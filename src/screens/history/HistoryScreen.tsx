// src/screens/history/HistoryScreen.tsx
// ✅ CORREGIDO: Carga archivados desde cache Y Firebase cuando está online

import React, { useEffect, useMemo, useState } from "react";
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
import { useRoute, RouteProp, useIsFocused } from "@react-navigation/native";

// 🔥 Firebase
import { auth, db } from "../../config/firebaseConfig";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";

// ✅ Soporte offline
import { offlineAuthService } from "../../services/offline/OfflineAuthService";

// ⏰ Utils compartidos
import { formatHHMMDisplay } from "../../utils/timeUtils";
import {
  formatDateTimeLabel,
  isPastDateTime,
  jsDowToIndex,
} from "../../utils/dateUtils";

// 🧱 Capa offline
import { syncQueueService } from "../../services/offline/SyncQueueService";

import NetInfo from "@react-native-community/netinfo";

type Nav = StackNavigationProp<RootStackParamList, "History">;
type Route = RouteProp<RootStackParamList, "History">;

/* ===================== Tipos locales ===================== */

const DAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

type HistoryHabit = {
  id: string;
  name: string;
  priority?: string;
  days?: number[];
  times?: string[];
  archivedAt?: string | null;
  isArchived?: boolean;
  icon?: string;
  lib?: string;
};

type HistoryAppointment = {
  id: string;
  title: string;
  doctor?: string | null;
  location?: string | null;
  date?: string | null;
  time?: string | null;
  archivedAt?: string | null;
  isArchived?: boolean;
};

type HistoryMedication = {
  id: string;
  nombre: string;
  dosis?: string;
  frecuencia?: string;
  archivedAt?: string | null;
  isArchived?: boolean;
};

type HistoryItemKind = "habit" | "appointment" | "med";

type HistoryItem = {
  id: string;
  kind: HistoryItemKind;
  habit?: HistoryHabit;
  appointment?: HistoryAppointment;
  medication?: HistoryMedication;
  sortKey: number;
};

/* ===================== HELPERS ===================== */

/**
 * ✅ FIX: Convierte cualquier formato de fecha a string ISO
 */
function normalizeDate(dateValue: any): string | null {
  if (!dateValue) return null;

  if (typeof dateValue === "string") {
    return dateValue;
  }

  if (dateValue.toDate && typeof dateValue.toDate === "function") {
    return dateValue.toDate().toISOString();
  }

  if (dateValue.seconds !== undefined) {
    return new Date(dateValue.seconds * 1000).toISOString();
  }

  if (dateValue instanceof Date) {
    return dateValue.toISOString();
  }

  if (typeof dateValue === "number") {
    return new Date(dateValue).toISOString();
  }

  return null;
}

/**
 * ✅ FIX: Verifica si una fecha ya pasó de forma segura
 */
function safeIsPastDateTime(dateValue: any, timeValue?: any): boolean {
  try {
    const dateStr = normalizeDate(dateValue);
    if (!dateStr) return false;

    let datePart = dateStr;
    if (dateStr.includes("T")) {
      datePart = dateStr.split("T")[0];
    }

    let timePart: string | null = null;
    if (timeValue) {
      if (typeof timeValue === "string") {
        timePart = timeValue;
      } else if (timeValue.toDate) {
        const d = timeValue.toDate();
        timePart = `${d.getHours().toString().padStart(2, "0")}:${d
          .getMinutes()
          .toString()
          .padStart(2, "0")}`;
      }
    }

    return isPastDateTime(datePart, timePart);
  } catch (error) {
    console.log("Error en safeIsPastDateTime:", error);
    return false;
  }
}

/**
 * Extrae solo YYYY-MM-DD de una fecha normalizada
 */
function extractDateOnly(normalizedDate: string | null): string | null {
  if (!normalizedDate) return null;
  if (normalizedDate.includes("T")) {
    return normalizedDate.split("T")[0];
  }
  return normalizedDate;
}

/* ===================== Componente ===================== */

export default function HistoryScreen({ navigation }: { navigation: Nav }) {
  const route = useRoute<Route>();
  const isFocused = useIsFocused();

  const [habitHistory, setHabitHistory] = useState<HistoryHabit[]>([]);
  const [apptHistory, setApptHistory] = useState<HistoryAppointment[]>([]);
  const [medHistory, setMedHistory] = useState<HistoryMedication[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isOnline, setIsOnline] = useState(true);
  const [pendingChanges, setPendingChanges] = useState(0);

  const [filterType, setFilterType] = useState<
    "all" | "habit" | "appointment" | "med"
  >("all");
  const [filterDay, setFilterDay] = useState<number | null>(null);

  // ✅ Obtener UID con soporte offline
  const loggedUserUid =
    auth.currentUser?.uid || offlineAuthService.getCurrentUid();
  const ownerUid = route.params?.patientUid ?? loggedUserUid ?? null;
  const isCaregiverView =
    !!route.params?.patientUid && route.params.patientUid !== loggedUserUid;

  // Monitor de conectividad
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

  /* ===================== Cargar historial ===================== */
  useEffect(() => {
    if (!ownerUid) {
      setIsLoading(false);
      return;
    }
    if (!isFocused) return;

    let isCancelled = false;

    const loadHistory = async () => {
      try {
        setIsLoading(true);
        console.log("🔄 Cargando historial para:", ownerUid);

        // Verificar estado de conexión
        const netState = await NetInfo.fetch();
        const online =
          netState.isConnected === true &&
          netState.isInternetReachable !== false;

        const habitList: HistoryHabit[] = [];
        const medsList: HistoryMedication[] = [];
        const apptsList: HistoryAppointment[] = [];

        const processedHabitIds = new Set<string>();
        const processedMedIds = new Set<string>();
        const processedApptIds = new Set<string>();

        // ========================================
        // 1. CARGAR DESDE CACHE (siempre primero)
        // ========================================
        const cachedHabits = await syncQueueService.getFromCache<any>(
          "habits",
          ownerUid
        );
        const cachedMeds = await syncQueueService.getFromCache<any>(
          "medications",
          ownerUid
        );
        const cachedAppts = await syncQueueService.getFromCache<any>(
          "appointments",
          ownerUid
        );

        // 🆕 Array auxiliar para re-escribir el cache de medications
        let medCacheArray: any[] = [];
        if (cachedMeds?.data) {
          medCacheArray = [...cachedMeds.data];
        }

        // Procesar hábitos del cache
        if (cachedHabits?.data) {
          cachedHabits.data.forEach((item: any) => {
            if (item.isArchived === true || !!item.archivedAt) {
              habitList.push({
                id: item.id || "unknown",
                name: item.name || "Hábito sin nombre",
                priority: item.priority || "normal",
                days: item.days || [],
                times: item.times || [],
                archivedAt: normalizeDate(item.archivedAt),
                isArchived: true,
                icon: item.icon || "check-circle",
                lib: item.lib || "MaterialIcons",
              });
              processedHabitIds.add(item.id);
            }
          });
        }

        // Procesar medicamentos del cache
        if (cachedMeds?.data) {
          cachedMeds.data.forEach((item: any) => {
            if (item.isArchived === true || !!item.archivedAt) {
              medsList.push({
                id: item.id || "unknown",
                nombre: item.nombre || "Medicamento sin nombre",
                dosis:
                  item.dosis ||
                  `${item.doseAmount || 1} ${item.doseUnit || "tabletas"}`,
                frecuencia: item.frecuencia || "",
                archivedAt: normalizeDate(item.archivedAt),
                isArchived: true,
              });
              processedMedIds.add(item.id);
            }
          });
        }

        // Procesar citas del cache
        if (cachedAppts?.data) {
          cachedAppts.data.forEach((item: any) => {
            const isPast = safeIsPastDateTime(item.date, item.time);
            if (item.isArchived === true || !!item.archivedAt || isPast) {
              apptsList.push({
                id: item.id || "unknown",
                title: item.title || "Cita sin título",
                doctor: item.doctor || null,
                location: item.location || null,
                date: extractDateOnly(normalizeDate(item.date)),
                time: item.time || null,
                archivedAt: normalizeDate(item.archivedAt),
                isArchived: true,
              });
              processedApptIds.add(item.id);
            }
          });
        }

        console.log("📦 Desde cache:", {
          habits: habitList.length,
          meds: medsList.length,
          appts: apptsList.length,
        });

        // ========================================
        // 2. SI ESTÁ ONLINE, TAMBIÉN CARGAR DE FIREBASE
        // ========================================
        if (online) {
          console.log("🔥 Cargando archivados desde Firebase...");

          try {
            // Hábitos archivados
            const habitsRef = collection(db, "users", ownerUid, "habits");
            const habitsQuery = query(
              habitsRef,
              where("isArchived", "==", true)
            );
            const habitsSnapshot = await getDocs(habitsQuery);

            habitsSnapshot.docs.forEach((docSnap) => {
              if (!processedHabitIds.has(docSnap.id)) {
                const data = docSnap.data();
                habitList.push({
                  id: docSnap.id,
                  name: data.name || "Hábito sin nombre",
                  priority: data.priority || "normal",
                  days: data.days || [],
                  times: data.times || [],
                  archivedAt: normalizeDate(data.archivedAt),
                  isArchived: true,
                  icon: data.icon || "check-circle",
                  lib: data.lib || "MaterialIcons",
                });
                processedHabitIds.add(docSnap.id);
              }
            });

            // Medicamentos archivados
            const medsRef = collection(db, "users", ownerUid, "medications");
            const medsQuery = query(medsRef, where("isArchived", "==", true));
            const medsSnapshot = await getDocs(medsQuery);

            medsSnapshot.docs.forEach((docSnap) => {
              if (!processedMedIds.has(docSnap.id)) {
                const data = docSnap.data();
                medsList.push({
                  id: docSnap.id,
                  nombre: data.nombre || "Medicamento sin nombre",
                  dosis:
                    data.dosis ||
                    `${data.doseAmount || 1} ${data.doseUnit || "tabletas"}`,
                  frecuencia: data.frecuencia || "",
                  archivedAt: normalizeDate(data.archivedAt),
                  isArchived: true,
                });
                processedMedIds.add(docSnap.id);
              }

              // 🆕 Asegurarnos de que también queden en el cache
              if (!medCacheArray.some((m) => m.id === docSnap.id)) {
                medCacheArray.push({
                  id: docSnap.id,
                  ...docSnap.data(),
                });
              }
            });

            // Citas archivadas
            const apptsRef = collection(db, "users", ownerUid, "appointments");
            const apptsQuery = query(apptsRef, where("isArchived", "==", true));
            const apptsSnapshot = await getDocs(apptsQuery);

            apptsSnapshot.docs.forEach((docSnap) => {
              if (!processedApptIds.has(docSnap.id)) {
                const data = docSnap.data();
                apptsList.push({
                  id: docSnap.id,
                  title: data.title || "Cita sin título",
                  doctor: data.doctor || null,
                  location: data.location || null,
                  date: extractDateOnly(normalizeDate(data.date)),
                  time: data.time || null,
                  archivedAt: normalizeDate(data.archivedAt),
                  isArchived: true,
                });
                processedApptIds.add(docSnap.id);
              }
            });

            // Citas pasadas no archivadas
            const allApptsSnapshot = await getDocs(apptsRef);
            allApptsSnapshot.docs.forEach((docSnap) => {
              if (!processedApptIds.has(docSnap.id)) {
                const data = docSnap.data();
                const isPast = safeIsPastDateTime(data.date, data.time);
                if (isPast) {
                  apptsList.push({
                    id: docSnap.id,
                    title: data.title || "Cita sin título",
                    doctor: data.doctor || null,
                    location: data.location || null,
                    date: extractDateOnly(normalizeDate(data.date)),
                    time: data.time || null,
                    archivedAt: null,
                    isArchived: false,
                  });
                  processedApptIds.add(docSnap.id);
                }
              }
            });

            console.log("🔥 Desde Firebase (adicionales):", {
              habits: habitsSnapshot.docs.length,
              meds: medsSnapshot.docs.length,
              appts: apptsSnapshot.docs.length,
            });

            // 🆕 GUARDAR EL NUEVO CACHE DE MEDS (activos + archivados)
            try {
              await syncQueueService.saveToCache(
                "medications",
                ownerUid,
                medCacheArray
              );
              console.log(
                `💾 Cache de medications actualizado (total en cache: ${medCacheArray.length})`
              );
            } catch (cacheErr) {
              console.log("⚠️ No se pudo actualizar cache de meds:", cacheErr);
            }
          } catch (firebaseError) {
            console.log("⚠️ Error cargando de Firebase:", firebaseError);
          }
        }

        // ========================================
        // 3. ORDENAR Y ACTUALIZAR ESTADO
        // ========================================
        if (!isCancelled) {
          const sortByArchiveDate = (a: any, b: any) => {
            const da = a.archivedAt ? Date.parse(a.archivedAt) : 0;
            const db = b.archivedAt ? Date.parse(b.archivedAt) : 0;
            return db - da;
          };

          habitList.sort(sortByArchiveDate);
          medsList.sort(sortByArchiveDate);
          apptsList.sort(sortByArchiveDate);

          setHabitHistory(habitList);
          setMedHistory(medsList);
          setApptHistory(apptsList);

          console.log("✅ Historial cargado (total):");
          console.log(`   - Hábitos archivados: ${habitList.length}`);
          console.log(`   - Medicamentos archivados: ${medsList.length}`);
          console.log(`   - Citas archivadas/pasadas: ${apptsList.length}`);
        }
      } catch (error) {
        console.log("❌ Error cargando historial:", error);
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    loadHistory();

    return () => {
      isCancelled = true;
    };
  }, [ownerUid, isFocused]);

  /* ===================== Combinar y filtrar items ===================== */
  const allItems: HistoryItem[] = useMemo(() => {
    const items: HistoryItem[] = [];

    habitHistory.forEach((h) => {
      const ts = h.archivedAt ? Date.parse(h.archivedAt) : 0;
      items.push({
        id: h.id,
        kind: "habit",
        habit: h,
        sortKey: ts,
      });
    });

    medHistory.forEach((m) => {
      const ts = m.archivedAt ? Date.parse(m.archivedAt) : 0;
      items.push({
        id: m.id,
        kind: "med",
        medication: m,
        sortKey: ts,
      });
    });

    apptHistory.forEach((a) => {
      const ts = a.archivedAt ? Date.parse(a.archivedAt) : 0;
      items.push({
        id: a.id,
        kind: "appointment",
        appointment: a,
        sortKey: ts,
      });
    });

    return items.sort((x, y) => y.sortKey - x.sortKey);
  }, [habitHistory, medHistory, apptHistory]);

  const filteredItems = useMemo(() => {
    let filtered = allItems;

    if (filterType !== "all") {
      filtered = filtered.filter((it) => it.kind === filterType);
    }

    if (filterDay !== null) {
      filtered = filtered.filter((it) => {
        if (it.kind === "habit" && it.habit) {
          return it.habit.days?.includes(filterDay) ?? false;
        }
        return false;
      });
    }

    return filtered;
  }, [allItems, filterType, filterDay]);

  /* ===================== Render Cards ===================== */
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

  /* ===================== UI Principal ===================== */
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
        {/* Banner offline */}

        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>
            {isCaregiverView ? "Historial del paciente" : "Mi historial"}
          </Text>
          <Text style={styles.subtitle}>
            Hábitos, medicamentos y citas archivadas
          </Text>

          {isCaregiverView && (
            <View style={styles.caregiverBanner}>
              <Text style={styles.caregiverText}>
                👁️ Viendo historial de tu paciente (solo lectura)
              </Text>
            </View>
          )}

          {/* Filtros */}
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
});
