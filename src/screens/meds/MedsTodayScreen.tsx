// src/screens/meds/MedsTodayScreen.tsx
// ✅ UI SIN AMARILLO (tarjeta igual siempre)
// ✅ Posponer NO cambia el botón; solo mueve proximaToma/nextDueAt
// ✅ Si está pospuesto (snoozedUntil > now) NO se considera "tomada"

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
import { offlineAuthService } from "../../services/offline/OfflineAuthService";
import { archiveMedication } from "../../utils/archiveHelpers";

// Firebase
import { auth, db } from "../../config/firebaseConfig";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";

// Servicios
import { sendImmediateNotification } from "../../services/Notifications";
import { offlineAlarmService } from "../../services/offline/OfflineAlarmService";
import { syncQueueService } from "../../services/offline/SyncQueueService";
import { OfflineBanner } from "../../components/OfflineBanner";
import NetInfo from "@react-native-community/netinfo";

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
  const match = freq.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  const totalMinutes = h * 60 + m;
  return totalMinutes * 60 * 1000;
};

/**
 * ✅ Convierte de forma segura ISO string | Date | Firestore Timestamp | {seconds} -> Date | null
 */
const toDateSafe = (v: any): Date | null => {
  if (!v) return null;

  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof v?.toDate === "function") {
    const d = v.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }

  if (typeof v?.seconds === "number") {
    const d = new Date(v.seconds * 1000);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
};

export default function MedsTodayScreen({ navigation }: { navigation: Nav }) {
  const route = useRoute<MedsRoute>();

  const params = route.params ?? {};
  const initialPatientName =
    typeof params.patientName === "string" ? params.patientName : "";

  const [meds, setMeds] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMedId, setSelectedMedId] = useState<string | null>(null);

  const [patientName] = useState<string>(initialPatientName);

  const [now, setNow] = useState<Date>(new Date());
  const hasSelection = !!selectedMedId;

  const loggedUserUid =
    auth.currentUser?.uid || offlineAuthService.getCurrentUid();

  const ownerUid = params.patientUid ?? loggedUserUid ?? null;

  const isCaregiverView =
    !!params.patientUid && params.patientUid !== loggedUserUid;

  const canModify = ownerUid === loggedUserUid;

  const [isOnline, setIsOnline] = useState(true);
  const [isFromCache, setIsFromCache] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(0);

  // ======================= Carga desde cache al enfocar =======================

  useFocusEffect(
    useCallback(() => {
      const forceReload = async () => {
        if (!ownerUid) return;

        try {
          const activeItems = await syncQueueService.getActiveItems(
            "medications",
            ownerUid
          );

          if (activeItems && activeItems.length >= 0) {
            const processedMeds = activeItems.map((data: any) => ({
              id: data.id,
              nombre: data.nombre || "Medicamento sin nombre",
              dosis: data.dosis,
              frecuencia: data.frecuencia,
              proximaToma: data.proximaToma,
              nextDueAt: toDateSafe(data.nextDueAt),
              cantidadInicial: data.cantidadInicial || 0,
              cantidadActual: data.cantidadActual || 0,
              cantidadPorToma: data.cantidadPorToma || 1,
              imageUri: data.imageUri || "",
              currentAlarmId: data.currentAlarmId || null,
              snoozeCount: data.snoozeCount || 0,
              snoozedUntil: toDateSafe(data.snoozedUntil),
              lastSnoozeAt: toDateSafe(data.lastSnoozeAt),
              lastTakenAt: toDateSafe(data.lastTakenAt),
              low20Notified: data.low20Notified ?? false,
              low10Notified: data.low10Notified ?? false,
            }));

            setMeds(processedMeds);
            setNow(new Date());
          }
        } catch {
          // no-op
        }
      };

      forceReload();
    }, [ownerUid])
  );

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(id);
  }, []);

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

  const reloadFromCache = useCallback(async () => {
    if (!ownerUid) return;

    try {
      const activeItems = await syncQueueService.getActiveItems(
        "medications",
        ownerUid
      );

      if (activeItems && activeItems.length > 0) {
        const processedMeds = activeItems.map((data: any) => ({
          id: data.id,
          nombre: data.nombre || "Medicamento sin nombre",
          dosis: data.dosis,
          frecuencia: data.frecuencia,
          proximaToma: data.proximaToma,
          nextDueAt: toDateSafe(data.nextDueAt),
          cantidadInicial: data.cantidadInicial || 0,
          cantidadActual: data.cantidadActual || 0,
          cantidadPorToma: data.cantidadPorToma || 1,
          imageUri: data.imageUri || "",
          currentAlarmId: data.currentAlarmId || null,
          snoozeCount: data.snoozeCount || 0,
          snoozedUntil: toDateSafe(data.snoozedUntil),
          lastSnoozeAt: toDateSafe(data.lastSnoozeAt),
          lastTakenAt: toDateSafe(data.lastTakenAt),
          low20Notified: data.low20Notified ?? false,
          low10Notified: data.low10Notified ?? false,
        }));

        setMeds(processedMeds);
        setIsFromCache(true);
      } else {
        setMeds([]);
      }
    } catch (error) {
      console.log("❌ Error recargando:", error);
    }
  }, [ownerUid]);

  useFocusEffect(
    useCallback(() => {
      reloadFromCache();
    }, [reloadFromCache])
  );

  // ======================= Suscripción Firebase =======================

  useEffect(() => {
    const effectiveUid = ownerUid || offlineAuthService.getCurrentUid();

    if (!effectiveUid) {
      setLoading(false);
      return;
    }

    let isMounted = true;
    let unsubscribe: (() => void) | null = null;

    const loadMedications = async () => {
      try {
        setLoading(true);
        const uidToUse = effectiveUid;

        const activeItems = await syncQueueService.getActiveItems(
          "medications",
          uidToUse
        );

        if (activeItems && activeItems.length > 0 && isMounted) {
          const processedMeds = activeItems.map((data: any) => ({
            id: data.id,
            nombre: data.nombre || "Medicamento sin nombre",
            dosis: data.dosis,
            frecuencia: data.frecuencia,
            proximaToma: data.proximaToma,
            nextDueAt: toDateSafe(data.nextDueAt),
            cantidadInicial: data.cantidadInicial || 0,
            cantidadActual: data.cantidadActual || 0,
            cantidadPorToma: data.cantidadPorToma || 1,
            imageUri: data.imageUri || "",
            currentAlarmId: data.currentAlarmId || null,
            snoozeCount: data.snoozeCount || 0,
            snoozedUntil: toDateSafe(data.snoozedUntil),
            lastSnoozeAt: toDateSafe(data.lastSnoozeAt),
            lastTakenAt: toDateSafe(data.lastTakenAt),
            low20Notified: data.low20Notified ?? false,
            low10Notified: data.low10Notified ?? false,
          }));

          setMeds(processedMeds);
          setIsFromCache(true);
          setLoading(false);
        }

        const netState = await NetInfo.fetch();
        const isOnlineNow =
          netState.isConnected === true &&
          netState.isInternetReachable !== false;

        if (!isOnlineNow) {
          setLoading(false);
          return;
        }

        const medsRef = collection(db, "users", uidToUse, "medications");
        const q = query(medsRef, orderBy("createdAt", "desc"));

        unsubscribe = onSnapshot(q, async (snapshot) => {
          if (!isMounted) return;

          const items = snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));

          await syncQueueService.saveToCache("medications", uidToUse, items);

          const updatedActiveItems = await syncQueueService.getActiveItems(
            "medications",
            uidToUse
          );

          const finalMeds = updatedActiveItems.map((data: any) => ({
            id: data.id,
            nombre: data.nombre || "Medicamento sin nombre",
            dosis: data.dosis,
            frecuencia: data.frecuencia,
            proximaToma: data.proximaToma,
            nextDueAt: toDateSafe(data.nextDueAt),
            cantidadInicial: data.cantidadInicial || 0,
            cantidadActual: data.cantidadActual || 0,
            cantidadPorToma: data.cantidadPorToma || 1,
            imageUri: data.imageUri || "",
            currentAlarmId: data.currentAlarmId || null,
            snoozeCount: data.snoozeCount || 0,
            snoozedUntil: toDateSafe(data.snoozedUntil),
            lastSnoozeAt: toDateSafe(data.lastSnoozeAt),
            lastTakenAt: toDateSafe(data.lastTakenAt),
            low20Notified: data.low20Notified ?? false,
            low10Notified: data.low10Notified ?? false,
          }));

          setMeds(finalMeds);
          setIsFromCache(false);
          setLoading(false);
        });
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
  }, [ownerUid]);

  // ======================= Online / cola =======================

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

  // ======================= Helpers =======================

  const isSnoozed = (med: Medication): boolean => {
    if (!med.snoozedUntil) return false;
    return med.snoozedUntil > now;
  };

  const isMedTaken = useCallback(
    (med: Medication): boolean => {
      // ✅ Si está pospuesto, NO se considera "tomada"
      if (isSnoozed(med)) return false;

      // ✅ Si ya tiene un nextDueAt futuro (ciclo programado), se considera tomada
      if (med.nextDueAt && now < med.nextDueAt) return true;

      return false;
    },
    [now]
  );

  // ======================= Acción marcar tomada =======================

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
      if (med.currentAlarmId) {
        await offlineAlarmService.cancelAlarm(med.currentAlarmId);
      }

      const nowDate = new Date();
      const intervalMs = freqToMs(med.frecuencia);

      const initial = med.cantidadInicial ?? 0;
      const actual = med.cantidadActual ?? initial;
      const porToma = med.cantidadPorToma ?? 1;
      const nuevaCantidad = Math.max(0, actual - porToma);

      let low20 = med.low20Notified ?? false;
      let low10 = med.low10Notified ?? false;

      const porcentaje = initial > 0 ? nuevaCantidad / initial : 0;

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

      let nextDueAt: Date | null = null;
      let proximaTomaText = med.proximaToma ?? "";
      let newAlarmId: string | null = null;

      if (intervalMs > 0) {
        nextDueAt = new Date(nowDate.getTime() + intervalMs);
        proximaTomaText = nextDueAt.toLocaleTimeString("es-MX", {
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

        if (result.success) newAlarmId = result.notificationId;
      }

      const updateData: any = {
        lastTakenAt: nowDate.toISOString(),
        cantidadActual: nuevaCantidad,
        cantidad: nuevaCantidad,
        low20Notified: low20,
        low10Notified: low10,
        updatedAt: nowDate.toISOString(),

        // ✅ al tomar, se limpian estados de posposición
        snoozeCount: 0,
        snoozedUntil: null,
        lastSnoozeAt: null,
      };

      if (newAlarmId) updateData.currentAlarmId = newAlarmId;

      if (nextDueAt) {
        updateData.nextDueAt = nextDueAt.toISOString();
        updateData.proximaToma = proximaTomaText;
      }

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

      await syncQueueService.updateItemInCache(
        "medications",
        ownerUid,
        med.id,
        updateData
      );

      await syncQueueService.enqueue(
        "UPDATE",
        "medications",
        med.id,
        ownerUid,
        updateData
      );

      const pending = await syncQueueService.getPendingCount();
      setPendingChanges(pending);

      setNow(new Date());

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
  // Reprogramar alarmas faltantes al sincronizar
  // ============================================================

  useEffect(() => {
    const reprogramMissingAlarms = async () => {
      if (!ownerUid || !isOnline || isFromCache) return;

      for (const med of meds) {
        if (med.nextDueAt && !med.currentAlarmId) {
          const nowLocal = new Date();
          if (med.nextDueAt > nowLocal) {
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
                  snoozeCount: med.snoozeCount ?? 0,
                }
              );

              if (result.success && result.notificationId) {
                await syncQueueService.updateItemInCache(
                  "medications",
                  ownerUid,
                  med.id,
                  { currentAlarmId: result.notificationId }
                );

                setMeds((prev) =>
                  prev.map((m) =>
                    m.id === med.id
                      ? { ...m, currentAlarmId: result.notificationId }
                      : m
                  )
                );
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

    if (isOnline && !isFromCache) reprogramMissingAlarms();
  }, [meds, isOnline, isFromCache, ownerUid]);

  // ======================= Otras acciones =======================

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

              setMeds((prev) => prev.filter((m) => m.id !== selectedMedId));
              setSelectedMedId(null);

              await archiveMedication(ownerUid!, med.id, med);

              await syncQueueService.updateItemInCache(
                "medications",
                ownerUid!,
                med.id,
                {
                  isArchived: true,
                  archivedAt: new Date().toISOString(),
                }
              );

              const pending = await syncQueueService.getPendingCount();
              setPendingChanges(pending);

              Alert.alert(
                "¡Listo!",
                isOnline
                  ? "Medicamento archivado correctamente."
                  : "Se sincronizará cuando haya conexión."
              );
            } catch (err) {
              console.log("Error:", err);
              Alert.alert("Error", "No se pudo archivar el medicamento.");
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

        {isCaregiverView && (
          <View style={styles.caregiverBanner}>
            <Text style={styles.caregiverText}>
              👀 Estás viendo los medicamentos de {patientName}.
              {!canModify && " Solo puedes ver, no modificar."}
            </Text>
          </View>
        )}

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

        {meds.map((med) => {
          const selected = med.id === selectedMedId;
          const isTaken = isMedTaken(med);

          return (
            <TouchableOpacity
              key={med.id}
              activeOpacity={0.9}
              style={[
                styles.card,
                selected && { borderColor: COLORS.primary, borderWidth: 2 },
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
                </View>
              </View>

              {med.imageUri ? (
                <View style={styles.imageWrap}>
                  <Image
                    source={{ uri: med.imageUri }}
                    style={styles.medImage}
                    resizeMode="cover"
                  />
                </View>
              ) : null}

              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  isTaken && styles.primaryBtnDisabled,
                ]}
                onPress={() => onMarkTaken(med)}
                disabled={isTaken}
              >
                <Text style={styles.primaryText}>
                  {isTaken ? "✓ Tomada" : "Marcar como tomada"}
                </Text>
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })}

        {meds.length > 0 && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                { alignSelf: "center", marginTop: 18, paddingHorizontal: 24 },
              ]}
              onPress={onAdd}
            >
              <Text style={styles.primaryText}>Agregar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryBtn, !hasSelection && styles.disabledBtn]}
              onPress={onEditSelected}
              disabled={!hasSelection}
            >
              <Text style={styles.secondaryText}>Editar seleccionado</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.deleteBtn, !hasSelection && styles.disabledBtn]}
              onPress={handleArchive}
              disabled={!hasSelection}
            >
              <Text style={styles.deleteText}>Eliminar seleccionado</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

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
  subtitle: { color: COLORS.textSecondary, marginTop: 4 },
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
  primaryBtnDisabled: { opacity: 0.6 },
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
  deleteText: { color: COLORS.surface, fontWeight: "800" },

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
