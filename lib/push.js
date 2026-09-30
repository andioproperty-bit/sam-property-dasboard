// Kirim notifikasi ke HP staf (Web Push). Khusus server.
import webpush from 'web-push';
import { supabaseAdmin } from './waServer';

let ready = null;

function setup() {
  if (ready !== null) return ready;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    console.warn('[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY belum di-set, notifikasi dilewati');
    ready = false;
    return ready;
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:ptsatyamanggalap@gmail.com', pub, priv);
  ready = true;
  return ready;
}

/**
 * userIds: array id staf penerima, atau null = semua staf yang mengaktifkan notifikasi.
 * payload: { title, body, url, tag }
 */
export async function sendPushToUsers(userIds, payload) {
  if (!setup()) return { sent: 0, failed: 0, removed: 0, reason: 'no-vapid' };
  const db = supabaseAdmin();

  let q = db.from('push_subscriptions').select('id, endpoint, p256dh, auth');
  if (Array.isArray(userIds)) {
    if (!userIds.length) return { sent: 0, failed: 0, removed: 0 };
    q = q.in('user_id', userIds);
  }
  const { data: subs, error } = await q;
  if (error) {
    console.error('[push] gagal membaca langganan:', error.message);
    return { sent: 0, failed: 0, removed: 0, reason: error.message };
  }
  if (!subs || !subs.length) return { sent: 0, failed: 0, removed: 0, reason: 'no-subscription' };

  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
        TTL: 60 * 60,
        urgency: 'high',
      })
    )
  );

  const dead = [];
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const code = r.reason?.statusCode;
      if (code === 404 || code === 410) dead.push(subs[i].id); // HP sudah mencabut izin / uninstall
      else {
        failed += 1;
        console.error('[push] gagal kirim:', code, r.reason?.body || r.reason?.message);
      }
    }
  });
  if (dead.length) await db.from('push_subscriptions').delete().in('id', dead);

  return { sent: results.filter((r) => r.status === 'fulfilled').length, failed, removed: dead.length };
}
