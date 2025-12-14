// src/context/OfflineContext.tsx
// ⚠️ IMPORTANTE: Guardar con extensión .tsx

import React, {
  createContext, // crea un contexto global
  useContext, // hook para consumir el contexto
  useEffect, // hook para efectos secundarios
  useState, // hook para manejar estado
  useCallback, // hook para memorizar funciones
  ReactNode, // tipo para children
} from "react";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
// NetInfo permite detectar cambios de conectividad en React Native

import { syncQueueService } from "../services/offline/SyncQueueService";
// Servicio que maneja la cola de operaciones offline pendientes

// Definición de la forma del contexto
interface OfflineContextValue {
  isOnline: boolean; // indica si hay conexión a internet
  pendingOperations: number; // número de operaciones pendientes de sincronizar
  isSyncing: boolean; // indica si se está sincronizando actualmente
  lastSyncTime: Date | null; // última vez que se sincronizó
  syncNow: () => Promise<void>; // función para forzar sincronización manual
}

// Valores por defecto del contexto
const defaultValue: OfflineContextValue = {
  isOnline: true,
  pendingOperations: 0,
  isSyncing: false,
  lastSyncTime: null,
  syncNow: async () => {}, // función vacía por defecto
};

// Creación del contexto
const OfflineContext = createContext<OfflineContextValue>(defaultValue);

// Props del proveedor
interface OfflineProviderProps {
  children: ReactNode; // componentes hijos que tendrán acceso al contexto
}

// Componente proveedor del contexto
export function OfflineProvider(
  props: OfflineProviderProps
): React.ReactElement {
  // Estados internos
  const [isOnline, setIsOnline] = useState(true); // estado de conexión
  const [pendingOperations, setPendingOperations] = useState(0); // operaciones pendientes
  const [isSyncing, setIsSyncing] = useState(false); // estado de sincronización
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null); // última sincronización

  // Función para sincronizar manualmente
  const syncNow = useCallback(async () => {
    // Evita sincronizar si ya está en proceso o si no hay conexión
    if (isSyncing || !isOnline) return;

    setIsSyncing(true);
    try {
      // Procesa la cola de operaciones pendientes
      await syncQueueService.processQueue();
      // Obtiene el número actualizado de operaciones pendientes
      const count = await syncQueueService.getPendingCount();
      setPendingOperations(count);
      // Actualiza la hora de última sincronización
      setLastSyncTime(new Date());
    } catch {
      // Si falla, no muestra error (fallo silencioso)
    } finally {
      // Siempre desactiva el estado de sincronización
      setIsSyncing(false);
    }
  }, [isSyncing, isOnline]);

  // Efecto para escuchar cambios de conectividad
  useEffect(() => {
    const handleConnectivityChange = (state: NetInfoState) => {
      // Determina si hay conexión real
      const online =
        state.isConnected === true && state.isInternetReachable !== false;
      const wasOffline = !isOnline;
      setIsOnline(online);

      // Si se reconecta después de estar offline → auto-sync
      if (online && wasOffline) {
        syncNow();
      }
    };

    // Suscripción a cambios de red
    const unsubscribe = NetInfo.addEventListener(handleConnectivityChange);

    // Chequeo inicial de conectividad
    NetInfo.fetch().then(handleConnectivityChange);

    // Limpieza de la suscripción
    return () => unsubscribe();
  }, [isOnline, syncNow]);

  // Efecto para actualizar periódicamente el número de operaciones pendientes
  useEffect(() => {
    const updatePending = async () => {
      try {
        const count = await syncQueueService.getPendingCount();
        setPendingOperations(count);
      } catch {
        // Fallo silencioso
      }
    };

    // Actualización inicial
    updatePending();
    // Intervalo cada 5 segundos
    const interval = setInterval(updatePending, 5000);
    return () => clearInterval(interval);
  }, []);

  // Valor del contexto que se provee a los hijos
  const value: OfflineContextValue = {
    isOnline,
    pendingOperations,
    isSyncing,
    lastSyncTime,
    syncNow,
  };

  // Renderiza el proveedor con el valor actual
  return React.createElement(
    OfflineContext.Provider,
    { value: value },
    props.children
  );
}

// Hook para consumir todo el contexto
export function useOffline(): OfflineContextValue {
  return useContext(OfflineContext);
}

// Hook simplificado para obtener solo el estado de conexión
export function useIsOnline(): boolean {
  const { isOnline } = useOffline();
  return isOnline;
}

// Exportación por defecto del contexto
export default OfflineContext;
