// Kirim gambar / video / audio / dokumen dari dashboard.
// File sudah diunggah browser ke Storage (folder out/), endpoint ini meneruskannya ke WhatsApp.
import { supabaseAdmin, sendWhatsAppMedia, mediaKindForMime } from '../../../lib/waServer';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const LABEL = { image: '[Gambar]', video: '[Video]', audio: '[Audio]', document: '[Dokumen]' };

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method tidak diizinkan' });

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Silakan login ulang.' });
  const db = supabaseAdmin();
  const { data: authData } = await db.auth.getUser(token);
  const user = authData?.user;
  if (!user) return res.status(401).json({ error: 'Sesi login habis. Silakan login ulang.' });

  const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).single();
  const isAdmin = profile?.role === 'admin';

  const { conversationId, path, mime, name, size, caption } = req.body || {};
  if (!conversationId || !path || !String(path).startsWith('out/')) {
    return res.status(400).json({ error: 'File tidak valid.' });
  }

  const { data: conv } = await db.from('wa_conversations').select('*').eq('id', conversationId).single();
  if (!conv) return res.status(404).json({ error: 'Chat tidak ditemukan.' });
  if (!isAdmin && conv.assigned_to && conv.assigned_to !== user.id) {
    return res.status(403).json({ error: 'Chat ini sedang dipegang agen lain.' });
  }
  const lastIn = conv.last_inbound_at ? new Date(conv.last_inbound_at).getTime() : 0;
  if (!lastIn || Date.now() - lastIn > WINDOW_MS) {
    return res.status(409).json({ error: 'Sudah lewat 24 jam sejak pesan terakhir pelanggan, jadi file tidak bisa dikirim.' });
  }

  // Link sementara (1 jam) agar server WhatsApp bisa mengambil filenya
  const { data: signed, error: signErr } = await db.storage.from('wa-media').createSignedUrl(path, 3600);
  if (signErr || !signed?.signedUrl) return res.status(500).json({ error: 'File tidak ditemukan di penyimpanan.' });

  const kind = mediaKindForMime(mime);
  const cap = String(caption || '').trim().slice(0, 1000);
  let waMessageId;
  try {
    waMessageId = await sendWhatsAppMedia(conv.wa_id, kind, signed.signedUrl, { caption: cap, filename: name });
  } catch (e) {
    return res.status(502).json({ error: 'WhatsApp menolak file: ' + e.message });
  }

  const at = new Date().toISOString();
  const preview = `${LABEL[kind]}${kind === 'document' && name ? ' ' + name : ''}${cap ? ' ' + cap : ''}`;
  const { data: msg, error: insErr } = await db
    .from('wa_messages')
    .insert({
      conversation_id: conv.id,
      wa_message_id: waMessageId,
      direction: 'out',
      msg_type: kind,
      body: preview,
      caption: cap || null,
      media_path: path,
      media_mime: mime || null,
      media_name: name || null,
      media_size: Number(size) || null,
      status: 'sent',
      sent_by: user.id,
      created_at: at,
    })
    .select('id, direction, body, msg_type, status, error, sent_by, created_at, media_path, media_mime, media_name, media_size, caption')
    .single();
  if (insErr) console.error('[wa-send-media] terkirim tapi gagal disimpan:', insErr.message);

  await db.rpc('wa_register_outbound', { p_conversation_id: conv.id, p_preview: preview.slice(0, 200), p_at: at });

  if (!conv.assigned_to) {
    await db.from('wa_conversations').update({ assigned_to: user.id }).eq('id', conv.id).is('assigned_to', null);
  }

  return res.status(200).json({ ok: true, message: msg || null });
}
