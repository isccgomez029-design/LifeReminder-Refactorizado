// src/utils/dateUtils.ts

// 🔹 YYYY-MM-DD + HH:mm -> Date
export function buildDateTime(
  date?: string | null,
  time?: string | null
): Date | null {
  if (!date) return null;

  const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;

  let h = 0;
  let mi = 0;

  if (time && /^\d{2}:\d{2}$/.test(time)) {
    const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
    h = isNaN(hh) ? 0 : hh;
    mi = isNaN(mm) ? 0 : mm;
  }

  return new Date(y, m - 1, d, h, mi, 0, 0);
}

// 🔹 Etiqueta bonita con fecha + hora (12h am/pm)
export function formatDateTimeLabel(
  date?: string | null,
  time?: string | null
): string {
  const dt = buildDateTime(date, time);
  if (!dt) return date || "";

  return dt.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// 🔹 Saber si ya pasó
export function isPastDateTime(
  date?: string | null,
  time?: string | null
): boolean {
  const dt = buildDateTime(date, time);
  if (!dt) return false;
  return dt.getTime() < Date.now();
}

// 🔹 JS getDay() -> índice 0=Lunes..6=Domingo (como tus DAY_LABELS)
export function jsDowToIndex(d: Date): number {
  const js = d.getDay(); // 0 domingo ... 6 sábado
  return (js + 6) % 7; // lunes = 0
}
