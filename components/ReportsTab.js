import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { supabase } from '../lib/supabaseClient';
import s from './ReportsTab.module.css';

const PRESETS = [
  { key: '7', label: '7 hari' },
  { key: '30', label: '30 hari' },
  { key: 'bulan', label: 'Bulan ini' },
  { key: 'bulanlalu', label: 'Bulan lalu' },
  { key: 'custom', label: 'Pilih tanggal' },
];

const CLASS_LABEL = { hot: 'Hot', warm: 'Warm', cool: 'Cool', closing: 'Closing', none: 'Belum diklasifikasi' };
const CLASS_COLOR = { hot: '#C2412D', warm: '#D68A2E', cool: '#3E6FA8', closing: '#2F7A4F', none: '#CFC6C2' };
const ACTIVE_STATUSES = ['Follow-up', 'Nego'];

// ---------- helper ----------
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function rangeFor(key, customFrom, customTo) {
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (key === '7' || key === '30') {
    const from = new Date(tomorrow);
    from.setDate(tomorrow.getDate() - Number(key));
    return { from, to: tomorrow };
  }
  if (key === 'bulan') return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: tomorrow };
  if (key === 'bulanlalu') {
    return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 1) };
  }
  const from = customFrom ? startOfDay(new Date(customFrom + 'T00:00:00')) : today;
  const toBase = customTo ? startOfDay(new Date(customTo + 'T00:00:00')) : today;
  const to = new Date(toBase);
  to.setDate(toBase.getDate() + 1);
  return { from, to: to > from ? to : tomorrow };
}
function fmtDuration(sec) {
  if (sec === null || sec === undefined || Number.isNaN(Number(sec))) return '—';
  const v = Math.round(Number(sec));
  if (v < 60) return `${v} dtk`;
  const m = Math.round(v / 60);
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm ? `${h} j ${mm} m` : `${h} jam`;
  const d = Math.floor(h / 24);
  return `${d} hr ${h % 24} j`;
}
function pct(a, b) {
  return b ? Math.round((a / b) * 100) : 0;
}
function fmtDate(d) {
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
function downloadCsv(filename, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- komponen ----------
export default function ReportsTab({ leads = [], properties = [], profiles = [], user, isAdmin }) {
  const [preset, setPreset] = useState('30');
  const [customFrom, setCustomFrom] = useState(ymd(new Date(Date.now() - 6 * 864e5)));
  const [customTo, setCustomTo] = useState(ymd(new Date()));
  const [summary, setSummary] = useState(null);
  const [response, setResponse] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const respRef = useRef(null);
  const projRef = useRef(null);
  const dailyRef = useRef(null);
  const classRef = useRef(null);
  const chartsRef = useRef({});

  const { from, to } = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const toInclusive = new Date(to.getTime() - 1);
  const nameOf = useCallback(
    (id) => (id ? profiles.find((p) => p.id === id)?.name || 'Staf' : 'Dibalas dari HP'),
    [profiles]
  );

  // ---------- ambil data chat dari database ----------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const args = { p_from: from.toISOString(), p_to: to.toISOString() };
    Promise.all([supabase.rpc('wa_report_summary', args), supabase.rpc('wa_report_response', args)]).then(([a, b]) => {
      if (cancelled) return;
      if (a.error || b.error) {
        setError((a.error || b.error).message);
        setSummary(null);
        setResponse([]);
      } else {
        setSummary(a.data || null);
        setResponse(b.data || []);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  // ---------- leads dalam periode ----------
  const periodLeads = useMemo(
    () =>
      leads.filter((l) => {
        const t = new Date(l.created_at);
        if (!(t >= from && t < to)) return false;
        return isAdmin || l.agent_id === user?.id;
      }),
    [leads, from, to, isAdmin, user]
  );
  const closingCount = periodLeads.filter((l) => l.status === 'Closing').length;

  const byProject = useMemo(() => {
    const map = {};
    periodLeads.forEach((l) => {
      const k = l.property_id || 'none';
      if (!map[k]) map[k] = { key: k, name: k === 'none' ? 'Tanpa proyek' : properties.find((p) => p.id === k)?.title || 'Proyek terhapus', leads: 0, proses: 0, closing: 0, hilang: 0 };
      map[k].leads += 1;
      if (ACTIVE_STATUSES.includes(l.status)) map[k].proses += 1;
      if (l.status === 'Closing') map[k].closing += 1;
      if (l.status === 'Hilang') map[k].hilang += 1;
    });
    return Object.values(map).sort((a, b) => b.leads - a.leads);
  }, [periodLeads, properties]);

  const bySource = useMemo(() => {
    const map = {};
    periodLeads.forEach((l) => {
      const k = l.source || 'Lainnya';
      if (!map[k]) map[k] = { name: k, leads: 0, closing: 0 };
      map[k].leads += 1;
      if (l.status === 'Closing') map[k].closing += 1;
    });
    return Object.values(map).sort((a, b) => b.leads - a.leads);
  }, [periodLeads]);

  // ---------- kinerja agen (gabungan chat + leads) ----------
  const agentRows = useMemo(() => {
    const map = {};
    const ensure = (id) => {
      const k = id || 'hp';
      if (!map[k]) map[k] = { key: k, id, name: nameOf(id), answered: 0, median: null, within5: 0, sent: 0, leads: 0, closing: 0 };
      return map[k];
    };
    response.forEach((r) => {
      const row = ensure(r.agent_id);
      row.answered = Number(r.answered) || 0;
      row.median = r.median_sec;
      row.within5 = Number(r.within5) || 0;
      row.sent = Number(r.sent) || 0;
    });
    periodLeads.forEach((l) => {
      if (!l.agent_id) return;
      const row = ensure(l.agent_id);
      row.leads += 1;
      if (l.status === 'Closing') row.closing += 1;
    });
    return Object.values(map).sort((a, b) => b.answered + b.leads - (a.answered + a.leads));
  }, [response, periodLeads, nameOf]);

  // ---------- grafik ----------
  useEffect(() => {
    Object.values(chartsRef.current).forEach((c) => c && c.destroy());
    chartsRef.current = {};
    if (loading) return;

    const withMedian = agentRows.filter((r) => r.median !== null && r.median !== undefined);
    if (withMedian.length && respRef.current) {
      chartsRef.current.resp = new Chart(respRef.current, {
        type: 'bar',
        data: {
          labels: withMedian.map((r) => r.name),
          datasets: [{ label: 'Median respons (menit)', data: withMedian.map((r) => +(Number(r.median) / 60).toFixed(1)), backgroundColor: '#7D2233', borderRadius: 4, maxBarThickness: 28 }],
        },
        options: {
          indexAxis: 'y',
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${fmtDuration(withMedian[c.dataIndex].median)}` } } },
          scales: { x: { beginAtZero: true, title: { display: true, text: 'menit' } } },
        },
      });
    }

    const topProjects = byProject.slice(0, 8);
    if (topProjects.length && projRef.current) {
      chartsRef.current.proj = new Chart(projRef.current, {
        type: 'bar',
        data: {
          labels: topProjects.map((p) => p.name),
          datasets: [
            { label: 'Total leads', data: topProjects.map((p) => p.leads), backgroundColor: '#E6C7CC', borderRadius: 4, maxBarThickness: 32 },
            { label: 'Closing', data: topProjects.map((p) => p.closing), backgroundColor: '#7D2233', borderRadius: 4, maxBarThickness: 32 },
          ],
        },
        options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
      });
    }

    if (summary && dailyRef.current) {
      const map = {};
      (summary.daily || []).forEach((d) => {
        map[d.d] = d;
      });
      const labels = [];
      const masuk = [];
      const keluar = [];
      for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) {
        const k = ymd(d);
        labels.push(d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }));
        masuk.push(map[k]?.in || 0);
        keluar.push(map[k]?.out || 0);
      }
      chartsRef.current.daily = new Chart(dailyRef.current, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Pesan masuk', data: masuk, borderColor: '#7D2233', backgroundColor: 'rgba(125,34,51,0.12)', fill: true, tension: 0.3, pointRadius: 2 },
            { label: 'Balasan', data: keluar, borderColor: '#B8873A', backgroundColor: 'transparent', tension: 0.3, pointRadius: 2 },
          ],
        },
        options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
      });
    }

    const classes = summary?.classes || {};
    const classKeys = Object.keys(classes).filter((k) => classes[k] > 0);
    if (classKeys.length && classRef.current) {
      const order = ['hot', 'warm', 'cool', 'closing', 'none'].filter((k) => classKeys.includes(k));
      chartsRef.current.cls = new Chart(classRef.current, {
        type: 'doughnut',
        data: {
          labels: order.map((k) => CLASS_LABEL[k]),
          datasets: [{ data: order.map((k) => classes[k]), backgroundColor: order.map((k) => CLASS_COLOR[k]), borderWidth: 0 }],
        },
        options: { cutout: '62%', aspectRatio: 1.9, plugins: { legend: { position: 'right' } } },
      });
    }

    return () => {
      Object.values(chartsRef.current).forEach((c) => c && c.destroy());
      chartsRef.current = {};
    };
  }, [loading, agentRows, byProject, summary, from, to]);

  // ---------- unduh CSV ----------
  function exportAgents() {
    downloadCsv(`kinerja-agen_${ymd(from)}_${ymd(toInclusive)}.csv`, [
      ['Agen', 'Chat dibalas', 'Median respons', 'Dibalas <= 5 menit (%)', 'Pesan terkirim', 'Leads ditangani', 'Closing', 'Closing rate (%)'],
      ...agentRows.map((r) => [r.name, r.answered, fmtDuration(r.median), pct(r.within5, r.answered), r.sent, r.leads, r.closing, pct(r.closing, r.leads)]),
    ]);
  }
  function exportProjects() {
    downloadCsv(`leads-per-proyek_${ymd(from)}_${ymd(toInclusive)}.csv`, [
      ['Proyek', 'Total leads', 'Follow-up/Nego', 'Closing', 'Hilang', 'Closing rate (%)'],
      ...byProject.map((p) => [p.name, p.leads, p.proses, p.closing, p.hilang, pct(p.closing, p.leads)]),
    ]);
  }

  const answered = Number(summary?.answered) || 0;
  const within5 = Number(summary?.within5) || 0;

  return (
    <section>
      <div className="topbar">
        <div>
          <h1>Laporan</h1>
          <p>
            {isAdmin ? 'Kinerja tim, chat WA, dan leads per proyek' : 'Kinerja Anda: chat WA dan leads yang Anda tangani'} ·{' '}
            {fmtDate(from)} – {fmtDate(toInclusive)}
          </p>
        </div>
      </div>

      {/* ===== Filter periode ===== */}
      <div className={s.filters}>
        <div className={s.chips} role="tablist" aria-label="Periode laporan">
          {PRESETS.map((p) => (
            <button key={p.key} role="tab" aria-selected={preset === p.key} className={`${s.chip} ${preset === p.key ? s.chipOn : ''}`} onClick={() => setPreset(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className={s.dates}>
            <label className={s.dateField}>
              <span>Dari</span>
              <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} />
            </label>
            <label className={s.dateField}>
              <span>Sampai</span>
              <input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} />
            </label>
          </div>
        )}
      </div>

      {error && (
        <div className={s.error}>
          Laporan chat gagal dimuat: {error}. Pastikan file SQL <code>005_reports.sql</code> sudah dijalankan di Supabase.
        </div>
      )}

      {/* ===== Angka utama ===== */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Percakapan baru</div>
          <div className="kpi-value">{loading ? '…' : summary?.new_conversations ?? 0}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Median waktu respons</div>
          <div className="kpi-value accent">{loading ? '…' : fmtDuration(summary?.median_sec)}</div>
          <div className={s.kpiNote}>{loading ? '' : `${pct(within5, answered)}% dibalas ≤ 5 menit`}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Chat belum dibalas</div>
          <div className={`kpi-value ${Number(summary?.unanswered) ? s.warn : ''}`}>{loading ? '…' : summary?.unanswered ?? 0}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Leads baru</div>
          <div className="kpi-value">{periodLeads.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Closing rate</div>
          <div className="kpi-value gold">{pct(closingCount, periodLeads.length)}%</div>
          <div className={s.kpiNote}>{closingCount} closing dari {periodLeads.length} leads</div>
        </div>
      </div>

      {/* ===== Grafik ===== */}
      <div className="chart-grid">
        <div className="panel">
          <h3>Median Waktu Respons per Agen</h3>
          {agentRows.some((r) => r.median !== null && r.median !== undefined) ? (
            <canvas ref={respRef} height="160" />
          ) : (
            <div className="panel-empty">{loading ? 'Memuat…' : 'Belum ada chat yang dibalas di periode ini'}</div>
          )}
        </div>
        <div className="panel">
          <h3>Leads vs Closing per Proyek</h3>
          {byProject.length ? <canvas ref={projRef} height="160" /> : <div className="panel-empty">Belum ada leads di periode ini</div>}
        </div>
      </div>

      <div className="chart-grid">
        <div className="panel">
          <h3>Volume Chat Harian</h3>
          {summary && (Number(summary.inbound_messages) || Number(summary.outbound_messages)) ? (
            <canvas ref={dailyRef} height="140" />
          ) : (
            <div className="panel-empty">{loading ? 'Memuat…' : 'Belum ada chat di periode ini'}</div>
          )}
        </div>
        <div className="panel">
          <h3>Klasifikasi Chat</h3>
          {summary && Object.values(summary.classes || {}).some((n) => n > 0) ? (
            <canvas ref={classRef} height="140" />
          ) : (
            <div className="panel-empty">{loading ? 'Memuat…' : 'Belum ada chat di periode ini'}</div>
          )}
        </div>
      </div>

      {/* ===== Tabel kinerja agen ===== */}
      <div className={`panel ${s.block}`}>
        <div className={s.panelHead}>
          <h3>{isAdmin ? 'Kinerja Agen' : 'Kinerja Saya'}</h3>
          {agentRows.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={exportAgents}>
              Unduh CSV
            </button>
          )}
        </div>
        {agentRows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agen</th>
                  <th className={s.num}>Chat dibalas</th>
                  <th className={s.num}>Median respons</th>
                  <th className={s.num}>≤ 5 menit</th>
                  <th className={s.num}>Pesan terkirim</th>
                  <th className={s.num}>Leads</th>
                  <th className={s.num}>Closing</th>
                  <th className={s.num}>Closing rate</th>
                </tr>
              </thead>
              <tbody>
                {agentRows.map((r) => (
                  <tr key={r.key}>
                    <td className="cell-strong">{r.name}</td>
                    <td className={s.num}>{r.answered}</td>
                    <td className={s.num}>{fmtDuration(r.median)}</td>
                    <td className={s.num}>{r.answered ? `${pct(r.within5, r.answered)}%` : '—'}</td>
                    <td className={s.num}>{r.sent}</td>
                    <td className={s.num}>{r.leads}</td>
                    <td className={s.num}>{r.closing}</td>
                    <td className={s.num}>{r.leads ? `${pct(r.closing, r.leads)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel-empty">{loading ? 'Memuat…' : 'Belum ada aktivitas di periode ini'}</div>
        )}
        <p className={s.footnote}>
          Waktu respons dihitung dari pesan pertama pelanggan sampai balasan pertama staf. Median dipakai agar satu chat yang
          terlambat semalam tidak merusak rata-rata.
        </p>
      </div>

      {/* ===== Tabel per proyek & sumber ===== */}
      <div className="chart-grid">
        <div className="panel">
          <div className={s.panelHead}>
            <h3>Leads per Proyek</h3>
            {byProject.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={exportProjects}>
                Unduh CSV
              </button>
            )}
          </div>
          {byProject.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Proyek</th>
                    <th className={s.num}>Leads</th>
                    <th className={s.num}>Proses</th>
                    <th className={s.num}>Closing</th>
                    <th className={s.num}>Hilang</th>
                    <th className={s.num}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {byProject.map((p) => (
                    <tr key={p.key}>
                      <td className="cell-strong">{p.name}</td>
                      <td className={s.num}>{p.leads}</td>
                      <td className={s.num}>{p.proses}</td>
                      <td className={s.num}>{p.closing}</td>
                      <td className={s.num}>{p.hilang}</td>
                      <td className={s.num}>{pct(p.closing, p.leads)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel-empty">Belum ada leads di periode ini</div>
          )}
        </div>
        <div className="panel">
          <h3>Leads per Sumber</h3>
          {bySource.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Sumber</th>
                    <th className={s.num}>Leads</th>
                    <th className={s.num}>Closing</th>
                    <th className={s.num}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {bySource.map((r) => (
                    <tr key={r.name}>
                      <td className="cell-strong">{r.name}</td>
                      <td className={s.num}>{r.leads}</td>
                      <td className={s.num}>{r.closing}</td>
                      <td className={s.num}>{pct(r.closing, r.leads)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel-empty">Belum ada leads di periode ini</div>
          )}
        </div>
      </div>
    </section>
  );
}
