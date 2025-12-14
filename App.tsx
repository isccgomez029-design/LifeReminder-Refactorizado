// App.tsx
// ✅ SIMPLIFICADO: Solo usa SyncQueueService (sin OfflineDataManager)

import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import NetInfo from "@react-native-community/netinfo";

import StackNavigator from "./src/navigation/StackNavigator";
import { configureNotificationPermissions } from "./src/services/Notifications";
import { navigationRef } from "./src/navigation/navigationRef";

// 🔹 Servicios Offline
import { offlineAuthService } from "./src/services/offline/OfflineAuthService";
import { syncQueueService } from "./src/services/offline/SyncQueueService";

// 🔹 Contexto de conectividad
import { OfflineProvider } from "./src/context/OfflineContext";
import { auth } from "./src/config/firebaseConfig";
import { offlineAlarmService } from "./src/services/offline/OfflineAlarmService";
import {
  shouldShowAlarm,
  performAlarmMaintenance,
  cleanupArchivedItemAlarms,
} from "./src/services/alarmValidator";
import { AlarmInitializer } from "./src/components/AlarmInitializer";

const COLORS = {
  primary: "#6366F1",
  background: "#F8FAFC",
  text: "#1E293B",
};

export default function App() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const initializeApp = async () => {
      try {
        console.log("🚀 Inicializando LifeReminder...");

        await configureNotificationPermissions();

        const cachedUser = await offlineAuthService.initialize();
        console.log(
          "✅ Auth inicializado:",
          cachedUser ? cachedUser.email : "Sin sesión"
        );

        await syncQueueService.initialize();
        console.log("✅ Sync Queue inicializado");

        // ⭐ INSTRUCCIÓN 2: Inicializar Sistema de Alarmas
        await offlineAlarmService.initialize();
        console.log("✅ Sistema de alarmas inicializado");

        await performAlarmMaintenance();
        console.log("✅ Mantenimiento de alarmas completado");

        if (cachedUser) {
          await syncQueueService.debugCache(cachedUser.uid);
        }

        // ⭐ INSTRUCCIÓN 4: LIMPIAR ALARMAS HUÉRFANAS
        const userId =
          auth.currentUser?.uid || offlineAuthService.getCurrentUid();

        if (userId) {
          await cleanupArchivedItemAlarms(userId);
        }

        const netState = await NetInfo.fetch();
        console.log(
          "📡 Estado de conexión:",
          netState.isConnected ? "Online" : "Offline"
        );

        if (isMounted) setIsInitializing(false);
      } catch (error: any) {
        console.error("❌ Error inicializando app:", error);
        if (isMounted) {
          setInitError(error.message || "Error de inicialización");
          setIsInitializing(false);
        }
      }
    };

    initializeApp();

    // ⭐ INSTRUCCIÓN 3: Listener modificado (response / background)
    const responseListener =
      Notifications.addNotificationResponseReceivedListener(
        async (response) => {
          const data = response.notification.request.content.data;

          if (data?.screen === "Alarm") {
            const { shouldShow, reason } = await shouldShowAlarm(data);

            if (shouldShow) {
              (navigationRef.current as any)?.navigate("Alarm", data.params);
            } else {
              console.log(`🔕 Alarma ignorada: ${reason}`);
            }
          }
        }
      );

    // ⭐ Listener foreground
    const notificationListener = Notifications.addNotificationReceivedListener(
      async (notification) => {
        const data = notification.request.content.data;

        if (data?.screen === "Alarm") {
          const { shouldShow, reason } = await shouldShowAlarm(data);

          if (shouldShow) {
            (navigationRef.current as any)?.navigate("Alarm", data.params);
          } else {
            console.log(`🔕 Alarma ignorada (foreground): ${reason}`);
          }
        }
      }
    );

    // Cleanup
    return () => {
      isMounted = false;
      responseListener.remove();
      notificationListener.remove();
      offlineAuthService.destroy();
      syncQueueService.destroy();
    };
  }, []);

  if (isInitializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Cargando LifeReminder...</Text>
      </View>
    );
  }

  if (initError) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorTitle}>Error de Inicialización</Text>
        <Text style={styles.errorText}>{initError}</Text>
        <Text style={styles.errorHint}>
          Intenta cerrar y volver a abrir la aplicación
        </Text>
      </View>
    );
  }

  // ⭐ INSTRUCCIÓN 4: Agregar AlarmInitializer en el Return
  return (
    <OfflineProvider>
      <SafeAreaProvider>
        <NavigationContainer ref={navigationRef}>
          {/* ✅ DEBE estar DENTRO del NavigationContainer */}
          <AlarmInitializer />
          <StackNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </OfflineProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.text,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background,
    padding: 20,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: COLORS.text,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: "#EF4444",
    textAlign: "center",
    marginBottom: 16,
  },
  errorHint: {
    fontSize: 12,
    color: "#64748B",
    textAlign: "center",
  },
});
