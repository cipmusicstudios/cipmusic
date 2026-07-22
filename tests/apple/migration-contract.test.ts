import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql = readFileSync('supabase/migrations/20260722010000_apple_entitlement_ledger_phase_1a.sql', 'utf8');

test('migration contains required ledgers and no user_membership write', () => {
  assert.match(sql, /^--[\s\S]*\nbegin;/i);
  assert.match(sql, /commit;\s*$/i);
  for (const name of ['app_store_entitlements', 'app_store_transactions', 'app_store_notification_events',
    'app_store_binding_tombstones', 'billing_entitlements_v2', 'billing_account_deletion_requests',
    'billing_runtime_controls']) assert.match(sql, new RegExp(`create table public\\.${name}`));
  assert.doesNotMatch(sql, /(insert\s+into|update|delete\s+from)\s+public\.user_membership/i);
  assert.doesNotMatch(sql, /revoke all on all tables in schema public/i);
});

test('security definer functions are locked down and search_path fixed', () => {
  const definerCount = (sql.match(/security definer/gi) ?? []).length;
  const pathCount = (sql.match(/set search_path = pg_catalog, public/gi) ?? []).length;
  assert.ok(definerCount >= 4); assert.ok(pathCount >= definerCount);
  for (const fn of ['billing_get_runtime_controls', 'billing_record_app_store_transaction',
    'billing_record_app_store_notification', 'billing_prepare_account_deletion']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}`));
  }
  assert.match(sql, /revoke all on public\.app_store_entitlements from service_role/i);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete)[^;]+ to service_role/i);
});

test('binding, replay, ordering, sandbox and deletion invariants are explicit', () => {
  assert.match(sql, /on delete restrict/i);
  assert.match(sql, /APP_STORE_ALREADY_BOUND/);
  assert.match(sql, /APP_STORE_BINDING_TOMBSTONED/);
  assert.match(sql, /on conflict \(environment, transaction_id\) do nothing/i);
  assert.match(sql, /NOTIFICATION_REPLAY_MISMATCH/);
  assert.match(sql, /then 'ignored_unknown'/);
  assert.match(sql, /then 'orphan'/);
  assert.match(sql, /transaction_evidence_signed_at/i);
  assert.match(sql, /renewal_evidence_signed_at/i);
  assert.match(sql, /status_observed_at/i);
  assert.match(sql, /status_fingerprint/i);
  assert.match(sql, /current_state_quality = 'quarantined'/i);
  assert.match(sql, /SANDBOX_PRODUCTION_GRANT_FORBIDDEN/);
  assert.match(sql, /APP_STORE_PRODUCT_MISMATCH/);
  assert.match(sql, /APP_STORE_SUBSCRIPTION_GROUP_MISMATCH/);
  assert.match(sql, /INVALID_PREMIUM_GRANT/);
  assert.match(sql, /valid_until > statement_timestamp\(\)/i);
  assert.doesNotMatch(sql, /p_current_expires_at <= transaction_timestamp\(\)/i);
  assert.match(sql, /LEGACY_CLAIM_CONFIRMATION_REQUIRED/);
  assert.match(sql, /LEGACY_CLAIM_NOT_ALLOWED/);
  assert.doesNotMatch(sql, /p_allow_legacy_claim/i);
  assert.match(sql, /foreign key \(entitlement_id, environment, original_transaction_id\)/i);
  assert.doesNotMatch(sql, /app_account_token uuid/i);
  assert.match(sql, /app_account_token_hash text/i);
  assert.match(sql, /binding_conflict_hash_low text/i);
  assert.match(sql, /binding_conflict_hash_high text/i);
  assert.match(sql, /binding_conflict_hash_low < binding_conflict_hash_high/i);
  assert.match(sql, /status = 'prepared'/);
  assert.match(sql, /delete from public\.billing_entitlements_v2[\s\S]*source = 'apple'/i);
});

test('feature defaults are fail closed', () => {
  assert.match(sql, /values \(true, false, false, false, 'off', false\)/);
  assert.equal((sql.match(/APPLE_LEDGER_WRITE_DISABLED/g) ?? []).length, 2);
});
