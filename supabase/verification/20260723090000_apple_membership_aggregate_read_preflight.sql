\set ON_ERROR_STOP on
-- Read-only preflight for the aggregate-read follow-up. It does not authorize execution.
with checks as (
  select * from (values
    ('phase_1a_present', to_regclass('public.billing_entitlements_v2') is not null,
      'Phase 1A billing_entitlements_v2 must exist before this follow-up'),
    ('phase_1a_type_present', to_regtype('public.app_store_environment') is not null,
      'Phase 1A app_store_environment must exist'),
    ('summary_rpc_absent', to_regprocedure('public.billing_get_current_entitlement_summary(uuid)') is null,
      'follow-up RPC must not already exist'),
    ('user_membership_present', to_regclass('public.user_membership') is not null,
      'capture legacy membership baseline before migration')
  ) v(check_name, passed, detail)
)
select case when bool_and(passed) then 'AGGREGATE_READ_PREFLIGHT_GO' else 'AGGREGATE_READ_PREFLIGHT_NO_GO' end as result,
  jsonb_agg(jsonb_build_object('check',check_name,'detail',detail) order by check_name) filter(where not passed) as failures,
  'Read-only only: preserve this result, then require named approval before the follow-up migration.' as required_action
from checks;
