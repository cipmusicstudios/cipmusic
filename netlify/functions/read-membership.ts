/**
 * read-membership（JWT 收口版）
 *
 * 变更要点（安全整改 Phase：user state hardening）：
 *   - 不再信任 body 里任意 `userId`；旧字段保留接收但完全忽略，仅作为部署灰度期间的兼容占位。
 *   - 必须通过 `Authorization: Bearer <supabase-access-token>` 识别调用者；
 *     使用 service-role 客户端的 `auth.getUser(jwt)` 校验 token。
 *   - 仅按 JWT 对应的 `user.id` 查询 `public.user_membership`，无行视为未开通 → 200 + 全 null。
 *   - 匿名 / 无效 token → 401 UNAUTHENTICATED（结构化 JSON）。
 *
 * 非目标：本次仅修 `read-membership` 的认证漏洞，不改前端 UI、Stripe/ZPAY、Practice broker
 * 等其他链路；返回字段集保持与旧响应兼容。
 */
import type {Handler, HandlerEvent, HandlerResponse} from '@netlify/functions';
import {createSupabaseServiceClient} from './_shared/supabase-service';

const TABLE = 'user_membership';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** 安全诊断字段；不含密钥、token、userId */
export type ReadMembershipDebug = {
  userIdPresent: boolean;
  supabaseConfigured: boolean;
  queryAttempted: boolean;
  table: string;
  missingEnv?: string[];
  queryPath?: 'user_id';
  errorStage?: string;
  errorMessage?: string | null;
  supabaseErrorCode?: string | null;
};

function collectMissingSupabaseEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.SUPABASE_URL?.trim()) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return missing;
}

function json(statusCode: number, body: unknown): HandlerResponse {
  return {
    statusCode,
    headers: {'Content-Type': 'application/json', ...corsHeaders},
    body: JSON.stringify(body),
  };
}

function successBody(row: {
  premium_until: string | null;
  membership_status: string | null;
  payment_provider: string | null;
  last_payment_at: string | null;
  auto_renew: boolean | null;
  current_period_end: string | null;
  stripe_subscription_status: string | null;
  cancel_at_period_end: boolean | null;
  last_payment_status: string | null;
  payment_failure_at: string | null;
} | null) {
  return {
    ok: true as const,
    premiumUntil: row?.premium_until ?? null,
    membershipStatus: row?.membership_status ?? null,
    paymentProvider: row?.payment_provider ?? null,
    lastPaymentAt: row?.last_payment_at ?? null,
    autoRenew: row?.auto_renew ?? null,
    currentPeriodEnd: row?.current_period_end ?? null,
    stripeSubscriptionStatus: row?.stripe_subscription_status ?? null,
    cancelAtPeriodEnd: row?.cancel_at_period_end ?? null,
    lastPaymentStatus: row?.last_payment_status ?? null,
    paymentFailureAt: row?.payment_failure_at ?? null,
  };
}

function fail(
  status: number,
  code: string,
  message: string,
  debug: ReadMembershipDebug,
  hint?: string,
): HandlerResponse {
  return json(status, {
    ok: false,
    code,
    error: code,
    message,
    ...(hint ? {hint} : {}),
    debug,
  });
}

function parseAuthHeader(event: HandlerEvent): string | null {
  const headers = event.headers ?? {};
  const raw =
    headers['authorization'] ||
    headers['Authorization'] ||
    (headers as Record<string, string | undefined>)['AUTHORIZATION'];
  if (!raw || typeof raw !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!m) return null;
  const token = m[1].trim();
  return token || null;
}

function logLine(fields: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v == null) {
      safe[k] = v;
    }
  }
  console.log('[read-membership]', JSON.stringify(safe));
}

/**
 * 读取 public.user_membership（service role），仅返回 JWT 对应用户自己的行。
 * Body：仅忽略字段（保留兼容）；用户身份严格来自 Authorization header。
 */
export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === 'OPTIONS') {
    return {statusCode: 204, headers: corsHeaders, body: ''};
  }

  const missingEnv = collectMissingSupabaseEnv();
  const hasAuthHeader = Boolean(parseAuthHeader(event));
  const baseDebug = (partial: Partial<ReadMembershipDebug> = {}): ReadMembershipDebug => ({
    userIdPresent: false,
    supabaseConfigured: Boolean(
      process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    ),
    queryAttempted: false,
    table: TABLE,
    missingEnv,
    ...partial,
  });

  if (event.httpMethod !== 'POST') {
    return fail(405, 'METHOD_NOT_ALLOWED', 'POST required', baseDebug());
  }

  /** Body 仅用于 schema 检查；其内容不参与鉴权/查询。 */
  try {
    JSON.parse(event.body || '{}');
  } catch {
    logLine({stage: 'invalid_json', hasAuthHeader, ok: false});
    return fail(400, 'INVALID_JSON', 'Invalid JSON body', baseDebug({errorStage: 'invalid_json'}));
  }

  const token = parseAuthHeader(event);
  if (!token) {
    logLine({stage: 'no_bearer', hasAuthHeader, ok: false});
    return fail(
      401,
      'UNAUTHENTICATED',
      'Missing Authorization: Bearer <supabase_access_token>',
      baseDebug({errorStage: 'no_bearer'}),
    );
  }

  if (missingEnv.length > 0) {
    logLine({stage: 'env_incomplete', hasAuthHeader, ok: false});
    return fail(
      503,
      'SERVICE_ENV_INCOMPLETE',
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for Netlify Functions (VITE_* is not available server-side).',
      baseDebug({errorStage: 'env_incomplete'}),
    );
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    logLine({stage: 'no_service_client', hasAuthHeader, ok: false});
    return fail(
      503,
      'SERVICE_ENV_INCOMPLETE',
      'Could not create Supabase service client.',
      baseDebug({errorStage: 'no_service_client'}),
    );
  }

  const userRes = await supabase.auth.getUser(token);
  if (userRes.error || !userRes.data?.user?.id) {
    logLine({
      stage: 'jwt_invalid',
      hasAuthHeader,
      authOk: false,
      ok: false,
      errorMessage: userRes.error?.message ?? null,
    });
    return fail(
      401,
      'INVALID_SESSION',
      'Supabase access token could not be verified',
      baseDebug({
        errorStage: 'jwt_invalid',
        errorMessage: userRes.error?.message ?? null,
      }),
    );
  }
  const userId = userRes.data.user.id;

  const byUserId = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (byUserId.error) {
    console.error('[read-membership] user_id query', byUserId.error);
    logLine({
      stage: 'query_failed',
      hasAuthHeader,
      authOk: true,
      resolvedUserId: userId,
      ok: false,
      errorMessage: byUserId.error.message,
    });
    return fail(
      503,
      'MEMBERSHIP_QUERY_FAILED',
      byUserId.error.message,
      baseDebug({
        userIdPresent: true,
        queryAttempted: true,
        queryPath: 'user_id',
        errorStage: 'query_failed',
        errorMessage: byUserId.error.message,
        supabaseErrorCode: byUserId.error.code != null ? String(byUserId.error.code) : null,
      }),
      'Confirm public.user_membership exists and columns match supabase/membership-zpay-schema.sql plus supabase/membership-stripe-schema.sql.',
    );
  }

  logLine({
    stage: 'ok',
    hasAuthHeader,
    authOk: true,
    resolvedUserId: userId,
    ok: true,
    rowFound: byUserId.data != null,
  });
  return json(200, successBody(byUserId.data));
};
