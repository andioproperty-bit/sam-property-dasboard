// Notifikasi HP untuk Divisi Teknik (tiket perawatan & temuan QC).
// Dipanggil dari TeknikTab setelah data tersimpan. Penerima ditentukan di server.
import { supabaseAdmin } from '../../../lib/waServer';
import { sendPushToUsers } from '../../../lib/push';

const PRIO = { darurat: '🚨 DARURAT', tinggi: '⚠️ Prioritas tinggi', normal: 'Tiket baru', rendah: 'Tiket baru' };

async function timTeknik(db) {
  const [{ data: members }, { data: admins }] = await Promise.all([
    db.from('teknik_members').select('profile_id'),
    db.from('profiles').select('id').eq('role', 'admin'),
  ]);
  return Array.from(new Set([...(members || []).map((m) => m.profile_id), ...(admins || []).map((a) => a.id)]));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method tidak diizinkan' });
  try {
    const db = supabaseAdmin();
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await db.auth.getUser(token);
    const me = auth?.user;
    if (!me) return res.status(401).json({ error: 'Sesi login habis' });

    const { type, id } = req.body || {};
    if (!type || !id) return res.status(400).json({ error: 'type dan id wajib' });

    const { data: prof } = await db.from('profiles').select('name').eq('id', me.id).maybeSingle();
    const dari = prof?.name || 'Staf';
    let targets = [];
    let payload = null;

    if (type.startsWith('tiket')) {
      const { data: t } = await db.from('teknik_tiket').select('*, unit:teknik_units(kode)').eq('id', id).maybeSingle();
      if (!t) return res.status(404).json({ error: 'Tiket tidak ditemukan' });
      const no = 'TK-' + String(t.nomor).padStart(4, '0');
      const unit = t.unit?.kode ? ` · Unit ${t.unit.kode}` : '';
      const url = '/dashboard?tab=teknik&v=perawatan';
      if (type === 'tiket_baru') {
        targets = await timTeknik(db);
        payload = { title: `${PRIO[t.prioritas] || 'Tiket baru'} ${no}`, body: `${t.judul}${unit} — dilaporkan ${dari}`, url, tag: 'tk-' + t.id };
      } else if (type === 'tiket_tugas' && t.teknisi) {
        targets = [t.teknisi];
        payload = { title: `Tugas perawatan ${no}`, body: `${t.judul}${unit} — ditugaskan oleh ${dari}`, url, tag: 'tk-' + t.id };
      } else if (type === 'tiket_selesai' && t.pelapor) {
        targets = [t.pelapor];
        payload = { title: `Tiket ${no} selesai ✅`, body: `${t.judul}${unit} — dikerjakan ${dari}`, url, tag: 'tk-' + t.id };
      }
    } else if (type.startsWith('temuan')) {
      const { data: q } = await db.from('teknik_temuan').select('*, unit:teknik_units(kode)').eq('id', id).maybeSingle();
      if (!q) return res.status(404).json({ error: 'Temuan tidak ditemukan' });
      const unit = q.unit?.kode ? `Unit ${q.unit.kode}: ` : '';
      const url = '/dashboard?tab=teknik&v=qc';
      if (type === 'temuan_kritis') {
        targets = await timTeknik(db);
        payload = { title: '🚧 Temuan QC kritis', body: `${unit}${q.deskripsi}`.slice(0, 160), url, tag: 'qc-' + q.id };
      } else if (type === 'temuan_tugas' && q.pic) {
        targets = [q.pic];
        payload = { title: 'Perbaikan QC untuk Anda', body: `${unit}${q.deskripsi}`.slice(0, 160), url, tag: 'qc-' + q.id };
      }
    }

    targets = targets.filter((u) => u && u !== me.id);
    if (!payload || !targets.length) return res.status(200).json({ ok: true, sent: 0 });
    const r = await sendPushToUsers(targets, payload);
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    console.error('[teknik/notify]', e);
    return res.status(500).json({ error: e.message });
  }
}
