import type {Handler, HandlerEvent, HandlerResponse} from '@netlify/functions';
import {createSupabaseServiceClient} from './_shared/supabase-service';
import {userIdFromRequestBody} from './_shared/user-id';

const TABLE = 'user_membership';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** 安全诊断字段；不含密钥与 userId */
export type ReadMembershipDebug = {
  userIdPresent: boolean;
  supabaseConfigured: boolean;
  queryAttempted: boolean;
  table: string;
  missingEnv?: string[];
  queryPath?: 'user_id';
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
} | null) {
  return {
    ok: true as const,
    premiumUntil: row?.premium_until ?? null,
    membershipStatus: row?.membership_status ?? null,
    paymentProvider: row?.payment_provider ?? null,
    lastPaymentAt: row?.last_payment_at ?? null,
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

/**
 * 读取 public.user_membership（service role）。
 * Body: { userId }（Supabase Auth UUID）。仅按 user_id 查询，无行视为未开通 → HTTP 200 + ok:true + 全 null。
 */
export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === 'OPTIONS') {
    return {statusCode: 204, headers: corsHeaders, body: ''};
  }
  if (event.httpMethod !== 'POST') {
    return fail(405, 'METHOD_NOT_ALLOWED', 'POST required', {
      userIdPresent: false,
      supabaseConfigured: Boolean(
        process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
      ),
      queryAttempted: false,
      table: TABLE,
      missingEnv: collectMissingSupabaseEnv(),
    });
  }

  let body: {userId?: string};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return fail(400, 'INVALID_JSON', 'Invalid JSON body', {
      userIdPresent: false,
      supabaseConfigured: Boolean(
        process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
      ),
      queryAttempted: false,
      table: TABLE,
      missingEnv: collectMissingSupabaseEnv(),
    });
  }

  const userId = userIdFromRequestBody({userId: typeof body.userId === 'string' ? body.userId : undefined});
  const missingEnv = collectMissingSupabaseEnv();

  const baseDebug = (partial: Partial<ReadMembershipDebug> = {}): ReadMembershipDebug => ({
    userIdPresent: userId != null,
    supabaseConfigured: Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    queryAttempted: false,
    table: TABLE,
    missingEnv,
    ...partial,
  });

  if (!userId) {
    return fail(400, 'MISSING_USER', 'userId is required (Supabase Auth UUID)', baseDebug());
  }

  if (missingEnv.length > 0) {
    return fail(
      503,
      'SERVICE_ENV_INCOMPLETE',
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for Netlify Functions (VITE_* is not available server-side).',
      baseDebug({queryAttempted: false}),
    );
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return fail(503, 'SERVICE_ENV_INCOMPLETE', 'Could not create Supabase service client.', baseDebug());
  }

  const byUserId = await supabase
    .from(TABLE)
    .select('premium_until, membership_status, payment_provider, last_payment_at')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (byUserId.error) {
    console.error('[read-membership] user_id query', byUserId.error);
    return fail(
      503,
      'MEMBERSHIP_QUERY_FAILED',
      byUserId.error.message,
      baseDebug({
        queryAttempted: true,
        queryPath: 'user_id',
        errorMessage: byUserId.error.message,
        supabaseErrorCode: byUserId.error.code != null ? String(byUserId.error.code) : null,
      }),
      'Confirm public.user_membership exists and columns match supabase/membership-zpay-schema.sql.',
    );
  }

  return json(200, successBody(byUserId.data));
};
