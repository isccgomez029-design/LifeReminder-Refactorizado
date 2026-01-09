// src/services/settingsService.ts

import AsyncStorage from "@react-native-async-storage/async-storage";

/* ============================================================
 *                        CONSTANTES
 * ============================================================ */

export const SETTINGS_KEY = "@lifereminder/settings";

/* ============================================================
 *                          TIPOS
 * ============================================================ */

export type Settings = {
  notificationsEnabled: boolean;
  vibration: boolean;

  // avisos de inventario
  medLow20: boolean;
  medLow10: boolean;
};

/* ============================================================
 *                    VALORES POR DEFECTO
 * ============================================================ */

const DEFAULT_SETTINGS: Settings = {
  notificationsEnabled: true,
  vibration: true,
  medLow20: true,
  medLow10: true,
};

/* ============================================================
 *                     HELPERS INTERNOS
 * ============================================================ */

function safeParse(json: string | null): Partial<Settings> {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/* ============================================================
 *                    API PÚBLICA DEL SERVICIO
 * ============================================================ */

export async function getSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  const parsed = safeParse(raw);

  return {
    notificationsEnabled:
      typeof parsed.notificationsEnabled === "boolean"
        ? parsed.notificationsEnabled
        : DEFAULT_SETTINGS.notificationsEnabled,

    vibration:
      typeof parsed.vibration === "boolean"
        ? parsed.vibration
        : DEFAULT_SETTINGS.vibration,

    medLow20:
      typeof parsed.medLow20 === "boolean"
        ? parsed.medLow20
        : DEFAULT_SETTINGS.medLow20,

    medLow10:
      typeof parsed.medLow10 === "boolean"
        ? parsed.medLow10
        : DEFAULT_SETTINGS.medLow10,
  };
}

export async function saveSettings(
  partial: Partial<Settings>
): Promise<Settings> {
  const current = await getSettings();
  const merged: Settings = { ...current, ...partial };

  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

/* ============================================================
 *                    GETTERS SEMÁNTICOS
 * ============================================================ */

export async function areNotificationsEnabled(): Promise<boolean> {
  const s = await getSettings();
  return s.notificationsEnabled;
}

export async function isVibrationEnabled(): Promise<boolean> {
  const s = await getSettings();
  return s.vibration;
}

export async function shouldNotifyMedLow20(): Promise<boolean> {
  const s = await getSettings();
  return s.medLow20;
}

export async function shouldNotifyMedLow10(): Promise<boolean> {
  const s = await getSettings();
  return s.medLow10;
}

/* ============================================================
 *                    ACCIONES ESPECIALES
 * ============================================================ */

/**
 *  Apaga notificaciones y borra TODAS las alarmas locales
 *  Se llama cuando el usuario apaga el switch
 */
export async function disableAllNotifications(): Promise<void> {
  const merged = await saveSettings({ notificationsEnabled: false });

  // Import dinámico para evitar ciclos
  const { offlineAlarmService } = await import(
    "../services/offline/OfflineAlarmService"
  );

  await offlineAlarmService.cancelAllAlarms();
}

/**
 *  Reactiva notificaciones (NO reprograma automáticamente)
 * AlarmInitializer se encarga luego
 */
export async function enableNotifications(): Promise<void> {
  await saveSettings({ notificationsEnabled: true });
}

/**
 *  Reset total (debug / logout completo)
 */
export async function resetSettings(): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS));
}
