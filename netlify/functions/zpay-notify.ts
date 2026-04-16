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
  if (!verifyZpayNotify(params, key)) {
    console.warn('[zpay-notify] bad sign', params.out_trade_no);
    return textResponse(400, 'fail');
  }

  if (params.trade_status !== 'TRADE_SUCCESS') {
    return textResponse(200, 'success');
  }

  const out_trade_no = params.out_trade_no;
  if (!out_trade_no) {
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

  if (orderErr || !order) {
    console.error('[zpay-notify] order lookup', orderErr);
    return textResponse(404, 'fail');
  }

  if (!moneyMatches(String(order.amount_cny), String(params.money ?? ''))) {
    console.warn('[zpay-notify] money mismatch', order.amount_cny, params.money);
    return textResponse(400, 'fail');
  }

  if (order.status === 'paid') {
    return textResponse(200, 'success');
  }

  const days = Number(order.membership_days);
  if (days !== 30 && days !== 365) {
    return textResponse(400, 'fail');
  }

  const userIdStr = String(
    (order as {user_id?: string; authing_user_id?: string}).user_id ?? order.authing_user_id ?? '',
  );
  if (!userIdStr || !isUuidString(userIdStr)) {
    console.error('[zpay-notify] missing or invalid user_id on order', order.out_trade_no);
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
    console.error('[zpay-notify] claim order', claimErr);
    return textResponse(500, 'fail');
  }

  if (!claimed?.length) {
    const {data: again} = await supabase
      .from('membership_orders')
      .select('status')
      .eq('out_trade_no', out_trade_no)
      .maybeSingle();
    if (again?.status === 'paid') {
      return textResponse(200, 'success');
    }
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
    console.error('[zpay-notify] upsert membership', upsertErr);
    return textResponse(500, 'fail');
  }

  return textResponse(200, 'success');
};
