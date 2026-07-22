\set ON_ERROR_STOP on

create schema test_assert;
create function test_assert.ok(value boolean, message text)
returns void language plpgsql as $$
begin
  if value is not true then raise exception 'ASSERTION_FAILED: %', message; end if;
end $$;

select test_assert.ok(to_regprocedure('extensions.digest(text,text)') is not null, 'extensions.digest signature');
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

do $$
declare fn record;
begin
  for fn in
    select p.oid, p.proname, p.prosecdef, p.proconfig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'billing_get_runtime_controls','billing_record_app_store_transaction',
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

set role service_role;
do $$ begin
  perform * from public.billing_get_runtime_controls();
  begin
    perform * from public.billing_record_app_store_transaction(
      null,'production','production','flags-tx','flags-original',
      'com.cipmusic.aurasounds.premium.monthly.v2','22099193',null,null,now()+interval '1 day',now(),null,null,null,null,'active',true,true,
      repeat('0',64),false
    );
    raise exception 'ASSERTION_FAILED: ledger fail-open';
  exception when sqlstate '55000' then null; end;
end $$;
reset role;

update public.billing_runtime_controls set apple_verification_enabled=true, apple_ledger_write_enabled=true;

-- First unclaimed, then claim, then same-user idempotency.
select * from public.billing_record_app_store_transaction(
  null,'production','production','tx-001','original-001',
  'com.cipmusic.aurasounds.premium.monthly.v2','22099193',null,
  now(),now()+interval '30 days',clock_timestamp(),null,null,'PURCHASED','PURCHASED','active',true,true,repeat('1',64),false
);
select test_assert.ok((select binding_state='unclaimed' and user_id is null from public.app_store_entitlements where original_transaction_id='original-001'), 'first unclaimed');

select * from public.billing_record_app_store_transaction(
  '10000000-0000-4000-8000-000000000001','production','production','tx-002','original-001',
  'com.cipmusic.aurasounds.premium.monthly.v2','22099193','10000000-0000-4000-8000-000000000001',
  now(),now()+interval '31 days',clock_timestamp()+interval '1 second',null,null,'PURCHASED','PURCHASED','active',true,true,repeat('2',64),false
);
select test_assert.ok((select binding_state='claimed' and user_id='10000000-0000-4000-8000-000000000001' from public.app_store_entitlements where original_transaction_id='original-001'), 'claim failed');
select * from public.billing_record_app_store_transaction(
  '10000000-0000-4000-8000-000000000001','production','production','tx-002','original-001',
  'com.cipmusic.aurasounds.premium.monthly.v2','22099193','10000000-0000-4000-8000-000000000001',
  now(),now()+interval '31 days',clock_timestamp()+interval '1 second',null,null,'PURCHASED','PURCHASED','active',true,true,repeat('2',64),false
);

do $$ begin
  begin
    perform * from public.billing_record_app_store_transaction(
      '10000000-0000-4000-8000-000000000002','production','production','tx-conflict','original-001',
      'com.cipmusic.aurasounds.premium.monthly.v2','22099193','10000000-0000-4000-8000-000000000002',null,now()+interval '1 day',clock_timestamp()+interval '2 seconds',null,null,null,null,'active',true,true,repeat('3',64),false);
    raise exception 'ASSERTION_FAILED: cross-user claim succeeded';
  exception when unique_violation then
    perform test_assert.ok(sqlerrm='APP_STORE_ALREADY_BOUND','wrong binding error');
  end;
  begin
    perform * from public.billing_record_app_store_transaction(
      '10000000-0000-4000-8000-000000000001','production','production','tx-002','original-001',
      'com.cipmusic.aurasounds.premium.monthly.v2','22099193','10000000-0000-4000-8000-000000000001',null,now()+interval '1 day',clock_timestamp()+interval '3 seconds',null,null,null,null,'active',true,true,repeat('9',64),false);
    raise exception 'ASSERTION_FAILED: replay mismatch succeeded';
  exception when unique_violation then
    perform test_assert.ok(sqlerrm='TRANSACTION_REPLAY_MISMATCH','wrong replay error');
  end;
  begin
    perform * from public.billing_record_app_store_transaction(
      '10000000-0000-4000-8000-000000000001','production','production','bad-token','original-token',
      'com.cipmusic.aurasounds.premium.monthly.v2','22099193','10000000-0000-4000-8000-000000000002',null,now()+interval '1 day',now(),null,null,null,null,'active',true,true,repeat('4',64),false);
    raise exception 'ASSERTION_FAILED: token mismatch succeeded';
  exception when invalid_parameter_value then
    perform test_assert.ok(sqlerrm='APP_ACCOUNT_TOKEN_MISMATCH','wrong token error');
  end;
end $$;

-- Newer state wins; older event is ledger-only.
select * from public.billing_record_app_store_transaction(
  '10000000-0000-4000-8000-000000000001','production','production','tx-new','original-001',
  'com.cipmusic.aurasounds.premium.yearly.v2','22099193','10000000-0000-4000-8000-000000000001',null,now()+interval '365 days',now()+interval '10 seconds',null,null,null,null,'active',true,true,repeat('5',64),false
);
select * from public.billing_record_app_store_transaction(
  '10000000-0000-4000-8000-000000000001','production','production','tx-old','original-001',
  'com.cipmusic.aurasounds.premium.monthly.v2','22099193','10000000-0000-4000-8000-000000000001',null,now()+interval '2 days',now()-interval '1 day',null,null,null,null,'expired',false,false,repeat('6',64),false
);
select test_assert.ok((select latest_transaction_id='tx-new' and normalized_status='active' from public.app_store_entitlements where original_transaction_id='original-001'), 'old state overwrote new');

-- Same IDs are isolated by environment; sandbox cannot grant.
select * from public.billing_record_app_store_transaction(
  null,'sandbox','sandbox','tx-001','original-001',
  'com.cipmusic.aurasounds.premium.monthly.v2','22099193',null,null,now()+interval '1 day',now(),null,null,null,null,'active',false,true,repeat('7',64),false
);
select test_assert.ok((select count(*)=2 from public.app_store_entitlements where original_transaction_id='original-001'), 'environment isolation');
do $$ begin
  begin
    update public.app_store_entitlements set grants_premium=true where environment='sandbox' and original_transaction_id='original-001';
    raise exception 'ASSERTION_FAILED: sandbox grant check absent';
  exception when check_violation then null; end;
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
select * from public.billing_record_app_store_transaction(
  '10000000-0000-4000-8000-000000000003','production','production','tx-rollback','original-rollback',
  'com.cipmusic.aurasounds.premium.monthly.v2','22099193','10000000-0000-4000-8000-000000000003',null,now()+interval '1 day',now(),null,null,null,null,'active',true,true,repeat('e',64),false
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
    perform * from public.billing_record_app_store_transaction(
      '10000000-0000-4000-8000-000000000003','production','production','tx-after-delete','original-rollback',
      'com.cipmusic.aurasounds.premium.monthly.v2','22099193','10000000-0000-4000-8000-000000000003',null,now()+interval '1 day',now()+interval '1 day',null,null,null,null,'active',true,true,repeat('f',64),false);
    raise exception 'ASSERTION_FAILED: tombstone claim succeeded';
  exception when unique_violation then
    perform test_assert.ok(sqlerrm='APP_STORE_BINDING_TOMBSTONED','wrong tombstone error');
  end;
end $$;

select test_assert.ok((select count(*)=0 from public.user_membership), 'membership write detected');
