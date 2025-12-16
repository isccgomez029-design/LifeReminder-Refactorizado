// src/services/offline/OfflineAuthService.ts
// ✅ Login offline siempre + Register offline-first (pantallas limpias) + Finalización automática online

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as Crypto from "expo-crypto";
import { auth, db } from "../../config/firebaseConfig";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  User,
  createUserWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { syncQueueService } from "./SyncQueueService";

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
  username?: string;
  isPendingRegistration?: boolean;
  pendingCreatedAt?: number;
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

export interface RegisterParams {
  fullName: string;
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
}

export interface RegisterResult {
  success: boolean;
  isOffline: boolean; // true si se creó como pending local
  user?: CachedUser;
  error?: string;
  errorCode?: string;
}

interface PendingRegistration {
  tempUid: string;
  email: string;
  password: string;
  fullName: string;
  username: string;
  createdAt: number;
}

// ============================================================
//                      CONSTANTES
// ============================================================

const STORAGE_KEYS = {
  CACHED_USER: "@lifereminder/auth/cached_user",
  CACHED_CREDENTIALS: "@lifereminder/auth/cached_credentials",
  CACHED_UID: "@lifereminder/auth/cached_uid",
  CACHED_PLAINTEXT_CREDS: "@lifereminder/auth/plaintext_creds",
  PENDING_REGISTRATION: "@lifereminder/auth/pending_registration",
};

// ✅ Offline-first real: no expira
const OFFLINE_SESSION_VALIDITY_MS: number | null = null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,20}$/;

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
  private isFinalizingPending: boolean = false;

  // ==================== INICIALIZACIÓN ====================

  async initialize(): Promise<CachedUser | null> {
    if (this.initializationPromise) return this.initializationPromise;
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

    // ✅ Si hay registro pendiente y estamos online, finalizarlo primero
    if (this.isOnline) {
      await this.finalizePendingRegistrationIfAny();
    }

    // ✅ Restaurar Firebase si aplica
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

  // ============================================================
  //                    REGISTER (PANTALLAS LIMPIAS)
  // ============================================================

  /**
   * ✅ Register único (pantalla limpia):
   * - Valida inputs
   * - Detecta internet
   * - Online: crea Firebase Auth + doc usuarios + siembra offline login
   * - Offline: crea pending local + login inmediato offline
   */
  async register(params: RegisterParams): Promise<RegisterResult> {
    const validation = this.validateRegisterParams(params);
    if (!validation.ok) {
      return {
        success: false,
        isOffline: false,
        error: validation.error,
        errorCode: validation.code,
      };
    }

    const email = params.email.trim().toLowerCase();
    const password = params.password;
    const fullName = params.fullName.trim();
    const username = params.username.trim();

    const netState = await NetInfo.fetch();
    this.isOnline = isNetOnline(netState);

    // OFFLINE => pending local
    if (!this.isOnline) {
      const res = await this.registerOfflinePending({
        email,
        password,
        fullName,
        username,
      });

      if (!res.success) {
        return {
          success: false,
          isOffline: true,
          error: res.error || "No se pudo crear el registro offline.",
          errorCode: "register/offline-failed",
        };
      }

      const u = await this.getCachedUser();
      return {
        success: true,
        isOffline: true,
        user: u || this.currentUser || undefined,
      };
    }

    // ONLINE => Firebase real
    try {
      log("🧾 Intentando registro online (Firebase)...");

      const cred = await createUserWithEmailAndPassword(auth, email, password);

      if (cred.user) {
        await updateProfile(cred.user, { displayName: fullName });

        await setDoc(doc(db, "usuarios", cred.user.uid), {
          uid: cred.user.uid,
          email,
          fullName,
          username,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        // ✅ siembra offline login (hash + plaintext + cached user/profile)
        await this.persistOfflineLoginAfterRegister(email, password);
      }

      const u = await this.getCachedUser();
      return {
        success: true,
        isOffline: false,
        user: u || this.currentUser || undefined,
      };
    } catch (e: any) {
      const code = e?.code ?? "";
      log("❌ Error registro online:", code);

      let msg = "Ocurrió un error al crear tu cuenta. Intenta de nuevo.";
      if (code === "auth/email-already-in-use")
        msg = "Este correo ya está registrado.";
      else if (code === "auth/invalid-email") msg = "El correo no es válido.";
      else if (code === "auth/weak-password")
        msg = "La contraseña es demasiado débil (mínimo 6 caracteres).";
      else if (code === "auth/network-request-failed") {
        // fallback: si se cayó en el registro, aún podemos hacer pending local
        const fallback = await this.registerOfflinePending({
          email,
          password,
          fullName,
          username,
        });

        if (fallback.success) {
          const u = await this.getCachedUser();
          return {
            success: true,
            isOffline: true,
            user: u || this.currentUser || undefined,
          };
        }
        msg = "Sin conexión. No se pudo completar registro offline.";
      }

      return {
        success: false,
        isOffline: false,
        error: msg,
        errorCode: code || "register/unknown",
      };
    }
  }

  private validateRegisterParams(params: RegisterParams): {
    ok: boolean;
    error?: string;
    code?: string;
  } {
    const fullName = (params.fullName || "").trim();
    const email = (params.email || "").trim();
    const username = (params.username || "").trim();
    const password = params.password || "";
    const confirm = params.confirmPassword || "";

    if (!fullName)
      return {
        ok: false,
        error: "Falta tu nombre",
        code: "register/missing-name",
      };
    if (!email)
      return {
        ok: false,
        error: "Ingresa tu correo",
        code: "register/missing-email",
      };
    if (!EMAIL_RE.test(email)) {
      return {
        ok: false,
        error: "Correo no válido. Ejemplo: usuario@dominio.com",
        code: "register/invalid-email",
      };
    }
    if (!username)
      return {
        ok: false,
        error: "Ingresa tu nombre de usuario",
        code: "register/missing-username",
      };
    if (!USERNAME_RE.test(username)) {
      return {
        ok: false,
        error:
          "Usuario no válido. Usa 3–20 caracteres: letras, números, punto, guion y guion_bajo.",
        code: "register/invalid-username",
      };
    }
    if (password.length < 6) {
      return {
        ok: false,
        error: "La contraseña debe tener al menos 6 caracteres.",
        code: "register/weak-password",
      };
    }
    if (password !== confirm) {
      return {
        ok: false,
        error: "Las contraseñas no coinciden",
        code: "register/password-mismatch",
      };
    }
    return { ok: true };
  }

  // ============================================================
  //                     REGISTER OFFLINE PENDING
  // ============================================================

  async registerOfflinePending(params: {
    email: string;
    password: string;
    fullName: string;
    username: string;
  }): Promise<{ success: boolean; tempUid?: string; error?: string }> {
    const email = params.email.trim().toLowerCase();
    const password = params.password;
    const fullName = params.fullName.trim();
    const username = params.username.trim();

    if (!email || !password || !fullName || !username) {
      return { success: false, error: "Datos incompletos." };
    }

    try {
      const now = Date.now();
      const tempUid = `temp_${now}_${Math.random().toString(36).slice(2, 9)}`;

      const pending: PendingRegistration = {
        tempUid,
        email,
        password,
        fullName,
        username,
        createdAt: now,
      };
      await AsyncStorage.setItem(
        STORAGE_KEYS.PENDING_REGISTRATION,
        JSON.stringify(pending)
      );

      const localUser: CachedUser = {
        uid: tempUid,
        email,
        displayName: fullName,
        photoURL: null,
        emailVerified: false,
        nombre: fullName,
        username,
        isPendingRegistration: true,
        pendingCreatedAt: now,
        _cachedAt: now,
        _lastOnlineLogin: now,
      };

      await AsyncStorage.setItem(
        STORAGE_KEYS.CACHED_USER,
        JSON.stringify(localUser)
      );
      await AsyncStorage.setItem(STORAGE_KEYS.CACHED_UID, tempUid);
      cachedUidSync = tempUid;

      await this.cacheCredentials(email, password);
      await AsyncStorage.setItem(
        STORAGE_KEYS.CACHED_PLAINTEXT_CREDS,
        JSON.stringify({ email, password })
      );

      this.currentUser = localUser;
      this.notifyAuthStateListeners(localUser);

      log("✅ Registro offline pendiente creado:", tempUid);
      return { success: true, tempUid };
    } catch (err: any) {
      log("❌ registerOfflinePending() error:", err?.message);
      return { success: false, error: "No se pudo crear el registro offline." };
    }
  }

  private async getPendingRegistration(): Promise<PendingRegistration | null> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_REGISTRATION);
      return raw ? (JSON.parse(raw) as PendingRegistration) : null;
    } catch {
      return null;
    }
  }

  private async clearPendingRegistration(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEYS.PENDING_REGISTRATION);
  }

  async finalizePendingRegistrationIfAny(): Promise<void> {
    if (this.isFinalizingPending) return;

    try {
      const netState = await NetInfo.fetch();
      this.isOnline = isNetOnline(netState);
      if (!this.isOnline) return;

      const pending = await this.getPendingRegistration();
      if (!pending) return;

      this.isFinalizingPending = true;
      log("🧩 Finalizando registro pendiente...");

      if (auth.currentUser) {
        if ((auth.currentUser.email || "").toLowerCase() === pending.email) {
          await this.clearPendingRegistration();
        }
        this.isFinalizingPending = false;
        return;
      }

      const cred = await createUserWithEmailAndPassword(
        auth,
        pending.email,
        pending.password
      );

      await updateProfile(cred.user, { displayName: pending.fullName });

      await setDoc(doc(db, "usuarios", cred.user.uid), {
        uid: cred.user.uid,
        email: pending.email,
        fullName: pending.fullName,
        username: pending.username,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const realUid = cred.user.uid;
      const oldUid = pending.tempUid;

      await syncQueueService.migrateUserNamespace(oldUid, realUid);

      await this.cacheUserFromFirebase(cred.user);
      await this.cacheUserProfile(realUid);

      await this.cacheCredentials(pending.email, pending.password);
      await AsyncStorage.setItem(
        STORAGE_KEYS.CACHED_PLAINTEXT_CREDS,
        JSON.stringify({ email: pending.email, password: pending.password })
      );

      await this.clearPendingRegistration();

      log(`✅ Registro pendiente finalizado. ${oldUid} -> ${realUid}`);
    } catch (err: any) {
      log(
        "⚠️ finalizePendingRegistrationIfAny() falló:",
        err?.code || err?.message
      );
    } finally {
      this.isFinalizingPending = false;
    }
  }

  // ==================== AUTENTICACIÓN ====================

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
    const trimmedEmail = (email || "").trim().toLowerCase();
    const pass = password || "";

    // ✅ Validación aquí (para mantener pantallas limpias)
    if (!trimmedEmail) {
      return {
        success: false,
        isOffline: false,
        error: "Por favor, ingresa tu correo.",
        errorCode: "login/missing-email",
      };
    }

    if (!EMAIL_RE.test(trimmedEmail)) {
      return {
        success: false,
        isOffline: false,
        error: "El formato del correo no es válido.",
        errorCode: "login/invalid-email",
      };
    }

    if (!pass.trim()) {
      return {
        success: false,
        isOffline: false,
        error: "Por favor, ingresa tu contraseña.",
        errorCode: "login/missing-password",
      };
    }

    if (pass.length < 6) {
      return {
        success: false,
        isOffline: false,
        error: "La contraseña debe tener al menos 6 caracteres.",
        errorCode: "login/weak-password",
      };
    }

    const netState = await NetInfo.fetch();
    this.isOnline = isNetOnline(netState);

    if (this.isOnline) {
      return this.signInOnline(trimmedEmail, pass);
    } else {
      return this.signInOffline(trimmedEmail, pass);
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

      // ✅ Sin expiración offline (OFFLINE_SESSION_VALIDITY_MS queda reservado)
      void OFFLINE_SESSION_VALIDITY_MS;

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

  // ==================== RESTORE FIREBASE SESSION ====================

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

      const pending = await this.getPendingRegistration();
      if (pending) {
        log("ℹ️ Hay registro pendiente, se omite Firebase restore");
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
        isPendingRegistration: false,
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
      const collectionsToTry = ["usuarios", "users"];
      let profileData: Record<string, any> | null = null;

      for (const col of collectionsToTry) {
        const ref = doc(db, col, uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          profileData = snap.data();
          log(`💾 Perfil encontrado en colección: ${col}`);
          break;
        }
      }

      if (!profileData) return;

      const cachedUser = await this.getCachedUser();
      if (!cachedUser) return;

      const updatedUser: CachedUser = {
        ...cachedUser,
        nombre:
          profileData.nombre ??
          profileData.fullName ??
          profileData.displayName ??
          cachedUser.displayName ??
          undefined,
        username: profileData.username ?? cachedUser.username ?? undefined,
        telefono: profileData.telefono ?? profileData.phone ?? undefined,
        fechaNacimiento: profileData.fechaNacimiento ?? undefined,
        rol: profileData.rol ?? undefined,
      };

      await AsyncStorage.setItem(
        STORAGE_KEYS.CACHED_USER,
        JSON.stringify(updatedUser)
      );

      this.currentUser = updatedUser;
      this.notifyAuthStateListeners(updatedUser);

      log("✅ Perfil cacheado/actualizado");
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
      await this.finalizePendingRegistrationIfAny();

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
        STORAGE_KEYS.PENDING_REGISTRATION,
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
    callback(this.currentUser);3
    return () => this.authStateListeners.delete(callback);
  }

  private notifyAuthStateListeners(user: CachedUser | null): void {
    this.authStateListeners.forEach((callback) => callback(user));
  }
}

export const offlineAuthService = new OfflineAuthService();
export default offlineAuthService;
