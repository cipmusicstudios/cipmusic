-- Canonical, read-only Phase 1A catalog manifest (PostgreSQL 17).
-- The JSON deliberately excludes OIDs and normalizes the migration owner to
-- @migration_owner. All arrays are explicitly sorted. pg_get_* deparsers are
-- used for executable definitions. Consumers compare phase1a_manifest_sha256()
-- with the reviewed frozen SHA recorded beside the migration.

create or replace function pg_temp.phase1a_manifest_json()
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $manifest$
with target_tables(name) as (
  values ('app_store_entitlements'), ('app_store_transactions'),
    ('app_store_notification_events'), ('app_store_binding_tombstones'),
    ('billing_entitlements_v2'), ('billing_account_deletion_requests'),
    ('billing_account_deletion_fences'), ('billing_runtime_controls')
), target_types(name) as (
  values ('app_store_environment'), ('app_store_binding_state'),
    ('app_store_current_state_quality'), ('app_store_status_source'),
    ('billing_aggregate_mode'), ('billing_entitlement_validity')
), target_functions(name) as (
  values ('billing_v2_set_updated_at'), ('billing_get_runtime_controls'),
    ('billing_get_current_entitlement_status'), ('billing_record_app_store_transaction'),
    ('billing_record_app_store_notification'), ('billing_prepare_account_deletion')
), enums as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', tt.name,
    'labels', coalesce((select jsonb_agg(e.enumlabel order by e.enumsortorder)
      from pg_type t join pg_namespace n on n.oid=t.typnamespace
      join pg_enum e on e.enumtypid=t.oid
      where n.nspname='public' and t.typname=tt.name), '[]'::jsonb)
  ) order by tt.name), '[]'::jsonb) value from target_types tt
), tables as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema','public','name', tt.name, 'kind', c.relkind, 'persistence', c.relpersistence,
    'owner', case when c.relowner=(select oid from pg_roles where rolname=current_user)
      then '@migration_owner' else pg_get_userbyid(c.relowner) end,
    'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
    'replica_identity',c.relreplident,
    'replica_identity_index',(select ci.relname from pg_index ri
      join pg_class ci on ci.oid=ri.indexrelid
      where ri.indrelid=c.oid and ri.indisreplident),
    'options', coalesce(to_jsonb(c.reloptions),'[]'::jsonb),
    'acl', coalesce((select jsonb_agg(jsonb_build_object(
      'grantee', case when a.grantee=0 then 'PUBLIC' when a.grantee=c.relowner then '@migration_owner' else pg_get_userbyid(a.grantee) end,
      'grantor', case when a.grantor=c.relowner then '@migration_owner' else pg_get_userbyid(a.grantor) end,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      order by case when a.grantee=0 then 'PUBLIC' when a.grantee=c.relowner then '@migration_owner' else pg_get_userbyid(a.grantee) end,
        case when a.grantor=c.relowner then '@migration_owner' else pg_get_userbyid(a.grantor) end,
        a.privilege_type,a.is_grantable)
      from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a), '[]'::jsonb)
  ) order by tt.name), '[]'::jsonb) value
  from target_tables tt left join pg_class c on c.oid=to_regclass('public.'||tt.name)
), columns as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table',tt.name,'position',a.attnum,'name',a.attname,
    'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
    'collation',case when a.attcollation=0 then null else a.attcollation::regcollation::text end,
    'default',pg_get_expr(d.adbin,d.adrelid,true),'identity',a.attidentity,
    'generated',a.attgenerated,'storage',a.attstorage,'compression',a.attcompression,
    'statistics',a.attstattarget
  ) order by tt.name,a.attnum), '[]'::jsonb) value
  from target_tables tt join pg_attribute a on a.attrelid=to_regclass('public.'||tt.name)
    and a.attnum>0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
), constraints as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table',tt.name,'name',con.conname,'type',con.contype,
    'deferrable',con.condeferrable,'deferred',con.condeferred,
    'validated',con.convalidated,'definition',pg_get_constraintdef(con.oid,true)
  ) order by tt.name,con.conname), '[]'::jsonb) value
  from target_tables tt join pg_constraint con on con.conrelid=to_regclass('public.'||tt.name)
), indexes as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table',tt.name,'name',ci.relname,'method',am.amname,'unique',i.indisunique,
    'primary',i.indisprimary,'valid',i.indisvalid,'ready',i.indisready,
    'definition',pg_get_indexdef(i.indexrelid),
    'predicate',pg_get_expr(i.indpred,i.indrelid,true),
    'expressions',pg_get_expr(i.indexprs,i.indrelid,true)
  ) order by tt.name,ci.relname), '[]'::jsonb) value
  from target_tables tt join pg_index i on i.indrelid=to_regclass('public.'||tt.name)
  join pg_class ci on ci.oid=i.indexrelid join pg_am am on am.oid=ci.relam
), functions as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema','public','signature',p.oid::regprocedure::text,
    'owner',case when p.proowner=(select oid from pg_roles where rolname=current_user)
      then '@migration_owner' else pg_get_userbyid(p.proowner) end,
    'language',l.lanname,'result',pg_get_function_result(p.oid),
    'arguments',pg_get_function_arguments(p.oid),
    'identity_arguments',pg_get_function_identity_arguments(p.oid),
    'kind',p.prokind,'volatility',p.provolatile,'parallel',p.proparallel,
    'strict',p.proisstrict,'security_definer',p.prosecdef,'leakproof',p.proleakproof,
    'cost',p.procost,'rows',p.prorows,'returns_set',p.proretset,
    'source',p.prosrc,'binary',p.probin,
    'config',coalesce((select jsonb_agg(x order by x) from unnest(p.proconfig) x),'[]'::jsonb),
    'acl',coalesce((select jsonb_agg(jsonb_build_object(
      'grantee',case when a.grantee=0 then 'PUBLIC' when a.grantee=p.proowner then '@migration_owner' else pg_get_userbyid(a.grantee) end,
      'grantor',case when a.grantor=p.proowner then '@migration_owner' else pg_get_userbyid(a.grantor) end,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      order by case when a.grantee=0 then 'PUBLIC' when a.grantee=p.proowner then '@migration_owner' else pg_get_userbyid(a.grantee) end,
        case when a.grantor=p.proowner then '@migration_owner' else pg_get_userbyid(a.grantor) end,
        a.privilege_type,a.is_grantable)
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'[]'::jsonb)
  ) order by p.oid::regprocedure::text), '[]'::jsonb) value
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  join pg_language l on l.oid=p.prolang
  where n.nspname='public' and p.proname in (select name from target_functions)
), triggers as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table',tt.name,'name',t.tgname,'enabled',t.tgenabled,
    'definition',pg_get_triggerdef(t.oid,true)
  ) order by tt.name,t.tgname), '[]'::jsonb) value
  from target_tables tt join pg_trigger t on t.tgrelid=to_regclass('public.'||tt.name)
  where not t.tgisinternal
), policies as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table',tt.name,'name',p.polname,'permissive',p.polpermissive,'command',p.polcmd,
    'roles',coalesce((select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end
      order by case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end) from unnest(p.polroles) r),'[]'::jsonb),
    'using',pg_get_expr(p.polqual,p.polrelid,true),
    'check',pg_get_expr(p.polwithcheck,p.polrelid,true)
  ) order by tt.name,p.polname), '[]'::jsonb) value
  from target_tables tt join pg_policy p on p.polrelid=to_regclass('public.'||tt.name)
)
select jsonb_build_object('format','cipmusic-phase1a-pg17-v2','enums',e.value,
  'tables',t.value,'columns',c.value,'constraints',k.value,'indexes',i.value,
  'functions',f.value,'triggers',g.value,'policies',p.value)
from enums e cross join tables t cross join columns c cross join constraints k
cross join indexes i cross join functions f cross join triggers g cross join policies p
$manifest$;

create or replace function pg_temp.phase1a_manifest_sha256()
returns text language sql stable set search_path=pg_catalog,public as $$
  select encode(extensions.digest(pg_temp.phase1a_manifest_json()::text,'sha256'),'hex')
$$;
