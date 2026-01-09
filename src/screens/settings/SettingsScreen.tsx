// src/screens/settings/SettingsScreen.tsx

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  getSettings,
  saveSettings,
  disableAllNotifications,
  enableNotifications,
} from "../../services/settingsService";

const SettingsScreen: React.FC = () => {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [vibration, setVibration] = useState(true);
  const [medLow20, setMedLow20] = useState(true);
  const [medLow10, setMedLow10] = useState(true);

  // ================== CARGA INICIAL ==================
  useEffect(() => {
    let mounted = true;

    getSettings().then((s) => {
      if (!mounted) return;
      setNotificationsEnabled(s.notificationsEnabled);
      setVibration(s.vibration);
      setMedLow20(s.medLow20);
      setMedLow10(s.medLow10);
    });

    return () => {
      mounted = false;
    };
  }, []);

  // ================== HANDLERS ==================

  const onToggleNotifications = async (value: boolean) => {
    setNotificationsEnabled(value);

    if (value) {
      await enableNotifications();
    } else {
      await disableAllNotifications();
    }
  };

  const onToggleVibration = async (value: boolean) => {
    setVibration(value);
    await saveSettings({ vibration: value });
  };

  const onToggleMedLow20 = async (value: boolean) => {
    setMedLow20(value);
    await saveSettings({ medLow20: value });
  };

  const onToggleMedLow10 = async (value: boolean) => {
    setMedLow10(value);
    await saveSettings({ medLow10: value });
  };

  // ================== UI ==================

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* NOTIFICACIONES */}
        <Text style={styles.sectionTitle}>Notificaciones</Text>
        <View style={styles.card}>
          {/* Notificaciones generales */}
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>Notificaciones generales</Text>
              <Text style={styles.subLabel}>
                Activa o desactiva todos los recordatorios.
              </Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={onToggleNotifications}
            />
          </View>

          {/* Vibración */}
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>Vibración</Text>
              <Text style={styles.subLabel}>
                Vibra al recibir recordatorios.
              </Text>
            </View>
            <Switch
              value={vibration}
              onValueChange={onToggleVibration}
              disabled={!notificationsEnabled}
            />
          </View>

          {/* Aviso 20% */}
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>
                Avisar cuando quede ~20% del medicamento
              </Text>
              <Text style={styles.subLabel}>
                Te avisamos cuando tu inventario llegue a aproximadamente un
                20%.
              </Text>
            </View>
            <Switch value={medLow20} onValueChange={onToggleMedLow20} />
          </View>

          {/* Aviso 10% */}
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>
                Avisar cuando quede ~10% del medicamento
              </Text>
              <Text style={styles.subLabel}>
                Alerta crítica antes de que se termine.
              </Text>
            </View>
            <Switch value={medLow10} onValueChange={onToggleMedLow10} />
          </View>
        </View>

        {/* ACERCA DE */}
        <Text style={styles.sectionTitle}>Acerca de</Text>
        <View style={styles.card}>
          <View style={styles.rowText}>
            <Text style={styles.label}>LifeReminder</Text>
            <Text style={styles.subLabel}>Versión 1.0.0</Text>
            <Text style={styles.subLabel}>
              Aplicación para ayudarte a gestionar tus medicamentos y citas.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

// ================== STYLES (SIN CAMBIOS) ==================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f6fa" },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginTop: 12,
    marginBottom: 6,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    justifyContent: "space-between",
  },
  rowText: {
    flex: 1,
    paddingRight: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
  },
  subLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
});

export default SettingsScreen;
