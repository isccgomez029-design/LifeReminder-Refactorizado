// src/services/appointmentsService.ts
// 🔥 Servicio de citas con soporte offline-first

import { db } from "../config/firebaseConfig";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { syncQueueService } from "./offline/SyncQueueService";

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
}

// ============================================================
//                    FUNCIONES CRUD
// ============================================================

export async function createAppointment(
  userId: string,
  data: Appointment
): Promise<string> {
  const tempId = `temp_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;

  const appointmentData = {
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _createdLocally: true,
  };

  await syncQueueService.enqueue(
    "CREATE",
    "appointments",
    tempId,
    userId,
    appointmentData
  );

  return tempId;
}

export async function updateAppointment(
  userId: string,
  appointmentId: string,
  data: Partial<Appointment>
): Promise<void> {
  const updateData = {
    ...data,
    updatedAt: new Date().toISOString(),
  };

  await syncQueueService.enqueue(
    "UPDATE",
    "appointments",
    appointmentId,
    userId,
    updateData
  );
}

export async function deleteAppointment(appointmentId: string): Promise<void> {
  const { auth } = await import("../config/firebaseConfig");
  const userId = auth.currentUser?.uid;

  if (!userId) {
    throw new Error("No hay usuario autenticado");
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
  // Primero cargar datos locales
  loadLocalAppointments(userId).then((localAppts) => {
    if (localAppts.length > 0) {
      onChange(localAppts);
    }
  });

  const apptsRef = collection(db, "users", userId, "appointments");
  const q = query(apptsRef, orderBy("date", "asc"));

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const appointments: Appointment[] = snapshot.docs.map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
          } as Appointment)
      );

      onChange(appointments);

      // Guardar en caché usando saveToCache (array completo)
      const apptsWithId = appointments.filter(
        (a): a is Appointment & { id: string } => !!a.id
      );
      syncQueueService.saveToCache("appointments", userId, apptsWithId);
    },
    (error) => {
      loadLocalAppointments(userId).then((localAppts) => {
        if (localAppts.length > 0) {
          onChange(localAppts);
        }
      });

      onError?.(error);
    }
  );

  return unsubscribe;
}

async function loadLocalAppointments(userId: string): Promise<Appointment[]> {
  try {
    const cached = await syncQueueService.getFromCache<Appointment>(
      "appointments",
      userId
    );

    if (cached && cached.data) {
      return cached.data.sort((a, b) => {
        return (a.date || "").localeCompare(b.date || "");
      });
    }

    return [];
  } catch (error) {
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
        ...docSnap.data(),
      } as Appointment;
    }

    // Fallback a caché
    const cached = await syncQueueService.getFromCache<Appointment>(
      "appointments",
      userId
    );
    if (cached && cached.data) {
      const found = cached.data.find((a) => a.id === appointmentId);
      if (found) return found;
    }

    return null;
  } catch (error) {
    const cached = await syncQueueService.getFromCache<Appointment>(
      "appointments",
      userId
    );
    if (cached && cached.data) {
      const found = cached.data.find((a) => a.id === appointmentId);
      if (found) return found;
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
};
