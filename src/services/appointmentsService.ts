// src/services/appointmentsService.ts

import { db } from "../config/firebaseConfig";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { syncQueueService } from "./offline/SyncQueueService";
import { offlineAuthService } from "./offline/OfflineAuthService";
import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getDocs } from "firebase/firestore";
// ============================================================
//                    TIPOS DE CITA
// ============================================================

export interface Appointment {
  id?: string;
  title: string;
  doctor?: string;
  location?: string;
  date: string;
  time?: string | null;
  eventId?: string | null;
  createdAt?: any;
  updatedAt?: any;
  isArchived?: boolean;
}

// ============================================================
//                    FUNCIONES CRUD
// ============================================================
export async function getAppointmentsForCaregiver(
  userId: string,
  loggedUserId: string
): Promise<Appointment[]> {
  // Si es el propio usuario, usar método normal
  if (userId === loggedUserId) {
    return loadLocalAppointments(userId);
  }

  // Para cuidadores: intentar cache primero, luego Firestore
  try {
    // Intentar desde cache
    const cached = await syncQueueService.getFromCache("appointments", userId);

    if (cached && cached.data && cached.data.length > 0) {
      const activeItems = cached.data.filter((item: any) => {
        return !(item.isArchived === true || !!item.archivedAt);
      });
      return activeItems as Appointment[];
    }

    // Si no hay cache, leer directamente de Firestore

    const netState = await NetInfo.fetch();
    const isOnline =
      netState.isConnected === true && netState.isInternetReachable !== false;

    if (!isOnline) {
      return [];
    }

    const apptsRef = collection(db, "users", userId, "appointments");
    const q = query(apptsRef, orderBy("date", "asc"));
    const snapshot = await getDocs(q);

    const appointments = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Appointment[];

    // Guardar en cache temporal para futuras consultas
    try {
      const currentValidUid = syncQueueService.getCurrentValidUserId();

      if (currentValidUid && currentValidUid === userId) {
        await syncQueueService.saveToCache(
          "appointments",
          userId,
          appointments
        );
      }
    } catch (cacheError) {}

    return appointments.filter((a) => !a.isArchived);
  } catch (error) {
    return [];
  }
}

// src/services/appointmentsService.ts

export async function createAppointment(
  userId: string | null | undefined,
  data: Appointment,
  forcedId?: string
): Promise<string> {
  const validUid = syncQueueService.getCurrentValidUserId();
  const finalUid = userId ?? validUid;

  if (!finalUid) {
    throw new Error("No hay usuario válido para crear cita (offline/online).");
  }

  // si ya hay validUid establecido, exige consistencia
  if (validUid && finalUid !== validUid) {
    throw new Error("UID inválido para crear cita.");
  }

  const tempId =
    forcedId ?? `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

  const appointmentData = {
    ...data,
    createdAt: data.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _createdLocally: true,
    isArchived: data.isArchived ?? false,
  };

  await syncQueueService.enqueue(
    "CREATE",
    "appointments",
    tempId,
    finalUid,
    appointmentData as any
  );

  return tempId;
}

export async function updateAppointment(
  userId: string | null | undefined,
  appointmentId: string,
  data: Partial<Appointment>
): Promise<void> {
  const validUid = syncQueueService.getCurrentValidUserId();
  const finalUid = userId ?? validUid;

  if (!finalUid) {
    throw new Error("No hay usuario válido para actualizar cita.");
  }

  if (validUid && finalUid !== validUid) {
    throw new Error("UID inválido para actualizar cita.");
  }

  const updateData = {
    ...data,
    updatedAt: new Date().toISOString(),
  };

  await syncQueueService.enqueue(
    "UPDATE",
    "appointments",
    appointmentId,
    finalUid,
    updateData as any
  );
}

export async function deleteAppointment(appointmentId: string): Promise<void> {
  const userId = syncQueueService.getCurrentValidUserId();

  if (!userId) {
    throw new Error("No hay usuario válido");
  }

  await syncQueueService.enqueue(
    "DELETE",
    "appointments",
    appointmentId,
    userId,
    {}
  );
}

// ============================================================
//              FUNCIONES DE LECTURA (CON CACHE)
// ============================================================

export function listenAppointments(
  userId: string,
  onChange: (appointments: Appointment[]) => void,
  onError?: (error: any) => void
): () => void {
  let active = true;

  // 1️ Cargar primero datos locales (protegido)
  loadLocalAppointments(userId).then((localAppts) => {
    const validUid = syncQueueService.getCurrentValidUserId();
    if (!active || !validUid || validUid !== userId) return;

    if (localAppts.length > 0) {
      onChange(localAppts);
    }
  });

  const apptsRef = collection(db, "users", userId, "appointments");
  const q = query(apptsRef, orderBy("date", "asc"));

  // 2️ Suscripción Firestore protegida por UID válido
  const unsubscribe = onSnapshot(
    q,
    async (snapshot) => {
      const validUid = syncQueueService.getCurrentValidUserId();
      if (!active || !validUid || validUid !== userId) return;

      const appointments: Appointment[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as any),
      }));

      onChange(appointments);

      const apptsWithId = appointments.filter(
        (a): a is Appointment & { id: string } => !!a.id
      );

      await syncQueueService.saveToCache(
        "appointments",
        userId,
        apptsWithId as any
      );
    },
    async (error) => {
      const validUid = syncQueueService.getCurrentValidUserId();
      if (!active || !validUid || validUid !== userId) return;

      try {
        const localAppts = await loadLocalAppointments(userId);
        if (localAppts.length > 0) {
          onChange(localAppts);
        }
      } catch {
        // no-op
      }

      onError?.(error);
    }
  );

  // 3️ Cleanup correcto
  return () => {
    active = false;
    unsubscribe();
  };
}

async function loadLocalAppointments(userId: string): Promise<Appointment[]> {
  try {
    const cached = await syncQueueService.getFromCache<Appointment>(
      "appointments",
      userId
    );

    if (cached && cached.data) {
      return (cached.data as any[]).sort((a, b) => {
        return (a.date || "").localeCompare(b.date || "");
      }) as Appointment[];
    }

    return [];
  } catch {
    return [];
  }
}

export async function getAppointmentById(
  userId: string,
  appointmentId: string
): Promise<Appointment | null> {
  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const docRef = doc(db, "users", userId, "appointments", appointmentId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return {
        id: docSnap.id,
        ...(docSnap.data() as any),
      } as Appointment;
    }

    // Fallback a caché
    const cached = await syncQueueService.getFromCache<Appointment>(
      "appointments",
      userId
    );
    if (cached && cached.data) {
      const found = (cached.data as any[]).find((a) => a.id === appointmentId);
      if (found) return found as Appointment;
    }

    return null;
  } catch {
    const cached = await syncQueueService.getFromCache<Appointment>(
      "appointments",
      userId
    );
    if (cached && cached.data) {
      const found = (cached.data as any[]).find((a) => a.id === appointmentId);
      if (found) return found as Appointment;
    }

    return null;
  }
}

export default {
  createAppointment,
  updateAppointment,
  deleteAppointment,
  listenAppointments,
  getAppointmentById,
  getAppointmentsForCaregiver,
};
