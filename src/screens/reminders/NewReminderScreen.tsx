// src/screens/reminders/NewReminderScreen.tsx

import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import { COLORS, FONT_SIZES } from "../../../types";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";

import { useRoute, RouteProp, useFocusEffect } from "@react-navigation/native";
import { offlineAuthService } from "../../services/offline/OfflineAuthService";
// 🔥 Firebase Auth
import { auth, db } from "../../config/firebaseConfig";
import { collection, query, where, onSnapshot } from "firebase/firestore";

// 🔹 Servicio de hábitos
import { type HabitWithArchive } from "../../services/habitsService";

// ⏰ Utils
import { formatHHMMDisplay } from "../../utils/timeUtils";

// ✅ Imports agregados (Sync)
import { syncQueueService } from "../../services/offline/SyncQueueService";
import NetInfo from "@react-native-community/netinfo";
import { OfflineBanner } from "../../components/OfflineBanner";

// ✅ CAMBIO 5: Actualizar imports
import { archiveHabit } from "../../utils/archiveHelpers";

type Nav = StackNavigationProp<RootStackParamList, "NewReminder">;
type Route = RouteProp<RootStackParamList, "NewReminder">;

const DAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

export default function NewReminderScreen({ navigation }: { navigation: Nav }) {
  const route = useRoute<Route>();

  const [habits, setHabits] = useState<HabitWithArchive[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ✅ Estados agregados
  const [isOnline, setIsOnline] = useState(true);
  const [isFromCache, setIsFromCache] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(0);
  const [loading, setLoading] = useState(true);

  // 🔑 dueño real de los hábitos (paciente o usuario logueado)
  const loggedUserUid =
    auth.currentUser?.uid || offlineAuthService.getCurrentUid();
  const ownerUid = route.params?.patientUid ?? loggedUserUid ?? null;
  const isCaregiverView =
    !!route.params?.patientUid && route.params.patientUid !== loggedUserUid;
  const canModify = ownerUid === loggedUserUid;

  // ✅ CAMBIO 1: Simplificar reloadFromCache
  const reloadFromCache = React.useCallback(async () => {
    if (!ownerUid) return;

    try {
      console.log("🔄 Recargando hábitos desde cache...");

      const cached = await syncQueueService.getFromCache<any>(
        "habits",
        ownerUid
      );

      if (cached?.data && cached.data.length > 0) {
        const items = cached.data.filter(
          (h: any) => !h.isArchived
        ) as HabitWithArchive[];

        console.log(`✅ Mostrando ${items.length} hábitos`);
        setHabits(items);
        setIsFromCache(true);
      }
    } catch (error) {
      console.log("Error cache hábitos:", error);
    }
  }, [ownerUid]);

  // ✅ useFocusEffect para recargar cache - YA ESTÁ PRESENTE:
  useFocusEffect(
    React.useCallback(() => {
      console.log("👁️ NewReminderScreen recibió el foco");
      reloadFromCache();
    }, [reloadFromCache])
  );
  // ================== CONNECTIVITY MONITOR ==================
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online =
        state.isConnected === true && state.isInternetReachable !== false;
      setIsOnline(online);

      if (online) {
        syncQueueService.processQueue().then(() => {
          syncQueueService.getPendingCount().then(setPendingChanges);
        });
      }
    });

    syncQueueService.getPendingCount().then(setPendingChanges);
    return () => unsubscribe();
  }, []);

  // ✅ Cargar hábitos desde cache al iniciar
  useEffect(() => {
    const loadFromCache = async () => {
      const userId =
        auth.currentUser?.uid || offlineAuthService.getCurrentUid();
      if (!userId) return;

      try {
        const cached = await syncQueueService.getFromCache("habits", userId);
        if (cached && cached.data.length > 0) {
          console.log("📦 Hábitos desde cache:", cached.data.length);
          const items = cached.data.filter(
            (h: any) => !h.isArchived
          ) as HabitWithArchive[];
          setHabits(items);
        }
      } catch (error) {
        console.log("Error cache hábitos:", error);
      }
    };

    loadFromCache();
  }, []);

  // ================== Cargar hábitos activos ==================
  useEffect(() => {
    const userId = ownerUid;
    if (!userId) return;

    let isMounted = true;
    let unsubscribe: (() => void) | null = null;

    const loadHabits = async () => {
      try {
        setLoading(true);

        // 1. Cargar desde cache
        const cached = await syncQueueService.getFromCache<any>(
          "habits",
          userId
        );

        if (cached?.data && isMounted) {
          console.log(`📦 Cache: ${cached.data.length} hábitos`);
          const processedHabits = cached.data.map((data: any) => ({
            id: data.id,
            name: data.name || "",
            icon: data.icon,
            lib: data.lib,
            priority: data.priority,
            days: data.days || [],
            times: data.times || [],
          }));

          setHabits(processedHabits);
          setIsFromCache(true);
          setLoading(false);
        }

        // 2. Listener de Firebase
        const habitsRef = collection(db, "users", userId, "habits");
        const q = query(habitsRef);

        unsubscribe = onSnapshot(
          q,
          async (snapshot) => {
            if (!isMounted) return;

            console.log(
              "🔥 [FIREBASE] Snapshot:",
              snapshot.docs.length,
              "docs"
            );

            const items = snapshot.docs.map((d) => ({
              id: d.id,
              ...d.data(),
            }));

            await syncQueueService.saveToCache("habits", userId, items);

            const merged = await syncQueueService.getFromCache<any>(
              "habits",
              userId
            );

            if (merged?.data) {
              const finalHabits = merged.data.filter(
                (h: any) => !h.isArchived
              ) as HabitWithArchive[];

              setHabits(finalHabits);
              setIsFromCache(false);
              setLoading(false);
            }
          },
          (error) => {
            console.log("❌ Firebase error:", error);
          }
        );
      } catch (error) {
        console.log("❌ Error cargando hábitos:", error);
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadHabits();

    return () => {
      isMounted = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [ownerUid]);
  
  const selectedHabit = useMemo(
    () => habits.find((h) => h.id === selectedId),
    [habits, selectedId]
  );

  // ✅ Función de crear con SyncQueue
  const handleCreateReminder = async (reminderData: any) => {
    try {
      const userId =
        auth.currentUser?.uid || offlineAuthService.getCurrentUid();
      if (!userId) {
        Alert.alert("Error", "No autenticado");
        return;
      }

      const tempId = `temp_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      const newReminder = {
        id: tempId,
        ...reminderData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isArchived: false,
      };

      // Encolar operación
      await syncQueueService.enqueue(
        "CREATE",
        "habits",
        tempId,
        userId,
        newReminder
      );
      await syncQueueService.addToCacheItem("habits", userId, newReminder);
      await syncQueueService.saveLocalData(
        "habits",
        tempId,
        userId,
        newReminder
      );

      const pending = await syncQueueService.getPendingCount();
      setPendingChanges(pending);

      Alert.alert("✅ Listo", "Recordatorio creado");
      navigation.goBack();
    } catch (error) {
      console.log("Error:", error);
      Alert.alert("Error", "No se pudo crear");
    }
  };

  const onAdd = () => {
    if (!canModify) {
      Alert.alert(
        "Solo lectura",
        "No puedes crear hábitos para este paciente desde tu sesión."
      );
      return;
    }

    navigation.navigate("AddHabit", {
      mode: "new",
      patientUid: ownerUid ?? undefined,
    });
  };

  const onEdit = () => {
    if (!selectedHabit || !selectedHabit.id) {
      Alert.alert("Selecciona un hábito", "Toca un hábito primero.");
      return;
    }

    if (!canModify) {
      Alert.alert(
        "Solo lectura",
        "No puedes editar hábitos para este paciente desde tu sesión."
      );
      return;
    }

    navigation.navigate("AddHabit", {
      mode: "edit",
      habit: selectedHabit,
      patientUid: ownerUid ?? undefined,
    });
  };

  // ✅ CAMBIO 3: Simplificar handleArchive
  const handleArchive = async () => {
    if (!selectedId) {
      Alert.alert("Selecciona un hábito", "Toca un hábito primero.");
      return;
    }

    if (!canModify) {
      Alert.alert("Solo lectura", "No puedes eliminar hábitos.");
      return;
    }

    const habitId = selectedId;
    const habit = habits.find((h) => h.id === habitId);
    const habitName = habit?.name ?? "este hábito";

    Alert.alert(
      "Archivar hábito",
      `¿Seguro que quieres archivar "${habitName}"?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Archivar",
          style: "destructive",
          onPress: async () => {
            try {
              if (!ownerUid) return;

              // ✅ Optimistic update
              setHabits((prev) => prev.filter((h) => h.id !== habitId));
              setSelectedId(null);

              // ✅ SOLO usar archiveHabit (importar de archiveHelpers)
              // enqueue interno actualiza cache automáticamente
              await archiveHabit(ownerUid, habitId, habit);

              // ❌ NO llamar a deleteCacheItem

              setPendingChanges(await syncQueueService.getPendingCount());

              Alert.alert(
                "¡Listo!",
                isOnline
                  ? "Hábito archivado."
                  : "Se sincronizará cuando haya conexión."
              );
            } catch (e: any) {
              console.log("Error:", e);
              Alert.alert("Error", e?.message ?? "Intenta nuevamente.");
              // Restaurar UI
              if (habit) {
                setHabits((prev) => [...prev, habit]);
              }
            }
          },
        },
      ]
    );
  };

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

  return (
    <SafeAreaView style={styles.safe}>
      {/* ✅ D. OfflineBanner Agregado */}
      <OfflineBanner pendingChanges={pendingChanges} />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
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

        {/* Banner si estás viendo a un paciente como cuidador */}
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
                onPress={() =>
                  setSelectedId((prev) => (prev === h.id ? null : h.id!))
                }
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
              onPress={handleArchive}
            >
              <Text style={styles.actionText}>Eliminar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1 },
  content: { padding: 8, paddingBottom: 24 },

  cacheBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FFF3CD",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginBottom: 10,
  },
  cacheText: {
    fontSize: FONT_SIZES.small,
    color: "#856404",
    fontWeight: "600",
  },

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
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
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

  // Días
  daysRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  dayPill: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  dayPillInactive: {
    backgroundColor: "#E0E0E0",
  },
  dayPillActive: {
    backgroundColor: COLORS.primary,
  },
  dayPillText: {
    fontSize: FONT_SIZES.small,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  dayPillTextActive: {
    color: COLORS.surface,
  },

  // Horas
  timesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
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

  // Botones
  actionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
    width: "100%",
  },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 4,
  },
  primaryBtn: { backgroundColor: COLORS.primary },
  dangerBtn: { backgroundColor: "#D32F2F" },
  actionText: {
    color: COLORS.surface,
    fontWeight: "800",
    fontSize: FONT_SIZES.medium,
  },
  actionDisabled: {
    opacity: 0.4,
  },
});
