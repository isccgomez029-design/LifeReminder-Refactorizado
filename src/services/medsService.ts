// src/services/medsService.ts
// 💊 Servicio de medicamentos (offline-first) + helpers de dominio
// - Este servicio maneja: lectura/cache/cola CRUD y casos de uso de medicamentos.
// - Alarmas NO se programan aquí directamente con OfflineAlarmService: se delegan a medsAlarmsService.

import { db } from "../config/firebaseConfig";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  orderBy,
} from "firebase/firestore";

import { syncQueueService } from "./offline/SyncQueueService";
import medsAlarmsService, { MedAlarmInput } from "./alarms/medsAlarmsService";

// ============================================================
//                    TIPOS DE MEDICAMENTO
// ============================================================

export interface Medication {
  id?: string;
  nombre: string;

  // Frecuencia (string libre hoy). En tu UI suele ser "HH:mm" intervalo.
  frecuencia?: string;

  // Hora de primera toma en formato "HH:mm" (en tu UI: proximaToma)
  proximaToma?: string;

  // Próxima toma calculada (Date o ISO en storage)
  nextDueAt?: Date | null;

  dosis?: string;
  doseAmount?: number;
  doseUnit?: "tabletas" | "ml";

  cantidadInicial?: number;
  cantidadActual?: number;
  cantidadPorToma?: number;

  imageUri?: string;

  low20Notified?: boolean;
  low10Notified?: boolean;

  isArchived?: boolean;
  archivedAt?: string;

  createdAt?: any;
  updatedAt?: any;

  lastTakenAt?: any;
  takenToday?: boolean;

  // Alarmas / Snooze
  currentAlarmId?: string | null;
  snoozeCount?: number;
  snoozedUntil?: Date | null;
  lastSnoozeAt?: Date | null;

  // Flags internos opcionales
  _createdLocally?: boolean;
}

// ============================================================
//                  HELPERS DE DOMINIO
// ============================================================

/**
 * Convierte frecuencia a ms.
 * - Soporta tu formato actual "HH:mm" (intervalo).
 * - También soporta expresiones tipo: "8h", "cada 8 horas", "diario", "cada 2 días".
 */
export function freqToMs(freq?: string): number | null {
  if (!freq) return null;
  const f = String(freq).trim().toLowerCase();

  // Caso principal de tu app: "HH:mm" intervalo
  const hhmm = f.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    const totalMinutes = h * 60 + m;
    if (totalMinutes <= 0) return null;
    return totalMinutes * 60 * 1000;
  }

  // Horas: "8h", "8 h", "cada 8 horas", "cada 8 hrs"
  const hourMatch =
    f.match(/(\d+)\s*h\b/) || f.match(/cada\s+(\d+)\s*(hora|horas|hr|hrs)\b/);
  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    if (!Number.isFinite(hours) || hours <= 0) return null;
    return hours * 60 * 60 * 1000;
  }

  // Días: "diario", "cada 1 día", "cada 2 dias"
  if (
    f.includes("diario") ||
    f.includes("cada día") ||
    f.includes("cada dia")
  ) {
    return 24 * 60 * 60 * 1000;
  }

  const dayMatch = f.match(/cada\s+(\d+)\s*(día|dias|días)\b/);
  if (dayMatch) {
    const days = Number(dayMatch[1]);
    if (!Number.isFinite(days) || days <= 0) return null;
    return days * 24 * 60 * 60 * 1000;
  }

  return null;
}

/**
 * Devuelve una Date para "hoy a HH:mm". Si la hora ya pasó, devuelve mañana a HH:mm.
 */
export function computeFirstDueFromTime(
  hhmm?: string,
  now = new Date()
): Date | null {
  if (!hhmm) return null;
  const [hhStr, mmStr] = String(hhmm).split(":");
  const hh = Number(hhStr);
  const mm = Number(mmStr);

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;

  const candidate = new Date(now);
  candidate.setHours(hh, mm, 0, 0);

  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate;
}

/**
 * Calcula nextDueAt basado en:
 * - Si hay "proximaToma" => primera fecha desde esa hora
 * - Si no, pero hay frecuencia => now + frecuencia
 */
export function computeNextDueAt(params: {
  now?: Date;
  frecuencia?: string;
  proximaToma?: string;
}): Date | null {
  const now = params.now ?? new Date();

  const first = computeFirstDueFromTime(params.proximaToma, now);
  if (first) return first;

  const ms = freqToMs(params.frecuencia);
  if (!ms) return null;

  return new Date(now.getTime() + ms);
}

function toIsoNow(now = new Date()) {
  return now.toISOString();
}

function normalizeDatesFromCache(med: any): Medication {
  return {
    ...med,
    nextDueAt: med?.nextDueAt ? new Date(med.nextDueAt) : null,
    snoozedUntil: med?.snoozedUntil ? new Date(med.snoozedUntil) : null,
    lastSnoozeAt: med?.lastSnoozeAt ? new Date(med.lastSnoozeAt) : null,
  } as Medication;
}

function toMedAlarmInput(med: Medication & { id: string }): MedAlarmInput {
  return {
    id: med.id,
    nombre: med.nombre,
    dosis: med.dosis,
    imageUri: med.imageUri,
    frecuencia: med.frecuencia,
    cantidadActual: med.cantidadActual,
    cantidadPorToma: med.cantidadPorToma,
    proximaToma: med.proximaToma,
    nextDueAt: med.nextDueAt ?? null,
    currentAlarmId: med.currentAlarmId ?? null,
    snoozeCount: med.snoozeCount ?? 0,
    snoozedUntil: med.snoozedUntil ?? null,
    lastSnoozeAt: med.lastSnoozeAt ?? null,
  };
}

// ============================================================
//                  CACHE HELPERS (OFFLINE-FIRST)
// ============================================================

async function getCachedActiveMedList(
  userId: string
): Promise<(Medication & { id: string })[]> {
  const cached = await syncQueueService.getFromCache<any>(
    "medications",
    userId
  );
  const data = cached?.data || [];
  return (data || [])
    .filter((m: any) => !!m?.id)
    .map((m: any) => normalizeDatesFromCache(m))
    .filter((m: any) => !m.isArchived) as any;
}

async function upsertCachedMed(
  userId: string,
  med: Medication & { id: string }
) {
  // ⚠️ OJO: esto actualiza cache de ACTIVOS (sin archivados), consistente con UI de hoy.
  const list = await getCachedActiveMedList(userId);
  const idx = list.findIndex((x) => x.id === med.id);

  const next = [...list];
  if (med.isArchived) {
    // si viene archivado, lo removemos de activos
    const filtered = next.filter((m) => m.id !== med.id);
    await syncQueueService.saveToCache("medications", userId, filtered);
    return;
  }

  if (idx >= 0) next[idx] = med;
  else next.unshift(med);

  await syncQueueService.saveToCache("medications", userId, next);
}

async function removeCachedMed(userId: string, medId: string) {
  const list = await getCachedActiveMedList(userId);
  const next = list.filter((m) => m.id !== medId);
  await syncQueueService.saveToCache("medications", userId, next);
}

// ============================================================
//                    FUNCIONES CRUD (BASE)
// ============================================================

/**
 * ✅ CREAR medicamento (offline-first)
 * - Solo crea/encola y actualiza cache.
 * - Alarmas: prográmalas desde el flujo (ej. AddMedication) usando medsAlarmsService.
 */
export async function createMedication(
  userId: string,
  data: Partial<Medication>
): Promise<string> {
  const tempId = `temp_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;

  const medicationData: Partial<Medication> = {
    ...data,
    createdAt: toIsoNow(),
    updatedAt: toIsoNow(),
    isArchived: false,
    _createdLocally: true,
  };

  await syncQueueService.enqueue(
    "CREATE",
    "medications",
    tempId,
    userId,
    medicationData
  );

  // Optimistic cache (activos)
  await upsertCachedMed(userId, {
    id: tempId,
    ...(medicationData as any),
  });

  return tempId;
}

/**
 * ✅ ACTUALIZAR medicamento (offline-first)
 */
export async function updateMedication(
  userId: string,
  medId: string,
  data: Partial<Medication>
): Promise<void> {
  const updateData: Partial<Medication> = {
    ...data,
    updatedAt: toIsoNow(),
  };

  await syncQueueService.enqueue(
    "UPDATE",
    "medications",
    medId,
    userId,
    updateData
  );

  // Optimistic cache: merge con lo cacheado si existe
  const existing = await syncQueueService.getItemFromCache(
    "medications",
    userId,
    medId
  );

  const merged = normalizeDatesFromCache({
    ...(existing || {}),
    id: medId,
    ...(updateData as any),
  });

  await upsertCachedMed(userId, merged as any);
}

/**
 * ✅ ELIMINAR medicamento (offline-first)
 */
export async function deleteMedication(
  userId: string,
  medId: string
): Promise<void> {
  await syncQueueService.enqueue("DELETE", "medications", medId, userId, {});
  await removeCachedMed(userId, medId);
}

/**
 * ✅ ARCHIVAR medicamento (offline-first)
 */
export async function archiveMedicationOfflineFirst(
  userId: string,
  medId: string
): Promise<void> {
  await updateMedication(userId, medId, {
    isArchived: true,
    archivedAt: toIsoNow(),
  });

  // Cache: remover de activos
  await removeCachedMed(userId, medId);
}

// ============================================================
//              FUNCIONES DE LECTURA (CON CACHE)
// ============================================================

/**
 * 📦 Cargar medicamentos activos desde cache local
 */
export async function loadLocalMedications(
  userId: string
): Promise<Medication[]> {
  try {
    const cached = await syncQueueService.getFromCache<any>(
      "medications",
      userId
    );
    const localData = cached?.data || [];

    return (localData || [])
      .filter((med: any) => !med.isArchived)
      .map((med: any) => normalizeDatesFromCache(med));
  } catch (error) {
    console.log("❌ Error cargando medicamentos locales:", error);
    return [];
  }
}

/**
 * 📖 Escuchar medicamentos en tiempo real (con fallback a cache)
 * Nota: Este listener guarda el resultado (activos) a cache para UI rápida.
 */
export function listenMedications(
  userId: string,
  onChange: (medications: Medication[]) => void,
  onError?: (error: any) => void
): () => void {
  loadLocalMedications(userId).then((localMeds) => {
    if (localMeds.length > 0) onChange(localMeds);
  });

  const medsRef = collection(db, "users", userId, "medications");
  const q = query(
    medsRef,
    where("isArchived", "==", false),
    orderBy("createdAt", "desc")
  );

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const medications: Medication[] = snapshot.docs.map((d) => {
        const data: any = d.data();
        return {
          id: d.id,
          ...data,
          nextDueAt:
            data?.nextDueAt?.toDate?.() ||
            (data?.nextDueAt ? new Date(data.nextDueAt) : null),
          snoozedUntil:
            data?.snoozedUntil?.toDate?.() ||
            (data?.snoozedUntil ? new Date(data.snoozedUntil) : null),
          lastSnoozeAt:
            data?.lastSnoozeAt?.toDate?.() ||
            (data?.lastSnoozeAt ? new Date(data.lastSnoozeAt) : null),
        } as Medication;
      });

      onChange(medications);

      const medsWithId = medications.filter(
        (m): m is Medication & { id: string } => !!m.id
      );

      // Cache activos
      syncQueueService.saveToCache("medications", userId, medsWithId);
    },
    (error) => {
      console.log("❌ Error escuchando medicamentos:", error);

      loadLocalMedications(userId).then((localMeds) => {
        if (localMeds.length > 0) {
          console.log("📦 Usando medicamentos desde cache local");
          onChange(localMeds);
        }
      });

      onError?.(error);
    }
  );

  return unsubscribe;
}

/**
 * 📖 Obtener un medicamento por ID (con fallback a cache)
 */
export async function getMedicationById(
  userId: string,
  medId: string
): Promise<Medication | null> {
  try {
    const docRef = doc(db, "users", userId, "medications", medId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data: any = docSnap.data();
      return {
        id: docSnap.id,
        ...data,
        nextDueAt:
          data?.nextDueAt?.toDate?.() ||
          (data?.nextDueAt ? new Date(data.nextDueAt) : null),
        snoozedUntil:
          data?.snoozedUntil?.toDate?.() ||
          (data?.snoozedUntil ? new Date(data.snoozedUntil) : null),
        lastSnoozeAt:
          data?.lastSnoozeAt?.toDate?.() ||
          (data?.lastSnoozeAt ? new Date(data.lastSnoozeAt) : null),
      } as Medication;
    }

    const localData = await syncQueueService.getItemFromCache(
      "medications",
      userId,
      medId
    );
    if (localData) return normalizeDatesFromCache({ ...localData, id: medId });

    return null;
  } catch (error) {
    console.log("❌ Error obteniendo medicamento:", error);

    const localData = await syncQueueService.getItemFromCache(
      "medications",
      userId,
      medId
    );
    if (localData) return normalizeDatesFromCache({ ...localData, id: medId });

    return null;
  }
}

/**
 * 📖 Obtener lista activa desde cache (rápido, útil para pantallas)
 */
export async function getActiveMedsFromCache(userId: string) {
  return await getCachedActiveMedList(userId);
}

// ============================================================
//              CASOS DE USO (PARA LIMPIAR UI)
// ============================================================

/**
 * ✅ Marcar tomada (offline-first) + reprogramar alarma (delegado a medsAlarmsService).
 *
 * - Calcula inventario / flags low-stock (NO envía notificación; eso lo decide la UI).
 * - Cancela duplicados y programa la siguiente alarma si hay frecuencia válida.
 * - Persiste TODO con un solo flujo (cache + cola) usando medsAlarmsService extraPatch.
 */
export async function markMedicationTakenAndRescheduleOfflineFirst(params: {
  ownerUid: string;
  med: Medication & { id: string };
  patientName?: string;
  now?: Date;
}): Promise<{
  nextDueAt: Date | null;
  patch: Partial<Medication>;
  lowStockLevel: 0 | 20 | 10;
}> {
  const now = params.now ?? new Date();
  const med = params.med;

  const initial = Number(med.cantidadInicial ?? 0);
  const actual = Number(med.cantidadActual ?? initial);
  const perDose = Number(med.cantidadPorToma ?? 1);

  if (actual <= 0) {
    throw new Error("med/out-of-stock");
  }

  const nuevaCantidad = Math.max(0, actual - perDose);

  // % restante (evita división por 0)
  const percent = initial > 0 ? (nuevaCantidad / initial) * 100 : 100;

  const prevLow20 = med.low20Notified ?? false;
  const prevLow10 = med.low10Notified ?? false;

  const willLow20 = !prevLow20 && percent <= 20 && percent > 10;
  const willLow10 = !prevLow10 && percent <= 10;

  let lowStockLevel: 0 | 20 | 10 = 0;
  if (willLow10) lowStockLevel = 10;
  else if (willLow20) lowStockLevel = 20;

  const intervalMs = freqToMs(med.frecuencia);
  const nextDueAt = intervalMs ? new Date(now.getTime() + intervalMs) : null;

  // Patch base del "taken"
  const basePatch: Partial<Medication> = {
    lastTakenAt: toIsoNow(now),
    cantidadActual: nuevaCantidad,
    // compat legacy si lo usas en algún lado:
    cantidadPorToma: med.cantidadPorToma ?? 1,
    low20Notified: prevLow20 || willLow20,
    low10Notified: prevLow10 || willLow10,
    updatedAt: toIsoNow(now),
    snoozeCount: 0,
    snoozedUntil: null,
    lastSnoozeAt: null,
  };

  // Si NO hay frecuencia interpretable, solo persistimos el patch base (sin alarma)
  if (!nextDueAt) {
    await updateMedication(params.ownerUid, med.id, basePatch);
    return { nextDueAt: null, patch: basePatch, lowStockLevel };
  }

  // ✅ Programar alarma + persistir TODO junto (extraPatch)
  const { patch } = await medsAlarmsService.scheduleMedAlarmAndPersist({
    ownerUid: params.ownerUid,
    med: toMedAlarmInput({ ...med, cantidadActual: nuevaCantidad }),
    triggerDate: nextDueAt,
    patientName: params.patientName,
    snoozeCount: 0,
    extraPatch: basePatch,
    // persist default true
  });

  return {
    nextDueAt,
    patch: { ...(basePatch as any), ...(patch as any) },
    lowStockLevel,
  };
}

/**
 * ✅ Archivar medicamento + cancelar todas sus alarmas (offline-first)
 */
export async function archiveMedicationWithAlarmsOfflineFirst(params: {
  ownerUid: string;
  medId: string;
}): Promise<void> {
  // 1) Cancelar alarmas del item
  await medsAlarmsService.cancelAllMedAlarmsForItem({
    ownerUid: params.ownerUid,
    medId: params.medId,
  });

  // 2) Archivar en cola + cache
  await archiveMedicationOfflineFirst(params.ownerUid, params.medId);
}

/**
 * ✅ Reconciliar alarmas faltantes para meds activos (post-sync)
 * (Delegado a medsAlarmsService)
 */
export async function reconcileMissingMedAlarms(params: {
  ownerUid: string;
  meds: (Medication & { id: string })[];
  patientName?: string;
}) {
  return await medsAlarmsService.reconcileMissingMedAlarmsAndPersist({
    ownerUid: params.ownerUid,
    meds: params.meds.map((m) => toMedAlarmInput(m)),
    patientName: params.patientName,
  });
}

// ============================================================
//                    HOOK PERSONALIZADO
// ============================================================

export function useMedsService() {
  return {
    // CRUD base
    createMedication,
    updateMedication,
    deleteMedication,
    archiveMedicationOfflineFirst,

    // Lectura
    listenMedications,
    loadLocalMedications,
    getMedicationById,
    getActiveMedsFromCache,

    // Helpers
    freqToMs,
    computeFirstDueFromTime,
    computeNextDueAt,

    // Casos de uso
    markMedicationTakenAndRescheduleOfflineFirst,
    archiveMedicationWithAlarmsOfflineFirst,
    reconcileMissingMedAlarms,
  };
}

export default {
  createMedication,
  updateMedication,
  deleteMedication,
  archiveMedicationOfflineFirst,
  listenMedications,
  loadLocalMedications,
  getMedicationById,
  getActiveMedsFromCache,
  freqToMs,
  computeFirstDueFromTime,
  computeNextDueAt,
  markMedicationTakenAndRescheduleOfflineFirst,
  archiveMedicationWithAlarmsOfflineFirst,
  reconcileMissingMedAlarms,
};
