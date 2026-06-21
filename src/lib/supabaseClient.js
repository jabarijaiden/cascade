import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConnected = !!(
  supabaseUrl && 
  supabaseAnonKey && 
  supabaseUrl !== 'placeholder' &&
  !supabaseUrl.includes('YOUR_SUPABASE')
);

export const supabase = supabaseConnected 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;
