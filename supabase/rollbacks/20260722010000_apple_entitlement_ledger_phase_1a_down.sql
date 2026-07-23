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
-- delete Supabase migration history. Run the approved rollback batch in one
-- psql process, one backend, and one explicit transaction. Session-local state
-- and operator attestations are deliberately ignored: this file independently
-- recalculates every database-verifiable safety condition under lock.
-- After a successful down,
-- use the supported Supabase CLI migration-repair workflow to mark version
-- 20260722010000 reverted; never hand-delete a migration-history row.
--
-- Required execution entrypoint:
--   \i supabase/rollbacks/20260722010000_apple_entitlement_ledger_phase_1a_approved_batch.sql
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
  v_manifest_sha text;
  v_business_rows bigint := 0;
  v_business_heap_bytes bigint;
  v_business_write_stats bigint;
  v_controls_n_tup_ins bigint;
  v_controls_n_tup_upd bigint;
  v_controls_n_tup_del bigint;
  v_target_table_count integer;
  v_catalog_origin_xid_count integer;
  v_catalog_origin_xid text;
  v_row_origin_xid text;
  v_frozen_xids_match_catalog boolean;
  v_stats_reset timestamptz;
  v_apple_membership_rows bigint;
  v_migration_history_count bigint;
begin
  perform pg_stat_clear_snapshot();
  v_manifest_sha := pg_temp.phase1a_manifest_sha256();
  if v_manifest_sha is distinct from '6ad498f6d8d81a1c8e70bc6482e9cafa0ebd3af4c62ad306b58ca8e00aff50e1' then
    raise exception using errcode='55000', message='PHASE1A_MANIFEST_MISMATCH';
  end if;

  select xmin::text into strict v_row_origin_xid
  from public.billing_runtime_controls;
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
    v_business_rows := v_business_rows+v_count;
    if v_count <> 0 then
      raise exception using errcode = '55000',
        message = format('PHASE1A_BUSINESS_DATA_PRESENT: public.%s=%s', v_name, v_count);
    end if;
  end loop;

  select count(*),count(distinct c.xmin::text),min(c.xmin::text),
    bool_and(c.relfrozenxid::text=c.xmin::text),
    coalesce(sum(pg_relation_size(c.oid)) filter(where c.relname<>'billing_runtime_controls'),-1),
    coalesce(sum(s.n_tup_ins+s.n_tup_upd+s.n_tup_del)
      filter(where c.relname<>'billing_runtime_controls'),-1),
    max(s.n_tup_ins) filter(where c.relname='billing_runtime_controls'),
    max(s.n_tup_upd) filter(where c.relname='billing_runtime_controls'),
    max(s.n_tup_del) filter(where c.relname='billing_runtime_controls')
  into v_target_table_count,v_catalog_origin_xid_count,v_catalog_origin_xid,
    v_frozen_xids_match_catalog,v_business_heap_bytes,v_business_write_stats,
    v_controls_n_tup_ins,v_controls_n_tup_upd,v_controls_n_tup_del
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  left join pg_stat_user_tables s on s.relid=c.oid
  where n.nspname='public' and c.relname in (
    'billing_runtime_controls','app_store_entitlements','app_store_transactions',
    'app_store_notification_events','app_store_binding_tombstones',
    'billing_entitlements_v2','billing_account_deletion_requests',
    'billing_account_deletion_fences');

  select stats_reset into v_stats_reset from pg_stat_database
  where datname=current_database();

  if v_target_table_count<>8 or v_catalog_origin_xid_count<>1
    or v_row_origin_xid<>v_catalog_origin_xid
    or not coalesce(v_frozen_xids_match_catalog,false)
    or v_controls_n_tup_ins<>1 or v_controls_n_tup_upd<>0 or v_controls_n_tup_del<>0
    or v_business_write_stats<>0 or v_business_heap_bytes<>0
    or v_runtime.updated_at is null
    or (v_stats_reset is not null and v_stats_reset>v_runtime.updated_at)
  then
    raise exception using errcode='55000',
      message='PHASE1A_NEVER_ENABLED_EVIDENCE_INCOMPLETE';
  end if;

  if to_regclass('public.user_membership') is not null then
    execute $sql$
      select count(*) from public.user_membership um
      where lower(coalesce(to_jsonb(um)->>'payment_provider', ''))
              in ('apple', 'app_store', 'apple_app_store')
         or lower(coalesce(to_jsonb(um)->>'source', ''))
              in ('apple', 'app_store', 'apple_app_store')
         or lower(coalesce(to_jsonb(um)->>'provider', ''))
              in ('apple', 'app_store', 'apple_app_store')
    $sql$ into v_apple_membership_rows;
    if v_apple_membership_rows <> 0 then
      raise exception using errcode = '55000', message = 'PHASE1A_APPLE_WRITEBACK_SUSPECTED';
    end if;
  end if;

  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception using errcode='55000', message='PHASE1A_MIGRATION_HISTORY_UNREADABLE';
  end if;
  select count(*) into v_migration_history_count
  from supabase_migrations.schema_migrations where version='20260722010000';
  if v_migration_history_count<>1 then
    raise exception using errcode='55000', message='PHASE1A_MIGRATION_HISTORY_MISMATCH';
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
