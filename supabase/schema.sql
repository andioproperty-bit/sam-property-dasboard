-- =====================================================================
-- SAM PROPERTY — SCHEMA & ROLE-BASED ACCESS CONTROL
-- Jalankan seluruh file ini di: Supabase Dashboard > SQL Editor > New query
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- ROLE
-- ---------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('admin','agent');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- PROFILES (1 baris otomatis dibuat untuk tiap akun login baru)
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  phone text,
  role user_role not null default 'agent',
  created_at timestamptz default now()
);

-- Fungsi cek admin (security definer supaya tidak bikin RLS jadi rekursif)
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- Cegah agen menaikkan role dirinya sendiri jadi admin
create or replace function enforce_profile_role_change()
returns trigger language plpgsql as $$
begin
  if NEW.role <> OLD.role and not is_admin() then
    -- Kalau sudah ada admin, hanya admin yang boleh mengubah role siapa pun.
    -- Kalau BELUM ada admin sama sekali (setup pertama kali), izinkan
    -- pengubahan pertama supaya tidak terkunci sendiri (chicken-and-egg).
    if exists (select 1 from profiles where role = 'admin') then
      raise exception 'Hanya admin yang boleh mengubah role';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_enforce_role_change on profiles;
create trigger trg_enforce_role_change
before update on profiles
for each row execute function enforce_profile_role_change();

alter table profiles enable row level security;

drop policy if exists "profiles_select_all" on profiles;
create policy "profiles_select_all" on profiles for select using (auth.role() = 'authenticated');

drop policy if exists "profiles_update_own_or_admin" on profiles;
create policy "profiles_update_own_or_admin" on profiles for update
  using (auth.uid() = id or is_admin())
  with check (auth.uid() = id or is_admin());

drop policy if exists "profiles_delete_admin_only" on profiles;
create policy "profiles_delete_admin_only" on profiles for delete using (is_admin());

-- Auto-buat baris profile setiap kali ada akun baru daftar/dibuat
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), 'agent')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- PROPERTIES
-- ---------------------------------------------------------------------
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text check (type in ('Jual','Sewa')),
  category text,
  address text,
  price numeric default 0,
  status text default 'Tersedia',
  area text,
  agent_id uuid references profiles(id) on delete set null,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz default now()
);
alter table properties enable row level security;

drop policy if exists "properties_select_all" on properties;
create policy "properties_select_all" on properties for select using (auth.role() = 'authenticated');

drop policy if exists "properties_insert_auth" on properties;
create policy "properties_insert_auth" on properties for insert with check (auth.role() = 'authenticated');

drop policy if exists "properties_update_owner_or_admin" on properties;
create policy "properties_update_owner_or_admin" on properties for update
  using (is_admin() or agent_id = auth.uid());

drop policy if exists "properties_delete_admin_only" on properties;
create policy "properties_delete_admin_only" on properties for delete using (is_admin());

-- ---------------------------------------------------------------------
-- LEADS
-- ---------------------------------------------------------------------
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  source text,
  status text default 'Baru',
  property_id uuid references properties(id) on delete set null,
  agent_id uuid references profiles(id) on delete set null,
  notes text,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz default now()
);
alter table leads enable row level security;

drop policy if exists "leads_select_all" on leads;
create policy "leads_select_all" on leads for select using (auth.role() = 'authenticated');

drop policy if exists "leads_insert_auth" on leads;
create policy "leads_insert_auth" on leads for insert with check (auth.role() = 'authenticated');

drop policy if exists "leads_update_owner_or_admin" on leads;
create policy "leads_update_owner_or_admin" on leads for update
  using (is_admin() or agent_id = auth.uid());

drop policy if exists "leads_delete_admin_only" on leads;
create policy "leads_delete_admin_only" on leads for delete using (is_admin());

-- ---------------------------------------------------------------------
-- TRANSACTIONS
-- ---------------------------------------------------------------------
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  agent_id uuid references profiles(id) on delete set null,
  type text check (type in ('Jual','Sewa')),
  price numeric default 0,
  commission_percent numeric default 0,
  commission_amount numeric default 0,
  date date default current_date,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz default now()
);
alter table transactions enable row level security;

drop policy if exists "transactions_select_all" on transactions;
create policy "transactions_select_all" on transactions for select using (auth.role() = 'authenticated');

drop policy if exists "transactions_insert_auth" on transactions;
create policy "transactions_insert_auth" on transactions for insert with check (auth.role() = 'authenticated');

drop policy if exists "transactions_update_owner_or_admin" on transactions;
create policy "transactions_update_owner_or_admin" on transactions for update
  using (is_admin() or agent_id = auth.uid());

drop policy if exists "transactions_delete_admin_only" on transactions;
create policy "transactions_delete_admin_only" on transactions for delete using (is_admin());

-- =====================================================================
-- SELESAI. Ringkasan aturan akses:
--  - Semua staf internal (yang sudah login) BISA MELIHAT semua data.
--  - Tambah data: semua staf internal bisa.
--  - Ubah data: admin bisa semua; agen hanya listing/lead/transaksi miliknya sendiri.
--  - Hapus data: HANYA admin.
--  - Ubah role staf (admin/agen): HANYA admin.
--  - Orang tanpa akun (tidak login) TIDAK BISA mengakses data sama sekali.
-- =====================================================================
