import { createClient } from '@supabase/supabase-js';

// Admin membuatkan password baru untuk staf yang lupa password.
// Memakai SUPABASE_SERVICE_ROLE_KEY yang hanya ada di server Vercel.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MIN_PASSWORD = 8;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metode tidak diizinkan' });
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: 'Server belum dikonfigurasi (SUPABASE_SERVICE_ROLE_KEY).' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Tidak ada sesi login yang valid.' });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerData?.user) return res.status(401).json({ error: 'Sesi tidak valid, silakan login ulang.' });

  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', callerData.user.id).single();
  if (callerProfile?.role !== 'admin') return res.status(403).json({ error: 'Hanya admin yang boleh mereset password staf.' });

  const { userId, password } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'Staf belum dipilih.' });
  if (!password || String(password).length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password minimal ${MIN_PASSWORD} karakter.` });
  }

  const { data: target } = await admin.from('profiles').select('id, name').eq('id', userId).single();
  if (!target) return res.status(404).json({ error: 'Staf tidak ditemukan.' });

  const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password: String(password) });
  if (updErr) {
    const msg = /weak|at least/i.test(updErr.message)
      ? 'Password terlalu lemah. Gunakan campuran huruf besar, huruf kecil, dan angka.'
      : updErr.message;
    return res.status(400).json({ error: msg });
  }

  return res.status(200).json({ success: true, name: target.name });
}
