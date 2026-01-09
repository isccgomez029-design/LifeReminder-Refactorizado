// src/services/offline/OfflineAuthService.ts

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
  isOffline: boolean;
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
  USERS_ROOT: "@lifereminder/auth/users",
  LAST_USER_EMAIL: "@lifereminder/auth/last_user_email",

  PENDING_REGISTRATIONS: "@lifereminder/auth/pending_registrations",
  LOGOUT_EXPLICIT: "@lifereminder/auth/logout_explicit",
};

// Helpers para paths por email
const userKey = (email: string) => `${STORAGE_KEYS.USERS_ROOT}/${email}/user`;

const credentialsKey = (email: string) =>
  `${STORAGE_KEYS.USERS_ROOT}/${email}/credentials`;

const plaintextKey = (email: string) =>
  `${STORAGE_KEYS.USERS_ROOT}/${email}/plaintext`;

// offline-first real
const OFFLINE_SESSION_VALIDITY_MS: number | null = null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,20}$/;

//                    UTILIDADES

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
  console.log(`[OfflineAuth ${timestamp}] ${message}`, data || "");
}

function isNetOnline(state: {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}) {
  return state.isConnected === true && state.isInternetReachable !== false;
}

let cachedUidSync: string | null = null;

//              CLASE PRINCIPAL: OfflineAuthService

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
  private async clearProfileCache(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const profileKeys = keys.filter((k) => k.includes("/profile/"));

      if (profileKeys.length > 0) {
        await AsyncStorage.multiRemove(profileKeys);
      }
    } catch {
      // no-op
    }
  }

  private async _doInitialize(): Promise<CachedUser | null> {
    await this.loadCachedUid();

    const netState = await NetInfo.fetch();
    this.isOnline = isNetOnline(netState);

    this.connectivityUnsubscribe = NetInfo.addEventListener((state) => {
      const wasOffline = !this.isOnline;
      this.isOnline = isNetOnline(state);

      if (wasOffline && this.isOnline) {
        this.syncSessionOnReconnect();
      }
    });

    //  1. FINALIZAR REGISTROS OFFLINE PENDIENTES PRIMERO
    await this.finalizeAllPendingRegistrations();

    //  2. SOLO DESPUÉS intentar restaurar Firebase
    await this.attemptFirebaseRestore();

    const cachedUser = await this.restoreSession();

    this.firebaseAuthUnsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        await this.cacheUserFromFirebase(user);
        await AsyncStorage.removeItem(STORAGE_KEYS.LOGOUT_EXPLICIT);
      }
    });

    this.isInitialized = true;

    return cachedUser;
  }

  private async loadCachedUid(): Promise<void> {
    try {
      const email = await AsyncStorage.getItem(STORAGE_KEYS.LAST_USER_EMAIL);
      if (email) {
        const userData = await AsyncStorage.getItem(userKey(email));
        if (userData) {
          const user = JSON.parse(userData) as CachedUser;
          if (user.uid) {
            cachedUidSync = user.uid;
          }
        }
      }
    } catch (error) {
      log("Error al cargar UID cacheado", error);
    }
  }

  destroy(): void {
    if (this.connectivityUnsubscribe) this.connectivityUnsubscribe();
    if (this.firebaseAuthUnsubscribe) this.firebaseAuthUnsubscribe();
    this.authStateListeners.clear();
    this.isInitialized = false;
    this.initializationPromise = null;
  }

  //                    REGISTER
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

      const u = await this.getCachedUser(email);
      return {
        success: true,
        isOffline: true,
        user: u || this.currentUser || undefined,
      };
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);

      if (cred.user) {
        await updateProfile(cred.user, { displayName: fullName });

        await setDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid,
          email,
          fullName,
          username,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await this.persistOfflineLoginAfterRegister(email, password);
        await AsyncStorage.removeItem(STORAGE_KEYS.LOGOUT_EXPLICIT);

        //sincronizar sesión tras registro ONLINE
        const cachedUser = await this.getCachedUser(email);

        if (cachedUser) {
          this.currentUser = cachedUser;
          cachedUidSync = cachedUser.uid;
          syncQueueService.setCurrentValidUserId(cachedUser.uid);
          await syncQueueService.initialize();
          await syncQueueService.processQueue();

          this.notifyAuthStateListeners(cachedUser);
        }
      }

      const u = await this.getCachedUser(email);

      return {
        success: true,
        isOffline: false,
        user: u || this.currentUser || undefined,
      };
    } catch (e: any) {
      const code = e?.code ?? "";

      let msg = "Ocurrió un error al crear tu cuenta. Intenta de nuevo.";
      if (code === "auth/email-already-in-use")
        msg = "Este correo ya está registrado.";
      else if (code === "auth/invalid-email") msg = "El correo no es válido.";
      else if (code === "auth/weak-password")
        msg = "La contraseña es demasiado débil (mínimo 6 caracteres).";
      else if (code === "auth/network-request-failed") {
        const fallback = await this.registerOfflinePending({
          email,
          password,
          fullName,
          username,
        });

        if (fallback.success) {
          const u = await this.getCachedUser(email);
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

  //  Agregar a cola en lugar de sobrescribir
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

      //  Obtener cola existente
      const queue = await this.getPendingRegistrations();

      //  Verificar si el email ya está en cola
      const existingIndex = queue.findIndex((p) => p.email === email);
      if (existingIndex !== -1) {
        queue[existingIndex] = {
          tempUid,
          email,
          password,
          fullName,
          username,
          createdAt: now,
        };
      } else {
        //  Agregar nuevo registro a la cola
        queue.push({
          tempUid,
          email,
          password,
          fullName,
          username,
          createdAt: now,
        });
      }

      //  Guardar cola actualizada
      await AsyncStorage.setItem(
        STORAGE_KEYS.PENDING_REGISTRATIONS,
        JSON.stringify(queue)
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

      await AsyncStorage.setItem(userKey(email), JSON.stringify(localUser));
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_USER_EMAIL, email);
      cachedUidSync = tempUid;

      await this.cacheCredentials(email, password);
      await AsyncStorage.setItem(
        plaintextKey(email),
        JSON.stringify({ email, password })
      );
      this.currentUser = localUser;
      cachedUidSync = tempUid;
      syncQueueService.setCurrentValidUserId(tempUid);
      this.notifyAuthStateListeners(localUser);
      await syncQueueService.initialize();

      return { success: true, tempUid };
    } catch (err: any) {
      return { success: false, error: "No se pudo crear el registro offline." };
    }
  }

  // Obtener todos los registros pendientes
  private async getPendingRegistrations(): Promise<PendingRegistration[]> {
    try {
      const raw = await AsyncStorage.getItem(
        STORAGE_KEYS.PENDING_REGISTRATIONS
      );
      return raw ? (JSON.parse(raw) as PendingRegistration[]) : [];
    } catch {
      return [];
    }
  }

  //  Eliminar un registro específico de la cola
  private async removePendingRegistration(tempUid: string): Promise<void> {
    try {
      const queue = await this.getPendingRegistrations();
      const filtered = queue.filter((p) => p.tempUid !== tempUid);
      await AsyncStorage.setItem(
        STORAGE_KEYS.PENDING_REGISTRATIONS,
        JSON.stringify(filtered)
      );
    } catch (err) {}
  }

  //  Limpiar toda la cola
  private async clearAllPendingRegistrations(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEYS.PENDING_REGISTRATIONS);
  }

  // Procesar TODOS los registros pendientes
  async finalizeAllPendingRegistrations(): Promise<void> {
    if (this.isFinalizingPending) {
      return;
    }

    try {
      const netState = await NetInfo.fetch();
      this.isOnline = isNetOnline(netState);
      if (!this.isOnline) {
        return;
      }

      const queue = await this.getPendingRegistrations();
      if (queue.length === 0) {
        return;
      }

      this.isFinalizingPending = true;

      for (const pending of queue) {
        try {
          await this.finalizeSingleRegistration(pending);
          // Esperar un poco entre registros para evitar rate limiting
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (err) {
          // Continuar con el siguiente registro incluso si uno falla
        }
      }
    } catch (err) {
    } finally {
      this.isFinalizingPending = false;
    }
  }

  //  Finalizar registro pendiente
  private async finalizeSingleRegistration(
    pending: PendingRegistration
  ): Promise<void> {
    try {
      // Si Firebase ya tiene sesión activa con el mismo email
      if (auth.currentUser) {
        const fbEmail = auth.currentUser.email?.toLowerCase();

        if (fbEmail === pending.email) {
          // Usuario ya existe, solo limpiar pending y migrar datos
          const realUid = auth.currentUser.uid;
          const oldUid = pending.tempUid;

          await syncQueueService.migrateUserNamespace(oldUid, realUid);
          //ACTUALIZAR UID VÁLIDO ANTES DE PROCESAR COLA
          syncQueueService.setCurrentValidUserId(realUid);
          await syncQueueService.initialize();

          await this.cacheUserFromFirebase(auth.currentUser);
          await this.cacheUserProfile(realUid);
          await this.removePendingRegistration(pending.tempUid);
          return;
        }
      }

      // 1️ Crear usuario REAL en Firebase

      const cred = await createUserWithEmailAndPassword(
        auth,
        pending.email,
        pending.password
      );

      await updateProfile(cred.user, { displayName: pending.fullName });

      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        email: pending.email,
        fullName: pending.fullName,
        username: pending.username,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const realUid = cred.user.uid;
      const oldUid = pending.tempUid;

      // 2️⃣ Migrar TODO el namespace offline (meds, habits, queue, etc.)

      await syncQueueService.migrateUserNamespace(oldUid, realUid);

      // 3️ Cachear usuario base y perfil
      await this.cacheUserFromFirebase(cred.user);
      await this.cacheUserProfile(realUid);

      // 4️ Obtener usuario FINAL desde cache
      const email = pending.email.toLowerCase();
      const cachedUser = await this.getCachedUser(email);

      if (cachedUser) {
        //  SINCRONIZACIÓN GLOBAL OBLIGATORIA
        this.currentUser = cachedUser;
        cachedUidSync = cachedUser.uid;
        syncQueueService.setCurrentValidUserId(cachedUser.uid);
        await syncQueueService.initialize();
        await syncQueueService.processQueue();

        this.notifyAuthStateListeners(cachedUser);
      }

      // 5️ Persistir credenciales para futuros logins offline
      await this.cacheCredentials(pending.email, pending.password);
      await AsyncStorage.setItem(
        plaintextKey(pending.email),
        JSON.stringify({ email: pending.email, password: pending.password })
      );

      // 6️ Eliminar este registro de la cola
      await this.removePendingRegistration(pending.tempUid);
    } catch (err: any) {
      const code = err?.code || "";

      // Si el email ya está en uso, eliminar de la cola
      if (code === "auth/email-already-in-use") {
        await this.removePendingRegistration(pending.tempUid);
        return;
      }

      // Para otros errores, dejar en la cola para reintentar después
      throw err;
    }
  }

  // ==================== AUTENTICACIÓN ====================

  async persistOfflineLoginAfterRegister(email: string, password: string) {
    const e = email.trim().toLowerCase();
    if (!e || !password) return;

    try {
      await this.cacheCredentials(e, password);
      await AsyncStorage.setItem(
        plaintextKey(e),
        JSON.stringify({ email: e, password })
      );

      if (auth.currentUser) {
        await this.cacheUserFromFirebase(auth.currentUser);
        await this.cacheUserProfile(auth.currentUser.uid);
      }
    } catch (err) {
      log("Error en persistOfflineLoginAfterRegister", err);
    }
  }

  async signIn(email: string, password: string): Promise<OfflineAuthResult> {
    const trimmedEmail = (email || "").trim().toLowerCase();
    const pass = password || "";

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
      // 1️ Login con Firebase
      const result = await signInWithEmailAndPassword(auth, email, password);
      const fbUser = result.user;

      // 2️ Evitar mezcla de usuarios
      if (this.currentUser && this.currentUser.uid !== fbUser.uid) {
        await this.clearAllCache();
      }

      // 3️ Cachear usuario base
      await this.cacheUserFromFirebase(fbUser);

      // 4️ Cachear perfil
      await this.cacheUserProfile(fbUser.uid);

      // 5️ Cachear credenciales
      await this.cacheCredentials(email, password);
      await AsyncStorage.setItem(
        plaintextKey(email),
        JSON.stringify({ email, password })
      );

      // 6️ Obtener usuario completo
      const cachedUser = await this.getCachedUser(email);

      if (cachedUser) {
        this.currentUser = cachedUser;
        cachedUidSync = cachedUser.uid;
        syncQueueService.setCurrentValidUserId(cachedUser.uid);
        await syncQueueService.initialize();
        await syncQueueService.processQueue();

        this.notifyAuthStateListeners(cachedUser);
      }

      await AsyncStorage.removeItem(STORAGE_KEYS.LOGOUT_EXPLICIT);

      return {
        success: true,
        isOffline: false,
        user: cachedUser || undefined,
      };
    } catch (e: any) {
      const code = e?.code ?? "";

      // Si falla por red, intentar offline
      if (code === "auth/network-request-failed") {
        return this.signInOffline(email, password);
      }

      return {
        success: false,
        isOffline: false,
        error: this.getErrorMessage(code),
        errorCode: code,
      };
    }
  }

  private async signInOffline(
    email: string,
    password: string
  ): Promise<OfflineAuthResult> {
    try {
      const cachedCreds = await this.getCachedCredentials(email);

      if (!cachedCreds) {
        return {
          success: false,
          isOffline: true,
          error:
            "No puedes iniciar sesión offline porque nunca has iniciado sesión con este correo.",
          errorCode: "login/no-cached-credentials",
        };
      }

      const inputHash = await hashPassword(password, cachedCreds.salt);

      if (inputHash !== cachedCreds.passwordHash) {
        return {
          success: false,
          isOffline: true,
          error: "Contraseña incorrecta.",
          errorCode: "login/wrong-password",
        };
      }

      await this.updateCredentialsLastUsed();

      const cachedUser = await this.getCachedUser(email);

      if (!cachedUser) {
        return {
          success: false,
          isOffline: true,
          error: "No se pudo recuperar la sesión offline.",
          errorCode: "login/no-cached-user",
        };
      }

      // Evitar mezcla de usuarios
      if (this.currentUser && this.currentUser.uid !== cachedUser.uid) {
        await this.clearAllCache();
      }

      this.currentUser = cachedUser;
      cachedUidSync = cachedUser.uid;
      syncQueueService.setCurrentValidUserId(cachedUser.uid);
      await syncQueueService.initialize();
      await syncQueueService.processQueue();

      this.notifyAuthStateListeners(cachedUser);

      await AsyncStorage.setItem(STORAGE_KEYS.LAST_USER_EMAIL, email);
      await AsyncStorage.removeItem(STORAGE_KEYS.LOGOUT_EXPLICIT);

      return {
        success: true,
        isOffline: true,
        user: cachedUser,
      };
    } catch (err: any) {
      return {
        success: false,
        isOffline: true,
        error: "Error al iniciar sesión offline.",
        errorCode: "login/offline-error",
      };
    }
  }

  // ==================== LOGOUT ====================

  async signOut(): Promise<void> {
    try {
      // Marcar logout explícito
      await AsyncStorage.setItem(
        STORAGE_KEYS.LOGOUT_EXPLICIT,
        new Date().toISOString()
      );

      // Cerrar sesión en Firebase si existe
      if (auth.currentUser) {
        await auth.signOut();
      }

      // Limpiar estado local
      const prevUid = this.currentUser?.uid;
      this.currentUser = null;
      cachedUidSync = null;
      syncQueueService.setCurrentValidUserId(null);
      syncQueueService.destroy();
      this.notifyAuthStateListeners(null);

      // NO limpiar cache para permitir login offline
      // Solo limpiar el LAST_USER_EMAIL para evitar auto-restore
      await AsyncStorage.removeItem(STORAGE_KEYS.LAST_USER_EMAIL);
    } catch (error) {
      throw error;
    }
  }

  // ==================== FIREBASE RESTORE ====================

  private async attemptFirebaseRestore(): Promise<void> {
    try {
      // Verificar si hubo logout explícito reciente
      const logoutStr = await AsyncStorage.getItem(
        STORAGE_KEYS.LOGOUT_EXPLICIT
      );
      if (logoutStr) {
        const logoutTime = new Date(logoutStr).getTime();
        const now = Date.now();
        if (now - logoutTime < 60000) {
          return;
        }
      }

      // Solo restaurar si hay usuario en Firebase y coincide con offline
      if (!auth.currentUser) {
        return;
      }

      const fbUid = auth.currentUser.uid;
      const offlineUid = this.getCurrentUid();

      // Si hay usuario offline y NO coincide → cerrar Firebase
      if (offlineUid && fbUid !== offlineUid) {
        await auth.signOut();
        return;
      }

      // Si coincide o no hay offline → restaurar

      await this.cacheUserFromFirebase(auth.currentUser);
      await this.cacheUserProfile(fbUid);

      const email = auth.currentUser.email?.toLowerCase();
      if (email) {
        const cachedUser = await this.getCachedUser(email);
        if (cachedUser) {
          this.currentUser = cachedUser;
          cachedUidSync = cachedUser.uid;
          syncQueueService.setCurrentValidUserId(cachedUser.uid);
          await syncQueueService.initialize();
          await syncQueueService.processQueue();

          this.notifyAuthStateListeners(cachedUser);
        }
      }
    } catch (error) {}
  }

  // ==================== CACHÉ DE USUARIO ====================

  private async cacheUserFromFirebase(user: User): Promise<void> {
    try {
      const email = user.email?.toLowerCase();
      if (!email) return;

      const now = Date.now();
      const cached: CachedUser = {
        uid: user.uid,
        email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        emailVerified: user.emailVerified,
        _cachedAt: now,
        _lastOnlineLogin: now,
      };

      await AsyncStorage.setItem(userKey(email), JSON.stringify(cached));
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_USER_EMAIL, email);
    } catch (error) {}
  }

  private async cacheUserProfile(uid: string): Promise<void> {
    try {
      const netState = await NetInfo.fetch();
      if (!isNetOnline(netState)) {
        return;
      }

      const profileRef = doc(db, "users", uid);
      const profileSnap = await getDoc(profileRef);

      if (!profileSnap.exists()) {
        return;
      }

      const profileData = profileSnap.data();
      const email = profileData.email?.toLowerCase();

      if (!email) {
        return;
      }

      const cachedUser = await this.getCachedUser(email);
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

      await AsyncStorage.setItem(userKey(email), JSON.stringify(updatedUser));

      this.currentUser = updatedUser;
      this.notifyAuthStateListeners(updatedUser);
    } catch (error) {}
  }

  async getCachedUser(email?: string): Promise<CachedUser | null> {
    try {
      let targetEmail = email;
      if (!targetEmail) {
        targetEmail =
          (await AsyncStorage.getItem(STORAGE_KEYS.LAST_USER_EMAIL)) ||
          undefined;
      }
      if (!targetEmail) return null;

      const data = await AsyncStorage.getItem(userKey(targetEmail));
      return data ? JSON.parse(data) : null;
    } catch (error) {
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
        credentialsKey(email),
        JSON.stringify(credentials)
      );
    } catch (error) {}
  }

  private async getCachedCredentials(
    email?: string
  ): Promise<CachedCredentials | null> {
    try {
      let targetEmail = email;
      if (!targetEmail) {
        targetEmail =
          (await AsyncStorage.getItem(STORAGE_KEYS.LAST_USER_EMAIL)) ||
          undefined;
      }
      if (!targetEmail) return null;

      const data = await AsyncStorage.getItem(credentialsKey(targetEmail));
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  private async updateCredentialsLastUsed(): Promise<void> {
    try {
      const email = await AsyncStorage.getItem(STORAGE_KEYS.LAST_USER_EMAIL);
      if (!email) return;

      const cached = await this.getCachedCredentials(email);
      if (cached) {
        cached._lastUsed = Date.now();
        await AsyncStorage.setItem(
          credentialsKey(email),
          JSON.stringify(cached)
        );
      }
    } catch (error) {}
  }

  // ==================== SESIÓN ====================

  private async restoreSession(): Promise<CachedUser | null> {
    const email = await AsyncStorage.getItem(STORAGE_KEYS.LAST_USER_EMAIL);
    if (!email) {
      return null;
    }

    const userRaw = await AsyncStorage.getItem(userKey(email));
    if (!userRaw) {
      return null;
    }

    const user = JSON.parse(userRaw) as CachedUser;

    //si el UID restaurado no coincide, limpiar cache previo
    if (this.currentUser && this.currentUser.uid !== user.uid) {
      await this.clearAllCache();
    }

    this.currentUser = user;
    cachedUidSync = user.uid;
    syncQueueService.setCurrentValidUserId(user.uid);
    this.notifyAuthStateListeners(user);

    return user;
  }

  private async syncSessionOnReconnect(): Promise<void> {
    try {
      //  Procesar registros pendientes primero
      await this.finalizeAllPendingRegistrations();

      const offlineUid = this.getCurrentUid();

      // Si no hay usuario offline se permitira  Firebase
      if (!offlineUid) {
        if (!auth.currentUser) {
          await this.attemptFirebaseRestore();
        }
        return;
      }

      //  Firebase tiene sesión pero NO coincide → BLOQUEAR
      if (auth.currentUser && auth.currentUser.uid !== offlineUid) {
        await auth.signOut();
        return;
      }

      //  UID coincide → sincronizar con seguridad
      if (auth.currentUser && auth.currentUser.uid === offlineUid) {
        await auth.currentUser.reload();
        await this.cacheUserFromFirebase(auth.currentUser);
        await this.cacheUserProfile(auth.currentUser.uid);
      }
      const uid = this.getCurrentUid();
      if (uid) {
        await syncQueueService.initialize();
        await syncQueueService.processQueue();
      }
    } catch (error) {}
  }

  // ==================== UTILIDADES ====================

  async clearAllCache(): Promise<void> {
    try {
      const email = await AsyncStorage.getItem(STORAGE_KEYS.LAST_USER_EMAIL);
      const keysToRemove = [
        STORAGE_KEYS.LAST_USER_EMAIL,
        STORAGE_KEYS.PENDING_REGISTRATIONS,
      ];

      if (email) {
        keysToRemove.push(
          userKey(email),
          credentialsKey(email),
          plaintextKey(email)
        );
      }

      await AsyncStorage.multiRemove(keysToRemove);
      this.currentUser = null;
      cachedUidSync = null;
    } catch (error) {}
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
    //  1. Fuente de verdad ABSOLUTA: SyncQueue
    const validUid = syncQueueService.getCurrentValidUserId();
    if (validUid) {
      return validUid;
    }

    //  2. Usuario offline en memoria (controlado por OfflineAuthService)
    if (this.currentUser?.uid) {
      return this.currentUser.uid;
    }

    //  3. Fallback extremo: Firebase Auth
    //  Solo se usa si todo lo demás falló
    if (auth.currentUser?.uid) {
      return auth.currentUser.uid;
    }

    //  4. No hay UID válido
    return null;
  }

  async getCurrentUidAsync(): Promise<string | null> {
    const syncUid = this.getCurrentUid();
    if (syncUid) return syncUid;

    try {
      const email = await AsyncStorage.getItem(STORAGE_KEYS.LAST_USER_EMAIL);
      if (email) {
        const userData = await AsyncStorage.getItem(userKey(email));
        if (userData) {
          const user = JSON.parse(userData) as CachedUser;
          if (user.uid) {
            cachedUidSync = user.uid;
            this.currentUser = user;
            return user.uid;
          }
        }
      }
    } catch (error) {
      log("❌ Error en getCurrentUidAsync", error);
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
