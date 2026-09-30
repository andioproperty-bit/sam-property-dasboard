// Simpan / hapus langganan notifikasi untuk HP yang sedang dipakai staf.
import { supabaseAdmin } from '../../../lib/waServer';

async function getUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await supabaseAdmin().auth.getUser(token);
  return data?.user || null;
}

export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Sesi login habis. Silakan login ulang.' });
  const db = supabaseAdmin();

  if (req.method === 'POST') {
    const sub = req.body?.subscription;
    const endpoint = sub?.endpoint;
    const p256dh = sub?.keys?.p256dh;
    const auth = sub?.keys?.auth;
    if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: 'Data langganan tidak lengkap.' });

    const { error } = await db.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
      },
      { onConflict: 'endpoint' }
    );
    if (error) return res.status(500).json({ error: 'Gagal menyimpan: ' + error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const endpoint = req.body?.endpoint;
    if (!endpoint) return res.status(400).json({ error: 'Endpoint kosong.' });
    await db.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', user.id);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method tidak diizinkan' });
}
