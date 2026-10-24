// Fungsi bantu untuk menu Absensi & Kinerja
import { supabase } from '../lib/supabaseClient';

export const TZ = 'Asia/Jakarta';
export const DAY_SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']; // urutan ISO 1..7
export const DAY_LONG = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

export const STATUS = {
  tepat: { label: 'Tepat waktu', short: 'Hadir', tone: 'ok' },
  terlambat: { label: 'Terlambat', short: 'Telat', tone: 'warn' },
  izin: { label: 'Izin', short: 'Izin', tone: 'info' },
  sakit: { label: 'Sakit', short: 'Sakit', tone: 'info' },
  cuti: { label: 'Cuti', short: 'Cuti', tone: 'info' },
  dinas: { label: 'Dinas luar', short: 'Dinas', tone: 'info' },
  alpa: { label: 'Tidak hadir', short: 'Alpa', tone: 'bad' },
  belum: { label: 'Belum absen', short: 'Belum', tone: 'none' },
  bebas: { label: 'Tidak wajib absen', short: '—', tone: 'none' },
  libur: { label: 'Libur', short: 'Libur', tone: 'off' },
};

export const LEAVE_KIND = {
  izin: 'Izin',
  sakit: 'Sakit',
  cuti: 'Cuti',
  dinas: 'Dinas luar',
};

export const PLACE_LABEL = {
  kantor: 'Di kantor',
  luar: 'Di luar kantor',
  tidak_diatur: 'Lokasi tercatat',
  manual: 'Input admin',
};

// ---------- tanggal & jam (selalu WIB) ----------
function parts(date, opts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, ...opts }).formatToParts(date);
}

export function jakartaToday() {
  const p = parts(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit' });
  const get = (t) => p.find((x) => x.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function jakartaMinutesNow() {
  const p = parts(new Date(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const get = (t) => Number(p.find((x) => x.type === t).value);
  return get('hour') * 60 + get('minute');
}

export function clockText(date = new Date()) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function fmtTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(iso)
  );
}

export function timeInputValue(iso) {
  if (!iso) return '';
  return fmtTime(iso).replace('.', ':');
}

export function fmtDateLong(ymd) {
  const d = new Date(ymd + 'T12:00:00+07:00');
  return new Intl.DateTimeFormat('id-ID', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

export function fmtDateShort(ymd) {
  const d = new Date(ymd + 'T12:00:00+07:00');
  return new Intl.DateTimeFormat('id-ID', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

export function fmtMonth(ymd) {
  const d = new Date(ymd.slice(0, 7) + '-15T12:00:00+07:00');
  return new Intl.DateTimeFormat('id-ID', { timeZone: TZ, month: 'long', year: 'numeric' }).format(d);
}

export function monthStart(ymd) {
  return ymd.slice(0, 7) + '-01';
}

export function addMonths(ymd, n) {
  const [y, m] = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function monthEnd(ymd) {
  const next = addMonths(monthStart(ymd), 1);
  const d = new Date(next + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function daysInMonth(ymd) {
  const out = [];
  const start = monthStart(ymd);
  const end = monthEnd(ymd);
  for (let d = new Date(start + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// 1 = Senin ... 7 = Minggu
export function isoDow(ymd) {
  const g = new Date(ymd + 'T00:00:00Z').getUTCDay();
  return g === 0 ? 7 : g;
}

export function toMinutes(t) {
  if (!t) return 0;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

export function hhmm(t) {
  return String(t || '').slice(0, 5).replace(':', '.');
}

export function fmtDuration(min) {
  const v = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(v / 60);
  const m = v % 60;
  if (!h) return `${m} mnt`;
  return m ? `${h} j ${m} m` : `${h} jam`;
}

export function fmtDistance(m) {
  if (m === null || m === undefined) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;
}

export function mapsUrl(lat, lng) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function distanceM(lat1, lng1, lat2, lng2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(a)));
}

// ---------- GPS ----------
export function getPosition() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Perangkat ini tidak mendukung GPS.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (err) => {
        if (err.code === 1) {
          reject(
            new Error(
              'Izin lokasi ditolak. Buka pengaturan browser/HP, izinkan lokasi untuk sam-admin.asvarakozta.id, lalu coba lagi.'
            )
          );
        } else if (err.code === 3) {
          reject(new Error('GPS terlalu lama merespons. Pastikan GPS aktif dan coba lagi di tempat terbuka.'));
        } else {
          reject(new Error('Lokasi tidak bisa dibaca. Pastikan GPS aktif, lalu coba lagi.'));
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

// ---------- foto ----------
export async function compressImage(blob, maxSize = 960, quality = 0.72) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Foto tidak bisa dibaca.'));
      i.src = url;
    });
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b || blob), 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const signedCache = {};
export async function signedUrl(path) {
  if (!path) return null;
  const hit = signedCache[path];
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data } = await supabase.storage.from('attendance').createSignedUrl(path, 3600);
  if (data?.signedUrl) signedCache[path] = { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 };
  return data?.signedUrl || null;
}

export async function uploadAttendanceFile(userId, blob, label) {
  const path = `${userId}/${jakartaToday()}-${label}-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('attendance').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error('Foto gagal diunggah: ' + error.message);
  return path;
}

// ---------- CSV ----------
export function downloadCsv(filename, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Pesan error dari database dibuat lebih rapi
export function cleanError(err) {
  const msg = err?.message || String(err || 'Terjadi kesalahan.');
  return msg.replace(/^.*?ERROR:\s*/i, '');
}
