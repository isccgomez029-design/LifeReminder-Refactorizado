// src/services/offline/OfflineAlarmService.ts

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { offlineAuthService } from "./OfflineAuthService";

import {
  areNotificationsEnabled,
  isVibrationEnabled,
} from "../settingsService";

const ALARMS_STORAGE_KEY = "@lifereminder/alarms";
const ALARM_METADATA_KEY = "@lifereminder/alarm_metadata";

export interface AlarmMetadata {
  id: string;
  type: "med" | "habit";
  itemId: string;
  itemName: string;
  ownerUid: string;
  triggerDate: string;
  createdAt: string;
  snoozeCount: number;

  dosis?: string;
  imageUri?: string;
  frecuencia?: string;
  cantidadActual?: number;
  cantidadPorToma?: number;

  habitIcon?: string;
  habitLib?: "MaterialIcons" | "FontAwesome5";
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
        await this.reconcileWithExpoNotifications().catch(() => {});
        this.initialized = true;
      } catch {
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
    } catch {}
  }

  private async saveAlarmsToStorage(): Promise<void> {
    try {
      const data = Array.from(this.alarms.values());
      await AsyncStorage.setItem(ALARM_METADATA_KEY, JSON.stringify(data));
    } catch {}
  }

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
      }
    } catch {}
  }

  // ============================================================
  //  Trigger exacto por FECHA
  // ============================================================

  private makeDateTrigger(date: Date): Notifications.DateTriggerInput {
    return {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date,
    };
  }

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
    try {
      return await Notifications.scheduleNotificationAsync({
        content: args.content,
        trigger: this.makeDateTrigger(args.triggerDate),
      });
    } catch {}

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

    // SETTINGS: bloquear si están apagadas
    if (!(await areNotificationsEnabled())) {
      return {
        notificationId: null,
        metadata: null,
        success: false,
        error: "notifications-disabled",
      };
    }

    try {
      if (!isValidFutureDate(triggerDate)) {
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

      //  SETTINGS: vibración
      const vibrate = await isVibrationEnabled();

      const content: Notifications.NotificationContentInput = {
        title: `💊 Hora de tomar ${medication.nombre}`,
        body: medication.dosis
          ? `Dosis: ${medication.dosis}`
          : "Es momento de tu medicamento",
        sound: "default",
        vibrate: vibrate ? [0, 250, 250, 250] : undefined,
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
      await this.saveAlarmsToStorage();
      await sleep(50);

      return { notificationId, metadata, success: true };
    } catch (error: any) {
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

    //  SETTINGS
    if (!(await areNotificationsEnabled())) {
      return {
        notificationId: null,
        metadata: null,
        success: false,
        error: "notifications-disabled",
      };
    }

    try {
      if (!isValidFutureDate(triggerDate)) {
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

      const vibrate = await isVibrationEnabled();

      const content: Notifications.NotificationContentInput = {
        title: `🔔 Recordatorio: ${habit.name}`,
        body: "Es momento de completar tu hábito.",
        sound: "default",
        vibrate: vibrate ? [0, 250, 250, 250] : undefined,
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

      return { notificationId, metadata, success: true };
    } catch (error: any) {
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
    } catch {}

    this.alarms.delete(notificationId);
    await this.saveAlarmsToStorage().catch(() => {});
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
      if (await this.cancelAlarm(id)) count++;
    }

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
      if (await this.cancelAlarm(id)) count++;
    }

    return count;
  }

  async cancelAllAlarms(): Promise<void> {
    await this.initialize();
    await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
    this.alarms.clear();
    await this.saveAlarmsToStorage().catch(() => {});
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

  // HELPERS

  private async getPatientName(userId: string): Promise<string> {
    try {
      const cachedUser = await offlineAuthService.getCachedUser();
      if (cachedUser?.displayName) return cachedUser.displayName;
      if (cachedUser?.email) return cachedUser.email.split("@")[0];
      return "Paciente";
    } catch {
      return "Paciente";
    }
  }

  // PROGRAMAR SIGUIENTE ALARMA DE MEDICAMENTO

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
        return {
          notificationId: null,
          metadata: null,
          success: false,
          error: "Sin frecuencia",
        };
      }

      const match = medication.frecuencia.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) {
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

      const nextTrigger = new Date(Date.now() + intervalMs);

      return await this.scheduleMedicationAlarm(nextTrigger, {
        ...medication,
        snoozeCount: 0,
      });
    } catch (error: any) {
      return {
        notificationId: null,
        metadata: null,
        success: false,
        error: error?.message || "Error",
      };
    }
  }

  // LIMPIEZA DE ALARMAS VENCIDAS

  async cleanupExpiredAlarms(): Promise<number> {
    await this.initialize();

    const now = new Date();
    let count = 0;
    const toDelete: string[] = [];

    for (const [id, metadata] of this.alarms.entries()) {
      const triggerDate = new Date(metadata.triggerDate);
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
    }

    return count;
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
          const result = await this.scheduleMedicationAlarm(med.nextDueAt, {
            nombre: med.nombre,
            dosis: med.dosis,
            imageUri: med.imageUri,
            medId: med.id,
            ownerUid,
            frecuencia: med.frecuencia,
            cantidadActual: med.cantidadActual,
            cantidadPorToma: med.cantidadPorToma,
            snoozeCount: 0,
          });

          result.success ? reprogrammed++ : errors++;
        } catch {
          errors++;
        }
      }
    }

    return { reprogrammed, errors };
  }
}

export const offlineAlarmService = new OfflineAlarmService();
export default offlineAlarmService;
