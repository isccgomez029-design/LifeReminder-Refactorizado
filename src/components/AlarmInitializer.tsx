// src/components/AlarmInitializer.tsx
import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as Notifications from "expo-notifications";

import { offlineAlarmService } from "../services/offline/OfflineAlarmService";
import { performAlarmMaintenance } from "../services/alarmValidator";
import { offlineAuthService } from "../services/offline/OfflineAuthService";
import { syncQueueService } from "../services/offline/SyncQueueService";
import { auth } from "../config/firebaseConfig";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Convierte ISO | Date | Timestamp | {seconds} -> Date | null */
const toDateSafe = (v: any): Date | null => {
  if (!v) return null;

  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof v?.toDate === "function") {
    const d = v.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }

  if (typeof v?.seconds === "number") {
    const d = new Date(v.seconds * 1000);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
};

type CachedMed = {
  id: string;
  nombre?: string;
  dosis?: string;
  frecuencia?: string;
  imageUri?: string;
  nextDueAt?: any;
  proximaToma?: string;
  currentAlarmId?: string | null;
  cantidadActual?: number;
  cantidadPorToma?: number;
  snoozeCount?: number;
  patientName?: string;
};

type CachedHabit = {
  id: string;
  name?: string;
  icon?: string;
  lib?: string;
  nextDueAt?: any;
  currentAlarmId?: string | null;
  snoozeCount?: number;
  patientName?: string;
};

export function AlarmInitializer() {
  const appState = useRef(AppState.currentState);
  const maintenanceInterval = useRef<NodeJS.Timeout | undefined>(undefined);
  const lastMaintenanceTime = useRef<number>(0);

  // ✅ Throttle para no reprogramar a lo loco
  const lastEnsureTime = useRef<number>(0);
  const ensuringRef = useRef<boolean>(false);

  const getOwnerUid = () =>
    auth.currentUser?.uid || offlineAuthService.getCurrentUid();

  /**
   * ✅ Garantiza que TODA próxima alarma (nextDueAt futura) tenga
   * una notificación local REAL programada.
   */
  const ensureUpcomingAlarms = async () => {
    if (ensuringRef.current) return;

    const ownerUid = getOwnerUid();
    if (!ownerUid) return;

    // No correr más de una vez cada 60s
    const now = Date.now();
    if (now - lastEnsureTime.current < 60 * 1000) return;

    ensuringRef.current = true;
    lastEnsureTime.current = now;

    try {
      // Lista de notificaciones locales programadas (Expo)
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const scheduledIds = new Set<string>(
        scheduled.map((n) => n.identifier).filter(Boolean)
      );

      // ====== MEDS ======
      const meds = (await syncQueueService.getActiveItems(
        "medications",
        ownerUid
      )) as CachedMed[];

      for (const med of meds) {
        const nextDueAt = toDateSafe(med.nextDueAt);
        if (!nextDueAt) continue;

        // Solo futuro
        if (nextDueAt.getTime() <= Date.now()) continue;

        const hasAlarmId = !!med.currentAlarmId;
        const existsInExpo =
          hasAlarmId && scheduledIds.has(med.currentAlarmId as string);

        // Si no hay alarmId o ya no existe en Expo -> reprogramar
        if (!hasAlarmId || !existsInExpo) {
          try {
            const result = await offlineAlarmService.scheduleMedicationAlarm(
              nextDueAt,
              {
                nombre: med.nombre || "Medicamento",
                dosis: med.dosis,
                imageUri: med.imageUri,
                medId: med.id,
                ownerUid,
                frecuencia: med.frecuencia,
                cantidadActual: med.cantidadActual ?? 0,
                cantidadPorToma: med.cantidadPorToma ?? 1,
                patientName: med.patientName,
                snoozeCount: med.snoozeCount ?? 0,
              }
            );

            if (result?.success && result.notificationId) {
              const patch = { currentAlarmId: result.notificationId };

              // Cache + cola (funciona offline/online)
              await syncQueueService.updateItemInCache(
                "medications",
                ownerUid,
                med.id,
                patch
              );
              await syncQueueService.enqueue(
                "UPDATE",
                "medications",
                med.id,
                ownerUid,
                patch
              );
            }
          } catch {
            // no-op
          }
        }
      }

      // ====== HABITS ======
      const habits = (await syncQueueService.getActiveItems(
        "habits",
        ownerUid
      )) as CachedHabit[];

      for (const habit of habits) {
        const nextDueAt = toDateSafe(habit.nextDueAt);
        if (!nextDueAt) continue;
        if (nextDueAt.getTime() <= Date.now()) continue;

        const hasAlarmId = !!habit.currentAlarmId;
        const existsInExpo =
          hasAlarmId && scheduledIds.has(habit.currentAlarmId as string);

        if (!hasAlarmId || !existsInExpo) {
          try {
            const result = await offlineAlarmService.scheduleHabitAlarm(
              nextDueAt,
              {
                name: habit.name || "Hábito",
                icon: habit.icon,
                lib:
                  habit.lib === "MaterialIcons" || habit.lib === "FontAwesome5"
                    ? habit.lib
                    : undefined,
                habitId: habit.id,
                ownerUid,
                patientName: habit.patientName,
                snoozeCount: habit.snoozeCount ?? 0,
              }
            );

            if (result?.success && result.notificationId) {
              const patch = { currentAlarmId: result.notificationId };

              await syncQueueService.updateItemInCache(
                "habits",
                ownerUid,
                habit.id,
                patch
              );
              await syncQueueService.enqueue(
                "UPDATE",
                "habits",
                habit.id,
                ownerUid,
                patch
              );
            }
          } catch {
            // no-op
          }
        }
      }
    } finally {
      ensuringRef.current = false;
    }
  };

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      try {
        // 1) Inicializar alarmas
        await offlineAlarmService.initialize();

        // 2) ✅ Asegurar que existan alarmas locales para próximos eventos
        await ensureUpcomingAlarms();

        // 3) Mantenimiento inicial si han pasado 5 min
        const now = Date.now();
        if (now - lastMaintenanceTime.current > 5 * 60 * 1000) {
          await performAlarmMaintenance();
          lastMaintenanceTime.current = now;
        }

        // 4) ✅ Intervalo de mantenimiento (30 min) + ensure
        maintenanceInterval.current = setInterval(async () => {
          if (!isMounted) return;

          const currentTime = Date.now();

          // ensure cada ~5 min (pero throttle interno de 60s)
          if (currentTime - lastEnsureTime.current > 5 * 60 * 1000) {
            await ensureUpcomingAlarms();
          }

          // mantenimiento cada 25-30 min
          if (currentTime - lastMaintenanceTime.current > 25 * 60 * 1000) {
            await performAlarmMaintenance();
            lastMaintenanceTime.current = currentTime;
          }
        }, 30 * 60 * 1000);

        if (__DEV__) {
          await offlineAlarmService.debugPrintAllAlarms();
        }
      } catch {
        // no-op
      }
    };

    initialize();

    const subscription = AppState.addEventListener(
      "change",
      async (nextAppState: AppStateStatus) => {
        if (
          appState.current.match(/inactive|background/) &&
          nextAppState === "active"
        ) {
          try {
            await offlineAlarmService.initialize();

            // ✅ al volver a foreground, re-asegurar alarmas
            await ensureUpcomingAlarms();

            const now = Date.now();
            if (now - lastMaintenanceTime.current > 10 * 60 * 1000) {
              await performAlarmMaintenance();
              lastMaintenanceTime.current = now;
            }

            if (__DEV__) {
              await offlineAlarmService.debugPrintAllAlarms();
            }
          } catch {
            // no-op
          }
        }

        appState.current = nextAppState;
      }
    );

    return () => {
      isMounted = false;
      subscription.remove();
      if (maintenanceInterval.current)
        clearInterval(maintenanceInterval.current);
    };
  }, []);

  return null;
}

export default AlarmInitializer;
