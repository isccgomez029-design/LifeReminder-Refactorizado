// src/services/medsService.ts
// 🔥 Servicio de medicamentos con soporte offline-first

import { db } from "../config/firebaseConfig";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
} from "firebase/firestore";
import { syncQueueService } from "./offline";

// ============================================================
//                    TIPOS DE MEDICAMENTO
// ============================================================

export interface Medication {
  id?: string;
  nombre: string;
  frecuencia?: string;
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
  takenToday?: boolean;
  // 🆕 Campos para alarmas pospuestas
  currentAlarmId?: string | null;
  snoozeCount?: number;
  snoozedUntil?: Date | null;
  lastSnoozeAt?: Date | null;
}

// ============================================================
//                    FUNCIONES CRUD
// ============================================================

/**
 * ✅ CREAR medicamento (con soporte offline)
 */
export async function createMedication(
  userId: string,
  data: Partial<Medication>
): Promise<string> {
  // Generar ID temporal para el documento
  const tempId = `temp_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;

  const medicationData = {
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isArchived: false,
    _createdLocally: true, // Marcador para saber que se creó offline
  };

  // Encolar operación
  await syncQueueService.enqueue(
    "CREATE",
    "medications",
    tempId,
    userId,
    medicationData
  );

  return tempId;
}

/**
 * ✅ ACTUALIZAR medicamento (con soporte offline)
 */
export async function updateMedication(
  userId: string,
  medId: string,
  data: Partial<Medication>
): Promise<void> {
  const updateData = {
    ...data,
    updatedAt: new Date().toISOString(),
  };

  // Encolar operación
  await syncQueueService.enqueue(
    "UPDATE",
    "medications",
    medId,
    userId,
    updateData
  );
}

/**
 * ✅ ELIMINAR medicamento (con soporte offline)
 */
export async function deleteMedication(
  userId: string,
  medId: string
): Promise<void> {
  // Encolar operación de eliminación
  await syncQueueService.enqueue(
    "DELETE",
    "medications",
    medId,
    userId,
    {} // payload vacío para DELETE
  );
}

/**
 * ✅ ARCHIVAR medicamento (con soporte offline)
 */
export async function archiveMedication(
  userId: string,
  medId: string
): Promise<void> {
  await updateMedication(userId, medId, {
    isArchived: true,
    archivedAt: new Date().toISOString(),
  });
}

// ============================================================
//              FUNCIONES DE LECTURA (CON CACHE)
// ============================================================

/**
 * 📖 Escuchar medicamentos en tiempo real (con fallback a cache local)
 */
export function listenMedications(
  userId: string,
  onChange: (medications: Medication[]) => void,
  onError?: (error: any) => void
): () => void {
  // Primero cargar datos locales
  loadLocalMedications(userId).then((localMeds) => {
    if (localMeds.length > 0) {
      onChange(localMeds);
    }
  });

  // Luego escuchar cambios en Firestore (si hay conexión)
  const medsRef = collection(db, "users", userId, "medications");
  const q = query(medsRef, where("isArchived", "==", false));

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const medications: Medication[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          nextDueAt: data.nextDueAt?.toDate?.() || null,
          snoozedUntil: data.snoozedUntil?.toDate?.() || null,
          lastSnoozeAt: data.lastSnoozeAt?.toDate?.() || null,
        } as Medication;
      });

      onChange(medications);

      const medsWithId = medications.filter(
        (m): m is Medication & { id: string } => !!m.id
      );
      syncQueueService.saveToCache("medications", userId, medsWithId);
    },
    (error) => {
      console.log("❌ Error escuchando medicamentos:", error);

      // Si hay error de conexión, cargar desde cache local
      loadLocalMedications(userId).then((localMeds) => {
        if (localMeds.length > 0) {
          console.log("📦 Cargando medicamentos desde cache local");
          onChange(localMeds);
        }
      });

      onError?.(error);
    }
  );

  return unsubscribe;
}

/**
 * 📦 Cargar medicamentos desde cache local
 */
async function loadLocalMedications(userId: string): Promise<Medication[]> {
  try {
    const cached = await syncQueueService.getFromCache<any>(
      "medications",
      userId
    );
    const localData = cached?.data || [];

    return localData
      .filter((med: any) => !med.isArchived)
      .map((med: any) => ({
        ...med,
        nextDueAt: med.nextDueAt ? new Date(med.nextDueAt) : null,
        snoozedUntil: med.snoozedUntil ? new Date(med.snoozedUntil) : null,
        lastSnoozeAt: med.lastSnoozeAt ? new Date(med.lastSnoozeAt) : null,
      }));
  } catch (error) {
    console.log("❌ Error cargando medicamentos locales:", error);
    return [];
  }
}

/**
 * 📖 Obtener un medicamento por ID (con fallback a cache)
 */
export async function getMedicationById(
  userId: string,
  medId: string
): Promise<Medication | null> {
  try {
    // Intentar obtener de Firestore
    const docRef = doc(db, "users", userId, "medications", medId);
    const docSnap = await import("firebase/firestore").then(({ getDoc }) =>
      getDoc(docRef)
    );

    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ...data,
        nextDueAt: data.nextDueAt?.toDate?.() || null,
        snoozedUntil: data.snoozedUntil?.toDate?.() || null,
        lastSnoozeAt: data.lastSnoozeAt?.toDate?.() || null,
      } as Medication;
    }

    // Si no existe en Firestore, buscar en cache local
    const localData = await syncQueueService.getItemFromCache(
      "medications",
      userId,
      medId
    );

    if (localData) {
      return {
        ...localData,
        id: medId, // Ponerlo después del spread
        nextDueAt: (localData as any).nextDueAt
          ? new Date((localData as any).nextDueAt)
          : null,
        snoozedUntil: (localData as any).snoozedUntil
          ? new Date((localData as any).snoozedUntil)
          : null,
        lastSnoozeAt: (localData as any).lastSnoozeAt
          ? new Date((localData as any).lastSnoozeAt)
          : null,
      } as Medication;
    }

    return null;
  } catch (error) {
    console.log("❌ Error obteniendo medicamento:", error);

    // Fallback a cache local
    const localData = await syncQueueService.getItemFromCache(
      "medications",
      userId,
      medId
    );

    if (localData) {
      return {
        ...localData,
        id: medId, // Ponerlo después del spread
        nextDueAt: (localData as any).nextDueAt
          ? new Date((localData as any).nextDueAt)
          : null,
        snoozedUntil: (localData as any).snoozedUntil
          ? new Date((localData as any).snoozedUntil)
          : null,
        lastSnoozeAt: (localData as any).lastSnoozeAt
          ? new Date((localData as any).lastSnoozeAt)
          : null,
      } as Medication;
    }

    return null;
  }
}

// ============================================================
//                    HOOK PERSONALIZADO
// ============================================================

/**
 * 🪝 Hook para usar el servicio de medicamentos
 */
export function useMedsService() {
  return {
    createMedication,
    updateMedication,
    deleteMedication,
    archiveMedication,
    listenMedications,
    getMedicationById,
  };
}

// Exportar por defecto
export default {
  createMedication,
  updateMedication,
  deleteMedication,
  archiveMedication,
  listenMedications,
  getMedicationById,
};
