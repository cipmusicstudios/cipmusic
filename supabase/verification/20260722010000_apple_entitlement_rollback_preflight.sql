\set ON_ERROR_STOP on
\ir 20260722010000_apple_entitlement_manifest.sql

-- Read-only decision report. A SAFE result additionally requires the operator
-- to provide external_flag_history_verified=1 after reviewing immutable
-- deployment/runtime evidence. PostgreSQL statistics are resettable evidence,
-- not an audit log; without that attestation this report returns MANUAL_REVIEW.
\if :{?external_flag_history_verified}
\else
  \set external_flag_history_verified 0
\endif

with target_tables(name) as (
  values ('app_store_entitlements'),('app_store_transactions'),
    ('app_store_notification_events'),('app_store_binding_tombstones'),
    ('billing_entitlements_v2'),('billing_account_deletion_requests'),
    ('billing_account_deletion_fences')
), counts as (
  select name, case when to_regclass('public.'||name) is null then null else
    ((xpath('//count/text()',query_to_xml(format('select count(*) from public.%I',name),false,true,'')))[1]::text)::bigint
  end row_count from target_tables
), controls as (
  select case when to_regclass('public.billing_runtime_controls') is null then null else
    query_to_xml('select singleton,apple_verification_enabled,apple_ledger_write_enabled,apple_membership_writeback_enabled,aggregate_mode::text,legacy_protection_enabled,updated_at,updated_by from public.billing_runtime_controls',false,true,'')
  end value,
  case when to_regclass('public.billing_runtime_controls') is null then 0 else
    ((xpath('//count/text()',query_to_xml('select count(*) from public.billing_runtime_controls',false,true,'')))[1]::text)::integer end row_count
), stats as (
  select d.stats_reset,
    max(s.n_tup_upd) filter(where s.relname='billing_runtime_controls') controls_n_tup_upd,
    coalesce(sum(s.n_tup_ins+s.n_tup_upd+s.n_tup_del)
      filter(where s.relname in (select name from target_tables)),0) business_write_stats
  from pg_stat_database d left join pg_stat_user_tables s on s.schemaname='public'
  where d.datname=current_database() group by d.stats_reset
), evidence as (
  select
    pg_temp.phase1a_manifest_sha256() manifest_sha,
    'f2d2208f2b2c20fbe24b1e139a85e462609623b52e7af525063ffa12e4cc3a5a'::text expected_manifest_sha,
    coalesce((select sum(row_count) from counts),-1) business_rows,
    c.row_count controls_rows,
    coalesce((xpath('//*[local-name()="singleton"]/text()',c.value))[1]::text::boolean,false) singleton,
    coalesce((xpath('//*[local-name()="apple_verification_enabled"]/text()',c.value))[1]::text::boolean,true) verification_enabled,
    coalesce((xpath('//*[local-name()="apple_ledger_write_enabled"]/text()',c.value))[1]::text::boolean,true) ledger_enabled,
    coalesce((xpath('//*[local-name()="apple_membership_writeback_enabled"]/text()',c.value))[1]::text::boolean,true) writeback_enabled,
    coalesce((xpath('//*[local-name()="legacy_protection_enabled"]/text()',c.value))[1]::text::boolean,true) legacy_enabled,
    coalesce((xpath('//*[local-name()="aggregate_mode"]/text()',c.value))[1]::text,'missing') aggregate_mode,
    (xpath('//*[local-name()="updated_at"]/text()',c.value))[1]::text updated_at,
    (xpath('//*[local-name()="updated_by"]/text()',c.value))[1]::text updated_by,
    s.stats_reset,s.controls_n_tup_upd,s.business_write_stats,
    :'external_flag_history_verified'::integer=1 external_flag_history_verified,
    case when to_regclass('public.user_membership') is null then -1 else
      ((xpath('//count/text()',query_to_xml($sql$select count(*) from public.user_membership um
        where lower(coalesce(to_jsonb(um)->>'payment_provider','')) in ('apple','app_store','apple_app_store')
           or lower(coalesce(to_jsonb(um)->>'source','')) in ('apple','app_store','apple_app_store')
           or lower(coalesce(to_jsonb(um)->>'provider','')) in ('apple','app_store','apple_app_store')$sql$,false,true,'')))[1]::text)::bigint end apple_membership_rows,
    case when to_regclass('supabase_migrations.schema_migrations') is null then -1 else
      ((xpath('//count/text()',query_to_xml($sql$select count(*) from supabase_migrations.schema_migrations where version='20260722010000'$sql$,false,true,'')))[1]::text)::bigint end migration_history_count
  from controls c cross join stats s
), decision as (
  select *, case
    when business_rows>0 or verification_enabled or ledger_enabled or writeback_enabled
      or legacy_enabled or aggregate_mode<>'off' or apple_membership_rows>0
      then 'ROLLBACK_UNSAFE'
    when manifest_sha<>expected_manifest_sha or controls_rows<>1 or not singleton
      or updated_by is not null or migration_history_count<>1
      or controls_n_tup_upd>0 or business_write_stats>0
      or stats_reset is not null
      or not external_flag_history_verified
      then 'ROLLBACK_REQUIRES_MANUAL_REVIEW'
    else 'ROLLBACK_SAFE' end rollback_result
  from evidence
)
select rollback_result,
  case when rollback_result='ROLLBACK_SAFE' then format(
    'PHASE1A_DOWN_ACK|version=20260722010000|up_sha=5e03dc81ec469c469ccdfe47681e81dff9059e0dc894336c5360e69b93f687d4|database=%s|manifest_sha=%s',
    current_database(),expected_manifest_sha) end approval_token,
  to_jsonb(decision)-'rollback_result' as evidence
from decision;
