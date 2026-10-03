// Helper khusus server (API routes). JANGAN di-import dari komponen browser.
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

let _admin = null;

export function supabaseAdmin() {
  if (!_admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum di-set di Vercel.');
    }
    _admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _admin;
}

export function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Memastikan request webhook benar-benar dari Meta (header X-Hub-Signature-256)
export function verifySignature(rawBody, header) {
  const secret = process.env.WA_APP_SECRET;
  if (!secret) {
    // Di produksi wajib ada App Secret. Saat development lokal boleh dilewati.
    return process.env.NODE_ENV !== 'production';
  }
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(header.slice(7), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 6281234567890 -> 081234567890 (format yang dipakai di tabel leads)
export function toLocalPhone(waId) {
  const d = String(waId || '').replace(/\D/g, '');
  return d.startsWith('62') ? '0' + d.slice(2) : d;
}

export function phoneVariants(waId) {
  const d = String(waId || '').replace(/\D/g, '');
  return [d, '+' + d, toLocalPhone(d)];
}

// Ubah berbagai jenis pesan WhatsApp jadi teks yang bisa dibaca di inbox
export function extractText(m) {
  switch (m.type) {
    case 'text':
      return m.text?.body || '';
    case 'button':
      return m.button?.text || '[Tombol]';
    case 'interactive':
      return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '[Pilihan]';
    case 'image':
      return '[Gambar]' + (m.image?.caption ? ' ' + m.image.caption : '');
    case 'video':
      return '[Video]' + (m.video?.caption ? ' ' + m.video.caption : '');
    case 'document':
      return '[Dokumen] ' + (m.document?.filename || '') + (m.document?.caption ? ' ' + m.document.caption : '');
    case 'audio':
      return m.audio?.voice ? '[Pesan suara]' : '[Audio]';
    case 'sticker':
      return '[Stiker]';
    case 'location': {
      const l = m.location || {};
      const label = [l.name, l.address].filter(Boolean).join(', ');
      return '[Lokasi] ' + (label || `${l.latitude}, ${l.longitude}`);
    }
    case 'contacts':
      return '[Kontak] ' + (m.contacts?.[0]?.name?.formatted_name || '');
    case 'reaction':
      return '[Reaksi ' + (m.reaction?.emoji || '') + ']';
    default:
      return `[Pesan ${m.type || 'tidak dikenal'}]`;
  }
}

export async function sendWhatsAppText(to, body) {
  const version = process.env.WA_GRAPH_VERSION || 'v23.0';
  const phoneId = process.env.WA_PHONE_NUMBER_ID;
  const token = process.env.WA_ACCESS_TOKEN;
  if (!phoneId || !token) throw new Error('WA_PHONE_NUMBER_ID atau WA_ACCESS_TOKEN belum di-set di Vercel.');

  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error;
    throw new Error(e?.error_data?.details || e?.message || `HTTP ${res.status}`);
  }
  return json.messages?.[0]?.id || null;
}

// ---------------------------------------------------------------------
// MEDIA (gambar, video, audio, dokumen)
// ---------------------------------------------------------------------
export const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'];

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
};

export function extForMime(mime, fallbackName) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  if (EXT_BY_MIME[base]) return EXT_BY_MIME[base];
  const m = String(fallbackName || '').match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toLowerCase() : 'bin';
}

// Jenis pesan WhatsApp yang cocok untuk sebuah file
export function mediaKindForMime(mime) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  if (base === 'image/jpeg' || base === 'image/png') return 'image';
  if (base === 'video/mp4' || base === 'video/3gpp') return 'video';
  if (['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr'].includes(base)) return 'audio';
  return 'document';
}

// Unduh file kiriman pelanggan dari server Meta
export async function downloadWhatsAppMedia(mediaId) {
  const version = process.env.WA_GRAPH_VERSION || 'v23.0';
  const token = process.env.WA_ACCESS_TOKEN;
  const metaRes = await fetch(`https://graph.facebook.com/${version}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meta = await metaRes.json().catch(() => ({}));
  if (!metaRes.ok || !meta.url) throw new Error(meta?.error?.message || `Media ${mediaId} tidak ditemukan`);

  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!fileRes.ok) throw new Error(`Gagal mengunduh media (HTTP ${fileRes.status})`);
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { buffer, mime: meta.mime_type || fileRes.headers.get('content-type') || 'application/octet-stream', size: buffer.length };
}

// Kirim gambar / video / audio / dokumen lewat link (Meta mengambil filenya sendiri)
export async function sendWhatsAppMedia(to, kind, link, { caption, filename } = {}) {
  const version = process.env.WA_GRAPH_VERSION || 'v23.0';
  const phoneId = process.env.WA_PHONE_NUMBER_ID;
  const token = process.env.WA_ACCESS_TOKEN;
  if (!phoneId || !token) throw new Error('WA_PHONE_NUMBER_ID atau WA_ACCESS_TOKEN belum di-set di Vercel.');

  const media = { link };
  if (caption && kind !== 'audio') media.caption = caption;
  if (kind === 'document' && filename) media.filename = filename;

  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: kind, [kind]: media }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error;
    throw new Error(e?.error_data?.details || e?.message || `HTTP ${res.status}`);
  }
  return json.messages?.[0]?.id || null;
}
