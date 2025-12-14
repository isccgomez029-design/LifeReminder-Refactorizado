// src/services/offline/OfflineAuthService.ts
// ✅ MEJORADO: Restaura automáticamente la sesión de Firebase

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as Crypto from "expo-crypto";
import { auth, db } from "../../config/firebaseConfig";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

// ============================================================
//                         TIPOS
// ============================================================

export interface CachedUser {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  nombre?: string;
  telefono?: string;
  fechaNacimiento?: string;
  rol?: string;
  _cachedAt: number;
  _lastOnlineLogin: number;
}

export interface CachedCredentials {
  email: string;
  passwordHash: string;
  salt: string;
  _createdAt: number;
  _lastUsed: number;
}

export interface OfflineAuthResult {
  success: boolean;
  user?: CachedUser;
  isOffline: boolean;
  error?: string;
  errorCode?: string;
}

// ============================================================
//                      CONSTANTES
// ============================================================

const STORAGE_KEYS = {
  CACHED_USER: "@lifereminder/auth/cached_user",
  CACHED_CREDENTIALS: "@lifereminder/auth/cached_credentials",
  CACHED_UID: "@lifereminder/auth/cached_uid",
  // 🆕 Guardar email/password en texto plano (solo para restaurar Firebase)
  // NOTA: En producción, considera usar react-native-keychain para mayor seguridad
  CACHED_PLAINTEXT_CREDS: "@lifereminder/auth/plaintext_creds",
};

// ✅ CAMBIO: Para LifeReminder offline-first, NO forzamos expiración de sesión offline.
// El usuario solo debe requerir internet para registrarse o para sincronizar/respaldar,
// no para poder entrar a la app.
//
// Si en el futuro quieres volver a limitar, cambia este valor a, por ejemplo,
// 30 * 24 * 60 * 60 * 1000.
const OFFLINE_SESSION_VALIDITY_MS: number | null = null;

// ============================================================
//                    UTILIDADES
// ============================================================

async function generateSalt(): Promise<string> {
  const randomBytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(new Uint8Array(randomBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const data = password + salt;
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    data
  );
  return hash;
}

function log(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  console.log(`[OfflineAuth ${timestamp}] ${message}`, data ?? "");
}

function isNetOnline(state: {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}) {
  return state.isConnected === true && state.isInternetReachable !== false;
}

let cachedUidSync: string | null = null;

// ============================================================
//              CLASE PRINCIPAL: OfflineAuthService
// ============================================================

export class OfflineAuthService {
  private currentUser: CachedUser | null = null;
  private isOnline: boolean = true;
  private authStateListeners: Set<(user: CachedUser | null) => void> =
    new Set();
  private connectivityUnsubscribe: (() => void) | null = null;
  private firebaseAuthUnsubscribe: (() => void) | null = null;
  private isInitialized: boolean = false;
  private initializationPromise: Promise<CachedUser | null> | null = null;

  // ==================== INICIALIZACIÓN ====================

  async initialize(): Promise<CachedUser | null> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._doInitialize();
    return this.initializationPromise;
  }

  private async _doInitialize(): Promise<CachedUser | null> {
    log("🚀 Inicializando OfflineAuthService...");

    await this.loadCachedUid();

    const netState = await NetInfo.fetch();
    this.isOnline = isNetOnline(netState);
    log(`📡 Estado de conexión: ${this.isOnline ? "Online" : "Offline"}`);

    this.connectivityUnsubscribe = NetInfo.addEventListener((state) => {
      const wasOffline = !this.isOnline;
      this.isOnline = isNetOnline(state);

      if (wasOffline && this.isOnline) {
        log("🔄 Reconexión detectada, sincronizando sesión...");
        this.syncSessionOnReconnect();
      }
    });

    // ✅ Intentar restaurar sesión de Firebase si hay credenciales
    await this.attemptFirebaseRestore();

    const cachedUser = await this.restoreSession();

    this.firebaseAuthUnsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        await this.cacheUserFromFirebase(user);
      }
    });

    this.isInitialized = true;
    log("✅ OfflineAuthService inicializado");
    return cachedUser;
  }

  /**
   * ✅ Intenta restaurar sesión de Firebase con credenciales guardadas
   */
  private async attemptFirebaseRestore(): Promise<void> {
    try {
      if (auth.currentUser) {
        log("✅ Firebase ya tiene sesión activa");
        return;
      }

      if (!this.isOnline) {
        log("📴 Offline - no se puede restaurar Firebase");
        return;
      }

      const credsJson = await AsyncStorage.getItem(
        STORAGE_KEYS.CACHED_PLAINTEXT_CREDS
      );
      if (!credsJson) {
        log("ℹ️ No hay credenciales guardadas");
        return;
      }

      const { email, password } = JSON.parse(credsJson);

      log("🔐 Intentando restaurar sesión de Firebase...");
      await signInWithEmailAndPassword(auth, email, password);
      log("✅ Sesión de Firebase restaurada exitosamente");
    } catch (error: any) {
      log("⚠️ No se pudo restaurar Firebase:", error.code);
      // No lanzar error - el usuario puede seguir usando offline
    }
  }

  private async loadCachedUid(): Promise<void> {
    try {
      const uid = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_UID);
      if (uid) {
        cachedUidSync = uid;
        log(`💾 UID cargado: ${uid.substring(0, 8)}...`);
        return;
      }

      const userData = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_USER);
      if (userData) {
        const user = JSON.parse(userData) as CachedUser;
        if (user.uid) {
          cachedUidSync = user.uid;
          await AsyncStorage.setItem(STORAGE_KEYS.CACHED_UID, user.uid);
          log(`💾 UID extraído: ${user.uid.substring(0, 8)}...`);
        }
      }
    } catch (error) {
      log("⚠️ Error cargando UID:", error);
    }
  }

  destroy(): void {
    if (this.connectivityUnsubscribe) this.connectivityUnsubscribe();
    if (this.firebaseAuthUnsubscribe) this.firebaseAuthUnsubscribe();
    this.authStateListeners.clear();
    this.isInitialized = false;
    this.initializationPromise = null;
    log("🛑 OfflineAuthService destruido");
  }

  // ==================== AUTENTICACIÓN ====================

  /**
   * ✅ Útil para RegisterScreen:
   * Después de crear la cuenta (online), guarda credenciales locales para que el
   * próximo inicio de sesión pueda ser 100% offline, incluso si el usuario cierra sesión.
   */
  async persistOfflineLoginAfterRegister(email: string, password: string) {
    const e = email.trim().toLowerCase();
    if (!e || !password) return;

    try {
      await this.cacheCredentials(e, password);
      await AsyncStorage.setItem(
        STORAGE_KEYS.CACHED_PLAINTEXT_CREDS,
        JSON.stringify({ email: e, password })
      );

      if (auth.currentUser) {
        await this.cacheUserFromFirebase(auth.currentUser);
        await this.cacheUserProfile(auth.currentUser.uid);
      }

      log("✅ persistOfflineLoginAfterRegister() completado");
    } catch (err) {
      log("⚠️ persistOfflineLoginAfterRegister() falló:", err);
    }
  }

  async signIn(email: string, password: string): Promise<OfflineAuthResult> {
    const trimmedEmail = email.trim().toLowerCase();

    const netState = await NetInfo.fetch();
    this.isOnline = isNetOnline(netState);

    if (this.isOnline) {
      return this.signInOnline(trimmedEmail, password);
    } else {
      return this.signInOffline(trimmedEmail, password);
    }
  }

  private async signInOnline(
    email: string,
    password: string
  ): Promise<OfflineAuthResult> {
    try {
      log("🔐 Intentando login online...");

      const result = await signInWithEmailAndPassword(auth, email, password);
      const user = result.user;

      await this.cacheUserFromFirebase(user);
      await this.cacheCredentials(email, password);

      // ✅ Guardar credenciales en texto plano para restaurar Firebase
      await AsyncStorage.setItem(
        STORAGE_KEYS.CACHED_PLAINTEXT_CREDS,
        JSON.stringify({ email, password })
      );

      await this.cacheUserProfile(user.uid);

      const cachedUser = await this.getCachedUser();

      log("✅ Login online exitoso:", email);

      return {
        success: true,
        user: cachedUser!,
        isOffline: false,
      };
    } catch (error: any) {
      log("❌ Error en login online:", error.code);

      if (
        error.code === "auth/network-request-failed" ||
        error.code === "auth/internal-error"
      ) {
        log("🔄 Fallback a login offline...");
        return this.signInOffline(email, password);
      }

      return {
        success: false,
        isOffline: false,
        error: this.getErrorMessage(error.code),
        errorCode: error.code,
      };
    }
  }

  private async signInOffline(
    email: string,
    password: string
  ): Promise<OfflineAuthResult> {
    try {
      log("🔐 Intentando login offline...");

      const cached = await this.getCachedCredentials();

      if (!cached) {
        return {
          success: false,
          isOffline: true,
          error:
            "No hay sesión guardada en este dispositivo. Necesitas internet solo una vez (registro o primer login) para activar el modo offline.",
          errorCode: "offline/no-cached-credentials",
        };
      }

      if (cached.email !== email) {
        return {
          success: false,
          isOffline: true,
          error: "El correo no coincide con la última sesión guardada.",
          errorCode: "offline/email-mismatch",
        };
      }

      const passwordHash = await hashPassword(password, cached.salt);
      if (passwordHash !== cached.passwordHash) {
        return {
          success: false,
          isOffline: true,
          error: "Contraseña incorrecta.",
          errorCode: "offline/wrong-password",
        };
      }

      const cachedUser = await this.getCachedUser();
      if (!cachedUser) {
        return {
          success: false,
          isOffline: true,
          error:
            "No se encontró tu perfil local para esta cuenta. Conéctate a internet una sola vez para reconstruir la sesión en este dispositivo.",
          errorCode: "offline/no-cached-user",
        };
      }

      // ✅ CAMBIO: No expirar sesión offline.
      // Con que el password coincida con el hash cacheado y exista un usuario cacheado,
      // permitimos entrar siempre.

      await this.updateCredentialsLastUsed();

      this.currentUser = cachedUser;
      cachedUidSync = cachedUser.uid;
      this.notifyAuthStateListeners(cachedUser);

      log("✅ Login offline exitoso:", email);

      return {
        success: true,
        user: cachedUser,
        isOffline: true,
      };
    } catch (error: any) {
      log("❌ Error en login offline:", error);
      return {
        success: false,
        isOffline: true,
        error: "Error al iniciar sesión offline.",
        errorCode: "offline/unknown-error",
      };
    }
  }

  async signOut(clearCache: boolean = false): Promise<void> {
    try {
      if (this.isOnline && auth.currentUser) {
        await auth.signOut();
      }

      this.currentUser = null;

      if (clearCache) {
        await this.clearAllCache();
        cachedUidSync = null;
      }

      this.notifyAuthStateListeners(null);
      log("✅ Sesión cerrada");
    } catch (error) {
      log("❌ Error cerrando sesión:", error);
    }
  }

  // ==================== CACHÉ DE USUARIO ====================

  private async cacheUserFromFirebase(user: User): Promise<void> {
    try {
      const cachedUser: CachedUser = {
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName,
        photoURL: user.photoURL,
        emailVerified: user.emailVerified,
        _cachedAt: Date.now(),
        _lastOnlineLogin: Date.now(),
      };

      await AsyncStorage.setItem(
        STORAGE_KEYS.CACHED_USER,
        JSON.stringify(cachedUser)
      );

      await AsyncStorage.setItem(STORAGE_KEYS.CACHED_UID, user.uid);
      cachedUidSync = user.uid;

      this.currentUser = cachedUser;
      this.notifyAuthStateListeners(cachedUser);

      log("💾 Usuario cacheado:", user.email);
    } catch (error) {
      log("❌ Error cacheando usuario:", error);
    }
  }

  private async cacheUserProfile(uid: string): Promise<void> {
    try {
      const userDocRef = doc(db, "users", uid);
      const userDoc = await getDoc(userDocRef);

      if (userDoc.exists()) {
        const profileData = userDoc.data();
        const cachedUser = await this.getCachedUser();

        if (cachedUser) {
          const updatedUser: CachedUser = {
            ...cachedUser,
            nombre: profileData.nombre || profileData.displayName,
            telefono: profileData.telefono || profileData.phone,
            fechaNacimiento: profileData.fechaNacimiento,
            rol: profileData.rol,
          };

          await AsyncStorage.setItem(
            STORAGE_KEYS.CACHED_USER,
            JSON.stringify(updatedUser)
          );

          this.currentUser = updatedUser;
        }

        log("💾 Perfil cacheado");
      }
    } catch (error) {
      log("❌ Error cacheando perfil:", error);
    }
  }

  async getCachedUser(): Promise<CachedUser | null> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_USER);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      log("❌ Error obteniendo usuario:", error);
      return null;
    }
  }

  // ==================== CACHÉ DE CREDENCIALES ====================

  private async cacheCredentials(
    email: string,
    password: string
  ): Promise<void> {
    try {
      const salt = await generateSalt();
      const passwordHash = await hashPassword(password, salt);

      const credentials: CachedCredentials = {
        email: email.toLowerCase(),
        passwordHash,
        salt,
        _createdAt: Date.now(),
        _lastUsed: Date.now(),
      };

      await AsyncStorage.setItem(
        STORAGE_KEYS.CACHED_CREDENTIALS,
        JSON.stringify(credentials)
      );

      log("💾 Credenciales cacheadas");
    } catch (error) {
      log("❌ Error cacheando credenciales:", error);
    }
  }

  private async getCachedCredentials(): Promise<CachedCredentials | null> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_CREDENTIALS);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  private async updateCredentialsLastUsed(): Promise<void> {
    try {
      const cached = await this.getCachedCredentials();
      if (cached) {
        cached._lastUsed = Date.now();
        await AsyncStorage.setItem(
          STORAGE_KEYS.CACHED_CREDENTIALS,
          JSON.stringify(cached)
        );
      }
    } catch (error) {
      log("❌ Error actualizando credenciales:", error);
    }
  }

  // ==================== SESIÓN ====================

  private async restoreSession(): Promise<CachedUser | null> {
    try {
      if (auth.currentUser) {
        await this.cacheUserFromFirebase(auth.currentUser);
        return this.currentUser;
      }

      const cachedUser = await this.getCachedUser();

      if (cachedUser) {
        // ✅ CAMBIO: restaurar siempre desde caché.
        // La sincronización con Firebase se intentará cuando haya conexión.
        log("✅ Sesión restaurada desde caché");
        this.currentUser = cachedUser;
        cachedUidSync = cachedUser.uid;
        this.notifyAuthStateListeners(cachedUser);
        return cachedUser;
      }

      return null;
    } catch (error) {
      log("❌ Error restaurando sesión:", error);
      return null;
    }
  }

  private async syncSessionOnReconnect(): Promise<void> {
    try {
      if (!auth.currentUser) {
        await this.attemptFirebaseRestore();
      }

      if (auth.currentUser) {
        await auth.currentUser.reload();
        await this.cacheUserFromFirebase(auth.currentUser);
        await this.cacheUserProfile(auth.currentUser.uid);
        log("✅ Sesión sincronizada");
      }
    } catch (error) {
      log("❌ Error sincronizando:", error);
    }
  }

  // ==================== UTILIDADES ====================

  async clearAllCache(): Promise<void> {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.CACHED_USER,
        STORAGE_KEYS.CACHED_CREDENTIALS,
        STORAGE_KEYS.CACHED_UID,
        STORAGE_KEYS.CACHED_PLAINTEXT_CREDS,
      ]);
      this.currentUser = null;
      cachedUidSync = null;
      log("🗑️ Caché limpiada");
    } catch (error) {
      log("❌ Error limpiando caché:", error);
    }
  }

  getCurrentUser(): CachedUser | null {
    return this.currentUser;
  }

  isAuthenticated(): boolean {
    return this.currentUser !== null || auth.currentUser !== null;
  }

  getIsOnline(): boolean {
    return this.isOnline;
  }

  getCurrentUid(): string | null {
    if (auth.currentUser?.uid) return auth.currentUser.uid;
    if (this.currentUser?.uid) return this.currentUser.uid;
    if (cachedUidSync) return cachedUidSync;
    return null;
  }

  async getCurrentUidAsync(): Promise<string | null> {
    const syncUid = this.getCurrentUid();
    if (syncUid) return syncUid;

    try {
      const uid = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_UID);
      if (uid) {
        cachedUidSync = uid;
        return uid;
      }

      const userData = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_USER);
      if (userData) {
        const user = JSON.parse(userData) as CachedUser;
        if (user.uid) {
          cachedUidSync = user.uid;
          this.currentUser = user;
          return user.uid;
        }
      }
    } catch (error) {
      log("❌ Error en getCurrentUidAsync:", error);
    }

    return null;
  }

  async waitForInitialization(): Promise<CachedUser | null> {
    if (this.isInitialized) return this.currentUser;
    if (this.initializationPromise) return this.initializationPromise;
    return this.initialize();
  }

  private getErrorMessage(code: string): string {
    switch (code) {
      case "auth/invalid-email":
        return "El correo no es válido.";
      case "auth/user-not-found":
        return "No existe una cuenta con este correo.";
      case "auth/wrong-password":
        return "Contraseña incorrecta.";
      case "auth/too-many-requests":
        return "Demasiados intentos. Intenta más tarde.";
      case "auth/network-request-failed":
        return "Error de conexión.";
      case "auth/user-disabled":
        return "Esta cuenta ha sido deshabilitada.";
      default:
        return "Error al iniciar sesión.";
    }
  }

  // ==================== LISTENERS ====================

  addAuthStateListener(
    callback: (user: CachedUser | null) => void
  ): () => void {
    this.authStateListeners.add(callback);
    callback(this.currentUser);
    return () => this.authStateListeners.delete(callback);
  }

  private notifyAuthStateListeners(user: CachedUser | null): void {
    this.authStateListeners.forEach((callback) => callback(user));
  }
}

export const offlineAuthService = new OfflineAuthService();
export default offlineAuthService;
