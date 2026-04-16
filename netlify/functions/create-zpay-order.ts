import type {Handler, HandlerEvent, HandlerResponse} from '@netlify/functions';
import {signZpayParams} from './_shared/zpay-crypto';
import {createSupabaseServiceClient} from './_shared/supabase-service';
import {userIdFromRequestBody} from './_shared/user-id';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PRICING: Record<number, {money: string; name: string}> = {
  30: {money: '39.00', name: 'Premium membership 30 days'},
  365: {money: '299.00', name: 'Premium membership 365 days'},
};

function json(statusCode: number, body: unknown): HandlerResponse {
  return {
    statusCode,
    headers: {'Content-Type': 'application/json', ...corsHeaders},
    body: JSON.stringify(body),
  };
}

function buildPayUrl(gateway: string, signed: Record<string, string>): string {
  const u = new URL(gateway);
  for (const [k, v] of Object.entries(signed)) {
    if (v === '' || v == null) continue;
    u.searchParams.set(k, v);
  }
  return u.toString();
}

export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === 'OPTIONS') {
    return {statusCode: 204, headers: corsHeaders, body: ''};
  }
  if (event.httpMethod !== 'POST') {
    return json(405, {error: 'METHOD_NOT_ALLOWED'});
  }

  const pid = process.env.ZPAY_PID?.trim();
  const key = process.env.ZPAY_KEY?.trim();
  const gateway = (process.env.ZPAY_GATEWAY || 'https://zpayz.cn/submit.php').trim();
  const notifyUrl = process.env.ZPAY_NOTIFY_URL?.trim();
  const returnUrl = process.env.ZPAY_RETURN_URL?.trim();

  if (!pid || !key) {
    return json(503, {error: 'ZPAY_NOT_CONFIGURED', message: 'Missing ZPAY_PID or ZPAY_KEY'});
  }
  if (!notifyUrl || !returnUrl) {
    return json(503, {error: 'ZPAY_URLS_NOT_CONFIGURED', message: 'Missing ZPAY_NOTIFY_URL or ZPAY_RETURN_URL'});
  }

  /** userId：Supabase Auth UUID。仍接受 body.authingUserId 仅为旧字段名兼容（temporary）。 */
  let body: {membershipDays?: number; userId?: string; authingUserId?: string};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, {error: 'INVALID_JSON'});
  }

  const membershipDays = body.membershipDays;
  const userId = userIdFromRequestBody(body);

  if (!userId) {
    return json(401, {error: 'AUTH_REQUIRED', message: 'userId is required (Supabase Auth UUID)'});
  }
  if (membershipDays !== 30 && membershipDays !== 365) {
    return json(400, {error: 'INVALID_MEMBERSHIP_DAYS'});
  }

  const tier = PRICING[membershipDays];
  const out_trade_no = `zp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return json(503, {error: 'SUPABASE_NOT_CONFIGURED'});
  }

  const {error: insertErr} = await supabase.from('membership_orders').insert({
    out_trade_no,
    user_id: userId,
    membership_days: membershipDays,
    amount_cny: tier.money,
    status: 'pending',
  });

  if (insertErr) {
    console.error('[create-zpay-order] insert failed', insertErr);
    return json(503, {
      error: 'ORDER_PERSIST_FAILED',
      message: insertErr.message,
      hint: 'Apply supabase/membership-zpay-schema.sql if the table is missing.',
    });
  }

  const signParams: Record<string, string> = {
    pid,
    type: 'wxpay',
    out_trade_no,
    notify_url: notifyUrl,
    return_url: returnUrl,
    name: tier.name,
    money: tier.money,
    param: out_trade_no,
    sign_type: 'MD5',
  };
  const sign = signZpayParams(signParams, key);
  const payParams = {...signParams, sign};
  const payUrl = buildPayUrl(gateway, payParams);

  return json(200, {payUrl});
};
