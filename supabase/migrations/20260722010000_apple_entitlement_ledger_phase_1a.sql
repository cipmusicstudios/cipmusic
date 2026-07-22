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
  grants_premium boolean not null default false,
  expires_at timestamptz null,
  auto_renew boolean null,
  latest_transaction_id text null,
  latest_signed_date timestamptz not null,
  latest_effective_at timestamptz not null,
  latest_notification_uuid uuid null,
  current_status_hash text not null check (current_status_hash ~ '^[0-9a-f]{64}$'),
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
    environment = 'production' or grants_premium = false
  ),
  constraint app_store_entitlements_grant_status check (
    not grants_premium or normalized_status in ('active', 'grace_period', 'canceled_active')
  ),
  constraint app_store_entitlements_grant_expiry check (
    not grants_premium or (expires_at is not null and expires_at > transaction_timestamp())
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
  status text not null check (status in ('active', 'inactive', 'revoked', 'expired')),
  validity public.billing_entitlement_validity not null default 'bounded',
  valid_until timestamptz null,
  grants_premium boolean not null default false,
  source_version_at timestamptz not null,
  disabled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((validity = 'lifetime' and valid_until is null) or validity = 'bounded'),
  check (source <> 'apple' or source_environment is not null),
  check (source_environment is distinct from 'sandbox'::public.app_store_environment or grants_premium = false),
  unique nulls not distinct (source, source_environment, external_entitlement_id)
);

create index billing_entitlements_v2_user_grant_idx
  on public.billing_entitlements_v2 (user_id, grants_premium, valid_until);

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
  p_current_source_signed_date timestamptz,
  p_current_evidence_hash text
)
returns table (
  entitlement_id uuid,
  binding_result text,
  transaction_duplicate boolean,
  applied_as_latest boolean,
  current_state_ambiguous boolean
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
  v_ambiguous boolean := false;
  v_expected_token_hash text;
  v_claim_allowed boolean := false;
  v_current_state_hash text;
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
  if p_current_evidence_hash !~ '^[0-9a-f]{64}$'
     or (p_app_account_token_hash is not null and p_app_account_token_hash !~ '^[0-9a-f]{64}$')
     or (p_current_app_account_token_hash is not null and p_current_app_account_token_hash !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_HASH';
  end if;
  v_current_state_hash := encode(extensions.digest(concat_ws('|',
    p_payload_environment::text,
    p_original_transaction_id,
    p_current_transaction_id,
    p_current_product_id,
    p_current_subscription_group_id,
    coalesce(p_current_app_account_token_hash, ''),
    p_current_normalized_status,
    p_current_grants_premium::text,
    coalesce(extract(epoch from p_current_expires_at)::text, ''),
    coalesce(p_current_auto_renew::text, ''),
    extract(epoch from p_current_source_signed_date)::text
  ), 'sha256'), 'hex');

  v_expected_token_hash := encode(
    extensions.digest('cipmusic:app-account-token:v1:' || lower(p_user_id::text), 'sha256'), 'hex'
  );
  if (p_app_account_token_hash is not null and p_app_account_token_hash <> v_expected_token_hash)
     or (p_current_app_account_token_hash is not null and p_current_app_account_token_hash <> v_expected_token_hash) then
    raise exception using errcode = '22023', message = 'APP_ACCOUNT_TOKEN_MISMATCH';
  end if;
  if p_claim_intent = 'legacy_claim' then
    if not p_legacy_claim_confirmed then
      raise exception using errcode = '22023', message = 'LEGACY_CLAIM_CONFIRMATION_REQUIRED';
    end if;
    if p_app_account_token_hash is not null or p_current_app_account_token_hash is not null
       or not p_current_grants_premium then
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
    or p_current_normalized_status not in ('active', 'grace_period', 'canceled_active')
    or p_current_expires_at is null
    or p_current_expires_at <= transaction_timestamp()
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
    if p_claim_intent = 'legacy_claim' and p_current_source_signed_date < v_ent.latest_signed_date then
      raise exception using errcode = '22023', message = 'LEGACY_CLAIM_NOT_ALLOWED';
    end if;
    if p_current_source_signed_date = v_ent.latest_signed_date
       and v_current_state_hash <> v_ent.current_status_hash then
      v_ambiguous := true;
    end if;
  end if;

  if not found then
    insert into public.app_store_entitlements (
      environment, endpoint_environment, original_transaction_id, user_id, binding_state,
      claimed_at, app_account_token_hash, claim_method, claim_evidence_hash,
      product_id, subscription_group_id, normalized_status,
      grants_premium, expires_at, auto_renew, latest_transaction_id,
      latest_signed_date, latest_effective_at, current_status_hash
    ) values (
      p_payload_environment, p_endpoint_environment, p_original_transaction_id,
      case when v_claim_allowed then p_user_id end,
      case when v_claim_allowed then 'claimed'::public.app_store_binding_state else 'unclaimed'::public.app_store_binding_state end,
      case when v_claim_allowed then transaction_timestamp() end,
      p_current_app_account_token_hash,
      case when v_claim_allowed then p_claim_intent end,
      case when v_claim_allowed then p_current_evidence_hash end,
      p_current_product_id, p_current_subscription_group_id, p_current_normalized_status,
      p_current_grants_premium, p_current_expires_at, p_current_auto_renew, p_current_transaction_id,
      p_current_source_signed_date,
      greatest(coalesce(p_current_expires_at, p_current_source_signed_date), p_current_source_signed_date),
      v_current_state_hash
    ) returning * into v_ent;
    v_binding := case when v_ent.binding_state = 'claimed' then 'claimed' else 'unclaimed' end;
    v_applied := true;
  else
    if v_ambiguous then
      v_binding := case when v_ent.binding_state = 'claimed' then 'already_claimed' else 'unclaimed' end;
    elsif v_ent.binding_state = 'unclaimed' then
      if not v_claim_allowed then
        v_binding := 'unclaimed';
      else
        update public.app_store_entitlements set
          user_id = p_user_id, binding_state = 'claimed', claimed_at = transaction_timestamp(),
          app_account_token_hash = coalesce(app_account_token_hash, p_current_app_account_token_hash),
          claim_method = p_claim_intent, claim_evidence_hash = p_current_evidence_hash
        where id = v_ent.id returning * into v_ent;
        v_binding := 'claimed';
      end if;
    else
      v_binding := 'already_claimed';
    end if;

    if not v_ambiguous and p_current_source_signed_date > v_ent.latest_signed_date then
      update public.app_store_entitlements set
        endpoint_environment = p_endpoint_environment,
        app_account_token_hash = coalesce(app_account_token_hash, p_current_app_account_token_hash),
        product_id = p_current_product_id,
        subscription_group_id = p_current_subscription_group_id,
        normalized_status = p_current_normalized_status,
        grants_premium = p_current_grants_premium,
        expires_at = p_current_expires_at,
        auto_renew = p_current_auto_renew,
        latest_transaction_id = p_current_transaction_id,
        latest_signed_date = p_current_source_signed_date,
        latest_effective_at = greatest(coalesce(p_current_expires_at, p_current_source_signed_date), p_current_source_signed_date),
        current_status_hash = v_current_state_hash
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

  if v_ent.binding_state = 'claimed' and not v_ambiguous then
    insert into public.billing_entitlements_v2 (
      user_id, source, source_environment, external_entitlement_id, plan, product_id, status,
      validity, valid_until, grants_premium, source_version_at
    ) values (
      v_ent.user_id, 'apple', p_payload_environment, p_original_transaction_id, 'premium',
      v_ent.product_id, case
        when v_ent.grants_premium then 'active'
        when v_ent.normalized_status in ('revoked', 'refunded') then 'revoked'
        when v_ent.normalized_status = 'expired' then 'expired'
        else 'inactive'
      end,
      'bounded', v_ent.expires_at, v_ent.grants_premium, v_ent.latest_signed_date
    ) on conflict (source, source_environment, external_entitlement_id) do update set
      product_id = excluded.product_id,
      status = excluded.status,
      valid_until = excluded.valid_until,
      grants_premium = excluded.grants_premium,
      source_version_at = excluded.source_version_at,
      disabled_at = case when excluded.grants_premium then null else now() end
    where excluded.source_version_at > public.billing_entitlements_v2.source_version_at
      and public.billing_entitlements_v2.user_id = excluded.user_id;
  end if;

  return query select v_ent.id, v_binding, not v_tx_inserted, v_applied, v_ambiguous;
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
    binding_state = 'account_deleted', user_id = null, grants_premium = false
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
revoke all on function public.billing_record_app_store_notification(
  public.app_store_environment, public.app_store_environment, uuid, text, text,
  timestamptz, text, text, text
) from public, anon, authenticated;
revoke all on function public.billing_record_app_store_transaction(
  uuid, public.app_store_environment, public.app_store_environment, text, text, text, text,
  text, timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text,
  text, text, boolean, text, text, text, text, text, boolean, timestamptz, boolean,
  timestamptz, text
) from public, anon, authenticated;
revoke all on function public.billing_prepare_account_deletion(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.billing_get_runtime_controls() to service_role;
grant execute on function public.billing_record_app_store_notification(
  public.app_store_environment, public.app_store_environment, uuid, text, text,
  timestamptz, text, text, text
) to service_role;
grant execute on function public.billing_record_app_store_transaction(
  uuid, public.app_store_environment, public.app_store_environment, text, text, text, text,
  text, timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text,
  text, text, boolean, text, text, text, text, text, boolean, timestamptz, boolean,
  timestamptz, text
) to service_role;
grant execute on function public.billing_prepare_account_deletion(uuid, uuid) to service_role;

comment on table public.app_store_transactions is
  'Non-secret transaction summaries only. Full JWS, receipts, signed payloads, and Apple API JWTs are forbidden.';
comment on table public.app_store_notification_events is
  'Notification inbox metadata and hashes only; signedPayload is never persisted.';
comment on table public.billing_entitlements_v2 is
  'Phase 1A shadow/ledger entitlement model. It must not write public.user_membership.';

commit;
