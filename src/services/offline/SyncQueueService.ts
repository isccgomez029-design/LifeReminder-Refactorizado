// src/services/offline/SyncQueueService.ts

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import { db } from "../../config/firebaseConfig";
import {
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  Timestamp,
} from "firebase/firestore";

const QUEUE_KEY = "@lifereminder/sync_queue";
const STORAGE_PREFIX = "@lifereminder/data";

export type OperationType = "CREATE" | "UPDATE" | "DELETE";
export type QueueItemStatus = "PENDING" | "PROCESSING" | "FAILED" | "COMPLETED";

export interface QueueItem {
  id: string;
  type: OperationType;
  collection: string;
  documentId: string;
  userId: string;
  payload: Record<string, any>;
  timestamp: number;
  retryCount: number;
  status: QueueItemStatus;
  error?: string;
}

export interface SyncStats {
  pending: number;
  failed: number;
  total: number;
  isOnline: boolean;
  isProcessing: boolean;
  lastSync: Date | null;
}

export interface CachedCollection {
  data: Record<string, any>[];
  cachedAt: number;
  lastSyncedAt: number;
}

export interface CachedData<T = any> {
  data: T[];
  timestamp: number;
  userId: string;
}

export interface SyncResult {
  itemId: string;
  success: boolean;
  error?: string;
}


let isOnline = true;
let isProcessing = false;
let lastSyncTime: Date | null = null;

let listeners: Array<(queue: QueueItem[]) => void> = [];
let isInitialized = false;
let netInfoUnsubscribe: (() => void) | null = null;

const AUTO_SYNC_COLLECTIONS = [
  "medications",
  "habits",
  "appointments",
  "history",
];

//    UID ACTUAL 

let _currentValidUserId: string | null = null;

function setCurrentValidUserId(userId: string | null): void {
  _currentValidUserId = userId;
}

function getCurrentValidUserId(): string | null {
  return _currentValidUserId;
}

//  UTILIDADES

function getCacheKey(collectionName: string, userId: string): string {
  return `${STORAGE_PREFIX}/${userId}/${collectionName}`;
}

function normalizeForStorage(value: any): any {
  if (value === null || value === undefined) return value;

  // Firestore Timestamp
  if (typeof value?.toDate === "function") {
    try {
      const d = value.toDate();
      return d instanceof Date ? d.toISOString() : null;
    } catch {
      return null;
    }
  }

  if (typeof value?.seconds === "number") {
    const d = new Date(value.seconds * 1000);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Date
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Array
  if (Array.isArray(value)) {
    return value.map(normalizeForStorage);
  }

  // Object
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalizeForStorage(v);
    }
    return out;
  }

  return value;
}

// INICIALIZACIÓN

async function initialize(): Promise<void> {
  if (isInitialized) return;

  if (netInfoUnsubscribe) netInfoUnsubscribe();

  netInfoUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const wasOffline = !isOnline;

    isOnline =
      state.isConnected === true && state.isInternetReachable !== false;

    if (isOnline && wasOffline) {
      setTimeout(() => processQueue(), 1500);
    }
  });

  const state = await NetInfo.fetch();
  isOnline = state.isConnected === true && state.isInternetReachable !== false;

  const queue = await getQueue();
  const pendingCount = queue.filter(
    (item) => item.status === "PENDING" || item.status === "FAILED"
  ).length;

  if (pendingCount > 0 && isOnline) {
    setTimeout(() => processQueue(), 2000);
  }

  isInitialized = true;
}

function destroy(): void {
  if (netInfoUnsubscribe) {
    netInfoUnsubscribe();
    netInfoUnsubscribe = null;
  }
  listeners = [];
  isInitialized = false;
}

//QUEUE LISTENERS

function addListener(callback: (queue: QueueItem[]) => void): () => void {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter((l) => l !== callback);
  };
}

async function notifyListeners(): Promise<void> {
  const queue = await getQueue();
  listeners.forEach((listener) => listener(queue));
}

//  QUEUE MANAGEMENT
async function getQueue(): Promise<QueueItem[]> {
  try {
    const data = await AsyncStorage.getItem(QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: QueueItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    await notifyListeners();
  } catch {}
}

async function enqueue(
  type: OperationType,
  collectionName: string,
  documentId: string,
  userId: string,
  payload: Record<string, any>
): Promise<string> {
  const queue = await getQueue();
  const id = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const item: QueueItem = {
    id,
    type,
    collection: collectionName,
    documentId,
    userId,
    payload,
    timestamp: Date.now(),
    retryCount: 0,
    status: "PENDING",
  };

  queue.push(item);
  await saveQueue(queue);

  if (type === "CREATE") {
    await addItemToCache(collectionName, userId, {
      id: documentId,
      ...payload,
    });
  } else if (type === "UPDATE") {
    await updateItemInCache(collectionName, userId, documentId, payload);
  } else if (type === "DELETE") {
    await removeItemFromCache(collectionName, userId, documentId);
  }

  if (isOnline && !isProcessing) {
    setTimeout(() => processQueue(), 500);
  }

  return id;
}

async function getPendingCount(): Promise<number> {
  const queue = await getQueue();
  return queue.filter(
    (item) => item.status === "PENDING" || item.status === "FAILED"
  ).length;
}

async function getStats(): Promise<SyncStats> {
  const queue = await getQueue();
  return {
    pending: queue.filter((item) => item.status === "PENDING").length,
    failed: queue.filter((item) => item.status === "FAILED").length,
    total: queue.length,
    isOnline,
    isProcessing,
    lastSync: lastSyncTime,
  };
}

// PROCESS QUEUE

function prepareDataForFirestore(
  data: Record<string, any>
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("_") || key === "id") continue;

    if (value === null || value === undefined) {
      result[key] = null;
    } else if (value instanceof Date) {
      result[key] = Timestamp.fromDate(value);
    } else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      result[key] = Timestamp.fromDate(new Date(value));
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = prepareDataForFirestore(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

async function processQueue(): Promise<{ success: number; failed: number }> {
  if (isProcessing) return { success: 0, failed: 0 };

  const netState = await NetInfo.fetch();
  isOnline =
    netState.isConnected === true && netState.isInternetReachable !== false;

  if (!isOnline) return { success: 0, failed: 0 };

  isProcessing = true;
  await notifyListeners();

  const queue = await getQueue();
  const pendingItems = queue.filter(
    (item) => item.status === "PENDING" || item.status === "FAILED"
  );

  if (pendingItems.length === 0) {
    isProcessing = false;
    await notifyListeners();
    return { success: 0, failed: 0 };
  }

  let successCount = 0;
  let failedCount = 0;
  let currentQueue = [...queue];

  for (const item of pendingItems) {
    if (item.userId.startsWith("temp_")) {
      continue;
    }

    if (_currentValidUserId && item.userId !== _currentValidUserId) {
      continue;
    }

    const itemIndex = currentQueue.findIndex((q) => q.id === item.id);
    if (itemIndex >= 0) {
      currentQueue[itemIndex].status = "PROCESSING";
      await saveQueue(currentQueue);
    }

    try {
      const collectionPath = `users/${item.userId}/${item.collection}`;
      const docRef = doc(db, collectionPath, item.documentId);

      if (item.type === "CREATE") {
        const preparedData = prepareDataForFirestore(item.payload);
        await setDoc(docRef, preparedData);
        successCount++;
      } else if (item.type === "UPDATE") {
        const preparedData = prepareDataForFirestore(item.payload);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          await updateDoc(docRef, preparedData);
        } else {
          await setDoc(docRef, preparedData);
        }
        successCount++;
      } else if (item.type === "DELETE") {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          await deleteDoc(docRef);
        }
        successCount++;
      }

      // eliminar item procesado correctamente
      currentQueue = currentQueue.filter((q) => q.id !== item.id);
      await saveQueue(currentQueue);
    } catch (error: any) {
      const idx = currentQueue.findIndex((q) => q.id === item.id);
      if (idx >= 0) {
        currentQueue[idx].status = "FAILED";
        currentQueue[idx].retryCount++;
        currentQueue[idx].error = error?.message || "Error";

        if (currentQueue[idx].retryCount >= 5) {
          currentQueue = currentQueue.filter((q) => q.id !== item.id);
        }

        await saveQueue(currentQueue);
      }

      failedCount++;
    }
  }

  lastSyncTime = new Date();
  isProcessing = false;
  await notifyListeners();

  return { success: successCount, failed: failedCount };
}

async function retryFailed(): Promise<void> {
  const queue = await getQueue();
  const updatedQueue = queue.map((item) => {
    if (item.status === "FAILED") {
      return { ...item, status: "PENDING" as QueueItemStatus, retryCount: 0 };
    }
    return item;
  });

  await saveQueue(updatedQueue);

  if (isOnline) {
    processQueue();
  }
}

async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
  await notifyListeners();
}

async function forceSync(): Promise<{ success: number; failed: number }> {
  return processQueue();
}

async function saveToCache(
  collectionName: string,
  userId: string,
  remoteData: Array<Record<string, any>>
): Promise<void> {
  try {
    const dataWithIds = remoteData.filter(
      (item): item is Record<string, any> & { id: string } =>
        typeof item?.id === "string" && item.id.length > 0
    );

    const queue = await getQueue();
    const pendingOps = queue.filter(
      (op) =>
        op.collection === collectionName &&
        op.userId === userId &&
        (op.status === "PENDING" ||
          op.status === "FAILED" ||
          op.status === "PROCESSING")
    );

    const pendingMap = new Map<string, QueueItem>();
    pendingOps.forEach((op) => {
      const existing = pendingMap.get(op.documentId);
      if (!existing || op.timestamp > existing.timestamp) {
        pendingMap.set(op.documentId, op);
      }
    });

    const currentCache = await getFromCache(collectionName, userId);
    const currentData = currentCache?.data || [];

    const finalData: Array<Record<string, any>> = [];
    const processedIds = new Set<string>();

    const PRESERVE_FIELDS = [
      "currentAlarmId",
      "scheduledAlarmIds",
      "snoozeCount",
      "snoozedUntil",
      "lastSnoozeAt",
      "lastSnoozeAt",
    ];

    for (const item of dataWithIds) {
      const pendingOp = pendingMap.get(item.id);

      if (pendingOp?.type === "DELETE") {
        processedIds.add(item.id);
        continue;
      }

      const localItem = currentData.find((d: any) => d.id === item.id);
      let mergedItem: Record<string, any> = { ...item };

      if (pendingOp?.type === "UPDATE") {
        mergedItem = { ...mergedItem, ...pendingOp.payload };
      }

      if (localItem) {
        for (const field of PRESERVE_FIELDS) {
          if (
            localItem[field] !== undefined &&
            localItem[field] !== null &&
            item[field] === undefined
          ) {
            mergedItem[field] = localItem[field];
          }
        }
      }

      finalData.push(normalizeForStorage(mergedItem));
      processedIds.add(item.id);
    }

    for (const [docId, op] of pendingMap) {
      if (op.type === "CREATE" && !processedIds.has(docId)) {
        finalData.push(normalizeForStorage({ id: docId, ...op.payload }));
        processedIds.add(docId);
      }
    }

    for (const item of currentData as any[]) {
      const itemId = item.id as string;
      if (!processedIds.has(itemId)) {
        if (
          item.isArchived === true ||
          !!item.archivedAt ||
          itemId?.startsWith("temp_")
        ) {
          finalData.push(normalizeForStorage(item));
          processedIds.add(itemId);
        }
      }
    }

    const key = getCacheKey(collectionName, userId);
    const cached: CachedCollection = {
      data: finalData,
      cachedAt: Date.now(),
      lastSyncedAt: Date.now(),
    };

    await AsyncStorage.setItem(key, JSON.stringify(cached));
  } catch {}
}

async function getFromCache<T = any>(
  collectionName: string,
  userId: string
): Promise<{ data: T[]; timestamp: number } | null> {
  try {
    const key = getCacheKey(collectionName, userId);
    const cached = await AsyncStorage.getItem(key);

    if (!cached) return null;

    const parsed = JSON.parse(cached) as CachedCollection;

    if (parsed.data && Array.isArray(parsed.data)) {
      const hasWrongUserId = parsed.data.some((item: any) => {
        if (item?.userId && item.userId !== userId) return true;
        return false;
      });

      if (hasWrongUserId) {
        await AsyncStorage.removeItem(key);
        return null;
      }
    }

    return { data: parsed.data as T[], timestamp: parsed.cachedAt };
  } catch {
    return null;
  }
}

async function addItemToCache(
  collectionName: string,
  userId: string,
  item: Record<string, any>
): Promise<void> {
  try {
    if (!item.id) return;

    item = normalizeForStorage(item);

    const cached = await getFromCache(collectionName, userId);
    const currentData = cached?.data || [];

    const existingIndex = currentData.findIndex((d: any) => d.id === item.id);

    let newData: Array<Record<string, any>>;
    if (existingIndex >= 0) {
      newData = [...currentData];
      newData[existingIndex] = { ...newData[existingIndex], ...item };
    } else {
      newData = [...currentData, item];
    }

    const key = getCacheKey(collectionName, userId);
    const cacheData: CachedCollection = {
      data: newData,
      cachedAt: Date.now(),
      lastSyncedAt: Date.now(),
    };

    await AsyncStorage.setItem(key, JSON.stringify(cacheData));
  } catch {}
}

async function updateItemInCache(
  collectionName: string,
  userId: string,
  docId: string,
  updates: Record<string, any>
): Promise<void> {
  try {
    updates = normalizeForStorage(updates);

    const cached = await getFromCache(collectionName, userId);

    if (!cached || !cached.data) {
      const key = getCacheKey(collectionName, userId);
      const cacheData: CachedCollection = {
        data: [normalizeForStorage({ id: docId, ...updates })],
        cachedAt: Date.now(),
        lastSyncedAt: Date.now(),
      };
      await AsyncStorage.setItem(key, JSON.stringify(cacheData));
      return;
    }

    const itemIndex = cached.data.findIndex((item: any) => item.id === docId);

    let updatedData: Array<Record<string, any>>;
    if (itemIndex >= 0) {
      updatedData = [...cached.data];
      updatedData[itemIndex] = normalizeForStorage({
        ...updatedData[itemIndex],
        ...updates,
      });
    } else {
      updatedData = [
        ...cached.data,
        normalizeForStorage({ id: docId, ...updates }),
      ];
    }

    const key = getCacheKey(collectionName, userId);
    const cacheData: CachedCollection = {
      data: updatedData,
      cachedAt: Date.now(),
      lastSyncedAt: Date.now(),
    };
    await AsyncStorage.setItem(key, JSON.stringify(cacheData));
  } catch {}
}

async function removeItemFromCache(
  collectionName: string,
  userId: string,
  docId: string
): Promise<void> {
  try {
    const cached = await getFromCache(collectionName, userId);
    if (!cached) return;

    const filteredData = cached.data.filter((item: any) => item.id !== docId);

    const key = getCacheKey(collectionName, userId);
    const cacheData: CachedCollection = {
      data: filteredData,
      cachedAt: Date.now(),
      lastSyncedAt: Date.now(),
    };
    await AsyncStorage.setItem(key, JSON.stringify(cacheData));
  } catch {}
}

async function getItemFromCache(
  collectionName: string,
  userId: string,
  docId: string
): Promise<Record<string, any> | null> {
  try {
    const cached = await getFromCache(collectionName, userId);
    if (!cached) return null;

    return (cached.data as any).find((item: any) => item.id === docId) || null;
  } catch {
    return null;
  }
}

async function clearCache(
  collectionName: string,
  userId: string
): Promise<void> {
  try {
    const key = getCacheKey(collectionName, userId);
    await AsyncStorage.removeItem(key);
  } catch {}
}

async function clearAllUserCache(userId: string): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const userCacheKeys = allKeys.filter(
      (key) => key.startsWith(STORAGE_PREFIX) && key.includes(userId)
    );

    if (userCacheKeys.length > 0) {
      await AsyncStorage.multiRemove(userCacheKeys);
    }
  } catch {}
}

//Limpia todos los datos de usuario

async function clearAllUserData(): Promise<void> {
  try {
    //  Obtener  las claves de AsyncStorage
    const allKeys = await AsyncStorage.getAllKeys();

    // Filtrar  las claves de datos (@lifereminder/data)
    const dataKeys = allKeys.filter((key) => key.startsWith(STORAGE_PREFIX));

    // Eliminar  las claves de datos
    if (dataKeys.length > 0) {
      await AsyncStorage.multiRemove(dataKeys);
    }

    // Limpiar la cola de sincronización
    await clearQueue();
  } catch {}
}

async function hasCachedData(userId: string): Promise<boolean> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    return allKeys.some(
      (key) => key.startsWith(STORAGE_PREFIX) && key.includes(userId)
    );
  } catch {
    return false;
  }
}

async function debugCache(userId: string): Promise<void> {
  try {
    for (const collectionName of AUTO_SYNC_COLLECTIONS) {
      await getFromCache(collectionName, userId);
    }
    await getQueue();
  } catch {}
}

async function migrateUserNamespace(
  oldUid: string,
  newUid: string
): Promise<void> {
  if (!oldUid || !newUid || oldUid === newUid) return;

  try {
    //  Migrar keys de AsyncStorage
    const allKeys = await AsyncStorage.getAllKeys();
    const oldPrefix = `${STORAGE_PREFIX}/${oldUid}/`;
    const oldKeys = allKeys.filter((k) => k.startsWith(oldPrefix));

    for (const key of oldKeys) {
      const value = await AsyncStorage.getItem(key);
      if (value == null) continue;

      const newKey = key.replace(
        `${STORAGE_PREFIX}/${oldUid}/`,
        `${STORAGE_PREFIX}/${newUid}/`
      );

      await AsyncStorage.setItem(newKey, value);
      await AsyncStorage.removeItem(key);
    }

    // Migrar cola de sincronización
    const queue = await getQueue();
    const updated = queue.map((item) => {
      if (item.userId === oldUid) return { ...item, userId: newUid };
      return item;
    });

    await saveQueue(updated);
  } catch (err: any) {
    throw err;
  }
}

async function syncCollection(
  collectionName: string,
  userId: string
): Promise<any[]> {
  const netState = await NetInfo.fetch();
  isOnline =
    netState.isConnected === true && netState.isInternetReachable !== false;

  if (!isOnline) {
    const cached = await getFromCache(collectionName, userId);
    return cached?.data || [];
  }

  try {
    const collRef = collection(db, "users", userId, collectionName);
    const snapshot = await getDocs(collRef);

    const data = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    await saveToCache(collectionName, userId, data);

    const cached = await getFromCache(collectionName, userId);
    return cached?.data || data;
  } catch {
    const cached = await getFromCache(collectionName, userId);
    return cached?.data || [];
  }
}

async function syncAllCollections(userId: string): Promise<void> {
  for (const collectionName of AUTO_SYNC_COLLECTIONS) {
    await syncCollection(collectionName, userId);
  }
}

const saveLocalData = async (
  collectionName: string,
  documentId: string,
  userId: string,
  data: Record<string, any>
): Promise<void> => {
  await addItemToCache(collectionName, userId, { id: documentId, ...data });
};

const getLocalData = async (
  collectionName: string,
  documentId: string,
  userId: string
): Promise<Record<string, any> | null> => {
  return getItemFromCache(collectionName, userId, documentId);
};

const getAllLocalData = async (
  collectionName: string,
  userId: string
): Promise<Record<string, any>[]> => {
  const cached = await getFromCache(collectionName, userId);
  return cached?.data || [];
};

const deleteLocalData = async (
  collectionName: string,
  documentId: string,
  userId: string
): Promise<void> => {
  await removeItemFromCache(collectionName, userId, documentId);
};

const updateCacheItem = updateItemInCache;
const deleteCacheItem = removeItemFromCache;
const addToCacheItem = addItemToCache;

async function hasPendingOperations(
  collectionName: string,
  documentId: string,
  userId: string
): Promise<boolean> {
  const queue = await getQueue();
  return queue.some(
    (op) =>
      op.collection === collectionName &&
      op.documentId === documentId &&
      op.userId === userId &&
      (op.status === "PENDING" || op.status === "FAILED")
  );
}

async function getExcludedIds(
  collectionName: string,
  userId: string
): Promise<Set<string>> {
  const queue = await getQueue();
  const excluded = new Set<string>();

  queue.forEach((op) => {
    if (op.collection !== collectionName || op.userId !== userId) return;
    if (op.status !== "PENDING" && op.status !== "FAILED") return;

    if (op.type === "DELETE") excluded.add(op.documentId);
  });

  return excluded;
}

async function getArchivedIds(
  collectionName: string,
  userId: string
): Promise<Set<string>> {
  const cached = await getFromCache(collectionName, userId);
  const archived = new Set<string>();

  if (cached?.data) {
    cached.data.forEach((item: any) => {
      if (item.isArchived === true || !!item.archivedAt) {
        archived.add(item.id);
      }
    });
  }

  const queue = await getQueue();
  queue.forEach((op) => {
    if (op.collection !== collectionName || op.userId !== userId) return;
    if (op.status !== "PENDING" && op.status !== "FAILED") return;
    if (op.type === "UPDATE" && op.payload?.isArchived === true) {
      archived.add(op.documentId);
    }
  });

  return archived;
}

async function getActiveItems(
  collectionName: string,
  userId: string
): Promise<Record<string, any>[]> {
  const cached = await getFromCache(collectionName, userId);
  if (!cached?.data) return [];

  const excludedIds = await getExcludedIds(collectionName, userId);
  const archivedIds = await getArchivedIds(collectionName, userId);

  return cached.data.filter((item: any) => {
    if (excludedIds.has(item.id)) return false;
    if (archivedIds.has(item.id)) return false;
    if (item.isArchived === true || !!item.archivedAt) return false;
    return true;
  });
}

async function getArchivedItems(
  collectionName: string,
  userId: string
): Promise<Record<string, any>[]> {
  const cached = await getFromCache(collectionName, userId);
  if (!cached?.data) return [];

  return cached.data.filter(
    (item: any) => item.isArchived === true || !!item.archivedAt
  );
}

function getIsOnline(): boolean {
  return isOnline;
}

async function checkConnection(): Promise<boolean> {
  const state = await NetInfo.fetch();
  isOnline = state.isConnected === true && state.isInternetReachable !== false;
  return isOnline;
}

export const syncQueueService = {
  initialize,
  destroy,

  addListener,

  getQueue,
  enqueue,
  getPendingCount,
  getStats,
  processQueue,
  retryFailed,
  clearQueue,
  forceSync,

  saveToCache,
  getFromCache,
  addItemToCache,
  updateItemInCache,
  removeItemFromCache,
  getItemFromCache,
  clearCache,
  clearAllUserCache,
  clearAllUserData,

  setCurrentValidUserId,
  getCurrentValidUserId,

  hasCachedData,
  debugCache,

  getActiveItems,
  getArchivedItems,
  getArchivedIds,

  syncCollection,
  syncAllCollections,

  saveLocalData,
  getLocalData,
  getAllLocalData,
  deleteLocalData,
  updateCacheItem,
  deleteCacheItem,
  addToCacheItem,

  hasPendingOperations,
  getExcludedIds,
  getIsOnline,
  checkConnection,
  migrateUserNamespace,
};

export default syncQueueService;
