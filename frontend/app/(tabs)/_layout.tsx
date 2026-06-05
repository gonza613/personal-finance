import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View } from 'react-native';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#6366F1', // Indigo 500
        tabBarInactiveTintColor: '#64748B', // Slate 500
        tabBarStyle: {
          backgroundColor: '#0F172A', // Slate 900
          borderTopColor: '#1E293B', // Slate 800
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
          paddingTop: 10,
        },
        headerStyle: {
          backgroundColor: '#0F172A',
          borderBottomColor: '#1E293B',
          borderBottomWidth: 1,
        },
        headerTitleStyle: {
          color: '#F8FAFC',
          fontSize: 18,
          fontWeight: '700',
        },
        headerTitleAlign: 'center',
        tabBarShowLabel: true,
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Resumen',
          tabBarLabel: 'Dashboard',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Ionicons name="wallet" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="inversiones"
        options={{
          title: 'Inversiones',
          tabBarLabel: 'Inversiones',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Ionicons name="trending-up" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Asistente IA',
          tabBarLabel: 'Asistente',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Ionicons name="chatbubbles" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
