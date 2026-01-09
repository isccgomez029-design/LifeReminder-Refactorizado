// src/hooks/useHome.ts

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { offlineAuthService } from "../services/offline/OfflineAuthService";
import { syncQueueService } from "../services/offline/SyncQueueService";

type HomeRouteParams = {
  patientUid?: string;
  patientName?: string;
};

export function useHome(args?: { routeParams?: HomeRouteParams }) {
  const params = args?.routeParams ?? {};

  // 🔐 Identidad (FUENTE ÚNICA)
  const loggedUserUid = offlineAuthService.getCurrentUid();
  const ownerUid = params.patientUid ?? loggedUserUid ?? null;

  const isCaregiverView =
    !!params.patientUid && params.patientUid !== loggedUserUid;
  const canModify = ownerUid === loggedUserUid;

  // 🌐 Offline / pending ops
  const [isOnline, setIsOnline] = useState(true);
  const [pendingChanges, setPendingChanges] = useState(0);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online =
        state.isConnected === true && state.isInternetReachable !== false;

      setIsOnline(online);

      if (online) {
        syncQueueService.processQueue().then(() => {
          syncQueueService.getPendingCount().then(setPendingChanges);
        });
      }
    });

    syncQueueService.getPendingCount().then(setPendingChanges);
    return () => unsubscribe();
  }, []);

  // 🔐 Permisos
  const checkModifyPermissions = useCallback(
    (action: string) => {
      if (!canModify) {
        Alert.alert("Solo lectura", `No puedes ${action} desde tu sesión.`);
        return false;
      }
      return true;
    },
    [canModify]
  );

  const [loading, setLoading] = useState(false);

  // ejemplo: contadores
  const [counts, setCounts] = useState({
    medsToday: 0,
    upcomingAppointments: 0,
    activeHabits: 0,
  });

  const refresh = useCallback(async () => {
    if (!ownerUid) return;
    try {
      setLoading(true);
      // cargar data aquí si luego lo necesitas
    } finally {
      setLoading(false);
    }
  }, [ownerUid]);

  return useMemo(
    () => ({
      // auth/permissions
      ownerUid,
      loggedUserUid,
      canModify,
      isCaregiverView,

      // offline
      isOnline,
      pendingChanges,

      // state
      loading,
      counts,

      // actions
      refresh,
      checkModifyPermissions,
      setCounts,
    }),
    [
      ownerUid,
      loggedUserUid,
      canModify,
      isCaregiverView,
      isOnline,
      pendingChanges,
      loading,
      counts,
      refresh,
      checkModifyPermissions,
    ]
  );
}
