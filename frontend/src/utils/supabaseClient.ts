import { createClient } from '@supabase/supabase-js';

// @ts-ignore
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
// @ts-ignore
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
