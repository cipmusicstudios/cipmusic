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

const activeLegacy = (row: LegacyMembership) => {
  if (!row) return false;
  if (row.premium_until) return Date.parse(row.premium_until) > Date.now();
  return ['active', 'premium', 'stripe_subscription_active', 'stripe_subscription_trialing'].includes((row.membership_status ?? '').toLowerCase());
};

export function aggregateMembership(legacy: LegacyMembership, apple: AppleEntitlement[]) {
  const production =
    apple.find(
      (value) => value.environment === 'production' && value.currently_grants_premium,
    ) ?? null;
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
