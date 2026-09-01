import { createClient } from '@supabase/supabase-js';

// PENTING: Pakai SUPABASE_SERVICE_ROLE_KEY (tanpa prefix NEXT_PUBLIC_)
// supaya nilainya TIDAK pernah terkirim ke browser. Ini kode yang jalan
// di server Vercel, bukan di kode yang dilihat pengguna.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metode tidak diizinkan' });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Server belum dikonfigurasi. Tambahkan SUPABASE_SERVICE_ROLE_KEY di Environment Variables Vercel.',
    });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Tidak ada sesi login yang valid.' });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Pastikan yang minta ini benar-benar user yang sedang login
  const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
  if (callerError || !callerData?.user) {
    return res.status(401).json({ error: 'Sesi tidak valid, silakan login ulang.' });
  }

  // Pastikan yang minta ini role-nya admin
  const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .single();

  if (callerProfileError || callerProfile?.role !== 'admin') {
    return res.status(403).json({ error: 'Hanya admin yang boleh menambah staf baru.' });
  }

  const { name, email, password, phone } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nama wajib diisi.' });
  }
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Email wajib diisi.' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password minimal 6 karakter.' });
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true, // langsung aktif, tidak perlu verifikasi email (menghindari limit kirim email)
    user_metadata: { name: name.trim() },
  });

  if (createError) {
    return res.status(400).json({ error: createError.message });
  }

  // Lengkapi data nama & telepon di tabel profiles (trigger otomatis sudah bikin barisnya)
  if (created?.user?.id) {
    await supabaseAdmin
      .from('profiles')
      .update({ name: name.trim(), phone: phone ? phone.trim() : null })
      .eq('id', created.user.id);
  }

  return res.status(200).json({ success: true, userId: created?.user?.id });
}
