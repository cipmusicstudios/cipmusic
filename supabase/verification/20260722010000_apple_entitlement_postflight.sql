\set ON_ERROR_STOP on

-- Read-only postflight. Supply the baseline values emitted by production preflight.
\if :{?expected_user_membership_rows}
\else
  \echo 'ERROR: expected_user_membership_rows is required'
  \quit 3
\endif
\if :{?expected_user_membership_schema_fingerprint}
\else
  \echo 'ERROR: expected_user_membership_schema_fingerprint is required'
  \quit 3
\endif
\if :{?expected_payment_object_fingerprint}
\else
  \echo 'ERROR: expected_payment_object_fingerprint is required'
  \quit 3
\endif
\if :{?expected_payment_function_fingerprint}
\else
  \echo 'ERROR: expected_payment_function_fingerprint is required'
  \quit 3
\endif

with expected_tables(name) as (
  values ('billing_runtime_controls'), ('app_store_entitlements'),
    ('app_store_transactions'), ('app_store_notification_events'),
    ('app_store_binding_tombstones'), ('billing_entitlements_v2'),
    ('billing_account_deletion_requests'), ('billing_account_deletion_fences')
), expected_types(name, labels) as (
  values
    ('app_store_environment','production,sandbox'),
    ('app_store_binding_state','unclaimed,claimed,account_deleted,transferred,fraud_locked'),
    ('app_store_current_state_quality','verified,quarantined'),
    ('app_store_status_source','server_api_status,notification_projection,reconciliation'),
    ('billing_aggregate_mode','off,shadow,write'),
    ('billing_entitlement_validity','bounded,lifetime')
), expected_functions(name) as (
  values ('billing_v2_set_updated_at'), ('billing_get_runtime_controls'),
    ('billing_get_current_entitlement_status'), ('billing_record_app_store_transaction'),
    ('billing_record_app_store_notification'), ('billing_prepare_account_deletion')
), expected_triggers(name) as (
  values ('billing_runtime_controls_set_updated_at'),
    ('app_store_entitlements_set_updated_at'),
    ('app_store_notification_events_set_updated_at'),
    ('billing_entitlements_v2_set_updated_at'),
    ('billing_account_deletion_requests_set_updated_at'),
    ('billing_account_deletion_fences_set_updated_at')
), expected_table_columns(name, column_count) as (
  values ('app_store_binding_tombstones',8), ('app_store_entitlements',31),
    ('app_store_notification_events',16), ('app_store_transactions',19),
    ('billing_account_deletion_fences',4), ('billing_account_deletion_requests',9),
    ('billing_entitlements_v2',17), ('billing_runtime_controls',8)
), membership as (
  select
    ((xpath('//count/text()', query_to_xml(
      'select count(*) from public.user_membership',false,true,'')))[1]::text)::bigint as row_count,
    md5(coalesce(string_agg(format('%s:%s:%s:%s:%s',c.ordinal_position,c.column_name,
      c.data_type,c.is_nullable,coalesce(c.column_default,'')),'|' order by c.ordinal_position),'')) as schema_fingerprint
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='user_membership'
), payment_objects as (
  select md5(coalesce(string_agg(format('%s:%s:%s:%s',n.nspname,c.relname,c.relkind,
    pg_get_userbyid(c.relowner)),'|' order by n.nspname,c.relname),'')) as fingerprint
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and (c.relname='user_membership' or c.relname='membership_orders'
    or c.relname like '%stripe%' or c.relname like '%google_play%' or c.relname like '%zpay%')
), payment_functions as (
  select md5(coalesce(string_agg(format('%s:%s:%s',n.nspname,p.oid::regprocedure::text,
    pg_get_userbyid(p.proowner)),'|' order by n.nspname,p.oid::regprocedure::text),'')) as fingerprint
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like '%stripe%' or p.proname like '%google_play%'
    or p.proname like '%zpay%' or p.proname like '%membership%')
), inventory as (
  select
    (select count(*) from expected_tables e where to_regclass('public.'||e.name) is not null) as table_count,
    (select count(*) from expected_types e where exists (
      select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
      where n.nspname='public' and t.typname=e.name)) as type_count,
    (select count(*) from expected_types e where e.labels=(
      select string_agg(en.enumlabel,',' order by en.enumsortorder)
      from pg_type t join pg_namespace n on n.oid=t.typnamespace
      join pg_enum en on en.enumtypid=t.oid
      where n.nspname='public' and t.typname=e.name)) as enum_definition_count,
    (select count(*) from expected_table_columns e where e.column_count=(
      select count(*) from information_schema.columns c
      where c.table_schema='public' and c.table_name=e.name)) as table_column_shape_count,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in (select name from expected_functions)) as function_count,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in (select name from expected_functions)
        and pg_get_userbyid(p.proowner)=current_user) as function_owner_count,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in (select name from expected_functions)
        and p.prosecdef) as security_definer_count,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in (select name from expected_functions)
        and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=pg_catalog, public%') as fixed_search_path_count,
    (select count(*) from pg_trigger where not tgisinternal
      and tgname in (select name from expected_triggers)) as trigger_count,
    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (select name from expected_tables)
        and c.relrowsecurity) as rls_count,
    (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (select name from expected_tables)) as policy_count,
    (select count(*) from pg_constraint con where con.conrelid in (
      select to_regclass('public.'||name) from expected_tables)) as constraint_count,
    (select count(*) from pg_index i where i.indrelid in (
      select to_regclass('public.'||name) from expected_tables)) as index_count,
    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where n.nspname='public' and c.relname in (select name from expected_tables)
        and (a.grantee=0 or a.grantee in (select oid from pg_roles
          where rolname in ('anon','authenticated','service_role')))
        and a.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
      as unexpected_table_grants,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where n.nspname='public' and p.proname in (select name from expected_functions)
        and (a.grantee=0 or a.grantee in (select oid from pg_roles
          where rolname in ('anon','authenticated')))
        and a.privilege_type='EXECUTE') as unexpected_function_grants,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in (
        'billing_get_runtime_controls','billing_get_current_entitlement_status',
        'billing_record_app_store_transaction','billing_record_app_store_notification',
        'billing_prepare_account_deletion')
        and has_function_privilege('service_role',p.oid,'EXECUTE')) as service_role_rpc_grants,
    case when to_regclass('supabase_migrations.schema_migrations') is null then 0 else
      ((xpath('//count/text()',query_to_xml(
        $$select count(*) from supabase_migrations.schema_migrations where version='20260722010000'$$,
        false,true,'')))[1]::text)::bigint end as migration_history_count
), data_state as (
  select
    (select count(*) from public.billing_runtime_controls) as controls_count,
    (select count(*) from public.app_store_entitlements) as entitlements_count,
    (select count(*) from public.app_store_transactions) as transactions_count,
    (select count(*) from public.app_store_notification_events) as notifications_count,
    (select count(*) from public.app_store_binding_tombstones) as tombstones_count,
    (select count(*) from public.billing_entitlements_v2) as billing_entitlements_count,
    (select count(*) from public.billing_account_deletion_requests) as deletion_requests_count,
    (select count(*) from public.billing_account_deletion_fences) as deletion_fences_count,
    bool_and(not apple_verification_enabled and not apple_ledger_write_enabled
      and not apple_membership_writeback_enabled and aggregate_mode='off'
      and not legacy_protection_enabled) as controls_default
  from public.billing_runtime_controls
), checks as (
  select c.* from inventory i cross join data_state d cross join membership m
  cross join payment_objects p cross join payment_functions pf cross join lateral (values
    ('migration_history',i.migration_history_count=1,i.migration_history_count::text),
    ('tables',i.table_count=8,i.table_count::text),
    ('types',i.type_count=6,i.type_count::text),
    ('enum_definitions',i.enum_definition_count=6,i.enum_definition_count::text),
    ('table_column_shapes',i.table_column_shape_count=8,i.table_column_shape_count::text),
    ('functions',i.function_count=6,i.function_count::text),
    ('function_owners',i.function_owner_count=6,i.function_owner_count::text),
    ('security_definer',i.security_definer_count=5,i.security_definer_count::text),
    ('fixed_search_path',i.fixed_search_path_count=6,i.fixed_search_path_count::text),
    ('triggers',i.trigger_count=6,i.trigger_count::text),
    ('rls',i.rls_count=8,i.rls_count::text),
    ('policies',i.policy_count=0,i.policy_count::text),
    ('constraints',i.constraint_count=55,i.constraint_count::text),
    ('indexes',i.index_count=20,i.index_count::text),
    ('table_grants',i.unexpected_table_grants=0,i.unexpected_table_grants::text),
    ('function_grants',i.unexpected_function_grants=0,i.unexpected_function_grants::text),
    ('service_role_rpc_grants',i.service_role_rpc_grants=5,i.service_role_rpc_grants::text),
    ('runtime_singleton',d.controls_count=1,d.controls_count::text),
    ('runtime_defaults',d.controls_default,coalesce(d.controls_default::text,'null')),
    ('phase1a_tables_empty',d.entitlements_count+d.transactions_count+d.notifications_count+
      d.tombstones_count+d.billing_entitlements_count+d.deletion_requests_count+
      d.deletion_fences_count=0,
      (d.entitlements_count+d.transactions_count+d.notifications_count+d.tombstones_count+
       d.billing_entitlements_count+d.deletion_requests_count+d.deletion_fences_count)::text),
    ('user_membership_rows',m.row_count=:'expected_user_membership_rows'::bigint,m.row_count::text),
    ('user_membership_schema',m.schema_fingerprint=:'expected_user_membership_schema_fingerprint',m.schema_fingerprint),
    ('payment_objects',p.fingerprint=:'expected_payment_object_fingerprint',p.fingerprint),
    ('payment_functions',pf.fingerprint=:'expected_payment_function_fingerprint',pf.fingerprint)
  ) c(check_name,passed,detail)
)
select case when bool_and(passed) then 'MIGRATION_POSTFLIGHT_PASS'
  else 'MIGRATION_POSTFLIGHT_FAIL' end as result,
  coalesce(jsonb_agg(jsonb_build_object('check',check_name,'detail',detail)
    order by check_name) filter(where not passed),'[]'::jsonb) as failures
from checks;
