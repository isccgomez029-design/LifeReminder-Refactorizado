// src/services/Notifications.ts
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// Handler global: cómo se muestran las notificaciones locales
Notifications.setNotificationHandler({
  handleNotification: async () =>
    ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    } as any), // casteo rápido para que TS no se queje
});

/**
 * Pide permisos y configura canal (Android).
 */
export async function configureNotificationPermissions() {
  const { status } = await Notifications.getPermissionsAsync();

  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    if (req.status !== "granted") {
      return;
    }
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "general",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
}

/**
 * Notificación inmediata local.
 */
export async function sendImmediateNotification(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: "default",
    },
    trigger: null, // inmediata
  });
}

/**
 * Recordatorio 24h antes de una cita
 */
export async function scheduleAppointmentReminder(
  dateISO: string, // "2025-11-25"
  time: string | undefined, // "14:30" o undefined
  title: string // texto de la cita (doctor o motivo)
) {
  try {
    // Hora por defecto si no viene hora
    const safeTime = time && /^\d{2}:\d{2}$/.test(time) ? time : "09:00";

    // Fecha/hora de la cita en horario local
    const appointmentDate = new Date(`${dateISO}T${safeTime}:00`);

    // 24 horas antes
    const reminderDate = new Date(
      appointmentDate.getTime() - 24 * 60 * 60 * 1000
    );

    // Si ya pasó el momento del recordatorio, no programamos nada
    if (reminderDate <= new Date()) {
      console.log(
        "[scheduleAppointmentReminder] Hora de recordatorio ya pasó, no se agenda."
      );
      return;
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Recordatorio de cita médica",
        body: `Mañana tienes tu cita: ${title}`,
        sound: "default",
      },
      // Usamos fecha absoluta; el `as any` es para evitar broncas con TS
      trigger: reminderDate as any,
    });

    console.log(
      "[scheduleAppointmentReminder] Notificación programada para:",
      reminderDate.toISOString()
    );
  } catch (err) {
    console.log("Error programando recordatorio de cita:", err);
  }
}
