// src/hooks/useOfflineAlarms.ts
// 🔔 Hook para gestionar alarmas de forma offline-first

import { useState, useEffect, useCallback } from "react";
import {
  offlineAlarmService,
  AlarmMetadata,
  AlarmScheduleResult,
} from "../services/offline/OfflineAlarmService";
import { offlineAuthService } from "../services/offline/OfflineAuthService";
import * as Notifications from "expo-notifications";

export interface UseOfflineAlarmsReturn {
  // Estado
  alarms: AlarmMetadata[];
  loading: boolean;
  alarmCount: number;

  // Acciones: Medicamentos
  scheduleMedicationAlarm: (
    triggerDate: Date,
    medication: {
      nombre: string;
      dosis?: string;
      imageUri?: string;
      medId?: string;
      ownerUid?: string;
      frecuencia?: string;
      cantidadActual?: number;
      cantidadPorToma?: number;
      patientName?: string;
      snoozeCount?: number;
    }
  ) => Promise<AlarmScheduleResult>;

  // Acciones: Hábitos
  scheduleHabitAlarm: (
    triggerDate: Date,
    habit: {
      name: string;
      icon?: string;
      lib?: "MaterialIcons" | "FontAwesome5";
      habitId?: string;
      ownerUid?: string;
      patientName?: string;
      snoozeCount?: number;
    }
  ) => Promise<AlarmScheduleResult>;

  // Acciones: Cancelar
  cancelAlarm: (notificationId: string) => Promise<boolean>;
  cancelAllAlarmsForItem: (itemId: string) => Promise<number>;
  cancelAllAlarms: () => Promise<void>;

  // Consultas
  getAlarmsForItem: (itemId: string) => AlarmMetadata[];
  getAlarmById: (notificationId: string) => AlarmMetadata | undefined;

  // Utilidades
  refresh: () => Promise<void>;
  cleanupExpired: () => Promise<number>;
}

export function useOfflineAlarms(): UseOfflineAlarmsReturn {
  const [alarms, setAlarms] = useState<AlarmMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAlarms = useCallback(async () => {
    try {
      setLoading(true);
      const allAlarms = await offlineAlarmService.getAllAlarms();
      setAlarms(allAlarms);
    } catch (error) {
      console.error("Error cargando alarmas:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAlarms();

    // Actualizar cada 30 segundos
    const interval = setInterval(loadAlarms, 30000);

    // Escuchar cuando se reciben notificaciones
    const subscription = Notifications.addNotificationReceivedListener(() => {
      loadAlarms();
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [loadAlarms]);

  const scheduleMedicationAlarm = useCallback(
    async (
      triggerDate: Date,
      medication: {
        nombre: string;
        dosis?: string;
        imageUri?: string;
        medId?: string;
        ownerUid?: string;
        frecuencia?: string;
        cantidadActual?: number;
        cantidadPorToma?: number;
        patientName?: string;
        snoozeCount?: number;
      }
    ): Promise<AlarmScheduleResult> => {
      const result = await offlineAlarmService.scheduleMedicationAlarm(
        triggerDate,
        medication
      );
      await loadAlarms(); // Refrescar lista
      return result;
    },
    [loadAlarms]
  );

  const scheduleHabitAlarm = useCallback(
    async (
      triggerDate: Date,
      habit: {
        name: string;
        icon?: string;
        lib?: "MaterialIcons" | "FontAwesome5";
        habitId?: string;
        ownerUid?: string;
        patientName?: string;
        snoozeCount?: number;
      }
    ): Promise<AlarmScheduleResult> => {
      const result = await offlineAlarmService.scheduleHabitAlarm(
        triggerDate,
        habit
      );
      await loadAlarms();
      return result;
    },
    [loadAlarms]
  );

  const cancelAlarm = useCallback(
    async (notificationId: string): Promise<boolean> => {
      const success = await offlineAlarmService.cancelAlarm(notificationId);
      await loadAlarms();
      return success;
    },
    [loadAlarms]
  );

  const cancelAllAlarmsForItem = useCallback(
    async (itemId: string): Promise<number> => {
      const ownerUid = offlineAuthService.getCurrentUid();
      if (!ownerUid) return 0;

      const count = await offlineAlarmService.cancelAllAlarmsForItem(
        itemId,
        ownerUid
      );
      await loadAlarms();
      return count;
    },
    [loadAlarms]
  );

  const cancelAllAlarms = useCallback(async (): Promise<void> => {
    await offlineAlarmService.cancelAllAlarms();
    await loadAlarms();
  }, [loadAlarms]);

  const getAlarmsForItem = useCallback(
    (itemId: string): AlarmMetadata[] => {
      const ownerUid = offlineAuthService.getCurrentUid();
      if (!ownerUid) return [];

      return alarms.filter(
        (alarm) => alarm.itemId === itemId && alarm.ownerUid === ownerUid
      );
    },
    [alarms]
  );

  const getAlarmById = useCallback(
    (notificationId: string): AlarmMetadata | undefined => {
      return alarms.find((alarm) => alarm.id === notificationId);
    },
    [alarms]
  );

  const refresh = useCallback(async (): Promise<void> => {
    await loadAlarms();
  }, [loadAlarms]);

  const cleanupExpired = useCallback(async (): Promise<number> => {
    const count = await offlineAlarmService.cleanupExpiredAlarms();
    await loadAlarms();
    return count;
  }, [loadAlarms]);

  return {
    alarms,
    loading,
    alarmCount: alarms.length,
    scheduleMedicationAlarm,
    scheduleHabitAlarm,
    cancelAlarm,
    cancelAllAlarmsForItem,
    cancelAllAlarms,
    getAlarmsForItem,
    getAlarmById,
    refresh,
    cleanupExpired,
  };
}

export default useOfflineAlarms;
