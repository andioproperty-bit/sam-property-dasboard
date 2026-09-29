// Endpoint yang dipanggil Meta setiap ada pesan masuk / status pesan berubah.
// URL: https://sam-admin.asvarakozta.id/api/whatsapp/webhook
import {
  supabaseAdmin,
  readRawBody,
  verifySignature,
  extractText,
  phoneVariants,
  toLocalPhone,
} from '../../../lib/waServer';

// Body mentah dibutuhkan untuk verifikasi signature Meta
export const config = { api: { bodyParser: false } };

const STATUS_RANK = { received: 0, sent: 1, delivered: 2, read: 3 };

export default async function handler(req, res) {
  // 1) Verifikasi saat pertama kali webhook didaftarkan di Meta
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Verify token tidak cocok');
  }

  if (req.method !== 'POST') return res.status(405).end();

  // 2) Pesan / status dari Meta
  const raw = await readRawBody(req);
  if (!verifySignature(raw, req.headers['x-hub-signature-256'])) {
    return res.status(401).send('Signature tidak valid');
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).send('Body bukan JSON');
  }

  try {
    await processPayload(payload);
    return res.status(200).json({ ok: true });
  } catch (err) {
    // 500 = Meta akan mengirim ulang. Aman karena pesan dobel otomatis diabaikan.
    console.error('[wa-webhook]', err);
    return res.status(500).json({ ok: false });
  }
}

async function processPayload(payload) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      if (change.field === 'messages') {
        const contacts = v.contacts || [];
        for (const m of v.messages || []) await handleInbound(m, contacts);
        for (const s of v.statuses || []) await handleStatus(s);
      } else if (change.field === 'smb_message_echoes') {
        // Hanya muncul jika nomor memakai mode coexistence (dibalas dari HP juga)
        for (const m of v.message_echoes || []) await handleEcho(m);
      }
    }
  }
}

function toIso(ts) {
  return ts ? new Date(Number(ts) * 1000).toISOString() : new Date().toISOString();
}

async function getOrCreateConversation(waId, name) {
  const db = supabaseAdmin();

  const { data: existing, error } = await db
    .from('wa_conversations')
    .select('*')
    .eq('wa_id', waId)
    .maybeSingle();
  if (error) throw error;

  if (existing) {
    if (!existing.contact_name && name) {
      await db.from('wa_conversations').update({ contact_name: name }).eq('id', existing.id);
    }
    return existing;
  }

  // Cari lead lama dengan nomor yang sama, kalau tidak ada buat lead baru
  let leadId = null;
  const { data: match } = await db
    .from('leads')
    .select('id')
    .in('phone', phoneVariants(waId))
    .order('created_at', { ascending: false })
    .limit(1);

  if (match && match.length) {
    leadId = match[0].id;
  } else {
    const { data: newLead, error: leadErr } = await db
      .from('leads')
      .insert({
        name: name || toLocalPhone(waId),
        phone: toLocalPhone(waId),
        source: 'WhatsApp',
        status: 'Baru',
        notes: 'Dibuat otomatis dari WhatsApp Inbox',
      })
      .select('id')
      .single();
    if (leadErr) console.error('[wa-webhook] gagal membuat lead:', leadErr.message);
    else leadId = newLead.id;
  }

  const { data: created, error: convErr } = await db
    .from('wa_conversations')
    .upsert({ wa_id: waId, contact_name: name || null, lead_id: leadId }, { onConflict: 'wa_id', ignoreDuplicates: true })
    .select('*');
  if (convErr) throw convErr;
  if (created && created.length) return created[0];

  // Sudah dibuat oleh request lain di saat bersamaan
  const { data: again, error: againErr } = await db.from('wa_conversations').select('*').eq('wa_id', waId).single();
  if (againErr) throw againErr;
  return again;
}

async function handleInbound(m, contacts) {
  const db = supabaseAdmin();
  const waId = m.from;
  const name = contacts.find((c) => c.wa_id === waId)?.profile?.name || null;
  const conv = await getOrCreateConversation(waId, name);
  const body = extractText(m);
  const at = toIso(m.timestamp);

  const { data: inserted, error } = await db
    .from('wa_messages')
    .upsert(
      {
        conversation_id: conv.id,
        wa_message_id: m.id,
        direction: 'in',
        msg_type: m.type || 'text',
        body,
        status: 'received',
        created_at: at,
        raw: m,
      },
      { onConflict: 'wa_message_id', ignoreDuplicates: true }
    )
    .select('id');
  if (error) throw error;
  if (!inserted || !inserted.length) return; // pesan dobel dari Meta, abaikan

  const { error: rpcErr } = await db.rpc('wa_register_inbound', {
    p_conversation_id: conv.id,
    p_preview: body.slice(0, 200),
    p_at: at,
  });
  if (rpcErr) throw rpcErr;
}

async function handleEcho(m) {
  const db = supabaseAdmin();
  const conv = await getOrCreateConversation(m.to, null);
  const body = extractText(m);
  const at = toIso(m.timestamp);

  const { data: inserted, error } = await db
    .from('wa_messages')
    .upsert(
      {
        conversation_id: conv.id,
        wa_message_id: m.id,
        direction: 'out',
        msg_type: m.type || 'text',
        body,
        status: 'sent',
        created_at: at,
        raw: m,
      },
      { onConflict: 'wa_message_id', ignoreDuplicates: true }
    )
    .select('id');
  if (error) throw error;
  if (!inserted || !inserted.length) return;

  const { error: rpcErr } = await db.rpc('wa_register_outbound', {
    p_conversation_id: conv.id,
    p_preview: body.slice(0, 200),
    p_at: at,
  });
  if (rpcErr) throw rpcErr;
}

async function handleStatus(s) {
  const db = supabaseAdmin();
  const { data: row, error } = await db
    .from('wa_messages')
    .select('id, status')
    .eq('wa_message_id', s.id)
    .maybeSingle();
  if (error) throw error;
  if (!row) return;

  if (s.status === 'failed') {
    const e = s.errors?.[0];
    await db
      .from('wa_messages')
      .update({ status: 'failed', error: e?.error_data?.details || e?.title || 'Gagal terkirim' })
      .eq('id', row.id);
    return;
  }

  // Jangan turunkan status (misal "read" tertimpa "delivered" yang datang terlambat)
  if ((STATUS_RANK[s.status] ?? -1) > (STATUS_RANK[row.status] ?? -1)) {
    await db.from('wa_messages').update({ status: s.status }).eq('id', row.id);
  }
}
