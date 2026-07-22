import type {AppleNormalizedStatus} from './types';

export function normalizeAppleSubscriptionStatus(input: {
  status?: number | null;
  subtype?: string | null;
  revoked?: boolean;
  refunded?: boolean;
  upgraded?: boolean;
  expiresAt?: number | null;
  graceExpiresAt?: number | null;
  autoRenewOff?: boolean;
  now?: number;
}): {status: AppleNormalizedStatus | 'grace_period' | 'billing_retry' | 'canceled_active'; grantsPremium: boolean} {
  const now = input.now ?? Date.now();
  const stillActive = Boolean(input.expiresAt && input.expiresAt > now);
  if (input.refunded) return {status: 'refunded', grantsPremium: false};
  if (input.revoked || input.status === 5) return {status: 'revoked', grantsPremium: false};
  if (input.upgraded) return {status: 'upgraded', grantsPremium: false};
  const graceActive = Boolean(input.graceExpiresAt && input.graceExpiresAt > now);
  if (input.status === 4) return {status: 'grace_period', grantsPremium: graceActive};
  if (input.status === 3) return {status: 'billing_retry', grantsPremium: stillActive};
  if (input.status === 2 || !stillActive) return {status: 'expired', grantsPremium: false};
  if (input.autoRenewOff || input.subtype === 'AUTO_RENEW_DISABLED') {
    return {status: 'canceled_active', grantsPremium: stillActive};
  }
  if (input.status === 1 || stillActive) return {status: 'active', grantsPremium: true};
  return {status: 'unknown', grantsPremium: false};
}
