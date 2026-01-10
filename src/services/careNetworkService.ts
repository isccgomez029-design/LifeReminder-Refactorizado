// src/services/careNetworkService.ts

import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  Unsubscribe,
  collectionGroup,
  getDoc,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../config/firebaseConfig";
import { syncQueueService } from "./offline/SyncQueueService";

/* ============================================================
 *                         TIPOS
 * ============================================================ */

export type CareAccessMode = "full" | "read-only" | "alerts-only" | "disabled";
export type CareInviteStatus = "pending" | "accepted" | "rejected";

export type CareInvite = {
  id: string;
  caregiverUid: string;
  patientUid: string;
  name?: string;
  phone?: string;
  email?: string;
  relationship?: string;
  status: CareInviteStatus;
  accessMode?: CareAccessMode;
  createdAt: string;
  updatedAt: string;
};

export type PatientLink = {
  id: string;
  path: string;
  ownerUid: string;
  ownerName: string;
  relationship?: string;
  accessMode?: CareAccessMode;
  photoUri?: string;
};

type NotifyResult = {
  success: boolean;
  notifiedCount: number;
  error?: string;
};

export type CreateInviteResult = {
  success: boolean;
  inviteId?: string;
  caregiverUid?: string;
  error?: string;
};

/* ============================================================
 *            CREAR INVITACIÓN (NUEVA FUNCIÓN)
 * ============================================================ */

/**
 * Crear invitación de cuidador
 *
 * Esta función:
 * 1. Busca al cuidador por email en la colección users
 * 2. Obtiene su UID
 * 3. Crea la invitación con el caregiverUid correcto
 *
 * @param patientUid - UID del paciente (quien invita)
 * @param caregiverEmail - Email del cuidador
 * @param caregiverName - Nombre del cuidador (opcional)
 * @param relationship - Relación (ej: "Padre", "Hijo")
 * @param phone - Teléfono (opcional)
 * @param accessMode - Modo de acceso
 */
export async function createCaregiverInvite(params: {
  patientUid: string;
  caregiverEmail: string;
  caregiverName?: string;
  relationship?: string;
  phone?: string;
  accessMode?: CareAccessMode;
}): Promise<CreateInviteResult> {
  try {
    const {
      patientUid,
      caregiverEmail,
      caregiverName,
      relationship,
      phone,
      accessMode = "alerts-only",
    } = params;


    // ============================================================
    // PASO 1: Buscar al cuidador en la colección users
    // ============================================================
    const usersRef = collection(db, "users");
    const q = query(
      usersRef,
      where("email", "==", caregiverEmail.trim().toLowerCase())
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      //  Cuidador no encontrado
      return {
        success: false,
        error: `El usuario con email ${caregiverEmail} no está registrado. Debe crear una cuenta primero.`,
      };
    }


    const caregiverDoc = snapshot.docs[0];
    const caregiverUid = caregiverDoc.id; 
    const caregiverData = caregiverDoc.data();


    // ============================================================
    // PASO 2: Verificar que no sea auto-invitación
    // ============================================================
    if (caregiverUid === patientUid) {
      return {
        success: false,
        error: "No puedes invitarte a ti mismo como cuidador.",
      };
    }

    // ============================================================
    // PASO 3: Verificar si ya existe una invitación
    // ============================================================
    const existingInvitesRef = collection(
      db,
      "users",
      patientUid,
      "careNetwork"
    );

    const existingQuery = query(
      existingInvitesRef,
      where("caregiverUid", "==", caregiverUid),
      where("deleted", "==", false)
    );

    const existingSnapshot = await getDocs(existingQuery);

    if (!existingSnapshot.empty) {
      const existing = existingSnapshot.docs[0].data();

      if (existing.status === "pending") {
        return {
          success: false,
          error: "Ya existe una invitación pendiente para este cuidador.",
        };
      }

      if (existing.status === "accepted") {
        return {
          success: false,
          error: "Este usuario ya es tu cuidador.",
        };
      }
    }

    // ============================================================
    // PASO 4: Crear la invitación con TODOS los campos
    // ============================================================
    const inviteData = {
 
      caregiverUid: caregiverUid,

      // Información del cuidador
      email: caregiverEmail.trim().toLowerCase(),
      name:
        caregiverName ||
        caregiverData.displayName ||
        caregiverData.fullName ||
        caregiverEmail,
      phone: phone || caregiverData.phone || "",
      relationship: relationship?.trim() || "",

      // Configuración
      accessMode: accessMode,
      status: "pending",
      deleted: false,

      // Timestamps
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const careNetworkRef = collection(db, "users", patientUid, "careNetwork");

    const docRef = await addDoc(careNetworkRef, inviteData);

    return {
      success: true,
      inviteId: docRef.id,
      caregiverUid: caregiverUid,
    };
  } catch (error: any) {

    return {
      success: false,
      error: error?.message || "Error al crear la invitación",
    };
  }
}


export async function fixExistingInvitation(
  patientUid: string,
  inviteId: string,
  caregiverEmail: string
): Promise<CreateInviteResult> {
  try {

    // 1. Buscar UID del cuidador por email
    const usersRef = collection(db, "users");
    const q = query(
      usersRef,
      where("email", "==", caregiverEmail.trim().toLowerCase())
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return {
        success: false,
        error: `Cuidador con email ${caregiverEmail} no encontrado`,
      };
    }
    const caregiverUid = snapshot.docs[0].id;
    // 2. Actualizar la invitación
    const inviteRef = doc(db, "users", patientUid, "careNetwork", inviteId);

    await updateDoc(inviteRef, {
      caregiverUid: caregiverUid,
      updatedAt: serverTimestamp(),
    });


    return {
      success: true,
      inviteId: inviteId,
      caregiverUid,
    };
  } catch (error: any) {

    return {
      success: false,
      error: error?.message || "Error al corregir la invitación",
    };
  }
}


export function listenCareInvites(
  caregiverUid: string,
  onData: (invites: CareInvite[]) => void,
  onError?: (e: any) => void
): Unsubscribe {

  const q = query(
    collectionGroup(db, "careNetwork"),
    where("caregiverUid", "==", caregiverUid),
    where("status", "==", "pending")
  );

  return onSnapshot(
    q,
    (snap) => {

      const list: CareInvite[] = snap.docs
        .map((d) => {
          const data = d.data() as any;
          const path = d.ref.path;
          const patientUid = path.split("/")[1] || "";

          return {
            id: d.id,
            caregiverUid: data.caregiverUid || "",
            patientUid,
            name: data.name || data.ownerName || "",
            phone: data.phone || "",
            email: data.email || data.ownerEmail || "",
            relationship: data.relationship || data.relation || "",
            status: data.status || "pending",
            accessMode: data.accessMode || "alerts-only",
            createdAt: data.createdAt || "",
            updatedAt: data.updatedAt || "",
            _deleted: data.deleted,
          } as any;
        })
        .filter((invite: any) => invite._deleted !== true)
        .map((invite: any) => {
          const { _deleted, ...clean } = invite;
          return clean as CareInvite;
        });

      onData(list);
    },
    (err) => {

      onError?.(err);
    }
  );
}

/**
 * Aceptar invitación de cuidado
 */
export async function acceptCareInvite(
  inviteId: string,
  patientUid: string
): Promise<void> {
  try {
    const ref = doc(db, "users", patientUid, "careNetwork", inviteId);
    await updateDoc(ref, {
      status: "accepted",
      updatedAt: serverTimestamp(),
    });
  } catch (error) {

    throw error;
  }
}

export async function rejectCareInvite(
  inviteId: string,
  patientUid: string
): Promise<void> {
  try {
    const ref = doc(db, "users", patientUid, "careNetwork", inviteId);
    await updateDoc(ref, {
      status: "rejected",
      updatedAt: serverTimestamp(),
    });
  } catch (error) {

    throw error;
  }
}



export function listenMyPatients(
  caregiverUid: string,
  onData: (patients: PatientLink[]) => void,
  onError?: (e: any) => void
): Unsubscribe {
  const q = query(
    collectionGroup(db, "careNetwork"),
    where("caregiverUid", "==", caregiverUid),
    where("status", "==", "accepted")
  );

  return onSnapshot(
    q,
    (snap) => {
      const list: PatientLink[] = snap.docs
        .map((d) => {
          const data = d.data() as any;
          const path = d.ref.path;
          const ownerUid = path.split("/")[1] ?? "";

          return {
            id: d.id,
            path,
            ownerUid,
            ownerName: data.ownerName || data.name || data.email || "Paciente",
            relationship: data.relationship ?? "",
            accessMode: data.accessMode ?? "alerts-only",
            _deleted: data.deleted,
          } as any;
        })
        .filter((p: any) => p._deleted !== true)
        .map((p: any) => {
          const { _deleted, ...clean } = p;
          return clean as PatientLink;
        });

      list.sort((a, b) => a.ownerName.localeCompare(b.ownerName, "es"));
      onData(list);
    },
    (err) => {

      onError?.(err);
    }
  );
}


export async function loadPatientPhoto(
  patientUid: string
): Promise<string | null> {
  try {
    const cached = await syncQueueService.getFromCache("profile", patientUid);
    if (Array.isArray(cached?.data) && cached.data.length > 0) {
      const photo = cached.data[0].photoUri;
      if (photo) return photo;
    }

    const userRef = doc(db, "users", patientUid);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      const data: any = snap.data();
      if (data.photoUri) {
        await syncQueueService.saveToCache("profile", patientUid, [
          { id: patientUid, ...data },
        ]);
        return data.photoUri;
      }
    }
    return null;
  } catch (error) {

    return null;
  }
}


export async function loadPatientsPhotos(
  patients: PatientLink[]
): Promise<Record<string, string>> {
  const photos: Record<string, string> = {};
  await Promise.all(
    patients.map(async (p) => {
      const photoUri = await loadPatientPhoto(p.ownerUid);
      if (photoUri) photos[p.ownerUid] = photoUri;
    })
  );
  return photos;
}



export async function notifyCaregiversAboutNoncompliance(params: {
  patientUid: string;
  patientName?: string;
  medicationName: string;
  snoozeCount: number;
  type: "med" | "habit";
}): Promise<NotifyResult> {
  try {
    const { patientUid, patientName, medicationName, snoozeCount, type } =
      params;

    const careNetworkRef = collection(db, "users", patientUid, "careNetwork");
    const q = query(careNetworkRef, where("status", "==", "accepted"));

    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      return { success: true, notifiedCount: 0 };
    }

    const notificationPromises = snapshot.docs.map(async (docSnap) => {
      const caregiverData = docSnap.data();
      const caregiverUid = caregiverData.caregiverUid;
      const accessMode = caregiverData.accessMode || "alerts-only";

      if (accessMode === "disabled" || !caregiverUid) return false;

      const notificationsRef = collection(
        db,
        "users",
        caregiverUid,
        "notifications"
      );

      const itemType = type === "med" ? "medicamento" : "hábito";
      const patientDisplay = patientName || "Un paciente";

      await addDoc(notificationsRef, {
        type: "noncompliance",
        title: `⚠️ Incumplimiento detectado`,
        message: `${patientDisplay} ha pospuesto "${medicationName}" ${snoozeCount} veces`,
        patientUid,
        patientName: patientName || "Paciente",
        itemType: type,
        itemName: medicationName,
        snoozeCount,
        severity: "high",
        read: false,
        createdAt: serverTimestamp(),
      });

      return true;
    });

    const results = await Promise.all(notificationPromises);
    const notifiedCount = results.filter(Boolean).length;

    return { success: true, notifiedCount };
  } catch (error: any) {

    return { success: false, notifiedCount: 0, error: error?.message };
  }
}


export async function notifyCaregiversAboutDismissal(params: {
  patientUid: string;
  patientName?: string;
  itemName: string;
  itemType: "med" | "habit";
  snoozeCountBeforeDismiss: number;
}): Promise<NotifyResult> {
  try {
    const {
      patientUid,
      patientName,
      itemName,
      itemType,
      snoozeCountBeforeDismiss,
    } = params;

    const careNetworkRef = collection(db, "users", patientUid, "careNetwork");
    const q = query(careNetworkRef, where("status", "==", "accepted"));

    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      return { success: true, notifiedCount: 0 };
    }

    const notificationPromises = snapshot.docs.map(async (docSnap) => {
      const caregiverData = docSnap.data();
      const caregiverUid = caregiverData.caregiverUid;
      const accessMode = caregiverData.accessMode || "alerts-only";

      if (accessMode === "disabled" || !caregiverUid) return false;

      const notificationsRef = collection(
        db,
        "users",
        caregiverUid,
        "notifications"
      );

      const itemTypeLabel = itemType === "med" ? "medicamento" : "hábito";
      const patientDisplay = patientName || "Un paciente";
      const severity = snoozeCountBeforeDismiss > 0 ? "high" : "medium";

      let messageText = `${patientDisplay} ha descartado el ${itemTypeLabel} "${itemName}"`;
      if (snoozeCountBeforeDismiss > 0) {
        messageText += ` después de posponerlo ${snoozeCountBeforeDismiss} ${
          snoozeCountBeforeDismiss === 1 ? "vez" : "veces"
        }`;
      }
      messageText += " sin completarlo.";

      await addDoc(notificationsRef, {
        type: "dismissal",
        title: `🚫 ${
          itemTypeLabel === "medicamento" ? "Medicamento" : "Hábito"
        } descartado`,
        message: messageText,
        patientUid,
        patientName: patientName || "Paciente",
        itemType,
        itemName,
        snoozeCountBeforeDismiss,
        severity,
        read: false,
        createdAt: serverTimestamp(),
      });

      return true;
    });

    const results = await Promise.all(notificationPromises);
    const notifiedCount = results.filter(Boolean).length;

    return { success: true, notifiedCount };
  } catch (error: any) {

    return { success: false, notifiedCount: 0, error: error?.message };
  }
}
export async function logSnoozeEvent(params: {
  patientUid: string;
  itemId: string;
  itemName: string;
  itemType: "med" | "habit";
  snoozeMinutes: number;
  snoozeCount: number;
}): Promise<void> {
  try {
    const {
      patientUid,
      itemId,
      itemName,
      itemType,
      snoozeMinutes,
      snoozeCount,
    } = params;

    const eventsRef = collection(db, "users", patientUid, "complianceEvents");

    await addDoc(eventsRef, {
      eventType: "snooze",
      itemId,
      itemName,
      itemType,
      snoozeMinutes,
      snoozeCount,
      timestamp: serverTimestamp(),
    });
  } catch (error) {

  }
}

export async function logDismissalEvent(params: {
  patientUid: string;
  itemId: string;
  itemName: string;
  itemType: "med" | "habit";
  snoozeCountBeforeDismiss: number;
}): Promise<void> {
  try {
    const { patientUid, itemId, itemName, itemType, snoozeCountBeforeDismiss } =
      params;

    const eventsRef = collection(db, "users", patientUid, "complianceEvents");

    await addDoc(eventsRef, {
      eventType: "dismissal",
      itemId,
      itemName,
      itemType,
      snoozeCountBeforeDismiss,
      timestamp: serverTimestamp(),
    });
  } catch (error) {

  }
}

export async function logComplianceSuccess(params: {
  patientUid: string;
  itemId: string;
  itemName: string;
  itemType: "med" | "habit";
  afterSnoozes?: number;
}): Promise<void> {
  try {
    const { patientUid, itemId, itemName, itemType, afterSnoozes } = params;

    const eventsRef = collection(db, "users", patientUid, "complianceEvents");

    await addDoc(eventsRef, {
      eventType: "completed",
      itemId,
      itemName,
      itemType,
      afterSnoozes: afterSnoozes || 0,
      timestamp: serverTimestamp(),
    });
  } catch (error) {

  }
}

export function getAccessModeLabel(mode: CareAccessMode): string {
  const labels: Record<CareAccessMode, string> = {
    full: "Acceso completo",
    "read-only": "Solo lectura",
    "alerts-only": "Solo alertas",
    disabled: "Desactivado",
  };
  return labels[mode] || "Desconocido";
}

export function hasPermission(
  accessMode: CareAccessMode,
  action: "view" | "edit" | "alerts"
): boolean {
  switch (accessMode) {
    case "full":
      return true;
    case "read-only":
      return action === "view";
    case "alerts-only":
      return action === "alerts";
    case "disabled":
      return false;
    default:
      return false;
  }
}
