-- Phase 1A: Apple App Store ledger and verification support.
-- DRAFT ONLY. Do not apply before schema/security review.
-- This migration deliberately does not read or write public.user_membership.

begin;

do $preflight$
declare
  v_name text;
begin
  if to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'phase 1A preflight failed: extensions.digest(text,text) is required';
  end if;
  foreach v_name in array array[
    'app_store_entitlements',
    'app_store_transactions',
    'app_store_notification_events',
    'app_store_binding_tombstones',
    'billing_entitlements_v2',
    'billing_account_deletion_requests',
    'billing_runtime_controls'
  ] loop
    if to_regclass('public.' || v_name) is not null then
      raise exception 'phase 1A preflight failed: public.% already exists', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'app_store_environment',
    'app_store_binding_state',
    'app_store_current_state_quality',
    'app_store_status_source',
    'billing_aggregate_mode',
    'billing_entitlement_validity'
  ] loop
    if exists (
      select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = v_name
    ) then
      raise exception 'phase 1A preflight failed: public.% type already exists', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'billing_v2_set_updated_at',
    'billing_get_runtime_controls',
    'billing_get_current_entitlement_status',
    'billing_record_app_store_transaction',
    'billing_record_app_store_notification',
    'billing_prepare_account_deletion'
  ] loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name
    ) then
      raise exception 'phase 1A preflight failed: public.% function already exists', v_name;
    end if;
  end loop;
end
$preflight$;

create type public.app_store_environment as enum ('production', 'sandbox');
create type public.app_store_binding_state as enum (
  'unclaimed', 'claimed', 'account_deleted', 'transferred', 'fraud_locked'
);
create type public.app_store_current_state_quality as enum ('verified', 'quarantined');
create type public.app_store_status_source as enum (
  'server_api_status', 'notification_projection', 'reconciliation'
);
create type public.billing_aggregate_mode as enum ('off', 'shadow', 'write');
create type public.billing_entitlement_validity as enum ('bounded', 'lifetime');

create function public.billing_v2_set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.updated_at := clock_timestamp();
  return new;
end
$function$;

create table public.billing_runtime_controls (
  singleton boolean primary key default true check (singleton),
  apple_verification_enabled boolean not null default false,
  apple_ledger_write_enabled boolean not null default false,
  apple_membership_writeback_enabled boolean not null default false,
  aggregate_mode public.billing_aggregate_mode not null default 'off',
  legacy_protection_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text null,
  check (not apple_membership_writeback_enabled or aggregate_mode = 'write')
);

insert into public.billing_runtime_controls (
  singleton,
  apple_verification_enabled,
  apple_ledger_write_enabled,
  apple_membership_writeback_enabled,
  aggregate_mode,
  legacy_protection_enabled
) values (true, false, false, false, 'off', false);

create trigger billing_runtime_controls_set_updated_at
before update on public.billing_runtime_controls
for each row execute function public.billing_v2_set_updated_at();

create table public.app_store_entitlements (
  id uuid primary key default gen_random_uuid(),
  environment public.app_store_environment not null,
  endpoint_environment public.app_store_environment not null,
  original_transaction_id text not null,
  user_id uuid null references auth.users(id) on delete restrict,
  binding_state public.app_store_binding_state not null default 'unclaimed',
  claimed_at timestamptz null,
  app_account_token_hash text null check (app_account_token_hash ~ '^[0-9a-f]{64}$'),
  claim_method text null check (claim_method in ('purchase', 'restore', 'legacy_claim')),
  claim_evidence_hash text null check (claim_evidence_hash ~ '^[0-9a-f]{64}$'),
  product_id text not null,
  subscription_group_id text not null,
  normalized_status text not null check (normalized_status in (
    'active', 'expired', 'grace_period', 'billing_retry', 'revoked', 'refunded',
    'upgraded', 'downgraded', 'canceled_active', 'unknown'
  )),
  source_grants_premium boolean not null default false,
  expires_at timestamptz null,
  auto_renew boolean null,
  latest_transaction_id text null,
  transaction_evidence_signed_at timestamptz not null,
  renewal_evidence_signed_at timestamptz null,
  status_observed_at timestamptz not null,
  last_verified_at timestamptz not null,
  status_fingerprint text not null check (status_fingerprint ~ '^[0-9a-f]{64}$'),
  conflicting_status_fingerprint text null check (conflicting_status_fingerprint ~ '^[0-9a-f]{64}$'),
  status_source public.app_store_status_source not null,
  current_state_quality public.app_store_current_state_quality not null default 'verified',
  latest_effective_at timestamptz not null,
  latest_notification_uuid uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_store_entitlements_environment_match
    check (environment = endpoint_environment),
  constraint app_store_entitlements_binding_shape check (
    (binding_state = 'unclaimed' and user_id is null and claimed_at is null)
    or (binding_state = 'claimed' and user_id is not null and claimed_at is not null)
    or (binding_state in ('account_deleted', 'transferred') and user_id is null and claimed_at is not null)
    or (binding_state = 'fraud_locked' and claimed_at is not null)
  ),
  constraint app_store_entitlements_sandbox_grant check (
    environment = 'production' or source_grants_premium = false
  ),
  constraint app_store_entitlements_grant_status check (
    not source_grants_premium or normalized_status in (
      'active', 'grace_period', 'canceled_active', 'billing_retry'
    )
  ),
  constraint app_store_entitlements_quarantine_shape check (
    (current_state_quality = 'verified' and conflicting_status_fingerprint is null)
    or (current_state_quality = 'quarantined' and source_grants_premium = false
      and conflicting_status_fingerprint is not null)
  ),
  unique (environment, original_transaction_id),
  unique (id, environment, original_transaction_id)
);

create index app_store_entitlements_user_idx
  on public.app_store_entitlements (user_id) where user_id is not null;
create index app_store_entitlements_status_idx
  on public.app_store_entitlements (environment, normalized_status, expires_at);

create table public.app_store_transactions (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null,
  environment public.app_store_environment not null,
  transaction_id text not null,
  original_transaction_id text not null,
  product_id text not null,
  subscription_group_id text not null,
  app_account_token_hash text null check (app_account_token_hash ~ '^[0-9a-f]{64}$'),
  purchase_date timestamptz null,
  expires_date timestamptz null,
  signed_date timestamptz not null,
  revocation_date timestamptz null,
  revocation_reason integer null,
  transaction_reason text null,
  ownership_type text null,
  transaction_status text not null check (transaction_status in ('recorded', 'revoked', 'upgraded')),
  summary_hash text not null check (summary_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (environment, transaction_id),
  foreign key (entitlement_id, environment, original_transaction_id)
    references public.app_store_entitlements(id, environment, original_transaction_id)
    on delete restrict
);

create index app_store_transactions_original_idx
  on public.app_store_transactions (environment, original_transaction_id, signed_date desc);

create table public.app_store_notification_events (
  id uuid primary key default gen_random_uuid(),
  environment public.app_store_environment not null,
  endpoint_environment public.app_store_environment not null,
  notification_uuid uuid not null,
  notification_type text not null,
  subtype text null,
  signed_date timestamptz not null,
  original_transaction_id text null,
  transaction_id text null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  processing_status text not null default 'received' check (
    processing_status in ('received', 'processed', 'ignored_unknown', 'orphan', 'failed')
  ),
  attempt_count integer not null default 1 check (attempt_count > 0),
  processed_at timestamptz null,
  last_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (environment = endpoint_environment),
  unique (environment, notification_uuid)
);

create index app_store_notification_events_processing_idx
  on public.app_store_notification_events (environment, processing_status, signed_date);

create table public.app_store_binding_tombstones (
  id uuid primary key default gen_random_uuid(),
  environment public.app_store_environment not null,
  original_transaction_id text not null,
  prior_user_hash text not null check (prior_user_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('account_deleted', 'transferred', 'fraud_locked')),
  deletion_request_id uuid null,
  retained_until timestamptz null,
  created_at timestamptz not null default now(),
  unique (environment, original_transaction_id)
);

create table public.billing_entitlements_v2 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  source text not null check (source in ('apple', 'legacy_protection')),
  source_environment public.app_store_environment null,
  external_entitlement_id text not null,
  plan text not null default 'premium',
  product_id text null,
  status text not null check (status in (
    'active', 'expired', 'grace_period', 'billing_retry', 'revoked', 'refunded',
    'upgraded', 'downgraded', 'canceled_active', 'unknown'
  )),
  validity public.billing_entitlement_validity not null default 'bounded',
  valid_until timestamptz null,
  source_grants_premium boolean not null default false,
  current_state_quality public.app_store_current_state_quality not null default 'verified',
  source_version_at timestamptz not null,
  source_observed_at timestamptz not null,
  disabled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (validity = 'lifetime' and valid_until is null)
    or (validity = 'bounded' and (valid_until is not null or current_state_quality = 'quarantined'))
  ),
  check (source <> 'apple' or source_environment is not null),
  check (source_environment is distinct from 'sandbox'::public.app_store_environment or source_grants_premium = false),
  check (not source_grants_premium or status in (
    'active', 'grace_period', 'billing_retry', 'canceled_active'
  )),
  check (current_state_quality <> 'quarantined' or source_grants_premium = false),
  unique nulls not distinct (source, source_environment, external_entitlement_id)
);

create index billing_entitlements_v2_user_grant_idx
  on public.billing_entitlements_v2 (user_id, source_grants_premium, valid_until);

create function public.billing_get_current_entitlement_status(p_user_id uuid)
returns table (
  source text,
  source_environment public.app_store_environment,
  external_entitlement_id text,
  currently_grants_premium boolean
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $function$
  select b.source, b.source_environment, b.external_entitlement_id,
    (
      b.source_grants_premium
      and b.status in ('active', 'grace_period', 'billing_retry', 'canceled_active')
      and b.current_state_quality = 'verified'
      and (b.source <> 'apple' or b.source_environment = 'production')
      and (
        (b.validity = 'lifetime' and b.valid_until is null)
        or (b.validity = 'bounded' and b.valid_until > statement_timestamp())
      )
    ) as currently_grants_premium
  from public.billing_entitlements_v2 b
  where b.user_id = p_user_id
$function$;

create table public.billing_account_deletion_requests (
  request_id uuid primary key,
  user_id uuid null,
  user_hash text not null check (user_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('preparing', 'prepared', 'failed')),
  apple_entitlements_processed integer not null default 0,
  error_code text null,
  prepared_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_store_binding_tombstones
  add constraint app_store_binding_tombstones_deletion_request_fk
  foreign key (deletion_request_id)
  references public.billing_account_deletion_requests(request_id)
  on delete restrict;

create trigger app_store_entitlements_set_updated_at
before update on public.app_store_entitlements
for each row execute function public.billing_v2_set_updated_at();
create trigger app_store_notification_events_set_updated_at
before update on public.app_store_notification_events
for each row execute function public.billing_v2_set_updated_at();
create trigger billing_entitlements_v2_set_updated_at
before update on public.billing_entitlements_v2
for each row execute function public.billing_v2_set_updated_at();
create trigger billing_account_deletion_requests_set_updated_at
before update on public.billing_account_deletion_requests
for each row execute function public.billing_v2_set_updated_at();

alter table public.billing_runtime_controls enable row level security;
alter table public.app_store_entitlements enable row level security;
alter table public.app_store_transactions enable row level security;
alter table public.app_store_notification_events enable row level security;
alter table public.app_store_binding_tombstones enable row level security;
alter table public.billing_entitlements_v2 enable row level security;
alter table public.billing_account_deletion_requests enable row level security;

revoke all on public.billing_runtime_controls from public, anon, authenticated;
revoke all on public.app_store_entitlements from public, anon, authenticated;
revoke all on public.app_store_transactions from public, anon, authenticated;
revoke all on public.app_store_notification_events from public, anon, authenticated;
revoke all on public.app_store_binding_tombstones from public, anon, authenticated;
revoke all on public.billing_entitlements_v2 from public, anon, authenticated;
revoke all on public.billing_account_deletion_requests from public, anon, authenticated;
revoke all on public.billing_runtime_controls from service_role;
revoke all on public.app_store_entitlements from service_role;
revoke all on public.app_store_transactions from service_role;
revoke all on public.app_store_notification_events from service_role;
revoke all on public.app_store_binding_tombstones from service_role;
revoke all on public.billing_entitlements_v2 from service_role;
revoke all on public.billing_account_deletion_requests from service_role;

create function public.billing_get_runtime_controls()
returns table (
  apple_verification_enabled boolean,
  apple_ledger_write_enabled boolean,
  apple_membership_writeback_enabled boolean,
  aggregate_mode public.billing_aggregate_mode,
  legacy_protection_enabled boolean
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $function$
  select c.apple_verification_enabled, c.apple_ledger_write_enabled,
         c.apple_membership_writeback_enabled, c.aggregate_mode,
         c.legacy_protection_enabled
  from public.billing_runtime_controls c
  where c.singleton = true
$function$;

create function public.billing_record_app_store_notification(
  p_endpoint_environment public.app_store_environment,
  p_payload_environment public.app_store_environment,
  p_notification_uuid uuid,
  p_notification_type text,
  p_subtype text,
  p_signed_date timestamptz,
  p_original_transaction_id text,
  p_transaction_id text,
  p_payload_hash text
)
returns table (event_id uuid, duplicate boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_id uuid; v_existing_hash text;
begin
  if not coalesce((
    select apple_verification_enabled and apple_ledger_write_enabled
    from public.billing_runtime_controls where singleton = true
  ), false) then
    raise exception using errcode = '55000', message = 'APPLE_LEDGER_WRITE_DISABLED';
  end if;
  if p_endpoint_environment <> p_payload_environment then
    raise exception using errcode = '22023', message = 'APP_STORE_ENVIRONMENT_MISMATCH';
  end if;
  if p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD_HASH';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('cipmusic:billing:apple:notification:' || p_payload_environment::text || ':' || p_notification_uuid::text, 0)
  );
  select id, payload_hash into v_id, v_existing_hash
  from public.app_store_notification_events
  where environment = p_payload_environment and notification_uuid = p_notification_uuid
  for update;
  if found then
    if v_existing_hash <> p_payload_hash then
      raise exception using errcode = '23505', message = 'NOTIFICATION_REPLAY_MISMATCH';
    end if;
    update public.app_store_notification_events set attempt_count = attempt_count + 1 where id = v_id;
    return query select v_id, true;
    return;
  end if;
  insert into public.app_store_notification_events (
    environment, endpoint_environment, notification_uuid, notification_type, subtype,
    signed_date, original_transaction_id, transaction_id, payload_hash, processing_status
  ) values (
    p_payload_environment, p_endpoint_environment, p_notification_uuid, p_notification_type,
    p_subtype, p_signed_date, p_original_transaction_id, p_transaction_id, p_payload_hash,
    case
      when p_notification_type not in (
        'SUBSCRIBED', 'DID_RENEW', 'DID_FAIL_TO_RENEW', 'DID_CHANGE_RENEWAL_STATUS',
        'DID_CHANGE_RENEWAL_PREF', 'EXPIRED', 'GRACE_PERIOD_EXPIRED', 'REFUND',
        'REFUND_REVERSED', 'REVOKE', 'RENEWAL_EXTENDED', 'TEST'
      ) then 'ignored_unknown'
      when p_original_transaction_id is null and p_notification_type <> 'TEST' then 'orphan'
      else 'received'
    end
  ) returning id into v_id;
  return query select v_id, false;
end
$function$;

create function public.billing_record_app_store_transaction(
  p_user_id uuid,
  p_endpoint_environment public.app_store_environment,
  p_payload_environment public.app_store_environment,
  p_transaction_id text,
  p_original_transaction_id text,
  p_product_id text,
  p_subscription_group_id text,
  p_app_account_token_hash text,
  p_purchase_date timestamptz,
  p_expires_date timestamptz,
  p_signed_date timestamptz,
  p_revocation_date timestamptz,
  p_revocation_reason integer,
  p_transaction_reason text,
  p_ownership_type text,
  p_transaction_status text,
  p_summary_hash text,
  p_claim_intent text,
  p_legacy_claim_confirmed boolean,
  p_current_transaction_id text,
  p_current_product_id text,
  p_current_subscription_group_id text,
  p_current_app_account_token_hash text,
  p_current_normalized_status text,
  p_current_grants_premium boolean,
  p_current_expires_at timestamptz,
  p_current_auto_renew boolean,
  p_transaction_evidence_signed_at timestamptz,
  p_renewal_evidence_signed_at timestamptz,
  p_status_observed_at timestamptz,
  p_status_fingerprint text,
  p_conflicting_status_fingerprint text,
  p_status_source text,
  p_current_state_quality text
)
returns table (
  entitlement_id uuid,
  binding_result text,
  transaction_duplicate boolean,
  applied_as_latest boolean,
  current_state_quality public.app_store_current_state_quality
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_ent public.app_store_entitlements%rowtype;
  v_tx_id uuid;
  v_tx_inserted boolean;
  v_existing_tx_hash text;
  v_applied boolean := false;
  v_binding text;
  v_expected_token_hash text;
  v_claim_allowed boolean := false;
  v_calculated_fingerprint text;
  v_same_evidence boolean := false;
  v_newer_evidence boolean := false;
  v_incoming_quality public.app_store_current_state_quality;
  v_status_source public.app_store_status_source;
begin
  if not coalesce((
    select apple_verification_enabled and apple_ledger_write_enabled
    from public.billing_runtime_controls where singleton = true
  ), false) then
    raise exception using errcode = '55000', message = 'APPLE_LEDGER_WRITE_DISABLED';
  end if;
  if p_endpoint_environment <> p_payload_environment then
    raise exception using errcode = '22023', message = 'APP_STORE_ENVIRONMENT_MISMATCH';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'AUTHENTICATED_USER_REQUIRED';
  end if;
  if p_product_id not in (
    'com.cipmusic.aurasounds.premium.monthly.v2',
    'com.cipmusic.aurasounds.premium.yearly.v2'
  ) then
    raise exception using errcode = '22023', message = 'APP_STORE_PRODUCT_MISMATCH';
  end if;
  if p_subscription_group_id <> '22099193' then
    raise exception using errcode = '22023', message = 'APP_STORE_SUBSCRIPTION_GROUP_MISMATCH';
  end if;
  if p_current_product_id not in (
    'com.cipmusic.aurasounds.premium.monthly.v2',
    'com.cipmusic.aurasounds.premium.yearly.v2'
  ) then
    raise exception using errcode = '22023', message = 'APP_STORE_PRODUCT_MISMATCH';
  end if;
  if p_current_subscription_group_id <> '22099193' then
    raise exception using errcode = '22023', message = 'APP_STORE_SUBSCRIPTION_GROUP_MISMATCH';
  end if;
  if p_transaction_status not in ('recorded', 'revoked', 'upgraded') then
    raise exception using errcode = '22023', message = 'INVALID_TRANSACTION_STATUS';
  end if;
  if p_current_normalized_status not in (
    'active', 'expired', 'grace_period', 'billing_retry', 'revoked', 'refunded',
    'upgraded', 'downgraded', 'canceled_active', 'unknown'
  ) then
    raise exception using errcode = '22023', message = 'CURRENT_STATUS_INVALID';
  end if;
  if p_claim_intent not in ('purchase', 'restore', 'legacy_claim') then
    raise exception using errcode = '22023', message = 'CLAIM_INTENT_REQUIRED';
  end if;
  if p_summary_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_SUMMARY_HASH';
  end if;
  if p_status_fingerprint !~ '^[0-9a-f]{64}$'
     or (p_conflicting_status_fingerprint is not null and p_conflicting_status_fingerprint !~ '^[0-9a-f]{64}$')
     or (p_app_account_token_hash is not null and p_app_account_token_hash !~ '^[0-9a-f]{64}$')
     or (p_current_app_account_token_hash is not null and p_current_app_account_token_hash !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_HASH';
  end if;
  if p_status_source not in ('server_api_status', 'notification_projection', 'reconciliation')
     or p_current_state_quality not in ('verified', 'quarantined')
     or p_transaction_evidence_signed_at is null or p_status_observed_at is null then
    raise exception using errcode = '22023', message = 'CURRENT_STATUS_INVALID';
  end if;
  v_incoming_quality := p_current_state_quality::public.app_store_current_state_quality;
  v_status_source := p_status_source::public.app_store_status_source;
  v_calculated_fingerprint := encode(extensions.digest(concat_ws('|',
    p_payload_environment::text,
    p_original_transaction_id,
    p_current_transaction_id,
    p_current_product_id,
    p_current_subscription_group_id,
    coalesce(p_current_app_account_token_hash, ''),
    p_current_normalized_status,
    p_current_grants_premium::text,
    coalesce(to_char(p_current_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ''),
    coalesce(p_current_auto_renew::text, ''),
    p_status_source
  ), 'sha256'), 'hex');
  if (v_incoming_quality = 'verified' and p_conflicting_status_fingerprint is not null)
     or (v_incoming_quality = 'quarantined' and (
       p_conflicting_status_fingerprint is null
       or p_conflicting_status_fingerprint = p_status_fingerprint
       or p_current_grants_premium
     )) then
    raise exception using errcode = '22023', message = 'CURRENT_STATUS_INVALID';
  end if;

  v_expected_token_hash := encode(
    extensions.digest('cipmusic:app-account-token:v1:' || lower(p_user_id::text), 'sha256'), 'hex'
  );
  if (p_app_account_token_hash is not null and p_app_account_token_hash <> v_expected_token_hash)
     or (p_current_app_account_token_hash is not null and p_current_app_account_token_hash <> v_expected_token_hash) then
    raise exception using errcode = '22023', message = 'APP_ACCOUNT_TOKEN_MISMATCH';
  end if;
  if v_incoming_quality = 'verified' and p_status_fingerprint <> v_calculated_fingerprint then
    raise exception using errcode = '22023', message = 'CURRENT_STATUS_FINGERPRINT_MISMATCH';
  end if;
  if p_claim_intent = 'legacy_claim' then
    if not p_legacy_claim_confirmed then
      raise exception using errcode = '22023', message = 'LEGACY_CLAIM_CONFIRMATION_REQUIRED';
    end if;
    if p_app_account_token_hash is not null or p_current_app_account_token_hash is not null
       or not p_current_grants_premium or v_incoming_quality <> 'verified' then
      raise exception using errcode = '22023', message = 'LEGACY_CLAIM_NOT_ALLOWED';
    end if;
    v_claim_allowed := true;
  else
    v_claim_allowed := coalesce(p_current_app_account_token_hash = v_expected_token_hash, false);
  end if;

  if p_payload_environment = 'sandbox' and p_current_grants_premium then
    raise exception using errcode = '22023', message = 'SANDBOX_PRODUCTION_GRANT_FORBIDDEN';
  end if;
  if p_current_grants_premium and (
    p_payload_environment <> 'production'
    or p_current_normalized_status not in ('active', 'grace_period', 'canceled_active', 'billing_retry')
    or p_current_expires_at is null
    or v_incoming_quality <> 'verified'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_PREMIUM_GRANT';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('cipmusic:billing:apple:original:' || p_payload_environment::text || ':' || p_original_transaction_id, 0)
  );

  if exists (
    select 1 from public.app_store_binding_tombstones
    where environment = p_payload_environment and original_transaction_id = p_original_transaction_id
  ) then
    raise exception using errcode = '23505', message = 'APP_STORE_BINDING_TOMBSTONED';
  end if;

  select * into v_ent from public.app_store_entitlements
  where environment = p_payload_environment and original_transaction_id = p_original_transaction_id
  for update;

  if found then
    if v_ent.binding_state = 'claimed' and v_ent.user_id is distinct from p_user_id then
      raise exception using errcode = '23505', message = 'APP_STORE_ALREADY_BOUND';
    elsif v_ent.binding_state in ('account_deleted', 'transferred', 'fraud_locked') then
      raise exception using errcode = '23505', message = 'APP_STORE_BINDING_BLOCKED';
    end if;
    v_same_evidence := p_transaction_evidence_signed_at = v_ent.transaction_evidence_signed_at
      and p_renewal_evidence_signed_at is not distinct from v_ent.renewal_evidence_signed_at;
    v_newer_evidence := p_transaction_evidence_signed_at >= v_ent.transaction_evidence_signed_at
      and coalesce(p_renewal_evidence_signed_at, '-infinity'::timestamptz)
        >= coalesce(v_ent.renewal_evidence_signed_at, '-infinity'::timestamptz)
      and not v_same_evidence;
    if p_claim_intent = 'legacy_claim' and not (v_same_evidence or v_newer_evidence) then
      raise exception using errcode = '22023', message = 'LEGACY_CLAIM_NOT_ALLOWED';
    end if;
  end if;

  if not found then
    insert into public.app_store_entitlements (
      environment, endpoint_environment, original_transaction_id, user_id, binding_state,
      claimed_at, app_account_token_hash, claim_method, claim_evidence_hash,
      product_id, subscription_group_id, normalized_status,
      source_grants_premium, expires_at, auto_renew, latest_transaction_id,
      transaction_evidence_signed_at, renewal_evidence_signed_at, status_observed_at,
      last_verified_at, status_fingerprint, conflicting_status_fingerprint,
      status_source, current_state_quality, latest_effective_at
    ) values (
      p_payload_environment, p_endpoint_environment, p_original_transaction_id,
      case when v_claim_allowed then p_user_id end,
      case when v_claim_allowed then 'claimed'::public.app_store_binding_state else 'unclaimed'::public.app_store_binding_state end,
      case when v_claim_allowed then transaction_timestamp() end,
      p_current_app_account_token_hash,
      case when v_claim_allowed then p_claim_intent end,
      case when v_claim_allowed then p_status_fingerprint end,
      p_current_product_id, p_current_subscription_group_id, p_current_normalized_status,
      p_current_grants_premium, p_current_expires_at, p_current_auto_renew, p_current_transaction_id,
      p_transaction_evidence_signed_at, p_renewal_evidence_signed_at, p_status_observed_at,
      p_status_observed_at, least(p_status_fingerprint, coalesce(p_conflicting_status_fingerprint, p_status_fingerprint)),
      p_conflicting_status_fingerprint, v_status_source, v_incoming_quality,
      greatest(coalesce(p_current_expires_at, p_transaction_evidence_signed_at), p_transaction_evidence_signed_at)
    ) returning * into v_ent;
    v_binding := case when v_ent.binding_state = 'claimed' then 'claimed' else 'unclaimed' end;
    v_applied := true;
  else
    if v_ent.binding_state = 'unclaimed' then
      if not v_claim_allowed then
        v_binding := 'unclaimed';
      else
        update public.app_store_entitlements set
          user_id = p_user_id, binding_state = 'claimed', claimed_at = transaction_timestamp(),
          app_account_token_hash = coalesce(app_account_token_hash, p_current_app_account_token_hash),
          claim_method = p_claim_intent, claim_evidence_hash = p_status_fingerprint
        where id = v_ent.id returning * into v_ent;
        v_binding := 'claimed';
      end if;
    else
      v_binding := 'already_claimed';
    end if;

    if v_same_evidence and v_ent.current_state_quality = 'quarantined'
       and v_status_source = 'reconciliation' and v_incoming_quality = 'verified' then
      update public.app_store_entitlements set
        endpoint_environment = p_endpoint_environment,
        app_account_token_hash = coalesce(app_account_token_hash, p_current_app_account_token_hash),
        product_id = p_current_product_id, subscription_group_id = p_current_subscription_group_id,
        normalized_status = p_current_normalized_status,
        source_grants_premium = p_current_grants_premium, expires_at = p_current_expires_at,
        auto_renew = p_current_auto_renew, latest_transaction_id = p_current_transaction_id,
        status_observed_at = p_status_observed_at, last_verified_at = p_status_observed_at,
        status_fingerprint = p_status_fingerprint, conflicting_status_fingerprint = null,
        status_source = v_status_source, current_state_quality = 'verified',
        latest_effective_at = greatest(coalesce(p_current_expires_at, p_transaction_evidence_signed_at), p_transaction_evidence_signed_at)
      where id = v_ent.id returning * into v_ent;
      v_applied := true;
    elsif v_same_evidence and (
      v_ent.current_state_quality = 'quarantined'
      or v_incoming_quality = 'quarantined'
      or p_status_fingerprint <> v_ent.status_fingerprint
    ) then
      update public.app_store_entitlements set
        normalized_status = 'unknown', source_grants_premium = false, expires_at = null,
        auto_renew = null, status_observed_at = greatest(status_observed_at, p_status_observed_at),
        last_verified_at = greatest(last_verified_at, p_status_observed_at),
        status_fingerprint = least(status_fingerprint, p_status_fingerprint,
          coalesce(conflicting_status_fingerprint, p_status_fingerprint),
          coalesce(p_conflicting_status_fingerprint, p_status_fingerprint)),
        conflicting_status_fingerprint = greatest(status_fingerprint, p_status_fingerprint,
          coalesce(conflicting_status_fingerprint, p_status_fingerprint),
          coalesce(p_conflicting_status_fingerprint, p_status_fingerprint)),
        status_source = v_status_source, current_state_quality = 'quarantined'
      where id = v_ent.id returning * into v_ent;
      v_applied := true;
    elsif v_same_evidence then
      update public.app_store_entitlements set
        status_observed_at = greatest(status_observed_at, p_status_observed_at),
        last_verified_at = greatest(last_verified_at, p_status_observed_at)
      where id = v_ent.id returning * into v_ent;
    elsif v_newer_evidence then
      update public.app_store_entitlements set
        endpoint_environment = p_endpoint_environment,
        app_account_token_hash = coalesce(app_account_token_hash, p_current_app_account_token_hash),
        product_id = p_current_product_id,
        subscription_group_id = p_current_subscription_group_id,
        normalized_status = p_current_normalized_status,
        source_grants_premium = p_current_grants_premium,
        expires_at = p_current_expires_at,
        auto_renew = p_current_auto_renew,
        latest_transaction_id = p_current_transaction_id,
        transaction_evidence_signed_at = p_transaction_evidence_signed_at,
        renewal_evidence_signed_at = p_renewal_evidence_signed_at,
        status_observed_at = p_status_observed_at, last_verified_at = p_status_observed_at,
        status_fingerprint = least(p_status_fingerprint, coalesce(p_conflicting_status_fingerprint, p_status_fingerprint)),
        conflicting_status_fingerprint = p_conflicting_status_fingerprint,
        status_source = v_status_source, current_state_quality = v_incoming_quality,
        latest_effective_at = greatest(coalesce(p_current_expires_at, p_transaction_evidence_signed_at), p_transaction_evidence_signed_at)
      where id = v_ent.id returning * into v_ent;
      v_applied := true;
    end if;
  end if;

  insert into public.app_store_transactions (
    entitlement_id, environment, transaction_id, original_transaction_id, product_id,
    subscription_group_id, app_account_token_hash, purchase_date, expires_date, signed_date,
    revocation_date, revocation_reason, transaction_reason, ownership_type,
    transaction_status, summary_hash
  ) values (
    v_ent.id, p_payload_environment, p_transaction_id, p_original_transaction_id, p_product_id,
    p_subscription_group_id, p_app_account_token_hash, p_purchase_date, p_expires_date, p_signed_date,
    p_revocation_date, p_revocation_reason, p_transaction_reason, p_ownership_type,
    p_transaction_status, p_summary_hash
  ) on conflict (environment, transaction_id) do nothing
  returning id into v_tx_id;
  v_tx_inserted := v_tx_id is not null;
  if not v_tx_inserted then
    select summary_hash into v_existing_tx_hash
    from public.app_store_transactions
    where environment = p_payload_environment and transaction_id = p_transaction_id;
    if v_existing_tx_hash <> p_summary_hash then
      raise exception using errcode = '23505', message = 'TRANSACTION_REPLAY_MISMATCH';
    end if;
  end if;

  if v_ent.binding_state = 'claimed' then
    insert into public.billing_entitlements_v2 (
      user_id, source, source_environment, external_entitlement_id, plan, product_id, status,
      validity, valid_until, source_grants_premium, current_state_quality,
      source_version_at, source_observed_at
    ) values (
      v_ent.user_id, 'apple', p_payload_environment, p_original_transaction_id, 'premium',
      v_ent.product_id, v_ent.normalized_status,
      'bounded', v_ent.expires_at, v_ent.source_grants_premium, v_ent.current_state_quality,
      greatest(v_ent.transaction_evidence_signed_at,
        coalesce(v_ent.renewal_evidence_signed_at, v_ent.transaction_evidence_signed_at)),
      v_ent.status_observed_at
    ) on conflict (source, source_environment, external_entitlement_id) do update set
      product_id = excluded.product_id,
      status = excluded.status,
      valid_until = excluded.valid_until,
      source_grants_premium = excluded.source_grants_premium,
      current_state_quality = excluded.current_state_quality,
      source_version_at = excluded.source_version_at,
      source_observed_at = excluded.source_observed_at,
      disabled_at = case when excluded.source_grants_premium then null else now() end
    where public.billing_entitlements_v2.user_id = excluded.user_id;
  end if;

  return query select v_ent.id, v_binding, not v_tx_inserted, v_applied, v_ent.current_state_quality;
end
$function$;

create function public.billing_prepare_account_deletion(p_user_id uuid, p_request_id uuid)
returns table (request_id uuid, status text, apple_entitlements_processed integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_existing public.billing_account_deletion_requests%rowtype; v_count integer := 0; v_hash text;
begin
  v_hash := encode(extensions.digest(
    'cipmusic:deleted-user:v1:' || lower(p_user_id::text), 'sha256'
  ), 'hex');
  perform pg_advisory_xact_lock(
    hashtextextended('cipmusic:billing:account-deletion:' || p_user_id::text, 0)
  );
  select * into v_existing from public.billing_account_deletion_requests
  where billing_account_deletion_requests.request_id = p_request_id for update;
  if found then
    if v_existing.user_hash <> v_hash then
      raise exception using errcode = '22023', message = 'DELETION_REQUEST_USER_MISMATCH';
    end if;
    if v_existing.status = 'prepared' then
      return query select v_existing.request_id, v_existing.status, v_existing.apple_entitlements_processed;
      return;
    end if;
  else
    insert into public.billing_account_deletion_requests(request_id, user_id, user_hash, status)
    values (p_request_id, p_user_id, v_hash, 'preparing');
  end if;

  perform 1 from public.app_store_entitlements where user_id = p_user_id for update;
  insert into public.app_store_binding_tombstones (
    environment, original_transaction_id, prior_user_hash, reason, deletion_request_id
  ) select environment, original_transaction_id,
      v_hash, 'account_deleted', p_request_id
    from public.app_store_entitlements where user_id = p_user_id
  on conflict (environment, original_transaction_id) do nothing;

  delete from public.billing_entitlements_v2
  where user_id = p_user_id and source = 'apple';

  update public.app_store_entitlements set
    binding_state = 'account_deleted', user_id = null, source_grants_premium = false
  where user_id = p_user_id;
  get diagnostics v_count = row_count;

  update public.billing_account_deletion_requests set
    status = 'prepared', user_id = null, apple_entitlements_processed = v_count,
    prepared_at = now(), error_code = null
  where billing_account_deletion_requests.request_id = p_request_id
  returning * into v_existing;
  return query select v_existing.request_id, v_existing.status, v_existing.apple_entitlements_processed;
end
$function$;

revoke all on function public.billing_v2_set_updated_at() from public, anon, authenticated;
revoke all on function public.billing_get_runtime_controls() from public, anon, authenticated;
revoke all on function public.billing_get_current_entitlement_status(uuid) from public, anon, authenticated;
revoke all on function public.billing_record_app_store_notification(
  public.app_store_environment, public.app_store_environment, uuid, text, text,
  timestamptz, text, text, text
) from public, anon, authenticated;
revoke all on function public.billing_record_app_store_transaction(
  uuid, public.app_store_environment, public.app_store_environment, text, text, text, text,
  text, timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text,
  text, text, boolean, text, text, text, text, text, boolean, timestamptz, boolean,
  timestamptz, timestamptz, timestamptz, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.billing_prepare_account_deletion(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.billing_get_runtime_controls() to service_role;
grant execute on function public.billing_get_current_entitlement_status(uuid) to service_role;
grant execute on function public.billing_record_app_store_notification(
  public.app_store_environment, public.app_store_environment, uuid, text, text,
  timestamptz, text, text, text
) to service_role;
grant execute on function public.billing_record_app_store_transaction(
  uuid, public.app_store_environment, public.app_store_environment, text, text, text, text,
  text, timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text,
  text, text, boolean, text, text, text, text, text, boolean, timestamptz, boolean,
  timestamptz, timestamptz, timestamptz, text, text, text, text
) to service_role;
grant execute on function public.billing_prepare_account_deletion(uuid, uuid) to service_role;

comment on table public.app_store_transactions is
  'Non-secret transaction summaries only. Full JWS, receipts, signed payloads, and Apple API JWTs are forbidden.';
comment on table public.app_store_notification_events is
  'Notification inbox metadata and hashes only; signedPayload is never persisted.';
comment on table public.billing_entitlements_v2 is
  'Phase 1A shadow/ledger entitlement model. It must not write public.user_membership.';

commit;
