import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatRupiah } from '../lib/format';
import Modal from './Modal';
import { MIN_PASSWORD, generatePassword } from '../lib/passwordUtils';

export default function StaffTab({ profiles, transactions, isAdmin, refresh, showToast }) {
  const [savingId, setSavingId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [resetFor, setResetFor] = useState(null);

  async function handleRoleChange(id, role) {
    setSavingId(id);
    const { error } = await supabase.from('profiles').update({ role }).eq('id', id);
    setSavingId(null);
    if (error) { showToast('Gagal mengubah role: ' + error.message); return; }
    showToast('Role diperbarui');
    refresh();
  }

  return (
    <section>
      <div className="topbar">
        <div>
          <h1>Staf &amp; Peran</h1>
          <p>Performa tiap staf dan pengaturan hak akses (Admin / Agen)</p>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ Tambah Staf Baru</button>
        )}
      </div>

      <div className="agent-grid">
        {profiles.map((p) => {
          const trx = transactions.filter((t) => t.agent_id === p.id);
          const totalCommission = trx.reduce((s, t) => s + (Number(t.commission_amount) || 0), 0);
          return (
            <div className="agent-card" key={p.id}>
              <div className="agent-name">{p.name}</div>
              <div className="agent-phone">{p.phone || 'Belum ada no. HP'}</div>
              <div className="agent-stats">
                <div><div className="agent-stat-label">CLOSING</div><div className="agent-stat-value">{trx.length}</div></div>
                <div><div className="agent-stat-label">KOMISI</div><div className="agent-stat-value" style={{ fontSize: 14 }}>{formatRupiah(totalCommission)}</div></div>
              </div>
              {isAdmin ? (
                <select
                  value={p.role}
                  disabled={savingId === p.id}
                  onChange={(e) => handleRoleChange(p.id, e.target.value)}
                  style={{ marginTop: 12, width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontFamily: 'var(--font-body)' }}
                >
                  <option value="agent">Agen</option>
                  <option value="admin">Admin</option>
                </select>
              ) : (
                <div style={{ marginTop: 12 }}><span className="badge badge-grey">{p.role === 'admin' ? 'Admin' : 'Agen'}</span></div>
              )}
              {isAdmin && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}
                  onClick={() => setResetFor(p)}
                >
                  Reset password
                </button>
              )}
            </div>
          );
        })}
      </div>

      {resetFor && (
        <ResetPasswordModal person={resetFor} onClose={() => setResetFor(null)} showToast={showToast} />
      )}

      {showAddModal && (
        <AddStaffModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => { setShowAddModal(false); showToast('Staf baru berhasil ditambahkan'); refresh(); }}
          showToast={showToast}
        />
      )}
    </section>
  );
}

function AddStaffModal({ onClose, onSuccess, showToast }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function set(key, val) { setForm((f) => ({ ...f, [key]: val })); }

  async function handleSubmit() {
    setError('');
    if (!form.name.trim()) { setError('Nama wajib diisi'); return; }
    if (!form.email.trim()) { setError('Email wajib diisi'); return; }
    if (form.password.length < 6) { setError('Password minimal 6 karakter'); return; }

    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) { setError('Sesi login tidak ditemukan, coba login ulang.'); setSubmitting(false); return; }

      const res = await fetch('/api/admin/create-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Gagal menambah staf');
        setSubmitting(false);
        return;
      }
      onSuccess();
    } catch (e) {
      setError('Terjadi kesalahan: ' + e.message);
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h3>Tambah Staf Baru</h3>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: -10, marginBottom: 16, lineHeight: 1.5 }}>
        Akun langsung aktif dan bisa dipakai login. Role default staf baru adalah <strong>Agen</strong> —
        bisa diubah jadi Admin lewat kartu staf setelah dibuat.
      </p>
      {error && <div className="auth-error">{error}</div>}
      <div className="field"><label>Nama</label><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Siti Rahma" /></div>
      <div className="field"><label>Email</label><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="siti@sampropertyagency.com" /></div>
      <div className="field"><label>No. HP (opsional)</label><input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="0812xxxxxxx" /></div>
      <div className="field"><label>Password Awal</label><input type="text" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="Minimal 6 karakter" /></div>
      <div className="field-hint">Sampaikan password ini ke staf yang bersangkutan secara langsung/pribadi.</div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Batal</button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Menyimpan...' : 'Buat Akun'}</button>
      </div>
    </Modal>
  );
}

function waNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('0') ? '62' + d.slice(1) : d;
}

function ResetPasswordModal({ person, onClose, showToast }) {
  const [password, setPassword] = useState(() => generatePassword());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    setError('');
    if (password.length < MIN_PASSWORD) { setError(`Password minimal ${MIN_PASSWORD} karakter`); return; }
    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: person.id, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || 'Gagal mereset password'); setSubmitting(false); return; }
      setDone(true);
      setSubmitting(false);
    } catch (e) {
      setError('Terjadi kesalahan: ' + e.message);
      setSubmitting(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      showToast('Password disalin');
    } catch {
      showToast('Salin manual: ' + password);
    }
  }

  const message =
    `Halo ${person.name}, password dashboard SAM Admin Anda sudah direset.\n\n` +
    `Password sementara: ${password}\n` +
    `Login di https://sam-admin.asvarakozta.id lalu segera ganti lewat menu "Ganti password".`;
  const wa = waNumber(person.phone);

  return (
    <Modal onClose={submitting ? () => {} : onClose}>
      <h3>Reset password · {person.name}</h3>
      {!done ? (
        <>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: -10, marginBottom: 16, lineHeight: 1.5 }}>
            Password lama {person.name} langsung tidak berlaku setelah disimpan.
          </p>
          {error && <div className="auth-error">{error}</div>}
          <div className="field">
            <label htmlFor="rp-pass">Password baru</label>
            <input id="rp-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value.trim())} autoComplete="off" />
          </div>
          <div className="field-hint">
            Minimal {MIN_PASSWORD} karakter.{' '}
            <button type="button" onClick={() => setPassword(generatePassword())} style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
              Buat acak lagi
            </button>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Batal</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Menyimpan...' : 'Simpan Password Baru'}</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ background: '#E3F1E8', color: '#24603D', fontSize: 13, padding: '11px 13px', borderRadius: 6, marginBottom: 14, lineHeight: 1.5 }}>
            Password {person.name} sudah diganti. Sampaikan password ini secara pribadi dan minta {person.name} menggantinya setelah login.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 14 }}>
            <code style={{ flex: 1, fontSize: 17, fontWeight: 700, letterSpacing: '0.04em' }}>{password}</code>
            <button className="btn btn-ghost btn-sm" onClick={copy}>Salin</button>
          </div>
          <div className="modal-actions">
            {wa ? (
              <a className="btn btn-ghost" href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
                Kirim via WhatsApp
              </a>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--ink-faint)', marginRight: 'auto', alignSelf: 'center' }}>No. HP staf belum diisi</span>
            )}
            <button className="btn btn-primary" onClick={onClose}>Selesai</button>
          </div>
        </>
      )}
    </Modal>
  );
}
