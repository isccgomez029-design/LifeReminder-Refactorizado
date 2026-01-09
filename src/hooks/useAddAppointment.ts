// src/hooks/useAddAppointment.ts
import { useMemo, useState } from "react";
import { Alert, Platform } from "react-native";

import { auth } from "../config/firebaseConfig";
import { offlineAuthService } from "../services/offline/OfflineAuthService";

import { scheduleAppointmentReminder } from "../services/Notifications";

import { upsertAndroidEvent } from "../services/deviceCalendarService";

import type { Appointment } from "../services/appointmentsService";
import {
  createAppointment,
  updateAppointment,
} from "../services/appointmentsService";

import { normalizeTime, formatHHMMDisplay } from "../utils/timeUtils";

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
// Agrega un 0 a la izquierda si el número es menor a 10 (formato de fecha)

const toISO = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Convierte un objeto Date a string en formato YYYY-MM-DD

// =======================
// Tipos
// =======================

type Params = {
  navigation: any; // Objeto de navegación de React Navigation
  routeParams?: {
    mode?: "new" | "edit"; // Indica si se crea o edita una cita
    appt?: Appointment; // Cita existente (solo en modo edición)
  };
};

// =======================
// Hook principal
// =======================

export function useAddAppointment({ navigation, routeParams }: Params) {
  const mode = routeParams?.mode ?? "new"; // Modo por defecto: crear
  const appt = routeParams?.appt as any | undefined; // Cita a editar (si existe)
  const isEdit = mode === "edit"; // Booleano para saber si es edición

  // Fecha inicial: la de la cita o la fecha actual
  const initialDate = useMemo(
    () => (appt?.date ? new Date(appt.date) : new Date()),
    [appt?.date]
  );

  // =======================
  // Estados del formulario
  // =======================

  const [date, setDate] = useState<Date>(initialDate); // Fecha de la cita
  const [motivo, setMotivo] = useState<string>(appt?.title ?? ""); // Motivo/título
  const [ubicacion, setUbicacion] = useState<string>(appt?.location ?? ""); // Ubicación
  const [medico, setMedico] = useState<string>(appt?.doctor ?? ""); // Doctor
  const [hora, setHora] = useState<string>(appt?.time ?? ""); // Hora en formato HH:MM

  // Handler para cambios de hora
  const onChangeHora = (hhmm: string) => setHora(hhmm);

  // =======================
  // Guardar cita
  // =======================

  const guardar = async () => {
    // Validación: motivo obligatorio
    if (!motivo.trim()) {
      Alert.alert("Falta información", "Escribe el motivo de la cita.");
      return;
    }

    // Validación: hora obligatoria
    if (!hora) {
      Alert.alert("Falta información", "Selecciona la hora de la cita.");
      return;
    }

    // Obtiene el UID del usuario (online u offline)
    const userId = offlineAuthService.getCurrentUid();
    if (!userId) {
      Alert.alert(
        "Sesión requerida",
        "Inicia sesión de nuevo para poder guardar la cita."
      );
      return;
    }

    // Nombre del paciente para notificaciones (offline-first)
    const patientName =
      auth.currentUser?.displayName ||
      offlineAuthService.getCurrentUser()?.displayName ||
      undefined;

    // Normalización de fecha y hora
    const dateISO = toISO(date); // Fecha en formato YYYY-MM-DD
    const horaFinal = normalizeTime(hora); // Hora normalizada HH:MM

    // ID de la cita:
    // - si edita → usa el ID existente
    // - si crea → genera un ID temporal
    const appointmentId =
      isEdit && appt?.id
        ? appt.id
        : `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Payload base de la cita
    const basePayload: Appointment = {
      id: appointmentId,
      title: motivo.trim(), // Motivo limpio
      doctor: medico.trim() || undefined, // Doctor (opcional)
      location: ubicacion.trim() || undefined, // Ubicación (opcional)
      date: dateISO, // Fecha ISO
      time: horaFinal, // Hora HH:MM
      eventId: (appt?.eventId as string | null | undefined) ?? undefined, // ID de calendario
      createdAt: appt?.createdAt || new Date().toISOString(), // Fecha creación
      updatedAt: new Date().toISOString(), // Fecha actualización
      isArchived: false, // Marca activa
    };

    try {
      // =======================
      // 1) Calendario Android
      // =======================

      let eventIdFromDevice: string | undefined =
        basePayload.eventId ?? undefined;

      // Solo Android: crea o actualiza evento en calendario del dispositivo
      if (Platform.OS === "android") {
        try {
          const { eventId } = await upsertAndroidEvent({
            eventId: basePayload.eventId ?? undefined,
            title: basePayload.title,
            location: basePayload.location,
            doctor: basePayload.doctor,
            date: basePayload.date,
            time: basePayload.time,
          } as any);

          eventIdFromDevice = eventId; // Guarda el ID del evento del sistema
        } catch {
          // Fallo silencioso: no bloquea el guardado de la cita
        }
      }

      // Payload final con eventId del dispositivo (si existe)
      const finalPayload: Appointment = {
        ...basePayload,
        eventId: eventIdFromDevice,
      };

      // =======================
      // 2) Persistencia offline-first
      // =======================

      if (isEdit && appt?.id) {
        // Actualiza la cita existente
        await updateAppointment(userId, appt.id, finalPayload);
      } else {
        // Crea una nueva cita
        await createAppointment(userId, finalPayload, appointmentId);
      }

      // =======================
      // 3) Recordatorios
      // =======================
      // - Paciente: notificación local (Expo)
      // - Cuidador: Firestore (si hay conexión)
      try {
        await scheduleAppointmentReminder(
          userId, // UID del paciente
          finalPayload.date, // Fecha
          finalPayload.time || "", // Hora
          finalPayload.doctor || finalPayload.title, // Texto principal
          patientName, // Nombre del paciente
          finalPayload.location // Ubicación
        );
      } catch {
        // Fallo silencioso
      }

      // Mensaje de éxito
      Alert.alert(
        "✅ Listo",
        isEdit ? "Cita actualizada" : "Cita creada correctamente"
      );

      navigation.goBack(); // Regresa a la pantalla anterior
    } catch (e: any) {
      // Manejo de error general
      Alert.alert(
        "Error",
        e?.message ?? "No se pudo guardar la cita. Intenta de nuevo."
      );
    }
  };

  // =======================
  // API del hook
  // =======================

  return {
    isEdit, // Indica si es edición
    date, // Fecha
    motivo, // Motivo
    ubicacion, // Ubicación
    medico, // Doctor
    hora, // Hora

    setDate, // Setter fecha
    setMotivo, // Setter motivo
    setUbicacion, // Setter ubicación
    setMedico, // Setter doctor
    onChangeHora, // Handler hora

    guardar, // Acción principal

    formatHHMMDisplay, // Helper para mostrar hora formateada
  };
}
