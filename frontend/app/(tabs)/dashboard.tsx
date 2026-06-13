import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, FlatList, TextInput, TouchableOpacity, Modal, ActivityIndicator, Alert, ScrollView, Animated } from 'react-native';
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
  const [monthlyTrend, setMonthlyTrend] = useState<{ month: string; amount: number }[]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<{ category: string; amount: number; percentage: number; color: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [budgetModalVisible, setBudgetModalVisible] = useState(false);

  // Form fields (shared for create/edit)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Otros');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Budget
  const [budget, setBudget] = useState(200000);
  const [budgetInput, setBudgetInput] = useState('');

  const router = useRouter();

  useEffect(() => {
    fetchExpenses();
    fetchBudget();
  }, []);

  const fetchBudget = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('budget')
        .eq('id', user.id)
        .maybeSingle();
      if (data?.budget) {
        setBudget(Number(data.budget));
      }
    } catch (err) {
      console.log('Error fetching budget:', err);
    }
  };

  const handleSaveBudget = async () => {
    const val = Number(budgetInput);
    if (!val || val <= 0) {
      Alert.alert('Error', 'Ingresá un monto válido para el presupuesto.');
      return;
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from('profiles')
        .update({ budget: val })
        .eq('id', user.id);
      if (error) throw error;
      setBudget(val);
      setBudgetModalVisible(false);
      Alert.alert('Éxito', `Presupuesto actualizado a $${val.toLocaleString('es-AR')}`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'No se pudo actualizar el presupuesto.');
    }
  };

  const computeStats = (data: Gasto[]) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-11

    let monthlyTotal = 0;
    const catMap: Record<string, number> = {};
    const dailyMap: Record<string, number> = {};
    const trendMap: Record<string, number> = {};
    
    // Inicializar los últimos 7 días con 0
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const key = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
      dailyMap[key] = 0;
    }

    // Inicializar los últimos 6 meses con 0
    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const key = d.toLocaleDateString('es-AR', { month: 'short' }).replace('.', '');
      trendMap[key] = 0;
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
      const dayKey = itemDate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
      if (dailyMap[dayKey] !== undefined) {
        dailyMap[dayKey] += amountVal;
      }

      // Sumar a tendencia mensual (últimos 6 meses)
      const monthKey = itemDate.toLocaleDateString('es-AR', { month: 'short' }).replace('.', '');
      if (trendMap[monthKey] !== undefined) {
        trendMap[monthKey] += amountVal;
      }
    });

    setMonthlyExpenses(monthlyTotal);

    // Formatear gastos diarios
    const formattedDaily = Object.keys(dailyMap).map(day => ({
      day,
      amount: dailyMap[day]
    }));
    setDailyExpenses(formattedDaily);

    // Formatear tendencia mensual
    const formattedTrend = Object.keys(trendMap).map(month => ({
      month,
      amount: trendMap[month]
    }));
    setMonthlyTrend(formattedTrend);

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

  const handleOpenAddModal = () => {
    setEditingId(null);
    setAmount('');
    setCategory('Otros');
    setDescription('');
    setModalVisible(true);
  };

  const handleOpenEditModal = (item: Gasto) => {
    setEditingId(item.id);
    setAmount(String(item.monto));
    setCategory(item.categoria);
    setDescription(item.descripcion || '');
    setModalVisible(true);
  };

  const handleSaveExpense = async () => {
    if (!amount || isNaN(Number(amount))) {
      Alert.alert('Error', 'Por favor ingresa un monto válido.');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Generar embedding del gasto
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
          console.log("No se pudo generar el embedding, se guardará sin él.", err);
        }
      }

      if (editingId) {
        // Actualizar existente
        const payload: Record<string, any> = {
          monto: Number(amount),
          categoria: category,
          descripcion: description,
        };
        if (embedding) payload.embedding = embedding;

        const { error } = await supabase
          .from('gastos')
          .update(payload)
          .eq('id', editingId);
        if (error) throw error;
      } else {
        // Crear nuevo
        const { error } = await supabase.from('gastos').insert({
          user_id: user.id,
          monto: Number(amount),
          categoria: category,
          descripcion: description,
          embedding,
        });
        if (error) throw error;
      }

      setAmount('');
      setDescription('');
      setCategory('Otros');
      setEditingId(null);
      setModalVisible(false);
      fetchExpenses();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'No se pudo guardar el gasto');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExpense = async () => {
    if (!editingId) return;
    Alert.alert(
      'Confirmar Eliminación',
      '¿Estás seguro de que deseas eliminar este gasto?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const { error } = await supabase
                .from('gastos')
                .delete()
                .eq('id', editingId);
              if (error) throw error;
              setModalVisible(false);
              setEditingId(null);
              fetchExpenses();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'No se pudo eliminar el gasto.');
            } finally {
              setSaving(false);
            }
          }
        }
      ]
    );
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
      <TouchableOpacity style={styles.expenseItem} onPress={() => handleOpenEditModal(item)} activeOpacity={0.7}>
        <View style={[styles.iconWrapper, { backgroundColor: details.color + '15' }]}>
          <Ionicons name={details.icon as any} size={22} color={details.color} />
        </View>
        <View style={styles.expenseDetails}>
          <Text style={styles.expenseDesc}>{item.descripcion || item.categoria}</Text>
          <Text style={styles.expenseMeta}>{item.categoria} • {formattedDate}</Text>
        </View>
        <View style={styles.expenseRight}>
          <Text style={styles.expenseAmount}>${Number(item.monto).toLocaleString('es-AR')}</Text>
          <Ionicons name="chevron-forward" size={14} color="#CCCCCC" />
        </View>
      </TouchableOpacity>
    );
  };

  const budgetPct = budget > 0 ? (monthlyExpenses / budget) * 100 : 0;

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      {/* Resumen del Balance */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Gastado este mes</Text>
        <Text style={styles.balanceAmount}>${monthlyExpenses.toLocaleString('es-AR')}</Text>
        
        {/* Barra de progreso de presupuesto */}
        <TouchableOpacity style={styles.budgetProgressContainer} onPress={() => {
          setBudgetInput(String(budget));
          setBudgetModalVisible(true);
        }} activeOpacity={0.8}>
          <View style={styles.budgetRow}>
            <Text style={styles.budgetText}>
              Presupuesto: ${budget.toLocaleString('es-AR')}
              <Text style={styles.budgetEditHint}> ✎</Text>
            </Text>
            <Text style={[styles.budgetText, budgetPct >= 100 ? styles.budgetOverText : null]}>
              {budgetPct.toFixed(0)}%
            </Text>
          </View>
          <View style={styles.progressBarBg}>
            <View 
              style={[
                styles.progressBarFill, 
                { 
                  width: `${Math.min(budgetPct, 100)}%`,
                  backgroundColor: budgetPct >= 100 ? '#EF4444' : budgetPct >= 80 ? '#F59E0B' : '#10B981'
                }
              ]} 
            />
          </View>
        </TouchableOpacity>

        {budgetPct >= 100 && (
          <View style={styles.alertBanner}>
            <Ionicons name="warning" size={14} color="#EF4444" />
            <Text style={styles.alertText}>¡Superaste tu presupuesto mensual!</Text>
          </View>
        )}
        {budgetPct >= 80 && budgetPct < 100 && (
          <View style={[styles.alertBanner, styles.alertWarning]}>
            <Ionicons name="alert-circle" size={14} color="#F59E0B" />
            <Text style={[styles.alertText, styles.alertWarningText]}>Estás al {budgetPct.toFixed(0)}% de tu presupuesto</Text>
          </View>
        )}

        <Text style={styles.historicLabel}>
          Total acumulado histórico: ${totalExpenses.toLocaleString('es-AR')}
        </Text>

        <TouchableOpacity style={styles.addButton} onPress={handleOpenAddModal}>
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

      {/* Gráfico de Tendencia Mensual (Últimos 6 meses) */}
      {monthlyTrend.some(m => m.amount > 0) && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Tendencia mensual (últimos 6 meses)</Text>
          <View style={styles.barChartContainer}>
            {monthlyTrend.map((item, index) => {
              const maxAmount = Math.max(...monthlyTrend.map(d => d.amount), 1);
              const heightPercentage = (item.amount / maxAmount) * 100;
              const barHeight = item.amount > 0 ? Math.max((heightPercentage / 100) * 80, 6) : 0;

              return (
                <View key={index} style={styles.barColumn}>
                  <View style={styles.barWrapper}>
                    {item.amount > 0 && (
                      <Text style={styles.barValueText}>
                        ${item.amount >= 1000000 
                          ? `${(item.amount / 1000000).toFixed(1)}M` 
                          : item.amount >= 1000 
                            ? `${(item.amount / 1000).toFixed(0)}k` 
                            : Math.round(item.amount)}
                      </Text>
                    )}
                    <View 
                      style={[
                        styles.barFill, 
                        { 
                          height: barHeight,
                          backgroundColor: item.amount > 0 ? '#10B981' : '#334155',
                          borderRadius: 4,
                        }
                      ]} 
                    />
                  </View>
                  <Text style={styles.barLabel}>{item.month}</Text>
                </View>
              );
            })}
          </View>
          {/* Predicción del mes */}
          {monthlyExpenses > 0 && (
            <View style={styles.predictionBox}>
              <Ionicons name="trending-up" size={14} color="#6366F1" />
              <Text style={styles.predictionText}>
                A este ritmo, gastarás ~${Math.round(
                  monthlyExpenses / Math.max(new Date().getDate(), 1) * new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
                ).toLocaleString('es-AR')} este mes
              </Text>
            </View>
          )}
        </View>
      )}

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

      {/* Modal Crear/Editar Gasto */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId ? 'Editar Gasto' : 'Nuevo Gasto'}</Text>
              <TouchableOpacity onPress={() => { setModalVisible(false); setEditingId(null); }}>
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

              <View style={styles.buttonRow}>
                {editingId && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.deleteButton]}
                    onPress={handleDeleteExpense}
                    disabled={saving}
                  >
                    <Ionicons name="trash-outline" size={20} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.actionButtonText}>Eliminar</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.modalSubmitButton, !editingId && { width: '100%' }]}
                  onPress={handleSaveExpense}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.modalSubmitText}>{editingId ? 'Guardar Cambios' : 'Guardar Gasto'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal Configurar Presupuesto */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={budgetModalVisible}
        onRequestClose={() => setBudgetModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: 300 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Configurar Presupuesto</Text>
              <TouchableOpacity onPress={() => setBudgetModalVisible(false)}>
                <Ionicons name="close" size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Presupuesto mensual ($)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="200000"
                placeholderTextColor="#64748B"
                keyboardType="numeric"
                value={budgetInput}
                onChangeText={setBudgetInput}
              />
            </View>
            <TouchableOpacity style={styles.modalSubmitButton} onPress={handleSaveBudget}>
              <Text style={styles.modalSubmitText}>Guardar Presupuesto</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
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
    backgroundColor: '#FFFFFF',
  },
  balanceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginTop: 10,
    marginBottom: 20,
  },
  balanceLabel: {
    fontSize: 12,
    color: '#666666',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  balanceAmount: {
    fontSize: 34,
    fontWeight: '800',
    color: '#000000',
    marginBottom: 16,
    letterSpacing: -1,
  },
  budgetProgressContainer: {
    width: '100%',
    marginBottom: 12,
  },
  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  budgetText: {
    fontSize: 12,
    color: '#666666',
    fontWeight: '600',
  },
  budgetEditHint: {
    fontSize: 11,
    color: '#999999',
  },
  budgetOverText: {
    color: '#EF4444',
    fontWeight: '800',
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
    width: '100%',
  },
  alertWarning: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  alertText: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '600',
    marginLeft: 6,
  },
  alertWarningText: {
    color: '#D97706',
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 3,
    width: '100%',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  historicLabel: {
    fontSize: 12,
    color: '#999999',
    fontWeight: '500',
    marginBottom: 20,
  },
  addButton: {
    flexDirection: 'row',
    backgroundColor: '#000000',
    borderRadius: 10,
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
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginBottom: 20,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#000000',
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
    borderRadius: 4,
  },
  barValueText: {
    fontSize: 9,
    color: '#000000',
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  barLabel: {
    fontSize: 10,
    color: '#666666',
    marginTop: 8,
    fontWeight: '600',
  },
  predictionBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F3FF',
    borderRadius: 8,
    padding: 10,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#E0E7FF',
  },
  predictionText: {
    fontSize: 12,
    color: '#4F46E5',
    fontWeight: '600',
    marginLeft: 6,
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
    color: '#000000',
    fontWeight: '600',
  },
  categoryValue: {
    fontSize: 12,
    color: '#666666',
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
    fontSize: 16,
    fontWeight: '800',
    color: '#000000',
  },
  listContent: {
    paddingBottom: 90,
  },
  expenseItem: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  iconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  expenseDetails: {
    flex: 1,
  },
  expenseDesc: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 4,
  },
  expenseMeta: {
    fontSize: 12,
    color: '#666666',
  },
  expenseRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  expenseAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#999999',
    marginTop: 12,
    fontSize: 14,
    textAlign: 'center',
  },
  logoutButton: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FF3B30',
    zIndex: 10,
  },
  logoutText: {
    color: '#FF3B30',
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#000000',
  },
  modalBody: {
    paddingBottom: 24,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#666666',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalInput: {
    height: 48,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 16,
    color: '#000000',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#F9FAFB',
  },
  categoryBadgeText: {
    fontSize: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  modalSubmitButton: {
    flex: 1,
    height: 48,
    backgroundColor: '#000000',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  modalSubmitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
