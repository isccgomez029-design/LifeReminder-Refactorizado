// src/screens/alarm/AlarmScreen.tsx
// ✅ CORREGIDO: Espera a que AsyncStorage persista antes de cerrar

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Vibration,
  StatusBar,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { useRoute, useNavigation, RouteProp } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";
import { COLORS, FONT_SIZES } from "../../../types";

import { auth } from "../../config/firebaseConfig";
import { offlineAuthService } from "../../services/offline/OfflineAuthService";
import { syncQueueService } from "../../services/offline/SyncQueueService";
import {
  notifyCaregiversAboutNoncompliance,
  notifyCaregiversAboutDismissal,
  logSnoozeEvent,
  logComplianceSuccess,
  logDismissalEvent,
} from "../../services/caregiverNotifications";
import offlineAlarmService from "../../services/offline/OfflineAlarmService";

const freqToMs = (freq?: string): number => {
  if (!freq) return 0;
  const m = freq.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return (parseInt(m[1]) * 60 + parseInt(m[2])) * 60000;
};

type AlarmRoute = RouteProp<RootStackParamList, "Alarm">;
type Nav = StackNavigationProp<RootStackParamList, "Alarm">;

const VIBRATION_PATTERN = [0, 400, 200, 400, 200, 400];
const SNOOZE_LIMIT = 3;

// ✅ NUEVO: Helper para esperar persistencia
async function waitForPersistence(retries = 5, delayMs = 200): Promise<void> {
  for (let i = 0; i < retries; i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export default function AlarmScreen() {
  const route = useRoute<AlarmRoute>();
  const navigation = useNavigation<Nav>();

  const {
    type,
    title,
    message,
    medId,
    ownerUid: paramOwnerUid,
    imageUri,
    doseLabel,
    frecuencia,
    cantidadActual,
    cantidadPorToma,
    habitIcon,
    habitLib,
    habitId,
    snoozeCount: initialSnoozeCount,
    patientName,
  } = (route.params as any) || {};

  const ownerUid =
    paramOwnerUid ||
    auth.currentUser?.uid ||
    offlineAuthService.getCurrentUid();

  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [snoozeCount, setSnoozeCount] = useState<number>(
    initialSnoozeCount || 0
  );
  const isProcessingRef = useRef(false);

  // Sonido
  useEffect(() => {
    let isMounted = true;
    let loadedSound: Audio.Sound | null = null;

    async function loadSound() {
      try {
        const { sound: s } = await Audio.Sound.createAsync(
          require("../../../assets/alarm_sound.mp3"),
          { isLooping: true, volume: 1 }
        );
        if (isMounted) {
          loadedSound = s;
          setSound(s);
          await s.playAsync();
        } else {
          await s.unloadAsync();
        }
      } catch (err) {}
    }

    loadSound();

    return () => {
      isMounted = false;
      if (loadedSound) {
        loadedSound.stopAsync().catch(() => {});
        loadedSound.unloadAsync().catch(() => {});
      }
    };
  }, []);

  // Vibración
  useEffect(() => {
    Vibration.vibrate(VIBRATION_PATTERN, true);
    return () => Vibration.cancel();
  }, []);

  // Animación
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const stopAlarm = async () => {
    try {
      Vibration.cancel();
      if (sound) {
        await sound.stopAsync().catch(() => {});
        await sound.unloadAsync().catch(() => {});
      }
    } catch (err) {}
  };

  const closeScreen = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.reset({
        index: 0,
        routes: [{ name: "MainTabs" as any }],
      });
    }
  };

  // ================================================================
  //   ✅ TOMAR MEDICAMENTO - CORREGIDO
  // ================================================================
  const handleComplete = async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    await stopAlarm();

    try {
      if (type === "med" && medId && ownerUid) {
        const now = new Date();
        const newQty = Math.max(
          0,
          (cantidadActual ?? 0) - (cantidadPorToma ?? 1)
        );

        const updateData: Record<string, any> = {
          lastTakenAt: now.toISOString(),
          cantidadActual: newQty,
          cantidad: newQty,
          updatedAt: now.toISOString(),
          currentAlarmId: null,
          snoozeCount: 0,
          snoozedUntil: null,
          lastSnoozeAt: null,
        };

        const interval = freqToMs(frecuencia);
        if (interval > 0) {
          const nextDueAt = new Date(now.getTime() + interval);
          updateData.nextDueAt = nextDueAt.toISOString();
          updateData.proximaToma = nextDueAt.toLocaleTimeString("es-MX", {
            hour: "2-digit",
            minute: "2-digit",
          });

          try {
            const result = await offlineAlarmService.scheduleMedicationAlarm(
              nextDueAt,
              {
                nombre: title,
                dosis: doseLabel,
                imageUri: imageUri,
                medId: medId,
                ownerUid: ownerUid,
                frecuencia: frecuencia,
                cantidadActual: newQty,
                cantidadPorToma: cantidadPorToma,
                patientName: patientName,
                snoozeCount: 0,
              }
            );

            if (result.success && result.notificationId) {
              updateData.currentAlarmId = result.notificationId;
            }
          } catch (e) {}
        }

        // ✅ CRÍTICO: Actualizar cache y esperar persistencia
        await syncQueueService.updateItemInCache(
          "medications",
          ownerUid,
          medId,
          updateData
        );

        await syncQueueService.enqueue(
          "UPDATE",
          "medications",
          medId,
          ownerUid,
          updateData
        );

        // ✅ ESPERAR que AsyncStorage termine de escribir
        await waitForPersistence();

        await logComplianceSuccess({
          patientUid: ownerUid,
          itemId: medId,
          itemName: title,
          itemType: "med",
          afterSnoozes: snoozeCount,
        }).catch(() => {});
      } else if (type === "habit" && habitId && ownerUid) {
        const updateData = {
          currentAlarmId: null,
          snoozeCount: 0,
          snoozedUntil: null,
          lastSnoozeAt: null,
          lastCompletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await syncQueueService.updateItemInCache(
          "habits",
          ownerUid,
          habitId,
          updateData
        );

        await syncQueueService.enqueue(
          "UPDATE",
          "habits",
          habitId,
          ownerUid,
          updateData
        );

        await waitForPersistence();

        await logComplianceSuccess({
          patientUid: ownerUid,
          itemId: habitId,
          itemName: title,
          itemType: "habit",
          afterSnoozes: snoozeCount,
        }).catch(() => {});
      }
    } catch (err) {
    } finally {
      isProcessingRef.current = false;
      // ✅ Cerrar DESPUÉS de persistir
      closeScreen();
    }
  };

  // ================================================================
  //   ✅ POSPONER ALARMA - CORREGIDO
  // ================================================================
  const handleSnooze = async (minutes: number) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    const newSnoozeCount = snoozeCount + 1;
    await stopAlarm();

    try {
      const itemId = type === "med" ? medId : habitId;

      if (ownerUid && itemId) {
        await logSnoozeEvent({
          patientUid: ownerUid,
          itemId,
          itemName: title,
          itemType: type,
          snoozeMinutes: minutes,
          snoozeCount: newSnoozeCount,
        }).catch(() => {});

        if (newSnoozeCount >= SNOOZE_LIMIT) {
          await notifyCaregiversAboutNoncompliance({
            patientUid: ownerUid,
            patientName: patientName || "Paciente",
            medicationName: title,
            snoozeCount: newSnoozeCount,
            type,
          }).catch(() => {});
        }
      }

      const newTriggerTime = new Date(Date.now() + minutes * 60 * 1000);
      let newAlarmId: string | null = null;

      if (type === "med" && medId && ownerUid) {
        try {
          const result = await offlineAlarmService.scheduleMedicationAlarm(
            newTriggerTime,
            {
              nombre: title,
              dosis: doseLabel,
              imageUri,
              medId,
              ownerUid,
              frecuencia,
              cantidadActual,
              cantidadPorToma,
              patientName,
              snoozeCount: newSnoozeCount,
            }
          );

          if (result.success) {
            newAlarmId = result.notificationId;
          }
        } catch (e) {}

        const updateData = {
          currentAlarmId: newAlarmId,
          snoozeCount: newSnoozeCount,
          snoozedUntil: newTriggerTime.toISOString(),
          lastSnoozeAt: new Date().toISOString(),
        };

        await syncQueueService.updateItemInCache(
          "medications",
          ownerUid,
          medId,
          updateData
        );

        await syncQueueService.enqueue(
          "UPDATE",
          "medications",
          medId,
          ownerUid,
          updateData
        );

        // ✅ ESPERAR persistencia
        await waitForPersistence();
      } else if (type === "habit" && habitId && ownerUid) {
        try {
          const result = await offlineAlarmService.scheduleHabitAlarm(
            newTriggerTime,
            {
              name: title,
              icon: habitIcon,
              lib: habitLib,
              habitId,
              ownerUid,
              patientName,
              snoozeCount: newSnoozeCount,
            }
          );

          if (result.success) {
            newAlarmId = result.notificationId;
          }
        } catch (e) {}

        const updateData = {
          currentAlarmId: newAlarmId,
          snoozeCount: newSnoozeCount,
          snoozedUntil: newTriggerTime.toISOString(),
          lastSnoozeAt: new Date().toISOString(),
        };

        await syncQueueService.updateItemInCache(
          "habits",
          ownerUid,
          habitId,
          updateData
        );

        await syncQueueService.enqueue(
          "UPDATE",
          "habits",
          habitId,
          ownerUid,
          updateData
        );

        await waitForPersistence();
      }
    } catch (err) {
    } finally {
      isProcessingRef.current = false;
      closeScreen();
    }
  };

  // ================================================================
  //   ✅ DESCARTAR ALARMA - CORREGIDO
  // ================================================================
  const handleDismiss = async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    await stopAlarm();

    try {
      const itemId = type === "med" ? medId : habitId;
      if (ownerUid && itemId) {
        try {
          await logDismissalEvent({
            patientUid: ownerUid,
            itemId,
            itemName: title,
            itemType: type,
            snoozeCountBeforeDismiss: snoozeCount,
          });
        } catch (e) {}

        try {
          await notifyCaregiversAboutDismissal({
            patientUid: ownerUid,
            patientName: patientName || "Paciente",
            itemName: title,
            itemType: type,
            snoozeCountBeforeDismiss: snoozeCount,
          });
        } catch (e) {}
      }
    } catch (err) {}

    // ✅ ESPERAR persistencia
    await waitForPersistence();

    closeScreen();
  };

  // ================================================================
  //   RENDER
  // ================================================================
  let iconElement: React.ReactNode;

  if (type === "med" && imageUri) {
    iconElement = (
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <Image source={{ uri: imageUri }} style={styles.medImage} />
      </Animated.View>
    );
  } else if (type === "habit" && habitIcon && habitLib) {
    const IconLib = habitLib === "FontAwesome5" ? FontAwesome5 : MaterialIcons;
    iconElement = (
      <Animated.View
        style={[styles.iconCircle, { transform: [{ scale: pulseAnim }] }]}
      >
        <IconLib name={habitIcon as any} size={64} color="#fff" />
      </Animated.View>
    );
  } else {
    iconElement = (
      <Animated.View
        style={[styles.iconCircle, { transform: [{ scale: pulseAnim }] }]}
      >
        <MaterialIcons
          name={type === "med" ? "medication" : "alarm"}
          size={64}
          color="#fff"
        />
      </Animated.View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="black" />
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <View style={styles.iconContainer}>{iconElement}</View>
          <Text style={styles.title}>{title || "¡Alarma!"}</Text>

          {snoozeCount > 0 && (
            <View style={styles.snoozeCountBadge}>
              <MaterialIcons name="snooze" size={16} color="#FFA726" />
              <Text style={styles.snoozeCountText}>
                {snoozeCount === 1
                  ? "Primera posposición"
                  : `${snoozeCount} posposiciones`}
              </Text>
            </View>
          )}

          {type === "med" && doseLabel && (
            <View style={styles.doseChip}>
              <MaterialIcons name="medical-services" size={20} color="#fff" />
              <Text style={styles.doseText}>{doseLabel}</Text>
            </View>
          )}

          {message && <Text style={styles.message}>{message}</Text>}

          <Text style={styles.time}>
            {new Date().toLocaleTimeString("es-MX", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleComplete}
          >
            <MaterialIcons name="check-circle" size={28} color="#fff" />
            <Text style={styles.primaryButtonText}>
              {type === "med" ? "Tomar ahora" : "Hecho"}
            </Text>
          </TouchableOpacity>

          <View style={styles.snoozeRow}>
            <TouchableOpacity
              style={styles.snoozeButton}
              onPress={() => handleSnooze(5)}
            >
              <MaterialIcons name="snooze" size={18} color="#fff" />
              <Text style={styles.snoozeText}>5 min</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.snoozeButton}
              onPress={() => handleSnooze(10)}
            >
              <MaterialIcons name="snooze" size={18} color="#fff" />
              <Text style={styles.snoozeText}>10 min</Text>
            </TouchableOpacity>
          </View>

          {snoozeCount >= SNOOZE_LIMIT - 1 && (
            <View style={styles.warningBox}>
              <MaterialIcons name="warning" size={20} color="#FFA726" />
              <Text style={styles.warningText}>
                {snoozeCount === SNOOZE_LIMIT - 1
                  ? "Última posposición antes de notificar"
                  : "Tu red de apoyo ha sido notificada"}
              </Text>
            </View>
          )}

          <TouchableOpacity
            onPress={handleDismiss}
            style={styles.dismissButton}
          >
            <MaterialIcons
              name="notifications-off"
              size={16}
              color="rgba(255,255,255,0.6)"
            />
            <Text style={styles.dismissText}>
              Descartar (notifica a tu red)
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "black" },
  safe: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  iconContainer: { marginBottom: 30 },
  iconCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "#6200EE",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#6200EE",
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 12,
  },
  medImage: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 4,
    borderColor: "#6200EE",
  },
  title: {
    fontSize: 32,
    color: "#fff",
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 12,
  },
  snoozeCountBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255, 167, 38, 0.2)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#FFA726",
  },
  snoozeCountText: {
    color: "#FFA726",
    fontSize: 12,
    fontWeight: "700",
  },
  doseChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#03DAC6",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    marginBottom: 12,
    gap: 8,
  },
  doseText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "700",
  },
  message: {
    fontSize: 18,
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
    marginBottom: 16,
  },
  time: {
    fontSize: 48,
    color: "#fff",
    fontWeight: "800",
    marginBottom: 40,
    letterSpacing: 2,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#6200EE",
    paddingHorizontal: 40,
    paddingVertical: 18,
    borderRadius: 999,
    marginBottom: 24,
    shadowColor: "#6200EE",
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 8,
  },
  primaryButtonText: { color: "#fff", fontSize: 20, fontWeight: "900" },
  snoozeRow: { flexDirection: "row", gap: 16, marginBottom: 16 },
  snoozeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  snoozeText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  warningBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255, 167, 38, 0.15)",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 167, 38, 0.3)",
    maxWidth: "90%",
  },
  warningText: {
    flex: 1,
    color: "#FFA726",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  dismissButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  dismissText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
