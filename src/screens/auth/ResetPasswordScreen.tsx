import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RouteProp } from "@react-navigation/native";
import { RootStackParamList } from "../../navigation/StackNavigator";
import { COLORS, FONT_SIZES } from "../../../types";

const loginImage = require("../../../assets/login_image.png");

type Nav = StackNavigationProp<RootStackParamList, "ResetPassword">;
type Route = RouteProp<RootStackParamList, "ResetPassword">;

export default function ResetPasswordScreen({
  navigation,
  route,
}: {
  navigation: Nav;
  route: Route;
}) {
  const { email } = route.params || { email: "" };

  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");

  const handleSave = () => {
    // Validaciones básicas de UX
    if (!pass1.trim() || !pass2.trim()) {
      Alert.alert("Faltan campos", "Ingresa y confirma tu nueva contraseña.");
      return;
    }

    if (pass1.length < 8) {
      Alert.alert(
        "Contraseña débil",
        "La contraseña debe tener al menos 8 caracteres."
      );
      return;
    }

    if (pass1 !== pass2) {
      Alert.alert("No coinciden", "Las contraseñas no son iguales.");
      return;
    }

    // Aquí normalmente mandarías al backend el cambio de contraseña
    Alert.alert("Listo", "Tu contraseña fue actualizada.", [
      {
        text: "Ir a iniciar sesión",
        onPress: () => navigation.navigate("Login"),
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.content}>
        <Image source={loginImage} style={styles.logo} />

        <Text style={styles.title}>Nueva contraseña</Text>
        <Text style={styles.subtitle}>
          Establece una nueva contraseña para tu cuenta:
          {"\n"}
          <Text style={styles.email}>{email || "tu-correo@example.com"}</Text>
        </Text>

        <View style={styles.formContainer}>
          {/* Campo contraseña nueva */}
          <Text style={styles.label}>Nueva contraseña</Text>
          <TextInput
            style={styles.input}
            placeholder="Mínimo 8 caracteres"
            placeholderTextColor={COLORS.textSecondary}
            secureTextEntry
            value={pass1}
            onChangeText={setPass1}
          />

          {/* Campo confirmar contraseña */}
          <Text style={styles.label}>Confirmar contraseña</Text>
          <TextInput
            style={styles.input}
            placeholder="Repite tu contraseña"
            placeholderTextColor={COLORS.textSecondary}
            secureTextEntry
            value={pass2}
            onChangeText={setPass2}
          />

          {/* Botón guardar */}
          <TouchableOpacity style={styles.primaryButton} onPress={handleSave}>
            <Text style={styles.primaryButtonText}>
              Guardar nueva contraseña
            </Text>
          </TouchableOpacity>

          {/* Volver al login */}
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => navigation.navigate("Login")}
          >
            <Text style={styles.linkText}>Volver al inicio de sesión</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 90,
    height: 90,
    marginBottom: 16,
    borderRadius: 45,
  },
  title: {
    fontSize: FONT_SIZES.xlarge,
    fontWeight: "800",
    color: COLORS.primary,
    textAlign: "center",
  },
  subtitle: {
    fontSize: FONT_SIZES.medium,
    textAlign: "center",
    color: COLORS.textSecondary,
    marginTop: 8,
    marginBottom: 24,
    lineHeight: 20,
  },
  email: {
    color: COLORS.text,
    fontWeight: "700",
  },
  formContainer: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  label: {
    color: COLORS.text,
    fontWeight: "600",
    fontSize: FONT_SIZES.small,
    marginBottom: 6,
  },
  input: {
    height: 50,
    borderColor: COLORS.textSecondary,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: FONT_SIZES.medium,
    color: COLORS.text,
    backgroundColor: COLORS.surface,
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  primaryButtonText: {
    color: COLORS.surface,
    fontWeight: "700",
    fontSize: FONT_SIZES.medium,
  },
  linkBtn: {
    alignItems: "center",
    paddingVertical: 4,
  },
  linkText: {
    color: COLORS.primary,
    fontSize: FONT_SIZES.small,
    textDecorationLine: "underline",
    fontWeight: "600",
  },
});
