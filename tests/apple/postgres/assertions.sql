\set ON_ERROR_STOP on

create schema test_assert;
create function test_assert.ok(value boolean, message text)
returns void language plpgsql as $$
begin
  if value is not true then raise exception 'ASSERTION_FAILED: %', message; end if;
end $$;

select test_assert.ok(to_regprocedure('extensions.digest(text,text)') is not null, 'extensions.digest signature');
select test_assert.ok(encode(extensions.digest(concat_ws('|',
  'production','fixture-original','fixture-current','com.cipmusic.aurasounds.premium.monthly.v2',
  '22099193','','active','true','2030-01-02T03:04:05.006Z','true','server_api_status'
), 'sha256'), 'hex') = :'expected_status_fingerprint', 'TypeScript/PostgreSQL status fingerprint mismatch');
select test_assert.ok((select note = 'untouched' from public.apple_phase1a_baseline_sentinel where id = 1), 'baseline changed');
select test_assert.ok((select count(*) = 0 from public.user_membership), 'user_membership changed');
select test_assert.ok(not exists (
  select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and n.nspname='public' and c.relname='user_membership'
), 'user_membership trigger created');

do $$
declare role_name text; table_name text; command text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    foreach table_name in array array[
      'billing_runtime_controls','app_store_entitlements','app_store_transactions',
      'app_store_notification_events','app_store_binding_tombstones',
      'billing_entitlements_v2','billing_account_deletion_requests'
    ] loop
      foreach command in array array['SELECT','INSERT','UPDATE','DELETE'] loop
        perform test_assert.ok(not has_table_privilege(role_name, 'public.'||table_name, command), role_name||' has '||command||' on '||table_name);
      end loop;
    end loop;
  end loop;
  foreach table_name in array array[
    'billing_runtime_controls','app_store_entitlements','app_store_transactions',
    'app_store_notification_events','app_store_binding_tombstones',
    'billing_entitlements_v2','billing_account_deletion_requests'
  ] loop
    perform test_assert.ok(not has_table_privilege('service_role', 'public.'||table_name, 'SELECT,INSERT,UPDATE,DELETE'), 'service_role direct DML on '||table_name);
  end loop;
end $$;

select test_assert.ok(not has_function_privilege('anon','public.billing_get_runtime_controls()','EXECUTE'), 'anon controls execute');
select test_assert.ok(not has_function_privilege('authenticated','public.billing_get_runtime_controls()','EXECUTE'), 'authenticated controls execute');
select test_assert.ok(has_function_privilege('service_role','public.billing_get_runtime_controls()','EXECUTE'), 'service_role controls execute missing');
select test_assert.ok(not has_function_privilege('anon','public.billing_get_current_entitlement_status(uuid)','EXECUTE'), 'anon current entitlement execute');
select test_assert.ok(not has_function_privilege('authenticated','public.billing_get_current_entitlement_status(uuid)','EXECUTE'), 'authenticated current entitlement execute');
select test_assert.ok(has_function_privilege('service_role','public.billing_get_current_entitlement_status(uuid)','EXECUTE'), 'service current entitlement execute missing');

set role authenticated;
do $$ begin
  begin
    perform * from public.billing_get_current_entitlement_status('00000000-0000-4000-8000-000000000001');
    raise exception 'ASSERTION_FAILED: authenticated executed current entitlement RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform * from public.billing_get_current_entitlement_status('00000000-0000-4000-8000-000000000001');
    raise exception 'ASSERTION_FAILED: anon executed current entitlement RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$
declare fn record;
begin
  for fn in
    select p.oid, p.proname, p.prosecdef, p.proconfig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'billing_get_runtime_controls','billing_get_current_entitlement_status','billing_record_app_store_transaction',
      'billing_record_app_store_notification','billing_prepare_account_deletion'
    )
  loop
    perform test_assert.ok(fn.prosecdef, fn.proname||' not SECURITY DEFINER');
    perform test_assert.ok(fn.proconfig @> array['search_path=pg_catalog, public'], fn.proname||' search_path');
  end loop;
end $$;

insert into auth.users(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000003'),
 ('10000000-0000-4000-8000-000000000004'),
 ('10000000-0000-4000-8000-000000000005');

create function test_assert.token_hash(value uuid) returns text
language sql immutable security definer set search_path=pg_catalog,extensions as $$
  select encode(extensions.digest('cipmusic:app-account-token:v1:' || lower(value::text), 'sha256'), 'hex')
$$;

create function test_assert.record_tx(
  p_user uuid,
  p_environment public.app_store_environment,
  p_transaction_id text,
  p_original_transaction_id text,
  p_transaction_signed_date timestamptz,
  p_current_signed_date timestamptz,
  p_current_status text,
  p_current_grant boolean,
  p_current_product text default 'com.cipmusic.aurasounds.premium.monthly.v2',
  p_current_expires_at timestamptz default null,
  p_with_token boolean default true,
  p_claim_intent text default 'purchase',
  p_confirmed boolean default false,
  p_summary_hash text default null,
  p_current_hash text default null,
  p_transaction_product text default null,
  p_transaction_status text default 'recorded',
  p_current_transaction_id text default null,
  p_renewal_signed_date timestamptz default null,
  p_current_quality text default 'verified',
  p_conflicting_hash text default null,
  p_status_source text default 'server_api_status'
)
returns table (
  entitlement_id uuid, binding_result text, transaction_duplicate boolean,
  applied_as_latest boolean, current_state_quality public.app_store_current_state_quality
)
language plpgsql security definer set search_path=pg_catalog,test_assert,extensions,public as $$
declare
  v_token_hash text := case when p_with_token and p_user is not null then test_assert.token_hash(p_user) end;
  v_expires timestamptz := coalesce(p_current_expires_at,
    case when p_current_grant then transaction_timestamp() + interval '30 days' end);
  v_product text := coalesce(p_transaction_product, p_current_product);
  v_current_hash text;
begin
  v_current_hash := coalesce(p_current_hash, encode(extensions.digest(concat_ws('|',
    p_environment::text, p_original_transaction_id, coalesce(p_current_transaction_id, p_transaction_id),
    p_current_product, '22099193', coalesce(v_token_hash, ''), p_current_status,
    p_current_grant::text,
    coalesce(to_char(v_expires at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ''),
    'true', p_status_source
  ), 'sha256'), 'hex'));
  return query select * from public.billing_record_app_store_transaction(
    p_user, p_environment, p_environment, p_transaction_id, p_original_transaction_id,
    v_product, '22099193', v_token_hash, p_transaction_signed_date - interval '1 day',
    p_transaction_signed_date + interval '30 days', p_transaction_signed_date,
    case when p_transaction_status='revoked' then p_transaction_signed_date end,
    null, 'PURCHASE', 'PURCHASED', p_transaction_status,
    coalesce(p_summary_hash, encode(extensions.digest('tx:' || p_transaction_id, 'sha256'), 'hex')),
    p_claim_intent, p_confirmed, coalesce(p_current_transaction_id, p_transaction_id), p_current_product, '22099193',
    v_token_hash, p_current_status, p_current_grant, v_expires, true,
    p_current_signed_date, p_renewal_signed_date, statement_timestamp(), v_current_hash,
    p_conflicting_hash, p_status_source, p_current_quality
  );
end $$;
grant usage on schema test_assert to service_role;
grant execute on function test_assert.record_tx(
  uuid, public.app_store_environment, text, text, timestamptz, timestamptz, text,
  boolean, text, timestamptz, boolean, text, boolean, text, text, text, text, text,
  timestamptz, text, text, text
) to service_role;

create function test_assert.call_generic_ledger_as_invoker() returns void
language plpgsql security invoker set search_path=pg_catalog,test_assert,extensions,public as $$
begin
  perform * from public.billing_record_app_store_transaction(
    null, 'production', 'production', 'unauthorized-tx', 'unauthorized-original',
    'com.cipmusic.aurasounds.premium.monthly.v2', '22099193', null,
    '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z',
    null, null, 'PURCHASE', 'PURCHASED', 'recorded', repeat('0',64),
    'purchase', false, 'unauthorized-tx', 'com.cipmusic.aurasounds.premium.monthly.v2',
    '22099193', null, 'expired', false, '2026-02-01T00:00:00Z', false,
    '2026-01-01T00:00:00Z', null, '2026-01-01T00:00:00Z', repeat('1',64),
    null, 'server_api_status', 'verified'
  );
end $$;
grant usage on schema test_assert to anon, authenticated;
grant execute on function test_assert.call_generic_ledger_as_invoker() to anon, authenticated;

set role authenticated;
do $$ begin
  begin
    perform test_assert.call_generic_ledger_as_invoker();
    raise exception 'ASSERTION_FAILED: authenticated executed generic ledger RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform test_assert.call_generic_ledger_as_invoker();
    raise exception 'ASSERTION_FAILED: anon executed generic ledger RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set role service_role;
do $$ begin
  perform * from public.billing_get_runtime_controls();
  begin
    perform * from test_assert.record_tx(
      '10000000-0000-4000-8000-000000000001','production','flags-tx','flags-original',
      now(),now(),'active',true
    );
    raise exception 'ASSERTION_FAILED: ledger fail-open';
  exception when sqlstate '55000' then null; end;
end $$;
reset role;

-- Current entitlement is computed at read time; static source eligibility cannot outlive valid_until.
insert into public.billing_entitlements_v2(
  user_id,source,source_environment,external_entitlement_id,status,validity,valid_until,
  source_grants_premium,current_state_quality,source_version_at,source_observed_at
) values (
  '10000000-0000-4000-8000-000000000002','legacy_protection',null,'short-lived','active','bounded',
  statement_timestamp()+interval '100 milliseconds',true,'verified',now(),now()
);
select test_assert.ok((select currently_grants_premium from public.billing_get_current_entitlement_status(
  '10000000-0000-4000-8000-000000000002') where external_entitlement_id='short-lived'), 'fresh bounded grant denied');
select pg_sleep(0.15);
select test_assert.ok((select not currently_grants_premium from public.billing_get_current_entitlement_status(
  '10000000-0000-4000-8000-000000000002') where external_entitlement_id='short-lived'), 'expired bounded grant remained active');
insert into public.billing_entitlements_v2(
  user_id,source,source_environment,external_entitlement_id,status,validity,valid_until,
  source_grants_premium,current_state_quality,source_version_at,source_observed_at
) values (
  '10000000-0000-4000-8000-000000000002','legacy_protection',null,'at-boundary','active','bounded',
  statement_timestamp(),true,'verified',now(),now()
);
select test_assert.ok((select not currently_grants_premium from public.billing_get_current_entitlement_status(
  '10000000-0000-4000-8000-000000000002') where external_entitlement_id='at-boundary'), 'boundary grant remained active');
insert into public.billing_entitlements_v2(
  user_id,source,source_environment,external_entitlement_id,status,validity,valid_until,
  source_grants_premium,current_state_quality,source_version_at,source_observed_at
) values (
  '10000000-0000-4000-8000-000000000002','legacy_protection',null,'lifetime','active','lifetime',
  null,true,'verified',now(),now()
);
select test_assert.ok((select currently_grants_premium from public.billing_get_current_entitlement_status(
  '10000000-0000-4000-8000-000000000002') where external_entitlement_id='lifetime'), 'lifetime grant denied');

update public.billing_runtime_controls set apple_verification_enabled=true, apple_ledger_write_enabled=true;

do $$ begin
  begin
    perform * from test_assert.record_tx(
      '10000000-0000-4000-8000-000000000002','production','legacy-no-confirm','legacy-no-confirm-original',
      now(),now(),'active',true,'com.cipmusic.aurasounds.premium.monthly.v2',null,false,'legacy_claim',false);
    raise exception 'ASSERTION_FAILED: unconfirmed legacy claim succeeded';
  exception when invalid_parameter_value then
    perform test_assert.ok(sqlerrm='LEGACY_CLAIM_CONFIRMATION_REQUIRED','wrong missing confirmation error');
  end;
  begin
    perform * from test_assert.record_tx(
      '10000000-0000-4000-8000-000000000002','production','legacy-token','legacy-token-original',
      now(),now(),'active',true,'com.cipmusic.aurasounds.premium.monthly.v2',null,true,'legacy_claim',true);
    raise exception 'ASSERTION_FAILED: tokenized legacy claim succeeded';
  exception when invalid_parameter_value then
    perform test_assert.ok(sqlerrm='LEGACY_CLAIM_NOT_ALLOWED','wrong tokenized legacy error');
  end;
  begin
    perform * from test_assert.record_tx(
      '10000000-0000-4000-8000-000000000002','production','legacy-expired','legacy-expired-original',
      now()-interval '2 days',now(),'expired',false,'com.cipmusic.aurasounds.premium.monthly.v2',
      now()-interval '1 day',false,'legacy_claim',true);
    raise exception 'ASSERTION_FAILED: expired legacy claim succeeded';
  exception when invalid_parameter_value then
    perform test_assert.ok(sqlerrm='LEGACY_CLAIM_NOT_ALLOWED','wrong expired legacy error');
  end;
end $$;

-- Restore without a token stays unclaimed; explicit current legacy claim is required.
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000001','production','tx-001','original-001',
  now(),now(),'active',true,'com.cipmusic.aurasounds.premium.monthly.v2',null,false,'restore',false
);
select test_assert.ok((select binding_state='unclaimed' and user_id is null from public.app_store_entitlements where original_transaction_id='original-001'), 'first unclaimed');

select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000001','production','tx-002','original-001',
  now()+interval '1 second',now()+interval '1 second','active',true,'com.cipmusic.aurasounds.premium.monthly.v2',null,false,'legacy_claim',true
);
select test_assert.ok((select binding_state='claimed' and user_id='10000000-0000-4000-8000-000000000001' from public.app_store_entitlements where original_transaction_id='original-001'), 'claim failed');
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000001','production','tx-002','original-001',
  now()+interval '1 second',now()+interval '1 second','active',true,'com.cipmusic.aurasounds.premium.monthly.v2',null,false,'legacy_claim',true
);

do $$ begin
  begin
    perform * from test_assert.record_tx(
      '10000000-0000-4000-8000-000000000002','production','tx-conflict','original-001',
      now()+interval '2 seconds',now()+interval '2 seconds','active',true,'com.cipmusic.aurasounds.premium.monthly.v2',null,false,'legacy_claim',true);
    raise exception 'ASSERTION_FAILED: cross-user claim succeeded';
  exception when unique_violation then
    perform test_assert.ok(sqlerrm='APP_STORE_ALREADY_BOUND','wrong binding error');
  end;
  begin
    perform * from test_assert.record_tx(
      '10000000-0000-4000-8000-000000000001','production','tx-002','original-001',
      now()+interval '1 second',now()+interval '1 second','active',true,'com.cipmusic.aurasounds.premium.monthly.v2',null,false,'legacy_claim',true,
      repeat('9',64));
    raise exception 'ASSERTION_FAILED: replay mismatch succeeded';
  exception when unique_violation then
    perform test_assert.ok(sqlerrm='TRANSACTION_REPLAY_MISMATCH','wrong replay error');
  end;
  begin
    perform * from public.billing_record_app_store_transaction(
      '10000000-0000-4000-8000-000000000001','production','production','bad-token','original-token',
      'com.cipmusic.aurasounds.premium.monthly.v2','22099193',test_assert.token_hash('10000000-0000-4000-8000-000000000002'),
      now(),now()+interval '1 day',now(),null,null,'PURCHASE','PURCHASED','recorded',repeat('4',64),
      'purchase',false,'bad-token','com.cipmusic.aurasounds.premium.monthly.v2','22099193',
      test_assert.token_hash('10000000-0000-4000-8000-000000000002'),'active',true,now()+interval '1 day',true,
      now(),null,now(),repeat('4',64),null,'server_api_status','verified');
    raise exception 'ASSERTION_FAILED: token mismatch succeeded';
  exception when invalid_parameter_value then
    perform test_assert.ok(sqlerrm='APP_ACCOUNT_TOKEN_MISMATCH','wrong token error');
  end;
end $$;

-- A newer signed-evidence snapshot wins; an older transaction fact cannot alter it.
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000001','production','tx-new','original-001',
  now()+interval '10 seconds',now()+interval '10 seconds','active',true,
  'com.cipmusic.aurasounds.premium.yearly.v2'
);
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000001','production','tx-old','original-001',
  now()-interval '1 day',now()-interval '1 day','expired',false,
  'com.cipmusic.aurasounds.premium.monthly.v2',now()-interval '1 hour',true,'restore'
);
select test_assert.ok((select latest_transaction_id='tx-new' and normalized_status='active'
  from public.app_store_entitlements where original_transaction_id='original-001'), 'old state overwrote new');
select test_assert.ok((select product_id='com.cipmusic.aurasounds.premium.yearly.v2' and source_grants_premium
  from public.billing_entitlements_v2 where external_entitlement_id='original-001'), 'projection did not use locked entitlement');

-- Natural expiry with unchanged signed evidence deterministically disables the Apple source.
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000004','production','natural-active-fact','natural-original',
  now(),date_trunc('second',now()),'active',true,
  'com.cipmusic.aurasounds.premium.monthly.v2',statement_timestamp()+interval '100 milliseconds',true,'purchase',false,
  null,null,null,'recorded','natural-current'
);
select pg_sleep(0.15);
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000004','production','natural-expired-fact','natural-original',
  now()+interval '1 second',(select transaction_evidence_signed_at from public.app_store_entitlements where original_transaction_id='natural-original'),
  'expired',false,'com.cipmusic.aurasounds.premium.monthly.v2',
  (select expires_at from public.app_store_entitlements where original_transaction_id='natural-original'),true,'restore',false,
  null,null,null,'recorded','natural-current'
);
select test_assert.ok((select current_state_quality='verified' and normalized_status='expired'
  and not source_grants_premium and conflicting_status_fingerprint is null
  from public.app_store_entitlements where original_transaction_id='natural-original'), 'natural expiry was not deterministic');
select test_assert.ok((select not currently_grants_premium from public.billing_get_current_entitlement_status(
  '10000000-0000-4000-8000-000000000004') where external_entitlement_id='natural-original'), 'quarantine still grants');

-- Reverse temporal order also deterministically resolves to verified expired.
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000004','production','reverse-expired-fact','reverse-original',
  now(),date_trunc('second',now()),'expired',false,
  'com.cipmusic.aurasounds.premium.monthly.v2',now()-interval '1 second',true,'restore',false,
  null,null,null,'recorded','reverse-current'
);
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000004','production','reverse-active-fact','reverse-original',
  now()+interval '1 second',(select transaction_evidence_signed_at from public.app_store_entitlements where original_transaction_id='reverse-original'),
  'active',true,'com.cipmusic.aurasounds.premium.monthly.v2',
  (select expires_at from public.app_store_entitlements where original_transaction_id='reverse-original'),true,'restore',false,
  null,null,null,'recorded','reverse-current'
);
select test_assert.ok((select current_state_quality='verified' and normalized_status='expired'
  and not source_grants_premium and conflicting_status_fingerprint is null
  from public.app_store_entitlements where original_transaction_id='reverse-original'), 'reverse expiry was not deterministic');
select test_assert.ok((select not currently_grants_premium from public.billing_get_current_entitlement_status(
  '10000000-0000-4000-8000-000000000004') where external_entitlement_id='reverse-original'), 'reverse quarantine grants');

-- A premature expired observation with the same evidence is contradictory and quarantined.
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000004','production','conflict-a','conflict-original',
  '2026-04-01T00:00:00Z','2026-04-01T00:00:00Z','active',true,
  'com.cipmusic.aurasounds.premium.monthly.v2','2099-04-02T00:00:00Z',true,'purchase',false,
  null,null,null,'recorded','conflict-current'
);
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000004','production','conflict-b','conflict-original',
  '2026-04-01T00:00:01Z','2026-04-01T00:00:00Z',
  'expired',false,'com.cipmusic.aurasounds.premium.monthly.v2',
  '2099-04-02T00:00:00Z',true,'restore',false,
  null,null,null,'recorded','conflict-current'
);
select test_assert.ok((select current_state_quality='quarantined' and normalized_status='unknown'
  and not source_grants_premium and expires_at is null
  from public.app_store_entitlements where original_transaction_id='conflict-original'), 'premature expiry did not quarantine');

-- Caller-selected reconciliation is audit metadata only and cannot unlock equal evidence.
set role service_role;
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000004','production','fake-reconciliation','conflict-original',
  '2026-04-01T00:00:02Z','2026-04-01T00:00:00Z',
  'active',true,'com.cipmusic.aurasounds.premium.monthly.v2','2099-04-02T00:00:00Z',true,'restore',false,
  null,null,null,'recorded','conflict-current',null,'verified',null,'reconciliation'
);
reset role;
select test_assert.ok((select current_state_quality='quarantined' and not source_grants_premium
  from public.app_store_entitlements where original_transaction_id='conflict-original'), 'fake reconciliation unlocked quarantine');

-- Strictly newer transaction evidence resolves through the ordinary verified path.
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000004','production','new-evidence','conflict-original',
  now()+interval '1 day',now()+interval '1 day','active',true,
  'com.cipmusic.aurasounds.premium.monthly.v2',now()+interval '30 days',true,'restore',false,
  null,null,null,'recorded','new-current'
);
select test_assert.ok((select current_state_quality='verified' and source_grants_premium
  from public.app_store_entitlements where original_transaction_id='conflict-original'), 'new transaction evidence did not resolve');

-- Strictly newer renewal evidence independently resolves quarantine.
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000004','production','renewal-a','renewal-original',
  now(),date_trunc('second',now()),'active',true,
  'com.cipmusic.aurasounds.premium.monthly.v2',now()+interval '1 day',true,'purchase',false,
  null,null,null,'recorded','renewal-current',date_trunc('second',now())
);
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000004','production','renewal-b','renewal-original',
  now()+interval '1 second',(select transaction_evidence_signed_at from public.app_store_entitlements where original_transaction_id='renewal-original'),
  'expired',false,'com.cipmusic.aurasounds.premium.monthly.v2',
  (select expires_at from public.app_store_entitlements where original_transaction_id='renewal-original'),true,'restore',false,
  null,null,null,'recorded','renewal-current',
  (select renewal_evidence_signed_at from public.app_store_entitlements where original_transaction_id='renewal-original')
);
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000004','production','renewal-c','renewal-original',
  now()+interval '2 seconds',(select transaction_evidence_signed_at from public.app_store_entitlements where original_transaction_id='renewal-original'),
  'active',true,'com.cipmusic.aurasounds.premium.monthly.v2',now()+interval '30 days',true,'restore',false,
  null,null,null,'recorded','renewal-new-current',
  (select renewal_evidence_signed_at + interval '1 second' from public.app_store_entitlements where original_transaction_id='renewal-original')
);
select test_assert.ok((select current_state_quality='verified' and source_grants_premium
  from public.app_store_entitlements where original_transaction_id='renewal-original'), 'new renewal evidence did not resolve');

-- True conflicts normalize current and billing projections independently of A/B order.
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000004','production','order-a1','order-one','2026-06-01T00:00:00Z','2026-06-01T00:00:00Z',
  'active',true,'com.cipmusic.aurasounds.premium.yearly.v2','2099-06-02T00:00:00Z',true,'purchase',false,
  null,null,null,'recorded','z-current'
);
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000004','production','order-b1','order-one','2026-06-01T00:00:01Z',
  '2026-06-01T00:00:00Z','revoked',false,'com.cipmusic.aurasounds.premium.monthly.v2','2099-06-02T00:00:00Z',true,'restore',false,
  null,null,null,'recorded','a-current'
);
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000004','production','order-b2','order-two','2026-06-01T00:00:00Z','2026-06-01T00:00:00Z',
  'revoked',false,'com.cipmusic.aurasounds.premium.monthly.v2','2099-06-02T00:00:00Z',true,'purchase',false,
  null,null,null,'recorded','a-current'
);
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000004','production','order-a2','order-two','2026-06-01T00:00:01Z',
  '2026-06-01T00:00:00Z','active',true,'com.cipmusic.aurasounds.premium.yearly.v2','2099-06-02T00:00:00Z',true,'restore',false,
  null,null,null,'recorded','z-current'
);
select test_assert.ok((select bool_and(current_state_quality='quarantined' and normalized_status='unknown'
  and not source_grants_premium and expires_at is null and product_id='com.cipmusic.aurasounds.premium.monthly.v2'
  and latest_transaction_id='a-current' and status_fingerprint < conflicting_status_fingerprint)
  from public.app_store_entitlements where original_transaction_id in ('order-one','order-two')), 'order-independent entitlement normalization failed');
select test_assert.ok((select count(*)=2 and bool_and(status='unknown' and not source_grants_premium
  and current_state_quality='quarantined' and valid_until is null
  and product_id='com.cipmusic.aurasounds.premium.monthly.v2')
  from public.billing_entitlements_v2 where external_entitlement_id in ('order-one','order-two')), 'order-independent billing projection failed');
select test_assert.ok((
  select jsonb_build_object(
    'quality', a.current_state_quality, 'status', a.normalized_status, 'grant', a.source_grants_premium,
    'expiry', a.expires_at, 'product', a.product_id, 'latest_tx', a.latest_transaction_id,
    'tx_evidence', a.transaction_evidence_signed_at, 'renewal_evidence', a.renewal_evidence_signed_at,
    'auto_renew', a.auto_renew
  ) = jsonb_build_object(
    'quality', b.current_state_quality, 'status', b.normalized_status, 'grant', b.source_grants_premium,
    'expiry', b.expires_at, 'product', b.product_id, 'latest_tx', b.latest_transaction_id,
    'tx_evidence', b.transaction_evidence_signed_at, 'renewal_evidence', b.renewal_evidence_signed_at,
    'auto_renew', b.auto_renew
  ) from public.app_store_entitlements a cross join public.app_store_entitlements b
  where a.original_transaction_id='order-one' and b.original_transaction_id='order-two'
), 'A/B entitlement business fields differ by order');
select test_assert.ok((
  select jsonb_build_object(
    'source', a.source, 'environment', a.source_environment, 'plan', a.plan, 'product', a.product_id,
    'status', a.status, 'validity', a.validity, 'valid_until', a.valid_until, 'grant', a.source_grants_premium,
    'quality', a.current_state_quality, 'source_version', a.source_version_at
  ) = jsonb_build_object(
    'source', b.source, 'environment', b.source_environment, 'plan', b.plan, 'product', b.product_id,
    'status', b.status, 'validity', b.validity, 'valid_until', b.valid_until, 'grant', b.source_grants_premium,
    'quality', b.current_state_quality, 'source_version', b.source_version_at
  ) from public.billing_entitlements_v2 a cross join public.billing_entitlements_v2 b
  where a.external_entitlement_id='order-one' and b.external_entitlement_id='order-two'
), 'A/B billing business fields differ by order');

-- A latest revoked unclaimed chain cannot be claimed by replaying an older transaction.
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000002','production','revoked-current','revoked-original',
  now(),now(),'revoked',false,'com.cipmusic.aurasounds.premium.monthly.v2',now(),false,'restore'
);
do $$ begin
  begin
    perform * from test_assert.record_tx(
      '10000000-0000-4000-8000-000000000002','production','older-active-claim','revoked-original',
      now()-interval '10 days',now()-interval '1 day','active',true,
      'com.cipmusic.aurasounds.premium.monthly.v2',now()+interval '1 day',false,'legacy_claim',true);
    raise exception 'ASSERTION_FAILED: older active status claimed newer revoked chain';
  exception when invalid_parameter_value then
    perform test_assert.ok(sqlerrm='LEGACY_CLAIM_NOT_ALLOWED','wrong stale legacy status error');
  end;
end $$;
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000002','production','older-active-fact','revoked-original',
  now()-interval '10 days',
  (select transaction_evidence_signed_at from public.app_store_entitlements where original_transaction_id='revoked-original'),
  'revoked',false,'com.cipmusic.aurasounds.premium.monthly.v2',
  (select expires_at from public.app_store_entitlements where original_transaction_id='revoked-original'),
  false,'restore',false,null,
  (select status_fingerprint from public.app_store_entitlements where original_transaction_id='revoked-original'),
  null,'recorded','revoked-current'
);
select test_assert.ok((select normalized_status='revoked' and not source_grants_premium and binding_state='unclaimed'
  from public.app_store_entitlements where original_transaction_id='revoked-original'), 'old transaction changed revoked projection');
select test_assert.ok(not exists(select 1 from public.billing_entitlements_v2 where external_entitlement_id='revoked-original'), 'revoked chain projected billing grant');

-- Same IDs are isolated by environment; sandbox cannot grant.
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000002','sandbox','tx-001','original-001',
  now(),now(),'active',false,'com.cipmusic.aurasounds.premium.monthly.v2',now()+interval '1 day',false,'restore'
);
select test_assert.ok((select count(*)=2 from public.app_store_entitlements where original_transaction_id='original-001'), 'environment isolation');
do $$ begin
  begin
    update public.app_store_entitlements set source_grants_premium=true where environment='sandbox' and original_transaction_id='original-001';
    raise exception 'ASSERTION_FAILED: sandbox grant check absent';
  exception when check_violation then null; end;
end $$;

-- The three-column FK rejects cross-chain entitlement references.
do $$
declare v_wrong uuid;
begin
  select id into v_wrong from public.app_store_entitlements where original_transaction_id='natural-original';
  begin
    insert into public.app_store_transactions(
      entitlement_id,environment,transaction_id,original_transaction_id,product_id,
      subscription_group_id,signed_date,transaction_status,summary_hash
    ) values (
      v_wrong,'production','fk-mismatch','original-001','com.cipmusic.aurasounds.premium.monthly.v2',
      '22099193',now(),'recorded',repeat('8',64)
    );
    raise exception 'ASSERTION_FAILED: composite FK mismatch succeeded';
  exception when foreign_key_violation then null; end;
end $$;

-- Notification inbox behavior.
select * from public.billing_record_app_store_notification('production','production','20000000-0000-4000-8000-000000000001','DID_RENEW',null,now(),'original-001','tx-new',repeat('a',64));
select * from public.billing_record_app_store_notification('production','production','20000000-0000-4000-8000-000000000001','DID_RENEW',null,now(),'original-001','tx-new',repeat('a',64));
select test_assert.ok((select attempt_count=2 from public.app_store_notification_events where notification_uuid='20000000-0000-4000-8000-000000000001'), 'notification idempotency');
do $$ begin
  begin
    perform * from public.billing_record_app_store_notification('production','production','20000000-0000-4000-8000-000000000001','DID_RENEW',null,now(),'original-001','tx-new',repeat('b',64));
    raise exception 'ASSERTION_FAILED: notification replay mismatch succeeded';
  exception when unique_violation then null; end;
end $$;
select * from public.billing_record_app_store_notification('sandbox','sandbox','20000000-0000-4000-8000-000000000001','UNKNOWN_FUTURE',null,now(),null,null,repeat('c',64));
select test_assert.ok((select processing_status='ignored_unknown' from public.app_store_notification_events where environment='sandbox' and notification_uuid='20000000-0000-4000-8000-000000000001'), 'unknown notification');
select * from public.billing_record_app_store_notification('production','production','20000000-0000-4000-8000-000000000002','DID_RENEW',null,now(),null,null,repeat('d',64));
select test_assert.ok((select processing_status='orphan' from public.app_store_notification_events where notification_uuid='20000000-0000-4000-8000-000000000002'), 'orphan notification');

-- Deletion prepare, idempotency, raw UUID removal, and ON DELETE RESTRICT.
do $$ begin
  begin
    delete from auth.users where id='10000000-0000-4000-8000-000000000001';
    raise exception 'ASSERTION_FAILED: unprepared auth deletion succeeded';
  exception when foreign_key_violation then null; end;
end $$;
select * from public.billing_prepare_account_deletion('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
select * from public.billing_prepare_account_deletion('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
select test_assert.ok((select status='prepared' and user_id is null and apple_entitlements_processed=1 from public.billing_account_deletion_requests where request_id='30000000-0000-4000-8000-000000000001'), 'deletion request');
select test_assert.ok((select binding_state='account_deleted' and user_id is null and claimed_at is not null from public.app_store_entitlements where environment='production' and original_transaction_id='original-001'), 'account_deleted shape');
select test_assert.ok((select count(*)=1 from public.app_store_binding_tombstones where environment='production' and original_transaction_id='original-001'), 'tombstone missing');
select test_assert.ok((select count(*)=0 from public.billing_entitlements_v2 where user_id='10000000-0000-4000-8000-000000000001' and source='apple'), 'apple grant remains');
delete from auth.users where id='10000000-0000-4000-8000-000000000001';

select * from public.billing_prepare_account_deletion('10000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000005');
select test_assert.ok((select apple_entitlements_processed=0 and user_id is null from public.billing_account_deletion_requests where request_id='30000000-0000-4000-8000-000000000005'), 'zero-entitlement prepare');
do $$ begin
  begin
    perform * from public.billing_prepare_account_deletion('10000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000005');
    raise exception 'ASSERTION_FAILED: request id reused for another user';
  exception when invalid_parameter_value then
    perform test_assert.ok(sqlerrm='DELETION_REQUEST_USER_MISMATCH','wrong deletion reuse error');
  end;
end $$;
delete from auth.users where id='10000000-0000-4000-8000-000000000005';

-- Prepare rollback on injected failure.
select * from test_assert.record_tx(
  '10000000-0000-4000-8000-000000000003','production','tx-rollback','original-rollback',
  now(),now(),'active',true
);
create function test_assert.reject_account_deleted() returns trigger language plpgsql as $$
begin if new.binding_state='account_deleted' then raise exception 'INJECTED_PREPARE_FAILURE'; end if; return new; end $$;
create trigger reject_account_deleted before update on public.app_store_entitlements for each row execute function test_assert.reject_account_deleted();
do $$ begin
  begin
    perform * from public.billing_prepare_account_deletion('10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003');
    raise exception 'ASSERTION_FAILED: injected prepare succeeded';
  exception when others then
    perform test_assert.ok(sqlerrm='INJECTED_PREPARE_FAILURE','wrong injected failure');
  end;
end $$;
drop trigger reject_account_deleted on public.app_store_entitlements;
drop function test_assert.reject_account_deleted();
select test_assert.ok((select binding_state='claimed' from public.app_store_entitlements where original_transaction_id='original-rollback'), 'prepare rollback failed');
select test_assert.ok(not exists(select 1 from public.billing_account_deletion_requests where request_id='30000000-0000-4000-8000-000000000003'), 'failed request persisted');

-- Tombstone blocks future claim.
select * from public.billing_prepare_account_deletion('10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000004');
do $$ begin
  begin
    perform * from test_assert.record_tx(
      '10000000-0000-4000-8000-000000000003','production','tx-after-delete','original-rollback',
      now()+interval '1 day',now()+interval '1 day','active',true);
    raise exception 'ASSERTION_FAILED: tombstone claim succeeded';
  exception when unique_violation then
    perform test_assert.ok(sqlerrm='APP_STORE_BINDING_TOMBSTONED','wrong tombstone error');
  end;
end $$;

-- No raw UUID text or UUID bytes remain after deletion preparation.
select test_assert.ok(not exists (
  select 1 from public.app_store_entitlements e
  where row_to_json(e)::text like '%10000000-0000-4000-8000-000000000003%'
), 'raw UUID remains in entitlement');
select test_assert.ok(not exists (
  select 1 from public.app_store_transactions t
  where row_to_json(t)::text like '%10000000-0000-4000-8000-000000000003%'
), 'raw UUID remains in transaction');
select test_assert.ok(not exists (
  select 1 from public.app_store_binding_tombstones t
  where row_to_json(t)::text like '%10000000-0000-4000-8000-000000000003%'
), 'raw UUID remains in tombstone');
select test_assert.ok(not exists (
  select 1 from public.billing_account_deletion_requests r
  where row_to_json(r)::text like '%10000000-0000-4000-8000-000000000003%'
), 'raw UUID remains in deletion request');
select test_assert.ok(not exists (
  select 1 from public.app_store_entitlements e
  where e.user_id='10000000-0000-4000-8000-000000000003'
     or encode(uuid_send(e.user_id),'hex')=replace('10000000-0000-4000-8000-000000000003','-','')
), 'raw UUID binary remains in entitlement');
select test_assert.ok(not exists (
  select 1 from public.billing_account_deletion_requests r
  where r.user_id='10000000-0000-4000-8000-000000000003'
     or encode(uuid_send(r.user_id),'hex')=replace('10000000-0000-4000-8000-000000000003','-','')
), 'raw UUID binary remains in deletion request');

select test_assert.ok((select count(*)=0 from public.user_membership), 'membership write detected');
