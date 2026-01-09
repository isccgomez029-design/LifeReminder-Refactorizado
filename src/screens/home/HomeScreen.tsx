// src/screens/home/HomeScreen.tsx

import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Dimensions,
} from "react-native";
import { MaterialIcons, FontAwesome5, Entypo } from "@expo/vector-icons";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";
import { COLORS, FONT_SIZES } from "../../../types";
import { SafeAreaView } from "react-native-safe-area-context";

type HomeNav = StackNavigationProp<RootStackParamList, "Home">;

// 👉 Rutas a las que puedes ir directamente desde Home (sin params)
type MainSectionRoute =
  | "MedsToday"
  | "NewReminder"
  | "Appointments"
  | "History"
  | "CareNetwork"
  | "MyPatients";

type SectionItem = {
  key: string;
  title: string;
  subtitle?: string;
  iconLib: "MaterialIcons" | "FontAwesome5" | "Entypo";
  iconName: string;
  color: string;
  route: MainSectionRoute;
};

const SECTIONS: SectionItem[] = [
  {
    key: "meds_today",
    title: "Medicación",
    subtitle: "Dosis pendientes",
    iconLib: "FontAwesome5",
    iconName: "pills",
    color: COLORS.primary,
    route: "MedsToday",
  },
  {
    key: "new_reminder",
    title: "Hábitos",
    subtitle: "Rutinas diarias",
    iconLib: "MaterialIcons",
    iconName: "add-alert",
    color: COLORS.secondary,
    route: "NewReminder",
  },
  {
    key: "appointments",
    title: "Citas médicas",
    subtitle: "Próximas citas",
    iconLib: "MaterialIcons",
    iconName: "event",
    color: COLORS.secondary,
    route: "Appointments",
  },
  {
    key: "history",
    title: "Historial",
    subtitle: "Registros pasados",
    iconLib: "MaterialIcons",
    iconName: "history",
    color: COLORS.primary,
    route: "History",
  },
  {
    key: "care_network",
    title: "Red de apoyo",
    subtitle: "Familia y cuidadores",
    iconLib: "FontAwesome5",
    iconName: "users",
    color: COLORS.primary,
    route: "CareNetwork",
  },

  {
    key: "my_patients",
    title: "Mis pacientes",
    subtitle: "Gestionar pacientes",
    iconLib: "MaterialIcons",
    iconName: "supervisor-account",
    color: COLORS.secondary,
    route: "MyPatients",
  },
];

export default function HomeScreen({ navigation }: { navigation: HomeNav }) {
  const data = useMemo(() => SECTIONS, []);

  const renderItem = ({ item }: { item: SectionItem }) => {
    const IconCmp =
      item.iconLib === "MaterialIcons"
        ? MaterialIcons
        : item.iconLib === "FontAwesome5"
        ? FontAwesome5
        : Entypo;

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => navigation.navigate(item.route)}
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={item.title}
      >
        <View style={[styles.iconWrap, { backgroundColor: item.color }]}>
          <IconCmp
            name={item.iconName as any}
            size={20}
            color={COLORS.surface}
          />
        </View>

        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.title}
        </Text>

        {!!item.subtitle && (
          <Text style={styles.cardSubtitle} numberOfLines={2}>
            {item.subtitle}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={data}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        numColumns={2}
        showsVerticalScrollIndicator={false}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.gridContent}
        style={styles.gridList}
      />
    </SafeAreaView>
  );
}

const { width: W, height: H } = Dimensions.get("window");
const SCREEN_PADDING = 16;
const GUTTER = 16;
const CARD_WIDTH = (W - SCREEN_PADDING * 2 - GUTTER) / 2;
const CARD_HEIGHT = 150;

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  menuContainer: {
    position: "absolute",
    top: "100%",
    right: 10,
    marginTop: 10,
    width: 210,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
    paddingVertical: 6,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  menuIcon: {
    marginRight: 8,
  },
  menuText: {
    fontSize: FONT_SIZES.medium || 16,
    color: COLORS.text,
    fontWeight: "600",
  },
  menuDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 6,
  },
  menuDanger: {},
  menuDangerText: {
    color: "#c62828",
  },

  /* ===== Grid ===== */
  gridList: { flex: 1 },
  gridContent: {
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: 18,
    paddingBottom: 28,
    minHeight: H,
  },
  row: {
    justifyContent: "space-between",
    marginBottom: 22,
  },

  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  iconWrap: {
    width: 55,
    height: 55,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZES.medium + 1 || 17,
    fontWeight: "800",
    lineHeight: 20,
  },
  cardSubtitle: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.small || 13,
    lineHeight: 17,
    marginTop: 4,
  },
});
