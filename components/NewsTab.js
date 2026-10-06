import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import Modal from './Modal';

const CATEGORY_SUGGESTIONS = ['KPR & Pembiayaan', 'Legalitas', 'Tips Beli', 'Pasar Properti', 'Info Developer', 'Regulasi'];

function pad(n) { return String(n).padStart(2, '0'); }

// ISO -> nilai untuk <input type="datetime-local">
function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function fmtDate(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return '-';
  }
}

const textareaStyle = {
  width: '100%', padding: '10px 12px', border: '1px solid #d9d2c8', borderRadius: 8,
  font: 'inherit', fontSize: 14, lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box',
};

export default function NewsTab({ isAdmin, showToast }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState(null); // null = tutup, {} = baru, {...} = edit

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('news_articles')
      .select('*')
      .order('published_at', { ascending: false });
    if (error) {
      setLoadError(error.message);
      setArticles([]);
    } else {
      setLoadError('');
      setArticles(data || []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const categories = useMemo(() => {
    const set = new Set(CATEGORY_SUGGESTIONS);
    articles.forEach((a) => a.category && set.add(a.category));
    return Array.from(set);
  }, [articles]);

  const rows = articles.filter((a) => {
    const q = search.toLowerCase();
    const matchSearch = !q || (a.title || '').toLowerCase().includes(q) || (a.category || '').toLowerCase().includes(q);
    const matchStatus = !statusFilter || (statusFilter === 'terbit' ? a.is_published : !a.is_published);
    return matchSearch && matchStatus;
  });

  async function handleSave(form) {
    const payload = {
      title: form.title.trim(),
      category: form.category.trim() || 'Info Properti',
      summary: form.summary.trim() || null,
      content: form.content.trim() || null,
      image_url: form.image_url || null,
      source_name: form.source_name.trim() || null,
      source_url: form.source_url.trim() || null,
      is_published: !!form.is_published,
      published_at: form.published_at ? new Date(form.published_at).toISOString() : new Date().toISOString(),
    };
    let error;
    if (form.id) {
      ({ error } = await supabase.from('news_articles').update(payload).eq('id', form.id));
    } else {
      ({ error } = await supabase.from('news_articles').insert(payload));
    }
    if (error) { showToast('Gagal menyimpan: ' + error.message); return false; }
    setEditing(null);
    showToast('Artikel tersimpan');
    load();
    return true;
  }

  async function handleDelete(id) {
    if (typeof window !== 'undefined' && !window.confirm('Hapus artikel ini? Tindakan ini tidak bisa dibatalkan.')) return;
    const { error } = await supabase.from('news_articles').delete().eq('id', id);
    if (error) { showToast('Gagal menghapus: ' + error.message); return; }
    setEditing(null);
    showToast('Artikel dihapus');
    load();
  }

  async function togglePublish(a) {
    const { error } = await supabase.from('news_articles').update({ is_published: !a.is_published }).eq('id', a.id);
    if (error) { showToast('Gagal mengubah status: ' + error.message); return; }
    showToast(a.is_published ? 'Artikel disembunyikan dari website' : 'Artikel diterbitkan');
    load();
  }

  return (
    <section>
      <div className="topbar">
        <div>
          <h1>Berita &amp; Info Properti</h1>
          <p>Artikel yang tampil di bagian "Berita &amp; Info Properti" pada samproperti.id</p>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Tambah Artikel</button>}
      </div>

      <div className="filter-row">
        <input type="text" placeholder="Cari judul / kategori..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Semua Status</option>
          <option value="terbit">Terbit</option>
          <option value="draf">Draf (disembunyikan)</option>
        </select>
      </div>

      <div className="table-wrap">
        {loading ? (
          <div className="empty-state"><div className="big">Memuat artikel...</div></div>
        ) : loadError ? (
          <div className="empty-state">
            <div className="big">Tabel berita belum siap</div>
            <div>{loadError}. Jalankan file create-news-table.sql di Supabase SQL Editor terlebih dahulu.</div>
          </div>
        ) : articles.length === 0 ? (
          <div className="empty-state"><div className="big">Belum ada artikel</div><div>Klik "+ Tambah Artikel" untuk menulis artikel pertama.</div></div>
        ) : rows.length === 0 ? (
          <div className="empty-state"><div className="big">Tidak ditemukan</div><div>Coba ubah kata kunci atau filter status.</div></div>
        ) : (
          <table>
            <thead><tr><th>No</th><th>Foto</th><th>Artikel</th><th>Kategori</th><th>Tanggal</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((a, idx) => (
                <tr key={a.id}>
                  <td className="cell-soft">{idx + 1}</td>
                  <td>
                    {a.image_url ? (
                      <img src={a.image_url} alt={a.title} style={{ width: 56, height: 44, objectFit: 'cover', borderRadius: 6 }} />
                    ) : (
                      <div style={{ width: 56, height: 44, borderRadius: 6, background: '#eee' }} />
                    )}
                  </td>
                  <td>
                    <div className="cell-strong">{a.title}</div>
                    <div className="cell-soft">{(a.summary || '').slice(0, 80)}{(a.summary || '').length > 80 ? '…' : ''}</div>
                  </td>
                  <td>{a.category || '-'}</td>
                  <td className="cell-soft">{fmtDate(a.published_at)}</td>
                  <td>
                    <span className={'badge ' + (a.is_published ? 'badge-green' : 'badge-grey')}>
                      {a.is_published ? 'Terbit' : 'Draf'}
                    </span>
                  </td>
                  <td>
                    {isAdmin && (
                      <div className="row-actions">
                        <button className="icon-btn" title={a.is_published ? 'Sembunyikan dari website' : 'Terbitkan'} onClick={() => togglePublish(a)}>
                          {a.is_published ? '◐' : '●'}
                        </button>
                        <button className="icon-btn" title="Edit" onClick={() => setEditing(a)}>✎</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing !== null && (
        <ArticleModal
          data={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={handleDelete}
          showToast={showToast}
        />
      )}
    </section>
  );
}

function ArticleModal({ data, categories, onClose, onSave, onDelete, showToast }) {
  const [form, setForm] = useState({
    id: data.id || null,
    title: data.title || '',
    category: data.category || 'Tips Beli',
    summary: data.summary || '',
    content: data.content || '',
    image_url: data.image_url || '',
    source_name: data.source_name || '',
    source_url: data.source_url || '',
    is_published: data.id ? !!data.is_published : true,
    published_at: toLocalInput(data.published_at),
  });
  const [coverFile, setCoverFile] = useState(null);
  const [preview, setPreview] = useState(data.image_url || '');
  const [saving, setSaving] = useState(false);

  function set(key, val) { setForm((f) => ({ ...f, [key]: val })); }

  function handleCover(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('File harus berupa gambar (JPG/PNG)'); return; }
    if (file.size > 5 * 1024 * 1024) { showToast('Ukuran foto maksimal 5MB'); return; }
    setCoverFile(file);
    setPreview(URL.createObjectURL(file));
  }

  function removeCover() {
    setCoverFile(null);
    setPreview('');
    set('image_url', '');
  }

  async function handleSubmit() {
    if (!form.title.trim()) { showToast('Judul wajib diisi'); return; }
    if (!form.content.trim()) { showToast('Isi artikel wajib diisi'); return; }
    if (form.source_url.trim() && !/^https?:\/\//i.test(form.source_url.trim())) {
      showToast('Link sumber harus diawali http:// atau https://');
      return;
    }
    setSaving(true);

    let imageUrl = form.image_url;
    if (coverFile) {
      const ext = coverFile.name.split('.').pop();
      const fileName = 'news/' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext;
      const { error: uploadError } = await supabase.storage
        .from('property-photos')
        .upload(fileName, coverFile, { cacheControl: '3600', upsert: false });
      if (uploadError) {
        showToast('Gagal upload foto: ' + uploadError.message);
        setSaving(false);
        return;
      }
      const { data: pub } = supabase.storage.from('property-photos').getPublicUrl(fileName);
      imageUrl = pub.publicUrl;
    }

    await onSave({ ...form, image_url: imageUrl });
    setSaving(false);
  }

  return (
    <Modal onClose={onClose}>
      <h3>{data.id ? 'Edit' : 'Tambah'} Artikel</h3>

      <div className="field">
        <label>Foto sampul (opsional)</label>
        {preview && (
          <div style={{ marginBottom: 8 }}>
            <img src={preview} alt="Pratinjau sampul" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 8 }} />
            <button type="button" className="btn btn-ghost" style={{ marginTop: 6 }} onClick={removeCover}>Hapus Foto</button>
          </div>
        )}
        <input type="file" accept="image/*" onChange={handleCover} />
        <div className="cell-soft" style={{ marginTop: 4 }}>Tanpa foto, website otomatis memakai sampul bergambar ikon.</div>
      </div>

      <div className="field">
        <label>Judul</label>
        <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Contoh: Cara Memilih Rumah Pertama" />
      </div>

      <div className="field-row">
        <div className="field">
          <label>Kategori</label>
          <input list="news-categories" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="Pilih atau ketik kategori baru" />
          <datalist id="news-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div className="field">
          <label>Tanggal terbit</label>
          <input type="datetime-local" value={form.published_at} onChange={(e) => set('published_at', e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Ringkasan (tampil di kartu, sekitar 1–2 kalimat)</label>
        <textarea style={textareaStyle} rows={2} value={form.summary} onChange={(e) => set('summary', e.target.value)} />
      </div>

      <div className="field">
        <label>Isi artikel</label>
        <textarea style={{ ...textareaStyle, minHeight: 220 }} rows={10} value={form.content} onChange={(e) => set('content', e.target.value)}
          placeholder={'Tulis paragraf biasa. Pisahkan paragraf dengan satu baris kosong.\n\n## Sub-judul bagian\n- Poin pertama\n- Poin kedua'} />
        <div className="cell-soft" style={{ marginTop: 4 }}>
          Format: baris kosong = paragraf baru · <b>## Judul</b> = sub-judul · awali baris dengan <b>- </b> untuk poin.
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Nama sumber (opsional)</label>
          <input value={form.source_name} onChange={(e) => set('source_name', e.target.value)} placeholder="Contoh: Kontan, Agustus 2026" />
        </div>
        <div className="field">
          <label>Link sumber (opsional)</label>
          <input value={form.source_url} onChange={(e) => set('source_url', e.target.value)} placeholder="https://..." />
        </div>
      </div>

      <div className="field">
        <label>Status</label>
        <select value={form.is_published ? '1' : '0'} onChange={(e) => set('is_published', e.target.value === '1')}>
          <option value="1">Terbit — tampil di website</option>
          <option value="0">Draf — disembunyikan</option>
        </select>
      </div>

      <div className="modal-actions">
        {data.id && <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={() => onDelete(data.id)} disabled={saving}>Hapus</button>}
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Batal</button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
      </div>
    </Modal>
  );
}
