// src/hooks/useMedsToday.ts

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";

import { RootStackParamList } from "../navigation/StackNavigator";
import { offlineAuthService } from "../services/offline/OfflineAuthService";
import { auth } from "../config/firebaseConfig";
import { useOffline } from "../context/OfflineContext";

import medsService, { Medication } from "../services/medsService";
import { hasPermission } from "../services/careNetworkService";

type Nav = StackNavigationProp<RootStackParamList, "MedsToday">;

type RouteParams = {
  patientUid?: string;
  patientName?: string;
  accessMode?: "full" | "read-only" | "alerts-only" | "disabled";
};

export function useMedsToday(args: {
  navigation: Nav;
  routeParams?: RouteParams;
}) {
  const { navigation, routeParams } = args;
  const params = routeParams ?? {};

  const accessMode = params.accessMode ?? "full";
  const canView = hasPermission(accessMode, "view");

  const initialPatientName =
    typeof params.patientName === "string" ? params.patientName : "";

  const [patientName] = useState<string>(initialPatientName);

  const [meds, setMeds] = useState<Array<Medication & { id: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMedId, setSelectedMedId] = useState<string | null>(null);

  const [now, setNow] = useState<Date>(new Date());
  const hasSelection = !!selectedMedId;

  const { isOnline, pendingOperations } = useOffline();

  const loggedUserUid = offlineAuthService.getCurrentUid();

  const ownerUid = params.patientUid ?? loggedUserUid ?? null;

  const isCaregiverView =
    !!params.patientUid && params.patientUid !== loggedUserUid;

  // ❗ De momento NADIE modifica desde aquí (tal como lo quieres)
  const canModify = ownerUid === loggedUserUid;

  /* ============================================================
   *  BLOQUEO TOTAL DE LECTURA (alerts-only / disabled)
   * ============================================================ */
  if (!canView) {
    return {
      // estado
      loading: false,
      meds: [],
      selectedMedId: null,
      patientName,
      isOnline,
      pendingChanges: pendingOperations,

      // permisos
      ownerUid,
      canModify: false,
      isCaregiverView: true,
      hasSelection: false,
      blocked: true,

      // acciones NO-OP
      selectMed: () => {},
      markTaken: async () => {},
      addMed: () => {},
      editSelected: () => {},
      archiveSelected: () => {},

      // helpers
      isTaken: () => false,
    };
  }

  /* ============================================================
   * Permisos de modificación (se mantiene tu lógica actual)
   * ============================================================ */
  const checkModifyPermissions = useCallback(
    (action: string): boolean => {
      if (!canModify) {
        Alert.alert(
          "Sin permisos",
          `Solo el paciente puede ${action} medicamentos.`
        );
        return false;
      }
      return true;
    },
    [canModify]
  );

  /* ============================================================
   * Tick para cálculos de "tomada"
   * ============================================================ */
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(id);
  }, []);

  /* ============================================================
   * Cache offline-first
   * ============================================================ */
  const reloadFromCache = useCallback(async () => {
    if (!ownerUid) return;
    try {
      const list = await medsService.getActiveMedsFromCache(ownerUid);
      const withId = list.filter(
        (m): m is Medication & { id: string } => !!m.id
      ) as any;
      setMeds(withId);
    } catch {
      // no-op
    }
  }, [ownerUid]);

  useFocusEffect(
    useCallback(() => {
      reloadFromCache();
    }, [reloadFromCache])
  );
  useEffect(() => {
    if (!ownerUid) return;

    if (isOnline && pendingOperations === 0) {
      reloadFromCache();
    }
  }, [isOnline, pendingOperations, ownerUid, reloadFromCache]);
  /* ============================================================
   * Firestore realtime (solo si online)
   * ============================================================ */
  useEffect(() => {
    if (!ownerUid) {
      setLoading(false);
      return;
    }

    let mounted = true;
    let unsubscribe: null | (() => void) = null;

    const start = async () => {
      try {
        setLoading(true);

        await reloadFromCache();
        if (!mounted) return;

        if (!isOnline) {
          setLoading(false);
          return;
        }

        unsubscribe = medsService.subscribeMedicationsFirestore(
          ownerUid,
          (list) => {
            if (!mounted) return;
            const withId = list.filter(
              (m): m is Medication & { id: string } => !!m.id
            ) as any;
            setMeds(withId);
            setLoading(false);
          },
          () => {
            if (!mounted) return;
            setLoading(false);
          }
        );
      } catch {
        if (mounted) setLoading(false);
      }
    };

    start();

    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [ownerUid, isOnline, reloadFromCache]);

  /* ============================================================
   * Reprogramar alarmas (solo online)
   * ============================================================ */
  useEffect(() => {
    if (!ownerUid) return;
    if (!isOnline) return;
    if (meds.length === 0) return;

    medsService.reprogramMissingAlarms({
      ownerUid,
      meds,
      patientName,
    });
  }, [meds, isOnline, ownerUid, patientName]);

  /* ============================================================
   * Acciones
   * ============================================================ */
  const selectMed = useCallback((id: string) => {
    setSelectedMedId((prev) => (prev === id ? null : id));
  }, []);

  const isTaken = useCallback(
    (med: Medication) => medsService.isMedTaken(med, now),
    [now]
  );

  const markTaken = useCallback(
    async (med: Medication & { id: string }) => {
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
        const { updatedMed } = await medsService.markMedicationTaken({
          ownerUid,
          med,
          patientName,
        });

        //  Actualizar el estado inmediatamente con el medicamento actualizado
        setMeds((prev) => prev.map((m) => (m.id === med.id ? updatedMed : m)));

        //  Forzar actualización del timestamp para re-calcular isTaken
        setNow(new Date());

        // Recargar desde cache para asegurar consistencia
        setTimeout(() => reloadFromCache(), 100);
      } catch (error) {
        console.error("Error al marcar medicamento como tomado:", error);
        Alert.alert("Error", "No se pudo registrar la toma.");
      }
    },
    [ownerUid, checkModifyPermissions, patientName, reloadFromCache]
  );

  const addMed = useCallback(() => {
    if (!ownerUid) return;
    if (!checkModifyPermissions("agregar")) return;
    navigation.navigate("AddMedication" as any, { patientUid: ownerUid });
  }, [checkModifyPermissions, navigation, ownerUid]);

  const editSelected = useCallback(() => {
    if (!ownerUid) return;
    const med = meds.find((m) => m.id === selectedMedId);
    if (!med) return;
    if (!checkModifyPermissions("editar")) return;

    navigation.navigate("AddMedication" as any, {
      medId: med.id,
      initialData: med,
      patientUid: ownerUid,
    });
  }, [checkModifyPermissions, meds, navigation, ownerUid, selectedMedId]);

  const archiveSelected = useCallback(() => {
    if (!ownerUid) return;

    if (!selectedMedId) {
      Alert.alert("Ups", "Selecciona un medicamento primero.");
      return;
    }

    const med = meds.find((m) => m.id === selectedMedId);
    if (!med) return;

    if (!checkModifyPermissions("archivar")) return;

    Alert.alert("Archivar medicamento", `¿Deseas archivar "${med.nombre}"?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Archivar",
        style: "destructive",
        onPress: async () => {
          try {
            // Actualización optimista
            setMeds((prev) => prev.filter((m) => m.id !== selectedMedId));
            setSelectedMedId(null);

            await medsService.archiveMedication(ownerUid, med.id, med);

            // Sin alerta innecesaria - el cambio es visible inmediatamente
          } catch (error) {
            console.error("Error al archivar medicamento:", error);
            // Revertir cambio optimista si falla
            setMeds((prev) =>
              [...prev, med].sort((a, b) => (a.nombre > b.nombre ? 1 : -1))
            );
            Alert.alert("Error", "No se pudo archivar el medicamento.");
          }
        },
      },
    ]);
  }, [ownerUid, selectedMedId, meds, checkModifyPermissions]);

  const pendingChanges = pendingOperations;

  return useMemo(
    () => ({
      // state
      loading,
      meds,
      selectedMedId,
      patientName,
      isOnline,
      pendingChanges,

      // permissions
      ownerUid,
      canModify,
      isCaregiverView,
      hasSelection,
      blocked: false,

      // actions
      selectMed,
      markTaken,
      addMed,
      editSelected,
      archiveSelected,

      // helpers
      isTaken,
    }),
    [
      loading,
      meds,
      selectedMedId,
      patientName,
      isOnline,
      pendingChanges,
      ownerUid,
      canModify,
      isCaregiverView,
      hasSelection,
      selectMed,
      markTaken,
      addMed,
      editSelected,
      archiveSelected,
      isTaken,
    ]
  );
}
