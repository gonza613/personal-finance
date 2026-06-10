import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, FlatList, TextInput, TouchableOpacity, Modal, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { supabase } from '../../src/utils/supabaseClient';
import { Ionicons } from '@expo/vector-icons';

interface InvestmentPosition {
  id: string;
  ticker: string;
  cantidad: number;
  tipo: string; // bono, crypto, fci
  plataforma: string;
}

const ASSET_TYPES = [
  { value: 'bono', label: 'Bono Renta Fija', icon: 'document-text-outline', color: '#3B82F6' },
  { value: 'crypto', label: 'Criptomoneda', icon: 'logo-bitcoin', color: '#F59E0B' },
  { value: 'fci', label: 'Fondo Común (FCI)', icon: 'trending-up-outline', color: '#10B981' },
];

export default function InversionesScreen() {
  const [positions, setPositions] = useState<InvestmentPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Form fields
  const [ticker, setTicker] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [tipo, setTipo] = useState('crypto');
  const [plataforma, setPlataforma] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPositions();
  }, []);

  const fetchPositions = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('inversiones_posiciones')
        .select('id, ticker, cantidad, tipo, plataforma')
        .eq('user_id', user.id)
        .order('ticker', { ascending: true });

      if (error) throw error;
      setPositions(data || []);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'No se pudieron cargar las posiciones.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAddModal = () => {
    setEditingId(null);
    setTicker('');
    setCantidad('');
    setTipo('crypto');
    setPlataforma('');
    setModalVisible(true);
  };

  const handleOpenEditModal = (item: InvestmentPosition) => {
    setEditingId(item.id);
    setTicker(item.ticker);
    setCantidad(item.cantidad.toString());
    setTipo(item.tipo);
    setPlataforma(item.plataforma);
    setModalVisible(true);
  };

  const handleSavePosition = async () => {
    if (!ticker.trim() || !cantidad || isNaN(Number(cantidad)) || !plataforma.trim()) {
      Alert.alert('Error', 'Por favor ingresa datos válidos. Todos los campos son obligatorios.');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const payload = {
        ticker: ticker.trim().toUpperCase(),
        cantidad: Number(cantidad),
        tipo,
        plataforma: plataforma.trim(),
        user_id: user.id
      };

      if (editingId) {
        // Actualizar existente
        const { error } = await supabase
          .from('inversiones_posiciones')
          .update(payload)
          .eq('id', editingId);

        if (error) throw error;
      } else {
        // Crear nuevo
        const { error } = await supabase
          .from('inversiones_posiciones')
          .insert(payload);

        if (error) throw error;
      }

      setModalVisible(false);
      fetchPositions();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Error al guardar la posición.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePosition = async () => {
    if (!editingId) return;

    Alert.alert(
      'Confirmar Eliminación',
      '¿Estás seguro de que deseas eliminar esta posición de inversión?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const { error } = await supabase
                .from('inversiones_posiciones')
                .delete()
                .eq('id', editingId);

              if (error) throw error;
              setModalVisible(false);
              fetchPositions();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'No se pudo eliminar la posición.');
            } finally {
              setSaving(false);
            }
          }
        }
      ]
    );
  };

  const getAssetTypeDetails = (type: string) => {
    return ASSET_TYPES.find(t => t.value === type) || ASSET_TYPES[0];
  };

  const renderPositionItem = ({ item }: { item: InvestmentPosition }) => {
    const details = getAssetTypeDetails(item.tipo);
    return (
      <TouchableOpacity style={styles.positionCard} onPress={() => handleOpenEditModal(item)}>
        <View style={[styles.iconWrapper, { backgroundColor: details.color + '15' }]}>
          <Ionicons name={details.icon as any} size={22} color={details.color} />
        </View>
        <View style={styles.positionDetails}>
          <Text style={styles.tickerText}>{item.ticker}</Text>
          <Text style={styles.platformText}>{item.plataforma} • {details.label}</Text>
        </View>
        <View style={styles.amountWrapper}>
          <Text style={styles.amountText}>{Number(item.cantidad).toLocaleString('es-AR', { maximumFractionDigits: 6 })}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Resumen Superior */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <Ionicons name="briefcase-outline" size={24} color="#6366F1" />
          <Text style={styles.summaryTitle}>Mi Portafolio</Text>
        </View>
        <Text style={styles.summarySubtitle}>
          {positions.length} posición{positions.length === 1 ? '' : 'es'} activa{positions.length === 1 ? '' : 's'} registradas.
        </Text>
        <TouchableOpacity style={styles.addButton} onPress={handleOpenAddModal}>
          <Ionicons name="add" size={20} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={styles.addButtonText}>Nueva Inversión</Text>
        </TouchableOpacity>
      </View>

      {/* Título de Listado */}
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Activos en Cartera</Text>
        <TouchableOpacity onPress={fetchPositions}>
          <Ionicons name="refresh-outline" size={20} color="#94A3B8" />
        </TouchableOpacity>
      </View>

      {/* Lista */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#6366F1" />
        </View>
      ) : positions.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="bar-chart-outline" size={48} color="#475569" />
          <Text style={styles.emptyText}>Aún no registraste ninguna inversión.</Text>
        </View>
      ) : (
        <FlatList
          data={positions}
          renderItem={renderPositionItem}
          keyExtractor={(item: InvestmentPosition) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Modal CRUD Inversión */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId ? 'Editar Posición' : 'Nueva Inversión'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Ticker / Símbolo</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="ej. BTC, AL30, AAPL"
                  placeholderTextColor="#64748B"
                  value={ticker}
                  onChangeText={setTicker}
                  autoCapitalize="characters"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Cantidad</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="0.0000"
                  placeholderTextColor="#64748B"
                  keyboardType="numeric"
                  value={cantidad}
                  onChangeText={setCantidad}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Plataforma / Broker</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="ej. BingX, Lemon Cash, Balanz"
                  placeholderTextColor="#64748B"
                  value={plataforma}
                  onChangeText={setPlataforma}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Tipo de Activo</Text>
                <View style={styles.typesGrid}>
                  {ASSET_TYPES.map((typeObj) => (
                    <TouchableOpacity
                      key={typeObj.value}
                      style={[
                        styles.typeBadge,
                        tipo === typeObj.value && { backgroundColor: '#000000', borderColor: '#000000' }
                      ]}
                      onPress={() => setTipo(typeObj.value)}
                    >
                      <Ionicons
                        name={typeObj.icon as any}
                        size={16}
                        color={tipo === typeObj.value ? '#FFFFFF' : '#666666'}
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        style={[
                          styles.typeBadgeText,
                          tipo === typeObj.value ? { color: '#FFFFFF', fontWeight: '700' } : { color: '#666666' }
                        ]}
                      >
                        {typeObj.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.buttonRow}>
                {editingId && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.deleteButton]}
                    onPress={handleDeletePosition}
                    disabled={saving}
                  >
                    <Ionicons name="trash-outline" size={20} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.actionButtonText}>Eliminar</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.actionButton, styles.saveButton, !editingId && { width: '100%' }]}
                  onPress={handleSavePosition}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="save-outline" size={20} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.actionButtonText}>Guardar</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
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
    backgroundColor: '#FFFFFF',
    padding: 20,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginTop: 10,
    marginBottom: 24,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#000000',
    marginLeft: 8,
  },
  summarySubtitle: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 16,
    textAlign: 'center',
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
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#000000',
  },
  listContent: {
    paddingBottom: 80,
  },
  positionCard: {
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
  positionDetails: {
    flex: 1,
  },
  tickerText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#000000',
    marginBottom: 4,
  },
  platformText: {
    fontSize: 12,
    color: '#666666',
  },
  amountWrapper: {
    alignItems: 'flex-end',
  },
  amountText: {
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
  typesGrid: {
    flexDirection: 'column',
    gap: 8,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#F9FAFB',
  },
  typeBadgeText: {
    fontSize: 13,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
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
  saveButton: {
    backgroundColor: '#000000',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
