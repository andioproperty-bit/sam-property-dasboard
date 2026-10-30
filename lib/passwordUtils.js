// Fungsi bantu password untuk halaman login, lupa password, dan admin
export const MIN_PASSWORD = 8;
export const ADMIN_WA = '6281130320099';

// 0–3: lemah, cukup, kuat
export function passwordStrength(pw) {
  if (!pw || pw.length < MIN_PASSWORD) return pw ? 1 : 0;
  let score = 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw) && (pw.length >= 10 || /[^A-Za-z0-9]/.test(pw))) score += 1;
  return Math.min(3, score);
}

export function strengthLabel(level) {
  return ['', 'Lemah', 'Cukup', 'Kuat'][level] || '';
}

// Password acak yang mudah dibacakan (tanpa huruf/angka yang mirip seperti 0/O, 1/l)
export function generatePassword() {
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set, n) => {
    const buf = new Uint32Array(n);
    crypto.getRandomValues(buf);
    return Array.from(buf, (x) => set[x % set.length]).join('');
  };
  return pick(upper, 1) + pick(lower, 5) + pick(digits, 4);
}

export function waAdminUrl(text) {
  return `https://wa.me/${ADMIN_WA}?text=${encodeURIComponent(text)}`;
}
