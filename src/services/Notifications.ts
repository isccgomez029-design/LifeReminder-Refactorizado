// src/services/notifications.ts

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
  limit,
  Unsubscribe,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../config/firebaseConfig";
import { hasPermission } from "./careNetworkService";

/* ============================================================
 *                    TIPOS Y CONSTANTES
 * ============================================================ */

export type NotificationSeverity = "low" | "medium" | "high";

export type NotificationType =
  | "noncompliance" // Incumplimiento (múltiples posposiciones)
  | "dismissal" // Descarte de alarma
  | "missed" // Dosis perdida
  | "completed" // Completado exitosamente
  | "appointment"; // Recordatorio de cita

export type CareNotification = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  patientUid: string;
  patientName: string;

  // meds/habits
  itemType?: "med" | "habit";
  itemName?: string;
  snoozeCount?: number;

  // citas
  appointmentTitle?: string;
  appointmentDateISO?: string;
  location?: string;

  severity: NotificationSeverity;
  read: boolean;
  createdAt: any;
};

type NotifyResult = {
  success: boolean;
  notifiedCount: number;
  error?: string;
};

/* ============================================================
 *        NOTIFICACIONES LOCALES (DEVICE)
 * ============================================================ */

// Handler global: cómo se muestran las notificaciones locales
Notifications.setNotificationHandler({
  handleNotification: async () =>
    ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    } as any),
});

/**
 * Pide permisos y configura canal (Android)
 */
export async function configureNotificationPermissions(): Promise<void> {
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
 *  Notificación inmediata local
 */
export async function sendImmediateNotification(
  title: string,
  body: string
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: "default",
      },
      trigger: null,
    });
  } catch (error) {}
}

/**
 * Recordatorio 24h antes de una cita

 */
export async function scheduleAppointmentReminder(
  patientUid: string,
  dateISO: string, // "2025-11-25"
  time: string | undefined, // "14:30" o undefined
  title: string, // texto de la cita (doctor o motivo)
  patientName?: string, // opcional
  location?: string // opcional
): Promise<void> {
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
      return;
    }

    // Aviso LOCAL para el paciente
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Recordatorio de cita médica",
        body: `Mañana tienes tu cita: ${title}`,
        sound: "default",
      },
      trigger: reminderDate as any,
    });

    // Aviso en FIRESTORE para cuidadores
    try {
      await notifyCaregiversAboutAppointmentReminder({
        patientUid,
        patientName,
        appointmentTitle: title,
        appointmentDateISO: appointmentDate.toISOString(),
        location,
      });
    } catch (e) {}
  } catch (err) {}
}

/* ============================================================
 *       NOTIFICACIONES FIRESTORE
 * ============================================================ */

/**
 * Escucha notificaciones del cuidador en tiempo real
 * @param userId - UID del cuidador
 * @param onData - Callback con las notificaciones
 * @param onError - Callback de error (opcional)
 * @returns Función unsubscribe
 */
export function listenCaregiverNotifications(
  userId: string,
  onData: (notifications: CareNotification[]) => void,
  onError?: (error: any) => void
): Unsubscribe {
  const notifRef = collection(db, "users", userId, "notifications");
  const q = query(notifRef, orderBy("createdAt", "desc"), limit(50));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: CareNotification[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as any;
        return {
          id: docSnap.id,
          type: data.type || "noncompliance",
          title: data.title || "Notificación",
          message: data.message || "",
          patientUid: data.patientUid || "",
          patientName: data.patientName || "Paciente",

          itemType: data.itemType,
          itemName: data.itemName,
          snoozeCount: data.snoozeCount,

          appointmentTitle: data.appointmentTitle,
          appointmentDateISO: data.appointmentDateISO,
          location: data.location,

          severity: data.severity || "medium",
          read: !!data.read,
          createdAt: data.createdAt,
        };
      });

      onData(list);
    },
    (error) => {
      onError?.(error);
    }
  );
}

/**
 *  Marca una notificación como leída
 */
export async function markNotificationAsRead(
  userId: string,
  notificationId: string
): Promise<void> {
  try {
    const notifRef = doc(db, "users", userId, "notifications", notificationId);
    await updateDoc(notifRef, { read: true });
  } catch (error) {
    throw error;
  }
}

/**
 * Marca múltiples notificaciones como leídas
 */
export async function markMultipleAsRead(
  userId: string,
  notificationIds: string[]
): Promise<void> {
  try {
    const promises = notificationIds.map((id) =>
      markNotificationAsRead(userId, id)
    );
    await Promise.all(promises);
  } catch (error) {
    throw error;
  }
}

/* ============================================================
 *      NOTIFICACIONES FIRESTORE
 * ============================================================ */

/**
 * Notificar a cuidadores: recordatorio de cita (1 día antes)
 */
export async function notifyCaregiversAboutAppointmentReminder(params: {
  patientUid: string;
  patientName?: string;
  appointmentTitle: string;
  appointmentDateISO: string; // ISO real de la cita
  location?: string;
}): Promise<NotifyResult> {
  try {
    const {
      patientUid,
      patientName,
      appointmentTitle,
      appointmentDateISO,
      location,
    } = params;

    //  Buscar cuidadores activos del paciente
    const careNetworkRef = collection(db, "users", patientUid, "careNetwork");
    const q = query(
      careNetworkRef,
      where("status", "==", "accepted"),
      where("deleted", "==", false)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return { success: true, notifiedCount: 0 };
    }

    const patientDisplay = patientName || "Un paciente";

    const dt = new Date(appointmentDateISO);
    const dateText = isNaN(dt.getTime())
      ? appointmentDateISO
      : dt.toLocaleString("es-MX", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });

    const baseMsg = `Mañana ${patientDisplay} tiene su cita: "${appointmentTitle}" (${dateText}).`;
    const message = location ? `${baseMsg} 📍 ${location}` : baseMsg;

    // Crear notificación para cada cuidador
    const notificationPromises = snapshot.docs.map(async (docSnap) => {
      const caregiverData = docSnap.data() as any;
      const caregiverUid = caregiverData.caregiverUid;

      // Solo notificar si el modo de acceso permite alertas
      const accessMode = caregiverData.accessMode || "alerts-only";

      if (!hasPermission(accessMode, "alerts")) {
        return false;
      }

      if (!caregiverUid) {
        return false;
      }

      const notificationsRef = collection(
        db,
        "users",
        caregiverUid,
        "notifications"
      );

      await addDoc(notificationsRef, {
        type: "appointment",
        title: "🗓️ Recordatorio de cita médica",
        message,
        patientUid,
        patientName: patientName || "Paciente",
        appointmentTitle,
        appointmentDateISO,
        location: location || null,
        severity: "medium",
        read: false,
        createdAt: serverTimestamp(),
      });

      return true;
    });

    const results = await Promise.all(notificationPromises);
    const notifiedCount = results.filter(Boolean).length;

    return { success: true, notifiedCount };
  } catch (error: any) {
    return { success: false, notifiedCount: 0, error: error?.message };
  }
}

/**
 *  Notificar a los cuidadores sobre incumplimiento de medicación/hábito
 */
export async function notifyCaregiversAboutNoncompliance(params: {
  patientUid: string;
  patientName?: string;
  medicationName: string;
  snoozeCount: number;
  type: "med" | "habit";
}): Promise<NotifyResult> {
  try {
    const { patientUid, patientName, medicationName, snoozeCount, type } =
      params;

    // 🔍 Buscar cuidadores activos del paciente
    const careNetworkRef = collection(db, "users", patientUid, "careNetwork");
    const q = query(
      careNetworkRef,
      where("status", "==", "accepted"),
      where("deleted", "==", false)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return { success: true, notifiedCount: 0 };
    }

    // Crear notificación para cada cuidador
    const notificationPromises = snapshot.docs.map(async (docSnap) => {
      const caregiverData = docSnap.data() as any;
      const caregiverUid = caregiverData.caregiverUid;

      // Solo notificar si el modo de acceso permite alertas
      const accessMode = caregiverData.accessMode || "alerts-only";
      if (accessMode === "disabled") {
        return false;
      }

      if (!caregiverUid) {
        return false;
      }

      // Crear notificación en la subcolección del cuidador
      const notificationsRef = collection(
        db,
        "users",
        caregiverUid,
        "notifications"
      );

      const patientDisplay = patientName || "Un paciente";

      await addDoc(notificationsRef, {
        type: "noncompliance",
        title: `⚠️ Incumplimiento detectado`,
        message: `${patientDisplay} ha pospuesto "${medicationName}" ${snoozeCount} veces`,
        patientUid: patientUid,
        patientName: patientName || "Paciente",
        itemType: type,
        itemName: medicationName,
        snoozeCount: snoozeCount,
        severity: "high",
        read: false,
        createdAt: serverTimestamp(),
      });

      return true;
    });

    const results = await Promise.all(notificationPromises);
    const notifiedCount = results.filter(Boolean).length;

    return { success: true, notifiedCount };
  } catch (error: any) {
    return { success: false, notifiedCount: 0, error: error?.message };
  }
}

/**
 * Notificar a los cuidadores cuando el paciente DESCARTA una alarma
 */
export async function notifyCaregiversAboutDismissal(params: {
  patientUid: string;
  patientName?: string;
  itemName: string;
  itemType: "med" | "habit";
  snoozeCountBeforeDismiss: number;
}): Promise<NotifyResult> {
  try {
    const {
      patientUid,
      patientName,
      itemName,
      itemType,
      snoozeCountBeforeDismiss,
    } = params;

    //  Buscar cuidadores activos del paciente
    const careNetworkRef = collection(db, "users", patientUid, "careNetwork");
    const q = query(
      careNetworkRef,
      where("status", "==", "accepted"),
      where("deleted", "==", false)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return { success: true, notifiedCount: 0 };
    }

    // Crear notificación para cada cuidador
    const notificationPromises = snapshot.docs.map(async (docSnap) => {
      const caregiverData = docSnap.data() as any;
      const caregiverUid = caregiverData.caregiverUid;

      // Solo notificar si el modo de acceso permite alertas
      const accessMode = caregiverData.accessMode || "alerts-only";
      if (accessMode === "disabled") {
        return false;
      }

      if (!caregiverUid) {
        return false;
      }

      // Crear notificación en la subcolección del cuidador
      const notificationsRef = collection(
        db,
        "users",
        caregiverUid,
        "notifications"
      );

      const itemTypeLabel = itemType === "med" ? "medicamento" : "hábito";
      const patientDisplay = patientName || "Un paciente";

      const severity =
        snoozeCountBeforeDismiss > 0
          ? "high"
          : snoozeCountBeforeDismiss === 0
          ? "medium"
          : "medium";

      let messageText = `${patientDisplay} ha descartado el ${itemTypeLabel} "${itemName}"`;
      if (snoozeCountBeforeDismiss > 0) {
        messageText += ` después de posponerlo ${snoozeCountBeforeDismiss} ${
          snoozeCountBeforeDismiss === 1 ? "vez" : "veces"
        }`;
      }
      messageText += " sin completarlo.";

      await addDoc(notificationsRef, {
        type: "dismissal",
        title: `🚫 ${
          itemTypeLabel === "medicamento" ? "Medicamento" : "Hábito"
        } descartado`,
        message: messageText,
        patientUid: patientUid,
        patientName: patientName || "Paciente",
        itemType: itemType,
        itemName: itemName,
        snoozeCountBeforeDismiss: snoozeCountBeforeDismiss,
        severity: severity,
        read: false,
        createdAt: serverTimestamp(),
      });

      return true;
    });

    const results = await Promise.all(notificationPromises);
    const notifiedCount = results.filter(Boolean).length;

    return { success: true, notifiedCount };
  } catch (error: any) {
    return { success: false, notifiedCount: 0, error: error?.message };
  }
}

/**
 * Registrar evento de posposición en Firestore
 */
export async function logSnoozeEvent(params: {
  patientUid: string;
  itemId: string;
  itemName: string;
  itemType: "med" | "habit";
  snoozeMinutes: number;
  snoozeCount: number;
}): Promise<void> {
  try {
    const {
      patientUid,
      itemId,
      itemName,
      itemType,
      snoozeMinutes,
      snoozeCount,
    } = params;

    const eventsRef = collection(db, "users", patientUid, "complianceEvents");

    await addDoc(eventsRef, {
      eventType: "snooze",
      itemId,
      itemName,
      itemType,
      snoozeMinutes,
      snoozeCount,
      timestamp: serverTimestamp(),
    });
  } catch (error) {}
}

/**
 *  Registrar evento de descarte en Firestore
 */
export async function logDismissalEvent(params: {
  patientUid: string;
  itemId: string;
  itemName: string;
  itemType: "med" | "habit";
  snoozeCountBeforeDismiss: number;
}): Promise<void> {
  try {
    const { patientUid, itemId, itemName, itemType, snoozeCountBeforeDismiss } =
      params;

    const eventsRef = collection(db, "users", patientUid, "complianceEvents");

    await addDoc(eventsRef, {
      eventType: "dismissal",
      itemId,
      itemName,
      itemType,
      snoozeCountBeforeDismiss,
      timestamp: serverTimestamp(),
    });
  } catch (error) {}
}

/**
 *  Registrar cumplimiento exitoso
 */
export async function logComplianceSuccess(params: {
  patientUid: string;
  itemId: string;
  itemName: string;
  itemType: "med" | "habit";
  afterSnoozes?: number;
}): Promise<void> {
  try {
    const { patientUid, itemId, itemName, itemType, afterSnoozes } = params;

    const eventsRef = collection(db, "users", patientUid, "complianceEvents");

    await addDoc(eventsRef, {
      eventType: "completed",
      itemId,
      itemName,
      itemType,
      afterSnoozes: afterSnoozes || 0,
      timestamp: serverTimestamp(),
    });
  } catch (error) {}
}



export function getSeverityColor(severity: NotificationSeverity): string {
  const colors: Record<NotificationSeverity, string> = {
    high: "#D32F2F",
    medium: "#FFA726",
    low: "#66BB6A",
  };
  return colors[severity] || "#777777";
}


export function formatNotificationDate(timestamp: any): string {
  if (!timestamp) return "";

  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Ahora mismo";
    if (diffMins < 60) return `Hace ${diffMins} min`;
    if (diffMins < 1440) return `Hace ${Math.floor(diffMins / 60)} h`;

    return date.toLocaleDateString("es-MX", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}


export function getUnreadCount(notifications: CareNotification[]): number {
  return notifications.filter((n) => !n.read).length;
}

export function filterBySeverity(
  notifications: CareNotification[],
  severity: NotificationSeverity
): CareNotification[] {
  return notifications.filter((n) => n.severity === severity);
}


export function filterByPatient(
  notifications: CareNotification[],
  patientUid: string
): CareNotification[] {
  return notifications.filter((n) => n.patientUid === patientUid);
}


export function groupByPatient(
  notifications: CareNotification[]
): Record<string, CareNotification[]> {
  return notifications.reduce((acc, notif) => {
    const key = notif.patientUid;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(notif);
    return acc;
  }, {} as Record<string, CareNotification[]>);
}
