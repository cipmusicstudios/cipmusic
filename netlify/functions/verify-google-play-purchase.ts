import type {Handler, HandlerEvent, HandlerResponse} from '@netlify/functions';
import {createSupabaseServiceClient} from './_shared/supabase-service';
import {
  GOOGLE_PLAY_PACKAGE_NAME,
  GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID,
  GOOGLE_PLAY_ALLOWED_BASE_PLANS,
  GOOGLE_PLAY_SA_ENV_VARS,
  fetchAccessToken,
  fetchSubscriptionV2,
  isEntitledState,
  isGooglePlayBillingEnabled,
  loadServiceAccount,
  pickPremiumLineItem,
} from './_shared/google-play';

const MEMBERSHIP_TABLE = 'user_membership';
const PURCHASES_TABLE = 'membership_google_play_purchases';
const PROVIDER = 'google_play';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** 仅含可对外返回的诊断字段；绝不含 purchaseToken / access token / userId 原文 / private_key。 */
type VerifyDebug = {
  missingEnv: string[];
  hasAuthHeader: boolean;
  authValid: boolean;
  supabaseConfigured: boolean;
  serviceAccountConfigured: boolean;
  productIdMatched: boolean | null;
  basePlanMatched: boolean | null;
  subscriptionState: string | null;
  entitled: boolean | null;
  errorStage?: string;
};

function collectMissingEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.SUPABASE_URL?.trim()) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  for (const name of GOOGLE_PLAY_SA_ENV_VARS) {
    if (!process.env[name]?.trim()) missing.push(name);
  }
  return missing;
}

function json(statusCode: number, body: unknown): HandlerResponse {
  return {
    statusCode,
    headers: {'Content-Type': 'application/json', ...corsHeaders},
    body: JSON.stringify(body),
  };
}

function fail(status: number, code: string, message: string, debug: VerifyDebug): HandlerResponse {
  return json(status, {ok: false, code, error: code, message, debug});
}

function parseBearer(event: HandlerEvent): string | null {
  const headers = event.headers ?? {};
  const raw = headers['authorization'] || headers['Authorization'];
  if (!raw || typeof raw !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  const token = m?.[1]?.trim();
  return token || null;
}

function laterIso(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = a ? new Date(a).getTime() : NaN;
  const tb = b ? new Date(b).getTime() : NaN;
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? null : b ?? null;
  if (Number.isNaN(tb)) return a ?? null;
  return ta >= tb ? a ?? null : b ?? null;
}

/**
 * 安全收口（对齐 read-membership Phase B）：
 *  - 必须 `Authorization: Bearer <supabase_access_token>`；userId 仅来自校验通过的 JWT，
 *    绝不信任 body 里的任何 user 标识。
 *  - 客户端只传 `purchaseToken`（必填）与可选 `productId`（仅用于日志/早退，最终以 Google 返回为准）。
 *  - 所有 product / base plan / 到期 / 状态判定都基于 Google subscriptionsv2 响应。
 */
export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === 'OPTIONS') {
    return {statusCode: 204, headers: corsHeaders, body: ''};
  }

  const baseDebug = (partial: Partial<VerifyDebug> = {}): VerifyDebug => ({
    missingEnv: collectMissingEnv(),
    hasAuthHeader: Boolean(event.headers?.authorization || event.headers?.Authorization),
    authValid: false,
    supabaseConfigured: Boolean(
      process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    ),
    serviceAccountConfigured: GOOGLE_PLAY_SA_ENV_VARS.every(name => Boolean(process.env[name]?.trim())),
    productIdMatched: null,
    basePlanMatched: null,
    subscriptionState: null,
    entitled: null,
    ...partial,
  });

  if (event.httpMethod !== 'POST') {
    return fail(405, 'METHOD_NOT_ALLOWED', 'POST required', baseDebug({errorStage: 'wrong_method'}));
  }

  if (!isGooglePlayBillingEnabled()) {
    return fail(
      503,
      'GOOGLE_PLAY_BILLING_DISABLED',
      'Google Play Billing verification is temporarily disabled',
      baseDebug({errorStage: 'feature_disabled'}),
    );
  }

  const token = parseBearer(event);
  if (!token) {
    return fail(
      401,
      'UNAUTHENTICATED',
      'Missing Authorization: Bearer <supabase_access_token>',
      baseDebug({errorStage: 'no_bearer'}),
    );
  }

  let body: {purchaseToken?: string; productId?: string};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return fail(400, 'INVALID_JSON', 'Request body must be JSON', baseDebug({errorStage: 'bad_json'}));
  }

  const purchaseToken = typeof body.purchaseToken === 'string' ? body.purchaseToken.trim() : '';
  if (!purchaseToken) {
    return fail(
      400,
      'MISSING_PURCHASE_TOKEN',
      'purchaseToken is required',
      baseDebug({errorStage: 'missing_purchase_token'}),
    );
  }

  const missingEnv = collectMissingEnv();
  if (missingEnv.length > 0) {
    return fail(
      503,
      'SERVICE_ENV_INCOMPLETE',
      `Missing server env: ${missingEnv.join(', ')}`,
      baseDebug({hasAuthHeader: true, errorStage: 'env_missing'}),
    );
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return fail(
      503,
      'SERVICE_ENV_INCOMPLETE',
      'Could not create Supabase service client',
      baseDebug({hasAuthHeader: true, errorStage: 'no_service_client'}),
    );
  }

  // 1) 校验 JWT，取 userId（绝不信任客户端 user 标识）。
  const userRes = await supabase.auth.getUser(token);
  if (userRes.error || !userRes.data?.user?.id) {
    return fail(
      401,
      'INVALID_SESSION',
      'Supabase access token could not be verified',
      baseDebug({hasAuthHeader: true, errorStage: 'jwt_invalid'}),
    );
  }
  const userId = userRes.data.user.id;

  // 2) 服务账号 → access token → Google Play subscriptionsv2.get。
  const sa = loadServiceAccount();
  if (!sa) {
    console.error('[verify-google-play-purchase] service account not configured/parseable');
    return fail(
      503,
      'GOOGLE_PLAY_NOT_CONFIGURED',
      `Missing or invalid Google Play service-account env (${GOOGLE_PLAY_SA_ENV_VARS.join(', ')})`,
      baseDebug({hasAuthHeader: true, authValid: true, errorStage: 'sa_invalid'}),
    );
  }

  let accessToken: string;
  try {
    accessToken = await fetchAccessToken(sa);
  } catch (e) {
    console.error('[verify-google-play-purchase] oauth failed', e instanceof Error ? e.message : e);
    return fail(
      502,
      'GOOGLE_AUTH_FAILED',
      'Failed to obtain Google API access token',
      baseDebug({hasAuthHeader: true, authValid: true, errorStage: 'google_oauth'}),
    );
  }

  const subRes = await fetchSubscriptionV2(accessToken, GOOGLE_PLAY_PACKAGE_NAME, purchaseToken);
  if (!subRes.ok) {
    console.warn('[verify-google-play-purchase] subscriptionsv2 lookup failed', {
      userId,
      httpStatus: subRes.httpStatus,
      bodySnippet: subRes.bodySnippet,
    });
    // 404/410 → token 无效或不属于本应用；其余视为上游错误。
    const invalidToken = subRes.httpStatus === 404 || subRes.httpStatus === 410 || subRes.httpStatus === 400;
    return fail(
      invalidToken ? 400 : 502,
      invalidToken ? 'PURCHASE_NOT_FOUND' : 'GOOGLE_API_ERROR',
      invalidToken
        ? 'Purchase token not found for this application'
        : 'Google Play Developer API error',
      baseDebug({hasAuthHeader: true, authValid: true, errorStage: 'subscriptionsv2'}),
    );
  }

  const sub = subRes.data;
  const subscriptionState = sub.subscriptionState ?? null;

  // 3) 校验 product + base plan（必须是 cip_premium 且 monthly-599 / annual-4999）。
  const lineItem = pickPremiumLineItem(sub);
  const productIdMatched = (sub.lineItems ?? []).some(
    li => li.productId === GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID,
  );
  const basePlanMatched = lineItem != null;
  if (!lineItem) {
    console.warn('[verify-google-play-purchase] product/base-plan mismatch', {
      userId,
      productIdMatched,
      basePlans: (sub.lineItems ?? []).map(li => li.offerDetails?.basePlanId ?? null),
      allowed: Array.from(GOOGLE_PLAY_ALLOWED_BASE_PLANS),
    });
    return fail(
      400,
      'PRODUCT_MISMATCH',
      `Purchase is not for ${GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID} with an allowed base plan`,
      baseDebug({
        hasAuthHeader: true,
        authValid: true,
        productIdMatched,
        basePlanMatched,
        subscriptionState,
        errorStage: 'product_mismatch',
      }),
    );
  }

  const basePlanId = lineItem.offerDetails?.basePlanId ?? null;
  const expiryTime = lineItem.expiryTime ?? null;
  const entitled = isEntitledState(sub.subscriptionState) && Boolean(expiryTime);
  const latestOrderId = sub.latestOrderId ?? null;
  const autoRenew = lineItem.autoRenewingPlan?.autoRenewEnabled ?? null;
  const nowIso = new Date().toISOString();

  // 4) 幂等记录购买（唯一键 purchase_token）。重复校验 = upsert，不会重复发放。
  const {error: purchaseErr} = await supabase.from(PURCHASES_TABLE).upsert(
    {
      purchase_token: purchaseToken,
      user_id: userId,
      package_name: GOOGLE_PLAY_PACKAGE_NAME,
      product_id: GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID,
      base_plan_id: basePlanId,
      latest_order_id: latestOrderId,
      subscription_state: subscriptionState,
      expiry_time: expiryTime,
      auto_renew: autoRenew,
      acknowledgement_state: sub.acknowledgementState ?? null,
      linked_purchase_token: sub.linkedPurchaseToken ?? null,
      raw_response: sub,
      last_verified_at: nowIso,
    },
    {onConflict: 'purchase_token'},
  );
  if (purchaseErr) {
    console.error('[verify-google-play-purchase] purchase upsert failed', {
      userId,
      error: purchaseErr.message,
    });
    return fail(
      503,
      'PURCHASE_PERSIST_FAILED',
      purchaseErr.message,
      baseDebug({
        hasAuthHeader: true,
        authValid: true,
        productIdMatched,
        basePlanMatched,
        subscriptionState,
        entitled,
        errorStage: 'purchase_upsert',
      }),
    );
  }

  if (!entitled) {
    // 非有效状态（PENDING / ON_HOLD / PAUSED / EXPIRED）：已记录购买，但不发放/不延长会员。
    // 返回**失败**（ok:false, 402），与移动端契约一致：客户端仅在 `ok === true` 时才
    // finishTransaction(=acknowledge)。若这里返回 ok:true，客户端会确认一笔未发放 Premium 的
    // 购买，破坏「未发放就不确认、让 Google 自动退款 / 下次重试」的安全设计。
    console.warn('[verify-google-play-purchase] not entitled, recorded only', {
      userId,
      subscriptionState,
      basePlanId,
    });
    return fail(
      402,
      'SUBSCRIPTION_NOT_ACTIVE',
      `Subscription not active (state=${subscriptionState ?? 'unknown'})`,
      baseDebug({
        hasAuthHeader: true,
        authValid: true,
        productIdMatched,
        basePlanMatched,
        subscriptionState,
        entitled: false,
        errorStage: 'not_entitled',
      }),
    );
  }

  // 5) 统一会员发放：premium_until 取「现有」与「Google 到期」中的较晚者，
  //    避免缩短其它渠道（如 Stripe 年付）已有的有效期。premium_until 为绝对时间，
  //    重复校验天然幂等（不像 ZPay 那样累加天数）。
  const {data: existing, error: readErr} = await supabase
    .from(MEMBERSHIP_TABLE)
    .select('premium_until')
    .eq('user_id', userId)
    .maybeSingle();
  if (readErr) {
    console.error('[verify-google-play-purchase] read membership failed', readErr.message);
    return fail(
      503,
      'MEMBERSHIP_QUERY_FAILED',
      readErr.message,
      baseDebug({
        hasAuthHeader: true,
        authValid: true,
        productIdMatched,
        basePlanMatched,
        subscriptionState,
        entitled,
        errorStage: 'membership_read',
      }),
    );
  }

  const newPremiumUntil = laterIso(existing?.premium_until ?? null, expiryTime);

  const {error: upsertErr} = await supabase.from(MEMBERSHIP_TABLE).upsert(
    {
      user_id: userId,
      premium_until: newPremiumUntil,
      // current_period_end 反映本次 Google 订阅的本期到期，供 read-membership → 移动端展示
      // 「续费 / 到期日」；与 Stripe / 草案契约保持一致。
      current_period_end: expiryTime,
      membership_status: 'premium',
      payment_provider: PROVIDER,
      last_payment_at: nowIso,
      auto_renew: autoRenew,
    },
    {onConflict: 'user_id'},
  );
  if (upsertErr) {
    console.error('[verify-google-play-purchase] membership upsert failed', {
      userId,
      error: upsertErr.message,
    });
    return fail(
      503,
      'MEMBERSHIP_UPSERT_FAILED',
      upsertErr.message,
      baseDebug({
        hasAuthHeader: true,
        authValid: true,
        productIdMatched,
        basePlanMatched,
        subscriptionState,
        entitled,
        errorStage: 'membership_upsert',
      }),
    );
  }

  console.log('[verify-google-play-purchase] membership granted', {
    userId,
    basePlanId,
    subscriptionState,
    previousPremiumUntil: existing?.premium_until ?? null,
    newPremiumUntil,
  });

  return json(200, {
    ok: true,
    entitled: true,
    provider: PROVIDER,
    subscriptionState,
    productId: GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID,
    basePlanId,
    premiumUntil: newPremiumUntil,
    autoRenew,
  });
};
