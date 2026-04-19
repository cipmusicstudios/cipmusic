import type {Handler, HandlerEvent, HandlerResponse} from '@netlify/functions';
import {verifyZpayNotify} from './_shared/zpay-crypto';
import {createSupabaseServiceClient} from './_shared/supabase-service';
import {isUuidString} from './_shared/user-id';

function textResponse(statusCode: number, body: string): HandlerResponse {
  return {
    statusCode,
    headers: {'Content-Type': 'text/plain; charset=utf-8'},
    body,
  };
}

function parseFormBody(event: HandlerEvent): Record<string, string> {
  const raw = event.body || '';
  const decoded = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  return Object.fromEntries(new URLSearchParams(decoded));
}

function moneyMatches(orderAmount: string, notifyMoney: string): boolean {
  const a = Number(orderAmount);
  const b = Number(notifyMoney);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) < 0.001;
}

/**
 * 调试用快照：剥掉 sign 与 sign_type，避免把 MD5 签名贴进 Netlify log。
 * 用途仅限 ZPay notify 的逐步骤诊断，不参与签名校验、不影响业务返回。
 */
function safeNotifySnapshot(params: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === 'sign' || k === 'sign_type') continue;
    out[k] = v;
  }
  return out;
}

export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod !== 'POST') {
    return textResponse(405, 'fail');
  }

  const key = process.env.ZPAY_KEY?.trim();
  if (!key) {
    console.error('[zpay-notify] ZPAY_KEY missing');
    return textResponse(500, 'fail');
  }

  const params = parseFormBody(event);
  const signValid = verifyZpayNotify(params, key);

  console.log('[zpay-notify] received', {
    out_trade_no: params.out_trade_no ?? null,
    trade_no: params.trade_no ?? null,
    money: params.money ?? null,
    trade_status: params.trade_status ?? null,
    name: params.name ?? null,
    signValid,
    paramKeys: Object.keys(safeNotifySnapshot(params)).sort(),
  });

  if (!signValid) {
    console.warn('[zpay-notify] bad sign', {out_trade_no: params.out_trade_no ?? null});
    return textResponse(400, 'fail');
  }

  if (params.trade_status !== 'TRADE_SUCCESS') {
    console.log('[zpay-notify] non-success trade_status, ack only', {
      out_trade_no: params.out_trade_no ?? null,
      trade_status: params.trade_status ?? null,
    });
    return textResponse(200, 'success');
  }

  const out_trade_no = params.out_trade_no;
  if (!out_trade_no) {
    console.warn('[zpay-notify] missing out_trade_no');
    return textResponse(400, 'fail');
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    console.error('[zpay-notify] supabase not configured');
    return textResponse(500, 'fail');
  }

  const {data: order, error: orderErr} = await supabase
    .from('membership_orders')
    .select('*')
    .eq('out_trade_no', out_trade_no)
    .maybeSingle();

  console.log('[zpay-notify] order lookup', {
    out_trade_no,
    orderFound: Boolean(order),
    orderId: order?.id ?? null,
    orderStatus: order?.status ?? null,
    orderAmountCny: order?.amount_cny ?? null,
    orderMembershipDays: order?.membership_days ?? null,
    orderUserId: order?.user_id ?? null,
    lookupError: orderErr?.message ?? null,
  });

  if (orderErr || !order) {
    console.error('[zpay-notify] order not found', {out_trade_no, error: orderErr?.message ?? null});
    return textResponse(404, 'fail');
  }

  const moneyOk = moneyMatches(String(order.amount_cny), String(params.money ?? ''));
  if (!moneyOk) {
    console.warn('[zpay-notify] money mismatch', {
      out_trade_no,
      orderAmount: order.amount_cny,
      notifyMoney: params.money ?? null,
    });
    return textResponse(400, 'fail');
  }

  if (order.status === 'paid') {
    console.log('[zpay-notify] order already paid, ack idempotent', {out_trade_no});
    return textResponse(200, 'success');
  }

  const days = Number(order.membership_days);
  if (days !== 30 && days !== 365) {
    console.warn('[zpay-notify] invalid membership_days on order', {out_trade_no, days});
    return textResponse(400, 'fail');
  }

  const userIdStr = String(
    (order as {user_id?: string; authing_user_id?: string}).user_id ?? order.authing_user_id ?? '',
  );
  if (!userIdStr || !isUuidString(userIdStr)) {
    console.error('[zpay-notify] missing or invalid user_id on order', {
      out_trade_no,
      rawUserId: userIdStr || null,
    });
    return textResponse(400, 'fail');
  }

  const nowIso = new Date().toISOString();

  const {data: claimed, error: claimErr} = await supabase
    .from('membership_orders')
    .update({
      status: 'paid',
      zpay_trade_no: params.trade_no ?? null,
      paid_at: nowIso,
      raw_notify: params,
    })
    .eq('out_trade_no', out_trade_no)
    .eq('status', 'pending')
    .select('id');

  if (claimErr) {
    console.error('[zpay-notify] claim order failed', {out_trade_no, error: claimErr.message});
    return textResponse(500, 'fail');
  }

  console.log('[zpay-notify] order claimed', {
    out_trade_no,
    user_id: userIdStr,
    claimedCount: claimed?.length ?? 0,
    trade_no: params.trade_no ?? null,
  });

  if (!claimed?.length) {
    const {data: again} = await supabase
      .from('membership_orders')
      .select('status')
      .eq('out_trade_no', out_trade_no)
      .maybeSingle();
    if (again?.status === 'paid') {
      console.log('[zpay-notify] concurrent claim, already paid', {out_trade_no});
      return textResponse(200, 'success');
    }
    console.warn('[zpay-notify] claim race lost, status not paid', {out_trade_no, status: again?.status ?? null});
    return textResponse(409, 'fail');
  }

  let {data: existing, error: exErr} = await supabase
    .from('user_membership')
    .select('premium_until')
    .eq('user_id', userIdStr)
    .maybeSingle();

  if (!exErr && !existing) {
    const leg = await supabase
      .from('user_membership')
      .select('premium_until')
      .eq('authing_user_id', userIdStr)
      .maybeSingle();
    existing = leg.data;
    exErr = leg.error;
  }

  if (exErr) {
    console.error('[zpay-notify] read membership', exErr);
    return textResponse(500, 'fail');
  }

  const now = Date.now();
  const msPerDay = 86400000;
  let baseMs = now;
  const curUntil = existing?.premium_until ? new Date(existing.premium_until as string).getTime() : NaN;
  if (!Number.isNaN(curUntil) && curUntil > now) {
    baseMs = curUntil;
  }
  const newUntilIso = new Date(baseMs + days * msPerDay).toISOString();

  const {error: upsertErr} = await supabase.from('user_membership').upsert(
    {
      user_id: userIdStr,
      premium_until: newUntilIso,
      membership_status: 'premium',
      payment_provider: 'zpay',
      last_payment_at: nowIso,
    },
    {onConflict: 'user_id'},
  );

  if (upsertErr) {
    console.error('[zpay-notify] upsert membership failed', {
      out_trade_no,
      user_id: userIdStr,
      error: upsertErr.message,
    });
    return textResponse(500, 'fail');
  }

  console.log('[zpay-notify] membership activated', {
    out_trade_no,
    user_id: userIdStr,
    days,
    previousPremiumUntil: existing?.premium_until ?? null,
    newPremiumUntil: newUntilIso,
  });

  return textResponse(200, 'success');
};
