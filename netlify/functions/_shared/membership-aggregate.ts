export type LegacyMembership = {
  premium_until: string | null;
  membership_status: string | null;
  auto_renew: boolean | null;
  current_period_end: string | null;
} | null;

export type AppleEntitlement = {
  environment: 'production' | 'sandbox';
  currently_grants_premium: boolean;
  valid_until: string | null;
};

/**
 * Legacy providers remain authoritative while their explicit status is active.
 * A valid future premium_until is also active; malformed/expired dates fall
 * back to the status instead of silently downgrading an existing member.
 */
export const activeLegacy = (row: LegacyMembership) => {
  if (!row) return false;
  const status = (row.membership_status ?? '').toLowerCase();
  const activeStatus = ['active', 'premium', 'stripe_subscription_active', 'stripe_subscription_trialing',
    'zpay_active', 'manual_active', 'canceled_active'].includes(status);
  if (!row.premium_until) return activeStatus;
  const until = Date.parse(row.premium_until);
  return Number.isFinite(until) && until > Date.now() ? true : activeStatus;
};

export function aggregateMembership(legacy: LegacyMembership, apple: AppleEntitlement[]) {
  const production =
    apple.find(
      (value) => value.environment === 'production' && value.currently_grants_premium,
    ) ?? null;
  // Authenticated-user diagnostic only; it never participates in isPremium.
  const sandboxVerified = apple.some((value) => value.environment === 'sandbox');

  if (activeLegacy(legacy)) {
    return {
      isPremium: true,
      membershipStatus: legacy?.membership_status ?? 'premium',
      premiumUntil: legacy?.premium_until ?? null,
      currentPeriodEnd: legacy?.current_period_end ?? null,
      autoRenew: legacy?.auto_renew ?? null,
      source: 'legacy',
      appleEnvironment: production ? 'production' : null,
      appleSandboxVerified: sandboxVerified,
    };
  }

  if (production) {
    return {
      isPremium: true,
      membershipStatus: 'apple_app_store_active',
      premiumUntil: production.valid_until,
      currentPeriodEnd: production.valid_until,
      autoRenew: null,
      source: 'apple',
      appleEnvironment: 'production',
      appleSandboxVerified: sandboxVerified,
    };
  }

  return {
    isPremium: false,
    membershipStatus: legacy?.membership_status ?? null,
    premiumUntil: legacy?.premium_until ?? null,
    currentPeriodEnd: legacy?.current_period_end ?? null,
    autoRenew: legacy?.auto_renew ?? null,
    source: legacy ? 'legacy_inactive' : 'none',
    appleEnvironment: null,
    appleSandboxVerified: sandboxVerified,
  };
}
