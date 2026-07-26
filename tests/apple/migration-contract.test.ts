import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql = readFileSync('supabase/migrations/20260722010000_apple_entitlement_ledger_phase_1a.sql', 'utf8');
const aggregateSql = readFileSync('supabase/migrations/20260723090000_apple_membership_aggregate_read.sql', 'utf8');
const recoverySql = readFileSync('supabase/migrations/20260726190000_claim_verified_unclaimed_apple_entitlement.sql', 'utf8');
const resignedJwsRecoverySql = readFileSync('supabase/migrations/20260726210000_allow_resigned_jws_unclaimed_recovery.sql', 'utf8');
const readMembership = readFileSync('netlify/functions/read-membership.ts', 'utf8');
const currentMembershipReader = readFileSync('netlify/functions/_shared/read-current-membership.ts', 'utf8');
const sceneAssetUrl = readFileSync('netlify/functions/scene-asset-url.ts', 'utf8');

test('migration contains required ledgers and no user_membership write', () => {
  assert.match(sql, /^--[\s\S]*\nbegin;/i);
  assert.match(sql, /commit;\s*$/i);
  for (const name of ['app_store_entitlements', 'app_store_transactions', 'app_store_notification_events',
    'app_store_binding_tombstones', 'billing_entitlements_v2', 'billing_account_deletion_requests',
    'billing_account_deletion_fences', 'billing_runtime_controls']) assert.match(sql, new RegExp(`create table public\\.${name}`));
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

test('unclaimed recovery RPC is forward-only, atomic, and service-role-only', () => {
  assert.match(recoverySql, /^begin;/im);
  assert.match(recoverySql, /commit;\s*$/im);
  assert.match(recoverySql, /security definer[\s\S]*set search_path = pg_catalog, public/i);
  assert.match(recoverySql, /p_environment <> 'production'/i);
  assert.match(recoverySql, /binding_state = 'unclaimed'[\s\S]*user_id is null[\s\S]*app_account_token_hash is null/i);
  assert.match(recoverySql, /for update/i);
  assert.match(recoverySql, /APP_STORE_ALREADY_BOUND/);
  assert.match(recoverySql, /TRANSACTION_REPLAY_MISMATCH/);
  assert.match(recoverySql, /v_tx\.summary_hash <> p_summary_hash/i);
  assert.match(recoverySql, /insert into public\.billing_entitlements_v2/i);
  assert.match(recoverySql, /revoke all on function public\.billing_claim_verified_unclaimed_app_store_entitlement[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(recoverySql, /public\.user_membership/i);
  assert.doesNotMatch(recoverySql, /update\s+public\.billing_runtime_controls/i);
});

test('re-signed JWS recovery only permits a monotonic signing time', () => {
  assert.match(resignedJwsRecoverySql, /^begin;/im);
  assert.match(resignedJwsRecoverySql, /commit;\s*$/im);
  assert.match(resignedJwsRecoverySql, /create or replace function public\.billing_claim_verified_unclaimed_app_store_entitlement/i);
  assert.match(resignedJwsRecoverySql, /p_signed_date < v_tx\.signed_date/i);
  assert.match(resignedJwsRecoverySql, /if p_signed_date > v_tx\.signed_date[\s\S]*signed_date = p_signed_date[\s\S]*summary_hash = p_summary_hash/i);
  assert.match(resignedJwsRecoverySql, /v_tx\.purchase_date is distinct from p_purchase_date/i);
  assert.match(resignedJwsRecoverySql, /v_tx\.expires_date is distinct from p_expires_date/i);
  assert.match(resignedJwsRecoverySql, /v_tx\.transaction_status <> p_transaction_status/i);
  assert.match(resignedJwsRecoverySql, /v_ent\.status_fingerprint <> p_status_fingerprint/i);
  assert.match(resignedJwsRecoverySql, /revoke all on function public\.billing_claim_verified_unclaimed_app_store_entitlement[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(resignedJwsRecoverySql, /public\.user_membership/i);
  assert.doesNotMatch(resignedJwsRecoverySql, /update\s+public\.billing_runtime_controls/i);
});

test('binding, replay, ordering, sandbox and deletion invariants are explicit', () => {
  assert.match(sql, /on delete restrict/i);
  assert.match(sql, /APP_STORE_ALREADY_BOUND/);
  assert.match(sql, /APP_STORE_BINDING_TOMBSTONED/);
  assert.match(sql, /TRANSACTION_CHAIN_MISMATCH/);
  assert.match(sql, /cipmusic:billing:apple:transaction:/);
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
  assert.match(sql, /ACCOUNT_DELETION_FENCED/);
  assert.match(sql, /create table public\.billing_account_deletion_fences/i);
  assert.match(sql, /delete from public\.billing_entitlements_v2[\s\S]*source = 'apple'/i);
});

test('feature defaults are fail closed', () => {
  assert.match(sql, /values \(true, false, false, false, 'off', false\)/);
  assert.equal((sql.match(/APPLE_LEDGER_WRITE_DISABLED/g) ?? []).length, 2);
});

test('membership aggregate exposes only safe current summary to service role', () => {
  assert.match(aggregateSql, /create function public\.billing_get_current_entitlement_summary\(p_user_id uuid\)/i);
  assert.match(aggregateSql, /^begin;/im);
  assert.match(aggregateSql, /commit;\s*$/im);
  assert.match(aggregateSql, /returns table \(environment public\.app_store_environment, currently_grants_premium boolean, valid_until timestamptz\)/i);
  assert.match(aggregateSql, /security definer stable set search_path = pg_catalog, public/i);
  assert.match(aggregateSql, /source_environment = 'production'/i);
  assert.match(aggregateSql, /valid_until > statement_timestamp\(\)/i);
  assert.match(aggregateSql, /revoke all on function public\.billing_get_current_entitlement_summary\(uuid\) from public, anon, authenticated/i);
  assert.match(aggregateSql, /grant execute on function public\.billing_get_current_entitlement_summary\(uuid\) to service_role/i);
  assert.doesNotMatch(aggregateSql, /user_membership/i);
  assert.doesNotMatch(aggregateSql, /transaction_id|signed_transaction|jws/i);
});

test('aggregate follow-up is a separately frozen, ordered rollout set', () => {
  const rollout = readFileSync('docs/apple-membership-aggregate-read-rollout.md', 'utf8');
  assert.match(rollout, /Phase 1A remains frozen and unchanged/);
  assert.match(rollout, /20260722010000[\s\S]*20260723090000/);
  assert.match(rollout, /50a195a0b61a616f07e3cc32d6f7a7ba7d0e521ec2dad55713e0abe0865d580d/);
  assert.match(rollout, /forward fix or the verified complete-backup restore/i);
});

test('read-membership returns only UI membership fields, never Apple evidence', () => {
  assert.match(currentMembershipReader, /select\('premium_until, membership_status, auto_renew, current_period_end'\)/);
  assert.match(currentMembershipReader, /billing_get_current_entitlement_summary/);
  assert.match(readMembership, /readCurrentMembership/);
  assert.match(sceneAssetUrl, /readCurrentMembership/);
  assert.doesNotMatch(
    readMembership + currentMembershipReader,
    /transaction_id|original_transaction|signed_transaction|jws|receipt/i,
  );
});
