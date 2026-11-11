import { createClient } from '@supabase/supabase-js';

// Membaca nota / struk / invoice / bukti transfer dengan AI (Vercel AI Gateway)
// lalu mengembalikan data terstruktur untuk dicatat di menu Keuangan.
// Hanya Admin & staf Keuangan.

export const config = { maxDuration: 60, api: { bodyParser: { sizeLimit: '64kb' } } };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const MODEL = process.env.FINANCE_AI_MODEL || 'google/gemini-2.5-flash';
const MAX_BYTES = 10 * 1024 * 1024;
const METHODS = ['transfer', 'tunai', 'qris', 'kartu', 'lainnya'];

function gatewayToken(req) {
  return process.env.AI_GATEWAY_API_KEY || req.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN || null;
}

function buildPrompt(categories, hint) {
  const masuk = categories.filter((c) => c.kind === 'masuk').map((c) => c.name);
  const keluar = categories.filter((c) => c.kind === 'keluar').map((c) => c.name);
  return `Kamu adalah staf keuangan PT Satya Manggala Propertindo (SAM Property), agency & konsultan properti di Malang.
Baca dokumen terlampir (nota, struk, invoice, kuitansi, atau bukti transfer/pembayaran) dan kembalikan HANYA satu objek JSON:
{
  "is_financial_doc": boolean,            // false bila bukan dokumen transaksi
  "kind": "masuk" | "keluar" | null,      // dari sudut pandang SAM Property
  "date": "YYYY-MM-DD" | null,            // tanggal transaksi/pembayaran
  "amount": number | null,                // TOTAL yang dibayar/diterima dalam Rupiah, angka bulat tanpa titik
  "counterparty": string | null,          // nama toko/vendor/penerima (bila keluar) atau pengirim/pembayar (bila masuk)
  "description": string,                  // ringkas, Bahasa Indonesia, maks 80 karakter, mis. "Iklan Meta Ads 1–7 Nov" atau "Bensin mobil survei"
  "category": string | null,              // PERSIS salah satu nama kategori di bawah sesuai jenisnya
  "payment_method": "transfer" | "tunai" | "qris" | "kartu" | "lainnya" | null,
  "reference_no": string | null,          // no. nota / invoice / referensi transfer
  "doc_type": "nota" | "struk" | "invoice" | "kuitansi" | "bukti_transfer" | "lainnya",
  "items": [{"name": string, "qty": number | null, "price": number | null}],   // maks 10 baris utama, boleh kosong
  "confidence": number,                   // 0–1, seberapa yakin isian di atas benar
  "notes": string | null                  // masalah: buram, terpotong, ada beberapa nota, arah uang tidak jelas, dll.
}
Aturan:
- Format angka Indonesia: titik = ribuan, koma = desimal ("Rp 1.250.000,00" = 1250000). Ambil TOTAL akhir (setelah pajak/diskon), bukan subtotal.
- Nota/struk belanja, tagihan, invoice dari vendor → "keluar". Bukti transfer: bila pengirimnya SAM Property / PT Satya Manggala Propertindo / pegawainya → "keluar"; bila penerimanya SAM Property → "masuk". Kuitansi yang diterbitkan SAM untuk klien → "masuk".
- Komisi/fee dari developer atau klien (mis. Asvara Kozta, Metro Park) yang diterima SAM → "masuk".
- Tanggal ditulis dd/mm/yyyy di Indonesia. Bila tahun hanya 2 digit, anggap 20xx.
- Jangan mengarang. Bila tidak terbaca, isi null dan turunkan confidence.
${hint === 'masuk' || hint === 'keluar' ? `- Pengguna menandai dokumen ini sebagai "${hint}". Pakai itu kecuali dokumen jelas bertentangan (jelaskan di notes).\n` : ''}
Kategori pemasukan (masuk): ${masuk.join('; ')}
Kategori pengeluaran (keluar): ${keluar.join('; ')}`;
}

function parseJson(text) {
  if (!text) return null;
  const s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(s);
  } catch (e) {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch (e2) { return null; }
    }
    return null;
  }
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[^\d,.-]/g, '');
  // "1.250.000,50" → 1250000.50 ; "1250000" → 1250000
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/\.(?=\d{3}(\D|$))/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function clean(raw, categories, hint) {
  const r = raw || {};
  let kind = r.kind === 'masuk' || r.kind === 'keluar' ? r.kind : null;
  if (!kind && (hint === 'masuk' || hint === 'keluar')) kind = hint;
  const amount = toNumber(r.amount);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')) ? r.date : null;
  const cat = categories.find((c) => c.name === r.category && (!kind || c.kind === kind))
    || categories.find((c) => r.category && c.name.toLowerCase() === String(r.category).toLowerCase());
  let confidence = Number(r.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.max(0, Math.min(1, confidence));
  return {
    is_financial_doc: r.is_financial_doc !== false,
    kind,
    date,
    amount: amount && amount > 0 ? Math.round(amount * 100) / 100 : null,
    counterparty: r.counterparty ? String(r.counterparty).slice(0, 120) : null,
    description: r.description ? String(r.description).slice(0, 160) : null,
    category_id: cat ? cat.id : null,
    category_name: cat ? cat.name : r.category || null,
    payment_method: METHODS.includes(r.payment_method) ? r.payment_method : null,
    reference_no: r.reference_no ? String(r.reference_no).slice(0, 80) : null,
    doc_type: r.doc_type || null,
    items: Array.isArray(r.items) ? r.items.slice(0, 10) : [],
    confidence,
    notes: r.notes ? String(r.notes).slice(0, 300) : null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metode tidak diizinkan' });
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Server belum dikonfigurasi (SUPABASE_SERVICE_ROLE_KEY).' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sesi login tidak valid.' });

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: who, error: whoErr } = await db.auth.getUser(token);
  if (whoErr || !who?.user) return res.status(401).json({ error: 'Sesi tidak valid, silakan login ulang.' });
  const { data: prof } = await db.from('profiles').select('role').eq('id', who.user.id).single();
  if (!['admin', 'keuangan'].includes(String(prof?.role))) return res.status(403).json({ error: 'Menu Keuangan hanya untuk Admin dan staf Keuangan.' });

  const { path, hint } = req.body || {};
  if (!path || typeof path !== 'string' || path.includes('..')) return res.status(400).json({ error: 'File tidak valid.' });

  const aiToken = gatewayToken(req);
  if (!aiToken) {
    return res.status(503).json({ code: 'AI_TIDAK_AKTIF', error: 'Pembaca nota otomatis belum aktif di server. Nota tetap tersimpan, isi datanya manual.' });
  }

  const { data: file, error: dlErr } = await db.storage.from('finance').download(path);
  if (dlErr || !file) return res.status(404).json({ error: 'File nota tidak ditemukan.' });
  if (file.size > MAX_BYTES) return res.status(413).json({ error: 'File terlalu besar (maks 10 MB).' });
  const mime = file.type || (path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
  const b64 = Buffer.from(await file.arrayBuffer()).toString('base64');
  const dataUrl = `data:${mime};base64,${b64}`;

  const { data: categories } = await db.from('fin_categories').select('id, kind, name').eq('is_active', true).order('sort');
  const cats = categories || [];

  const docPart = mime === 'application/pdf'
    ? { type: 'file', file: { filename: path.split('/').pop(), file_data: dataUrl } }
    : { type: 'image_url', image_url: { url: dataUrl } };

  let aiRes;
  try {
    aiRes = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildPrompt(cats, hint) },
          { role: 'user', content: [{ type: 'text', text: 'Baca dokumen ini dan kembalikan JSON sesuai format.' }, docPart] },
        ],
      }),
    });
  } catch (e) {
    return res.status(502).json({ error: 'Gagal menghubungi layanan AI. Coba lagi sebentar.' });
  }

  if (!aiRes.ok) {
    const detail = await aiRes.text().catch(() => '');
    console.error('[finance-extract] AI gagal', aiRes.status, detail.slice(0, 500));
    if (aiRes.status === 401 || aiRes.status === 403) {
      return res.status(503).json({ code: 'AI_TIDAK_AKTIF', error: 'AI Gateway belum aktif untuk proyek Vercel ini. Nota tetap tersimpan, isi datanya manual.' });
    }
    if (aiRes.status === 402 || /credit|insufficient|quota/i.test(detail)) {
      return res.status(503).json({ code: 'AI_KREDIT_HABIS', error: 'Kredit AI Gateway habis. Nota tetap tersimpan, isi datanya manual.' });
    }
    return res.status(502).json({ error: `Layanan AI menolak permintaan (${aiRes.status}).` });
  }

  const body = await aiRes.json().catch(() => null);
  const raw = parseJson(body?.choices?.[0]?.message?.content);
  if (!raw) return res.status(422).json({ error: 'Isi nota tidak bisa dibaca AI. Silakan isi manual.' });

  return res.status(200).json({ ok: true, model: MODEL, data: clean(raw, cats, hint) });
}
