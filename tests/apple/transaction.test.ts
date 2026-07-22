import test from 'node:test';
import assert from 'node:assert/strict';
import {hashAppAccountToken, summarizeTransaction} from '../../netlify/functions/_shared/apple/transaction';

const future = Date.now() + 86_400_000;
const base = {
  environment: 'Production', bundleId: 'com.cipmusic.aurasounds',
  productId: 'com.cipmusic.aurasounds.premium.monthly.v2',
  subscriptionGroupIdentifier: '22099193', transactionId: 'tx-1',
  originalTransactionId: 'orig-1', signedDate: Date.now(), expiresDate: future,
};

test('valid production JWS produces immutable transaction facts only', () => {
  const summary = summarizeTransaction(base, 'production', null);
  assert.equal(summary.transactionStatus, 'recorded');
  assert.equal('grantsPremium' in summary, false);
  assert.equal('normalizedStatus' in summary, false);
  assert.match(summary.summaryHash, /^[0-9a-f]{64}$/);
});

for (const [name, patch, code] of [
  ['bundle', {bundleId: 'evil.app'}, 'BUNDLE_ID_MISMATCH'],
  ['sku', {productId: 'evil.sku'}, 'PRODUCT_ID_MISMATCH'],
  ['group', {subscriptionGroupIdentifier: '999'}, 'SUBSCRIPTION_GROUP_MISMATCH'],
  ['environment', {environment: 'Sandbox'}, 'ENVIRONMENT_MISMATCH'],
] as const) {
  test(`rejects wrong ${name}`, () => assert.throws(
    () => summarizeTransaction({...base, ...patch}, 'production', null),
    (error: any) => error.code === code,
  ));
}

test('rejects appAccountToken different from authenticated UUID', () => {
  assert.throws(() => summarizeTransaction({...base, appAccountToken: '11111111-1111-4111-8111-111111111111'},
    'production', '22222222-2222-4222-8222-222222222222'),
  (error: any) => error.code === 'APP_ACCOUNT_TOKEN_MISMATCH');
});

test('sandbox transaction facts contain no grant decision', () => {
  const summary = summarizeTransaction({...base, environment: 'Sandbox'}, 'sandbox', null);
  assert.equal('grantsPremium' in summary, false);
});

test('appAccountToken privacy hash is domain separated and canonical', () => {
  assert.equal(hashAppAccountToken('11111111-1111-4111-8111-111111111111'),
    hashAppAccountToken('11111111-1111-4111-8111-111111111111'.toUpperCase()));
  assert.match(hashAppAccountToken('11111111-1111-4111-8111-111111111111') ?? '', /^[0-9a-f]{64}$/);
});

test('summary hash covers every persisted transaction semantic', () => {
  const original = summarizeTransaction(base, 'production', null).summaryHash;
  const variants = [
    {...base, appAccountToken: '11111111-1111-4111-8111-111111111111'},
    {...base, purchaseDate: Date.now() - 1000},
    {...base, transactionReason: 'RENEWAL'},
    {...base, inAppOwnershipType: 'PURCHASED'},
    {...base, revocationDate: Date.now()},
  ];
  for (const variant of variants) {
    assert.notEqual(summarizeTransaction(variant, 'production', null).summaryHash, original);
  }
});

test('immutable transaction summary is independent of verification wall clock', () => {
  const realNow = Date.now;
  try {
    Date.now = () => future - 1;
    const beforeExpiry = summarizeTransaction(base, 'production', null);
    Date.now = () => future + 1;
    const afterExpiry = summarizeTransaction(base, 'production', null);
    assert.deepEqual(afterExpiry, beforeExpiry);
  } finally {
    Date.now = realNow;
  }
});
