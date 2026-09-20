-- Jalankan di Supabase > SQL Editor (project: sam-property)
-- Tujuan: membuat tempat penyimpanan (bucket) khusus untuk foto listing,
-- yang bisa diupload oleh staf yang login, dan dibaca publik (untuk
-- ditampilkan di website samproperti.id).

-- 1) Buat bucket "property-photos" (public = bisa dibaca siapa saja lewat URL)
insert into storage.buckets (id, name, public)
values ('property-photos', 'property-photos', true)
on conflict (id) do nothing;

-- 2) Siapa saja boleh MELIHAT/download foto di bucket ini (perlu, supaya
--    foto bisa tampil di website publik)
create policy "Publik bisa lihat foto properti"
on storage.objects for select
to public
using (bucket_id = 'property-photos');

-- 3) Hanya staf yang SUDAH LOGIN (authenticated) yang boleh upload foto baru
create policy "Staf bisa upload foto properti"
on storage.objects for insert
to authenticated
with check (bucket_id = 'property-photos');

-- 4) Staf yang login juga boleh menghapus/mengganti foto yang salah upload
create policy "Staf bisa hapus foto properti"
on storage.objects for delete
to authenticated
using (bucket_id = 'property-photos');
