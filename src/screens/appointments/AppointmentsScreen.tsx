// src/screens/appointments/AppointmentsScreen.tsx
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Modal,
  Pressable,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { COLORS, FONT_SIZES } from "../../../types";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRoute, RouteProp } from "@react-navigation/native";

import { OfflineBanner } from "../../components/OfflineBanner";
import { useAppointments } from "../../hooks/useAppointments";

type Nav = StackNavigationProp<RootStackParamList, "Appointments">;
type Route = RouteProp<RootStackParamList, "Appointments">;

export default function AppointmentsScreen({
  navigation,
}: {
  navigation: Nav;
}) {
  const route = useRoute<Route>();

  const {
    canModify,
    isCaregiverView,
    loading,
    pendingChanges,

    upcomingAppointments,
    selectedApptId,
    selectedAppt,
    blocked,
    showCal,
    setShowCal,
    cursor,
    selectedDate,
    setSelectedDate,
    monthMatrix,
    monthKeyMap,
    selectedItems,
    monthLabel,
    today,
    isSameDay,

    formatApptDateTime,
    formatTime12,
    toISO,

    toggleSelect,
    goAdd,
    goEdit,
    removeSelected,
    goPrevMonth,
    goNextMonth,
  } = useAppointments({ navigation, routeParams: route.params as any });
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
  return (
    <SafeAreaView style={styles.safe}>
      <OfflineBanner pendingChanges={pendingChanges} />

      <StatusBar
        barStyle="light-content"
        backgroundColor={COLORS.primary}
        translucent={false}
      />

      <View style={styles.wrapper}>
        <ScrollView
          style={styles.container}
          showsVerticalScrollIndicator={false}
          bounces={true}
        >
          <View style={styles.content}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Citas médicas</Text>
              </View>

              <TouchableOpacity
                style={styles.sectionIcon}
                onPress={() => setShowCal(true)}
                accessibilityLabel="Abrir mini calendario"
              >
                <MaterialIcons name="event" size={26} color={COLORS.surface} />
              </TouchableOpacity>
            </View>

            {isCaregiverView && (
              <View style={styles.caregiverBanner}>
                <Text style={styles.caregiverText}>
                  Estás viendo las citas de un paciente.
                </Text>
              </View>
            )}

            <View style={styles.panel}>
              {loading ? (
                <Text style={{ color: COLORS.textSecondary, marginBottom: 12 }}>
                  Cargando citas...
                </Text>
              ) : upcomingAppointments.length === 0 ? (
                <Text style={{ color: COLORS.textSecondary, marginBottom: 12 }}>
                  No hay próximas citas registradas.
                </Text>
              ) : null}

              {upcomingAppointments.map((a) => {
                const selected = a.id === selectedApptId;
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[
                      styles.appointmentCard,
                      selected && styles.appointmentCardSelected,
                    ]}
                    onPress={() => toggleSelect(a.id)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.cardHeaderRow}>
                      <Text style={styles.appointmentTitle}>
                        {a.doctor ?? a.title}
                      </Text>

                      {selected ? (
                        <View style={styles.selectedPill}>
                          <MaterialIcons
                            name="check-circle"
                            size={16}
                            color="#fff"
                          />
                          <Text style={styles.selectedPillText}>
                            Seleccionada
                          </Text>
                        </View>
                      ) : (
                        <MaterialIcons
                          name="radio-button-unchecked"
                          size={18}
                          color={COLORS.border}
                        />
                      )}
                    </View>

                    <View style={styles.chip}>
                      <Text style={styles.chipText}>
                        {formatApptDateTime(a.date, a.time)}
                      </Text>
                    </View>

                    {a.doctor && a.title ? (
                      <Text style={styles.locationText}>{a.title}</Text>
                    ) : null}
                    {a.location ? (
                      <Text style={styles.locationText}>{a.location}</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}

              {canModify && (
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.primaryBtn]}
                    onPress={goAdd}
                  >
                    <Text style={styles.actionText}>Agregar</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.actionBtn,
                      styles.primaryBtn,
                      !selectedAppt && { opacity: 0.5 },
                    ]}
                    disabled={!selectedAppt}
                    onPress={goEdit}
                  >
                    <Text style={styles.actionText}>Editar</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.actionBtn,
                      styles.dangerBtn,
                      !selectedAppt && { opacity: 0.5 },
                    ]}
                    disabled={!selectedAppt}
                    onPress={removeSelected}
                  >
                    <Text style={styles.actionText}>Eliminar </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      </View>

      {/* Mini Calendario (Modal) */}
      <Modal
        visible={showCal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCal(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setShowCal(false)}>
          <Pressable style={styles.calendarCard} onPress={() => {}}>
            <View style={styles.calHeader}>
              <TouchableOpacity onPress={goPrevMonth} style={styles.navBtn}>
                <MaterialIcons
                  name="chevron-left"
                  size={22}
                  color={COLORS.text}
                />
              </TouchableOpacity>
              <Text style={styles.calTitle}>
                {monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}
              </Text>
              <TouchableOpacity onPress={goNextMonth} style={styles.navBtn}>
                <MaterialIcons
                  name="chevron-right"
                  size={22}
                  color={COLORS.text}
                />
              </TouchableOpacity>
            </View>

            <View style={styles.weekRow}>
              {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
                <Text key={d} style={styles.weekCell}>
                  {d}
                </Text>
              ))}
            </View>

            {monthMatrix.map((row, rIdx) => (
              <View key={`r-${rIdx}`} style={styles.daysRow}>
                {row.map((date, cIdx) => {
                  const inMonth = date.getMonth() === cursor.getMonth();
                  const iso = toISO(date);
                  const hasAppts = (monthKeyMap.get(iso) ?? []).length > 0;
                  const isToday2 = isSameDay(date, today);
                  const isSelected =
                    selectedDate && isSameDay(date, selectedDate);

                  return (
                    <TouchableOpacity
                      key={`c-${cIdx}`}
                      style={[
                        styles.dayCell,
                        !inMonth && { opacity: 0.35 },
                        isSelected && { borderColor: COLORS.primary },
                      ]}
                      onPress={() => setSelectedDate(date)}
                    >
                      <Text
                        style={[
                          styles.dayText,
                          isToday2 && { fontWeight: "800" },
                        ]}
                      >
                        {date.getDate()}
                      </Text>
                      {hasAppts && <View style={styles.dot} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}

            <View style={styles.dayList}>
              <Text style={styles.dayListTitle}>
                {selectedDate
                  ? selectedDate.toLocaleDateString("es-MX", {
                      weekday: "long",
                      day: "2-digit",
                      month: "short",
                    })
                  : "Selecciona un día"}
              </Text>

              {selectedItems.length === 0 ? (
                <Text style={styles.emptyText}>Sin citas próximas</Text>
              ) : (
                selectedItems.map((a) => (
                  <View key={a.id} style={styles.dayItem}>
                    <View style={styles.dayItemChip}>
                      <Text style={styles.dayItemChipText}>
                        {formatTime12(a.time)}
                      </Text>
                    </View>
                    <Text style={styles.dayItemText}>
                      {a.doctor ?? a.title}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

/* ===================== ESTILOS ===================== */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  wrapper: { flex: 1 },
  container: { flex: 1 },
  content: { padding: 8, paddingBottom: 24 },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
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
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },

  caregiverBanner: {
    marginBottom: 10,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#E0F2FE",
  },
  caregiverText: { fontSize: FONT_SIZES.small, color: "#0F172A" },

  panel: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },

  appointmentCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 12,
  },
  appointmentCardSelected: {
    borderColor: COLORS.primary,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
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

  locationText: { marginTop: 6, color: COLORS.textSecondary },
  appointmentTitle: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: FONT_SIZES.large,
    marginBottom: 4,
  },

  chip: {
    alignSelf: "flex-start",
    backgroundColor: COLORS.secondary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    color: COLORS.surface,
    fontWeight: "700",
    fontSize: FONT_SIZES.small,
  },

  actionsRow: { flexDirection: "row", gap: 12, marginTop: 6 },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtn: { backgroundColor: COLORS.primary },
  dangerBtn: { backgroundColor: "#D32F2F" },
  actionText: {
    color: COLORS.surface,
    fontWeight: "800",
    fontSize: FONT_SIZES.medium,
  },

  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.28)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  calendarCard: {
    width: "92%",
    maxWidth: 420,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  calHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  calTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: "800",
    color: COLORS.text,
    textTransform: "capitalize",
  },
  navBtn: { padding: 6 },

  weekRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  weekCell: {
    width: `${100 / 7}%`,
    textAlign: "center",
    color: COLORS.textSecondary,
    fontWeight: "700",
  },

  daysRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dayText: { color: COLORS.text, fontSize: FONT_SIZES.medium },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.secondary,
    marginTop: 4,
  },

  dayList: { marginTop: 10 },
  dayListTitle: {
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 6,
    textTransform: "capitalize",
  },
  emptyText: { color: COLORS.textSecondary },
  dayItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  dayItemChip: {
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  dayItemChipText: { color: COLORS.surface, fontWeight: "700" },
  dayItemText: { color: COLORS.text, flex: 1, fontWeight: "600" },
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
});
