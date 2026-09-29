// Mengirim balasan dari dashboard ke pelanggan lewat WhatsApp Cloud API.
import { supabaseAdmin, sendWhatsAppText } from '../../../lib/waServer';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method tidak diizinkan' });

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Silakan login ulang.' });

  const db = supabaseAdmin();

  const { data: authData, error: authErr } = await db.auth.getUser(token);
  const user = authData?.user;
  if (authErr || !user) return res.status(401).json({ error: 'Sesi login habis. Silakan login ulang.' });

  const { data: profile } = await db.from('profiles').select('id, role').eq('id', user.id).single();
  const isAdmin = profile?.role === 'admin';

  const { conversationId, text } = req.body || {};
  const body = String(text || '').trim();
  if (!conversationId || !body) return res.status(400).json({ error: 'Pesan masih kosong.' });
  if (body.length > 4096) return res.status(400).json({ error: 'Pesan terlalu panjang (maks. 4.096 karakter).' });

  const { data: conv, error: convErr } = await db
    .from('wa_conversations')
    .select('*')
    .eq('id', conversationId)
    .single();
  if (convErr || !conv) return res.status(404).json({ error: 'Chat tidak ditemukan.' });

  if (!isAdmin && conv.assigned_to && conv.assigned_to !== user.id) {
    return res.status(403).json({ error: 'Chat ini sedang dipegang agen lain.' });
  }

  const lastIn = conv.last_inbound_at ? new Date(conv.last_inbound_at).getTime() : 0;
  if (!lastIn || Date.now() - lastIn > WINDOW_MS) {
    return res.status(409).json({
      error: 'Sudah lewat 24 jam sejak pesan terakhir pelanggan. Balasan bebas ditolak WhatsApp; gunakan pesan template (Fase 3) atau tunggu pelanggan mengirim pesan lagi.',
    });
  }

  let waMessageId;
  try {
    waMessageId = await sendWhatsAppText(conv.wa_id, body);
  } catch (e) {
    return res.status(502).json({ error: 'WhatsApp menolak pesan: ' + e.message });
  }

  const at = new Date().toISOString();
  const { data: msg, error: insErr } = await db
    .from('wa_messages')
    .insert({
      conversation_id: conv.id,
      wa_message_id: waMessageId,
      direction: 'out',
      msg_type: 'text',
      body,
      status: 'sent',
      sent_by: user.id,
      created_at: at,
    })
    .select('id, direction, body, msg_type, status, error, sent_by, created_at')
    .single();
  if (insErr) console.error('[wa-send] pesan terkirim tapi gagal disimpan:', insErr.message);

  await db.rpc('wa_register_outbound', { p_conversation_id: conv.id, p_preview: body.slice(0, 200), p_at: at });

  // Yang pertama membalas otomatis memegang chat & lead-nya
  if (!conv.assigned_to) {
    await db.from('wa_conversations').update({ assigned_to: user.id }).eq('id', conv.id).is('assigned_to', null);
    if (conv.lead_id) {
      await db.from('leads').update({ agent_id: user.id }).eq('id', conv.lead_id).is('agent_id', null);
    }
  }

  return res.status(200).json({ ok: true, message: msg || null });
}
