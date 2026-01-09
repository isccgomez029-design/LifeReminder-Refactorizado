// src/screens/history/HistoryScreen.tsx

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import { COLORS, FONT_SIZES } from "../../../types";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";
import { useRoute, RouteProp } from "@react-navigation/native";

import { formatHHMMDisplay } from "../../utils/timeUtils";

import { useHistory, HistoryItem } from "../../hooks/useHistory";

type Nav = StackNavigationProp<RootStackParamList, "History">;
type Route = RouteProp<RootStackParamList, "History">;

export default function HistoryScreen({ navigation }: { navigation: Nav }) {
  const route = useRoute<Route>();

  const {
    isLoading,
    ownerUid,
    isCaregiverView,
    blocked,

    filterType,
    filterDay,
    setFilterType,
    setFilterDay,

    filteredItems,
    DAY_LABELS,
  } = useHistory({ route });
  /* ============================================================
   *  BLOQUEO TOTAL (alerts-only / disabled)
   * ============================================================ */
  if (blocked) {
    return (
      <SafeAreaView style={styles.safe}>
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
  const renderItemCard = (item: HistoryItem) => {
    if (item.kind === "habit" && item.habit) {
      const h = item.habit;
      return (
        <View key={`habit-${h.id}`} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconCircle, { backgroundColor: "#6366F1" }]}>
              {h.lib === "FontAwesome5" ? (
                <FontAwesome5 name={h.icon || "check"} size={16} color="#FFF" />
              ) : (
                <MaterialIcons
                  name={(h.icon as any) || "check-circle"}
                  size={16}
                  color="#FFF"
                />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{h.name}</Text>
              <Text style={styles.cardSubtitle}>Hábito</Text>
            </View>
            <View
              style={[
                styles.typeChip,
                {
                  backgroundColor:
                    h.priority === "alta"
                      ? "#EF4444"
                      : h.priority === "baja"
                      ? "#6B7280"
                      : "#6366F1",
                },
              ]}
            >
              <Text style={styles.typeChipText}>
                {h.priority === "alta"
                  ? "Alta"
                  : h.priority === "baja"
                  ? "Baja"
                  : "Normal"}
              </Text>
            </View>
          </View>

          {h.days && h.days.length > 0 && (
            <View style={styles.daysRow}>
              {DAY_LABELS.map((d, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.dayPill,
                    h.days?.includes(idx)
                      ? styles.dayPillActive
                      : styles.dayPillInactive,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayPillText,
                      h.days?.includes(idx) && styles.dayPillTextActive,
                    ]}
                  >
                    {d}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {h.times && h.times.length > 0 && (
            <View style={styles.timesRow}>
              {h.times.map((t, i) => (
                <View key={i} style={styles.timeChip}>
                  <Text style={styles.timeChipText}>
                    {formatHHMMDisplay(t)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {h.archivedAt && (
            <Text style={styles.footerText}>
              Archivado: {new Date(h.archivedAt).toLocaleDateString("es-MX")}
            </Text>
          )}
        </View>
      );
    }

    if (item.kind === "med" && item.medication) {
      const m = item.medication;
      return (
        <View key={`med-${m.id}`} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconCircle, { backgroundColor: "#EF4444" }]}>
              <FontAwesome5 name="pills" size={16} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{m.nombre}</Text>
              <Text style={styles.cardSubtitle}>Medicamento</Text>
            </View>
          </View>

          {m.dosis && <Text style={styles.bodyText}>Dosis: {m.dosis}</Text>}
          {m.frecuencia && (
            <Text style={styles.bodyText}>Frecuencia: {m.frecuencia}</Text>
          )}

          {m.archivedAt && (
            <Text style={styles.footerText}>
              Archivado: {new Date(m.archivedAt).toLocaleDateString("es-MX")}
            </Text>
          )}
        </View>
      );
    }

    if (item.kind === "appointment" && item.appointment) {
      const a = item.appointment;
      return (
        <View key={`appt-${a.id}`} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconCircle, { backgroundColor: "#3B82F6" }]}>
              <MaterialIcons name="event" size={16} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{a.title}</Text>
              <Text style={styles.cardSubtitle}>Cita médica</Text>
            </View>
          </View>

          {a.doctor && <Text style={styles.bodyText}>Doctor: {a.doctor}</Text>}
          {a.location && (
            <Text style={styles.bodyText}>Lugar: {a.location}</Text>
          )}
          {a.date && (
            <Text style={styles.bodyText}>
              Fecha: {a.date} {a.time ? `a las ${a.time}` : ""}
            </Text>
          )}

          {a.archivedAt ? (
            <Text style={styles.footerText}>
              Archivado: {new Date(a.archivedAt).toLocaleDateString("es-MX")}
            </Text>
          ) : (
            <Text style={styles.footerText}>Cita pasada</Text>
          )}
        </View>
      );
    }

    return null;
  };

  if (!ownerUid) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.emptyContainer}>
            <MaterialIcons
              name="history"
              size={64}
              color={COLORS.textSecondary}
            />
            <Text style={styles.emptyTitle}>Sin acceso</Text>
            <Text style={styles.emptyText}>
              Inicia sesión para ver tu historial
            </Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>
            {isCaregiverView ? "Historial del paciente" : "Mi historial"}
          </Text>

          {isCaregiverView && (
            <View style={styles.caregiverBanner}>
              <Text style={styles.caregiverText}>
                👁️ Viendo historial de tu paciente (solo lectura)
              </Text>
            </View>
          )}

          <View style={styles.filtersBlock}>
            <Text style={styles.filterLabel}>Filtrar por tipo:</Text>
            <View style={styles.filterRow}>
              {[
                { key: "all", label: "Todo" },
                { key: "habit", label: "Hábitos" },
                { key: "med", label: "Medicamentos" },
                { key: "appointment", label: "Citas" },
              ].map((f) => (
                <TouchableOpacity
                  key={f.key}
                  style={[
                    styles.filterChip,
                    filterType === f.key && styles.filterChipActive,
                  ]}
                  onPress={() =>
                    setFilterType(
                      f.key as "all" | "habit" | "appointment" | "med"
                    )
                  }
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      filterType === f.key && styles.filterChipTextActive,
                    ]}
                  >
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {filterType === "habit" && (
              <>
                <Text style={[styles.filterLabel, { marginTop: 10 }]}>
                  Filtrar por día:
                </Text>
                <View style={styles.filterRow}>
                  <TouchableOpacity
                    style={[
                      styles.filterChip,
                      filterDay === null && styles.filterChipActive,
                    ]}
                    onPress={() => setFilterDay(null)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        filterDay === null && styles.filterChipTextActive,
                      ]}
                    >
                      Todos
                    </Text>
                  </TouchableOpacity>

                  {DAY_LABELS.map((d, idx) => {
                    const active = filterDay === idx;
                    return (
                      <TouchableOpacity
                        key={idx}
                        style={[
                          styles.filterChip,
                          active && styles.filterChipActive,
                        ]}
                        onPress={() =>
                          setFilterDay((prev) => (prev === idx ? null : idx))
                        }
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            active && styles.filterChipTextActive,
                          ]}
                        >
                          {d}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}
          </View>

          {/* Estado de carga */}
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Cargando historial...</Text>
            </View>
          ) : filteredItems.length === 0 ? (
            <View style={styles.emptyContainer}>
              <MaterialIcons
                name="history"
                size={64}
                color={COLORS.textSecondary}
              />
              <Text style={styles.emptyTitle}>No hay registros</Text>
              <Text style={styles.emptyText}>
                {filterType !== "all" || filterDay !== null
                  ? "No hay registros que coincidan con los filtros seleccionados."
                  : "No has archivado ningún hábito, medicamento o cita todavía."}
              </Text>
              <Text style={styles.emptyHint}>
                • Los hábitos aparecen después de archivarlos desde "Hábitos y
                recordatorios"{"\n"}• Los medicamentos aparecen después de
                archivarlos desde "Medicamentos de hoy"{"\n"}• Las citas
                aparecen después de que pasan o se archivan
              </Text>
            </View>
          ) : (
            filteredItems.map(renderItemCard)
          )}

          <TouchableOpacity
            style={styles.backTopBtn}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backTopText}>Volver</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/* ===================== ESTILOS ===================== */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  safe: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },

  title: {
    fontSize: FONT_SIZES.xlarge,
    fontWeight: "800",
    color: COLORS.text,
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 12,
    fontSize: FONT_SIZES.medium,
    color: COLORS.textSecondary,
  },

  caregiverBanner: {
    backgroundColor: "#E0F2FE",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  caregiverText: {
    fontSize: FONT_SIZES.small,
    color: "#0F172A",
  },

  filtersBlock: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 12,
  },
  filterLabel: {
    fontSize: FONT_SIZES.small,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: COLORS.background,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterChipText: {
    fontSize: FONT_SIZES.small,
    color: COLORS.text,
    fontWeight: "600",
  },
  filterChipTextActive: {
    color: "#FFF",
  },

  loadingContainer: {
    padding: 40,
    alignItems: "center",
  },
  loadingText: {
    fontSize: FONT_SIZES.medium,
    color: COLORS.textSecondary,
    marginTop: 12,
  },

  emptyContainer: {
    padding: 40,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: "700",
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: FONT_SIZES.medium,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginBottom: 16,
  },
  emptyHint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 18,
    fontStyle: "italic",
  },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  cardTitle: {
    fontSize: FONT_SIZES.medium,
    fontWeight: "700",
    color: COLORS.text,
  },
  cardSubtitle: {
    fontSize: FONT_SIZES.small,
    color: COLORS.textSecondary,
  },
  bodyText: {
    fontSize: FONT_SIZES.small,
    color: COLORS.text,
    marginTop: 4,
  },
  footerText: {
    marginTop: 8,
    fontSize: 11,
    color: COLORS.textSecondary,
    fontStyle: "italic",
  },

  typeChip: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  typeChipText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "700",
  },

  daysRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  dayPill: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  dayPillInactive: {
    backgroundColor: "#E5E7EB",
  },
  dayPillActive: {
    backgroundColor: COLORS.primary,
  },
  dayPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  dayPillTextActive: {
    color: "#FFF",
  },

  timesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  timeChip: {
    backgroundColor: COLORS.secondary,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  timeChipText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
  },

  backTopBtn: {
    marginTop: 20,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
  },
  backTopText: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: FONT_SIZES.medium,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
