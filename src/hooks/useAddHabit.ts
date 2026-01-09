// src/hooks/useAddHabit.ts
// 🪝 Hook: lógica de AddHabitScreen (offline-first + alarmas) sin tocar UI

import { useCallback, useMemo, useState } from "react";
import { Alert } from "react-native";

import { RouteProp } from "@react-navigation/native";
import { RootStackParamList, Habit } from "../navigation/StackNavigator";

import { syncQueueService } from "../services/offline/SyncQueueService";
import { offlineAuthService } from "../services/offline/OfflineAuthService";
import { auth } from "../config/firebaseConfig";

import { scheduleRecurringHabitAlarms } from "../services/alarmHelpers";
import { normalizeTime } from "../utils/timeUtils";

// Tipos para tipar la ruta (params) de la pantalla AddHabit
type AddHabitRoute = RouteProp<RootStackParamList, "AddHabit">; // Tipo de route para AddHabit

// Tipos para limitar valores válidos en UI
export type HabitLib = "FontAwesome5" | "MaterialIcons"; // Librerías permitidas para iconos
export type HabitPriority = "baja" | "normal" | "alta"; // Prioridades permitidas

export function useAddHabit(args: { route: AddHabitRoute }) {
  // Hook principal que recibe la route
  const { route } = args; // Extrae la route de los argumentos

  const mode = route.params?.mode ?? "new"; // Obtiene modo desde params (new/edit); por defecto "new"
  const habit = route.params?.habit as Habit | undefined; // Hábito existente si viene en edición
  const isEdit = mode === "edit"; // Booleano para saber si estamos editando

  // ========= state (igual que antes) =========
  const [name, setName] = useState(habit?.name ?? ""); // Nombre del hábito (inicial: el existente o vacío)
  const [icon, setIcon] = useState<string | undefined>(habit?.icon); // Icono del hábito (opcional al inicio)
  const [lib, setLib] = useState<HabitLib>(habit?.lib ?? "MaterialIcons"); // Librería del icono (default MaterialIcons)
  const [priority, setPriority] = useState<HabitPriority>( // Prioridad del hábito
    ((habit?.priority as any) || "normal") as HabitPriority // Default: normal (cast defensivo)
  );
  const [days, setDays] = useState<number[]>(habit?.days ?? []); // Días seleccionados (0-6 normalmente)
  const [times, setTimes] = useState<string[]>(habit?.times ?? []); // Horas configuradas ["HH:MM", ...]
  const [newTime, setNewTime] = useState(times[0] ?? "08:00"); // Hora temporal usada para agregar (default 08:00)

  // ========= actions =========

  const toggleDay = useCallback((idx: number) => {
    // Agrega o quita un día de la lista
    setDays(
      (
        prev // Actualiza days usando el estado anterior
      ) =>
        prev.includes(idx) // Si ya existe el día...
          ? prev.filter((d) => d !== idx) // ...lo quita
          : [...prev, idx] // ...si no, lo agrega
    );
  }, []); // No depende de nada externo

  const addTime = useCallback(() => {
    // Agrega un horario a la lista de times
    const final = normalizeTime(newTime); // Normaliza "HH:MM" (evita formatos inválidos)
    if (!final) {
      // Si la hora no es válida...
      Alert.alert("Hora inválida", "Selecciona una hora válida."); // ...muestra alerta
      return; // ...y termina
    }

    setTimes((prev) => {
      // Actualiza la lista de horarios
      if (prev.includes(final)) return prev; // Evita duplicados
      return [...prev, final].sort(); // Agrega la hora y ordena para mantener consistencia
    });
  }, [newTime]); // Depende de newTime

  const removeTime = useCallback((t: string) => {
    // Elimina un horario específico
    setTimes((prev) => prev.filter((x) => x !== t)); // Filtra el horario a remover
  }, []); // No depende de nada externo

  const save = useCallback(async () => {
    // Guarda el hábito (CREATE/UPDATE) y agenda alarmas
    if (!name.trim()) {
      // Validación: nombre requerido
      Alert.alert("Falta información", "Escribe un nombre."); // Mensaje al usuario
      return; // Detiene guardado
    }
    if (!icon) {
      // Validación: icono requerido
      Alert.alert("Icono", "Selecciona un icono."); // Mensaje al usuario
      return; // Detiene guardado
    }
    if (days.length === 0) {
      // Validación: al menos un día
      Alert.alert("Días", "Elige al menos un día."); // Mensaje al usuario
      return; // Detiene guardado
    }
    if (times.length === 0) {
      // Validación: al menos un horario
      Alert.alert("Horarios", "Agrega al menos un horario."); // Mensaje al usuario
      return; // Detiene guardado
    }

    // ✅ offlineAuthService fallback
    const userId = offlineAuthService.getCurrentUid(); // Toma uid online o el uid cacheado offline
    if (!userId) {
      // Si no hay sesión...
      Alert.alert("Error", "Debe iniciar sesión."); // Aviso
      return; // Termina
    }

    const sortedTimes = [...times].sort(); // Copia y ordena horarios para persistir consistente

    try {
      const habitId = // Determina el id del hábito
        isEdit && habit?.id // Si es edición y existe id...
          ? habit.id // ...usa el id existente
          : `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; // ...si no, genera un id temporal

      const habitData = {
        // Construye el objeto a guardar
        id: habitId, // Id final
        name: name.trim(), // Nombre limpio
        icon, // Icono seleccionado
        lib, // Librería del icono
        priority, // Prioridad
        days, // Días seleccionados
        times: sortedTimes, // Horarios ordenados
        createdAt: (habit as any)?.createdAt || new Date().toISOString(), // createdAt: conserva el anterior o crea uno nuevo
        updatedAt: new Date().toISOString(), // updatedAt: siempre se actualiza al guardar
        isArchived: false, // Marca como activo (no archivado)
      };

      if (isEdit && habit?.id) {
        // Si es edición...
        await syncQueueService.enqueue(
          // Encola UPDATE (offline-first)
          "UPDATE", // Tipo operación
          "habits", // Colección
          habit.id, // Documento a actualizar
          userId, // Usuario dueño
          habitData // Payload final
        );
      } else {
        // Si es creación...
        await syncQueueService.enqueue(
          // Encola CREATE (offline-first)
          "CREATE", // Tipo operación
          "habits", // Colección
          habitId, // Documento nuevo
          userId, // Usuario dueño
          habitData // Payload final
        );
      }

      // 🔔 alarmas locales
      await scheduleRecurringHabitAlarms({
        // Agenda alarmas recurrentes en el dispositivo (local notifications)
        id: habitId, // Id del hábito
        name: name.trim(), // Nombre (para mostrar en notificación)
        times: sortedTimes, // Horarios
        days, // Días
        icon, // Icono
        lib, // Librería
        ownerUid: userId, // UID dueño (para metadata y validación)
      });

      Alert.alert(
        // Mensaje de éxito
        "Listo",
        isEdit ? "Hábito actualizado." : "Hábito creado correctamente."
      );

      return { ok: true as const }; // Devuelve OK para que la pantalla decida qué hacer (ej: navegar back)
    } catch (e: any) {
      // Si algo falla...
      Alert.alert("Error", e?.message ?? "No se pudo guardar el hábito"); // Muestra error
      return { ok: false as const }; // Devuelve fallo
    }
  }, [name, icon, days, times, isEdit, habit, lib, priority]); // Dependencias: valores usados dentro

  return useMemo(
    // Memoiza el objeto para no recrearlo en cada render
    () => ({
      // mode
      isEdit, // Indica si es edición

      // state
      name, // Nombre actual
      icon, // Icono actual
      lib, // Librería actual
      priority, // Prioridad actual
      days, // Días seleccionados
      times, // Horarios guardados
      newTime, // Hora temporal para agregar

      // setters (UI usa estos)
      setName, // Actualiza nombre
      setIcon, // Actualiza icono
      setLib, // Actualiza librería
      setPriority, // Actualiza prioridad
      setNewTime, // Actualiza la hora temporal del picker

      // actions
      toggleDay, // Agrega/quita un día
      addTime, // Agrega un horario
      removeTime, // Elimina un horario
      save, // Guarda el hábito y agenda alarmas
    }),
    [
      isEdit, // Dependencias para memo
      name,
      icon,
      lib,
      priority,
      days,
      times,
      newTime,
      toggleDay,
      addTime,
      removeTime,
      save,
    ]
  );
}
