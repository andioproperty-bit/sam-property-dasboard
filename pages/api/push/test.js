// Kirim notifikasi percobaan ke semua HP milik staf yang sedang login.
import { supabaseAdmin } from '../../../lib/waServer';
import { sendPushToUsers } from '../../../lib/push';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method tidak diizinkan' });
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const { data } = await supabaseAdmin().auth.getUser(token);
  const user = data?.user;
  if (!user) return res.status(401).json({ error: 'Sesi login habis. Silakan login ulang.' });

  const r = await sendPushToUsers([user.id], {
    title: 'Tes notifikasi SAM Admin',
    body: 'Notifikasi sudah aktif di perangkat ini. Chat WA baru akan muncul seperti ini.',
    url: '/dashboard?tab=chat',
    tag: 'sam-test',
  });
  if (r.reason === 'no-vapid') return res.status(500).json({ error: 'Kunci notifikasi (VAPID) belum diisi di Vercel.' });
  if (!r.sent) return res.status(400).json({ error: 'Belum ada perangkat aktif. Klik Aktifkan notifikasi dulu.' });
  return res.status(200).json({ ok: true, ...r });
}
