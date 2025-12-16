// src/screens/care/CareInvitesScreen.tsx
// ✅ REFACTORIZADA: Solo UI, lógica en hooks y servicios

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Alert,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS } from "../../../types";

// 🎯 Hook personalizado con toda la lógica
import { useCareInvites } from "../../hooks/useCaregiverHooks";
import type { CareInvite } from "../../services/careNetworkService";

export default function CareInvitesScreen() {
  // 🎯 Toda la lógica viene del hook
  const { invites, loading, acceptInvite, rejectInvite } = useCareInvites();

  /* =========================================
   *           📝 HANDLERS
   * ========================================= */

  const handleAccept = async (invite: CareInvite) => {
    try {
      await acceptInvite(invite.id);
      Alert.alert("✅ Invitación aceptada");
    } catch (error) {
      Alert.alert("Error", "No se pudo aceptar la invitación.");
    }
  };

  const handleReject = async (invite: CareInvite) => {
    try {
      await rejectInvite(invite.id);
      Alert.alert("✅ Invitación rechazada");
    } catch (error) {
      Alert.alert("Error", "No se pudo rechazar la invitación.");
    }
  };

  /* =========================================
   *           🎨 RENDER HELPERS
   * ========================================= */

  const renderInviteCard = ({ item }: { item: CareInvite }) => (
    <View style={styles.card}>
      <Text style={styles.name}>{item.name || "Paciente desconocido"}</Text>
      <Text style={styles.phone}>{item.phone || "Sin teléfono"}</Text>
      {item.relationship && (
        <Text style={styles.relationship}>Relación: {item.relationship}</Text>
      )}

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.btn, styles.acceptBtn]}
          onPress={() => handleAccept(item)}
        >
          <Text style={styles.btnText}>Aceptar</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.rejectBtn]}
          onPress={() => handleReject(item)}
        >
          <Text style={styles.btnText}>Rechazar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.center}>
      <Text style={styles.empty}>No tienes invitaciones pendientes</Text>
    </View>
  );

  const renderLoading = () => (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.loadingText}>Cargando invitaciones...</Text>
    </View>
  );

  /* =========================================
   *              🎨 RENDER MAIN
   * ========================================= */

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>{renderLoading()}</SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {invites.length === 0 ? (
        renderEmpty()
      ) : (
        <FlatList
          data={invites}
          keyExtractor={(item) => item.id}
          renderItem={renderInviteCard}
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  );
}

/* =========================================
 *              🎨 STYLES
 * ========================================= */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  listContent: {
    padding: 16,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  empty: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: "center",
  },

  card: {
    backgroundColor: COLORS.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  name: {
    fontSize: 18,
    fontWeight: "bold",
    color: COLORS.text,
    marginBottom: 4,
  },
  phone: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  relationship: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 12,
    fontStyle: "italic",
  },

  buttons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptBtn: {
    backgroundColor: "#10b981",
  },
  rejectBtn: {
    backgroundColor: "#ef4444",
  },
  btnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
});
