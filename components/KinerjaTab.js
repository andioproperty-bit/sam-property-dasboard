import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatRupiah } from '../lib/format';
import Modal from './Modal';
import { MonthGrid, Legend } from './AttendanceTab';
import s from './KinerjaTab.module.css';
import {
  jakartaToday,
  fmtMonth,
  fmtDateShort,
  fmtTime,
  monthStart,
  monthEnd,
  addMonths,
  fmtDuration,
  downloadCsv,
  cleanError,
} from './absensiUtils';

const WEIGHTS = { disiplin: 30, leads: 30, closing: 40 };

// Skor 0–100. Komponen tanpa target tidak dihitung, bobot dibagi ulang.
export function scoreOf(r) {
  const comps = [];
  if (r.required && r.workdays > 0) {
    const ok = r.tepat + r.terlambat * 0.5 + r.izin + r.sakit + r.cuti + r.dinas;
    comps.push({ key: 'disiplin', w: WEIGHTS.disiplin, v: Math.min(100, (ok / r.workdays) * 100) });
  }
  if (r.target_leads > 0) comps.push({ key: 'leads', w: WEIGHTS.leads, v: Math.min(1, r.leads / r.target_leads) * 100 });
  if (r.target_closing > 0) comps.push({ key: 'closing', w: WEIGHTS.closing, v: Math.min(1, r.closing / r.target_closing) * 100 });
  if (!comps.length) return { score: null, comps };
  const tw = comps.reduce((a, c) => a + c.w, 0);
  return { score: Math.round(comps.reduce((a, c) => a + c.w * c.v, 0) / tw), comps };
}

export function gradeOf(score) {
  if (score === null || score === undefined) return { g: '–', label: 'Belum ada data', tone: 'none' };
  if (score >= 85) return { g: 'A', label: 'Sangat baik', tone: 'ok' };
  if (score >= 70) return { g: 'B', label: 'Baik', tone: 'good' };
  if (score >= 55) return { g: 'C', label: 'Cukup', tone: 'warn' };
  return { g: 'D', label: 'Perlu perhatian', tone: 'bad' };
}

function pct(a, b) {
  return b ? Math.round((a / b) * 100) : 0;
}

function hadirOf(r) {
  return r.tepat + r.terlambat;
}

function Bar({ label, value, sub, empty }) {
  return (
    <div className={s.bar}>
      <div className={s.barTop}>
        <span>{label}</span>
        <span className={s.barSub}>{sub}</span>
      </div>
      <div className={s.barTrack} aria-hidden="true">
        {!empty && <span className={s.barFill} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />}
      </div>
    </div>
  );
}

export default function KinerjaTab({ user, isAdmin, profiles = [], showToast }) {
  const today = jakartaToday();
  const [month, setMonth] = useState(monthStart(today));
  const [rows, setRows] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('kartu');
  const [targetFor, setTargetFor] = useState(null);
  const [reportsFor, setReportsFor] = useState(null);
  const notify = useCallback((m) => (showToast ? showToast(m) : window.alert(m)), [showToast]);

  const load = useCallback(async () => {
    setLoading(true);
    const [rep, st, set] = await Promise.all([
      supabase.rpc('kinerja_report', { p_month: month }),
      supabase.rpc('att_month_status', { p_month: month }),
      supabase.from('attendance_settings').select('*').eq('id', 1).single(),
    ]);
    if (rep.error) notify('Laporan kinerja gagal dimuat: ' + rep.error.message);
    const map = {};
    (st.data || []).forEach((r) => {
      if (!map[r.user_id]) map[r.user_id] = {};
      map[r.user_id][r.day] = r.status;
    });
    setRows(rep.data || []);
    setStatuses(map);
    setSettings(set.data || null);
    setLoading(false);
  }, [month, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const enriched = useMemo(
    () =>
      rows
        .map((r) => ({ ...r, ...scoreOf(r) }))
        // Akun yang tidak wajib absen & tanpa aktivitas tidak perlu ditampilkan
        .filter((r) => r.required || r.leads || r.closing || r.wa_replies || hadirOf(r)),
    [rows]
  );

  const team = useMemo(() => {
    const req = enriched.filter((r) => r.required);
    const workdays = req.reduce((a, r) => a + r.workdays, 0);
    const hadir = req.reduce((a, r) => a + hadirOf(r), 0);
    const scored = enriched.filter((r) => r.score !== null);
    return {
      kehadiran: pct(hadir, workdays),
      hasWorkdays: workdays > 0,
      terlambat: req.reduce((a, r) => a + r.terlambat, 0),
      lateMin: req.reduce((a, r) => a + r.late_minutes, 0),
      leads: enriched.reduce((a, r) => a + r.leads, 0),
      closing: enriched.reduce((a, r) => a + r.closing, 0),
      sales: enriched.reduce((a, r) => a + Number(r.sales || 0), 0),
      avgScore: scored.length ? Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null,
    };
  }, [enriched]);

  function csvRows() {
    return [
      [
        'Nama',
        'Hari kerja',
        'Hadir',
        'Kehadiran (%)',
        'Terlambat (kali)',
        'Total terlambat (menit)',
        'Izin',
        'Sakit',
        'Cuti',
        'Dinas luar',
        'Tidak hadir',
        'Rata-rata jam masuk',
        'Total jam kerja',
        'Absen di luar kantor',
        'Tidak absen pulang',
        'Lembur (hari libur)',
        'Leads',
        'Target leads',
        'Closing',
        'Target closing',
        'Nilai penjualan',
        'Target nilai penjualan',
        'Komisi',
        'Pesan WA dibalas',
        'Skor',
        'Predikat',
      ],
      ...enriched.map((r) => [
        r.name,
        r.required ? r.workdays : 'tidak wajib',
        hadirOf(r),
        r.required ? pct(hadirOf(r), r.workdays) : '',
        r.terlambat,
        r.late_minutes,
        r.izin,
        r.sakit,
        r.cuti,
        r.dinas,
        r.alpa,
        r.avg_check_in || '',
        fmtDuration(r.work_minutes),
        r.luar_kantor,
        r.no_checkout,
        r.lembur,
        r.leads,
        r.target_leads || '',
        r.closing,
        r.target_closing || '',
        Number(r.sales || 0),
        Number(r.target_sales || 0) || '',
        Number(r.komisi || 0),
        r.wa_replies,
        r.score ?? '',
        gradeOf(r.score).label,
      ]),
    ];
  }

  function printReport() {
    const w = window.open('', '_blank');
    if (!w) return notify('Pop-up diblokir browser. Izinkan pop-up untuk mencetak laporan.');
    const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const printedAt = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
    const body = enriched
      .map((r) => {
        const g = gradeOf(r.score);
        return `<tr>
          <td class="l"><b>${esc(r.name)}</b></td>
          <td>${r.required ? `${hadirOf(r)}/${r.workdays}` : '—'}</td>
          <td>${r.required ? pct(hadirOf(r), r.workdays) + '%' : '—'}</td>
          <td>${r.terlambat}× <span class="m">${r.late_minutes ? fmtDuration(r.late_minutes) : ''}</span></td>
          <td>${r.izin + r.sakit + r.cuti + r.dinas}</td>
          <td>${r.alpa}</td>
          <td>${esc(r.avg_check_in || '—')}</td>
          <td>${r.leads}${r.target_leads ? ` / ${r.target_leads}` : ''}</td>
          <td>${r.closing}${r.target_closing ? ` / ${r.target_closing}` : ''}</td>
          <td class="r">${esc(formatRupiah(r.sales))}</td>
          <td><b>${r.score ?? '–'}</b></td>
          <td class="l">${esc(g.label)}</td>
        </tr>`;
      })
      .join('');
    w.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Laporan Kinerja ${esc(fmtMonth(month))}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a2238; margin: 0; }
  .kop { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #1b2a4a; padding-bottom: 10px; }
  .kop .pt { font-size: 20px; font-weight: bold; color: #1b2a4a; }
  .kop .sub { font-size: 12px; color: #6b6f7d; font-family: Arial, sans-serif; }
  .gold { height: 3px; background: #b8923a; margin-top: 2px; }
  h1 { font-size: 18px; margin: 22px 0 4px; color: #1b2a4a; }
  .period { font-family: Arial, sans-serif; font-size: 12.5px; color: #555; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11.5px; }
  th { background: #1b2a4a; color: #fff; padding: 7px 6px; font-weight: 600; text-align: center; }
  td { border-bottom: 1px solid #dcdfe6; padding: 7px 6px; text-align: center; }
  td.l, th.l { text-align: left; } td.r { text-align: right; } .m { color: #888; }
  .note { font-family: Arial, sans-serif; font-size: 10.5px; color: #666; margin-top: 12px; line-height: 1.5; }
  .sign { margin-top: 36px; display: flex; justify-content: flex-end; font-family: Arial, sans-serif; font-size: 12.5px; }
  .sign div { text-align: center; min-width: 230px; } .sign .sp { height: 64px; }
</style></head><body>
<div class="kop"><div><div class="pt">PT Satya Manggala Propertindo</div><div class="sub">SAM Property · Malang, Jawa Timur · WA 0811-3032-0099</div></div><div class="sub">Dokumen internal</div></div>
<div class="gold"></div>
<h1>Laporan Kinerja Staf</h1>
<div class="period">Periode ${esc(fmtMonth(month))}${month === monthStart(today) ? ' (berjalan, data sampai hari ini)' : ''}</div>
<table><thead><tr>
<th class="l">Nama</th><th>Hadir / hari kerja</th><th>Kehadiran</th><th>Terlambat</th><th>Izin/sakit/cuti/dinas</th><th>Tidak hadir</th><th>Rata-rata masuk</th><th>Leads / target</th><th>Closing / target</th><th>Nilai penjualan</th><th>Skor</th><th class="l">Predikat</th>
</tr></thead><tbody>${body}</tbody></table>
<div class="note">Skor 0–100 = 30% kedisiplinan + 30% pencapaian leads + 40% pencapaian closing. Kedisiplinan: hadir tepat waktu = 1, terlambat = 0,5, izin/sakit/cuti/dinas yang disetujui = 1, tidak hadir = 0. Komponen tanpa target tidak dihitung. Closing dan nilai penjualan diambil dari menu Transaksi. Predikat: A ≥ 85, B ≥ 70, C ≥ 55, D &lt; 55.</div>
<div class="sign"><div>Malang, ${esc(printedAt)}<br>Mengetahui,<div class="sp"></div><b>Simon Andyo Margo (SAM Property)</b></div></div>
<script>window.onload = function(){ window.print(); };</script>
</body></html>`);
    w.document.close();
  }

  return (
    <section>
      <div className="topbar">
        <div>
          <h1>Kinerja</h1>
          <p>{isAdmin ? 'Kehadiran, leads, dan closing setiap staf' : 'Kehadiran, leads, dan closing Anda'}</p>
        </div>
        <div className={s.actions}>
          <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv(`kinerja-${month.slice(0, 7)}.csv`, csvRows())} disabled={!enriched.length}>
            Unduh CSV
          </button>
          <button className="btn btn-primary btn-sm" onClick={printReport} disabled={!enriched.length}>
            Cetak Laporan
          </button>
        </div>
      </div>

      <div className={s.controls}>
        <div className={s.monthNav}>
          <button className="btn btn-ghost btn-sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Bulan sebelumnya">
            ‹
          </button>
          <span className={s.monthLabel}>{fmtMonth(month)}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setMonth(addMonths(month, 1))} disabled={month >= monthStart(today)} aria-label="Bulan berikutnya">
            ›
          </button>
        </div>
        {isAdmin && (
          <div className={s.toggle} role="tablist">
            {[
              ['kartu', 'Kartu'],
              ['tabel', 'Tabel'],
            ].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={view === k} className={`${s.toggleBtn} ${view === k ? s.toggleOn : ''}`} onClick={() => setView(k)}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Kehadiran tim</div>
            <div className="kpi-value accent">{team.hasWorkdays ? `${team.kehadiran}%` : '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Terlambat</div>
            <div className="kpi-value gold">{team.terlambat}×</div>
            <div className={s.kpiNote}>{team.lateMin ? `total ${fmtDuration(team.lateMin)}` : 'tidak ada'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Leads ditangani</div>
            <div className="kpi-value">{team.leads}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Closing</div>
            <div className="kpi-value">{team.closing}</div>
            <div className={s.kpiNote}>{formatRupiah(team.sales)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Skor rata-rata</div>
            <div className="kpi-value">{team.avgScore ?? '—'}</div>
            <div className={s.kpiNote}>{gradeOf(team.avgScore).label}</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="panel-empty">Memuat laporan…</div>
      ) : enriched.length === 0 ? (
        <div className="empty-state">
          <div className="big">Belum ada data</div>
          <div>Data kinerja muncul setelah staf mulai absen dan menangani leads.</div>
        </div>
      ) : view === 'tabel' && isAdmin ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Staf</th>
                <th className={s.num}>Hadir</th>
                <th className={s.num}>Terlambat</th>
                <th className={s.num}>Izin/sakit/cuti</th>
                <th className={s.num}>Tidak hadir</th>
                <th className={s.num}>Rata-rata masuk</th>
                <th className={s.num}>Jam kerja</th>
                <th className={s.num}>Leads</th>
                <th className={s.num}>Closing</th>
                <th className={s.num}>Nilai penjualan</th>
                <th className={s.num}>Skor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {enriched.map((r) => {
                const g = gradeOf(r.score);
                return (
                  <tr key={r.user_id}>
                    <td className="cell-strong">
                      {r.name}
                      {!r.required && <div className="cell-soft">tidak wajib absen</div>}
                    </td>
                    <td className={s.num}>{r.required ? `${hadirOf(r)}/${r.workdays}` : '—'}</td>
                    <td className={s.num}>{r.terlambat}×</td>
                    <td className={s.num}>{r.izin + r.sakit + r.cuti + r.dinas}</td>
                    <td className={s.num}>{r.alpa}</td>
                    <td className={s.num}>{r.avg_check_in || '—'}</td>
                    <td className={s.num}>{fmtDuration(r.work_minutes)}</td>
                    <td className={s.num}>
                      {r.leads}
                      {r.target_leads ? <span className="cell-soft"> / {r.target_leads}</span> : ''}
                    </td>
                    <td className={s.num}>
                      {r.closing}
                      {r.target_closing ? <span className="cell-soft"> / {r.target_closing}</span> : ''}
                    </td>
                    <td className={s.num}>{formatRupiah(r.sales)}</td>
                    <td className={s.num}>
                      <span className={`${s.gradePill} ${s['g_' + g.tone]}`}>
                        {r.score ?? '–'} {g.g !== '–' && `· ${g.g}`}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setTargetFor(r)}>
                        Target
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <>
        <Legend />
        <div className={s.cards}>
          {enriched.map((r) => (
            <StaffCard
              key={r.user_id}
              r={r}
              month={month}
              today={today}
              settings={settings}
              statusByDay={statuses[r.user_id] || {}}
              isAdmin={isAdmin}
              onTarget={() => setTargetFor(r)}
              onReports={() => setReportsFor(r)}
            />
          ))}
        </div>
        </>
      )}

      <p className={s.footnote}>
        Skor 0–100 = 30% kedisiplinan + 30% pencapaian leads + 40% pencapaian closing. Kedisiplinan: tepat waktu = 1, terlambat =
        0,5, izin/sakit/cuti/dinas yang disetujui = 1, tidak hadir = 0. Komponen yang belum punya target tidak dihitung. Leads =
        leads yang ditangani staf dan dibuat di bulan ini (klik WA anonim tidak dihitung). Closing dan nilai penjualan diambil
        dari menu Transaksi.
      </p>

      {targetFor && (
        <TargetModal
          row={targetFor}
          month={month}
          onClose={() => setTargetFor(null)}
          onSaved={() => {
            setTargetFor(null);
            notify('Target disimpan.');
            load();
          }}
        />
      )}
      {reportsFor && <DailyReports row={reportsFor} month={month} onClose={() => setReportsFor(null)} />}
    </section>
  );
}

function StaffCard({ r, month, today, settings, statusByDay, isAdmin, onTarget, onReports }) {
  const g = gradeOf(r.score);
  const disiplin = r.comps.find((c) => c.key === 'disiplin');
  return (
    <article className={s.card}>
      <header className={s.cardHead}>
        <div>
          <h3 className={s.cardName}>{r.name}</h3>
          <div className={s.cardSub}>
            {r.required
              ? `${hadirOf(r)} dari ${r.workdays} hari kerja · rata-rata masuk ${r.avg_check_in || '—'}`
              : 'Tidak wajib absen'}
          </div>
        </div>
        <div className={`${s.score} ${s['g_' + g.tone]}`}>
          <span className={s.scoreNum}>{r.score ?? '–'}</span>
          <span className={s.scoreLabel}>{g.g !== '–' ? `${g.g} · ${g.label}` : g.label}</span>
        </div>
      </header>

      {r.required && settings && (
        <div className={s.strip}>
          <MonthGrid month={month} statusByDay={statusByDay} settings={settings} today={today} compact />
        </div>
      )}

      <div className={s.bars}>
        {r.required && (
          <Bar
            label="Kedisiplinan"
            value={disiplin ? disiplin.v : 0}
            empty={!disiplin}
            sub={disiplin ? `${Math.round(disiplin.v)}%` : 'belum ada hari kerja'}
          />
        )}
        <Bar
          label="Leads"
          value={r.target_leads ? (r.leads / r.target_leads) * 100 : 0}
          empty={!r.target_leads}
          sub={r.target_leads ? `${r.leads} / ${r.target_leads}` : `${r.leads} · target belum diatur`}
        />
        <Bar
          label="Closing"
          value={r.target_closing ? (r.closing / r.target_closing) * 100 : 0}
          empty={!r.target_closing}
          sub={r.target_closing ? `${r.closing} / ${r.target_closing}` : `${r.closing} · target belum diatur`}
        />
        {Number(r.target_sales) > 0 && (
          <Bar
            label="Nilai penjualan"
            value={(Number(r.sales) / Number(r.target_sales)) * 100}
            sub={`${formatRupiah(r.sales)} / ${formatRupiah(r.target_sales)}`}
          />
        )}
      </div>

      <dl className={s.facts}>
        {r.required && (
          <>
            <div>
              <dt>Terlambat</dt>
              <dd>
                {r.terlambat}× {r.late_minutes > 0 && <span className={s.dim}>({fmtDuration(r.late_minutes)})</span>}
              </dd>
            </div>
            <div>
              <dt>Izin / sakit / cuti</dt>
              <dd>
                {r.izin} / {r.sakit} / {r.cuti}
                {r.dinas > 0 && <span className={s.dim}> · dinas {r.dinas}</span>}
              </dd>
            </div>
            <div>
              <dt>Tidak hadir</dt>
              <dd className={r.alpa ? s.bad : ''}>{r.alpa} hari</dd>
            </div>
          </>
        )}
        <div>
          <dt>Total jam kerja</dt>
          <dd>{fmtDuration(r.work_minutes)}</dd>
        </div>
        <div>
          <dt>Absen di luar kantor</dt>
          <dd>{r.luar_kantor}×</dd>
        </div>
        <div>
          <dt>Tidak absen pulang</dt>
          <dd className={r.no_checkout ? s.bad : ''}>{r.no_checkout}×</dd>
        </div>
        <div>
          <dt>Nilai penjualan</dt>
          <dd>{formatRupiah(r.sales)}</dd>
        </div>
        <div>
          <dt>Komisi</dt>
          <dd>{formatRupiah(r.komisi)}</dd>
        </div>
        {r.wa_replies > 0 && (
          <div>
            <dt>Pesan WA dibalas</dt>
            <dd>{r.wa_replies}</dd>
          </div>
        )}
        {r.pending_leave > 0 && (
          <div>
            <dt>Izin menunggu</dt>
            <dd className={s.warnText}>{r.pending_leave}</dd>
          </div>
        )}
      </dl>

      <footer className={s.cardFoot}>
        <button className="btn btn-ghost btn-sm" onClick={onReports}>
          Laporan harian
        </button>
        {isAdmin && (
          <button className="btn btn-ghost btn-sm" onClick={onTarget}>
            Atur target
          </button>
        )}
      </footer>
    </article>
  );
}

function TargetModal({ row, month, onClose, onSaved }) {
  const [f, setF] = useState({
    target_leads: row.target_leads || '',
    target_closing: row.target_closing || '',
    target_sales: Number(row.target_sales) || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setSaving(true);
    setError('');
    const { error: e } = await supabase.from('staff_targets').upsert(
      {
        user_id: row.user_id,
        month,
        target_leads: Math.max(0, parseInt(f.target_leads, 10) || 0),
        target_closing: Math.max(0, parseInt(f.target_closing, 10) || 0),
        target_sales: Math.max(0, Number(String(f.target_sales).replace(/\D/g, '')) || 0),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,month' }
    );
    setSaving(false);
    if (e) return setError(cleanError(e));
    onSaved();
  }

  return (
    <Modal onClose={onClose}>
      <h3>Target {row.name}</h3>
      <p className={s.dim} style={{ marginTop: -8 }}>
        {fmtMonth(month)}
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="t-leads">Target leads</label>
          <input id="t-leads" type="number" min="0" value={f.target_leads} onChange={(e) => set('target_leads', e.target.value)} placeholder="mis. 30" />
        </div>
        <div className="field">
          <label htmlFor="t-closing">Target closing (unit)</label>
          <input id="t-closing" type="number" min="0" value={f.target_closing} onChange={(e) => set('target_closing', e.target.value)} placeholder="mis. 2" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="t-sales">Target nilai penjualan (Rp, opsional)</label>
        <input
          id="t-sales"
          inputMode="numeric"
          value={f.target_sales ? Number(String(f.target_sales).replace(/\D/g, '')).toLocaleString('id-ID') : ''}
          onChange={(e) => set('target_sales', e.target.value.replace(/\D/g, ''))}
          placeholder="mis. 1.000.000.000"
        />
      </div>
      <div className="field-hint">Isi 0 atau kosongkan jika tidak memakai target tersebut.</div>
      {error && <div className={s.errorBox}>{error}</div>}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
          Batal
        </button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Menyimpan…' : 'Simpan Target'}
        </button>
      </div>
    </Modal>
  );
}

function DailyReports({ row, month, onClose }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    supabase
      .from('attendance')
      .select('work_date, check_in_at, check_out_at, check_in_note, daily_report, late_minutes')
      .eq('user_id', row.user_id)
      .gte('work_date', month)
      .lte('work_date', monthEnd(month))
      .order('work_date', { ascending: false })
      .then(({ data }) => setItems(data || []));
  }, [row, month]);

  return (
    <Modal onClose={onClose}>
      <h3>Laporan harian · {row.name}</h3>
      <p className={s.dim} style={{ marginTop: -8 }}>
        {fmtMonth(month)}
      </p>
      {items === null ? (
        <div className="panel-empty">Memuat…</div>
      ) : items.length === 0 ? (
        <div className="panel-empty">Belum ada laporan di bulan ini.</div>
      ) : (
        <ol className={s.reports}>
          {items.map((i) => (
            <li key={i.work_date}>
              <div className={s.reportHead}>
                <b>{fmtDateShort(i.work_date)}</b>
                <span className={s.dim}>
                  {fmtTime(i.check_in_at)}–{i.check_out_at ? fmtTime(i.check_out_at) : '?'}
                  {i.late_minutes > 0 && ` · telat ${fmtDuration(i.late_minutes)}`}
                </span>
              </div>
              {i.check_in_note && <p className={s.reportNote}>Di luar kantor: {i.check_in_note}</p>}
              <p className={s.reportText}>{i.daily_report || <span className={s.dim}>Tidak ada laporan (belum absen pulang).</span>}</p>
            </li>
          ))}
        </ol>
      )}
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onClose}>
          Tutup
        </button>
      </div>
    </Modal>
  );
}

