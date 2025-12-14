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
} from "firebase/firestore";
import { db } from "../config/firebaseConfig";

export type CarePermissions = {
  meds: boolean;
  appointments: boolean;
  habits: boolean;
  history: boolean;
};

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

// 🔹 Escuchar mi red de apoyo (yo soy el owner)
export function listenMyCareLinks(
  ownerId: string,
  onData: (links: CareLink[]) => void,
  onError?: (e: any) => void
) {
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

      // ordenar: activos primero y luego por fecha
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

// 🔹 Crear una relación de cuidado
export async function createCareLink(params: {
  ownerId: string;
  ownerEmail: string;
  caregiverEmail: string;
  relation: string;
  permissions: CarePermissions;
  canEdit: boolean;
}) {
  const nowIso = new Date().toISOString();

  const colRef = collection(db, "careLinks");
  await addDoc(colRef, {
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
}

// 🔹 Actualizar permisos / relación / canEdit / status
export async function updateCareLink(
  id: string,
  changes: Partial<
    Pick<
      CareLink,
      "relation" | "permissions" | "canEdit" | "status" | "caregiverEmail"
    >
  >
) {
  const ref = doc(db, "careLinks", id);
  const nowIso = new Date().toISOString();
  await updateDoc(ref, {
    ...changes,
    updatedAt: nowIso,
  });
}

// 🔹 Revocar (desactivar) una relación
export async function revokeCareLink(id: string) {
  await updateCareLink(id, { status: "revoked" });
}
