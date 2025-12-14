// src/screens/care/MyPatientsScreen.tsx

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import { COLORS, FONT_SIZES } from "../../../types";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";

// Firebase
import {
  collectionGroup,
  onSnapshot,
  query,
  where,
  doc,
  getDoc,
} from "firebase/firestore";
import { auth, db } from "../../config/firebaseConfig";

import { syncQueueService } from "../../services/offline/SyncQueueService";

type Nav = StackNavigationProp<RootStackParamList, "MyPatients">;

type PatientLink = {
  id: string;
  path: string;
  ownerUid: string;
  ownerName: string;
  relationship?: string;
  accessMode?: string;
};

export default function MyPatientsScreen({ navigation }: { navigation: Nav }) {
  const [patients, setPatients] = useState<PatientLink[]>([]);
  const [profilePhotos, setProfilePhotos] = useState<Record<string, string>>(
    {}
  );

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert(
        "Sesión requerida",
        "Debes iniciar sesión para ver tus pacientes."
      );
      return;
    }

    const q = query(
      collectionGroup(db, "careNetwork"),
      where("caregiverUid", "==", user.uid),
      where("status", "==", "accepted"),
      where("deleted", "==", false)
    );

    const unsub = onSnapshot(
      q,
      async (snap) => {
        const list: PatientLink[] = snap.docs.map((d) => {
          const data = d.data() as any;
          const path = d.ref.path;
          const segments = path.split("/");
          const ownerUid = segments[1] ?? data.ownerUid ?? "";

          const ownerName =
            data.ownerName ||
            data.name ||
            data.ownerEmail ||
            data.email ||
            "Paciente sin nombre";

          return {
            id: d.id,
            path,
            ownerUid,
            ownerName,
            relationship: data.relationship ?? "",
            accessMode: data.accessMode ?? "alerts-only",
          };
        });

        // Ordenar por nombre
        list.sort((a, b) => a.ownerName.localeCompare(b.ownerName, "es"));

        setPatients(list);

        // 🔥 Cargar fotos de perfil de cada paciente
        loadPhotos(list);
      },
      (err) => {
        console.log("Error cargando pacientes:", err);
        Alert.alert("Error", "No se pudieron cargar tus pacientes.");
      }
    );

    return unsub;
  }, []);

  /** ===========================================
   *   🖼 Cargar foto de perfil (Firestore + Offline)
   *  ===========================================*/
  const loadPhotos = async (patientList: PatientLink[]) => {
    const newPhotos: Record<string, string> = {};

    for (const p of patientList) {
      try {
        // 1) Intentar cargar desde cache offline
        const cached = await syncQueueService.getFromCache(
          "profile",
          p.ownerUid
        );
        if (Array.isArray(cached?.data) && cached.data.length > 0) {
          const photo = cached.data[0].photoUri;
          if (photo) {
            newPhotos[p.ownerUid] = photo;
            continue;
          }
        }

        // 2) Si no hay cache → Firestore
        const userRef = doc(db, "users", p.ownerUid);
        const snap = await getDoc(userRef);

        if (snap.exists()) {
          const data: any = snap.data();
          if (data.photoUri) {
            newPhotos[p.ownerUid] = data.photoUri;

            await syncQueueService.saveToCache("profile", p.ownerUid, [
              { id: p.ownerUid, ...data },
            ]);
          }
        }
      } catch (e) {
        console.log("⚠️ Error cargando foto de paciente", p.ownerUid, e);
      }
    }

    setProfilePhotos((prev) => ({ ...prev, ...newPhotos }));
  };

  const goToPatient = (p: PatientLink, screen: keyof RootStackParamList) => {
    navigation.navigate(
      screen as any,
      {
        patientUid: p.ownerUid,
        patientName: p.ownerName,
      } as any
    );
  };

  /** ===========================================
   *   Render card del paciente
   *  ===========================================*/
  const renderPatientCard = (p: PatientLink) => {
    const photoUri = profilePhotos[p.ownerUid];
    const accessLabel =
      p.accessMode === "full"
        ? "Acceso completo"
        : p.accessMode === "read-only"
        ? "Solo lectura"
        : p.accessMode === "alerts-only"
        ? "Solo alertas"
        : "Desactivado";

    return (
      <View key={p.path} style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.iconCircle}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatar} />
            ) : (
              <FontAwesome5 name="user" size={18} color={COLORS.surface} />
            )}
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{p.ownerName}</Text>
            {!!p.relationship && (
              <Text style={styles.cardSubtitle}>
                Parentesco: {p.relationship}
              </Text>
            )}
            <Text style={styles.cardSubtitle}>Permisos: {accessLabel}</Text>
          </View>
        </View>

        {/* Botones */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.primaryBtn]}
            onPress={() => goToPatient(p, "MedsToday")}
          >
            <Text style={styles.actionText}>Medicación</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.primaryBtn]}
            onPress={() => goToPatient(p, "Appointments")}
          >
            <Text style={styles.actionText}>Citas</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.primaryBtn]}
            onPress={() => goToPatient(p, "NewReminder")}
          >
            <Text style={styles.actionText}>Hábitos</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.secondaryBtn]}
            onPress={() => goToPatient(p, "History")}
          >
            <Text style={styles.secondaryText}>Historial</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Mis pacientes</Text>
            <Text style={styles.subtitle}>
              Consulta la información de los pacientes que te han agregado como
              parte de su red de apoyo.
            </Text>
          </View>
          <View style={styles.sectionIcon}>
            <MaterialIcons
              name="supervisor-account"
              size={24}
              color={COLORS.surface}
            />
          </View>
        </View>

        {patients.length === 0 ? (
          <Text style={styles.emptyText}>
            Aún no tienes pacientes asignados.
          </Text>
        ) : (
          patients.map(renderPatientCard)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ===== ESTILOS ===== */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1 },
  content: { padding: 10, paddingBottom: 24 },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  title: { fontSize: FONT_SIZES.xlarge, fontWeight: "800", color: COLORS.text },
  subtitle: {
    marginTop: 4,
    fontSize: FONT_SIZES.medium,
    color: COLORS.textSecondary,
  },
  sectionIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.secondary,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },

  emptyText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.small,
    marginTop: 8,
  },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginTop: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    overflow: "hidden",
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  cardTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: "800",
    color: COLORS.text,
  },
  cardSubtitle: {
    fontSize: FONT_SIZES.small,
    color: COLORS.textSecondary,
  },

  actionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: { backgroundColor: COLORS.primary },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surface,
  },
  actionText: {
    color: COLORS.surface,
    fontWeight: "800",
    fontSize: FONT_SIZES.medium,
  },
  secondaryText: {
    color: COLORS.primary,
    fontWeight: "800",
    fontSize: FONT_SIZES.medium,
  },
});
