import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY belum diatur. ' +
    'Salin .env.local.example menjadi .env.local dan isi dengan kredensial project Supabase-mu.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
