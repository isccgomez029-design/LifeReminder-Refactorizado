// src/screens/appointments/AppointmentsScreen.tsx
import React, { useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform,
  Modal,
  Pressable,
  Alert,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { COLORS, FONT_SIZES } from "../../../types";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRoute, RouteProp, useFocusEffect } from "@react-navigation/native";

// 🔥 Firebase Auth & Firestore (A: Imports agregados)
import { auth, db } from "../../config/firebaseConfig";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { offlineAuthService } from "../../services/offline/OfflineAuthService";
// 🔹 Servicios
import {
  deleteAppointment,
  Appointment,
} from "../../services/appointmentsService";
import { deleteAndroidEvent } from "../../services/deviceCalendarService";

// ✅ (A: Imports agregados)
import { syncQueueService } from "../../services/offline/SyncQueueService";
import { OfflineBanner } from "../../components/OfflineBanner";
import NetInfo from "@react-native-community/netinfo";

// 🔧 CAMBIO 1: Agregar import de archiveAppointment
import { archiveAppointment } from "../../utils/archiveHelpers";

type Nav = StackNavigationProp<RootStackParamList, "Appointments">;
type Route = RouteProp<RootStackParamList, "Appointments">;

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const toISO = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Construye un Date a partir de date+time (si no hay hora -> 23:59) */
function getAppointmentDate(a: Appointment): Date {
  const [y, m, d] = a.date.split("-").map((n) => parseInt(n, 10));
  let hh = 23;
  let mm = 59;
  if (a.time) {
    const [hStr, mStr] = a.time.split(":");
    const h = parseInt(hStr ?? "0", 10);
    const mi = parseInt(mStr ?? "0", 10);
    if (!isNaN(h)) hh = h;
    if (!isNaN(mi)) mm = mi;
  }
  return new Date(y, (m || 1) - 1, d || 1, hh, mm, 0);
}

/** Devuelve true si la cita ya pasó */
function isAppointmentPast(a: Appointment, now: Date): boolean {
  const dt = getAppointmentDate(a);
  return dt.getTime() < now.getTime();
}

/** 🔹 Fecha + hora en español AM/PM */
function formatApptDateTime(dateISO: string, time?: string | null) {
  const [y, m, d] = dateISO.split("-").map((n) => parseInt(n, 10));
  const baseDate = new Date(y, (m || 1) - 1, d || 1);

  const datePart = baseDate.toLocaleDateString("es-MX", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  if (!time) return datePart;

  const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
  const withTime = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);

  const timePart = withTime.toLocaleTimeString("es-MX", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return `${datePart} · ${timePart}`;
}

/** 🔹 Solo hora 12h (para lista del mini-calendario) */
function formatTime12(time?: string | null) {
  if (!time) return "Sin hora";
  const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d.toLocaleTimeString("es-MX", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getMonthMatrix(year: number, monthIndex0: number) {
  const first = new Date(year, monthIndex0, 1);
  const startWeekIdx = (first.getDay() + 6) % 7; // L=0 ... D=6
  const daysInMonth = new Date(year, monthIndex0 + 1, 0).getDate();
  const prevDays = new Date(year, monthIndex0, 0).getDate();

  const matrix: Date[][] = [];
  let dayCounter = 1;
  let nextMonthDay = 1;

  for (let r = 0; r < 6; r++) {
    const row: Date[] = [];
    for (let c = 0; c < 7; c++) {
      let date: Date;
      const cellIndex = r * 7 + c;
      if (cellIndex < startWeekIdx) {
        const d = prevDays - (startWeekIdx - cellIndex - 1);
        date = new Date(year, monthIndex0 - 1, d);
      } else if (dayCounter <= daysInMonth) {
        date = new Date(year, monthIndex0, dayCounter++);
      } else {
        date = new Date(year, monthIndex0 + 1, nextMonthDay++);
      }
      row.push(date);
    }
    matrix.push(row);
  }
  return matrix;
}

export default function AppointmentsScreen({
  navigation,
}: {
  navigation: Nav;
}) {
  const route = useRoute<Route>();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedApptId, setSelectedApptId] = useState<string | null>(null);

  // ✅ (B: Estados agregados)
  const [pendingChanges, setPendingChanges] = useState(0);
  const [isOnline, setIsOnline] = useState(true);

  const [isFromCache, setIsFromCache] = useState(false);
  const [loading, setLoading] = useState(true);

  // Mini calendario
  const [showCal, setShowCal] = useState(false);
  const today = new Date();
  const [cursor, setCursor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selectedDate, setSelectedDate] = useState<Date | null>(today);

  // 🔑 dueño real de las citas (paciente o usuario logueado)
  const loggedUserUid =
    auth.currentUser?.uid || offlineAuthService.getCurrentUid();
  const ownerUid = route.params?.patientUid ?? loggedUserUid ?? null;
  const isCaregiverView =
    !!route.params?.patientUid && route.params.patientUid !== loggedUserUid;
  const canModify = ownerUid === loggedUserUid;

  // 🔧 CAMBIO 2: Simplificar reloadFromCache
  const reloadFromCache = React.useCallback(async () => {
    if (!ownerUid) return;

    try {
      console.log("🔄 Recargando citas desde cache...");

      // ✅ Usar solo getFromCache
      const cached = await syncQueueService.getFromCache<any>(
        "appointments",
        ownerUid
      );

      if (cached?.data && cached.data.length > 0) {
        // Filtrar archivadas
        const items = cached.data.filter(
          (a: any) => !a.isArchived
        ) as Appointment[];

        console.log(`✅ Mostrando ${items.length} citas`);
        setAppointments(items);
        setIsFromCache(true);
      }
    } catch (error) {
      console.log("❌ Error recargando:", error);
    }
  }, [ownerUid]);

  useFocusEffect(
    React.useCallback(() => {
      console.log("👁️ AppointmentsScreen recibió el foco");
      reloadFromCache();
    }, [reloadFromCache])
  );

  // ✅ Cargar citas desde cache al iniciar
  useEffect(() => {
    const loadFromCache = async () => {
      if (!ownerUid) return; // ✅ Usar ownerUid

      try {
        const cached = await syncQueueService.getFromCache(
          "appointments",
          ownerUid
        );
        if (cached && cached.data.length > 0) {
          console.log("📦 Citas desde cache:", cached.data.length);
          setAppointments(cached.data as Appointment[]); // ✅ Agregar type cast
        }
      } catch (error) {
        console.log("Error cache citas:", error);
      }
    };

    loadFromCache();
  }, [ownerUid]); // ✅ Usar ownerUid

  // ================== CONNECTIVITY MONITOR (D: useEffect agregado) ==================
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

// ================== Escuchar Firestore + Cache por ownerUid ==================
useEffect(() => {
  const userId = ownerUid;
  if (!userId) return;

  let isMounted = true;
  let unsubscribe: (() => void) | null = null;

  const loadAppointments = async () => {
    try {
      setLoading(true);

      // 1. Cargar desde cache primero
      const cached = await syncQueueService.getFromCache<any>(
        "appointments",
        userId
      );

      if (cached?.data && isMounted) {
        console.log(`📦 Cache: ${cached.data.length} citas`);
        const processedAppts = cached.data.map((data: any) => ({
          id: data.id,
          title: data.title || "",
          doctor: data.doctor || "",
          location: data.location || "",
          date: data.date || "",
          time: data.time || "",
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        }));

        setAppointments(processedAppts);
        setIsFromCache(true);
        setLoading(false);
      }

      // 2. Listener de Firebase
      const apptsRef = collection(db, "users", userId, "appointments");
      const q = query(apptsRef, orderBy("date", "asc"));

      unsubscribe = onSnapshot(q, async (snapshot) => {
        if (!isMounted) return;

        console.log("🔥 [FIREBASE] Snapshot:", snapshot.docs.length, "docs");

        const items = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as Appointment[];

        await syncQueueService.saveToCache("appointments", userId, items);

        const merged = await syncQueueService.getFromCache<any>(
          "appointments",
          userId
        );

        if (merged?.data) {
          const finalAppts = merged.data.filter(
            (a: any) => !a.isArchived
          ) as Appointment[];

          setAppointments(finalAppts);
          setIsFromCache(false);
          setLoading(false);
        }
      });
    } catch (error) {
      console.log("❌ Error cargando citas:", error);
      if (isMounted) {
        setLoading(false);
      }
    }
  };

  loadAppointments();

  return () => {
    isMounted = false;
    if (unsubscribe) {
      unsubscribe();
    }
  };
}, [ownerUid]);

  // ================== Solo citas futuras / próximas ==================
  const upcomingAppointments = useMemo(() => {
    const now = new Date();
    return appointments.filter((a) => !isAppointmentPast(a, now));
  }, [appointments]);

  useEffect(() => {
    if (!selectedApptId) return;
    const stillExists = upcomingAppointments.some(
      (a) => a.id === selectedApptId
    );
    if (!stillExists) setSelectedApptId(null);
  }, [upcomingAppointments, selectedApptId]);

  const monthMatrix = useMemo(
    () => getMonthMatrix(cursor.getFullYear(), cursor.getMonth()),
    [cursor]
  );

  const monthKeyMap = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    upcomingAppointments.forEach((a) => {
      const list = map.get(a.date) ?? [];
      list.push(a);
      map.set(a.date, list);
    });
    return map;
  }, [upcomingAppointments]);

  const selectedISO = selectedDate ? toISO(selectedDate) : "";
  const selectedItems = monthKeyMap.get(selectedISO) ?? [];

  const goPrevMonth = () =>
    setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  const goNextMonth = () =>
    setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const monthLabel = cursor.toLocaleDateString("es-MX", {
    month: "long",
    year: "numeric",
  });

  const selectedAppt = upcomingAppointments.find(
    (a) => a.id === selectedApptId
  );

  // ================== Acciones ==================

  const handleEdit = () => {
    if (!selectedAppt) {
      Alert.alert("Selecciona una cita", "Toca una cita para poder editarla.");
      return;
    }

    navigation.navigate("AddAppointment", {
      mode: "edit",
      appt: selectedAppt,
      patientUid: ownerUid ?? undefined,
    } as any);
  };

  // 🔧 CAMBIO 4: Simplificar handleDelete
  const handleDelete = async () => {
    if (!selectedAppt) {
      Alert.alert("Selecciona una cita", "Toca una cita para eliminarla.");
      return;
    }

    Alert.alert(
      "Eliminar cita",
      `¿Seguro que quieres eliminar "${selectedAppt.title}"?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              // ✅ Optimistic update
              setAppointments((prev) =>
                prev.filter((a) => a.id !== selectedAppt.id)
              );
              setSelectedApptId(null);

              // Eliminar evento del calendario Android si existe
              if (Platform.OS === "android" && selectedAppt.eventId) {
                try {
                  await deleteAndroidEvent(selectedAppt.eventId);
                } catch (e) {
                  console.log("Error eliminando evento calendario:", e);
                }
              }

              // ✅ USAR archiveAppointment en lugar de delete directo
              // Esto permite recuperar la cita si fue un error
              await archiveAppointment(
                ownerUid!,
                selectedAppt.id!,
                selectedAppt
              );

              // ❌ NO llamar a deleteCacheItem

              setPendingChanges(await syncQueueService.getPendingCount());

              Alert.alert(
                "¡Listo!",
                isOnline
                  ? "Cita eliminada."
                  : "Se sincronizará cuando haya conexión."
              );
            } catch (err) {
              console.log("Error:", err);
              Alert.alert("Error", "No se pudo eliminar la cita.");
              // Restaurar UI
              setAppointments((prev) => [...prev, selectedAppt]);
            }
          },
        },
      ]
    );
  };
  // ================== UI ==================
  return (
    <SafeAreaView style={styles.safe}>
      {/* ✅ (E: OfflineBanner agregado) */}
      <OfflineBanner pendingChanges={pendingChanges} />

      <StatusBar
        barStyle="light-content"
        backgroundColor={COLORS.primary}
        translucent={false}
      />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Citas médicas</Text>
            <Text style={styles.subtitle}>Próximas citas y opciones</Text>
          </View>

          <TouchableOpacity
            style={styles.sectionIcon}
            onPress={() => setShowCal(true)}
            accessibilityLabel="Abrir mini calendario"
          >
            <MaterialIcons name="event" size={26} color={COLORS.surface} />
          </TouchableOpacity>
        </View>

        {/* Banner si estás viendo a un paciente como cuidador */}
        {isCaregiverView && (
          <View style={styles.caregiverBanner}>
            <Text style={styles.caregiverText}>
              Estás viendo las citas de un paciente.
            </Text>
          </View>
        )}

        {/* Lista de citas (solo PRÓXIMAS) */}
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
                onPress={() => {
                  if (selectedApptId === a.id) {
                    setSelectedApptId(null);
                  } else {
                    setSelectedApptId(a.id ?? null);
                  }
                }}
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
                      <Text style={styles.selectedPillText}>Seleccionada</Text>
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

          {/* Acciones → solo si el dueño es el usuario actual */}
          {canModify && (
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.primaryBtn]}
                onPress={() =>
                  navigation.navigate("AddAppointment", {
                    mode: "new",
                    patientUid: ownerUid ?? undefined,
                  } as any)
                }
              >
                <Text style={styles.actionText}>Agregar cita</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  styles.primaryBtn,
                  !selectedAppt && { opacity: 0.5 },
                ]}
                disabled={!selectedAppt}
                onPress={handleEdit}
              >
                <Text style={styles.actionText}>Editar cita</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  styles.dangerBtn,
                  !selectedAppt && { opacity: 0.5 },
                ]}
                disabled={!selectedAppt}
                onPress={handleDelete}
              >
                <Text style={styles.actionText}>Eliminar cita</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

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
                  const isToday = isSameDay(date, today);
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
                          isToday && { fontWeight: "800" },
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
});
