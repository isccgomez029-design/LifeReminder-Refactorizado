/* ================================
   UserMenuButton.tsx - CORREGIDO
   ✅ Usa offlineAuthService.signOut() para mantener el cache
   ================================ */

import React, { useState, useEffect } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  Text,
  BackHandler,
  Alert,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { COLORS, FONT_SIZES } from "../../types";
import { useNavigation } from "@react-navigation/native";

// ✅ CAMBIO: Importar offlineAuthService en lugar de auth directamente
import { offlineAuthService } from "../services/offline/OfflineAuthService";

export default function UserMenuButton() {
  const navigation = useNavigation<any>();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (open) {
        setOpen(false);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [open]);

  const go = (route: string) => {
    setOpen(false);
    navigation.navigate(route);
  };

  const handleLogout = async () => {
    setOpen(false);
    try {
      // ✅ CAMBIO CRÍTICO: Usar offlineAuthService.signOut()
      // El parámetro false mantiene el cache para login offline futuro
      await offlineAuthService.signOut(false);

      navigation.reset({ index: 0, routes: [{ name: "Login" }] });
    } catch (e: any) {
      Alert.alert("Error al cerrar sesión", e?.message ?? "Intenta de nuevo.");
    }
  };

  // Función para logout completo (borra todo el cache)
  const handleLogoutComplete = async () => {
    Alert.alert(
      "Cerrar sesión completa",
      "¿Deseas borrar todos los datos guardados? No podrás usar la app sin internet hasta que vuelvas a iniciar sesión.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Borrar y salir",
          style: "destructive",
          onPress: async () => {
            setOpen(false);
            try {
              // Cerrar sesión Y borrar cache
              await offlineAuthService.signOut(true);
              navigation.reset({ index: 0, routes: [{ name: "Login" }] });
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "Intenta de nuevo.");
            }
          },
        },
      ]
    );
  };

  return (
    <View style={{ position: "relative" }}>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        style={{ padding: 6 }}
        accessibilityLabel="Menú de usuario"
      >
        <MaterialIcons name="settings" size={22} color={COLORS.surface} />
      </TouchableOpacity>

      {open && (
        <>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
          />

          <View style={styles.menu}>
            {/* PERFIL */}
            <TouchableOpacity style={styles.item} onPress={() => go("Profile")}>
              <MaterialIcons
                name="person"
                size={18}
                color={COLORS.text}
                style={styles.icon}
              />
              <Text style={styles.txt}>Perfil</Text>
            </TouchableOpacity>

            {/* CONFIGURACIÓN */}
            <TouchableOpacity
              style={styles.item}
              onPress={() => go("Settings")}
            >
              <MaterialIcons
                name="tune"
                size={18}
                color={COLORS.text}
                style={styles.icon}
              />
              <Text style={styles.txt}>Configuración</Text>
            </TouchableOpacity>

            {/* INVITACIONES */}
            <TouchableOpacity
              style={styles.item}
              onPress={() => go("CareInvites")}
            >
              <MaterialIcons
                name="group-add"
                size={18}
                color={COLORS.text}
                style={styles.icon}
              />
              <Text style={styles.txt}>Invitaciones de cuidado</Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.item}
              onPress={() => go("MyPatients")}
            >
              <MaterialIcons
                name="supervisor-account"
                size={18}
                color={COLORS.text}
                style={styles.icon}
              />
              <Text style={styles.txt}>Mis pacientes</Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* CERRAR SESIÓN (mantiene cache) */}
            <TouchableOpacity style={styles.item} onPress={handleLogout}>
              <MaterialIcons
                name="logout"
                size={18}
                color="#c62828"
                style={styles.icon}
              />
              <Text style={[styles.txt, { color: "#c62828" }]}>
                Cerrar sesión
              </Text>
            </TouchableOpacity>

            {/* OPCIONAL: Logout completo que borra cache
            <TouchableOpacity style={styles.item} onPress={handleLogoutComplete}>
              <MaterialIcons
                name="delete-forever"
                size={18}
                color="#b71c1c"
                style={styles.icon}
              />
              <Text style={[styles.txt, { color: "#b71c1c", fontSize: 12 }]}>
                Cerrar y borrar datos
              </Text>
            </TouchableOpacity>
            */}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: 8,
    width: 210,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 6,
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  icon: { marginRight: 8 },
  txt: {
    fontSize: FONT_SIZES.medium || 16,
    color: COLORS.text,
    fontWeight: "600",
  },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 6 },
});
