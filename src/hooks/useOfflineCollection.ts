// src/hooks/useOfflineCollection.ts
// 🔄 Hook para manejar colecciones con soporte offline completo
// ✅ MEJORADO: Espera a que auth esté listo antes de cargar datos

import { useState, useEffect, useCallback, useRef } from "react";
import { syncQueueService } from "../services/offline/SyncQueueService";
import { offlineAuthService } from "../services/offline/OfflineAuthService";
import { db } from "../config/firebaseConfig";
import { collection, query, onSnapshot, Unsubscribe } from "firebase/firestore";
import NetInfo from "@react-native-community/netinfo";

export interface UseOfflineCollectionOptions {
  collection: string;
  realtime?: boolean;
  filter?: (item: any) => boolean;
  sort?: (a: any, b: any) => number;
  transform?: (item: any) => any;
  userId?: string;
}

export interface UseOfflineCollectionResult<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  isOnline: boolean;
  isFromCache: boolean;
  refresh: () => Promise<void>;
  create: (data: Partial<T>) => Promise<string>;
  update: (id: string, data: Partial<T>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  getById: (id: string) => T | undefined;
}

/**
 * Obtiene el userId de forma robusta, esperando si es necesario
 */
async function getAuthenticatedUserId(
  customUserId?: string
): Promise<string | null> {
  // Si se proporciona userId personalizado, usarlo
  if (customUserId) {
    return customUserId;
  }

  // Intentar obtener del servicio
  let uid = offlineAuthService.getCurrentUid();

  if (uid) {
    return uid;
  }

  // Si no hay uid, puede que auth aún no esté listo
  // Esperar un poco y reintentar (máximo 3 intentos)
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    uid = offlineAuthService.getCurrentUid();
    if (uid) {
      console.log(
        `[useOfflineCollection] UID obtenido después de ${i + 1} intentos`
      );
      return uid;
    }
  }

  // Último intento: leer directamente del cache
  const cachedUser = await offlineAuthService.getCachedUser();
  if (cachedUser?.uid) {
    console.log(`[useOfflineCollection] UID obtenido del cache directo`);
    return cachedUser.uid;
  }

  return null;
}

export function useOfflineCollection<T extends { id: string }>(
  options: UseOfflineCollectionOptions
): UseOfflineCollectionResult<T> {
  const {
    collection: collectionName,
    realtime = true,
    filter,
    sort,
    transform,
    userId: customUserId,
  } = options;

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [isFromCache, setIsFromCache] = useState(false);

  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const mountedRef = useRef(true);
  const loadingRef = useRef(false); // Evitar cargas múltiples

  // Procesar datos (filtrar, ordenar, transformar)
  const processData = useCallback(
    (rawData: any[]): T[] => {
      if (!rawData || !Array.isArray(rawData)) {
        return [];
      }

      let processed = rawData;

      if (filter) {
        processed = processed.filter(filter);
      }

      if (transform) {
        processed = processed.map(transform);
      }

      if (sort) {
        processed = [...processed].sort(sort);
      }

      return processed as T[];
    },
    [filter, sort, transform]
  );

  // Cargar datos
  const loadData = useCallback(async () => {
    // Evitar cargas múltiples simultáneas
    if (loadingRef.current) {
      console.log(
        `[useOfflineCollection] ${collectionName}: ya cargando, ignorando`
      );
      return;
    }

    loadingRef.current = true;

    try {
      // ✅ PASO 0: Obtener userId de forma robusta
      const userId = await getAuthenticatedUserId(customUserId);

      if (!userId) {
        console.log(
          `[useOfflineCollection] ${collectionName}: Sin usuario autenticado`
        );
        if (mountedRef.current) {
          setError("Usuario no autenticado");
          setLoading(false);
        }
        loadingRef.current = false;
        return;
      }

      console.log(
        `[useOfflineCollection] Cargando ${collectionName} para ${userId.substring(
          0,
          8
        )}...`
      );

      // ✅ PASO 1: SIEMPRE cargar desde cache primero
      const cached = await syncQueueService.getFromCache<any>(
        collectionName,
        userId
      );

      if (cached && cached.data && cached.data.length > 0) {
        console.log(
          `[useOfflineCollection] ${collectionName} cache: ${cached.data.length} items`
        );
        const processed = processData(cached.data);

        if (mountedRef.current) {
          setData(processed);
          setIsFromCache(true);
          setLoading(false);
        }
      } else {
        console.log(`[useOfflineCollection] ${collectionName} cache: vacío`);
      }

      // ✅ PASO 2: Verificar conexión
      const netState = await NetInfo.fetch();
      const online =
        netState.isConnected === true && netState.isInternetReachable !== false;

      if (mountedRef.current) {
        setIsOnline(online);
      }

      if (!online) {
        console.log(
          `[useOfflineCollection] ${collectionName}: Sin conexión, usando solo cache`
        );
        if (mountedRef.current) {
          setLoading(false);
        }
        loadingRef.current = false;
        return;
      }

      // ✅ PASO 3: Si hay conexión y realtime, suscribirse a Firebase
      if (realtime) {
        console.log(
          `[useOfflineCollection] ${collectionName}: Suscribiendo a Firebase...`
        );

        // Cancelar suscripción anterior si existe
        if (unsubscribeRef.current) {
          unsubscribeRef.current();
        }

        const collRef = collection(db, "users", userId, collectionName);
        const q = query(collRef);

        unsubscribeRef.current = onSnapshot(
          q,
          async (snapshot) => {
            const items = snapshot.docs.map((doc) => ({
              id: doc.id,
              ...doc.data(),
            }));

            console.log(
              `[useOfflineCollection] ${collectionName} Firebase: ${items.length} items`
            );

            // Guardar en cache (respeta operaciones pendientes)
            await syncQueueService.saveToCache(collectionName, userId, items);

            // Recargar desde cache para obtener datos fusionados
            const merged = await syncQueueService.getFromCache<any>(
              collectionName,
              userId
            );

            if (merged && mountedRef.current) {
              const processed = processData(merged.data);
              setData(processed);
              setIsFromCache(false);
              setLoading(false);
            }
          },
          (err) => {
            console.log(
              `[useOfflineCollection] ${collectionName} Error Firebase:`,
              err.message
            );
            // Ya tenemos datos del cache, no hacer nada más
            if (mountedRef.current) {
              setLoading(false);
            }
          }
        );
      } else {
        // Sin realtime, solo sincronizar una vez
        const synced = await syncQueueService.syncCollection(
          collectionName,
          userId
        );

        if (mountedRef.current) {
          const processed = processData(synced);
          setData(processed);
          setIsFromCache(false);
          setLoading(false);
        }
      }
    } catch (err: any) {
      console.error(`[useOfflineCollection] ${collectionName} Error:`, err);
      if (mountedRef.current) {
        setError(err.message || "Error cargando datos");
        setLoading(false);
      }
    } finally {
      loadingRef.current = false;
    }
  }, [collectionName, customUserId, processData, realtime]);

  // Inicializar
  useEffect(() => {
    mountedRef.current = true;

    // Pequeño delay para asegurar que auth esté listo
    const timer = setTimeout(() => {
      loadData();
    }, 100);

    // Escuchar cambios de conectividad
    const netUnsub = NetInfo.addEventListener((state) => {
      const online =
        state.isConnected === true && state.isInternetReachable !== false;
      const wasOffline = !isOnline;

      if (mountedRef.current) {
        setIsOnline(online);
      }

      // Si reconectamos, recargar datos
      if (online && wasOffline) {
        console.log(
          `[useOfflineCollection] ${collectionName}: Reconectado, recargando...`
        );
        loadData();
      }
    });

    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      netUnsub();
    };
  }, [loadData, collectionName]);

  // Refrescar datos
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    const userId = await getAuthenticatedUserId(customUserId);
    if (userId) {
      await syncQueueService.syncCollection(collectionName, userId);
      const cached = await syncQueueService.getFromCache<any>(
        collectionName,
        userId
      );
      if (cached && mountedRef.current) {
        setData(processData(cached.data));
      }
    }

    setLoading(false);
  }, [collectionName, customUserId, processData]);

  // Crear documento
  const create = useCallback(
    async (itemData: Partial<T>): Promise<string> => {
      const userId = await getAuthenticatedUserId(customUserId);
      if (!userId) throw new Error("Usuario no autenticado");

      const tempId = `temp_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      const newData = {
        ...itemData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await syncQueueService.enqueue(
        "CREATE",
        collectionName,
        tempId,
        userId,
        newData
      );

      return tempId;
    },
    [collectionName, customUserId]
  );

  // Actualizar documento
  const update = useCallback(
    async (id: string, itemData: Partial<T>): Promise<void> => {
      const userId = await getAuthenticatedUserId(customUserId);
      if (!userId) throw new Error("Usuario no autenticado");

      const updateData = {
        ...itemData,
        updatedAt: new Date().toISOString(),
      };

      await syncQueueService.enqueue(
        "UPDATE",
        collectionName,
        id,
        userId,
        updateData
      );
    },
    [collectionName, customUserId]
  );

  // Eliminar documento
  const remove = useCallback(
    async (id: string): Promise<void> => {
      const userId = await getAuthenticatedUserId(customUserId);
      if (!userId) throw new Error("Usuario no autenticado");

      await syncQueueService.enqueue("DELETE", collectionName, id, userId, {});
    },
    [collectionName, customUserId]
  );

  // Obtener por ID
  const getById = useCallback(
    (id: string): T | undefined => {
      return data.find((item) => item.id === id);
    },
    [data]
  );

  return {
    data,
    loading,
    error,
    isOnline,
    isFromCache,
    refresh,
    create,
    update,
    remove,
    getById,
  };
}

// ============================================================
//          HOOKS ESPECIALIZADOS PARA CADA COLECCIÓN
// ============================================================

export function useOfflineMedications(userId?: string) {
  return useOfflineCollection<any>({
    collection: "medications",
    userId,
    filter: (med) => !med.isArchived,
    sort: (a, b) => {
      const dateA = a.nextDueAt?.toDate?.() || a.nextDueAt || 0;
      const dateB = b.nextDueAt?.toDate?.() || b.nextDueAt || 0;
      return new Date(dateA).getTime() - new Date(dateB).getTime();
    },
  });
}

export function useOfflineHabits(userId?: string) {
  return useOfflineCollection<any>({
    collection: "habits",
    userId,
    filter: (habit) => !habit.isArchived,
    sort: (a, b) => {
      const priorityOrder: Record<string, number> = {
        alta: 0,
        normal: 1,
        baja: 2,
      };
      const aPriority = priorityOrder[a.priority || "normal"] ?? 1;
      const bPriority = priorityOrder[b.priority || "normal"] ?? 1;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return (a.name || "").localeCompare(b.name || "");
    },
  });
}

export function useOfflineAppointments(userId?: string) {
  return useOfflineCollection<any>({
    collection: "appointments",
    userId,
    sort: (a, b) => {
      return (a.date || "").localeCompare(b.date || "");
    },
  });
}

export function useOfflineHistory(userId?: string) {
  return useOfflineCollection<any>({
    collection: "history",
    userId,
    realtime: false,
    sort: (a, b) => {
      const dateA = a.timestamp?.toDate?.() || a.timestamp || 0;
      const dateB = b.timestamp?.toDate?.() || b.timestamp || 0;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    },
  });
}

export function useOfflineCaregivers(userId?: string) {
  return useOfflineCollection<any>({
    collection: "caregivers",
    userId,
    filter: (caregiver) => caregiver.status === "active",
  });
}

export default useOfflineCollection;
