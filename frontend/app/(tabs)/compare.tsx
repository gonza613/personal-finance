import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { supabase } from '../../src/utils/supabaseClient';
import { Ionicons } from '@expo/vector-icons';

interface PriceRecord {
  supermarket: string;
  unitPrice: number;
  totalPrice: number;
  quantity: number;
  date: string;
}

interface ProductGroup {
  productName: string;
  brand: string;
  unit: string;
  prices: PriceRecord[];
  cheapest: PriceRecord;
}

function formatDate(dateStr: string) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

export default function CompareScreen() {
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ProductGroup[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const handleSearch = useCallback(async (term: string) => {
    const cleanTerm = term.trim();
    if (!cleanTerm) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ticket_detalles')
        .select(`
          id, producto, precio, cantidad,
          tickets!inner(
            fecha,
            comercio
          )
        `)
        .ilike('producto', `%${cleanTerm}%`);

      if (error) throw error;

      // Group by normalized name
      const groups: Record<string, ProductGroup> = {};

      (data || []).forEach((item: any) => {
        const prodName = item.producto || '';
        const key = prodName.trim().toLowerCase();

        if (!groups[key]) {
          groups[key] = {
            productName: prodName,
            brand: 'Sin marca',
            unit: 'unidad',
            prices: [],
            cheapest: {} as any
          };
        }

        const unitPrice = Number(item.precio) || 0;
        const qty = Number(item.cantidad) || 1;

        groups[key].prices.push({
          supermarket: item.tickets.comercio,
          unitPrice: unitPrice,
          totalPrice: unitPrice * qty,
          quantity: qty,
          date: item.tickets.fecha,
        });
      });

      // Format and sort prices
      const formatted = Object.values(groups).map((group) => {
        // Sort from cheapest to most expensive
        const sortedPrices = group.prices.sort((a, b) => a.unitPrice - b.unitPrice);
        return {
          ...group,
          prices: sortedPrices,
          cheapest: sortedPrices[0],
        };
      });

      setResults(formatted);
    } catch (err) {
      console.error('Error al buscar precios:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      handleSearch(search);
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [search, handleSearch]);

  const toggleExpand = (idx: number) => {
    setExpandedIndex(expandedIndex === idx ? null : idx);
  };

  const renderProductItem = ({ item, index }: { item: ProductGroup; index: number }) => {
    const isExpanded = expandedIndex === index;
    return (
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.cardHeader}
          activeOpacity={0.8}
          onPress={() => toggleExpand(index)}
        >
          <View style={styles.productInfo}>
            <Text style={styles.productName}>{item.productName}</Text>
            <Text style={styles.productBrand}>
              {item.brand} {item.unit ? `• ${item.unit}` : ''}
            </Text>
          </View>
          <View style={styles.cheapestInfo}>
            <Text style={styles.cheapestLabel}>Más barato en</Text>
            <Text style={styles.cheapestPrice}>
              ${item.cheapest.unitPrice.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </Text>
            <Text style={styles.cheapestSuper}>{item.cheapest.supermarket}</Text>
          </View>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color="#000000"
            style={{ marginLeft: 8 }}
          />
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.expandedContent}>
            <View style={styles.divider} />
            <Text style={styles.historyTitle}>Historial por supermercado:</Text>
            {item.prices.map((price, pIdx) => {
              const isCheapest = pIdx === 0;
              return (
                <View
                  key={pIdx}
                  style={[
                    styles.priceRow,
                    isCheapest && styles.cheapestPriceRow,
                  ]}
                >
                  <View style={styles.priceRowLeft}>
                    <Ionicons
                      name="storefront-outline"
                      size={16}
                      color={isCheapest ? '#10B981' : '#666666'}
                      style={{ marginRight: 8 }}
                    />
                    <View>
                      <Text style={styles.supermarketName}>{price.supermarket}</Text>
                      <Text style={styles.purchaseMeta}>
                        {formatDate(price.date)} • x{price.quantity} {item.unit || 'u'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.priceRowRight}>
                    <Text style={[styles.unitPriceText, isCheapest && styles.cheapestUnitPriceText]}>
                      ${price.unitPrice.toLocaleString('es-AR', { minimumFractionDigits: 2 })} /u
                    </Text>
                    {isCheapest && (
                      <View style={styles.cheapestTag}>
                        <Text style={styles.cheapestTagText}>El más barato</Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Comparar Precios</Text>
        <Text style={styles.subtitle}>Encuentra en qué supermercado pagaste más barato tus productos</Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={18} color="#666666" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Ej: Leche, Yerba, Coca Cola..."
          placeholderTextColor="#A3A3A3"
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color="#999999" />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color="#000000" />
        </View>
      ) : search.trim() && results.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="pricetag-outline" size={48} color="#CCCCCC" />
          <Text style={styles.emptyTitle}>Sin registros del producto</Text>
          <Text style={styles.emptySubtitle}>Asegúrate de escribir bien el nombre o subir fotos de tus tickets primero.</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          renderItem={renderProductItem}
          keyExtractor={(_, index) => index.toString()}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    padding: 20,
    paddingBottom: 10,
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    backgroundColor: '#FFFFFF',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontSize: 14,
    color: '#000000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  card: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    justifyContent: 'space-between',
  },
  productInfo: {
    flex: 1.2,
    paddingRight: 10,
  },
  productName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 4,
  },
  productBrand: {
    fontSize: 12,
    color: '#666666',
  },
  cheapestInfo: {
    flex: 0.8,
    alignItems: 'flex-end',
  },
  cheapestLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#999999',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  cheapestPrice: {
    fontSize: 16,
    fontWeight: '800',
    color: '#10B981',
  },
  cheapestSuper: {
    fontSize: 11,
    fontWeight: '600',
    color: '#333333',
  },
  expandedContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E5E5',
    marginBottom: 12,
  },
  historyTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#999999',
    marginBottom: 10,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#FBFBFB',
    marginBottom: 8,
  },
  cheapestPriceRow: {
    backgroundColor: '#F0FDF4',
    borderColor: '#A7F3D0',
  },
  priceRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  supermarketName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000000',
  },
  purchaseMeta: {
    fontSize: 11,
    color: '#666666',
    marginTop: 2,
  },
  priceRowRight: {
    alignItems: 'flex-end',
  },
  unitPriceText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333333',
  },
  cheapestUnitPriceText: {
    color: '#10B981',
    fontWeight: '800',
  },
  cheapestTag: {
    backgroundColor: '#10B981',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
  },
  cheapestTagText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333333',
    marginTop: 12,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 18,
  },
});
