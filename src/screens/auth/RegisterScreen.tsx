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

// 🔹 Firebase
import { auth, db } from "../../config/firebaseConfig";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

type Nav = StackNavigationProp<RootStackParamList, "Register">;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,20}$/; // letras, números, punto, guion, guion_bajo (3-20)

export default function RegisterScreen({ navigation }: { navigation: Nav }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(""); // correo
  const [username, setUsername] = useState(""); // usuario separado
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const validate = () => {
    if (!fullName.trim()) return Alert.alert("Falta tu nombre");
    if (!email.trim()) return Alert.alert("Ingresa tu correo");
    if (!EMAIL_RE.test(email.trim()))
      return Alert.alert("Correo no válido", "Ejemplo: usuario@dominio.com");
    if (!username.trim()) return Alert.alert("Ingresa tu nombre de usuario");
    if (!USERNAME_RE.test(username.trim()))
      return Alert.alert(
        "Usuario no válido",
        "Usa 3–20 caracteres: letras, números, punto, guion y guion_bajo."
      );
    if (password.length < 6)
      return Alert.alert(
        "Contraseña muy corta",
        "La contraseña debe tener al menos 6 caracteres."
      );
    if (password !== confirm)
      return Alert.alert("Las contraseñas no coinciden");
    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    try {
      setIsLoading(true);

      const emailTrim = email.trim();
      const pass = password;

      // 1️⃣ Crear usuario en Authentication
      const cred = await createUserWithEmailAndPassword(auth, emailTrim, pass);

      // 2️⃣ Actualizar displayName con el nombre completo
      if (cred.user) {
        await updateProfile(cred.user, {
          displayName: fullName.trim(),
        });

        // 3️⃣ Crear documento en colección "usuarios"
        await setDoc(doc(db, "usuarios", cred.user.uid), {
          uid: cred.user.uid,
          email: cred.user.email,
          fullName: fullName.trim(),
          username: username.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      Alert.alert("Cuenta creada", "Tu registro se realizó correctamente.", [
        { text: "Continuar", onPress: () => navigation.replace("Home") },
      ]);
    } catch (e: any) {
      console.log("Error al registrar:", e);
      const code = e?.code ?? "";
      let msg = "Ocurrió un error al crear tu cuenta. Intenta de nuevo.";

      if (code === "auth/email-already-in-use")
        msg = "Este correo ya está registrado.";
      else if (code === "auth/invalid-email") msg = "El correo no es válido.";
      else if (code === "auth/weak-password")
        msg = "La contraseña es demasiado débil (mínimo 6 caracteres).";

      Alert.alert("No se pudo registrar", msg);
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

          {/* Correo */}
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

          {/* Usuario */}
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
    