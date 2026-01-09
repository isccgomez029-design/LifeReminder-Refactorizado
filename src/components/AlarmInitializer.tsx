// src/components/AlarmInitializer.tsx
import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as Notifications from "expo-notifications";

import { offlineAlarmService } from "../services/offline/OfflineAlarmService";
import { performAlarmMaintenance } from "../services/alarmValidator";
import { offlineAuthService } from "../services/offline/OfflineAuthService";
import { syncQueueService } from "../services/offline/SyncQueueService";
import { auth } from "../config/firebaseConfig";

Notifications.setNotificationHandler({
  // Configura cómo se muestran las notificaciones cuando llegan
  handleNotification: async () => ({
    // Handler ejecutado por Expo al recibir una notificación
    shouldShowAlert: true, // Mostrar alerta/overlay
    shouldPlaySound: true, // Reproducir sonido
    shouldSetBadge: true, // Actualizar badge (iOS)
    shouldShowBanner: true, // Mostrar banner (iOS)
    shouldShowList: true, // Mostrar en lista/centro de notificaciones
  }),
});

/** Convierte ISO | Date | Timestamp | {seconds} -> Date | null */ // Doc: normaliza formatos de fecha
const toDateSafe = (v: any): Date | null => {
  // Convierte un valor “fecha” a Date válida
  if (!v) return null; // Si viene vacío/null/undefined, no hay fecha

  if (typeof v === "string" || typeof v === "number") {
    // Si viene como ISO string o timestamp numérico
    const d = new Date(v); // Construye Date
    return isNaN(d.getTime()) ? null : d; // Si es inválida, null; si es válida, la regresa
  }

  if (typeof v?.toDate === "function") {
    // Si viene como Firestore Timestamp (tiene toDate)
    const d = v.toDate(); // Convierte a Date
    return d instanceof Date && !isNaN(d.getTime()) ? d : null; // Valida y regresa
  }

  if (typeof v?.seconds === "number") {
    // Si viene como { seconds } (otra forma común de Timestamp)
    const d = new Date(v.seconds * 1000); // Convierte seconds -> ms y crea Date
    return isNaN(d.getTime()) ? null : d; // Valida y regresa
  }

  return null; // Si no coincide con ningún formato, se considera inválido
};

type CachedMed = {
  // Tipo de medicamento tal como vive en el cache local
  id: string; // ID del medicamento
  nombre?: string; // Nombre
  dosis?: string; // Dosis (texto)
  frecuencia?: string; // Frecuencia (ej. cada X horas)
  imageUri?: string; // URI de imagen local/galería
  nextDueAt?: any; // Próxima fecha/hora de toma (puede venir en varios formatos)
  proximaToma?: string; // Texto formateado de próxima toma
  currentAlarmId?: string | null; // ID de notificación programada en Expo (si existe)
  cantidadActual?: number; // Cantidad disponible actual
  cantidadPorToma?: number; // Cantidad a descontar por toma
  snoozeCount?: number; // Número de “posponer” aplicados
  patientName?: string; // Nombre del paciente (si vista cuidador)
};

type CachedHabit = {
  // Tipo de hábito tal como vive en el cache local
  id: string; // ID del hábito
  name?: string; // Nombre
  icon?: string; // Icono
  lib?: string; // Librería del icono (MaterialIcons/FontAwesome5)
  nextDueAt?: any; // Próxima fecha/hora del hábito
  currentAlarmId?: string | null; // ID de notificación programada en Expo
  snoozeCount?: number; // Número de snoozes
  patientName?: string; // Nombre del paciente (si aplica)
};

export function AlarmInitializer() {
  // Componente “sin UI” que inicializa y repara alarmas globalmente
  const appState = useRef(AppState.currentState); // Guarda el estado actual de la app (active/background/inactive)
  const maintenanceInterval = useRef<NodeJS.Timeout | undefined>(undefined); // Referencia al setInterval para luego limpiarlo
  const lastMaintenanceTime = useRef<number>(0); // Marca de tiempo del último mantenimiento ejecutado

  //  Throttle para no reprogramar a lo loco
  const lastEnsureTime = useRef<number>(0); // Última vez que se ejecutó ensureUpcomingAlarms
  const ensuringRef = useRef<boolean>(false); // “Lock” para evitar ejecuciones simultáneas

  const getOwnerUid = () =>
    // Función helper para obtener el UID del usuario dueño
    offlineAuthService.getCurrentUid();
  // Usa Firebase si existe, si no usa sesión offline

  /**
   *  Garantiza que TODA próxima alarma (nextDueAt futura) tenga
   * una notificación local REAL programada.
   */
  const ensureUpcomingAlarms = async () => {
    // Repara alarmas futuras faltantes en el SO
    if (ensuringRef.current) return; // Si ya hay un ensure corriendo, evita duplicarlo

    const ownerUid = getOwnerUid(); // Obtiene UID del usuario actual
    if (!ownerUid) return; // Si no hay UID, no se puede asegurar nada

    // No correr más de una vez cada 60s
    const now = Date.now(); // Tiempo actual
    if (now - lastEnsureTime.current < 60 * 1000) return; // Throttle: si corrió hace <60s, salir

    ensuringRef.current = true; // Activa lock (entra a sección crítica)
    lastEnsureTime.current = now; // Registra la ejecución

    try {
      // Lista de notificaciones locales programadas (Expo)
      const scheduled = await Notifications.getAllScheduledNotificationsAsync(); // Lee notificaciones programadas en el dispositivo
      const scheduledIds = new Set<string>( // Crea un Set para búsqueda rápida de IDs
        scheduled.map((n) => n.identifier).filter(Boolean) // Extrae identifiers válidos
      );

      // ====== MEDS ======
      const meds = (await syncQueueService.getActiveItems(
        // Obtiene medicamentos activos desde cache (no archivados)
        "medications", // Colección lógica
        ownerUid // Usuario dueño
      )) as CachedMed[]; // Cast al tipo CachedMed

      for (const med of meds) {
        // Recorre cada medicamento
        const nextDueAt = toDateSafe(med.nextDueAt); // Convierte nextDueAt a Date segura
        if (!nextDueAt) continue; // Si no hay fecha válida, ignora

        // Solo futuro
        if (nextDueAt.getTime() <= Date.now()) continue; // Si la fecha ya pasó o es ahora, ignora (solo futuras)

        const hasAlarmId = !!med.currentAlarmId; // True si el item “cree” tener alarma programada
        const existsInExpo = // Verifica si esa alarma realmente existe en el SO/Expo
          hasAlarmId && scheduledIds.has(med.currentAlarmId as string); // Consulta el Set de notificaciones programadas

        // Si no hay alarmId o ya no existe en Expo -> reprogramar
        if (!hasAlarmId || !existsInExpo) {
          // Si falta o se perdió, se debe reprogramar
          try {
            const result = await offlineAlarmService.scheduleMedicationAlarm(
              // Agenda la alarma local del medicamento
              nextDueAt, // Fecha/hora exacta del trigger
              {
                // Payload que se mostrará/usar en la notificación
                nombre: med.nombre || "Medicamento", // Nombre fallback
                dosis: med.dosis, // Dosis
                imageUri: med.imageUri, // Imagen
                medId: med.id, // ID del medicamento
                ownerUid, // UID dueño
                frecuencia: med.frecuencia, // Frecuencia
                cantidadActual: med.cantidadActual ?? 0, // Cantidad actual con default
                cantidadPorToma: med.cantidadPorToma ?? 1, // Cantidad por toma con default
                patientName: med.patientName, // Nombre paciente (si aplica)
                snoozeCount: med.snoozeCount ?? 0, // Snooze actual con default
              }
            );

            if (result?.success && result.notificationId) {
              // Si la programación fue exitosa y hay ID
              const patch = { currentAlarmId: result.notificationId }; // Prepara patch para guardar el nuevo alarmId

              // Cache + cola (funciona offline/online)
              await syncQueueService.updateItemInCache(
                // Actualiza cache local con el nuevo alarmId
                "medications", // Colección
                ownerUid, // Usuario
                med.id, // Documento
                patch // Datos a actualizar
              );
              await syncQueueService.enqueue(
                // Encola la actualización para sincronizar con Firestore cuando haya internet
                "UPDATE", // Tipo operación
                "medications", // Colección
                med.id, // Documento
                ownerUid, // Usuario
                patch // Payload (nuevo alarmId)
              );
            }
          } catch {}
        }
      }

      // ====== HABITS ======
      const habits = (await syncQueueService.getActiveItems(
        // Obtiene hábitos activos desde cache
        "habits", // Colección lógica
        ownerUid // Usuario dueño
      )) as CachedHabit[]; // Cast al tipo CachedHabit

      for (const habit of habits) {
        // Recorre cada hábito
        const nextDueAt = toDateSafe(habit.nextDueAt); // Convierte nextDueAt a Date segura
        if (!nextDueAt) continue; // Si no hay fecha válida, ignora
        if (nextDueAt.getTime() <= Date.now()) continue; // Solo futuras

        const hasAlarmId = !!habit.currentAlarmId; // True si tiene alarmId guardado
        const existsInExpo = // Verifica si existe realmente programada
          hasAlarmId && scheduledIds.has(habit.currentAlarmId as string); // Consulta en Set

        if (!hasAlarmId || !existsInExpo) {
          // Si falta o se perdió, reprograma
          try {
            const result = await offlineAlarmService.scheduleHabitAlarm(
              // Agenda la alarma local del hábito
              nextDueAt, // Fecha/hora del trigger
              {
                // Payload de la notificación
                name: habit.name || "Hábito", // Nombre fallback
                icon: habit.icon, // Icono
                // Valida que solo se acepten librerías soportadas
                lib:
                  habit.lib === "MaterialIcons" || habit.lib === "FontAwesome5"
                    ? habit.lib // Si es válida, úsala
                    : undefined, // Si no, no setear lib
                habitId: habit.id, // ID del hábito
                ownerUid, // UID dueño
                patientName: habit.patientName, // Nombre paciente (si aplica)
                snoozeCount: habit.snoozeCount ?? 0, // Snooze con default
              }
            );

            if (result?.success && result.notificationId) {
              // Si fue exitoso y hay notificationId
              const patch = { currentAlarmId: result.notificationId }; // Patch con nuevo alarmId

              await syncQueueService.updateItemInCache(
                // Actualiza cache local
                "habits", // Colección
                ownerUid, // Usuario
                habit.id, // Documento
                patch // Datos
              );
              await syncQueueService.enqueue(
                // Encola UPDATE para sincronizar luego
                "UPDATE", // Operación
                "habits", // Colección
                habit.id, // Documento
                ownerUid, // Usuario
                patch // Payload
              );
            }
          } catch {
            // no-op
          }
        }
      }
    } finally {
      ensuringRef.current = false; // Libera el lock aunque haya errores
    }
  };

  useEffect(() => {
    // Efecto que corre una vez al montar el componente
    let isMounted = true; // Flag para evitar ejecutar cosas si ya se desmontó

    const initialize = async () => {
      // Inicialización general al inicio de la app
      try {
        // 1) Inicializar alarmas
        await offlineAlarmService.initialize(); // Carga/rehidrata estructura interna de alarmas offline

        // Asegurar que existan alarmas locales para próximos eventos
        await ensureUpcomingAlarms(); // Repara/reprograma alarmas futuras faltantes

        // 3) Mantenimiento inicial si han pasado 5 min
        const now = Date.now(); // Tiempo actual
        if (now - lastMaintenanceTime.current > 5 * 60 * 1000) {
          // Si hace >5 min del último mantenimiento
          await performAlarmMaintenance(); // Ejecuta validaciones/limpieza (alarmValidator)
          lastMaintenanceTime.current = now; // Actualiza marca de tiempo
        }

        // Intervalo de mantenimiento (30 min) + ensure
        maintenanceInterval.current = setInterval(async () => {
          // Crea un timer periódico
          if (!isMounted) return; // Si ya se desmontó, no ejecutar

          const currentTime = Date.now(); // Tiempo actual

          // ensure cada ~5 min (pero throttle interno de 60s)
          if (currentTime - lastEnsureTime.current > 5 * 60 * 1000) {
            // Si han pasado >5 min desde el último ensure
            await ensureUpcomingAlarms(); // Re-asegura alarmas futuras
          }

          // mantenimiento cada 25-30 min
          if (currentTime - lastMaintenanceTime.current > 25 * 60 * 1000) {
            // Si han pasado >25 min desde el último mantenimiento
            await performAlarmMaintenance(); // Corre mantenimiento
            lastMaintenanceTime.current = currentTime; // Actualiza marca de tiempo
          }
        }, 30 * 60 * 1000); // Frecuencia del interval: 30 minutos
      } catch {
        // no-op
      }
    };

    initialize(); // Ejecuta la inicialización al montar

    const subscription = AppState.addEventListener(
      // Se suscribe a cambios de estado de la app
      "change", // Evento de cambio de AppState
      async (nextAppState: AppStateStatus) => {
        // Callback cuando cambia (active/background/inactive)
        if (
          // Condición: venimos de background/inactive y volvemos a active
          appState.current.match(/inactive|background/) && // Estado anterior era inactive o background
          nextAppState === "active" // Estado nuevo es active (foreground)
        ) {
          try {
            await offlineAlarmService.initialize(); // Re-inicializa alarmas al volver (por seguridad)

            //  al volver a foreground, re-asegurar alarmas
            await ensureUpcomingAlarms(); // Repara alarmas futuras al regresar

            const now = Date.now(); // Tiempo actual
            if (now - lastMaintenanceTime.current > 10 * 60 * 1000) {
              // Si hace >10 min del último mantenimiento
              await performAlarmMaintenance(); // Corre mantenimiento
              lastMaintenanceTime.current = now; // Actualiza marca de tiempo
            }
          } catch {
            // no-op
          }
        }

        appState.current = nextAppState; // Guarda el estado actual para la próxima transición
      }
    );

    return () => {
      // Cleanup cuando el componente se desmonta
      isMounted = false; // Marca que ya no está montado
      subscription.remove(); // Elimina listener de AppState
      if (maintenanceInterval.current)
        // Si hay interval activo
        clearInterval(maintenanceInterval.current); // Limpia el interval para evitar fugas
    };
  }, []); // Dependencias vacías: solo corre una vez

  return null; // No renderiza UI (es un “initializer” de side-effects)
}

export default AlarmInitializer; // Export por defecto para importarlo fácil en App.tsx
