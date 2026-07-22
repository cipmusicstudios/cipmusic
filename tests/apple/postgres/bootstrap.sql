\set ON_ERROR_STOP on

create schema auth;
create schema extensions;
create extension pgcrypto with schema extensions;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;

create table auth.users (
  id uuid primary key,
  created_at timestamptz not null default now()
);

create table public.user_membership (
  user_id uuid primary key references auth.users(id) on delete cascade,
  membership_status text not null default 'Basic',
  premium_until timestamptz null
);

create table public.apple_phase1a_baseline_sentinel (
  id integer primary key,
  note text not null
);
insert into public.apple_phase1a_baseline_sentinel values (1, 'untouched');
