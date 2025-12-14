// src/screens/auth/ForgotPasswordScreen.tsx
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
import { RootStackParamList } from "../../navigation/StackNavigator";
import { COLORS, FONT_SIZES } from "../../../types";

// 🔹 Firebase
import { auth } from "../../config/firebaseConfig";
import { sendPasswordResetEmail } from "firebase/auth";

type Nav = StackNavigationProp<RootStackParamList, "ForgotPassword">;

// Ajusta la ruta si tu imagen está en otro lugar
const loginImage = require("../../../assets/login_image.png");

export default function ForgotPasswordScreen({
  navigation,
}: {
  navigation: Nav;
}) {
  const [email, setEmail] = useState("");
  const [isSending, setIsSending] = useState(false);

  const validateEmail = () => {
    const value = email.trim();
    if (!value) {
      Alert.alert(
        "Falta el correo",
        "Ingresa el correo con el que te registraste."
      );
      return false;
    }
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
    if (!re.test(value)) {
      Alert.alert("Correo no válido", "Ejemplo: usuario@dominio.com");
      return false;
    }
    return true;
  };

  const handleSendEmail = async () => {
    if (!validateEmail()) return;

    try {
      setIsSending(true);
      const emailTrim = email.trim();

      // 🔹 AQUÍ SE ENVÍA EL CORREO DE RECUPERACIÓN
      await sendPasswordResetEmail(auth, emailTrim);

      Alert.alert(
        "Correo enviado",
        "Te enviamos un correo con instrucciones para restablecer tu contraseña. Revisa tu bandeja de entrada o spam.",
        [
          {
            text: "Ir al inicio de sesión",
            onPress: () => navigation.navigate("Login"),
          },
          { text: "Aceptar" },
        ]
      );
    } catch (e: any) {
      console.log("Error al enviar reset:", e);
      const code = e?.code ?? "";
      let msg = "Ocurrió un error al enviar el correo. Intenta de nuevo.";

      if (code === "auth/user-not-found") {
        msg = "No existe un usuario registrado con ese correo.";
      } else if (code === "auth/invalid-email") {
        msg = "El correo no es válido.";
      }

      Alert.alert("No se pudo enviar el correo", msg);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.inner}>
        <Image source={loginImage} style={styles.image} resizeMode="contain" />

        <Text style={styles.title}>¿Olvidaste tu contraseña?</Text>
        <Text style={styles.subtitle}>
          Ingresa tu correo y te enviaremos un enlace para restablecerla.
        </Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Correo electrónico"
            placeholderTextColor={COLORS.textSecondary}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="email"
          />

          <TouchableOpacity
            style={[styles.primaryBtn, { opacity: isSending ? 0.6 : 1 }]}
            onPress={handleSendEmail}
            disabled={isSending}
          >
            <Text style={styles.primaryBtnText}>
              {isSending ? "Enviando..." : "Enviar correo de recuperación"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => navigation.navigate("Login")}
          >
            <Text style={styles.linkText}>Volver a iniciar sesión</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    alignItems: "center",
  },
  image: {
    width: 200,
    height: 160,
    marginBottom: 16,
  },
  title: {
    fontSize: FONT_SIZES.xxlarge,
    fontWeight: "bold",
    color: COLORS.primary,
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: FONT_SIZES.medium,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginBottom: 24,
  },
  form: {
    width: "100%",
    maxWidth: 360,
    marginTop: 8,
  },
  input: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.textSecondary,
    paddingHorizontal: 14,
    backgroundColor: COLORS.surface,
    color: COLORS.text,
    marginBottom: 14,
  },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 4,
  },
  primaryBtnText: {
    color: COLORS.surface,
    fontWeight: "700",
    fontSize: FONT_SIZES.medium,
  },
  linkBtn: {
    alignItems: "center",
    paddingVertical: 4,
    marginTop: 12,
  },
  linkText: {
    color: COLORS.primary,
    fontSize: FONT_SIZES.small,
    textDecorationLine: "underline",
    fontWeight: "600",
  },
});
