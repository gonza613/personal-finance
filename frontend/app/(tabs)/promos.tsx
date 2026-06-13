import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, FlatList, TextInput, TouchableOpacity, Modal, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { supabase } from '../../src/utils/supabaseClient';
import { Ionicons } from '@expo/vector-icons';

interface Promocion {
  id: string;
  entidad: string;
  descuento_porcentaje: number;
  tope_reintegro: number | null;
  dias_vigencia: string;
}

const ENTIDADES = [
  { name: 'Galicia', color: '#EF6C00' },
  { name: 'Santander', color: '#CC0000' },
  { name: 'BBVA', color: '#004481' },
  { name: 'Macro', color: '#002D62' },
  { name: 'Nación', color: '#00689D' },
  { name: 'MODO', color: '#5B21B6' },
  { name: 'Mercado Pago', color: '#009EE3' },
  { name: 'Lemon', color: '#FBBF24' },
  { name: 'Naranja X', color: '#F97316' },
  { name: 'Todos', color: '#6366F1' },
];

export default function PromosScreen() {
  const [promotions, setPromotions] = useState<Promocion[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form fields
  const [entidad, setEntidad] = useState('');
  const [descuento, setDescuento] = useState('');
  const [tope, setTope] = useState('');
  const [dias, setDias] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPromotions();
  }, []);

  const fetchPromotions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('promociones')
        .select('id, entidad, descuento_porcentaje, tope_reintegro, dias_vigencia')
        .order('entidad', { ascending: true });

      if (error) throw error;
      setPromotions(data || []);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'No se pudieron cargar las promociones.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAddModal = () => {
    setEditingId(null);
    setEntidad('');
    setDescuento('');
    setTope('');
    setDias('');
    setModalVisible(true);
  };

  const handleOpenEditModal = (item: Promocion) => {
    setEditingId(item.id);
    setEntidad(item.entidad);
    setDescuento(String(item.descuento_porcentaje));
    setTope(item.tope_reintegro ? String(item.tope_reintegro) : '');
    setDias(item.dias_vigencia);
    setModalVisible(true);
  };

  const handleSavePromotion = async () => {
    if (!entidad.trim() || !descuento || isNaN(Number(descuento)) || !dias.trim()) {
      Alert.alert('Error', 'Completá entidad, porcentaje de descuento y días de vigencia.');
      return;
    }

    setSaving(true);
    try {
      // Generar embedding
      let embedding: number[] | null = null;
      // @ts-ignore
      const geminiApiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
      if (geminiApiKey) {
        try {
          const textToEmbed = `${entidad} ${descuento}% descuento ${dias} ${tope ? 'tope ' + tope : ''}`;
          const embedUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${geminiApiKey}`;
          const embedResponse = await fetch(embedUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "models/gemini-embedding-2",
              content: { parts: [{ text: textToEmbed }] },
              outputDimensionality: 768
            })
          });
          if (embedResponse.ok) {
            const embedData = await embedResponse.json();
            embedding = embedData.embedding.values;
          }
        } catch (err) {
          console.log("No se pudo generar embedding para la promo.", err);
        }
      }

      const payload: Record<string, any> = {
        entidad: entidad.trim(),
        descuento_porcentaje: Number(descuento),
        tope_reintegro: tope ? Number(tope) : null,
        dias_vigencia: dias.trim(),
      };
      if (embedding) payload.embedding = embedding;

      if (editingId) {
        const { error } = await supabase
          .from('promociones')
          .update(payload)
          .eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('promociones')
          .insert(payload);
        if (error) throw error;
      }

      setModalVisible(false);
      setEditingId(null);
      fetchPromotions();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Error al guardar la promoción.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePromotion = async () => {
    if (!editingId) return;
    Alert.alert(
      'Confirmar Eliminación',
      '¿Estás seguro de que deseas eliminar esta promoción?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const { error } = await supabase
                .from('promociones')
                .delete()
                .eq('id', editingId);
              if (error) throw error;
              setModalVisible(false);
              setEditingId(null);
              fetchPromotions();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'No se pudo eliminar la promoción.');
            } finally {
              setSaving(false);
            }
          }
        }
      ]
    );
  };

  const getEntidadColor = (name: string) => {
    return ENTIDADES.find(e => e.name.toLowerCase() === name.toLowerCase())?.color || '#6366F1';
  };

  const renderPromoItem = ({ item }: { item: Promocion }) => {
    const color = getEntidadColor(item.entidad);
    return (
      <TouchableOpacity style={styles.promoCard} onPress={() => handleOpenEditModal(item)} activeOpacity={0.7}>
        <View style={[styles.entidadBadge, { backgroundColor: color + '15' }]}>
          <Text style={[styles.entidadBadgeText, { color }]}>{item.entidad.slice(0, 2).toUpperCase()}</Text>
        </View>
        <View style={styles.promoDetails}>
          <Text style={styles.promoEntidad}>{item.entidad}</Text>
          <Text style={styles.promoDias}>{item.dias_vigencia}</Text>
        </View>
        <View style={styles.promoRight}>
          <View style={[styles.descuentoBadge, { backgroundColor: color + '15' }]}>
            <Text style={[styles.descuentoText, { color }]}>{item.descuento_porcentaje}%</Text>
          </View>
          {item.tope_reintegro && (
            <Text style={styles.topeText}>Tope ${Number(item.tope_reintegro).toLocaleString('es-AR')}</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={14} color="#CCCCCC" style={{ marginLeft: 4 }} />
      </TouchableOpacity>
    );
  };

  const groupedByEntidad: Record<string, Promocion[]> = {};
  promotions.forEach(p => {
    if (!groupedByEntidad[p.entidad]) groupedByEntidad[p.entidad] = [];
    groupedByEntidad[p.entidad].push(p);
  });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <Ionicons name="pricetags-outline" size={24} color="#6366F1" />
          <Text style={styles.summaryTitle}>Mis Promociones</Text>
        </View>
        <Text style={styles.summarySubtitle}>
          {promotions.length} promoción{promotions.length === 1 ? '' : 'es'} registrada{promotions.length === 1 ? '' : 's'}
        </Text>
        <TouchableOpacity style={styles.addButton} onPress={handleOpenAddModal}>
          <Ionicons name="add" size={20} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={styles.addButtonText}>Nueva Promoción</Text>
        </TouchableOpacity>
      </View>

      {/* Lista */}
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Promociones Activas</Text>
        <TouchableOpacity onPress={fetchPromotions}>
          <Ionicons name="refresh-outline" size={20} color="#94A3B8" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#6366F1" />
        </View>
      ) : promotions.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="pricetags-outline" size={48} color="#475569" />
          <Text style={styles.emptyText}>Aún no registraste ninguna promoción.</Text>
          <Text style={styles.emptySubText}>Podés cargarlas acá o decirle a Alexa o al chat.</Text>
        </View>
      ) : (
        <FlatList
          data={promotions}
          renderItem={renderPromoItem}
          keyExtractor={(item: Promocion) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Modal CRUD Promoción */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId ? 'Editar Promoción' : 'Nueva Promoción'}</Text>
              <TouchableOpacity onPress={() => { setModalVisible(false); setEditingId(null); }}>
                <Ionicons name="close" size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Entidad / Banco</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="ej. Galicia, MODO, Mercado Pago"
                  placeholderTextColor="#64748B"
                  value={entidad}
                  onChangeText={setEntidad}
                />
                <View style={styles.quickEntidades}>
                  {ENTIDADES.slice(0, 6).map((ent) => (
                    <TouchableOpacity
                      key={ent.name}
                      style={[
                        styles.quickEntBadge,
                        entidad === ent.name && { backgroundColor: ent.color + '20', borderColor: ent.color }
                      ]}
                      onPress={() => setEntidad(ent.name)}
                    >
                      <Text style={[
                        styles.quickEntText,
                        entidad === ent.name && { color: ent.color, fontWeight: '700' }
                      ]}>
                        {ent.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Descuento (%)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="ej. 20"
                  placeholderTextColor="#64748B"
                  keyboardType="numeric"
                  value={descuento}
                  onChangeText={setDescuento}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Tope de reintegro ($) — Opcional</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="ej. 5000"
                  placeholderTextColor="#64748B"
                  keyboardType="numeric"
                  value={tope}
                  onChangeText={setTope}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Días de vigencia</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="ej. Lunes y Martes, Todos los días"
                  placeholderTextColor="#64748B"
                  value={dias}
                  onChangeText={setDias}
                />
              </View>

              <View style={styles.buttonRow}>
                {editingId && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.deleteButton]}
                    onPress={handleDeletePromotion}
                    disabled={saving}
                  >
                    <Ionicons name="trash-outline" size={20} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.actionButtonText}>Eliminar</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.actionButton, styles.saveButton, !editingId && { width: '100%' }]}
                  onPress={handleSavePromotion}
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
  promoCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  entidadBadge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  entidadBadgeText: {
    fontSize: 14,
    fontWeight: '800',
  },
  promoDetails: {
    flex: 1,
  },
  promoEntidad: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 2,
  },
  promoDias: {
    fontSize: 12,
    color: '#666666',
  },
  promoRight: {
    alignItems: 'flex-end',
  },
  descuentoBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 4,
  },
  descuentoText: {
    fontSize: 16,
    fontWeight: '800',
  },
  topeText: {
    fontSize: 11,
    color: '#999999',
    fontWeight: '500',
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
  emptySubText: {
    color: '#BBBBBB',
    fontSize: 12,
    marginTop: 4,
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
  quickEntidades: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  quickEntBadge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#F9FAFB',
  },
  quickEntText: {
    fontSize: 12,
    color: '#666666',
    fontWeight: '500',
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
