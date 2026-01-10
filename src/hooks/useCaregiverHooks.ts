//useCaregiverHooks.ts

import { useState, useEffect, useCallback, useMemo } from "react";
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

export interface UseCaregiverNotificationsResult {
  notifications: CareNotification[];
  loading: boolean;
  refreshing: boolean;
  unreadCount: number;
  onRefresh: () => void;
  markAsRead: (notifId: string) => Promise<void>;
}

export function useCaregiverNotifications(): UseCaregiverNotificationsResult {
  const [notifications, setNotifications] = useState<CareNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canReceiveAlerts, setCanReceiveAlerts] = useState<boolean | null>(
    null
  );

  const validUid = offlineAuthService.getCurrentUid();
  const fbUid = auth.currentUser?.uid;

  const canUseFirestore = useMemo(() => {
    return (
      !!validUid &&
      !!fbUid &&
      fbUid === validUid &&
      !validUid.startsWith("temp_")
    );
  }, [validUid, fbUid]);

  const userId = canUseFirestore ? fbUid : undefined;

  useEffect(() => {
    if (!canUseFirestore || !userId) {
      setCanReceiveAlerts(false);
      setLoading(false);
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
  }, [canUseFirestore, userId]);

  useEffect(() => {
    if (!canUseFirestore || !userId) {
      setNotifications([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (canReceiveAlerts === null) {
      setLoading(true);
      return;
    }

    if (!canReceiveAlerts) {
      setNotifications([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

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
  }, [canUseFirestore, userId, canReceiveAlerts]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
  }, []);

  const markAsRead = useCallback(
    async (notifId: string) => {
      if (!canUseFirestore || !userId) return;
      try {
        await markNotificationAsRead(userId, notifId);
      } catch {}
    },
    [canUseFirestore, userId]
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

export interface UseCareInvitesResult {
  invites: CareInvite[];
  loading: boolean;
  acceptInvite: (inviteId: string) => Promise<void>;
  rejectInvite: (inviteId: string) => Promise<void>;
}

export function useCareInvites(): UseCareInvitesResult {
  const [invites, setInvites] = useState<CareInvite[]>([]);
  const [loading, setLoading] = useState(true);

  const validUid = offlineAuthService.getCurrentUid();
  const fbUid = auth.currentUser?.uid;

  const canUseFirestore = useMemo(() => {
    return (
      !!validUid &&
      !!fbUid &&
      fbUid === validUid &&
      !validUid.startsWith("temp_")
    );
  }, [validUid, fbUid]);

  const userId = canUseFirestore ? fbUid : undefined;

  useEffect(() => {
    if (!canUseFirestore || !userId) {
      setInvites([]);
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
  }, [canUseFirestore, userId]);

  const acceptInvite = useCallback(
    async (inviteId: string) => {
      if (!canUseFirestore || !userId) return;

      const invite = invites.find((i) => i.id === inviteId);
      if (!invite) throw new Error("Invitación no encontrada");

      await acceptCareInvite(inviteId, invite.patientUid);
    },
    [canUseFirestore, userId, invites]
  );

  const rejectInvite = useCallback(
    async (inviteId: string) => {
      if (!canUseFirestore || !userId) return;

      const invite = invites.find((i) => i.id === inviteId);
      if (!invite) throw new Error("Invitación no encontrada");

      await rejectCareInvite(inviteId, invite.patientUid);
    },
    [canUseFirestore, userId, invites]
  );

  return {
    invites,
    loading,
    acceptInvite,
    rejectInvite,
  };
}

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

  const validUid = offlineAuthService.getCurrentUid();
  const fbUid = auth.currentUser?.uid;

  const canUseFirestore = useMemo(() => {
    return (
      !!validUid &&
      !!fbUid &&
      fbUid === validUid &&
      !validUid.startsWith("temp_")
    );
  }, [validUid, fbUid]);

  const userId = canUseFirestore ? fbUid : undefined;

  useEffect(() => {
    if (!canUseFirestore || !userId) {
      setPatients([]);
      setProfilePhotos({});
      setLoading(false);
      return;
    }

    const unsubscribe = listenMyPatients(
      userId,
      async (data) => {
        setPatients(data);
        setLoading(false);

        try {
          const photos = await loadPatientsPhotos(data);
          setProfilePhotos(photos);
        } catch {
          setProfilePhotos({});
        }
      },
      () => {
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [canUseFirestore, userId]);

  return {
    patients,
    profilePhotos,
    loading,
  };
}
