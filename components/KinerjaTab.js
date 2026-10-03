// Tab Kinerja — sistem penilaian kinerja Divisi Marketing Amansaka.
// Data: daily_reports, ad_spend, marketing_targets, staff_targets (lihat supabase/005_kinerja_marketing.sql)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import s from './KinerjaTab.module.css';

const VIEWS = [
  { key: 'ringkasan', label: 'Ringkasan' },
  { key: 'papan', label: 'Papan kinerja' },
  { key: 'laporan', label: 'Laporan harian' },
  { key: 'iklan', label: 'Iklan & CPL' },
  { key: 'target', label: 'Target', admin: true },
];
const BOBOT = { closing: 40, survei: 25, leads: 15, fu: 10, disiplin: 10 };
const PLATFORMS = ['Meta Ads', 'TikTok Ads', 'Google Ads', 'Portal properti', 'Lainnya'];
const EMPTY_REPORT = { leads: 0, follow_up: 0, survei: 0, booking: 0, closing: 0, closing_value: 0, konten: 0, calls: 0, notes: '' };
const EMPTY_MT = { unit: 0, omzet: 0, leads: 0, survei: 0, budget: 0, cpl_max: 0, konten: 0 };

// ---------- helper ----------
const pad = (n) => String(n).padStart(2, '0');
const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const ymd = (d) => `${ym(d)}-${pad(d.getDate())}`;
function bounds(m) {
  const [y, mo] = m.split('-').map(Number);
  const days = new Date(y, mo, 0).getDate();
  return { y, mo, days, start: `${m}-01`, end: `${m}-${pad(days)}` };
}
function workdaysElapsed(m) {
  const b = bounds(m);
  const now = new Date();
  const cur = ym(now);
  if (m > cur) return 0;
  const lim = m === cur ? now.getDate() : b.days;
  let c = 0;
  for (let d = 1; d <= lim; d++) if (new Date(b.y, b.mo - 1, d).getDay() !== 0) c++;
  return c;
}
function monthName(m) {
  const b = bounds(m);
  return new Date(b.y, b.mo - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}
const num = (n) => (Number(n) || 0).toLocaleString('id-ID');
function rp(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return 'Rp ' + (n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' M';
  if (n >= 1e6) return 'Rp ' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}
const ratio = (a, b) => (b > 0 ? a / b : 0);
const pctTxt = (p) => Math.round(p * 100) + '%';
const level = (p) => (p >= 1 ? s.barOk : p >= 0.7 ? s.barMid : s.barLow);
const int = (v) => Math.max(0, parseInt(v, 10) || 0);
function sumReports(list) {
  const t = { leads: 0, follow_up: 0, survei: 0, booking: 0, closing: 0, closing_value: 0, konten: 0, calls: 0 };
  list.forEach((r) => { for (const k in t) t[k] += Number(r[k]) || 0; });
  return t;
}
function grade(score) {
  if (score >= 85) return { g: 'A', label: 'Unggul', cls: s.gA };
  if (score >= 70) return { g: 'B', label: 'Baik', cls: s.gB };
  if (score >= 55) return { g: 'C', label: 'Perlu dorongan', cls: s.gC };
  return { g: 'D', label: 'Evaluasi', cls: s.gD };
}

function Bar({ p, cls }) {
  return (
    <div className={s.bar}>
      <i className={cls || level(p)} style={{ width: Math.min(100, p * 100) + '%' }} />
    </div>
  );
}

export default function KinerjaTab({ user, isAdmin, profiles = [], leads = [], transactions = [], showToast }) {
  const [view, setView] = useState('ringkasan');
  const [month, setMonth] = useState(ym(new Date()));
  const [reports, setReports] = useState([]);
  const [ads, setAds] = useState([]);
  const [mt, setMt] = useState({ row: null, from: null });
  const [stMap, setStMap] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchMonth = useCallback(async () => {
    setLoading(true);
    const b = bounds(month);
    const [r, a, m, st] = await Promise.all([
      supabase.from('daily_reports').select('*').gte('report_date', b.start).lte('report_date', b.end),
      supabase.from('ad_spend').select('*').gte('spend_date', b.start).lte('spend_date', b.end),
      supabase.from('marketing_targets').select('*').lte('month', month).order('month', { ascending: false }).limit(1),
      supabase.from('staff_targets').select('*').lte('month', month).order('month', { ascending: false }),
    ]);
    const err = r.error || a.error || m.error || st.error;
    if (err) showToast?.('Gagal memuat data kinerja: ' + err.message);
    setReports(r.data || []);
    setAds(a.data || []);
    const row = (m.data || [])[0] || null;
    setMt({ row, from: row ? row.month : null });
    const map = {};
    (st.data || []).forEach((x) => { if (!map[x.user_id]) map[x.user_id] = x; });
    setStMap(map);
    setLoading(false);
  }, [month, showToast]);

  useEffect(() => { fetchMonth(); }, [fetchMonth]);

  const T = mt.row || EMPTY_MT;
  const nameOf = useCallback((id) => profiles.find((p) => p.id === id)?.name || '(staf dihapus)', [profiles]);

  // ---------- anggota yang dinilai ----------
  const members = useMemo(() => profiles.filter((p) => {
    const t = stMap[p.id];
    if (t) return t.dinilai;
    return p.role === 'agent' || reports.some((r) => r.user_id === p.id);
  }), [profiles, stMap, reports]);

  const ranked = useMemo(() => {
    const wd = workdaysElapsed(month);
    return members.map((p) => {
      const tg = stMap[p.id] || { t_closing: 0, t_survei: 0, t_leads: 0, t_fu: 0 };
      const mine = reports.filter((r) => r.user_id === p.id);
      const t = sumReports(mine);
      const days = new Set(mine.map((r) => r.report_date)).size;
      const cap = (x) => Math.min(1.2, x);
      const pr = {
        closing: cap(ratio(t.closing, tg.t_closing)),
        survei: cap(ratio(t.survei, tg.t_survei)),
        leads: cap(ratio(t.leads, tg.t_leads)),
        fu: cap(ratio(t.follow_up, tg.t_fu)),
        disiplin: wd ? Math.min(1, days / wd) : 0,
      };
      let score = 0;
      for (const k in BOBOT) score += pr[k] * BOBOT[k];
      score = Math.min(100, Math.round(score));
      const crmLeads = leads.filter((l) => l.agent_id === p.id && l.created_at && ym(new Date(l.created_at)) === month).length;
      const crmTrx = transactions.filter((x) => x.agent_id === p.id && String(x.date || '').startsWith(month)).length;
      return { p, tg, t, pr, days, wd, score, gr: grade(score), noTarget: !stMap[p.id], crmLeads, crmTrx };
    }).sort((a, b) => b.score - a.score);
  }, [members, stMap, reports, month, leads, transactions]);

  const total = useMemo(() => sumReports(reports), [reports]);
  const adTotal = useMemo(() => ({
    spend: ads.reduce((x, a) => x + (Number(a.spend) || 0), 0),
    leads: ads.reduce((x, a) => x + (Number(a.leads) || 0), 0),
  }), [ads]);
  const crmLeadsMonth = useMemo(() => leads.filter((l) => l.created_at && ym(new Date(l.created_at)) === month).length, [leads, month]);

  function exportCsv() {
    const head = ['tanggal', 'nama', 'leads', 'follow_up', 'survei', 'booking', 'closing', 'nilai_closing', 'konten', 'panggilan', 'catatan'];
    const rows = [...reports].sort((a, b) => a.report_date.localeCompare(b.report_date)).map((r) =>
      [r.report_date, nameOf(r.user_id), r.leads, r.follow_up, r.survei, r.booking, r.closing, r.closing_value, r.konten, r.calls, r.notes || '']
        .map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(','));
    const blob = new Blob(['\ufeff' + [head.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kinerja-marketing-amansaka-${month}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Kinerja Marketing</h1>
          <p>{monthName(month)} · {members.length} staf dinilai · {reports.length} laporan masuk</p>
        </div>
        <div className={s.tools}>
          <input type="month" className={s.monthInput} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Pilih bulan" />
          {reports.length > 0 && <button className="btn btn-ghost" onClick={exportCsv}>Unduh CSV</button>}
        </div>
      </div>

      <div className={s.chips} role="tablist">
        {VIEWS.filter((v) => !v.admin || isAdmin).map((v) => (
          <button key={v.key} role="tab" aria-selected={view === v.key} className={s.chip + (view === v.key ? ' ' + s.chipOn : '')} onClick={() => setView(v.key)}>
            {v.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="panel-empty">Memuat data kinerja...</div>
      ) : (
        <>
          {view === 'ringkasan' && (
            <Ringkasan T={T} mtFrom={mt.from} month={month} total={total} adTotal={adTotal} reports={reports} ranked={ranked} crmLeadsMonth={crmLeadsMonth} isAdmin={isAdmin} goTarget={() => setView('target')} />
          )}
          {view === 'papan' && <Papan ranked={ranked} isAdmin={isAdmin} />}
          {view === 'laporan' && (
            <Laporan user={user} isAdmin={isAdmin} profiles={profiles} members={members} reports={reports} nameOf={nameOf} refresh={fetchMonth} showToast={showToast} month={month} setMonth={setMonth} />
          )}
          {view === 'iklan' && <Iklan ads={ads} T={T} total={total} adTotal={adTotal} user={user} isAdmin={isAdmin} refresh={fetchMonth} showToast={showToast} />}
          {view === 'target' && isAdmin && (
            <Target month={month} mt={mt} stMap={stMap} profiles={profiles} refresh={fetchMonth} showToast={showToast} />
          )}
        </>
      )}
    </div>
  );
}

// =====================================================================
function Ringkasan({ T, mtFrom, month, total, adTotal, reports, ranked, crmLeadsMonth, isAdmin, goTarget }) {
  const b = bounds(month);
  const now = new Date();
  const sisaHari = ym(now) === month ? b.days - now.getDate() : month > ym(now) ? b.days : 0;
  const sisa = Math.max(0, T.unit - total.closing);
  const n = Math.max(T.unit, total.closing);
  const cpl = adTotal.leads ? adTotal.spend / adTotal.leads : 0;
  const pCpl = cpl && T.cpl_max ? Math.min(1, T.cpl_max / cpl) : 0;

  const steps = [['Leads', total.leads], ['Follow-up', total.follow_up], ['Survei', total.survei], ['Booking', total.booking], ['Closing', total.closing]];
  const mx = Math.max(1, ...steps.map((x) => x[1]));
  const conv = (a, c) => (c ? ((a / c) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%' : '—');

  // grafik harian
  const daily = Array.from({ length: b.days }, () => ({ l: 0, c: 0 }));
  reports.forEach((r) => {
    const d = parseInt(r.report_date.slice(8), 10) - 1;
    if (daily[d]) { daily[d].l += Number(r.leads) || 0; daily[d].c += Number(r.closing) || 0; }
  });
  const W = 620, H = 200, pl = 28, pb = 22, pt = 14, iw = W - pl - 14, ih = H - pb - pt;
  const step = Math.ceil(Math.max(4, ...daily.map((d) => d.l)) / 4);
  const top = step * 4;
  const bw = iw / b.days;

  return (
    <>
      {!mtFrom && (
        <div className={s.notice}>
          Target divisi belum diatur.{' '}
          {isAdmin ? <button className={s.linkBtn} onClick={goTarget}>Atur target sekarang</button> : 'Minta admin mengatur target di menu Kinerja › Target.'}
        </div>
      )}
      {mtFrom && mtFrom !== month && (
        <div className={s.noticeSoft}>Bulan ini memakai target {monthName(mtFrom)}. {isAdmin && <button className={s.linkBtn} onClick={goTarget}>Ubah target bulan ini</button>}</div>
      )}

      <div className={s.hero}>
        <div className={s.heroRow}>
          <div>
            <div className={s.heroBig}>{num(total.closing)}<span> / {num(T.unit)} unit</span></div>
            <div className={s.heroLbl}>Unit closing bulan ini terhadap target divisi</div>
          </div>
          <div className={s.heroOmzet}>
            <div className={s.heroOmzetV}>{rp(total.closing_value)}</div>
            <div className={s.heroLbl}>dari target {rp(T.omzet)} · {pctTxt(ratio(total.closing_value, T.omzet))}</div>
          </div>
        </div>
        <div className={s.units} aria-hidden="true">
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className={s.unit + (i < total.closing ? ' ' + s.unitDone : '') + (i >= T.unit ? ' ' + s.unitExtra : '')}>
              <svg viewBox="0 0 38 44"><path className={s.roof} d="M3 18 19 5l16 13" /><path className={s.body} d="M7 17v24h24V17" /><path className={s.body} d="M16 41V30h6v11" /></svg>
            </div>
          ))}
        </div>
        <div className={s.heroMeter}>
          {!T.unit ? 'Target unit belum diatur.' : sisa ? `Kurang ${sisa} unit lagi${sisaHari ? ` dalam ${sisaHari} hari tersisa` : ''}.` : `Target unit tercapai${total.closing > T.unit ? `, lebih ${total.closing - T.unit} unit` : ''}.`}
        </div>
      </div>

      <div className={s.kpis}>
        <div className="kpi-card">
          <div className="kpi-label">Leads dilaporkan</div>
          <div className="kpi-value">{num(total.leads)}</div>
          <div className={s.kpiSub}>Target {num(T.leads)} · di CRM {num(crmLeadsMonth)}</div>
          <Bar p={ratio(total.leads, T.leads)} />
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Survei lokasi</div>
          <div className="kpi-value">{num(total.survei)}</div>
          <div className={s.kpiSub}>Target {num(T.survei)}</div>
          <Bar p={ratio(total.survei, T.survei)} />
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Biaya per lead</div>
          <div className="kpi-value">{cpl ? rp(cpl) : '—'}</div>
          <div className={s.kpiSub}>{T.cpl_max ? 'Batas ' + rp(T.cpl_max) : 'Batas belum diatur'}</div>
          <Bar p={pCpl} cls={pCpl >= 1 ? s.barOk : pCpl >= 0.8 ? s.barMid : s.barLow} />
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Konten diposting</div>
          <div className="kpi-value">{num(total.konten)}</div>
          <div className={s.kpiSub}>Target {num(T.konten)}</div>
          <Bar p={ratio(total.konten, T.konten)} />
        </div>
      </div>

      <div className={s.two}>
        <div className="panel">
          <h3>Corong penjualan</h3>
          <div className={s.funnel}>
            {steps.map(([l, v]) => (
              <div key={l} className={s.fstep}>
                <span>{l}</span>
                <div className={s.fbar}><i style={{ width: (v / mx) * 100 + '%' }} /></div>
                <b>{num(v)}</b>
              </div>
            ))}
          </div>
          <div className={s.conv}>
            <span>Lead → survei <b>{conv(total.survei, total.leads)}</b></span>
            <span>Survei → booking <b>{conv(total.booking, total.survei)}</b></span>
            <span>Booking → closing <b>{conv(total.closing, total.booking)}</b></span>
            <span>Lead → closing <b>{conv(total.closing, total.leads)}</b></span>
          </div>
        </div>
        <div className="panel">
          <h3>Leads harian</h3>
          <div className={s.legend}>Batang = leads masuk · titik hijau = ada closing</div>
          <div className={s.chart}>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Grafik leads harian">
              {[0, 1, 2, 3, 4].map((i) => {
                const y = pt + ih - (ih * i) / 4;
                return (
                  <g key={i}>
                    <line x1={pl} x2={W - 6} y1={y} y2={y} className={s.gridLine} />
                    <text x={pl - 6} y={y + 4} textAnchor="end" className={s.axis}>{step * i}</text>
                  </g>
                );
              })}
              {daily.map((d, i) => {
                const h = (ih * d.l) / top;
                const x = pl + i * bw + bw * 0.18;
                return (
                  <g key={i}>
                    <rect x={x} y={pt + ih - h} width={bw * 0.64} height={h} rx="2" className={s.barRect}><title>{`Tgl ${i + 1}: ${d.l} leads${d.c ? `, ${d.c} closing` : ''}`}</title></rect>
                    {d.c > 0 && <circle cx={x + bw * 0.32} cy={pt + ih - h - 8} r="4.5" className={s.dotClose} />}
                    {((i + 1) % 5 === 0 || i === 0) && <text x={x + bw * 0.32} y={H - 6} textAnchor="middle" className={s.axis}>{i + 1}</text>}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Peringkat singkat</h3>
        {ranked.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Nama</th><th>Leads</th><th>Survei</th><th>Closing</th><th>Omzet</th><th>Skor</th></tr></thead>
              <tbody>
                {ranked.map((x, i) => (
                  <tr key={x.p.id}>
                    <td>{i + 1}</td>
                    <td className="cell-strong">{x.p.name || 'Tanpa nama'}</td>
                    <td>{num(x.t.leads)}</td>
                    <td>{num(x.t.survei)}</td>
                    <td>{num(x.t.closing)}</td>
                    <td>{rp(x.t.closing_value)}</td>
                    <td><span className={s.grade + ' ' + x.gr.cls}>{x.score} · {x.gr.g}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel-empty">Belum ada staf yang dinilai. Admin bisa mengatur di Kinerja › Target.</div>
        )}
      </div>
    </>
  );
}

// =====================================================================
function Papan({ ranked, isAdmin }) {
  const Mini = ({ l, v, t, p }) => (
    <div className={s.miniItem}>
      {l}<b>{num(v)} / {num(t)}</b><Bar p={p} />
    </div>
  );
  return (
    <>
      {ranked.length === 0 && <div className="panel"><div className="panel-empty">Papan masih kosong. {isAdmin ? 'Atur staf dan target pribadinya di Kinerja › Target.' : 'Admin belum mengatur target tim.'}</div></div>}
      <div className={s.lb}>
        {ranked.map((x, i) => (
          <div key={x.p.id} className={s.card + (i === 0 ? ' ' + s.cardTop : '')}>
            <div className={s.rank}>{i + 1}</div>
            <div className={s.who}>
              <b>{x.p.name || 'Tanpa nama'}</b>
              <span>Lapor {x.days}/{x.wd} hari kerja · {rp(x.t.closing_value)}</span>
              <span>Di CRM: {x.crmLeads} leads · {x.crmTrx} transaksi</span>
              {x.noTarget && <span className={s.warnTxt}>Target pribadi belum diatur</span>}
            </div>
            <div className={s.mini}>
              <Mini l="Closing" v={x.t.closing} t={x.tg.t_closing} p={x.pr.closing} />
              <Mini l="Survei" v={x.t.survei} t={x.tg.t_survei} p={x.pr.survei} />
              <Mini l="Leads" v={x.t.leads} t={x.tg.t_leads} p={x.pr.leads} />
              <Mini l="Follow-up" v={x.t.follow_up} t={x.tg.t_fu} p={x.pr.fu} />
            </div>
            <div className={s.score}>
              <div className={s.scoreNum}>{x.score}</div>
              <span className={s.grade + ' ' + x.gr.cls}>{x.gr.g} · {x.gr.label}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Cara skor dihitung</h3>
        <p className={s.note}>
          Skor 0–100 = Closing 40% + Survei lokasi 25% + Leads 15% + Follow-up 10% + Disiplin lapor 10%. Tiap komponen adalah capaian terhadap target pribadi, maksimal dihitung 120% supaya satu angka tidak menutupi yang lain. Disiplin lapor = hari yang dilaporkan dibanding hari kerja Senin–Sabtu yang sudah berjalan.
          Angka “Di CRM” diambil otomatis dari tab Leads dan Transaksi sebagai pembanding laporan.
        </p>
        <div className={s.gradeRow}>
          <span className={s.grade + ' ' + s.gA}>A · 85+ Unggul</span>
          <span className={s.grade + ' ' + s.gB}>B · 70–84 Baik</span>
          <span className={s.grade + ' ' + s.gC}>C · 55–69 Perlu dorongan</span>
          <span className={s.grade + ' ' + s.gD}>D · di bawah 55 Evaluasi</span>
        </div>
      </div>
    </>
  );
}

// =====================================================================
function Laporan({ user, isAdmin, profiles, members, reports, nameOf, refresh, showToast, month, setMonth }) {
  const today = ymd(new Date());
  const minDate = (() => { const d = new Date(); d.setDate(d.getDate() - 3); return ymd(d); })();
  const [date, setDate] = useState(today);
  const [uid, setUid] = useState(user?.id || '');
  const [f, setF] = useState(EMPTY_REPORT);
  const [exists, setExists] = useState(false);
  const [saving, setSaving] = useState(false);

  const people = isAdmin ? (members.length ? members : profiles) : profiles.filter((p) => p.id === user?.id);

  useEffect(() => {
    if (!date || !uid) return;
    let alive = true;
    supabase.from('daily_reports').select('*').eq('report_date', date).eq('user_id', uid).maybeSingle().then(({ data }) => {
      if (!alive) return;
      setExists(!!data);
      setF(data ? { leads: data.leads, follow_up: data.follow_up, survei: data.survei, booking: data.booking, closing: data.closing, closing_value: data.closing_value, konten: data.konten, calls: data.calls, notes: data.notes || '' } : EMPTY_REPORT);
    });
    return () => { alive = false; };
  }, [date, uid]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: k === 'notes' ? e.target.value : e.target.value === '' ? '' : int(e.target.value) }));

  async function save() {
    if (!date || !uid) return showToast?.('Isi tanggal dan nama staf.');
    if (!isAdmin && (date < minDate || date > today)) return showToast?.('Laporan hanya bisa diisi untuk hari ini s.d. 3 hari ke belakang.');
    setSaving(true);
    const payload = {
      report_date: date, user_id: uid,
      leads: int(f.leads), follow_up: int(f.follow_up), survei: int(f.survei), booking: int(f.booking),
      closing: int(f.closing), closing_value: int(f.closing_value), konten: int(f.konten), calls: int(f.calls),
      notes: String(f.notes || '').trim().slice(0, 1000) || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('daily_reports').upsert(payload, { onConflict: 'report_date,user_id' }).select('id, closing').single();
    setSaving(false);
    if (error) return showToast?.('Gagal menyimpan: ' + error.message);
    showToast?.(exists ? 'Laporan diperbarui' : 'Laporan tersimpan');
    setExists(true);
    if (data?.closing > 0) {
      // Kabari tim lewat notifikasi HP (server yang memastikan tidak dobel)
      const { data: sess } = await supabase.auth.getSession();
      fetch('/api/kinerja/closing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sess?.session?.access_token || '') },
        body: JSON.stringify({ report_id: data.id }),
      }).catch(() => {});
    }
    if (date.slice(0, 7) !== month) setMonth(date.slice(0, 7));
    else refresh();
  }

  async function remove(id) {
    if (!confirm('Hapus laporan ini?')) return;
    const { error } = await supabase.from('daily_reports').delete().eq('id', id);
    if (error) return showToast?.('Gagal menghapus: ' + error.message);
    showToast?.('Laporan dihapus');
    refresh();
  }

  function edit(r) {
    setDate(r.report_date);
    setUid(r.user_id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const list = [...reports].sort((a, b) => b.report_date.localeCompare(a.report_date) || nameOf(a.user_id).localeCompare(nameOf(b.user_id)));
  const canEditRow = (r) => isAdmin || (r.user_id === user?.id && r.report_date >= minDate && r.report_date <= today);

  return (
    <>
      <div className="panel">
        <h3>{exists ? 'Perbarui laporan' : 'Isi laporan hari ini'}</h3>
        <p className={s.note} style={{ marginTop: -6 }}>
          Satu laporan per orang per hari. {isAdmin ? 'Sebagai admin, kamu bisa mengisi atau mengoreksi untuk staf mana pun.' : 'Bisa diisi untuk hari ini sampai 3 hari ke belakang.'}
        </p>
        <div className={s.formGrid2}>
          <div className="field"><label>Tanggal</label><input type="date" value={date} max={isAdmin ? undefined : today} min={isAdmin ? undefined : minDate} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="field">
            <label>Nama staf</label>
            <select value={uid} onChange={(e) => setUid(e.target.value)} disabled={!isAdmin}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name || 'Tanpa nama'}</option>)}
            </select>
          </div>
        </div>
        <div className={s.formGrid4}>
          {[['leads', 'Leads baru'], ['follow_up', 'Follow-up'], ['survei', 'Survei lokasi'], ['booking', 'Booking'], ['closing', 'Closing (unit)'], ['closing_value', 'Nilai closing (Rp)'], ['konten', 'Konten diposting'], ['calls', 'Telepon / chat aktif']].map(([k, l]) => (
            <div className="field" key={k}><label>{l}</label><input type="number" inputMode="numeric" min="0" step={k === 'closing_value' ? 1000000 : 1} value={f[k]} onChange={set(k)} /></div>
          ))}
        </div>
        <div className="field"><label>Catatan</label><textarea value={f.notes} onChange={set('notes')} placeholder="Prospek panas, hambatan, kebutuhan dari divisi lain…" /></div>
        {exists && <div className={s.noticeSoft}>Laporan untuk tanggal dan staf ini sudah ada. Menyimpan akan memperbaruinya.</div>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => setF(EMPTY_REPORT)} type="button">Kosongkan</button>
          <button className="btn btn-primary" onClick={save} disabled={saving} type="button">{saving ? 'Menyimpan…' : exists ? 'Simpan perubahan' : 'Simpan laporan'}</button>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Laporan {monthName(month)}</h3>
        {list.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Tanggal</th><th>Nama</th><th>Leads</th><th>FU</th><th>Survei</th><th>Booking</th><th>Closing</th><th>Nilai</th><th>Konten</th><th>Catatan</th><th></th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.report_date + 'T00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</td>
                    <td className="cell-strong">{nameOf(r.user_id)}</td>
                    <td>{num(r.leads)}</td><td>{num(r.follow_up)}</td><td>{num(r.survei)}</td><td>{num(r.booking)}</td><td>{num(r.closing)}</td>
                    <td>{r.closing_value ? rp(r.closing_value) : '—'}</td><td>{num(r.konten)}</td>
                    <td className="cell-soft" style={{ maxWidth: 240, whiteSpace: 'normal' }}>{r.notes}</td>
                    <td>
                      <div className="row-actions">
                        {canEditRow(r) && <button className="icon-btn" onClick={() => edit(r)} aria-label="Ubah laporan" title="Ubah">✎</button>}
                        {isAdmin && <button className="icon-btn" onClick={() => remove(r.id)} aria-label="Hapus laporan" title="Hapus">✕</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel-empty">Belum ada laporan di bulan ini.</div>
        )}
      </div>
    </>
  );
}

// =====================================================================
function Iklan({ ads, T, total, adTotal, user, isAdmin, refresh, showToast }) {
  const [f, setF] = useState({ spend_date: ymd(new Date()), platform: PLATFORMS[0], spend: 0, leads: 0, notes: '' });
  const [saving, setSaving] = useState(false);
  const cpl = adTotal.leads ? adTotal.spend / adTotal.leads : 0;
  const pSpend = ratio(adTotal.spend, T.budget);
  const pCpl = cpl && T.cpl_max ? Math.min(1, T.cpl_max / cpl) : 0;

  async function save() {
    if (!f.spend_date) return showToast?.('Isi tanggal.');
    if (!int(f.spend) && !int(f.leads)) return showToast?.('Isi belanja atau jumlah leads.');
    setSaving(true);
    const { error } = await supabase.from('ad_spend').insert({
      spend_date: f.spend_date, platform: f.platform, spend: int(f.spend), leads: int(f.leads),
      notes: f.notes.trim().slice(0, 300) || null, created_by: user?.id,
    });
    setSaving(false);
    if (error) return showToast?.('Gagal menyimpan: ' + error.message);
    showToast?.('Belanja iklan tersimpan');
    setF((x) => ({ ...x, spend: 0, leads: 0, notes: '' }));
    refresh();
  }
  async function remove(id) {
    if (!confirm('Hapus catatan iklan ini?')) return;
    const { error } = await supabase.from('ad_spend').delete().eq('id', id);
    if (error) return showToast?.('Gagal menghapus: ' + error.message);
    showToast?.('Catatan dihapus');
    refresh();
  }

  const by = {};
  ads.forEach((a) => { const p = a.platform || 'Lainnya'; by[p] = by[p] || { s: 0, l: 0 }; by[p].s += Number(a.spend) || 0; by[p].l += Number(a.leads) || 0; });
  const plat = Object.entries(by).sort((a, b) => b[1].s - a[1].s);
  const list = [...ads].sort((a, b) => b.spend_date.localeCompare(a.spend_date));

  return (
    <>
      <div className={s.kpis}>
        <div className="kpi-card"><div className="kpi-label">Belanja iklan</div><div className="kpi-value">{rp(adTotal.spend)}</div><div className={s.kpiSub}>Anggaran {rp(T.budget)}</div><Bar p={pSpend} cls={pSpend > 1 ? s.barLow : pSpend > 0.9 ? s.barMid : s.barOk} /></div>
        <div className="kpi-card"><div className="kpi-label">Leads dari iklan</div><div className="kpi-value">{num(adTotal.leads)}</div><div className={s.kpiSub}>Target divisi {num(T.leads)}</div><Bar p={ratio(adTotal.leads, T.leads)} /></div>
        <div className="kpi-card"><div className="kpi-label">Biaya per lead</div><div className="kpi-value">{cpl ? rp(cpl) : '—'}</div><div className={s.kpiSub}>{T.cpl_max ? 'Batas ' + rp(T.cpl_max) : 'Batas belum diatur'}</div><Bar p={pCpl} cls={pCpl >= 1 ? s.barOk : pCpl >= 0.8 ? s.barMid : s.barLow} /></div>
        <div className="kpi-card"><div className="kpi-label">Biaya per closing</div><div className="kpi-value">{total.closing && adTotal.spend ? rp(adTotal.spend / total.closing) : '—'}</div><div className={s.kpiSub}>Belanja iklan ÷ unit closing</div></div>
      </div>

      <div className="panel">
        <h3>Catat belanja iklan</h3>
        <div className={s.formGrid4}>
          <div className="field"><label>Tanggal</label><input type="date" value={f.spend_date} onChange={(e) => setF({ ...f, spend_date: e.target.value })} /></div>
          <div className="field"><label>Platform</label><select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select></div>
          <div className="field"><label>Belanja (Rp)</label><input type="number" inputMode="numeric" min="0" step="10000" value={f.spend} onChange={(e) => setF({ ...f, spend: e.target.value })} /></div>
          <div className="field"><label>Leads dari iklan</label><input type="number" inputMode="numeric" min="0" value={f.leads} onChange={(e) => setF({ ...f, leads: e.target.value })} /></div>
        </div>
        <div className="field"><label>Catatan kampanye</label><input type="text" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Nama kampanye, materi, audiens" /></div>
        <div className="modal-actions"><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan belanja iklan'}</button></div>
      </div>

      <div className={s.two} style={{ marginTop: 16 }}>
        <div className="panel">
          <h3>Per platform</h3>
          {plat.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Platform</th><th>Belanja</th><th>Leads</th><th>CPL</th></tr></thead>
              <tbody>{plat.map(([p, v]) => <tr key={p}><td className="cell-strong">{p}</td><td>{rp(v.s)}</td><td>{num(v.l)}</td><td>{v.l ? rp(v.s / v.l) : '—'}</td></tr>)}</tbody>
            </table></div>
          ) : <div className="panel-empty">Belum ada catatan iklan bulan ini.</div>}
        </div>
        <div className="panel">
          <h3>Riwayat</h3>
          {list.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Tanggal</th><th>Platform</th><th>Belanja</th><th>Leads</th><th></th></tr></thead>
              <tbody>{list.map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.spend_date + 'T00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}{a.notes && <div className="cell-soft">{a.notes}</div>}</td>
                  <td>{a.platform}</td><td>{rp(a.spend)}</td><td>{num(a.leads)}</td>
                  <td>{(isAdmin || a.created_by === user?.id) && <button className="icon-btn" onClick={() => remove(a.id)} aria-label="Hapus" title="Hapus">✕</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <div className="panel-empty">Belum ada catatan iklan bulan ini.</div>}
        </div>
      </div>
    </>
  );
}

// =====================================================================
function Target({ month, mt, stMap, profiles, refresh, showToast }) {
  const [d, setD] = useState({ ...EMPTY_MT, ...(mt.row || {}) });
  const [rows, setRows] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { setD({ ...EMPTY_MT, ...(mt.row || {}) }); }, [mt]);
  useEffect(() => {
    const r = {};
    profiles.forEach((p) => {
      const t = stMap[p.id];
      r[p.id] = t
        ? { dinilai: t.dinilai, t_closing: t.t_closing, t_survei: t.t_survei, t_leads: t.t_leads, t_fu: t.t_fu }
        : { dinilai: p.role === 'agent', t_closing: 1, t_survei: 8, t_leads: 60, t_fu: 150 };
    });
    setRows(r);
  }, [profiles, stMap]);

  async function saveDivisi() {
    setSaving(true);
    const payload = { month, unit: int(d.unit), omzet: int(d.omzet), leads: int(d.leads), survei: int(d.survei), budget: int(d.budget), cpl_max: int(d.cpl_max), konten: int(d.konten), updated_at: new Date().toISOString() };
    const { error } = await supabase.from('marketing_targets').upsert(payload, { onConflict: 'month' });
    setSaving(false);
    if (error) return showToast?.('Gagal menyimpan: ' + error.message);
    showToast?.('Target divisi ' + monthName(month) + ' tersimpan');
    refresh();
  }
  async function saveStaf() {
    setSaving(true);
    const payload = Object.entries(rows).map(([user_id, r]) => ({
      month, user_id, dinilai: !!r.dinilai, t_closing: int(r.t_closing), t_survei: int(r.t_survei), t_leads: int(r.t_leads), t_fu: int(r.t_fu), updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('staff_targets').upsert(payload, { onConflict: 'month,user_id' });
    setSaving(false);
    if (error) return showToast?.('Gagal menyimpan: ' + error.message);
    showToast?.('Target staf ' + monthName(month) + ' tersimpan');
    refresh();
  }
  const setRow = (id, k, v) => setRows((x) => ({ ...x, [id]: { ...x[id], [k]: v } }));
  const fields = [['unit', 'Unit closing', 1], ['omzet', 'Omzet (Rp)', 10000000], ['leads', 'Leads', 1], ['survei', 'Survei lokasi', 1], ['budget', 'Anggaran iklan (Rp)', 100000], ['cpl_max', 'CPL maksimal (Rp)', 1000], ['konten', 'Konten per bulan', 1]];

  return (
    <>
      <div className="panel">
        <h3>Target divisi · {monthName(month)}</h3>
        {mt.from && mt.from !== month && <div className={s.noticeSoft}>Angka di bawah diambil dari target {monthName(mt.from)}. Simpan untuk menetapkannya sebagai target {monthName(month)}.</div>}
        <div className={s.formGrid4}>
          {fields.map(([k, l, st]) => (
            <div className="field" key={k}><label>{l}</label><input type="number" inputMode="numeric" min="0" step={st} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} /></div>
          ))}
        </div>
        <div className="modal-actions"><button className="btn btn-primary" onClick={saveDivisi} disabled={saving}>Simpan target divisi</button></div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Target pribadi staf · {monthName(month)}</h3>
        <p className={s.note} style={{ marginTop: -6 }}>Centang “Dinilai” untuk staf yang masuk papan kinerja. Target berlaku juga untuk bulan-bulan berikutnya sampai diubah.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Dinilai</th><th>Nama</th><th>Closing</th><th>Survei</th><th>Leads</th><th>Follow-up</th></tr></thead>
            <tbody>
              {profiles.map((p) => {
                const r = rows[p.id];
                if (!r) return null;
                return (
                  <tr key={p.id}>
                    <td><input type="checkbox" checked={!!r.dinilai} onChange={(e) => setRow(p.id, 'dinilai', e.target.checked)} aria-label={'Nilai ' + (p.name || '')} /></td>
                    <td className="cell-strong">{p.name || 'Tanpa nama'}<div className="cell-soft">{p.role === 'admin' ? 'Admin' : 'Agen'}</div></td>
                    {['t_closing', 't_survei', 't_leads', 't_fu'].map((k) => (
                      <td key={k}><input className={s.cellInput} type="number" inputMode="numeric" min="0" value={r[k]} disabled={!r.dinilai} onChange={(e) => setRow(p.id, k, e.target.value)} /></td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="modal-actions"><button className="btn btn-primary" onClick={saveStaf} disabled={saving}>Simpan target staf</button></div>
      </div>
    </>
  );
}
