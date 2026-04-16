const DEFAULT_READ_URL = '/.netlify/functions/read-membership';

function readEndpoint(): string {
  const fromEnv = import.meta.env.VITE_READ_MEMBERSHIP_URL as string | undefined;
  return (fromEnv && fromEnv.trim()) || DEFAULT_READ_URL;
}

export type RemoteUserMembership = {
  premiumUntil: string | null;
  membershipStatus: string | null;
  paymentProvider: string | null;
  lastPaymentAt: string | null;
};

/** 端点不可达（本地 preview 无 Functions、404、非 JSON 等）与「函数已响应但失败」区分，便于前端降级。 */
export type RemoteMembershipFetchFailureReason = 'function_unavailable' | 'request_failed';

export type RemoteMembershipFetchResult =
  | {ok: true; data: RemoteUserMembership | null}
  | {ok: false; data: null; reason: RemoteMembershipFetchFailureReason; httpStatus?: number};

function normalizePayload(parsed: Record<string, unknown>): RemoteUserMembership | null {
  const premiumUntil = (parsed.premiumUntil ?? parsed.premium_until) as string | null | undefined;
  const membershipStatus = (parsed.membershipStatus ?? parsed.membership_status) as string | null | undefined;
  const paymentProvider = (parsed.paymentProvider ?? parsed.payment_provider) as string | null | undefined;
  const lastPaymentAt = (parsed.lastPaymentAt ?? parsed.last_payment_at) as string | null | undefined;
  return {
    premiumUntil: premiumUntil ?? null,
    membershipStatus: membershipStatus ?? null,
    paymentProvider: paymentProvider ?? null,
    lastPaymentAt: lastPaymentAt ?? null,
  };
}

/** userId：Supabase Auth UUID。 */
export async function fetchRemoteUserMembership(userId: string): Promise<RemoteMembershipFetchResult> {
  try {
    const res = await fetch(readEndpoint(), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({userId}),
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      if (!res.ok && (res.status === 404 || res.status === 405)) {
        return {ok: false, data: null, reason: 'function_unavailable', httpStatus: res.status};
      }
      if (!res.ok) {
        return {ok: false, data: null, reason: 'request_failed', httpStatus: res.status};
      }
      return {ok: false, data: null, reason: 'function_unavailable', httpStatus: res.status};
    }

    if (!res.ok) {
      if (res.status === 404 || res.status === 405) {
        return {ok: false, data: null, reason: 'function_unavailable', httpStatus: res.status};
      }
      return {ok: false, data: null, reason: 'request_failed', httpStatus: res.status};
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {ok: false, data: null, reason: 'function_unavailable', httpStatus: res.status};
    }

    const obj = parsed as Record<string, unknown>;
    if ('error' in obj && !('premiumUntil' in obj) && !('premium_until' in obj)) {
      return {ok: false, data: null, reason: 'request_failed', httpStatus: res.status};
    }

    const data = normalizePayload(obj);
    return {ok: true, data};
  } catch {
    return {ok: false, data: null, reason: 'function_unavailable'};
  }
}

export function daysUntilDate(iso: string | null): number | null {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (Number.isNaN(end)) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);
  return Math.ceil((endDay.getTime() - start.getTime()) / 86400000);
}

/** App language: English / simplified Chinese / Traditional Chinese (matches Settings `currentLang`). */
export function formatMembershipDateOnly(iso: string, currentLang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  if (currentLang === 'English') {
    return d.toLocaleDateString('en-CA', {year: 'numeric', month: '2-digit', day: '2-digit'});
  }
  if (currentLang === '\u7e41\u9ad4\u4e2d\u6587') {
    return d.toLocaleDateString('zh-TW', {year: 'numeric', month: '2-digit', day: '2-digit'});
  }
  return d.toLocaleDateString('zh-CN', {year: 'numeric', month: '2-digit', day: '2-digit'});
}

export function premiumUntilActive(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t > Date.now();
}

export type NormalizedPaymentProvider = 'stripe' | 'zpay' | 'unknown';

export function normalizePaymentProvider(raw: string | null | undefined): NormalizedPaymentProvider {
  const s = (raw || '').toLowerCase().trim();
  if (s === 'stripe') return 'stripe';
  if (s === 'zpay' || s === 'wechat' || s.includes('wechat')) return 'zpay';
  return 'unknown';
}
