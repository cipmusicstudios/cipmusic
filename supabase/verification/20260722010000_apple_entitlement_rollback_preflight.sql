\set ON_ERROR_STOP on
\ir 20260722010000_apple_entitlement_manifest.sql

-- Diagnostic only. This report never authorizes the destructive down migration.
-- The down migration independently recalculates the same database evidence after
-- taking every required ACCESS EXCLUSIVE lock. MANUAL_REVIEW is never an override.
select pg_stat_clear_snapshot();

with target_tables(name) as (
  values ('app_store_entitlements'),('app_store_transactions'),
    ('app_store_notification_events'),('app_store_binding_tombstones'),
    ('billing_entitlements_v2'),('billing_account_deletion_requests'),
    ('billing_account_deletion_fences'),('billing_runtime_controls')
), business_tables(name) as (
  select name from target_tables where name<>'billing_runtime_controls'
), table_evidence as (
  select
    count(*) filter(where c.oid is not null) target_table_count,
    count(distinct c.xmin::text) catalog_origin_xid_count,
    min(c.xmin::text) catalog_origin_xid,
    bool_and(c.relfrozenxid::text=c.xmin::text) frozen_xids_match_catalog,
    coalesce(sum(pg_relation_size(c.oid)) filter(where tt.name<>'billing_runtime_controls'),-1) business_heap_bytes,
    coalesce(sum(s.n_tup_ins+s.n_tup_upd+s.n_tup_del)
      filter(where tt.name<>'billing_runtime_controls'),-1) business_write_stats,
    max(s.n_tup_ins) filter(where tt.name='billing_runtime_controls') controls_n_tup_ins,
    max(s.n_tup_upd) filter(where tt.name='billing_runtime_controls') controls_n_tup_upd,
    max(s.n_tup_del) filter(where tt.name='billing_runtime_controls') controls_n_tup_del
  from target_tables tt
  left join pg_class c on c.oid=to_regclass('public.'||tt.name)
  left join pg_stat_user_tables s on s.relid=c.oid
), counts as (
  select name, case when to_regclass('public.'||name) is null then null else
    ((xpath('//count/text()',query_to_xml(format('select count(*) from public.%I',name),false,true,'')))[1]::text)::bigint
  end row_count from business_tables
), controls as (
  select xmin::text row_origin_xid,singleton,apple_verification_enabled,
    apple_ledger_write_enabled,apple_membership_writeback_enabled,
    aggregate_mode::text aggregate_mode,legacy_protection_enabled,updated_at,
    updated_by,count(*) over()::integer row_count
  from public.billing_runtime_controls
), evidence as (
  select
    pg_temp.phase1a_manifest_sha256() manifest_sha,
    '6ad498f6d8d81a1c8e70bc6482e9cafa0ebd3af4c62ad306b58ca8e00aff50e1'::text expected_manifest_sha,
    coalesce((select sum(row_count) from counts),-1) business_rows,
    c.row_count controls_rows,c.row_origin_xid,c.singleton,
    c.apple_verification_enabled verification_enabled,
    c.apple_ledger_write_enabled ledger_enabled,
    c.apple_membership_writeback_enabled writeback_enabled,
    c.legacy_protection_enabled legacy_enabled,c.aggregate_mode,c.updated_at,c.updated_by,
    te.*,
    d.stats_reset,
    case when to_regclass('public.user_membership') is null then -1 else
      ((xpath('//count/text()',query_to_xml($sql$select count(*) from public.user_membership um
        where lower(coalesce(to_jsonb(um)->>'payment_provider','')) in ('apple','app_store','apple_app_store')
           or lower(coalesce(to_jsonb(um)->>'source','')) in ('apple','app_store','apple_app_store')
           or lower(coalesce(to_jsonb(um)->>'provider','')) in ('apple','app_store','apple_app_store')$sql$,false,true,'')))[1]::text)::bigint end apple_membership_rows,
    case when to_regclass('supabase_migrations.schema_migrations') is null then -1 else
      ((xpath('//count/text()',query_to_xml($sql$select count(*) from supabase_migrations.schema_migrations where version='20260722010000'$sql$,false,true,'')))[1]::text)::bigint end migration_history_count
  from controls c cross join table_evidence te
  left join pg_stat_database d on d.datname=current_database()
), decision as (
  select *, case
    when business_rows>0 or verification_enabled or ledger_enabled or writeback_enabled
      or legacy_enabled or aggregate_mode<>'off' or apple_membership_rows>0
      then 'ROLLBACK_UNSAFE'
    when manifest_sha<>expected_manifest_sha or controls_rows<>1 or not singleton
      or updated_by is not null or migration_history_count<>1
      or target_table_count<>8 or catalog_origin_xid_count<>1
      or row_origin_xid<>catalog_origin_xid or not frozen_xids_match_catalog
      or controls_n_tup_ins<>1 or controls_n_tup_upd<>0 or controls_n_tup_del<>0
      or business_write_stats<>0 or business_heap_bytes<>0
      or updated_at is null or (stats_reset is not null and stats_reset>updated_at)
      then 'ROLLBACK_REQUIRES_MANUAL_REVIEW'
    else 'ROLLBACK_SAFE' end rollback_result
  from evidence
)
select rollback_result,to_jsonb(decision)-'rollback_result' as evidence
from decision;
