// src/services/offline/SyncQueueService.ts
// 🔄 Servicio ÚNICO de sincronización offline-first
// ✅ CORREGIDO: Preserva items archivados en cache

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

// ============================================================
//                         TIPOS
// ============================================================

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

// ============================================================
//                    ESTADO INTERNO
// ============================================================

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

// ============================================================
//                    UTILIDADES
// ============================================================

function log(message: string, data?: any) {
  console.log(`[SyncQueue] ${message}`, data ?? "");
}

function getCacheKey(collectionName: string, userId: string): string {
  return `${STORAGE_PREFIX}/${userId}/${collectionName}`;
}

// ============================================================
//                    INICIALIZACIÓN
// ============================================================

async function initialize(): Promise<void> {
  if (isInitialized) {
    log("⚠️ Ya inicializado");
    return;
  }

  if (netInfoUnsubscribe) {
    netInfoUnsubscribe();
  }

  netInfoUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const wasOffline = !isOnline;
    isOnline =
      state.isConnected === true && state.isInternetReachable !== false;

    log(`📶 Red: ${isOnline ? "Online" : "Offline"}`);

    if (isOnline && wasOffline) {
      log("🔄 Reconectado, procesando cola...");
      setTimeout(() => processQueue(), 1500);
    }
  });

  const state = await NetInfo.fetch();
  isOnline = state.isConnected === true && state.isInternetReachable !== false;

  log(`📶 Estado inicial: ${isOnline ? "Online" : "Offline"}`);

  const queue = await getQueue();
  const pendingCount = queue.filter(
    (item) => item.status === "PENDING" || item.status === "FAILED"
  ).length;

  if (pendingCount > 0) {
    log(`📋 ${pendingCount} operaciones pendientes`);
    if (isOnline) {
      setTimeout(() => processQueue(), 2000);
    }
  }

  isInitialized = true;
  log("✅ Inicializado");
}

function destroy(): void {
  if (netInfoUnsubscribe) {
    netInfoUnsubscribe();
    netInfoUnsubscribe = null;
  }
  listeners = [];
  isInitialized = false;
  log("🛑 Destruido");
}

// ============================================================
//                    QUEUE LISTENERS
// ============================================================

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

// ============================================================
//                    QUEUE MANAGEMENT
// ============================================================

async function getQueue(): Promise<QueueItem[]> {
  try {
    const data = await AsyncStorage.getItem(QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    log("❌ Error leyendo cola:", error);
    return [];
  }
}

async function saveQueue(queue: QueueItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    await notifyListeners();
  } catch (error) {
    log("❌ Error guardando cola:", error);
  }
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

  log(`📝 Encolado: ${type} ${collectionName}/${documentId}`);

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

// ============================================================
//                    PROCESS QUEUE
// ============================================================

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
  if (isProcessing) {
    log("⏳ Ya procesando");
    return { success: 0, failed: 0 };
  }

  const netState = await NetInfo.fetch();
  isOnline =
    netState.isConnected === true && netState.isInternetReachable !== false;

  if (!isOnline) {
    log("📴 Sin conexión");
    return { success: 0, failed: 0 };
  }

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

  log(`🔄 Procesando ${pendingItems.length} operaciones...`);

  let successCount = 0;
  let failedCount = 0;
  let currentQueue = [...queue];

  for (const item of pendingItems) {
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
        log(`✅ CREATE: ${item.documentId}`);
        successCount++;
      } else if (item.type === "UPDATE") {
        const preparedData = prepareDataForFirestore(item.payload);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          await updateDoc(docRef, preparedData);
          log(`✅ UPDATE: ${item.documentId}`);
        } else {
          await setDoc(docRef, preparedData);
          log(`✅ UPDATE→CREATE: ${item.documentId}`);
        }
        successCount++;
      } else if (item.type === "DELETE") {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          await deleteDoc(docRef);
          log(`✅ DELETE: ${item.documentId}`);
        } else {
          log(`⚠️ DELETE omitido: ${item.documentId}`);
        }
        successCount++;
      }

      currentQueue = currentQueue.filter((q) => q.id !== item.id);
      await saveQueue(currentQueue);
    } catch (error: any) {
      const itemIndex = currentQueue.findIndex((q) => q.id === item.id);
      if (itemIndex >= 0) {
        currentQueue[itemIndex].status = "FAILED";
        currentQueue[itemIndex].retryCount++;
        currentQueue[itemIndex].error = error?.message || "Error";

        if (currentQueue[itemIndex].retryCount >= 5) {
          log(`❌ Eliminando fallida: ${item.documentId}`);
          currentQueue = currentQueue.filter((q) => q.id !== item.id);
        }

        await saveQueue(currentQueue);
      }

      failedCount++;
      log(`❌ Error ${item.type} ${item.documentId}:`, error?.message);
    }
  }

  lastSyncTime = new Date();
  isProcessing = false;
  await notifyListeners();

  log(`✅ Resultado: ${successCount} ok, ${failedCount} error`);
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
  log("🗑️ Cola limpiada");
}

async function forceSync(): Promise<{ success: number; failed: number }> {
  log("🔄 Forzando sincronización...");
  return processQueue();
}

// ============================================================
//              CACHE MANAGEMENT (CORREGIDO)
// ============================================================

/**
 * ✅ CORREGIDO: Guarda datos en cache PRESERVANDO items archivados
 */
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

    // ✅ CAMPOS QUE DEBEN PRESERVARSE LOCALMENTE
    const PRESERVE_FIELDS = [
      "currentAlarmId",
      "scheduledAlarmIds",
      "snoozeCount",
      "snoozedUntil",
      "lastSnoozeAt",
    ];

    // Procesar datos remotos
    for (const item of dataWithIds) {
      const pendingOp = pendingMap.get(item.id);

      // Solo excluir DELETE pendientes
      if (pendingOp?.type === "DELETE") {
        processedIds.add(item.id);
        continue;
      }

      // ✅ NUEVO: Obtener datos locales actuales del item
      const localItem = currentData.find((d: any) => d.id === item.id);

      let mergedItem = { ...item };

      // Si hay operación UPDATE pendiente, aplicar cambios
      if (pendingOp?.type === "UPDATE") {
        mergedItem = { ...mergedItem, ...pendingOp.payload };
      }

      // ✅ CRÍTICO: Preservar campos de alarma locales si existen
      // Esto evita que Firestore sobrescriba alarmas programadas localmente
      if (localItem) {
        for (const field of PRESERVE_FIELDS) {
          // Si el campo existe localmente y NO viene en el UPDATE remoto
          if (
            localItem[field] !== undefined &&
            localItem[field] !== null &&
            item[field] === undefined
          ) {
            mergedItem[field] = localItem[field];
          }
        }
      }

      finalData.push(mergedItem);
      processedIds.add(item.id);
    }

    // Agregar items CREATE pendientes
    for (const [docId, op] of pendingMap) {
      if (op.type === "CREATE" && !processedIds.has(docId)) {
        finalData.push({ id: docId, ...op.payload });
        processedIds.add(docId);
      }
    }

    // Preservar items archivados del cache actual
    for (const item of currentData) {
      const itemId = item.id as string;
      if (!processedIds.has(itemId)) {
        if (
          item.isArchived === true ||
          !!item.archivedAt ||
          itemId?.startsWith("temp_")
        ) {
          finalData.push(item);
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

    log(
      `💾 Cache: ${collectionName} (${finalData.length} items, alarmas preservadas)`
    );
  } catch (error) {
    log(`❌ Error guardando cache:`, error);
  }
}
async function getFromCache<T = Record<string, any>>(
  collectionName: string,
  userId: string
): Promise<{ data: T[]; timestamp: number } | null> {
  try {
    const key = getCacheKey(collectionName, userId);
    const cached = await AsyncStorage.getItem(key);

    if (cached) {
      const parsed = JSON.parse(cached) as CachedCollection;
      return { data: parsed.data as T[], timestamp: parsed.cachedAt };
    }

    return null;
  } catch (error) {
    log(`❌ Error leyendo cache:`, error);
    return null;
  }
}

async function addItemToCache(
  collectionName: string,
  userId: string,
  item: Record<string, any>
): Promise<void> {
  try {
    if (!item.id) {
      log(`⚠️ Item sin id`);
      return;
    }

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

    log(`➕ Agregado: ${collectionName}/${item.id}`);
  } catch (error) {
    log(`❌ Error agregando:`, error);
  }
}

/**
 * ✅ CORREGIDO: Actualiza un item en cache de forma robusta
 */
async function updateItemInCache(
  collectionName: string,
  userId: string,
  docId: string,
  updates: Record<string, any>
): Promise<void> {
  try {
    const cached = await getFromCache(collectionName, userId);

    if (!cached || !cached.data) {
      // Si no hay cache, crear uno con el item
      const key = getCacheKey(collectionName, userId);
      const cacheData: CachedCollection = {
        data: [{ id: docId, ...updates }],
        cachedAt: Date.now(),
        lastSyncedAt: Date.now(),
      };
      await AsyncStorage.setItem(key, JSON.stringify(cacheData));
      log(`✏️ Cache creado con: ${collectionName}/${docId}`);
      return;
    }

    const itemIndex = cached.data.findIndex((item: any) => item.id === docId);

    let updatedData: Array<Record<string, any>>;
    if (itemIndex >= 0) {
      // ✅ Actualizar item existente
      updatedData = [...cached.data];
      updatedData[itemIndex] = { ...updatedData[itemIndex], ...updates };
      log(`✏️ Actualizado existente: ${collectionName}/${docId}`);
    } else {
      // ✅ Agregar nuevo item si no existe
      updatedData = [...cached.data, { id: docId, ...updates }];
      log(`✏️ Agregado nuevo: ${collectionName}/${docId}`);
    }

    const key = getCacheKey(collectionName, userId);
    const cacheData: CachedCollection = {
      data: updatedData,
      cachedAt: Date.now(),
      lastSyncedAt: Date.now(),
    };
    await AsyncStorage.setItem(key, JSON.stringify(cacheData));
  } catch (error) {
    log(`❌ Error actualizando cache:`, error);
  }
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

    log(`🗑️ Eliminado: ${collectionName}/${docId}`);
  } catch (error) {
    log(`❌ Error eliminando:`, error);
  }
}

async function getItemFromCache(
  collectionName: string,
  userId: string,
  docId: string
): Promise<Record<string, any> | null> {
  try {
    const cached = await getFromCache(collectionName, userId);
    if (!cached) return null;

    return cached.data.find((item: any) => item.id === docId) || null;
  } catch (error) {
    log(`❌ Error obteniendo item:`, error);
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
    log(`🗑️ Cache limpiado: ${collectionName}`);
  } catch (error) {
    log(`❌ Error:`, error);
  }
}

async function clearAllUserCache(userId: string): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const userCacheKeys = allKeys.filter(
      (key) => key.startsWith(STORAGE_PREFIX) && key.includes(userId)
    );

    if (userCacheKeys.length > 0) {
      await AsyncStorage.multiRemove(userCacheKeys);
      log(`🗑️ Cache del usuario limpiado (${userCacheKeys.length} keys)`);
    }
  } catch (error) {
    log(`❌ Error:`, error);
  }
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
    log(`🔍 Debug Cache para ${userId}:`);

    for (const collectionName of AUTO_SYNC_COLLECTIONS) {
      const cached = await getFromCache(collectionName, userId);
      if (cached && cached.data.length > 0) {
        const archivedCount = cached.data.filter(
          (item: any) => item.isArchived === true || !!item.archivedAt
        ).length;
        const activeCount = cached.data.length - archivedCount;
        log(
          `   ${collectionName}: ${cached.data.length} items (${activeCount} activos, ${archivedCount} archivados)`
        );
      } else {
        log(`   ${collectionName}: vacío`);
      }
    }

    const queue = await getQueue();
    const userQueue = queue.filter((op) => op.userId === userId);
    log(`   Cola: ${userQueue.length} operaciones`);
  } catch (error) {
    log(`❌ Error debug:`, error);
  }
}

// ============================================================
//    SINCRONIZACIÓN (reemplaza OfflineDataManager)
// ============================================================

/**
 * Sincroniza una colección desde Firebase
 */
async function syncCollection(
  collectionName: string,
  userId: string
): Promise<any[]> {
  // Verificar conexión
  const netState = await NetInfo.fetch();
  isOnline =
    netState.isConnected === true && netState.isInternetReachable !== false;

  if (!isOnline) {
    log(`📴 Sin conexión, retornando cache para ${collectionName}`);
    const cached = await getFromCache(collectionName, userId);
    return cached?.data || [];
  }

  try {
    log(`📥 Sincronizando: ${collectionName}`);

    const collRef = collection(db, "users", userId, collectionName);
    const snapshot = await getDocs(collRef);

    const data = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // ✅ Guardar en cache (ahora preserva operaciones pendientes Y archivados)
    await saveToCache(collectionName, userId, data);

    log(`✅ ${collectionName}: ${data.length} docs`);

    // Retornar datos del cache para incluir operaciones pendientes
    const cached = await getFromCache(collectionName, userId);
    return cached?.data || data;
  } catch (error) {
    log(`❌ Error sync ${collectionName}:`, error);
    const cached = await getFromCache(collectionName, userId);
    return cached?.data || [];
  }
}

/**
 * Sincroniza todas las colecciones del usuario
 */
async function syncAllCollections(userId: string): Promise<void> {
  log("🔄 Sincronizando todas las colecciones...");

  for (const collectionName of AUTO_SYNC_COLLECTIONS) {
    await syncCollection(collectionName, userId);
  }

  log("✅ Sincronización completa");
}

// ============================================================
//    ALIASES PARA COMPATIBILIDAD
// ============================================================

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

// ============================================================
//                    UTILIDADES
// ============================================================

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

    if (op.type === "DELETE") {
      excluded.add(op.documentId);
    }
    // ✅ CORREGIDO: NO excluir archivados de la lista general
    // Solo excluir de la vista principal, no del cache
  });

  return excluded;
}

/**
 * ✅ NUEVO: Obtener IDs archivados para filtrar en vistas
 */
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

  // También incluir los que tienen UPDATE pendiente con isArchived
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

/**
 * ✅ NUEVO: Obtener solo items activos (no archivados)
 */
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

/**
 * ✅ NUEVO: Obtener solo items archivados
 */
async function getArchivedItems(
  collectionName: string,
  userId: string
): Promise<Record<string, any>[]> {
  const cached = await getFromCache(collectionName, userId);
  if (!cached?.data) return [];

  return cached.data.filter((item: any) => {
    return item.isArchived === true || !!item.archivedAt;
  });
}
function getIsOnline(): boolean {
  return isOnline;
}

async function checkConnection(): Promise<boolean> {
  const state = await NetInfo.fetch();
  isOnline = state.isConnected === true && state.isInternetReachable !== false;
  return isOnline;
}

// ============================================================
//                    EXPORT
// ============================================================

export const syncQueueService = {
  // Inicialización
  initialize,
  destroy,

  // Listeners
  addListener,

  // Queue
  getQueue,
  enqueue,
  getPendingCount,
  getStats,
  processQueue,
  retryFailed,
  clearQueue,
  forceSync,

  // Cache
  saveToCache,
  getFromCache,
  addItemToCache,
  updateItemInCache,
  removeItemFromCache,
  getItemFromCache,
  clearCache,
  clearAllUserCache,
  hasCachedData,
  debugCache,

  // ✅ NUEVO: Funciones para obtener items filtrados
  getActiveItems,
  getArchivedItems,
  getArchivedIds,

  // Sincronización
  syncCollection,
  syncAllCollections,

  // Aliases
  saveLocalData,
  getLocalData,
  getAllLocalData,
  deleteLocalData,
  updateCacheItem,
  deleteCacheItem,
  addToCacheItem,

  // Utilidades
  hasPendingOperations,
  getExcludedIds,
  getIsOnline,
  checkConnection,
};

export default syncQueueService;
