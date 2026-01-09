// App.tsx
import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import NetInfo from "@react-native-community/netinfo";

// 🔀 Stacks
import { AuthStack, AppStack } from "./src/navigation/StackNavigator";
import { navigationRef } from "./src/navigation/navigationRef";

// 🔔 Servicios
import { configureNotificationPermissions } from "./src/services/Notifications";
import {
  offlineAuthService,
  type CachedUser,
} from "./src/services/offline/OfflineAuthService";
import { syncQueueService } from "./src/services/offline/SyncQueueService";
import { offlineAlarmService } from "./src/services/offline/OfflineAlarmService";

// 🌐 Contexto
import { OfflineProvider } from "./src/context/OfflineContext";

// ⏰ Alarmas
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

  // 🔑 Estado real de auth (offline + online)
  const [user, setUser] = useState<CachedUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let unsubscribeAuth: (() => void) | null = null;

    const initializeApp = async () => {
      try {
        // 1️⃣ Permisos de notificaciones
        await configureNotificationPermissions();

        // 2️⃣ Inicializar auth offline-first
        await offlineAuthService.initialize();

        // 3️⃣ Listener reactivo de sesión (CLAVE)
        unsubscribeAuth = offlineAuthService.addAuthStateListener((u) => {
          if (!isMounted) return;
          setUser(u);
          setAuthReady(true);
        });

        // 4️⃣ Inicializar cola offline
        await syncQueueService.initialize();

        // 5️⃣ Inicializar alarmas offline
        await offlineAlarmService.initialize();

        // 6️⃣ Mantenimiento de alarmas
        await performAlarmMaintenance();

        // 7️⃣ Limpieza de alarmas huérfanas
        const uid = offlineAuthService.getCurrentUid();
        if (uid) {
          await cleanupArchivedItemAlarms(uid);
        }

        // 8️⃣ Forzar evaluación inicial de red
        await NetInfo.fetch();

        if (isMounted) setIsInitializing(false);
      } catch (error: any) {
        if (isMounted) {
          setInitError(error?.message ?? "Error de inicialización");
          setIsInitializing(false);
        }
      }
    };

    initializeApp();

    // 🔔 Notificación tocada (background)
    const responseListener =
      Notifications.addNotificationResponseReceivedListener(
        async (response) => {
          const data = response.notification.request.content.data;
          if (data?.screen === "Alarm") {
            const { shouldShow } = await shouldShowAlarm(data);
            if (shouldShow) {
              (navigationRef.current as any)?.navigate("Alarm", data.params);
            }
          }
        }
      );

    // 🔔 Notificación recibida (foreground)
    const notificationListener = Notifications.addNotificationReceivedListener(
      async (notification) => {
        const data = notification.request.content.data;
        if (data?.screen === "Alarm") {
          const { shouldShow } = await shouldShowAlarm(data);
          if (shouldShow) {
            (navigationRef.current as any)?.navigate("Alarm", data.params);
          }
        }
      }
    );

    return () => {
      isMounted = false;
      unsubscribeAuth?.();
      responseListener.remove();
      notificationListener.remove();
      offlineAuthService.destroy();
      syncQueueService.destroy();
    };
  }, []);

  // 🟡 Splash / loading
  if (isInitializing || !authReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Cargando LifeReminder...</Text>
      </View>
    );
  }

  // 🔴 Error crítico
  if (initError) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorTitle}>Error de inicialización</Text>
        <Text style={styles.errorText}>{initError}</Text>
        <Text style={styles.errorHint}>
          Cierra y vuelve a abrir la aplicación
        </Text>
      </View>
    );
  }

  // ✅ APP FINAL
  return (
    <OfflineProvider>
      <SafeAreaProvider>
        <NavigationContainer ref={navigationRef}>
          <AlarmInitializer />
          {user ? <AppStack /> : <AuthStack />}
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
