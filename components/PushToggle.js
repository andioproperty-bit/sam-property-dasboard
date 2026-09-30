import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import s from './PushToggle.module.css';

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${data?.session?.access_token || ''}` };
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

// Status: loading | unsupported | ios-install | nokey | denied | off | on
export default function PushToggle({ showToast }) {
  const [status, setStatus] = useState('loading');
  const [busy, setBusy] = useState(false);
  const notify = (msg, type) => (showToast ? showToast(msg, type) : window.alert(msg));

  useEffect(() => {
    (async () => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (!supported) return setStatus(isIOS() ? 'ios-install' : 'unsupported');
      if (!VAPID_PUBLIC) return setStatus('nokey');
      if (Notification.permission === 'denied') return setStatus('denied');
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setStatus(sub ? 'on' : 'off');
      } catch {
        setStatus('off');
      }
    })();
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setStatus(perm === 'denied' ? 'denied' : 'off');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
        });
      }
      const r = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error || 'Gagal mengaktifkan notifikasi.');
      setStatus('on');
      notify('Notifikasi aktif di perangkat ini.');
    } catch (e) {
      notify(e.message || 'Gagal mengaktifkan notifikasi.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: await authHeaders(),
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus('off');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const r = await fetch('/api/push/test', { method: 'POST', headers: await authHeaders() });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error || 'Tes gagal.');
      notify('Notifikasi tes dikirim. Kalau layar ini sedang dibuka, kunci HP atau pindah aplikasi dulu untuk melihatnya.');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (status === 'loading' || status === 'unsupported') return null;

  if (status === 'on') {
    return (
      <div className={`${s.box} ${s.on}`}>
        <span className={s.text}>
          <span className={s.dot} /> Notifikasi aktif di perangkat ini
        </span>
        <span className={s.actions}>
          <button className={s.link} onClick={test} disabled={busy}>Tes</button>
          <button className={s.link} onClick={disable} disabled={busy}>Matikan</button>
        </span>
      </div>
    );
  }

  let message = 'Dapatkan notifikasi di HP setiap ada chat WA baru.';
  let action = (
    <button className={s.btn} onClick={enable} disabled={busy}>
      {busy ? 'Memproses…' : 'Aktifkan'}
    </button>
  );
  if (status === 'ios-install') {
    message = 'Di iPhone: instal dulu lewat Safari → Bagikan → Tambah ke Layar Utama, lalu buka dari ikon SAM Admin.';
    action = null;
  } else if (status === 'nokey') {
    message = 'Notifikasi belum siap: kunci VAPID belum diisi di Vercel.';
    action = null;
  } else if (status === 'denied') {
    message = 'Notifikasi diblokir. Izinkan di setelan HP/browser untuk situs ini, lalu muat ulang.';
    action = null;
  }

  return (
    <div className={s.box}>
      <span className={s.text}>{message}</span>
      {action}
    </div>
  );
}
