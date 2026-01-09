// src/screens/reminders/NewReminderScreen.tsx

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import { COLORS, FONT_SIZES } from "../../../types";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";
import { useRoute } from "@react-navigation/native";

import { OfflineBanner } from "../../components/OfflineBanner";
import { formatHHMMDisplay } from "../../utils/timeUtils";
import { useHabits } from "../../hooks/useHabits";

type Nav = StackNavigationProp<RootStackParamList, "NewReminder">;

const DAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

export default function NewReminderScreen({ navigation }: { navigation: Nav }) {
  const route = useRoute<any>();

  const {
    habits,
    selectedId,
    selectedHabit,
    loading,
    pendingChanges,
    isCaregiverView,
    blocked,

    toggleSelect,
    onAdd,
    onEdit,
    onArchive,
  } = useHabits({
    navigation,
    routeParams: route.params,
  });

  /* ============================================================
   *  BLOQUEO TOTAL (alerts-only / disabled)
   * ============================================================ */
  if (blocked) {
    return (
      <SafeAreaView style={styles.safe}>
        <OfflineBanner pendingChanges={pendingChanges} />

        <View style={styles.center}>
          <MaterialIcons
            name="notifications-active"
            size={48}
            color={COLORS.textSecondary}
          />

          <Text style={styles.emptyTitle}>Acceso limitado</Text>

          <Text style={styles.emptyText}>
            Este contacto solo recibe alertas del paciente.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  /* ============================================================
   * Render helpers
   * ============================================================ */
  const renderPriorityChip = (p?: string) => {
    const label = p === "alta" ? "Alta" : p === "baja" ? "Baja" : "Normal";
    const bg =
      p === "alta" ? "#d32f2f" : p === "baja" ? "#455a64" : COLORS.secondary;

    return (
      <View style={[styles.chip, { backgroundColor: bg }]}>
        <Text style={styles.chipText}>{label}</Text>
      </View>
    );
  };

  const renderDays = (days?: number[]) => {
    if (!days || days.length === 0) return null;
    return (
      <View style={styles.daysRow}>
        {DAY_LABELS.map((d, idx) => {
          const active = days.includes(idx);
          return (
            <View
              key={idx}
              style={[
                styles.dayPill,
                active ? styles.dayPillActive : styles.dayPillInactive,
              ]}
            >
              <Text
                style={[styles.dayPillText, active && styles.dayPillTextActive]}
              >
                {d}
              </Text>
            </View>
          );
        })}
      </View>
    );
  };

  const renderTimes = (times?: string[]) => {
    if (!times || times.length === 0) return null;
    return (
      <View style={styles.timesRow}>
        {times.map((t, i) => (
          <View key={i} style={styles.timeChip}>
            <Text style={styles.timeChipText}>{formatHHMMDisplay(t)}</Text>
          </View>
        ))}
      </View>
    );
  };

  /* ============================================================
   * UI
   * ============================================================ */
  return (
    <SafeAreaView style={styles.safe}>
      <OfflineBanner pendingChanges={pendingChanges} />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Hábitos y recordatorios</Text>
            <Text style={styles.subtitle}>
              Crea hábitos diarios con horarios y notificaciones
            </Text>
          </View>
          <View style={styles.sectionIcon}>
            <MaterialIcons name="add-alert" size={24} color={COLORS.surface} />
          </View>
        </View>

        {/* Banner cuidador */}
        {isCaregiverView && (
          <View style={styles.caregiverBanner}>
            <Text style={styles.caregiverText}>
              Estás viendo los hábitos de un paciente.
            </Text>
          </View>
        )}

        <View style={styles.panel}>
          {loading ? (
            <Text style={{ color: COLORS.textSecondary, marginBottom: 8 }}>
              Cargando hábitos...
            </Text>
          ) : habits.length === 0 ? (
            <Text style={{ color: COLORS.textSecondary, marginBottom: 8 }}>
              Aún no hay hábitos registrados.
            </Text>
          ) : null}

          {habits.map((h) => {
            const IconCmp =
              h.lib === "FontAwesome5" ? FontAwesome5 : MaterialIcons;
            const selected = h.id === selectedId;

            return (
              <TouchableOpacity
                key={h.id}
                style={[styles.habitCard, selected && styles.habitCardSelected]}
                activeOpacity={0.85}
                onPress={() => toggleSelect(h.id!)}
              >
                <View style={styles.cardHeaderRow}>
                  <View style={styles.iconTitleRow}>
                    <View style={styles.iconWrap}>
                      <IconCmp
                        name={(h.icon || "check-circle") as any}
                        size={18}
                        color={COLORS.surface}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.habitName}>{h.name}</Text>
                      {renderPriorityChip(h.priority)}
                    </View>
                  </View>

                  {selected ? (
                    <View style={styles.selectedPill}>
                      <MaterialIcons
                        name="check-circle"
                        size={16}
                        color="#fff"
                      />
                      <Text style={styles.selectedPillText}>Seleccionado</Text>
                    </View>
                  ) : (
                    <MaterialIcons
                      name="radio-button-unchecked"
                      size={18}
                      color={COLORS.border}
                    />
                  )}
                </View>

                {renderDays(h.days)}
                {renderTimes(h.times)}
              </TouchableOpacity>
            );
          })}

          {/* Acciones */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.primaryBtn]}
              onPress={onAdd}
            >
              <Text style={styles.actionText}>Agregar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionBtn,
                styles.primaryBtn,
                !selectedHabit && styles.actionDisabled,
              ]}
              disabled={!selectedHabit}
              onPress={onEdit}
            >
              <Text style={styles.actionText}>Editar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionBtn,
                styles.dangerBtn,
                !selectedHabit && styles.actionDisabled,
              ]}
              disabled={!selectedHabit}
              onPress={onArchive}
            >
              <Text style={styles.actionText}>Eliminar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ============================================================
 * Styles
 * ============================================================ */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1 },
  content: { padding: 8, paddingBottom: 24 },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  title: { fontSize: FONT_SIZES.xlarge, fontWeight: "800", color: COLORS.text },
  subtitle: {
    marginTop: 4,
    fontSize: FONT_SIZES.medium,
    color: COLORS.textSecondary,
  },
  sectionIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.secondary,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },

  caregiverBanner: {
    marginBottom: 10,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#E0F2FE",
  },
  caregiverText: {
    fontSize: FONT_SIZES.small,
    color: "#0F172A",
  },

  panel: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
  },

  blockedTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 6,
  },
  blockedText: {
    fontSize: FONT_SIZES.medium,
    color: COLORS.textSecondary,
  },

  habitCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    marginBottom: 10,
  },
  habitCardSelected: {
    borderColor: COLORS.primary,
  },

  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  iconTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 10,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  habitName: {
    fontSize: FONT_SIZES.large,
    fontWeight: "800",
    color: COLORS.text,
  },

  chip: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  chipText: {
    color: "#fff",
    fontSize: FONT_SIZES.small,
    fontWeight: "700",
  },

  selectedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  selectedPillText: { color: "#fff", fontWeight: "700", fontSize: 12 },

  daysRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  dayPill: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dayPillInactive: { backgroundColor: "#E0E0E0" },
  dayPillActive: { backgroundColor: COLORS.primary },
  dayPillText: {
    fontSize: FONT_SIZES.small,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  dayPillTextActive: { color: COLORS.surface },

  timesRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  timeChip: {
    backgroundColor: COLORS.secondary,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  timeChipText: {
    color: COLORS.surface,
    fontSize: 12,
    fontWeight: "700",
  },

  actionsRow: {
    flexDirection: "row",
    marginTop: 14,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginHorizontal: 4,
  },
  primaryBtn: { backgroundColor: COLORS.primary },
  dangerBtn: { backgroundColor: "#D32F2F" },
  actionText: {
    color: COLORS.surface,
    fontWeight: "800",
    fontSize: FONT_SIZES.medium,
  },
  actionDisabled: { opacity: 0.4 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  emptyTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: "700",
    color: COLORS.text,
    marginTop: 12,
    marginBottom: 4,
  },

  emptyText: {
    fontSize: FONT_SIZES.small,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: 8,
  },
});
