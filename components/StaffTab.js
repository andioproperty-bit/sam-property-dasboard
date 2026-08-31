import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatRupiah } from '../lib/format';

export default function StaffTab({ profiles, transactions, isAdmin, refresh, showToast }) {
  const [savingId, setSavingId] = useState(null);

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
      </div>

      {isAdmin && (
        <div className="panel" style={{ marginBottom: 20, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--ink)' }}>Menambah staf baru:</strong> buka Supabase Dashboard → Authentication → Users → Add user,
          buatkan email &amp; password untuk staf tersebut. Akun akan otomatis muncul di daftar bawah ini dengan role default <em>Agen</em> —
          ubah jadi <em>Admin</em> di sini kalau perlu.
        </div>
      )}

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
    </section>
  );
}
