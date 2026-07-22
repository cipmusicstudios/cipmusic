import test from 'node:test';
import assert from 'node:assert/strict';
import {createVerifyHandler} from '../../netlify/functions/_shared/apple/verify-handler';
import type {RuntimeControls} from '../../netlify/functions/_shared/apple/runtime';
import type {CurrentEntitlementStatus} from '../../netlify/functions/_shared/apple/types';
import {AppleServiceError} from '../../netlify/functions/_shared/apple/types';

const userId = '11111111-1111-4111-8111-111111111111';
const fakeSupabase = {} as any;
const event = (body: unknown, auth = true) => ({
  httpMethod: 'POST', body: JSON.stringify(body), headers: auth ? {authorization: 'Bearer test'} : {},
} as any);
const controls = (verification: boolean, ledger = false): RuntimeControls => ({
  appleVerificationEnabled: verification, appleLedgerWriteEnabled: ledger,
  appleMembershipWritebackEnabled: false, aggregateMode: 'off', legacyProtectionEnabled: false,
});
const transaction = (patch: Record<string, unknown> = {}) => ({
  environment: 'Production', bundleId: 'com.cipmusic.aurasounds',
  productId: 'com.cipmusic.aurasounds.premium.monthly.v2', subscriptionGroupIdentifier: '22099193',
  transactionId: 'tx-1', originalTransactionId: 'orig-1', signedDate: Date.now(),
  expiresDate: Date.now() + 86_400_000, ...patch,
});
const verifier = (tx = transaction()) => ({
  verifyTransaction: async () => tx,
  verifyNotification: async () => ({}),
  verifyRenewal: async () => ({}),
});
const current = (patch: Partial<CurrentEntitlementStatus> = {}): CurrentEntitlementStatus => ({
  environment: 'production', originalTransactionId: 'orig-1', latestTransactionId: 'tx-current',
  productId: 'com.cipmusic.aurasounds.premium.monthly.v2', subscriptionGroupId: '22099193',
  appAccountTokenHash: null, normalizedStatus: 'active', grantsPremium: true,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(), autoRenew: true,
  transactionEvidenceSignedAt: new Date().toISOString(), renewalEvidenceSignedAt: null,
  statusObservedAt: new Date().toISOString(), statusFingerprint: 'a'.repeat(64),
  conflictingStatusFingerprint: null, statusSource: 'server_api_status',
  currentStateQuality: 'verified', ...patch,
});
const withEnv = async (fn: () => Promise<void>) => {
  const old = {...process.env};
  Object.assign(process.env, {APP_STORE_ISSUER_ID: 'issuer', APP_STORE_KEY_ID: 'key',
    APP_STORE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----',
    APP_STORE_BUNDLE_ID: 'com.cipmusic.aurasounds', APP_STORE_APP_ID: '6767718789',
    APP_STORE_ENVIRONMENT: 'production'});
  try { await fn(); } finally { process.env = old; }
};

test('CORS preflight exposes the required POST headers', async () => {
  const handler = createVerifyHandler({supabase: fakeSupabase});
  const response = await handler({httpMethod: 'OPTIONS', headers: {}, body: null} as any);
  assert.equal(response.statusCode, 204);
});

test('all flags off calls neither Apple nor ledger', async () => {
  let apple = 0; let writes = 0;
  const handler = createVerifyHandler({supabase: fakeSupabase, authenticate: async () => userId,
    readControls: async () => controls(false), verifier: {...verifier(),
      verifyTransaction: async () => { apple++; return transaction(); }},
    persist: async () => { writes++; return {bindingResult: '', duplicate: false, currentStateQuality: 'verified'}; }});
  const response = await handler(event({signedTransactionInfo: 'a.b.c', claimIntent: 'restore'}));
  assert.equal(response.statusCode, 503); assert.equal(apple, 0); assert.equal(writes, 0);
});

test('invalid JWT is rejected', async () => {
  const handler = createVerifyHandler({supabase: fakeSupabase, authenticate: async () => null});
  assert.equal((await handler(event({transactionId: '1', claimIntent: 'restore'}))).statusCode, 401);
});

test('client userId is rejected before verification', async () => {
  const handler = createVerifyHandler({supabase: fakeSupabase});
  const response = await handler(event({transactionId: '1', claimIntent: 'restore', userId}));
  assert.equal(response.statusCode, 400); assert.match(response.body, /CLIENT_USER_ID_FORBIDDEN/);
});

test('legacy claim requires explicit confirmation', async () => {
  const handler = createVerifyHandler({supabase: fakeSupabase});
  const response = await handler(event({transactionId: '1', claimIntent: 'legacy_claim'}));
  assert.equal(response.statusCode, 400); assert.match(response.body, /LEGACY_CLAIM_CONFIRMATION_REQUIRED/);
});

test('verification-only verifies transaction without claiming current status', async () => withEnv(async () => {
  let currentCalls = 0; let writes = 0;
  const handler = createVerifyHandler({supabase: fakeSupabase, authenticate: async () => userId,
    readControls: async () => controls(true, false), verifier: verifier(),
    currentStatus: {lookupCurrentStatus: async () => { currentCalls++; return current(); }},
    persist: async () => { writes++; return {bindingResult: '', duplicate: false, currentStateQuality: 'verified'}; }});
  const response = await handler(event({signedTransactionInfo: 'jws', claimIntent: 'restore', allowLegacyClaim: true}));
  assert.equal(response.statusCode, 200); assert.match(response.body, /verification-only/);
  assert.equal(currentCalls, 0); assert.equal(writes, 0);
}));

test('ordinary tokenless restore never becomes legacy claim', async () => withEnv(async () => {
  let receivedIntent = '';
  const handler = createVerifyHandler({supabase: fakeSupabase, authenticate: async () => userId,
    readControls: async () => controls(true, true), verifier: verifier(),
    currentStatus: {lookupCurrentStatus: async () => current()},
    persist: async (_client, _user, _environment, _summary, _current, intent) => {
      receivedIntent = intent; return {bindingResult: 'unclaimed', duplicate: false, currentStateQuality: 'verified'};
    }});
  const response = await handler(event({signedTransactionInfo: 'jws', claimIntent: 'restore', allowLegacyClaim: true}));
  assert.equal(response.statusCode, 200); assert.equal(receivedIntent, 'restore');
  assert.match(response.body, /"binding":"unclaimed"/);
}));

test('legacy claim is rejected when either current or submitted transaction has a token', async () => withEnv(async () => {
  const handler = createVerifyHandler({supabase: fakeSupabase, authenticate: async () => userId,
    readControls: async () => controls(true, true), verifier: verifier(transaction({appAccountToken: userId})),
    currentStatus: {lookupCurrentStatus: async () => current({appAccountTokenHash: 'b'.repeat(64)})}});
  const response = await handler(event({signedTransactionInfo: 'jws', claimIntent: 'legacy_claim', legacyClaimConfirmed: true}));
  assert.equal(response.statusCode, 409); assert.match(response.body, /LEGACY_CLAIM_NOT_ALLOWED/);
}));

test('legacy claim requires a currently granting entitlement', async () => withEnv(async () => {
  const handler = createVerifyHandler({supabase: fakeSupabase, authenticate: async () => userId,
    readControls: async () => controls(true, true), verifier: verifier(),
    currentStatus: {lookupCurrentStatus: async () => current({normalizedStatus: 'expired', grantsPremium: false,
      expiresAt: new Date(Date.now() - 1000).toISOString()})}});
  const response = await handler(event({signedTransactionInfo: 'jws', claimIntent: 'legacy_claim', legacyClaimConfirmed: true}));
  assert.equal(response.statusCode, 409); assert.match(response.body, /LEGACY_CLAIM_NOT_ALLOWED/);
}));

test('current-status provider failure never writes or grants', async () => withEnv(async () => {
  let writes = 0;
  const handler = createVerifyHandler({supabase: fakeSupabase, authenticate: async () => userId,
    readControls: async () => controls(true, true), verifier: verifier(),
    currentStatus: {lookupCurrentStatus: async () => { throw new AppleServiceError('CURRENT_STATUS_REQUIRED', 503); }},
    persist: async () => { writes++; return {bindingResult: '', duplicate: false, currentStateQuality: 'verified'}; }});
  const response = await handler(event({signedTransactionInfo: 'jws', claimIntent: 'restore'}));
  assert.equal(response.statusCode, 503); assert.equal(writes, 0); assert.match(response.body, /CURRENT_STATUS_REQUIRED/);
}));

test('unexpected current-status chain fails closed', async () => withEnv(async () => {
  const handler = createVerifyHandler({supabase: fakeSupabase, authenticate: async () => userId,
    readControls: async () => controls(true, true), verifier: verifier(),
    currentStatus: {lookupCurrentStatus: async () => current({originalTransactionId: 'other'})}});
  const response = await handler(event({signedTransactionInfo: 'jws', claimIntent: 'restore'}));
  assert.equal(response.statusCode, 502); assert.match(response.body, /CURRENT_STATUS_INVALID/);
}));

test('persisted quarantine returns deterministic non-200', async () => withEnv(async () => {
  const handler = createVerifyHandler({supabase: fakeSupabase, authenticate: async () => userId,
    readControls: async () => controls(true, true), verifier: verifier(),
    currentStatus: {lookupCurrentStatus: async () => current()},
    persist: async () => ({bindingResult: 'already_claimed', duplicate: false, currentStateQuality: 'quarantined'})});
  const response = await handler(event({signedTransactionInfo: 'jws', claimIntent: 'restore'}));
  assert.equal(response.statusCode, 409); assert.match(response.body, /CURRENT_STATE_QUARANTINED/);
}));

test('JWS and transactionId mismatch is rejected', async () => withEnv(async () => {
  const handler = createVerifyHandler({supabase: fakeSupabase, authenticate: async () => userId,
    readControls: async () => controls(true), verifier: verifier(transaction({transactionId: 'actual'}))});
  const response = await handler(event({signedTransactionInfo: 'jws', transactionId: 'different', claimIntent: 'restore'}));
  assert.equal(response.statusCode, 400); assert.match(response.body, /TRANSACTION_ID_MISMATCH/);
}));
