// src/screens/meds/MedsTodayScreen.tsx

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  FlatList,
  ActivityIndicator,
  Dimensions,
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

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

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
    blocked,
    selectMed,
    markTaken,
    addMed,
    editSelected,
    archiveSelected,

    isTaken,
  } = useMedsToday({ navigation, routeParams: route.params as any });

  const renderHeader = () => (
    <View>
      <View style={styles.headerRow}>
        <View style={styles.headerTextContainer}>
          <Text style={styles.title}>
            {isCaregiverView ? `Meds de ${patientName}` : "Medicamentos"}
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
            Agrega tu primer medicamento para comenzar a recibir recordatorios.
          </Text>

          {canModify && (
            <TouchableOpacity style={styles.addButtonEmpty} onPress={addMed}>
              <Text style={styles.primaryText}>Agregar medicamento</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );

  const renderMedCard = ({ item: med }: { item: any }) => {
    const selected = med.id === selectedMedId;
    const taken = isTaken(med);

    return (
      <View style={styles.cardContainer}>
        <TouchableOpacity
          activeOpacity={0.9}
          style={[styles.card, selected && styles.cardSelected]}
          onPress={() => selectMed(med.id)}
        >
          <View style={styles.cardContent}>
            <View style={styles.cardHeader}>
              <View style={styles.medInfoContainer}>
                <Text style={styles.medTitle} numberOfLines={2}>
                  {med.nombre}
                </Text>
                <Text style={styles.medSubtitle} numberOfLines={2}>
                  {med.dosis || "Dosis no especificada"}
                  {med.frecuencia ? ` · cada ${med.frecuencia}` : ""}
                </Text>

                {typeof med.cantidadActual === "number" && (
                  <Text style={styles.qtyText}>
                    Cantidad disponible: {med.cantidadActual}
                  </Text>
                )}
              </View>

              {med.proximaToma && (
                <View style={styles.timeContainer}>
                  <View style={styles.timePill}>
                    <Text style={styles.timeText}>{med.proximaToma}</Text>
                  </View>
                </View>
              )}
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
              style={[styles.takeBtn, taken && styles.takeBtnDisabled]}
              onPress={() => markTaken(med)}
              disabled={taken}
              activeOpacity={0.7}
            >
              <Text style={styles.takeBtnText} numberOfLines={1}>
                {taken ? "✓ Tomada" : "Marcar como tomada"}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const renderFooter = () => {
    if (meds.length === 0) return null;

    return (
      <View style={styles.footerContainer}>
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.primaryBtn]}
            onPress={addMed}
          >
            <Text style={styles.actionBtnText} numberOfLines={1}>
              Agregar
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.primaryBtn,
              !hasSelection && styles.disabledBtn,
            ]}
            onPress={editSelected}
            disabled={!hasSelection}
          >
            <Text style={styles.actionBtnText} numberOfLines={1}>
              Editar
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.dangerBtn,
              !hasSelection && styles.disabledBtn,
            ]}
            onPress={archiveSelected}
            disabled={!hasSelection}
          >
            <Text style={styles.actionBtnText} numberOfLines={1}>
              Eliminar
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };
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

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Cargando medicamentos...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <OfflineBanner pendingChanges={pendingChanges} />

      <View style={styles.container}>
        <FlatList
          data={meds}
          renderItem={renderMedCard}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          ListFooterComponent={renderFooter}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={false}
          windowSize={10}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          getItemLayout={(data, index) => ({
            length: 200,
            offset: 200 * index,
            index,
          })}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.medium,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    height: 60,
  },
  headerTextContainer: {
    flex: 1,
  },
  title: {
    color: COLORS.text,
    fontSize: FONT_SIZES.xlarge,
    fontWeight: "800",
    lineHeight: 28,
  },
  subtitle: {
    color: COLORS.textSecondary,
    marginTop: 4,
    fontSize: FONT_SIZES.medium,
  },
  roundIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: COLORS.secondary,
    alignItems: "center",
    justifyContent: "center",
  },

  caregiverBanner: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#E0F2FE",
  },
  caregiverText: {
    fontSize: FONT_SIZES.small,
    color: "#0F172A",
    lineHeight: 18,
  },

  cardContainer: {
    marginBottom: 16,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  cardSelected: {
    borderColor: COLORS.primary,
    borderWidth: 2,
  },
  cardContent: {
    padding: 16,
  },

  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
    minHeight: 60,
  },
  medInfoContainer: {
    flex: 1,
    marginRight: 12,
  },
  timeContainer: {
    justifyContent: "flex-start",
  },
  medTitle: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: FONT_SIZES.large,
    lineHeight: 22,
    marginBottom: 4,
  },
  medSubtitle: {
    color: COLORS.text,
    fontWeight: "600",
    fontSize: FONT_SIZES.medium,
    lineHeight: 20,
  },

  qtyText: {
    marginTop: 6,
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.small,
    lineHeight: 16,
  },

  timePill: {
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  timeText: {
    color: COLORS.surface,
    fontWeight: "800",
    fontSize: FONT_SIZES.small,
  },

  imageWrap: {
    alignItems: "center",
    marginVertical: 12,
  },
  medImage: {
    width: 150,
    height: 90,
    borderRadius: 6,
  },

  takeBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  takeBtnDisabled: {
    opacity: 0.6,
  },
  takeBtnText: {
    color: COLORS.surface,
    fontWeight: "800",
    fontSize: FONT_SIZES.small,
    textAlign: "center",
    includeFontPadding: false,
  },

  footerContainer: {
    marginTop: 8,
    paddingBottom: 16,
  },

  actionsRow: {
    flexDirection: "row",
    gap: 8,
  },

  actionBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },

  primaryBtn: {
    backgroundColor: COLORS.primary,
  },

  dangerBtn: {
    backgroundColor: "#D32F2F",
  },

  actionBtnText: {
    color: COLORS.surface,
    fontWeight: "800",
    fontSize: FONT_SIZES.small,
    textAlign: "center",
    includeFontPadding: false,
  },

  disabledBtn: {
    opacity: 0.4,
  },

  addButtonEmpty: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    marginTop: 16,
  },
  primaryText: {
    color: COLORS.surface,
    fontWeight: "800",
    fontSize: FONT_SIZES.medium,
    textAlign: "center",
  },

  emptyCard: {
    marginTop: 16,
    padding: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
    lineHeight: 24,
  },
  emptyText: {
    fontSize: FONT_SIZES.small,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
});
