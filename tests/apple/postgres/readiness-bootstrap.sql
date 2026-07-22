\set ON_ERROR_STOP on
\ir bootstrap.sql

create schema supabase_migrations;
create table supabase_migrations.schema_migrations (
  version text primary key,
  statements text[] null,
  name text null
);

-- Synthetic legacy payment objects used only to prove Phase 1A lifecycle
-- operations do not change unrelated membership/payment schemas or rows.
alter table public.user_membership
  add column payment_provider text null,
  add column auto_renew boolean null;

create table public.membership_orders (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  payment_provider text not null,
  amount_cents integer not null
);

create table public.membership_google_play_purchases (
  purchase_token_hash text primary key,
  user_id uuid not null references auth.users(id),
  latest_order_id text not null
);

create table public.membership_stripe_subscriptions (
  subscription_hash text primary key,
  user_id uuid not null references auth.users(id),
  status text not null
);

insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001');
insert into public.user_membership(user_id, membership_status, premium_until, payment_provider, auto_renew)
values ('10000000-0000-4000-8000-000000000001', 'premium', '2030-01-01T00:00:00Z', 'stripe', true);
insert into public.membership_orders(id,user_id,payment_provider,amount_cents)
values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','zpay',1000);
insert into public.membership_google_play_purchases(purchase_token_hash,user_id,latest_order_id)
values ('synthetic-google-hash','10000000-0000-4000-8000-000000000001','synthetic-order');
insert into public.membership_stripe_subscriptions(subscription_hash,user_id,status)
values ('synthetic-stripe-hash','10000000-0000-4000-8000-000000000001','active');
