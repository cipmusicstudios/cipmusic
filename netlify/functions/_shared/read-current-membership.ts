import type {SupabaseClient} from '@supabase/supabase-js';
import {
  aggregateMembership,
  type AppleEntitlement,
  type LegacyMembership,
} from './membership-aggregate';

export const APPLE_SUMMARY_RPC_TIMEOUT_MS = 1500;

export type CurrentMembership = ReturnType<typeof aggregateMembership>;

export type CurrentMembershipReadResult =
  | {ok: true; membership: CurrentMembership; legacyFound: boolean}
  | {
      ok: false;
      error: {message: string; code?: string | null};
    };

function isAppleEntitlement(value: unknown): value is AppleEntitlement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.environment === 'production' || record.environment === 'sandbox') &&
    typeof record.currently_grants_premium === 'boolean' &&
    (typeof record.valid_until === 'string' || record.valid_until === null)
  );
}

async function readAppleEntitlements(
  supabase: SupabaseClient,
  userId: string,
  timeoutMs: number,
): Promise<AppleEntitlement[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rpc = Promise.resolve(
    supabase.rpc('billing_get_current_entitlement_summary', {p_user_id: userId}),
  ).then(
    result => ({kind: 'result' as const, result}),
    () => ({kind: 'rejected' as const}),
  );
  const timeout = new Promise<{kind: 'timeout'}>(resolve => {
    timer = setTimeout(() => resolve({kind: 'timeout'}), timeoutMs);
  });
  try {
    const settled = await Promise.race([rpc, timeout]);
    if (settled.kind !== 'result' || settled.result.error) return [];
    return (Array.isArray(settled.result.data) ? settled.result.data : [])
      .filter(isAppleEntitlement);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Canonical server-side membership read for an already-authenticated Supabase
 * user. Legacy providers remain supported, while only verified Production
 * Apple rows returned by the service-role RPC can grant Premium.
 *
 * Apple RPC rejection, error, malformed data, or timeout fails closed for the
 * Apple source while preserving an independently valid legacy entitlement.
 */
export async function readCurrentMembership(
  supabase: SupabaseClient,
  userId: string,
  options: {appleRpcTimeoutMs?: number} = {},
): Promise<CurrentMembershipReadResult> {
  const legacyResult = await supabase
    .from('user_membership')
    .select('premium_until, membership_status, auto_renew, current_period_end')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (legacyResult.error) {
    return {
      ok: false,
      error: {
        message: legacyResult.error.message,
        code: legacyResult.error.code != null ? String(legacyResult.error.code) : null,
      },
    };
  }

  const appleRows = await readAppleEntitlements(
    supabase,
    userId,
    options.appleRpcTimeoutMs ?? APPLE_SUMMARY_RPC_TIMEOUT_MS,
  );
  const legacy = (legacyResult.data ?? null) as LegacyMembership;
  return {
    ok: true,
    membership: aggregateMembership(legacy, appleRows),
    legacyFound: legacy != null,
  };
}
