// src/screens/meds/AddMedicationScreen.tsx
// ✅ ACTUALIZADO: Alarmas delegadas a medsAlarmsService (offline-first)

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  Image,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { COLORS, FONT_SIZES } from "../../../types";
import { StackNavigationProp } from "@react-navigation/stack";
import { RouteProp } from "@react-navigation/native";
import { RootStackParamList } from "../../navigation/StackNavigator";
import { SafeAreaView } from "react-native-safe-area-context";

// 🔹 Firebase Auth
import { auth } from "../../config/firebaseConfig";

// 🔹 Servicios offline
import { offlineAuthService } from "../../services/offline/OfflineAuthService";
import { syncQueueService } from "../../services/offline/SyncQueueService";

// 🔹 Servicio de alarmas de dominio (✅ nuevo)
import medsAlarmsService from "../../services/alarms/medsAlarmsService";

// 🔹 Utils
import { normalizeTime } from "../../utils/timeUtils";

// 🔹 Componentes
import ImagePickerSheet from "../../components/ImagePickerSheet";
import TimePickerField from "../../components/TimePickerField";

// 🔹 Servicio de imagen
import {
  pickImageFromGallery,
  takePhotoWithCamera,
} from "../../services/imagePickerService";

type Nav = StackNavigationProp<RootStackParamList, "AddMedication">;
type Route = RouteProp<RootStackParamList, "AddMedication">;

function formatHHmm(date: Date) {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AddMedicationScreen({
  navigation,
  route,
}: {
  navigation: Nav;
  route: Route;
}) {
  const medId = route?.params?.medId;
  const initial = route?.params?.initialData;
  const initialAny: any = initial ?? {};

  const isEdit = !!medId;

  // 🔎 Dueño real (paciente o tú mismo)
  const loggedUid = auth.currentUser?.uid || offlineAuthService.getCurrentUid();
  const ownerUid = route?.params?.patientUid ?? loggedUid ?? null;

  // 🔐 Permiso para modificar (cuidador read-only no debe editar)
  const canModify = ownerUid && loggedUid && ownerUid === loggedUid;

  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [frecuencia, setFrecuencia] = useState(initial?.frecuencia ?? "");
  const [hora, setHora] = useState(initial?.proximaToma ?? "");

  const [cantidad, setCantidad] = useState(
    initialAny.cantidadActual != null
      ? String(initialAny.cantidadActual)
      : initialAny.cantidad != null
      ? String(initialAny.cantidad)
      : ""
  );

  const [doseAmount, setDoseAmount] = useState(
    initialAny.cantidadPorToma != null
      ? String(initialAny.cantidadPorToma)
      : initialAny.doseAmount != null
      ? String(initialAny.doseAmount)
      : initialAny.dosis
      ? String(initialAny.dosis).match(/\d+/)?.[0] ?? ""
      : ""
  );

  const [doseUnit, setDoseUnit] = useState<"tabletas" | "ml">(
    initialAny.doseUnit === "ml"
      ? "ml"
      : initialAny.doseUnit === "tabletas"
      ? "tabletas"
      : String(initialAny.dosis || "")
          .toLowerCase()
          .includes("ml")
      ? "ml"
      : "tabletas"
  );

  const [imageUri, setImageUri] = useState<string>(initialAny.imageUri ?? "");
  const [showImageSheet, setShowImageSheet] = useState(false);

  const handlePickFromGallery = async () => {
    const uri = await pickImageFromGallery();
    if (uri) setImageUri(uri);
  };

  const handleTakePhoto = async () => {
    const uri = await takePhotoWithCamera();
    if (uri) setImageUri(uri);
  };

  const onPressCamera = () => {
    setShowImageSheet(true);
  };

  const validate = () => {
    if (!canModify) {
      Alert.alert(
        "Sin permisos",
        "Solo el paciente puede modificar medicamentos."
      );
      return false;
    }

    if (!nombre.trim()) {
      Alert.alert("Falta el nombre", "Ingresa el nombre del medicamento.");
      return false;
    }

    if (!doseAmount.trim()) {
      Alert.alert(
        "Falta la dosis",
        "Ingresa la cantidad por toma, por ejemplo: 1, 2, 5, etc."
      );
      return false;
    }
    const doseNum = Number(doseAmount.trim());
    if (!Number.isFinite(doseNum) || doseNum <= 0) {
      Alert.alert("Dosis inválida", "La dosis debe ser un número mayor que 0.");
      return false;
    }
    if (!doseUnit) {
      Alert.alert(
        "Unidad de dosis",
        "Selecciona si la dosis es en tabletas/pastillas o en ml."
      );
      return false;
    }

    const freqTrim = frecuencia.trim();
    if (!freqTrim) {
      Alert.alert(
        "Falta la frecuencia",
        "Ingresa cada cuánto se toma en formato HH:MM, por ejemplo: 08:00."
      );
      return false;
    }
    const freqMatch = freqTrim.match(/^(\d{1,2}):(\d{2})$/);
    if (!freqMatch) {
      Alert.alert(
        "Frecuencia inválida",
        "La frecuencia debe tener el formato HH:MM, por ejemplo: 08:00."
      );
      return false;
    }
    const h = Number(freqMatch[1]);
    const m = Number(freqMatch[2]);
    if (
      !Number.isFinite(h) ||
      !Number.isFinite(m) ||
      h < 0 ||
      h > 23 ||
      m < 0 ||
      m > 59
    ) {
      Alert.alert(
        "Frecuencia inválida",
        "Revisa las horas y minutos de la frecuencia."
      );
      return false;
    }

    if (cantidad.trim()) {
      const n = Number(cantidad.trim());
      if (!Number.isFinite(n) || n < 0) {
        Alert.alert(
          "Cantidad inválida",
          "La cantidad disponible debe ser un número entero mayor o igual a 0."
        );
        return false;
      }
    }

    return true;
  };

  // ============================================
  //  FUNCIÓN PRINCIPAL: onSubmit
  // ============================================
  const onSubmit = async () => {
    if (!validate()) return;

    const userId = ownerUid; // ✅ ownerUid ya resuelto offline-first

    if (!userId) {
      Alert.alert(
        "Sesión requerida",
        "Debes iniciar sesión para guardar tus medicamentos."
      );
      return;
    }

    const cantidadNumber = cantidad.trim() ? Number(cantidad.trim()) : 0;
    const doseAmountNumber = doseAmount.trim()
      ? Number(doseAmount.trim())
      : undefined;

    const horaFormatted = hora.trim() ? normalizeTime(hora.trim()) : "";
    if (horaFormatted && horaFormatted !== hora) {
      setHora(horaFormatted);
    }

    try {
      const medicationId =
        isEdit && medId
          ? medId
          : `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const dosisString =
        doseAmountNumber !== undefined
          ? `${doseAmountNumber} ${doseUnit}`
          : undefined;

      // ============================================
      //  CALCULAR nextDueAt PARA LA PRIMERA ALARMA
      // ============================================
      let nextDueAt: Date | null = null;

      if (horaFormatted) {
        const [hours, minutes] = horaFormatted.split(":").map(Number);

        const now = new Date();
        const firstDose = new Date();
        firstDose.setHours(hours, minutes, 0, 0);

        if (firstDose <= now) firstDose.setDate(firstDose.getDate() + 1);

        nextDueAt = firstDose;
      }

      // ============================================
      //  PREPARAR DATOS DEL MEDICAMENTO
      //  (IMPORTANTE: Encolar el doc completo ANTES de programar alarmas)
      // ============================================
      const medicationData: any = {
        id: medicationId,
        nombre: nombre.trim(),
        dosis: dosisString,
        frecuencia: frecuencia.trim(),
        // Proxima toma guardada como hora visible
        proximaToma: nextDueAt ? formatHHmm(nextDueAt) : horaFormatted || null,
        nextDueAt: nextDueAt ? nextDueAt.toISOString() : null,

        doseAmount: doseAmountNumber,
        doseUnit: doseUnit,
        cantidadPorToma: doseAmountNumber || 1,
        cantidadInicial: cantidadNumber,
        cantidadActual: cantidadNumber,
        cantidad: cantidadNumber,
        low20Notified: false,
        low10Notified: false,
        imageUri: imageUri || undefined,
        takenToday: false,

        // Alarm fields (se setean con medsAlarmsService después)
        currentAlarmId: initialAny.currentAlarmId ?? null,
        snoozeCount: 0,
        snoozedUntil: null,
        lastSnoozeAt: null,

        createdAt: isEdit ? undefined : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isArchived: false,
      };

      // ============================================
      //  1) CANCELAR ALARMAS ANTERIORES (solo en edit)
      // ============================================
      if (isEdit && medId) {
        await medsAlarmsService.cancelAllMedAlarmsForItem({
          ownerUid: userId,
          medId: medId,
        });
      }

      // ============================================
      //  2) ENCOLAR CREATE/UPDATE del doc COMPLETO
      //     (esto evita UPDATE→CREATE incompleto)
      // ============================================
      if (isEdit && medId) {
        await syncQueueService.enqueue(
          "UPDATE",
          "medications",
          medId,
          userId,
          medicationData
        );
      } else {
        await syncQueueService.enqueue(
          "CREATE",
          "medications",
          medicationId,
          userId,
          medicationData
        );
      }

      // ============================================
      //  3) PROGRAMAR ALARMA + PERSISTIR currentAlarmId (si aplica)
      // ============================================
      let alarmId: string | null = null;

      if (nextDueAt && frecuencia.trim()) {
        const alarmResult = await medsAlarmsService.scheduleMedAlarmAndPersist({
          ownerUid: userId,
          med: {
            id: medicationId,
            nombre: medicationData.nombre,
            dosis: medicationData.dosis,
            imageUri: medicationData.imageUri,
            frecuencia: medicationData.frecuencia,
            cantidadActual: medicationData.cantidadActual,
            cantidadPorToma: medicationData.cantidadPorToma,
          },
          triggerDate: nextDueAt,
          patientName: route?.params?.patientName,
        });

        alarmId = alarmResult.alarmId;
      }

      Alert.alert(
        "Listo",
        isEdit
          ? "Medicamento actualizado."
          : alarmId && nextDueAt
          ? `Medicamento guardado. Primera alarma programada para ${nextDueAt.toLocaleTimeString(
              "es-MX",
              {
                hour: "2-digit",
                minute: "2-digit",
              }
            )}.`
          : "Medicamento guardado.",
        [{ text: "OK", onPress: () => navigation.goBack() }]
      );
    } catch (e: any) {
      console.log("Error guardando medicamento:", e);
      Alert.alert(
        "Error",
        `No se pudo guardar el medicamento.\n\nCódigo: ${
          e?.code ?? "desconocido"
        }\nDetalle: ${e?.message ?? "sin mensaje"}`
      );
    }
  };

  // ============================================
  //  FUNCIÓN: onDelete
  // ============================================
  const onDelete = () => {
    if (!isEdit || !medId) return;

    Alert.alert(
      "Eliminar medicamento",
      "¿Seguro que deseas eliminar este medicamento? Esta acción no se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            const userId = ownerUid;

            if (!userId) {
              Alert.alert(
                "Sesión requerida",
                "Debes iniciar sesión para eliminar medicamentos."
              );
              return;
            }

            try {
              // ✅ Cancelar alarmas vía servicio de dominio
              await medsAlarmsService.cancelAllMedAlarmsForItem({
                ownerUid: userId,
                medId,
              });

              // Eliminar medicamento
              await syncQueueService.enqueue(
                "DELETE",
                "medications",
                medId,
                userId,
                {}
              );

              Alert.alert("Eliminado", "El medicamento fue eliminado.", [
                { text: "OK", onPress: () => navigation.goBack() },
              ]);
            } catch (e: any) {
              console.log("Error eliminando medicamento:", e);
              Alert.alert(
                "Error",
                `No se pudo eliminar el medicamento.\n\nCódigo: ${
                  e?.code ?? "desconocido"
                }\nDetalle: ${e?.message ?? "sin mensaje"}`
              );
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Título + icono de sección */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              {isEdit ? "Editar medicamento" : "Agregar medicamento"}
            </Text>
          </View>
          <View style={styles.sectionIcon}>
            <MaterialIcons
              name="medical-services"
              size={22}
              color={COLORS.surface}
            />
          </View>
        </View>

        {/* ===== Tarjeta / Formulario ===== */}
        <View style={styles.card}>
          {/* Botón cámara flotante */}
          <TouchableOpacity
            style={styles.cameraBtn}
            onPress={onPressCamera}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name="photo-camera"
              size={22}
              color={COLORS.surface}
            />
          </TouchableOpacity>

          {/* Preview de imagen */}
          {imageUri ? (
            <View style={styles.previewWrapper}>
              <Image source={{ uri: imageUri }} style={styles.previewImage} />
            </View>
          ) : null}

          {/* Nombre */}
          <View style={[styles.fieldRow, styles.firstFieldRow]}>
            <Text style={styles.label}>Nombre:</Text>
            <TextInput
              style={styles.input}
              value={nombre}
              onChangeText={setNombre}
              placeholder="Ej. Losartán"
              placeholderTextColor={COLORS.textSecondary}
            />
          </View>

          {/* Hora próxima toma */}
          <View style={styles.fieldRow}>
            <Text style={styles.label}>Hora próxima toma:</Text>
            <View style={styles.timeRow}>
              <TimePickerField
                value={hora}
                onChange={setHora}
                mode="point"
                placeholder="Seleccionar hora"
              />
            </View>
          </View>

          {/* Frecuencia */}
          <View style={styles.fieldRow}>
            <Text style={styles.label}>Cada:</Text>
            <View style={styles.timeRow}>
              <TimePickerField
                value={frecuencia}
                onChange={setFrecuencia}
                mode="interval"
                placeholder="Seleccionar intervalo"
              />
              <Text style={[styles.label, { marginLeft: 8 }]}>hrs</Text>
            </View>
          </View>

          {/* Dosis */}
          <View style={styles.fieldRow}>
            <Text style={styles.label}>Dosis por toma:</Text>
            <View style={styles.doseRow}>
              <TextInput
                style={styles.doseAmountInput}
                value={doseAmount}
                onChangeText={setDoseAmount}
                placeholder="Ej. 1"
                placeholderTextColor={COLORS.textSecondary}
                keyboardType="numeric"
              />

              <View style={styles.unitRow}>
                <TouchableOpacity
                  style={[
                    styles.unitChip,
                    doseUnit === "tabletas" && styles.unitChipSelected,
                  ]}
                  onPress={() => setDoseUnit("tabletas")}
                >
                  <Text
                    style={[
                      styles.unitChipText,
                      doseUnit === "tabletas" && styles.unitChipTextSelected,
                    ]}
                  >
                    Tabletas/pastillas
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.unitChip,
                    doseUnit === "ml" && styles.unitChipSelected,
                  ]}
                  onPress={() => setDoseUnit("ml")}
                >
                  <Text
                    style={[
                      styles.unitChipText,
                      styles.unitChipTextSmall,
                      doseUnit === "ml" && styles.unitChipTextSelected,
                    ]}
                  >
                    Mililitros (ml)
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Cantidad */}
          <View style={styles.fieldRow}>
            <Text style={styles.label}>Cantidad disponible:</Text>
            <TextInput
              style={styles.input}
              value={cantidad}
              onChangeText={setCantidad}
              placeholder="Ej. 30"
              placeholderTextColor={COLORS.textSecondary}
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* Botones */}
        <TouchableOpacity style={styles.primaryBtn} onPress={onSubmit}>
          <Text style={styles.primaryBtnText}>
            {isEdit ? "Actualizar medicamento" : "Guardar medicamento"}
          </Text>
        </TouchableOpacity>

        {isEdit && (
          <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
            <Text style={styles.deleteBtnText}>Eliminar medicamento</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <ImagePickerSheet
        visible={showImageSheet}
        onClose={() => setShowImageSheet(false)}
        onTakePhoto={async () => {
          setShowImageSheet(false);
          await handleTakePhoto();
        }}
        onPickFromGallery={async () => {
          setShowImageSheet(false);
          await handlePickFromGallery();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 0 },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  title: { fontSize: FONT_SIZES.xlarge, fontWeight: "800", color: COLORS.text },
  sectionIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.secondary,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 52,
    borderWidth: 1,
    borderColor: COLORS.border,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },

  cameraBtn: {
    position: "absolute",
    right: 12,
    top: 12,
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },

  previewWrapper: { alignItems: "center", marginBottom: 12 },
  previewImage: { width: 140, height: 90, borderRadius: 8 },

  fieldRow: { marginBottom: 14 },
  firstFieldRow: { marginTop: 4 },

  label: {
    color: COLORS.text,
    fontWeight: "700",
    fontSize: FONT_SIZES.small,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.textSecondary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: FONT_SIZES.medium,
    color: COLORS.text,
    backgroundColor: COLORS.background,
  },

  timeRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },

  doseRow: { flexDirection: "column" },
  doseAmountInput: {
    borderWidth: 1,
    borderColor: COLORS.textSecondary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: FONT_SIZES.medium,
    color: COLORS.text,
    backgroundColor: COLORS.background,
  },
  unitRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    flexWrap: "wrap",
  },
  unitChip: {
    borderWidth: 1,
    borderColor: COLORS.textSecondary,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 8,
    marginBottom: 4,
  },
  unitChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  unitChipText: {
    fontSize: FONT_SIZES.small,
    color: COLORS.text,
    fontWeight: "600",
  },
  unitChipTextSmall: { fontSize: FONT_SIZES.small },
  unitChipTextSelected: { color: COLORS.surface },

  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignSelf: "center",
    marginTop: 22,
    alignItems: "center",
  },
  primaryBtnText: {
    color: COLORS.surface,
    fontWeight: "900",
    fontSize: FONT_SIZES.medium,
    letterSpacing: 0.3,
  },

  deleteBtn: {
    backgroundColor: "#D32F2F",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignSelf: "center",
    marginTop: 12,
    alignItems: "center",
  },
  deleteBtnText: {
    color: COLORS.surface,
    fontWeight: "800",
    fontSize: FONT_SIZES.small,
  },
});
