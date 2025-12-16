// src/screens/auth/RegisterScreen.tsx
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";
import { COLORS, FONT_SIZES } from "../../../types";

import { offlineAuthService } from "../../services/offline/OfflineAuthService";

type Nav = StackNavigationProp<RootStackParamList, "Register">;

export default function RegisterScreen({ navigation }: { navigation: Nav }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    try {
      setIsLoading(true);

      const res = await offlineAuthService.register({
        fullName,
        email,
        username,
        password,
        confirmPassword: confirm,
      });

      if (!res.success) {
        Alert.alert("No se pudo registrar", res.error || "Error");
        return;
      }

      // Si fue offline, igual entra; se finaliza automático cuando vuelva internet.
      if (res.isOffline) {
        Alert.alert(
          "Registro offline creado",
          "Tu cuenta se creó en este dispositivo. Cuando tengas internet se completará automáticamente.",
          [{ text: "Continuar", onPress: () => navigation.replace("Home") }]
        );
        return;
      }

      Alert.alert("Cuenta creada", "Tu registro se realizó correctamente.", [
        { text: "Continuar", onPress: () => navigation.replace("Home") },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Crear cuenta</Text>
        <Text style={styles.subtitle}>Regístrate para usar la app</Text>

        <View style={styles.formContainer}>
          <TextInput
            style={styles.input}
            placeholder="Nombre completo"
            value={fullName}
            placeholderTextColor={COLORS.textSecondary}
            onChangeText={setFullName}
          />

          <TextInput
            style={styles.input}
            placeholder="Correo"
            value={email}
            placeholderTextColor={COLORS.textSecondary}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="email"
          />

          <TextInput
            style={styles.input}
            placeholder="Usuario"
            value={username}
            placeholderTextColor={COLORS.textSecondary}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TextInput
            style={styles.input}
            placeholder="Contraseña"
            value={password}
            placeholderTextColor={COLORS.textSecondary}
            onChangeText={setPassword}
            secureTextEntry
          />
          <TextInput
            style={styles.input}
            placeholder="Confirmar contraseña"
            value={confirm}
            placeholderTextColor={COLORS.textSecondary}
            onChangeText={setConfirm}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.primaryBtn, { opacity: isLoading ? 0.6 : 1 }]}
            disabled={isLoading}
            onPress={handleSubmit}
          >
            <Text style={styles.primaryBtnText}>
              {isLoading ? "Creando cuenta..." : "Registrarme"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.link}>Ya tengo cuenta — Iniciar sesión</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  title: {
    fontSize: FONT_SIZES.xxlarge,
    fontWeight: "bold",
    color: COLORS.primary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: FONT_SIZES.medium,
    color: COLORS.textSecondary,
    marginBottom: 24,
  },
  formContainer: { width: "100%", maxWidth: 340 },
  input: {
    height: 50,
    borderColor: COLORS.textSecondary,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    marginBottom: 14,
    backgroundColor: COLORS.surface,
    color: COLORS.text,
    fontSize: FONT_SIZES.medium,
  },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    height: 50,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 6,
  },
  primaryBtnText: {
    color: COLORS.surface,
    fontSize: FONT_SIZES.medium,
    fontWeight: "bold",
  },
  linkBtn: { alignItems: "center", marginTop: 18 },
  link: { color: COLORS.primary, textDecorationLine: "underline" },
});
