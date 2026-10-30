import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { buildXlsx, saveFile } from '../lib/xlsxLite';
import Modal from './Modal';
import s from './BackupTab.module.css';

// Nama tabel → label yang mudah dipahami (urutan = urutan tampil)
const TABLES = [
  { key: 'leads', label: 'Leads', sheet: 'Leads' },
  { key: 'lead_followups', label: 'Riwayat follow-up', sheet: 'Follow-up' },
  { key: 'properties', label: 'Listing properti', sheet: 'Listing' },
  { key: 'transactions', label: 'Transaksi', sheet: 'Transaksi' },
  { key: 'wa_conversations', label: 'Chat WA — percakapan', sheet: 'Chat Percakapan' },
  { key: 'wa_messages', label: 'Chat WA — pesan', sheet: 'Chat Pesan' },
  { key: 'wa_events', label: 'Chat WA — log aktivitas', sheet: 'Chat Log' },
  { key: 'attendance', label: 'Absensi', sheet: 'Absensi' },
  { key: 'leave_requests', label: 'Izin / sakit / cuti', sheet: 'Izin' },
  { key: 'staff_targets', label: 'Target staf', sheet: 'Target Staf' },
  { key: 'attendance_settings', label: 'Pengaturan absensi', sheet: 'Pengaturan Absensi' },
  { key: 'news_articles', label: 'Berita', sheet: 'Berita' },
  { key: 'profiles', label: 'Data staf', sheet: 'Staf', noRestore: true },
];
const LABEL = Object.fromEntries(TABLES.map((t) => [t.key, t.label]));
const KIND = {
  otomatis: { label: 'Otomatis', badge: 'badge-grey' },
  manual: { label: 'Manual', badge: 'badge-gold' },
  sebelum_pulihkan: { label: 'Sebelum pulihkan', badge: 'badge-red' },
};
// Kolom berisi ID staf → ditambah kolom nama staf di Excel
const STAFF_COLS = ['agent_id', 'user_id', 'created_by', 'assigned_to', 'sent_by', 'actor_id', 'target_id', 'reviewed_by', 'updated_by', 'downloaded_by'];
// Kolom teknis yang tidak perlu di Excel (tetap ada di file JSON)
const SKIP_COLS = { wa_messages: ['raw'], push_subscriptions: ['p256dh', 'auth'] };

const TZ = 'Asia/Jakarta';
const fmtDT = (iso) =>
  new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const fmtExcelDT = (iso) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const stamp = (iso) => fmtExcelDT(iso).replace(/[: ]/g, '-').replace(/-+/g, '-');
function rel(iso) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.round(h / 24);
  return `${d} hari lalu`;
}
const daysSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);
function fmtSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
function cleanErr(e) {
  return String(e?.message || e || 'Terjadi kesalahan').replace(/^.*?ERROR:\s*/i, '');
}
function summary(counts) {
  if (!counts) return '';
  return ['leads', 'properties', 'transactions', 'wa_messages', 'attendance']
    .filter((k) => counts[k] !== undefined)
    .map((k) => `${counts[k]} ${({ leads: 'leads', properties: 'listing', transactions: 'transaksi', wa_messages: 'pesan WA', attendance: 'absensi' })[k]}`)
    .join(' · ');
}

// ---------- Excel dari isi backup ----------
function backupToSheets(data, createdAt) {
  const staff = Object.fromEntries((data.profiles || []).map((p) => [p.id, p.name]));
  const props = Object.fromEntries((data.properties || []).map((p) => [p.id, p.title]));
  const leads = Object.fromEntries((data.leads || []).map((p) => [p.id, p.name]));
  const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

  const info = [
    ['Keterangan', 'Isi'],
    ['Aplikasi', 'SAM Admin — PT Satya Manggala Propertindo'],
    ['Waktu backup (WIB)', fmtExcelDT(createdAt)],
    ['Catatan', 'File ini salinan data untuk dibaca. Untuk memulihkan data gunakan file .json'],
    [],
    ['Data', 'Jumlah baris'],
    ...TABLES.map((t) => [t.label, (data[t.key] || []).length]),
  ];
  const sheets = [{ name: 'Ringkasan', rows: info }];

  for (const t of TABLES) {
    const rows = data[t.key] || [];
    const skip = SKIP_COLS[t.key] || [];
    const cols = [];
    rows.forEach((r) => Object.keys(r).forEach((k) => !cols.includes(k) && !skip.includes(k) && cols.push(k)));
    const header = [];
    const getters = [];
    cols.forEach((c) => {
      header.push(c);
      getters.push((r) => {
        const v = r[c];
        if (typeof v === 'string' && isoRe.test(v)) return fmtExcelDT(v);
        return v;
      });
      if (STAFF_COLS.includes(c)) {
        header.push(c.replace(/_id$|_by$|_to$/, '') + '_nama');
        getters.push((r) => (r[c] ? staff[r[c]] || '(staf terhapus)' : ''));
      }
      if (c === 'property_id') {
        header.push('properti_nama');
        getters.push((r) => (r.property_id ? props[r.property_id] || '' : ''));
      }
      if (c === 'lead_id') {
        header.push('lead_nama');
        getters.push((r) => (r.lead_id ? leads[r.lead_id] || '' : ''));
      }
    });
    sheets.push({ name: t.sheet, rows: rows.length ? [header, ...rows.map((r) => getters.map((g) => g(r)))] : [['(kosong)']] });
  }
  return sheets;
}

export default function BackupTab({ showToast }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState('');
  const [restore, setRestore] = useState(null); // { source: 'id'|'file', id?, data?, createdAt, counts }
  const fileRef = useRef(null);
  const notify = useCallback((m) => (showToast ? showToast(m) : window.alert(m)), [showToast]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('backup_list');
    if (error) {
      notify('Daftar backup gagal dimuat: ' + cleanErr(error));
      setList([]);
      return;
    }
    setList(data || []);
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function createBackup() {
    setBusy('create');
    const { error } = await supabase.rpc('backup_create', { p_note: null });
    setBusy('');
    if (error) return notify('Backup gagal: ' + cleanErr(error));
    notify('Backup berhasil dibuat');
    load();
  }

  async function fetchData(b) {
    const { data, error } = await supabase.rpc('backup_get', { p_id: b.id });
    if (error) throw error;
    return data;
  }

  async function download(b, type) {
    setBusy(b.id + type);
    try {
      const data = await fetchData(b);
      const base = `backup-sam-admin_${stamp(b.created_at)}`;
      if (type === 'json') {
        await saveFile(new Blob([JSON.stringify(data)], { type: 'application/json' }), base + '.json');
      } else {
        await saveFile(buildXlsx(backupToSheets(data, b.created_at)), base + '.xlsx');
      }
      load();
    } catch (e) {
      notify('Gagal mengunduh: ' + cleanErr(e));
    }
    setBusy('');
  }

  async function remove(b) {
    if (!window.confirm(`Hapus backup ${fmtDT(b.created_at)}? Backup yang dihapus tidak bisa dikembalikan.`)) return;
    const { error } = await supabase.rpc('backup_delete', { p_id: b.id });
    if (error) return notify('Gagal menghapus: ' + cleanErr(error));
    notify('Backup dihapus');
    load();
  }

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !data._meta || data._meta.app !== 'SAM Admin') throw new Error('Ini bukan file backup SAM Admin (.json).');
      const counts = Object.fromEntries(TABLES.map((t) => [t.key, (data[t.key] || []).length]));
      setRestore({ source: 'file', data, createdAt: data._meta.created_at, counts, fileName: file.name });
    } catch (err) {
      notify(err instanceof SyntaxError ? 'File tidak bisa dibaca. Pilih file backup berakhiran .json' : cleanErr(err));
    }
  }

  const latest = list && list[0];
  const lastAuto = list && list.find((b) => b.kind === 'otomatis');
  const lastDownload = list && list.reduce((m, b) => (b.downloaded_at && (!m || b.downloaded_at > m) ? b.downloaded_at : m), null);
  const needOffsite = list && daysSince(lastDownload) > 7;

  return (
    <section>
      <div className="topbar">
        <div>
          <h1>Backup Data</h1>
          <p>Cadangan seluruh data dashboard — bisa diunduh dan dipulihkan</p>
        </div>
        <div className={s.actions}>
          <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
            Pulihkan dari File
          </button>
          <button className="btn btn-primary btn-sm" onClick={createBackup} disabled={busy === 'create'}>
            {busy === 'create' ? 'Membuat backup…' : 'Backup Sekarang'}
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={pickFile} />
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Backup otomatis</div>
          <div className={`kpi-value accent ${s.kpiSmall}`}>Aktif</div>
          <div className={s.kpiNote}>Setiap hari 02.00 WIB · disimpan 30 hari</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Backup terakhir</div>
          <div className={`kpi-value ${s.kpiSmall}`}>{latest ? rel(latest.created_at) : '—'}</div>
          <div className={s.kpiNote}>{latest ? fmtDT(latest.created_at) : 'Belum ada backup'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Otomatis terakhir</div>
          <div className={`kpi-value ${s.kpiSmall}`}>{lastAuto ? rel(lastAuto.created_at) : '—'}</div>
          <div className={s.kpiNote}>{lastAuto ? `${lastAuto.total_rows} baris data` : 'Menunggu jadwal 02.00 WIB'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Disalin ke perangkat</div>
          <div className={`kpi-value ${s.kpiSmall} ${needOffsite ? s.warnText : ''}`}>{lastDownload ? rel(lastDownload) : 'Belum pernah'}</div>
          <div className={s.kpiNote}>Unduh & simpan di Google Drive / laptop</div>
        </div>
      </div>

      {needOffsite && list.length > 0 && (
        <div className={s.notice}>
          <b>Simpan salinan di luar aplikasi minimal seminggu sekali.</b> Backup di sini tersimpan di server yang sama dengan data. Unduh file
          <b> JSON</b> (untuk pemulihan) dan <b>Excel</b> (untuk dibaca) dari backup terbaru, lalu simpan di Google Drive.
        </div>
      )}

      <div className="table-wrap">
        {list === null ? (
          <div className="panel-empty">Memuat…</div>
        ) : list.length === 0 ? (
          <div className="empty-state">
            <div className="big">Belum ada backup</div>
            <div>Klik “Backup Sekarang” untuk membuat backup pertama.</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Jenis</th>
                <th>Isi</th>
                <th>Ukuran</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((b) => {
                const k = KIND[b.kind] || KIND.manual;
                return (
                  <tr key={b.id}>
                    <td>
                      <div className="cell-strong">{fmtDT(b.created_at)}</div>
                      <div className="cell-soft">
                        {b.created_by_name ? `oleh ${b.created_by_name}` : 'sistem'}
                        {b.downloaded_at ? ' · sudah diunduh' : ''}
                      </div>
                    </td>
                    <td>
                      <span className={'badge ' + k.badge}>{k.label}</span>
                    </td>
                    <td>
                      <div>{b.total_rows} baris</div>
                      <div className="cell-soft">{summary(b.row_counts)}</div>
                    </td>
                    <td className="cell-soft">{fmtSize(b.size_bytes)}</td>
                    <td>
                      <div className={s.rowBtns}>
                        <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => download(b, 'xlsx')}>
                          {busy === b.id + 'xlsx' ? '…' : 'Excel'}
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => download(b, 'json')}>
                          {busy === b.id + 'json' ? '…' : 'JSON'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={!!busy}
                          onClick={() => setRestore({ source: 'id', id: b.id, createdAt: b.created_at, counts: b.row_counts })}
                        >
                          Pulihkan
                        </button>
                        <button className="icon-btn" title="Hapus backup" disabled={!!busy} onClick={() => remove(b)}>
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className={s.foot}>
        Yang dicadangkan: leads & riwayat follow-up, listing, transaksi, Chat WA, absensi, izin, target, berita, dan data staf. Foto listing,
        foto selfie, dan file chat tetap tersimpan di Storage Supabase (tidak ikut file backup). Password login tidak pernah ikut dicadangkan.
      </p>

      {restore && (
        <RestoreModal
          info={restore}
          onClose={() => setRestore(null)}
          onDone={() => {
            load();
          }}
          notify={notify}
        />
      )}
    </section>
  );
}

// =====================================================================
function RestoreModal({ info, onClose, onDone, notify }) {
  const [current, setCurrent] = useState(null);
  const [picked, setPicked] = useState([]);
  const [confirm, setConfirm] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const tables = TABLES.filter((t) => !t.noRestore);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('backup_current_counts');
      if (error) {
        notify('Gagal membaca data sekarang: ' + cleanErr(error));
        setCurrent({});
        return;
      }
      setCurrent(data || {});
      // pilih otomatis tabel yang jumlahnya di backup lebih banyak dari sekarang
      setPicked(tables.filter((t) => (info.counts?.[t.key] || 0) > (data?.[t.key] || 0)).map((t) => t.key));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  async function run() {
    setRunning(true);
    const res =
      info.source === 'file'
        ? await supabase.rpc('backup_restore_file', { p_data: info.data, p_tables: picked })
        : await supabase.rpc('backup_restore', { p_id: info.id, p_tables: picked });
    setRunning(false);
    if (res.error) return notify('Pemulihan gagal: ' + cleanErr(res.error));
    setResult(res.data);
    onDone();
  }

  if (result) {
    const rows = Object.entries(result.tables || {});
    const added = rows.reduce((a, [, v]) => a + (v.added || 0), 0);
    const failed = rows.filter(([, v]) => v.failed > 0);
    return (
      <Modal onClose={onClose}>
        <h3>Pemulihan selesai</h3>
        <p className={s.lead}>
          <b>{added}</b> baris data yang hilang berhasil dikembalikan. Data yang sudah ada tidak diubah.
        </p>
        <div className={s.resultList}>
          {rows.map(([k, v]) => (
            <div key={k} className={s.resultRow}>
              <span>{LABEL[k] || k}</span>
              <span>
                <b>+{v.added}</b>
                {v.failed ? <em className={s.warnText}> · {v.failed} gagal</em> : null}
              </span>
            </div>
          ))}
        </div>
        {failed.length > 0 && (
          <p className={s.small}>
            Sebagian baris gagal, biasanya karena staf terkait sudah dihapus. Buat ulang akun staf tersebut lalu pulihkan lagi. Detail: {failed[0][1].error}
          </p>
        )}
        <p className={s.small}>Sebelum memulihkan, sistem sudah membuat backup “Sebelum pulihkan” sebagai pengaman.</p>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Selesai & muat ulang
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={running ? () => {} : onClose}>
      <h3>Pulihkan data</h3>
      <p className={s.lead}>
        Dari backup <b>{fmtDT(info.createdAt)}</b>
        {info.fileName ? <> (file {info.fileName})</> : null}.
      </p>
      <div className={s.safe}>
        Aman: hanya data yang <b>sudah terhapus</b> yang dikembalikan. Data yang ada sekarang tidak ditimpa, dan sistem otomatis membuat backup
        dulu sebelum memulihkan.
      </div>

      {current === null ? (
        <div className="panel-empty">Membandingkan data…</div>
      ) : (
        <div className={s.pickList}>
          <div className={`${s.pickRow} ${s.pickHead}`}>
            <span>Data</span>
            <span>Di backup</span>
            <span>Sekarang</span>
          </div>
          {tables.map((t) => {
            const inB = info.counts?.[t.key] ?? 0;
            const now = current[t.key] ?? 0;
            const less = inB > now;
            return (
              <label key={t.key} className={s.pickRow}>
                <span className={s.pickName}>
                  <input type="checkbox" checked={picked.includes(t.key)} onChange={() => toggle(t.key)} disabled={!inB} />
                  {t.label}
                </span>
                <span>{inB}</span>
                <span className={less ? s.warnText : ''}>{now}</span>
              </label>
            );
          })}
        </div>
      )}
      <p className={s.small}>Angka “Sekarang” merah = jumlah data sekarang lebih sedikit dari backup (kemungkinan ada yang terhapus).</p>

      <div className="field">
        <label htmlFor="rs-confirm">Ketik PULIHKAN untuk melanjutkan</label>
        <input id="rs-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="PULIHKAN" autoComplete="off" />
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={running}>
          Batal
        </button>
        <button className="btn btn-primary" onClick={run} disabled={running || !picked.length || confirm.trim().toUpperCase() !== 'PULIHKAN'}>
          {running ? 'Memulihkan…' : `Pulihkan ${picked.length} jenis data`}
        </button>
      </div>
    </Modal>
  );
}
