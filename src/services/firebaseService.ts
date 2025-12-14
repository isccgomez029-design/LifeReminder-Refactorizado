// src/services/firebaseService.ts
import { db } from "../config/firebaseConfig";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  query,
  onSnapshot,
  WhereFilterOp,
  QueryConstraint,
} from "firebase/firestore";

/**
 * Referencia a una subcolección dentro de users/{uid}/{sub}
 */
export function userSubRef(uid: string, sub: string) {
  return collection(db, "users", uid, sub);
}

/**
 * CREATE: crea un documento en users/{uid}/{sub}
 */
export async function createUserDoc<T extends object>(
  uid: string,
  sub: string,
  data: T
) {
  const colRef = userSubRef(uid, sub);
  const docRef = await addDoc(colRef, data as any);
  return docRef; // si quieres el id: docRef.id
}

/**
 * UPDATE: actualiza un documento en users/{uid}/{sub}/{id}
 */
export async function updateUserDoc<T extends object>(
  uid: string,
  sub: string,
  id: string,
  data: Partial<T>
) {
  const ref = doc(db, "users", uid, sub, id);
  await updateDoc(ref, data as any);
}

/**
 * DELETE: elimina un documento en users/{uid}/{sub}/{id}
 */
export async function deleteUserDoc(uid: string, sub: string, id: string) {
  const ref = doc(db, "users", uid, sub, id);
  await deleteDoc(ref);
}

/**
 * READ: obtiene todos los documentos de users/{uid}/{sub}
 */
export async function getUserDocs<T = any>(
  uid: string,
  sub: string
): Promise<(T & { id: string })[]> {
  const q = query(userSubRef(uid, sub));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }));
}

/**
 * READ: obtiene un documento por id en users/{uid}/{sub}/{id}
 */
export async function getUserDocById<T = any>(
  uid: string,
  sub: string,
  id: string
): Promise<(T & { id: string }) | null> {
  const ref = doc(db, "users", uid, sub, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as T) };
}

/**
 * LISTEN: escucha cambios en tiempo real en users/{uid}/{sub}
 *    puedes pasar filtros opcionales tipo where
 */
export function listenUserSubcollection<T = any>(
  uid: string,
  sub: string,
  {
    whereField,
    whereOp,
    whereValue,
  }: { whereField?: string; whereOp?: WhereFilterOp; whereValue?: any } = {},
  onChange?: (items: (T & { id: string })[]) => void,
  onError?: (err: any) => void
) {
  let constraints: QueryConstraint[] = [];

  if (whereField && whereOp && typeof whereValue !== "undefined") {
    const { where } =
      require("firebase/firestore") as typeof import("firebase/firestore");
    constraints.push(where(whereField, whereOp, whereValue));
  }

  const q = constraints.length
    ? query(userSubRef(uid, sub), ...constraints)
    : query(userSubRef(uid, sub));

  const unsubscribe = onSnapshot(
    q,
    (snap) => {
      const list: (T & { id: string })[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as T),
      }));
      onChange?.(list);
    },
    (err) => {
      console.log("listenUserSubcollection error:", err);
      onError?.(err);
    }
  );

  return unsubscribe;
}
