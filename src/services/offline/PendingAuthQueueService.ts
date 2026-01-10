// src/services/offline/PendingAuthQueueService.ts

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  signOut,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { secondaryDb, secondaryAuth } from "../../config/firebaseConfig";

import { syncQueueService } from "./SyncQueueService";

const QUEUE_KEY = "@lifereminder/auth/pending_reg_queue_v1";
const PASS_KEY_PREFIX = "@lifereminder/auth/pending_reg_pass_v1/";

// mismos keys que tu OfflineAuthService
const USERS_ROOT = "@lifereminder/auth/users";
const userKey = (email: string) => `${USERS_ROOT}/${email}/user`;

export type PendingRegStatus = "PENDING" | "PROCESSING" | "FAILED";

export type PendingRegistrationItem = {
  id: string;
  tempUid: string;
  email: string;
  displayName: string;
  username?: string;
  rol?: string;
  createdAt: number;
  status: PendingRegStatus;
  error?: string;
};

type CachedUser = {
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
};

// ================== estado interno (como SyncQueueService) ==================
let isInitialized = false;
let isOnline = true;
let isProcessing = false;
let netInfoUnsub: (() => void) | null = null;

function passKey(id: string) {
  return PASS_KEY_PREFIX + id;
}

async function isReallyOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected === true && state.isInternetReachable !== false;
}

async function getQueue(): Promise<PendingRegistrationItem[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingRegistrationItem[]) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: PendingRegistrationItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

async function setPendingPassword(id: string, password: string): Promise<void> {
  await AsyncStorage.setItem(passKey(id), password);
}

async function getPendingPassword(id: string): Promise<string | null> {
  return AsyncStorage.getItem(passKey(id));
}

async function deletePendingPassword(id: string): Promise<void> {
  await AsyncStorage.removeItem(passKey(id));
}

//initialize / destroy 
async function initialize(): Promise<void> {
  if (isInitialized) return;

  if (netInfoUnsub) netInfoUnsub();

  netInfoUnsub = NetInfo.addEventListener((state: NetInfoState) => {
    const wasOffline = !isOnline;
    isOnline =
      state.isConnected === true && state.isInternetReachable !== false;

    if (isOnline && wasOffline) {
      setTimeout(() => {
        processQueue().catch(() => {});
      }, 1200);
    }
  });

  const state = await NetInfo.fetch();
  isOnline = state.isConnected === true && state.isInternetReachable !== false;

  const q = await getQueue();
  const pendingCount = q.filter(
    (x) => x.status === "PENDING" || x.status === "FAILED"
  ).length;
  if (pendingCount > 0 && isOnline) {
    setTimeout(() => {
      processQueue().catch(() => {});
    }, 1200);
  }

  isInitialized = true;
}

function destroy(): void {
  if (netInfoUnsub) {
    netInfoUnsub();
    netInfoUnsub = null;
  }
  isInitialized = false;
}


async function enqueueRegistration(input: {
  tempUid: string;
  email: string;
  password: string;
  displayName: string;
  username?: string;
  rol?: string;
}): Promise<string> {
  await initialize(); 

  const id = `reg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const item: PendingRegistrationItem = {
    id,
    tempUid: input.tempUid,
    email: input.email.trim().toLowerCase(),
    displayName: (input.displayName || "").trim(),
    username: input.username?.trim(),
    rol: input.rol,
    createdAt: Date.now(),
    status: "PENDING",
  };

  await setPendingPassword(id, input.password);

  const queue = await getQueue();
  queue.unshift(item);
  await saveQueue(queue);


  if (await isReallyOnline()) {
    setTimeout(() => {
      processQueue().catch(() => {});
    }, 500);
  }

  return id;
}



async function processQueue(): Promise<{ success: number; failed: number }> {
  if (isProcessing) return { success: 0, failed: 0 };

  const online = await isReallyOnline();
  isOnline = online;
  if (!online) return { success: 0, failed: 0 };

  let queue = await getQueue();
  const pending = queue.filter(
    (x) => x.status === "PENDING" || x.status === "FAILED"
  );
  if (pending.length === 0) return { success: 0, failed: 0 };

  isProcessing = true;

  let success = 0;
  let failed = 0;

  for (const item of pending) {
    queue = queue.map((q) =>
      q.id === item.id ? { ...q, status: "PROCESSING", error: undefined } : q
    );
    await saveQueue(queue);

    try {
      const password = await getPendingPassword(item.id);
      if (!password) throw new Error("Password pendiente no encontrado.");

      let realUid: string | null = null;

      try {

        const cred = await createUserWithEmailAndPassword(
          secondaryAuth,
          item.email,
          password
        );

        if (item.displayName) {
          await updateProfile(cred.user, { displayName: item.displayName });
        }

        await setDoc(doc(secondaryDb, "users", cred.user.uid), {
          uid: cred.user.uid,
          email: item.email,
          fullName: item.displayName,
          username: item.username || null,
          rol: item.rol || "patient",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          fromOfflineRegistration: true,
        });

        realUid = cred.user.uid;
      } catch (e: any) {

        if (e?.code === "auth/email-already-in-use") {
          const res = await signInWithEmailAndPassword(
            secondaryAuth,
            item.email,
            password
          );
          realUid = res.user.uid;
        } else {
          throw e;
        }
      } finally {
        try {
          await signOut(secondaryAuth);
        } catch {}
      }

      if (!realUid) throw new Error("No se pudo obtener UID real.");


      await syncQueueService.migrateUserNamespace(item.tempUid, realUid);

      try {
        const raw = await AsyncStorage.getItem(userKey(item.email));
        if (raw) {
          const cu = JSON.parse(raw) as CachedUser;
          const updated: CachedUser = {
            ...cu,
            uid: realUid,
            isPendingRegistration: false,
            pendingCreatedAt: undefined,
            _cachedAt: Date.now(),
            _lastOnlineLogin: Date.now(),
            displayName: item.displayName || cu.displayName || null,
            nombre: item.displayName || cu.nombre,
            username: item.username || cu.username,
          };
          await AsyncStorage.setItem(
            userKey(item.email),
            JSON.stringify(updated)
          );
        }
      } catch {}

      await deletePendingPassword(item.id);

      queue = queue.filter((q) => q.id !== item.id);
      await saveQueue(queue);

      success++;
    } catch (e: any) {
      const msg = e?.message || "Error";

      queue = queue.map((q) =>
        q.id === item.id ? { ...q, status: "FAILED", error: msg } : q
      );
      await saveQueue(queue);

      failed++;
    }
  }

  isProcessing = false;
  return { success, failed };
}

async function getStats(): Promise<{
  total: number;
  pending: number;
  failed: number;
}> {
  const queue = await getQueue();
  return {
    total: queue.length,
    pending: queue.filter((x) => x.status === "PENDING").length,
    failed: queue.filter((x) => x.status === "FAILED").length,
  };
}

async function clearAll(): Promise<void> {
  const queue = await getQueue();
  for (const item of queue) {
    try {
      await deletePendingPassword(item.id);
    } catch {}
  }
  await AsyncStorage.removeItem(QUEUE_KEY);
}

export const pendingAuthQueueService = {
  initialize,
  destroy,
  enqueueRegistration,
  processQueue,
  getQueue,
  getStats,
  clearAll,
};

export default pendingAuthQueueService;
