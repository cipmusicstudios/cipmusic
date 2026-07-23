import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateMembership} from '../../netlify/functions/_shared/membership-aggregate';

const future = new Date(Date.now() + 86_400_000).toISOString();

test('production Apple grants Pro when no legacy membership exists', () => {
  const membership = aggregateMembership(null, [
    {environment: 'production', currently_grants_premium: true, valid_until: future},
  ]);
  assert.equal(membership.isPremium, true);
  assert.equal(membership.source, 'apple');
  assert.equal(membership.membershipStatus, 'apple_app_store_active');
});

test('sandbox is visible but never grants production Pro', () => {
  const membership = aggregateMembership(null, [
    {environment: 'sandbox', currently_grants_premium: true, valid_until: future},
  ]);
  assert.equal(membership.isPremium, false);
  assert.equal(membership.appleSandboxVerified, true);
  assert.equal(membership.appleEnvironment, null);
});

test('an active legacy membership with a future expiry is never downgraded', () => {
  for (const membershipStatus of ['active', 'stripe_subscription_active', 'stripe_subscription_trialing', 'zpay_active', 'manual_active', 'premium']) {
    const membership = aggregateMembership(
      {
        premium_until: future,
        membership_status: membershipStatus,
        auto_renew: true,
        current_period_end: future,
      },
      [{environment: 'production', currently_grants_premium: false, valid_until: null}],
    );
    assert.equal(membership.isPremium, true, membershipStatus);
    assert.equal(membership.source, 'legacy', membershipStatus);
  }
});

test('parseable expired premium_until is never revived by a stale active status', () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  for (const membership_status of ['premium', 'active', 'canceled_active']) {
    assert.equal(aggregateMembership({premium_until: yesterday, membership_status, auto_renew: false, current_period_end: future}, []).isPremium, false);
  }
});

test('null date uses the existing active-status fallback, while malformed dates fail closed', () => {
  assert.equal(aggregateMembership({premium_until: null, membership_status: 'active', auto_renew: false, current_period_end: null}, []).isPremium, true);
  assert.equal(aggregateMembership({premium_until: 'not-a-date', membership_status: 'premium', auto_renew: false, current_period_end: null}, []).isPremium, false);
  assert.equal(aggregateMembership({premium_until: null, membership_status: 'canceled_active', auto_renew: false, current_period_end: future}, []).isPremium, true);
});

test('expired legacy status is not revived by an expired date', () => {
  const membership = aggregateMembership({premium_until: new Date(Date.now() - 86_400_000).toISOString(), membership_status: 'expired', auto_renew: false, current_period_end: null}, []);
  assert.equal(membership.isPremium, false);
});

test('an Apple query with no active entitlement cannot overwrite legacy data', () => {
  const membership = aggregateMembership(
    {
      premium_until: future,
      membership_status: 'premium',
      auto_renew: false,
      current_period_end: future,
    },
    [],
  );
  assert.equal(membership.isPremium, true);
  assert.equal(membership.membershipStatus, 'premium');
});
