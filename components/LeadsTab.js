import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import Modal from './Modal';

const STATUS_OPTIONS = ['Baru', 'Follow-up', 'Nego', 'Closing', 'Hilang'];
const SOURCE_OPTIONS = ['WhatsApp', 'Instagram', 'Facebook', 'Website', 'Referral', 'Walk-in'];
const STATUS_BADGE = { Baru: 'badge-grey', 'Follow-up': 'badge-gold', Nego: 'badge-gold', Closing: 'badge-green', Hilang: 'badge-red' };

export default function LeadsTab({ leads, properties, profiles, user, isAdmin, refresh, showToast }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState(null);

  const rows = leads
    .filter((l) => {
      const matchSearch = (l.name || '').toLowerCase().includes(search.toLowerCase()) || (l.phone || '').toLowerCase().includes(search.toLowerCase());
      const matchStatus = !statusFilter || l.status === statusFilter;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  function canManage(l) { return isAdmin || l.agent_id === user.id; }

  async function handleSave(form) {
    const payload = {
      name: form.name,
      phone: form.phone,
      source: form.source,
      status: form.status,
      property_id: form.property_id || null,
      agent_id: form.agent_id || null,
      notes: form.notes,
    };
    let error;
    if (form.id) ({ error } = await supabase.from('leads').update(payload).eq('id', form.id));
    else ({ error } = await supabase.from('leads').insert(payload));
    if (error) { showToast('Gagal menyimpan: ' + error.message); return; }
    setEditing(null); showToast('Lead tersimpan'); refresh();
  }

  async function handleDelete(id) {
    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) { showToast('Gagal menghapus: ' + error.message); return; }
    setEditing(null); showToast('Lead dihapus'); refresh();
  }

  return (
    <section>
      <div className="topbar">
        <div><h1>Leads</h1><p>Calon pembeli / penyewa yang sedang ditindaklanjuti</p></div>
        <button className="btn btn-primary" onClick={() => setEditing({})}>+ Tambah Lead</button>
      </div>

      <div className="filter-row">
        <input type="text" placeholder="Cari nama / no. HP..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Semua Status</option>
          {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div className="table-wrap">
        {leads.length === 0 ? (
          <div className="empty-state"><div className="big">Belum ada leads</div><div>Catat calon pembeli/penyewa supaya tidak ada follow-up yang terlewat.</div></div>
        ) : rows.length === 0 ? (
          <div className="empty-state"><div className="big">Tidak ditemukan</div><div>Coba ubah kata kunci atau filter status.</div></div>
        ) : (
          <table>
            <thead><tr><th>No</th><th>Nama</th><th>Sumber</th><th>Properti Diminati</th><th>Status</th><th>Agen</th><th></th></tr></thead>
            <tbody>
              {rows.map((l, idx) => {
                const prop = properties.find((p) => p.id === l.property_id);
                const agent = profiles.find((a) => a.id === l.agent_id);
                return (
                  <tr key={l.id}>
                    <td className="cell-soft">{idx + 1}</td>
                    <td><div className="cell-strong">{l.name}</div><div className="cell-soft">{l.phone || '-'}</div></td>
                    <td>{l.source || '-'}</td>
                    <td>{prop ? prop.title : <span className="cell-soft">-</span>}</td>
                    <td><span className={'badge ' + (STATUS_BADGE[l.status] || 'badge-grey')}>{l.status}</span></td>
                    <td>{agent ? agent.name : <span className="cell-soft">-</span>}</td>
                    <td>
                      {canManage(l) && (
                        <div className="row-actions"><button className="icon-btn" title="Edit" onClick={() => setEditing(l)}>✎</button></div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing !== null && (
        <LeadModal data={editing} properties={properties} profiles={profiles} isAdmin={isAdmin} user={user} onClose={() => setEditing(null)} onSave={handleSave} onDelete={handleDelete} />
      )}
    </section>
  );
}

function LeadModal({ data, properties, profiles, isAdmin, user, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({
    id: data.id || null,
    name: data.name || '',
    phone: data.phone || '',
    source: data.source || 'WhatsApp',
    status: data.status || 'Baru',
    property_id: data.property_id || '',
    agent_id: data.agent_id || (isAdmin ? '' : user.id),
    notes: data.notes || '',
  });
  function set(key, val) { setForm((f) => ({ ...f, [key]: val })); }

  return (
    <Modal onClose={onClose}>
      <h3>{data.id ? 'Edit' : 'Tambah'} Lead</h3>
      <div className="field-row">
        <div className="field"><label>Nama</label><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Budi Santoso" /></div>
        <div className="field"><label>No. HP</label><input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="0812xxxxxxx" /></div>
      </div>
      <div className="field-row">
        <div className="field"><label>Sumber</label><select value={form.source} onChange={(e) => set('source', e.target.value)}>{SOURCE_OPTIONS.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="field"><label>Status</label><select value={form.status} onChange={(e) => set('status', e.target.value)}>{STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}</select></div>
      </div>
      <div className="field"><label>Tertarik Properti</label><select value={form.property_id} onChange={(e) => set('property_id', e.target.value)}><option value="">- Belum ditentukan -</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
      <div className="field"><label>Agen</label><select value={form.agent_id} onChange={(e) => set('agent_id', e.target.value)} disabled={!isAdmin}><option value="">- Pilih Agen -</option>{profiles.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      <div className="field"><label>Catatan</label><textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Catatan follow-up..." /></div>
      <div className="modal-actions">
        {data.id && isAdmin && <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={() => onDelete(data.id)}>Hapus</button>}
        <button className="btn btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" onClick={() => form.name.trim() ? onSave(form) : null}>Simpan</button>
      </div>
    </Modal>
  );
}
