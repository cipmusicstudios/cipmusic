\set ON_ERROR_STOP on
\ir 20260722010000_apple_entitlement_manifest.sql

-- Post-commit incident diagnostic only. Phase 1A has no destructive SQL down.
-- Every outcome keeps post_commit_down_supported/destructive_down_allowed false.

with business_counts as (
  select
    (select count(*) from public.app_store_entitlements) as entitlements,
    (select count(*) from public.app_store_transactions) as transactions,
    (select count(*) from public.app_store_notification_events) as notifications,
    (select count(*) from public.app_store_binding_tombstones) as tombstones,
    (select count(*) from public.billing_entitlements_v2) as billing_entitlements,
    (select count(*) from public.billing_account_deletion_requests) as deletion_requests,
    (select count(*) from public.billing_account_deletion_fences) as deletion_fences
), controls as (
  select
    count(*)::integer as row_count,
    bool_and(singleton) as singleton,
    bool_or(apple_verification_enabled) as verification_enabled,
    bool_or(apple_ledger_write_enabled) as ledger_enabled,
    bool_or(apple_membership_writeback_enabled) as writeback_enabled,
    bool_or(legacy_protection_enabled) as legacy_enabled,
    bool_or(aggregate_mode <> 'off') as aggregate_enabled,
    jsonb_agg(to_jsonb(c) order by singleton) as current_rows
  from public.billing_runtime_controls c
), evidence as (
  select
    pg_temp.phase1a_manifest_sha256() as manifest_sha,
    'a645fa4cef579279f4ebc8baec380e3a413792b0da2c92c889921c1da7fb27bb'::text as expected_manifest_sha,
    b.*,
    (b.entitlements+b.transactions+b.notifications+b.tombstones+
      b.billing_entitlements+b.deletion_requests+b.deletion_fences) as business_rows,
    c.*,
    case when to_regclass('public.user_membership') is null then -1 else
      ((xpath('//count/text()',query_to_xml($sql$
        select count(*) from public.user_membership um
        where lower(coalesce(to_jsonb(um)->>'payment_provider','')) in ('apple','app_store','apple_app_store')
           or lower(coalesce(to_jsonb(um)->>'source','')) in ('apple','app_store','apple_app_store')
           or lower(coalesce(to_jsonb(um)->>'provider','')) in ('apple','app_store','apple_app_store')
      $sql$,false,true,'')))[1]::text)::bigint end as apple_membership_rows,
    case when to_regclass('supabase_migrations.schema_migrations') is null then -1 else
      ((xpath('//count/text()',query_to_xml($sql$
        select count(*) from supabase_migrations.schema_migrations
        where version='20260722010000'
      $sql$,false,true,'')))[1]::text)::bigint end as migration_history_count
  from business_counts b cross join controls c
), decision as (
  select *, case
    when business_rows > 0 or verification_enabled or ledger_enabled or writeback_enabled
      or legacy_enabled or aggregate_enabled or apple_membership_rows > 0
      then 'BACKUP_RESTORE_RECOMMENDED'
    when manifest_sha <> expected_manifest_sha or row_count <> 1 or not coalesce(singleton,false)
      or migration_history_count <> 1
      then 'FORWARD_FIX_REQUIRED'
    else 'NO_POST_COMMIT_DOWN_SUPPORTED'
  end as diagnostic_result
  from evidence
)
select diagnostic_result,
  false as post_commit_down_supported,
  false as destructive_down_allowed,
  to_jsonb(decision)-'diagnostic_result' as evidence
from decision;
