// src/types/index.ts
/**
 * Tipos y constantes centrales de LifeReminder
 */
import type { ReactNode } from "react";
import type { ImageSourcePropType } from "react-native";

/* =========================
   BÁSICOS / UTILITARIOS
   ========================= */
export type ID = number;
export type LoadingState = "idle" | "loading" | "success" | "error";

export interface ErrorState {
  hasError: boolean;
  message?: string;
  code?: string;
}

export interface ScreenState<T> {
  data: T[];
  loading: LoadingState;
  error: ErrorState;
}

/* =========================
   AUTENTICACIÓN / USUARIO
   ========================= */
export interface LoginFormData {
  username: string;
  password: string;
}

export interface UserProfile {
  id: ID;
  name: string;
  email?: string;
  phone?: string;
  avatarUri?: string;
  birthdateISO?: string; // "YYYY-MM-DD"
}

/* =========================
   MEDICINAS / RECORDATORIOS
   ========================= */
export type DoseUnit = "mg" | "ml" | "pills" | "drops" | "units";
export type ReminderType = "medication" | "habit";
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface Medication {
  id: ID;
  name: string;
  doseValue?: number;
  doseUnit?: DoseUnit;
  withFood?: boolean;
  notes?: string;
}

export type Schedule =
  | {
      kind: "daily";
      times: string[]; // "HH:mm" (24h)
      everyNDays?: number; // opcional: cada N días
      startDateISO: string; // "YYYY-MM-DD"
      endDateISO?: string;
    }
  | {
      kind: "weekly";
      days: Weekday[];
      times: string[];
      startDateISO: string;
      endDateISO?: string;
    }
  | {
      kind: "interval";
      everyHours: number; // p.ej. cada 8 horas
      firstAtISO: string; // ISO completo: "YYYY-MM-DDTHH:mm:ssZ"
      endDateISO?: string;
    }
  | {
      kind: "specific";
      datetimesISO: string[]; // lista de fechas/horas exactas en ISO
    };

export interface Reminder {
  id: ID;
  type: ReminderType;
  title: string;
  medicationId?: ID; // si es de medicación
  schedule: Schedule;
  enabled: boolean;
  notes?: string;
}

export interface ReminderFormData {
  type: ReminderType;
  title: string;
  medicationName?: string;
  doseValue?: number;
  doseUnit?: DoseUnit;
  schedule: Schedule;
  notes?: string;
}

/* =========================
   CITAS MÉDICAS
   ========================= */
export type AppointmentStatus = "upcoming" | "done" | "canceled";

export interface Appointment {
  id: ID;
  title: string; // p.ej. "Dermatología"
  datetimeISO: string; // ISO completo
  location?: string; // clínica/hospital
  doctor?: string;
  notes?: string;
  status: AppointmentStatus;
}

export interface AppointmentFormData {
  title: string;
  datetimeISO: string;
  location?: string;
  doctor?: string;
  notes?: string;
}

/* =========================
   RED DE APOYO / CONTACTOS
   ========================= */
export type CareRole = "viewer" | "editor" | "caregiver";

export interface CareContact {
  id: ID;
  name: string;
  relation?: string; // hija, esposo, etc.
  phone?: string;
  email?: string;
  role: CareRole;
}

/* =========================
   HISTORIAL / REPORTES
   ========================= */
export type HistoryEventType =
  | "dose_taken"
  | "dose_missed"
  | "dose_snoozed"
  | "appointment_attended"
  | "appointment_missed";

export interface HistoryEvent {
  id: ID;
  type: HistoryEventType;
  atISO: string; // cuándo ocurrió
  relatedId?: ID; // id de reminder o cita
  meta?: Record<string, any>;
}

export interface AdherenceByMedication {
  medicationId: ID;
  medicationName: string;
  taken: number;
  missed: number;
  adherenceRate: number; // 0..1
}

export interface AdherenceReport {
  id: ID;
  fromISO: string;
  toISO: string;
  overallRate: number; // 0..1
  totalTaken: number;
  totalMissed: number;
  perMedication?: AdherenceByMedication[];
}

/* =========================
   PREFERENCIAS / AJUSTES
   ========================= */
export type ThemeMode = "light" | "dark" | "system";
export interface NotificationPrefs {
  enablePush: boolean;
  enableSound: boolean;
  morningHour?: number; // 6..11
  nightHour?: number; // 18..22
}

export interface AppSettings {
  theme: ThemeMode;
  language?: "es" | "en";
  notifications: NotificationPrefs;
}

/* =========================
   UI: PROPS COMPARTIDAS
   ========================= */
export interface CardProps {
  titulo: string;
  subtitulo?: string;
  onPress?: () => void;
  icono?: string;
  imagen?: ImageSourcePropType;
}

export interface ModalProps {
  visible: boolean;
  onClose: () => void;
  titulo?: string;
  children?: ReactNode;
}

export interface ListItemProps<T> {
  item: T;
  onPress?: (item: T) => void;
  onEdit?: (item: T) => void;
  onDelete?: (item: T) => void;
}

/* =========================
   CONSTANTES DE ESTILO
   ========================= */
export const COLORS = {
  primary: "#0F766E",
  secondary: "#1DBEDB",
  background: "#f5f5f5",
  surface: "#ffffff",
  error: "#b00020",
  text: "#000000",
  textSecondary: "#777777",
  border: "#E5E7EB",
  accent: "#ff3b30",
} as const;

export const FONT_SIZES = {
  small: 14,
  medium: 16,
  large: 18,
  xlarge: 22,
  xxlarge: 24,
} as const;
