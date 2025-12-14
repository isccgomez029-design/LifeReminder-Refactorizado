// src/hooks/useOfflineSync.ts
// Hook simplificado para sincronización offline
// NO requiere cambios visuales en las pantallas

import { useEffect, useState, useCallback } from "react";
import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { db } from "../config/firebaseConfig";
import {
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  Timestamp,
} from "firebase/firestore";

const QUEUE_KEY = "@lifereminder/offline_queue";

export interface QueuedOperation {
  id: string;
  type: "CREATE" | "UPDATE" | "DELETE";
  collectionPath: string;
  docId: string;
  data?: any;
  timestamp: number;
}

// Guardar operación en cola
async function enqueueOperation(
  op: Omit<QueuedOperation, "id" | "timestamp">
): Promise<void> {
  try {
    const queue = await getQueue();
    const newOp: QueuedOperation = {
      ...op,
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };
    queue.push(newOp);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Silently fail
  }
}

// Obtener cola
async function getQueue(): Promise<QueuedOperation[]> {
  try {
    const data = await AsyncStorage.getItem(QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// Procesar cola cuando hay conexión
async function processQueue(): Promise<void> {
  const queue = await getQueue();
  if (queue.length === 0) return;

  const failedOps: QueuedOperation[] = [];

  for (const op of queue) {
    try {
      if (op.type === "UPDATE" && op.data) {
        const docRef = doc(db, op.collectionPath, op.docId);
        // Convertir fechas a Timestamps
        const processedData = { ...op.data };
        for (const key of Object.keys(processedData)) {
          if (processedData[key] instanceof Date) {
            processedData[key] = Timestamp.fromDate(processedData[key]);
          }
        }
        await updateDoc(docRef, processedData);
      } else if (op.type === "DELETE") {
        const docRef = doc(db, op.collectionPath, op.docId);
        await deleteDoc(docRef);
      } else if (op.type === "CREATE" && op.data) {
        const collRef = collection(db, op.collectionPath);
        await addDoc(collRef, op.data);
      }
    } catch {
      failedOps.push(op);
    }
  }

  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(failedOps));
}

// Hook principal
export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online =
        state.isConnected === true && state.isInternetReachable !== false;
      setIsOnline(online);

      // Procesar cola cuando se reconecta
      if (online) {
        processQueue().then(() => {
          getQueue().then((q) => setPendingCount(q.length));
        });
      }
    });

    // Cargar pendientes iniciales
    getQueue().then((q) => setPendingCount(q.length));

    return () => unsubscribe();
  }, []);

  // Función para ejecutar operación (online directo, offline encolar)
  const executeOperation = useCallback(
    async (
      type: "CREATE" | "UPDATE" | "DELETE",
      collectionPath: string,
      docId: string,
      data?: any
    ): Promise<boolean> => {
      if (isOnline) {
        // Ejecutar directamente
        try {
          if (type === "UPDATE" && data) {
            const docRef = doc(db, collectionPath, docId);
            await updateDoc(docRef, data);
          } else if (type === "DELETE") {
            const docRef = doc(db, collectionPath, docId);
            await deleteDoc(docRef);
          } else if (type === "CREATE" && data) {
            const collRef = collection(db, collectionPath);
            await addDoc(collRef, data);
          }
          return true;
        } catch {
          // Si falla, encolar
          await enqueueOperation({ type, collectionPath, docId, data });
          const q = await getQueue();
          setPendingCount(q.length);
          return false;
        }
      } else {
        // Encolar para después
        await enqueueOperation({ type, collectionPath, docId, data });
        const q = await getQueue();
        setPendingCount(q.length);
        return false;
      }
    },
    [isOnline]
  );

  // Forzar sincronización
  const syncNow = useCallback(async () => {
    if (!isOnline) return;
    await processQueue();
    const q = await getQueue();
    setPendingCount(q.length);
  }, [isOnline]);

  return {
    isOnline,
    pendingCount,
    executeOperation,
    syncNow,
  };
}

export default useOfflineSync;
