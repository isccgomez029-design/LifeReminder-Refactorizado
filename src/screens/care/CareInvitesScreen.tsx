// src/screens/care/CareInvitesScreen.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Alert,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../config/firebaseConfig";
import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc,
} from "firebase/firestore";

import { offlineAuthService } from "../../services/offline/OfflineAuthService";
import { COLORS } from "../../../types";

export default function CareInvitesScreen() {
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 🔥 Obtener UID real (online u offline)
  const firebaseUser = auth.currentUser;
  const offlineUser = offlineAuthService.getCurrentUser();
  const userId = firebaseUser?.uid || offlineUser?.uid;

  useEffect(() => {
    if (!userId) {
      console.log("⚠️ No hay usuario autenticado (CareInvites)");
      setLoading(false);
      return;
    }

    const ref = collection(db, "careNetwork");
    const q = query(
      ref,
      where("caregiverUid", "==", userId),
      where("status", "==", "pending")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setInvites(list);
        setLoading(false);
      },
      (error) => {
        console.log("❌ Error snapshot invitaciones:", error);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [userId]);

  const acceptInvite = async (invite: any) => {
    try {
      const ref = doc(db, "careNetwork", invite.id);
      await updateDoc(ref, {
        status: "accepted",
        updatedAt: new Date().toISOString(),
      });
      Alert.alert("✔️ Invitación aceptada");
    } catch (e) {
      Alert.alert("Error", "No se pudo aceptar la invitación.");
    }
  };

  const declineInvite = async (invite: any) => {
    try {
      const ref = doc(db, "careNetwork", invite.id);
      await updateDoc(ref, {
        status: "rejected",
        updatedAt: new Date().toISOString(),
      });
      Alert.alert("✔️ Invitación rechazada");
    } catch (e) {
      Alert.alert("Error", "No se pudo rechazar.");
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" />
        <Text>Cargando invitaciones...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {invites.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>No tienes invitaciones pendientes</Text>
        </View>
      ) : (
        <FlatList
          data={invites}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.name}>
                {item.name || "Paciente desconocido"}
              </Text>
              <Text style={styles.phone}>{item.phone || "Sin teléfono"}</Text>

              <View style={styles.buttons}>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: "#10b981" }]}
                  onPress={() => acceptInvite(item)}
                >
                  <Text style={styles.btnText}>Aceptar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: "#ef4444" }]}
                  onPress={() => declineInvite(item)}
                >
                  <Text style={styles.btnText}>Rechazar</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { fontSize: 16, color: COLORS.textSecondary },

  card: {
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
    elevation: 2,
  },
  name: { fontSize: 18, fontWeight: "bold" },
  phone: { fontSize: 14, color: "#555" },
  buttons: { flexDirection: "row", marginTop: 10, gap: 8 },
  btn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700" },
});
