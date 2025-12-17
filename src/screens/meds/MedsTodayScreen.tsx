// src/screens/meds/MedsTodayScreen.tsx

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";
import { COLORS, FONT_SIZES } from "../../../types";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRoute, RouteProp } from "@react-navigation/native";

import { OfflineBanner } from "../../components/OfflineBanner";
import { useMedsToday } from "../../hooks/useMedsToday";

type Nav = StackNavigationProp<RootStackParamList, "MedsToday">;
type MedsRoute = RouteProp<RootStackParamList, "MedsToday">;

export default function MedsTodayScreen({ navigation }: { navigation: Nav }) {
  const route = useRoute<MedsRoute>();

  const {
    loading,
    meds,
    selectedMedId,
    patientName,
    pendingChanges,

    canModify,
    isCaregiverView,
    hasSelection,

    selectMed,
    markTaken,
    addMed,
    editSelected,
    archiveSelected,

    isTaken,
  } = useMedsToday({ navigation, routeParams: route.params as any });

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
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
                onPress={addMed}
              >
                <Text style={styles.primaryText}>Agregar medicamento</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {meds.map((med) => {
          const selected = med.id === selectedMedId;
          const taken = isTaken(med);

          return (
            <TouchableOpacity
              key={med.id}
              activeOpacity={0.9}
              style={[
                styles.card,
                selected && { borderColor: COLORS.primary, borderWidth: 2 },
              ]}
              onPress={() => selectMed(med.id)}
            >
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.medTitle}>{med.nombre}</Text>
                  <Text style={styles.medSubtitle}>
                    {med.dosis || "Dosis no especificada"}
                    {med.frecuencia ? ` · cada ${med.frecuencia}` : ""}
                  </Text>

                  {typeof med.cantidadActual === "number" && (
                    <Text style={styles.qtyText}>
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
                style={[styles.primaryBtn, taken && styles.primaryBtnDisabled]}
                onPress={() => markTaken(med)}
                disabled={taken}
              >
                <Text style={styles.primaryText}>
                  {taken ? "✓ Tomada" : "Marcar como tomada"}
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
              onPress={addMed}
            >
              <Text style={styles.primaryText}>Agregar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryBtn, !hasSelection && styles.disabledBtn]}
              onPress={editSelected}
              disabled={!hasSelection}
            >
              <Text style={styles.secondaryText}>Editar seleccionado</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.deleteBtn, !hasSelection && styles.disabledBtn]}
              onPress={archiveSelected}
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

  center: { flex: 1, justifyContent: "center", alignItems: "center" },

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
  caregiverText: { fontSize: FONT_SIZES.small, color: "#0F172A" },

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

  qtyText: {
    marginTop: 4,
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.small,
  },

  timePill: {
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  timeText: { color: COLORS.surface, fontWeight: "800" },

  imageWrap: { alignItems: "center", marginTop: 8, marginBottom: 12 },
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
  emptyText: { fontSize: FONT_SIZES.small, color: COLORS.textSecondary },
});
