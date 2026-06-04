-- Server-only secrets for Netlify Functions.
--
-- Values in this table are read with SUPABASE_SERVICE_ROLE_KEY from trusted
-- backend functions only. RLS is enabled and no anon/authenticated client
-- policies are created.

create table if not exists public.server_secrets (
  name text primary key,
  secret_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.server_secrets enable row level security;

comment on table public.server_secrets is
  'Server-only secret values for backend functions. Access through Supabase service role only; no client RLS policies.';

comment on column public.server_secrets.name is
  'Stable secret identifier, for example apple_sign_in_private_key.';

comment on column public.server_secrets.secret_value is
  'Secret material. Do not expose through client APIs, logs, migrations, or Git.';
