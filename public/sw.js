// Service worker SAM Admin — sengaja minimal.
// Data (Supabase, API) TIDAK pernah disimpan di cache supaya chat & leads selalu terbaru.
// Satu-satunya yang disimpan: halaman "tidak ada koneksi".
const CACHE = 'sam-admin-v2';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE_URL, '/icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Hanya tangani perpindahan halaman; sisanya langsung ke internet seperti biasa.
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});

// ---------- Notifikasi chat WA ----------
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'SAM Admin', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Chat WA baru';
  const options = {
    body: data.body || 'Ada pesan baru dari pelanggan.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'sam-chat',
    renotify: true,
    data: { url: data.url || '/dashboard?tab=chat' },
  };
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Kalau dashboard sedang dibuka dan dilihat, tidak perlu notifikasi
      const watching = list.some((c) => c.visibilityState === 'visible' && c.focused);
      if (watching) return undefined;
      return self.registration.showNotification(title, options);
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/dashboard?tab=chat', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && 'focus' in c) {
          return c.focus().then((fc) => (fc && 'navigate' in fc ? fc.navigate(url) : undefined)).catch(() => self.clients.openWindow(url));
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
