// src/screens/auth/LoginScreen.tsx
// ✅ Actualizado: Soporte para inicio de sesión offline

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";
import { LoginFormData, COLORS, FONT_SIZES } from "../../../types/index";
import { MaterialIcons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";

// 🔹 Servicio de autenticación offline
import { offlineAuthService } from "../../services/offline/OfflineAuthService";

// 🔹 Firebase Auth (para compatibilidad)
import { auth } from "../../config/firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";

const loginImage = require("../../../assets/login_image.png");

type LoginScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  "Login"
>;

interface LoginScreenProps {
  navigation: LoginScreenNavigationProp;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ navigation }) => {
  const [formData, setFormData] = useState<LoginFormData>({
    username: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(true);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [cachedEmail, setCachedEmail] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      try {
        const netState = await NetInfo.fetch();
        setIsOnline(
          netState.isConnected === true &&
            netState.isInternetReachable !== false
        );

        const cachedUser = await offlineAuthService.initialize();

        if (!isMounted) return;

        if (cachedUser) {
          console.log("✅ Sesión restaurada (offline):", cachedUser.email);
          setCachedEmail(cachedUser.email);
        } else {
          const cached = await offlineAuthService.getCachedUser();
          if (cached?.email) setCachedEmail(cached.email);
        }
      } catch (error) {
        console.log("Error inicializando auth:", error);
      } finally {
        if (isMounted) setIsCheckingSession(false);
      }
    };

    initAuth();

    const unsub = onAuthStateChanged(auth, (user) => {
      if (user && isMounted) {
        console.log("🔐 Firebase tiene sesión activa:", user.email);
      }
    });

    const netUnsub = NetInfo.addEventListener((state) => {
      setIsOnline(
        state.isConnected === true && state.isInternetReachable !== false
      );
    });

    return () => {
      isMounted = false;
      unsub();
      netUnsub();
    };
  }, [navigation]);

  const updateFormData = (field: keyof LoginFormData, value: string): void => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const validateForm = (): boolean => {
    if (!formData.username.trim()) {
      Alert.alert("Error", "Por favor, ingresa tu correo");
      return false;
    }
    const email = formData.username.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      Alert.alert("Error", "El formato del correo no es válido");
      return false;
    }
    if (!formData.password.trim()) {
      Alert.alert("Error", "Por favor, ingresa tu contraseña");
      return false;
    }
    if (formData.password.length < 6) {
      Alert.alert("Error", "La contraseña debe tener al menos 6 caracteres");
      return false;
    }
    return true;
  };

  const handleLogin = (): void => {
    if (!validateForm()) return;

    // ✅ No bloqueamos por estar offline: el servicio decide si hay cache suficiente.
    authenticateUser();
  };

  const authenticateUser = async (): Promise<void> => {
    try {
      setIsLoading(true);

      const result = await offlineAuthService.signIn(
        formData.username.trim(),
        formData.password
      );

      if (result.success) {
        if (result.isOffline) {
          Alert.alert(
            "Modo sin conexión",
            "Has iniciado sesión con tus credenciales guardadas. Algunos datos pueden no estar actualizados.",
            [{ text: "Continuar", onPress: () => navigation.replace("Home") }]
          );
        } else {
          navigation.replace("Home");
        }
      } else {
        Alert.alert(
          result.isOffline
            ? "Error de sesión offline"
            : "Error de inicio de sesión",
          result.error || "Error desconocido"
        );
      }
    } catch (e: any) {
      console.log("Error en login:", e);
      Alert.alert("Error", "Ocurrió un error inesperado. Intenta de nuevo.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = (): void => {
    if (!isOnline) {
      Alert.alert(
        "Sin conexión",
        "Necesitas conexión a internet para recuperar tu contraseña."
      );
      return;
    }
    navigation.navigate("ForgotPassword");
  };

  const handleRegister = () => {
    if (!isOnline) {
      Alert.alert(
        "Sin conexión",
        "Necesitas conexión a internet para registrarte."
      );
      return;
    }
    navigation.navigate("Register");
  };

  if (isCheckingSession) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Verificando sesión...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.content}>
        <View
          style={[
            styles.connectionBadge,
            { backgroundColor: isOnline ? "#10B981" : "#EF4444" },
          ]}
        >
          <MaterialIcons
            name={isOnline ? "wifi" : "wifi-off"}
            size={14}
            color="#fff"
          />
          <Text style={styles.connectionText}>
            {isOnline ? "Conectado" : "Sin conexión"}
          </Text>
        </View>

        <Image source={loginImage} style={styles.loginImage} />
        <Text style={styles.title}>LifeReminder</Text>
        <Text style={styles.subtitle}>Iniciar Sesión</Text>

        <View style={styles.formContainer}>
          <TextInput
            style={styles.input}
            placeholder="Correo (correo@dominio.com)"
            placeholderTextColor={COLORS.textSecondary}
            value={formData.username}
            onChangeText={(text) => updateFormData("username", text)}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
            editable={!isLoading}
          />

          <TextInput
            style={styles.input}
            placeholder="Contraseña"
            placeholderTextColor={COLORS.textSecondary}
            value={formData.password}
            onChangeText={(text) => updateFormData("password", text)}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />

          <TouchableOpacity
            style={[styles.loginButton, { opacity: isLoading ? 0.6 : 1 }]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <View style={styles.loadingButton}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.loginButtonText}>Iniciando...</Text>
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <MaterialIcons
                  name={isOnline ? "login" : "offline-bolt"}
                  size={20}
                  color="#fff"
                />
                <Text style={styles.loginButtonText}>
                  {isOnline ? "Iniciar Sesión" : "Iniciar Sesión Offline"}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.linksContainer}>
          <TouchableOpacity
            onPress={handleForgotPassword}
            style={!isOnline && styles.disabledLink}
          >
            <Text style={[styles.link, !isOnline && styles.disabledLinkText]}>
              ¿Olvidaste tu contraseña?
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleRegister}
            style={!isOnline && styles.disabledLink}
          >
            <Text style={[styles.link, !isOnline && styles.disabledLinkText]}>
              Regístrate
            </Text>
          </TouchableOpacity>
        </View>

        {!isOnline && (
          <View style={styles.offlineNote}>
            <MaterialIcons
              name="cloud-off"
              size={20}
              color={COLORS.textSecondary}
            />
            <Text style={styles.offlineNoteText}>
              Sin conexión.{" "}
              {cachedEmail
                ? "Puedes iniciar sesión con tu cuenta guardada."
                : "Conéctate a internet para iniciar sesión por primera vez."}
            </Text>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: 12,
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.medium,
  },
  connectionBadge: {
    position: "absolute",
    top: 60,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  connectionText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  loginImage: { width: 120, height: 120, marginBottom: 20, borderRadius: 60 },
  title: {
    fontSize: FONT_SIZES.xxlarge,
    fontWeight: "bold",
    color: COLORS.primary,
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: FONT_SIZES.large,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginBottom: 20,
  },
  formContainer: { width: "100%", maxWidth: 300 },
  input: {
    height: 50,
    borderColor: COLORS.textSecondary,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 15,
    marginBottom: 15,
    fontSize: FONT_SIZES.medium,
    backgroundColor: COLORS.surface,
    color: COLORS.text,
  },
  loginButton: {
    backgroundColor: COLORS.primary,
    height: 50,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
    elevation: 2,
    shadowColor: COLORS.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  buttonContent: { flexDirection: "row", alignItems: "center", gap: 8 },
  loadingButton: { flexDirection: "row", alignItems: "center", gap: 8 },
  loginButtonText: {
    color: COLORS.surface,
    fontSize: FONT_SIZES.medium,
    fontWeight: "bold",
  },
  linksContainer: { marginTop: 30, alignItems: "center", gap: 15 },
  link: {
    color: COLORS.primary,
    fontSize: FONT_SIZES.medium,
    textDecorationLine: "underline",
  },
  disabledLink: { opacity: 0.5 },
  disabledLinkText: { color: COLORS.textSecondary },
  offlineNote: {
    position: "absolute",
    bottom: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    maxWidth: "90%",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  offlineNoteText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.small,
    lineHeight: 18,
  },
});

export default LoginScreen;
