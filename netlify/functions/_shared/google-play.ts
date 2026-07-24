import {createSign} from 'crypto';

/**
 * Google Play Developer API 服务端校验（Android 订阅）。
 *
 * 设计与 zpay-crypto 一致：手写、零额外 npm 依赖。仅用 Node 内置 `crypto` 给
 * 服务账号 JWT 做 RS256 签名，换取 OAuth2 access token，再调用
 * Android Publisher v3 `purchases.subscriptionsv2.get`（v2 端点才会返回 base plan）。
 *
 * 绝不信任客户端的「购买成功」：所有 productId / basePlanId / 到期时间 / 订阅状态
 * 均以 Google 返回为准（见 verify-google-play-purchase.ts）。
 */

/** Google Play 订阅产品与 base plan 常量（与 Play Console 配置、移动端一致）。 */
export const GOOGLE_PLAY_PACKAGE_NAME = 'com.cipmusic.aurasounds';
export const GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID = 'cip_premium';
export const GOOGLE_PLAY_BASE_PLAN_MONTHLY = 'monthly-599';
export const GOOGLE_PLAY_BASE_PLAN_ANNUAL = 'annual-4999';
export const GOOGLE_PLAY_ALLOWED_BASE_PLANS: ReadonlySet<string> = new Set([
  GOOGLE_PLAY_BASE_PLAN_MONTHLY,
  GOOGLE_PLAY_BASE_PLAN_ANNUAL,
]);

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ANDROID_PUBLISHER_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

/** SubscriptionPurchaseV2.subscriptionState 枚举（Google 文档值）。 */
export type GooglePlaySubscriptionState =
  | 'SUBSCRIPTION_STATE_UNSPECIFIED'
  | 'SUBSCRIPTION_STATE_PENDING'
  | 'SUBSCRIPTION_STATE_ACTIVE'
  | 'SUBSCRIPTION_STATE_PAUSED'
  | 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
  | 'SUBSCRIPTION_STATE_ON_HOLD'
  | 'SUBSCRIPTION_STATE_CANCELED'
  | 'SUBSCRIPTION_STATE_EXPIRED';

export type GooglePlayLineItem = {
  productId?: string;
  expiryTime?: string;
  autoRenewingPlan?: {autoRenewEnabled?: boolean};
  offerDetails?: {basePlanId?: string; offerId?: string; offerTags?: string[]};
};

export type GooglePlaySubscriptionV2 = {
  subscriptionState?: GooglePlaySubscriptionState;
  lineItems?: GooglePlayLineItem[];
  latestOrderId?: string;
  linkedPurchaseToken?: string;
  acknowledgementState?: string;
  startTime?: string;
  regionCode?: string;
  testPurchase?: Record<string, unknown>;
};

export type ServiceAccount = {clientEmail: string; privateKey: string; projectId: string};

/**
 * 拆分式服务账号环境变量（替代单段 GOOGLE_PLAY_SERVICE_ACCOUNT_JSON）。
 * 原因：Netlify Functions 继承的全部 env 合计有 4KB 上限；整段 JSON（更何况 base64
 * 还会膨胀 ~33%）会把额度撑爆导致部署失败。拆成三个变量、私钥不再裹 JSON / base64，
 * 体积更小、可控。token_uri 固定为 OAUTH_TOKEN_URL，无需入 env。
 */
export const GOOGLE_PLAY_CLIENT_EMAIL_ENV = 'GOOGLE_PLAY_CLIENT_EMAIL';
export const GOOGLE_PLAY_PRIVATE_KEY_ENV = 'GOOGLE_PLAY_PRIVATE_KEY';
export const GOOGLE_PLAY_PROJECT_ID_ENV = 'GOOGLE_PLAY_PROJECT_ID';
export const GOOGLE_PLAY_BILLING_ENABLED_ENV = 'google_play_billing_enabled';

/** 三个必需变量名，供 handler 做 missing-env 检查与诊断（不含取值）。 */
export const GOOGLE_PLAY_SA_ENV_VARS = [
  GOOGLE_PLAY_CLIENT_EMAIL_ENV,
  GOOGLE_PLAY_PRIVATE_KEY_ENV,
  GOOGLE_PLAY_PROJECT_ID_ENV,
] as const;

export function isGooglePlayBillingEnabled(): boolean {
  const value =
    process.env[GOOGLE_PLAY_BILLING_ENABLED_ENV]?.trim().toLowerCase() ??
    process.env.GOOGLE_PLAY_BILLING_ENABLED?.trim().toLowerCase() ??
    '';
  return value === 'true' || value === '1' || value === 'yes';
}

/**
 * 从三个独立环境变量构造服务账号凭据。任一缺失返回 null（调用方据此返回 503，绝不打印 private_key）。
 * GOOGLE_PLAY_PRIVATE_KEY 常以 `\n` 转义单行保存，这里还原成真实换行供 crypto 使用。
 */
export function loadServiceAccount(): ServiceAccount | null {
  const clientEmail = process.env[GOOGLE_PLAY_CLIENT_EMAIL_ENV]?.trim() ?? '';
  const privateKey = (process.env[GOOGLE_PLAY_PRIVATE_KEY_ENV] ?? '').replace(/\\n/g, '\n').trim();
  const projectId = process.env[GOOGLE_PLAY_PROJECT_ID_ENV]?.trim() ?? '';
  if (!clientEmail || !privateKey || !projectId) return null;
  return {clientEmail, privateKey, projectId};
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** 用服务账号私钥签一个 RS256 JWT 断言，换取 androidpublisher scope 的 access token。 */
export async function fetchAccessToken(sa: ServiceAccount): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = {alg: 'RS256', typ: 'JWT'};
  const claims = {
    iss: sa.clientEmail,
    scope: ANDROID_PUBLISHER_SCOPE,
    aud: OAUTH_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(sa.privateKey);
  const assertion = `${signingInput}.${base64url(signature)}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: body.toString(),
  });

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    // 不打印 assertion / private_key；仅状态码与截断 body（Google 的 error/description 不含密钥）。
    throw new Error(`google_oauth_failed status=${res.status} body=${text.slice(0, 300)}`);
  }
  let parsed: {access_token?: string};
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('google_oauth_invalid_json');
  }
  const token = parsed.access_token?.trim();
  if (!token) throw new Error('google_oauth_missing_access_token');
  return token;
}

export type FetchSubscriptionResult =
  | {ok: true; data: GooglePlaySubscriptionV2; httpStatus: number}
  | {ok: false; httpStatus: number; bodySnippet: string};

/**
 * 调 purchases.subscriptionsv2.get。purchaseToken 仅在 URL path 出现（已 encode），
 * 不写入日志明文（token 本身视为敏感凭据）。
 */
export async function fetchSubscriptionV2(
  accessToken: string,
  packageName: string,
  purchaseToken: string,
): Promise<FetchSubscriptionResult> {
  const url = `${ANDROID_PUBLISHER_BASE}/applications/${encodeURIComponent(
    packageName,
  )}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {Authorization: `Bearer ${accessToken}`, Accept: 'application/json'},
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    return {ok: false, httpStatus: res.status, bodySnippet: text.slice(0, 300)};
  }
  let data: GooglePlaySubscriptionV2;
  try {
    data = JSON.parse(text);
  } catch {
    return {ok: false, httpStatus: res.status, bodySnippet: 'invalid_json'};
  }
  return {ok: true, data, httpStatus: res.status};
}

/** ACTIVE / IN_GRACE_PERIOD / CANCELED（已关续费但仍在有效期内）→ 视为应享有 Premium。 */
export function isEntitledState(state: GooglePlaySubscriptionState | undefined): boolean {
  return (
    state === 'SUBSCRIPTION_STATE_ACTIVE' ||
    state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' ||
    state === 'SUBSCRIPTION_STATE_CANCELED'
  );
}

/**
 * 在 lineItems 里挑出本订阅产品（cip_premium）且 base plan 属于允许集合的那一项。
 * 返回 null 表示购买与本产品/合法 base plan 不匹配（应判为校验失败）。
 */
export function pickPremiumLineItem(sub: GooglePlaySubscriptionV2): GooglePlayLineItem | null {
  const items = sub.lineItems ?? [];
  for (const item of items) {
    const productOk = item.productId === GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID;
    const basePlanId = item.offerDetails?.basePlanId ?? '';
    const basePlanOk = GOOGLE_PLAY_ALLOWED_BASE_PLANS.has(basePlanId);
    if (productOk && basePlanOk) return item;
  }
  return null;
}
