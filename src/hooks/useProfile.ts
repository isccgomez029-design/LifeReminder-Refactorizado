// src/hooks/useProfile.ts

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";

import {
  type ProfileData,
  getCurrentAuthInfo,
  loadProfileOfflineFirst,
  saveProfileOfflineFirst,
  changeEmailOnline,
  changePasswordOnline,
} from "../services/profileService";

//  solo para re-leer cache
import { syncQueueService } from "../services/offline/SyncQueueService";
import { useOffline } from "../context/OfflineContext";
export function useProfile() {
  const { firebaseUser, offlineUser, userId, userEmail, displayNameFallback } =
    getCurrentAuthInfo();
  const { isOnline, pendingOperations } = useOffline();

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

  const applyProfileToState = useCallback(
    (data: any | null) => {
      if (!data) {
        //  Perfil nuevo offline → estado limpio
        setDisplayName(displayNameFallback || "");
        setPhone("");
        setAge("");
        setAllergies("");
        setConditions("");
        setPhotoUri(null);

        setEmergencyName("");
        setEmergencyRelation("");
        setEmergencyPhone("");

        setBloodType("");
        setEmergencyNotes("");
        return;
      }

      setDisplayName(data.displayName || displayNameFallback || "");
      setPhone(data.phone || "");
      setAge(data.age ? String(data.age) : "");
      setAllergies(data.allergies || "");
      setConditions(data.conditions || "");
      if (typeof data.photoUri === "string") {
        setPhotoUri(data.photoUri);
      }

      setEmergencyName(data.emergencyContactName || "");
      setEmergencyRelation(data.emergencyContactRelation || "");
      setEmergencyPhone(data.emergencyContactPhone || "");

      setBloodType(data.bloodType || "");
      setEmergencyNotes(data.emergencyNotes || "");
    },
    [displayNameFallback]
  );

  // Load profile (cache inmediato, NO cuelga)
  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        if (!userId) {
          if (mounted) setLoading(false);
          return;
        }

        const data = await loadProfileOfflineFirst(userId);
        if (!mounted) return;

        applyProfileToState(data);
      } catch (e) {
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [userId, applyProfileToState]);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    const t = setTimeout(async () => {
      if (cancelled) return;

      try {
        const cached = await syncQueueService.getFromCache("profile", userId);
        const first = cached?.data?.[0] ?? null;
        if (!first) return;

        applyProfileToState(first);
      } catch {
        // no-op
      }
    }, 1200);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [userId, applyProfileToState]);

  //  reaccionar cuando termina el sync offline
  useEffect(() => {
    if (!userId) return;

    if (isOnline && pendingOperations === 0) {
      (async () => {
        try {
          const data = await loadProfileOfflineFirst(userId);
          applyProfileToState(data);
        } catch {
          // no-op
        }
      })();
    }
  }, [userId, isOnline, pendingOperations, applyProfileToState]);

  const toggleEdit = useCallback(() => {
    setIsEditing((prev) => !prev);
  }, []);

  const handlePickFromGallery = useCallback(async () => {
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
    } catch (e) {}
  }, []);

  const handleTakePhoto = useCallback(async () => {
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
    } catch (e) {}
  }, []);

  const handleSave = useCallback(async () => {
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

    const profileData: ProfileData = {
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
      await saveProfileOfflineFirst({ userId, profileData });
      Alert.alert("Listo", "Perfil actualizado correctamente.");
      setIsEditing(false);
    } catch (e) {
      Alert.alert("Error", "No se pudieron guardar los cambios.");
    } finally {
      setSaving(false);
    }
  }, [
    userId,
    displayName,
    phone,
    userEmail,
    age,
    allergies,
    conditions,
    photoUri,
    emergencyName,
    emergencyRelation,
    emergencyPhone,
    bloodType,
    emergencyNotes,
  ]);

  const handleChangeEmail = useCallback(async () => {
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
      await changeEmailOnline({
        firebaseUser,
        newEmail: trimmedEmail,
        currentPassword: emailPassword,
      });

      Alert.alert("Listo", "Correo actualizado correctamente.");
      setShowEmailForm(false);
      setNewEmail("");
      setEmailPassword("");
    } catch (error: any) {
      Alert.alert(
        "Error",
        `No se pudo cambiar el correo.\n\nCódigo: ${
          error?.code ?? error?.message ?? "desconocido"
        }`
      );
    } finally {
      setProcessingEmail(false);
    }
  }, [firebaseUser, newEmail, emailPassword]);

  const handleChangePassword = useCallback(async () => {
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
      await changePasswordOnline({
        firebaseUser,
        currentPassword: currentPass,
        newPassword: newPass,
      });

      Alert.alert("Listo", "Contraseña actualizada correctamente.");
      setShowPasswordForm(false);
      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");
    } catch (error: any) {
      Alert.alert(
        "Error",
        `No se pudo cambiar la contraseña.\n\nCódigo: ${
          error?.code ?? error?.message ?? "desconocido"
        }`
      );
    } finally {
      setProcessingPass(false);
    }
  }, [firebaseUser, currentPass, newPass, confirmPass]);

  return useMemo(
    () => ({
      // auth
      firebaseUser,
      offlineUser,
      userId,
      userEmail,

      // state
      displayName,
      setDisplayName,
      phone,
      setPhone,
      age,
      setAge,
      allergies,
      setAllergies,
      conditions,
      setConditions,
      photoUri,
      emergencyName,
      setEmergencyName,
      emergencyRelation,
      setEmergencyRelation,
      emergencyPhone,
      setEmergencyPhone,
      bloodType,
      setBloodType,
      emergencyNotes,
      setEmergencyNotes,

      loading,
      saving,
      isEditing,

      showEmailForm,
      setShowEmailForm,
      showPasswordForm,
      setShowPasswordForm,

      newEmail,
      setNewEmail,
      emailPassword,
      setEmailPassword,
      processingEmail,

      currentPass,
      setCurrentPass,
      newPass,
      setNewPass,
      confirmPass,
      setConfirmPass,
      processingPass,

      // actions
      toggleEdit,
      handlePickFromGallery,
      handleTakePhoto,
      handleSave,
      handleChangeEmail,
      handleChangePassword,

      // setters used by UI
      setPhotoUri,
    }),
    [
      firebaseUser,
      offlineUser,
      userId,
      userEmail,
      displayName,
      phone,
      age,
      allergies,
      conditions,
      photoUri,
      emergencyName,
      emergencyRelation,
      emergencyPhone,
      bloodType,
      emergencyNotes,
      loading,
      saving,
      isEditing,
      showEmailForm,
      showPasswordForm,
      newEmail,
      emailPassword,
      processingEmail,
      currentPass,
      newPass,
      confirmPass,
      processingPass,
      toggleEdit,
      handlePickFromGallery,
      handleTakePhoto,
      handleSave,
      handleChangeEmail,
      handleChangePassword,
    ]
  );
}

export default {
  useProfile,
};
