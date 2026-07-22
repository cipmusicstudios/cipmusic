\set ON_ERROR_STOP on

-- Read-only Production preflight for Phase 1A schema installation.
-- Required psql variables (do not put credentials in this file or shell history):
--   expected_project_ref, expected_database, expected_role,
--   external_apple_flags_off (must be 1 after a separate Netlify/Apple review).
-- Example invocation uses environment-backed PG connection settings:
--   psql "$DATABASE_URL" -X -v expected_project_ref=hngtwkayovuxhiqustsa \
--     -v expected_database=postgres -v expected_role=postgres \
--     -v external_apple_flags_off=1 -f <this-file>

\if :{?expected_project_ref}
\else
  \echo 'ERROR: expected_project_ref is required'
  \quit 3
\endif
\if :{?expected_database}
\else
  \echo 'ERROR: expected_database is required'
  \quit 3
\endif
\if :{?expected_role}
\else
  \echo 'ERROR: expected_role is required'
  \quit 3
\endif
\if :{?external_apple_flags_off}
\else
  \echo 'ERROR: external_apple_flags_off is required'
  \quit 3
\endif

with expected_tables(name) as (
  values ('app_store_entitlements'), ('app_store_transactions'),
    ('app_store_notification_events'), ('app_store_binding_tombstones'),
    ('billing_entitlements_v2'), ('billing_account_deletion_requests'),
    ('billing_account_deletion_fences'), ('billing_runtime_controls')
), expected_types(name) as (
  values ('app_store_environment'), ('app_store_binding_state'),
    ('app_store_current_state_quality'), ('app_store_status_source'),
    ('billing_aggregate_mode'), ('billing_entitlement_validity')
), expected_functions(name) as (
  values ('billing_v2_set_updated_at'), ('billing_get_runtime_controls'),
    ('billing_get_current_entitlement_status'), ('billing_record_app_store_transaction'),
    ('billing_record_app_store_notification'), ('billing_prepare_account_deletion')
), membership as (
  select
    to_regclass('public.user_membership') is not null as exists,
    case when to_regclass('public.user_membership') is null then null else
      ((xpath('//count/text()', query_to_xml(
        'select count(*) from public.user_membership', false, true, '')))[1]::text)::bigint
    end as row_count,
    md5(coalesce(string_agg(
      format('%s:%s:%s:%s:%s', c.ordinal_position, c.column_name, c.data_type,
        c.is_nullable, coalesce(c.column_default,'')), '|' order by c.ordinal_position),''))
      as schema_fingerprint,
    (select coalesce(jsonb_agg(jsonb_build_object(
      'name', con.conname, 'type', con.contype,
      'definition', pg_get_constraintdef(con.oid)) order by con.conname),'[]'::jsonb)
      from pg_constraint con
      where con.conrelid=to_regclass('public.user_membership')) as constraints
    ,coalesce(jsonb_agg(c.column_name order by c.ordinal_position)
      filter (where c.column_name ~* '(apple|app_store)'),'[]'::jsonb) as apple_related_columns
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='user_membership'
), payment_objects as (
  select md5(coalesce(string_agg(format('%s:%s:%s:%s', n.nspname, c.relname,
    c.relkind, pg_get_userbyid(c.relowner)), '|' order by n.nspname,c.relname),'')) as fingerprint,
    coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind)
      order by n.nspname,c.relname) filter (where c.oid is not null),'[]'::jsonb) as inventory
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and (
    c.relname='user_membership' or c.relname='membership_orders'
    or c.relname like '%stripe%' or c.relname like '%google_play%' or c.relname like '%zpay%')
), payment_functions as (
  select md5(coalesce(string_agg(format('%s:%s:%s',n.nspname,p.oid::regprocedure::text,
    pg_get_userbyid(p.proowner)),'|' order by n.nspname,p.oid::regprocedure::text),'')) as fingerprint,
    coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,
      'signature',p.oid::regprocedure::text) order by n.nspname,p.oid::regprocedure::text)
      filter(where p.oid is not null),'[]'::jsonb) as inventory
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like '%stripe%' or p.proname like '%google_play%'
    or p.proname like '%zpay%' or p.proname like '%membership%')
), activity as (
  select
    count(*) filter (where pid<>pg_backend_pid() and xact_start < clock_timestamp()-interval '5 minutes') as long_transactions,
    count(*) filter (where pid<>pg_backend_pid() and wait_event_type='Lock') as lock_waiters,
    count(*) filter (where pid<>pg_backend_pid() and state='active' and query ~* '\m(create|alter|drop|reindex|vacuum full|cluster)\M') as active_ddl,
    count(*) filter (where pid<>pg_backend_pid()) as other_connections,
    count(*) filter (where pid<>pg_backend_pid() and state='active') as other_active_connections
  from pg_stat_activity where datname=current_database()
), history_catalog as (
  select
    exists(select 1 from pg_namespace where nspname='supabase_migrations') schema_exists,
    to_regclass('supabase_migrations.schema_migrations') is not null table_exists,
    exists(select 1 from pg_attribute where attrelid=to_regclass('supabase_migrations.schema_migrations')
      and attname='version' and not attisdropped and atttypid in ('text'::regtype,'varchar'::regtype)) version_column_valid,
    coalesce(has_table_privilege(current_user,to_regclass('supabase_migrations.schema_migrations'),'SELECT'),false) readable
), state as (
  select
    current_database() as database_name,
    current_user as role_name,
    current_setting('server_version') as server_version,
    current_setting('server_version_num')::integer as server_version_num,
    :'expected_project_ref'::text as operator_project_ref,
    :'external_apple_flags_off'::integer=1 as external_apple_flags_off,
    to_regprocedure('extensions.digest(text,text)') is not null
      and pg_get_function_result(to_regprocedure('extensions.digest(text,text)'))='bytea'
      as digest_signature_ok,
    (select count(*) from expected_tables e where to_regclass('public.'||e.name) is not null) as conflicting_tables,
    (select count(*) from expected_types e where exists (
      select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
      where n.nspname='public' and t.typname=e.name)) as conflicting_types,
    (select count(*) from expected_functions e where exists (
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=e.name)) as conflicting_functions,
    h.schema_exists as migration_history_schema_exists,
    h.table_exists as migration_history_table_exists,
    h.version_column_valid as migration_history_structure_valid,
    h.readable as migration_history_readable,
    case when h.schema_exists and h.table_exists and h.version_column_valid and h.readable then
      ((xpath('//count/text()', query_to_xml(
        $$select count(*) from supabase_migrations.schema_migrations where version='20260722010000'$$,
        false,true,'')))[1]::text)::bigint else null end as migration_history_count,
    m.exists as user_membership_exists, m.row_count as user_membership_rows,
    m.schema_fingerprint as user_membership_schema_fingerprint,
    m.constraints as user_membership_constraints,
    m.apple_related_columns as user_membership_apple_related_columns,
    p.fingerprint as payment_object_fingerprint, p.inventory as payment_object_inventory,
    pf.fingerprint as payment_function_fingerprint, pf.inventory as payment_function_inventory,
    a.*
  from membership m cross join payment_objects p cross join payment_functions pf cross join activity a cross join history_catalog h
), checks as (
  select c.* from state s cross join lateral (values
    ('project_ref_attested', s.operator_project_ref='hngtwkayovuxhiqustsa', s.operator_project_ref),
    ('database_name', s.database_name=:'expected_database', s.database_name),
    ('execution_role', s.role_name=:'expected_role', s.role_name),
    ('postgresql_17', s.server_version_num between 170000 and 179999, s.server_version),
    ('digest_signature', s.digest_signature_ok, 'extensions.digest(text,text) returns bytea'),
    ('target_tables_absent', s.conflicting_tables=0, s.conflicting_tables::text),
    ('target_types_absent', s.conflicting_types=0, s.conflicting_types::text),
    ('target_functions_absent', s.conflicting_functions=0, s.conflicting_functions::text),
    ('migration_history_schema', s.migration_history_schema_exists, 'supabase_migrations schema must exist'),
    ('migration_history_table', s.migration_history_table_exists, 'schema_migrations table must exist'),
    ('migration_history_structure', s.migration_history_structure_valid, 'version text/varchar column required'),
    ('migration_history_unreadable', s.migration_history_readable, 'SELECT privilege required'),
    ('target_version_absent', coalesce(s.migration_history_count=0,false), coalesce(s.migration_history_count::text,'unavailable')),
    ('no_long_transactions', s.long_transactions=0, s.long_transactions::text),
    ('no_lock_waiters', s.lock_waiters=0, s.lock_waiters::text),
    ('no_active_ddl', s.active_ddl=0, s.active_ddl::text),
    ('user_membership_exists', s.user_membership_exists, coalesce(s.user_membership_rows::text,'missing')),
    ('external_apple_flags_off', s.external_apple_flags_off, s.external_apple_flags_off::text)
  ) as c(check_name, passed, detail)
), verdict as (
  select case when bool_and(coalesce(passed,false)) then 'MIGRATION_PREFLIGHT_GO'
    else 'MIGRATION_PREFLIGHT_NO_GO' end as result,
    coalesce(jsonb_agg(jsonb_build_object('check',check_name,'detail',detail)
      order by check_name) filter (where not coalesce(passed,false)),'[]'::jsonb) as no_go_reasons
  from checks
)
select v.result, v.no_go_reasons,
  jsonb_build_object(
    'database',s.database_name,'role',s.role_name,'server_version',s.server_version,
    'project_ref_attested',s.operator_project_ref,
    'connections',jsonb_build_object('other',s.other_connections,'active',s.other_active_connections),
    'user_membership_rows',s.user_membership_rows,
    'user_membership_schema_fingerprint',s.user_membership_schema_fingerprint,
    'user_membership_constraints',s.user_membership_constraints,
    'user_membership_apple_related_columns',s.user_membership_apple_related_columns,
    'payment_object_fingerprint',s.payment_object_fingerprint,
    'payment_object_inventory',s.payment_object_inventory,
    'payment_function_fingerprint',s.payment_function_fingerprint,
    'payment_function_inventory',s.payment_function_inventory
  ) as baseline
from verdict v cross join state s;
