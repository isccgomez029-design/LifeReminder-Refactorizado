// src/components/OfflineBanner.tsx
// 📡 Banner que muestra el estado de conexión y cambios pendientes

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

interface OfflineBannerProps {
  pendingChanges?: number;
}

export function OfflineBanner({ pendingChanges = 0 }: OfflineBannerProps) {
  if (pendingChanges === 0) {
    return null; // No mostrar nada si no hay cambios pendientes
  }

  return (
    <View style={styles.banner}>
      <MaterialIcons name="cloud-off" size={16} color="#F59E0B" />
      <Text style={styles.text}>
        {pendingChanges === 1
          ? "1 cambio pendiente de sincronizar"
          : `${pendingChanges} cambios pendientes de sincronizar`}
      </Text>
      <MaterialIcons name="sync" size={16} color="#F59E0B" />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEF3C7",
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F59E0B",
  },
  text: {
    fontSize: 12,
    color: "#92400E",
    fontWeight: "600",
  },
});
