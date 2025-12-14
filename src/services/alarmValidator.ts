// src/services/alarmValidator.ts
// ✅ ACTUALIZADO: Validador offline-first con soporte completo

import { syncQueueService } from "./offline/SyncQueueService";
import { offlineAlarmService } from "./offline/OfflineAlarmService";
import { offlineAuthService } from "./offline/OfflineAuthService";

/**
 * Verifica si una alarma debe mostrarse o debe ser ignorada
 * porque el item está archivado.
 */
export async function shouldShowAlarm(
  notificationData: any
): Promise<{ shouldShow: boolean; reason?: string }> {
  try {
    const params = notificationData?.params || notificationData || {};
    const { type, medId, habitId, ownerUid: paramOwnerUid } = params;

    // Obtener ownerUid de forma offline-first
    const ownerUid = paramOwnerUid || offlineAuthService.getCurrentUid();

    if (!ownerUid) {
      console.log("⚠️ No hay ownerUid, permitiendo alarma");
      return { shouldShow: true };
    }

    let itemId: string | null = null;
    let collection: "medications" | "habits" | null = null;

    if (type === "med" && medId) {
      itemId = medId;
      collection = "medications";
    } else if (type === "habit" && habitId) {
      itemId = habitId;
      collection = "habits";
    }

    // Si no hay item identificable, permitir mostrar
    if (!itemId || !collection) {
      console.log("⚠️ No hay item identificable, permitiendo alarma");
      return { shouldShow: true };
    }

    // ✅ CAMBIO PRINCIPAL: Usar getItemFromCache que es 100% offline
    const itemData = await syncQueueService.getItemFromCache(
      collection,
      ownerUid,
      itemId
    );

    if (!itemData) {
      // Si no hay datos en cache local, permitir mostrar
      console.log(
        `⚠️ Item ${itemId} no encontrado en cache, permitiendo alarma`
      );
      return { shouldShow: true };
    }

    // Verificar estado de archivo
    if (itemData.isArchived === true || !!itemData.archivedAt) {
      console.log(`🔕 Item ${itemId} está archivado, ignorando alarma`);

      // Cancelar todas las alarmas futuras de este item usando el servicio offline
      await offlineAlarmService.cancelAllAlarmsForItem(itemId, ownerUid);

      return {
        shouldShow: false,
        reason: "El item está archivado",
      };
    }

    // Item activo, mostrar alarma
    return { shouldShow: true };
  } catch (error) {
    console.log("❌ Error validando alarma:", error);
    // En caso de error, permitir mostrar la alarma (fail-safe)
    return { shouldShow: true };
  }
}

/**
 * Limpia todas las alarmas de items archivados
 * ✅ Ahora 100% offline-first
 */
export async function cleanupArchivedItemAlarms(
  userId?: string
): Promise<void> {
  try {
    console.log("🧹 Limpiando alarmas de items archivados...");

    // Obtener userId de forma offline-first
    const ownerUid = userId || offlineAuthService.getCurrentUid();
    if (!ownerUid) {
      console.log("⚠️ Sin usuario, cancelando limpieza");
      return;
    }

    // Obtener todas las alarmas del servicio offline
    const allAlarms = await offlineAlarmService.getAllAlarms();

    // Filtrar solo las alarmas del usuario actual
    const userAlarms = allAlarms.filter((alarm) => alarm.ownerUid === ownerUid);

    let cancelledCount = 0;

    for (const alarm of userAlarms) {
      const collection = alarm.type === "med" ? "medications" : "habits";

      try {
        // Verificar si está archivado (100% desde cache local)
        const itemData = await syncQueueService.getItemFromCache(
          collection,
          ownerUid,
          alarm.itemId
        );

        if (itemData?.isArchived === true || !!itemData?.archivedAt) {
          await offlineAlarmService.cancelAlarm(alarm.id);
          cancelledCount++;
          console.log(`🔕 Alarma de item archivado cancelada: ${alarm.id}`);
        }
      } catch (checkErr) {
        console.log(`⚠️ Error verificando item ${alarm.itemId}:`, checkErr);
      }
    }

    console.log(`✅ Limpieza completada: ${cancelledCount} alarmas canceladas`);
  } catch (error) {
    console.log("❌ Error limpiando alarmas:", error);
  }
}

/**
 * Limpia alarmas vencidas (que ya deberían haber sonado hace más de 1 hora)
 */
export async function cleanupExpiredAlarms(): Promise<void> {
  try {
    const count = await offlineAlarmService.cleanupExpiredAlarms();
    if (count > 0) {
      console.log(`🧹 Limpiadas ${count} alarmas vencidas`);
    }
  } catch (error) {
    console.log("❌ Error limpiando alarmas vencidas:", error);
  }
}

/**
 * Función de mantenimiento general (llamar al iniciar la app)
 */
export async function performAlarmMaintenance(): Promise<void> {
  const userId = offlineAuthService.getCurrentUid();
  if (!userId) return;

  console.log("🔧 Iniciando mantenimiento de alarmas...");

  // Limpiar alarmas vencidas
  await cleanupExpiredAlarms();

  // Limpiar alarmas de items archivados
  await cleanupArchivedItemAlarms(userId);

  console.log("✅ Mantenimiento de alarmas completado");
}
