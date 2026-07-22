-- Phase 1A Apple entitlement ledger rollback.
--
-- APPLICABLE ONLY WHEN:
--   * rollback preflight returned ROLLBACK_SAFE for the frozen up migration;
--   * every Phase 1A business table is empty;
--   * runtime controls are still the untouched default row;
--   * no Apple writeback is visible in public.user_membership;
--   * object names, owners, RLS, functions, and triggers match the approved schema.
--
-- NOT APPLICABLE WHEN any ledger/inbox/entitlement/deletion data exists, any
-- Apple flag is or may previously have been enabled, a binding/quarantine exists,
-- or object ownership/shape differs. Preserve evidence and use restore or a
-- reviewed forward fix instead.
--
-- DATA-PRESERVATION WARNING: this file deliberately has no CASCADE and will not
-- delete Supabase migration history. Run rollback preflight and down in one
-- explicit transaction, with an explicit LOCAL never-enabled attestation.
-- After a successful down,
-- use the supported Supabase CLI migration-repair workflow to mark version
-- 20260722010000 reverted; never hand-delete a migration-history row.
--
-- Required before execution:
--   BEGIN;
--   \i supabase/verification/20260722010000_apple_entitlement_rollback_preflight.sql
--   SET LOCAL app.phase1a_never_enabled_attested = 'true';
--   \i supabase/rollbacks/20260722010000_apple_entitlement_ledger_phase_1a_down.sql
--
-- Required after execution:
--   run the rollback verification in the PG17 readiness harness, verify all
--   Phase 1A objects are absent, then repair migration history with Supabase CLI.

\ir ../verification/20260722010000_apple_entitlement_manifest.sql

set local lock_timeout = '5s';
set local statement_timeout = '5min';
set local idle_in_transaction_session_timeout = '2min';

-- Acquire all locks before any safety read. ACCESS EXCLUSIVE blocks concurrent
-- DML and DDL; lock_timeout makes a writer-first conflict fail the whole tx.
lock table public.billing_runtime_controls,
  public.app_store_entitlements,
  public.app_store_transactions,
  public.app_store_notification_events,
  public.app_store_binding_tombstones,
  public.billing_entitlements_v2,
  public.billing_account_deletion_requests,
  public.billing_account_deletion_fences,
  public.user_membership
in access exclusive mode;

do $rollback_guard$
declare
  v_name text;
  v_count bigint;
  v_runtime public.billing_runtime_controls%rowtype;
  v_attestation record;
begin
  if to_regclass('pg_temp.phase1a_rollback_preflight_attestation') is null then
    raise exception using errcode = '55000',
      message = 'PHASE1A_SAME_TRANSACTION_PREFLIGHT_REQUIRED';
  end if;

  select * into v_attestation
  from pg_temp.phase1a_rollback_preflight_attestation
  where preflight_id::text=current_setting('app.phase1a_rollback_preflight_id',true);

  if not found then
    raise exception using errcode='55000',
      message='PHASE1A_ROLLBACK_ATTESTATION_INVALID_OR_EXPIRED';
  end if;

  if v_attestation.backend_pid<>pg_backend_pid()
    or v_attestation.transaction_id<>pg_current_xact_id()::text
    or v_attestation.database_name<>current_database()
    or v_attestation.operation_type<>'phase_1a_down'
    or v_attestation.migration_version<>'20260722010000'
    or v_attestation.up_sha<>'5e03dc81ec469c469ccdfe47681e81dff9059e0dc894336c5360e69b93f687d4'
    or v_attestation.manifest_sha<>'8ea409d5d99b0dfb65049e8b4ee1fb776b3f16bc992b32a1bac33530d7e4b88e'
    or v_attestation.rollback_result<>'ROLLBACK_SAFE'
    or not v_attestation.external_history_attested
    or v_attestation.generated_at < clock_timestamp()-interval '10 minutes'
    or v_attestation.generated_at > clock_timestamp()+interval '5 seconds'
    or current_setting('app.phase1a_never_enabled_attested',true) is distinct from 'true'
  then
    raise exception using errcode='55000',
      message='PHASE1A_ROLLBACK_ATTESTATION_INVALID_OR_EXPIRED';
  end if;

  if pg_temp.phase1a_manifest_sha256() is distinct from
    '8ea409d5d99b0dfb65049e8b4ee1fb776b3f16bc992b32a1bac33530d7e4b88e'
  then
    raise exception using errcode='55000', message='PHASE1A_MANIFEST_MISMATCH';
  end if;

  select * into strict v_runtime from public.billing_runtime_controls;
  if v_runtime.singleton is distinct from true
    or v_runtime.apple_verification_enabled
    or v_runtime.apple_ledger_write_enabled
    or v_runtime.apple_membership_writeback_enabled
    or v_runtime.aggregate_mode is distinct from 'off'
    or v_runtime.legacy_protection_enabled
    or v_runtime.updated_by is not null
  then
    raise exception using errcode = '55000', message = 'PHASE1A_RUNTIME_CONTROLS_NOT_PRISTINE';
  end if;

  -- Bounded, schema-qualified dynamic reads are used so this guard can check
  -- every approved Phase 1A table without accepting caller-supplied SQL.
  foreach v_name in array array[
    'app_store_transactions',
    'app_store_notification_events',
    'billing_entitlements_v2',
    'app_store_binding_tombstones',
    'billing_account_deletion_fences',
    'billing_account_deletion_requests',
    'app_store_entitlements'
  ] loop
    execute format('select count(*) from public.%I', v_name) into v_count;
    if v_count <> 0 then
      raise exception using errcode = '55000',
        message = format('PHASE1A_BUSINESS_DATA_PRESENT: public.%s=%s', v_name, v_count);
    end if;
  end loop;

  if to_regclass('public.user_membership') is not null then
    execute $sql$
      select count(*) from public.user_membership um
      where lower(coalesce(to_jsonb(um)->>'payment_provider', ''))
              in ('apple', 'app_store', 'apple_app_store')
         or lower(coalesce(to_jsonb(um)->>'source', ''))
              in ('apple', 'app_store', 'apple_app_store')
         or lower(coalesce(to_jsonb(um)->>'provider', ''))
              in ('apple', 'app_store', 'apple_app_store')
    $sql$ into v_count;
    if v_count <> 0 then
      raise exception using errcode = '55000', message = 'PHASE1A_APPLE_WRITEBACK_SUSPECTED';
    end if;
  end if;
end
$rollback_guard$;

drop function public.billing_prepare_account_deletion(uuid, uuid);
drop function public.billing_record_app_store_transaction(
  uuid, public.app_store_environment, public.app_store_environment, text, text, text, text,
  text, timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text,
  text, text, boolean, text, text, text, text, text, boolean, timestamptz, boolean,
  timestamptz, timestamptz, timestamptz, text, text, text, text
);
drop function public.billing_record_app_store_notification(
  public.app_store_environment, public.app_store_environment, uuid, text, text,
  timestamptz, text, text, text
);
drop function public.billing_get_current_entitlement_status(uuid);
drop function public.billing_get_runtime_controls();

drop trigger billing_account_deletion_fences_set_updated_at
  on public.billing_account_deletion_fences;
drop trigger billing_account_deletion_requests_set_updated_at
  on public.billing_account_deletion_requests;
drop trigger billing_entitlements_v2_set_updated_at
  on public.billing_entitlements_v2;
drop trigger app_store_notification_events_set_updated_at
  on public.app_store_notification_events;
drop trigger app_store_entitlements_set_updated_at
  on public.app_store_entitlements;
drop trigger billing_runtime_controls_set_updated_at
  on public.billing_runtime_controls;

drop function public.billing_v2_set_updated_at();

-- The approved up migration creates no policies. The guard rejects any policy
-- instead of silently deleting an object that was added later.

drop table public.app_store_transactions;
drop table public.billing_entitlements_v2;
drop table public.app_store_binding_tombstones;
drop table public.billing_account_deletion_fences;
drop table public.billing_account_deletion_requests;
drop table public.app_store_notification_events;
drop table public.app_store_entitlements;
drop table public.billing_runtime_controls;

drop type public.billing_entitlement_validity;
drop type public.billing_aggregate_mode;
drop type public.app_store_status_source;
drop type public.app_store_current_state_quality;
drop type public.app_store_binding_state;
drop type public.app_store_environment;

commit;
