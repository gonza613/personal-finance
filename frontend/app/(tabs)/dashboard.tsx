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
  const [monthlyExpenses, setMonthlyExpenses] = useState(0);
  const [dailyExpenses, setDailyExpenses] = useState<{ day: string; amount: number }[]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<{ category: string; amount: number; percentage: number; color: string }[]>([]);
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

  const computeStats = (data: Gasto[]) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-11

    let monthlyTotal = 0;
    const catMap: Record<string, number> = {};
    const dailyMap: Record<string, number> = {};
    
    // Inicializar los últimos 7 días con 0
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const key = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
      dailyMap[key] = 0;
    }

    data.forEach(item => {
      const itemDate = new Date(item.fecha);
      const amountVal = Number(item.monto);

      // Si el gasto es del año y mes actual
      if (itemDate.getFullYear() === currentYear && itemDate.getMonth() === currentMonth) {
        monthlyTotal += amountVal;

        // Sumar por categoría
        const catName = item.categoria;
        catMap[catName] = (catMap[catName] || 0) + amountVal;
      }

      // Sumar a los últimos 7 días si cae en la ventana
      const key = itemDate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
      if (dailyMap[key] !== undefined) {
        dailyMap[key] += amountVal;
      }
    });

    setMonthlyExpenses(monthlyTotal);

    // Formatear gastos diarios
    const formattedDaily = Object.keys(dailyMap).map(day => ({
      day,
      amount: dailyMap[day]
    }));
    setDailyExpenses(formattedDaily);

    // Formatear distribución por categorías ordenadas por monto descendente
    const formattedCat = Object.keys(catMap).map(catName => {
      const amountVal = catMap[catName];
      const percentage = monthlyTotal > 0 ? (amountVal / monthlyTotal) * 100 : 0;
      const details = getCategoryDetails(catName);
      return {
        category: catName,
        amount: amountVal,
        percentage,
        color: details.color
      };
    }).sort((a, b) => b.amount - a.amount);
    
    setCategoryBreakdown(formattedCat);
  };

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

      // Computar los datos estadísticos
      computeStats(data || []);
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

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      {/* Resumen del Balance */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Gastado este mes</Text>
        <Text style={styles.balanceAmount}>${monthlyExpenses.toLocaleString('es-AR')}</Text>
        
        {/* Barra de progreso de presupuesto mensual ($200.000 ARS por defecto) */}
        <View style={styles.budgetProgressContainer}>
          <View style={styles.budgetRow}>
            <Text style={styles.budgetText}>Presupuesto mensual: $200.000</Text>
            <Text style={styles.budgetText}>
              {((monthlyExpenses / 200000) * 100).toFixed(0)}%
            </Text>
          </View>
          <View style={styles.progressBarBg}>
            <View 
              style={[
                styles.progressBarFill, 
                { 
                  width: `${Math.min((monthlyExpenses / 200000) * 100, 100)}%`,
                  backgroundColor: monthlyExpenses > 200000 ? '#EF4444' : '#10B981'
                }
              ]} 
            />
          </View>
        </View>

        <Text style={styles.historicLabel}>
          Total acumulado histórico: ${totalExpenses.toLocaleString('es-AR')}
        </Text>

        <TouchableOpacity style={styles.addButton} onPress={() => setModalVisible(true)}>
          <Ionicons name="add" size={20} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={styles.addButtonText}>Agregar Gasto</Text>
        </TouchableOpacity>
      </View>

      {/* Gráfico de Barras de Gastos Diarios */}
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>Gastos últimos 7 días</Text>
        <View style={styles.barChartContainer}>
          {dailyExpenses.map((item, index) => {
            const maxAmount = Math.max(...dailyExpenses.map(d => d.amount), 1);
            const heightPercentage = (item.amount / maxAmount) * 100;
            // Altura máxima del gráfico es 80px, mínimo 0
            const barHeight = item.amount > 0 ? Math.max((heightPercentage / 100) * 80, 6) : 0;

            return (
              <View key={index} style={styles.barColumn}>
                <View style={styles.barWrapper}>
                  {item.amount > 0 && (
                    <Text style={styles.barValueText}>
                      ${item.amount >= 1000 ? `${(item.amount / 1000).toFixed(1)}k` : Math.round(item.amount)}
                    </Text>
                  )}
                  <View 
                    style={[
                      styles.barFill, 
                      { 
                        height: barHeight,
                        backgroundColor: item.amount > 0 ? '#6366F1' : '#334155'
                      }
                    ]} 
                  />
                </View>
                <Text style={styles.barLabel}>{item.day}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Distribución por Categorías */}
      {categoryBreakdown.length > 0 && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Distribución de gastos (este mes)</Text>
          {categoryBreakdown.map((item) => {
            const details = getCategoryDetails(item.category);
            return (
              <View key={item.category} style={styles.categoryRow}>
                <View style={[styles.miniIconWrapper, { backgroundColor: details.color + '15' }]}>
                  <Ionicons name={details.icon as any} size={14} color={details.color} />
                </View>
                <View style={styles.categoryInfo}>
                  <View style={styles.categoryHeader}>
                    <Text style={styles.categoryName}>{item.category}</Text>
                    <Text style={styles.categoryValue}>
                      ${item.amount.toLocaleString('es-AR')} ({item.percentage.toFixed(0)}%)
                    </Text>
                  </View>
                  <View style={styles.progressBarBg}>
                    <View 
                      style={[
                        styles.progressBarFill, 
                        { 
                          width: `${item.percentage}%`,
                          backgroundColor: details.color
                        }
                      ]} 
                    />
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Título de Listado */}
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Gastos Recientes</Text>
        <TouchableOpacity onPress={fetchExpenses}>
          <Ionicons name="refresh-outline" size={20} color="#94A3B8" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#6366F1" />
        </View>
      ) : (
        <FlatList
          data={expenses}
          renderItem={renderExpenseItem}
          keyExtractor={(item: Gasto) => item.id}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="wallet-outline" size={48} color="#475569" />
              <Text style={styles.emptyText}>Aún no registraste ningún gasto.</Text>
            </View>
          }
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
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  headerContainer: {
    paddingBottom: 10,
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
    marginBottom: 20,
  },
  balanceLabel: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  balanceAmount: {
    fontSize: 38,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 16,
    letterSpacing: -1,
  },
  budgetProgressContainer: {
    width: '100%',
    marginBottom: 16,
  },
  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  budgetText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#0F172A',
    borderRadius: 4,
    width: '100%',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  historicLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    marginBottom: 20,
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
  chartCard: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 20,
  },
  chartTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 16,
  },
  barChartContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 120,
    paddingTop: 10,
  },
  barColumn: {
    alignItems: 'center',
    flex: 1,
  },
  barWrapper: {
    height: 100,
    justifyContent: 'flex-end',
    alignItems: 'center',
    width: '100%',
  },
  barFill: {
    width: 14,
    borderRadius: 8,
  },
  barValueText: {
    fontSize: 9,
    color: '#6366F1',
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  barLabel: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 8,
    fontWeight: '600',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  miniIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  categoryInfo: {
    flex: 1,
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  categoryName: {
    fontSize: 13,
    color: '#F8FAFC',
    fontWeight: '600',
  },
  categoryValue: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 16,
  },
  listTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  listContent: {
    paddingBottom: 90,
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
    left: 20,
    backgroundColor: '#1E293B',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: '#334155',
    elevation: 3,
    zIndex: 10,
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
