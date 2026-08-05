create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key,
  email text unique not null,
  username text unique,
  name text not null,
  role text not null default 'teacher',
  school text,
  created_at timestamptz default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date text not null,
  check_in text,
  check_out text,
  created_at timestamptz default now()
);

create table if not exists public.leaves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  date text not null,
  reason text,
  attachment_url text,
  status text not null default 'Menunggu',
  submitted_at timestamptz default now()
);

create table if not exists public.settings (
  id integer primary key default 1,
  jam_masuk_standar text not null default '08:30'
);

alter table public.profiles enable row level security;
alter table public.attendance enable row level security;
alter table public.leaves enable row level security;
alter table public.settings enable row level security;

create policy "Profiles are viewable by authenticated users"
on public.profiles
for select
using (auth.role() = 'authenticated');

create policy "Attendance is viewable by authenticated users"
on public.attendance
for select
using (auth.role() = 'authenticated');

create policy "Attendance can be inserted by authenticated users"
on public.attendance
for insert
with check (auth.role() = 'authenticated');

create policy "Attendance can be updated by authenticated users"
on public.attendance
for update
using (auth.role() = 'authenticated');

create policy "Leaves are viewable by authenticated users"
on public.leaves
for select
using (auth.role() = 'authenticated');

create policy "Leaves can be inserted by authenticated users"
on public.leaves
for insert
with check (auth.role() = 'authenticated');

create policy "Settings are viewable by authenticated users"
on public.settings
for select
using (auth.role() = 'authenticated');

create policy "Settings can be updated by authenticated users"
on public.settings
for update
using (auth.role() = 'authenticated');

insert into public.settings(id, jam_masuk_standar)
values (1, '08:30')
on conflict (id) do nothing;
