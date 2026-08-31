import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import Modal from './Modal';
import { formatRupiah, formatDate } from '../lib/format';

export default function TransactionsTab({ transactions, properties, leads, profiles, user, isAdmin, refresh, showToast }) {
  const [editing, setEditing] = useState(null);

  const rows = [...transactions].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  function canManage(t) { return isAdmin || t.agent_id === user.id; }

  async function handleSave(form) {
    const price = Number(form.price) || 0;
    const commissionPercent = Number(form.commission_percent) || 0;
    const payload = {
      property_id: form.property_id,
      lead_id: form.lead_id || null,
      agent_id: form.agent_id || null,
      type: form.type,
      price,
      commission_percent: commissionPercent,
      commission_amount: Math.round((price * commissionPercent) / 100),
      date: form.date,
    };
    let error;
    if (form.id) ({ error } = await supabase.from('transactions').update(payload).eq('id', form.id));
    else ({ error } = await supabase.from('transactions').insert(payload));
    if (error) { showToast('Gagal menyimpan: ' + error.message); return; }
    setEditing(null); showToast('Transaksi tersimpan'); refresh();
  }

  async function handleDelete(id) {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) { showToast('Gagal menghapus: ' + error.message); return; }
    setEditing(null); showToast('Transaksi dihapus'); refresh();
  }

  return (
    <section>
      <div className="topbar">
        <div><h1>Transaksi</h1><p>Closing jual &amp; sewa beserta komisi agen</p></div>
        <button className="btn btn-primary" onClick={() => properties.length ? setEditing({}) : showToast('Tambahkan listing properti dulu')}>+ Tambah Transaksi</button>
      </div>

      <div className="table-wrap">
        {transactions.length === 0 ? (
          <div className="empty-state"><div className="big">Belum ada transaksi</div><div>Catat closing untuk melacak komisi dan performa agen.</div></div>
        ) : (
          <table>
            <thead><tr><th>Tanggal</th><th>Properti</th><th>Agen</th><th>Tipe</th><th>Harga Deal</th><th>Komisi</th><th></th></tr></thead>
            <tbody>
              {rows.map((t) => {
                const prop = properties.find((p) => p.id === t.property_id);
                const agent = profiles.find((a) => a.id === t.agent_id);
                return (
                  <tr key={t.id}>
                    <td>{formatDate(t.date)}</td>
                    <td className="cell-strong">{prop ? prop.title : <span className="cell-soft">(dihapus)</span>}</td>
                    <td>{agent ? agent.name : <span className="cell-soft">-</span>}</td>
                    <td>{t.type === 'Jual' ? <span className="badge badge-gold">Jual</span> : <span className="badge badge-green">Sewa</span>}</td>
                    <td>{formatRupiah(t.price)}</td>
                    <td className="cell-strong" style={{ color: 'var(--gold)' }}>{formatRupiah(t.commission_amount)} <span className="cell-soft">({t.commission_percent}%)</span></td>
                    <td>{canManage(t) && <div className="row-actions"><button className="icon-btn" title="Edit" onClick={() => setEditing(t)}>✎</button></div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing !== null && (
        <TransactionModal data={editing} properties={properties} leads={leads} profiles={profiles} isAdmin={isAdmin} user={user} onClose={() => setEditing(null)} onSave={handleSave} onDelete={handleDelete} />
      )}
    </section>
  );
}

function TransactionModal({ data, properties, leads, profiles, isAdmin, user, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({
    id: data.id || null,
    property_id: data.property_id || (properties[0] && properties[0].id) || '',
    lead_id: data.lead_id || '',
    agent_id: data.agent_id || (isAdmin ? '' : user.id),
    type: data.type || 'Jual',
    price: data.price || '',
    commission_percent: data.commission_percent !== undefined ? data.commission_percent : 2.5,
    date: data.date ? data.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
  });
  function set(key, val) { setForm((f) => ({ ...f, [key]: val })); }

  return (
    <Modal onClose={onClose}>
      <h3>{data.id ? 'Edit' : 'Tambah'} Transaksi</h3>
      <div className="field"><label>Properti</label><select value={form.property_id} onChange={(e) => set('property_id', e.target.value)}>{properties.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
      <div className="field"><label>Lead / Klien</label><select value={form.lead_id} onChange={(e) => set('lead_id', e.target.value)}><option value="">- Tidak ada -</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
      <div className="field-row">
        <div className="field"><label>Agen</label><select value={form.agent_id} onChange={(e) => set('agent_id', e.target.value)} disabled={!isAdmin && !!data.id}>{profiles.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="field"><label>Tipe</label><select value={form.type} onChange={(e) => set('type', e.target.value)}><option>Jual</option><option>Sewa</option></select></div>
      </div>
      <div className="field-row">
        <div className="field"><label>Harga Deal (Rp)</label><input type="number" value={form.price} onChange={(e) => set('price', e.target.value)} placeholder="800000000" /></div>
        <div className="field"><label>Komisi (%)</label><input type="number" step="0.1" value={form.commission_percent} onChange={(e) => set('commission_percent', e.target.value)} placeholder="2.5" /></div>
      </div>
      <div className="field"><label>Tanggal Closing</label><input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></div>
      <div className="modal-actions">
        {data.id && isAdmin && <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={() => onDelete(data.id)}>Hapus</button>}
        <button className="btn btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" onClick={() => form.property_id ? onSave(form) : null}>Simpan</button>
      </div>
    </Modal>
  );
}
