import type {Handler, HandlerEvent, HandlerResponse} from '@netlify/functions';
import {createSupabaseServiceClient} from './_shared/supabase-service';
import {userIdFromRequestBody} from './_shared/user-id';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(statusCode: number, body: unknown): HandlerResponse {
  return {
    statusCode,
    headers: {'Content-Type': 'application/json', ...corsHeaders},
    body: JSON.stringify(body),
  };
}

/**
 * 读取 user_membership（service role）。
 * Body 传 userId（Supabase Auth UUID）。仍接受 authingUserId 字段名仅为旧客户端兼容（temporary）。
 * TODO: 用 Supabase JWT 校验调用方身份，避免仅依赖 body 中的 userId。
 */
export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === 'OPTIONS') {
    return {statusCode: 204, headers: corsHeaders, body: ''};
  }
  if (event.httpMethod !== 'POST') {
    return json(405, {error: 'METHOD_NOT_ALLOWED'});
  }

  let body: {userId?: string; authingUserId?: string};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, {error: 'INVALID_JSON'});
  }

  const userId = userIdFromRequestBody(body);
  if (!userId) {
    return json(400, {error: 'MISSING_USER', message: 'userId is required (Supabase Auth UUID)'});
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return json(503, {
      error: 'SUPABASE_NOT_CONFIGURED',
      message:
        'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Netlify function environment (service role is required to read user_membership).',
    });
  }

  const byUserId = await supabase
    .from('user_membership')
    .select('premium_until, membership_status, payment_provider, last_payment_at')
    .eq('user_id', userId)
    .maybeSingle();

  let data = byUserId.data;
  let error = byUserId.error;

  if (!data) {
    const byLegacy = await supabase
      .from('user_membership')
      .select('premium_until, membership_status, payment_provider, last_payment_at')
      .eq('authing_user_id', userId)
      .maybeSingle();
    data = byLegacy.data;
    if (byLegacy.error) error = byLegacy.error;
  }

  if (error) {
    console.error('[read-membership]', error);
    return json(503, {
      error: 'READ_FAILED',
      message: error.message,
      hint: 'Apply supabase/membership-zpay-schema.sql if the table is missing.',
    });
  }

  return json(200, {
    premiumUntil: data?.premium_until ?? null,
    membershipStatus: data?.membership_status ?? null,
    paymentProvider: data?.payment_provider ?? null,
    lastPaymentAt: data?.last_payment_at ?? null,
  });
};
