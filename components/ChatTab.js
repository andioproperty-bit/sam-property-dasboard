import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import s from './ChatTab.module.css';

const WINDOW_MS = 24 * 60 * 60 * 1000;

const FILTERS = [
  { key: 'mine', label: 'Chat saya' },
  { key: 'unassigned', label: 'Belum dipegang' },
  { key: 'all', label: 'Semua' },
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

function timeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (sameDay(d, new Date())) return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
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

// ---------- komponen utama ----------
export default function ChatTab({ user, isAdmin, profiles = [], showToast }) {
  const [convs, setConvs] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [filter, setFilter] = useState(isAdmin ? 'all' : 'mine');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(Date.now());
  const threadRef = useRef(null);

  const toastRef = useRef(showToast);
  toastRef.current = showToast;
  const notify = (msg) => (toastRef.current ? toastRef.current(msg, 'error') : window.alert(msg));

  const nameOf = (id) => profiles.find((p) => p.id === id)?.name || 'Staf';

  // Daftar percakapan + realtime
  const fetchConvs = useCallback(async () => {
    const { data, error } = await supabase
      .from('wa_conversations')
      .select('*, lead:leads(id, name, status)')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(300);
    if (error) {
      console.error(error);
      notify('Daftar chat gagal dimuat: ' + error.message);
    } else {
      setConvs(data || []);
    }
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

  // Pesan untuk chat yang sedang dibuka + realtime
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return undefined;
    }
    let cancelled = false;
    setLoadingMsgs(true);

    supabase
      .from('wa_messages')
      .select('id, direction, body, msg_type, status, error, sent_by, created_at')
      .eq('conversation_id', activeId)
      .order('created_at', { ascending: true })
      .limit(500)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) notify('Pesan gagal dimuat: ' + error.message);
        setMessages(data || []);
        setLoadingMsgs(false);
      });

    supabase.rpc('wa_mark_read', { p_conversation_id: activeId }).then(() => {});

    const filterStr = `conversation_id=eq.${activeId}`;
    const channel = supabase
      .channel('wa-messages-' + activeId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_messages', filter: filterStr }, (p) => {
        setMessages((prev) => (prev.some((m) => m.id === p.new.id) ? prev : [...prev, p.new]));
        if (p.new.direction === 'in') supabase.rpc('wa_mark_read', { p_conversation_id: activeId }).then(() => {});
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wa_messages', filter: filterStr }, (p) => {
        setMessages((prev) => prev.map((m) => (m.id === p.new.id ? { ...m, ...p.new } : m)));
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Auto-scroll ke pesan terbaru
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, activeId]);

  const counts = useMemo(
    () => ({
      mine: convs.filter((c) => c.assigned_to === user?.id).length,
      unassigned: convs.filter((c) => !c.assigned_to).length,
      all: convs.length,
    }),
    [convs, user]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let digits = q.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '62' + digits.slice(1);
    return convs.filter((c) => {
      if (filter === 'mine' && c.assigned_to !== user?.id) return false;
      if (filter === 'unassigned' && c.assigned_to) return false;
      if (!q) return true;
      return (
        (c.contact_name || '').toLowerCase().includes(q) ||
        (c.lead?.name || '').toLowerCase().includes(q) ||
        (c.last_message_text || '').toLowerCase().includes(q) ||
        (digits.length >= 3 && (c.wa_id || '').includes(digits))
      );
    });
  }, [convs, filter, query, user]);

  const active = convs.find((c) => c.id === activeId) || null;
  const windowLeft = active?.last_inbound_at ? WINDOW_MS - (now - Date.parse(active.last_inbound_at)) : 0;
  const windowOpen = windowLeft > 0;
  const canReply =
    active && windowOpen && (isAdmin || !active.assigned_to || active.assigned_to === user?.id);

  // ---------- aksi ----------
  async function updateConv(patch) {
    if (!active) return;
    const { error } = await supabase.from('wa_conversations').update(patch).eq('id', active.id);
    if (error) notify('Perubahan gagal disimpan: ' + error.message);
    else fetchConvs();
  }

  async function send() {
    const text = draft.trim();
    if (!text || !active || sending) return;
    setSending(true);
    try {
      const { data } = await supabase.auth.getSession();
      const r = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data?.session?.access_token || ''}`,
        },
        body: JSON.stringify({ conversationId: active.id, text }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error || 'Pesan gagal terkirim.');
      setDraft('');
      if (json.message) {
        setMessages((prev) => (prev.some((m) => m.id === json.message.id) ? prev : [...prev, json.message]));
      }
    } catch (e) {
      notify(e.message);
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

  // ---------- render ----------
  const renderMessages = () => {
    const out = [];
    let lastDay = null;
    messages.forEach((m) => {
      const d = new Date(m.created_at);
      if (!lastDay || !sameDay(d, lastDay)) {
        out.push(
          <div key={'day-' + m.id} className={s.day}>
            <span>{dayLabel(d)}</span>
          </div>
        );
        lastDay = d;
      }
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

  return (
    <section className={s.wrap}>
      {/* ===== Daftar chat ===== */}
      <aside className={`${s.list} ${activeId ? s.hideMobile : ''}`}>
        <header className={s.listHead}>
          <h1 className={s.title}>Chat WhatsApp</h1>
          <input
            className={s.search}
            type="search"
            placeholder="Cari nama, nomor, atau isi chat"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className={s.filters} role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                className={`${s.filter} ${filter === f.key ? s.filterOn : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label} <span className={s.filterCount}>{counts[f.key]}</span>
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
            <p className={s.note}>Tidak ada chat di filter ini.</p>
          ) : (
            visible.map((c) => (
              <button
                key={c.id}
                className={`${s.item} ${c.id === activeId ? s.itemOn : ''} ${c.status === 'closed' ? s.itemClosed : ''}`}
                onClick={() => setActiveId(c.id)}
              >
                <span className={s.avatar}>{initials(c.contact_name, c.wa_id)}</span>
                <span className={s.itemBody}>
                  <span className={s.itemTop}>
                    <span className={s.itemName}>{c.contact_name || formatPhone(c.wa_id)}</span>
                    <span className={s.itemTime}>{timeLabel(c.last_message_at)}</span>
                  </span>
                  <span className={s.itemBottom}>
                    <span className={s.itemPreview}>{c.last_message_text || '—'}</span>
                    {c.unread_count > 0 && <span className={s.unread}>{c.unread_count}</span>}
                  </span>
                  <span className={s.itemOwner}>
                    {c.assigned_to ? nameOf(c.assigned_to) : 'Belum dipegang'}
                    {c.status === 'closed' ? ' · selesai' : ''}
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
            <p>Pilih chat di sebelah kiri untuk membaca dan membalas.</p>
          </div>
        ) : (
          <>
            <header className={s.threadHead}>
              <div className={s.headRow}>
                <button className={s.back} onClick={() => setActiveId(null)} aria-label="Kembali ke daftar chat">
                  ‹
                </button>
                <div className={s.who}>
                  <div className={s.whoName}>{active.contact_name || formatPhone(active.wa_id)}</div>
                  <div className={s.whoSub}>
                    {formatPhone(active.wa_id)}
                    {active.lead && <span className={s.leadBadge}>Lead: {active.lead.status || 'Baru'}</span>}
                  </div>
                </div>
                <div className={s.controls}>
                  {isAdmin ? (
                    <select
                      className={s.select}
                      value={active.assigned_to || ''}
                      onChange={(e) => updateConv({ assigned_to: e.target.value || null })}
                      aria-label="Pegang chat oleh"
                    >
                      <option value="">Belum dipegang</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || 'Tanpa nama'}
                        </option>
                      ))}
                    </select>
                  ) : !active.assigned_to ? (
                    <button className={s.btnGold} onClick={() => updateConv({ assigned_to: user.id })}>
                      Ambil chat
                    </button>
                  ) : null}
                  <button
                    className={s.btnGhost}
                    onClick={() => updateConv({ status: active.status === 'closed' ? 'open' : 'closed' })}
                  >
                    {active.status === 'closed' ? 'Buka lagi' : 'Tandai selesai'}
                  </button>
                </div>
              </div>

              {/* Meter jendela balas 24 jam */}
              <div className={s.meterWrap}>
                <div className={s.meter} aria-hidden="true">
                  <span
                    className={`${s.meterFill} ${windowLeft < 3 * 3600000 ? s.meterLow : ''}`}
                    style={{ width: `${Math.max(0, Math.min(100, (windowLeft / WINDOW_MS) * 100))}%` }}
                  />
                </div>
                <span className={s.meterText}>
                  {windowOpen
                    ? `Sisa ${windowText(windowLeft)} untuk membalas bebas`
                    : 'Jendela balas 24 jam sudah tutup'}
                </span>
              </div>
            </header>

            <div className={s.messages} ref={threadRef}>
              {loadingMsgs ? <p className={s.note}>Memuat pesan…</p> : renderMessages()}
            </div>

            <footer className={s.composer}>
              {!windowOpen ? (
                <p className={s.closedNote}>
                  Sudah lewat 24 jam sejak pesan terakhir pelanggan, jadi WhatsApp hanya menerima pesan template.
                  Fitur template menyusul di Fase 3. Untuk sekarang, tunggu pelanggan membalas atau hubungi dari HP.
                </p>
              ) : !canReply ? (
                <p className={s.closedNote}>Chat ini dipegang {nameOf(active.assigned_to)}.</p>
              ) : (
                <>
                  <textarea
                    className={s.input}
                    rows={1}
                    placeholder="Tulis balasan… (Enter kirim, Shift+Enter baris baru)"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                    disabled={sending}
                  />
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
