import test from 'node:test';
import assert from 'node:assert/strict';
import {writeTransactionLedger} from '../../netlify/functions/_shared/apple/runtime';
import type {CurrentEntitlementStatus, TransactionSummary} from '../../netlify/functions/_shared/apple/types';

const userId = '11111111-1111-4111-8111-111111111111';
const summary: TransactionSummary = {
  environment: 'production', transactionId: 'tx-1', originalTransactionId: 'orig-1',
  productId: 'com.cipmusic.aurasounds.premium.monthly.v2', subscriptionGroupId: '22099193',
  appAccountToken: null, purchaseDate: '2026-07-01T00:00:00.000Z',
  expiresDate: '2026-08-01T00:00:00.000Z', signedDate: '2026-07-01T00:00:01.000Z',
  revocationDate: null, revocationReason: null, transactionReason: 'PURCHASE',
  ownershipType: 'PURCHASED', transactionStatus: 'recorded', summaryHash: 'a'.repeat(64),
};
const current: CurrentEntitlementStatus = {
  environment: 'production', originalTransactionId: 'orig-1', latestTransactionId: 'tx-1',
  productId: summary.productId, subscriptionGroupId: summary.subscriptionGroupId,
  appAccountTokenHash: null, normalizedStatus: 'canceled_active', grantsPremium: true,
  expiresAt: '2026-08-01T00:00:00.000Z', autoRenew: false,
  transactionEvidenceSignedAt: summary.signedDate, renewalEvidenceSignedAt: null,
  statusObservedAt: '2026-07-26T00:00:00.000Z', statusFingerprint: 'b'.repeat(64),
  conflictingStatusFingerprint: null, statusSource: 'server_api_status', currentStateQuality: 'verified',
};

const client = (responses: Array<{data?: unknown; error?: {message: string} | null}>) => {
  const calls: Array<{name: string; args: Record<string, unknown>}> = [];
  return {
    calls,
    supabase: {rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({name, args}); return responses.shift() ?? {data: null, error: {message: 'unexpected'}};
    }} as any,
  };
};

test('verified tokenless restore recovers a pre-existing replay conflict', async () => {
  const fake = client([
    {data: null, error: {message: 'TRANSACTION_REPLAY_MISMATCH'}},
    {data: [{binding_result: 'claimed', transaction_duplicate: true, current_state_quality: 'verified'}], error: null},
  ]);
  const result = await writeTransactionLedger(fake.supabase, userId, 'production', summary, current, 'restore', false);
  assert.deepEqual(result, {bindingResult: 'claimed', duplicate: true, currentStateQuality: 'verified'});
  assert.deepEqual(fake.calls.map(call => call.name), [
    'billing_record_app_store_transaction', 'billing_claim_verified_unclaimed_app_store_entitlement',
  ]);
  assert.equal(fake.calls[1].args.p_user_id, userId);
  assert.equal(fake.calls[1].args.p_app_account_token_hash, null);
  assert.equal(fake.calls[1].args.p_summary_hash, summary.summaryHash);
});

test('purchase replay and token-bearing restore retain ordinary replay protection', async () => {
  for (const [intent, tx, state] of [
    ['purchase', summary, current],
    ['restore', {...summary, appAccountToken: userId}, current],
  ] as const) {
    const fake = client([{data: null, error: {message: 'TRANSACTION_REPLAY_MISMATCH'}}]);
    await assert.rejects(
      writeTransactionLedger(fake.supabase, userId, 'production', tx, state, intent, false),
      (error: any) => error?.code === 'TRANSACTION_REPLAY_CONFLICT',
    );
    assert.equal(fake.calls.length, 1);
  }
});

test('duplicate unclaimed restore uses recovery while a first insert remains unclaimed', async () => {
  const first = client([{data: [{binding_result: 'unclaimed', transaction_duplicate: false, current_state_quality: 'verified'}], error: null}]);
  assert.equal((await writeTransactionLedger(first.supabase, userId, 'production', summary, current, 'restore', false)).bindingResult, 'unclaimed');
  assert.equal(first.calls.length, 1);

  const duplicate = client([
    {data: [{binding_result: 'unclaimed', transaction_duplicate: true, current_state_quality: 'verified'}], error: null},
    {data: [{binding_result: 'already_claimed', transaction_duplicate: true, current_state_quality: 'verified'}], error: null},
  ]);
  assert.equal((await writeTransactionLedger(duplicate.supabase, userId, 'production', summary, current, 'restore', false)).bindingResult, 'already_claimed');
  assert.equal(duplicate.calls.length, 2);
});
