// Service worker SAM Admin — sengaja minimal.
// Data (Supabase, API) TIDAK pernah disimpan di cache supaya chat & leads selalu terbaru.
// Satu-satunya yang disimpan: halaman "tidak ada koneksi".
const CACHE = 'sam-admin-v1';
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
