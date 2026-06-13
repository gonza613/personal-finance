import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#000000',
        tabBarInactiveTintColor: '#737373',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E5E5E5',
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
          paddingTop: 10,
        },
        headerStyle: {
          backgroundColor: '#FFFFFF',
          borderBottomColor: '#E5E5E5',
          borderBottomWidth: 1,
          elevation: 0,
          shadowOpacity: 0,
        },
        headerTitleStyle: {
          color: '#000000',
          fontSize: 16,
          fontWeight: '800',
          letterSpacing: -0.2,
        },
        headerTitleAlign: 'center',
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Resumen',
          tabBarLabel: 'Resumen',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="compras"
        options={{
          title: 'Compras',
          tabBarLabel: 'Compras',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cart-outline" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="promos"
        options={{
          title: 'Promociones',
          tabBarLabel: 'Promos',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pricetags-outline" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="inversiones"
        options={{
          title: 'Inversiones',
          tabBarLabel: 'Inversiones',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trending-up-outline" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Asistente IA',
          tabBarLabel: 'Asistente',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles-outline" size={20} color={color} />
          ),
        }}
      />
      {/* Ocultar las páginas viejas que ya no se usan */}
      <Tabs.Screen
        name="scan"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="compare"
        options={{
          title: 'Comparar Precios',
          tabBarLabel: 'Comparar',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="git-compare-outline" size={20} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
