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
-- delete Supabase migration history. Run the read-only rollback preflight first,
-- then set the exact session approval token it returns. After a successful down,
-- use the supported Supabase CLI migration-repair workflow to mark version
-- 20260722010000 reverted; never hand-delete a migration-history row.
--
-- Required before execution:
--   \i supabase/verification/20260722010000_apple_entitlement_rollback_preflight.sql
--   SET app.phase1a_rollback_approval =
--     'ROLLBACK_SAFE:5e03dc81ec469c469ccdfe47681e81dff9059e0dc894336c5360e69b93f687d4';
--
-- Required after execution:
--   run the rollback verification in the PG17 readiness harness, verify all
--   Phase 1A objects are absent, then repair migration history with Supabase CLI.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';
set local idle_in_transaction_session_timeout = '2min';

do $rollback_guard$
declare
  v_name text;
  v_count bigint;
  v_owner_mismatch_count integer;
  v_unexpected_policy_count integer;
  v_structure_count integer;
  v_runtime public.billing_runtime_controls%rowtype;
begin
  if current_setting('app.phase1a_rollback_approval', true) is distinct from
    'ROLLBACK_SAFE:5e03dc81ec469c469ccdfe47681e81dff9059e0dc894336c5360e69b93f687d4'
  then
    raise exception using errcode = '55000',
      message = 'PHASE1A_ROLLBACK_APPROVAL_REQUIRED';
  end if;

  foreach v_name in array array[
    'billing_runtime_controls',
    'app_store_entitlements',
    'app_store_transactions',
    'app_store_notification_events',
    'app_store_binding_tombstones',
    'billing_entitlements_v2',
    'billing_account_deletion_requests',
    'billing_account_deletion_fences'
  ] loop
    if to_regclass('public.' || v_name) is null then
      raise exception using errcode = '55000',
        message = format('PHASE1A_OBJECT_MISSING: public.%s', v_name);
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
    if not exists (
      select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = v_name
    ) then
      raise exception using errcode = '55000',
        message = format('PHASE1A_TYPE_MISSING: public.%s', v_name);
    end if;
  end loop;

  select count(*) into v_owner_mismatch_count
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any(array[
      'billing_runtime_controls', 'app_store_entitlements',
      'app_store_transactions', 'app_store_notification_events',
      'app_store_binding_tombstones', 'billing_entitlements_v2',
      'billing_account_deletion_requests', 'billing_account_deletion_fences'
    ])
    and pg_get_userbyid(c.relowner) <> current_user;
  if v_owner_mismatch_count <> 0 then
    raise exception using errcode = '55000', message = 'PHASE1A_OWNER_MISMATCH';
  end if;

  select count(*) into v_unexpected_policy_count
  from pg_policy p join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any(array[
      'billing_runtime_controls', 'app_store_entitlements',
      'app_store_transactions', 'app_store_notification_events',
      'app_store_binding_tombstones', 'billing_entitlements_v2',
      'billing_account_deletion_requests', 'billing_account_deletion_fences'
    ]);
  if v_unexpected_policy_count <> 0 then
    raise exception using errcode = '55000', message = 'PHASE1A_UNEXPECTED_POLICIES';
  end if;

  select count(*) into v_structure_count from (
    values ('app_store_binding_tombstones',8), ('app_store_entitlements',31),
      ('app_store_notification_events',16), ('app_store_transactions',19),
      ('billing_account_deletion_fences',4), ('billing_account_deletion_requests',9),
      ('billing_entitlements_v2',17), ('billing_runtime_controls',8)
  ) expected(name,column_count)
  where expected.column_count=(select count(*) from information_schema.columns c
    where c.table_schema='public' and c.table_name=expected.name);
  if v_structure_count <> 8 then
    raise exception using errcode='55000', message='PHASE1A_COLUMN_SHAPE_MISMATCH';
  end if;

  select count(*) into v_structure_count from pg_constraint con
  where con.conrelid in (
    select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any(array[
      'billing_runtime_controls','app_store_entitlements','app_store_transactions',
      'app_store_notification_events','app_store_binding_tombstones','billing_entitlements_v2',
      'billing_account_deletion_requests','billing_account_deletion_fences']));
  if v_structure_count <> 55 then
    raise exception using errcode='55000', message='PHASE1A_CONSTRAINT_SHAPE_MISMATCH';
  end if;

  select count(*) into v_structure_count from pg_index i
  where i.indrelid in (
    select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any(array[
      'billing_runtime_controls','app_store_entitlements','app_store_transactions',
      'app_store_notification_events','app_store_binding_tombstones','billing_entitlements_v2',
      'billing_account_deletion_requests','billing_account_deletion_fences']));
  if v_structure_count <> 20 then
    raise exception using errcode='55000', message='PHASE1A_INDEX_SHAPE_MISMATCH';
  end if;

  select count(*) into v_structure_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=any(array[
    'billing_v2_set_updated_at','billing_get_runtime_controls',
    'billing_get_current_entitlement_status','billing_record_app_store_transaction',
    'billing_record_app_store_notification','billing_prepare_account_deletion'])
    and pg_get_userbyid(p.proowner)=current_user
    and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=pg_catalog, public%';
  if v_structure_count <> 6 then
    raise exception using errcode='55000', message='PHASE1A_FUNCTION_SHAPE_MISMATCH';
  end if;

  select count(*) into v_structure_count from pg_trigger t
  where not t.tgisinternal and t.tgname=any(array[
    'billing_runtime_controls_set_updated_at','app_store_entitlements_set_updated_at',
    'app_store_notification_events_set_updated_at','billing_entitlements_v2_set_updated_at',
    'billing_account_deletion_requests_set_updated_at','billing_account_deletion_fences_set_updated_at']);
  if v_structure_count <> 6 then
    raise exception using errcode='55000', message='PHASE1A_TRIGGER_SHAPE_MISMATCH';
  end if;

  select count(*) into v_structure_count from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname=any(array[
    'billing_runtime_controls','app_store_entitlements','app_store_transactions',
    'app_store_notification_events','app_store_binding_tombstones','billing_entitlements_v2',
    'billing_account_deletion_requests','billing_account_deletion_fences']) and c.relrowsecurity;
  if v_structure_count <> 8 then
    raise exception using errcode='55000', message='PHASE1A_RLS_SHAPE_MISMATCH';
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
