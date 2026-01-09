import { useState, useEffect, useCallback } from "react";
import { auth } from "../config/firebaseConfig";
import { offlineAuthService } from "../services/offline/OfflineAuthService";

import {
  listenCaregiverNotifications,
  markNotificationAsRead,
  getUnreadCount,
  type CareNotification,
} from "../services/Notifications";

import {
  listenCareInvites,
  acceptCareInvite,
  rejectCareInvite,
  listenMyPatients,
  loadPatientsPhotos,
  type CareInvite,
  type PatientLink,
} from "../services/careNetworkService";

/* ============================================================
 *            HOOK: useCaregiverNotifications
 * ============================================================ */

export interface UseCaregiverNotificationsResult {
  notifications: CareNotification[];
  loading: boolean;
  refreshing: boolean;
  unreadCount: number;
  onRefresh: () => void;
  markAsRead: (notifId: string) => Promise<void>;
}

/**
 * Hook para gestionar notificaciones del cuidador
 */
export function useCaregiverNotifications(): UseCaregiverNotificationsResult {
  const [notifications, setNotifications] = useState<CareNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [canReceiveAlerts, setCanReceiveAlerts] = useState<boolean | null>(
    null
  );

  const user = auth.currentUser;
  const userId = user?.uid;

  /* ------------------------------------------------------------
   * Determinar si el cuidador puede recibir alertas
   * ------------------------------------------------------------ */
  useEffect(() => {
    if (!userId) {
      setCanReceiveAlerts(false);
      return;
    }

    const unsubscribe = listenMyPatients(
      userId,
      (patients) => {
        const allowed = patients.some(
          (p) => p.accessMode === "alerts-only" || p.accessMode === "full"
        );

        setCanReceiveAlerts(allowed);
      },
      () => {
        setCanReceiveAlerts(false);
      }
    );

    return unsubscribe;
  }, [userId]);

  /* ------------------------------------------------------------
   * Listener de notificaciones (SOLO si tiene permiso)
   * ------------------------------------------------------------ */
  useEffect(() => {
    if (!userId || canReceiveAlerts === null) {
      setLoading(false);
      return;
    }

    // ❌ Sin permiso → no escuchar nada
    if (!canReceiveAlerts) {
      setNotifications([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    // ✅ Con permiso → escuchar Firestore
    const unsubscribe = listenCaregiverNotifications(
      userId,
      (data) => {
        setNotifications(data);
        setLoading(false);
        setRefreshing(false);
      },
      () => {
        setLoading(false);
        setRefreshing(false);
      }
    );

    return unsubscribe;
  }, [userId, canReceiveAlerts]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // El listener actualizará los datos
  }, []);

  const markAsRead = useCallback(
    async (notifId: string) => {
      if (!userId) return;
      try {
        await markNotificationAsRead(userId, notifId);
      } catch {}
    },
    [userId]
  );

  const unreadCount = getUnreadCount(notifications);

  return {
    notifications,
    loading,
    refreshing,
    unreadCount,
    onRefresh,
    markAsRead,
  };
}

/* ============================================================
 *               HOOK: useCareInvites
 * ============================================================ */

export interface UseCareInvitesResult {
  invites: CareInvite[];
  loading: boolean;
  acceptInvite: (inviteId: string) => Promise<void>;
  rejectInvite: (inviteId: string) => Promise<void>;
}

export function useCareInvites(): UseCareInvitesResult {
  const [invites, setInvites] = useState<CareInvite[]>([]);
  const [loading, setLoading] = useState(true);

  const firebaseUser = auth.currentUser;
  const offlineUser = offlineAuthService.getCurrentUser();
  const userId = firebaseUser?.uid || offlineUser?.uid;

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const unsubscribe = listenCareInvites(
      userId,
      (data) => {
        setInvites(data);
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [userId]);

  const acceptInvite = useCallback(
    async (inviteId: string) => {
      const invite = invites.find((i) => i.id === inviteId);
      if (!invite) throw new Error("Invitación no encontrada");

      await acceptCareInvite(inviteId, invite.patientUid);
    },
    [invites]
  );

  const rejectInvite = useCallback(
    async (inviteId: string) => {
      const invite = invites.find((i) => i.id === inviteId);
      if (!invite) throw new Error("Invitación no encontrada");

      await rejectCareInvite(inviteId, invite.patientUid);
    },
    [invites]
  );

  return {
    invites,
    loading,
    acceptInvite,
    rejectInvite,
  };
}

/* ============================================================
 *              👥 HOOK: useMyPatients
 * ============================================================ */

export interface UseMyPatientsResult {
  patients: PatientLink[];
  profilePhotos: Record<string, string>;
  loading: boolean;
}

export function useMyPatients(): UseMyPatientsResult {
  const [patients, setPatients] = useState<PatientLink[]>([]);
  const [profilePhotos, setProfilePhotos] = useState<Record<string, string>>(
    {}
  );
  const [loading, setLoading] = useState(true);

  const user = auth.currentUser;
  const userId = user?.uid;

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const unsubscribe = listenMyPatients(
      userId,
      async (data) => {
        setPatients(data);
        setLoading(false);

        const photos = await loadPatientsPhotos(data);
        setProfilePhotos(photos);
      },
      () => {
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [userId]);

  return {
    patients,
    profilePhotos,
    loading,
  };
}
