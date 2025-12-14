// src/hooks/useOfflineData.ts
// Hook para manejar datos con soporte offline + caché

import { useState, useEffect, useCallback, useRef } from "react";
import { db, auth } from "../config/firebaseConfig";
import {
  collection,
  query,
  orderBy as firestoreOrderBy,
  onSnapshot,
  QueryConstraint,
  Timestamp,
  Unsubscribe,
  OrderByDirection,
} from "firebase/firestore";
import NetInfo from "@react-native-community/netinfo";
import { syncQueueService } from "../services/offline/SyncQueueService";

// ============================================================
//                         TIPOS
// ============================================================

interface OrderByConfig {
  field: string;
  direction?: OrderByDirection;
}

export interface UseOfflineDataOptions<T> {
  collection: string; // Nombre de la colección
  userId?: string | null;
  constraints?: QueryConstraint[];
  orderBy?: OrderByConfig;
  transform?: (data: any) => T;
  enabled?: boolean;
  filterFn?: (item: T) => boolean;
}

export interface UseOfflineDataResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
  isFromCache: boolean;
  isOnline: boolean;
  pendingChanges: number;
  refresh: () => Promise<void>;
  updateItem: (docId: string, updates: Partial<T>) => Promise<boolean>;
  deleteItem: (docId: string) => Promise<boolean>;
  addItem: (item: Omit<T, "id">) => Promise<string | null>;
}

// ============================================================
//                         HELPERS
// ============================================================

function parseTimestamps(obj: any): any {
  if (!obj) return obj;

  if (obj instanceof Timestamp) {
    return obj.toDate();
  }

  if (
    obj &&
    typeof obj === "object" &&
    "seconds" in obj &&
    "nanoseconds" in obj
  ) {
    return new Date(obj.seconds * 1000);
  }

  if (Array.isArray(obj)) {
    return obj.map(parseTimestamps);
  }

  if (typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = parseTimestamps(value);
    }
    return result;
  }

  return obj;
}

// ============================================================
//                         HOOK
// ============================================================

export function useOfflineData<T extends { id: string }>(
  options: UseOfflineDataOptions<T>
): UseOfflineDataResult<T> {
  const {
    collection: collectionName,
    userId: providedUserId,
    constraints = [],
    orderBy: orderByConfig,
    transform,
    enabled = true,
    filterFn,
  } = options;

  const userId = providedUserId ?? auth.currentUser?.uid ?? null;

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isFromCache, setIsFromCache] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingChanges, setPendingChanges] = useState(0);

  const unsubscribeRef = useRef<Unsubscribe | null>(null);

  const loadFromCache = useCallback(async () => {
    if (!userId) return false;

    try {
      const cached = await syncQueueService.getFromCache<T>(
        collectionName,
        userId
      );
      if (cached && cached.data.length > 0) {
        let processedData = cached.data.map((item) => {
          const parsed = parseTimestamps(item);
          return transform ? transform(parsed) : parsed;
        });

        if (filterFn) {
          processedData = processedData.filter(filterFn);
        }

        setData(processedData);
        setIsFromCache(true);
        return true;
      }
    } catch {
      // Silently fail
    }
    return false;
  }, [collectionName, userId, transform, filterFn]);

  const saveToCache = useCallback(
    async (items: T[]) => {
      if (!userId) return;
      try {
        await syncQueueService.saveToCache(collectionName, userId, items);
      } catch {
        // Silently fail
      }
    },
    [collectionName, userId]
  );

  const subscribeToFirestore = useCallback(() => {
    if (!userId || !enabled) return;

    const collectionPath = `users/${userId}/${collectionName}`;
    const collRef = collection(db, collectionPath);

    const queryConstraints: QueryConstraint[] = [...constraints];
    if (orderByConfig) {
      queryConstraints.push(
        firestoreOrderBy(orderByConfig.field, orderByConfig.direction || "desc")
      );
    }

    const q = query(collRef, ...queryConstraints);

    unsubscribeRef.current = onSnapshot(
      q,
      (snapshot) => {
        let items: T[] = [];

        snapshot.forEach((docSnap) => {
          const rawData = docSnap.data();
          const parsed = parseTimestamps(rawData);
          let item = { id: docSnap.id, ...parsed } as T;

          if (transform) {
            item = transform(item);
          }

          items.push(item);
        });

        if (filterFn) {
          items = items.filter(filterFn);
        }

        setData(items);
        setIsFromCache(false);
        setLoading(false);
        setError(null);

        saveToCache(items);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
  }, [
    userId,
    collectionName,
    constraints,
    orderByConfig,
    transform,
    saveToCache,
    enabled,
    filterFn,
  ]);

  useEffect(() => {
    if (!userId || !enabled) {
      setData([]);
      setLoading(false);
      return;
    }

    let isMounted = true;

    const init = async () => {
      setLoading(true);

      const hasCached = await loadFromCache();
      if (hasCached && isMounted) {
        setLoading(false);
      }

      const netState = await NetInfo.fetch();
      const online =
        netState.isConnected === true && netState.isInternetReachable !== false;
      setIsOnline(online);

      if (online) {
        subscribeToFirestore();
      } else if (isMounted) {
        setLoading(false);
      }
    };

    init();

    const unsubscribeNet = NetInfo.addEventListener((state) => {
      const online =
        state.isConnected === true && state.isInternetReachable !== false;
      setIsOnline(online);

      if (online && !unsubscribeRef.current) {
        subscribeToFirestore();
      }
    });

    return () => {
      isMounted = false;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      unsubscribeNet();
    };
  }, [userId, collectionName, enabled, loadFromCache, subscribeToFirestore]);

  useEffect(() => {
    const updatePending = async () => {
      const count = await syncQueueService.getPendingCount();
      setPendingChanges(count);
    };

    updatePending();
    const interval = setInterval(updatePending, 3000);
    return () => clearInterval(interval);
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;

    if (isOnline) {
      await syncQueueService.processQueue();
      setPendingChanges(await syncQueueService.getPendingCount());

      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      subscribeToFirestore();
    } else {
      await loadFromCache();
    }
  }, [userId, isOnline, subscribeToFirestore, loadFromCache]);

  const updateItem = useCallback(
    async (docId: string, updates: Partial<T>): Promise<boolean> => {
      if (!userId) return false;

      setData((prev) =>
        prev.map((item) => (item.id === docId ? { ...item, ...updates } : item))
      );

      await syncQueueService.updateCacheItem(
        collectionName,
        userId,
        docId,
        updates
      );
      await syncQueueService.enqueue(
        "UPDATE",
        collectionName,
        docId,
        userId,
        updates as Record<string, any>
      );
      setPendingChanges(await syncQueueService.getPendingCount());

      return true;
    },
    [userId, collectionName]
  );

  const deleteItem = useCallback(
    async (docId: string): Promise<boolean> => {
      if (!userId) return false;

      setData((prev) => prev.filter((item) => item.id !== docId));
      await syncQueueService.deleteCacheItem(collectionName, userId, docId);
      await syncQueueService.enqueue(
        "DELETE",
        collectionName,
        docId,
        userId,
        {}
      );
      setPendingChanges(await syncQueueService.getPendingCount());

      return true;
    },
    [userId, collectionName]
  );

  const addItem = useCallback(
    
    async (item: Omit<T, "id">): Promise<string | null> => {
      if (!userId) return null;

      const tempId = `temp_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const newItem = { ...item, id: tempId } as T;

      setData((prev) => [...prev, newItem]);
      await syncQueueService.addToCacheItem(collectionName, userId, newItem);
      await syncQueueService.enqueue(
        "CREATE",
        collectionName,
        tempId,
        userId,
        item as Record<string, any>
      );
      setPendingChanges(await syncQueueService.getPendingCount());

      return tempId;
    },
    [userId, collectionName]
  );

  return {
    data,
    loading,
    error,
    isFromCache,
    isOnline,
    pendingChanges,
    refresh,
    updateItem,
    deleteItem,
    addItem,
  };
}

export default useOfflineData;
