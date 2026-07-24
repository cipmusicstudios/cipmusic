\set ON_ERROR_STOP on
-- Read-only postflight for the aggregate-read follow-up.
\if :{?expected_owner}
\else
  \echo 'ERROR: expected_owner is required'
  \quit 3
\endif
with expected as (
  select to_regprocedure('public.billing_get_current_entitlement_summary(uuid)') as oid
), same_named_routines as (
  select count(*) as routine_count
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='billing_get_current_entitlement_summary'
), f as (
  select p.oid,p.proowner,p.prosecdef,p.proconfig,p.proacl,p.prokind,l.lanname,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_get_function_result(p.oid) as result_type
  from expected e
  join pg_proc p on p.oid=e.oid
  join pg_language l on l.oid=p.prolang
), checks as (
  select * from (values
    ('same_name_count',(select routine_count=1 from same_named_routines),'only one public billing_get_current_entitlement_summary routine is allowed'),
    ('rpc_exists',(select count(*)=1 from f),'exact uuid RPC signature required'),
    ('argument_types',(select identity_arguments='p_user_id uuid' from f),'only the approved uuid argument signature is allowed'),
    ('return_type',(select result_type='TABLE(environment app_store_environment, currently_grants_premium boolean, valid_until timestamp with time zone)' from f),'approved TABLE return type required'),
    ('function_kind',(select prokind='f' from f),'approved object must be a function, not a procedure/aggregate/window function'),
    ('function_language',(select lanname='sql' from f),'approved function language required'),
    ('function_owner',(select pg_get_userbyid(proowner)=:'expected_owner' from f),'approved owner required'),
    ('security_definer',(select prosecdef from f),'must be security definer'),
    ('fixed_search_path',(select proconfig=array['search_path=pg_catalog, public']::text[] from f),'fixed search_path required'),
    ('public_revoked',not exists (
      select 1 from f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE'
    ),'PUBLIC must not execute'),
    ('anon_revoked',coalesce((select not has_function_privilege('anon',oid,'EXECUTE') from f),false),'anon must not execute'),
    ('authenticated_revoked',coalesce((select not has_function_privilege('authenticated',oid,'EXECUTE') from f),false),'authenticated must not execute'),
    ('service_role_granted',coalesce((select has_function_privilege('service_role',oid,'EXECUTE') from f),false),'service_role must execute')
  ) v(check_name,passed,detail)
)
select case when bool_and(coalesce(passed,false)) then 'AGGREGATE_READ_POSTFLIGHT_PASS' else 'AGGREGATE_READ_POSTFLIGHT_FAIL' end as result,
  jsonb_agg(jsonb_build_object('check',check_name,'detail',detail) order by check_name) filter(where not coalesce(passed,false)) as failures,
  'If failed, stop and use a reviewed forward fix or verified complete-backup restore; no destructive down migration exists.' as required_action
from checks;
