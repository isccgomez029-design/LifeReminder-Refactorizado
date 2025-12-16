// src/services/notificationsService.ts
// 🔔 SERVICIO UNIFICADO DE NOTIFICACIONES
// Combina: Notificaciones locales (expo) + Notificaciones Firestore (cuidadores)

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
  itemType: "med" | "habit";
  itemName: string;
  snoozeCount: number;
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
 *         📱 SECCIÓN 1: NOTIFICACIONES LOCALES (DEVICE)
 *         Usa expo-notifications para push local
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
 * 📱 Pide permisos y configura canal (Android)
 */
export async function configureNotificationPermissions(): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();

  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    if (req.status !== "granted") {
      console.log("⚠️ Permisos de notificaciones no otorgados");
      return;
    }
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "general",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  console.log("✅ Permisos de notificaciones configurados");
}

/**
 * 📱 Notificación inmediata local
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
      trigger: null, // inmediata
    });
    console.log(`📱 Notificación local enviada: ${title}`);
  } catch (error) {
    console.error("Error enviando notificación inmediata:", error);
  }
}

/**
 * 📱 Recordatorio 24h antes de una cita
 */
export async function scheduleAppointmentReminder(
  dateISO: string, // "2025-11-25"
  time: string | undefined, // "14:30" o undefined
  title: string // texto de la cita (doctor o motivo)
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
      trigger: reminderDate as any,
    });

    console.log(
      `📅 Recordatorio de cita programado para: ${reminderDate.toISOString()}`
    );
  } catch (err) {
    console.error("Error programando recordatorio de cita:", err);
  }
}

/* ============================================================
 *      🌐 SECCIÓN 2: NOTIFICACIONES FIRESTORE (LECTURA)
 *      Para que cuidadores vean alertas de pacientes
 * ============================================================ */

/**
 * 🌐 Escucha notificaciones del cuidador en tiempo real
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
      const list: CareNotification[] = snapshot.docs.map((doc) => {
        const data = doc.data() as any;
        return {
          id: doc.id,
          type: data.type || "noncompliance",
          title: data.title || "Notificación",
          message: data.message || "",
          patientUid: data.patientUid || "",
          patientName: data.patientName || "Paciente",
          itemType: data.itemType || "med",
          itemName: data.itemName || "",
          snoozeCount: data.snoozeCount || 0,
          severity: data.severity || "medium",
          read: !!data.read,
          createdAt: data.createdAt,
        };
      });

      onData(list);
    },
    (error) => {
      console.error("Error cargando notificaciones:", error);
      onError?.(error);
    }
  );
}

/**
 * 🌐 Marca una notificación como leída
 */
export async function markNotificationAsRead(
  userId: string,
  notificationId: string
): Promise<void> {
  try {
    const notifRef = doc(db, "users", userId, "notifications", notificationId);
    await updateDoc(notifRef, { read: true });
    console.log(`✅ Notificación ${notificationId} marcada como leída`);
  } catch (error) {
    console.error("Error marcando notificación como leída:", error);
    throw error;
  }
}

/**
 * 🌐 Marca múltiples notificaciones como leídas
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
    console.log(
      `✅ ${notificationIds.length} notificaciones marcadas como leídas`
    );
  } catch (error) {
    console.error("Error marcando múltiples notificaciones:", error);
    throw error;
  }
}

/* ============================================================
 *      🌐 SECCIÓN 3: NOTIFICACIONES FIRESTORE (ESCRITURA)
 *      Para que pacientes notifiquen a cuidadores
 * ============================================================ */

/**
 * 🌐 Notificar a los cuidadores sobre incumplimiento de medicación/hábito
 * Se llama cuando el paciente pospone 3+ veces
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
      console.log("⚠️ No hay cuidadores activos para notificar");
      return { success: true, notifiedCount: 0 };
    }

    // 🔨 Crear notificación para cada cuidador
    const notificationPromises = snapshot.docs.map(async (doc) => {
      const caregiverData = doc.data();
      const caregiverUid = caregiverData.caregiverUid;

      // Solo notificar si el modo de acceso permite alertas
      const accessMode = caregiverData.accessMode || "alerts-only";
      if (accessMode === "disabled") {
        console.log(
          `⏭️ Cuidador ${doc.id} tiene acceso desactivado, omitiendo`
        );
        return false;
      }

      if (!caregiverUid) {
        console.log("⚠️ Cuidador sin UID:", doc.id);
        return false;
      }

      // Crear notificación en la subcolección del cuidador
      const notificationsRef = collection(
        db,
        "users",
        caregiverUid,
        "notifications"
      );

      const itemType = type === "med" ? "medicamento" : "hábito";
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

      console.log(
        `✅ Notificación de incumplimiento enviada a cuidador ${caregiverUid}`
      );
      return true;
    });

    const results = await Promise.all(notificationPromises);
    const notifiedCount = results.filter(Boolean).length;

    console.log(`✅ Notificadas ${notifiedCount} personas de la red de apoyo`);
    return { success: true, notifiedCount };
  } catch (error: any) {
    console.error("❌ Error notificando a cuidadores:", error);
    return { success: false, notifiedCount: 0, error: error?.message };
  }
}

/**
 * 🌐 Notificar a los cuidadores cuando el paciente DESCARTA una alarma
 * sin tomar el medicamento o completar el hábito
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

    // 🔍 Buscar cuidadores activos del paciente
    const careNetworkRef = collection(db, "users", patientUid, "careNetwork");
    const q = query(
      careNetworkRef,
      where("status", "==", "accepted"),
      where("deleted", "==", false)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      console.log("⚠️ No hay cuidadores activos para notificar el descarte");
      return { success: true, notifiedCount: 0 };
    }

    // 🔨 Crear notificación para cada cuidador
    const notificationPromises = snapshot.docs.map(async (doc) => {
      const caregiverData = doc.data();
      const caregiverUid = caregiverData.caregiverUid;

      // Solo notificar si el modo de acceso permite alertas
      const accessMode = caregiverData.accessMode || "alerts-only";
      if (accessMode === "disabled") {
        console.log(
          `⏭️ Cuidador ${doc.id} tiene acceso desactivado, omitiendo`
        );
        return false;
      }

      if (!caregiverUid) {
        console.log("⚠️ Cuidador sin UID:", doc.id);
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

      // Determinar severidad basada en si pospuso antes
      const severity =
        snoozeCountBeforeDismiss > 0
          ? "high"
          : snoozeCountBeforeDismiss === 0
          ? "medium"
          : "medium";

      // Mensaje más descriptivo
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

      console.log(
        `✅ Notificación de descarte enviada a cuidador ${caregiverUid} sobre ${itemName}`
      );
      return true;
    });

    const results = await Promise.all(notificationPromises);
    const notifiedCount = results.filter(Boolean).length;

    console.log(
      `✅ Descarte notificado a ${notifiedCount} personas de la red de apoyo`
    );
    return { success: true, notifiedCount };
  } catch (error: any) {
    console.error("❌ Error notificando descarte a cuidadores:", error);
    return { success: false, notifiedCount: 0, error: error?.message };
  }
}

/**
 * 🌐 Registrar evento de posposición en Firestore
 * (Útil para historial y análisis)
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

    console.log(
      `📊 Evento de posposición registrado: ${itemName} (${snoozeCount}x)`
    );
  } catch (error) {
    console.error("❌ Error registrando evento de posposición:", error);
  }
}

/**
 * 🌐 Registrar evento de descarte en Firestore
 * (Para historial y análisis de adherencia)
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

    console.log(`📊 Evento de descarte registrado: ${itemName}`);
  } catch (error) {
    console.error("❌ Error registrando evento de descarte:", error);
  }
}

/**
 * 🌐 Registrar cumplimiento exitoso
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

    console.log(`✅ Cumplimiento registrado: ${itemName}`);
  } catch (error) {
    console.error("❌ Error registrando cumplimiento:", error);
  }
}

/* ============================================================
 *              🛠️ SECCIÓN 4: UTILIDADES Y HELPERS
 * ============================================================ */

/**
 * Obtiene el color según la severidad
 */
export function getSeverityColor(severity: NotificationSeverity): string {
  const colors: Record<NotificationSeverity, string> = {
    high: "#D32F2F",
    medium: "#FFA726",
    low: "#66BB6A",
  };
  return colors[severity] || "#777777";
}

/**
 * Formatea timestamp a texto legible (relativo o absoluto)
 */
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

/**
 * Cuenta notificaciones no leídas
 */
export function getUnreadCount(notifications: CareNotification[]): number {
  return notifications.filter((n) => !n.read).length;
}

/**
 * Filtra notificaciones por severidad
 */
export function filterBySeverity(
  notifications: CareNotification[],
  severity: NotificationSeverity
): CareNotification[] {
  return notifications.filter((n) => n.severity === severity);
}

/**
 * Filtra notificaciones por paciente
 */
export function filterByPatient(
  notifications: CareNotification[],
  patientUid: string
): CareNotification[] {
  return notifications.filter((n) => n.patientUid === patientUid);
}

/**
 * Agrupa notificaciones por paciente
 */
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
