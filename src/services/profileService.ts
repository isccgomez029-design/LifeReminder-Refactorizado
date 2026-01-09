// src/services/profileService.ts

import { auth, db } from "../config/firebaseConfig";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
  User,
} from "firebase/auth";

import { syncQueueService } from "./offline/SyncQueueService";
import { offlineAuthService } from "./offline/OfflineAuthService";

export type ProfileData = {
  id: string;
  displayName: string;
  phone: string;
  email: string;

  age: number | null;
  allergies: string;
  conditions: string;
  photoUri: string | null;

  emergencyContactName: string;
  emergencyContactRelation: string;
  emergencyContactPhone: string;

  bloodType: string;
  emergencyNotes: string;

  updatedAt: string;
};

function safeFirstFromCache(cached: any): any | null {
  if (!cached?.data) return null;
  if (Array.isArray(cached.data) && cached.data.length > 0)
    return cached.data[0];
  return null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT")), ms)
    ),
  ]);
}

/**
 *  VERSIÓN CORREGIDA
 *
 * Ahora devuelve AMBOS usuarios:
 * - firebaseUser: Siempre disponible si Firebase Auth tiene sesión (para cambios de email/contraseña)
 * - offlineUser: Usuario offline activo (prioridad para datos de perfil)
 * - userId: Prioriza offline, luego firebase
 */
export function getCurrentAuthInfo() {
  const offlineUser = offlineAuthService.getCurrentUser();
  const offlineUid = offlineAuthService.getCurrentUid();

  // SIEMPRE obtener Firebase User (para operaciones de seguridad)
  const firebaseUser = auth.currentUser;

  // Priorizar offline para userId y datos de perfil
  const userId = offlineUid || firebaseUser?.uid || null;
  const userEmail = offlineUser?.email || firebaseUser?.email || "";
  const displayNameFallback =
    offlineUser?.displayName || firebaseUser?.displayName || "";

  return {
    firebaseUser, // Ahora siempre disponible cuando existe sesión en Firebase
    offlineUser, // Usuario offline (puede ser null)
    userId, // Prioriza offline, luego firebase
    userEmail, // Prioriza offline, luego firebase
    displayNameFallback, // Prioriza offline, luego firebase
  };
}

/**
 *  OFFLINE-FIRST:
 * 1) Retorna cache inmediato (sin colgar)
 * 2) Si hay internet, hace getDoc en background con timeout
 * 3) Si llega remoto, actualiza cache (la UI puede re-leer luego)
 */
export async function loadProfileOfflineFirst(
  userId: string
): Promise<any | null> {
  //  VALIDACIÓN CRÍTICA: solo permitir el UID activo
  const validUid = syncQueueService.getCurrentValidUserId();
  if (validUid && userId !== validUid) {
    return null;
  }

  // 1) cache (rápido)
  let data: any | null = null;
  try {
    const cached = await syncQueueService.getFromCache("profile", userId);
    const first = safeFirstFromCache(cached);
    if (first) data = first;
  } catch {
    // no-op
  }

  // 2) Firestore en background (PROTEGIDO)
  void (async () => {
    try {
      //  Revalidar UID antes de tocar red
      const stillValidUid = syncQueueService.getCurrentValidUserId();
      if (!stillValidUid || stillValidUid !== userId) return;

      const online = await syncQueueService.checkConnection();
      if (!online) return;

      const userRef = doc(db, "users", userId);
      const snap = await withTimeout(getDoc(userRef), 2000);

      if (snap.exists()) {
        await syncQueueService.saveToCache("profile", userId, [
          { ...snap.data(), id: userId },
        ]);
      }
    } catch {
      // silencioso
    }
  })();

  return data;
}

export async function saveProfileOfflineFirst(args: {
  userId: string;
  profileData: ProfileData;
}): Promise<void> {
  const { userId, profileData } = args;

  //  VALIDACIÓN CRÍTICA: solo permitir escribir para el UID activo
  const validUid = syncQueueService.getCurrentValidUserId();
  if (!validUid || validUid !== userId) {
    //  Evita escribir perfil de otro usuario
    return;
  }

  // 1️ Encolar operación (offline-first)
  await syncQueueService.enqueue(
    "UPDATE",
    "profile",
    userId,
    userId,
    profileData
  );

  // 2️ Actualizar cache local inmediatamente (solo UID válido)
  try {
    await syncQueueService.saveToCache("profile", userId, [
      { ...profileData, id: userId },
    ]);
  } catch {
    // no-op
  }

  // 3️ Intento directo a Firestore (si hay conexión) – PROTEGIDO
  try {
    const stillValidUid = syncQueueService.getCurrentValidUserId();
    if (!stillValidUid || stillValidUid !== userId) return;

    const userRef = doc(db, "users", userId);
    await setDoc(userRef, profileData, { merge: true });
  } catch {
    // se sincroniza luego con la cola
  }
}

/**
 *  Cambiar email (solo online)
 * Requiere firebaseUser y conexión a internet
 */
export async function changeEmailOnline(args: {
  firebaseUser: User;
  newEmail: string;
  currentPassword: string;
}): Promise<void> {
  const { firebaseUser, newEmail, currentPassword } = args;

  if (!firebaseUser?.email) {
    throw new Error("NO_EMAIL");
  }

  // Reautenticar con contraseña actual
  const cred = EmailAuthProvider.credential(
    firebaseUser.email,
    currentPassword
  );
  await reauthenticateWithCredential(firebaseUser, cred);

  // Actualizar email en Firebase Auth
  await updateEmail(firebaseUser, newEmail);

  // Actualizar email en Firestore
  const userRef = doc(db, "users", firebaseUser.uid);
  await setDoc(
    userRef,
    { email: newEmail, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

/**
 *  Cambiar contraseña (solo online)
 * Requiere firebaseUser y conexión a internet
 */
export async function changePasswordOnline(args: {
  firebaseUser: User;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const { firebaseUser, currentPassword, newPassword } = args;

  if (!firebaseUser?.email) {
    throw new Error("NO_EMAIL");
  }

  // Reautenticar con contraseña actual
  const cred = EmailAuthProvider.credential(
    firebaseUser.email,
    currentPassword
  );
  await reauthenticateWithCredential(firebaseUser, cred);

  // Actualizar contraseña en Firebase Auth
  await updatePassword(firebaseUser, newPassword);
}
