\set ON_ERROR_STOP on

-- Read-only decision report. This script never invokes the down migration.
-- Run as the same database role that would execute the rollback.

with expected_tables(name) as (
  values
    ('billing_runtime_controls'), ('app_store_entitlements'),
    ('app_store_transactions'), ('app_store_notification_events'),
    ('app_store_binding_tombstones'), ('billing_entitlements_v2'),
    ('billing_account_deletion_requests'), ('billing_account_deletion_fences')
), expected_types(name) as (
  values
    ('app_store_environment'), ('app_store_binding_state'),
    ('app_store_current_state_quality'), ('app_store_status_source'),
    ('billing_aggregate_mode'), ('billing_entitlement_validity')
), expected_functions(name) as (
  values
    ('billing_v2_set_updated_at'),
    ('billing_get_runtime_controls'),
    ('billing_get_current_entitlement_status'),
    ('billing_record_app_store_notification'),
    ('billing_record_app_store_transaction'),
    ('billing_prepare_account_deletion')
), expected_table_columns(name, column_count) as (
  values ('app_store_binding_tombstones',8), ('app_store_entitlements',31),
    ('app_store_notification_events',16), ('app_store_transactions',19),
    ('billing_account_deletion_fences',4), ('billing_account_deletion_requests',9),
    ('billing_entitlements_v2',17), ('billing_runtime_controls',8)
), object_state as (
  select
    (select count(*) from expected_tables e
      where to_regclass('public.' || e.name) is not null) as table_count,
    (select count(*) from expected_types e where exists (
      select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
      where n.nspname='public' and t.typname=e.name)) as type_count,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in (select name from expected_functions)) as function_count,
    (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (select name from expected_tables)) as policy_count,
    (select count(*) from expected_table_columns e where e.column_count=(
      select count(*) from information_schema.columns c
      where c.table_schema='public' and c.table_name=e.name)) as table_column_shape_count,
    (select count(*) from pg_constraint con where con.conrelid in (
      select to_regclass('public.'||name) from expected_tables)) as constraint_count,
    (select count(*) from pg_index i where i.indrelid in (
      select to_regclass('public.'||name) from expected_tables)) as index_count,
    (select count(*) from pg_trigger where not tgisinternal and tgrelid in (
      select to_regclass('public.'||name) from expected_tables)) as trigger_count,
    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (select name from expected_tables)
        and c.relrowsecurity) as rls_count,
    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (select name from expected_tables)
        and pg_get_userbyid(c.relowner)<>current_user) as owner_mismatch_count
), counts as (
  select
    case when to_regclass('public.app_store_entitlements') is null then null else
      ((xpath('//count/text()', query_to_xml(
        'select count(*) from public.app_store_entitlements', false, true, '')))[1]::text)::bigint end as entitlements,
    case when to_regclass('public.app_store_transactions') is null then null else
      ((xpath('//count/text()', query_to_xml(
        'select count(*) from public.app_store_transactions', false, true, '')))[1]::text)::bigint end as transactions,
    case when to_regclass('public.app_store_notification_events') is null then null else
      ((xpath('//count/text()', query_to_xml(
        'select count(*) from public.app_store_notification_events', false, true, '')))[1]::text)::bigint end as notifications,
    case when to_regclass('public.app_store_binding_tombstones') is null then null else
      ((xpath('//count/text()', query_to_xml(
        'select count(*) from public.app_store_binding_tombstones', false, true, '')))[1]::text)::bigint end as tombstones,
    case when to_regclass('public.billing_entitlements_v2') is null then null else
      ((xpath('//count/text()', query_to_xml(
        'select count(*) from public.billing_entitlements_v2', false, true, '')))[1]::text)::bigint end as billing_entitlements,
    case when to_regclass('public.billing_account_deletion_requests') is null then null else
      ((xpath('//count/text()', query_to_xml(
        'select count(*) from public.billing_account_deletion_requests', false, true, '')))[1]::text)::bigint end as deletion_requests,
    case when to_regclass('public.billing_account_deletion_fences') is null then null else
      ((xpath('//count/text()', query_to_xml(
        'select count(*) from public.billing_account_deletion_fences', false, true, '')))[1]::text)::bigint end as deletion_fences
), controls as (
  select case when to_regclass('public.billing_runtime_controls') is null then null else
    query_to_xml('select singleton, apple_verification_enabled, apple_ledger_write_enabled, apple_membership_writeback_enabled, aggregate_mode::text, legacy_protection_enabled, updated_by from public.billing_runtime_controls', false, true, '')
  end as value,
  case when to_regclass('public.billing_runtime_controls') is null then 0 else
    ((xpath('//count/text()',query_to_xml(
      'select count(*) from public.billing_runtime_controls',false,true,'')))[1]::text)::integer
  end as row_count
), signals as (
  select o.*, c.*,
    coalesce((xpath('//*[local-name()="apple_verification_enabled"]/text()', controls.value))[1]::text::boolean, true) as verification_enabled,
    coalesce((xpath('//*[local-name()="apple_ledger_write_enabled"]/text()', controls.value))[1]::text::boolean, true) as ledger_enabled,
    coalesce((xpath('//*[local-name()="apple_membership_writeback_enabled"]/text()', controls.value))[1]::text::boolean, true) as writeback_enabled,
    coalesce((xpath('//*[local-name()="legacy_protection_enabled"]/text()', controls.value))[1]::text::boolean, true) as legacy_enabled,
    coalesce((xpath('//*[local-name()="aggregate_mode"]/text()', controls.value))[1]::text, 'missing') as aggregate_mode,
    (xpath('//*[local-name()="updated_by"]/text()', controls.value))[1]::text as updated_by,
    controls.row_count as runtime_control_rows,
    case when to_regclass('public.user_membership') is null then 0 else
      ((xpath('//count/text()', query_to_xml($sql$
        select count(*) from public.user_membership um
        where lower(coalesce(to_jsonb(um)->>'payment_provider','')) in ('apple','app_store','apple_app_store')
           or lower(coalesce(to_jsonb(um)->>'source','')) in ('apple','app_store','apple_app_store')
           or lower(coalesce(to_jsonb(um)->>'provider','')) in ('apple','app_store','apple_app_store')
      $sql$, false, true, '')))[1]::text)::bigint end as suspicious_apple_memberships,
    exists(select 1 from pg_stat_user_tables where schemaname='public'
      and relname='billing_runtime_controls' and n_tup_upd>0) as controls_were_updated,
    exists(select 1 from pg_stat_user_tables where schemaname='public'
      and relname in ('app_store_entitlements','app_store_transactions','app_store_notification_events',
        'app_store_binding_tombstones','billing_entitlements_v2','billing_account_deletion_requests',
        'billing_account_deletion_fences') and (n_tup_ins>0 or n_tup_upd>0 or n_tup_del>0)) as business_tables_were_written,
    case when to_regclass('public.app_store_transactions') is null then null else
      ((xpath('//count/text()',query_to_xml(
        $$select count(*) from public.app_store_transactions where environment='production'$$,
        false,true,'')))[1]::text)::bigint end as production_transactions,
    case when to_regclass('public.app_store_transactions') is null then null else
      ((xpath('//count/text()',query_to_xml(
        $$select count(*) from public.app_store_transactions where environment='sandbox'$$,
        false,true,'')))[1]::text)::bigint end as sandbox_transactions,
    case when to_regclass('public.app_store_entitlements') is null then null else
      ((xpath('//count/text()',query_to_xml(
        $$select count(*) from public.app_store_entitlements where current_state_quality='quarantined' or binding_conflict_hash_low is not null or conflicting_status_fingerprint is not null$$,
        false,true,'')))[1]::text)::bigint end as quarantine_or_binding_conflicts,
    case when to_regclass('public.billing_entitlements_v2') is null then null else
      ((xpath('//count/text()',query_to_xml(
        $$select count(*) from public.billing_entitlements_v2 where source='apple'$$,
        false,true,'')))[1]::text)::bigint end as apple_billing_entitlements,
    case when to_regclass('supabase_migrations.schema_migrations') is null then null else
      ((xpath('//count/text()', query_to_xml(
        $$select count(*) from supabase_migrations.schema_migrations where version='20260722010000'$$,
        false, true, '')))[1]::text)::bigint end as migration_history_count
  from object_state o cross join counts c cross join controls
), decision as (
  select *, case
    when coalesce(entitlements,0)+coalesce(transactions,0)+coalesce(notifications,0)
       +coalesce(tombstones,0)+coalesce(billing_entitlements,0)
       +coalesce(deletion_requests,0)+coalesce(deletion_fences,0) > 0
      or verification_enabled or ledger_enabled or writeback_enabled or legacy_enabled
      or aggregate_mode <> 'off' or suspicious_apple_memberships > 0
      or coalesce(production_transactions,0)>0 or coalesce(sandbox_transactions,0)>0
      or coalesce(quarantine_or_binding_conflicts,0)>0 or coalesce(apple_billing_entitlements,0)>0
      or business_tables_were_written
      then 'ROLLBACK_UNSAFE'
    when table_count<>8 or type_count<>6 or function_count<>6
      or policy_count<>0 or owner_mismatch_count<>0 or updated_by is not null
      or table_column_shape_count<>8 or constraint_count<>55 or index_count<>20
      or trigger_count<>6 or rls_count<>8 or runtime_control_rows<>1
      or controls_were_updated or migration_history_count is distinct from 1
      then 'ROLLBACK_REQUIRES_MANUAL_REVIEW'
    else 'ROLLBACK_SAFE'
  end as rollback_result
  from signals
)
select rollback_result,
  case when rollback_result='ROLLBACK_SAFE' then
    'ROLLBACK_SAFE:5e03dc81ec469c469ccdfe47681e81dff9059e0dc894336c5360e69b93f687d4'
  else null end as approval_token,
  to_jsonb(decision)-'rollback_result' as evidence
from decision;
