# SAM Property — Dashboard Internal

Aplikasi dashboard dengan login sungguhan (Supabase Auth) dan database Postgres
(Supabase). Ada 2 peran: **Admin** (bisa hapus & atur semua) dan **Agen**
(bisa tambah data, hanya boleh edit miliknya sendiri, tidak bisa hapus).

## 1. Buat project Supabase (gratis)

1. Buka https://supabase.com → Sign up / login → **New project**.
2. Catat **Project URL** dan **anon public key** (Project Settings → API).
3. Buka **SQL Editor** → New query → tempel seluruh isi file `supabase/schema.sql`
   di folder ini → klik **Run**. Ini akan membuat semua tabel, aturan akses
   (RLS), dan otomatisasi role.

## 2. Buat akun staf pertama (Admin)

1. Di Supabase Dashboard → **Authentication → Users → Add user**.
2. Isi email & password untuk dirimu sendiri (calon Admin). Centang
   "Auto Confirm User" supaya bisa langsung login tanpa verifikasi email.
3. Buka tab **Table Editor → profiles**, cari baris dengan email/nama kamu,
   ubah kolom `role` dari `agent` menjadi `admin`.
   (Baris ini otomatis muncul begitu user dibuat — tidak perlu diisi manual.)
4. Untuk staf lain, ulangi langkah "Add user" di atas — role defaultnya
   `agent`, dan bisa diubah dari dalam aplikasi (menu **Staf & Peran**,
   khusus admin) tanpa perlu buka Supabase lagi.

## 3. Jalankan di komputer (opsional, untuk coba dulu)

```bash
npm install
cp .env.local.example .env.local
# lalu isi .env.local dengan Project URL & anon key dari langkah 1
npm run dev
```

Buka http://localhost:3000 dan login dengan akun yang dibuat di langkah 2.

## 4. Deploy online (gratis) dengan Vercel

1. Push folder ini ke repository GitHub (buat repo baru, lalu:
   `git init && git add . && git commit -m "init" && git remote add origin <url-repo> && git push -u origin main`).
2. Buka https://vercel.com → Sign up (bisa pakai akun GitHub) → **Add New Project**
   → pilih repo ini.
3. Saat diminta **Environment Variables**, isi:
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL dari Supabase
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon public key dari Supabase
4. Klik **Deploy**. Setelah selesai, Vercel akan kasih alamat seperti
   `https://sam-property-dashboard.vercel.app` — itu link yang dibagikan
   ke tim internal.

## Ringkasan aturan akses

| Aksi | Admin | Agen |
|---|---|---|
| Lihat semua data | ✅ | ✅ |
| Tambah listing/lead/transaksi | ✅ | ✅ |
| Edit data milik sendiri | ✅ | ✅ |
| Edit data milik agen lain | ✅ | ❌ |
| Hapus data apa pun | ✅ | ❌ |
| Ubah role staf (Admin/Agen) | ✅ | ❌ |

Aturan ini ditegakkan di level database (Row Level Security), bukan cuma
disembunyikan di tampilan — jadi tetap aman meskipun seseorang mencoba
memanggil API secara langsung tanpa lewat tampilan aplikasi.

## Catatan

- Tidak ada pendaftaran akun sendiri (self sign-up) — sengaja dimatikan
  supaya hanya staf yang dibuatkan akun oleh Admin yang bisa masuk.
- Untuk reset password staf, gunakan Supabase Dashboard → Authentication →
  Users → pilih user → **Send password recovery**.
