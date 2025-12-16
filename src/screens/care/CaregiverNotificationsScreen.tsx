// src/screens/care/CaregiverNotificationsScreen.tsx
// ✅ REFACTORIZADA: Solo UI, lógica en hooks y servicios

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { COLORS, FONT_SIZES } from "../../../types";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";

// 🎯 Hook personalizado con toda la lógica
import { useCaregiverNotifications } from "../../hooks/useCaregiverHooks";
import {
  getSeverityColor,
  formatNotificationDate,
  type CareNotification,
} from "../../services/Notifications";

type Nav = StackNavigationProp<RootStackParamList, "CareInvites">;

interface Props {
  navigation: Nav;
}

export default function CaregiverNotificationsScreen({ navigation }: Props) {
  // 🎯 Toda la lógica viene del hook
  const {
    notifications,
    loading,
    refreshing,
    unreadCount,
    onRefresh,
    markAsRead,
  } = useCaregiverNotifications();

  /* =========================================
   *           🎨 RENDER HELPERS
   * ========================================= */

  const renderNotification = (notif: CareNotification) => {
    const severityColor = getSeverityColor(notif.severity);

    return (
      <TouchableOpacity
        key={notif.id}
        style={[styles.notifCard, !notif.read && styles.notifCardUnread]}
        onPress={() => markAsRead(notif.id)}
        activeOpacity={0.7}
      >
        <View style={styles.notifHeader}>
          <View
            style={[
              styles.severityIndicator,
              { backgroundColor: severityColor },
            ]}
          />

          <View style={{ flex: 1 }}>
            <Text style={styles.notifTitle}>{notif.title}</Text>
            <Text style={styles.notifMessage}>{notif.message}</Text>

            <View style={styles.notifMeta}>
              <MaterialIcons
                name="person"
                size={14}
                color={COLORS.textSecondary}
              />
              <Text style={styles.notifMetaText}>{notif.patientName}</Text>

              <MaterialIcons
                name="access-time"
                size={14}
                color={COLORS.textSecondary}
                style={{ marginLeft: 12 }}
              />
              <Text style={styles.notifMetaText}>
                {formatNotificationDate(notif.createdAt)}
              </Text>
            </View>
          </View>

          {!notif.read && <View style={styles.unreadDot} />}
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyCard}>
      <MaterialIcons
        name="notifications-none"
        size={48}
        color={COLORS.textSecondary}
      />
      <Text style={styles.emptyTitle}>Sin notificaciones</Text>
      <Text style={styles.emptyText}>
        Aquí aparecerán las alertas de tus pacientes
      </Text>
    </View>
  );

  const renderLoading = () => (
    <Text style={styles.emptyText}>Cargando notificaciones...</Text>
  );

  /* =========================================
   *              🎨 RENDER MAIN
   * ========================================= */

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Notificaciones</Text>
            {unreadCount > 0 && (
              <Text style={styles.subtitle}>
                {unreadCount} {unreadCount === 1 ? "nueva" : "nuevas"}
              </Text>
            )}
          </View>

          <View style={styles.sectionIcon}>
            <MaterialIcons
              name="notifications"
              size={24}
              color={COLORS.surface}
            />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Content */}
        {loading
          ? renderLoading()
          : notifications.length === 0
          ? renderEmpty()
          : notifications.map(renderNotification)}
      </ScrollView>
    </SafeAreaView>
  );
}

/* =========================================
 *              🎨 STYLES
 * ========================================= */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 24 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: FONT_SIZES.xlarge,
    fontWeight: "800",
    color: COLORS.text,
  },
  subtitle: {
    marginTop: 4,
    fontSize: FONT_SIZES.medium,
    color: COLORS.secondary,
    fontWeight: "600",
  },
  sectionIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.secondary,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: "#D32F2F",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },

  notifCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 10,
  },
  notifCardUnread: {
    borderColor: COLORS.secondary,
    borderWidth: 2,
    backgroundColor: "#F8FAFC",
  },
  notifHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  severityIndicator: {
    width: 4,
    height: "100%",
    borderRadius: 2,
    minHeight: 40,
  },
  notifTitle: {
    fontSize: FONT_SIZES.medium,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 4,
  },
  notifMessage: {
    fontSize: FONT_SIZES.small,
    color: COLORS.text,
    lineHeight: 20,
    marginBottom: 8,
  },
  notifMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  notifMetaText: {
    fontSize: FONT_SIZES.small,
    color: COLORS.textSecondary,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.secondary,
  },

  emptyCard: {
    marginTop: 40,
    alignItems: "center",
    padding: 20,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: "700",
    color: COLORS.text,
    marginTop: 12,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: FONT_SIZES.small,
    color: COLORS.textSecondary,
    textAlign: "center",
  },
});
