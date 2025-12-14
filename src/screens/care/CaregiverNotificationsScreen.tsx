// src/screens/care/CaregiverNotificationsScreen.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { COLORS, FONT_SIZES } from "../../../types";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";

// Firebase
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
  limit,
} from "firebase/firestore";
import { auth, db } from "../../config/firebaseConfig";

type Nav = StackNavigationProp<RootStackParamList, "CareInvites">;

type CareNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  patientUid: string;
  patientName: string;
  itemType: "med" | "habit";
  itemName: string;
  snoozeCount: number;
  severity: "low" | "medium" | "high";
  read: boolean;
  createdAt: any;
};

export default function CaregiverNotificationsScreen({
  navigation,
}: {
  navigation: Nav;
}) {
  const [notifications, setNotifications] = useState<CareNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const user = auth.currentUser;

  const loadNotifications = () => {
    if (!user) {
      setLoading(false);
      return;
    }

    const notifRef = collection(db, "users", user.uid, "notifications");
    const q = query(notifRef, orderBy("createdAt", "desc"), limit(50));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: CareNotification[] = snapshot.docs.map((doc) => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            type: data.type || "noncompliance",
            title: data.title || "Notificación",
            message: data.message || "",
            patientUid: data.patientUid || "",
            patientName: data.patientName || "Paciente",
            itemType: data.itemType || "med",
            itemName: data.itemName || "",
            snoozeCount: data.snoozeCount || 0,
            severity: data.severity || "medium",
            read: !!data.read,
            createdAt: data.createdAt,
          };
        });

        setNotifications(list);
        setLoading(false);
        setRefreshing(false);
      },
      (error) => {
        console.error("Error cargando notificaciones:", error);
        setLoading(false);
        setRefreshing(false);
        Alert.alert("Error", "No se pudieron cargar las notificaciones");
      }
    );

    return unsubscribe;
  };

  useEffect(() => {
    const unsubscribe = loadNotifications();
    return unsubscribe;
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    loadNotifications();
  };

  const markAsRead = async (notifId: string) => {
    if (!user) return;

    try {
      const notifRef = doc(db, "users", user.uid, "notifications", notifId);
      await updateDoc(notifRef, { read: true });
    } catch (error) {
      console.error("Error marcando como leída:", error);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "high":
        return "#D32F2F";
      case "medium":
        return "#FFA726";
      case "low":
        return "#66BB6A";
      default:
        return COLORS.textSecondary;
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return "";

    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) return "Ahora mismo";
      if (diffMins < 60) return `Hace ${diffMins} min`;
      if (diffMins < 1440) return `Hace ${Math.floor(diffMins / 60)} h`;

      return date.toLocaleDateString("es-MX", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

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
                {formatDate(notif.createdAt)}
              </Text>
            </View>
          </View>

          {!notif.read && <View style={styles.unreadDot} />}
        </View>
      </TouchableOpacity>
    );
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

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

        {loading ? (
          <Text style={styles.emptyText}>Cargando notificaciones...</Text>
        ) : notifications.length === 0 ? (
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
        ) : (
          notifications.map(renderNotification)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

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
