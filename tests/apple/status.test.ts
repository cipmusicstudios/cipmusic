import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAppleSubscriptionStatus} from '../../netlify/functions/_shared/apple/status';

const future = 2_000; const now = 1_000;
test('Apple status mapping preserves only trusted active periods', () => {
  assert.deepEqual(normalizeAppleSubscriptionStatus({status: 1, expiresAt: future, now}), {status: 'active', grantsPremium: true});
  assert.deepEqual(normalizeAppleSubscriptionStatus({status: 4, graceExpiresAt: future, now}), {status: 'grace_period', grantsPremium: true});
  assert.deepEqual(normalizeAppleSubscriptionStatus({status: 3, expiresAt: future, now}), {status: 'billing_retry', grantsPremium: true});
  assert.deepEqual(normalizeAppleSubscriptionStatus({status: 5, expiresAt: future, now}), {status: 'revoked', grantsPremium: false});
  assert.deepEqual(normalizeAppleSubscriptionStatus({refunded: true, expiresAt: future, now}), {status: 'refunded', grantsPremium: false});
  assert.deepEqual(normalizeAppleSubscriptionStatus({status: 1, subtype: 'AUTO_RENEW_DISABLED', expiresAt: future, now}),
    {status: 'canceled_active', grantsPremium: true});
});

test('billing retry grants only through the verified paid period', () => {
  assert.deepEqual(normalizeAppleSubscriptionStatus({status: 3, expiresAt: future, now}),
    {status: 'billing_retry', grantsPremium: true});
  assert.deepEqual(normalizeAppleSubscriptionStatus({status: 3, expiresAt: now, now}),
    {status: 'billing_retry', grantsPremium: false});
});

test('grace requires an explicit future grace expiry', () => {
  assert.deepEqual(normalizeAppleSubscriptionStatus({status: 4, expiresAt: future, now}),
    {status: 'grace_period', grantsPremium: false});
  assert.deepEqual(normalizeAppleSubscriptionStatus({status: 4, graceExpiresAt: future, now}),
    {status: 'grace_period', grantsPremium: true});
});
