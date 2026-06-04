-- Account deletion hard-delete compatibility.
--
-- Apply before deploying netlify/functions/delete-account.ts with Supabase
-- Admin hard delete enabled. Retained payment/order rows must survive
-- auth.users deletion for legal/accounting/fraud/subscription reconciliation,
-- but they should no longer point at a login-capable account after deletion.

-- ---------- Apple Sign in token revocation cache ----------------------------
-- Service-role only. RLS is enabled with no client policies, so anon/auth users
-- cannot read or write Apple refresh tokens from the generated API.
create table if not exists public.apple_sign_in_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  apple_user_id text,
  refresh_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_error text
);

alter table public.apple_sign_in_tokens enable row level security;

comment on table public.apple_sign_in_tokens is
  'Server-only Sign in with Apple refresh tokens used solely to revoke Apple credentials during account deletion.';

-- ---------- ZPAY / order rows retained after auth hard delete ----------------
alter table if exists public.membership_orders
  add column if not exists deleted_user_hash text;

alter table if exists public.membership_orders
  add column if not exists account_deleted_at timestamptz;

do $$
declare
  fk record;
begin
  if to_regclass('public.membership_orders') is null then
    return;
  end if;

  alter table public.membership_orders alter column user_id drop not null;

  for fk in
    select conname
    from pg_constraint
    where conrelid = 'public.membership_orders'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.membership_orders drop constraint %I', fk.conname);
  end loop;

  alter table public.membership_orders
    add constraint membership_orders_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null;
end $$;

do $$
begin
  if to_regclass('public.membership_orders') is null then
    return;
  end if;
  comment on column public.membership_orders.deleted_user_hash is
    'One-way deleted-account hash for accounting/fraud reconciliation after user_id is nulled.';
  comment on column public.membership_orders.account_deleted_at is
    'Timestamp when the login account was deleted and this retained order row was detached.';
end $$;

-- ---------- Google Play purchase rows retained after auth hard delete --------
alter table if exists public.membership_google_play_purchases
  add column if not exists deleted_user_hash text;

alter table if exists public.membership_google_play_purchases
  add column if not exists account_deleted_at timestamptz;

do $$
declare
  fk record;
begin
  if to_regclass('public.membership_google_play_purchases') is null then
    return;
  end if;

  alter table public.membership_google_play_purchases alter column user_id drop not null;

  for fk in
    select conname
    from pg_constraint
    where conrelid = 'public.membership_google_play_purchases'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.membership_google_play_purchases drop constraint %I', fk.conname);
  end loop;

  alter table public.membership_google_play_purchases
    add constraint membership_google_play_purchases_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null;
end $$;

do $$
begin
  if to_regclass('public.membership_google_play_purchases') is null then
    return;
  end if;
  comment on column public.membership_google_play_purchases.deleted_user_hash is
    'One-way deleted-account hash for subscription reconciliation after user_id is nulled.';
  comment on column public.membership_google_play_purchases.account_deleted_at is
    'Timestamp when the login account was deleted and this retained purchase row was detached.';
end $$;
