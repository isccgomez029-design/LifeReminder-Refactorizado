// src/screens/profile/ProfileScreen.tsx
// ✅ CORREGIDO: Soporte offline completo con offlineAuthService

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { MaterialIcons } from "@expo/vector-icons";

// Firebase
import { auth, db } from "../../config/firebaseConfig";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
} from "firebase/auth";

// ✅ Servicios offline
import { syncQueueService } from "../../services/offline/SyncQueueService";
import { offlineAuthService } from "../../services/offline/OfflineAuthService";

const ProfileScreen: React.FC = () => {
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [allergies, setAllergies] = useState("");
  const [conditions, setConditions] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyRelation, setEmergencyRelation] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");

  const [bloodType, setBloodType] = useState("");
  const [emergencyNotes, setEmergencyNotes] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [processingEmail, setProcessingEmail] = useState(false);

  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [processingPass, setProcessingPass] = useState(false);

  // ✅ CORREGIDO: Obtener usuario de Firebase O del servicio offline
  const firebaseUser = auth.currentUser;
  const offlineUser = offlineAuthService.getCurrentUser();
  const userId = firebaseUser?.uid || offlineAuthService.getCurrentUid();
  const userEmail = firebaseUser?.email || offlineUser?.email || "";

  useEffect(() => {
    const loadProfile = async () => {
      try {
        if (!userId) {
          console.log("⚠️ No hay usuario autenticado (online ni offline)");
          setLoading(false);
          return;
        }

        let data: any | null = null;

        // 1) Intentar leer del cache local
        try {
          const cached = await syncQueueService.getFromCache("profile", userId);
          if (cached?.data && cached.data.length > 0) {
            data = cached.data[0];
            console.log("✅ Perfil cargado desde cache local");
          }
        } catch (e) {
          console.log("⚠️ Error leyendo perfil local:", e);
        }

        // 2) Intentar refrescar desde Firestore
        try {
          const userRef = doc(db, "users", userId);
          const snap = await getDoc(userRef);

          if (snap.exists()) {
            data = snap.data();
            console.log("✅ Perfil actualizado desde Firestore");
            await syncQueueService.saveToCache("profile", userId, [
              { id: userId, ...data },
            ]);
          }
        } catch (e) {
          console.log("⚠️ Sin conexión, usando datos locales");
        }

        if (data) {
          setDisplayName(
            data.displayName ||
              firebaseUser?.displayName ||
              offlineUser?.displayName ||
              ""
          );
          setPhone(data.phone || "");
          setAge(data.age ? String(data.age) : "");
          setAllergies(data.allergies || "");
          setConditions(data.conditions || "");
          setPhotoUri(data.photoUri || null);
          setEmergencyName(data.emergencyContactName || "");
          setEmergencyRelation(data.emergencyContactRelation || "");
          setEmergencyPhone(data.emergencyContactPhone || "");
          setBloodType(data.bloodType || "");
          setEmergencyNotes(data.emergencyNotes || "");
        } else {
          setDisplayName(
            firebaseUser?.displayName || offlineUser?.displayName || ""
          );
        }
      } catch (error) {
        console.error("❌ Error cargando perfil:", error);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [userId]);

  const handlePickFromGallery = async () => {
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permiso requerido",
          "Necesitas permitir el acceso a la galería."
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (!result.canceled && result.assets?.[0]) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error("Error al elegir de galería:", error);
    }
  };

  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permiso requerido",
          "Necesitas permitir el acceso a la cámara."
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (!result.canceled && result.assets?.[0]) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error("Error al tomar foto:", error);
    }
  };

  const handleSave = async () => {
    if (!userId) {
      Alert.alert("Error", "No hay usuario autenticado.");
      return;
    }
    if (!displayName.trim()) {
      Alert.alert("Validación", "El nombre no puede estar vacío.");
      return;
    }

    let parsedAge: number | null = null;
    if (age.trim()) {
      const n = Number(age.trim());
      if (Number.isNaN(n) || n <= 0) {
        Alert.alert("Validación", "La edad debe ser un número mayor a 0.");
        return;
      }
      parsedAge = n;
    }

    const profileData = {
      id: userId,
      displayName: displayName.trim(),
      phone: phone.trim(),
      email: userEmail,
      age: parsedAge,
      allergies: allergies.trim(),
      conditions: conditions.trim(),
      photoUri: photoUri || null,
      emergencyContactName: emergencyName.trim(),
      emergencyContactRelation: emergencyRelation.trim(),
      emergencyContactPhone: emergencyPhone.trim(),
      bloodType: bloodType.trim(),
      emergencyNotes: emergencyNotes.trim(),
      updatedAt: new Date().toISOString(),
    };

    try {
      setSaving(true);
      await syncQueueService.enqueue(
        "UPDATE",
        "profile",
        userId,
        userId,
        profileData
      );

      try {
        const userRef = doc(db, "users", userId);
        await setDoc(userRef, profileData, { merge: true });
      } catch (syncError) {
        console.log("⚠️ Se sincronizará cuando haya conexión");
      }

      Alert.alert("Listo", "Perfil actualizado correctamente.");
      setIsEditing(false);
    } catch (error) {
      console.error("❌ Error guardando perfil:", error);
      Alert.alert("Error", "No se pudieron guardar los cambios.");
    } finally {
      setSaving(false);
    }
  };

  const toggleEdit = () => setIsEditing((prev) => !prev);

  const handleChangeEmail = async () => {
    if (!firebaseUser || !firebaseUser.email) {
      Alert.alert("Error", "Esta función requiere conexión a internet.");
      return;
    }
    const trimmedEmail = newEmail.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      Alert.alert("Validación", "Escribe un correo válido.");
      return;
    }
    if (!emailPassword.trim()) {
      Alert.alert("Validación", "Escribe tu contraseña actual.");
      return;
    }

    try {
      setProcessingEmail(true);
      const cred = EmailAuthProvider.credential(
        firebaseUser.email,
        emailPassword
      );
      await reauthenticateWithCredential(firebaseUser, cred);
      await updateEmail(firebaseUser, trimmedEmail);
      const userRef = doc(db, "users", firebaseUser.uid);
      await setDoc(
        userRef,
        { email: trimmedEmail, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      Alert.alert("Listo", "Correo actualizado correctamente.");
      setShowEmailForm(false);
      setNewEmail("");
      setEmailPassword("");
    } catch (error: any) {
      Alert.alert(
        "Error",
        `No se pudo cambiar el correo.\n\nCódigo: ${
          error?.code ?? "desconocido"
        }`
      );
    } finally {
      setProcessingEmail(false);
    }
  };

  const handleChangePassword = async () => {
    if (!firebaseUser || !firebaseUser.email) {
      Alert.alert("Error", "Esta función requiere conexión a internet.");
      return;
    }
    if (!currentPass.trim() || !newPass.trim() || newPass.length < 6) {
      Alert.alert(
        "Validación",
        "La nueva contraseña debe tener al menos 6 caracteres."
      );
      return;
    }
    if (newPass !== confirmPass) {
      Alert.alert("Validación", "Las contraseñas no coinciden.");
      return;
    }

    try {
      setProcessingPass(true);
      const cred = EmailAuthProvider.credential(
        firebaseUser.email,
        currentPass
      );
      await reauthenticateWithCredential(firebaseUser, cred);
      await updatePassword(firebaseUser, newPass);
      Alert.alert("Listo", "Contraseña actualizada correctamente.");
      setShowPasswordForm(false);
      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");
    } catch (error: any) {
      Alert.alert(
        "Error",
        `No se pudo cambiar la contraseña.\n\nCódigo: ${
          error?.code ?? "desconocido"
        }`
      );
    } finally {
      setProcessingPass(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Cargando perfil...</Text>
      </SafeAreaView>
    );
  }

  if (!userId) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>
          No hay usuario autenticado. Inicia sesión de nuevo.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>Mi perfil</Text>
              <Text style={styles.subtitle}>
                Revisa tu información personal y médica
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.editButton, isEditing && styles.editButtonActive]}
              onPress={toggleEdit}
            >
              <MaterialIcons
                name={isEditing ? "close" : "edit"}
                size={20}
                color={isEditing ? "#fff" : "#007bff"}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.avatarContainer}>
            <View style={styles.avatarOuter}>
              <View style={styles.avatarCircle}>
                {photoUri ? (
                  <Image
                    source={{ uri: photoUri }}
                    style={styles.avatarImage}
                  />
                ) : (
                  <Text style={styles.avatarInitials}>
                    {displayName
                      ? displayName.charAt(0).toUpperCase()
                      : userEmail?.charAt(0).toUpperCase() ?? "?"}
                  </Text>
                )}
              </View>
            </View>
            {isEditing && (
              <View style={styles.avatarButtons}>
                <TouchableOpacity
                  style={styles.avatarIconButton}
                  onPress={handlePickFromGallery}
                >
                  <MaterialIcons
                    name="photo-library"
                    size={20}
                    color="#007bff"
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.avatarIconButton}
                  onPress={handleTakePhoto}
                >
                  <MaterialIcons
                    name="photo-camera"
                    size={20}
                    color="#007bff"
                  />
                </TouchableOpacity>
              </View>
            )}
          </View>

          <Text style={styles.sectionTitle}>Cuenta</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Correo electrónico</Text>
            <Text style={styles.readonlyInput}>
              {userEmail || "No disponible"}
            </Text>
          </View>

          {firebaseUser && (
            <View style={styles.securityBlock}>
              <Text style={styles.sectionTitle}>Seguridad de la cuenta</Text>
              <TouchableOpacity
                style={styles.inlineButton}
                onPress={() => setShowEmailForm((prev) => !prev)}
              >
                <MaterialIcons
                  name="alternate-email"
                  size={18}
                  color="#007bff"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.inlineButtonText}>
                  {showEmailForm ? "Cancelar" : "Cambiar correo"}
                </Text>
              </TouchableOpacity>
              {showEmailForm && (
                <View style={styles.securityCard}>
                  <Text style={styles.label}>Nuevo correo</Text>
                  <TextInput
                    style={styles.input}
                    value={newEmail}
                    onChangeText={setNewEmail}
                    placeholder="nuevo@correo.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  <Text style={[styles.label, { marginTop: 8 }]}>
                    Contraseña actual
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={emailPassword}
                    onChangeText={setEmailPassword}
                    placeholder="Contraseña"
                    secureTextEntry
                  />
                  <TouchableOpacity
                    style={[
                      styles.saveButtonSmall,
                      processingEmail && { opacity: 0.7 },
                    ]}
                    onPress={handleChangeEmail}
                    disabled={processingEmail}
                  >
                    {processingEmail ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.saveButtonTextSmall}>Guardar</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
              <TouchableOpacity
                style={[styles.inlineButton, { marginTop: 10 }]}
                onPress={() => setShowPasswordForm((prev) => !prev)}
              >
                <MaterialIcons
                  name="lock-reset"
                  size={18}
                  color="#007bff"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.inlineButtonText}>
                  {showPasswordForm ? "Cancelar" : "Cambiar contraseña"}
                </Text>
              </TouchableOpacity>
              {showPasswordForm && (
                <View style={styles.securityCard}>
                  <Text style={styles.label}>Contraseña actual</Text>
                  <TextInput
                    style={styles.input}
                    value={currentPass}
                    onChangeText={setCurrentPass}
                    placeholder="Actual"
                    secureTextEntry
                  />
                  <Text style={[styles.label, { marginTop: 8 }]}>
                    Nueva contraseña
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={newPass}
                    onChangeText={setNewPass}
                    placeholder="Mín. 6 caracteres"
                    secureTextEntry
                  />
                  <Text style={[styles.label, { marginTop: 8 }]}>
                    Confirmar
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={confirmPass}
                    onChangeText={setConfirmPass}
                    placeholder="Repetir"
                    secureTextEntry
                  />
                  <TouchableOpacity
                    style={[
                      styles.saveButtonSmall,
                      processingPass && { opacity: 0.7 },
                    ]}
                    onPress={handleChangePassword}
                    disabled={processingPass}
                  >
                    {processingPass ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.saveButtonTextSmall}>Guardar</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          <View style={styles.sectionDivider} />
          <Text style={styles.sectionTitle}>Información personal</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Nombre</Text>
            <TextInput
              style={[styles.input, !isEditing && styles.inputDisabled]}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Tu nombre"
              editable={isEditing}
            />
          </View>
          <View style={styles.row}>
            <View style={[styles.field, styles.rowItem]}>
              <Text style={styles.label}>Edad</Text>
              <TextInput
                style={[styles.input, !isEditing && styles.inputDisabled]}
                value={age}
                onChangeText={setAge}
                placeholder="Ej. 21"
                keyboardType="numeric"
                editable={isEditing}
              />
            </View>
            <View style={[styles.field, styles.rowItem]}>
              <Text style={styles.label}>Teléfono</Text>
              <TextInput
                style={[styles.input, !isEditing && styles.inputDisabled]}
                value={phone}
                onChangeText={setPhone}
                placeholder="3511234567"
                keyboardType="phone-pad"
                editable={isEditing}
              />
            </View>
          </View>

          <View style={styles.sectionDivider} />
          <Text style={styles.sectionTitle}>Contacto de emergencia</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Nombre</Text>
            <TextInput
              style={[styles.input, !isEditing && styles.inputDisabled]}
              value={emergencyName}
              onChangeText={setEmergencyName}
              placeholder="Ej. Mamá"
              editable={isEditing}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Parentesco</Text>
            <TextInput
              style={[styles.input, !isEditing && styles.inputDisabled]}
              value={emergencyRelation}
              onChangeText={setEmergencyRelation}
              placeholder="Ej. Madre"
              editable={isEditing}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Teléfono</Text>
            <TextInput
              style={[styles.input, !isEditing && styles.inputDisabled]}
              value={emergencyPhone}
              onChangeText={setEmergencyPhone}
              placeholder="Teléfono"
              keyboardType="phone-pad"
              editable={isEditing}
            />
          </View>

          <View style={styles.sectionDivider} />
          <Text style={styles.sectionTitle}>Datos rápidos</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Tipo de sangre</Text>
            <TextInput
              style={[styles.input, !isEditing && styles.inputDisabled]}
              value={bloodType}
              onChangeText={setBloodType}
              placeholder="Ej. O+"
              editable={isEditing}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Notas</Text>
            <TextInput
              style={[
                styles.input,
                styles.multiline,
                !isEditing && styles.inputDisabled,
              ]}
              value={emergencyNotes}
              onChangeText={setEmergencyNotes}
              placeholder="Notas importantes"
              multiline
              editable={isEditing}
            />
          </View>

          <View style={styles.sectionDivider} />
          <Text style={styles.sectionTitle}>Datos médicos</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Alergias</Text>
            <TextInput
              style={[
                styles.input,
                styles.multiline,
                !isEditing && styles.inputDisabled,
              ]}
              value={allergies}
              onChangeText={setAllergies}
              placeholder="Alergias"
              multiline
              editable={isEditing}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Condiciones médicas</Text>
            <TextInput
              style={[
                styles.input,
                styles.multiline,
                !isEditing && styles.inputDisabled,
              ]}
              value={conditions}
              onChangeText={setConditions}
              placeholder="Condiciones"
              multiline
              editable={isEditing}
            />
          </View>

          {isEditing && (
            <TouchableOpacity
              style={[styles.saveButton, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>Guardar cambios</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f6fa" },
  content: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 24,
    alignItems: "center",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  loadingText: { marginTop: 8, fontSize: 14, color: "#555" },
  errorText: { fontSize: 16, textAlign: "center", color: "#333" },
  card: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#fff",
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 22,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: { fontSize: 22, fontWeight: "600", color: "#111827" },
  subtitle: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  editButton: {
    padding: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#007bff33",
    backgroundColor: "#fff",
  },
  editButtonActive: { backgroundColor: "#007bff", borderColor: "#007bff" },
  avatarContainer: { alignItems: "center", marginTop: 16, marginBottom: 12 },
  avatarOuter: { padding: 4, borderRadius: 999, backgroundColor: "#e5e7eb" },
  avatarCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: { width: 96, height: 96, borderRadius: 48 },
  avatarInitials: { fontSize: 32, fontWeight: "700", color: "#4b5563" },
  avatarButtons: { flexDirection: "row", marginTop: 8, gap: 10 },
  avatarIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#007bff33",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
    marginTop: 10,
    marginBottom: 6,
  },
  sectionDivider: { height: 1, backgroundColor: "#f0f0f0", marginVertical: 10 },
  field: { marginBottom: 12 },
  label: { fontSize: 13, marginBottom: 4, color: "#6b7280" },
  readonlyInput: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
    fontSize: 15,
    color: "#111827",
  },
  input: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    fontSize: 15,
    backgroundColor: "#fff",
    color: "#111827",
  },
  inputDisabled: { backgroundColor: "#f9fafb", color: "#6b7280" },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 10 },
  rowItem: { flex: 1 },
  saveButton: {
    marginTop: 8,
    backgroundColor: "#007bff",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  saveButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  securityBlock: { marginTop: 4 },
  inlineButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: 6,
  },
  inlineButtonText: { color: "#007bff", fontWeight: "600", fontSize: 13 },
  securityCard: {
    marginTop: 4,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
  },
  saveButtonSmall: {
    marginTop: 10,
    backgroundColor: "#007bff",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  saveButtonTextSmall: { color: "#fff", fontSize: 14, fontWeight: "600" },
});

export default ProfileScreen;
