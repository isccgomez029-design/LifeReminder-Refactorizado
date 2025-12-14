// src/screens/settings/SettingsScreen.tsx
import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

// 🔐 Clave única para guardar los ajustes
const SETTINGS_KEY = "@lifereminder/settings";

type HourFormat = "12" | "24";

type Settings = {
  notificationsEnabled: boolean;
  medLow20: boolean; // aviso 20%
  medLow10: boolean; // aviso 10%
  vibration: boolean;
};

const SettingsScreen: React.FC = () => {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [medLow20, setMedLow20] = useState(true);
  const [medLow10, setMedLow10] = useState(true);
  const [vibration, setVibration] = useState(true);
  const [hourFormat, setHourFormat] = useState<HourFormat>("24");

  // ================== CARGAR AJUSTES ==================
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const json = await AsyncStorage.getItem(SETTINGS_KEY);
        if (!json) return;

        const saved: Partial<Settings> = JSON.parse(json);

        if (typeof saved.notificationsEnabled === "boolean") {
          setNotificationsEnabled(saved.notificationsEnabled);
        }
        if (typeof saved.medLow20 === "boolean") {
          setMedLow20(saved.medLow20);
        }
        if (typeof saved.medLow10 === "boolean") {
          setMedLow10(saved.medLow10);
        }
        if (typeof saved.vibration === "boolean") {
          setVibration(saved.vibration);
        }
      } catch (e) {
        console.log("Error cargando ajustes:", e);
      }
    };

    loadSettings();
  }, []);

  // ================== GUARDAR AJUSTES ==================
  const persistSettings = async (partial: Partial<Settings>) => {
    try {
      const current: Settings = {
        notificationsEnabled,
        medLow20,
        medLow10,
        vibration,
      };

      const newSettings: Settings = { ...current, ...partial };
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));

      if (partial.notificationsEnabled !== undefined) {
        setNotificationsEnabled(partial.notificationsEnabled);
      }
      if (partial.medLow20 !== undefined) {
        setMedLow20(partial.medLow20);
      }
      if (partial.medLow10 !== undefined) {
        setMedLow10(partial.medLow10);
      }
      if (partial.vibration !== undefined) {
        setVibration(partial.vibration);
      }

    } catch (e) {
      console.log("Error guardando ajustes:", e);
    }
  };



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
              onValueChange={(value) =>
                persistSettings({ notificationsEnabled: value })
              }
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
              onValueChange={(value) => persistSettings({ vibration: value })}
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
            <Switch
              value={medLow20}
              onValueChange={(value) => persistSettings({ medLow20: value })}
            />
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
            <Switch
              value={medLow10}
              onValueChange={(value) => persistSettings({ medLow10: value })}
            />
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
