import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import Modal from './Modal';
import s from './AttendanceTab.module.css';
import {
  STATUS,
  LEAVE_KIND,
  PLACE_LABEL,
  DAY_SHORT,
  DAY_LONG,
  jakartaToday,
  jakartaMinutesNow,
  clockText,
  fmtTime,
  timeInputValue,
  fmtDateLong,
  fmtDateShort,
  fmtMonth,
  monthStart,
  monthEnd,
  addMonths,
  daysInMonth,
  isoDow,
  toMinutes,
  hhmm,
  fmtDuration,
  fmtDistance,
  mapsUrl,
  distanceM,
  getPosition,
  compressImage,
  signedUrl,
  uploadAttendanceFile,
  downloadCsv,
  cleanError,
} from './absensiUtils';

// =====================================================================
// Kalender bulanan berwarna (dipakai juga di tab Kinerja)
// =====================================================================
export function MonthGrid({ month, statusByDay = {}, settings, today, compact = false }) {
  const days = daysInMonth(month);
  const lead = isoDow(days[0]) - 1;
  const workDays = settings?.work_days || [1, 2, 3, 4, 5, 6];
  const holidays = settings?.holidays || [];

  function statusOf(d) {
    if (statusByDay[d]) return statusByDay[d];
    if (!workDays.includes(isoDow(d)) || holidays.includes(d)) return 'libur';
    return d > today ? 'future' : 'belum';
  }

  return (
    <div className={`${s.grid} ${compact ? s.gridCompact : ''}`}>
      {!compact &&
        DAY_SHORT.map((d) => (
          <div key={d} className={s.gridHead}>
            {d}
          </div>
        ))}
      {!compact && Array.from({ length: lead }).map((_, i) => <div key={'x' + i} />)}
      {days.map((d) => {
        const st = statusOf(d);
        const meta = STATUS[st];
        return (
          <div
            key={d}
            className={`${s.cell} ${s['tone_' + (meta?.tone || 'future')]} ${d === today ? s.cellToday : ''}`}
            title={`${fmtDateShort(d)} · ${meta ? meta.label : 'Belum lewat'}`}
          >
            {Number(d.slice(8))}
          </div>
        );
      })}
    </div>
  );
}

export function Legend() {
  const items = [
    ['ok', 'Tepat waktu'],
    ['warn', 'Terlambat'],
    ['info', 'Izin / sakit / cuti / dinas'],
    ['bad', 'Tidak hadir'],
    ['off', 'Libur'],
  ];
  return (
    <div className={s.legend}>
      {items.map(([t, l]) => (
        <span key={t} className={s.legendItem}>
          <span className={`${s.legendDot} ${s['tone_' + t]}`} />
          {l}
        </span>
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  const meta = STATUS[status] || STATUS.belum;
  return <span className={`${s.badge} ${s['tone_' + meta.tone]}`}>{meta.label}</span>;
}

// =====================================================================
// Halaman utama Absensi
// =====================================================================
export default function AttendanceTab({ user, isAdmin, profiles = [], showToast }) {
  const [view, setView] = useState('saya');
  const [settings, setSettings] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const notify = useCallback((m) => (showToast ? showToast(m) : window.alert(m)), [showToast]);

  const loadSettings = useCallback(async () => {
    const { data, error } = await supabase.from('attendance_settings').select('*').eq('id', 1).single();
    if (error) notify('Pengaturan absensi gagal dimuat: ' + error.message);
    setSettings(data || null);
  }, [notify]);

  const loadPending = useCallback(async () => {
    let q = supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'menunggu');
    if (!isAdmin) q = q.eq('user_id', user.id);
    const { count } = await q;
    setPendingCount(count || 0);
  }, [isAdmin, user]);

  useEffect(() => {
    loadSettings();
    loadPending();
  }, [loadSettings, loadPending]);

  const views = [
    { key: 'saya', label: 'Absen Saya' },
    ...(isAdmin ? [{ key: 'tim', label: 'Rekap Tim' }] : []),
    { key: 'izin', label: isAdmin ? 'Pengajuan Izin' : 'Izin Saya', count: pendingCount },
    ...(isAdmin ? [{ key: 'atur', label: 'Pengaturan' }] : []),
  ];

  return (
    <section>
      <div className="topbar">
        <div>
          <h1>Absensi</h1>
          <p>{fmtDateLong(jakartaToday())}</p>
        </div>
      </div>

      <div className={s.tabs} role="tablist">
        {views.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            className={`${s.tab} ${view === v.key ? s.tabOn : ''}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
            {v.count > 0 && <span className={s.tabCount}>{v.count}</span>}
          </button>
        ))}
      </div>

      {!settings ? (
        <div className="panel-empty">Memuat…</div>
      ) : view === 'saya' ? (
        <MyAttendance user={user} isAdmin={isAdmin} settings={settings} notify={notify} goSettings={() => setView('atur')} />
      ) : view === 'tim' ? (
        <TeamRecap profiles={profiles} settings={settings} notify={notify} />
      ) : view === 'izin' ? (
        <LeaveView user={user} isAdmin={isAdmin} profiles={profiles} notify={notify} onChanged={loadPending} />
      ) : (
        <SettingsView settings={settings} profiles={profiles} notify={notify} onSaved={loadSettings} />
      )}
    </section>
  );
}

// =====================================================================
// ABSEN SAYA
// =====================================================================
function MyAttendance({ user, isAdmin, settings, notify, goSettings }) {
  const today = jakartaToday();
  const [now, setNow] = useState(new Date());
  const [month, setMonth] = useState(monthStart(today));
  const [records, setRecords] = useState([]);
  const [statusByDay, setStatusByDay] = useState({});
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // 'in' | 'out' | null
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [att, st] = await Promise.all([
      supabase
        .from('attendance')
        .select('*')
        .eq('user_id', user.id)
        .gte('work_date', month)
        .lte('work_date', monthEnd(month))
        .order('work_date', { ascending: false }),
      supabase.rpc('att_month_status', { p_month: month }),
    ]);
    if (att.error) notify('Riwayat absensi gagal dimuat: ' + att.error.message);
    setRecords(att.data || []);
    const map = {};
    (st.data || []).filter((r) => r.user_id === user.id).forEach((r) => (map[r.day] = r.status));
    setStatusByDay(map);
    setLoading(false);
  }, [user, month, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const todayRec = month === monthStart(today) ? records.find((r) => r.work_date === today) : null;
  const [todayRecFallback, setTodayRecFallback] = useState(null);
  useEffect(() => {
    if (month === monthStart(today)) return;
    supabase
      .from('attendance')
      .select('*')
      .eq('user_id', user.id)
      .eq('work_date', today)
      .maybeSingle()
      .then(({ data }) => setTodayRecFallback(data || null));
  }, [month, today, user]);
  const rec = month === monthStart(today) ? todayRec : todayRecFallback;

  const exempt = (settings.exempt_user_ids || []).includes(user.id);
  const workday = (settings.work_days || []).includes(isoDow(today)) && !(settings.holidays || []).includes(today);
  const nowMin = jakartaMinutesNow();
  const startMin = toMinutes(settings.work_start);
  const lateNow = workday && nowMin > startMin + settings.late_grace_min;

  const counts = useMemo(() => {
    const c = { hadir: 0, terlambat: 0, izin: 0, alpa: 0 };
    Object.values(statusByDay).forEach((st) => {
      if (st === 'tepat') c.hadir += 1;
      else if (st === 'terlambat') {
        c.hadir += 1;
        c.terlambat += 1;
      } else if (['izin', 'sakit', 'cuti', 'dinas'].includes(st)) c.izin += 1;
      else if (st === 'alpa') c.alpa += 1;
    });
    return c;
  }, [statusByDay]);

  let state = 'in';
  if (rec && !rec.check_out_at) state = 'out';
  if (rec && rec.check_out_at) state = 'done';

  return (
    <>
      {settings.office_lat == null && (
        <div className={s.warnBox}>
          Lokasi kantor belum diatur, jadi absen belum bisa membedakan di kantor atau di luar kantor.
          {isAdmin ? (
            <button className={s.linkBtn} onClick={goSettings}>
              Atur sekarang
            </button>
          ) : (
            ' Minta admin mengatur lokasi kantor.'
          )}
        </div>
      )}

      <div className={s.hero}>
        <div className={s.heroMain}>
          <div className={s.clock} aria-live="off">
            {clockText(now)}
            <span className={s.clockTz}>WIB</span>
          </div>
          <div className={s.heroSub}>
            {workday
              ? `Jam kerja ${hhmm(settings.work_start)}–${hhmm(settings.work_end)} · toleransi ${settings.late_grace_min} mnt`
              : 'Hari ini libur. Absen tetap tercatat sebagai lembur.'}
            {exempt && ' · Akun ini tidak wajib absen'}
          </div>
          <div className={s.heroAction}>
            {state === 'in' && (
              <button className={s.bigBtn} onClick={() => setModal('in')}>
                Absen Masuk
              </button>
            )}
            {state === 'out' && (
              <button className={`${s.bigBtn} ${s.bigBtnOut}`} onClick={() => setModal('out')}>
                Absen Pulang
              </button>
            )}
            {state === 'done' && <div className={s.doneText}>Absensi hari ini lengkap. Terima kasih!</div>}
            {state === 'in' && lateNow && (
              <div className={s.heroHint}>
                Sudah lewat {fmtDuration(nowMin - startMin)} dari jam masuk, absen akan tercatat terlambat.
              </div>
            )}
          </div>
        </div>
        <div className={s.heroStats}>
          <div className={s.heroStat}>
            <span className={s.heroLabel}>Masuk</span>
            <span className={s.heroValue}>{rec ? fmtTime(rec.check_in_at) : '—'}</span>
            <span className={s.heroMeta}>
              {rec
                ? rec.late_minutes > 0
                  ? `Terlambat ${fmtDuration(rec.late_minutes)}`
                  : PLACE_LABEL[rec.check_in_place] || 'Tepat waktu'
                : 'Belum absen'}
            </span>
          </div>
          <div className={s.heroStat}>
            <span className={s.heroLabel}>Pulang</span>
            <span className={s.heroValue}>{rec?.check_out_at ? fmtTime(rec.check_out_at) : '—'}</span>
            <span className={s.heroMeta}>
              {rec?.check_out_at
                ? `Kerja ${fmtDuration((new Date(rec.check_out_at) - new Date(rec.check_in_at)) / 60000)}`
                : rec
                ? 'Jangan lupa absen pulang'
                : '—'}
            </span>
          </div>
        </div>
      </div>

      <div className={s.twoCol}>
        <div className="panel">
          <div className={s.panelHead}>
            <h3>Kalender {fmtMonth(month)}</h3>
            <div className={s.monthNav}>
              <button className="btn btn-ghost btn-sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Bulan sebelumnya">
                ‹
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setMonth(addMonths(month, 1))}
                disabled={month >= monthStart(today)}
                aria-label="Bulan berikutnya"
              >
                ›
              </button>
            </div>
          </div>
          <MonthGrid month={month} statusByDay={statusByDay} settings={settings} today={today} />
          <Legend />
          <div className={s.miniStats}>
            <span>
              <b>{counts.hadir}</b> hadir
            </span>
            <span>
              <b>{counts.terlambat}</b> terlambat
            </span>
            <span>
              <b>{counts.izin}</b> izin/sakit/cuti
            </span>
            <span>
              <b>{counts.alpa}</b> tidak hadir
            </span>
          </div>
        </div>

        <div className="panel">
          <h3>Riwayat {fmtMonth(month)}</h3>
          {loading ? (
            <div className="panel-empty">Memuat…</div>
          ) : records.length === 0 ? (
            <div className="panel-empty">Belum ada absensi di bulan ini.</div>
          ) : (
            <ul className={s.history}>
              {records.map((r) => (
                <li key={r.id}>
                  <button className={s.historyItem} onClick={() => setDetail(r)}>
                    <span className={s.historyDate}>{fmtDateShort(r.work_date)}</span>
                    <span className={s.historyTimes}>
                      {fmtTime(r.check_in_at)} – {r.check_out_at ? fmtTime(r.check_out_at) : <em>belum pulang</em>}
                    </span>
                    <StatusBadge status={r.late_minutes > 0 ? 'terlambat' : 'tepat'} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {modal && (
        <CheckModal
          mode={modal}
          user={user}
          settings={settings}
          onClose={() => setModal(null)}
          onDone={(msg) => {
            setModal(null);
            notify(msg);
            if (month !== monthStart(today)) setMonth(monthStart(today));
            else load();
          }}
        />
      )}
      {detail && <RecordDetail record={detail} settings={settings} onClose={() => setDetail(null)} />}
    </>
  );
}

// =====================================================================
// Kamera selfie (kamera langsung; cadangan: pilih dari kamera HP)
// =====================================================================
function Camera({ onCapture, captured, onRetake }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    if (captured) {
      const u = URL.createObjectURL(captured);
      setPreviewUrl(u);
      stop();
      return () => URL.revokeObjectURL(u);
    }
    setPreviewUrl(null);
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Kamera langsung tidak tersedia di browser ini.');
      return undefined;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setReady(true);
      })
      .catch(() => setError('Izin kamera ditolak atau kamera sedang dipakai aplikasi lain.'));
    return () => {
      cancelled = true;
      stop();
    };
  }, [captured]);

  async function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const size = Math.min(v.videoWidth, v.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    ctx.translate(720, 0);
    ctx.scale(-1, 1); // cermin, sama seperti yang terlihat di layar
    ctx.drawImage(v, (v.videoWidth - size) / 2, (v.videoHeight - size) / 2, size, size, 0, 0, 720, 720);
    canvas.toBlob((b) => b && onCapture(b), 'image/jpeg', 0.75);
  }

  async function pickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) onCapture(await compressImage(f));
  }

  if (previewUrl) {
    return (
      <div className={s.camBox}>
        <img src={previewUrl} alt="Foto selfie" className={s.camMedia} />
        <button className={`btn btn-ghost btn-sm ${s.camBtn}`} onClick={onRetake}>
          Ulangi foto
        </button>
      </div>
    );
  }

  return (
    <div className={s.camBox}>
      {error ? (
        <div className={s.camFallback}>
          <p>{error}</p>
          <label className="btn btn-primary">
            Buka kamera HP
            <input type="file" accept="image/*" capture="user" onChange={pickFile} className={s.hidden} />
          </label>
        </div>
      ) : (
        <>
          <video ref={videoRef} playsInline muted className={`${s.camMedia} ${s.mirror}`} />
          <button className={`btn btn-primary ${s.camBtn}`} onClick={snap} disabled={!ready}>
            {ready ? 'Ambil Foto' : 'Menyalakan kamera…'}
          </button>
        </>
      )}
    </div>
  );
}

// =====================================================================
// Modal absen masuk / pulang
// =====================================================================
function CheckModal({ mode, user, settings, onClose, onDone }) {
  const [pos, setPos] = useState(null);
  const [posError, setPosError] = useState('');
  const [locating, setLocating] = useState(true);
  const [photo, setPhoto] = useState(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const needPhoto = mode === 'in' && settings.require_photo;
  const officeSet = settings.office_lat != null && settings.office_lng != null;
  const dist = pos && officeSet ? distanceM(settings.office_lat, settings.office_lng, pos.lat, pos.lng) : null;
  const inOffice = dist != null && dist <= settings.radius_m + Math.min(pos.accuracy || 0, 100);
  const outside = officeSet && pos && !inOffice;

  const locate = useCallback(async () => {
    setLocating(true);
    setPosError('');
    try {
      setPos(await getPosition());
    } catch (e) {
      setPos(null);
      setPosError(e.message);
    } finally {
      setLocating(false);
    }
  }, []);

  useEffect(() => {
    locate();
  }, [locate]);

  const textOk = mode === 'out' ? text.trim().length >= 10 : !outside || text.trim().length >= 5;
  const canSubmit = !!pos && (!needPhoto || !!photo) && textOk && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      if (mode === 'in') {
        const path = photo ? await uploadAttendanceFile(user.id, photo, 'masuk') : null;
        const { error: e } = await supabase.rpc('att_check_in', {
          p_lat: pos.lat,
          p_lng: pos.lng,
          p_accuracy: pos.accuracy,
          p_photo: path,
          p_note: text.trim(),
        });
        if (e) throw e;
        onDone('Absen masuk berhasil.');
      } else {
        const { error: e } = await supabase.rpc('att_check_out', {
          p_lat: pos.lat,
          p_lng: pos.lng,
          p_accuracy: pos.accuracy,
          p_report: text.trim(),
        });
        if (e) throw e;
        onDone('Absen pulang berhasil. Selamat istirahat!');
      }
    } catch (e) {
      setError(cleanError(e));
      setSaving(false);
    }
  }

  return (
    <Modal onClose={saving ? () => {} : onClose}>
      <h3>{mode === 'in' ? 'Absen Masuk' : 'Absen Pulang'}</h3>

      {needPhoto && (
        <Camera captured={photo} onCapture={setPhoto} onRetake={() => setPhoto(null)} />
      )}

      <div className={`${s.locBox} ${outside ? s.locOut : pos ? s.locIn : ''}`}>
        <div className={s.locText}>
          {locating ? (
            'Mencari lokasi GPS…'
          ) : posError ? (
            posError
          ) : !officeSet ? (
            `Lokasi tercatat (akurasi ±${pos.accuracy} m). Lokasi kantor belum diatur admin.`
          ) : inOffice ? (
            <>
              <b>Di area kantor</b> · {fmtDistance(dist)} dari {settings.office_name} (akurasi ±{pos.accuracy} m)
            </>
          ) : (
            <>
              <b>Di luar area kantor</b> · {fmtDistance(dist)} dari {settings.office_name} (akurasi ±{pos.accuracy} m)
            </>
          )}
        </div>
        {!locating && (
          <button className={s.linkBtn} onClick={locate}>
            Perbarui
          </button>
        )}
      </div>

      <div className="field">
        <label htmlFor="att-text">
          {mode === 'out' ? 'Laporan kegiatan hari ini' : outside ? 'Keterangan kegiatan di luar kantor' : 'Keterangan (opsional)'}
        </label>
        <textarea
          id="att-text"
          rows={mode === 'out' ? 4 : 2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            mode === 'out'
              ? 'Contoh: Follow-up 6 leads, survei Metro Park bersama Pak Budi, posting 2 konten IG.'
              : 'Contoh: Survei lokasi Metro Park dengan calon pembeli.'
          }
          maxLength={1500}
        />
      </div>
      {mode === 'out' && text.trim().length > 0 && text.trim().length < 10 && (
        <div className="field-hint">Tulis minimal 10 karakter.</div>
      )}

      {error && <div className={s.errorBox}>{error}</div>}

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
          Batal
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
          {saving ? 'Menyimpan…' : mode === 'in' ? 'Kirim Absen Masuk' : 'Kirim Absen Pulang'}
        </button>
      </div>
    </Modal>
  );
}

// =====================================================================
// Detail satu absensi
// =====================================================================
function RecordDetail({ record: r, settings, name, onClose, onCorrect }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  useEffect(() => {
    if (r.check_in_photo) signedUrl(r.check_in_photo).then(setPhotoUrl);
  }, [r.check_in_photo]);

  const duration = r.check_out_at ? (new Date(r.check_out_at) - new Date(r.check_in_at)) / 60000 : null;

  return (
    <Modal onClose={onClose}>
      <h3>{name ? `${name} · ` : ''}{fmtDateShort(r.work_date)}</h3>
      {photoUrl && (
        <a href={photoUrl} target="_blank" rel="noreferrer">
          <img src={photoUrl} alt="Foto selfie absen masuk" className={s.detailPhoto} />
        </a>
      )}
      <dl className={s.detailList}>
        <dt>Masuk</dt>
        <dd>
          {fmtTime(r.check_in_at)}
          {r.late_minutes > 0 ? ` · terlambat ${fmtDuration(r.late_minutes)}` : ' · tepat waktu'}
          {!r.is_workday && ' · lembur (hari libur)'}
        </dd>
        <dt>Lokasi masuk</dt>
        <dd>
          {PLACE_LABEL[r.check_in_place] || '—'}
          {r.check_in_distance_m != null && ` · ${fmtDistance(r.check_in_distance_m)} dari kantor`}
          {r.check_in_lat != null && (
            <>
              {' · '}
              <a href={mapsUrl(r.check_in_lat, r.check_in_lng)} target="_blank" rel="noreferrer">
                Lihat peta
              </a>
            </>
          )}
        </dd>
        {r.check_in_note && (
          <>
            <dt>Keterangan</dt>
            <dd>{r.check_in_note}</dd>
          </>
        )}
        <dt>Pulang</dt>
        <dd>
          {r.check_out_at ? fmtTime(r.check_out_at) : 'Belum absen pulang'}
          {r.early_minutes > 0 && ` · pulang ${fmtDuration(r.early_minutes)} lebih awal`}
          {duration != null && ` · kerja ${fmtDuration(duration)}`}
        </dd>
        {r.check_out_lat != null && (
          <>
            <dt>Lokasi pulang</dt>
            <dd>
              {PLACE_LABEL[r.check_out_place] || '—'}
              {r.check_out_distance_m != null && ` · ${fmtDistance(r.check_out_distance_m)} dari kantor`}
              {' · '}
              <a href={mapsUrl(r.check_out_lat, r.check_out_lng)} target="_blank" rel="noreferrer">
                Lihat peta
              </a>
            </dd>
          </>
        )}
        <dt>Laporan kegiatan</dt>
        <dd className={s.preline}>{r.daily_report || '—'}</dd>
        {r.admin_note && (
          <>
            <dt>Catatan admin</dt>
            <dd>{r.admin_note}</dd>
          </>
        )}
      </dl>
      <div className="modal-actions">
        {onCorrect && (
          <button className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={onCorrect}>
            Koreksi
          </button>
        )}
        <button className="btn btn-primary" onClick={onClose}>
          Tutup
        </button>
      </div>
    </Modal>
  );
}

// =====================================================================
// REKAP TIM (Admin)
// =====================================================================
function TeamRecap({ profiles, settings, notify }) {
  const today = jakartaToday();
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [correct, setCorrect] = useState(null);
  const [thumbs, setThumbs] = useState({});
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, l] = await Promise.all([
      supabase.from('attendance').select('*').eq('work_date', date),
      supabase.from('leave_requests').select('*').eq('status', 'disetujui').lte('start_date', date).gte('end_date', date),
    ]);
    if (a.error) notify('Rekap gagal dimuat: ' + a.error.message);
    setRows(a.data || []);
    setLeaves(l.data || []);
    setLoading(false);
    (a.data || []).forEach((r) => {
      if (r.check_in_photo) signedUrl(r.check_in_photo).then((u) => setThumbs((t) => ({ ...t, [r.id]: u })));
    });
  }, [date, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const exempt = settings.exempt_user_ids || [];
  const workday = (settings.work_days || []).includes(isoDow(date)) && !(settings.holidays || []).includes(date);
  const afterEnd = date < today || (date === today && jakartaMinutesNow() >= toMinutes(settings.work_end));

  const list = profiles
    .map((p) => {
      const rec = rows.find((r) => r.user_id === p.id) || null;
      const lv = leaves.find((l) => l.user_id === p.id) || null;
      let status;
      if (rec) status = rec.late_minutes > 0 ? 'terlambat' : 'tepat';
      else if (lv) status = lv.kind;
      else if (exempt.includes(p.id)) status = 'bebas';
      else if (!workday) status = 'libur';
      else status = afterEnd ? 'alpa' : 'belum';
      return { p, rec, lv, status };
    })
    .sort((a, b) => Number(exempt.includes(a.p.id)) - Number(exempt.includes(b.p.id)) || (a.p.name || '').localeCompare(b.p.name || ''));

  const required = list.filter((x) => !exempt.includes(x.p.id));
  const k = {
    hadir: required.filter((x) => x.rec).length,
    terlambat: required.filter((x) => x.status === 'terlambat').length,
    izin: required.filter((x) => ['izin', 'sakit', 'cuti', 'dinas'].includes(x.status)).length,
    belum: required.filter((x) => x.status === 'belum' || x.status === 'alpa').length,
  };

  async function exportMonth() {
    setExporting(true);
    const m = monthStart(date);
    const { data, error } = await supabase
      .from('attendance')
      .select('*')
      .gte('work_date', m)
      .lte('work_date', monthEnd(m))
      .order('work_date');
    setExporting(false);
    if (error) return notify('Gagal mengambil data: ' + error.message);
    const nameOf = (id) => profiles.find((p) => p.id === id)?.name || 'Staf';
    downloadCsv(`absensi-${m.slice(0, 7)}.csv`, [
      ['Tanggal', 'Nama', 'Masuk', 'Pulang', 'Durasi kerja', 'Terlambat (menit)', 'Pulang awal (menit)', 'Lokasi masuk', 'Jarak dari kantor (m)', 'Keterangan', 'Laporan kegiatan', 'Catatan admin'],
      ...(data || []).map((r) => [
        r.work_date,
        nameOf(r.user_id),
        fmtTime(r.check_in_at),
        r.check_out_at ? fmtTime(r.check_out_at) : '',
        r.check_out_at ? fmtDuration((new Date(r.check_out_at) - new Date(r.check_in_at)) / 60000) : '',
        r.late_minutes,
        r.early_minutes,
        PLACE_LABEL[r.check_in_place] || '',
        r.check_in_distance_m ?? '',
        r.check_in_note || '',
        r.daily_report || '',
        r.admin_note || '',
      ]),
    ]);
  }

  return (
    <>
      <div className="filter-row">
        <input type="date" className={s.dateInput} value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <span className={s.muted}>{fmtDateLong(date)}{!workday && ' · hari libur'}</span>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={exportMonth} disabled={exporting}>
          {exporting ? 'Menyiapkan…' : `Unduh CSV ${fmtMonth(date)}`}
        </button>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Hadir</div>
          <div className="kpi-value accent">
            {k.hadir}
            <span className={s.kpiOf}> / {required.length}</span>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Terlambat</div>
          <div className="kpi-value gold">{k.terlambat}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Izin / sakit / cuti</div>
          <div className="kpi-value">{k.izin}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">{afterEnd ? 'Tidak hadir' : 'Belum absen'}</div>
          <div className={`kpi-value ${k.belum ? s.textBad : ''}`}>{k.belum}</div>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? (
          <div className="panel-empty">Memuat…</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Staf</th>
                <th>Status</th>
                <th>Masuk</th>
                <th>Pulang</th>
                <th>Lokasi</th>
                <th>Laporan kegiatan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map(({ p, rec, lv, status }) => (
                <tr key={p.id}>
                  <td>
                    <div className={s.staffCell}>
                      {rec && thumbs[rec.id] ? (
                        <img src={thumbs[rec.id]} alt="" className={s.thumb} />
                      ) : (
                        <span className={s.thumbEmpty}>{(p.name || '?').slice(0, 2).toUpperCase()}</span>
                      )}
                      <span className="cell-strong">{p.name}</span>
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={status} />
                    {lv && <div className="cell-soft">{lv.reason}</div>}
                  </td>
                  <td>
                    {rec ? fmtTime(rec.check_in_at) : '—'}
                    {rec?.late_minutes > 0 && <div className="cell-soft">+{fmtDuration(rec.late_minutes)}</div>}
                  </td>
                  <td>{rec?.check_out_at ? fmtTime(rec.check_out_at) : rec ? <span className="cell-soft">belum</span> : '—'}</td>
                  <td>
                    {rec ? (
                      <>
                        {PLACE_LABEL[rec.check_in_place] || '—'}
                        {rec.check_in_distance_m != null && <div className="cell-soft">{fmtDistance(rec.check_in_distance_m)}</div>}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={s.reportCell}>{rec?.daily_report || rec?.check_in_note || <span className="cell-soft">—</span>}</td>
                  <td>
                    <div className="row-actions">
                      {rec && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setDetail({ rec, name: p.name })}>
                          Detail
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => setCorrect({ p, rec })}>
                        {rec ? 'Koreksi' : 'Input manual'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <RecordDetail
          record={detail.rec}
          name={detail.name}
          settings={settings}
          onClose={() => setDetail(null)}
          onCorrect={() => {
            const p = profiles.find((x) => x.id === detail.rec.user_id);
            setDetail(null);
            setCorrect({ p, rec: detail.rec });
          }}
        />
      )}
      {correct && (
        <CorrectionModal
          person={correct.p}
          record={correct.rec}
          date={date}
          onClose={() => setCorrect(null)}
          onSaved={(msg) => {
            setCorrect(null);
            notify(msg);
            load();
          }}
        />
      )}
    </>
  );
}

function CorrectionModal({ person, record, date, onClose, onSaved }) {
  const [inT, setInT] = useState(record ? timeInputValue(record.check_in_at) : '08:30');
  const [outT, setOutT] = useState(record?.check_out_at ? timeInputValue(record.check_out_at) : '');
  const [note, setNote] = useState(record?.admin_note || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(remove = false) {
    if (remove && !window.confirm(`Hapus absensi ${person.name} tanggal ${fmtDateShort(date)}?`)) return;
    setSaving(true);
    setError('');
    const { error: e } = await supabase.rpc('att_admin_save', {
      p_user: person.id,
      p_date: date,
      p_in: remove ? null : inT,
      p_out: remove ? null : outT || null,
      p_note: note,
    });
    setSaving(false);
    if (e) return setError(cleanError(e));
    onSaved(remove ? 'Absensi dihapus.' : 'Absensi disimpan.');
  }

  return (
    <Modal onClose={onClose}>
      <h3>
        {record ? 'Koreksi' : 'Input manual'} · {person.name}
      </h3>
      <p className={s.muted} style={{ marginTop: -8 }}>
        {fmtDateLong(date)}
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="c-in">Jam masuk</label>
          <input id="c-in" type="time" value={inT} onChange={(e) => setInT(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="c-out">Jam pulang</label>
          <input id="c-out" type="time" value={outT} onChange={(e) => setOutT(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="c-note">Alasan koreksi</label>
        <textarea id="c-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: HP mati, sudah konfirmasi ke admin." />
      </div>
      {error && <div className={s.errorBox}>{error}</div>}
      <div className="modal-actions">
        {record && (
          <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={() => save(true)} disabled={saving}>
            Hapus
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
          Batal
        </button>
        <button className="btn btn-primary" onClick={() => save(false)} disabled={saving || !inT || note.trim().length < 3}>
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </Modal>
  );
}

// =====================================================================
// IZIN / SAKIT / CUTI
// =====================================================================
function LeaveView({ user, isAdmin, profiles, notify, onChanged }) {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('menunggu');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('leave_requests').select('*').order('created_at', { ascending: false }).limit(200);
    if (!isAdmin) q = q.eq('user_id', user.id);
    const { data, error } = await q;
    if (error) notify('Pengajuan gagal dimuat: ' + error.message);
    setItems(data || []);
    setLoading(false);
  }, [isAdmin, user, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = filter === 'semua' ? items : items.filter((i) => i.status === filter);
  const nameOf = (id) => profiles.find((p) => p.id === id)?.name || 'Staf';

  async function remove(item) {
    if (!window.confirm('Batalkan pengajuan ini?')) return;
    const { error } = await supabase.from('leave_requests').delete().eq('id', item.id);
    if (error) return notify('Gagal membatalkan: ' + error.message);
    notify('Pengajuan dibatalkan.');
    load();
    onChanged();
  }

  async function openAttachment(path) {
    const u = await signedUrl(path);
    if (u) window.open(u, '_blank', 'noopener');
  }

  return (
    <>
      <div className="filter-row">
        <div className={s.chips}>
          {[
            ['menunggu', 'Menunggu'],
            ['disetujui', 'Disetujui'],
            ['ditolak', 'Ditolak'],
            ['semua', 'Semua'],
          ].map(([k, l]) => (
            <button key={k} className={`${s.chip} ${filter === k ? s.chipOn : ''}`} onClick={() => setFilter(k)}>
              {l}
              <span className={s.chipCount}>{k === 'semua' ? items.length : items.filter((i) => i.status === k).length}</span>
            </button>
          ))}
        </div>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setCreating(true)}>
          + Ajukan Izin
        </button>
      </div>

      {loading ? (
        <div className="panel-empty">Memuat…</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <div className="big">Tidak ada pengajuan</div>
          <div>{filter === 'menunggu' ? 'Semua pengajuan sudah diproses.' : 'Belum ada pengajuan di kategori ini.'}</div>
        </div>
      ) : (
        <div className={s.leaveList}>
          {visible.map((i) => {
            const days = Math.round((new Date(i.end_date) - new Date(i.start_date)) / 86400000) + 1;
            return (
              <div key={i.id} className={s.leaveCard}>
                <div className={s.leaveTop}>
                  <span className={`${s.badge} ${s.tone_info}`}>{LEAVE_KIND[i.kind]}</span>
                  <span
                    className={`${s.badge} ${i.status === 'disetujui' ? s.tone_ok : i.status === 'ditolak' ? s.tone_bad : s.tone_warn}`}
                  >
                    {i.status === 'menunggu' ? 'Menunggu persetujuan' : i.status === 'disetujui' ? 'Disetujui' : 'Ditolak'}
                  </span>
                </div>
                {isAdmin && <div className={s.leaveName}>{nameOf(i.user_id)}</div>}
                <div className={s.leaveDates}>
                  {i.start_date === i.end_date ? fmtDateLong(i.start_date) : `${fmtDateShort(i.start_date)} – ${fmtDateShort(i.end_date)}`}
                  <span className={s.muted}> · {days} hari</span>
                </div>
                <p className={s.leaveReason}>{i.reason}</p>
                {i.attachment && (
                  <button className={s.linkBtn} onClick={() => openAttachment(i.attachment)}>
                    Lihat lampiran
                  </button>
                )}
                {i.review_note && <p className={s.reviewNote}>Catatan admin: {i.review_note}</p>}
                <div className={s.leaveActions}>
                  {isAdmin && i.status === 'menunggu' && (
                    <>
                      <button className="btn btn-primary btn-sm" onClick={() => setReviewing({ item: i, status: 'disetujui' })}>
                        Setujui
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setReviewing({ item: i, status: 'ditolak' })}>
                        Tolak
                      </button>
                    </>
                  )}
                  {isAdmin && i.status !== 'menunggu' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setReviewing({ item: i, status: 'menunggu' })}>
                      Ubah keputusan
                    </button>
                  )}
                  {i.user_id === user.id && i.status === 'menunggu' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => remove(i)}>
                      Batalkan
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <LeaveModal
          user={user}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            notify('Pengajuan terkirim. Menunggu persetujuan admin.');
            setFilter('menunggu');
            load();
            onChanged();
          }}
        />
      )}
      {reviewing && (
        <ReviewModal
          item={reviewing.item}
          status={reviewing.status}
          name={nameOf(reviewing.item.user_id)}
          onClose={() => setReviewing(null)}
          onSaved={(msg) => {
            setReviewing(null);
            notify(msg);
            load();
            onChanged();
          }}
        />
      )}
    </>
  );
}

function LeaveModal({ user, onClose, onSaved }) {
  const today = jakartaToday();
  const [form, setForm] = useState({ kind: 'izin', start_date: today, end_date: today, reason: '' });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    setError('');
    try {
      let attachment = null;
      if (file) attachment = await uploadAttendanceFile(user.id, await compressImage(file, 1400, 0.8), 'lampiran');
      const { error: e } = await supabase.from('leave_requests').insert({
        user_id: user.id,
        kind: form.kind,
        start_date: form.start_date,
        end_date: form.end_date < form.start_date ? form.start_date : form.end_date,
        reason: form.reason.trim(),
        attachment,
      });
      if (e) throw e;
      onSaved();
    } catch (e) {
      const msg = cleanError(e);
      setError(msg.includes('check constraint') ? 'Periksa tanggal (maksimal 31 hari) dan alasan (minimal 5 karakter).' : msg);
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h3>Ajukan Izin</h3>
      <div className="field">
        <label htmlFor="l-kind">Jenis</label>
        <select id="l-kind" value={form.kind} onChange={(e) => set('kind', e.target.value)}>
          {Object.entries(LEAVE_KIND).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="l-start">Dari tanggal</label>
          <input id="l-start" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="l-end">Sampai tanggal</label>
          <input id="l-end" type="date" value={form.end_date} min={form.start_date} onChange={(e) => set('end_date', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="l-reason">Alasan</label>
        <textarea
          id="l-reason"
          rows={3}
          value={form.reason}
          onChange={(e) => set('reason', e.target.value)}
          placeholder={form.kind === 'dinas' ? 'Contoh: Pameran properti di Surabaya.' : 'Contoh: Acara keluarga di luar kota.'}
        />
      </div>
      <div className="field">
        <label htmlFor="l-file">{form.kind === 'sakit' ? 'Foto surat dokter (disarankan)' : 'Lampiran foto (opsional)'}</label>
        <input id="l-file" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </div>
      {error && <div className={s.errorBox}>{error}</div>}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
          Batal
        </button>
        <button className="btn btn-primary" onClick={save} disabled={saving || form.reason.trim().length < 5}>
          {saving ? 'Mengirim…' : 'Kirim Pengajuan'}
        </button>
      </div>
    </Modal>
  );
}

function ReviewModal({ item, status, name, onClose, onSaved }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const title = status === 'disetujui' ? 'Setujui pengajuan' : status === 'ditolak' ? 'Tolak pengajuan' : 'Kembalikan ke menunggu';

  async function save() {
    setSaving(true);
    const { error: e } = await supabase.rpc('leave_review', { p_id: item.id, p_status: status, p_note: note });
    setSaving(false);
    if (e) return setError(cleanError(e));
    onSaved(status === 'disetujui' ? 'Pengajuan disetujui.' : status === 'ditolak' ? 'Pengajuan ditolak.' : 'Pengajuan dikembalikan ke menunggu.');
  }

  return (
    <Modal onClose={onClose}>
      <h3>{title}</h3>
      <p className={s.muted} style={{ marginTop: -8 }}>
        {name} · {LEAVE_KIND[item.kind]} · {fmtDateShort(item.start_date)}
        {item.end_date !== item.start_date && ` – ${fmtDateShort(item.end_date)}`}
      </p>
      <div className="field">
        <label htmlFor="r-note">Catatan untuk staf (opsional)</label>
        <textarea id="r-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <div className={s.errorBox}>{error}</div>}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
          Batal
        </button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Menyimpan…' : title}
        </button>
      </div>
    </Modal>
  );
}

// =====================================================================
// PENGATURAN (Admin)
// =====================================================================
function SettingsView({ settings, profiles, notify, onSaved }) {
  const [f, setF] = useState(() => ({
    office_name: settings.office_name || '',
    office_lat: settings.office_lat ?? '',
    office_lng: settings.office_lng ?? '',
    radius_m: settings.radius_m,
    work_start: hhmm(settings.work_start).replace('.', ':'),
    work_end: hhmm(settings.work_end).replace('.', ':'),
    late_grace_min: settings.late_grace_min,
    work_days: settings.work_days || [],
    holidays: settings.holidays || [],
    require_photo: settings.require_photo,
    exempt_user_ids: settings.exempt_user_ids || [],
  }));
  const [newHoliday, setNewHoliday] = useState('');
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));

  async function useMyLocation() {
    setLocating(true);
    try {
      const p = await getPosition();
      setF((x) => ({ ...x, office_lat: p.lat.toFixed(6), office_lng: p.lng.toFixed(6) }));
      notify(`Lokasi diambil (akurasi ±${p.accuracy} m). Jangan lupa klik Simpan.`);
    } catch (e) {
      notify(e.message);
    } finally {
      setLocating(false);
    }
  }

  async function save() {
    const lat = f.office_lat === '' ? null : Number(f.office_lat);
    const lng = f.office_lng === '' ? null : Number(f.office_lng);
    if ((lat === null) !== (lng === null) || (lat !== null && (Number.isNaN(lat) || Number.isNaN(lng)))) {
      return notify('Isi lintang dan bujur kantor dengan angka, atau kosongkan keduanya.');
    }
    if (!f.work_days.length) return notify('Pilih minimal satu hari kerja.');
    setSaving(true);
    const { error } = await supabase
      .from('attendance_settings')
      .update({
        office_name: f.office_name.trim() || 'Kantor SAM Property',
        office_lat: lat,
        office_lng: lng,
        radius_m: Math.min(5000, Math.max(30, Number(f.radius_m) || 150)),
        work_start: f.work_start,
        work_end: f.work_end,
        late_grace_min: Math.min(180, Math.max(0, Number(f.late_grace_min) || 0)),
        work_days: [...f.work_days].sort(),
        holidays: [...f.holidays].sort(),
        require_photo: f.require_photo,
        exempt_user_ids: f.exempt_user_ids,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);
    setSaving(false);
    if (error) return notify('Gagal menyimpan: ' + error.message);
    notify('Pengaturan absensi disimpan.');
    onSaved();
  }

  return (
    <div className={s.settings}>
      <div className="panel">
        <h3>Lokasi kantor</h3>
        <div className="field">
          <label htmlFor="o-name">Nama lokasi</label>
          <input id="o-name" value={f.office_name} onChange={(e) => set('office_name', e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="o-lat">Lintang (latitude)</label>
            <input id="o-lat" inputMode="decimal" value={f.office_lat} onChange={(e) => set('office_lat', e.target.value)} placeholder="-7.96xxxx" />
          </div>
          <div className="field">
            <label htmlFor="o-lng">Bujur (longitude)</label>
            <input id="o-lng" inputMode="decimal" value={f.office_lng} onChange={(e) => set('office_lng', e.target.value)} placeholder="112.6xxxx" />
          </div>
        </div>
        <div className={s.rowGap}>
          <button className="btn btn-ghost btn-sm" onClick={useMyLocation} disabled={locating}>
            {locating ? 'Mengambil lokasi…' : 'Pakai lokasi saya sekarang'}
          </button>
          {f.office_lat !== '' && f.office_lng !== '' && (
            <a className={s.linkBtn} href={mapsUrl(f.office_lat, f.office_lng)} target="_blank" rel="noreferrer">
              Cek di Google Maps
            </a>
          )}
        </div>
        <p className={s.help}>Paling akurat: klik tombol di atas saat Abang berada di dalam kantor.</p>
        <div className="field">
          <label htmlFor="o-rad">Radius area kantor: {f.radius_m} m</label>
          <input id="o-rad" type="range" min="30" max="1000" step="10" value={f.radius_m} onChange={(e) => set('radius_m', Number(e.target.value))} />
        </div>
      </div>

      <div className="panel">
        <h3>Jam kerja</h3>
        <div className="field-row">
          <div className="field">
            <label htmlFor="w-start">Jam masuk</label>
            <input id="w-start" type="time" value={f.work_start} onChange={(e) => set('work_start', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="w-end">Jam pulang</label>
            <input id="w-end" type="time" value={f.work_end} onChange={(e) => set('work_end', e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="w-grace">Toleransi terlambat (menit)</label>
          <input id="w-grace" type="number" min="0" max="180" value={f.late_grace_min} onChange={(e) => set('late_grace_min', e.target.value)} />
        </div>
        <div className="field">
          <label>Hari kerja</label>
          <div className={s.chips}>
            {DAY_LONG.map((d, i) => (
              <button key={d} type="button" className={`${s.chip} ${f.work_days.includes(i + 1) ? s.chipOn : ''}`} onClick={() => toggle('work_days', i + 1)}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="w-hol">Hari libur nasional / kantor</label>
          <div className={s.rowGap}>
            <input id="w-hol" type="date" className={s.dateInput} value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!newHoliday || f.holidays.includes(newHoliday)}
              onClick={() => {
                set('holidays', [...f.holidays, newHoliday]);
                setNewHoliday('');
              }}
            >
              Tambah
            </button>
          </div>
          {f.holidays.length > 0 && (
            <div className={s.chips} style={{ marginTop: 10 }}>
              {[...f.holidays].sort().map((h) => (
                <button key={h} type="button" className={s.chip} onClick={() => toggle('holidays', h)} title="Klik untuk menghapus">
                  {fmtDateShort(h)} ×
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <h3>Aturan</h3>
        <label className={s.check}>
          <input type="checkbox" checked={f.require_photo} onChange={(e) => set('require_photo', e.target.checked)} />
          Wajib foto selfie saat absen masuk
        </label>
        <div className="field" style={{ marginTop: 16 }}>
          <label>Tidak wajib absen (tidak dihitung alpa)</label>
          {profiles.map((p) => (
            <label key={p.id} className={s.check}>
              <input type="checkbox" checked={f.exempt_user_ids.includes(p.id)} onChange={() => toggle('exempt_user_ids', p.id)} />
              {p.name}
              <span className={s.muted}>{p.role === 'admin' ? ' · Admin' : ' · Agen'}</span>
            </label>
          ))}
        </div>
        <button className="btn btn-primary" onClick={save} disabled={saving} style={{ marginTop: 8 }}>
          {saving ? 'Menyimpan…' : 'Simpan Pengaturan'}
        </button>
      </div>
    </div>
  );
}
