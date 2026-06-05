import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { supabase } from '../src/utils/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { View, ActivityIndicator } from 'react-native';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    // Verificar sesión actual al cargar
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Suscribirse a cambios en el estado de autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!session && !inAuthGroup) {
      // Redirigir a login si no hay sesión
      router.replace('/login');
    } else if (session && (inAuthGroup || segments.length === 0 || segments[0] === 'index')) {
      // Redirigir a dashboard si ya hay sesión y se está en la pantalla de login o raíz
      router.replace('/dashboard');
    }
  }, [session, loading, segments]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212' }}>
        <ActivityIndicator size="large" color="#6366F1" />
      </View>
    );
  }

  return <Slot />;
}
