import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import Modal from './Modal';
import f from './LeadsTab.module.css';

const STATUS_OPTIONS = ['Baru', 'Follow-up', 'Nego', 'Closing', 'Hilang'];
const SOURCE_OPTIONS = ['WhatsApp', 'Instagram', 'Facebook', 'Website', 'Referral', 'Walk-in'];
const STATUS_BADGE = { Baru: 'badge-grey', 'Follow-up': 'badge-gold', Nego: 'badge-gold', Closing: 'badge-green', Hilang: 'badge-red' };
const DONE = ['Closing', 'Hilang'];

const CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'telepon', label: 'Telepon' },
  { key: 'survei', label: 'Survei lokasi' },
  { key: 'meeting', label: 'Meeting' },
  { key: 'email', label: 'Email' },
  { key: 'lainnya', label: 'Lainnya' },
];
const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label]));

const FU_FILTERS = [
  { key: '', label: 'Semua follow-up' },
  { key: 'jatuh_tempo', label: 'Jadwal hari ini & terlambat' },
  { key: 'belum', label: 'Belum pernah di-follow-up' },
  { key: 'lama', label: 'Tidak di-follow-up > 7 hari' },
];

// ---------- tanggal (WIB) ----------
const TZ = 'Asia/Jakarta';
function todayYmd() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function ymdOf(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}
function relDays(iso) {
  if (!iso) return null;
  const d = daysBetween(ymdOf(iso), todayYmd());
  if (d <= 0) return 'Hari ini';
  if (d === 1) return 'Kemarin';
  return `${d} hari lalu`;
}
function fmtDateShort(ymd) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ymd + 'T12:00:00+07:00'));
}
function fmtDateTime(iso) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso));
}
function localInputNow() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function waNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 8) return '';
  return d.startsWith('0') ? '62' + d.slice(1) : d;
}

// Keterangan jadwal follow-up berikutnya
function nextInfo(l) {
  if (!l.next_followup_at || DONE.includes(l.status)) return null;
  const diff = daysBetween(todayYmd(), l.next_followup_at);
  if (diff < 0) return { text: `Terlambat ${-diff} hari`, tone: 'late' };
  if (diff === 0) return { text: 'Hari ini', tone: 'today' };
  if (diff === 1) return { text: 'Besok', tone: 'soon' };
  return { text: fmtDateShort(l.next_followup_at), tone: 'later' };
}

export default function LeadsTab({ leads, properties, profiles, user, isAdmin, refresh, showToast }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fuFilter, setFuFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [followLead, setFollowLead] = useState(null);
  const [overrides, setOverrides] = useState({}); // ringkasan terbaru sebelum data dimuat ulang
  const [dirty, setDirty] = useState(false);

  const today = todayYmd();
  const merged = useMemo(() => leads.map((l) => (overrides[l.id] ? { ...l, ...overrides[l.id] } : l)), [leads, overrides]);

  const needsAttention = (l) => {
    if (DONE.includes(l.status)) return false;
    return (l.next_followup_at && l.next_followup_at <= today) || !l.last_followup_at || daysBetween(ymdOf(l.last_followup_at), today) > 7;
  };

  const counts = useMemo(() => {
    const open = merged.filter((l) => !DONE.includes(l.status) && (l.phone || '').trim() !== '-');
    return {
      jatuh_tempo: open.filter((l) => l.next_followup_at && l.next_followup_at <= today).length,
      belum: open.filter((l) => !l.last_followup_at).length,
      lama: open.filter((l) => l.last_followup_at && daysBetween(ymdOf(l.last_followup_at), today) > 7).length,
    };
  }, [merged, today]);

  const rows = merged
    .filter((l) => {
      const q = search.toLowerCase();
      const matchSearch = (l.name || '').toLowerCase().includes(q) || (l.phone || '').toLowerCase().includes(q);
      const matchStatus = !statusFilter || l.status === statusFilter;
      let matchFu = true;
      if (fuFilter) {
        const open = !DONE.includes(l.status) && (l.phone || '').trim() !== '-';
        if (fuFilter === 'jatuh_tempo') matchFu = open && !!l.next_followup_at && l.next_followup_at <= today;
        if (fuFilter === 'belum') matchFu = open && !l.last_followup_at;
        if (fuFilter === 'lama') matchFu = open && !!l.last_followup_at && daysBetween(ymdOf(l.last_followup_at), today) > 7;
      }
      return matchSearch && matchStatus && matchFu;
    })
    .sort((a, b) =>
      fuFilter === 'jatuh_tempo'
        ? (a.next_followup_at || '').localeCompare(b.next_followup_at || '')
        : (b.created_at || '').localeCompare(a.created_at || '')
    );

  function canManage(l) { return isAdmin || l.agent_id === user.id; }
  function canFollow(l) { return isAdmin || l.agent_id === user.id || !l.agent_id; }

  async function handleSave(form) {
    const payload = {
      name: form.name,
      phone: form.phone,
      source: form.source,
      status: form.status,
      property_id: form.property_id || null,
      agent_id: form.agent_id || null,
      notes: form.notes,
    };
    let error;
    if (form.id) ({ error } = await supabase.from('leads').update(payload).eq('id', form.id));
    else ({ error } = await supabase.from('leads').insert(payload));
    if (error) { showToast('Gagal menyimpan: ' + error.message); return; }
    setEditing(null); showToast('Lead tersimpan'); refresh();
  }

  async function handleDelete(id) {
    if (!window.confirm('Hapus lead ini beserta riwayat follow-up-nya?')) return;
    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) { showToast('Gagal menghapus: ' + error.message); return; }
    setEditing(null); showToast('Lead dihapus'); refresh();
  }

  function closeFollow() {
    setFollowLead(null);
    if (dirty) {
      setDirty(false);
      setOverrides({});
      refresh();
    }
  }

  return (
    <section>
      <div className="topbar">
        <div><h1>Leads</h1><p>Calon pembeli / penyewa yang sedang ditindaklanjuti</p></div>
        <button className="btn btn-primary" onClick={() => setEditing({})}>+ Tambah Lead</button>
      </div>

      {(counts.jatuh_tempo > 0 || counts.belum > 0) && (
        <div className={f.alert}>
          {counts.jatuh_tempo > 0 && (
            <button className={f.alertBtn} onClick={() => setFuFilter('jatuh_tempo')}>
              <b>{counts.jatuh_tempo}</b> jadwal follow-up hari ini / terlambat
            </button>
          )}
          {counts.belum > 0 && (
            <button className={f.alertBtn} onClick={() => setFuFilter('belum')}>
              <b>{counts.belum}</b> lead belum pernah di-follow-up
            </button>
          )}
        </div>
      )}

      <div className="filter-row">
        <input type="text" placeholder="Cari nama / no. HP..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Semua Status</option>
          {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={fuFilter} onChange={(e) => setFuFilter(e.target.value)}>
          {FU_FILTERS.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}{x.key && counts[x.key] ? ` (${counts[x.key]})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="table-wrap">
        {leads.length === 0 ? (
          <div className="empty-state"><div className="big">Belum ada leads</div><div>Catat calon pembeli/penyewa supaya tidak ada follow-up yang terlewat.</div></div>
        ) : rows.length === 0 ? (
          <div className="empty-state"><div className="big">Tidak ditemukan</div><div>Coba ubah kata kunci atau filter.</div></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>No</th><th>Nama</th><th>Sumber</th><th>Properti Diminati</th><th>Status</th><th>Agen</th>
                <th>Follow-up Terakhir</th><th>Jadwal Berikutnya</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l, idx) => {
                const prop = properties.find((p) => p.id === l.property_id);
                const agent = profiles.find((a) => a.id === l.agent_id);
                const nx = nextInfo(l);
                const stale = needsAttention(l) && l.last_followup_at;
                return (
                  <tr key={l.id}>
                    <td className="cell-soft">{idx + 1}</td>
                    <td><div className="cell-strong">{l.name}</div><div className="cell-soft">{l.phone || '-'}</div></td>
                    <td>{l.source || '-'}</td>
                    <td>{prop ? prop.title : <span className="cell-soft">{l.interest || '-'}</span>}</td>
                    <td><span className={'badge ' + (STATUS_BADGE[l.status] || 'badge-grey')}>{l.status}</span></td>
                    <td>{agent ? agent.name : <span className="cell-soft">-</span>}</td>
                    <td>
                      {l.last_followup_at ? (
                        <>
                          <div className={stale ? f.stale : ''}>{relDays(l.last_followup_at)}</div>
                          <div className="cell-soft">{fmtDateShort(ymdOf(l.last_followup_at))} · {l.followup_count}×</div>
                        </>
                      ) : DONE.includes(l.status) ? (
                        <span className="cell-soft">-</span>
                      ) : (
                        <span className={f.never}>Belum pernah</span>
                      )}
                    </td>
                    <td>{nx ? <span className={`${f.next} ${f['next_' + nx.tone]}`}>{nx.text}</span> : <span className="cell-soft">-</span>}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => setFollowLead(l)}>
                          {canFollow(l) ? 'Follow-up' : 'Riwayat'}
                        </button>
                        {canManage(l) && <button className="icon-btn" title="Edit" onClick={() => setEditing(l)}>✎</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing !== null && (
        <LeadModal data={editing} properties={properties} profiles={profiles} isAdmin={isAdmin} user={user} onClose={() => setEditing(null)} onSave={handleSave} onDelete={handleDelete} />
      )}
      {followLead && (
        <FollowupModal
          lead={merged.find((l) => l.id === followLead.id) || followLead}
          profiles={profiles}
          user={user}
          isAdmin={isAdmin}
          canAdd={canFollow(followLead)}
          showToast={showToast}
          onChanged={(summary) => {
            setDirty(true);
            setOverrides((o) => ({ ...o, [followLead.id]: { ...(o[followLead.id] || {}), ...summary } }));
          }}
          onClose={closeFollow}
        />
      )}
    </section>
  );
}

// =====================================================================
// Riwayat & catat follow-up
// =====================================================================
function FollowupModal({ lead, profiles, user, isAdmin, canAdd, showToast, onChanged, onClose }) {
  const [items, setItems] = useState(null);
  const [form, setForm] = useState({ channel: 'whatsapp', note: '', status_after: '', next_followup: '', followed_at: localInputNow() });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const nameOf = (id) => profiles.find((p) => p.id === id)?.name || 'Staf';
  const today = todayYmd();

  async function load() {
    const { data, error: e } = await supabase
      .from('lead_followups')
      .select('*')
      .eq('lead_id', lead.id)
      .order('followed_at', { ascending: false })
      .order('created_at', { ascending: false });
    if (e) setError('Riwayat gagal dimuat: ' + e.message);
    setItems(data || []);
    return data || [];
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  function summaryFrom(list, statusAfter) {
    const latest = list[0];
    const s = {
      followup_count: list.length,
      last_followup_at: latest ? latest.followed_at : null,
      next_followup_at: latest ? latest.next_followup : null,
    };
    if (statusAfter) s.status = statusAfter;
    if (list.length && !lead.agent_id) s.agent_id = user.id;
    return s;
  }

  async function save() {
    if (form.note.trim().length < 3) { setError('Tulis hasil follow-up (minimal 3 karakter).'); return; }
    setSaving(true);
    setError('');
    const followedIso = new Date(form.followed_at + ':00+07:00').toISOString();
    const { error: e } = await supabase.from('lead_followups').insert({
      lead_id: lead.id,
      user_id: user.id,
      channel: form.channel,
      note: form.note.trim(),
      status_after: form.status_after || null,
      next_followup: form.next_followup || null,
      followed_at: new Date(followedIso) > new Date() ? new Date().toISOString() : followedIso,
    });
    setSaving(false);
    if (e) {
      setError(/row-level security/i.test(e.message) ? 'Lead ini dipegang agen lain, jadi Anda tidak bisa mencatat follow-up.' : 'Gagal menyimpan: ' + e.message);
      return;
    }
    const list = await load();
    onChanged(summaryFrom(list, form.status_after));
    setForm({ channel: form.channel, note: '', status_after: '', next_followup: '', followed_at: localInputNow() });
    showToast('Follow-up tercatat');
  }

  async function remove(item) {
    if (!window.confirm('Hapus catatan follow-up ini?')) return;
    const { error: e } = await supabase.from('lead_followups').delete().eq('id', item.id);
    if (e) { showToast('Gagal menghapus: ' + e.message); return; }
    const list = await load();
    onChanged(summaryFrom(list));
    showToast('Catatan dihapus');
  }

  const wa = waNumber(lead.phone);
  const nx = nextInfo(lead);
  const quick = [
    ['Besok', addDays(today, 1)],
    ['3 hari', addDays(today, 3)],
    ['1 minggu', addDays(today, 7)],
  ];

  return (
    <Modal onClose={saving ? () => {} : onClose}>
      <div className={f.head}>
        <div>
          <h3 className={f.title}>{lead.name}</h3>
          <div className={f.sub}>
            {lead.phone || '-'} · <span className={'badge ' + (STATUS_BADGE[lead.status] || 'badge-grey')}>{lead.status}</span>
          </div>
        </div>
        {wa && (
          <a className="btn btn-ghost btn-sm" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">
            Buka WA
          </a>
        )}
      </div>

      <div className={f.summary}>
        <div><span>Follow-up terakhir</span><b>{lead.last_followup_at ? relDays(lead.last_followup_at) : 'Belum pernah'}</b></div>
        <div><span>Total follow-up</span><b>{lead.followup_count || 0}×</b></div>
        <div><span>Jadwal berikutnya</span><b className={nx ? f['next_' + nx.tone] : ''}>{nx ? nx.text : '-'}</b></div>
      </div>

      {canAdd ? (
        <div className={f.form}>
          <div className={f.formTitle}>Catat follow-up</div>
          <div className={f.chips}>
            {CHANNELS.map((c) => (
              <button key={c.key} type="button" className={`${f.chip} ${form.channel === c.key ? f.chipOn : ''}`} onClick={() => set('channel', c.key)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="field">
            <label htmlFor="fu-note">Hasil follow-up</label>
            <textarea
              id="fu-note"
              rows={3}
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder="Contoh: Sudah kirim pricelist tipe 45, minta simulasi KPR 15 tahun. Mau survei Sabtu."
              maxLength={1500}
            />
          </div>
          <div className={f.two}>
            <div className="field">
              <label htmlFor="fu-status">Ubah status lead</label>
              <select id="fu-status" value={form.status_after} onChange={(e) => set('status_after', e.target.value)}>
                <option value="">Tidak berubah ({lead.status})</option>
                {STATUS_OPTIONS.filter((s) => s !== lead.status).map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fu-at">Waktu follow-up</label>
              <input id="fu-at" type="datetime-local" value={form.followed_at} max={localInputNow()} onChange={(e) => set('followed_at', e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="fu-next">Jadwal follow-up berikutnya</label>
            <div className={f.nextRow}>
              <input id="fu-next" type="date" min={today} value={form.next_followup} onChange={(e) => set('next_followup', e.target.value)} />
              {quick.map(([label, v]) => (
                <button key={label} type="button" className={`${f.chip} ${form.next_followup === v ? f.chipOn : ''}`} onClick={() => set('next_followup', v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {error && <div className="auth-error">{error}</div>}
          <div className="modal-actions" style={{ marginTop: 6 }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Tutup</button>
            <button className="btn btn-primary" onClick={save} disabled={saving || form.note.trim().length < 3}>
              {saving ? 'Menyimpan…' : 'Simpan Follow-up'}
            </button>
          </div>
        </div>
      ) : (
        <p className={f.readonly}>Lead ini dipegang agen lain. Anda hanya bisa melihat riwayatnya.</p>
      )}

      <div className={f.historyTitle}>Riwayat follow-up</div>
      {items === null ? (
        <div className="panel-empty">Memuat…</div>
      ) : items.length === 0 ? (
        <div className={f.empty}>Belum ada catatan. Catat follow-up pertama di atas supaya tim tahu perkembangan lead ini.</div>
      ) : (
        <ol className={f.timeline}>
          {items.map((it) => (
            <li key={it.id} className={f.item}>
              <div className={f.itemHead}>
                <span className={f.channel}>{CHANNEL_LABEL[it.channel] || it.channel}</span>
                <span className={f.when}>{fmtDateTime(it.followed_at)}</span>
              </div>
              <p className={f.note}>{it.note}</p>
              <div className={f.meta}>
                <span>oleh {nameOf(it.user_id)}</span>
                {it.status_after && <span>· status jadi <b>{it.status_after}</b></span>}
                {it.next_followup && <span>· jadwal berikutnya {fmtDateShort(it.next_followup)}</span>}
                {(it.user_id === user.id || isAdmin) && (
                  <button className={f.del} onClick={() => remove(it)}>Hapus</button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {!canAdd && (
        <div className="modal-actions"><button className="btn btn-primary" onClick={onClose}>Tutup</button></div>
      )}
    </Modal>
  );
}

function LeadModal({ data, properties, profiles, isAdmin, user, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({
    id: data.id || null,
    name: data.name || '',
    phone: data.phone || '',
    source: data.source || 'WhatsApp',
    status: data.status || 'Baru',
    property_id: data.property_id || '',
    agent_id: data.agent_id || (isAdmin ? '' : user.id),
    notes: data.notes || '',
  });
  function set(key, val) { setForm((x) => ({ ...x, [key]: val })); }

  return (
    <Modal onClose={onClose}>
      <h3>{data.id ? 'Edit' : 'Tambah'} Lead</h3>
      <div className="field-row">
        <div className="field"><label>Nama</label><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Budi Santoso" /></div>
        <div className="field"><label>No. HP</label><input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="0812xxxxxxx" /></div>
      </div>
      <div className="field-row">
        <div className="field"><label>Sumber</label><select value={form.source} onChange={(e) => set('source', e.target.value)}>{SOURCE_OPTIONS.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="field"><label>Status</label><select value={form.status} onChange={(e) => set('status', e.target.value)}>{STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}</select></div>
      </div>
      <div className="field"><label>Tertarik Properti</label><select value={form.property_id} onChange={(e) => set('property_id', e.target.value)}><option value="">- Belum ditentukan -</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
      <div className="field"><label>Agen</label><select value={form.agent_id} onChange={(e) => set('agent_id', e.target.value)} disabled={!isAdmin}><option value="">- Pilih Agen -</option>{profiles.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      <div className="field"><label>Catatan umum</label><textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Info tetap tentang lead, mis. budget, kebutuhan. Riwayat follow-up dicatat lewat tombol Follow-up." /></div>
      <div className="modal-actions">
        {data.id && isAdmin && <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={() => onDelete(data.id)}>Hapus</button>}
        <button className="btn btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" onClick={() => form.name.trim() ? onSave(form) : null}>Simpan</button>
      </div>
    </Modal>
  );
}
