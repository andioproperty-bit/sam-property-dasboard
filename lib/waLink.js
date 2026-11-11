// Link WhatsApp yang bisa diarahkan ke WA Business atau WA biasa (khusus Android).
// iPhone & laptop selalu memakai wa.me (sistem yang memilih aplikasinya).

export const WA_APP_OPTIONS = [
  { value: 'otomatis', label: 'Otomatis (ikut HP)' },
  { value: 'bisnis', label: 'WhatsApp Business' },
  { value: 'biasa', label: 'WhatsApp biasa' },
];

export function waNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 8) return '';
  if (d.startsWith('0')) return '62' + d.slice(1);
  if (d.startsWith('8')) return '62' + d;
  return d;
}

export function isAndroid() {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
}

// Mengembalikan { href, target } untuk dipakai di <a>
export function waLink(phone, { text = '', app = 'otomatis' } = {}) {
  const num = waNumber(phone);
  if (!num) return null;
  const q = text ? `text=${encodeURIComponent(text)}` : '';
  const web = `https://wa.me/${num}${q ? '?' + q : ''}`;
  if (!app || app === 'otomatis' || !isAndroid()) return { href: web, target: '_blank' };
  const pkg = app === 'bisnis' ? 'com.whatsapp.w4b' : 'com.whatsapp';
  // Kalau aplikasinya tidak terpasang, Chrome otomatis kembali ke wa.me
  const href = `intent://send/?phone=${num}${q ? '&' + q : ''}#Intent;scheme=whatsapp;package=${pkg};S.browser_fallback_url=${encodeURIComponent(web)};end`;
  return { href, target: undefined };
}

export function waAppLabel(app) {
  return (WA_APP_OPTIONS.find((o) => o.value === app) || WA_APP_OPTIONS[0]).label;
}
