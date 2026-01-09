// src/hooks/useHistory.ts

import { useCallback, useEffect, useMemo, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import { useIsFocused, RouteProp } from "@react-navigation/native";

import { RootStackParamList } from "../navigation/StackNavigator";
import { hasPermission } from "../services/careNetworkService";
// Firebase
import { auth, db } from "../config/firebaseConfig";
import { collection, query, where, getDocs } from "firebase/firestore";

// Offline
import { offlineAuthService } from "../services/offline/OfflineAuthService";
import { syncQueueService } from "../services/offline/SyncQueueService";

// Date utils
import { isPastDateTime } from "../utils/dateUtils";

type Route = RouteProp<RootStackParamList, "History">;
type RouteParams = {
  patientUid?: string;
  patientName?: string;
  accessMode?: "full" | "read-only" | "alerts-only" | "disabled";
};

const DAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"] as const;

export type HistoryHabit = {
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

export type HistoryAppointment = {
  id: string;
  title: string;
  doctor?: string | null;
  location?: string | null;
  date?: string | null;
  time?: string | null;
  archivedAt?: string | null;
  isArchived?: boolean;
};

export type HistoryMedication = {
  id: string;
  nombre: string;
  dosis?: string;
  frecuencia?: string;
  archivedAt?: string | null;
  isArchived?: boolean;
};

export type HistoryItemKind = "habit" | "appointment" | "med";

export type HistoryItem = {
  id: string;
  kind: HistoryItemKind;
  habit?: HistoryHabit;
  appointment?: HistoryAppointment;
  medication?: HistoryMedication;
  sortKey: number;
};

/* ===================== Helpers (antes estaban en la screen) ===================== */

function normalizeDate(dateValue: any): string | null {
  if (!dateValue) return null;

  if (typeof dateValue === "string") return dateValue;

  if (dateValue.toDate && typeof dateValue.toDate === "function") {
    return dateValue.toDate().toISOString();
  }

  if (dateValue.seconds !== undefined) {
    return new Date(dateValue.seconds * 1000).toISOString();
  }

  if (dateValue instanceof Date) return dateValue.toISOString();

  if (typeof dateValue === "number") return new Date(dateValue).toISOString();

  return null;
}

function safeIsPastDateTime(dateValue: any, timeValue?: any): boolean {
  try {
    const dateStr = normalizeDate(dateValue);
    if (!dateStr) return false;

    let datePart = dateStr;
    if (dateStr.includes("T")) datePart = dateStr.split("T")[0];

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
  } catch {
    return false;
  }
}

function extractDateOnly(normalizedDate: string | null): string | null {
  if (!normalizedDate) return null;
  if (normalizedDate.includes("T")) return normalizedDate.split("T")[0];
  return normalizedDate;
}

/* ===================== Hook ===================== */

export function useHistory(args: { route: Route }) {
  const { route } = args;
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

  const loggedUserUid =
    auth.currentUser?.uid || offlineAuthService.getCurrentUid();
  const ownerUid = route.params?.patientUid ?? loggedUserUid ?? null;

  const isCaregiverView =
    !!route.params?.patientUid && route.params.patientUid !== loggedUserUid;
  const accessMode =
    (route.params as RouteParams | undefined)?.accessMode ?? "full";

  const canView = hasPermission(accessMode, "view");

  if (!canView) {
    return {
      // estado
      isLoading: false,
      isOnline: false,
      pendingChanges: 0,
      ownerUid,
      isCaregiverView,
      blocked: true,

      // listas vacías
      habitHistory: [],
      apptHistory: [],
      medHistory: [],

      // filtros
      filterType: "all",
      filterDay: null,
      setFilterType: () => {},
      setFilterDay: () => {},

      // computados
      filteredItems: [],
      DAY_LABELS,
    };
  }

  // Monitor conectividad (igual que en tus otras pantallas)
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

  const loadHistory = useCallback(async () => {
    if (!ownerUid) return;

    let cancelled = false;

    try {
      setIsLoading(true);

      const netState = await NetInfo.fetch();
      const online =
        netState.isConnected === true && netState.isInternetReachable !== false;

      const habitList: HistoryHabit[] = [];
      const medsList: HistoryMedication[] = [];
      const apptsList: HistoryAppointment[] = [];

      const processedHabitIds = new Set<string>();
      const processedMedIds = new Set<string>();
      const processedApptIds = new Set<string>();

      // 1) Cache primero
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

      // meds array para mantener cache completo (activos+archivados)
      let medCacheArray: any[] = [];
      if (cachedMeds?.data) medCacheArray = [...cachedMeds.data];

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
            if (item.id) processedHabitIds.add(item.id);
          }
        });
      }

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
            if (item.id) processedMedIds.add(item.id);
          }
        });
      }

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
              isArchived: item.isArchived === true ? true : false,
            });
            if (item.id) processedApptIds.add(item.id);
          }
        });
      }

      // 2) Firebase si online
      if (online) {
        try {
          // Hábitos archivados
          const habitsRef = collection(db, "users", ownerUid, "habits");
          const habitsQuery = query(habitsRef, where("isArchived", "==", true));
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

            // asegurar cache completo
            if (!medCacheArray.some((m) => m?.id === docSnap.id)) {
              medCacheArray.push({ id: docSnap.id, ...docSnap.data() });
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

          // guardar cache meds actualizado
          try {
            await syncQueueService.saveToCache(
              "medications",
              ownerUid,
              medCacheArray
            );
          } catch {
            // no-op
          }
        } catch {
          // no-op (cache ya cubre)
        }
      }

      // 3) ordenar y set state
      if (!cancelled) {
        const sortByArchiveDate = (a: any, b: any) => {
          const da = a.archivedAt ? Date.parse(a.archivedAt) : 0;
          const dbb = b.archivedAt ? Date.parse(b.archivedAt) : 0;
          return dbb - da;
        };

        habitList.sort(sortByArchiveDate);
        medsList.sort(sortByArchiveDate);
        apptsList.sort(sortByArchiveDate);

        setHabitHistory(habitList);
        setMedHistory(medsList);
        setApptHistory(apptsList);
      }
    } finally {
      if (!cancelled) setIsLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [ownerUid]);
  // recargar historial cuando termina el sync offline
  useEffect(() => {
    if (!ownerUid) return;

    if (isOnline && pendingChanges === 0) {
      loadHistory();
    }
  }, [isOnline, pendingChanges, ownerUid, loadHistory]);
  // cargar cuando entras/enfocas pantalla
  useEffect(() => {
    if (!ownerUid) {
      setIsLoading(false);
      return;
    }
    if (!isFocused) return;

    let alive = true;

    (async () => {
      if (!alive) return;
      await loadHistory();
    })();

    return () => {
      alive = false;
    };
  }, [ownerUid, isFocused, loadHistory]);

  const allItems: HistoryItem[] = useMemo(() => {
    const items: HistoryItem[] = [];

    habitHistory.forEach((h) => {
      const ts = h.archivedAt ? Date.parse(h.archivedAt) : 0;
      items.push({ id: h.id, kind: "habit", habit: h, sortKey: ts });
    });

    medHistory.forEach((m) => {
      const ts = m.archivedAt ? Date.parse(m.archivedAt) : 0;
      items.push({ id: m.id, kind: "med", medication: m, sortKey: ts });
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

    if (filterType !== "all")
      filtered = filtered.filter((it) => it.kind === filterType);

    if (filterDay !== null) {
      filtered = filtered.filter((it) => {
        if (it.kind === "habit" && it.habit)
          return it.habit.days?.includes(filterDay) ?? false;
        return false;
      });
    }

    return filtered;
  }, [allItems, filterType, filterDay]);

  return useMemo(
    () => ({
      // state
      isLoading,
      isOnline,
      pendingChanges,
      ownerUid,
      isCaregiverView,

      // raw lists
      habitHistory,
      apptHistory,
      medHistory,
      blocked: false,
      // filters
      filterType,
      filterDay,
      setFilterType,
      setFilterDay,

      // computed
      filteredItems,
      DAY_LABELS,
    }),
    [
      isLoading,
      isOnline,
      pendingChanges,
      ownerUid,
      isCaregiverView,
      habitHistory,
      apptHistory,
      medHistory,
      filterType,
      filterDay,
      filteredItems,
    ]
  );
}
