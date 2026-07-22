#!/usr/bin/env bash
set -euo pipefail

: "${PSQL:?PSQL is required}"
: "${APPLE_PG_URL:?APPLE_PG_URL is required}"
: "${APPLE_PG_LOG_DIR:?APPLE_PG_LOG_DIR is required}"

run_psql() { "$PSQL" "$APPLE_PG_URL" -X -v ON_ERROR_STOP=1 "$@"; }

run_psql -q <<'SQL'
insert into auth.users(id) values
 ('40000000-0000-4000-8000-000000000001'),
 ('40000000-0000-4000-8000-000000000002'),
 ('40000000-0000-4000-8000-000000000003'),
 ('40000000-0000-4000-8000-000000000004');
SQL

first_log="$APPLE_PG_LOG_DIR/concurrency-first.log"
second_log="$APPLE_PG_LOG_DIR/concurrency-second.log"

run_psql -q >"$first_log" 2>&1 <<'SQL' &
begin;
select * from test_assert.record_tx(
 '40000000-0000-4000-8000-000000000001','production','concurrent-tx-a','concurrent-original',
 now(),now(),'active',true,'com.cipmusic.aurasounds.premium.monthly.v2',null,false,'legacy_claim',true);
select pg_sleep(1);
commit;
SQL
first_pid=$!

sleep 0.15
set +e
run_psql -q >"$second_log" 2>&1 <<'SQL'
select * from test_assert.record_tx(
 '40000000-0000-4000-8000-000000000002','production','concurrent-tx-b','concurrent-original',
 now()+interval '1 second',now()+interval '1 second','active',true,'com.cipmusic.aurasounds.premium.monthly.v2',null,false,'legacy_claim',true);
SQL
second_rc=$?
set -e
wait "$first_pid"

if [[ "$second_rc" -eq 0 ]] || ! grep -q 'APP_STORE_ALREADY_BOUND' "$second_log"; then
  echo "Concurrent cross-user claim did not fail deterministically; logs: $APPLE_PG_LOG_DIR" >&2
  exit 1
fi

run_psql -q <<'SQL'
select test_assert.ok(
  (select user_id='40000000-0000-4000-8000-000000000001' and binding_state='claimed'
   from public.app_store_entitlements where environment='production' and original_transaction_id='concurrent-original'),
  'concurrent winner mismatch'
);
select test_assert.ok(
  not exists(select 1 from public.app_store_transactions where transaction_id='concurrent-tx-b'),
  'losing concurrent transaction persisted'
);
SQL

# Independent subscription chains for the same user must not share an advisory lock.
run_psql -q >"$APPLE_PG_LOG_DIR/concurrency-independent-a.log" 2>&1 <<'SQL' &
select * from test_assert.record_tx(
 '40000000-0000-4000-8000-000000000001','production','independent-a','independent-original-a',
 now(),now(),'active',true);
SQL
pid_a=$!
run_psql -q >"$APPLE_PG_LOG_DIR/concurrency-independent-b.log" 2>&1 <<'SQL' &
select * from test_assert.record_tx(
 '40000000-0000-4000-8000-000000000001','production','independent-b','independent-original-b',
 now(),now(),'active',true);
SQL
pid_b=$!
wait "$pid_a" "$pid_b"

run_psql -q <<'SQL'
select test_assert.ok(
  (select count(*)=2 from public.app_store_entitlements where original_transaction_id in ('independent-original-a','independent-original-b')),
  'independent concurrent writes failed'
);
select test_assert.ok(
  hashtextextended('cipmusic:billing:apple:original:x',0) <>
  hashtextextended('cipmusic:billing:apple:notification:x',0),
  'advisory namespaces collided in fixture'
);
SQL

# Same-user duplicate calls serialize and produce one transaction row.
run_psql -q >"$APPLE_PG_LOG_DIR/concurrency-idempotent-a.log" 2>&1 <<'SQL' &
begin;
select * from test_assert.record_tx(
 '40000000-0000-4000-8000-000000000001','production','same-user-tx','same-user-original',
 '2026-01-01T00:00:01Z','2026-01-01T00:00:01Z','expired',false);
select pg_sleep(1);
commit;
SQL
same_pid=$!
sleep 0.15
run_psql -q >"$APPLE_PG_LOG_DIR/concurrency-idempotent-b.log" 2>&1 <<'SQL'
select * from test_assert.record_tx(
 '40000000-0000-4000-8000-000000000001','production','same-user-tx','same-user-original',
 '2026-01-01T00:00:01Z','2026-01-01T00:00:01Z','expired',false);
SQL
wait "$same_pid"
run_psql -q -c "select test_assert.ok((select count(*)=1 from public.app_store_transactions where transaction_id='same-user-tx'),'same-user duplicate transaction');"

# Transaction and notification inbox writes may proceed concurrently.
run_psql -q >"$APPLE_PG_LOG_DIR/concurrency-transaction.log" 2>&1 <<'SQL' &
select * from test_assert.record_tx(
 '40000000-0000-4000-8000-000000000001','production','tx-with-notification','original-with-notification',
 now(),now(),'active',true);
SQL
tx_pid=$!
run_psql -q >"$APPLE_PG_LOG_DIR/concurrency-notification.log" 2>&1 <<'SQL' &
select * from public.billing_record_app_store_notification(
 'production','production','40000000-0000-4000-8000-000000000010','DID_RENEW',null,now(),
 'original-with-notification','tx-with-notification',repeat('7',64));
SQL
notification_pid=$!
wait "$tx_pid" "$notification_pid"
run_psql -q -c "select test_assert.ok(exists(select 1 from public.app_store_transactions where transaction_id='tx-with-notification') and exists(select 1 from public.app_store_notification_events where notification_uuid='40000000-0000-4000-8000-000000000010'),'transaction-notification concurrency');"

# Account deletion and renewal cannot leave a renewed grant after deletion commits.
run_psql -q <<'SQL'
select * from test_assert.record_tx(
 '40000000-0000-4000-8000-000000000003','production','delete-race-initial','delete-race-original',
 now(),now(),'active',true);
SQL
run_psql -q >"$APPLE_PG_LOG_DIR/concurrency-delete.log" 2>&1 <<'SQL' &
begin;
select * from public.billing_prepare_account_deletion('40000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000020');
select pg_sleep(1);
commit;
SQL
delete_pid=$!
sleep 0.15
set +e
run_psql -q >"$APPLE_PG_LOG_DIR/concurrency-delete-claim.log" 2>&1 <<'SQL'
select * from test_assert.record_tx(
 '40000000-0000-4000-8000-000000000003','production','delete-race-renewal','delete-race-original',
 now()+interval '1 second',now()+interval '1 second','active',true);
SQL
delete_claim_rc=$?
set -e
wait "$delete_pid"
if [[ "$delete_claim_rc" -eq 0 ]] || ! grep -Eq 'APP_STORE_BINDING_(TOMBSTONED|BLOCKED)' "$APPLE_PG_LOG_DIR/concurrency-delete-claim.log"; then
  echo "Deletion/claim race was not blocked; logs: $APPLE_PG_LOG_DIR" >&2
  exit 1
fi
run_psql -q <<'SQL'
select test_assert.ok(
 (select binding_state='account_deleted' and user_id is null and grants_premium=false from public.app_store_entitlements where original_transaction_id='delete-race-original')
 and not exists(select 1 from public.billing_entitlements_v2 where external_entitlement_id='delete-race-original'),
 'deletion race final state'
);
SQL

# Deletion preparation and notification inbox insertion remain atomic and independent.
run_psql -q <<'SQL'
select * from test_assert.record_tx(
 '40000000-0000-4000-8000-000000000004','production','delete-notification-initial','delete-notification-original',
 now(),now(),'active',true);
SQL
run_psql -q >"$APPLE_PG_LOG_DIR/concurrency-delete-notification-delete.log" 2>&1 <<'SQL' &
begin;
select * from public.billing_prepare_account_deletion(
 '40000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000030');
select pg_sleep(1);
commit;
SQL
delete_notification_pid=$!
sleep 0.15
run_psql -q >"$APPLE_PG_LOG_DIR/concurrency-delete-notification-inbox.log" 2>&1 <<'SQL'
select * from public.billing_record_app_store_notification(
 'production','production','40000000-0000-4000-8000-000000000031','DID_RENEW',null,now(),
 'delete-notification-original','delete-notification-initial',repeat('a',64));
SQL
wait "$delete_notification_pid"
run_psql -q <<'SQL'
select test_assert.ok(
 (select binding_state='account_deleted' and user_id is null from public.app_store_entitlements
  where original_transaction_id='delete-notification-original')
 and exists(select 1 from public.app_store_notification_events
  where notification_uuid='40000000-0000-4000-8000-000000000031'),
 'deletion-notification concurrency'
);
SQL

echo "Concurrency checks passed"
