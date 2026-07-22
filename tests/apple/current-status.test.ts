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
const makeVerifier = (expiresDate: number): AppleVerifier => ({
  verifyTransaction: async () => currentTransaction(expiresDate),
  verifyNotification: async () => ({}),
  verifyRenewal: async () => ({environment: 'Production', originalTransactionId: 'original',
    autoRenewStatus: 1, signedDate: Date.now() - 500}),
});
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

test('inconsistent active response with past expiry fails closed', async () => {
  const facts = summarizeTransaction(oldTransaction, 'production', null);
  const provider = new OfficialAppleCurrentStatusProvider(config, makeVerifier(Date.now() - 1000),
    () => ({getAllSubscriptionStatuses: async () => response(1)}));
  await assert.rejects(provider.lookupCurrentStatus(facts, 'production'),
    (error: unknown) => error instanceof AppleServiceError && error.code === 'CURRENT_STATUS_INVALID');
});

test('verified current active status grants only until its current expiry', async () => {
  const facts = summarizeTransaction(oldTransaction, 'production', null);
  const provider = new OfficialAppleCurrentStatusProvider(config, makeVerifier(Date.now() + 86_400_000),
    () => ({getAllSubscriptionStatuses: async () => response(1)}));
  const current = await provider.lookupCurrentStatus(facts, 'production');
  assert.equal(current.normalizedStatus, 'active');
  assert.equal(current.grantsPremium, true);
  assert.match(current.evidenceHash, /^[0-9a-f]{64}$/);
});
