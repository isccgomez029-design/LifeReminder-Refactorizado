// src/components/ImagePickerSheet.tsx

// Importación de React y componentes de React Native
import React from "react";
import {
  View, // contenedor básico
  Text, // para mostrar texto
  TouchableOpacity, // botón táctil con efecto de opacidad
  StyleSheet, // para definir estilos
  Modal, // (no se usa en este código, pero importado)
  Pressable, // componente táctil que detecta presión
} from "react-native";

// Iconos de Material Design (cámara, galería, etc.)
import { MaterialIcons } from "@expo/vector-icons";

// Constantes de colores y tamaños de fuente definidos en otro archivo
import { COLORS, FONT_SIZES } from "../../types";

// Definición de las props que recibe el componente
type Props = {
  visible: boolean; // controla si la hoja se muestra o no
  onClose: () => void; // función para cerrar la hoja
  onTakePhoto: () => void | Promise<void>; // acción para tomar foto
  onPickFromGallery: () => void | Promise<void>; // acción para elegir de galería
};

// Componente principal que muestra la hoja de selección de imagen
export default function ImagePickerSheet({
  visible,
  onClose,
  onTakePhoto,
  onPickFromGallery,
}: Props) {
  // Si la hoja no está visible, no renderiza nada
  if (!visible) return null;

  return (
    <View style={styles.sheetOverlay}>
      {/* Fondo oscuro que ocupa toda la pantalla, al presionar cierra la hoja */}
      <Pressable style={{ flex: 1 }} onPress={onClose} />

      {/* Contenedor de la hoja inferior */}
      <View style={styles.sheet}>
        {/* Pequeña barra/indicador en la parte superior de la hoja */}
        <View style={styles.sheetHandle} />

        {/* Título de la hoja */}
        <Text style={styles.sheetTitle}>Seleccionar imagen</Text>

        {/* Fila con los dos botones principales */}
        <View style={styles.sheetButtonsRow}>
          {/* Botón para tomar foto con la cámara */}
          <TouchableOpacity
            style={styles.sheetButton}
            onPress={onTakePhoto}
            activeOpacity={0.8} // efecto al presionar
          >
            {/* Icono de cámara */}
            <MaterialIcons
              name="photo-camera"
              size={22}
              color={COLORS.surface}
            />
            {/* Texto del botón */}
            <Text style={styles.sheetButtonText}>Tomar foto</Text>
          </TouchableOpacity>

          {/* Botón para seleccionar imagen desde la galería */}
          <TouchableOpacity
            style={styles.sheetButtonSecondary}
            onPress={onPickFromGallery}
            activeOpacity={0.8}
          >
            {/* Icono de galería */}
            <MaterialIcons
              name="photo-library"
              size={22}
              color={COLORS.surface}
            />
            {/* Texto del botón */}
            <Text style={styles.sheetButtonText}>Desde galería</Text>
          </TouchableOpacity>
        </View>

        {/* Botón para cancelar y cerrar la hoja */}
        <TouchableOpacity style={styles.sheetCancel} onPress={onClose}>
          <Text style={styles.sheetCancelText}>Cancelar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheetOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.2)",
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: FONT_SIZES.medium,
    fontWeight: "700",
    color: COLORS.text,
    textAlign: "center",
  },
  sheetButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
  },
  sheetButton: {
    flex: 1,
    marginRight: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  sheetButtonSecondary: {
    flex: 1,
    marginLeft: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.secondary,
  },
  sheetButtonText: {
    marginLeft: 8,
    color: COLORS.surface,
    fontWeight: "700",
    fontSize: FONT_SIZES.small,
  },
  sheetCancel: {
    marginTop: 10,
    paddingVertical: 8,
    alignItems: "center",
  },
  sheetCancelText: {
    color: COLORS.text,
    fontWeight: "600",
    fontSize: FONT_SIZES.small,
  },
});
