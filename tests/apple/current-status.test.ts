import test from 'node:test';
import assert from 'node:assert/strict';
import {OfficialAppleCurrentStatusProvider} from '../../netlify/functions/_shared/apple/current-status';
import {summarizeTransaction} from '../../netlify/functions/_shared/apple/transaction';
import {AppleServiceError, type AppleVerifier} from '../../netlify/functions/_shared/apple/types';

const config = {
  issuerId: 'issuer', keyId: 'key', privateKey: 'key', bundleId: 'com.cipmusic.aurasounds',
  appId: 6767718789, environment: 'production' as const,
};
const oldTransaction = {
  environment: 'Production', bundleId: config.bundleId,
  productId: 'com.cipmusic.aurasounds.premium.monthly.v2', subscriptionGroupIdentifier: '22099193',
  transactionId: 'old-tx', originalTransactionId: 'original',
  signedDate: Date.now() - 60 * 86_400_000, expiresDate: Date.now() - 30 * 86_400_000,
};
const currentTransaction = (expiresDate: number) => ({...oldTransaction,
  transactionId: 'current-tx', signedDate: Date.now() - 1000, expiresDate});
const makeVerifier = (expiresDate: number): AppleVerifier => {
  const transaction = currentTransaction(expiresDate);
  const renewal = {environment: 'Production', originalTransactionId: 'original',
    autoRenewStatus: 1, signedDate: Date.now() - 500};
  return {
    verifyTransaction: async () => transaction,
    verifyNotification: async () => ({}),
    verifyRenewal: async () => renewal,
  };
};
const response = (status: number) => ({
  environment: 'Production', bundleId: config.bundleId, appAppleId: config.appId,
  data: [{subscriptionGroupIdentifier: '22099193', lastTransactions: [{
    status, originalTransactionId: 'original', signedTransactionInfo: 'current-jws', signedRenewalInfo: 'renewal-jws',
  }]}],
});

test('historical JWS cannot override an Apple current expired status', async () => {
  const facts = summarizeTransaction(oldTransaction, 'production', null);
  const provider = new OfficialAppleCurrentStatusProvider(config, makeVerifier(Date.now() - 1000),
    () => ({getAllSubscriptionStatuses: async () => response(2)}));
  const current = await provider.lookupCurrentStatus(facts, 'production');
  assert.equal(current.normalizedStatus, 'expired');
  assert.equal(current.grantsPremium, false);
  assert.equal('grantsPremium' in facts, false);
});

test('active response with past expiry normalizes fail closed', async () => {
  const facts = summarizeTransaction(oldTransaction, 'production', null);
  const provider = new OfficialAppleCurrentStatusProvider(config, makeVerifier(Date.now() - 1000),
    () => ({getAllSubscriptionStatuses: async () => response(1)}));
  const current = await provider.lookupCurrentStatus(facts, 'production');
  assert.equal(current.normalizedStatus, 'expired');
  assert.equal(current.grantsPremium, false);
});

test('verified current active status grants only until its current expiry', async () => {
  const facts = summarizeTransaction(oldTransaction, 'production', null);
  const provider = new OfficialAppleCurrentStatusProvider(config, makeVerifier(Date.now() + 86_400_000),
    () => ({getAllSubscriptionStatuses: async () => response(1)}));
  const current = await provider.lookupCurrentStatus(facts, 'production');
  assert.equal(current.normalizedStatus, 'active');
  assert.equal(current.grantsPremium, true);
  assert.match(current.statusFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(current.currentStateQuality, 'verified');
});

test('duplicate identical current entries are idempotently deduplicated', async () => {
  const facts = summarizeTransaction(oldTransaction, 'production', null);
  const duplicated = response(1);
  duplicated.data[0].lastTransactions.push({...duplicated.data[0].lastTransactions[0]});
  const provider = new OfficialAppleCurrentStatusProvider(config, makeVerifier(Date.now() + 86_400_000),
    () => ({getAllSubscriptionStatuses: async () => duplicated}));
  assert.equal((await provider.lookupCurrentStatus(facts, 'production')).currentStateQuality, 'verified');
});

test('same evidence with different status is quarantined and cannot grant', async () => {
  const facts = summarizeTransaction(oldTransaction, 'production', null);
  const conflicting = response(1);
  conflicting.data[0].lastTransactions.push({...conflicting.data[0].lastTransactions[0], status: 2});
  const provider = new OfficialAppleCurrentStatusProvider(config, makeVerifier(Date.now() + 86_400_000),
    () => ({getAllSubscriptionStatuses: async () => conflicting}));
  const value = await provider.lookupCurrentStatus(facts, 'production');
  assert.equal(value.currentStateQuality, 'quarantined');
  assert.equal(value.grantsPremium, false);
});

for (const [name, value] of [
  ['null', null],
  ['empty', {...response(1), data: []}],
  ['partial', {...response(1), data: [{subscriptionGroupIdentifier: '22099193', lastTransactions: [{status: 1}]}]}],
] as const) {
  test(`${name} current status fails closed`, async () => {
    const facts = summarizeTransaction(oldTransaction, 'production', null);
    const provider = new OfficialAppleCurrentStatusProvider(config, makeVerifier(Date.now() + 86_400_000),
      () => ({getAllSubscriptionStatuses: async () => value as any}));
    await assert.rejects(provider.lookupCurrentStatus(facts, 'production'), AppleServiceError);
  });
}

test('a different original chain in the target group is rejected', async () => {
  const facts = summarizeTransaction(oldTransaction, 'production', null);
  const mixed = response(1);
  mixed.data[0].lastTransactions.push({...mixed.data[0].lastTransactions[0], originalTransactionId: 'other'});
  const provider = new OfficialAppleCurrentStatusProvider(config, makeVerifier(Date.now() + 86_400_000),
    () => ({getAllSubscriptionStatuses: async () => mixed}));
  await assert.rejects(provider.lookupCurrentStatus(facts, 'production'), AppleServiceError);
});
