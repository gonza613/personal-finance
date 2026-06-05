import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, FlatList, TextInput, TouchableOpacity, Modal, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { supabase } from '../../src/utils/supabaseClient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

interface Gasto {
  id: string;
  monto: number;
  categoria: string;
  descripcion: string;
  fecha: string;
}

const CATEGORIES = [
  { name: 'Comida', icon: 'restaurant-outline', color: '#F59E0B' },
  { name: 'Transporte', icon: 'car-outline', color: '#3B82F6' },
  { name: 'Servicios', icon: 'bulb-outline', color: '#10B981' },
  { name: 'Entretenimiento', icon: 'game-controller-outline', color: '#EC4899' },
  { name: 'Combustible', icon: 'speedometer-outline', color: '#EF4444' },
  { name: 'Salud', icon: 'heart-outline', color: '#84CC16' },
  { name: 'Supermercado', icon: 'cart-outline', color: '#6366F1' },
  { name: 'Otros', icon: 'ellipsis-horizontal-outline', color: '#64748B' },
];

export default function DashboardScreen() {
  const [expenses, setExpenses] = useState<Gasto[]>([]);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Otros');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchExpenses();
  }, []);

  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('gastos')
        .select('id, monto, categoria, descripcion, fecha')
        .eq('user_id', user.id)
        .order('fecha', { ascending: false });

      if (error) throw error;
      setExpenses(data || []);

      const total = (data || []).reduce((sum, item) => sum + Number(item.monto), 0);
      setTotalExpenses(total);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'No se pudieron cargar los gastos');
    } finally {
      setLoading(false);
    }
  };

  const handleAddExpense = async () => {
    if (!amount || isNaN(Number(amount))) {
      Alert.alert('Error', 'Por favor ingresa un monto válido.');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Generar embedding del gasto si está la API Key de Gemini
      let embedding: number[] | null = null;
      // @ts-ignore
      const geminiApiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

      if (geminiApiKey) {
        try {
          const textToEmbed = `${category} ${description} ${amount}`;
          const embedUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${geminiApiKey}`;
          const embedResponse = await fetch(embedUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "models/gemini-embedding-2",
              content: {
                parts: [{ text: textToEmbed }]
              },
              outputDimensionality: 768
            })
          });
          if (embedResponse.ok) {
            const embedData = await embedResponse.json();
            embedding = embedData.embedding.values;
          }
        } catch (err) {
          console.log("No se pudo generar el embedding, se guardará el gasto sin él.", err);
        }
      }

      const { error } = await supabase.from('gastos').insert({
        user_id: user.id,
        monto: Number(amount),
        categoria: category,
        descripcion: description,
        embedding,
      });

      if (error) throw error;

      setAmount('');
      setDescription('');
      setCategory('Otros');
      setModalVisible(false);
      fetchExpenses();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'No se pudo guardar el gasto');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  const getCategoryDetails = (catName: string) => {
    return CATEGORIES.find(c => c.name.toLowerCase() === catName.toLowerCase()) || CATEGORIES[7];
  };

  const renderExpenseItem = ({ item }: { item: Gasto }) => {
    const details = getCategoryDetails(item.categoria);
    const formattedDate = new Date(item.fecha).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
    });

    return (
      <View style={styles.expenseItem}>
        <View style={[styles.iconWrapper, { backgroundColor: details.color + '15' }]}>
          <Ionicons name={details.icon as any} size={22} color={details.color} />
        </View>
        <View style={styles.expenseDetails}>
          <Text style={styles.expenseDesc}>{item.descripcion || item.categoria}</Text>
          <Text style={styles.expenseMeta}>{item.categoria} • {formattedDate}</Text>
        </View>
        <Text style={styles.expenseAmount}>${Number(item.monto).toLocaleString('es-AR')}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Resumen del Balance */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Total Gastado</Text>
        <Text style={styles.balanceAmount}>${totalExpenses.toLocaleString('es-AR')}</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setModalVisible(true)}>
          <Ionicons name="add" size={20} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={styles.addButtonText}>Agregar Gasto</Text>
        </TouchableOpacity>
      </View>

      {/* Título de Listado */}
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Gastos Recientes</Text>
        <TouchableOpacity onPress={fetchExpenses}>
          <Ionicons name="refresh-outline" size={20} color="#94A3B8" />
        </TouchableOpacity>
      </View>

      {/* Lista */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#6366F1" />
        </View>
      ) : expenses.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="wallet-outline" size={48} color="#475569" />
          <Text style={styles.emptyText}>Aún no registraste ningún gasto.</Text>
        </View>
      ) : (
        <FlatList
          data={expenses}
          renderItem={renderExpenseItem}
          keyExtractor={(item: Gasto) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Botón de Cierre de Sesión en Esquina */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={20} color="#EF4444" />
        <Text style={styles.logoutText}>Salir</Text>
      </TouchableOpacity>

      {/* Modal Agregar Gasto */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nuevo Gasto</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Monto ($)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="0.00"
                  placeholderTextColor="#64748B"
                  keyboardType="numeric"
                  value={amount}
                  onChangeText={setAmount}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Descripción</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="ej. Almuerzo con amigos"
                  placeholderTextColor="#64748B"
                  value={description}
                  onChangeText={setDescription}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Categoría</Text>
                <View style={styles.categoriesGrid}>
                  {CATEGORIES.map((cat) => (
                    <TouchableOpacity
                      key={cat.name}
                      style={[
                        styles.categoryBadge,
                        category === cat.name && { backgroundColor: cat.color + '30', borderColor: cat.color }
                      ]}
                      onPress={() => setCategory(cat.name)}
                    >
                      <Ionicons
                        name={cat.icon as any}
                        size={16}
                        color={category === cat.name ? cat.color : '#64748B'}
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        style={[
                          styles.categoryBadgeText,
                          category === cat.name ? { color: '#F8FAFC', fontWeight: '700' } : { color: '#64748B' }
                        ]}
                      >
                        {cat.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <TouchableOpacity
                style={styles.modalSubmitButton}
                onPress={handleAddExpense}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitText}>Guardar Gasto</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    padding: 20,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  balanceCard: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    marginTop: 10,
    marginBottom: 24,
  },
  balanceLabel: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  balanceAmount: {
    fontSize: 36,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 16,
    letterSpacing: -1,
  },
  addButton: {
    flexDirection: 'row',
    backgroundColor: '#6366F1',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  listTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  listContent: {
    paddingBottom: 80,
  },
  expenseItem: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  iconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  expenseDetails: {
    flex: 1,
  },
  expenseDesc: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  expenseMeta: {
    fontSize: 12,
    color: '#64748B',
  },
  expenseAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#64748B',
    marginTop: 12,
    fontSize: 14,
    textAlign: 'center',
  },
  logoutButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: '#1E293B',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: '#334155',
    elevation: 3,
  },
  logoutText: {
    color: '#EF4444',
    fontWeight: '600',
    fontSize: 13,
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  modalBody: {
    paddingBottom: 24,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalInput: {
    height: 52,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingHorizontal: 16,
    color: '#F8FAFC',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
  },
  categoryBadgeText: {
    fontSize: 13,
  },
  modalSubmitButton: {
    height: 52,
    backgroundColor: '#10B981',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  modalSubmitText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
