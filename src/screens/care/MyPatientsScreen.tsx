// src/screens/care/MyPatientsScreen.tsx
// ✅ REFACTORIZADA: Solo UI, lógica en hooks y servicios

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import { COLORS, FONT_SIZES } from "../../../types";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";

// 🎯 Hook personalizado con toda la lógica
import { useMyPatients } from "../../hooks/useCaregiverHooks";
import {
  getAccessModeLabel,
  type PatientLink,
} from "../../services/careNetworkService";

type Nav = StackNavigationProp<RootStackParamList, "MyPatients">;

interface Props {
  navigation: Nav;
}

export default function MyPatientsScreen({ navigation }: Props) {
  // 🎯 Toda la lógica viene del hook
  const { patients, profilePhotos, loading } = useMyPatients();

  /* =========================================
   *           📝 HANDLERS
   * ========================================= */

  const goToPatient = (p: PatientLink, screen: keyof RootStackParamList) => {
    navigation.navigate(
      screen as any,
      {
        patientUid: p.ownerUid,
        patientName: p.ownerName,
      } as any
    );
  };

  /* =========================================
   *           🎨 RENDER HELPERS
   * ========================================= */

  const renderPatientCard = (p: PatientLink) => {
    const photoUri = profilePhotos[p.ownerUid];
    const accessLabel = getAccessModeLabel(p.accessMode || "alerts-only");

    return (
      <View key={p.path} style={styles.card}>
        {/* Header con foto y datos */}
        <View style={styles.cardHeader}>
          <View style={styles.iconCircle}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatar} />
            ) : (
              <FontAwesome5 name="user" size={18} color={COLORS.surface} />
            )}
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{p.ownerName}</Text>
            {!!p.relationship && (
              <Text style={styles.cardSubtitle}>
                Parentesco: {p.relationship}
              </Text>
            )}
            <Text style={styles.cardSubtitle}>Permisos: {accessLabel}</Text>
          </View>
        </View>

        {/* Botones de acción */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.primaryBtn]}
            onPress={() => goToPatient(p, "MedsToday")}
          >
            <Text style={styles.actionText}>Medicación</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.primaryBtn]}
            onPress={() => goToPatient(p, "Appointments")}
          >
            <Text style={styles.actionText}>Citas</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.primaryBtn]}
            onPress={() => goToPatient(p, "NewReminder")}
          >
            <Text style={styles.actionText}>Hábitos</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.secondaryBtn]}
            onPress={() => goToPatient(p, "History")}
          >
            <Text style={styles.secondaryText}>Historial</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyCard}>
      <MaterialIcons
        name="supervisor-account"
        size={48}
        color={COLORS.textSecondary}
      />
      <Text style={styles.emptyTitle}>Sin pacientes asignados</Text>
      <Text style={styles.emptyText}>
        Cuando un paciente te agregue a su red de apoyo, aparecerá aquí.
      </Text>
    </View>
  );

  const renderLoading = () => (
    <View style={styles.emptyCard}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.emptyText}>Cargando pacientes...</Text>
    </View>
  );

  /* =========================================
   *              🎨 RENDER MAIN
   * ========================================= */

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Mis pacientes</Text>
            <Text style={styles.subtitle}>
              Consulta la información de los pacientes que te han agregado como
              parte de su red de apoyo.
            </Text>
          </View>
          <View style={styles.sectionIcon}>
            <MaterialIcons
              name="supervisor-account"
              size={24}
              color={COLORS.surface}
            />
          </View>
        </View>

        {/* Content */}
        {loading
          ? renderLoading()
          : patients.length === 0
          ? renderEmpty()
          : patients.map(renderPatientCard)}
      </ScrollView>
    </SafeAreaView>
  );
}

/* =========================================
 *              🎨 STYLES
 * ========================================= */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1 },
  content: { padding: 10, paddingBottom: 24 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: FONT_SIZES.xlarge,
    fontWeight: "800",
    color: COLORS.text,
  },
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

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginTop: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    overflow: "hidden",
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  cardTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: "800",
    color: COLORS.text,
  },
  cardSubtitle: {
    fontSize: FONT_SIZES.small,
    color: COLORS.textSecondary,
  },

  actionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: {
    backgroundColor: COLORS.primary,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surface,
  },
  actionText: {
    color: COLORS.surface,
    fontWeight: "800",
    fontSize: FONT_SIZES.medium,
  },
  secondaryText: {
    color: COLORS.primary,
    fontWeight: "800",
    fontSize: FONT_SIZES.medium,
  },

  emptyCard: {
    marginTop: 40,
    alignItems: "center",
    padding: 20,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: "700",
    color: COLORS.text,
    marginTop: 12,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: FONT_SIZES.small,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: 8,
  },
});
