-- Follow-up to Phase 1A. This is not executed by this change.
begin;
create function public.billing_get_current_entitlement_summary(p_user_id uuid)
returns table (environment public.app_store_environment, currently_grants_premium boolean, valid_until timestamptz)
language sql security definer stable set search_path = pg_catalog, public as $function$
  select b.source_environment,
    b.source_grants_premium and b.current_state_quality = 'verified'
      and b.source_environment = 'production'
      and b.status in ('active','grace_period','billing_retry','canceled_active')
      and b.valid_until > statement_timestamp(), b.valid_until
  from public.billing_entitlements_v2 b
  where b.user_id = p_user_id and b.source = 'apple'
$function$;
revoke all on function public.billing_get_current_entitlement_summary(uuid) from public, anon, authenticated;
grant execute on function public.billing_get_current_entitlement_summary(uuid) to service_role;
comment on function public.billing_get_current_entitlement_summary(uuid) is
  'Service-role-only Apple entitlement summary for the authenticated membership broker.';
commit;
