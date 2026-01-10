// src/services/medsService.ts

import { db } from "../config/firebaseConfig";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  Unsubscribe,
  getDoc,
} from "firebase/firestore";

import { syncQueueService } from "./offline/SyncQueueService";
import { offlineAlarmService } from "./offline/OfflineAlarmService";
import { sendImmediateNotification } from "./Notifications";
import { archiveMedication as archiveMedicationHelper } from "../utils/archiveHelpers";
import { normalizeTime } from "../utils/timeUtils";
import { shouldNotifyMedLow20, shouldNotifyMedLow10 } from "./settingsService";


export interface Medication {
  id?: string;
  nombre: string;
  frecuencia?: string; // "HH:mm"
  proximaToma?: string;
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

  // Alarma + posposición
  currentAlarmId?: string | null;
  snoozeCount?: number;
  snoozedUntil?: Date | null;
  lastSnoozeAt?: Date | null;
}


export function freqToMs(freq?: string): number {
  if (!freq) return 0;
  const match = freq.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return (h * 60 + m) * 60 * 1000;
}

export function toDateSafe(v: any): Date | null {
  if (!v) return null;

  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof v?.toDate === "function") {
    const d = v.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }

  if (typeof v?.seconds === "number") {
    const d = new Date(v.seconds * 1000);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

export function normalizeMedication(raw: any): Medication {
  return {
    id: raw.id,
    nombre: raw.nombre || "Medicamento sin nombre",
    dosis: raw.dosis,
    frecuencia: raw.frecuencia,
    proximaToma: raw.proximaToma,
    nextDueAt: toDateSafe(raw.nextDueAt),

    doseAmount: raw.doseAmount,
    doseUnit: raw.doseUnit,

    cantidadInicial: raw.cantidadInicial ?? 0,
    cantidadActual: raw.cantidadActual ?? 0,
    cantidadPorToma: raw.cantidadPorToma ?? 1,

    imageUri: raw.imageUri || "",

    low20Notified: raw.low20Notified ?? false,
    low10Notified: raw.low10Notified ?? false,

    isArchived: raw.isArchived ?? false,
    archivedAt: raw.archivedAt,

    currentAlarmId: raw.currentAlarmId ?? null,
    snoozeCount: raw.snoozeCount ?? 0,
    snoozedUntil: toDateSafe(raw.snoozedUntil),
    lastSnoozeAt: toDateSafe(raw.lastSnoozeAt),

    lastTakenAt: toDateSafe(raw.lastTakenAt) ?? raw.lastTakenAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export function isSnoozed(med: Medication, now: Date): boolean {
  if (!med.snoozedUntil) return false;
  return med.snoozedUntil > now;
}

export function isMedTaken(med: Medication, now: Date): boolean {
  if (isSnoozed(med, now)) return false;
  if (med.nextDueAt && now < med.nextDueAt) return true;
  return false;
}


export async function createMedication(
  userId: string,
  data: Partial<Medication>
): Promise<string> {
  const validUid = syncQueueService.getCurrentValidUserId();
  if (!validUid || validUid !== userId) {
    return "";
  }

  const tempId = `temp_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;

  const medicationData = {
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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

  return tempId;
}

export async function updateMedication(
  userId: string,
  medId: string,
  data: Partial<Medication>
): Promise<void> {
  const validUid = syncQueueService.getCurrentValidUserId();
  if (!validUid || validUid !== userId) return;

  const updateData = { ...data, updatedAt: new Date().toISOString() };

  await syncQueueService.enqueue(
    "UPDATE",
    "medications",
    medId,
    userId,
    updateData
  );
}

export async function deleteMedication(
  userId: string,
  medId: string
): Promise<void> {
  const validUid = syncQueueService.getCurrentValidUserId();
  if (!validUid || validUid !== userId) return;

  await syncQueueService.enqueue("DELETE", "medications", medId, userId, {});
}


export async function archiveMedication(
  userId: string,
  medId: string,
  medData?: any
): Promise<void> {
  await archiveMedicationHelper(userId, medId, medData);
}


export async function getActiveMedsFromCache(
  userId: string
): Promise<Medication[]> {

  const activeItems = await syncQueueService.getActiveItems(
    "medications",
    userId
  );
  if (!activeItems) return [];
  return activeItems.map((x: any) => normalizeMedication(x));
}

export function subscribeMedicationsFirestore(
  userId: string,
  onChange: (medications: Medication[]) => void,
  onError?: (error: any) => void
): Unsubscribe {
  const medsRef = collection(db, "users", userId, "medications");


  const q = query(medsRef);

  return onSnapshot(
    q,
    async (snapshot) => {

      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Guardar cache completo (activos + archivados) para que History también funcione
      await syncQueueService.saveToCache("medications", userId, items);

      const active = await syncQueueService.getActiveItems(
        "medications",
        userId
      );
      const meds = (active || []).map((x: any) => normalizeMedication(x));
      onChange(meds);
    },
    (error) => {
      onError?.(error);
    }
  );
}

export async function getMedicationById(
  userId: string,
  medId: string
): Promise<Medication | null> {
  try {
    const ref = doc(db, "users", userId, "medications", medId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      return normalizeMedication({ id: snap.id, ...data });
    }
  } catch {
    // ignore
  }

  const localData = await syncQueueService.getItemFromCache(
    "medications",
    userId,
    medId
  );
  if (!localData) return null;
  return normalizeMedication({ id: medId, ...localData });
}


type MarkTakenInput = {
  ownerUid: string;
  med: Medication & { id: string };
  patientName?: string;
};

type MarkTakenResult = {
  updatedMed: Medication & { id: string };
};

export async function markMedicationTaken(
  input: MarkTakenInput
): Promise<MarkTakenResult> {
  const { ownerUid, med, patientName } = input;

  const validUid = syncQueueService.getCurrentValidUserId();
  if (!validUid || validUid !== ownerUid) {
    throw new Error("INVALID_SESSION");
  }

  if (med.currentAlarmId) {
    await offlineAlarmService.cancelAlarm(med.currentAlarmId);
  }

  const nowDate = new Date();
  const intervalMs = freqToMs(med.frecuencia);

  const initial = med.cantidadInicial ?? 0;
  const actual = med.cantidadActual ?? initial;
  const porToma = med.cantidadPorToma ?? 1;
  const nuevaCantidad = Math.max(0, actual - porToma);

  let low20 = med.low20Notified ?? false;
  let low10 = med.low10Notified ?? false;

  const porcentaje = initial > 0 ? nuevaCantidad / initial : 0;

  if (
    !low20 &&
    porcentaje <= 0.2 &&
    porcentaje > 0.1 &&
    (await shouldNotifyMedLow20())
  ) {
    await sendImmediateNotification(
      `Queda poco de ${med.nombre}`,
      "Te queda aproximadamente el 20%."
    );
    low20 = true;
  }

  if (!low10 && porcentaje <= 0.1 && (await shouldNotifyMedLow10())) {
    await sendImmediateNotification(
      `⚠️ ${med.nombre} casi se termina`,
      "Solo te queda el 10% del medicamento."
    );
    low10 = true;
  }

  let nextDueAt: Date | null = null;
  let proximaTomaText = med.proximaToma ?? "";
  let newAlarmId: string | null = null;

  if (intervalMs > 0) {
    nextDueAt = new Date(nowDate.getTime() + intervalMs);
    proximaTomaText = nextDueAt.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const result = await offlineAlarmService.scheduleMedicationAlarm(
      nextDueAt,
      {
        nombre: med.nombre,
        dosis: med.dosis,
        imageUri: med.imageUri,
        medId: med.id,
        ownerUid,
        frecuencia: med.frecuencia,
        cantidadActual: nuevaCantidad,
        cantidadPorToma: porToma,
        patientName: patientName || "",
        snoozeCount: 0,
      }
    );

    if (result.success) newAlarmId = result.notificationId;
  }

  const updateData: any = {
    lastTakenAt: nowDate.toISOString(),
    cantidadActual: nuevaCantidad,
    low20Notified: low20,
    low10Notified: low10,
    updatedAt: nowDate.toISOString(),
    snoozeCount: 0,
    snoozedUntil: null,
    lastSnoozeAt: null,
  };

  if (newAlarmId) updateData.currentAlarmId = newAlarmId;
  if (nextDueAt) {
    updateData.nextDueAt = nextDueAt.toISOString();
    updateData.proximaToma = proximaTomaText;
  }

  await syncQueueService.enqueue(
    "UPDATE",
    "medications",
    med.id!,
    ownerUid,
    updateData
  );

  return {
    updatedMed: {
      ...med,
      cantidadActual: nuevaCantidad,
      nextDueAt,
      proximaToma: proximaTomaText,
      currentAlarmId: newAlarmId,
      low20Notified: low20,
      low10Notified: low10,
      lastTakenAt: nowDate,
    },
  };
}

type ReprogramInput = {
  ownerUid: string;
  meds: Array<Medication & { id: string }>;
  patientName?: string;
};


export async function reprogramMissingAlarms(
  input: ReprogramInput
): Promise<void> {
  const { ownerUid, meds, patientName } = input;

  for (const med of meds) {
    if (med.nextDueAt && !med.currentAlarmId) {
      const now = new Date();
      if (med.nextDueAt > now) {
        try {
          const result = await offlineAlarmService.scheduleMedicationAlarm(
            med.nextDueAt,
            {
              nombre: med.nombre,
              dosis: med.dosis,
              imageUri: med.imageUri,
              medId: med.id,
              ownerUid,
              frecuencia: med.frecuencia,
              cantidadActual: med.cantidadActual,
              cantidadPorToma: med.cantidadPorToma,
              patientName: patientName || "",
              snoozeCount: med.snoozeCount ?? 0,
            }
          );

          if (result.success && result.notificationId) {
            await syncQueueService.updateItemInCache(
              "medications",
              ownerUid,
              med.id,
              {
                currentAlarmId: result.notificationId,
              }
            );
          }
        } catch {
          // no-op
        }
      }
    }
  }
}


export function validateFrequency(freq: string): {
  ok: boolean;
  reason?: string;
} {
  const freqTrim = (freq || "").trim();
  if (!freqTrim) return { ok: false, reason: "Falta la frecuencia" };

  const freqMatch = freqTrim.match(/^(\d{1,2}):(\d{2})$/);
  if (!freqMatch) return { ok: false, reason: "Frecuencia inválida (HH:MM)" };

  const h = Number(freqMatch[1]);
  const m = Number(freqMatch[2]);
  if (
    !Number.isFinite(h) ||
    !Number.isFinite(m) ||
    h < 0 ||
    h > 23 ||
    m < 0 ||
    m > 59
  ) {
    return { ok: false, reason: "Revisa las horas y minutos de la frecuencia" };
  }

  return { ok: true };
}

export function computeFirstDoseDate(horaHHMM: string): Date | null {
  const horaTrim = (horaHHMM || "").trim();
  if (!horaTrim) return null;

  const normalized = normalizeTime(horaTrim);
  const [hours, minutes] = normalized.split(":").map(Number);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  const now = new Date();
  const firstDose = new Date();
  firstDose.setHours(hours, minutes, 0, 0);

  if (firstDose <= now) {
    firstDose.setDate(firstDose.getDate() + 1);
  }

  return firstDose;
}

export type UpsertMedicationInput = {
  ownerUid: string; // dueño real (paciente)
  loggedUid: string; // logueado
  medId?: string; // si existe, edit

  nombre: string;
  frecuencia: string;
  hora: string;

  cantidad: number;
  doseAmount: number;
  doseUnit: "tabletas" | "ml";
  imageUri?: string;
};

export type UpsertMedicationResult = {
  medicationId: string;
  nextDueAt: Date | null;
  alarmId: string | null;
  horaFormatted: string;
};

export async function upsertMedicationWithAlarm(
  input: UpsertMedicationInput
): Promise<UpsertMedicationResult> {
  const {
    ownerUid,
    loggedUid,
    medId,
    nombre,
    frecuencia,
    hora,
    cantidad,
    doseAmount,
    doseUnit,
    imageUri,
  } = input;

  if (!ownerUid || !loggedUid) throw new Error("NO_SESSION");
  if (ownerUid !== loggedUid) throw new Error("PERMISSION_DENIED");

  const isEdit = !!medId;

  const horaFormatted = hora.trim() ? normalizeTime(hora.trim()) : "";
  const freqTrim = (frecuencia || "").trim();

  const medicationId =
    isEdit && medId
      ? medId
      : `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const dosisString = `${doseAmount} ${doseUnit}`;

  if (isEdit && medId) {
    await offlineAlarmService.cancelAllAlarmsForItem(medId, ownerUid);
  }

  let nextDueAt: Date | null = null;
  let alarmId: string | null = null;

  if (horaFormatted && freqTrim) {
    nextDueAt = computeFirstDoseDate(horaFormatted);

    if (nextDueAt) {
      const result = await offlineAlarmService.scheduleMedicationAlarm(
        nextDueAt,
        {
          nombre: nombre.trim(),
          dosis: dosisString,
          imageUri: imageUri || undefined,
          medId: medicationId,
          ownerUid,
          frecuencia: freqTrim,
          cantidadActual: cantidad,
          cantidadPorToma: doseAmount || 1,
          snoozeCount: 0,
        }
      );

      if (result.success) alarmId = result.notificationId;
    }
  }

  const medicationData: any = {
    id: medicationId,
    nombre: nombre.trim(),
    dosis: dosisString,

    frecuencia: freqTrim,
    proximaToma: horaFormatted || null,
    nextDueAt: nextDueAt ? nextDueAt.toISOString() : null,

    doseAmount,
    doseUnit,
    cantidadPorToma: doseAmount || 1,

    cantidadInicial: cantidad,
    cantidadActual: cantidad,
    cantidad: cantidad,

    low20Notified: false,
    low10Notified: false,

    imageUri: imageUri || undefined,

    currentAlarmId: alarmId,
    snoozeCount: 0,
    snoozedUntil: null,
    lastSnoozeAt: null,

    createdAt: isEdit ? undefined : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isArchived: false,
  };

  if (isEdit && medId) {
    await syncQueueService.enqueue(
      "UPDATE",
      "medications",
      medId,
      ownerUid,
      medicationData
    );
  } else {
    await syncQueueService.enqueue(
      "CREATE",
      "medications",
      medicationId,
      ownerUid,
      medicationData
    );
  }

  return { medicationId, nextDueAt, alarmId, horaFormatted };
}

export async function deleteMedicationWithAlarms(input: {
  ownerUid: string;
  loggedUid: string;
  medId: string;
}): Promise<void> {
  const { ownerUid, loggedUid, medId } = input;

  if (!ownerUid || !loggedUid) throw new Error("NO_SESSION");
  if (ownerUid !== loggedUid) throw new Error("PERMISSION_DENIED");

  await offlineAlarmService.cancelAllAlarmsForItem(medId, ownerUid);

  await syncQueueService.enqueue("DELETE", "medications", medId, ownerUid, {});
}

// ============================================================
//                    EXPORT DEFAULT / HOOK
// ============================================================

export default {
  createMedication,
  updateMedication,
  deleteMedication,
  archiveMedication,
  getActiveMedsFromCache,
  subscribeMedicationsFirestore,
  getMedicationById,
  isMedTaken,
  isSnoozed,
  markMedicationTaken,
  reprogramMissingAlarms,

  validateFrequency,
  computeFirstDoseDate,
  upsertMedicationWithAlarm,
  deleteMedicationWithAlarms,
};
