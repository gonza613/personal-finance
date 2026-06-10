import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, FlatList, TextInput, TouchableOpacity, Modal, ActivityIndicator, Alert, ScrollView, Platform } from 'react-native';
import { supabase } from '../../src/utils/supabaseClient';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { 
  Receipt, 
  Plus, 
  Calendar, 
  ShoppingBag, 
  Trash2, 
  X, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  Store,
  DollarSign
} from 'lucide-react-native';

interface TicketItem {
  id: string;
  producto: string;
  precio: number;
  cantidad: number;
  unidad_medida: string;
}

interface Ticket {
  id: string;
  comercio: string;
  fecha: string;
  total: number;
  creado_at: string;
  items?: TicketItem[];
}

export default function ComprasScreen() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  
  // States for Scanner / Editor Modal
  const [scanModalVisible, setScanModalVisible] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [comercio, setComercio] = useState('');
  const [fecha, setFecha] = useState('');
  const [scannedItems, setScannedItems] = useState<TicketItem[]>([]);
  const [saving, setSaving] = useState(false);
  
  const fileInputRef = useRef<any>(null);

  useEffect(() => {
    fetchTickets();
  }, []);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch tickets
      const { data: ticketsData, error: ticketsError } = await supabase
        .from('tickets')
        .select('*')
        .eq('user_id', user.id)
        .order('fecha', { ascending: false });

      if (ticketsError) throw ticketsError;

      const ticketsList = ticketsData || [];

      // Fetch items for each ticket
      for (const ticket of ticketsList) {
        const { data: itemsData, error: itemsError } = await supabase
          .from('ticket_detalles')
          .select('id, producto, precio, cantidad, unidad_medida')
          .eq('ticket_id', ticket.id);
        
        if (!itemsError && itemsData) {
          ticket.items = itemsData;
        }
      }

      setTickets(ticketsList);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'No se pudieron cargar los tickets.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (event: any) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setScanModalVisible(true);

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target?.result as string;
      try {
        const { data, error } = await supabase.functions.invoke('process-ticket', {
          body: {
            image: base64Data,
            mimeType: file.type
          }
        });

        if (error) throw error;

        if (data && data.error === 'quota_exceeded') {
          Alert.alert('Límite de Cuota Alcanzado', data.message);
          setScanModalVisible(false);
          return;
        }

        // Populate scanner editor state
        setComercio(data.comercio || 'Supermercado');
        setFecha(data.fecha || new Date().toISOString().split('T')[0]);
        
        const itemsWithId = (data.productos || []).map((item: any, idx: number) => ({
          id: Date.now().toString() + '-' + idx,
          producto: item.producto || 'Producto sin nombre',
          precio: Number(item.precio) || 0,
          cantidad: Number(item.cantidad) || 1,
          unidad_medida: item.unidad_medida || 'u'
        }));
        setScannedItems(itemsWithId);

      } catch (err: any) {
        Alert.alert('Error de Escaneo', err.message || 'No se pudo procesar el ticket con la IA.');
        setScanModalVisible(false);
      } finally {
        setIsProcessing(false);
        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCameraLaunch = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso denegado', 'Se requiere acceso a la cámara para tomar una foto del ticket.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled) {
        processImageResult(result);
      }
    } catch (error: any) {
      Alert.alert('Error', 'Ocurrió un error al abrir la cámara: ' + error.message);
    }
  };

  const handleLibraryLaunch = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso denegado', 'Se requiere acceso a la galería para seleccionar la foto del ticket.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled) {
        processImageResult(result);
      }
    } catch (error: any) {
      Alert.alert('Error', 'Ocurrió un error al abrir la galería: ' + error.message);
    }
  };

  const processImageResult = async (result: ImagePicker.ImagePickerResult) => {
    const asset = result.assets?.[0];
    if (!asset || !asset.base64) {
      Alert.alert('Error', 'No se pudo obtener la información de la imagen.');
      return;
    }

    const base64Data = `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
    const mimeType = asset.mimeType || 'image/jpeg';

    setIsProcessing(true);
    setScanModalVisible(true);

    try {
      const { data, error } = await supabase.functions.invoke('process-ticket', {
        body: {
          image: base64Data,
          mimeType: mimeType
        }
      });

      if (error) throw error;

      if (data && data.error === 'quota_exceeded') {
        Alert.alert('Límite de Cuota Alcanzado', data.message);
        setScanModalVisible(false);
        return;
      }

      // Populate scanner editor state
      setComercio(data.comercio || 'Supermercado');
      setFecha(data.fecha || new Date().toISOString().split('T')[0]);
      
      const itemsWithId = (data.productos || []).map((item: any, idx: number) => ({
        id: Date.now().toString() + '-' + idx,
        producto: item.producto || 'Producto sin nombre',
        precio: Number(item.precio) || 0,
        cantidad: Number(item.cantidad) || 1,
        unidad_medida: item.unidad_medida || 'u'
      }));
      setScannedItems(itemsWithId);

    } catch (err: any) {
      Alert.alert('Error de Escaneo', err.message || 'No se pudo procesar el ticket con la IA.');
      setScanModalVisible(false);
    } finally {
      setIsProcessing(false);
    }
  };

  const triggerFilePicker = () => {
    if (Platform.OS === 'web') {
      fileInputRef.current?.click();
      return;
    }

    Alert.alert(
      'Cargar Ticket',
      'Elige una opción para cargar la imagen de tu ticket',
      [
        {
          text: 'Tomar Foto',
          onPress: handleCameraLaunch,
        },
        {
          text: 'Seleccionar de la Galería',
          onPress: handleLibraryLaunch,
        },
        {
          text: 'Cancelar',
          style: 'cancel',
        },
      ]
    );
  };

  const handleAddItem = () => {
    const newItem: TicketItem = {
      id: Date.now().toString(),
      producto: '',
      precio: 0,
      cantidad: 1,
      unidad_medida: 'u'
    };
    setScannedItems(prev => [...prev, newItem]);
  };

  const handleDeleteItem = (id: string) => {
    setScannedItems(prev => prev.filter(item => item.id !== id));
  };

  const handleUpdateItem = (id: string, field: keyof TicketItem, value: any) => {
    setScannedItems(prev => prev.map(item => {
      if (item.id === id) {
        return {
          ...item,
          [field]: field === 'producto' ? value : Number(value) || 0
        };
      }
      return item;
    }));
  };

  const calculateTotal = () => {
    return scannedItems.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
  };

  const handleSaveTicket = async () => {
    if (!comercio.trim() || !fecha.trim() || scannedItems.length === 0) {
      Alert.alert('Error', 'Por favor ingresa un comercio, fecha y al menos un producto.');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const total = calculateTotal();

      // 1. Insert ticket
      const { data: ticketData, error: ticketError } = await supabase
        .from('tickets')
        .insert({
          user_id: user.id,
          comercio: comercio.trim(),
          fecha: fecha.trim(),
          total: total
        })
        .select()
        .single();

      if (ticketError) throw ticketError;

      // 2. Insert items
      const itemsPayload = scannedItems.map(item => ({
        ticket_id: ticketData.id,
        producto: item.producto.trim() || 'Producto General',
        precio: item.precio,
        cantidad: item.cantidad,
        unidad_medida: item.unidad_medida || 'u'
      }));

      const { error: itemsError } = await supabase
        .from('ticket_detalles')
        .insert(itemsPayload);

      if (itemsError) throw itemsError;

      // 3. Opcional: También registrar como gasto automático en la tabla 'gastos'
      // Esto hace que sume al total de gastos acumulados del mes de forma inteligente.
      let embedding: number[] | null = null;
      // @ts-ignore
      const geminiApiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

      if (geminiApiKey) {
        try {
          const textToEmbed = `Supermercado Compra en ${comercio} total ${total}`;
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
          console.log("No se pudo generar embedding para el gasto automático del ticket", err);
        }
      }

      await supabase.from('gastos').insert({
        user_id: user.id,
        monto: total,
        categoria: 'Supermercado',
        descripcion: `Ticket ${comercio}`,
        fecha: `${fecha}T12:00:00Z`,
        embedding
      });

      setScanModalVisible(false);
      fetchTickets();
      Alert.alert('Completado', 'Ticket y productos guardados, y sumados a tus gastos totales.');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'No se pudo guardar la compra.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleExpand = (id: string) => {
    setExpandedTicketId(prev => prev === id ? null : id);
  };

  const handleDeleteTicket = (id: string, store: string) => {
    Alert.alert(
      'Eliminar Ticket',
      `¿Deseas eliminar el ticket de "${store}" y todos sus productos?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              // Borra en cascada por foreign key
              const { error } = await supabase.from('tickets').delete().eq('id', id);
              if (error) throw error;
              
              // Opcional: También borrar el gasto correspondiente de la tabla de gastos
              await supabase.from('gastos').delete().eq('descripcion', `Ticket ${store}`);
              
              fetchTickets();
            } catch (err: any) {
              Alert.alert('Error', err.message || 'No se pudo eliminar el ticket.');
            }
          }
        }
      ]
    );
  };

  const renderTicketItem = ({ item }: { item: Ticket }) => {
    const isExpanded = expandedTicketId === item.id;
    const formattedDate = new Date(item.fecha + 'T12:00:00').toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });

    return (
      <View style={styles.ticketCard}>
        <TouchableOpacity 
          style={styles.ticketHeaderRow} 
          onPress={() => handleToggleExpand(item.id)}
          activeOpacity={0.7}
        >
          <View style={styles.ticketMeta}>
            <View style={styles.ticketIconContainer}>
              <Receipt size={16} color="#71717A" strokeWidth={1.5} />
            </View>
            <View>
              <Text style={styles.ticketStore}>{item.comercio}</Text>
              <Text style={styles.ticketDate}>{formattedDate}</Text>
            </View>
          </View>
          <View style={styles.ticketRight}>
            <Text style={styles.ticketAmount}>${item.total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</Text>
            {isExpanded ? (
              <ChevronUp size={16} color="#71717A" style={{ marginLeft: 8 }} />
            ) : (
              <ChevronDown size={16} color="#71717A" style={{ marginLeft: 8 }} />
            )}
          </View>
        </TouchableOpacity>

        {isExpanded && item.items && (
          <View style={styles.ticketDetailContainer}>
            <View style={styles.divider} />
            <Text style={styles.detailTitle}>Productos Detectados</Text>
            {item.items.map((prod, idx) => (
              <View key={prod.id || idx} style={styles.detailRow}>
                <Text style={styles.detailProductText} numberOfLines={1}>
                  {prod.producto}
                </Text>
                <Text style={styles.detailQtyPriceText}>
                  {prod.cantidad} {prod.unidad_medida || 'u'} x ${prod.precio.toLocaleString('es-AR')}
                </Text>
                <Text style={styles.detailSubtotalText}>
                  ${(prod.precio * prod.cantidad).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </Text>
              </View>
            ))}
            <TouchableOpacity 
              style={styles.deleteTicketButton} 
              onPress={() => handleDeleteTicket(item.id, item.comercio)}
            >
              <Trash2 size={12} color="#EF4444" style={{ marginRight: 6 }} />
              <Text style={styles.deleteTicketText}>Eliminar Ticket</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      {/* Botón de Carga / Escaneo */}
      <View style={styles.topActionContainer}>
        <TouchableOpacity 
          style={styles.scanButton} 
          onPress={triggerFilePicker}
          activeOpacity={0.8}
        >
          <Receipt size={16} color="#FFFFFF" strokeWidth={2} style={{ marginRight: 8 }} />
          <Text style={styles.scanButtonText}>Escanear Ticket con IA</Text>
        </TouchableOpacity>
        
        {Platform.OS === 'web' && (
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            style={{ display: 'none' }} 
            accept="image/*"
          />
        )}
      </View>

      {/* Historial de Compras */}
      <View style={styles.historyHeader}>
        <Text style={styles.historyTitle}>Historial de tickets</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color="#09090B" />
        </View>
      ) : tickets.length === 0 ? (
        <View style={styles.emptyContainer}>
          <ShoppingBag size={28} color="#71717A" strokeWidth={1.5} style={{ marginBottom: 12 }} />
          <Text style={styles.emptyText}>No has cargado ningún ticket aún.</Text>
        </View>
      ) : (
        <FlatList
          data={tickets}
          renderItem={renderTicketItem}
          keyExtractor={(item: Ticket) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Modal para Procesar / Editar Gasto del Ticket */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={scanModalVisible}
        onRequestClose={() => {
          if (!isProcessing) setScanModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          {isProcessing ? (
            <View style={styles.processingCard}>
              <ActivityIndicator size="large" color="#09090B" style={{ marginBottom: 16 }} />
              <Text style={styles.processingTitle}>Procesando con Gemini...</Text>
              <Text style={styles.processingSubtitle}>Extrayendo comercio, fecha y listado de productos con visión multimodal.</Text>
            </View>
          ) : (
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Revisar Ticket Detectado</Text>
                <TouchableOpacity 
                  style={styles.closeButton} 
                  onPress={() => setScanModalVisible(false)}
                  disabled={saving}
                >
                  <X size={16} color="#71717A" strokeWidth={2} />
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
                {/* Inputs de Encabezado */}
                <View style={styles.formRow}>
                  <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                    <Text style={styles.inputLabel}>Comercio</Text>
                    <View style={styles.iconInputWrapper}>
                      <Store size={14} color="#71717A" style={styles.inputIcon} />
                      <TextInput
                        style={styles.modalInput}
                        value={comercio}
                        onChangeText={setComercio}
                        placeholder="ej. Carrefour"
                        placeholderTextColor="#A1A1AA"
                      />
                    </View>
                  </View>

                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Fecha (AAAA-MM-DD)</Text>
                    <View style={styles.iconInputWrapper}>
                      <Calendar size={14} color="#71717A" style={styles.inputIcon} />
                      <TextInput
                        style={styles.modalInput}
                        value={fecha}
                        onChangeText={setFecha}
                        placeholder="ej. 2026-06-05"
                        placeholderTextColor="#A1A1AA"
                      />
                    </View>
                  </View>
                </View>

                {/* Tabla de Productos */}
                <View style={styles.tableSection}>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.tableHeaderLabel, { flex: 2.5 }]}>Producto</Text>
                    <Text style={[styles.tableHeaderLabel, { flex: 0.8, textAlign: 'center' }]}>Cant.</Text>
                    <Text style={[styles.tableHeaderLabel, { flex: 0.7, textAlign: 'center' }]}>Medida</Text>
                    <Text style={[styles.tableHeaderLabel, { flex: 1.3, textAlign: 'right' }]}>Precio ($)</Text>
                    <Text style={{ width: 30 }} />
                  </View>

                  {scannedItems.map((item) => (
                    <View key={item.id} style={styles.tableRow}>
                      <TextInput
                        style={[styles.tableInput, { flex: 2.5 }]}
                        value={item.producto}
                        onChangeText={(val) => handleUpdateItem(item.id, 'producto', val)}
                        placeholder="Producto"
                        placeholderTextColor="#A1A1AA"
                        autoCorrect={false}
                      />
                      <TextInput
                        style={[styles.tableInput, { flex: 0.8, textAlign: 'center' }]}
                        value={item.cantidad.toString()}
                        onChangeText={(val) => handleUpdateItem(item.id, 'cantidad', val)}
                        keyboardType="numeric"
                      />
                      <TextInput
                        style={[styles.tableInput, { flex: 0.7, textAlign: 'center' }]}
                        value={item.unidad_medida}
                        onChangeText={(val) => handleUpdateItem(item.id, 'unidad_medida', val)}
                        placeholder="u"
                        placeholderTextColor="#A1A1AA"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <TextInput
                        style={[styles.tableInput, { flex: 1.3, textAlign: 'right' }]}
                        value={item.precio.toString()}
                        onChangeText={(val) => handleUpdateItem(item.id, 'precio', val)}
                        keyboardType="numeric"
                      />
                      <TouchableOpacity 
                        style={styles.rowDeleteBtn} 
                        onPress={() => handleDeleteItem(item.id)}
                      >
                        <Trash2 size={14} color="#EF4444" strokeWidth={1.5} />
                      </TouchableOpacity>
                    </View>
                  ))}

                  <TouchableOpacity 
                    style={styles.addItemBtn} 
                    onPress={handleAddItem}
                    activeOpacity={0.7}
                  >
                    <Plus size={14} color="#71717A" style={{ marginRight: 6 }} />
                    <Text style={styles.addItemBtnText}>Agregar Producto</Text>
                  </TouchableOpacity>
                </View>

                {/* Suma Total */}
                <View style={styles.totalSection}>
                  <Text style={styles.totalLabel}>Total Calculado:</Text>
                  <Text style={styles.totalValue}>
                    ${calculateTotal().toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </Text>
                </View>

                {/* Botón Guardar */}
                <TouchableOpacity
                  style={styles.modalSubmitButton}
                  onPress={handleSaveTicket}
                  disabled={saving}
                  activeOpacity={0.8}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Check size={16} color="#FFFFFF" strokeWidth={2.5} style={{ marginRight: 8 }} />
                      <Text style={styles.modalSubmitText}>Guardar Compra</Text>
                    </>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          )}
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
    paddingTop: Platform.OS === 'ios' ? 56 : 24,
  },
  topActionContainer: {
    marginTop: 12,
    marginBottom: 24,
  },
  scanButton: {
    flexDirection: 'row',
    backgroundColor: '#09090B',
    borderRadius: 8,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#09090B',
  },
  scanButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  historyHeader: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  historyTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#71717A',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  centered: {
    flex: 0.6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 0.6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#71717A',
    fontSize: 13,
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: 40,
  },
  ticketCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E4E4E7',
    marginBottom: 12,
    overflow: 'hidden',
  },
  ticketHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  ticketMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ticketIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E4E4E7',
    backgroundColor: '#F4F4F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  ticketStore: {
    color: '#09090B',
    fontWeight: '600',
    fontSize: 14,
    letterSpacing: -0.1,
  },
  ticketDate: {
    color: '#71717A',
    fontSize: 11,
    marginTop: 2,
  },
  ticketRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ticketAmount: {
    color: '#09090B',
    fontWeight: '600',
    fontSize: 14,
    letterSpacing: -0.2,
  },
  ticketDetailContainer: {
    backgroundColor: '#F4F4F5',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#E4E4E7',
    marginBottom: 12,
  },
  detailTitle: {
    fontSize: 10,
    fontWeight: '600',
    color: '#71717A',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  detailProductText: {
    color: '#09090B',
    fontSize: 13,
    flex: 2,
  },
  detailQtyPriceText: {
    color: '#71717A',
    fontSize: 12,
    flex: 1.5,
    textAlign: 'center',
  },
  detailSubtotalText: {
    color: '#09090B',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  deleteTicketButton: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    marginTop: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 4,
    backgroundColor: '#EF444410',
    borderWidth: 1,
    borderColor: '#EF444430',
  },
  deleteTicketText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.4)',
    justifyContent: 'flex-end',
  },
  processingCard: {
    backgroundColor: '#FFFFFF',
    padding: 30,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: '#E4E4E7',
  },
  processingTitle: {
    color: '#09090B',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  processingSubtitle: {
    color: '#71717A',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: Platform.OS === 'ios' ? 44 : 30,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: '#E4E4E7',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#09090B',
    letterSpacing: -0.2,
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#F4F4F5',
    borderWidth: 1,
    borderColor: '#E4E4E7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBody: {
    paddingBottom: 20,
  },
  formRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#71717A',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  iconInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    backgroundColor: '#F4F4F5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E4E4E7',
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  modalInput: {
    flex: 1,
    color: '#09090B',
    fontSize: 13,
    height: '100%',
  },
  tableSection: {
    borderWidth: 1,
    borderColor: '#E4E4E7',
    borderRadius: 8,
    backgroundColor: '#F4F4F5',
    padding: 12,
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E4E4E7',
    marginBottom: 8,
  },
  tableHeaderLabel: {
    color: '#71717A',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  tableInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4E4E7',
    borderRadius: 6,
    height: 36,
    paddingHorizontal: 8,
    color: '#09090B',
    fontSize: 13,
  },
  rowDeleteBtn: {
    width: 30,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  addItemBtnText: {
    color: '#71717A',
    fontSize: 12,
    fontWeight: '500',
  },
  totalSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#E4E4E7',
    borderBottomWidth: 1,
    borderBottomColor: '#E4E4E7',
    marginBottom: 24,
  },
  totalLabel: {
    color: '#71717A',
    fontSize: 14,
    fontWeight: '500',
  },
  totalValue: {
    color: '#09090B',
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  modalSubmitButton: {
    height: 48,
    backgroundColor: '#09090B',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSubmitText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
