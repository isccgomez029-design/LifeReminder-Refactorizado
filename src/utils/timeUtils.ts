// src/utils/timeUtils.ts

// 🔹 Normaliza entradas tipo "0830", "8:3", "8", etc. a "HH:MM"
export const normalizeTime = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";

  let hh = "00";
  let mm = "00";

  if (digits.length <= 2) {
    hh = digits;
  } else {
    hh = digits.slice(0, 2);
    mm = digits.slice(2, 4) || "00";
  }

  let hNum = parseInt(hh, 10);
  let mNum = parseInt(mm, 10);

  if (isNaN(hNum)) hNum = 0;
  if (isNaN(mNum)) mNum = 0;

  if (hNum < 0) hNum = 0;
  if (hNum > 23) hNum = 23;
  if (mNum < 0) mNum = 0;
  if (mNum > 59) mNum = 59;

  const hhStr = hNum.toString().padStart(2, "0");
  const mmStr = mNum.toString().padStart(2, "0");

  return `${hhStr}:${mmStr}`;
};

/**
 * 🔹 clampTime: se usa cuando ya tienes algo tipo "8", "830", "08:3"
 * y quieres forzar que termine como HH:MM válido (00–23 / 00–59).
 * Útil para citas, hábitos, intervalos, etc.
 */
export function clampTime(hhmm: string): string {
  const m = /^(\d{1,2})(?::?(\d{1,2}))?$/.exec(hhmm.replace(/\s/g, ""));
  if (!m) return "";
  let h = parseInt(m[1], 10);
  let mi = parseInt(m[2] ?? "0", 10);
  if (isNaN(h)) h = 0;
  if (isNaN(mi)) mi = 0;
  if (h < 0) h = 0;
  if (h > 23) h = 23;
  if (mi < 0) mi = 0;
  if (mi > 59) mi = 59;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

// 🔹 "HH:MM" -> Date (para iniciar el DateTimePicker)
export function parseHHMMToDate(hhmm?: string): Date {
  const now = new Date();
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) {
    return now;
  }
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
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

// 🔹 Formato bonito en 12h con am/pm (para mostrar en los botones)
export function formatHHMMDisplay(hhmm?: string): string {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return "Seleccionar hora";
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(isNaN(h) ? 0 : h, isNaN(m) ? 0 : m, 0, 0);
  return d.toLocaleTimeString("es-MX", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
