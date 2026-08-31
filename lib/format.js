export function formatRupiah(n) {
  n = Number(n) || 0;
  return 'Rp ' + n.toLocaleString('id-ID');
}

export function formatDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function monthKey(d) {
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
}

export function monthLabel(key) {
  const [y, m] = key.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return names[parseInt(m) - 1] + ' ' + y.slice(2);
}
