// src/services/careNetworkService.ts
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  Timestamp,
  Unsubscribe,
  collectionGroup,
  getDoc,
} from "firebase/firestore";
import { db } from "../config/firebaseConfig";
import { syncQueueService } from "./offline/SyncQueueService";

/* ============================================================
 *                         TIPOS
 * ============================================================ */

export type CarePermissions = {
  meds: boolean;
  appointments: boolean;
  habits: boolean;
  history: boolean;
};

export type CareAccessMode = "full" | "read-only" | "alerts-only" | "disabled";

export type CareInviteStatus = "pending" | "accepted" | "rejected";

export type CareLink = {
  id?: string;
  ownerId: string;
  ownerEmail: string;
  caregiverEmail: string;
  relation: string;
  permissions: CarePermissions;
  canEdit: boolean;
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
};

export type CareInvite = {
  id: string;
  caregiverUid: string;
  name?: string;
  phone?: string;
  email?: string;
  relationship?: string;
  status: CareInviteStatus;
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

/* ============================================================
 *                    CARE LINKS (Red de apoyo)
 * ============================================================ */

/**
 * Escuchar mi red de apoyo (yo soy el owner)
 */
export function listenMyCareLinks(
  ownerId: string,
  onData: (links: CareLink[]) => void,
  onError?: (e: any) => void
): Unsubscribe {
  const colRef = collection(db, "careLinks");
  const q = query(colRef, where("ownerId", "==", ownerId));

  return onSnapshot(
    q,
    (snap) => {
      const list: CareLink[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          ownerId: data.ownerId,
          ownerEmail: data.ownerEmail,
          caregiverEmail: data.caregiverEmail,
          relation: data.relation ?? "",
          permissions: data.permissions ?? {
            meds: true,
            appointments: true,
            habits: true,
            history: false,
          },
          canEdit: !!data.canEdit,
          status: data.status ?? "active",
          createdAt: data.createdAt || "",
          updatedAt: data.updatedAt || "",
        };
      });

      // Ordenar: activos primero y luego por fecha
      list.sort((a, b) => {
        if (a.status !== b.status) {
          return a.status === "active" ? -1 : 1;
        }
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      });

      onData(list);
    },
    (err) => {
      console.log("Error escuchando careLinks:", err);
      onError?.(err);
    }
  );
}

/**
 * Crear una relación de cuidado
 */
export async function createCareLink(params: {
  ownerId: string;
  ownerEmail: string;
  caregiverEmail: string;
  relation: string;
  permissions: CarePermissions;
  canEdit: boolean;
}): Promise<string> {
  const nowIso = new Date().toISOString();

  const colRef = collection(db, "careLinks");
  const docRef = await addDoc(colRef, {
    ownerId: params.ownerId,
    ownerEmail: params.ownerEmail,
    caregiverEmail: params.caregiverEmail.trim().toLowerCase(),
    relation: params.relation.trim(),
    permissions: params.permissions,
    canEdit: params.canEdit,
    status: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  return docRef.id;
}

/**
 * Actualizar permisos / relación / canEdit / status
 */
export async function updateCareLink(
  id: string,
  changes: Partial<
    Pick<
      CareLink,
      "relation" | "permissions" | "canEdit" | "status" | "caregiverEmail"
    >
  >
): Promise<void> {
  const ref = doc(db, "careLinks", id);
  const nowIso = new Date().toISOString();
  await updateDoc(ref, {
    ...changes,
    updatedAt: nowIso,
  });
}

/**
 * Revocar (desactivar) una relación
 */
export async function revokeCareLink(id: string): Promise<void> {
  await updateCareLink(id, { status: "revoked" });
}

/* ============================================================
 *            CARE INVITES (Invitaciones pendientes)
 * ============================================================ */

/**
 * Escuchar invitaciones pendientes del cuidador
 */
export function listenCareInvites(
  caregiverUid: string,
  onData: (invites: CareInvite[]) => void,
  onError?: (e: any) => void
): Unsubscribe {
  const ref = collection(db, "careNetwork");
  const q = query(
    ref,
    where("caregiverUid", "==", caregiverUid),
    where("status", "==", "pending")
  );

  return onSnapshot(
    q,
    (snap) => {
      const list: CareInvite[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          caregiverUid: data.caregiverUid || "",
          name: data.name || data.ownerName || "",
          phone: data.phone || "",
          email: data.email || data.ownerEmail || "",
          relationship: data.relationship || data.relation || "",
          status: data.status || "pending",
          createdAt: data.createdAt || "",
          updatedAt: data.updatedAt || "",
        };
      });

      onData(list);
    },
    (err) => {
      console.log("❌ Error escuchando invitaciones:", err);
      onError?.(err);
    }
  );
}

/**
 * Aceptar invitación
 */
export async function acceptCareInvite(inviteId: string): Promise<void> {
  try {
    const ref = doc(db, "careNetwork", inviteId);
    await updateDoc(ref, {
      status: "accepted",
      updatedAt: new Date().toISOString(),
    });
    console.log("✅ Invitación aceptada");
  } catch (error) {
    console.error("Error aceptando invitación:", error);
    throw error;
  }
}

/**
 * Rechazar invitación
 */
export async function rejectCareInvite(inviteId: string): Promise<void> {
  try {
    const ref = doc(db, "careNetwork", inviteId);
    await updateDoc(ref, {
      status: "rejected",
      updatedAt: new Date().toISOString(),
    });
    console.log("✅ Invitación rechazada");
  } catch (error) {
    console.error("Error rechazando invitación:", error);
    throw error;
  }
}

/* ============================================================
 *              MY PATIENTS (Mis pacientes)
 * ============================================================ */

/**
 * Escuchar pacientes asignados al cuidador
 */
export function listenMyPatients(
  caregiverUid: string,
  onData: (patients: PatientLink[]) => void,
  onError?: (e: any) => void
): Unsubscribe {
  const q = query(
    collectionGroup(db, "careNetwork"),
    where("caregiverUid", "==", caregiverUid),
    where("status", "==", "accepted"),
    where("deleted", "==", false)
  );

  return onSnapshot(
    q,
    (snap) => {
      const list: PatientLink[] = snap.docs.map((d) => {
        const data = d.data() as any;
        const path = d.ref.path;
        const segments = path.split("/");
        const ownerUid = segments[1] ?? data.ownerUid ?? "";

        const ownerName =
          data.ownerName ||
          data.name ||
          data.ownerEmail ||
          data.email ||
          "Paciente sin nombre";

        return {
          id: d.id,
          path,
          ownerUid,
          ownerName,
          relationship: data.relationship ?? "",
          accessMode: data.accessMode ?? "alerts-only",
        };
      });

      // Ordenar por nombre
      list.sort((a, b) => a.ownerName.localeCompare(b.ownerName, "es"));

      onData(list);
    },
    (err) => {
      console.log("Error cargando pacientes:", err);
      onError?.(err);
    }
  );
}

/**
 * Cargar foto de perfil de un paciente
 * Intenta primero desde cache offline, luego desde Firestore
 */
export async function loadPatientPhoto(
  patientUid: string
): Promise<string | null> {
  try {
    // 1) Intentar desde cache offline
    const cached = await syncQueueService.getFromCache("profile", patientUid);
    if (Array.isArray(cached?.data) && cached.data.length > 0) {
      const photo = cached.data[0].photoUri;
      if (photo) {
        return photo;
      }
    }

    // 2) Si no hay cache → Firestore
    const userRef = doc(db, "users", patientUid);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      const data: any = snap.data();
      if (data.photoUri) {
        // Guardar en cache para próxima vez
        await syncQueueService.saveToCache("profile", patientUid, [
          { id: patientUid, ...data },
        ]);
        return data.photoUri;
      }
    }

    return null;
  } catch (error) {
    console.log("⚠️ Error cargando foto de paciente", patientUid, error);
    return null;
  }
}

/**
 * Cargar fotos de múltiples pacientes
 */
export async function loadPatientsPhotos(
  patients: PatientLink[]
): Promise<Record<string, string>> {
  const photos: Record<string, string> = {};

  await Promise.all(
    patients.map(async (p) => {
      const photoUri = await loadPatientPhoto(p.ownerUid);
      if (photoUri) {
        photos[p.ownerUid] = photoUri;
      }
    })
  );

  return photos;
}

/* ============================================================
 *                    UTILIDADES
 * ============================================================ */

/**
 * Obtiene el label de accessMode en español
 */
export function getAccessModeLabel(mode: CareAccessMode): string {
  const labels: Record<CareAccessMode, string> = {
    full: "Acceso completo",
    "read-only": "Solo lectura",
    "alerts-only": "Solo alertas",
    disabled: "Desactivado",
  };
  return labels[mode] || "Desconocido";
}

/**
 * Valida permisos del cuidador para una acción
 */
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
