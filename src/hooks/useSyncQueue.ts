// src/hooks/useSyncQueue.ts
// 🔄 Hook personalizado para usar el sistema de sincronización offline-first

import { useState, useEffect, useCallback } from "react";
import {
  syncQueueService,
  QueueItem,
  OperationType,
  SyncStats,
} from "../services/offline/SyncQueueService";
import { auth } from "../config/firebaseConfig";

// ============================================================
//                         TIPOS
// ============================================================

export interface UseSyncQueueReturn {
  // Estado
  queue: QueueItem[];
  stats: SyncStats;
  isOnline: boolean;
  isProcessing: boolean;
  pendingCount: number;

  // Acciones
  enqueue: (
    type: OperationType,
    collection: string,
    documentId: string,
    payload: Record<string, any>
  ) => Promise<string>;
  processQueue: () => Promise<{ success: number; failed: number }>;
  retryFailed: () => Promise<void>;
  clearQueue: () => Promise<void>;
  getLocalData: (
    collection: string,
    documentId: string
  ) => Promise<Record<string, any> | null>;
  getAllLocalData: (collection: string) => Promise<Record<string, any>[]>;

  // Operaciones de alto nivel
  createOffline: (
    collection: string,
    documentId: string,
    data: Record<string, any>
  ) => Promise<string>;
  updateOffline: (
    collection: string,
    documentId: string,
    data: Record<string, any>
  ) => Promise<string>;
  deleteOffline: (collection: string, documentId: string) => Promise<string>;
}

// ============================================================
//                         HOOK
// ============================================================

export function useSyncQueue(): UseSyncQueueReturn {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [stats, setStats] = useState<SyncStats>({
    pending: 0,
    failed: 0,
    total: 0,
    lastSync: null,
    isOnline: true,
    isProcessing: false,
  });

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      try {
        await syncQueueService.initialize();

        if (isMounted) {
          const initialQueue = await syncQueueService.getQueue();
          const initialStats = await syncQueueService.getStats();
          setQueue(initialQueue);
          setStats(initialStats);
        }
      } catch (error) {
        // Silently fail
      }
    };

    initialize();

    const unsubscribe = syncQueueService.addListener(
      (newQueue: QueueItem[]) => {
        if (isMounted) {
          setQueue(newQueue);
          syncQueueService.getStats().then((newStats: SyncStats) => {
            if (isMounted) {
              setStats(newStats);
            }
          });
        }
      }
    );

    const statsInterval = setInterval(async () => {
      if (isMounted) {
        const newStats = await syncQueueService.getStats();
        setStats(newStats);
      }
    }, 5000);

    return () => {
      isMounted = false;
      unsubscribe();
      clearInterval(statsInterval);
    };
  }, []);

  const enqueue = useCallback(
    async (
      type: OperationType,
      collection: string,
      documentId: string,
      payload: Record<string, any>
    ): Promise<string> => {
      const user = auth.currentUser;
      if (!user) {
        throw new Error("Usuario no autenticado");
      }

      return syncQueueService.enqueue(
        type,
        collection,
        documentId,
        user.uid,
        payload
      );
    },
    []
  );

  const processQueue = useCallback(async () => {
    return syncQueueService.processQueue();
  }, []);

  const retryFailed = useCallback(async (): Promise<void> => {
    return syncQueueService.retryFailed();
  }, []);

  const clearQueue = useCallback(async (): Promise<void> => {
    return syncQueueService.clearQueue();
  }, []);

  const getLocalData = useCallback(
    async (
      collection: string,
      documentId: string
    ): Promise<Record<string, any> | null> => {
      const user = auth.currentUser;
      if (!user) return null;

      return syncQueueService.getLocalData(collection, documentId, user.uid);
    },
    []
  );

  const getAllLocalData = useCallback(
    async (collection: string): Promise<Record<string, any>[]> => {
      const user = auth.currentUser;
      if (!user) return [];

      return syncQueueService.getAllLocalData(collection, user.uid);
    },
    []
  );

  const createOffline = useCallback(
    async (
      collection: string,
      documentId: string,
      data: Record<string, any>
    ): Promise<string> => {
      return enqueue("CREATE", collection, documentId, data);
    },
    [enqueue]
  );

  const updateOffline = useCallback(
    async (
      collection: string,
      documentId: string,
      data: Record<string, any>
    ): Promise<string> => {
      return enqueue("UPDATE", collection, documentId, data);
    },
    [enqueue]
  );

  const deleteOffline = useCallback(
    async (collection: string, documentId: string): Promise<string> => {
      return enqueue("DELETE", collection, documentId, { _deleted: true });
    },
    [enqueue]
  );

  const isOnline = stats.isOnline;
  const isProcessing = stats.isProcessing;
  const pendingCount = stats.pending;

  return {
    queue,
    stats,
    isOnline,
    isProcessing,
    pendingCount,
    enqueue,
    processQueue,
    retryFailed,
    clearQueue,
    getLocalData,
    getAllLocalData,
    createOffline,
    updateOffline,
    deleteOffline,
  };
}

export default useSyncQueue;
