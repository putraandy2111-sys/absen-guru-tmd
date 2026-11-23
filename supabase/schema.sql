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

do $$
declare
  legacy_standard text := '07:30';
begin
  if to_regclass('public.settings') is not null
     and not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'settings'
         and column_name = 'key'
     )
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'settings'
         and column_name = 'jam_masuk_standar'
     ) then
    execute 'select coalesce(jam_masuk_standar, ''07:30'') from public.settings limit 1'
      into legacy_standard;
    alter table public.settings rename to settings_legacy_standardization;

    create table public.settings (
      key text primary key,
      value text not null
    );

    insert into public.settings(key, value)
    values ('jamMasukStandar', coalesce(nullif(legacy_standard, ''), '07:30'))
    on conflict (key) do update set value = excluded.value;

    drop table public.settings_legacy_standardization;
  end if;
end $$;

create table if not exists public.settings (
  key text primary key,
  value text not null
);

insert into public.settings(key, value)
values ('jamMasukStandar', '07:30')
on conflict (key) do nothing;

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date text not null,
  check_in text,
  check_out text,
  distance_meters numeric,
  jam_masuk_standar text,
  created_at timestamptz default now()
);

alter table public.attendance
add column if not exists distance_meters numeric;

alter table public.attendance
add column if not exists jam_masuk_standar text;

update public.attendance
set jam_masuk_standar = coalesce(
  (select value from public.settings where key = 'jamMasukStandar'),
  '07:30'
)
where jam_masuk_standar is null;

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

