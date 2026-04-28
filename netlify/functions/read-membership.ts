import type {Handler, HandlerEvent, HandlerResponse} from '@netlify/functions';
import {createSupabaseServiceClient} from './_shared/supabase-service';

const TABLE = 'user_membership';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** 安全诊断字段；不含密钥、token 与 userId */
export type ReadMembershipDebug = {
  hasAuthHeader: boolean;
  authValid: boolean;
  supabaseConfigured: boolean;
  queryAttempted: boolean;
  table: string;
  missingEnv?: string[];
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

/**
 * Phase B2 安全收口：仅返回前端 UI 真正需要的字段。
 * 故意丢弃：paymentProvider / lastPaymentAt / stripeSubscriptionStatus
 * / lastPaymentStatus / paymentFailureAt 等支付内部状态字段，避免 JWT 鉴权后仍超额泄露。
 */
function successBody(
  userId: string,
  row:
    | {
        premium_until: string | null;
        membership_status: string | null;
        auto_renew: boolean | null;
        current_period_end: string | null;
      }
    | null,
) {
  return {
    ok: true as const,
    userId,
    membershipStatus: row?.membership_status ?? null,
    premiumUntil: row?.premium_until ?? null,
    currentPeriodEnd: row?.current_period_end ?? null,
    autoRenew: row?.auto_renew ?? null,
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
 * Phase B1 安全收口：必须 `Authorization: Bearer <supabase_access_token>`。
 * `userId` 仅来自 Supabase 校验通过的 JWT，绝不信任 body.userId，杜绝任意 UUID 枚举他人会员状态。
 */
export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === 'OPTIONS') {
    return {statusCode: 204, headers: corsHeaders, body: ''};
  }

  const baseDebug = (partial: Partial<ReadMembershipDebug> = {}): ReadMembershipDebug => ({
    hasAuthHeader: false,
    authValid: false,
    supabaseConfigured: Boolean(
      process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    ),
    queryAttempted: false,
    table: TABLE,
    missingEnv: collectMissingSupabaseEnv(),
    ...partial,
  });

  if (event.httpMethod !== 'POST') {
    return fail(405, 'METHOD_NOT_ALLOWED', 'POST required', baseDebug({errorStage: 'wrong_method'}));
  }

  const token = parseAuthHeader(event);
  if (!token) {
    logLine({stage: 'no_bearer', ok: false});
    return fail(
      401,
      'UNAUTHENTICATED',
      'Missing Authorization: Bearer <supabase_access_token>',
      baseDebug({errorStage: 'no_bearer'}),
    );
  }

  const missingEnv = collectMissingSupabaseEnv();
  if (missingEnv.length > 0) {
    logLine({stage: 'env_missing', ok: false});
    return fail(
      503,
      'SERVICE_ENV_INCOMPLETE',
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for Netlify Functions (VITE_* is not available server-side).',
      baseDebug({hasAuthHeader: true, errorStage: 'env_missing'}),
    );
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    logLine({stage: 'no_service_client', ok: false});
    return fail(
      503,
      'SERVICE_ENV_INCOMPLETE',
      'Could not create Supabase service client.',
      baseDebug({hasAuthHeader: true, errorStage: 'no_service_client'}),
    );
  }

  const userRes = await supabase.auth.getUser(token);
  if (userRes.error || !userRes.data?.user?.id) {
    logLine({stage: 'jwt_invalid', ok: false});
    return fail(
      401,
      'INVALID_SESSION',
      'Supabase access token could not be verified.',
      baseDebug({
        hasAuthHeader: true,
        errorStage: 'jwt_invalid',
        errorMessage: userRes.error?.message ?? null,
      }),
    );
  }

  const userId = userRes.data.user.id;

  const byUserId = await supabase
    .from(TABLE)
    .select('premium_until, membership_status, auto_renew, current_period_end')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (byUserId.error) {
    console.error('[read-membership] user_id query', byUserId.error);
    logLine({stage: 'membership_query_failed', ok: false});
    return fail(
      503,
      'MEMBERSHIP_QUERY_FAILED',
      byUserId.error.message,
      baseDebug({
        hasAuthHeader: true,
        authValid: true,
        queryAttempted: true,
        errorStage: 'membership_query_failed',
        errorMessage: byUserId.error.message,
        supabaseErrorCode: byUserId.error.code != null ? String(byUserId.error.code) : null,
      }),
      'Confirm public.user_membership exists and columns match supabase/membership-zpay-schema.sql plus supabase/membership-stripe-schema.sql.',
    );
  }

  logLine({
    stage: 'ok',
    ok: true,
    membershipFound: byUserId.data != null,
  });
  return json(200, successBody(userId, byUserId.data));
};
