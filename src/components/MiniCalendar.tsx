// src/components/MiniCalendar.tsx

// Importaciones necesarias
import React, { useMemo, useState } from "react";
import {
  View, // contenedor básico
  Text, // para mostrar texto
  TouchableOpacity, // botones táctiles
  StyleSheet, // estilos
  ViewStyle, // tipo para estilos de vista
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons"; // iconos de navegación
import { COLORS, FONT_SIZES } from "../../types"; // constantes de colores y fuentes

// Props que recibe el componente
type MiniCalendarProps = {
  value: Date; // fecha seleccionada actualmente
  onChange: (d: Date) => void; // callback al seleccionar un día
  markedDates?: string[]; // fechas con eventos en formato "YYYY-MM-DD"
  style?: ViewStyle; // estilos adicionales opcionales
};

// Función auxiliar para añadir ceros a números menores de 10
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

// Convierte una fecha a formato ISO corto (YYYY-MM-DD)
const toISO = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function MiniCalendar({
  value,
  onChange,
  markedDates = [],
  style,
}: MiniCalendarProps) {
  // Estado interno: cursor apunta al primer día del mes actual mostrado
  const [cursor, setCursor] = useState<Date>(
    new Date(value.getFullYear(), value.getMonth(), 1)
  );

  // Año y mes actuales del cursor
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  // Convertimos el array de fechas marcadas en un Set para búsqueda rápida
  const markedSet = useMemo(() => new Set(markedDates), [markedDates]);

  // Calculamos los días que se mostrarán en la cuadrícula del calendario
  const days = useMemo(() => {
    const firstDow = new Date(year, month, 1).getDay(); // día de la semana del 1er día (0=Dom ... 6=Sab)
    const daysInMonth = new Date(year, month + 1, 0).getDate(); // número de días en el mes
    const slots: (number | null)[] = [];

    // Relleno con null antes del día 1 para alinear la cuadrícula
    for (let i = 0; i < firstDow; i++) slots.push(null);

    // Insertamos los días reales del mes
    for (let d = 1; d <= daysInMonth; d++) slots.push(d);

    return slots;
  }, [year, month]);

  // Nombres de los días de la semana
  const weekDays = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];

  // Función para verificar si un día está seleccionado
  const isSelected = (d: number) =>
    value.getFullYear() === year &&
    value.getMonth() === month &&
    value.getDate() === d;

  // Fecha actual (hoy)
  const today = new Date();

  // Función para verificar si un día corresponde a hoy
  const isToday = (d: number) =>
    today.getFullYear() === year &&
    today.getMonth() === month &&
    today.getDate() === d;

  return (
    <View style={[styles.root, style]}>
      {/* Encabezado con botones de navegación */}
      <View style={styles.header}>
        {/* Botón para ir al mes anterior */}
        <TouchableOpacity
          onPress={() => setCursor(new Date(year, month - 1, 1))}
          style={styles.navBtn}
        >
          <MaterialIcons name="chevron-left" size={20} color={COLORS.surface} />
        </TouchableOpacity>

        {/* Texto con el mes y año actual */}
        <Text style={styles.headerText}>
          {cursor.toLocaleString("es-MX", { month: "short" }).toUpperCase()}{" "}
          {year}
        </Text>

        {/* Botón para ir al mes siguiente */}
        <TouchableOpacity
          onPress={() => setCursor(new Date(year, month + 1, 1))}
          style={styles.navBtn}
        >
          <MaterialIcons
            name="chevron-right"
            size={20}
            color={COLORS.surface}
          />
        </TouchableOpacity>
      </View>

      {/* Fila con los nombres de los días de la semana */}
      <View style={styles.weekRow}>
        {weekDays.map((w) => (
          <Text key={w} style={styles.weekText}>
            {w}
          </Text>
        ))}
      </View>

      {/* Cuadrícula con los días del mes */}
      <View style={styles.grid}>
        {days.map((d, i) => {
          // Si es un espacio vacío (relleno), renderizamos celda vacía
          if (d === null) return <View key={i} style={styles.cell} />;

          // Verificamos si el día está seleccionado
          const selected = isSelected(d);
          // Creamos objeto Date para el día actual
          const dateObj = new Date(year, month, d);
          // Convertimos a ISO para comparar con fechas marcadas
          const iso = toISO(dateObj);
          // Verificamos si el día tiene un evento marcado
          const hasMark = markedSet.has(iso);

          return (
            <TouchableOpacity
              key={i}
              style={[
                styles.cell,
                selected && {
                  backgroundColor: COLORS.secondary, // fondo especial si está seleccionado
                  borderRadius: 8,
                },
              ]}
              onPress={() => onChange(new Date(year, month, d))}
            >
              {/* Texto del día */}
              <Text
                style={[
                  styles.dayText,
                  isToday(d) && !selected && { fontWeight: "800" }, // resalta si es hoy
                  selected && { color: COLORS.surface, fontWeight: "800" }, // estilo especial si está seleccionado
                ]}
              >
                {d}
              </Text>
              {/* Punto indicador si el día tiene evento marcado */}
              {hasMark && <View style={styles.dot} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 250,
    backgroundColor: "#111",
    padding: 10,
    borderRadius: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  headerText: {
    color: COLORS.surface,
    fontWeight: "800",
    fontSize: FONT_SIZES.medium,
  },
  navBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.secondary,
  },
  weekRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  weekText: {
    color: "#bbb",
    fontSize: 10,
    width: 28,
    textAlign: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 2,
  },
  dayText: {
    color: COLORS.surface,
    fontSize: 12,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.secondary,
    marginTop: 2,
  },
});
