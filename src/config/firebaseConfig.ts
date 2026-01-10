// src/config/firebaseConfig.ts

import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  type Auth,
  // ⚠️ NO lo importo directo para evitar issues en web bundler.
  // getReactNativePersistence,
} from "firebase/auth";

import {
  getFirestore,
  type Firestore,
  enableIndexedDbPersistence,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDsE3hWcGQn7sESt1ivUDjbMnVa8AUjHlM",
  authDomain: "lifereminder-134bf.firebaseapp.com",
  projectId: "lifereminder-134bf",
  storageBucket: "lifereminder-134bf.firebasestorage.app",
  messagingSenderId: "435734995896",
  appId: "1:435734995896:web:fc605075740ffa09b6e54d",
  measurementId: "G-5B1L534L0Y",
};

// ============================================================
//                 APP PRINCIPAL (UNA SOLA VEZ)
// ============================================================

const primaryApp: FirebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);
export const app = primaryApp;

// ============================================================
//                 AUTH (RN con persistencia)
// ============================================================

function createAuth(appInstance: FirebaseApp): Auth {
  // Web: Auth normal
  if (Platform.OS === "web") {
    return getAuth(appInstance);
  }

  // React Native: Auth con persistencia en AsyncStorage
  try {
    const { getReactNativePersistence } = require("firebase/auth");
    return initializeAuth(appInstance, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // Fallbacks seguros
    try {
      return initializeAuth(appInstance);
    } catch {
      return getAuth(appInstance);
    }
  }
}

export const auth: Auth = createAuth(primaryApp);

// ============================================================
//                 FIRESTORE (offline RN)
// ============================================================

function createFirestore(appInstance: FirebaseApp): Firestore {
  const firestore = getFirestore(appInstance);

  // En web, intenta habilitar IndexedDB persistence (best-effort)
  if (Platform.OS === "web") {
    enableIndexedDbPersistence(firestore).catch(() => {
      // Puede fallar por multi-tabs u otros motivos; ignorar.
    });
  }

  return firestore;
}

export const db: Firestore = createFirestore(primaryApp);

// ============================================================
//          AUTH SECUNDARIO (NO CAMBIA SESIÓN PRINCIPAL)
// ============================================================

const secondaryFirebaseApp: FirebaseApp =
  getApps().find((a) => a.name === "Secondary") ??
  initializeApp(firebaseConfig, "Secondary");

// ✅ Importante: usamos getAuth directo (sin initializeAuth) para no complicar.
// Esto NO afecta auth.currentUser del principal.
export const secondaryAuth = getAuth(secondaryFirebaseApp);
export const secondaryDb = getFirestore(secondaryFirebaseApp);
// ============================================================
//                    HELPERS
// ============================================================

export async function checkFirestoreConnection(): Promise<boolean> {
  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const testRef = doc(db, "__connection_test__", "test");

    const timeoutPromise = new Promise<boolean>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), 5000)
    );

    const fetchPromise = getDoc(testRef)
      .then(() => true)
      .catch(() => false);

    return Promise.race([fetchPromise, timeoutPromise]).catch(() => false);
  } catch {
    return false;
  }
}

export function getCurrentUser() {
  return auth.currentUser;
}

export function getCurrentUid(): string | null {
  return auth.currentUser?.uid ?? null;
}
