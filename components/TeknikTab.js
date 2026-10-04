// Tab Teknik — sistem kerja Divisi Teknik Amansaka Villa Park.
// Modul: Ringkasan, Proyek & progres, Laporan lapangan, Anggaran, QC & serah terima, Perawatan, Tim.
// Data: tabel teknik_* (lihat supabase/006_divisi_teknik.sql). Foto: bucket Storage "teknik".
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import Modal from './Modal';
import s from './TeknikTab.module.css';

// ---------------------------------------------------------------------
// KONSTANTA
// ---------------------------------------------------------------------
// 12 tahapan pekerjaan + nilai dari RAB Unit B5 (03-07-2023). Bobot = porsi nilai terhadap total RAB.
const TAHAPAN_RAW = [
  [1, 'Persiapan', 2788016.88],
  [2, 'Pekerjaan tanah', 7080349.65],
  [3, 'Pondasi', 16957271.31],
  [4, 'Struktur', 187534504.51],
  [5, 'Pasangan dinding', 84124934.36],
  [6, 'Atap', 16776560.53],
  [7, 'Plafon', 21550834.79],
  [8, 'Sanitasi', 47324548.88],
  [9, 'Kusen, pintu, jendela & besi', 123795899.1],
  [10, 'Lantai & dinding (keramik)', 144060950.14],
  [11, 'Pengecatan', 15743741.64],
  [12, 'Listrik', 23139150],
];
const RAB_ACUAN = TAHAPAN_RAW.reduce((a, t) => a + t[2], 0);
const TAHAPAN = TAHAPAN_RAW.map(([no, nama, rab]) => ({ no, nama, rab, bobot: rab / RAB_ACUAN }));
const DEFAULT_RAB = 685000000;

const STATUS_UNIT = {
  perencanaan: { label: 'Perencanaan', cls: 'badge-grey' },
  konstruksi: { label: 'Konstruksi', cls: 'badge-gold' },
  finishing: { label: 'Finishing', cls: 'badge-gold' },
  serah_terima: { label: 'Serah terima', cls: 'badge-green' },
  operasional: { label: 'Operasional', cls: 'badge-green' },
};
const PRIORITAS = {
  darurat: { label: 'Darurat', sla: 4, cls: 'badge-red', rank: 0 },
  tinggi: { label: 'Tinggi', sla: 24, cls: 'badge-gold', rank: 1 },
  normal: { label: 'Normal', sla: 72, cls: 'badge-grey', rank: 2 },
  rendah: { label: 'Rendah', sla: 168, cls: 'badge-grey', rank: 3 },
};
const STATUS_TIKET = {
  baru: { label: 'Baru', cls: 'badge-red' },
  dikerjakan: { label: 'Dikerjakan', cls: 'badge-gold' },
  menunggu_material: { label: 'Menunggu material', cls: 'badge-grey' },
  selesai: { label: 'Selesai', cls: 'badge-green' },
};
const TINGKAT = {
  minor: { label: 'Minor', cls: 'badge-grey' },
  mayor: { label: 'Mayor', cls: 'badge-gold' },
  kritis: { label: 'Kritis', cls: 'badge-red' },
};
const STATUS_TEMUAN = {
  terbuka: { label: 'Terbuka', cls: 'badge-red' },
  diperbaiki: { label: 'Menunggu verifikasi', cls: 'badge-gold' },
  terverifikasi: { label: 'Terverifikasi', cls: 'badge-green' },
};
const KATEGORI_TIKET = ['Listrik', 'Air & plumbing', 'AC', 'Kolam renang', 'Atap & bocor', 'Pintu & kunci', 'Water heater', 'Furnitur', 'Taman', 'Lainnya'];
const KATEGORI_ASET = ['Kolam', 'AC', 'Pompa air', 'Water heater', 'Listrik & panel', 'Atap & talang', 'Genset', 'Lainnya'];
const ASET_STANDAR = [
  { nama: 'Pompa & filter kolam', kategori: 'Kolam', interval_hari: 7 },
  { nama: 'Uji kimia air kolam', kategori: 'Kolam', interval_hari: 3 },
  { nama: 'Servis & cuci AC', kategori: 'AC', interval_hari: 90 },
  { nama: 'Water heater', kategori: 'Water heater', interval_hari: 180 },
  { nama: 'Pompa air & kuras tandon', kategori: 'Pompa air', interval_hari: 90 },
  { nama: 'Talang & atap', kategori: 'Atap & talang', interval_hari: 90 },
  { nama: 'Panel listrik & MCB', kategori: 'Listrik & panel', interval_hari: 180 },
];
const CUACA = ['Cerah', 'Berawan', 'Gerimis', 'Hujan', 'Hujan lebat'];
const JABATAN = ['Manajer Teknik', 'Site Engineer', 'Pengawas Lapangan', 'Drafter / Estimator', 'Teknisi Perawatan', 'Admin Teknik'];
const BOBOT_SKOR = { sla: 40, disiplin: 30, tuntas: 30 };

// ---------------------------------------------------------------------
// HELPER
// ---------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const today = () => ymd(new Date());
function toDate(str) {
  if (!str) return null;
  const [y, m, d] = String(str).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
const dayDiff = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const addDays = (str, n) => {
  const d = toDate(str);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
function tgl(str, withYear = true) {
  const d = toDate(str);
  if (!d) return '-';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}
function jam(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
const num = (n) => (Number(n) || 0).toLocaleString('id-ID');
function rp(n) {
  n = Number(n) || 0;
  const a = Math.abs(n);
  if (a >= 1e9) return 'Rp ' + (n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' M';
  if (a >= 1e6) return 'Rp ' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}
const rpFull = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const pct = (p, d = 0) => (Number(p) || 0).toLocaleString('id-ID', { maximumFractionDigits: d }) + '%';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function monthName(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}
function workdaysElapsed(m) {
  const [y, mo] = m.split('-').map(Number);
  const days = new Date(y, mo, 0).getDate();
  const cur = ym(new Date());
  if (m > cur) return 0;
  const lim = m === cur ? new Date().getDate() : days;
  let c = 0;
  for (let d = 1; d <= lim; d++) if (new Date(y, mo - 1, d).getDay() !== 0) c++;
  return c;
}
const tiketNo = (t) => 'TK-' + String(t.nomor || 0).padStart(4, '0');

// Rencana progres (kurva S) pada tanggal tertentu: smoothstep antara tgl_mulai dan tgl_target.
function rencana(u, dateStr = today()) {
  if (!u.tgl_mulai || !u.tgl_target) return null;
  const span = dayDiff(u.tgl_mulai, u.tgl_target);
  if (span <= 0) return 100;
  const x = clamp(dayDiff(u.tgl_mulai, dateStr) / span, 0, 1);
  return 100 * (3 * x * x - 2 * x * x * x);
}
function totalProgres(map) {
  if (!map) return 0;
  return TAHAPAN.reduce((a, t) => a + t.bobot * (Number(map[t.no]) || 0), 0);
}
function kesehatan(u, total) {
  if (['serah_terima', 'operasional'].includes(u.status) || total >= 99.95) return 'done';
  if (u.status === 'perencanaan' || !u.tgl_mulai || !u.tgl_target) return 'idle';
  const dev = total - rencana(u);
  if (dev >= -5) return 'ok';
  if (dev >= -15) return 'warn';
  return 'crit';
}
const HEALTH = {
  done: { label: 'Selesai', cls: 'badge-green' },
  idle: { label: 'Belum mulai', cls: 'badge-grey' },
  ok: { label: 'Sesuai jadwal', cls: 'badge-green' },
  warn: { label: 'Waspada', cls: 'badge-gold' },
  crit: { label: 'Kritis', cls: 'badge-red' },
};
function slaInfo(t, now = Date.now()) {
  const sla = (PRIORITAS[t.prioritas]?.sla || 72) * 3600000;
  const start = new Date(t.created_at).getTime();
  const end = t.selesai_at ? new Date(t.selesai_at).getTime() : now;
  const used = end - start;
  return { sisa: sla - used, used, lewat: used > sla, sla };
}
function durasi(ms) {
  const a = Math.abs(ms);
  const h = Math.floor(a / 3600000);
  if (h >= 48) return Math.round(h / 24) + ' hari';
  if (h >= 1) return h + ' jam';
  return Math.max(1, Math.round(a / 60000)) + ' mnt';
}
function asetJatuhTempo(a) {
  const next = a.terakhir ? addDays(a.terakhir, a.interval_hari) : today();
  return { next, sisa: dayDiff(today(), next) };
}
const fotoUrl = (path) => (path ? supabase.storage.from('teknik').getPublicUrl(path).data.publicUrl : '');

// Kompres foto di HP sebelum upload (maks 1600px, JPEG) supaya hemat kuota Storage.
async function compress(file) {
  if (!file.type.startsWith('image/')) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.75));
  } catch (e) {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function uploadFotos(files, folder) {
  const paths = [];
  for (const f of files) {
    const blob = await compress(f);
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await supabase.storage.from('teknik').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error('Upload foto gagal: ' + error.message);
    paths.push(path);
  }
  return paths;
}
async function notify(type, id) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return;
    await fetch('/api/teknik/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ type, id }),
    });
  } catch (e) {
    /* notifikasi bersifat tambahan; data sudah tersimpan */
  }
}

// ---------------------------------------------------------------------
// KOMPONEN KECIL
// ---------------------------------------------------------------------
function Bar({ value, plan, tone }) {
  return (
    <div className={s.bar}>
      <div className={`${s.barFill} ${s['tone_' + (tone || 'ok')]}`} style={{ width: clamp(value, 0, 100) + '%' }} />
      {plan != null && <div className={s.barPlan} style={{ left: clamp(plan, 0, 100) + '%' }} title={'Rencana ' + pct(plan)} />}
    </div>
  );
}

function PhotoPicker({ files, setFiles, max = 6 }) {
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  return (
    <div className="field">
      <label>Foto ({files.length}/{max})</label>
      <div className={s.photoRow}>
        {previews.map((u, i) => (
          <div key={u} className={s.photoThumb}>
            <img src={u} alt="" />
            <button type="button" className={s.photoDel} onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Hapus foto">×</button>
          </div>
        ))}
        {files.length < max && (
          <label className={s.photoAdd}>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                const picked = Array.from(e.target.files || []);
                setFiles([...files, ...picked].slice(0, max));
                e.target.value = '';
              }}
            />
            + Foto
          </label>
        )}
      </div>
    </div>
  );
}

function Fotos({ paths, onOpen }) {
  if (!paths || !paths.length) return null;
  return (
    <div className={s.photoRow}>
      {paths.map((p) => (
        <button key={p} type="button" className={s.photoThumb} onClick={() => onOpen(fotoUrl(p))}>
          <img src={fotoUrl(p)} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  );
}

function Sheet({ title, sub, onClose, children }) {
  return (
    <div className={s.sheetOverlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.sheet}>
        <div className={s.sheetHead}>
          <div>
            <h3 className={s.sheetTitle}>{title}</h3>
            {sub && <div className={s.muted}>{sub}</div>}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Tutup</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Empty({ title, children }) {
  return (
    <div className="empty-state">
      <div className="big">{title}</div>
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------
// KOMPONEN UTAMA
// ---------------------------------------------------------------------
const VIEWS = [
  { key: 'ringkasan', label: 'Ringkasan' },
  { key: 'proyek', label: 'Proyek & progres' },
  { key: 'lapangan', label: 'Laporan lapangan' },
  { key: 'anggaran', label: 'Anggaran', teknik: true },
  { key: 'qc', label: 'QC & serah terima' },
  { key: 'perawatan', label: 'Perawatan' },
  { key: 'tim', label: 'Tim teknik', admin: true },
];

export default function TeknikTab({ user, isAdmin, profiles = [], showToast }) {
  const [view, setView] = useState('ringkasan');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [d, setD] = useState({ members: [], units: [], progress: [], logs: [], laporan: [], biaya: [], temuan: [], tiket: [], aset: [], asetLog: [] });
  const [openUnit, setOpenUnit] = useState(null);
  const [lightbox, setLightbox] = useState('');

  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('v');
    if (v && VIEWS.some((x) => x.key === v)) setView(v);
  }, []);

  const load = useCallback(async () => {
    const q = (t, order, asc = false, limit) => {
      let r = supabase.from(t).select('*');
      if (order) r = r.order(order, { ascending: asc });
      if (limit) r = r.limit(limit);
      return r;
    };
    const res = await Promise.all([
      q('teknik_members'),
      q('teknik_units', 'kode', true),
      q('teknik_progress'),
      q('teknik_progress_log', 'tanggal', true),
      q('teknik_laporan', 'tanggal', false, 600),
      q('teknik_biaya', 'tanggal', false, 2000),
      q('teknik_temuan', 'created_at', false, 1000),
      q('teknik_tiket', 'created_at', false, 1000),
      q('teknik_aset', 'nama', true),
      q('teknik_aset_log', 'tanggal', false, 500),
    ]);
    const bad = res.find((r) => r.error);
    if (bad) {
      setErr(bad.error.message);
      setLoading(false);
      return;
    }
    const [members, units, progress, logs, laporan, biaya, temuan, tiket, aset, asetLog] = res.map((r) => r.data || []);
    setD({ members, units, progress, logs, laporan, biaya, temuan, tiket, aset, asetLog });
    setErr('');
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isTeknik = isAdmin || d.members.some((m) => m.profile_id === user?.id);
  const nameOf = useMemo(() => {
    const m = {};
    profiles.forEach((p) => (m[p.id] = p.name || 'Tanpa nama'));
    return (id) => (id ? m[id] || '—' : '—');
  }, [profiles]);
  const team = useMemo(() => {
    const ids = new Set(d.members.map((m) => m.profile_id));
    return profiles.filter((p) => ids.has(p.id) || p.role === 'admin');
  }, [profiles, d.members]);

  const progMap = useMemo(() => {
    const m = {};
    d.progress.forEach((r) => {
      (m[r.unit_id] = m[r.unit_id] || {})[r.tahap] = Number(r.persen) || 0;
    });
    return m;
  }, [d.progress]);
  const unitStats = useMemo(() => {
    const spent = {};
    d.biaya.forEach((b) => b.unit_id && (spent[b.unit_id] = (spent[b.unit_id] || 0) + Number(b.jumlah || 0)));
    const m = {};
    d.units.forEach((u) => {
      const total = totalProgres(progMap[u.id]);
      const plan = rencana(u);
      const ac = spent[u.id] || 0;
      const ev = (total / 100) * Number(u.nilai_rab || 0);
      m[u.id] = { total, plan, dev: plan == null ? null : total - plan, health: kesehatan(u, total), ac, ev, cpi: ac > 0 ? ev / ac : null };
    });
    return m;
  }, [d.units, d.biaya, progMap]);
  const unitKode = useMemo(() => {
    const m = {};
    d.units.forEach((u) => (m[u.id] = u.kode));
    return (id) => (id ? m[id] || '—' : 'Fasilitas umum');
  }, [d.units]);

  const ctx = { d, user, isAdmin, isTeknik, profiles, team, nameOf, unitKode, progMap, unitStats, reload: load, showToast, setOpenUnit, setLightbox, setView };
  const views = VIEWS.filter((v) => (!v.admin || isAdmin) && (!v.teknik || isTeknik));

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Divisi Teknik</h1>
          <p>Progres pembangunan, mutu, biaya, dan perawatan villa dalam satu papan kerja.</p>
        </div>
        <button className="btn btn-ghost" onClick={() => { setLoading(true); load(); }}>Muat ulang</button>
      </div>

      <div className={s.tabs} role="tablist">
        {views.map((v) => (
          <button key={v.key} role="tab" aria-selected={view === v.key} className={`${s.tab} ${view === v.key ? s.tabOn : ''}`} onClick={() => setView(v.key)}>
            {v.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="panel-empty">Memuat data teknik...</div>
      ) : err ? (
        <div className="panel">
          <h3>Gagal memuat data teknik</h3>
          <p className={s.muted}>
            Pastikan file <b>supabase/006_divisi_teknik.sql</b> sudah dijalankan di Supabase SQL Editor. Pesan sistem: {err}
          </p>
        </div>
      ) : (
        <>
          {!isTeknik && (
            <div className={s.note}>
              Anda melihat dalam mode baca. Anda tetap bisa <b>melaporkan kerusakan villa</b> di menu Perawatan. Untuk mengubah data teknik, minta admin menambahkan Anda di Tim teknik.
            </div>
          )}
          {view === 'ringkasan' && <Ringkasan {...ctx} />}
          {view === 'proyek' && <Proyek {...ctx} />}
          {view === 'lapangan' && <Lapangan {...ctx} />}
          {view === 'anggaran' && isTeknik && <Anggaran {...ctx} />}
          {view === 'qc' && <QC {...ctx} />}
          {view === 'perawatan' && <Perawatan {...ctx} />}
          {view === 'tim' && isAdmin && <Tim {...ctx} />}
        </>
      )}

      {openUnit && d.units.find((u) => u.id === openUnit) && (
        <UnitDetail {...ctx} unit={d.units.find((u) => u.id === openUnit)} onClose={() => setOpenUnit(null)} />
      )}
      {lightbox && (
        <div className={s.lightbox} onClick={() => setLightbox('')}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// RINGKASAN
// ---------------------------------------------------------------------
const JABATAN_LAPANGAN = ['Manajer Teknik', 'Site Engineer', 'Pengawas Lapangan'];
function skorTim({ d, profiles, month }) {
  const wd = workdaysElapsed(month);
  const jab = {};
  d.members.forEach((m) => (jab[m.profile_id] = m.jabatan));
  return profiles
    .filter((p) => jab[p.id])
    .map((p) => {
      const lapangan = JABATAN_LAPANGAN.includes(jab[p.id]);
      const lapDays = new Set(d.laporan.filter((l) => l.pelapor === p.id && String(l.tanggal).startsWith(month)).map((l) => l.tanggal)).size;
      const tiketMine = d.tiket.filter((t) => t.teknisi === p.id);
      const selesaiBulan = tiketMine.filter((t) => t.status === 'selesai' && t.selesai_at && ym(new Date(t.selesai_at)) === month);
      const tepat = selesaiBulan.filter((t) => !slaInfo(t).lewat).length;
      const tugasBulan = [
        ...tiketMine.filter((t) => ym(new Date(t.created_at)) === month),
        ...d.temuan.filter((q) => q.pic === p.id && ym(new Date(q.created_at)) === month),
      ];
      const tuntas = tugasBulan.filter((x) => x.status === 'selesai' || x.status === 'terverifikasi' || x.status === 'diperbaiki').length;
      const comp = {
        disiplin: lapangan && wd > 0 ? Math.min(1, lapDays / wd) : null,
        sla: selesaiBulan.length ? tepat / selesaiBulan.length : null,
        tuntas: tugasBulan.length ? tuntas / tugasBulan.length : null,
      };
      let w = 0;
      let sc = 0;
      Object.entries(BOBOT_SKOR).forEach(([k, b]) => {
        if (comp[k] != null) {
          w += b;
          sc += b * comp[k];
        }
      });
      const skor = w ? (sc / w) * 100 : null;
      const grade = skor == null ? '—' : skor >= 85 ? 'A' : skor >= 70 ? 'B' : skor >= 55 ? 'C' : 'D';
      return { p, jabatan: jab[p.id], lapangan, lapDays, wd, selesai: selesaiBulan.length, tepat, tugas: tugasBulan.length, tuntas, skor, grade };
    })
    .sort((a, b) => (b.skor ?? -1) - (a.skor ?? -1));
}

function Ringkasan({ d, profiles, isTeknik, unitStats, unitKode, nameOf, setOpenUnit, setView }) {
  const [month, setMonth] = useState(ym(new Date()));
  const aktif = d.units.filter((u) => ['konstruksi', 'finishing'].includes(u.status));
  const avg = aktif.length ? aktif.reduce((a, u) => a + unitStats[u.id].total, 0) / aktif.length : 0;
  const telat = d.units.filter((u) => ['warn', 'crit'].includes(unitStats[u.id].health));
  const kritisUnit = d.units.filter((u) => unitStats[u.id].health === 'crit');
  const ev = d.units.reduce((a, u) => a + unitStats[u.id].ev, 0);
  const ac = d.units.reduce((a, u) => a + unitStats[u.id].ac, 0);
  const tiketOpen = d.tiket.filter((t) => t.status !== 'selesai');
  const lewatSla = tiketOpen.filter((t) => slaInfo(t).lewat);
  const temuanOpen = d.temuan.filter((q) => q.status !== 'terverifikasi');
  const temuanKritis = temuanOpen.filter((q) => q.tingkat === 'kritis');
  const asetDue = d.aset.filter((a) => asetJatuhTempo(a).sisa <= 0);
  const lapHariIni = d.laporan.filter((l) => l.tanggal === today()).length;

  const groups = useMemo(() => {
    const g = {};
    d.units.forEach((u) => {
      const k = u.kavling || (u.kode.match(/^[A-Za-z]+/) || ['Lain'])[0].toUpperCase();
      (g[k] = g[k] || []).push(u);
    });
    Object.values(g).forEach((arr) => arr.sort((a, b) => a.kode.localeCompare(b.kode, 'id', { numeric: true })));
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]));
  }, [d.units]);

  const aksi = [
    ...lewatSla.map((t) => ({ k: 't' + t.id, tone: 'crit', text: `${tiketNo(t)} lewat SLA ${durasi(slaInfo(t).sisa)} — ${t.judul} (${unitKode(t.unit_id)})`, go: 'perawatan' })),
    ...temuanKritis.map((q) => ({ k: 'q' + q.id, tone: 'crit', text: `Temuan kritis ${unitKode(q.unit_id)}: ${q.deskripsi}`, go: 'qc' })),
    ...kritisUnit.map((u) => ({ k: 'u' + u.id, tone: 'warn', text: `Unit ${u.kode} tertinggal ${pct(Math.abs(unitStats[u.id].dev), 1)} dari rencana`, unit: u.id })),
    ...asetDue.map((a) => ({ k: 'a' + a.id, tone: 'warn', text: `Perawatan jatuh tempo: ${a.nama} (${unitKode(a.unit_id)})`, go: 'perawatan' })),
    ...d.temuan
      .filter((q) => q.status === 'terbuka' && q.tenggat && q.tenggat < today() && q.tingkat !== 'kritis')
      .map((q) => ({ k: 'qt' + q.id, tone: 'warn', text: `Perbaikan lewat tenggat ${unitKode(q.unit_id)}: ${q.deskripsi} — PIC ${nameOf(q.pic)}`, go: 'qc' })),
  ];
  const papan = skorTim({ d, profiles, month });

  return (
    <div>
      <div className={`kpi-grid ${s.kpis}`}>
        <div className="kpi-card">
          <div className="kpi-label">Progres fisik rata-rata</div>
          <div className="kpi-value accent">{pct(avg, 1)}</div>
          <div className={s.kpiSub}>{aktif.length} unit sedang dibangun</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Unit terlambat</div>
          <div className="kpi-value">{telat.length}</div>
          <div className={s.kpiSub}>{kritisUnit.length} kritis (tertinggal &gt;15%)</div>
        </div>
        {isTeknik && (
          <div className="kpi-card">
            <div className="kpi-label">Indeks biaya (CPI)</div>
            <div className="kpi-value gold">{ac > 0 ? (ev / ac).toFixed(2) : '—'}</div>
            <div className={s.kpiSub}>{ac > 0 ? (ev / ac >= 1 ? 'Biaya terkendali' : 'Biaya melebihi nilai fisik') : 'Belum ada realisasi biaya'}</div>
          </div>
        )}
        <div className="kpi-card">
          <div className="kpi-label">Tiket perawatan terbuka</div>
          <div className="kpi-value">{tiketOpen.length}</div>
          <div className={s.kpiSub}>{lewatSla.length} lewat SLA</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Temuan QC terbuka</div>
          <div className="kpi-value">{temuanOpen.length}</div>
          <div className={s.kpiSub}>{temuanKritis.length} kritis</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Laporan lapangan hari ini</div>
          <div className="kpi-value">{lapHariIni}</div>
          <div className={s.kpiSub}>{asetDue.length} perawatan jatuh tempo</div>
        </div>
      </div>

      <div className={`panel ${s.block}`}>
        <div className={s.panelHead}>
          <h3>Papan proyek</h3>
          <div className={s.legend}>
            <span><i className={s.tone_ok} />Sesuai jadwal</span>
            <span><i className={s.tone_warn} />Waspada</span>
            <span><i className={s.tone_crit} />Kritis</span>
            <span><i className={s.tone_done} />Selesai</span>
            <span><i className={s.tone_idle} />Belum mulai</span>
          </div>
        </div>
        {!d.units.length ? (
          <Empty title="Belum ada unit">Tambahkan unit di menu Proyek &amp; progres untuk mulai memantau pembangunan.</Empty>
        ) : (
          groups.map(([k, arr]) => (
            <div key={k} className={s.kavling}>
              <div className={s.kavlingName}>Kavling {k}</div>
              <div className={s.site}>
                {arr.map((u) => {
                  const st = unitStats[u.id];
                  return (
                    <button key={u.id} className={`${s.plot} ${s['plot_' + st.health]}`} onClick={() => setOpenUnit(u.id)} title={`${u.kode} — ${HEALTH[st.health].label}`}>
                      <span className={s.plotFill} style={{ height: clamp(st.total, 0, 100) + '%' }} />
                      {st.plan != null && st.health !== 'done' && <span className={s.plotPlan} style={{ bottom: clamp(st.plan, 0, 100) + '%' }} />}
                      <span className={s.plotCode}>{u.kode}</span>
                      <span className={s.plotPct}>{Math.round(st.total)}%</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
        {d.units.length > 0 && <div className={s.hint}>Tinggi isian = progres fisik. Garis tipis = posisi rencana hari ini. Ketuk unit untuk detail.</div>}
      </div>

      <div className={s.split}>
        <div className="panel">
          <h3>Perlu tindakan</h3>
          {!aksi.length ? (
            <div className="panel-empty">Tidak ada yang mendesak. Semua terkendali.</div>
          ) : (
            <ul className={s.actions}>
              {aksi.slice(0, 12).map((a) => (
                <li key={a.k}>
                  <button className={s.actionItem} onClick={() => (a.unit ? setOpenUnit(a.unit) : setView(a.go))}>
                    <i className={s['tone_' + a.tone]} />
                    <span>{a.text}</span>
                  </button>
                </li>
              ))}
              {aksi.length > 12 && <li className={s.muted}>+{aksi.length - 12} lainnya</li>}
            </ul>
          )}
        </div>
        <div className="panel">
          <div className={s.panelHead}>
            <h3>Kinerja tim teknik</h3>
            <input type="month" className={s.inputSm} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </div>
          {!papan.length ? (
            <div className="panel-empty">Belum ada anggota tim teknik. Admin menambahkannya di menu Tim teknik.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Nama</th><th>Disiplin lapor</th><th>Tepat SLA</th><th>Tugas tuntas</th><th>Skor</th></tr>
                </thead>
                <tbody>
                  {papan.map((r) => (
                    <tr key={r.p.id}>
                      <td><div className="cell-strong">{r.p.name || '—'}</div><div className="cell-soft">{r.jabatan}</div></td>
                      <td>{r.lapangan ? `${r.lapDays}/${r.wd} hari` : '—'}</td>
                      <td>{r.selesai ? `${r.tepat}/${r.selesai}` : '—'}</td>
                      <td>{r.tugas ? `${r.tuntas}/${r.tugas}` : '—'}</td>
                      <td><span className={`${s.grade} ${s['grade_' + (r.grade === '—' ? 'X' : r.grade)]}`}>{r.grade}</span> {r.skor == null ? '' : Math.round(r.skor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className={s.hint}>Skor: tepat SLA {BOBOT_SKOR.sla}%, disiplin laporan lapangan {BOBOT_SKOR.disiplin}% (khusus manajer, site engineer, dan pengawas), tugas tuntas {BOBOT_SKOR.tuntas}%. Komponen tanpa data tidak dihitung. Grade A ≥85, B ≥70, C ≥55.</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// PROYEK & PROGRES
// ---------------------------------------------------------------------
function Proyek({ d, isTeknik, isAdmin, unitStats, reload, showToast, setOpenUnit }) {
  const [filter, setFilter] = useState('semua');
  const [form, setForm] = useState(null);
  const [bulk, setBulk] = useState(false);
  const list = d.units
    .filter((u) => filter === 'semua' || (filter === 'telat' ? ['warn', 'crit'].includes(unitStats[u.id].health) : u.status === filter))
    .sort((a, b) => a.kode.localeCompare(b.kode, 'id', { numeric: true }));
  const chips = [['semua', 'Semua'], ['telat', 'Terlambat'], ...Object.entries(STATUS_UNIT).map(([k, v]) => [k, v.label])];

  return (
    <div>
      <div className={s.toolbar}>
        <div className={s.chips}>
          {chips.map(([k, l]) => (
            <button key={k} className={`${s.chip} ${filter === k ? s.chipOn : ''}`} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        {isTeknik && (
          <div className={s.btnRow}>
            <button className="btn btn-ghost" onClick={() => setBulk(true)}>Tambah banyak unit</button>
            <button className="btn btn-primary" onClick={() => setForm({})}>Tambah unit</button>
          </div>
        )}
      </div>

      {!list.length ? (
        <div className="table-wrap">
          <Empty title={d.units.length ? 'Tidak ada unit di filter ini' : 'Belum ada unit'}>
            {d.units.length ? 'Pilih filter lain.' : 'Mulai dengan "Tambah banyak unit", misalnya Kavling A nomor 1–13.'}
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Unit</th><th>Status</th><th className={s.colWide}>Progres fisik</th><th>Deviasi</th><th>Target selesai</th><th>Kondisi</th></tr>
            </thead>
            <tbody>
              {list.map((u) => {
                const st = unitStats[u.id];
                const sisa = u.tgl_target ? dayDiff(today(), u.tgl_target) : null;
                return (
                  <tr key={u.id} className={s.rowClick} onClick={() => setOpenUnit(u.id)}>
                    <td>
                      <div className="cell-strong">{u.kode}</div>
                      <div className="cell-soft">{[u.tipe, u.kontraktor].filter(Boolean).join(' / ') || '—'}</div>
                    </td>
                    <td><span className={`badge ${STATUS_UNIT[u.status]?.cls}`}>{STATUS_UNIT[u.status]?.label}</span></td>
                    <td>
                      <div className={s.progCell}>
                        <Bar value={st.total} plan={st.health === 'done' ? null : st.plan} tone={st.health} />
                        <span className={s.progNum}>{pct(st.total, 1)}</span>
                      </div>
                    </td>
                    <td className={st.dev != null && st.dev < -5 ? s.neg : ''}>{st.dev == null ? '—' : (st.dev >= 0 ? '+' : '') + pct(st.dev, 1)}</td>
                    <td>
                      <div>{tgl(u.tgl_target)}</div>
                      {sisa != null && st.health !== 'done' && <div className="cell-soft">{sisa >= 0 ? `${sisa} hari lagi` : `lewat ${-sisa} hari`}</div>}
                    </td>
                    <td><span className={`badge ${HEALTH[st.health].cls}`}>{HEALTH[st.health].label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className={s.hint}>Bobot tahapan mengikuti RAB Unit B5 ({rpFull(RAB_ACUAN)}). Struktur {pct(TAHAPAN[3].bobot * 100, 1)}, keramik {pct(TAHAPAN[9].bobot * 100, 1)}, kusen {pct(TAHAPAN[8].bobot * 100, 1)} — tiga tahapan ini menentukan ±66% progres.</div>

      {form && <UnitForm unit={form} isAdmin={isAdmin} onClose={() => setForm(null)} reload={reload} showToast={showToast} />}
      {bulk && <BulkUnitForm existing={d.units} onClose={() => setBulk(false)} reload={reload} showToast={showToast} />}
    </div>
  );
}

function UnitForm({ unit, isAdmin, onClose, reload, showToast }) {
  const [f, setF] = useState({
    kode: '', kavling: '', tipe: '', status: 'perencanaan', tgl_mulai: '', tgl_target: '', tgl_selesai: '', nilai_rab: DEFAULT_RAB, kontraktor: '', catatan: '',
    ...unit,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() {
    if (!f.kode.trim()) return showToast('Kode unit wajib diisi');
    setBusy(true);
    const row = {
      kode: f.kode.trim().toUpperCase(),
      kavling: (f.kavling || (f.kode.match(/^[A-Za-z]+/) || [''])[0]).toUpperCase() || null,
      tipe: f.tipe || null,
      status: f.status,
      tgl_mulai: f.tgl_mulai || null,
      tgl_target: f.tgl_target || null,
      tgl_selesai: f.tgl_selesai || null,
      nilai_rab: Number(f.nilai_rab) || 0,
      kontraktor: f.kontraktor || null,
      catatan: f.catatan || null,
    };
    const { error } = unit.id ? await supabase.from('teknik_units').update(row).eq('id', unit.id) : await supabase.from('teknik_units').insert(row);
    setBusy(false);
    if (error) return showToast(error.message.includes('duplicate') ? 'Kode unit sudah dipakai' : 'Gagal: ' + error.message);
    showToast(unit.id ? 'Unit diperbarui' : 'Unit ditambahkan');
    onClose();
    reload();
  }
  async function del() {
    if (!window.confirm(`Hapus unit ${unit.kode} beserta progres, biaya, temuan, dan aset perawatannya?`)) return;
    const { error } = await supabase.from('teknik_units').delete().eq('id', unit.id);
    if (error) return showToast('Gagal: ' + error.message);
    showToast('Unit dihapus');
    onClose();
    reload();
  }
  return (
    <Modal onClose={onClose}>
      <h3>{unit.id ? `Ubah unit ${unit.kode}` : 'Tambah unit'}</h3>
      <div className="field-row">
        <div className="field"><label>Kode unit</label><input value={f.kode} onChange={set('kode')} placeholder="A5" /></div>
        <div className="field"><label>Tipe</label><input value={f.tipe || ''} onChange={set('tipe')} placeholder="Family Suite" /></div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Status</label>
          <select value={f.status} onChange={set('status')}>
            {Object.entries(STATUS_UNIT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="field"><label>Kontraktor / mandor</label><input value={f.kontraktor || ''} onChange={set('kontraktor')} /></div>
      </div>
      <div className="field-row">
        <div className="field"><label>Mulai bangun</label><input type="date" value={f.tgl_mulai || ''} onChange={set('tgl_mulai')} /></div>
        <div className="field"><label>Target selesai</label><input type="date" value={f.tgl_target || ''} onChange={set('tgl_target')} /></div>
      </div>
      <div className="field-row">
        <div className="field"><label>Nilai RAB / kontrak (Rp)</label><input type="number" min="0" step="1000000" value={f.nilai_rab} onChange={set('nilai_rab')} /></div>
        <div className="field"><label>Tanggal selesai aktual</label><input type="date" value={f.tgl_selesai || ''} onChange={set('tgl_selesai')} /></div>
      </div>
      <div className="field-hint">{rpFull(f.nilai_rab)}</div>
      <div className="field"><label>Catatan</label><textarea value={f.catatan || ''} onChange={set('catatan')} /></div>
      <div className="modal-actions">
        {unit.id && isAdmin && <button className={`btn btn-ghost ${s.danger}`} onClick={del}>Hapus</button>}
        <button className="btn btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Menyimpan...' : 'Simpan unit'}</button>
      </div>
    </Modal>
  );
}

function BulkUnitForm({ existing, onClose, reload, showToast }) {
  const [f, setF] = useState({ kavling: 'A', dari: 1, sampai: 13, tipe: '', status: 'perencanaan', nilai_rab: DEFAULT_RAB });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const kav = String(f.kavling || '').trim().toUpperCase();
  const kodes = [];
  for (let i = Number(f.dari) || 0; i <= (Number(f.sampai) || 0) && kodes.length < 200; i++) kodes.push(kav + i);
  const have = new Set(existing.map((u) => u.kode));
  const baru = kodes.filter((k) => !have.has(k));
  async function save() {
    if (!kav || !baru.length) return showToast('Tidak ada unit baru untuk dibuat');
    setBusy(true);
    const rows = baru.map((kode) => ({ kode, kavling: kav, tipe: f.tipe || null, status: f.status, nilai_rab: Number(f.nilai_rab) || 0 }));
    const { error } = await supabase.from('teknik_units').insert(rows);
    setBusy(false);
    if (error) return showToast('Gagal: ' + error.message);
    showToast(`${rows.length} unit ditambahkan`);
    onClose();
    reload();
  }
  return (
    <Modal onClose={onClose}>
      <h3>Tambah banyak unit</h3>
      <div className="field-row">
        <div className="field"><label>Kavling</label><input value={f.kavling} onChange={set('kavling')} maxLength={3} /></div>
        <div className="field"><label>Tipe (opsional)</label><input value={f.tipe} onChange={set('tipe')} /></div>
      </div>
      <div className="field-row">
        <div className="field"><label>Dari nomor</label><input type="number" min="1" value={f.dari} onChange={set('dari')} /></div>
        <div className="field"><label>Sampai nomor</label><input type="number" min="1" value={f.sampai} onChange={set('sampai')} /></div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Status awal</label>
          <select value={f.status} onChange={set('status')}>
            {Object.entries(STATUS_UNIT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="field"><label>Nilai RAB per unit (Rp)</label><input type="number" min="0" step="1000000" value={f.nilai_rab} onChange={set('nilai_rab')} /></div>
      </div>
      <div className="field-hint">
        Akan dibuat {baru.length} unit{baru.length ? `: ${baru.slice(0, 8).join(', ')}${baru.length > 8 ? ', …' : ''}` : ''}.
        {kodes.length - baru.length > 0 && ` ${kodes.length - baru.length} kode sudah ada dan dilewati.`} Tanggal mulai dan target diisi per unit setelahnya.
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" disabled={busy || !baru.length} onClick={save}>{busy ? 'Menyimpan...' : `Buat ${baru.length} unit`}</button>
      </div>
    </Modal>
  );
}

function KurvaS({ unit, logs, total }) {
  if (!unit.tgl_mulai || !unit.tgl_target) {
    return <div className={s.curveEmpty}>Isi tanggal mulai dan target selesai untuk menampilkan kurva S.</div>;
  }
  const W = 640;
  const H = 210;
  const P = { l: 34, r: 12, t: 12, b: 26 };
  const lastLog = logs.length ? logs[logs.length - 1].tanggal : unit.tgl_mulai;
  const endStr = [unit.tgl_target, today(), lastLog].sort().pop();
  const span = Math.max(1, dayDiff(unit.tgl_mulai, endStr));
  const x = (dstr) => P.l + (clamp(dayDiff(unit.tgl_mulai, dstr), 0, span) / span) * (W - P.l - P.r);
  const y = (v) => H - P.b - (clamp(v, 0, 100) / 100) * (H - P.t - P.b);
  const planPts = [];
  for (let i = 0; i <= 48; i++) {
    const dstr = addDays(unit.tgl_mulai, Math.round((dayDiff(unit.tgl_mulai, unit.tgl_target) * i) / 48));
    planPts.push(`${x(dstr).toFixed(1)},${y(rencana(unit, dstr)).toFixed(1)}`);
  }
  if (endStr > unit.tgl_target) planPts.push(`${x(endStr).toFixed(1)},${y(100).toFixed(1)}`);
  const act = [{ tanggal: unit.tgl_mulai, total: 0 }, ...logs.filter((l) => l.tanggal >= unit.tgl_mulai)];
  if (!logs.find((l) => l.tanggal === today()) && today() >= unit.tgl_mulai) act.push({ tanggal: today(), total });
  const actPts = act.map((l) => `${x(l.tanggal).toFixed(1)},${y(Number(l.total)).toFixed(1)}`).join(' ');
  const ticks = [0, 25, 50, 75, 100];
  return (
    <div className={s.curveWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={s.curve} role="img" aria-label="Kurva S rencana dan realisasi">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className={s.cGrid} />
            <text x={P.l - 6} y={y(t) + 3} className={s.cAxis} textAnchor="end">{t}</text>
          </g>
        ))}
        <text x={P.l} y={H - 8} className={s.cAxis}>{tgl(unit.tgl_mulai)}</text>
        <text x={W - P.r} y={H - 8} className={s.cAxis} textAnchor="end">{tgl(endStr)}</text>
        <line x1={x(today())} x2={x(today())} y1={P.t} y2={H - P.b} className={s.cToday} />
        <polyline points={planPts.join(' ')} className={s.cPlan} />
        <polyline points={actPts} className={s.cAct} />
        {act.slice(1).map((l) => <circle key={l.tanggal} cx={x(l.tanggal)} cy={y(Number(l.total))} r="3" className={s.cDot} />)}
      </svg>
      <div className={s.legend}>
        <span><i className={s.lgPlan} />Rencana</span>
        <span><i className={s.lgAct} />Realisasi</span>
        <span><i className={s.lgToday} />Hari ini</span>
      </div>
    </div>
  );
}

function UnitDetail({ unit, d, isTeknik, isAdmin, user, progMap, unitStats, reload, showToast, onClose }) {
  const st = unitStats[unit.id];
  const [vals, setVals] = useState(() => {
    const m = progMap[unit.id] || {};
    const o = {};
    TAHAPAN.forEach((t) => (o[t.no] = Number(m[t.no]) || 0));
    return o;
  });
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const total = totalProgres(vals);
  const dirty = TAHAPAN.some((t) => (Number((progMap[unit.id] || {})[t.no]) || 0) !== Number(vals[t.no]));
  const logs = d.logs.filter((l) => l.unit_id === unit.id).sort((a, b) => (a.tanggal < b.tanggal ? -1 : 1));
  const biayaTahap = {};
  d.biaya.filter((b) => b.unit_id === unit.id).forEach((b) => (biayaTahap[b.tahap || 0] = (biayaTahap[b.tahap || 0] || 0) + Number(b.jumlah || 0)));
  const temuanOpen = d.temuan.filter((q) => q.unit_id === unit.id && q.status !== 'terverifikasi').length;
  const tiketOpen = d.tiket.filter((t) => t.unit_id === unit.id && t.status !== 'selesai').length;
  const rab = Number(unit.nilai_rab || 0);

  async function save() {
    setBusy(true);
    const now = new Date().toISOString();
    const rows = TAHAPAN.map((t) => ({ unit_id: unit.id, tahap: t.no, persen: clamp(Number(vals[t.no]) || 0, 0, 100), updated_by: user.id, updated_at: now }));
    const r1 = await supabase.from('teknik_progress').upsert(rows, { onConflict: 'unit_id,tahap' });
    const r2 = r1.error ? r1 : await supabase.from('teknik_progress_log').upsert({ unit_id: unit.id, tanggal: today(), total: Math.round(total * 100) / 100 }, { onConflict: 'unit_id,tanggal' });
    let r3 = { error: null };
    if (!r2.error && unit.status === 'perencanaan' && total > 0) r3 = await supabase.from('teknik_units').update({ status: 'konstruksi', tgl_mulai: unit.tgl_mulai || today() }).eq('id', unit.id);
    setBusy(false);
    const e = r1.error || r2.error || r3.error;
    if (e) return showToast('Gagal: ' + e.message);
    showToast('Progres tersimpan');
    reload();
  }

  return (
    <Sheet
      title={`Unit ${unit.kode}`}
      sub={[STATUS_UNIT[unit.status]?.label, unit.tipe, unit.kontraktor && 'Kontraktor: ' + unit.kontraktor].filter(Boolean).join(' / ')}
      onClose={onClose}
    >
      <div className={s.statRow}>
        <div><div className="kpi-label">Progres fisik</div><div className={s.statBig}>{pct(total, 1)}</div></div>
        <div><div className="kpi-label">Rencana hari ini</div><div className={s.statBig}>{st.plan == null ? '—' : pct(st.plan, 1)}</div></div>
        <div><div className="kpi-label">Deviasi</div><div className={`${s.statBig} ${st.plan != null && total - st.plan < -5 ? s.neg : ''}`}>{st.plan == null ? '—' : (total - st.plan >= 0 ? '+' : '') + pct(total - st.plan, 1)}</div></div>
        <div><div className="kpi-label">Target selesai</div><div className={s.statBig}>{tgl(unit.tgl_target)}</div></div>
        <div><div className="kpi-label">QC / tiket terbuka</div><div className={s.statBig}>{temuanOpen} / {tiketOpen}</div></div>
      </div>

      <KurvaS unit={unit} logs={logs} total={total} />

      <div className={s.panelHead}>
        <h3 className={s.h3}>Progres per tahapan</h3>
        {isTeknik && <button className="btn btn-ghost btn-sm" onClick={() => setEdit(true)}>Ubah data unit</button>}
      </div>
      <div className={`table-wrap ${s.stageWrap}`}>
        <table className={s.stageTable}>
          <thead>
            <tr>
              <th>Tahapan</th><th>Bobot</th><th className={s.colWide}>Progres tahap</th><th>Kontribusi</th>
              {isTeknik && <th>Realisasi / anggaran</th>}
            </tr>
          </thead>
          <tbody>
            {TAHAPAN.map((t) => {
              const v = Number(vals[t.no]) || 0;
              const ang = t.bobot * rab;
              const real = biayaTahap[t.no] || 0;
              return (
                <tr key={t.no}>
                  <td className="cell-strong">{t.no}. {t.nama}</td>
                  <td className={s.stBobot}>{pct(t.bobot * 100, 1)}</td>
                  <td className={s.stSlider}>
                    {isTeknik ? (
                      <div className={s.slider}>
                        <input type="range" min="0" max="100" step="5" value={v} onChange={(e) => setVals({ ...vals, [t.no]: Number(e.target.value) })} aria-label={'Progres ' + t.nama} />
                        <input type="number" min="0" max="100" value={v} onChange={(e) => setVals({ ...vals, [t.no]: clamp(Number(e.target.value) || 0, 0, 100) })} className={s.numIn} />
                      </div>
                    ) : (
                      <div className={s.progCell}><Bar value={v} tone={v >= 100 ? 'done' : 'ok'} /><span className={s.progNum}>{pct(v)}</span></div>
                    )}
                  </td>
                  <td className={s.stKontrib}>{pct(t.bobot * v, 2)} dari total</td>
                  {isTeknik && (
                    <td className={`${s.stBudget} ${real > ang && ang > 0 ? s.neg : ''}`}>
                      {rp(real)} / {rp(ang)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {isTeknik && (
        <div className={s.stickyAct}>
          <span className={s.muted}>{dirty ? `Total baru ${pct(total, 2)} — belum disimpan` : 'Geser nilai per tahapan, lalu simpan.'}</span>
          <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Menyimpan...' : 'Simpan progres'}</button>
        </div>
      )}
      {unit.catatan && <p className={s.muted}>Catatan: {unit.catatan}</p>}
      {edit && <UnitForm unit={unit} isAdmin={isAdmin} onClose={() => { setEdit(false); }} reload={reload} showToast={showToast} />}
    </Sheet>
  );
}

// ---------------------------------------------------------------------
// LAPORAN LAPANGAN
// ---------------------------------------------------------------------
function Lapangan({ d, user, isTeknik, isAdmin, nameOf, unitKode, reload, showToast, setLightbox }) {
  const [month, setMonth] = useState(ym(new Date()));
  const [unit, setUnit] = useState('');
  const [form, setForm] = useState(false);
  const list = d.laporan.filter((l) => String(l.tanggal).startsWith(month) && (!unit || l.unit_id === unit));
  const byDate = {};
  list.forEach((l) => (byDate[l.tanggal] = byDate[l.tanggal] || []).push(l));
  const dates = Object.keys(byDate).sort().reverse();
  const hariOrang = list.reduce((a, l) => a + (Number(l.jumlah_tukang) || 0), 0);
  const hariHujan = new Set(list.filter((l) => /hujan/i.test(l.cuaca || '')).map((l) => l.tanggal)).size;
  const kendala = list.filter((l) => (l.kendala || '').trim()).length;

  async function del(l) {
    if (!window.confirm('Hapus laporan ini?')) return;
    const { error } = await supabase.from('teknik_laporan').delete().eq('id', l.id);
    if (error) return showToast('Gagal: ' + error.message);
    if (l.foto?.length) await supabase.storage.from('teknik').remove(l.foto);
    showToast('Laporan dihapus');
    reload();
  }

  return (
    <div>
      <div className={s.toolbar}>
        <div className={s.btnRow}>
          <input type="month" className={s.inputSm} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <select className={s.inputSm} value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">Semua unit</option>
            {d.units.map((u) => <option key={u.id} value={u.id}>{u.kode}</option>)}
          </select>
        </div>
        {isTeknik && <button className="btn btn-primary" onClick={() => setForm(true)}>Isi laporan hari ini</button>}
      </div>

      <div className={`kpi-grid ${s.kpis}`}>
        <div className="kpi-card"><div className="kpi-label">Laporan {monthName(month)}</div><div className="kpi-value">{list.length}</div></div>
        <div className="kpi-card"><div className="kpi-label">Hari-orang tukang</div><div className="kpi-value">{num(hariOrang)}</div></div>
        <div className="kpi-card"><div className="kpi-label">Hari hujan tercatat</div><div className="kpi-value">{hariHujan}</div><div className={s.kpiSub}>Bukti sah bila ada klaim perpanjangan waktu</div></div>
        <div className="kpi-card"><div className="kpi-label">Laporan dengan kendala</div><div className="kpi-value">{kendala}</div></div>
      </div>

      {!dates.length ? (
        <div className="table-wrap"><Empty title="Belum ada laporan di periode ini">Pengawas mengisi satu laporan per unit setiap hari kerja: pekerjaan, jumlah tukang, cuaca, kendala, dan foto.</Empty></div>
      ) : (
        dates.map((dt) => (
          <div key={dt} className={s.dayGroup}>
            <div className={s.dayHead}>{toDate(dt).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            {byDate[dt].map((l) => (
              <article key={l.id} className={s.report}>
                <div className={s.reportHead}>
                  <span className="cell-strong">{unitKode(l.unit_id)}</span>
                  <span className={s.muted}>{nameOf(l.pelapor)}</span>
                  {l.cuaca && <span className="badge badge-grey">{l.cuaca}</span>}
                  <span className="badge badge-grey">{l.jumlah_tukang || 0} tukang</span>
                  {(l.pelapor === user.id || isAdmin) && <button className={`${s.linkBtn} ${s.right}`} onClick={() => del(l)}>Hapus</button>}
                </div>
                {l.pekerjaan && <p className={s.para}>{l.pekerjaan}</p>}
                {l.kendala && <p className={`${s.para} ${s.kendala}`}>Kendala: {l.kendala}</p>}
                {l.rencana_besok && <p className={`${s.para} ${s.muted}`}>Rencana besok: {l.rencana_besok}</p>}
                <Fotos paths={l.foto} onOpen={setLightbox} />
              </article>
            ))}
          </div>
        ))
      )}
      {form && <LaporanForm d={d} onClose={() => setForm(false)} reload={reload} showToast={showToast} />}
    </div>
  );
}

function LaporanForm({ d, onClose, reload, showToast }) {
  const aktif = d.units.filter((u) => ['konstruksi', 'finishing', 'perencanaan'].includes(u.status));
  const [f, setF] = useState({ tanggal: today(), unit_id: aktif[0]?.id || '', cuaca: 'Cerah', jumlah_tukang: 0, pekerjaan: '', kendala: '', rencana_besok: '' });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() {
    if (!f.pekerjaan.trim()) return showToast('Isi pekerjaan yang dikerjakan hari ini');
    if (f.tanggal > today()) return showToast('Tanggal tidak boleh di masa depan');
    setBusy(true);
    try {
      const foto = await uploadFotos(files, 'laporan/' + f.tanggal);
      const { error } = await supabase.from('teknik_laporan').insert({ ...f, unit_id: f.unit_id || null, jumlah_tukang: Number(f.jumlah_tukang) || 0, foto });
      if (error) throw error;
      showToast('Laporan terkirim');
      onClose();
      reload();
    } catch (e) {
      showToast('Gagal: ' + e.message);
    }
    setBusy(false);
  }
  return (
    <Modal onClose={onClose}>
      <h3>Laporan harian lapangan</h3>
      <div className="field-row">
        <div className="field"><label>Tanggal</label><input type="date" max={today()} value={f.tanggal} onChange={set('tanggal')} /></div>
        <div className="field">
          <label>Unit</label>
          <select value={f.unit_id} onChange={set('unit_id')}>
            <option value="">Umum / fasilitas</option>
            {d.units.map((u) => <option key={u.id} value={u.id}>{u.kode}</option>)}
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Cuaca</label>
          <select value={f.cuaca} onChange={set('cuaca')}>{CUACA.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        <div className="field"><label>Jumlah tukang</label><input type="number" min="0" value={f.jumlah_tukang} onChange={set('jumlah_tukang')} /></div>
      </div>
      <div className="field"><label>Pekerjaan hari ini</label><textarea value={f.pekerjaan} onChange={set('pekerjaan')} placeholder="Pengecoran plat lantai 2, pemasangan bata ringan lantai 1 sisi timur..." /></div>
      <div className="field"><label>Kendala (kosongkan bila tidak ada)</label><textarea value={f.kendala} onChange={set('kendala')} placeholder="Material besi terlambat datang, hujan mulai jam 13.00..." /></div>
      <div className="field"><label>Rencana besok</label><input value={f.rencana_besok} onChange={set('rencana_besok')} /></div>
      <PhotoPicker files={files} setFiles={setFiles} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Mengirim...' : 'Kirim laporan'}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// ANGGARAN & BIAYA
// ---------------------------------------------------------------------
function Anggaran({ d, user, isAdmin, unitStats, unitKode, nameOf, reload, showToast, setLightbox }) {
  const [sel, setSel] = useState('');
  const [month, setMonth] = useState('');
  const [form, setForm] = useState(false);
  const units = [...d.units].sort((a, b) => a.kode.localeCompare(b.kode, 'id', { numeric: true }));
  const totRab = units.reduce((a, u) => a + Number(u.nilai_rab || 0), 0);
  const totAc = units.reduce((a, u) => a + unitStats[u.id].ac, 0);
  const totEv = units.reduce((a, u) => a + unitStats[u.id].ev, 0);
  const tanpaUnit = d.biaya.filter((b) => !b.unit_id).reduce((a, b) => a + Number(b.jumlah || 0), 0);
  const entries = d.biaya.filter((b) => (!sel || b.unit_id === sel) && (!month || String(b.tanggal).startsWith(month)));
  const selUnit = d.units.find((u) => u.id === sel);

  async function del(b) {
    if (!window.confirm(`Hapus catatan biaya "${b.uraian}"?`)) return;
    const { error } = await supabase.from('teknik_biaya').delete().eq('id', b.id);
    if (error) return showToast('Gagal: ' + error.message);
    if (b.bukti) await supabase.storage.from('teknik').remove([b.bukti]);
    showToast('Catatan biaya dihapus');
    reload();
  }

  return (
    <div>
      <div className={`kpi-grid ${s.kpis}`}>
        <div className="kpi-card"><div className="kpi-label">Total nilai RAB</div><div className="kpi-value">{rp(totRab)}</div><div className={s.kpiSub}>{units.length} unit</div></div>
        <div className="kpi-card"><div className="kpi-label">Realisasi biaya</div><div className="kpi-value accent">{rp(totAc + tanpaUnit)}</div><div className={s.kpiSub}>Serapan {pct(totRab ? ((totAc + tanpaUnit) / totRab) * 100 : 0, 1)}</div></div>
        <div className="kpi-card"><div className="kpi-label">Nilai fisik terpasang</div><div className="kpi-value">{rp(totEv)}</div><div className={s.kpiSub}>RAB × progres fisik</div></div>
        <div className="kpi-card"><div className="kpi-label">Indeks biaya (CPI)</div><div className="kpi-value gold">{totAc ? (totEv / totAc).toFixed(2) : '—'}</div><div className={s.kpiSub}>&lt;1 berarti biaya lebih cepat dari fisik</div></div>
      </div>

      <div className={`table-wrap ${s.block}`}>
        <table>
          <thead>
            <tr><th>Unit</th><th>Nilai RAB</th><th>Realisasi</th><th>Serapan</th><th>Progres fisik</th><th>Nilai fisik</th><th>CPI</th></tr>
          </thead>
          <tbody>
            {!units.length && <tr><td colSpan={7} className="panel-empty">Belum ada unit.</td></tr>}
            {units.map((u) => {
              const st = unitStats[u.id];
              const rab = Number(u.nilai_rab || 0);
              const serap = rab ? (st.ac / rab) * 100 : 0;
              return (
                <tr key={u.id} className={`${s.rowClick} ${sel === u.id ? s.rowOn : ''}`} onClick={() => setSel(sel === u.id ? '' : u.id)}>
                  <td className="cell-strong">{u.kode}</td>
                  <td>{rp(rab)}</td>
                  <td>{rp(st.ac)}</td>
                  <td className={serap > st.total + 10 ? s.neg : ''}>{pct(serap, 1)}</td>
                  <td>{pct(st.total, 1)}</td>
                  <td>{rp(st.ev)}</td>
                  <td>{st.cpi == null ? '—' : <span className={`badge ${st.cpi >= 1 ? 'badge-green' : st.cpi >= 0.9 ? 'badge-gold' : 'badge-red'}`}>{st.cpi.toFixed(2)}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={s.hint}>Ketuk baris unit untuk melihat rincian per tahapan dan menyaring catatan biaya. Serapan merah = biaya keluar jauh lebih cepat dari progres fisik.</div>

      {selUnit && (
        <div className={`panel ${s.block}`}>
          <h3>Rincian {selUnit.kode} per tahapan</h3>
          <div className={s.budgetList}>
            {TAHAPAN.map((t) => {
              const ang = t.bobot * Number(selUnit.nilai_rab || 0);
              const real = d.biaya.filter((b) => b.unit_id === selUnit.id && b.tahap === t.no).reduce((a, b) => a + Number(b.jumlah || 0), 0);
              const p = ang ? (real / ang) * 100 : 0;
              return (
                <div key={t.no} className={s.budgetRow}>
                  <div className={s.budgetName}>{t.no}. {t.nama}</div>
                  <Bar value={p} tone={p > 100 ? 'crit' : p > 90 ? 'warn' : 'ok'} />
                  <div className={s.budgetNum}>{rp(real)} / {rp(ang)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={s.toolbar}>
        <div className={s.btnRow}>
          <h3 className={s.h3}>Catatan biaya{selUnit ? ` — ${selUnit.kode}` : ''}</h3>
          <input type="month" className={s.inputSm} value={month} onChange={(e) => setMonth(e.target.value)} />
          {month && <button className={s.linkBtn} onClick={() => setMonth('')}>Semua bulan</button>}
        </div>
        <button className="btn btn-primary" onClick={() => setForm(true)}>Catat biaya</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Tanggal</th><th>Unit</th><th>Tahapan</th><th>Uraian</th><th>Vendor</th><th>Jumlah</th><th /></tr></thead>
          <tbody>
            {!entries.length && <tr><td colSpan={7} className="panel-empty">Belum ada catatan biaya.</td></tr>}
            {entries.slice(0, 300).map((b) => (
              <tr key={b.id}>
                <td>{tgl(b.tanggal, false)}</td>
                <td>{unitKode(b.unit_id)}</td>
                <td className="cell-soft">{b.tahap ? TAHAPAN[b.tahap - 1].nama : '—'}</td>
                <td>
                  <div>{b.uraian}</div>
                  <div className="cell-soft">{nameOf(b.dicatat_oleh)}</div>
                </td>
                <td className="cell-soft">{b.vendor || '—'}</td>
                <td className="cell-strong">{rpFull(b.jumlah)}</td>
                <td>
                  <div className="row-actions">
                    {b.bukti && <button className={s.linkBtn} onClick={() => setLightbox(fotoUrl(b.bukti))}>Nota</button>}
                    {(b.dicatat_oleh === user.id || isAdmin) && <button className={s.linkBtn} onClick={() => del(b)}>Hapus</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <BiayaForm d={d} preset={sel} onClose={() => setForm(false)} reload={reload} showToast={showToast} />}
    </div>
  );
}

function BiayaForm({ d, preset, onClose, reload, showToast }) {
  const [f, setF] = useState({ tanggal: today(), unit_id: preset || '', tahap: '', uraian: '', vendor: '', jumlah: '' });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() {
    if (!f.uraian.trim() || !(Number(f.jumlah) > 0)) return showToast('Isi uraian dan jumlah biaya');
    setBusy(true);
    try {
      const [bukti] = await uploadFotos(files, 'nota/' + f.tanggal.slice(0, 7));
      const { error } = await supabase.from('teknik_biaya').insert({
        tanggal: f.tanggal, unit_id: f.unit_id || null, tahap: f.tahap ? Number(f.tahap) : null, uraian: f.uraian.trim(), vendor: f.vendor || null, jumlah: Number(f.jumlah), bukti: bukti || null,
      });
      if (error) throw error;
      showToast('Biaya tercatat');
      onClose();
      reload();
    } catch (e) {
      showToast('Gagal: ' + e.message);
    }
    setBusy(false);
  }
  return (
    <Modal onClose={onClose}>
      <h3>Catat biaya</h3>
      <div className="field-row">
        <div className="field"><label>Tanggal</label><input type="date" value={f.tanggal} onChange={set('tanggal')} /></div>
        <div className="field">
          <label>Unit</label>
          <select value={f.unit_id} onChange={set('unit_id')}>
            <option value="">Umum (tanpa unit)</option>
            {d.units.map((u) => <option key={u.id} value={u.id}>{u.kode}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Tahapan RAB</label>
        <select value={f.tahap} onChange={set('tahap')}>
          <option value="">Tidak spesifik</option>
          {TAHAPAN.map((t) => <option key={t.no} value={t.no}>{t.no}. {t.nama}</option>)}
        </select>
      </div>
      <div className="field"><label>Uraian</label><input value={f.uraian} onChange={set('uraian')} placeholder="Semen 40 sak, upah mingguan tukang..." /></div>
      <div className="field-row">
        <div className="field"><label>Vendor / penerima</label><input value={f.vendor} onChange={set('vendor')} /></div>
        <div className="field"><label>Jumlah (Rp)</label><input type="number" min="0" step="1000" value={f.jumlah} onChange={set('jumlah')} /></div>
      </div>
      <div className="field-hint">{rpFull(f.jumlah)}</div>
      <PhotoPicker files={files} setFiles={setFiles} max={1} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Menyimpan...' : 'Simpan biaya'}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// QC & SERAH TERIMA
// ---------------------------------------------------------------------
function QC({ d, user, isTeknik, team, nameOf, unitKode, unitStats, reload, showToast, setLightbox }) {
  const [filter, setFilter] = useState('aktif');
  const [unit, setUnit] = useState('');
  const [form, setForm] = useState(false);
  const chips = [['aktif', 'Belum tuntas'], ['terbuka', 'Terbuka'], ['diperbaiki', 'Menunggu verifikasi'], ['terverifikasi', 'Terverifikasi'], ['semua', 'Semua']];
  const list = d.temuan
    .filter((q) => (!unit || q.unit_id === unit) && (filter === 'semua' || (filter === 'aktif' ? q.status !== 'terverifikasi' : q.status === filter)))
    .sort((a, b) => ({ kritis: 0, mayor: 1, minor: 2 }[a.tingkat] - { kritis: 0, mayor: 1, minor: 2 }[b.tingkat]) || (a.created_at < b.created_at ? 1 : -1));
  const kandidat = d.units
    .filter((u) => ['finishing', 'serah_terima'].includes(u.status) || unitStats[u.id].total >= 90)
    .sort((a, b) => a.kode.localeCompare(b.kode, 'id', { numeric: true }));

  async function setStatus(q, status) {
    const patch = { status, selesai_at: status === 'terverifikasi' ? new Date().toISOString() : null };
    const { error } = await supabase.from('teknik_temuan').update(patch).eq('id', q.id);
    if (error) return showToast('Gagal: ' + error.message);
    showToast(status === 'terverifikasi' ? 'Temuan diverifikasi' : status === 'diperbaiki' ? 'Ditandai sudah diperbaiki' : 'Dikembalikan ke terbuka');
    if (status === 'terbuka' && q.pic) notify('temuan_tugas', q.id);
    reload();
  }

  return (
    <div>
      {kandidat.length > 0 && (
        <div className={`panel ${s.block}`}>
          <h3>Kesiapan serah terima</h3>
          <div className={s.readyGrid}>
            {kandidat.map((u) => {
              const open = d.temuan.filter((q) => q.unit_id === u.id && q.status !== 'terverifikasi');
              const siap = unitStats[u.id].total >= 99.95 && !open.length;
              return (
                <div key={u.id} className={`${s.readyCard} ${siap ? s.readyOk : ''}`}>
                  <div className="cell-strong">{u.kode}</div>
                  <div className={s.muted}>Fisik {pct(unitStats[u.id].total, 1)} · {open.length} temuan terbuka{open.some((q) => q.tingkat === 'kritis') ? ' (ada kritis)' : ''}</div>
                  <span className={`badge ${siap ? 'badge-green' : 'badge-gold'}`}>{siap ? 'Siap serah terima' : 'Belum siap'}</span>
                </div>
              );
            })}
          </div>
          <div className={s.hint}>Unit siap diserahterimakan bila progres fisik 100% dan seluruh temuan QC sudah diverifikasi.</div>
        </div>
      )}

      <div className={s.toolbar}>
        <div className={s.btnRow}>
          <div className={s.chips}>
            {chips.map(([k, l]) => <button key={k} className={`${s.chip} ${filter === k ? s.chipOn : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
          </div>
          <select className={s.inputSm} value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">Semua unit</option>
            {d.units.map((u) => <option key={u.id} value={u.id}>{u.kode}</option>)}
          </select>
        </div>
        {isTeknik && <button className="btn btn-primary" onClick={() => setForm(true)}>Catat temuan</button>}
      </div>

      {!list.length ? (
        <div className="table-wrap"><Empty title="Tidak ada temuan">Catat setiap cacat mutu saat inspeksi: retak, rembes, kemiringan lantai, cat belang, dan sejenisnya.</Empty></div>
      ) : (
        <div className={s.cards}>
          {list.map((q) => {
            const telat = q.status === 'terbuka' && q.tenggat && q.tenggat < today();
            return (
              <article key={q.id} className={`${s.card} ${s['edge_' + q.tingkat]}`}>
                <div className={s.reportHead}>
                  <span className="cell-strong">{unitKode(q.unit_id)}</span>
                  {q.lokasi && <span className={s.muted}>{q.lokasi}</span>}
                  <span className={`badge ${TINGKAT[q.tingkat].cls}`}>{TINGKAT[q.tingkat].label}</span>
                  <span className={`badge ${STATUS_TEMUAN[q.status].cls}`}>{STATUS_TEMUAN[q.status].label}</span>
                </div>
                <p className={s.para}>{q.deskripsi}</p>
                <div className={s.meta}>
                  {q.tahap && <span>{TAHAPAN[q.tahap - 1].nama}</span>}
                  <span>PIC {nameOf(q.pic)}</span>
                  {q.tenggat && <span className={telat ? s.neg : ''}>Tenggat {tgl(q.tenggat, false)}{telat ? ' (lewat)' : ''}</span>}
                  <span>Dicatat {nameOf(q.dibuat_oleh)}, {tgl(q.created_at, false)}</span>
                </div>
                <Fotos paths={q.foto} onOpen={setLightbox} />
                {isTeknik && q.status !== 'terverifikasi' && (
                  <div className={s.btnRow}>
                    {q.status === 'terbuka' && <button className="btn btn-ghost btn-sm" onClick={() => setStatus(q, 'diperbaiki')}>Tandai sudah diperbaiki</button>}
                    {q.status === 'diperbaiki' && (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={() => setStatus(q, 'terverifikasi')}>Verifikasi</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setStatus(q, 'terbuka')}>Belum beres, kembalikan</button>
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {form && <TemuanForm d={d} team={team} user={user} onClose={() => setForm(false)} reload={reload} showToast={showToast} />}
    </div>
  );
}

function TemuanForm({ d, team, onClose, reload, showToast }) {
  const [f, setF] = useState({ unit_id: '', tahap: '', lokasi: '', deskripsi: '', tingkat: 'minor', pic: '', tenggat: addDays(today(), 7) });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() {
    if (!f.deskripsi.trim()) return showToast('Jelaskan temuannya');
    setBusy(true);
    try {
      const foto = await uploadFotos(files, 'qc');
      const { data, error } = await supabase
        .from('teknik_temuan')
        .insert({ unit_id: f.unit_id || null, tahap: f.tahap ? Number(f.tahap) : null, lokasi: f.lokasi || null, deskripsi: f.deskripsi.trim(), tingkat: f.tingkat, pic: f.pic || null, tenggat: f.tenggat || null, foto })
        .select('id')
        .single();
      if (error) throw error;
      if (f.tingkat === 'kritis') notify('temuan_kritis', data.id);
      if (f.pic) notify('temuan_tugas', data.id);
      showToast('Temuan tercatat');
      onClose();
      reload();
    } catch (e) {
      showToast('Gagal: ' + e.message);
    }
    setBusy(false);
  }
  return (
    <Modal onClose={onClose}>
      <h3>Catat temuan QC</h3>
      <div className="field-row">
        <div className="field">
          <label>Unit</label>
          <select value={f.unit_id} onChange={set('unit_id')}>
            <option value="">Fasilitas umum</option>
            {d.units.map((u) => <option key={u.id} value={u.id}>{u.kode}</option>)}
          </select>
        </div>
        <div className="field"><label>Lokasi</label><input value={f.lokasi} onChange={set('lokasi')} placeholder="KM lantai 2" /></div>
      </div>
      <div className="field"><label>Deskripsi temuan</label><textarea value={f.deskripsi} onChange={set('deskripsi')} placeholder="Rembes di sambungan pipa shower, keramik kopong 3 titik..." /></div>
      <div className="field-row">
        <div className="field">
          <label>Tingkat</label>
          <select value={f.tingkat} onChange={set('tingkat')}>
            <option value="minor">Minor — estetika</option>
            <option value="mayor">Mayor — fungsi terganggu</option>
            <option value="kritis">Kritis — struktur / keselamatan</option>
          </select>
        </div>
        <div className="field">
          <label>Tahapan</label>
          <select value={f.tahap} onChange={set('tahap')}>
            <option value="">—</option>
            {TAHAPAN.map((t) => <option key={t.no} value={t.no}>{t.nama}</option>)}
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>PIC perbaikan</label>
          <select value={f.pic} onChange={set('pic')}>
            <option value="">Belum ditentukan</option>
            {team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Tenggat</label><input type="date" value={f.tenggat} onChange={set('tenggat')} /></div>
      </div>
      <PhotoPicker files={files} setFiles={setFiles} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Menyimpan...' : 'Simpan temuan'}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// PERAWATAN: TIKET + PREVENTIF
// ---------------------------------------------------------------------
function Perawatan(props) {
  const [mode, setMode] = useState('tiket');
  return (
    <div>
      <div className={s.chips}>
        <button className={`${s.chip} ${mode === 'tiket' ? s.chipOn : ''}`} onClick={() => setMode('tiket')}>Tiket keluhan</button>
        <button className={`${s.chip} ${mode === 'preventif' ? s.chipOn : ''}`} onClick={() => setMode('preventif')}>Perawatan terjadwal</button>
      </div>
      <div className={s.gap} />
      {mode === 'tiket' ? <Tiket {...props} /> : <Preventif {...props} />}
    </div>
  );
}

function Tiket({ d, user, isTeknik, team, nameOf, unitKode, reload, showToast, setLightbox }) {
  const [filter, setFilter] = useState('aktif');
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, []);
  const month = ym(new Date());
  const aktif = d.tiket.filter((t) => t.status !== 'selesai');
  const selesaiBulan = d.tiket.filter((t) => t.status === 'selesai' && t.selesai_at && ym(new Date(t.selesai_at)) === month);
  const avgMs = selesaiBulan.length ? selesaiBulan.reduce((a, t) => a + slaInfo(t).used, 0) / selesaiBulan.length : 0;
  const tepat = selesaiBulan.filter((t) => !slaInfo(t).lewat).length;
  const list = (filter === 'aktif' ? aktif : filter === 'selesai' ? d.tiket.filter((t) => t.status === 'selesai') : filter === 'saya' ? d.tiket.filter((t) => t.teknisi === user.id || t.pelapor === user.id) : d.tiket)
    .slice()
    .sort((a, b) => {
      if (a.status === 'selesai' || b.status === 'selesai') return a.status === b.status ? (a.created_at < b.created_at ? 1 : -1) : a.status === 'selesai' ? 1 : -1;
      return PRIORITAS[a.prioritas].rank - PRIORITAS[b.prioritas].rank || slaInfo(a).sisa - slaInfo(b).sisa;
    });
  const current = open && d.tiket.find((t) => t.id === open);

  return (
    <div>
      <div className={`kpi-grid ${s.kpis}`}>
        <div className="kpi-card"><div className="kpi-label">Tiket aktif</div><div className="kpi-value">{aktif.length}</div><div className={s.kpiSub}>{aktif.filter((t) => t.status === 'baru').length} belum ditangani</div></div>
        <div className="kpi-card"><div className="kpi-label">Lewat SLA</div><div className="kpi-value accent">{aktif.filter((t) => slaInfo(t).lewat).length}</div></div>
        <div className="kpi-card"><div className="kpi-label">Rata-rata selesai (bulan ini)</div><div className="kpi-value">{selesaiBulan.length ? durasi(avgMs) : '—'}</div><div className={s.kpiSub}>{selesaiBulan.length} tiket selesai</div></div>
        <div className="kpi-card"><div className="kpi-label">Tepat SLA (bulan ini)</div><div className="kpi-value gold">{selesaiBulan.length ? pct((tepat / selesaiBulan.length) * 100) : '—'}</div></div>
      </div>
      <div className={s.toolbar}>
        <div className={s.chips}>
          {[['aktif', 'Aktif'], ['saya', 'Terkait saya'], ['selesai', 'Selesai'], ['semua', 'Semua']].map(([k, l]) => (
            <button key={k} className={`${s.chip} ${filter === k ? s.chipOn : ''}`} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => setForm(true)}>Laporkan kerusakan</button>
      </div>
      {!list.length ? (
        <div className="table-wrap"><Empty title={filter === 'aktif' ? 'Tidak ada tiket aktif' : 'Belum ada tiket'}>Tim MPV atau marketing bisa melaporkan kerusakan villa di sini. Tim teknik langsung mendapat notifikasi.</Empty></div>
      ) : (
        <div className={s.cards}>
          {list.slice(0, 200).map((t) => {
            const sl = slaInfo(t);
            return (
              <button key={t.id} className={`${s.card} ${s.cardBtn} ${s['edge_' + t.prioritas]}`} onClick={() => setOpen(t.id)}>
                <div className={s.reportHead}>
                  <span className={s.mono}>{tiketNo(t)}</span>
                  <span className="cell-strong">{t.judul}</span>
                  <span className={`badge ${PRIORITAS[t.prioritas].cls} ${s.right}`}>{PRIORITAS[t.prioritas].label}</span>
                </div>
                <div className={s.meta}>
                  <span>{unitKode(t.unit_id)}</span>
                  <span>{t.kategori}</span>
                  <span className={`badge ${STATUS_TIKET[t.status].cls}`}>{STATUS_TIKET[t.status].label}</span>
                  <span>Teknisi {nameOf(t.teknisi)}</span>
                  {t.status === 'selesai' ? (
                    <span className={sl.lewat ? s.neg : s.pos}>Selesai dalam {durasi(sl.used)}{sl.lewat ? ' (lewat SLA)' : ''}</span>
                  ) : (
                    <span className={sl.lewat ? s.neg : sl.sisa < sl.sla * 0.25 ? s.warnTxt : ''}>{sl.lewat ? `Lewat SLA ${durasi(sl.sisa)}` : `Sisa SLA ${durasi(sl.sisa)}`}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
      <div className={s.hint}>SLA penyelesaian: darurat 4 jam, tinggi 24 jam, normal 3 hari, rendah 7 hari, dihitung sejak tiket dibuat.</div>
      {form && <TiketForm d={d} onClose={() => setForm(false)} reload={reload} showToast={showToast} />}
      {current && <TiketDetail t={current} user={user} isTeknik={isTeknik} team={team} nameOf={nameOf} unitKode={unitKode} reload={reload} showToast={showToast} setLightbox={setLightbox} onClose={() => setOpen(null)} />}
    </div>
  );
}

function TiketForm({ d, onClose, reload, showToast }) {
  const [f, setF] = useState({ unit_id: '', kategori: 'Listrik', judul: '', deskripsi: '', prioritas: 'normal' });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() {
    if (!f.judul.trim()) return showToast('Isi judul singkat kerusakan');
    setBusy(true);
    try {
      const foto = await uploadFotos(files, 'tiket');
      const { data, error } = await supabase
        .from('teknik_tiket')
        .insert({ unit_id: f.unit_id || null, kategori: f.kategori, judul: f.judul.trim(), deskripsi: f.deskripsi || null, prioritas: f.prioritas, foto })
        .select('id')
        .single();
      if (error) throw error;
      notify('tiket_baru', data.id);
      showToast('Tiket terkirim ke tim teknik');
      onClose();
      reload();
    } catch (e) {
      showToast('Gagal: ' + e.message);
    }
    setBusy(false);
  }
  return (
    <Modal onClose={onClose}>
      <h3>Laporkan kerusakan</h3>
      <div className="field-row">
        <div className="field">
          <label>Unit</label>
          <select value={f.unit_id} onChange={set('unit_id')}>
            <option value="">Fasilitas umum</option>
            {d.units.map((u) => <option key={u.id} value={u.id}>{u.kode}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Kategori</label>
          <select value={f.kategori} onChange={set('kategori')}>{KATEGORI_TIKET.map((k) => <option key={k}>{k}</option>)}</select>
        </div>
      </div>
      <div className="field"><label>Judul singkat</label><input value={f.judul} onChange={set('judul')} placeholder="AC kamar 2 tidak dingin" /></div>
      <div className="field"><label>Detail</label><textarea value={f.deskripsi} onChange={set('deskripsi')} placeholder="Sejak kapan, apakah ada tamu menginap, sudah dicoba apa..." /></div>
      <div className="field">
        <label>Prioritas</label>
        <select value={f.prioritas} onChange={set('prioritas')}>
          <option value="darurat">Darurat — bahaya / tamu tidak bisa menginap (4 jam)</option>
          <option value="tinggi">Tinggi — mengganggu tamu (24 jam)</option>
          <option value="normal">Normal (3 hari)</option>
          <option value="rendah">Rendah — kosmetik (7 hari)</option>
        </select>
      </div>
      <PhotoPicker files={files} setFiles={setFiles} max={4} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Mengirim...' : 'Kirim tiket'}</button>
      </div>
    </Modal>
  );
}

function TiketDetail({ t, user, isTeknik, team, nameOf, unitKode, reload, showToast, setLightbox, onClose }) {
  const [teknisi, setTeknisi] = useState(t.teknisi || '');
  const [done, setDone] = useState(false);
  const [catatan, setCatatan] = useState(t.catatan_selesai || '');
  const [biaya, setBiaya] = useState(t.biaya || 0);
  const [busy, setBusy] = useState(false);
  const sl = slaInfo(t);
  const bisa = isTeknik || t.teknisi === user.id;

  async function patch(p, msg, ev) {
    setBusy(true);
    const { error } = await supabase.from('teknik_tiket').update(p).eq('id', t.id);
    setBusy(false);
    if (error) return showToast('Gagal: ' + error.message);
    if (ev) notify(ev, t.id);
    showToast(msg);
    reload();
    return true;
  }
  const assign = () => patch({ teknisi: teknisi || null }, 'Teknisi ditugaskan', teknisi ? 'tiket_tugas' : null);
  const mulai = () => patch({ status: 'dikerjakan', mulai_at: t.mulai_at || new Date().toISOString(), teknisi: t.teknisi || user.id }, 'Tiket mulai dikerjakan');
  const tunggu = () => patch({ status: 'menunggu_material' }, 'Status: menunggu material');
  async function selesai() {
    if (!catatan.trim()) return showToast('Tulis apa yang diperbaiki');
    const ok = await patch({ status: 'selesai', selesai_at: new Date().toISOString(), catatan_selesai: catatan.trim(), biaya: Number(biaya) || 0, teknisi: t.teknisi || user.id }, 'Tiket selesai', 'tiket_selesai');
    if (ok) onClose();
  }
  async function bukaLagi() {
    await patch({ status: 'dikerjakan', selesai_at: null }, 'Tiket dibuka kembali');
  }

  return (
    <Modal onClose={onClose}>
      <h3>{tiketNo(t)} · {t.judul}</h3>
      <div className={s.meta}>
        <span className={`badge ${PRIORITAS[t.prioritas].cls}`}>{PRIORITAS[t.prioritas].label}</span>
        <span className={`badge ${STATUS_TIKET[t.status].cls}`}>{STATUS_TIKET[t.status].label}</span>
        <span>{unitKode(t.unit_id)}</span>
        <span>{t.kategori}</span>
      </div>
      {t.deskripsi && <p className={s.para}>{t.deskripsi}</p>}
      <Fotos paths={t.foto} onOpen={setLightbox} />
      <dl className={s.dl}>
        <dt>Pelapor</dt><dd>{nameOf(t.pelapor)}, {jam(t.created_at)}</dd>
        <dt>SLA</dt><dd className={sl.lewat ? s.neg : ''}>{t.status === 'selesai' ? `Selesai dalam ${durasi(sl.used)}` : sl.lewat ? `Lewat ${durasi(sl.sisa)}` : `Sisa ${durasi(sl.sisa)}`}</dd>
        {t.mulai_at && <><dt>Mulai dikerjakan</dt><dd>{jam(t.mulai_at)}</dd></>}
        {t.selesai_at && <><dt>Selesai</dt><dd>{jam(t.selesai_at)}</dd></>}
        {t.catatan_selesai && <><dt>Perbaikan</dt><dd>{t.catatan_selesai}</dd></>}
        {Number(t.biaya) > 0 && <><dt>Biaya</dt><dd>{rpFull(t.biaya)}</dd></>}
      </dl>

      {isTeknik && t.status !== 'selesai' && (
        <div className={s.inlineForm}>
          <select value={teknisi} onChange={(e) => setTeknisi(e.target.value)} aria-label="Teknisi">
            <option value="">Pilih teknisi</option>
            {team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" disabled={busy || teknisi === (t.teknisi || '')} onClick={assign}>Tugaskan</button>
        </div>
      )}

      {bisa && t.status !== 'selesai' && !done && (
        <div className="modal-actions">
          {t.status !== 'dikerjakan' && <button className="btn btn-ghost" disabled={busy} onClick={mulai}>Mulai kerjakan</button>}
          {t.status !== 'menunggu_material' && <button className="btn btn-ghost" disabled={busy} onClick={tunggu}>Menunggu material</button>}
          <button className="btn btn-primary" onClick={() => setDone(true)}>Selesaikan</button>
        </div>
      )}
      {done && (
        <div className={s.doneBox}>
          <div className="field"><label>Apa yang diperbaiki</label><textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} /></div>
          <div className="field"><label>Biaya material (Rp)</label><input type="number" min="0" step="1000" value={biaya} onChange={(e) => setBiaya(e.target.value)} /></div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setDone(false)}>Batal</button>
            <button className="btn btn-primary" disabled={busy} onClick={selesai}>Tandai selesai</button>
          </div>
        </div>
      )}
      {isTeknik && t.status === 'selesai' && (
        <div className="modal-actions"><button className="btn btn-ghost" disabled={busy} onClick={bukaLagi}>Buka kembali</button></div>
      )}
    </Modal>
  );
}

function Preventif({ d, isTeknik, unitKode, nameOf, reload, showToast }) {
  const [form, setForm] = useState(null);
  const [tpl, setTpl] = useState(false);
  const [doneFor, setDoneFor] = useState(null);
  const [unit, setUnit] = useState('');
  const list = d.aset
    .filter((a) => !unit || a.unit_id === unit || (unit === 'umum' && !a.unit_id))
    .map((a) => ({ ...a, ...asetJatuhTempo(a) }))
    .sort((a, b) => a.sisa - b.sisa);
  const lastLog = {};
  d.asetLog.forEach((l) => { if (!lastLog[l.aset_id]) lastLog[l.aset_id] = l; });

  return (
    <div>
      <div className={s.toolbar}>
        <select className={s.inputSm} value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="">Semua lokasi</option>
          <option value="umum">Fasilitas umum</option>
          {d.units.map((u) => <option key={u.id} value={u.id}>{u.kode}</option>)}
        </select>
        {isTeknik && (
          <div className={s.btnRow}>
            <button className="btn btn-ghost" onClick={() => setTpl(true)}>Pasang jadwal standar</button>
            <button className="btn btn-primary" onClick={() => setForm({})}>Tambah aset</button>
          </div>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Aset</th><th>Lokasi</th><th>Interval</th><th>Terakhir</th><th>Berikutnya</th><th /></tr></thead>
          <tbody>
            {!list.length && <tr><td colSpan={6}><Empty title="Belum ada jadwal perawatan">Pakai "Pasang jadwal standar" untuk membuat jadwal kolam, AC, pompa, water heater, talang, dan panel listrik sekaligus.</Empty></td></tr>}
            {list.map((a) => (
              <tr key={a.id}>
                <td>
                  <div className="cell-strong">{a.nama}</div>
                  <div className="cell-soft">{a.kategori}{lastLog[a.id]?.catatan ? ` · ${lastLog[a.id].catatan}` : ''}</div>
                </td>
                <td>{unitKode(a.unit_id)}</td>
                <td>{a.interval_hari} hari</td>
                <td>
                  <div>{a.terakhir ? tgl(a.terakhir, false) : 'Belum pernah'}</div>
                  {lastLog[a.id] && <div className="cell-soft">{nameOf(lastLog[a.id].oleh)}</div>}
                </td>
                <td>
                  <span className={`badge ${a.sisa < 0 ? 'badge-red' : a.sisa <= 7 ? 'badge-gold' : 'badge-green'}`}>
                    {a.sisa < 0 ? `Lewat ${-a.sisa} hari` : a.sisa === 0 ? 'Hari ini' : `${a.sisa} hari lagi`}
                  </span>
                </td>
                <td>
                  {isTeknik && (
                    <div className="row-actions">
                      <button className="btn btn-primary btn-sm" onClick={() => setDoneFor(a)}>Sudah dikerjakan</button>
                      <button className={s.linkBtn} onClick={() => setForm(a)}>Ubah</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <AsetForm aset={form} d={d} onClose={() => setForm(null)} reload={reload} showToast={showToast} />}
      {tpl && <TemplateAset d={d} onClose={() => setTpl(false)} reload={reload} showToast={showToast} />}
      {doneFor && <AsetDone aset={doneFor} onClose={() => setDoneFor(null)} reload={reload} showToast={showToast} />}
    </div>
  );
}

function AsetForm({ aset, d, onClose, reload, showToast }) {
  const [f, setF] = useState({ nama: '', unit_id: '', kategori: 'Kolam', interval_hari: 30, terakhir: '', catatan: '', ...aset, unit_id: aset.unit_id || '', terakhir: aset.terakhir || '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() {
    if (!f.nama.trim()) return showToast('Isi nama aset');
    const row = { nama: f.nama.trim(), unit_id: f.unit_id || null, kategori: f.kategori, interval_hari: Math.max(1, Number(f.interval_hari) || 30), terakhir: f.terakhir || null, catatan: f.catatan || null };
    const { error } = aset.id ? await supabase.from('teknik_aset').update(row).eq('id', aset.id) : await supabase.from('teknik_aset').insert(row);
    if (error) return showToast('Gagal: ' + error.message);
    showToast('Aset tersimpan');
    onClose();
    reload();
  }
  async function del() {
    if (!window.confirm(`Hapus jadwal ${aset.nama}?`)) return;
    const { error } = await supabase.from('teknik_aset').delete().eq('id', aset.id);
    if (error) return showToast('Gagal: ' + error.message);
    onClose();
    reload();
  }
  return (
    <Modal onClose={onClose}>
      <h3>{aset.id ? 'Ubah aset' : 'Tambah aset perawatan'}</h3>
      <div className="field"><label>Nama aset / pekerjaan rutin</label><input value={f.nama} onChange={set('nama')} placeholder="Pompa kolam" /></div>
      <div className="field-row">
        <div className="field">
          <label>Lokasi</label>
          <select value={f.unit_id} onChange={set('unit_id')}>
            <option value="">Fasilitas umum</option>
            {d.units.map((u) => <option key={u.id} value={u.id}>{u.kode}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Kategori</label>
          <select value={f.kategori} onChange={set('kategori')}>{KATEGORI_ASET.map((k) => <option key={k}>{k}</option>)}</select>
        </div>
      </div>
      <div className="field-row">
        <div className="field"><label>Setiap (hari)</label><input type="number" min="1" value={f.interval_hari} onChange={set('interval_hari')} /></div>
        <div className="field"><label>Terakhir dikerjakan</label><input type="date" value={f.terakhir} onChange={set('terakhir')} /></div>
      </div>
      <div className="field"><label>Catatan / spesifikasi</label><input value={f.catatan || ''} onChange={set('catatan')} placeholder="Merk, kapasitas, vendor servis..." /></div>
      <div className="modal-actions">
        {aset.id && <button className={`btn btn-ghost ${s.danger}`} onClick={del}>Hapus</button>}
        <button className="btn btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" onClick={save}>Simpan aset</button>
      </div>
    </Modal>
  );
}

function TemplateAset({ d, onClose, reload, showToast }) {
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const units = d.units.filter((u) => ['serah_terima', 'operasional'].includes(u.status));
  const pool = units.length ? units : d.units;
  async function save() {
    if (!picked.length) return showToast('Pilih minimal satu unit');
    setBusy(true);
    const have = new Set(d.aset.map((a) => (a.unit_id || '') + '|' + a.nama));
    const rows = [];
    picked.forEach((uid) => ASET_STANDAR.forEach((a) => { if (!have.has(uid + '|' + a.nama)) rows.push({ ...a, unit_id: uid, terakhir: today() }); }));
    const { error } = rows.length ? await supabase.from('teknik_aset').insert(rows) : { error: null };
    setBusy(false);
    if (error) return showToast('Gagal: ' + error.message);
    showToast(`${rows.length} jadwal dibuat`);
    onClose();
    reload();
  }
  return (
    <Modal onClose={onClose}>
      <h3>Pasang jadwal standar</h3>
      <p className={s.muted}>Setiap unit terpilih mendapat {ASET_STANDAR.length} jadwal: {ASET_STANDAR.map((a) => `${a.nama} (${a.interval_hari} hari)`).join(', ')}. Hitungan mulai hari ini.</p>
      <div className={s.checkGrid}>
        {pool.map((u) => (
          <label key={u.id} className={s.check}>
            <input type="checkbox" checked={picked.includes(u.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, u.id] : picked.filter((x) => x !== u.id))} />
            {u.kode}
          </label>
        ))}
        {!pool.length && <span className={s.muted}>Belum ada unit.</span>}
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={() => setPicked(pool.map((u) => u.id))}>Pilih semua</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Membuat...' : 'Buat jadwal'}</button>
      </div>
    </Modal>
  );
}

function AsetDone({ aset, onClose, reload, showToast }) {
  const [f, setF] = useState({ tanggal: today(), catatan: '', biaya: 0 });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r1 = await supabase.from('teknik_aset_log').insert({ aset_id: aset.id, tanggal: f.tanggal, catatan: f.catatan || null, biaya: Number(f.biaya) || 0 });
    const r2 = r1.error ? r1 : await supabase.from('teknik_aset').update({ terakhir: f.tanggal }).eq('id', aset.id);
    setBusy(false);
    if (r2.error) return showToast('Gagal: ' + r2.error.message);
    showToast('Perawatan tercatat');
    onClose();
    reload();
  }
  return (
    <Modal onClose={onClose}>
      <h3>{aset.nama}</h3>
      <div className="field-row">
        <div className="field"><label>Tanggal dikerjakan</label><input type="date" max={today()} value={f.tanggal} onChange={(e) => setF({ ...f, tanggal: e.target.value })} /></div>
        <div className="field"><label>Biaya (Rp)</label><input type="number" min="0" step="1000" value={f.biaya} onChange={(e) => setF({ ...f, biaya: e.target.value })} /></div>
      </div>
      <div className="field"><label>Catatan kondisi</label><input value={f.catatan} onChange={(e) => setF({ ...f, catatan: e.target.value })} placeholder="pH 7,4, filter dibersihkan" /></div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>Simpan</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// TIM TEKNIK (admin)
// ---------------------------------------------------------------------
function Tim({ d, profiles, reload, showToast }) {
  const mem = {};
  d.members.forEach((m) => (mem[m.profile_id] = m));
  async function toggle(p, on) {
    const { error } = on
      ? await supabase.from('teknik_members').insert({ profile_id: p.id, jabatan: 'Teknisi Perawatan' })
      : await supabase.from('teknik_members').delete().eq('profile_id', p.id);
    if (error) return showToast('Gagal: ' + error.message);
    showToast(on ? `${p.name} masuk tim teknik` : `${p.name} dikeluarkan dari tim teknik`);
    reload();
  }
  async function jabatan(p, v) {
    const { error } = await supabase.from('teknik_members').update({ jabatan: v }).eq('profile_id', p.id);
    if (error) return showToast('Gagal: ' + error.message);
    showToast('Jabatan diperbarui');
    reload();
  }
  return (
    <div>
      <div className={s.note}>
        Buat akun staf teknik dulu di menu <b>Staf &amp; Peran</b>, lalu centang di sini. Anggota tim teknik bisa mengisi progres, laporan lapangan, biaya, QC, dan menangani tiket. Admin otomatis punya semua akses.
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nama</th><th>Peran sistem</th><th>Tim teknik</th><th>Jabatan</th></tr></thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id}>
                <td className="cell-strong">{p.name || '—'}</td>
                <td>{p.role === 'admin' ? 'Admin' : 'Agen'}</td>
                <td><input type="checkbox" checked={!!mem[p.id]} onChange={(e) => toggle(p, e.target.checked)} aria-label={'Tim teknik ' + p.name} /></td>
                <td>
                  {mem[p.id] ? (
                    <select className={s.inputSm} value={mem[p.id].jabatan} onChange={(e) => jabatan(p, e.target.value)}>
                      {[...new Set([...JABATAN, mem[p.id].jabatan])].map((j) => <option key={j}>{j}</option>)}
                    </select>
                  ) : (
                    <span className={s.muted}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
