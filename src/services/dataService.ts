// src/services/dataService.ts
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  type Unsubscribe,
  Timestamp,
} from "firebase/firestore";
import { auth, db } from "../config/firebaseConfig";

/* ============ TIPOS ============ */

export type Appointment = {
  id: string;
  userId: string;
  title: string;
  doctor?: string;
  location?: string;
  date: string; // "YYYY-MM-DD"
  time?: string; // "HH:mm"
  eventId?: string; // id del evento en el calendario del dispositivo
};

export type Medication = {
  id: string;
  userId: string;
  name: string;
  dose: string; // "1 tableta", "10 ml", etc.
  frequency: string; // "Cada 8 horas", "1 vez al día", etc.
  nextTime?: string; // "HH:mm" o ISO si quieres
  pillsTotal?: number;
  pillsLeft?: number;
  notes?: string;
};

export type CareContact = {
  id: string;
  userId: string; // dueño del contacto (paciente)
  name: string;
  relation?: string; // "Mamá", "Hermano", "Doctor"
  phone?: string;
  email?: string;
};

/* ============ HELPERS ============ */

function requireUser() {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("No hay usuario autenticado");
  }
  return user;
}

/* ============ CITAS MÉDICAS ============ */

const apptsCol = collection(db, "appointments");

/**
 * Escucha en tiempo real las citas del usuario actual.
 * Devuelve una función para dejar de escuchar (unsubscribe).
 */
export function listenMyAppointments(
  onChange: (appointments: Appointment[]) => void,
  onError?: (err: any) => void
): Unsubscribe {
  const user = requireUser();

  const q = query(
    apptsCol,
    where("userId", "==", user.uid),
    orderBy("date", "asc"),
    orderBy("time", "asc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const list: Appointment[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          userId: data.userId,
          title: data.title,
          doctor: data.doctor,
          location: data.location,
          date: data.date,
          time: data.time,
          eventId: data.eventId,
        };
      });
      onChange(list);
    },
    (err) => {
      console.log("Error escuchando citas:", err);
      onError?.(err);
    }
  );
}

/** Crear una nueva cita para el usuario actual */
export async function createAppointment(data: {
  title: string;
  doctor?: string;
  location?: string;
  date: string; // "YYYY-MM-DD"
  time?: string; // "HH:mm"
  eventId?: string;
}) {
  const user = requireUser();

  const docRef = await addDoc(apptsCol, {
    userId: user.uid,
    ...data,
    createdAt: Timestamp.now(),
  });

  return docRef.id;
}

/** Actualizar una cita existente (por id de Firestore) */
export async function updateAppointment(
  id: string,
  data: Partial<Omit<Appointment, "id" | "userId">>
) {
  const user = requireUser();
  const ref = doc(db, "appointments", id);
  await updateDoc(ref, {
    ...data,
    userId: user.uid, // por seguridad mantenemos el userId
  });
}

/** Eliminar una cita por id */
export async function deleteAppointment(id: string) {
  const ref = doc(db, "appointments", id);
  await deleteDoc(ref);
}

/* ============ MEDICAMENTOS ============ */

const medsCol = collection(db, "medications");

export function listenMyMedications(
  onChange: (meds: Medication[]) => void,
  onError?: (err: any) => void
): Unsubscribe {
  const user = requireUser();

  const q = query(
    medsCol,
    where("userId", "==", user.uid),
    orderBy("name", "asc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const list: Medication[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          userId: data.userId,
          name: data.name,
          dose: data.dose,
          frequency: data.frequency,
          nextTime: data.nextTime,
          pillsTotal: data.pillsTotal,
          pillsLeft: data.pillsLeft,
          notes: data.notes,
        };
      });
      onChange(list);
    },
    (err) => {
      console.log("Error escuchando medicación:", err);
      onError?.(err);
    }
  );
}

export async function createMedication(data: {
  name: string;
  dose: string;
  frequency: string;
  nextTime?: string;
  pillsTotal?: number;
  pillsLeft?: number;
  notes?: string;
}) {
  const user = requireUser();
  const docRef = await addDoc(medsCol, {
    userId: user.uid,
    ...data,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function updateMedication(
  id: string,
  data: Partial<Omit<Medication, "id" | "userId">>
) {
  const user = requireUser();
  const ref = doc(db, "medications", id);
  await updateDoc(ref, {
    ...data,
    userId: user.uid,
  });
}

export async function deleteMedication(id: string) {
  const ref = doc(db, "medications", id);
  await deleteDoc(ref);
}

/* ============ CONTACTOS / RED DE APOYO ============ */

const contactsCol = collection(db, "careContacts");

export function listenMyCareContacts(
  onChange: (list: CareContact[]) => void,
  onError?: (err: any) => void
): Unsubscribe {
  const user = requireUser();

  const q = query(
    contactsCol,
    where("userId", "==", user.uid),
    orderBy("name", "asc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const list: CareContact[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          userId: data.userId,
          name: data.name,
          relation: data.relation,
          phone: data.phone,
          email: data.email,
        };
      });
      onChange(list);
    },
    (err) => {
      console.log("Error escuchando contactos:", err);
      onError?.(err);
    }
  );
}

export async function createCareContact(data: {
  name: string;
  relation?: string;
  phone?: string;
  email?: string;
}) {
  const user = requireUser();
  const docRef = await addDoc(contactsCol, {
    userId: user.uid,
    ...data,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function updateCareContact(
  id: string,
  data: Partial<Omit<CareContact, "id" | "userId">>
) {
  const user = requireUser();
  const ref = doc(db, "careContacts", id);
  await updateDoc(ref, {
    ...data,
    userId: user.uid,
  });
}

export async function deleteCareContact(id: string) {
  const ref = doc(db, "careContacts", id);
  await deleteDoc(ref);
}
