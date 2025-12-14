// src/services/imagePickerService.ts
import * as ImagePicker from "expo-image-picker";
import { Alert } from "react-native";

/** Seleccionar desde galería: devuelve uri o null */
export async function pickImageFromGallery(): Promise<string | null> {
  try {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status !== "granted") {
      Alert.alert(
        "Permiso requerido",
        "Activa el permiso de fotos/galería en los ajustes para elegir una imagen."
      );
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    return result.assets[0].uri;
  } catch (e) {
    console.log("Error al elegir de galería:", e);
    Alert.alert("Error", "No se pudo abrir la galería.");
    return null;
  }
}

/** Tomar foto con la cámara: devuelve uri o null */
export async function takePhotoWithCamera(): Promise<string | null> {
  try {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();

    if (status !== "granted") {
      Alert.alert(
        "Permiso requerido",
        "Activa el permiso de cámara en los ajustes para poder tomar una foto."
      );
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    return result.assets[0].uri;
  } catch (e) {
    console.log("Error al tomar foto:", e);
    Alert.alert("Error", "No se pudo abrir la cámara.");
    return null;
  }
}
