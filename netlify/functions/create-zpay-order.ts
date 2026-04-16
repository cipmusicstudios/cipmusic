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

/** 仅含可对外返回的诊断字段，不包含任何密钥或 userId 原文 */
export type CreateZpayOrderDebug = {
  missingEnv: string[];
  userIdPresent: boolean;
  membershipDays: number | null;
  membershipDaysValid: boolean;
  supabaseConfigured: boolean;
  supabaseInsertAttempted: boolean;
  supabaseInsertOk: boolean | null;
  supabaseInsertError: string | null;
  zpaySignGenerated: boolean | null;
  payUrlGenerated: boolean | null;
};

function collectMissingEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.ZPAY_PID?.trim()) missing.push('ZPAY_PID');
  if (!process.env.ZPAY_KEY?.trim()) missing.push('ZPAY_KEY');
  if (!process.env.ZPAY_NOTIFY_URL?.trim()) missing.push('ZPAY_NOTIFY_URL');
  if (!process.env.ZPAY_RETURN_URL?.trim()) missing.push('ZPAY_RETURN_URL');
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

function buildPayUrl(gateway: string, signed: Record<string, string>): string {
  const u = new URL(gateway);
  for (const [k, v] of Object.entries(signed)) {
    if (v === '' || v == null) continue;
    u.searchParams.set(k, v);
  }
  return u.toString();
}

function debugSnapshot(opts: {
  membershipDays: number | null;
  userIdPresent: boolean;
  partial?: Partial<CreateZpayOrderDebug>;
}): CreateZpayOrderDebug {
  const md = opts.membershipDays;
  const partial = opts.partial ?? {};
  return {
    missingEnv: collectMissingEnv(),
    userIdPresent: opts.userIdPresent,
    membershipDays: md,
    membershipDaysValid: md === 30 || md === 365,
    supabaseConfigured: Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    supabaseInsertAttempted: false,
    supabaseInsertOk: null,
    supabaseInsertError: null,
    zpaySignGenerated: null,
    payUrlGenerated: null,
    ...partial,
  };
}

export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === 'OPTIONS') {
    return {statusCode: 204, headers: corsHeaders, body: ''};
  }
  if (event.httpMethod !== 'POST') {
    return json(405, {
      error: 'METHOD_NOT_ALLOWED',
      debug: debugSnapshot({membershipDays: null, userIdPresent: false}),
    });
  }

  const gateway = (process.env.ZPAY_GATEWAY || 'https://zpayz.cn/submit.php').trim();
  const pid = process.env.ZPAY_PID?.trim();
  const key = process.env.ZPAY_KEY?.trim();
  const notifyUrl = process.env.ZPAY_NOTIFY_URL?.trim();
  const returnUrl = process.env.ZPAY_RETURN_URL?.trim();

  /** userId：Supabase Auth UUID。仍接受 body.authingUserId 仅为旧字段名兼容（temporary）。 */
  let body: {membershipDays?: number; userId?: string; authingUserId?: string};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, {
      error: 'INVALID_JSON',
      debug: debugSnapshot({membershipDays: null, userIdPresent: false}),
    });
  }

  const membershipDays = body.membershipDays;
  const userId = userIdFromRequestBody(body);
  const missingEnv = collectMissingEnv();

  const baseDebug = (partial: Partial<CreateZpayOrderDebug> = {}): CreateZpayOrderDebug =>
    debugSnapshot({
      membershipDays: typeof membershipDays === 'number' ? membershipDays : null,
      userIdPresent: userId != null,
      partial,
    });

  if (missingEnv.length > 0) {
    const zpayCredMissing = !process.env.ZPAY_PID?.trim() || !process.env.ZPAY_KEY?.trim();
    const urlsMissing = !process.env.ZPAY_NOTIFY_URL?.trim() || !process.env.ZPAY_RETURN_URL?.trim();
    const error = zpayCredMissing
      ? 'ZPAY_NOT_CONFIGURED'
      : urlsMissing
        ? 'ZPAY_URLS_NOT_CONFIGURED'
        : 'SERVICE_ENV_INCOMPLETE';
    const message = zpayCredMissing
      ? 'Missing ZPAY_PID or ZPAY_KEY'
      : urlsMissing
        ? 'Missing ZPAY_NOTIFY_URL or ZPAY_RETURN_URL'
        : 'Missing required environment variables';
    return json(503, {
      error,
      message,
      debug: baseDebug(),
    });
  }

  if (!userId) {
    return json(401, {
      error: 'AUTH_REQUIRED',
      message: 'userId is required (Supabase Auth UUID)',
      debug: baseDebug(),
    });
  }
  if (membershipDays !== 30 && membershipDays !== 365) {
    return json(400, {
      error: 'INVALID_MEMBERSHIP_DAYS',
      message: 'membershipDays must be 30 or 365',
      debug: baseDebug(),
    });
  }

  const tier = PRICING[membershipDays];
  const out_trade_no = `zp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return json(503, {
      error: 'SUPABASE_NOT_CONFIGURED',
      message: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
      debug: baseDebug(),
    });
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
      debug: baseDebug({
        supabaseInsertAttempted: true,
        supabaseInsertOk: false,
        supabaseInsertError: insertErr.message || String(insertErr.code ?? 'insert_error'),
      }),
    });
  }

  const signParams: Record<string, string> = {
    pid: pid!,
    type: 'wxpay',
    out_trade_no,
    notify_url: notifyUrl,
    return_url: returnUrl,
    name: tier.name,
    money: tier.money,
    param: out_trade_no,
    sign_type: 'MD5',
  };

  let payUrl: string;
  try {
    const sign = signZpayParams(signParams, key!);
    const payParams = {...signParams, sign};
    payUrl = buildPayUrl(gateway, payParams);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[create-zpay-order] pay URL build failed', e);
    return json(500, {
      error: 'PAY_URL_BUILD_FAILED',
      message: msg,
      debug: baseDebug({
        supabaseInsertAttempted: true,
        supabaseInsertOk: true,
        supabaseInsertError: null,
        zpaySignGenerated: false,
        payUrlGenerated: false,
      }),
    });
  }

  return json(200, {payUrl});
};
