// src/navigation/StackNavigator.tsx
import React from "react";
import { createStackNavigator } from "@react-navigation/stack";
import {
  NavigationContainerRef,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { View, Text, Image, StyleSheet } from "react-native";

import LoginScreen from "../screens/auth/LoginScreen";
import ForgotPasswordScreen from "../screens/auth/ForgotPasswordScreen";
import ResetPasswordScreen from "../screens/auth/ResetPasswordScreen";
import RegisterScreen from "../screens/auth/RegisterScreen";

import HomeScreen from "../screens/home/HomeScreen";

import MedsTodayScreen from "../screens/meds/MedsTodayScreen";
import AddMedicationScreen from "../screens/meds/AddMedicationScreen";

import NewReminderScreen from "../screens/reminders/NewReminderScreen";
import AddHabitScreen from "../screens/reminders/AddHabitScreen";

import AppointmentsScreen from "../screens/appointments/AppointmentsScreen";
import AddAppointmentScreen from "../screens/appointments/AddAppointmentScreen";

import HistoryScreen from "../screens/history/HistoryScreen";

import CareNetworkScreen from "../screens/care/CareNetworkScreen";
import CareInvitesScreen from "../screens/care/CareInvitesScreen";
import MyPatientsScreen from "../screens/care/MyPatientsScreen";

import SettingsScreen from "../screens/settings/SettingsScreen";
import ProfileScreen from "../screens/profile/ProfileScreen";

import AlarmScreen from "../screens/alarm/AlarmScreen";

import UserMenuButton from "../components/userMenuButton";
import { COLORS, FONT_SIZES } from "../../types";

/* ====================================================
   NAVIGATION REF
==================================================== */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/* ====================================================
   Tipos auxiliares
==================================================== */

export type AppointmentParam = {
  id?: string;
  title: string;
  doctor?: string;
  location?: string;
  date: string;
  time?: string;
  eventId?: string;
};

export type Habit = {
  id?: string;
  name: string;
  icon?: string;
  lib?: "MaterialIcons" | "FontAwesome5";
  priority?: "baja" | "normal" | "alta";
  days?: number[];
  times?: string[];
};

/* ====================================================
   RootStackParamList CORREGIDO PARA PACIENTES
==================================================== */

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  ResetPassword: { email: string } | undefined;

  Home: undefined;

  // 🧪 Meds con soporte para cuidadores
  MedsToday:
    | {
        patientUid?: string;
        patientName?: string;
      }
    | undefined;

  // 🧪 Hábitos con soporte para cuidadores
  NewReminder:
    | {
        patientUid?: string;
        patientName?: string;
      }
    | undefined;

  AddHabit: {
    mode: "new" | "edit";
    habit?: Habit;
    patientUid?: string;
    patientName?: string;
  };

  // 🧪 Citas con soporte completo
  Appointments:
    | {
        action?: "create" | "edit";
        savedAppt?: AppointmentParam;
        editedAppt?: AppointmentParam;

        patientUid?: string;
        patientName?: string;
      }
    | undefined;

  AddAppointment:
    | {
        mode?: "new" | "edit";
        appt?: AppointmentParam;

        patientUid?: string;
        patientName?: string;
      }
    | undefined;

  // 🧪 Medicamentos con soporte para cuidador
  AddMedication:
    | {
        medId?: string;
        initialData?: {
          nombre: string;
          frecuencia: string;
          dosis: string;
          proximaToma?: string;
          cantidad?: number;
        };

        patientUid?: string;
        patientName?: string;
      }
    | undefined;

  // 🧪 Historial para cuidadores
  History:
    | {
        patientUid?: string;
        patientName?: string;
      }
    | undefined;

  CareNetwork: undefined;
  CareInvites: undefined;
  MyPatients: undefined;

  Settings: undefined;
  Profile: undefined;

  Alarm: {
    type: "med" | "habit";
    title: string;
    message?: string;
    imageUri?: string;
    doseLabel?: string;
    habitIcon?: string;
    habitLib?: "MaterialIcons" | "FontAwesome5";
  };
};

const Stack = createStackNavigator<RootStackParamList>();

/* ====================================================
   Logo del header
==================================================== */
const logoImg = require("../../assets/login_image.png");

function LogoTitle() {
  return (
    <View style={headerStyles.logoTitle}>
      <Text style={headerStyles.logoText}>LifeReminder</Text>
      <Image source={logoImg} style={headerStyles.logoIcon} />
    </View>
  );
}

/* ====================================================
   STACK NAVIGATOR COMPLETO
==================================================== */

export default function StackNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Login"
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.primary },
        headerTintColor: "#fff",
        headerTitleAlign: "left",
        headerTitle: () => <LogoTitle />,
        headerRight: () => <UserMenuButton />,
        headerRightContainerStyle: { paddingRight: 12 },
      }}
    >
      {/* ===== AUTH (sin header) ===== */}
      <Stack.Screen
        name="Login"
        component={LoginScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Register"
        component={RegisterScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ForgotPassword"
        component={ForgotPasswordScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ResetPassword"
        component={ResetPasswordScreen}
        options={{ headerShown: false }}
      />

      {/* ===== APP ===== */}
      <Stack.Screen name="Home" component={HomeScreen} />

      <Stack.Screen
        name="MedsToday"
        component={MedsTodayScreen}
        options={{ title: "Medicación de hoy" }}
      />

      <Stack.Screen
        name="AddMedication"
        component={AddMedicationScreen}
        options={{ title: "Medicamento" }}
      />

      <Stack.Screen
        name="NewReminder"
        component={NewReminderScreen}
        options={{ title: "Hábitos y recordatorios" }}
      />
      <Stack.Screen
        name="AddHabit"
        component={AddHabitScreen}
        options={{ title: "Nuevo hábito" }}
      />

      <Stack.Screen
        name="Appointments"
        component={AppointmentsScreen}
        options={{ title: "Citas médicas" }}
      />

      <Stack.Screen
        name="AddAppointment"
        component={AddAppointmentScreen}
        options={{ title: "Nueva cita" }}
      />

      <Stack.Screen
        name="History"
        component={HistoryScreen}
        options={{ title: "Historial" }}
      />

      <Stack.Screen
        name="CareNetwork"
        component={CareNetworkScreen}
        options={{ title: "Red de apoyo" }}
      />

      <Stack.Screen
        name="MyPatients"
        component={MyPatientsScreen}
        options={{ title: "Mis pacientes" }}
      />

      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: "Configuración" }}
      />

      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: "Perfil" }}
      />

      {/* 🔔 Pantalla de alarma */}
      <Stack.Screen
        name="Alarm"
        component={AlarmScreen}
        options={{
          headerShown: false,
          presentation: "modal",
          gestureEnabled: false,
          cardStyle: { backgroundColor: "black" },
        }}
      />

      <Stack.Screen
        name="CareInvites"
        component={CareInvitesScreen}
        options={{ title: "Invitaciones de cuidado" }}
      />
    </Stack.Navigator>
  );
}

/* ====================================================
   Estilos header
==================================================== */
const headerStyles = StyleSheet.create({
  logoTitle: {
    flexDirection: "row",
    alignItems: "center",
  },
  logoText: {
    color: "#fff",
    fontSize: FONT_SIZES.xlarge ?? 22,
    fontWeight: "800",
  },
  logoIcon: {
    width: 26,
    height: 26,
    marginLeft: 8,
  },
});
