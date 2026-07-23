\set ON_ERROR_STOP on
-- Read-only preflight for the aggregate-read follow-up. It does not authorize execution.
\if :{?expected_owner}
\else
  \echo 'ERROR: expected_owner is required'
  \quit 3
\endif
with same_named_routines as (
  select count(*) as routine_count
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='billing_get_current_entitlement_summary'
), checks as (
  select * from (values
    ('phase_1a_present', to_regclass('public.billing_entitlements_v2') is not null,
      'Phase 1A billing_entitlements_v2 must exist before this follow-up'),
    ('phase_1a_type_present', to_regtype('public.app_store_environment') is not null,
      'Phase 1A app_store_environment must exist'),
    ('summary_rpc_absent', (select routine_count=0 from same_named_routines),
      'follow-up RPC name must not already exist in public with any signature or routine kind'),
    ('approved_owner', current_user=:'expected_owner',
      'migration executor must match the approved security-definer owner'),
    ('user_membership_present', to_regclass('public.user_membership') is not null,
      'capture legacy membership baseline before migration')
  ) v(check_name, passed, detail)
)
select case when bool_and(passed) then 'AGGREGATE_READ_PREFLIGHT_GO' else 'AGGREGATE_READ_PREFLIGHT_NO_GO' end as result,
  jsonb_agg(jsonb_build_object('check',check_name,'detail',detail) order by check_name) filter(where not passed) as failures,
  'Read-only only: preserve this result, then require named approval before the follow-up migration.' as required_action
from checks;
