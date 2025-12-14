// src/components/TimePickerField.tsx
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { MaterialIcons } from "@expo/vector-icons";
import { COLORS, FONT_SIZES } from "../../types";

type Props = {
  value?: string; // "HH:MM"
  onChange: (hhmm: string) => void;
  mode?: "point" | "interval"; // point = hora puntual, interval = cada X tiempo
  placeholder?: string;
};

function parseHHMMToDate(hhmm?: string): Date {
  const now = new Date();
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      8,
      0,
      0,
      0
    );
  }
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    isNaN(h) ? 0 : h,
    isNaN(m) ? 0 : m,
    0,
    0
  );
}

function formatForDisplay(hhmm?: string, mode: "point" | "interval" = "point") {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return "";

  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);

  if (mode === "interval") {
    // 🟢 Intervalo: mostrar siempre 24h HH:MM sin am/pm
    const hh = isNaN(h) ? 0 : h;
    const mm = isNaN(m) ? 0 : m;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  // 🟢 Hora puntual: usar formato 12h con am/pm
  const d = new Date();
  d.setHours(isNaN(h) ? 0 : h, isNaN(m) ? 0 : m, 0, 0);
  return d.toLocaleTimeString("es-MX", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const TimePickerField: React.FC<Props> = ({
  value,
  onChange,
  mode = "point",
  placeholder = "Seleccionar hora",
}) => {
  const [show, setShow] = useState(false);
  const [pickerDate, setPickerDate] = useState<Date>(parseHHMMToDate(value));

  const label = useMemo(() => {
    const formatted = formatForDisplay(value, mode);
    if (!formatted) return placeholder;
    return formatted;
  }, [value, mode, placeholder]);

  const onPress = () => {
    setPickerDate(parseHHMMToDate(value));
    setShow(true);
  };

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") {
      setShow(false);
    }

    if (!selected) return; // cancelado

    setPickerDate(selected);
    const h = selected.getHours();
    const m = selected.getMinutes();
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    const hhmm = `${hh}:${mm}`;
    onChange(hhmm);
  };

  return (
    <View>
      <TouchableOpacity style={styles.timeButton} onPress={onPress}>
        <MaterialIcons name="access-time" size={20} color={COLORS.surface} />
        <Text style={styles.timeButtonText}>{label}</Text>
      </TouchableOpacity>

      {show && (
        <DateTimePicker
          value={pickerDate}
          mode="time"
          display="spinner"
          // 🟢 Para intervalos usamos 24h (permite 00:30 sin am/pm)
          is24Hour={mode === "interval"}
          onChange={handleChange}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  timeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flex: 1,
  },
  timeButtonText: {
    color: COLORS.surface,
    fontWeight: "700",
    fontSize: FONT_SIZES.small,
  },
});

export default TimePickerField;
