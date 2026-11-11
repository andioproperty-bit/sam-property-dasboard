import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatRupiah } from '../lib/format';
import { buildXlsx, saveFile } from '../lib/xlsxLite';
import Modal from './Modal';
import s from './FinanceTab.module.css';

// =====================================================================
// Menu KEUANGAN — upload nota/bukti bayar → dibaca AI → tercatat otomatis.
// Hanya Admin & staf Keuangan (dijaga juga oleh RLS di database).
// =====================================================================

const TZ = 'Asia/Jakarta';
const METHODS = [
  { value: 'transfer', label: 'Transfer' },
  { value: 'tunai', label: 'Tunai' },
  { value: 'qris', label: 'QRIS' },
  { value: 'kartu', label: 'Kartu debit/kredit' },
  { value: 'lainnya', label: 'Lainnya' },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label]));
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const AUTO_OK = 0.75; // keyakinan AI minimal agar langsung "tercatat" (tanpa cek)

const todayYmd = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const monthOf = (ymd) => ymd.slice(0, 7);
function monthRange(m) {
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return [`${m}-01`, `${m}-${String(last).padStart(2, '0')}`];
}
function shiftMonth(m, n) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const monthName = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const fmtDate = (ymd) =>
  ymd ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T00:00:00Z')) : '-';
const rp = (n) => formatRupiah(Math.round(Number(n) || 0));
const parseAmount = (v) => {
  const d = String(v || '').replace(/[^\d]/g, '');
  return d ? Number(d) : null;
};
const fmtAmountInput = (n) => (n ? Number(n).toLocaleString('id-ID') : '');
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

async function sha256(file) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Kecilkan foto supaya cepat diunggah & dibaca (maks 1800 px, JPEG)
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch (e) {
    return file;
  }
}

function extOf(file) {
  if (file.type === 'application/pdf') return 'pdf';
  const m = (file.name || '').match(/\.(\w+)$/);
  return (m ? m[1] : file.type.split('/')[1] || 'jpg').toLowerCase();
}

export default function FinanceTab({ user, profiles, showToast }) {
  const [month, setMonth] = useState(monthOf(todayYmd()));
  const [entries, setEntries] = useState(null);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [pendingAll, setPendingAll] = useState(0);
  const [kindFilter, setKindFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [search, setSearch] = useState('');
  const [hint, setHint] = useState('auto');
  const [queue, setQueue] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const notify = useCallback((m) => (showToast ? showToast(m) : window.alert(m)), [showToast]);

  const load = useCallback(async () => {
    const [from, to] = monthRange(month);
    const [c, a, e, p] = await Promise.all([
      supabase.from('fin_categories').select('*').order('kind').order('sort'),
      supabase.from('fin_accounts').select('*').order('sort'),
      supabase.from('fin_entries').select('*').gte('entry_date', from).lte('entry_date', to).order('entry_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('fin_entries').select('id', { count: 'exact', head: true }).eq('status', 'perlu_cek'),
    ]);
    if (e.error) {
      notify('Data keuangan gagal dimuat: ' + e.error.message);
      setEntries([]);
      return;
    }
    setCategories(c.data || []);
    setAccounts(a.data || []);
    setEntries(e.data || []);
    setPendingAll(p.count || 0);
  }, [month, notify]);

  useEffect(() => {
    setEntries(null);
    load();
  }, [load]);

  const catName = (id) => categories.find((c) => c.id === id)?.name || 'Tanpa kategori';
  const accName = (id) => accounts.find((a) => a.id === id)?.name || '';
  const nameOf = (id) => profiles.find((p) => p.id === id)?.name || '';

  const totals = useMemo(() => {
    const t = { masuk: 0, keluar: 0, pending: 0, byCat: { masuk: {}, keluar: {} } };
    (entries || []).forEach((x) => {
      if (x.status === 'perlu_cek') t.pending += 1;
      if (!x.amount) return;
      t[x.kind] += Number(x.amount);
      const key = x.category_id || 'none';
      t.byCat[x.kind][key] = (t.byCat[x.kind][key] || 0) + Number(x.amount);
    });
    return t;
  }, [entries]);

  const rows = (entries || []).filter((x) => {
    if (kindFilter && x.kind !== kindFilter) return false;
    if (statusFilter && x.status !== statusFilter) return false;
    if (catFilter && x.category_id !== catFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = [x.counterparty, x.description, x.reference_no, x.project, catName(x.category_id)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // ---------------- upload otomatis ----------------
  const setItem = (id, patch) => setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  function defaultAccount(method) {
    const want = method === 'tunai' ? 'kas' : method === 'qris' ? 'ewallet' : 'bank';
    return (accounts.find((a) => a.is_active && a.kind === want) || accounts.find((a) => a.is_active && a.kind === 'bank') || accounts[0] || {}).id || null;
  }

  async function processFile(item) {
    const { file } = item;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('File lebih dari 10 MB.');
      setItem(item.id, { stage: 'Memeriksa…' });
      const hash = await sha256(file);
      const { data: dup } = await supabase.from('fin_entries').select('id, entry_date, amount').eq('file_hash', hash).limit(1);
      if (dup && dup.length) {
        setItem(item.id, { stage: 'Dilewati', done: true, warn: `File yang sama sudah pernah diupload (${fmtDate(dup[0].entry_date)}).` });
        return;
      }

      setItem(item.id, { stage: 'Mengunggah…' });
      const small = await shrinkImage(file);
      const today = todayYmd();
      const path = `${today.slice(0, 4)}/${today.slice(5, 7)}/${uuid()}.${extOf(small)}`;
      const up = await supabase.storage.from('finance').upload(path, small, { contentType: small.type || 'application/octet-stream', upsert: false });
      if (up.error) throw new Error('Upload gagal: ' + up.error.message);

      setItem(item.id, { stage: 'AI membaca nota…' });
      const { data: sess } = await supabase.auth.getSession();
      let ai = null;
      let aiError = null;
      try {
        const res = await fetch('/api/finance/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess?.session?.access_token || ''}` },
          body: JSON.stringify({ path, hint }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.ok) ai = json.data;
        else aiError = json.error || `AI gagal (${res.status})`;
      } catch (e) {
        aiError = 'Tidak bisa menghubungi pembaca nota.';
      }

      const kind = ai?.kind || (hint !== 'auto' ? hint : 'keluar');
      const entry = {
        kind,
        entry_date: ai?.date || today,
        amount: ai?.amount || null,
        category_id: ai?.category_id && categories.find((c) => c.id === ai.category_id && c.kind === kind) ? ai.category_id : null,
        account_id: defaultAccount(ai?.payment_method),
        counterparty: ai?.counterparty || null,
        description: ai?.description || file.name.replace(/\.\w+$/, ''),
        payment_method: ai?.payment_method || null,
        reference_no: ai?.reference_no || null,
        source: 'upload',
        attachment_path: path,
        attachment_name: file.name,
        attachment_mime: small.type || null,
        file_hash: hash,
        ai_data: ai ? { ...ai, error: undefined } : { error: aiError },
        ai_confidence: ai ? ai.confidence : null,
      };

      // kemungkinan transaksi kembar (nominal + tanggal + pihak sama)
      let twin = null;
      if (entry.amount) {
        const { data: same } = await supabase
          .from('fin_entries')
          .select('id, counterparty')
          .eq('amount', entry.amount)
          .eq('entry_date', entry.entry_date)
          .eq('kind', entry.kind)
          .limit(5);
        twin = (same || []).find((x) => !entry.counterparty || !x.counterparty || x.counterparty.toLowerCase() === entry.counterparty.toLowerCase());
      }

      const good = ai && ai.is_financial_doc && entry.amount && ai.date && ai.kind && entry.category_id && ai.confidence >= AUTO_OK && !twin;
      entry.status = good ? 'final' : 'perlu_cek';
      const reasons = [];
      if (!ai) reasons.push(aiError || 'AI tidak bisa membaca');
      else {
        if (!ai.is_financial_doc) reasons.push('sepertinya bukan nota/bukti bayar');
        if (!entry.amount) reasons.push('nominal tidak terbaca');
        if (!ai.date) reasons.push('tanggal tidak terbaca');
        if (!entry.category_id) reasons.push('kategori belum pasti');
        if (ai.confidence < AUTO_OK) reasons.push('AI kurang yakin');
        if (ai.notes) reasons.push(ai.notes);
      }
      if (twin) reasons.push('mirip transaksi lain di tanggal & nominal yang sama');

      const ins = await supabase.from('fin_entries').insert(entry).select().single();
      if (ins.error) throw new Error('Gagal mencatat: ' + ins.error.message);
      setItem(item.id, {
        stage: good ? 'Tercatat' : 'Perlu dicek',
        done: true,
        ok: good,
        entry: ins.data,
        warn: good ? null : reasons.join(' · '),
      });
      if (monthOf(ins.data.entry_date) === month) setEntries((list) => [ins.data, ...(list || [])]);
    } catch (e) {
      setItem(item.id, { stage: 'Gagal', done: true, error: e.message || String(e) });
    }
  }

  async function onFiles(list) {
    const files = Array.from(list || []).filter(Boolean);
    if (!files.length) return;
    const items = files.map((f) => ({ id: uuid(), file: f, name: f.name, stage: 'Menunggu…' }));
    setQueue((q) => [...items, ...q].slice(0, 30));
    for (const it of items) {
      // berurutan supaya tidak membebani HP & server
      // eslint-disable-next-line no-await-in-loop
      await processFile(it);
    }
    load();
  }

  // ---------------- simpan / hapus ----------------
  async function saveEntry(form, markFinal) {
    const payload = {
      kind: form.kind,
      entry_date: form.entry_date,
      amount: form.amount || null,
      category_id: form.category_id || null,
      account_id: form.account_id || null,
      counterparty: form.counterparty?.trim() || null,
      description: form.description?.trim() || null,
      payment_method: form.payment_method || null,
      reference_no: form.reference_no?.trim() || null,
      project: form.project?.trim() || null,
      status: markFinal ? 'final' : 'perlu_cek',
    };
    if (markFinal && !payload.amount) {
      notify('Isi nominal dulu sebelum menandai beres.');
      return false;
    }
    if (form.newFile) {
      const f = await shrinkImage(form.newFile);
      const path = `${form.entry_date.slice(0, 4)}/${form.entry_date.slice(5, 7)}/${uuid()}.${extOf(f)}`;
      const up = await supabase.storage.from('finance').upload(path, f, { contentType: f.type || 'application/octet-stream' });
      if (up.error) {
        notify('Upload lampiran gagal: ' + up.error.message);
        return false;
      }
      Object.assign(payload, { attachment_path: path, attachment_name: form.newFile.name, attachment_mime: f.type || null, file_hash: await sha256(form.newFile) });
    }
    const q = form.id ? supabase.from('fin_entries').update(payload).eq('id', form.id) : supabase.from('fin_entries').insert({ ...payload, source: 'manual' });
    const { error } = await q;
    if (error) {
      notify('Gagal menyimpan: ' + error.message);
      return false;
    }
    notify(markFinal ? 'Transaksi tersimpan' : 'Disimpan sebagai perlu dicek');
    setEditing(null);
    if (form.entry_date && monthOf(form.entry_date) !== month) setMonth(monthOf(form.entry_date));
    else load();
    return true;
  }

  async function deleteEntry(entry) {
    if (!window.confirm('Hapus transaksi ini beserta file notanya?')) return;
    const { error } = await supabase.from('fin_entries').delete().eq('id', entry.id);
    if (error) return notify('Gagal menghapus: ' + error.message);
    if (entry.attachment_path) await supabase.storage.from('finance').remove([entry.attachment_path]);
    notify('Transaksi dihapus');
    setEditing(null);
    load();
  }

  async function openAttachment(entry) {
    const { data, error } = await supabase.storage.from('finance').createSignedUrl(entry.attachment_path, 600);
    if (error) return notify('Lampiran tidak bisa dibuka: ' + error.message);
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  // ---------------- Excel ----------------
  async function exportExcel() {
    setExporting(true);
    try {
      const list = [...(entries || [])].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
      const head = ['Tanggal', 'Jenis', 'Kategori', 'Pihak', 'Keterangan', 'Proyek', 'Akun', 'Metode', 'No. Referensi', 'Pemasukan', 'Pengeluaran', 'Status', 'Lampiran', 'Dicatat oleh'];
      const body = list.map((x) => [
        x.entry_date,
        x.kind === 'masuk' ? 'Pemasukan' : 'Pengeluaran',
        catName(x.category_id),
        x.counterparty || '',
        x.description || '',
        x.project || '',
        accName(x.account_id),
        METHOD_LABEL[x.payment_method] || '',
        x.reference_no || '',
        x.kind === 'masuk' ? Number(x.amount) || 0 : '',
        x.kind === 'keluar' ? Number(x.amount) || 0 : '',
        x.status === 'final' ? 'Beres' : 'Perlu dicek',
        x.attachment_name || '',
        nameOf(x.created_by),
      ]);
      const sum = [
        ['Laporan Keuangan', monthName(month)],
        ['PT Satya Manggala Propertindo (SAM Property)', ''],
        [],
        ['Total pemasukan', totals.masuk],
        ['Total pengeluaran', totals.keluar],
        ['Selisih (pemasukan − pengeluaran)', totals.masuk - totals.keluar],
        ['Transaksi perlu dicek', totals.pending],
        [],
        ['Pengeluaran per kategori', 'Jumlah'],
        ...Object.entries(totals.byCat.keluar).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k === 'none' ? 'Tanpa kategori' : catName(k), v]),
        [],
        ['Pemasukan per kategori', 'Jumlah'],
        ...Object.entries(totals.byCat.masuk).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k === 'none' ? 'Tanpa kategori' : catName(k), v]),
      ];
      const blob = buildXlsx([
        { name: 'Ringkasan', rows: sum },
        { name: 'Transaksi', rows: list.length ? [head, ...body] : [['(tidak ada transaksi)']] },
      ]);
      await saveFile(blob, `keuangan-sam-${month}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  const net = totals.masuk - totals.keluar;
  const expCats = Object.entries(totals.byCat.keluar).sort((a, b) => b[1] - a[1]);
  const incCats = Object.entries(totals.byCat.masuk).sort((a, b) => b[1] - a[1]);
  const maxExp = expCats[0]?.[1] || 1;
  const maxInc = incCats[0]?.[1] || 1;
  const busy = queue.some((q) => !q.done);

  return (
    <section>
      <div className="topbar">
        <div>
          <h1>Keuangan</h1>
          <p>Upload nota atau bukti bayar, AI mencatatnya otomatis</p>
        </div>
        <div className={s.topActions}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)}>Kategori & Akun</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing({})}>+ Catat Manual</button>
        </div>
      </div>

      {/* ---------- area upload ---------- */}
      <div
        className={s.drop}
        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add(s.dropOn); }}
        onDragLeave={(e) => e.currentTarget.classList.remove(s.dropOn)}
        onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove(s.dropOn); onFiles(e.dataTransfer.files); }}
      >
        <div className={s.dropMain}>
          <div className={s.dropTitle}>Upload nota, struk, invoice, atau bukti transfer</div>
          <div className={s.dropSub}>Foto atau PDF, bisa beberapa sekaligus. Tanggal, nominal, pihak, dan kategori diisi otomatis.</div>
          <div className={s.hintRow}>
            <span>Jenis:</span>
            {[
              ['auto', 'Deteksi otomatis'],
              ['keluar', 'Pengeluaran'],
              ['masuk', 'Pemasukan'],
            ].map(([v, l]) => (
              <button key={v} type="button" className={`${s.chip} ${hint === v ? s.chipOn : ''}`} onClick={() => setHint(v)}>{l}</button>
            ))}
          </div>
        </div>
        <div className={s.dropBtns}>
          <button className="btn btn-primary" disabled={busy} onClick={() => camRef.current?.click()}>Foto Nota</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>Pilih File</button>
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
        </div>
      </div>

      {queue.length > 0 && (
        <div className={s.queue}>
          <div className={s.queueHead}>
            <b>Hasil upload</b>
            {!busy && <button className={s.linkBtn} onClick={() => setQueue([])}>Bersihkan</button>}
          </div>
          {queue.map((it) => (
            <div key={it.id} className={s.qRow}>
              <span className={`${s.dot} ${it.error ? s.dotBad : it.done ? (it.ok ? s.dotOk : s.dotWarn) : s.dotRun}`} />
              <div className={s.qMain}>
                <div className={s.qName}>{it.name}</div>
                {it.entry && (
                  <div className={s.qInfo}>
                    {it.entry.kind === 'masuk' ? 'Pemasukan' : 'Pengeluaran'} · {it.entry.amount ? rp(it.entry.amount) : 'nominal kosong'} · {fmtDate(it.entry.entry_date)} · {catName(it.entry.category_id)}
                    {it.entry.counterparty ? ` · ${it.entry.counterparty}` : ''}
                  </div>
                )}
                {(it.warn || it.error) && <div className={it.error ? s.qErr : s.qWarn}>{it.error || it.warn}</div>}
              </div>
              <span className={s.qStage}>{it.stage}</span>
              {it.entry && (
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(it.entry)}>{it.ok ? 'Lihat' : 'Cek'}</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ---------- periode & ringkasan ---------- */}
      <div className={s.monthBar}>
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <b>{monthName(month)}</b>
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= monthOf(todayYmd())}>›</button>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={exporting || !entries?.length} onClick={exportExcel}>
          {exporting ? 'Menyiapkan…' : 'Unduh Excel'}
        </button>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Pemasukan</div>
          <div className={`kpi-value ${s.in}`}>{rp(totals.masuk)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Pengeluaran</div>
          <div className={`kpi-value ${s.out}`}>{rp(totals.keluar)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Selisih</div>
          <div className={`kpi-value ${net >= 0 ? s.in : s.out}`}>{net < 0 ? '−' : ''}{rp(Math.abs(net))}</div>
        </div>
        <button className={`kpi-card ${s.kpiBtn}`} onClick={() => setStatusFilter(statusFilter === 'perlu_cek' ? '' : 'perlu_cek')}>
          <div className="kpi-label">Perlu dicek</div>
          <div className={`kpi-value ${pendingAll ? s.warnText : ''}`}>{pendingAll}</div>
          <div className={s.kpiNote}>{pendingAll ? 'Klik untuk menampilkan' : 'Semua beres'}</div>
        </button>
      </div>

      {(expCats.length > 0 || incCats.length > 0) && (
        <div className={s.breakdown}>
          <div className="panel">
            <h3>Pengeluaran per kategori</h3>
            {expCats.length === 0 ? <div className="panel-empty">Belum ada pengeluaran</div> : expCats.map(([k, v]) => (
              <button key={k} className={s.barRow} onClick={() => setCatFilter(catFilter === k ? '' : k)}>
                <span className={s.barLabel}>{k === 'none' ? 'Tanpa kategori' : catName(k)}</span>
                <span className={s.barTrack}><span className={`${s.barFill} ${s.barOut}`} style={{ width: `${(v / maxExp) * 100}%` }} /></span>
                <span className={s.barVal}>{rp(v)}</span>
              </button>
            ))}
          </div>
          <div className="panel">
            <h3>Pemasukan per kategori</h3>
            {incCats.length === 0 ? <div className="panel-empty">Belum ada pemasukan</div> : incCats.map(([k, v]) => (
              <button key={k} className={s.barRow} onClick={() => setCatFilter(catFilter === k ? '' : k)}>
                <span className={s.barLabel}>{k === 'none' ? 'Tanpa kategori' : catName(k)}</span>
                <span className={s.barTrack}><span className={`${s.barFill} ${s.barIn}`} style={{ width: `${(v / maxInc) * 100}%` }} /></span>
                <span className={s.barVal}>{rp(v)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---------- daftar transaksi ---------- */}
      <div className="filter-row">
        <input type="text" placeholder="Cari pihak / keterangan / no. ref…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
          <option value="">Semua jenis</option>
          <option value="masuk">Pemasukan</option>
          <option value="keluar">Pengeluaran</option>
        </select>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">Semua kategori</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.kind === 'masuk' ? '↑ ' : '↓ '}{c.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Semua status</option>
          <option value="perlu_cek">Perlu dicek</option>
          <option value="final">Beres</option>
        </select>
      </div>

      <div className="table-wrap">
        {entries === null ? (
          <div className="panel-empty">Memuat…</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <div className="big">{entries.length ? 'Tidak ada yang cocok' : `Belum ada transaksi di ${monthName(month)}`}</div>
            <div>{entries.length ? 'Ubah filter atau kata kunci.' : 'Upload nota pertama di atas, atau catat manual.'}</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tanggal</th><th>Keterangan</th><th>Kategori</th><th>Akun / Metode</th><th style={{ textAlign: 'right' }}>Jumlah</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td className="cell-soft" style={{ whiteSpace: 'nowrap' }}>{fmtDate(x.entry_date)}</td>
                  <td>
                    <div className="cell-strong">{x.counterparty || x.description || '-'}</div>
                    <div className="cell-soft">
                      {x.counterparty && x.description ? x.description : ''}
                      {x.project ? ` · ${x.project}` : ''}
                      {x.reference_no ? ` · Ref ${x.reference_no}` : ''}
                    </div>
                  </td>
                  <td>{x.category_id ? catName(x.category_id) : <span className="cell-soft">-</span>}</td>
                  <td>
                    <div>{accName(x.account_id) || <span className="cell-soft">-</span>}</div>
                    <div className="cell-soft">{METHOD_LABEL[x.payment_method] || ''}</div>
                  </td>
                  <td className={`${s.amount} ${x.kind === 'masuk' ? s.in : s.out}`}>
                    {x.amount ? `${x.kind === 'masuk' ? '+' : '−'} ${rp(x.amount)}` : <span className="cell-soft">belum diisi</span>}
                  </td>
                  <td>
                    {x.status === 'perlu_cek' ? <span className="badge badge-gold">Perlu dicek</span> : <span className="badge badge-green">Beres</span>}
                  </td>
                  <td>
                    <div className="row-actions">
                      {x.attachment_path && <button className="icon-btn" title="Lihat nota" onClick={() => openAttachment(x)}>📎</button>}
                      <button className="icon-btn" title="Ubah" onClick={() => setEditing(x)}>✎</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className={s.foot}>
        Nota diupload ke penyimpanan privat dan hanya bisa dibuka Admin & staf Keuangan. Hasil bacaan AI yang kurang yakin ditandai <b>Perlu dicek</b>.
        Cocokkan dengan nota aslinya sebelum laporan dikirim.
      </p>

      {editing && (
        <EntryModal
          data={editing}
          categories={categories}
          accounts={accounts}
          nameOf={nameOf}
          onClose={() => setEditing(null)}
          onSave={saveEntry}
          onDelete={deleteEntry}
        />
      )}
      {showSettings && <SettingsModal categories={categories} accounts={accounts} onClose={() => setShowSettings(false)} onChanged={load} notify={notify} />}
    </section>
  );
}

// =====================================================================
function EntryModal({ data, categories, accounts, nameOf, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({
    id: data.id || null,
    kind: data.kind || 'keluar',
    entry_date: data.entry_date || todayYmd(),
    amount: data.amount ? Number(data.amount) : null,
    category_id: data.category_id || '',
    account_id: data.account_id || (accounts.find((a) => a.is_active)?.id || ''),
    counterparty: data.counterparty || '',
    description: data.description || '',
    payment_method: data.payment_method || '',
    reference_no: data.reference_no || '',
    project: data.project || '',
    newFile: null,
  });
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const cats = categories.filter((c) => c.kind === form.kind && (c.is_active || c.id === form.category_id));
  const ai = data.ai_data || null;

  useEffect(() => {
    let alive = true;
    if (data.attachment_path) {
      supabase.storage.from('finance').createSignedUrl(data.attachment_path, 600).then(({ data: d }) => {
        if (alive && d) setPreview({ url: d.signedUrl, pdf: (data.attachment_mime || '').includes('pdf') || /\.pdf$/i.test(data.attachment_path) });
      });
    }
    return () => { alive = false; };
  }, [data.attachment_path, data.attachment_mime]);

  useEffect(() => {
    if (form.category_id && !cats.some((c) => c.id === form.category_id)) set('category_id', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.kind]);

  async function submit(final) {
    setSaving(true);
    const ok = await onSave(form, final);
    if (!ok) setSaving(false);
  }

  return (
    <Modal onClose={saving ? () => {} : onClose}>
      <h3>{data.id ? 'Ubah Transaksi' : 'Catat Transaksi'}</h3>
      {preview && (
        <div className={s.preview}>
          {preview.pdf ? (
            <a className="btn btn-ghost btn-sm" href={preview.url} target="_blank" rel="noreferrer">Buka nota (PDF)</a>
          ) : (
            <a href={preview.url} target="_blank" rel="noreferrer"><img src={preview.url} alt="Nota" /></a>
          )}
        </div>
      )}
      {data.status === 'perlu_cek' && (
        <div className={s.checkNote}>
          {ai?.error ? `Pembaca otomatis: ${ai.error}` : 'Hasil bacaan AI perlu dicocokkan dengan nota.'}
          {ai?.notes ? ` Catatan AI: ${ai.notes}` : ''}
        </div>
      )}

      <div className={s.kindToggle}>
        <button type="button" className={`${s.kindBtn} ${form.kind === 'keluar' ? s.kindOut : ''}`} onClick={() => set('kind', 'keluar')}>Pengeluaran</button>
        <button type="button" className={`${s.kindBtn} ${form.kind === 'masuk' ? s.kindIn : ''}`} onClick={() => set('kind', 'masuk')}>Pemasukan</button>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Tanggal</label>
          <input type="date" value={form.entry_date} max={todayYmd()} onChange={(e) => set('entry_date', e.target.value)} />
        </div>
        <div className="field">
          <label>Jumlah (Rp)</label>
          <input inputMode="numeric" value={fmtAmountInput(form.amount)} onChange={(e) => set('amount', parseAmount(e.target.value))} placeholder="0" />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Kategori</label>
          <select value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
            <option value="">- Pilih kategori -</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{form.kind === 'masuk' ? 'Dari (pembayar)' : 'Kepada (toko/vendor)'}</label>
          <input value={form.counterparty} onChange={(e) => set('counterparty', e.target.value)} placeholder={form.kind === 'masuk' ? 'mis. PT Patraland' : 'mis. Meta Platforms'} />
        </div>
      </div>
      <div className="field">
        <label>Keterangan</label>
        <input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="mis. Iklan Meta Ads Asvara Kozta 1–7 Nov" />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Akun</label>
          <select value={form.account_id} onChange={(e) => set('account_id', e.target.value)}>
            <option value="">- Pilih akun -</option>
            {accounts.filter((a) => a.is_active || a.id === form.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Metode</label>
          <select value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
            <option value="">-</option>
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Proyek (opsional)</label>
          <input value={form.project} onChange={(e) => set('project', e.target.value)} list="fin-projects" placeholder="Umum / nama proyek" />
          <datalist id="fin-projects">
            {['Umum / Kantor', 'Asvara Kozta', 'Metro Park', 'Adara Residence'].map((p) => <option key={p} value={p} />)}
          </datalist>
        </div>
        <div className="field">
          <label>No. nota / referensi</label>
          <input value={form.reference_no} onChange={(e) => set('reference_no', e.target.value)} />
        </div>
      </div>
      {!data.attachment_path && (
        <div className="field">
          <label>Lampiran nota (opsional)</label>
          <input type="file" accept="image/*,application/pdf" onChange={(e) => set('newFile', e.target.files?.[0] || null)} />
        </div>
      )}
      {data.id && (
        <div className={s.meta}>
          Dicatat {data.source === 'upload' ? 'dari upload' : 'manual'}{nameOf(data.created_by) ? ` oleh ${nameOf(data.created_by)}` : ''}
          {data.ai_confidence != null ? ` · keyakinan AI ${Math.round(Number(data.ai_confidence) * 100)}%` : ''}
        </div>
      )}
      <div className="modal-actions">
        {data.id && <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} disabled={saving} onClick={() => onDelete(data)}>Hapus</button>}
        <button className="btn btn-ghost" disabled={saving} onClick={() => submit(false)}>Simpan, cek nanti</button>
        <button className="btn btn-primary" disabled={saving || !form.amount} onClick={() => submit(true)}>{saving ? 'Menyimpan…' : 'Simpan & Beres'}</button>
      </div>
    </Modal>
  );
}

// =====================================================================
function SettingsModal({ categories, accounts, onClose, onChanged, notify }) {
  const [newCat, setNewCat] = useState({ kind: 'keluar', name: '' });
  const [newAcc, setNewAcc] = useState({ kind: 'bank', name: '' });

  async function addCat() {
    if (newCat.name.trim().length < 3) return;
    const { error } = await supabase.from('fin_categories').insert({ kind: newCat.kind, name: newCat.name.trim() });
    if (error) return notify(/duplicate/i.test(error.message) ? 'Kategori itu sudah ada.' : 'Gagal: ' + error.message);
    setNewCat({ ...newCat, name: '' });
    onChanged();
  }
  async function toggleCat(c) {
    const { error } = await supabase.from('fin_categories').update({ is_active: !c.is_active }).eq('id', c.id);
    if (error) return notify('Gagal: ' + error.message);
    onChanged();
  }
  async function addAcc() {
    if (newAcc.name.trim().length < 3) return;
    const { error } = await supabase.from('fin_accounts').insert({ kind: newAcc.kind, name: newAcc.name.trim() });
    if (error) return notify(/duplicate/i.test(error.message) ? 'Akun itu sudah ada.' : 'Gagal: ' + error.message);
    setNewAcc({ ...newAcc, name: '' });
    onChanged();
  }
  async function toggleAcc(a) {
    const { error } = await supabase.from('fin_accounts').update({ is_active: !a.is_active }).eq('id', a.id);
    if (error) return notify('Gagal: ' + error.message);
    onChanged();
  }

  return (
    <Modal onClose={onClose}>
      <h3>Kategori & Akun</h3>
      <div className={s.setTitle}>Akun kas / bank</div>
      <p className={s.setHint}>Tulis nama akunnya saja (mis. "BCA Operasional"), jangan nomor rekening.</p>
      {accounts.map((a) => (
        <div key={a.id} className={s.setRow}>
          <span className={a.is_active ? '' : s.off}>{a.name} <span className="cell-soft">· {a.kind}</span></span>
          <button className={s.linkBtn} onClick={() => toggleAcc(a)}>{a.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
        </div>
      ))}
      <div className={s.setAdd}>
        <select value={newAcc.kind} onChange={(e) => setNewAcc({ ...newAcc, kind: e.target.value })}>
          <option value="bank">Bank</option><option value="kas">Kas</option><option value="ewallet">E-wallet</option>
        </select>
        <input value={newAcc.name} onChange={(e) => setNewAcc({ ...newAcc, name: e.target.value })} placeholder="Nama akun baru" />
        <button className="btn btn-ghost btn-sm" onClick={addAcc}>Tambah</button>
      </div>

      <div className={s.setTitle}>Kategori</div>
      {['keluar', 'masuk'].map((k) => (
        <div key={k}>
          <div className={s.setSub}>{k === 'keluar' ? 'Pengeluaran' : 'Pemasukan'}</div>
          {categories.filter((c) => c.kind === k).map((c) => (
            <div key={c.id} className={s.setRow}>
              <span className={c.is_active ? '' : s.off}>{c.name}</span>
              <button className={s.linkBtn} onClick={() => toggleCat(c)}>{c.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
            </div>
          ))}
        </div>
      ))}
      <div className={s.setAdd}>
        <select value={newCat.kind} onChange={(e) => setNewCat({ ...newCat, kind: e.target.value })}>
          <option value="keluar">Pengeluaran</option><option value="masuk">Pemasukan</option>
        </select>
        <input value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} placeholder="Nama kategori baru" />
        <button className="btn btn-ghost btn-sm" onClick={addCat}>Tambah</button>
      </div>
      <div className="modal-actions"><button className="btn btn-primary" onClick={onClose}>Selesai</button></div>
    </Modal>
  );
}
