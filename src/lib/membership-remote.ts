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
  autoRenew: boolean | null;
  currentPeriodEnd: string | null;
  stripeSubscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean | null;
  lastPaymentStatus: string | null;
  paymentFailureAt: string | null;
};

/** 端点不可达（本地 preview 无 Functions、404、非 JSON 等）与「函数已响应但失败」区分，便于前端降级。 */
export type RemoteMembershipFetchFailureReason = 'function_unavailable' | 'request_failed';

export type RemoteMembershipFetchResult =
  | {ok: true; data: RemoteUserMembership | null}
  | {
      ok: false;
      data: null;
      reason: RemoteMembershipFetchFailureReason;
      httpStatus?: number;
      serverCode?: string;
      serverMessage?: string;
      serverDebug?: unknown;
    };

function normalizePayload(parsed: Record<string, unknown>): RemoteUserMembership | null {
  const premiumUntil = (parsed.premiumUntil ?? parsed.premium_until) as string | null | undefined;
  const membershipStatus = (parsed.membershipStatus ?? parsed.membership_status) as string | null | undefined;
  const paymentProvider = (parsed.paymentProvider ?? parsed.payment_provider) as string | null | undefined;
  const lastPaymentAt = (parsed.lastPaymentAt ?? parsed.last_payment_at) as string | null | undefined;
  const autoRenew = (parsed.autoRenew ?? parsed.auto_renew) as boolean | null | undefined;
  const currentPeriodEnd = (parsed.currentPeriodEnd ?? parsed.current_period_end) as string | null | undefined;
  const stripeSubscriptionStatus = (parsed.stripeSubscriptionStatus ?? parsed.stripe_subscription_status) as
    | string
    | null
    | undefined;
  const cancelAtPeriodEnd = (parsed.cancelAtPeriodEnd ?? parsed.cancel_at_period_end) as boolean | null | undefined;
  const lastPaymentStatus = (parsed.lastPaymentStatus ?? parsed.last_payment_status) as string | null | undefined;
  const paymentFailureAt = (parsed.paymentFailureAt ?? parsed.payment_failure_at) as string | null | undefined;
  return {
    premiumUntil: premiumUntil ?? null,
    membershipStatus: membershipStatus ?? null,
    paymentProvider: paymentProvider ?? null,
    lastPaymentAt: lastPaymentAt ?? null,
    autoRenew: autoRenew ?? null,
    currentPeriodEnd: currentPeriodEnd ?? null,
    stripeSubscriptionStatus: stripeSubscriptionStatus ?? null,
    cancelAtPeriodEnd: cancelAtPeriodEnd ?? null,
    lastPaymentStatus: lastPaymentStatus ?? null,
    paymentFailureAt: paymentFailureAt ?? null,
  };
}

/** 从200 响应中取出会员字段对象（支持 ok:true + 顶层字段，或 ok:true + data 嵌套） */
function extractMembershipRecord(obj: Record<string, unknown>): Record<string, unknown> {
  if (obj.ok === true && obj.data != null && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    return obj.data as Record<string, unknown>;
  }
  return obj;
}

function readFailureFromBody(parsed: unknown, httpStatus: number): RemoteMembershipFetchResult {
  let serverCode: string | undefined;
  let serverMessage: string | undefined;
  let serverDebug: unknown;
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const errObj = parsed as Record<string, unknown>;
    if (typeof errObj.code === 'string') serverCode = errObj.code;
    else if (typeof errObj.error === 'string') serverCode = errObj.error;
    if (typeof errObj.message === 'string') serverMessage = errObj.message;
    if ('debug' in errObj) serverDebug = errObj.debug;
  }
  return {
    ok: false,
    data: null,
    reason: 'request_failed',
    httpStatus,
    serverCode,
    serverMessage,
    serverDebug,
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
      return readFailureFromBody(parsed, res.status);
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {ok: false, data: null, reason: 'function_unavailable', httpStatus: res.status};
    }

    const obj = parsed as Record<string, unknown>;

    if (obj.ok === false) {
      return readFailureFromBody(parsed, res.status);
    }

    const record = extractMembershipRecord(obj);
    const data = normalizePayload(record);
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

/**
 * 是否应解锁 Premium 能力：优先未过期的 premium_until；若无结束日期字段但 status 为有效会员，也视为 entitled。
 * （若存在 premium_until 字符串但未通过时间校验，则不以 status 覆盖，避免已过期行被误判。）
 */
export function remotePremiumEntitled(m: RemoteUserMembership | null | undefined): boolean {
  if (!m) return false;
  if (premiumUntilActive(m.premiumUntil)) return true;
  const iso = m.premiumUntil;
  if (iso != null && String(iso).trim() !== '') return false;
  const st = (m.membershipStatus || '').toLowerCase().trim();
  const stripeSt = (m.stripeSubscriptionStatus || '').toLowerCase().trim();
  return (
    st === 'active' ||
    st === 'premium' ||
    st === 'stripe_subscription_active' ||
    st === 'stripe_subscription_trialing' ||
    stripeSt === 'active' ||
    stripeSt === 'trialing'
  );
}

export type NormalizedPaymentProvider = 'stripe' | 'zpay' | 'unknown';

export function normalizePaymentProvider(raw: string | null | undefined): NormalizedPaymentProvider {
  const s = (raw || '').toLowerCase().trim();
  if (s === 'stripe') return 'stripe';
  if (s === 'zpay' || s === 'wechat' || s.includes('wechat')) return 'zpay';
  return 'unknown';
}

/**
 * 是否 Stripe **订阅**自动续费（与一次性 Checkout、后台 manual 开通区分）。
 * 依赖 `user_membership.membership_status` 等字段由支付回调写入；若无 subscription 标记则视为未开启自动续费。
 */
export function isStripeSubscriptionAutoRenew(m: RemoteUserMembership | null | undefined): boolean {
  if (!m) return false;
  const p = (m.paymentProvider || '').toLowerCase().trim();
  if (p !== 'stripe') return false;
  if (typeof m.autoRenew === 'boolean') return m.autoRenew;
  const st = (m.membershipStatus || '').toLowerCase().trim();
  if (!st) return false;
  return (
    st.includes('subscription') ||
    st === 'stripe_subscription' ||
    st === 'recurring' ||
    st.endsWith('_subscription')
  );
}

export type AccountAutoRenewCopy = {
  membershipAutoRenewOn: string;
  membershipAutoRenewOff: string;
  membershipAutoRenewUnknown: string;
};

/** Account「自动续费」行：仅 Stripe 订阅为已开启，其余为未开启；无 provider 信息时为 — */
export function accountAutoRenewLabel(
  m: RemoteUserMembership | null | undefined,
  t: AccountAutoRenewCopy,
): string {
  if (isStripeSubscriptionAutoRenew(m)) return t.membershipAutoRenewOn;
  const raw = (m?.paymentProvider || '').trim();
  if (!raw) return t.membershipAutoRenewUnknown;
  return t.membershipAutoRenewOff;
}
