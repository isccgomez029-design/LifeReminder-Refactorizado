/*
  useAddAppointment.ts
*/

// src/hooks/useAddAppointment.ts
import { useMemo, useState } from "react";
import { Alert, Platform } from "react-native";

import { auth } from "../config/firebaseConfig";
import { offlineAuthService } from "../services/offline/OfflineAuthService";
import { syncQueueService } from "../services/offline/SyncQueueService";

import { scheduleAppointmentReminder } from "../services/Notifications";
import { upsertAndroidEvent } from "../services/deviceCalendarService";

import type { Appointment } from "../services/appointmentsService";
import {
  createAppointment,
  updateAppointment,
} from "../services/appointmentsService";

import { normalizeTime, formatHHMMDisplay } from "../utils/timeUtils";

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

const toISO = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

type Params = {
  navigation: any;
  routeParams?: {
    mode?: "new" | "edit";
    appt?: Appointment;
    patientUid?: string;
  };
};

export function useAddAppointment({ navigation, routeParams }: Params) {
  const mode = routeParams?.mode ?? "new";
  const appt = routeParams?.appt as any | undefined;
  const isEdit = mode === "edit";

  const initialDate = useMemo(
    () => (appt?.date ? new Date(appt.date) : new Date()),
    [appt?.date]
  );

  const [date, setDate] = useState<Date>(initialDate);
  const [motivo, setMotivo] = useState<string>(appt?.title ?? "");
  const [ubicacion, setUbicacion] = useState<string>(appt?.location ?? "");
  const [medico, setMedico] = useState<string>(appt?.doctor ?? "");
  const [hora, setHora] = useState<string>(appt?.time ?? "");

  const onChangeHora = (hhmm: string) => setHora(hhmm);

  const guardar = async () => {
    if (!motivo.trim()) {
      Alert.alert("Falta información", "Escribe el motivo de la cita.");
      return;
    }

    if (!hora) {
      Alert.alert("Falta información", "Selecciona la hora de la cita.");
      return;
    }

    const userId =
      routeParams?.patientUid ??
      offlineAuthService.getCurrentUid() ??
      syncQueueService.getCurrentValidUserId();

    if (!userId) {
      Alert.alert(
        "Sesión requerida",
        "Inicia sesión de nuevo para poder guardar la cita."
      );
      return;
    }

    const patientName =
      auth.currentUser?.displayName ||
      offlineAuthService.getCurrentUser()?.displayName ||
      undefined;

    const dateISO = toISO(date);
    const horaFinal = normalizeTime(hora);

    const appointmentId =
      isEdit && appt?.id
        ? appt.id
        : `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    const basePayload: Appointment = {
      id: appointmentId,
      title: motivo.trim(),
      doctor: medico.trim() || undefined,
      location: ubicacion.trim() || undefined,
      date: dateISO,
      time: horaFinal,
      eventId: (appt?.eventId as string | null | undefined) ?? undefined,
      createdAt: appt?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isArchived: false,
    };

    try {
      let eventIdFromDevice: string | undefined =
        basePayload.eventId ?? undefined;

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

          eventIdFromDevice = eventId;
        } catch {}
      }

      const finalPayload: Appointment = {
        ...basePayload,
        eventId: eventIdFromDevice,
      };

      if (isEdit && appt?.id) {
        await updateAppointment(userId, appt.id, finalPayload);
      } else {
        await createAppointment(userId, finalPayload, appointmentId);
      }

      try {
        await scheduleAppointmentReminder(
          userId,
          finalPayload.date,
          finalPayload.time || "",
          finalPayload.doctor || finalPayload.title,
          patientName,
          finalPayload.location
        );
      } catch {}

      Alert.alert(
        "✅ Listo",
        isEdit ? "Cita actualizada" : "Cita creada correctamente"
      );

      navigation.goBack();
    } catch (e: any) {
      Alert.alert(
        "Error",
        e?.message ?? "No se pudo guardar la cita. Intenta de nuevo."
      );
    }
  };

  return {
    isEdit,
    date,
    motivo,
    ubicacion,
    medico,
    hora,

    setDate,
    setMotivo,
    setUbicacion,
    setMedico,
    onChangeHora,

    guardar,

    formatHHMMDisplay,
  };
}
