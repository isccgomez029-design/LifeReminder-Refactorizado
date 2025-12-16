// src/services/offline/OfflineAlarmService.ts
// 🔔 Sistema de alarmas 100% offline-first con persistencia total
// ✅ FIX: usar DATE trigger (hora exacta) en vez de TIME_INTERVAL para evitar fallos/derivas offline
// ✅ FIX: reconcile + persistencia más robusta (no se “cuelga” si Expo falla)
// ✅ FIX: metadata huérfana se limpia y se guarda sin bloquear UI

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { offlineAuthService } from "./OfflineAuthService";

// ============================================================
//                         CONSTANTES
// ============================================================

const ALARMS_STORAGE_KEY = "@lifereminder/alarms"; // compat (no usado aquí)
const ALARM_METADATA_KEY = "@lifereminder/alarm_metadata";

// ============================================================
//                         TIPOS
// ============================================================

export interface AlarmMetadata {
  id: string; // notification ID de Expo
  type: "med" | "habit";
  itemId: string; // medId o habitId
  itemName: string;
  ownerUid: string;
  triggerDate: string; // ISO string (hora objetivo exacta)
  createdAt: string;
  snoozeCount: number;

  // Datos específicos de medicamentos
  dosis?: string;
  imageUri?: string;
  frecuencia?: string;
  cantidadActual?: number;
  cantidadPorToma?: number;

  // Datos específicos de hábitos
  habitIcon?: string;
  habitLib?: "MaterialIcons" | "FontAwesome5";

  // Info del paciente
  patientName?: string;
}

export interface AlarmScheduleResult {
  notificationId: string | null;
  metadata: AlarmMetadata | null;
  success: boolean;
  error?: string;
}

// ============================================================
//                    UTILIDADES INTERNAS
// ============================================================

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const safeToISOString = (d: Date) => {
  try {
    return d.toISOString();
  } catch {
    return new Date().toISOString();
  }
};

const isValidFutureDate = (d: Date) =>
  d instanceof Date && !isNaN(d.getTime()) && d.getTime() > Date.now();

function safeString(v: any, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

// ============================================================
//                    CLASE PRINCIPAL
// ============================================================

class OfflineAlarmService {
  private alarms: Map<string, AlarmMetadata> = new Map();
  private initialized = false;
  private initializing: Promise<void> | null = null;

  // ========================================
  //            INICIALIZACIÓN
  // ========================================

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;

    this.initializing = (async () => {
      try {
        await this.loadAlarmsFromStorage();
        // reconcile NO debe bloquear tu app si algo falla
        await this.reconcileWithExpoNotifications().catch(() => {});
        this.initialized = true;
        console.log("✅ OfflineAlarmService inicializado");
      } catch (error) {
        console.error("❌ Error inicializando OfflineAlarmService:", error);
      } finally {
        this.initializing = null;
      }
    })();

    return this.initializing;
  }

  private async loadAlarmsFromStorage(): Promise<void> {
    try {
      const data = await AsyncStorage.getItem(ALARM_METADATA_KEY);
      if (!data) return;

      const parsed: AlarmMetadata[] = JSON.parse(data);
      this.alarms.clear();
      parsed.forEach((alarm) => {
        if (alarm?.id) this.alarms.set(alarm.id, alarm);
      });

      console.log(`📥 Cargadas ${this.alarms.size} alarmas del storage`);
    } catch (error) {
      console.error("❌ Error cargando alarmas:", error);
    }
  }

  private async saveAlarmsToStorage(): Promise<void> {
    try {
      const data = Array.from(this.alarms.values());
      await AsyncStorage.setItem(ALARM_METADATA_KEY, JSON.stringify(data));
      // log leve (no muy ruidoso)
      // console.log(`💾 Guardadas ${data.length} alarmas en storage`);
    } catch (error) {
      console.error("❌ Error guardando alarmas:", error);
    }
  }

  // Sincronizar con notificaciones de Expo (eliminar metadatos huérfanos)
  private async reconcileWithExpoNotifications(): Promise<void> {
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const scheduledIds = new Set(
        (scheduled || []).map((n) => n?.identifier).filter(Boolean)
      );

      let removedCount = 0;
      for (const [id] of this.alarms.entries()) {
        if (!scheduledIds.has(id)) {
          this.alarms.delete(id);
          removedCount++;
        }
      }

      if (removedCount > 0) {
        await this.saveAlarmsToStorage();
        console.log(`🧹 Eliminados ${removedCount} metadatos huérfanos`);
      }
    } catch (error) {
      console.error("⚠️ Error reconciliando notificaciones:", error);
      // IMPORTANTE: no lanzamos error para no romper flujo offline
    }
  }

  // ============================================================
  //  ✅ NUEVO: Trigger exacto por FECHA
  // ============================================================

  private makeDateTrigger(date: Date): Notifications.DateTriggerInput {
    return {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date,
    };
  }

  /**
   * Fallback por si algún dispositivo se pone difícil con DATE trigger.
   * OJO: solo se usa si DATE falla.
   */
  private makeTimeIntervalTrigger(
    target: Date
  ): Notifications.TimeIntervalTriggerInput {
    const diffMs = target.getTime() - Date.now();
    const seconds = Math.max(1, Math.floor(diffMs / 1000));
    return {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      repeats: false,
    };
  }

  private async scheduleWithDateThenFallback(args: {
    content: Notifications.NotificationContentInput;
    triggerDate: Date;
  }): Promise<string> {
    // 1) intentar DATE (exacto)
    try {
      return await Notifications.scheduleNotificationAsync({
        content: args.content,
        trigger: this.makeDateTrigger(args.triggerDate),
      });
    } catch (e) {
      console.warn("⚠️ DATE trigger falló, usando TIME_INTERVAL fallback");
    }

    // 2) fallback TIME_INTERVAL
    return await Notifications.scheduleNotificationAsync({
      content: args.content,
      trigger: this.makeTimeIntervalTrigger(args.triggerDate),
    });
  }

  // ========================================
  //        PROGRAMAR ALARMA DE MEDICAMENTO
  // ========================================

  async scheduleMedicationAlarm(
    triggerDate: Date,
    medication: {
      nombre: string;
      dosis?: string;
      imageUri?: string;
      medId?: string;
      ownerUid?: string;
      frecuencia?: string;
      cantidadActual?: number;
      cantidadPorToma?: number;
      patientName?: string;
      snoozeCount?: number;
    }
  ): Promise<AlarmScheduleResult> {
    await this.initialize();

    try {
      if (!isValidFutureDate(triggerDate)) {
        console.warn("⚠️ Fecha inválida/pasada, no se programa:", triggerDate);
        return {
          notificationId: null,
          metadata: null,
          success: false,
          error: "Fecha inválida",
        };
      }

      const ownerUid =
        medication.ownerUid || offlineAuthService.getCurrentUid();
      if (!ownerUid) {
        return {
          notificationId: null,
          metadata: null,
          success: false,
          error: "Usuario no autenticado",
        };
      }

      const patientName =
        medication.patientName || (await this.getPatientName(ownerUid));

      const content: Notifications.NotificationContentInput = {
        title: `💊 Hora de tomar ${medication.nombre}`,
        body: medication.dosis
          ? `Dosis: ${medication.dosis}`
          : "Es momento de tu medicamento",
        sound: "default",
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: {
          screen: "Alarm",
          params: {
            type: "med",
            title: medication.nombre,
            message: "Es momento de tomar tu dosis.",
            imageUri: medication.imageUri,
            doseLabel: medication.dosis,
            medId: medication.medId,
            ownerUid,
            frecuencia: medication.frecuencia,
            cantidadActual: medication.cantidadActual,
            cantidadPorToma: medication.cantidadPorToma,
            patientName,
            snoozeCount: medication.snoozeCount || 0,
          },
        },
      };

      const notificationId = await this.scheduleWithDateThenFallback({
        content,
        triggerDate,
      });

      const metadata: AlarmMetadata = {
        id: notificationId,
        type: "med",
        itemId: medication.medId || "unknown",
        itemName: medication.nombre,
        ownerUid,
        triggerDate: safeToISOString(triggerDate),
        createdAt: safeToISOString(new Date()),
        snoozeCount: medication.snoozeCount || 0,
        dosis: medication.dosis,
        imageUri: medication.imageUri,
        frecuencia: medication.frecuencia,
        cantidadActual: medication.cantidadActual,
        cantidadPorToma: medication.cantidadPorToma,
        patientName,
      };

      this.alarms.set(notificationId, metadata);

      // ✅ persistir sin hacer pesada la UI
      await this.saveAlarmsToStorage();
      await sleep(50);

      console.log(
        `✅ Alarma medicamento programada (${notificationId}) para:`,
        triggerDate.toLocaleString()
      );

      return { notificationId, metadata, success: true };
    } catch (error: any) {
      console.error("❌ Error programando alarma medicamento:", error);
      return {
        notificationId: null,
        metadata: null,
        success: false,
        error: error?.message || "Error",
      };
    }
  }

  // ========================================
  //        PROGRAMAR ALARMA DE HÁBITO
  // ========================================

  async scheduleHabitAlarm(
    triggerDate: Date,
    habit: {
      name: string;
      icon?: string;
      lib?: "MaterialIcons" | "FontAwesome5";
      habitId?: string;
      ownerUid?: string;
      patientName?: string;
      snoozeCount?: number;
    }
  ): Promise<AlarmScheduleResult> {
    await this.initialize();

    try {
      if (!isValidFutureDate(triggerDate)) {
        console.warn("⚠️ Fecha inválida/pasada, no se programa:", triggerDate);
        return {
          notificationId: null,
          metadata: null,
          success: false,
          error: "Fecha inválida",
        };
      }

      const ownerUid = habit.ownerUid || offlineAuthService.getCurrentUid();
      if (!ownerUid) {
        return {
          notificationId: null,
          metadata: null,
          success: false,
          error: "Usuario no autenticado",
        };
      }

      const patientName =
        habit.patientName || (await this.getPatientName(ownerUid));

      const content: Notifications.NotificationContentInput = {
        title: `🔔 Recordatorio: ${habit.name}`,
        body: "Es momento de completar tu hábito.",
        sound: "default",
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: {
          screen: "Alarm",
          params: {
            type: "habit",
            title: habit.name,
            message: "Es momento de completar tu hábito.",
            habitIcon: habit.icon || "check-circle",
            habitLib: habit.lib || "MaterialIcons",
            habitId: habit.habitId,
            ownerUid,
            patientName,
            snoozeCount: habit.snoozeCount || 0,
          },
        },
      };

      const notificationId = await this.scheduleWithDateThenFallback({
        content,
        triggerDate,
      });

      const metadata: AlarmMetadata = {
        id: notificationId,
        type: "habit",
        itemId: habit.habitId || "unknown",
        itemName: habit.name,
        ownerUid,
        triggerDate: safeToISOString(triggerDate),
        createdAt: safeToISOString(new Date()),
        snoozeCount: habit.snoozeCount || 0,
        habitIcon: habit.icon,
        habitLib: habit.lib,
        patientName,
      };

      this.alarms.set(notificationId, metadata);
      await this.saveAlarmsToStorage();
      await sleep(50);

      console.log(
        `✅ Alarma hábito programada (${notificationId}) para:`,
        triggerDate.toLocaleString()
      );

      return { notificationId, metadata, success: true };
    } catch (error: any) {
      console.error("❌ Error programando alarma hábito:", error);
      return {
        notificationId: null,
        metadata: null,
        success: false,
        error: error?.message || "Error",
      };
    }
  }

  // ========================================
  //        CANCELAR ALARMAS
  // ========================================

  async cancelAlarm(notificationId: string): Promise<boolean> {
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
    } catch (e) {
      // si falla, igual limpiamos metadata local para no “romper” UI
      console.warn("⚠️ No se pudo cancelar en Expo, limpiando local:", e);
    }

    this.alarms.delete(notificationId);
    await this.saveAlarmsToStorage().catch(() => {});
    console.log(`🗑️ Alarma cancelada (local): ${notificationId}`);
    return true;
  }

  async cancelAllAlarmsForItem(
    itemId: string,
    ownerUid: string
  ): Promise<number> {
    await this.initialize();

    let count = 0;
    const toDelete: string[] = [];

    for (const [id, metadata] of this.alarms.entries()) {
      if (metadata.itemId === itemId && metadata.ownerUid === ownerUid) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      const ok = await this.cancelAlarm(id);
      if (ok) count++;
    }

    console.log(`🗑️ Canceladas ${count} alarmas del item ${itemId}`);
    return count;
  }

  async cancelAllAlarmsForUser(ownerUid: string): Promise<number> {
    await this.initialize();

    let count = 0;
    const toDelete: string[] = [];

    for (const [id, metadata] of this.alarms.entries()) {
      if (metadata.ownerUid === ownerUid) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      const ok = await this.cancelAlarm(id);
      if (ok) count++;
    }

    console.log(`🗑️ Canceladas ${count} alarmas del usuario ${ownerUid}`);
    return count;
  }

  async cancelAllAlarms(): Promise<void> {
    await this.initialize();

    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch (e) {
      console.warn("⚠️ cancelAllScheduledNotificationsAsync falló:", e);
    }

    this.alarms.clear();
    await this.saveAlarmsToStorage().catch(() => {});
    console.log("🗑️ Todas las alarmas canceladas (local)");
  }

  // ========================================
  //        CONSULTAR ALARMAS
  // ========================================

  async getAllAlarms(): Promise<AlarmMetadata[]> {
    await this.initialize();
    return Array.from(this.alarms.values());
  }

  async getAlarmsForItem(
    itemId: string,
    ownerUid: string
  ): Promise<AlarmMetadata[]> {
    await this.initialize();
    return Array.from(this.alarms.values()).filter(
      (alarm) => alarm.itemId === itemId && alarm.ownerUid === ownerUid
    );
  }

  async getAlarmById(notificationId: string): Promise<AlarmMetadata | null> {
    await this.initialize();
    return this.alarms.get(notificationId) || null;
  }

  async getAlarmCount(): Promise<number> {
    await this.initialize();
    return this.alarms.size;
  }

  // ========================================
  //        HELPERS
  // ========================================

  private async getPatientName(userId: string): Promise<string> {
    try {
      const cachedUser = await offlineAuthService.getCachedUser();
      if (cachedUser?.displayName) return cachedUser.displayName;
      if (cachedUser?.email) return cachedUser.email.split("@")[0];
      // fallback “bonito”
      const id = safeString(userId, "");
      return id ? `Paciente` : "Paciente";
    } catch {
      return "Paciente";
    }
  }

  // ========================================
  //        PROGRAMAR SIGUIENTE ALARMA DE MEDICAMENTO
  // ========================================

  async scheduleNextMedicationAlarm(medication: {
    nombre: string;
    dosis?: string;
    imageUri?: string;
    medId?: string;
    ownerUid?: string;
    frecuencia?: string;
    cantidadActual?: number;
    cantidadPorToma?: number;
  }): Promise<AlarmScheduleResult> {
    try {
      if (!medication.frecuencia) {
        console.log("⚠️ Sin frecuencia, no se programa siguiente alarma");
        return {
          notificationId: null,
          metadata: null,
          success: false,
          error: "Sin frecuencia",
        };
      }

      const match = medication.frecuencia.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) {
        console.log(
          "⚠️ Formato de frecuencia inválido:",
          medication.frecuencia
        );
        return {
          notificationId: null,
          metadata: null,
          success: false,
          error: "Formato inválido",
        };
      }

      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const intervalMs = (hours * 60 + minutes) * 60 * 1000;

      if (intervalMs <= 0) {
        return {
          notificationId: null,
          metadata: null,
          success: false,
          error: "Intervalo inválido",
        };
      }

      const nextTrigger = new Date(Date.now() + intervalMs);

      return await this.scheduleMedicationAlarm(nextTrigger, {
        ...medication,
        snoozeCount: 0,
      });
    } catch (error: any) {
      console.error("❌ Error programando siguiente alarma:", error);
      return {
        notificationId: null,
        metadata: null,
        success: false,
        error: error?.message || "Error",
      };
    }
  }

  // ========================================
  //        LIMPIEZA DE ALARMAS VENCIDAS
  // ========================================

  async cleanupExpiredAlarms(): Promise<number> {
    await this.initialize();

    const now = new Date();
    let count = 0;
    const toDelete: string[] = [];

    for (const [id, metadata] of this.alarms.entries()) {
      const triggerDate = new Date(metadata.triggerDate);
      // Si debió dispararse hace más de 1 hora, limpiarla
      if (
        isNaN(triggerDate.getTime()) ||
        triggerDate.getTime() < now.getTime() - 60 * 60 * 1000
      ) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.alarms.delete(id);
      count++;
    }

    if (count > 0) {
      await this.saveAlarmsToStorage().catch(() => {});
      console.log(`🧹 Limpiadas ${count} alarmas vencidas`);
    }

    return count;
  }

  // ========================================
  //        DEBUG
  // ========================================

  async debugPrintAllAlarms(): Promise<void> {
    await this.initialize();
    console.log("========================================");
    console.log("DEBUG: TODAS LAS ALARMAS");
    console.log("========================================");
    console.log(`Total: ${this.alarms.size}`);
    for (const [id, metadata] of this.alarms.entries()) {
      console.log(`ID: ${id}`);
      console.log(`  Tipo: ${metadata.type}`);
      console.log(`  Item: ${metadata.itemName} (${metadata.itemId})`);
      console.log(`  Usuario: ${metadata.ownerUid}`);
      console.log(`  Trigger: ${metadata.triggerDate}`);
      console.log(`  Snooze: ${metadata.snoozeCount}`);
      console.log("---");
    }
    console.log("========================================");
  }

  async reprogramMissingAlarms(
    medications: Array<{
      id: string;
      nombre: string;
      nextDueAt?: Date | null;
      currentAlarmId?: string | null;
      dosis?: string;
      imageUri?: string;
      ownerUid?: string;
      frecuencia?: string;
      cantidadActual?: number;
      cantidadPorToma?: number;
    }>,
    ownerUid: string
  ): Promise<{ reprogrammed: number; errors: number }> {
    await this.initialize();

    let reprogrammed = 0;
    let errors = 0;
    const now = new Date();

    for (const med of medications) {
      if (med.nextDueAt && med.nextDueAt > now && !med.currentAlarmId) {
        try {
          console.log(`🔔 Reprogramando alarma para ${med.nombre}...`);

          const result = await this.scheduleMedicationAlarm(med.nextDueAt, {
            nombre: med.nombre,
            dosis: med.dosis,
            imageUri: med.imageUri,
            medId: med.id,
            ownerUid: ownerUid,
            frecuencia: med.frecuencia,
            cantidadActual: med.cantidadActual,
            cantidadPorToma: med.cantidadPorToma,
            snoozeCount: 0,
          });

          if (result.success) {
            reprogrammed++;
            console.log(`✅ Alarma reprogramada: ${result.notificationId}`);
          } else {
            errors++;
          }
        } catch (err) {
          console.error(`❌ Error reprogramando ${med.nombre}:`, err);
          errors++;
        }
      }
    }

    console.log(
      `🔔 Reprogramación completa: ${reprogrammed} ok, ${errors} errores`
    );
    return { reprogrammed, errors };
  }
}

// ============================================================
//                    INSTANCIA SINGLETON
// ============================================================

export const offlineAlarmService = new OfflineAlarmService();
export default offlineAlarmService;
