import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Image,
  Modal,
} from 'react-native';
import { supabase } from '../../src/utils/supabaseClient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

const UNITS = ['unidad', 'kg', 'g', 'litro', 'ml', 'pack'];

interface TicketItem {
  product_name: string;
  brand: string;
  quantity: number;
  unit: string;
  unit_price: number | '';
  total_price: number | '';
}

const emptyItem = (): TicketItem => ({
  product_name: '',
  brand: '',
  quantity: 1,
  unit: 'unidad',
  unit_price: '',
  total_price: '',
});

export default function ScanScreen() {
  const router = useRouter();
  const [images, setImages] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [activeStep, setActiveStep] = useState(0); // 0 = upload, 1 = edit/review
  
  // Scanned / Editable fields
  const [supermarketName, setSupermarketName] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [items, setItems] = useState<TicketItem[]>([emptyItem()]);
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // History and custom unit picker states
  const [tickets, setTickets] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [activeUnitItemIdx, setActiveUnitItemIdx] = useState<number | null>(null);

  React.useEffect(() => {
    fetchTickets();
  }, []);

  const fetchTickets = async () => {
    setLoadingHistory(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('tickets')
        .select(`
          id,
          purchase_date,
          total_amount,
          supermarkets (
            name
          )
        `)
        .eq('user_id', user.id)
        .order('purchase_date', { ascending: false });

      if (error) throw error;
      setTickets(data || []);
    } catch (err: any) {
      console.log('Error fetching tickets:', err.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleDeleteTicket = async (id: string, supermarketName: string, totalAmount: number, purchaseDate: string) => {
    Alert.alert(
      'Eliminar Ticket',
      `¿Deseas eliminar el ticket de "${supermarketName}" y todos sus productos?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              // 1. Borrar en cascada por foreign key en Supabase
              const { error } = await supabase.from('tickets').delete().eq('id', id);
              if (error) throw error;

              // 2. Borrar el gasto correspondiente en la tabla de gastos
              const { error: gastoError } = await supabase
                .from('gastos')
                .delete()
                .eq('descripcion', `Compra en ${supermarketName}`)
                .eq('monto', totalAmount);

              if (gastoError) console.log("Error deleting corresponding gasto:", gastoError);

              fetchTickets();
              Alert.alert('Eliminado', 'El ticket y su gasto asociado han sido eliminados.');
            } catch (err: any) {
              Alert.alert('Error', err.message || 'No se pudo eliminar el ticket.');
            }
          }
        }
      ]
    );
  };

  // Compression helper
  const compressImage = async (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const img = new (window as any).Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxWidth = 1200;
          const ratio = Math.min(maxWidth / img.width, 1);
          canvas.width = img.width * ratio;
          canvas.height = img.height * ratio;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          }
          resolve(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
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

      if (!result.canceled && result.assets?.[0]?.base64) {
        const asset = result.assets[0];
        const base64Data = `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
        setImages((prev) => [...prev, base64Data]);
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

      if (!result.canceled && result.assets?.[0]?.base64) {
        const asset = result.assets[0];
        const base64Data = `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
        setImages((prev) => [...prev, base64Data]);
      }
    } catch (error: any) {
      Alert.alert('Error', 'Ocurrió un error al abrir la galería: ' + error.message);
    }
  };

  const handlePickImages = () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = async (e: any) => {
        const files = e.target.files;
        if (files && files.length > 0) {
          setScanning(true);
          try {
            const compressed = await Promise.all(Array.from(files).map((f: any) => compressImage(f)));
            setImages((prev) => [...prev, ...compressed]);
          } catch (err) {
            Alert.alert('Error', 'No se pudieron procesar las imágenes.');
          } finally {
            setScanning(false);
          }
        }
      };
      input.click();
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

  const handleScan = async () => {
    if (images.length === 0) return;
    setScanning(true);
    setError(null);

    try {
      const baseUrl = Platform.OS === 'web' ? '' : 'https://personal-finance-eight.vercel.app';
      const response = await fetch(`${baseUrl}/api/scan-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Error al analizar el ticket con IA.');
      }

      const data = await response.json();

      setSupermarketName(data.supermarket || '');
      setPurchaseDate(data.purchase_date || new Date().toISOString().split('T')[0]);
      
      const normalizedItems = Array.isArray(data.items)
        ? data.items.map((item: any) => ({
            product_name: String(item.product_name || ''),
            brand: item.brand || '',
            quantity: Number(item.quantity) || 1,
            unit: item.unit || 'unidad',
            unit_price: item.unit_price != null ? Number(item.unit_price) : '',
            total_price: item.total_price != null ? Number(item.total_price) : '',
          }))
        : [emptyItem()];

      setItems(normalizedItems);
      setActiveStep(1);
    } catch (err: any) {
      setError(err.message || 'Error al procesar el ticket.');
    } finally {
      setScanning(false);
    }
  };

  const updateItem = (idx: number, field: keyof TicketItem, value: any) => {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value } as any;

      // Auto calculate total if qty and price are valid
      if (field === 'quantity' || field === 'unit_price') {
        const qty = Number(next[idx].quantity);
        const price = Number(next[idx].unit_price);
        if (!isNaN(qty) && !isNaN(price) && next[idx].unit_price !== '') {
          next[idx].total_price = Number((qty * price).toFixed(2));
        }
      }
      return next;
    });
  };

  const addItem = () => {
    setItems((prev) => [...prev, emptyItem()]);
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const calculateTotal = () => {
    return items.reduce((acc, item) => acc + (Number(item.total_price) || 0), 0);
  };

  const handleSave = async () => {
    if (!purchaseDate) {
      Alert.alert('Error', 'Por favor ingresa la fecha de compra.');
      return;
    }
    if (!supermarketName.trim()) {
      Alert.alert('Error', 'Por favor ingresa el supermercado.');
      return;
    }
    const filteredItems = items.filter((i) => i.product_name.trim());
    if (filteredItems.length === 0) {
      Alert.alert('Error', 'Por favor agrega al menos un producto con nombre.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No se encontró sesión de usuario.');

      // 1. Insert or find supermarket
      let supermarketId = null;
      const cleanSupName = supermarketName.trim();

      const { data: existingSup, error: supFindError } = await supabase
        .from('supermarkets')
        .select('id')
        .ilike('name', cleanSupName)
        .maybeSingle();

      if (supFindError) throw supFindError;

      if (existingSup) {
        supermarketId = existingSup.id;
      } else {
        const { data: newSup, error: supInsertError } = await supabase
          .from('supermarkets')
          .insert({ name: cleanSupName })
          .select('id')
          .single();

        if (supInsertError) throw supInsertError;
        supermarketId = newSup.id;
      }

      // 2. Insert Ticket
      const ticketTotal = calculateTotal();
      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .insert({
          supermarket_id: supermarketId,
          purchase_date: purchaseDate,
          total_amount: ticketTotal,
          user_id: user.id,
        })
        .select('id')
        .single();

      if (ticketError) throw ticketError;

      // 3. Insert Ticket Items
      const ticketItems = filteredItems.map((item) => ({
        ticket_id: ticket.id,
        product_name: item.product_name.trim(),
        brand: item.brand ? item.brand.trim() : null,
        quantity: Number(item.quantity) || 1,
        unit: item.unit,
        unit_price: Number(item.unit_price) || 0,
        total_price: Number(item.total_price) || 0,
      }));

      const { error: itemsError } = await supabase
        .from('ticket_items')
        .insert(ticketItems);

      if (itemsError) throw itemsError;

      // 4. Insert Gasto automatically so dashboard monthly spend is updated
      const { error: gastoError } = await supabase
        .from('gastos')
        .insert({
          user_id: user.id,
          monto: ticketTotal,
          categoria: 'Supermercado',
          descripcion: `Compra en ${cleanSupName}`,
          fecha: new Date(purchaseDate + 'T12:00:00').toISOString(), // Set local mid-day
        });

      if (gastoError) console.log("Gasto insert error:", gastoError);

      setSuccess(true);
      fetchTickets();
    } catch (err: any) {
      setError(err.message || 'Error al guardar el ticket.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setImages([]);
    setSupermarketName('');
    setPurchaseDate(new Date().toISOString().split('T')[0]);
    setItems([emptyItem()]);
    setActiveStep(0);
    setError(null);
    setSuccess(false);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      {success ? (
        <View style={styles.successContainer}>
          <Ionicons name="checkmark-circle" size={80} color="#10B981" />
          <Text style={styles.successTitle}>¡Ticket Guardado!</Text>
          <Text style={styles.successSubtitle}>El ticket se ha guardado correctamente y sumado a tus gastos del mes.</Text>
          <TouchableOpacity style={styles.successButton} onPress={handleReset}>
            <Text style={styles.successButtonText}>Escanear otro ticket</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Escanear Ticket</Text>
            <Text style={styles.subtitle}>Sube la foto del ticket y la IA extraerá los productos por ti</Text>
          </View>

          {/* Steps indicator */}
          <View style={styles.stepper}>
            <View style={styles.step}>
              <View style={[styles.stepDot, activeStep >= 0 && styles.activeStepDot]} />
              <Text style={[styles.stepText, activeStep >= 0 && styles.activeStepText]}>Subir fotos</Text>
            </View>
            <View style={styles.stepDivider} />
            <View style={styles.step}>
              <View style={[styles.stepDot, activeStep >= 1 && styles.activeStepDot]} />
              <Text style={[styles.stepText, activeStep >= 1 && styles.activeStepText]}>Editar y Guardar</Text>
            </View>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={20} color="#FF3B30" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {activeStep === 0 ? (
            // UPLOADER
            <>
              <View style={styles.uploadCard}>
                <TouchableOpacity
                  style={styles.dropzone}
                  activeOpacity={0.8}
                  onPress={handlePickImages}
                >
                  <Ionicons name="cloud-upload-outline" size={48} color="#000000" style={styles.uploadIcon} />
                  <Text style={styles.uploadTitle}>Seleccionar fotos del ticket</Text>
                  <Text style={styles.uploadSubtitle}>Presiona para buscar en tus archivos o tomar foto</Text>
                </TouchableOpacity>

                {images.length > 0 && (
                  <View style={styles.previewContainer}>
                    <Text style={styles.previewHeader}>{images.length} Imagenes cargadas</Text>
                    <View style={styles.imagesGrid}>
                      {images.map((img, idx) => (
                        <View key={idx} style={styles.imageWrapper}>
                          <Image source={{ uri: img }} style={styles.previewImage} />
                          <TouchableOpacity
                            style={styles.deleteBadge}
                            onPress={() => setImages((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            <Ionicons name="close" size={14} color="#FFFFFF" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>

                    {scanning ? (
                      <View style={styles.loadingBox}>
                        <ActivityIndicator size="small" color="#000000" />
                        <Text style={styles.loadingText}>Analizando con Inteligencia Artificial...</Text>
                      </View>
                    ) : (
                      <TouchableOpacity style={styles.scanButton} onPress={handleScan}>
                        <Ionicons name="sparkles-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                        <Text style={styles.scanButtonText}>Analizar Ticket con IA</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>

              {/* Historial de tickets */}
              <View style={styles.historySection}>
                <Text style={styles.historyTitle}>Historial de Tickets</Text>
                {loadingHistory ? (
                  <ActivityIndicator size="small" color="#000000" style={{ marginVertical: 20 }} />
                ) : tickets.length === 0 ? (
                  <Text style={styles.emptyHistoryText}>No tienes tickets cargados aún.</Text>
                ) : (
                  tickets.map((ticket) => {
                    const formattedDate = new Date(ticket.purchase_date + 'T12:00:00').toLocaleDateString('es-AR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric'
                    });
                    const storeName = ticket.supermarkets?.name || 'Supermercado';

                    return (
                      <View key={ticket.id} style={styles.ticketCard}>
                        <View style={styles.ticketHeader}>
                          <View>
                            <Text style={styles.ticketStore}>{storeName}</Text>
                            <Text style={styles.ticketDate}>{formattedDate}</Text>
                          </View>
                          <View style={styles.ticketRight}>
                            <Text style={styles.ticketAmount}>
                              ${(ticket.total_amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                            </Text>
                            <TouchableOpacity 
                              style={styles.deleteTicketBtn} 
                              onPress={() => handleDeleteTicket(ticket.id, storeName, ticket.total_amount, ticket.purchase_date)}
                            >
                              <Ionicons name="trash-outline" size={16} color="#FF3B30" />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            </>
          ) : (
            // EDITOR
            <View style={styles.editorCard}>
              <Text style={styles.sectionHeader}>INFORMACIÓN GENERAL</Text>
              <View style={styles.metaForm}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Supermercado</Text>
                  <TextInput
                    style={styles.input}
                    value={supermarketName}
                    onChangeText={setSupermarketName}
                    placeholder="Ej. Carrefour, Coto"
                    placeholderTextColor="#A3A3A3"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Fecha de compra</Text>
                  <TextInput
                    style={styles.input}
                    value={purchaseDate}
                    onChangeText={setPurchaseDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#A3A3A3"
                  />
                </View>
              </View>

              <View style={styles.sectionDivider} />

              <View style={styles.itemsHeader}>
                <Text style={styles.sectionHeader}>PRODUCTOS DETECTADOS</Text>
                <TouchableOpacity style={styles.addItemBtn} onPress={addItem}>
                  <Ionicons name="add" size={16} color="#000000" />
                  <Text style={styles.addItemBtnText}>Agregar</Text>
                </TouchableOpacity>
              </View>

              {items.map((item, idx) => (
                <View key={idx} style={styles.itemCard}>
                  <View style={styles.itemRowHeader}>
                    <Text style={styles.itemIndex}>Producto #{idx + 1}</Text>
                    <TouchableOpacity onPress={() => removeItem(idx)}>
                      <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.itemForm}>
                    <TextInput
                      style={[styles.input, styles.itemInputName]}
                      value={item.product_name}
                      onChangeText={(val) => updateItem(idx, 'product_name', val)}
                      placeholder="Nombre del producto"
                      placeholderTextColor="#A3A3A3"
                    />

                    <TextInput
                      style={[styles.input, styles.itemInputBrand]}
                      value={item.brand}
                      onChangeText={(val) => updateItem(idx, 'brand', val)}
                      placeholder="Marca (opcional)"
                      placeholderTextColor="#A3A3A3"
                    />

                    {/* Fila 2x2 para celular */}
                    <View style={styles.itemRowInputsContainer}>
                      <View style={styles.itemRowInner}>
                        <View style={[styles.inputField, { flex: 1 }]}>
                          <Text style={styles.inputMiniLabel}>Cant.</Text>
                          <TextInput
                            style={styles.input}
                            value={String(item.quantity)}
                            onChangeText={(val) => updateItem(idx, 'quantity', Number(val) || 0)}
                            keyboardType="numeric"
                            placeholder="1"
                            placeholderTextColor="#A3A3A3"
                          />
                        </View>
                        <View style={[styles.inputField, { flex: 1.5 }]}>
                          <Text style={styles.inputMiniLabel}>Unidad</Text>
                          <TouchableOpacity 
                            style={styles.pickerTrigger} 
                            onPress={() => setActiveUnitItemIdx(idx)}
                          >
                            <Text style={styles.pickerTriggerText}>{item.unit}</Text>
                            <Ionicons name="chevron-down" size={14} color="#666666" />
                          </TouchableOpacity>
                        </View>
                      </View>
                      <View style={styles.itemRowInner}>
                        <View style={[styles.inputField, { flex: 1 }]}>
                          <Text style={styles.inputMiniLabel}>Precio Unit.</Text>
                          <TextInput
                            style={styles.input}
                            value={item.unit_price === '' ? '' : String(item.unit_price)}
                            onChangeText={(val) => updateItem(idx, 'unit_price', val === '' ? '' : Number(val) || 0)}
                            keyboardType="numeric"
                            placeholder="$ 0.00"
                            placeholderTextColor="#A3A3A3"
                          />
                        </View>
                        <View style={[styles.inputField, { flex: 1 }]}>
                          <Text style={styles.inputMiniLabel}>Precio Total</Text>
                          <TextInput
                            style={styles.input}
                            value={item.total_price === '' ? '' : String(item.total_price)}
                            onChangeText={(val) => updateItem(idx, 'total_price', val === '' ? '' : Number(val) || 0)}
                            keyboardType="numeric"
                            placeholder="$ 0.00"
                            placeholderTextColor="#A3A3A3"
                          />
                        </View>
                      </View>
                    </View>
                  </View>
                </View>
              ))}

              <View style={styles.totalCard}>
                <Text style={styles.totalLabel}>Monto total calculado</Text>
                <Text style={styles.totalAmount}>${calculateTotal().toLocaleString('es-AR', { minimumFractionDigits: 2 })}</Text>
              </View>

              {saving ? (
                <ActivityIndicator size="small" color="#000000" style={{ marginVertical: 20 }} />
              ) : (
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                    <Ionicons name="checkmark-done" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.saveButtonText}>Guardar Ticket</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.cancelButton} onPress={handleReset}>
                    <Text style={styles.cancelButtonText}>Volver a escanear</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </>
      )}

      {/* Modal Selector de Unidades */}
      <Modal transparent visible={activeUnitItemIdx !== null} animationType="fade" onRequestClose={() => setActiveUnitItemIdx(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setActiveUnitItemIdx(null)}>
          <View style={styles.pickerModalContent}>
            <Text style={styles.pickerModalTitle}>Seleccionar Unidad</Text>
            {UNITS.map((unit) => (
              <TouchableOpacity
                key={unit}
                style={styles.pickerOption}
                onPress={() => {
                  if (activeUnitItemIdx !== null) {
                    updateItem(activeUnitItemIdx, 'unit', unit);
                    setActiveUnitItemIdx(null);
                  }
                }}
              >
                <Text style={styles.pickerOptionText}>{unit}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#000000',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 20,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E5E5E5',
    marginRight: 8,
  },
  activeStepDot: {
    backgroundColor: '#000000',
  },
  stepText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#999999',
  },
  activeStepText: {
    color: '#000000',
    fontWeight: '700',
  },
  stepDivider: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E5E5',
    marginHorizontal: 12,
  },
  errorBox: {
    flexDirection: 'row',
    backgroundColor: '#FFF2F2',
    borderWidth: 1,
    borderColor: '#FFD2D2',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 13,
    marginLeft: 8,
    fontWeight: '500',
  },
  uploadCard: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 16,
    padding: 24,
    backgroundColor: '#FFFFFF',
  },
  dropzone: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#E5E5E5',
    borderRadius: 12,
    paddingVertical: 40,
    alignItems: 'center',
    backgroundColor: '#FBFBFB',
  },
  uploadIcon: {
    marginBottom: 12,
  },
  uploadTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 6,
  },
  uploadSubtitle: {
    fontSize: 12,
    color: '#666666',
  },
  previewContainer: {
    marginTop: 24,
  },
  previewHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#666666',
    marginBottom: 12,
  },
  imagesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  imageWrapper: {
    position: 'relative',
  },
  previewImage: {
    width: 72,
    height: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  deleteBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#FF3B30',
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanButton: {
    flexDirection: 'row',
    backgroundColor: '#000000',
    borderRadius: 10,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  loadingBox: {
    flexDirection: 'row',
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 13,
    color: '#666666',
    marginLeft: 8,
    fontWeight: '500',
  },
  editorCard: {
    backgroundColor: '#FFFFFF',
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '800',
    color: '#999999',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  metaForm: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 20,
  },
  inputGroup: {
    flex: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#666666',
    marginBottom: 6,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#000000',
    backgroundColor: '#FFFFFF',
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#E5E5E5',
    marginVertical: 20,
  },
  itemsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addItemBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000000',
    marginLeft: 4,
  },
  itemCard: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 12,
    padding: 16,
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  itemRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  itemIndex: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000000',
  },
  itemForm: {
    gap: 10,
  },
  itemInputName: {
    width: '100%',
  },
  itemInputBrand: {
    width: '100%',
  },
  totalCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 10,
    padding: 16,
    marginVertical: 20,
    backgroundColor: '#FBFBFB',
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666666',
  },
  totalAmount: {
    fontSize: 20,
    fontWeight: '800',
    color: '#000000',
  },
  actions: {
    gap: 12,
  },
  saveButton: {
    flexDirection: 'row',
    backgroundColor: '#000000',
    height: 48,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  cancelButton: {
    height: 48,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  cancelButtonText: {
    color: '#666666',
    fontWeight: '600',
    fontSize: 14,
  },
  successContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#000000',
    marginTop: 20,
    marginBottom: 10,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 30,
  },
  successButton: {
    backgroundColor: '#000000',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 10,
  },
  successButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  itemRowInputsContainer: {
    gap: 8,
    marginTop: 4,
  },
  itemRowInner: {
    flexDirection: 'row',
    gap: 8,
  },
  inputField: {
    gap: 4,
  },
  inputMiniLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#666666',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  pickerTrigger: {
    flexDirection: 'row',
    height: 44,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
  },
  pickerTriggerText: {
    fontSize: 16,
    color: '#000000',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  pickerModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 320,
    gap: 12,
  },
  pickerModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#000000',
    textAlign: 'center',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pickerOption: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    alignItems: 'center',
  },
  pickerOptionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    textTransform: 'capitalize',
  },
  historySection: {
    marginTop: 40,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    paddingTop: 30,
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#000000',
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyHistoryText: {
    fontSize: 14,
    color: '#999999',
    textAlign: 'center',
    marginVertical: 20,
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ticketStore: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
  },
  ticketDate: {
    fontSize: 12,
    color: '#666666',
    marginTop: 2,
  },
  ticketRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ticketAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
  },
  deleteTicketBtn: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#FF3B3010',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ticketCard: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
  },
});
