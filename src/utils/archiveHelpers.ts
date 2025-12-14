// src/utils/archiveHelpers.ts
// ✅ CORREGIDO: Actualiza cache inmediatamente antes de encolar
// ==========================================================

import { syncQueueService } from "../services/offline/SyncQueueService";
import { offlineAlarmService } from "../services/offline/OfflineAlarmService";

/* ==========================================================
   🔔 CANCELAR ALARMAS DE UN ITEM
   ========================================================== */

/**
 * Cancela todas las alarmas programadas para un item específico
 * ✅ ACTUALIZADO: Usa offlineAlarmService
 */
async function cancelItemAlarms(
  itemId: string,
  ownerUid: string,
  currentAlarmId?: string | null
): Promise<void> {
  try {
    // 1. Cancelar alarma actual si existe
    if (currentAlarmId) {
      await offlineAlarmService.cancelAlarm(currentAlarmId);
      console.log(`🔕 Alarma cancelada (ID: ${currentAlarmId})`);
    }

    // 2. Cancelar todas las alarmas del item usando el servicio offline
    const canceledCount = await offlineAlarmService.cancelAllAlarmsForItem(
      itemId,
      ownerUid
    );

    if (canceledCount > 0) {
      console.log(`🔕 ${canceledCount} alarmas canceladas para ${itemId}`);
    }

    console.log(`✅ Alarmas de item ${itemId} procesadas`);
  } catch (error) {
    console.log("⚠️ Error cancelando alarmas:", error);
    // No lanzar error - la operación de archivar debe continuar
  }
}

/* ==========================================================
   ARCHIVAR MEDICAMENTO
   ========================================================== */
export async function archiveMedication(
  userId: string,
  medId: string,
  medData?: any
): Promise<void> {
  const now = new Date().toISOString();

  // Obtener datos actuales desde cache
  const currentData = await syncQueueService.getItemFromCache(
    "medications",
    userId,
    medId
  );

  // ✅ CANCELAR ALARMAS ANTES DE ARCHIVAR
  const alarmId = currentData?.currentAlarmId || medData?.currentAlarmId;
  await cancelItemAlarms(medId, userId, alarmId);

  const archiveData = {
    isArchived: true,
    archivedAt: now,
    updatedAt: now,
    // Reiniciar campos de alarma
    currentAlarmId: null,
    snoozeCount: 0,
    snoozedUntil: null,
    lastSnoozeAt: null,
  };

  // ✅ PRIMERO: Actualizar cache local inmediatamente
  await syncQueueService.updateItemInCache(
    "medications",
    userId,
    medId,
    archiveData
  );

  console.log(`💾 Cache actualizado: medicamento ${medId} archivado`);

  // ✅ SEGUNDO: Encolar para sincronización con Firestore
  await syncQueueService.enqueue(
    "UPDATE",
    "medications",
    medId,
    userId,
    archiveData
  );

  console.log(`📦 Medicamento ${medId} archivado y encolado`);
}

/* ==========================================================
   ARCHIVAR HÁBITO
   ========================================================== */
export async function archiveHabit(
  userId: string,
  habitId: string,
  habitData?: any
): Promise<void> {
  const now = new Date().toISOString();

  const currentData = await syncQueueService.getItemFromCache(
    "habits",
    userId,
    habitId
  );

  // ✅ CANCELAR ALARMAS ANTES DE ARCHIVAR
  const alarmId = currentData?.currentAlarmId || habitData?.currentAlarmId;
  await cancelItemAlarms(habitId, userId, alarmId);

  const archiveData = {
    isArchived: true,
    archivedAt: now,
    updatedAt: now,
    // Reiniciar campos de alarma
    currentAlarmId: null,
    scheduledAlarmIds: [],
    snoozeCount: 0,
    snoozedUntil: null,
    lastSnoozeAt: null,
  };

  // ✅ PRIMERO: Actualizar cache local
  await syncQueueService.updateItemInCache(
    "habits",
    userId,
    habitId,
    archiveData
  );

  console.log(`💾 Cache actualizado: hábito ${habitId} archivado`);

  // ✅ SEGUNDO: Encolar para Firestore
  await syncQueueService.enqueue(
    "UPDATE",
    "habits",
    habitId,
    userId,
    archiveData
  );

  console.log(`📦 Hábito ${habitId} archivado y encolado`);
}

/* ==========================================================
   ARCHIVAR CITA
   ========================================================== */
export async function archiveAppointment(
  userId: string,
  appointmentId: string,
  appointmentData?: any
): Promise<void> {
  const now = new Date().toISOString();

  const currentData = await syncQueueService.getItemFromCache(
    "appointments",
    userId,
    appointmentId
  );

  // ✅ CANCELAR RECORDATORIOS DE CITA
  await cancelItemAlarms(appointmentId, userId, null);

  const archiveData = {
    isArchived: true,
    archivedAt: now,
    updatedAt: now,
  };

  // ✅ PRIMERO: Actualizar cache local
  await syncQueueService.updateItemInCache(
    "appointments",
    userId,
    appointmentId,
    archiveData
  );

  console.log(`💾 Cache actualizado: cita ${appointmentId} archivada`);

  // ✅ SEGUNDO: Encolar para Firestore
  await syncQueueService.enqueue(
    "UPDATE",
    "appointments",
    appointmentId,
    userId,
    archiveData
  );

  console.log(`📦 Cita ${appointmentId} archivada y encolada`);
}

/* ==========================================================
   SOFT DELETE GENÉRICO
   ========================================================== */
export async function softDeleteItem(
  collection: "medications" | "habits" | "appointments",
  itemId: string,
  userId: string,
  itemData?: any
): Promise<void> {
  switch (collection) {
    case "medications":
      return archiveMedication(userId, itemId, itemData);
    case "habits":
      return archiveHabit(userId, itemId, itemData);
    case "appointments":
      return archiveAppointment(userId, itemId, itemData);
  }
}

/* ==========================================================
   RESTAURAR ITEM ARCHIVADO
   ========================================================== */
export async function restoreItem(
  collection: "medications" | "habits" | "appointments",
  itemId: string,
  userId: string
): Promise<void> {
  const now = new Date().toISOString();

  const restoreData = {
    isArchived: false,
    archivedAt: null,
    updatedAt: now,
  };

  // ✅ PRIMERO: Actualizar cache local
  await syncQueueService.updateItemInCache(
    collection,
    userId,
    itemId,
    restoreData
  );

  console.log(`💾 Cache actualizado: ${collection} ${itemId} restaurado`);

  // ✅ SEGUNDO: Encolar para Firestore
  await syncQueueService.enqueue(
    "UPDATE",
    collection,
    itemId,
    userId,
    restoreData
  );

  console.log(`♻️ ${collection} ${itemId} restaurado y encolado`);

  // NOTA: Las alarmas NO se reprograman automáticamente al restaurar.
  // El usuario deberá configurarlas de nuevo si es necesario.
}

/* ==========================================================
   ELIMINACIÓN PERMANENTE (hard delete)
   ========================================================== */
export async function hardDeleteItem(
  collection: "medications" | "habits" | "appointments",
  itemId: string,
  userId: string
): Promise<void> {
  // ✅ CANCELAR ALARMAS ANTES DE ELIMINAR
  const currentData = await syncQueueService.getItemFromCache(
    collection,
    userId,
    itemId
  );

  if (currentData?.currentAlarmId) {
    await cancelItemAlarms(itemId, userId, currentData.currentAlarmId);
  } else {
    await cancelItemAlarms(itemId, userId, null);
  }

  // ✅ PRIMERO: Eliminar del cache local
  await syncQueueService.removeItemFromCache(collection, userId, itemId);

  console.log(`💾 Cache actualizado: ${collection} ${itemId} eliminado`);

  // ✅ SEGUNDO: Encolar eliminación para Firestore
  await syncQueueService.enqueue("DELETE", collection, itemId, userId, {});

  console.log(`🗑️ ${collection} ${itemId} eliminado permanentemente`);
}

/* ==========================================================
   🆕 VERIFICAR SI UN ITEM ESTÁ ARCHIVADO
   ========================================================== */
export async function isItemArchived(
  collection: "medications" | "habits" | "appointments",
  itemId: string,
  userId: string
): Promise<boolean> {
  try {
    const itemData = await syncQueueService.getItemFromCache(
      collection,
      userId,
      itemId
    );

    if (!itemData) return false;

    return itemData.isArchived === true || !!itemData.archivedAt;
  } catch (error) {
    console.log("Error verificando estado de archivo:", error);
    return false;
  }
}

/* ==========================================================
   🆕 CANCELAR ALARMA SI ITEM ESTÁ ARCHIVADO
   Útil para verificar antes de mostrar alarma
   ========================================================== */
export async function cancelAlarmIfArchived(
  collection: "medications" | "habits",
  itemId: string,
  userId: string,
  alarmId?: string
): Promise<boolean> {
  try {
    const isArchived = await isItemArchived(collection, itemId, userId);

    if (isArchived) {
      console.log(`⚠️ Item ${itemId} está archivado, cancelando alarmas...`);
      await cancelItemAlarms(itemId, userId, alarmId);
      return true; // Indica que la alarma fue cancelada porque el item está archivado
    }

    return false; // Item activo, alarma válida
  } catch (error) {
    console.log("Error verificando estado para cancelar alarma:", error);
    return false;
  }
}

/* ==========================================================
   🆕 OBTENER ITEMS ARCHIVADOS
   ========================================================== */
export async function getArchivedItems(
  collection: "medications" | "habits" | "appointments",
  userId: string
): Promise<any[]> {
  return syncQueueService.getArchivedItems(collection, userId);
}

/* ==========================================================
   🆕 OBTENER ITEMS ACTIVOS (NO ARCHIVADOS)
   ========================================================== */
export async function getActiveItems(
  collection: "medications" | "habits" | "appointments",
  userId: string
): Promise<any[]> {
  return syncQueueService.getActiveItems(collection, userId);
}
