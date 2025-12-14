// src/screens/meds/MedsTodayScreen.tsx
// ✅ VERSION CORREGIDA - Persistencia offline completa (limpia y estable)

import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";
import { COLORS, FONT_SIZES } from "../../../types";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRoute, RouteProp, useFocusEffect } from "@react-navigation/native";
import NetInfo from "@react-native-community/netinfo";

// Offline-first
import { offlineAuthService } from "../../services/offline/OfflineAuthService";
import { offlineAlarmService } from "../../services/offline/OfflineAlarmService";
import { syncQueueService } from "../../services/offline/SyncQueueService";

// Firebase
import { auth, db } from "../../config/firebaseConfig";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";

// UI components
import { OfflineBanner } from "../../components/OfflineBanner";

// Utils/services
import { sendImmediateNotification } from "../../services/Notifications";
import { archiveMedication } from "../../utils/archiveHelpers";

type Nav = StackNavigationProp<RootStackParamList, "MedsToday">;
type MedsRoute = RouteProp<RootStackParamList, "MedsToday">;

type Medication = {
  id: string;
  nombre: string;
  dosis?: string;
  frecuencia?: string;
  proximaToma?: string;
  nextDueAt?: Date | null;
  cantidadInicial?: number;
  cantidadActual?: number;
  cantidadPorToma?: number;
  low20Notified?: boolean;
  low10Notified?: boolean;
  imageUri?: string;
  currentAlarmId?: string | null;
  snoozeCount?: number;
  snoozedUntil?: Date | null;
  lastSnoozeAt?: Date | null;
  lastTakenAt?: Date | null;
};

const freqToMs = (freq?: string): number => {
  if (!freq) return 0;
  // Tu formato actual de frecuencia parece ser "HH:mm" representando intervalo
  const match = freq.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  const totalMinutes = h * 60 + m;
  return totalMinutes * 60 * 1000;
};

// Mapea item crudo (cache o firestore) => Medication lista para UI
const mapToMedication = (data: any): Medication => ({
  id: data.id,
  nombre: data.nombre || "Medicamento sin nombre",
  dosis: data.dosis,
  frecuencia: data.frecuencia,
  proximaToma: data.proximaToma,
  nextDueAt: data.nextDueAt ? new Date(data.nextDueAt) : null,
  cantidadInicial: data.cantidadInicial || 0,
  cantidadActual: data.cantidadActual || 0,
  cantidadPorToma: data.cantidadPorToma || 1,
  low20Notified: data.low20Notified ?? false,
  low10Notified: data.low10Notified ?? false,
  imageUri: data.imageUri || "",
  currentAlarmId: data.currentAlarmId || null,
  snoozeCount: data.snoozeCount || 0,
  snoozedUntil: data.snoozedUntil ? new Date(data.snoozedUntil) : null,
  lastSnoozeAt: data.lastSnoozeAt ? new Date(data.lastSnoozeAt) : null,
  lastTakenAt: data.lastTakenAt ? new Date(data.lastTakenAt) : null,
});

export default function MedsTodayScreen({ navigation }: { navigation: Nav }) {
  const route = useRoute<MedsRoute>();
  const params = route.params ?? {};

  const initialPatientName =
    typeof params.patientName === "string" ? params.patientName : "";

  const [patientName] = useState<string>(initialPatientName);

  const [meds, setMeds] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMedId, setSelectedMedId] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(new Date());

  // 🔐 Usuario logueado (offline-first compatible)
  const loggedUserUid =
    auth.currentUser?.uid || offlineAuthService.getCurrentUid();

  // 🔎 Dueño real de los datos (paciente o tú mismo)
  const ownerUid = params.patientUid ?? loggedUserUid ?? null;

  // 👀 ¿Vista de cuidador?
  const isCaregiverView =
    !!params.patientUid && params.patientUid !== loggedUserUid;

  // 🔐 Permiso para modificar
  const canModify = ownerUid === loggedUserUid;

  const [isOnline, setIsOnline] = useState(true);
  const [isFromCache, setIsFromCache] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(0);

  const hasSelection = !!selectedMedId;

  // ======================= Helpers =======================

  const checkModifyPermissions = (action: string): boolean => {
    if (!canModify) {
      Alert.alert(
        "Sin permisos",
        `Solo el paciente puede ${action} medicamentos.`
      );
      return false;
    }
    return true;
  };

  const isSnoozed = (med: Medication): boolean => {
    if (!med.snoozedUntil) return false;
    return med.snoozedUntil > now;
  };

  // ⚠️ Nota: tu lógica actual considera "Tomada" si nextDueAt es futuro.
  // (Mantengo esto igual para no romper UX).
  const isMedTaken = useCallback(
    (med: Medication): boolean => {
      if (med.nextDueAt && now < med.nextDueAt) return true;
      return false;
    },
    [now]
  );

  const formatSnoozeRemaining = (snoozedUntil: Date): string => {
    const diffMs = snoozedUntil.getTime() - now.getTime();
    if (diffMs <= 0) return "Ahora";

    const mins = Math.ceil(diffMs / 60000);
    if (mins < 60) return `${mins} min`;

    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  };

  // ======================= Cache reload (una sola fuente) =======================

  const reloadFromCache = useCallback(async () => {
    if (!ownerUid) return;

    try {
      const activeItems = await syncQueueService.getActiveItems(
        "medications",
        ownerUid
      );

      const processedMeds = (activeItems || []).map(mapToMedication);

      setMeds(processedMeds);
      setIsFromCache(true);
      setNow(new Date());
    } catch (error) {
      // No romper UI
      console.log("❌ Error recargando desde cache:", error);
    }
  }, [ownerUid]);

  // ✅ Recargar cache cada vez que vuelve a foco
  useFocusEffect(
    useCallback(() => {
      reloadFromCache();
    }, [reloadFromCache])
  );

  // ======================= Clock tick =======================

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(id);
  }, []);

  // ======================= Debug alarmas (opcional) =======================

  useEffect(() => {
    const checkAlarms = async () => {
      const alarms = await offlineAlarmService.getAllAlarms();
      console.log(`📱 Total alarmas programadas: ${alarms.length}`);
      alarms.forEach((alarm) => {
        console.log(
          `  - ${alarm.itemName}: ${new Date(
            alarm.triggerDate
          ).toLocaleString()}`
        );
      });
    };
    checkAlarms();
  }, []);

  // ======================= Loader principal: cache -> (si online) firebase snapshot =======================

  useEffect(() => {
    const effectiveUid = ownerUid || offlineAuthService.getCurrentUid();

    if (!effectiveUid) {
      console.log("⚠️ No hay usuario autenticado");
      setLoading(false);
      return;
    }

    let isMounted = true;
    let unsubscribe: (() => void) | null = null;

    const loadMedications = async () => {
      try {
        setLoading(true);

        // 1) Cache primero (solo activos para UI)
        const activeItems = await syncQueueService.getActiveItems(
          "medications",
          effectiveUid
        );
        if (isMounted && activeItems) {
          setMeds(activeItems.map(mapToMedication));
          setIsFromCache(true);
        }

        // 2) Conexión
        const netState = await NetInfo.fetch();
        const online =
          netState.isConnected === true &&
          netState.isInternetReachable !== false;

        if (!online) {
          console.log("🔴 Modo offline - usando solo cache");
          if (isMounted) setLoading(false);
          return;
        }

        // 3) Firebase snapshot (guardar TODO en cache, luego UI muestra activos)
        const medsRef = collection(db, "users", effectiveUid, "medications");
        const q = query(medsRef, orderBy("createdAt", "desc"));

        unsubscribe = onSnapshot(q, async (snapshot) => {
          if (!isMounted) return;

          console.log("🔥 [FIREBASE] Snapshot:", snapshot.docs.length, "docs");

          // Guardar TODO (activos + archivados) TAL CUAL
          const items = snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));

          await syncQueueService.saveToCache(
            "medications",
            effectiveUid,
            items
          );

          // UI = solo activos
          const updatedActiveItems = await syncQueueService.getActiveItems(
            "medications",
            effectiveUid
          );

          setMeds((updatedActiveItems || []).map(mapToMedication));
          setIsFromCache(false);
          setLoading(false);
        });

        if (isMounted) setLoading(false);
      } catch (error) {
        console.log("❌ Error cargando medicamentos:", error);
        if (isMounted) setLoading(false);
      }
    };

    loadMedications();

    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [ownerUid, reloadFromCache]);

  // ======================= Online state + procesar cola =======================

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

  // ======================= ✅ Marcar tomada (tu lógica, estable) =======================

  const onMarkTaken = async (med: Medication) => {
    if (!ownerUid) {
      Alert.alert(
        "Error",
        "No se encontró el usuario dueño de estos medicamentos."
      );
      return;
    }

    if (!checkModifyPermissions("registrar la toma")) return;

    if ((med.cantidadActual ?? 0) <= 0) {
      Alert.alert(
        "Sin existencias",
        "Este medicamento ya no tiene cantidad registrada."
      );
      return;
    }

    try {
      // 1) Cancelar alarma previa si existe
      if (med.currentAlarmId) {
        await offlineAlarmService.cancelAlarm(med.currentAlarmId);
        console.log(`🔕 Alarma cancelada: ${med.currentAlarmId}`);
      }

      const nowDate = new Date();
      const intervalMs = freqToMs(med.frecuencia);

      // 2) Inventario
      const initial = med.cantidadInicial ?? 0;
      const actual = med.cantidadActual ?? initial;
      const porToma = med.cantidadPorToma ?? 1;
      const nuevaCantidad = Math.max(0, actual - porToma);

      let low20 = med.low20Notified ?? false;
      let low10 = med.low10Notified ?? false;

      const porcentaje = initial > 0 ? nuevaCantidad / initial : 0;

      // 3) Notifs inventario
      if (!low20 && porcentaje <= 0.2 && porcentaje > 0.1) {
        await sendImmediateNotification(
          `Queda poco de ${med.nombre}`,
          "Te queda aproximadamente el 20%."
        );
        low20 = true;
      }

      if (!low10 && porcentaje <= 0.1) {
        await sendImmediateNotification(
          `⚠️ ${med.nombre} casi se termina`,
          "Solo te queda el 10% del medicamento."
        );
        low10 = true;
      }

      // 4) Próxima toma + alarma
      let nextDueAt: Date | null = null;
      let proximaTomaText = med.proximaToma ?? "";
      let newAlarmId: string | null = null;

      if (intervalMs > 0) {
        nextDueAt = new Date(nowDate.getTime() + intervalMs);
        proximaTomaText = nextDueAt.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        });

        const result = await offlineAlarmService.scheduleMedicationAlarm(
          nextDueAt,
          {
            nombre: med.nombre,
            dosis: med.dosis,
            imageUri: med.imageUri,
            medId: med.id,
            ownerUid: ownerUid,
            frecuencia: med.frecuencia,
            cantidadActual: nuevaCantidad,
            cantidadPorToma: porToma,
            patientName: patientName,
            snoozeCount: 0,
          }
        );

        if (result.success) {
          newAlarmId = result.notificationId;
          console.log(
            `✅ Alarma programada: ${newAlarmId} para ${nextDueAt.toLocaleString()}`
          );
        } else {
          console.error("❌ Error programando alarma:", result.error);
        }
      }

      // 5) Update payload
      const updateData: any = {
        lastTakenAt: nowDate.toISOString(),
        cantidadActual: nuevaCantidad,
        cantidad: nuevaCantidad, // (si lo usas en alguna parte legacy)
        low20Notified: low20,
        low10Notified: low10,
        updatedAt: nowDate.toISOString(),
        snoozeCount: 0,
        snoozedUntil: null,
        lastSnoozeAt: null,
      };

      if (newAlarmId) updateData.currentAlarmId = newAlarmId;
      if (nextDueAt) {
        updateData.nextDueAt = nextDueAt.toISOString();
        updateData.proximaToma = proximaTomaText;
      }

      // 6) Optimistic UI
      setMeds((prev) =>
        prev.map((m) =>
          m.id === med.id
            ? {
                ...m,
                proximaToma: proximaTomaText,
                nextDueAt: nextDueAt,
                cantidadActual: nuevaCantidad,
                low20Notified: low20,
                low10Notified: low10,
                currentAlarmId: newAlarmId,
                snoozeCount: 0,
                snoozedUntil: null,
                lastSnoozeAt: null,
                lastTakenAt: nowDate,
              }
            : m
        )
      );

      // 7) Cache inmediato
      await syncQueueService.updateItemInCache(
        "medications",
        ownerUid,
        med.id,
        updateData
      );
      console.log("✅ Cache actualizado localmente con alarma:", newAlarmId);

      // 8) Encolar sync
      await syncQueueService.enqueue(
        "UPDATE",
        "medications",
        med.id,
        ownerUid,
        updateData
      );
      setPendingChanges(await syncQueueService.getPendingCount());

      // 9) Forzar “tick”
      setNow(new Date());

      // 10) Verificación opcional
      if (newAlarmId) {
        const alarm = await offlineAlarmService.getAlarmById(newAlarmId);
        if (alarm) console.log("🔔 Alarma verificada:", alarm.triggerDate);
        else console.warn("⚠️ Alarma no encontrada tras programar");
      }

      Alert.alert(
        "¡Listo!",
        isOnline
          ? "Se registró la toma."
          : "Se registró la toma (se sincronizará cuando haya conexión)."
      );
    } catch (err) {
      console.log("❌ Error marcando tomada:", err);
      Alert.alert("Error", "No se pudo registrar la toma.");
    }
  };

  // ============================================================
  // ✅ Reprogramar Alarmas al Sincronizar (CRÍTICO)
  // ============================================================

  useEffect(() => {
    const reprogramMissingAlarms = async () => {
      if (!ownerUid || !isOnline || isFromCache) return;

      console.log("🔄 Verificando alarmas después de sincronización...");

      for (const med of meds) {
        if (med.nextDueAt && !med.currentAlarmId) {
          const nowDate = new Date();

          if (med.nextDueAt > nowDate) {
            console.log(`🔔 Reprogramando alarma para ${med.nombre}...`);

            try {
              const result = await offlineAlarmService.scheduleMedicationAlarm(
                med.nextDueAt,
                {
                  nombre: med.nombre,
                  dosis: med.dosis,
                  imageUri: med.imageUri,
                  medId: med.id,
                  ownerUid: ownerUid,
                  frecuencia: med.frecuencia,
                  cantidadActual: med.cantidadActual,
                  cantidadPorToma: med.cantidadPorToma,
                  patientName: patientName,
                  snoozeCount: 0,
                }
              );

              if (result.success && result.notificationId) {
                await syncQueueService.updateItemInCache(
                  "medications",
                  ownerUid,
                  med.id,
                  {
                    currentAlarmId: result.notificationId,
                  }
                );

                setMeds((prev) =>
                  prev.map((m) =>
                    m.id === med.id
                      ? { ...m, currentAlarmId: result.notificationId }
                      : m
                  )
                );

                console.log(`✅ Alarma reprogramada: ${result.notificationId}`);
              }
            } catch (err) {
              console.error(
                `❌ Error reprogramando alarma para ${med.nombre}:`,
                err
              );
            }
          }
        }
      }
    };

    if (isOnline && !isFromCache) {
      reprogramMissingAlarms();
    }
  }, [meds, isOnline, isFromCache, ownerUid, patientName]);

  // ======================= Snooze reset/reschedule =======================

  const onCancelSnoozeAndReschedule = async (med: Medication) => {
    if (!ownerUid) return;

    Alert.alert(
      "Reiniciar alarma",
      `¿Deseas cancelar la posposición de "${med.nombre}" y programar una nueva alarma?`,
      [
        { text: "No", style: "cancel" },
        {
          text: "Sí, reiniciar",
          onPress: async () => {
            try {
              if (med.currentAlarmId) {
                await offlineAlarmService.cancelAlarm(med.currentAlarmId);
                console.log(`🔕 Alarma cancelada: ${med.currentAlarmId}`);
              }

              Alert.alert(
                "Nueva alarma",
                "¿En cuánto tiempo te gustaría que te recuerde?",
                [
                  { text: "1 min", onPress: () => rescheduleAlarm(med, 1) },
                  { text: "5 min", onPress: () => rescheduleAlarm(med, 5) },
                  { text: "15 min", onPress: () => rescheduleAlarm(med, 15) },
                  { text: "30 min", onPress: () => rescheduleAlarm(med, 30) },
                  { text: "Cancelar", style: "cancel" },
                ]
              );
            } catch (err) {
              console.log("Error cancelando posposición:", err);
              Alert.alert("Error", "No se pudo cancelar la posposición.");
            }
          },
        },
      ]
    );
  };

  const rescheduleAlarm = async (med: Medication, minutes: number) => {
    if (!ownerUid) return;

    try {
      const newDueAt = new Date(Date.now() + minutes * 60000);
      const proximaTomaText = newDueAt.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });

      const result = await offlineAlarmService.scheduleMedicationAlarm(
        newDueAt,
        {
          nombre: med.nombre,
          dosis: med.dosis,
          imageUri: med.imageUri,
          medId: med.id,
          ownerUid: ownerUid,
          frecuencia: med.frecuencia,
          cantidadActual: med.cantidadActual,
          cantidadPorToma: med.cantidadPorToma,
          patientName: patientName,
          snoozeCount: 0,
        }
      );

      if (!result.success) {
        Alert.alert("Error", "No se pudo programar la alarma.");
        return;
      }

      const newAlarmId = result.notificationId;

      const updateData = {
        nextDueAt: newDueAt.toISOString(),
        proximaToma: proximaTomaText,
        currentAlarmId: newAlarmId,
        snoozeCount: 0,
        snoozedUntil: null,
        lastSnoozeAt: null,
      };

      // UI
      setMeds((prev) =>
        prev.map((m) =>
          m.id === med.id
            ? {
                ...m,
                nextDueAt: newDueAt,
                proximaToma: proximaTomaText,
                currentAlarmId: newAlarmId,
                snoozeCount: 0,
                snoozedUntil: null,
                lastSnoozeAt: null,
              }
            : m
        )
      );

      // Cache
      await syncQueueService.updateItemInCache(
        "medications",
        ownerUid,
        med.id,
        updateData
      );

      // Queue
      await syncQueueService.enqueue(
        "UPDATE",
        "medications",
        med.id,
        ownerUid,
        updateData
      );

      Alert.alert("¡Listo!", `Alarma programada para las ${proximaTomaText}`);
    } catch (err) {
      console.log("Error reprogramando alarma:", err);
      Alert.alert("Error", "No se pudo reprogramar la alarma.");
    }
  };

  // ======================= Navegación / acciones =======================

  const onAdd = () => {
    if (!checkModifyPermissions("agregar")) return;
    navigation.navigate("AddMedication" as any, { patientUid: ownerUid });
  };

  const onEditSelected = () => {
    const med = meds.find((m) => m.id === selectedMedId);
    if (!med) return;
    if (!checkModifyPermissions("editar")) return;

    navigation.navigate("AddMedication" as any, {
      medId: med.id,
      initialData: med,
      patientUid: ownerUid,
    });
  };

  const handleArchive = () => {
    if (!selectedMedId) {
      Alert.alert("Ups", "Selecciona un medicamento primero.");
      return;
    }

    const med = meds.find((m) => m.id === selectedMedId);
    if (!med) return;

    if (!checkModifyPermissions("archivar")) return;

    Alert.alert(
      "Archivar medicamento",
      `¿Deseas archivar "${med.nombre}"? Podrás restaurarlo después si lo necesitas.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Archivar",
          style: "destructive",
          onPress: async () => {
            try {
              if (med.currentAlarmId) {
                await offlineAlarmService.cancelAlarm(med.currentAlarmId);
              }

              await offlineAlarmService.cancelAllAlarmsForItem(
                med.id,
                ownerUid!
              );

              // Optimistic UI
              setMeds((prev) => prev.filter((m) => m.id !== selectedMedId));
              setSelectedMedId(null);

              // Encola operación (tu helper)
              await archiveMedication(ownerUid!, med.id, med);

              // Cache inmediato
              await syncQueueService.updateItemInCache(
                "medications",
                ownerUid!,
                med.id,
                {
                  isArchived: true,
                  archivedAt: new Date().toISOString(),
                }
              );

              setPendingChanges(await syncQueueService.getPendingCount());

              Alert.alert(
                "¡Listo!",
                isOnline
                  ? "Medicamento archivado correctamente."
                  : "Se sincronizará cuando haya conexión."
              );
            } catch (err) {
              console.log("Error:", err);
              Alert.alert("Error", "No se pudo archivar el medicamento.");
              // rollback UI
              setMeds((prev) => [...prev, med]);
            }
          },
        },
      ]
    );
  };

  // ======================= Render =======================

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={{ marginTop: 16, color: COLORS.textSecondary }}>
            Cargando medicamentos...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <OfflineBanner pendingChanges={pendingChanges} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>
              {isCaregiverView
                ? `Meds de ${patientName}`
                : "Medicamentos de hoy"}
            </Text>
            {isCaregiverView && (
              <Text style={styles.subtitle}>Vista de cuidador</Text>
            )}
          </View>
          <TouchableOpacity style={styles.roundIcon}>
            <MaterialIcons name="inventory" size={20} color={COLORS.surface} />
          </TouchableOpacity>
        </View>

        {/* Banner de cuidador */}
        {isCaregiverView && (
          <View style={styles.caregiverBanner}>
            <Text style={styles.caregiverText}>
              👀 Estás viendo los medicamentos de {patientName}.
              {!canModify && " Solo puedes ver, no modificar."}
            </Text>
          </View>
        )}

        {/* Lista vacía */}
        {meds.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No hay medicamentos</Text>
            <Text style={styles.emptyText}>
              Agrega tu primer medicamento para comenzar a recibir
              recordatorios.
            </Text>
            {canModify && (
              <TouchableOpacity
                style={[styles.primaryBtn, { marginTop: 16 }]}
                onPress={onAdd}
              >
                <Text style={styles.primaryText}>Agregar medicamento</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Lista */}
        {meds.map((med) => {
          const selected = med.id === selectedMedId;
          const isTaken = isMedTaken(med);
          const medIsSnoozed = isSnoozed(med);

          return (
            <TouchableOpacity
              key={med.id}
              activeOpacity={0.9}
              style={[
                styles.card,
                selected && { borderColor: COLORS.primary, borderWidth: 2 },
                medIsSnoozed && styles.cardSnoozed,
              ]}
              onPress={() =>
                setSelectedMedId((prev) => (prev === med.id ? null : med.id))
              }
            >
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.medTitle}>{med.nombre}</Text>
                  <Text style={styles.medSubtitle}>
                    {med.dosis || "Dosis no especificada"}
                    {med.frecuencia ? ` · cada ${med.frecuencia}` : ""}
                  </Text>

                  {typeof med.cantidadActual === "number" && (
                    <Text
                      style={{
                        marginTop: 4,
                        color: COLORS.textSecondary,
                        fontSize: FONT_SIZES.small,
                      }}
                    >
                      Cantidad disponible: {med.cantidadActual}
                    </Text>
                  )}
                </View>

                <View style={{ alignItems: "flex-end" }}>
                  {med.proximaToma && (
                    <View style={styles.timePill}>
                      <Text style={styles.timeText}>{med.proximaToma}</Text>
                    </View>
                  )}

                  {medIsSnoozed && med.snoozedUntil && (
                    <View style={styles.snoozeBadge}>
                      <MaterialIcons name="snooze" size={12} color="#FFA726" />
                      <Text style={styles.snoozeBadgeText}>
                        {med.snoozeCount}x ·{" "}
                        {formatSnoozeRemaining(med.snoozedUntil)}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Imagen */}
              {med.imageUri ? (
                <View style={styles.imageWrap}>
                  <Image
                    source={{ uri: med.imageUri }}
                    style={styles.medImage}
                    resizeMode="cover"
                  />
                </View>
              ) : null}

              {/* Caja info posposición */}
              {medIsSnoozed && (
                <View style={styles.snoozeInfoBox}>
                  <MaterialIcons name="warning" size={16} color="#FFA726" />
                  <Text style={styles.snoozeInfoText}>
                    Alarma pospuesta {med.snoozeCount}{" "}
                    {med.snoozeCount === 1 ? "vez" : "veces"}
                  </Text>
                  <TouchableOpacity
                    style={styles.snoozeResetBtn}
                    onPress={() => onCancelSnoozeAndReschedule(med)}
                  >
                    <Text style={styles.snoozeResetText}>Reiniciar</Text>
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  isTaken && !medIsSnoozed && styles.primaryBtnDisabled,
                ]}
                onPress={() => onMarkTaken(med)}
                disabled={isTaken && !medIsSnoozed}
              >
                <Text style={styles.primaryText}>
                  {medIsSnoozed
                    ? "Tomar ahora (cancela posposición)"
                    : isTaken
                    ? "✓ Tomada"
                    : "Marcar como tomada"}
                </Text>
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })}

        {/* Botones inferiores */}
        {meds.length > 0 && (
          <View style={styles.actions}>
            {canModify && (
              <>
                <TouchableOpacity
                  style={[
                    styles.primaryBtn,
                    {
                      alignSelf: "center",
                      marginTop: 18,
                      paddingHorizontal: 24,
                    },
                  ]}
                  onPress={onAdd}
                >
                  <Text style={styles.primaryText}>Agregar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.secondaryBtn,
                    !hasSelection && styles.disabledBtn,
                  ]}
                  onPress={onEditSelected}
                  disabled={!hasSelection}
                >
                  <Text style={styles.secondaryText}>Editar seleccionado</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.deleteBtn,
                    !hasSelection && styles.disabledBtn,
                  ]}
                  onPress={handleArchive}
                  disabled={!hasSelection}
                >
                  <Text style={styles.deleteText}>Eliminar seleccionado</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ===== Estilos ===== */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, paddingBottom: 28 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    color: COLORS.text,
    fontSize: FONT_SIZES.xlarge,
    fontWeight: "800",
  },
  subtitle: {
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  roundIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: COLORS.secondary,
    alignItems: "center",
    justifyContent: "center",
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

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    marginTop: 10,
  },
  cardSnoozed: {
    borderColor: "#FFA726",
    borderWidth: 2,
    backgroundColor: "#FFFBF5",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  medTitle: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: FONT_SIZES.large,
  },
  medSubtitle: { color: COLORS.text, fontWeight: "600", marginTop: 2 },

  timePill: {
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  timeText: { color: COLORS.surface, fontWeight: "800" },

  snoozeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255, 167, 38, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#FFA726",
  },
  snoozeBadgeText: {
    color: "#FFA726",
    fontSize: 11,
    fontWeight: "700",
  },

  snoozeInfoBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255, 167, 38, 0.1)",
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 167, 38, 0.3)",
  },
  snoozeInfoText: {
    flex: 1,
    color: "#F57C00",
    fontSize: FONT_SIZES.small,
    fontWeight: "600",
  },
  snoozeResetBtn: {
    backgroundColor: "#FFA726",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  snoozeResetText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
  },

  imageWrap: {
    alignItems: "center",
    marginTop: 8,
    marginBottom: 12,
  },
  medImage: { width: 150, height: 90, borderRadius: 6 },

  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryText: { color: COLORS.surface, fontWeight: "800" },

  actions: { marginTop: 20, gap: 14, alignItems: "center" },
  secondaryBtn: {
    width: 200,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryText: { color: COLORS.surface, fontWeight: "800" },

  deleteBtn: {
    width: 200,
    backgroundColor: "#D32F2F",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  deleteText: {
    color: COLORS.surface,
    fontWeight: "800",
  },

  disabledBtn: { opacity: 0.4 },

  emptyCard: {
    marginTop: 20,
    padding: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: FONT_SIZES.small,
    color: COLORS.textSecondary,
  },
});
