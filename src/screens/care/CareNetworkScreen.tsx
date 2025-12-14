// src/screens/care/CareNetworkScreen.tsx
// ✅ CORREGIDO: Soporte offline completo

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../navigation/StackNavigator";
import { COLORS, FONT_SIZES } from "../../../types";

// Firebase
import { auth, db } from "../../config/firebaseConfig";
import {
  collection,
  addDoc,
  doc,
  onSnapshot,
  query,
  where,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";

// ✅ NUEVO: Soporte offline
import { offlineAuthService } from "../../services/offline/OfflineAuthService";
import { syncQueueService } from "../../services/offline/SyncQueueService";
import { OfflineBanner } from "../../components/OfflineBanner";
import NetInfo from "@react-native-community/netinfo";

type Nav = StackNavigationProp<RootStackParamList, "CareNetwork">;

/** ========= Tipos base ========= */

type CaregiverStatus = "pending" | "accepted" | "rejected";
type AccessMode = "full" | "read-only" | "alerts-only" | "disabled";

type Caregiver = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  relationship?: string;
  status: CaregiverStatus;
  accessMode: AccessMode;
  createdAt?: string;
};

/** ========= Helpers de UI ========= */

const statusLabelAndColor: Record<
  CaregiverStatus,
  { label: string; color: string }
> = {
  pending: { label: "Pendiente", color: "#F59E0B" },
  accepted: { label: "Activo", color: "#10B981" },
  rejected: { label: "Rechazado", color: "#EF4444" },
};

const accessModeOptions: { key: AccessMode; label: string; desc: string }[] = [
  {
    key: "full",
    label: "Acceso completo",
    desc: "Puede ver todo y proponer cambios",
  },
  {
    key: "read-only",
    label: "Solo lectura",
    desc: "Solo puede ver información",
  },
  {
    key: "alerts-only",
    label: "Solo alertas",
    desc: "Solo recibe avisos de omisión",
  },
  {
    key: "disabled",
    label: "Desactivado",
    desc: "Sin acceso ni alertas",
  },
];

/** ========= Pantalla principal ========= */

const CareNetworkScreen: React.FC<{ navigation: Nav }> = ({ navigation }) => {
  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ✅ NUEVO: Estados offline
  const [isOnline, setIsOnline] = useState(true);
  const [pendingChanges, setPendingChanges] = useState(0);
  const [isFromCache, setIsFromCache] = useState(false);

  // Modal para agregar cuidador
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRelationship, setNewRelationship] = useState("");
  const [newAccessMode, setNewAccessMode] = useState<AccessMode>("alerts-only");

  const [saving, setSaving] = useState(false);

  // ✅ CORREGIDO: Obtener UID con soporte offline
  const userId = auth.currentUser?.uid || offlineAuthService.getCurrentUid();

  /** ================ Monitor de conectividad ================ */
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online =
        state.isConnected === true && state.isInternetReachable !== false;
      setIsOnline(online);

      if (online) {
        syncQueueService.processQueue().then(() => {
          syncQueueService.getPendingCount().then(setPendingChanges);
        });
      }
    });

    syncQueueService.getPendingCount().then(setPendingChanges);
    return () => unsubscribe();
  }, []);

  /** ================ Cargar desde cache primero ================ */
  useEffect(() => {
    const loadFromCache = async () => {
      if (!userId) return;

      try {
        const cached = await syncQueueService.getFromCache<any>(
          "careNetwork",
          userId
        );

        if (cached?.data && cached.data.length > 0) {
          console.log("📦 CareNetwork desde cache:", cached.data.length);
          const list = cached.data
            .filter((item: any) => !item.deleted)
            .map((data: any) => ({
              id: data.id,
              name: data.name ?? "",
              email: data.email ?? "",
              phone: data.phone ?? "",
              relationship: data.relationship ?? "",
              status: (data.status as CaregiverStatus) ?? "pending",
              accessMode: (data.accessMode as AccessMode) ?? "alerts-only",
              createdAt: data.createdAt ?? null,
            }));

          // Ordenar
          list.sort((a: Caregiver, b: Caregiver) => {
            const orderStatus = (s: CaregiverStatus) =>
              s === "accepted" ? 0 : s === "pending" ? 1 : 2;
            const s1 = orderStatus(a.status);
            const s2 = orderStatus(b.status);
            if (s1 !== s2) return s1 - s2;
            return (a.name || "").localeCompare(b.name || "");
          });

          setCaregivers(list);
          setIsFromCache(true);
          setLoading(false);
        }
      } catch (error) {
        console.log("Error cache careNetwork:", error);
      }
    };

    loadFromCache();
  }, [userId]);

  /** ================ Escuchar lista de cuidadores en Firestore ================ */
  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const ref = collection(db, "users", userId, "careNetwork");
    const q = query(ref, where("deleted", "==", false));

    const unsub = onSnapshot(
      q,
      async (snap) => {
        const list: Caregiver[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: data.name ?? "",
            email: data.email ?? "",
            phone: data.phone ?? "",
            relationship: data.relationship ?? "",
            status: (data.status as CaregiverStatus) ?? "pending",
            accessMode: (data.accessMode as AccessMode) ?? "alerts-only",
            createdAt: data.createdAt ?? null,
          };
        });

        // Ordenar
        list.sort((a, b) => {
          const orderStatus = (s: CaregiverStatus) =>
            s === "accepted" ? 0 : s === "pending" ? 1 : 2;
          const s1 = orderStatus(a.status);
          const s2 = orderStatus(b.status);
          if (s1 !== s2) return s1 - s2;
          return (a.name || "").localeCompare(b.name || "");
        });

        // ✅ Guardar en cache
        await syncQueueService.saveToCache("careNetwork", userId, list);

        setCaregivers(list);
        setIsFromCache(false);
        setLoading(false);
      },
      (err) => {
        console.log("Error cargando red de apoyo:", err);
        // Si hay error de red, mantener datos del cache
        if (!isOnline) {
          setLoading(false);
        } else {
          Alert.alert(
            "Error",
            "No se pudieron cargar tus contactos de red de apoyo."
          );
          setLoading(false);
        }
      }
    );

    return unsub;
  }, [userId, isOnline]);

  /** ================ Agregar nuevo cuidador ================ */
  const handleOpenAdd = () => {
    setNewName("");
    setNewEmail("");
    setNewPhone("");
    setNewRelationship("");
    setNewAccessMode("alerts-only");
    setShowAddModal(true);
  };

  const handleSaveNewCaregiver = async () => {
    if (!userId) {
      Alert.alert("Sesión requerida", "Inicia sesión de nuevo.");
      return;
    }

    if (!newName.trim() || !newEmail.trim()) {
      Alert.alert(
        "Falta información",
        "Nombre y correo electrónico son obligatorios."
      );
      return;
    }

    try {
      setSaving(true);

      const newCaregiver = {
        name: newName.trim(),
        email: newEmail.trim().toLowerCase(),
        phone: newPhone.trim() || "",
        relationship: newRelationship.trim() || "",
        status: "pending" as CaregiverStatus,
        accessMode: newAccessMode,
        deleted: false,
        createdAt: new Date().toISOString(),
      };

      if (isOnline) {
        // Online: crear directamente en Firebase
        await addDoc(collection(db, "users", userId, "careNetwork"), {
          ...newCaregiver,
          createdAt: serverTimestamp(),
        });
      } else {
        // ✅ Offline: encolar operación
        const tempId = `temp_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;

        await syncQueueService.enqueue(
          "CREATE",
          "careNetwork",
          tempId,
          userId,
          {
            ...newCaregiver,
            id: tempId,
          }
        );

        // Agregar a cache local
        await syncQueueService.addToCacheItem("careNetwork", userId, {
          ...newCaregiver,
          id: tempId,
        });

        // Actualizar UI
        setCaregivers((prev) => [
          ...prev,
          { ...newCaregiver, id: tempId } as Caregiver,
        ]);

        setPendingChanges(await syncQueueService.getPendingCount());
      }

      setShowAddModal(false);
      Alert.alert(
        "Listo",
        isOnline
          ? "Se agregó el contacto y la invitación quedó pendiente."
          : "Se guardará cuando haya conexión."
      );
    } catch (e: any) {
      console.log("Error agregando cuidador:", e);
      Alert.alert(
        "Error",
        e?.message ?? "No se pudo agregar el contacto. Intenta nuevamente."
      );
    } finally {
      setSaving(false);
    }
  };

  /** ================ Cambiar modo de acceso ================ */
  const handleChangeAccessMode = async (id: string, mode: AccessMode) => {
    if (!userId) return;
    const cg = caregivers.find((c) => c.id === id);
    if (!cg) return;

    // Optimistic update
    setCaregivers((prev) =>
      prev.map((c) => (c.id === id ? { ...c, accessMode: mode } : c))
    );

    try {
      if (isOnline && !id.startsWith("temp_")) {
        await updateDoc(doc(db, "users", userId, "careNetwork", id), {
          accessMode: mode,
          updatedAt: serverTimestamp(),
        });
      } else {
        // ✅ Offline: encolar
        await syncQueueService.enqueue("UPDATE", "careNetwork", id, userId, {
          accessMode: mode,
          updatedAt: new Date().toISOString(),
        });

        await syncQueueService.updateCacheItem("careNetwork", userId, id, {
          accessMode: mode,
        });

        setPendingChanges(await syncQueueService.getPendingCount());
      }
    } catch (e: any) {
      console.log("Error actualizando accessMode:", e);
      // Revertir
      setCaregivers((prev) =>
        prev.map((c) => (c.id === id ? { ...c, accessMode: cg.accessMode } : c))
      );
      Alert.alert(
        "Error",
        e?.message ?? "No se pudieron actualizar los permisos."
      );
    }
  };

  /** ================ Eliminar (soft-delete) cuidador ================ */
  const handleRemoveCaregiver = (id: string) => {
    const cg = caregivers.find((c) => c.id === id);
    if (!userId || !cg) return;

    Alert.alert(
      "Eliminar contacto",
      `¿Seguro que deseas eliminar a "${
        cg.name || cg.email
      }" de tu red de apoyo?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            // Optimistic update
            setCaregivers((prev) => prev.filter((c) => c.id !== id));
            if (selectedId === id) setSelectedId(null);

            try {
              if (isOnline && !id.startsWith("temp_")) {
                await updateDoc(doc(db, "users", userId, "careNetwork", id), {
                  deleted: true,
                  deletedAt: serverTimestamp(),
                });
              } else {
                // ✅ Offline: encolar
                await syncQueueService.enqueue(
                  "UPDATE",
                  "careNetwork",
                  id,
                  userId,
                  {
                    deleted: true,
                    deletedAt: new Date().toISOString(),
                  }
                );

                await syncQueueService.updateCacheItem(
                  "careNetwork",
                  userId,
                  id,
                  { deleted: true }
                );

                setPendingChanges(await syncQueueService.getPendingCount());
              }
            } catch (e: any) {
              console.log("Error eliminando cuidador:", e);
              // Revertir
              setCaregivers((prev) => [...prev, cg]);
              Alert.alert(
                "Error",
                e?.message ?? "No se pudo eliminar el contacto."
              );
            }
          },
        },
      ]
    );
  };

  /** ================ Renderizar cuidador ================ */
  const renderCaregiver = (cg: Caregiver) => {
    const isSelected = selectedId === cg.id;
    const statusInfo = statusLabelAndColor[cg.status];
    const isPending = cg.id.startsWith("temp_");

    return (
      <TouchableOpacity
        key={cg.id}
        style={[styles.card, isSelected && styles.cardSelected]}
        activeOpacity={0.9}
        onPress={() => setSelectedId((prev) => (prev === cg.id ? null : cg.id))}
      >
        {/* Encabezado: nombre + icono + status */}
        <View style={styles.cardHeaderRow}>
          <View style={styles.iconTitleRow}>
            <View style={styles.iconCircle}>
              <FontAwesome5 name="user-friends" size={16} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{cg.name || "Sin nombre"}</Text>

              {!!cg.relationship && (
                <Text style={styles.cardSubtitle}>
                  Parentesco: {cg.relationship}
                </Text>
              )}

              <Text style={styles.cardSubtitle}>{cg.email}</Text>
              {!!cg.phone && (
                <Text style={styles.cardSubtitle}>Tel: {cg.phone}</Text>
              )}
            </View>
          </View>

          <View
            style={[
              styles.statusPill,
              { backgroundColor: statusInfo.color || COLORS.secondary },
            ]}
          >
            <Text style={styles.statusPillText}>{statusInfo.label}</Text>
          </View>
        </View>

        {/* Permisos / accessMode */}
        <View style={styles.accessBlock}>
          <Text style={styles.accessTitle}>Permisos</Text>
          <Text style={styles.accessHint}>
            Elige qué puede hacer este contacto en tu cuenta.
          </Text>

          <View style={styles.accessRow}>
            {accessModeOptions.map((opt) => {
              const active = cg.accessMode === opt.key;
              const disabled = false;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.accessChip,
                    active && styles.accessChipActive,
                    disabled && styles.accessChipDisabled,
                  ]}
                  disabled={disabled}
                  onPress={() => handleChangeAccessMode(cg.id, opt.key)}
                >
                  <Text
                    style={[
                      styles.accessChipLabel,
                      active && styles.accessChipLabelActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {cg.status !== "accepted" && (
            <Text style={styles.accessInfoText}>
              Este contacto aún no está activo. Los permisos se aplicarán cuando
              acepte la invitación.
            </Text>
          )}
        </View>

        {/* Botón eliminar */}
        <TouchableOpacity
          style={styles.removeBtn}
          onPress={() => handleRemoveCaregiver(cg.id)}
        >
          <MaterialIcons name="delete-outline" size={18} color="#B91C1C" />
          <Text style={styles.removeBtnText}>Eliminar de mi red de apoyo</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  /** ================ Render principal ================ */

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Encabezado general */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Red de apoyo</Text>
            <Text style={styles.subtitle}>
              Agrega familiares o cuidadores que puedan ayudarte a seguir tus
              citas y medicamentos.
            </Text>
          </View>
          <View style={styles.headerIcon}>
            <MaterialIcons name="groups" size={26} color={COLORS.surface} />
          </View>
        </View>

        {/* Botón para agregar nuevo cuidador */}
        <TouchableOpacity
          style={styles.addBtn}
          onPress={handleOpenAdd}
          activeOpacity={0.9}
        >
          <MaterialIcons name="person-add-alt-1" size={20} color="#fff" />
          <Text style={styles.addBtnText}>Agregar contacto</Text>
        </TouchableOpacity>

        {/* Lista de cuidadores */}
        {caregivers.length === 0 ? (
          <Text style={styles.emptyText}>
            Aún no has agregado contactos a tu red de apoyo. Comienza agregando
            al menos un familiar o cuidador.
          </Text>
        ) : (
          caregivers.map(renderCaregiver)
        )}
      </ScrollView>

      {/* ===== Modal para agregar cuidador ===== */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nuevo contacto</Text>
            <Text style={styles.modalSubtitle}>
              Este contacto podrá recibir invitación para ayudarte con tu
              tratamiento.
            </Text>

            <Text style={styles.modalLabel}>Nombre</Text>
            <TextInput
              style={styles.modalInput}
              value={newName}
              onChangeText={setNewName}
              placeholder="Ej. Mamá, Papá, Espos@"
            />

            <Text style={styles.modalLabel}>Parentesco</Text>
            <TextInput
              style={styles.modalInput}
              value={newRelationship}
              onChangeText={setNewRelationship}
              placeholder="Ej. Madre, Padre, Amigo, Tía..."
            />

            <Text style={styles.modalLabel}>Correo electrónico</Text>
            <TextInput
              style={styles.modalInput}
              value={newEmail}
              onChangeText={setNewEmail}
              placeholder="Ej. cuidador@correo.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.modalLabel}>Teléfono (opcional)</Text>
            <TextInput
              style={styles.modalInput}
              value={newPhone}
              onChangeText={setNewPhone}
              placeholder="Ej. 3511234567"
              keyboardType="phone-pad"
            />

            {/* Permisos iniciales */}
            <Text style={[styles.modalLabel, { marginTop: 10 }]}>
              Permisos iniciales
            </Text>
            <Text style={styles.modalHint}>
              Elige qué podrá hacer este contacto desde el inicio. Podrás
              cambiarlo después.
            </Text>

            <View style={styles.modalAccessRow}>
              {accessModeOptions.map((opt) => {
                const active = newAccessMode === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.modalAccessChip,
                      active && styles.modalAccessChipActive,
                    ]}
                    onPress={() => setNewAccessMode(opt.key)}
                  >
                    <Text
                      style={[
                        styles.modalAccessChipText,
                        active && styles.modalAccessChipTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnSecondary]}
                onPress={() => setShowAddModal(false)}
                disabled={saving}
              >
                <Text style={styles.modalBtnSecondaryText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={handleSaveNewCaregiver}
                disabled={saving}
              >
                <Text style={styles.modalBtnPrimaryText}>
                  {saving ? "Guardando..." : "Guardar"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

/** ========= Estilos ========= */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1 },
  content: { padding: 10, paddingBottom: 24 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: FONT_SIZES.xlarge,
    fontWeight: "800",
    color: COLORS.text,
  },
  subtitle: {
    marginTop: 4,
    fontSize: FONT_SIZES.medium,
    color: COLORS.textSecondary,
  },
  headerIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: COLORS.secondary,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },

  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    marginTop: 4,
    marginBottom: 10,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  addBtnText: {
    color: COLORS.surface,
    fontWeight: "800",
  },

  emptyText: {
    marginTop: 10,
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.small,
  },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginTop: 10,
  },
  cardSelected: {
    borderColor: COLORS.primary,
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  iconTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    flex: 1,
    gap: 10,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
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

  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPillText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
  },

  accessBlock: {
    marginTop: 6,
  },
  accessTitle: {
    fontSize: FONT_SIZES.small,
    fontWeight: "700",
    color: COLORS.text,
  },
  accessHint: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  accessRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  accessChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  accessChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  accessChipDisabled: {
    opacity: 0.4,
  },
  accessChipLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.text,
  },
  accessChipLabelActive: {
    color: COLORS.surface,
  },
  accessInfoText: {
    marginTop: 4,
    fontSize: 11,
    color: COLORS.textSecondary,
  },

  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  removeBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#B91C1C",
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
  },
  modalTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: "800",
    color: COLORS.text,
  },
  modalSubtitle: {
    marginTop: 4,
    fontSize: FONT_SIZES.small,
    color: COLORS.textSecondary,
  },
  modalLabel: {
    marginTop: 10,
    fontSize: FONT_SIZES.small,
    color: COLORS.textSecondary,
  },
  modalInput: {
    marginTop: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
  modalHint: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  modalAccessRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  modalAccessChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  modalAccessChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  modalAccessChipText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.text,
  },
  modalAccessChipTextActive: {
    color: COLORS.surface,
  },
  modalActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 14,
  },
  modalBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  modalBtnSecondary: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  modalBtnSecondaryText: {
    color: COLORS.text,
    fontWeight: "700",
  },
  modalBtnPrimary: {
    backgroundColor: COLORS.primary,
  },
  modalBtnPrimaryText: {
    color: COLORS.surface,
    fontWeight: "800",
  },
});

export default CareNetworkScreen;
