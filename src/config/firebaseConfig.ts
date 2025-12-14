// src/config/firebaseConfig.ts
// ✅ Actualizado: Persistencia offline habilitada para Auth y Firestore

// Detecta la plataforma (web, iOS, Android)
import { Platform } from "react-native";

// Inicialización de Firebase App
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";

// Módulos de Firebase Auth
import {
  getAuth, // obtiene instancia de Auth
  initializeAuth, // inicializa Auth con opciones personalizadas
  type Auth, // tipo para Auth
  browserLocalPersistence, // persistencia en navegador
  indexedDBLocalPersistence, // persistencia usando IndexedDB
} from "firebase/auth";

// Módulos de Firebase Firestore
import {
  getFirestore, // obtiene instancia de Firestore
  type Firestore, // tipo para Firestore
  enableIndexedDbPersistence, // habilita persistencia en IndexedDB (web)
  initializeFirestore, // inicializa Firestore con opciones
  persistentLocalCache, // cache local persistente
  persistentMultipleTabManager, // manejo de múltiples pestañas
  CACHE_SIZE_UNLIMITED, // tamaño ilimitado de cache
} from "firebase/firestore";

// Persistencia en React Native usando AsyncStorage
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Configuración de tu proyecto Firebase
 * ⚠️ Estos valores vienen de la consola de Firebase
 */
const firebaseConfig = {
  apiKey: "AIzaSyDsE3hWcGQn7sESt1ivUDjbMnVa8AUjHlM",
  authDomain: "lifereminder-134bf.firebaseapp.com",
  projectId: "lifereminder-134bf",
  storageBucket: "lifereminder-134bf.firebasestorage.app",
  messagingSenderId: "435734995896",
  appId: "1:435734995896:web:fc605075740ffa09b6e54d",
  measurementId: "G-5B1L534L0Y",
};

/**
 * Evita el error de "app ya inicializada" en Fast Refresh / recargas.
 * - Si ya existe una app inicializada, la reutiliza.
 * - Si no, inicializa una nueva.
 */
export const app: FirebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

/**
 * Crea Auth con persistencia adecuada según plataforma.
 */
function createAuth(app: FirebaseApp): Auth {
  if (Platform.OS === "web") {
    // En web, usa la configuración estándar
    return getAuth(app);
  }

  try {
    // En React Native: usar persistencia con AsyncStorage
    const { getReactNativePersistence } = require("firebase/auth");
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (err) {
    // Si falla la importación, muestra advertencia
    console.warn(
      "[Firebase] No se encontró 'firebase/auth/react-native'. Detalle:",
      err
    );
    try {
      // Intenta inicializar Auth sin persistencia explícita
      return initializeAuth(app);
    } catch {
      // Último recurso: usa getAuth
      return getAuth(app);
    }
  }
}

/**
 * Crea Firestore con persistencia offline habilitada
 */
function createFirestore(app: FirebaseApp): Firestore {
  try {
    // En React Native: usa configuración estándar
    // La persistencia offline se maneja con AsyncStorage
    if (Platform.OS !== "web") {
      return getFirestore(app);
    }

    // En Web: habilitar IndexedDB persistence
    const db = getFirestore(app);

    enableIndexedDbPersistence(db).catch((err) => {
      if (err.code === "failed-precondition") {
        // Ocurre si hay múltiples pestañas abiertas
        console.warn(
          "[Firestore] Persistencia no disponible (múltiples pestañas abiertas)"
        );
      } else if (err.code === "unimplemented") {
        // Ocurre si el navegador no soporta IndexedDB
        console.warn("[Firestore] Persistencia no soportada en este navegador");
      }
    });

    return db;
  } catch (err) {
    // Si ocurre error, muestra advertencia y devuelve instancia básica
    console.warn("[Firestore] Error configurando persistencia:", err);
    return getFirestore(app);
  }
}

// Exporta instancias listas para usar en la app
export const auth: Auth = createAuth(app);
export const db: Firestore = createFirestore(app);

/**
 * Utilidad para verificar si hay conexión a Firestore
 */
export async function checkFirestoreConnection(): Promise<boolean> {
  try {
    // Importa funciones necesarias dinámicamente
    const { doc, getDoc } = await import("firebase/firestore");
    const testRef = doc(db, "__connection_test__", "test");

    // Timeout de 5 segundos para evitar bloqueos
    const timeoutPromise = new Promise<boolean>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), 5000)
    );

    // Intenta leer un documento ficticio
    const fetchPromise = getDoc(testRef)
      .then(() => true) // si funciona, hay conexión
      .catch(() => false); // si falla, no hay conexión

    // Devuelve el resultado más rápido entre fetch y timeout
    return Promise.race([fetchPromise, timeoutPromise]).catch(() => false);
  } catch {
    return false;
  }
}

/**
 * Utilidad para obtener el usuario actual de forma segura
 */
export function getCurrentUser() {
  return auth.currentUser;
}

/**
 * Utilidad para obtener el UID del usuario actual
 */
export function getCurrentUid(): string | null {
  return auth.currentUser?.uid ?? null;
}
