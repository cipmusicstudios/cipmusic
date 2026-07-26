begin;

do $preflight$
begin
  if to_regprocedure('public.billing_record_app_store_transaction(uuid,public.app_store_environment,public.app_store_environment,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,integer,text,text,text,text,text,boolean,text,text,text,text,text,boolean,timestamptz,boolean,timestamptz,timestamptz,timestamptz,text,text,text,text)') is null
     or to_regclass('public.app_store_transactions') is null
     or to_regclass('public.app_store_entitlements') is null
     or to_regclass('public.billing_entitlements_v2') is null then
    raise exception 'unclaimed recovery preflight failed: Phase 1A ledger schema is required';
  end if;
  if to_regprocedure('public.billing_claim_verified_unclaimed_app_store_entitlement(uuid,public.app_store_environment,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,integer,text,text,text,text,text,text,text,text,text)') is not null then
    raise exception 'unclaimed recovery preflight failed: recovery function already exists';
  end if;
end
$preflight$;

create function public.billing_claim_verified_unclaimed_app_store_entitlement(
  p_user_id uuid,
  p_environment public.app_store_environment,
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
  p_current_transaction_id text,
  p_current_product_id text,
  p_current_subscription_group_id text,
  p_current_app_account_token_hash text,
  p_status_fingerprint text
)
returns table (
  entitlement_id uuid,
  binding_result text,
  transaction_duplicate boolean,
  current_state_quality public.app_store_current_state_quality
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_ent public.app_store_entitlements%rowtype;
  v_tx public.app_store_transactions%rowtype;
  v_user_hash text;
  v_binding_result text := 'claimed';
begin
  if not coalesce((
    select apple_verification_enabled and apple_ledger_write_enabled
    from public.billing_runtime_controls where singleton = true
  ), false) then
    raise exception using errcode = '55000', message = 'APPLE_LEDGER_WRITE_DISABLED';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'AUTHENTICATED_USER_REQUIRED';
  end if;
  if p_environment <> 'production' then
    raise exception using errcode = '22023', message = 'UNCLAIMED_RECOVERY_PRODUCTION_ONLY';
  end if;
  if p_app_account_token_hash is not null or p_current_app_account_token_hash is not null then
    raise exception using errcode = '22023', message = 'UNCLAIMED_RECOVERY_TOKEN_PRESENT';
  end if;

  v_user_hash := encode(extensions.digest(
    'cipmusic:deleted-user:v1:' || lower(p_user_id::text), 'sha256'
  ), 'hex');
  perform pg_advisory_xact_lock(
    hashtextextended('cipmusic:billing:account-deletion:' || lower(p_user_id::text), 0)
  );
  if exists (select 1 from public.billing_account_deletion_fences where user_hash = v_user_hash) then
    raise exception using errcode = '55000', message = 'ACCOUNT_DELETION_FENCED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('cipmusic:billing:apple:transaction:' || p_environment::text || ':' || p_transaction_id, 0)
  );
  select * into v_tx from public.app_store_transactions
  where environment = p_environment and transaction_id = p_transaction_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'UNCLAIMED_RECOVERY_TRANSACTION_NOT_FOUND';
  end if;
  if v_tx.original_transaction_id <> p_original_transaction_id
     or v_tx.product_id <> p_product_id
     or v_tx.subscription_group_id <> p_subscription_group_id
     or v_tx.app_account_token_hash is not null
     or v_tx.purchase_date is distinct from p_purchase_date
     or v_tx.expires_date is distinct from p_expires_date
     or v_tx.signed_date <> p_signed_date
     or v_tx.revocation_date is distinct from p_revocation_date
     or v_tx.revocation_reason is distinct from p_revocation_reason
     or v_tx.transaction_reason is distinct from p_transaction_reason
     or v_tx.ownership_type is distinct from p_ownership_type
     or v_tx.transaction_status <> p_transaction_status
     or v_tx.summary_hash <> p_summary_hash then
    raise exception using errcode = '23505', message = 'TRANSACTION_REPLAY_MISMATCH';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('cipmusic:billing:apple:original:' || p_environment::text || ':' || p_original_transaction_id, 0)
  );
  select * into v_ent from public.app_store_entitlements
  where environment = p_environment and original_transaction_id = p_original_transaction_id
  for update;
  if not found or v_ent.id <> v_tx.entitlement_id then
    raise exception using errcode = '23505', message = 'TRANSACTION_CHAIN_MISMATCH';
  end if;
  if exists (
    select 1 from public.billing_entitlements_v2
    where source = 'apple' and source_environment = p_environment
      and external_entitlement_id = p_original_transaction_id
      and user_id is distinct from p_user_id
  ) then
    raise exception using errcode = '23505', message = 'APP_STORE_ALREADY_BOUND';
  end if;
  if v_ent.binding_state = 'claimed' then
    if v_ent.user_id is distinct from p_user_id then
      raise exception using errcode = '23505', message = 'APP_STORE_ALREADY_BOUND';
    end if;
    v_binding_result := 'already_claimed';
  elsif v_ent.binding_state <> 'unclaimed'
     or v_ent.user_id is not null
     or v_ent.app_account_token_hash is not null then
    raise exception using errcode = '23505', message = 'APP_STORE_BINDING_BLOCKED';
  elsif v_ent.product_id <> p_current_product_id
     or v_ent.subscription_group_id <> p_current_subscription_group_id
     or v_ent.latest_transaction_id <> p_current_transaction_id
     or v_ent.current_state_quality <> 'verified'
     or v_ent.status_fingerprint <> p_status_fingerprint then
    raise exception using errcode = '23505', message = 'UNCLAIMED_RECOVERY_EVIDENCE_MISMATCH';
  else
    update public.app_store_entitlements set
      user_id = p_user_id,
      binding_state = 'claimed',
      claimed_at = transaction_timestamp(),
      claim_method = 'restore',
      claim_evidence_hash = p_status_fingerprint
    where id = v_ent.id
      and binding_state = 'unclaimed'
      and user_id is null
      and app_account_token_hash is null
    returning * into v_ent;
    if not found then
      raise exception using errcode = '40001', message = 'UNCLAIMED_RECOVERY_RACE_LOST';
    end if;
  end if;

  insert into public.billing_entitlements_v2 (
    user_id, source, source_environment, external_entitlement_id, plan, product_id, status,
    validity, valid_until, source_grants_premium, current_state_quality,
    source_version_at, source_observed_at
  ) values (
    v_ent.user_id, 'apple', v_ent.environment, v_ent.original_transaction_id, 'premium',
    v_ent.product_id, v_ent.normalized_status, 'bounded', v_ent.expires_at,
    v_ent.source_grants_premium, v_ent.current_state_quality,
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

  return query select v_ent.id, v_binding_result, true, v_ent.current_state_quality;
end
$function$;

revoke all on function public.billing_claim_verified_unclaimed_app_store_entitlement(
  uuid, public.app_store_environment, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text,
  text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.billing_claim_verified_unclaimed_app_store_entitlement(
  uuid, public.app_store_environment, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text,
  text, text, text, text, text
) to service_role;

comment on function public.billing_claim_verified_unclaimed_app_store_entitlement(
  uuid, public.app_store_environment, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text,
  text, text, text, text, text
) is 'Atomically claims a pre-existing verified Production Apple entitlement with no user or app-account-token binding after an authenticated, reverified restore.';

commit;
