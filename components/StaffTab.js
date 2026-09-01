import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatRupiah } from '../lib/format';
import Modal from './Modal';

export default function StaffTab({ profiles, transactions, isAdmin, refresh, showToast }) {
  const [savingId, setSavingId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

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
            </div>
          );
        })}
      </div>

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
