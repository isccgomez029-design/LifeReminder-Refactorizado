// src/screens/appointments/AddAppointmentScreen.tsx
// ✅ CORREGIDO: Soporte offline completo

import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Platform,
  Modal,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { MaterialIcons } from "@expo/vector-icons";
import { COLORS, FONT_SIZES } from "../../../types";
import { SafeAreaView } from "react-native-safe-area-context";
import { RouteProp, useRoute, useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";
import TimePickerField from "../../components/TimePickerField";

import { auth } from "../../config/firebaseConfig";
import { scheduleAppointmentReminder } from "../../services/Notifications";
import MiniCalendar from "../../components/MiniCalendar";

import { upsertAndroidEvent } from "../../services/deviceCalendarService";
import {
  normalizeTime,
  parseHHMMToDate,
  formatHHMMDisplay,
} from "../../utils/timeUtils";

// ✅ Servicios offline
import { syncQueueService } from "../../services/offline/SyncQueueService";
import { offlineAuthService } from "../../services/offline/OfflineAuthService";

type AddApptRoute = RouteProp<RootStackParamList, "AddAppointment">;
type Nav = StackNavigationProp<RootStackParamList, "AddAppointment">;

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const toISO = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function AddAppointmentScreen() {
  const route = useRoute<AddApptRoute>();
  const navigation = useNavigation<Nav>();

  const mode = route.params?.mode ?? "new";
  const appt = route.params?.appt as any | undefined;
  const isEdit = mode === "edit";

  const initialDate = useMemo(
    () => (appt?.date ? new Date(appt.date) : new Date()),
    [appt?.date]
  );

  const [date, setDate] = useState<Date>(initialDate);
  const [motivo, setMotivo] = useState<string>(appt?.title ?? "");
  const [ubicacion, setUbicacion] = useState<string>(appt?.location ?? "");
  const [medico, setMedico] = useState<string>(appt?.doctor ?? "");
  const [hora, setHora] = useState<string>(appt?.time ?? "");

  const [showTimePicker, setShowTimePicker] = useState(false);
  const [timeDate, setTimeDate] = useState<Date>(
    parseHHMMToDate(appt?.time ?? "")
  );

  const onChangeTime = (_: any, selected?: Date) => {
    if (Platform.OS === "android") {
      setShowTimePicker(false);
    }
    if (!selected) return;

    setTimeDate(selected);
    const h = selected.getHours();
    const m = selected.getMinutes();
    const hhmm = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    setHora(hhmm);
  };

  const guardar = async () => {
    if (!motivo.trim()) {
      Alert.alert("Falta información", "Escribe el motivo de la cita.");
      return;
    }

    if (!hora) {
      Alert.alert("Falta información", "Selecciona la hora de la cita.");
      return;
    }

    const horaFinal = normalizeTime(hora);

    // ✅ CORREGIDO: Usar offlineAuthService como fallback
    const userId = auth.currentUser?.uid || offlineAuthService.getCurrentUid();

    if (!userId) {
      Alert.alert(
        "Sesión requerida",
        "Inicia sesión de nuevo para poder guardar la cita."
      );
      return;
    }

    const dateISO = toISO(date);

    const appointmentId =
      isEdit && appt?.id
        ? appt.id
        : `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const payload = {
      id: appointmentId,
      title: motivo.trim(),
      doctor: medico.trim() || undefined,
      location: ubicacion.trim() || undefined,
      date: dateISO,
      time: horaFinal,
      eventId: (appt?.eventId as string | null | undefined) ?? undefined,
      createdAt: appt?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isArchived: false,
    };

    try {
      // 1) Sincronizar con calendario del dispositivo (Android)
      let eventIdFromDevice: string | undefined = payload.eventId ?? undefined;

      if (Platform.OS === "android") {
        try {
          const { eventId } = await upsertAndroidEvent({
            eventId: payload.eventId ?? undefined,
            title: payload.title,
            location: payload.location,
            doctor: payload.doctor,
            date: payload.date,
            time: payload.time,
          } as any);
          eventIdFromDevice = eventId;
        } catch (err) {
          console.log(
            "Error al crear/actualizar evento en calendario Android:",
            err
          );
        }
      }

      const finalPayload = {
        ...payload,
        eventId: eventIdFromDevice,
      };

      // 2) ✅ ENCOLAR OPERACIÓN (funciona offline)
      if (isEdit && appt?.id) {
        await syncQueueService.enqueue(
          "UPDATE",
          "appointments",
          appt.id,
          userId, // ✅ Usar userId
          finalPayload
        );
      } else {
        await syncQueueService.enqueue(
          "CREATE",
          "appointments",
          appointmentId,
          userId, // ✅ Usar userId
          finalPayload
        );
      }

      // 3) Programar notificación 24h antes
      try {
        await scheduleAppointmentReminder(
          finalPayload.date,
          finalPayload.time || "",
          finalPayload.doctor || finalPayload.title
        );
      } catch (notifErr) {
        console.log("Error programando recordatorio:", notifErr);
      }

      Alert.alert(
        "✅ Listo",
        isEdit ? "Cita actualizada" : "Cita creada correctamente"
      );

      navigation.goBack();
    } catch (e: any) {
      console.log("Error guardando cita:", e);
      Alert.alert(
        "Error",
        e?.message ?? "No se pudo guardar la cita. Intenta de nuevo."
      );
    }
  };

  const formattedHora = formatHHMMDisplay(hora);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>
          {isEdit ? "Editar cita" : "Nueva cita"}
        </Text>

        <View style={styles.card}>
          {/* Mini calendario reutilizable */}
          <View style={styles.calendarBox}>
            <MiniCalendar value={date} onChange={setDate} />
          </View>

          <View style={{ gap: 10 }}>
            <View style={styles.row}>
              <TextInput
                style={styles.input}
                placeholder="Motivo de la cita:"
                value={motivo}
                onChangeText={setMotivo}
                placeholderTextColor={COLORS.textSecondary}
              />
            </View>

            <View style={styles.row}>
              <TextInput
                style={styles.input}
                placeholder="Ubicación:"
                value={ubicacion}
                onChangeText={setUbicacion}
                placeholderTextColor={COLORS.textSecondary}
              />
            </View>

            <View style={styles.row}>
              <TextInput
                style={styles.input}
                placeholder="Médico y especialidad:"
                value={medico}
                onChangeText={setMedico}
                placeholderTextColor={COLORS.textSecondary}
              />
            </View>

            {/* Botón para abrir picker de hora tipo rueda */}
            <View style={styles.row}>
              <View style={styles.row}>
                <TimePickerField
                  value={hora}
                  onChange={(val) => setHora(val)}
                  mode="point"
                  placeholder="Seleccionar hora"
                />
              </View>
            </View>

            <TouchableOpacity style={styles.primaryBtn} onPress={guardar}>
              <Text style={styles.primaryText}>
                {isEdit ? "Guardar cambios" : "Confirmar"}
              </Text>
            </TouchableOpacity>

            <Text style={styles.helper}>
              Seleccionado:{" "}
              {date.toLocaleDateString("es-MX", {
                weekday: "short",
                year: "numeric",
                month: "short",
                day: "numeric",
              })}{" "}
              {hora ? `• ${formattedHora}` : ""}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Picker de hora tipo spinner (rueda) */}
      {showTimePicker && (
        <Modal transparent animationType="fade" visible={showTimePicker}>
          <View style={styles.timeModalBackdrop}>
            <View style={styles.timeModalCard}>
              <DateTimePicker
                value={timeDate}
                mode="time"
                display="spinner"
                is24Hour={false}
                onChange={onChangeTime}
              />
              {Platform.OS === "ios" && (
                <TouchableOpacity
                  style={[styles.primaryBtn, { marginTop: 8 }]}
                  onPress={() => setShowTimePicker(false)}
                >
                  <Text style={styles.primaryText}>Listo</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

/* ===== Estilos ===== */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1 },
  content: { padding: 8, paddingBottom: 24 },
  title: {
    fontSize: FONT_SIZES.xlarge,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 10,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    gap: 12,
  },
  calendarBox: {
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: "#111",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 6,
  },
  primaryText: {
    color: COLORS.surface,
    fontWeight: "800",
    fontSize: FONT_SIZES.medium,
  },
  helper: { color: COLORS.textSecondary, marginTop: 6, textAlign: "center" },

  timeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  timeButtonText: {
    color: COLORS.surface,
    fontWeight: "700",
  },

  timeModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  timeModalCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
  },
});
