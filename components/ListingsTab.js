import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import Modal from './Modal';
import { formatRupiah } from '../lib/format';

const STATUS_OPTIONS = ['Tersedia', 'Pending', 'Terjual', 'Tersewa'];
const CATEGORY_OPTIONS = ['Rumah', 'Apartemen', 'Ruko', 'Tanah', 'Gudang', 'Kos-kosan'];

function coverPhoto(p) {
  if (p.images && p.images.length > 0) return p.images[0];
  return p.image_url || '';
}

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
    const images = form.images || [];
    const payload = {
      title: form.title,
      type: form.type,
      category: form.category,
      address: form.address,
      price: Number(form.price) || 0,
      status: form.status,
      area: form.area,
      agent_id: form.agent_id || null,
      images: images,
      image_url: images[0] || null, // foto sampul, tetap diisi supaya kompatibel dengan website
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
            <thead><tr><th>No</th><th>Foto</th><th>Listing</th><th>Kategori</th><th>Tipe</th><th>Harga</th><th>Status</th><th>Agen</th><th></th></tr></thead>
            <tbody>
              {rows.map((p, idx) => {
                const agent = profiles.find((a) => a.id === p.agent_id);
                const cover = coverPhoto(p);
                const photoCount = (p.images && p.images.length) || (p.image_url ? 1 : 0);
                return (
                  <tr key={p.id}>
                    <td className="cell-soft">{idx + 1}</td>
                    <td>
                      <div style={{ position: 'relative', width: 56, height: 44 }}>
                        {cover ? (
                          <img src={cover} alt={p.title} style={{ width: 56, height: 44, objectFit: 'cover', borderRadius: 6 }} />
                        ) : (
                          <div style={{ width: 56, height: 44, borderRadius: 6, background: '#eee' }} />
                        )}
                        {photoCount > 1 && (
                          <span style={{
                            position: 'absolute', bottom: 2, right: 2, background: 'rgba(0,0,0,0.65)',
                            color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                          }}>+{photoCount - 1}</span>
                        )}
                      </div>
                    </td>
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
          showToast={showToast}
        />
      )}
    </section>
  );
}

const MAX_PHOTOS = 10;

function PropertyModal({ data, profiles, isAdmin, user, onClose, onSave, onDelete, showToast }) {
  const existingImages = data.images && data.images.length > 0
    ? data.images
    : (data.image_url ? [data.image_url] : []);

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

  // photos: array berisi { kind: 'existing', url } atau { kind: 'new', file, previewUrl }
  const [photos, setPhotos] = useState(existingImages.map((url) => ({ kind: 'existing', url })));
  const [saving, setSaving] = useState(false);

  function set(key, val) { setForm((f) => ({ ...f, [key]: val })); }

  function handlePhotosChange(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (photos.length + files.length > MAX_PHOTOS) {
      showToast(`Maksimal ${MAX_PHOTOS} foto per listing`);
      return;
    }

    const accepted = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        showToast(`${file.name} bukan file gambar, dilewati`);
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast(`${file.name} lebih dari 5MB, dilewati`);
        continue;
      }
      accepted.push({ kind: 'new', file, previewUrl: URL.createObjectURL(file) });
    }
    setPhotos((prev) => [...prev, ...accepted]);
    e.target.value = ''; // supaya bisa pilih file yang sama lagi kalau perlu
  }

  function removePhoto(index) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  function movePhoto(index, direction) {
    setPhotos((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSubmit() {
    if (!form.title.trim()) return;
    setSaving(true);

    const finalUrls = [];

    for (const photo of photos) {
      if (photo.kind === 'existing') {
        finalUrls.push(photo.url);
        continue;
      }
      // photo.kind === 'new' -> upload dulu ke Storage
      const ext = photo.file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('property-photos')
        .upload(fileName, photo.file, { cacheControl: '3600', upsert: false });

      if (uploadError) {
        showToast('Gagal upload foto: ' + uploadError.message);
        setSaving(false);
        return;
      }

      const { data: publicData } = supabase.storage
        .from('property-photos')
        .getPublicUrl(fileName);

      finalUrls.push(publicData.publicUrl);
    }

    await onSave({ ...form, images: finalUrls });
    setSaving(false);
  }

  return (
    <Modal onClose={onClose}>
      <h3>{data.id ? 'Edit' : 'Tambah'} Listing Properti</h3>

      <div className="field">
        <label>Foto Properti (bisa lebih dari satu, foto pertama jadi sampul)</label>

        {photos.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {photos.map((photo, index) => (
              <div key={index} style={{ position: 'relative', width: 84, height: 84 }}>
                <img
                  src={photo.kind === 'existing' ? photo.url : photo.previewUrl}
                  alt={`Foto ${index + 1}`}
                  style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: index === 0 ? '2px solid var(--wine-800, #6E1423)' : '1px solid #ddd' }}
                />
                {index === 0 && (
                  <span style={{ position: 'absolute', top: 2, left: 2, background: 'var(--wine-800, #6E1423)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>SAMPUL</span>
                )}
                <button
                  type="button"
                  onClick={() => removePhoto(index)}
                  title="Hapus foto"
                  style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: '#c0392b', color: '#fff', border: '2px solid #fff', fontSize: 12, lineHeight: '16px', cursor: 'pointer' }}
                >✕</button>
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => movePhoto(index, -1)}
                    title="Jadikan sampul / geser ke kiri"
                    style={{ position: 'absolute', bottom: -6, left: -6, width: 20, height: 20, borderRadius: '50%', background: '#333', color: '#fff', border: '2px solid #fff', fontSize: 11, lineHeight: '16px', cursor: 'pointer' }}
                  >◀</button>
                )}
              </div>
            ))}
          </div>
        )}

        {photos.length < MAX_PHOTOS && (
          <input type="file" accept="image/*" multiple onChange={handlePhotosChange} />
        )}
        <div className="cell-soft" style={{ marginTop: 4 }}>{photos.length}/{MAX_PHOTOS} foto. Klik ◀ pada foto untuk menjadikannya sampul.</div>
      </div>

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
          <select value={form.agent_id} onChange={(e) => set('agent_id', e.target.value)} disabled={!isAdmin}>
            <option value="">- Pilih Agen -</option>
            {profiles.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      <div className="modal-actions">
        {data.id && isAdmin && <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={() => onDelete(data.id)}>Hapus</button>}
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Batal</button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
      </div>
    </Modal>
  );
}
