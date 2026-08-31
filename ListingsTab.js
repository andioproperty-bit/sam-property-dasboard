import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import Modal from './Modal';
import { formatRupiah } from '../lib/format';

const STATUS_OPTIONS = ['Tersedia', 'Pending', 'Terjual', 'Tersewa'];
const CATEGORY_OPTIONS = ['Rumah', 'Apartemen', 'Ruko', 'Tanah', 'Gudang', 'Kos-kosan'];

export default function ListingsTab({ properties, profiles, user, isAdmin, refresh, showToast }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [editing, setEditing] = useState(null); // null = closed, {} = new, {...} = edit

  const rows = properties
    .filter((p) => {
      const matchSearch = (p.title || '').toLowerCase().includes(search.toLowerCase()) || (p.address || '').toLowerCase().includes(search.toLowerCase());
      const matchStatus = !statusFilter || p.status === statusFilter;
      const matchType = !typeFilter || p.type === typeFilter;
      return matchSearch && matchStatus && matchType;
    })
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  function canManage(p) {
    return isAdmin || p.agent_id === user.id;
  }

  async function handleSave(form) {
    const payload = {
      title: form.title,
      type: form.type,
      category: form.category,
      address: form.address,
      price: Number(form.price) || 0,
      status: form.status,
      area: form.area,
      agent_id: form.agent_id || null,
    };
    let error;
    if (form.id) {
      ({ error } = await supabase.from('properties').update(payload).eq('id', form.id));
    } else {
      ({ error } = await supabase.from('properties').insert(payload));
    }
    if (error) { showToast('Gagal menyimpan: ' + error.message); return; }
    setEditing(null);
    showToast('Listing tersimpan');
    refresh();
  }

  async function handleDelete(id) {
    const { error } = await supabase.from('properties').delete().eq('id', id);
    if (error) { showToast('Gagal menghapus: ' + error.message); return; }
    setEditing(null);
    showToast('Listing dihapus');
    refresh();
  }

  return (
    <section>
      <div className="topbar">
        <div>
          <h1>Listing Properti</h1>
          <p>Semua unit jual &amp; sewa yang dikelola SAM Property</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({})}>+ Tambah Listing</button>
      </div>

      <div className="filter-row">
        <input type="text" placeholder="Cari judul / alamat..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Semua Status</option>
          {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">Jual &amp; Sewa</option>
          <option>Jual</option>
          <option>Sewa</option>
        </select>
      </div>

      <div className="table-wrap">
        {properties.length === 0 ? (
          <div className="empty-state"><div className="big">Belum ada listing</div><div>Tambahkan properti pertama untuk mulai mengelola database jual/sewa.</div></div>
        ) : rows.length === 0 ? (
          <div className="empty-state"><div className="big">Tidak ditemukan</div><div>Coba ubah kata kunci atau filter pencarian.</div></div>
        ) : (
          <table>
            <thead><tr><th>Listing</th><th>Kategori</th><th>Tipe</th><th>Harga</th><th>Status</th><th>Agen</th><th></th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const agent = profiles.find((a) => a.id === p.agent_id);
                return (
                  <tr key={p.id}>
                    <td><div className="cell-strong">{p.title}</div><div className="cell-soft">{p.address || '-'}</div></td>
                    <td>{p.category || '-'}</td>
                    <td>{p.type === 'Jual' ? <span className="badge badge-gold">Jual</span> : <span className="badge badge-green">Sewa</span>}</td>
                    <td className="cell-strong">{formatRupiah(p.price)}</td>
                    <td><span className={'badge ' + (p.status === 'Tersedia' ? 'badge-green' : p.status === 'Pending' ? 'badge-gold' : 'badge-grey')}>{p.status}</span></td>
                    <td>{agent ? agent.name : <span className="cell-soft">-</span>}</td>
                    <td>
                      {canManage(p) && (
                        <div className="row-actions">
                          <button className="icon-btn" title="Edit" onClick={() => setEditing(p)}>✎</button>
                        </div>
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
        <PropertyModal
          data={editing}
          profiles={profiles}
          isAdmin={isAdmin}
          user={user}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </section>
  );
}

function PropertyModal({ data, profiles, isAdmin, user, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({
    id: data.id || null,
    title: data.title || '',
    type: data.type || 'Jual',
    category: data.category || 'Rumah',
    address: data.address || '',
    price: data.price || '',
    status: data.status || 'Tersedia',
    area: data.area || '',
    agent_id: data.agent_id || (isAdmin ? '' : user.id),
  });

  function set(key, val) { setForm((f) => ({ ...f, [key]: val })); }

  return (
    <Modal onClose={onClose}>
      <h3>{data.id ? 'Edit' : 'Tambah'} Listing Properti</h3>
      <div className="field"><label>Judul Listing</label><input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Rumah 2 Lantai Jl. Merdeka" /></div>
      <div className="field-row">
        <div className="field"><label>Tipe</label><select value={form.type} onChange={(e) => set('type', e.target.value)}><option>Jual</option><option>Sewa</option></select></div>
        <div className="field"><label>Kategori</label><select value={form.category} onChange={(e) => set('category', e.target.value)}>{CATEGORY_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select></div>
      </div>
      <div className="field"><label>Alamat</label><input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Jl. ... Kota Malang" /></div>
      <div className="field-row">
        <div className="field"><label>Harga (Rp)</label><input type="number" value={form.price} onChange={(e) => set('price', e.target.value)} placeholder="850000000" /></div>
        <div className="field"><label>Status</label><select value={form.status} onChange={(e) => set('status', e.target.value)}>{STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}</select></div>
      </div>
      <div className="field-row">
        <div className="field"><label>Luas Tanah/Bangunan (m2)</label><input value={form.area} onChange={(e) => set('area', e.target.value)} placeholder="120/90" /></div>
        <div className="field">
          <label>Agen Penanggung Jawab</label>
          <select value={form.agent_id} onChange={(e) => set('agent_id', e.target.value)} disabled={!isAdmin && !!data.id}>
            <option value="">- Pilih Agen -</option>
            {profiles.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      <div className="modal-actions">
        {data.id && isAdmin && <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={() => onDelete(data.id)}>Hapus</button>}
        <button className="btn btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" onClick={() => form.title.trim() ? onSave(form) : null}>Simpan</button>
      </div>
    </Modal>
  );
}
