// src/context/OfflineContext.tsx

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";

import { syncQueueService } from "../services/offline/SyncQueueService";
import { pendingAuthQueueService } from "../services/offline/PendingAuthQueueService";
import { offlineAuthService } from "../services/offline/OfflineAuthService";

interface OfflineContextValue {
  isOnline: boolean;
  pendingOperations: number;
  isSyncing: boolean;
  lastSyncTime: Date | null;
  syncNow: () => Promise<void>;
}

const defaultValue: OfflineContextValue = {
  isOnline: true,
  pendingOperations: 0,
  isSyncing: false,
  lastSyncTime: null,
  syncNow: async () => {},
};

const OfflineContext = createContext<OfflineContextValue>(defaultValue);

interface OfflineProviderProps {
  children: ReactNode;
}

export function OfflineProvider({
  children,
}: OfflineProviderProps): React.ReactElement {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingOperations, setPendingOperations] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const syncNow = useCallback(async () => {
    if (isSyncing || !isOnline) return;

    setIsSyncing(true);
    try {
      try {
        await pendingAuthQueueService.processQueue();
      } catch {}

      try {
        await pendingAuthQueueService.processQueue();
        await syncQueueService.processQueue();
      } catch {}

      await syncQueueService.processQueue();

      const count = await syncQueueService.getPendingCount();
      setPendingOperations(count);
      setLastSyncTime(new Date());
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, isOnline]);

  useEffect(() => {
    const handleConnectivityChange = (state: NetInfoState) => {
      const online =
        state.isConnected === true && state.isInternetReachable !== false;

      const wasOffline = !isOnline;
      setIsOnline(online);

      if (online && wasOffline) {
        syncNow();
      }
    };

    const unsubscribe = NetInfo.addEventListener(handleConnectivityChange);
    NetInfo.fetch().then(handleConnectivityChange);

    return () => unsubscribe();
  }, [isOnline, syncNow]);

  useEffect(() => {
    const updatePending = async () => {
      try {
        const count = await syncQueueService.getPendingCount();
        setPendingOperations(count);
      } catch {}
    };

    updatePending();
    const interval = setInterval(updatePending, 5000);

    return () => clearInterval(interval);
  }, []);

  const value: OfflineContextValue = {
    isOnline,
    pendingOperations,
    isSyncing,
    lastSyncTime,
    syncNow,
  };

  return (
    <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
  );
}

export function useOffline(): OfflineContextValue {
  return useContext(OfflineContext);
}

export function useIsOnline(): boolean {
  const { isOnline } = useOffline();
  return isOnline;
}

export default OfflineContext;
