// src/hooks/useCaregiverHooks.ts
// 🎯 Hooks especializados para pantallas de cuidadores

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
 *            🔔 HOOK: useCareg iverNotifications
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

  const user = auth.currentUser;
  const userId = user?.uid;

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const unsubscribe = listenCaregiverNotifications(
      userId,
      (data) => {
        setNotifications(data);
        setLoading(false);
        setRefreshing(false);
      },
      (error) => {
        console.error("Error en notificaciones:", error);
        setLoading(false);
        setRefreshing(false);
      }
    );

    return unsubscribe;
  }, [userId]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // El listener se encargará de actualizar los datos
  }, []);

  const markAsRead = useCallback(
    async (notifId: string) => {
      if (!userId) return;
      try {
        await markNotificationAsRead(userId, notifId);
      } catch (error) {
        console.error("Error marcando notificación:", error);
      }
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
 *              📩 HOOK: useCareInvites
 * ============================================================ */

export interface UseCareInvitesResult {
  invites: CareInvite[];
  loading: boolean;
  acceptInvite: (inviteId: string) => Promise<void>;
  rejectInvite: (inviteId: string) => Promise<void>;
}

/**
 * Hook para gestionar invitaciones de cuidado
 */
export function useCareInvites(): UseCareInvitesResult {
  const [invites, setInvites] = useState<CareInvite[]>([]);
  const [loading, setLoading] = useState(true);

  // Obtener UID (online u offline)
  const firebaseUser = auth.currentUser;
  const offlineUser = offlineAuthService.getCurrentUser();
  const userId = firebaseUser?.uid || offlineUser?.uid;

  useEffect(() => {
    if (!userId) {
      console.log("⚠️ No hay usuario autenticado (CareInvites)");
      setLoading(false);
      return;
    }

    const unsubscribe = listenCareInvites(
      userId,
      (data) => {
        setInvites(data);
        setLoading(false);
      },
      (error) => {
        console.error("Error en invitaciones:", error);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [userId]);

  const acceptInvite = useCallback(async (inviteId: string) => {
    try {
      await acceptCareInvite(inviteId);
    } catch (error) {
      console.error("Error aceptando invitación:", error);
      throw error;
    }
  }, []);

  const rejectInvite = useCallback(async (inviteId: string) => {
    try {
      await rejectCareInvite(inviteId);
    } catch (error) {
      console.error("Error rechazando invitación:", error);
      throw error;
    }
  }, []);

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

/**
 * Hook para gestionar la lista de pacientes del cuidador
 */
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
      console.log("⚠️ No hay usuario autenticado (MyPatients)");
      setLoading(false);
      return;
    }

    const unsubscribe = listenMyPatients(
      userId,
      async (data) => {
        setPatients(data);
        setLoading(false);

        // Cargar fotos de perfil
        const photos = await loadPatientsPhotos(data);
        setProfilePhotos(photos);
      },
      (error) => {
        console.error("Error en pacientes:", error);
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
