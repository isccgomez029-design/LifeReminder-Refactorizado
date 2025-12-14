// src/services/deviceCalendarService.ts
import * as Calendar from "expo-calendar";

// ⚠️ Pensado para Android (tu app es solo Android), pero funciona también en iOS si algún día lo necesitas.

export async function ensureCalendarIdAndroid(): Promise<string> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Permiso de calendario denegado.");
  }

  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable =
    cals.find(
      (c) => c.allowsModifications && /@/.test(c?.ownerAccount ?? "")
    ) || cals.find((c) => c.accessLevel === Calendar.CalendarAccessLevel.OWNER);

  if (writable) return writable.id;

  // Crear uno local si no existe alguno editable
  return Calendar.createCalendarAsync({
    title: "LifeReminder",
    color: "#2196F3",
    entityType: Calendar.EntityTypes.EVENT,
    source: {
      isLocalAccount: true,
      name: "LifeReminder",
      type: Calendar.SourceType.LOCAL,
    },
    name: "LifeReminder",
    ownerAccount: "personal",
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });
}

function parseStartEnd(dateISO: string, hhmm?: string, durationMin = 60) {
  const [y, m, d] = dateISO.split("-").map((n) => parseInt(n, 10));
  const [hh, mm] = (hhmm ?? "09:00").split(":").map((n) => parseInt(n, 10));
  const startDate = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  const endDate = new Date(startDate.getTime() + durationMin * 60000);
  return { startDate, endDate };
}

export async function upsertAndroidEvent(a: {
  eventId?: string;
  title: string;
  location?: string;
  doctor?: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm
}) {
  const calendarId = await ensureCalendarIdAndroid();
  const { startDate, endDate } = parseStartEnd(a.date, a.time, 60);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (a.eventId) {
    await Calendar.updateEventAsync(a.eventId, {
      title: a.title,
      location: a.location,
      notes: a.doctor ? `Médico: ${a.doctor}` : undefined,
      startDate,
      endDate,
      timeZone,
      alarms: [{ relativeOffset: -30 }],
    });
    return { eventId: a.eventId };
  } else {
    const eventId = await Calendar.createEventAsync(calendarId, {
      title: a.title,
      location: a.location,
      notes: a.doctor ? `Médico: ${a.doctor}` : undefined,
      startDate,
      endDate,
      timeZone,
      alarms: [{ relativeOffset: -30 }],
    });
    return { eventId };
  }
}

export async function deleteAndroidEvent(eventId: string) {
  try {
    await Calendar.deleteEventAsync(eventId);
  } catch (e) {
    console.log(
      "No se pudo eliminar evento del calendario del dispositivo:",
      e
    );
  }
}
