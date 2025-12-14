// src/screens/reminders/AddHabitScreen.tsx
// ✅ CORREGIDO: Soporte offline completo

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import { COLORS, FONT_SIZES } from "../../../types";
import { RouteProp, useRoute, useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList, Habit } from "../../navigation/StackNavigator";

// ✅ Servicios offline
import { syncQueueService } from "../../services/offline/SyncQueueService";
import { offlineAuthService } from "../../services/offline/OfflineAuthService";

// Firebase
import { auth } from "../../config/firebaseConfig";

// Servicios
import { scheduleRecurringHabitAlarms } from "../../services/alarmHelpers";

// Utils
import { normalizeTime, formatHHMMDisplay } from "../../utils/timeUtils";

// Hora UI
import TimePickerField from "../../components/TimePickerField";

type AddHabitRoute = RouteProp<RootStackParamList, "AddHabit">;
type Nav = StackNavigationProp<RootStackParamList, "AddHabit">;

const QUICK_ICONS: {
  icon: string;
  lib: "FontAwesome5" | "MaterialIcons";
}[] = [
  { icon: "tint", lib: "FontAwesome5" },
  { icon: "walking", lib: "FontAwesome5" },
  { icon: "self-improvement", lib: "MaterialIcons" },
  { icon: "book", lib: "FontAwesome5" },
  { icon: "favorite", lib: "MaterialIcons" },
  { icon: "healing", lib: "MaterialIcons" },
];

const DAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

export default function AddHabitScreen() {
  const route = useRoute<AddHabitRoute>();
  const navigation = useNavigation<Nav>();

  const mode = route.params?.mode ?? "new";
  const habit = route.params?.habit as Habit | undefined;
  const isEdit = mode === "edit";

  const [name, setName] = useState(habit?.name ?? "");
  const [icon, setIcon] = useState<string | undefined>(habit?.icon);
  const [lib, setLib] = useState<"FontAwesome5" | "MaterialIcons">(
    habit?.lib ?? "MaterialIcons"
  );
  const [priority, setPriority] = useState<"baja" | "normal" | "alta">(
    (habit?.priority as any) || "normal"
  );
  const [days, setDays] = useState<number[]>(habit?.days ?? []);
  const [times, setTimes] = useState<string[]>(habit?.times ?? []);

  const [newTime, setNewTime] = useState(times[0] ?? "08:00");

  const toggleDay = (idx: number) => {
    setDays((prev) =>
      prev.includes(idx) ? prev.filter((d) => d !== idx) : [...prev, idx]
    );
  };

  const addTime = () => {
    const final = normalizeTime(newTime);
    if (!final) {
      Alert.alert("Hora inválida", "Selecciona una hora válida.");
      return;
    }
    setTimes((prev) => {
      if (prev.includes(final)) return prev;
      return [...prev, final].sort();
    });
  };

  const removeTime = (t: string) => {
    setTimes((prev) => prev.filter((x) => x !== t));
  };

  const save = async () => {
    if (!name.trim())
      return Alert.alert("Falta información", "Escribe un nombre.");
    if (!icon) return Alert.alert("Icono", "Selecciona un icono.");
    if (days.length === 0) return Alert.alert("Días", "Elige al menos un día.");
    if (times.length === 0)
      return Alert.alert("Horarios", "Agrega al menos un horario.");

    // ✅ CORREGIDO: Usar offlineAuthService como fallback
    const userId = auth.currentUser?.uid || offlineAuthService.getCurrentUid();

    if (!userId) {
      return Alert.alert("Error", "Debe iniciar sesión.");
    }

    const sortedTimes = [...times].sort();

    try {
      const habitId =
        isEdit && habit?.id
          ? habit.id
          : `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const habitData = {
        id: habitId,
        name: name.trim(),
        icon,
        lib,
        priority,
        days,
        times: sortedTimes,
        createdAt: (habit as any)?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isArchived: false,
      };

      if (isEdit && habit?.id) {
        await syncQueueService.enqueue(
          "UPDATE",
          "habits",
          habit.id,
          userId, // ✅ Usar userId
          habitData
        );
      } else {
        await syncQueueService.enqueue(
          "CREATE",
          "habits",
          habitId,
          userId, // ✅ Usar userId
          habitData
        );
      }

      // Programar alarmas (localmente siempre, para que suenen)
      await scheduleRecurringHabitAlarms({
        id: habitId,
        name: name.trim(),
        times: sortedTimes,
        days,
        icon,
        lib,
        ownerUid: userId, // ✅ Pasar userId
      });

      Alert.alert(
        "Listo",
        isEdit ? "Hábito actualizado." : "Hábito creado correctamente."
      );

      navigation.goBack();
    } catch (e: any) {
      console.log(e);
      Alert.alert("Error", e?.message ?? "No se pudo guardar el hábito");
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>
          {isEdit ? "Editar hábito" : "Nuevo hábito"}
        </Text>

        <View style={styles.card}>
          {/* Nombre */}
          <Text style={styles.label}>Nombre del hábito</Text>
          <TextInput
            style={styles.input}
            placeholder="Ej. Beber agua"
            value={name}
            onChangeText={setName}
            placeholderTextColor={COLORS.textSecondary}
          />

          {/* Iconos */}
          <Text style={[styles.label, { marginTop: 12 }]}>Icono</Text>
          <View style={styles.iconRow}>
            {QUICK_ICONS.map((it, i) => {
              const IconCmp =
                it.lib === "FontAwesome5" ? FontAwesome5 : MaterialIcons;
              const selected = icon === it.icon && lib === it.lib;

              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.iconBox, selected && styles.iconBoxSelected]}
                  onPress={() => {
                    setIcon(it.icon);
                    setLib(it.lib);
                  }}
                >
                  <IconCmp
                    name={it.icon as any}
                    size={22}
                    color={selected ? COLORS.surface : COLORS.text}
                  />
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Días */}
          <Text style={[styles.label, { marginTop: 12 }]}>Repetir días</Text>
          <View style={styles.daysRow}>
            {DAY_LABELS.map((label, idx) => {
              const active = days.includes(idx);
              return (
                <TouchableOpacity
                  key={idx}
                  style={[styles.dayBox, active && styles.dayBoxSelected]}
                  onPress={() => toggleDay(idx)}
                >
                  <Text
                    style={[styles.dayText, active && styles.dayTextSelected]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Horas */}
          <Text style={[styles.label, { marginTop: 12 }]}>Horarios</Text>
          <View style={styles.timeRow}>
            <TimePickerField
              value={newTime}
              onChange={setNewTime}
              mode="point"
            />
            <TouchableOpacity style={styles.addTimeBtn} onPress={addTime}>
              <Text style={styles.addTimeText}>Agregar</Text>
            </TouchableOpacity>
          </View>

          {!!times.length && (
            <View style={styles.timesList}>
              {times.map((t) => (
                <View key={t} style={styles.timeChip}>
                  <Text style={styles.timeChipText}>
                    {formatHHMMDisplay(t)}
                  </Text>
                  <TouchableOpacity
                    style={styles.timeChipRemove}
                    onPress={() => removeTime(t)}
                  >
                    <MaterialIcons name="close" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Prioridad */}
          <Text style={[styles.label, { marginTop: 12 }]}>Prioridad</Text>
          <View style={styles.priorityRow}>
            {(["baja", "normal", "alta"] as const).map((p) => {
              const active = priority === p;
              return (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.priorityBox,
                    active && styles.priorityBoxSelected,
                  ]}
                  onPress={() => setPriority(p)}
                >
                  <Text
                    style={[
                      styles.priorityText,
                      active && styles.priorityTextSelected,
                    ]}
                  >
                    {p.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Guardar */}
          <TouchableOpacity style={styles.primaryBtn} onPress={save}>
            <Text style={styles.primaryText}>
              {isEdit ? "Guardar cambios" : "Confirmar"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* === ESTILOS === */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
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
    gap: 10,
  },
  label: {
    fontSize: FONT_SIZES.small,
    fontWeight: "700",
    color: COLORS.text,
  },
  input: {
    height: 40,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginTop: 4,
    color: COLORS.text,
  },
  iconRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 6,
  },
  iconBox: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBoxSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  daysRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  dayBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dayBoxSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  dayText: { color: COLORS.text },
  dayTextSelected: { color: COLORS.surface, fontWeight: "800" },

  timeRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginTop: 6,
  },
  addTimeBtn: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addTimeText: {
    color: COLORS.primary,
    fontWeight: "700",
  },

  timesList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  timeChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  timeChipText: {
    color: COLORS.surface,
    fontWeight: "700",
    marginRight: 4,
  },
  timeChipRemove: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },

  priorityRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  priorityBox: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  priorityBoxSelected: {
    backgroundColor: COLORS.secondary,
    borderColor: COLORS.secondary,
  },
  priorityText: {
    color: COLORS.text,
    fontWeight: "700",
  },
  priorityTextSelected: {
    color: COLORS.surface,
  },

  primaryBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 10,
  },
  primaryText: {
    color: COLORS.surface,
    fontWeight: "800",
    fontSize: FONT_SIZES.medium,
  },
});
