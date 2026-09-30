import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import s from './ChatTab.module.css';

const WINDOW_MS = 24 * 60 * 60 * 1000;

const STAGE_LABEL = { antrian: 'Antrian', proses: 'Diproses', selesai: 'Selesai' };
const CLASS_OPTIONS = [
  { key: 'hot', label: 'Hot' },
  { key: 'warm', label: 'Warm' },
  { key: 'cool', label: 'Cool' },
  { key: 'closing', label: 'Closing' },
];
const CLASS_LABEL = { hot: 'Hot', warm: 'Warm', cool: 'Cool', closing: 'Closing' };

const QUEUES = [
  { key: 'semua', label: 'Semua' },
  { key: 'umum', label: 'Antrian Umum' },
  { key: 'khusus', label: 'Antrian Khusus' },
  { key: 'perlu', label: 'Perlu Dibalas' },
  { key: 'proses', label: 'Diproses' },
  { key: 'selesai', label: 'Selesai' },
];

// ---------- helper tampilan ----------
function formatPhone(waId) {
  const d = String(waId || '').replace(/\D/g, '');
  const local = d.startsWith('62') ? '0' + d.slice(2) : d;
  return local.replace(/^(\d{4})(\d{4})(\d+)$/, '$1-$2-$3');
}

function initials(name, waId) {
  const src = (name || '').trim();
  if (!src) return String(waId || '').slice(-2);
  const parts = src.split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return 'Hari ini';
  if (sameDay(date, yesterday)) return 'Kemarin';
  return date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function listTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  if (sameDay(d, yesterday)) return 'Kemarin';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function clock(iso) {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function windowText(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} jam ${m} mnt` : `${m} mnt`;
}

function StatusTick({ status, error }) {
  if (status === 'failed') return <span className={s.failed} title={error || ''}>Gagal terkirim</span>;
  if (status === 'read') return <span className={`${s.tick} ${s.tickRead}`} aria-label="Dibaca">✓✓</span>;
  if (status === 'delivered') return <span className={s.tick} aria-label="Diterima">✓✓</span>;
  if (status === 'sent') return <span className={s.tick} aria-label="Terkirim">✓</span>;
  return null;
}

function StageBadge({ stage }) {
  const cls = stage === 'selesai' ? s.stageDone : stage === 'proses' ? s.stageProg : s.stageQueue;
  return <span className={`${s.badge} ${cls}`}>{STAGE_LABEL[stage] || 'Antrian'}</span>;
}

function ClassBadge({ value }) {
  if (!value) return null;
  return <span className={`${s.badge} ${s['cls_' + value]}`}>{CLASS_LABEL[value]}</span>;
}

// ---------- komponen utama ----------
export default function ChatTab({ user, isAdmin, profiles = [], showToast }) {
  const [convs, setConvs] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [events, setEvents] = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [queue, setQueue] = useState('semua');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(null); // 'class' | 'transfer' | 'contact' | null
  const [contactDraft, setContactDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const threadRef = useRef(null);

  const toastRef = useRef(showToast);
  toastRef.current = showToast;
  const notifyError = (msg) => (toastRef.current ? toastRef.current(msg, 'error') : window.alert(msg));

  const nameOf = (id) => (id ? profiles.find((p) => p.id === id)?.name || 'Staf' : 'Sistem');

  // ---------- data: daftar percakapan ----------
  const fetchConvs = useCallback(async () => {
    const { data, error } = await supabase
      .from('wa_conversations')
      .select('*, lead:leads(id, name, status)')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(300);
    if (error) notifyError('Daftar chat gagal dimuat: ' + error.message);
    else setConvs(data || []);
    setLoadingList(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchConvs();
    let timer;
    const channel = supabase
      .channel('wa-conversations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_conversations' }, () => {
        clearTimeout(timer);
        timer = setTimeout(fetchConvs, 300);
      })
      .subscribe();
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      clearTimeout(timer);
      clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, [fetchConvs]);

  // ---------- data: isi chat yang dibuka ----------
  useEffect(() => {
    setPanel(null);
    setNotice('');
    if (!activeId) {
      setMessages([]);
      setEvents([]);
      return undefined;
    }
    let cancelled = false;
    setLoadingMsgs(true);

    Promise.all([
      supabase
        .from('wa_messages')
        .select('id, direction, body, msg_type, status, error, sent_by, created_at')
        .eq('conversation_id', activeId)
        .order('created_at', { ascending: true })
        .limit(500),
      supabase
        .from('wa_events')
        .select('id, kind, actor_id, target_id, detail, created_at')
        .eq('conversation_id', activeId)
        .order('created_at', { ascending: true })
        .limit(300),
    ]).then(([m, e]) => {
      if (cancelled) return;
      if (m.error) notifyError('Pesan gagal dimuat: ' + m.error.message);
      setMessages(m.data || []);
      setEvents(e.data || []);
      setLoadingMsgs(false);
    });

    supabase.rpc('wa_mark_read', { p_conversation_id: activeId }).then(() => {});

    const f = `conversation_id=eq.${activeId}`;
    const channel = supabase
      .channel('wa-thread-' + activeId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_messages', filter: f }, (p) => {
        setMessages((prev) => (prev.some((x) => x.id === p.new.id) ? prev : [...prev, p.new]));
        if (p.new.direction === 'in') supabase.rpc('wa_mark_read', { p_conversation_id: activeId }).then(() => {});
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wa_messages', filter: f }, (p) => {
        setMessages((prev) => prev.map((x) => (x.id === p.new.id ? { ...x, ...p.new } : x)));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_events', filter: f }, (p) => {
        setEvents((prev) => (prev.some((x) => x.id === p.new.id) ? prev : [...prev, p.new]));
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, events, activeId]);

  // ---------- antrian ----------
  const inQueue = useCallback(
    (c, key) => {
      const mine = c.assigned_to === user?.id;
      const scoped = isAdmin || mine;
      switch (key) {
        case 'umum':
          return c.stage === 'antrian' && !c.assigned_to;
        case 'khusus':
          return c.stage === 'antrian' && !!c.assigned_to && scoped;
        case 'perlu':
          return c.stage === 'proses' && c.last_direction === 'in' && scoped;
        case 'proses':
          return c.stage === 'proses' && scoped;
        case 'selesai':
          return c.stage === 'selesai' && scoped;
        default:
          return true;
      }
    },
    [isAdmin, user]
  );

  const counts = useMemo(() => {
    const out = {};
    QUEUES.forEach((q) => {
      out[q.key] = convs.filter((c) => inQueue(c, q.key)).length;
    });
    return out;
  }, [convs, inQueue]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let digits = q.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '62' + digits.slice(1);
    return convs.filter((c) => {
      if (!inQueue(c, queue)) return false;
      if (!q) return true;
      return (
        (c.contact_name || '').toLowerCase().includes(q) ||
        (c.lead?.name || '').toLowerCase().includes(q) ||
        (c.last_message_text || '').toLowerCase().includes(q) ||
        (digits.length >= 3 && (c.wa_id || '').includes(digits))
      );
    });
  }, [convs, queue, query, inQueue]);

  // ---------- chat aktif ----------
  const active = convs.find((c) => c.id === activeId) || null;
  const isMine = !!active && active.assigned_to === user?.id;
  const canManage = !!active && (isAdmin || isMine);
  const windowLeft = active?.last_inbound_at ? WINDOW_MS - (now - Date.parse(active.last_inbound_at)) : 0;
  const windowOpen = windowLeft > 0;
  const canReply = !!active && windowOpen && (isAdmin || !active.assigned_to || isMine);
  const showTake =
    !!active &&
    active.stage !== 'selesai' &&
    (!active.assigned_to || (isMine && active.stage === 'antrian') || (isAdmin && !isMine));

  // ---------- aksi ----------
  async function runRpc(fn, args, successMsg) {
    if (!active || busy) return false;
    setBusy(true);
    const { error } = await supabase.rpc(fn, { p_id: active.id, ...args });
    setBusy(false);
    if (error) {
      notifyError(error.message);
      return false;
    }
    setPanel(null);
    if (successMsg) setNotice(successMsg);
    fetchConvs();
    return true;
  }

  const take = () => runRpc('wa_take', {}, 'Chat berhasil diambil alih.');
  const complete = () => runRpc('wa_complete', {}, 'Chat ditandai selesai.');
  const reopen = () => runRpc('wa_reopen', {}, 'Chat dibuka kembali.');
  const setClass = (v) => runRpc('wa_set_class', { p_class: v }, v ? `Klasifikasi diubah ke ${CLASS_LABEL[v]}.` : 'Klasifikasi dihapus.');
  const transfer = (target) =>
    runRpc('wa_transfer', { p_target: target }, target ? `Chat ditransfer ke ${nameOf(target)}.` : 'Chat dikembalikan ke Antrian Umum.');
  const saveContact = () => runRpc('wa_set_contact', { p_name: contactDraft }, 'Nama kontak diperbarui.');

  async function send() {
    const text = draft.trim();
    if (!text || !active || sending) return;
    setSending(true);
    try {
      const { data } = await supabase.auth.getSession();
      const r = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data?.session?.access_token || ''}` },
        body: JSON.stringify({ conversationId: active.id, text }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error || 'Pesan gagal terkirim.');
      setDraft('');
      if (json.message) setMessages((prev) => (prev.some((m) => m.id === json.message.id) ? prev : [...prev, json.message]));
    } catch (e) {
      notifyError(e.message);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function togglePanel(name) {
    if (name === 'contact') setContactDraft(active?.contact_name || '');
    setPanel((p) => (p === name ? null : name));
  }

  // ---------- teks kejadian ----------
  function eventText(ev) {
    const actor = nameOf(ev.actor_id);
    switch (ev.kind) {
      case 'start':
        return 'Percakapan baru dimulai';
      case 'take':
        return `${actor} mengambil alih percakapan`;
      case 'transfer':
        return ev.target_id ? `${actor} mentransfer ke ${nameOf(ev.target_id)}` : `${actor} mengembalikan ke Antrian Umum`;
      case 'complete':
        return `${actor} menandai percakapan selesai`;
      case 'reopen':
        return `${actor} membuka kembali percakapan`;
      case 'classify':
        return ev.detail ? `${actor} mengubah klasifikasi jadi ${CLASS_LABEL[ev.detail] || ev.detail}` : `${actor} menghapus klasifikasi`;
      case 'contact':
        return `${actor} mengubah nama kontak jadi "${ev.detail}"`;
      default:
        return ev.kind;
    }
  }

  // ---------- render thread ----------
  const timeline = useMemo(() => {
    const items = [
      ...messages.map((m) => ({ type: 'msg', at: m.created_at, data: m })),
      ...events.map((e) => ({ type: 'event', at: e.created_at, data: e })),
    ];
    return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [messages, events]);

  const renderTimeline = () => {
    const out = [];
    let lastDay = null;
    timeline.forEach((it) => {
      const d = new Date(it.at);
      if (!lastDay || !sameDay(d, lastDay)) {
        out.push(
          <div key={'day-' + it.data.id} className={s.day}>
            <span>{dayLabel(d)}</span>
          </div>
        );
        lastDay = d;
      }
      if (it.type === 'event') {
        out.push(
          <div key={'ev-' + it.data.id} className={s.event}>
            <span>
              {eventText(it.data)} · {clock(it.at)}
            </span>
          </div>
        );
        return;
      }
      const m = it.data;
      const outgoing = m.direction === 'out';
      out.push(
        <div key={m.id} className={`${s.bubbleRow} ${outgoing ? s.rowOut : s.rowIn}`}>
          <div className={`${s.bubble} ${outgoing ? s.bubbleOut : s.bubbleIn}`}>
            <div className={s.bubbleText}>{m.body}</div>
            <div className={s.bubbleMeta}>
              {outgoing && <span>{m.sent_by ? nameOf(m.sent_by) : 'Dari HP'}</span>}
              <span>{clock(m.created_at)}</span>
              {outgoing && <StatusTick status={m.status} error={m.error} />}
            </div>
          </div>
        </div>
      );
    });
    return out;
  };

  // ---------- render ----------
  return (
    <section className={s.wrap}>
      {/* ===== Daftar pelanggan ===== */}
      <aside className={`${s.list} ${activeId ? s.hideMobile : ''}`}>
        <header className={s.listHead}>
          <h1 className={s.title}>Pelanggan</h1>
          <input
            className={s.search}
            type="search"
            placeholder="Cari nama, nomor, atau isi chat"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className={s.chips} role="tablist">
            {QUEUES.map((q) => (
              <button
                key={q.key}
                role="tab"
                aria-selected={queue === q.key}
                className={`${s.chip} ${queue === q.key ? s.chipOn : ''}`}
                onClick={() => setQueue(q.key)}
              >
                {q.label}
                {counts[q.key] > 0 && <span className={s.chipCount}>{counts[q.key]}</span>}
              </button>
            ))}
          </div>
        </header>

        <div className={s.items}>
          {loadingList ? (
            <p className={s.note}>Memuat chat…</p>
          ) : convs.length === 0 ? (
            <p className={s.note}>
              Belum ada chat. Pesan WhatsApp yang masuk ke nomor SAM Property akan muncul di sini, dan otomatis
              tercatat di tab Leads.
            </p>
          ) : visible.length === 0 ? (
            <p className={s.note}>Tidak ada chat di antrian ini.</p>
          ) : (
            visible.map((c) => (
              <button
                key={c.id}
                className={`${s.item} ${c.id === activeId ? s.itemOn : ''}`}
                onClick={() => setActiveId(c.id)}
              >
                <span className={s.avatar}>{initials(c.contact_name, c.wa_id)}</span>
                <span className={s.itemBody}>
                  <span className={s.itemTop}>
                    <span className={s.itemName}>{c.contact_name || formatPhone(c.wa_id)}</span>
                    <span className={`${s.itemTime} ${c.unread_count > 0 ? s.itemTimeNew : ''}`}>
                      {listTime(c.last_message_at)}
                    </span>
                  </span>
                  <span className={s.itemBottom}>
                    <span className={s.itemPreview}>{c.last_message_text || '—'}</span>
                    {c.unread_count > 0 && <span className={s.unread}>{c.unread_count}</span>}
                  </span>
                  <span className={s.itemBadges}>
                    <StageBadge stage={c.stage} />
                    <span className={`${s.badge} ${s.badgeAgent}`}>{c.assigned_to ? nameOf(c.assigned_to) : 'Belum dipegang'}</span>
                    <ClassBadge value={c.lead_class} />
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ===== Thread ===== */}
      <div className={`${s.thread} ${!activeId ? s.hideMobile : ''}`}>
        {!active ? (
          <div className={s.threadEmpty}>
            <p>Pilih pelanggan di sebelah kiri untuk membaca dan membalas chat.</p>
          </div>
        ) : (
          <>
            {notice && (
              <div className={s.notice} role="status">
                <span>{notice}</span>
                <button className={s.noticeClose} onClick={() => setNotice('')} aria-label="Tutup">
                  ×
                </button>
              </div>
            )}

            <header className={s.threadHead}>
              <div className={s.headRow}>
                <button className={s.back} onClick={() => setActiveId(null)} aria-label="Kembali ke daftar">
                  ‹
                </button>
                <span className={`${s.avatar} ${s.avatarLg}`}>{initials(active.contact_name, active.wa_id)}</span>
                <div className={s.who}>
                  <div className={s.whoName}>{active.contact_name || formatPhone(active.wa_id)}</div>
                  <div className={s.whoSub}>{formatPhone(active.wa_id)}</div>
                  <div className={s.itemBadges}>
                    <StageBadge stage={active.stage} />
                    <span className={`${s.badge} ${s.badgeAgent}`}>
                      {active.assigned_to ? nameOf(active.assigned_to) : 'Belum dipegang'}
                    </span>
                    <ClassBadge value={active.lead_class} />
                  </div>
                </div>

                <div className={s.live} title={windowOpen ? `Sisa ${windowText(windowLeft)} untuk membalas bebas` : 'Jendela 24 jam sudah tutup'}>
                  <span className={`${s.liveDot} ${windowOpen ? s.liveOn : ''}`} />
                  {windowOpen ? 'Live' : 'Tutup'}
                </div>
              </div>

              <div className={s.actions}>
                {showTake && (
                  <button className={s.btnPrimary} onClick={take} disabled={busy}>
                    Ambil Alih
                  </button>
                )}
                <button className={s.btnOutline} onClick={() => togglePanel('class')} disabled={!canManage || busy} aria-expanded={panel === 'class'}>
                  Klasifikasi Lead
                </button>
                <button className={s.btnOutline} onClick={() => togglePanel('contact')} disabled={!canManage || busy} aria-expanded={panel === 'contact'}>
                  Ubah Kontak
                </button>
                <button className={s.btnOutline} onClick={() => togglePanel('transfer')} disabled={!canManage || busy} aria-expanded={panel === 'transfer'}>
                  Transfer
                </button>
                {active.stage !== 'selesai' ? (
                  <button className={s.btnSuccess} onClick={complete} disabled={!canManage || busy}>
                    Selesai
                  </button>
                ) : (
                  <button className={s.btnOutline} onClick={reopen} disabled={!canManage || busy}>
                    Buka Lagi
                  </button>
                )}
              </div>

              {!canManage && active.assigned_to && !isAdmin && (
                <p className={s.hint}>Chat ini dipegang {nameOf(active.assigned_to)}. Hanya pemegang chat atau admin yang bisa mengubahnya.</p>
              )}
              {!canManage && !active.assigned_to && (
                <p className={s.hint}>Klik Ambil Alih untuk mulai menangani pelanggan ini.</p>
              )}

              {panel === 'class' && (
                <div className={s.panel}>
                  <span className={s.panelLabel}>Klasifikasi lead</span>
                  <div className={s.panelRow}>
                    {CLASS_OPTIONS.map((o) => (
                      <button
                        key={o.key}
                        className={`${s.classBtn} ${s['cls_' + o.key]} ${active.lead_class === o.key ? s.classOn : ''}`}
                        onClick={() => setClass(o.key)}
                        disabled={busy}
                      >
                        {o.label}
                      </button>
                    ))}
                    {active.lead_class && (
                      <button className={s.linkBtn} onClick={() => setClass(null)} disabled={busy}>
                        Hapus
                      </button>
                    )}
                  </div>
                </div>
              )}

              {panel === 'contact' && (
                <div className={s.panel}>
                  <label className={s.panelLabel} htmlFor="wa-contact-name">
                    Nama kontak (ikut memperbarui nama di tab Leads)
                  </label>
                  <div className={s.panelRow}>
                    <input
                      id="wa-contact-name"
                      className={s.panelInput}
                      value={contactDraft}
                      onChange={(e) => setContactDraft(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveContact()}
                      maxLength={80}
                    />
                    <button className={s.btnPrimary} onClick={saveContact} disabled={busy || !contactDraft.trim()}>
                      Simpan
                    </button>
                  </div>
                </div>
              )}

              {panel === 'transfer' && (
                <div className={s.panel}>
                  <span className={s.panelLabel}>Transfer chat ke</span>
                  <div className={s.panelRow}>
                    {profiles
                      .filter((p) => p.id !== active.assigned_to)
                      .map((p) => (
                        <button key={p.id} className={s.btnOutline} onClick={() => transfer(p.id)} disabled={busy}>
                          {p.name || 'Tanpa nama'}
                        </button>
                      ))}
                    {active.assigned_to && (
                      <button className={s.linkBtn} onClick={() => transfer(null)} disabled={busy}>
                        Kembalikan ke Antrian Umum
                      </button>
                    )}
                  </div>
                </div>
              )}
            </header>

            <div className={s.messages} ref={threadRef}>
              {loadingMsgs ? <p className={s.note}>Memuat pesan…</p> : renderTimeline()}
            </div>

            <footer className={s.composer}>
              {!windowOpen ? (
                <p className={s.closedNote}>
                  Sudah lewat 24 jam sejak pesan terakhir pelanggan, jadi WhatsApp hanya menerima pesan template (menyusul
                  di Fase 3). Untuk sekarang, tunggu pelanggan membalas atau hubungi dari HP.
                </p>
              ) : !canReply ? (
                <p className={s.closedNote}>Chat ini dipegang {nameOf(active.assigned_to)}.</p>
              ) : (
                <>
                  <div className={s.composerMain}>
                    <textarea
                      className={s.input}
                      rows={1}
                      placeholder="Tulis balasan… (Enter kirim, Shift+Enter baris baru)"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onKeyDown}
                      disabled={sending}
                    />
                    <span className={s.windowNote}>Sisa {windowText(windowLeft)} untuk membalas bebas</span>
                  </div>
                  <button className={s.send} onClick={send} disabled={sending || !draft.trim()}>
                    {sending ? 'Mengirim…' : 'Kirim'}
                  </button>
                </>
              )}
            </footer>
          </>
        )}
      </div>
    </section>
  );
}
