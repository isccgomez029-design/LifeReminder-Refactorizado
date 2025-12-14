// src/components/AlarmInitializer.tsx
// ✅ MEJORADO: Mantenimiento más inteligente y menos agresivo

import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as Notifications from "expo-notifications";
import { offlineAlarmService } from "../services/offline/OfflineAlarmService";
import { performAlarmMaintenance } from "../services/alarmValidator";
import { offlineAuthService } from "../services/offline/OfflineAuthService";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function AlarmInitializer() {
  const appState = useRef(AppState.currentState);
  const maintenanceInterval = useRef<NodeJS.Timeout | undefined>(undefined);
  const lastMaintenanceTime = useRef<number>(0);

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      try {
        // 1. Inicializar el servicio de alarmas
        await offlineAlarmService.initialize();

        // 2. Realizar mantenimiento inicial SOLO si han pasado 5 minutos
        const now = Date.now();
        if (now - lastMaintenanceTime.current > 5 * 60 * 1000) {
          await performAlarmMaintenance();
          lastMaintenanceTime.current = now;
        }

        // 3. ✅ Mantenimiento periódico MÁS ESPACIADO (30 minutos)
        maintenanceInterval.current = setInterval(async () => {
          if (isMounted) {
            const currentTime = Date.now();
            // Solo ejecutar si han pasado al menos 25 minutos
            if (currentTime - lastMaintenanceTime.current > 25 * 60 * 1000) {
              await performAlarmMaintenance();
              lastMaintenanceTime.current = currentTime;
            }
          }
        }, 30 * 60 * 1000); // Cada 30 minutos

        if (__DEV__) {
          await offlineAlarmService.debugPrintAllAlarms();
        }
      } catch (error) {}
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

            // ✅ Solo hacer mantenimiento si han pasado 10 minutos
            const now = Date.now();
            if (now - lastMaintenanceTime.current > 10 * 60 * 1000) {
              await performAlarmMaintenance();
              lastMaintenanceTime.current = now;
            }

            if (__DEV__) {
              await offlineAlarmService.debugPrintAllAlarms();
            }
          } catch (error) {}
        }

        appState.current = nextAppState;
      }
    );

    return () => {
      isMounted = false;
      subscription.remove();
      if (maintenanceInterval.current) {
        clearInterval(maintenanceInterval.current);
      }
    };
  }, []);

  return null;
}

export default AlarmInitializer;
