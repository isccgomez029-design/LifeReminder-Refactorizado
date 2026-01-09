// src/config/firebaseConfig.ts

// Detecta la plataforma (web, iOS, Android)
import { Platform } from "react-native";

// Inicialización de Firebase App
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";

// Módulos de Firebase Auth
import {
  getAuth, // obtiene instancia de Auth
  initializeAuth, // inicializa Auth con opciones personalizadas
  type Auth, // tipo para Auth
} from "firebase/auth";

// Módulos de Firebase Firestore
import {
  getFirestore, // obtiene instancia de Firestore
  type Firestore, // tipo para Firestore
  enableIndexedDbPersistence, // habilita persistencia en IndexedDB (web)
} from "firebase/firestore";

// Persistencia en React Native usando AsyncStorage
import AsyncStorage from "@react-native-async-storage/async-storage";
// src/config/firebaseConfig.ts

const firebaseConfig = {
  apiKey: "AIzaSyDsE3hWcGQn7sESt1ivUDjbMnVa8AUjHlM", // Clave pública de la API
  authDomain: "lifereminder-134bf.firebaseapp.com", // Dominio de autenticación
  projectId: "lifereminder-134bf", // ID único del proyecto Firebase
  storageBucket: "lifereminder-134bf.firebasestorage.app", // Bucket de Storage (aunque no se use)
  messagingSenderId: "435734995896", // ID para mensajería (FCM)
  appId: "1:435734995896:web:fc605075740ffa09b6e54d", // ID de la app
  measurementId: "G-5B1L534L0Y", // ID de Analytics (no utilizado)
};

/**
 * Inicializa Firebase App solo una vez.
 * Evita errores en Fast Refresh o recargas múltiples.
 */
export const app: FirebaseApp = getApps().length
  ? getApp() // Si ya existe una app, reutilízala
  : initializeApp(firebaseConfig); // Si no, inicializa una nueva

/**
 * Crea y configura Firebase Auth según la plataforma.
 * - Web: configuración estándar
 * - Mobile (React Native): persistencia usando AsyncStorage
 */
function createAuth(app: FirebaseApp): Auth {
  if (Platform.OS === "web") {
    // En web se usa Auth normal con persistencia automática
    return getAuth(app);
  }

  try {
    // En React Native se usa persistencia basada en AsyncStorage
    const { getReactNativePersistence } = require("firebase/auth");
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (err) {
    try {
      // Intenta inicializar Auth sin persistencia explícita
      return initializeAuth(app);
    } catch {
      // Último recurso: obtener Auth sin inicialización manual
      return getAuth(app);
    }
  }
}

/**
 * Crea y configura Firestore con soporte offline.
 */
function createFirestore(app: FirebaseApp): Firestore {
  try {
    // En React Native, Firestore maneja offline internamente
    if (Platform.OS !== "web") {
      return getFirestore(app);
    }
    // En web se debe habilitar explícitamente IndexedDB persistence
    const db = getFirestore(app);

    return db;
  } catch (err) {
    return getFirestore(app);
  }
}

/**
 * Instancia global de Auth para toda la aplicación.
 */
export const auth: Auth = createAuth(app);

/**
 * Instancia global de Firestore para toda la aplicación.
 */
export const db: Firestore = createFirestore(app);

/**
 * Verifica si existe conexión real con Firestore.
 * Se usa para detectar conectividad efectiva.
 */
export async function checkFirestoreConnection(): Promise<boolean> {
  try {
    // Importación dinámica para reducir carga inicial
    const { doc, getDoc } = await import("firebase/firestore");
    const testRef = doc(db, "__connection_test__", "test"); // Documento ficticio

    // Promesa de timeout para evitar bloqueos largos
    const timeoutPromise = new Promise<boolean>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), 5000)
    );

    // Intento real de lectura
    const fetchPromise = getDoc(testRef)
      .then(() => true) // Si responde, hay conexión
      .catch(() => false); // Si falla, no hay conexión

    // Devuelve lo que ocurra primero: fetch o timeout
    return Promise.race([fetchPromise, timeoutPromise]).catch(() => false);
  } catch {
    return false; // Si algo falla, se asume sin conexión
  }
}

/**
 * Devuelve el usuario autenticado actual de forma segura.
 */
export function getCurrentUser() {
  return auth.currentUser;
}

/**
 * Devuelve el UID del usuario autenticado o null si no existe.
 */
export function getCurrentUid(): string | null {
  return auth.currentUser?.uid ?? null;
}
