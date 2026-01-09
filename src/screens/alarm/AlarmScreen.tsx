// src/screens/alarm/AlarmScreen.tsx

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  StatusBar,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import { useRoute, RouteProp } from "@react-navigation/native";
import { RootStackParamList } from "../../navigation/StackNavigator";

import { auth } from "../../config/firebaseConfig";
import { offlineAuthService } from "../../services/offline/OfflineAuthService";
import { useAlarmScreen } from "../../hooks/useAlarmScreen";
import { AlarmParams } from "../../services/alarmService";

type AlarmRoute = RouteProp<RootStackParamList, "Alarm">;

export default function AlarmScreen() {
  const route = useRoute<AlarmRoute>();
  const p = (route.params as any) || {};

  const ownerUid = p.ownerUid || offlineAuthService.getCurrentUid();

  const params: AlarmParams = {
    type: p.type,
    title: p.title,
    message: p.message,

    ownerUid,
    patientName: p.patientName,

    medId: p.medId,
    imageUri: p.imageUri,
    doseLabel: p.doseLabel,
    frecuencia: p.frecuencia,
    cantidadActual: p.cantidadActual,
    cantidadPorToma: p.cantidadPorToma,

    habitId: p.habitId,
    habitIcon: p.habitIcon,
    habitLib: p.habitLib,

    snoozeCount: p.snoozeCount,
  };

  const {
    pulseAnim,
    snoozeCount,
    SNOOZE_LIMIT,
    onComplete,
    onSnooze,
    onDismiss,
  } = useAlarmScreen(params);

  let iconElement: React.ReactNode;

  if (params.type === "med" && params.imageUri) {
    iconElement = (
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <Image source={{ uri: params.imageUri }} style={styles.medImage} />
      </Animated.View>
    );
  } else if (params.type === "habit" && params.habitIcon && params.habitLib) {
    const IconLib =
      params.habitLib === "FontAwesome5" ? FontAwesome5 : MaterialIcons;
    iconElement = (
      <Animated.View
        style={[styles.iconCircle, { transform: [{ scale: pulseAnim }] }]}
      >
        <IconLib name={params.habitIcon as any} size={64} color="#fff" />
      </Animated.View>
    );
  } else {
    iconElement = (
      <Animated.View
        style={[styles.iconCircle, { transform: [{ scale: pulseAnim }] }]}
      >
        <MaterialIcons
          name={params.type === "med" ? "medication" : "alarm"}
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

          <Text style={styles.title}>{params.title || "¡Alarma!"}</Text>

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

          {params.type === "med" && params.doseLabel && (
            <View style={styles.doseChip}>
              <MaterialIcons name="medical-services" size={20} color="#fff" />
              <Text style={styles.doseText}>{params.doseLabel}</Text>
            </View>
          )}

          {params.message ? (
            <Text style={styles.message}>{params.message}</Text>
          ) : null}

          <Text style={styles.time}>
            {new Date().toLocaleTimeString("es-MX", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>

          <TouchableOpacity style={styles.primaryButton} onPress={onComplete}>
            <MaterialIcons name="check-circle" size={28} color="#fff" />
            <Text style={styles.primaryButtonText}>
              {params.type === "med" ? "Tomar ahora" : "Hecho"}
            </Text>
          </TouchableOpacity>

          <View style={styles.snoozeRow}>
            <TouchableOpacity
              style={styles.snoozeButton}
              onPress={() => onSnooze(5)}
            >
              <MaterialIcons name="snooze" size={18} color="#fff" />
              <Text style={styles.snoozeText}>5 min</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.snoozeButton}
              onPress={() => onSnooze(10)}
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

          <TouchableOpacity onPress={onDismiss} style={styles.dismissButton}>
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
  snoozeCountText: { color: "#FFA726", fontSize: 12, fontWeight: "700" },
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
  doseText: { color: "#000", fontSize: 14, fontWeight: "700" },
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
  snoozeText: { color: "#fff", fontSize: 14, fontWeight: "700" },
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
