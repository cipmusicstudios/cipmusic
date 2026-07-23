\set ON_ERROR_STOP on
-- Read-only postflight for the aggregate-read follow-up.
\if :{?expected_owner}
\else
  \echo 'ERROR: expected_owner is required'
  \quit 3
\endif
with f as (
  select p.oid,p.proowner,p.prosecdef,p.proconfig,p.proacl
  from pg_proc p where p.oid='public.billing_get_current_entitlement_summary(uuid)'::regprocedure
), checks as (
  select * from (values
    ('rpc_exists',(select count(*)=1 from f),'exact uuid RPC signature required'),
    ('function_owner',(select pg_get_userbyid(proowner)=:'expected_owner' from f),'approved owner required'),
    ('security_definer',(select prosecdef from f),'must be security definer'),
    ('fixed_search_path',(select coalesce(array_to_string(proconfig,','),'') like '%search_path=pg_catalog, public%' from f),'fixed search_path required'),
    ('public_revoked',not exists (
      select 1 from f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE'
    ),'PUBLIC must not execute'),
    ('anon_revoked',not has_function_privilege('anon','public.billing_get_current_entitlement_summary(uuid)'::regprocedure,'EXECUTE'),'anon must not execute'),
    ('authenticated_revoked',not has_function_privilege('authenticated','public.billing_get_current_entitlement_summary(uuid)'::regprocedure,'EXECUTE'),'authenticated must not execute'),
    ('service_role_granted',has_function_privilege('service_role','public.billing_get_current_entitlement_summary(uuid)'::regprocedure,'EXECUTE'),'service_role must execute')
  ) v(check_name,passed,detail)
)
select case when bool_and(coalesce(passed,false)) then 'AGGREGATE_READ_POSTFLIGHT_PASS' else 'AGGREGATE_READ_POSTFLIGHT_FAIL' end as result,
  jsonb_agg(jsonb_build_object('check',check_name,'detail',detail) order by check_name) filter(where not coalesce(passed,false)) as failures,
  'If failed, stop and use a reviewed forward fix or verified complete-backup restore; no destructive down migration exists.' as required_action
from checks;
