// src/services/alarms/medsAlarmsService.ts
// 🔔 Dominio de alarmas para medicamentos (offline-first)
// - Pantallas NO deben hablar con OfflineAlarmService directamente.
// - Este servicio coordina: OfflineAlarmService + SyncQueueService + alarmValidator.

import { offlineAlarmService } from "../offline/OfflineAlarmService";
import { syncQueueService } from "../offline/SyncQueueService";
import { shouldShowAlarm } from "../alarmValidator";

export type MedAlarmInput = {
  id: string;
  nombre: string;
  dosis?: string;
  imageUri?: string;
  frecuencia?: string;
  cantidadActual?: number;
  cantidadPorToma?: number;
  proximaToma?: string;
  nextDueAt?: Date | null;
  currentAlarmId?: string | null;
  snoozeCount?: number;
  snoozedUntil?: Date | null;
  lastSnoozeAt?: Date | null;
};

function formatHHmm(date: Date) {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toIso(date: Date) {
  return date.toISOString();
}

/**
 * Cancela la alarma actual de un med si existe.
 * (No toca cola/cache, solo cancela expo + metadata)
 */
export async function cancelCurrentMedAlarm(
  med: Pick<MedAlarmInput, "currentAlarmId">
) {
  if (!med.currentAlarmId) return;
  await offlineAlarmService.cancelAlarm(med.currentAlarmId);
}

/**
 * Cancela TODAS las alarmas asociadas al item (medId + ownerUid)
 * Útil cuando quieres garantizar "no duplicar alarmas".
 */
export async function cancelAllMedAlarmsForItem(params: {
  ownerUid: string;
  medId: string;
}) {
  await offlineAlarmService.cancelAllAlarmsForItem(
    params.medId,
    params.ownerUid
  );
}

/**
 * Programa alarma para un medicamento y (opcionalmente) persiste:
 * - currentAlarmId / nextDueAt / proximaToma / snooze... en cache
 * - enqueue UPDATE para Firestore
 *
 * IMPORTANTE:
 * - No calcula inventario ni nextDueAt; recibe triggerDate ya calculada.
 *
 * ✅ NUEVO:
 * - persist?: false => SOLO programa la alarma y devuelve patch, sin cache/cola.
 *   (Útil cuando la pantalla quiere hacer 1 solo UPDATE combinado)
 */
export async function scheduleMedAlarmAndPersist(params: {
  ownerUid: string;
  med: MedAlarmInput;
  triggerDate: Date;
  patientName?: string;
  // si es una alarma pospuesta
  snoozeCount?: number;
  // si quieres forzar un "patch" adicional (ej: lowStock flags ya calculados)
  extraPatch?: Record<string, any>;
  // ✅ si false, NO hace updateItemInCache / enqueue
  persist?: boolean;
}): Promise<{ alarmId: string | null; patch: Record<string, any> }> {
  const { ownerUid, med, triggerDate } = params;
  const persist = params.persist !== false;

  // Guardrail (offline-first): si el item está archivado o inválido, no programar
  const validation = await shouldShowAlarm({
    type: "med",
    medId: med.id,
    ownerUid,
  });

  if (!validation.shouldShow) {
    // si está archivado, por seguridad cancelar cualquier huérfana
    await offlineAlarmService.cancelAllAlarmsForItem(med.id, ownerUid);
    return { alarmId: null, patch: {} };
  }

  // ✅ Evitar duplicados: cancela alarmas previas del item (incluye currentAlarmId + huérfanas)
  await offlineAlarmService.cancelAllAlarmsForItem(med.id, ownerUid);

  const result = await offlineAlarmService.scheduleMedicationAlarm(
    triggerDate,
    {
      nombre: med.nombre,
      dosis: med.dosis,
      imageUri: med.imageUri,
      medId: med.id,
      ownerUid,
      frecuencia: med.frecuencia,
      cantidadActual: med.cantidadActual,
      cantidadPorToma: med.cantidadPorToma,
      patientName: params.patientName,
      snoozeCount: params.snoozeCount ?? 0,
    }
  );

  if (!result.success || !result.notificationId) {
    return { alarmId: null, patch: {} };
  }

  const alarmId = result.notificationId;

  const patch: Record<string, any> = {
    currentAlarmId: alarmId,
    nextDueAt: toIso(triggerDate),
    proximaToma: formatHHmm(triggerDate),
    snoozeCount: params.snoozeCount ?? 0,
    snoozedUntil: null,
    lastSnoozeAt: null,
    ...(params.extraPatch || {}),
  };

  if (persist) {
    // ✅ Cache local inmediato
    await syncQueueService.updateItemInCache(
      "medications",
      ownerUid,
      med.id,
      patch
    );

    // ✅ Encolar sync
    await syncQueueService.enqueue(
      "UPDATE",
      "medications",
      med.id,
      ownerUid,
      patch
    );
  }

  return { alarmId, patch };
}

/**
 * Reprograma una alarma tipo snooze:
 * - Cancela alarmas del item
 * - Programa nueva en now + minutes
 * - (opcionalmente) persiste patch (cache + cola)
 *
 * ✅ NUEVO:
 * - persist?: false => SOLO programa y devuelve patch
 */
export async function rescheduleMedSnoozeAndPersist(params: {
  ownerUid: string;
  med: MedAlarmInput;
  minutes: number;
  patientName?: string;
  persist?: boolean;
}): Promise<{
  alarmId: string | null;
  nextDueAt: Date | null;
  patch: Record<string, any>;
}> {
  const { ownerUid, med, minutes } = params;
  const persist = params.persist !== false;

  const newDueAt = new Date(Date.now() + minutes * 60000);

  const validation = await shouldShowAlarm({
    type: "med",
    medId: med.id,
    ownerUid,
  });

  if (!validation.shouldShow) {
    await offlineAlarmService.cancelAllAlarmsForItem(med.id, ownerUid);
    return { alarmId: null, nextDueAt: null, patch: {} };
  }

  // Evitar duplicados
  await offlineAlarmService.cancelAllAlarmsForItem(med.id, ownerUid);

  const result = await offlineAlarmService.scheduleMedicationAlarm(newDueAt, {
    nombre: med.nombre,
    dosis: med.dosis,
    imageUri: med.imageUri,
    medId: med.id,
    ownerUid,
    frecuencia: med.frecuencia,
    cantidadActual: med.cantidadActual,
    cantidadPorToma: med.cantidadPorToma,
    patientName: params.patientName,
    snoozeCount: 0,
  });

  if (!result.success || !result.notificationId) {
    return { alarmId: null, nextDueAt: null, patch: {} };
  }

  const alarmId = result.notificationId;

  const patch: Record<string, any> = {
    nextDueAt: toIso(newDueAt),
    proximaToma: formatHHmm(newDueAt),
    currentAlarmId: alarmId,
    snoozeCount: 0,
    snoozedUntil: null,
    lastSnoozeAt: null,
  };

  if (persist) {
    await syncQueueService.updateItemInCache(
      "medications",
      ownerUid,
      med.id,
      patch
    );
    await syncQueueService.enqueue(
      "UPDATE",
      "medications",
      med.id,
      ownerUid,
      patch
    );
  }

  return { alarmId, nextDueAt: newDueAt, patch };
}

/**
 * Reconciliación post-sync:
 * Si hay meds con nextDueAt futura pero sin currentAlarmId, reprograma.
 *
 * Importante:
 * - SOLO reprograma si nextDueAt es futura
 * - Usa cancelAllAlarmsForItem para no duplicar si quedó algo huérfano
 * - Persiste currentAlarmId en cache + cola
 *
 * ✅ NUEVO:
 * - persist?: false => reprograma alarmas, pero NO escribe cache/cola (solo conteo)
 */
export async function reconcileMissingMedAlarmsAndPersist(params: {
  ownerUid: string;
  meds: MedAlarmInput[];
  patientName?: string;
  persist?: boolean;
}): Promise<{ reprogrammed: number; skipped: number; errors: number }> {
  const { ownerUid, meds, patientName } = params;
  const persist = params.persist !== false;
  const now = new Date();

  let reprogrammed = 0;
  let skipped = 0;
  let errors = 0;

  for (const med of meds) {
    try {
      const due = med.nextDueAt ?? null;

      // Solo si tiene próxima toma futura y no tiene alarma asociada
      if (!due || due <= now || med.currentAlarmId) {
        skipped++;
        continue;
      }

      const validation = await shouldShowAlarm({
        type: "med",
        medId: med.id,
        ownerUid,
      });

      if (!validation.shouldShow) {
        skipped++;
        continue;
      }

      // Evitar duplicados
      await offlineAlarmService.cancelAllAlarmsForItem(med.id, ownerUid);

      const result = await offlineAlarmService.scheduleMedicationAlarm(due, {
        nombre: med.nombre,
        dosis: med.dosis,
        imageUri: med.imageUri,
        medId: med.id,
        ownerUid,
        frecuencia: med.frecuencia,
        cantidadActual: med.cantidadActual,
        cantidadPorToma: med.cantidadPorToma,
        patientName,
        snoozeCount: 0,
      });

      if (!result.success || !result.notificationId) {
        errors++;
        continue;
      }

      if (persist) {
        const patch = { currentAlarmId: result.notificationId };
        await syncQueueService.updateItemInCache(
          "medications",
          ownerUid,
          med.id,
          patch
        );
        await syncQueueService.enqueue(
          "UPDATE",
          "medications",
          med.id,
          ownerUid,
          patch
        );
      }

      reprogrammed++;
    } catch (e) {
      errors++;
    }
  }

  return { reprogrammed, skipped, errors };
}

export default {
  cancelCurrentMedAlarm,
  cancelAllMedAlarmsForItem,
  scheduleMedAlarmAndPersist,
  rescheduleMedSnoozeAndPersist,
  reconcileMissingMedAlarmsAndPersist,
};
