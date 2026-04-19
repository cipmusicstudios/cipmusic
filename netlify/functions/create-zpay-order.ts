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

  /**
   * 调试日志：明确打印「客户端发来的 user_id 原值」与「校验后实际入库用的 user_id」。
   * 用于排查「订单 user_id 与浏览器登录用户不一致」类问题。
   * 同时打印 Authorization header 是否存在，便于后续要求前端带 Supabase JWT 时核对。
   */
  console.log('[create-zpay-order] received', {
    userIdRaw:
      typeof body.userId === 'string'
        ? body.userId
        : typeof body.authingUserId === 'string'
          ? body.authingUserId
          : null,
    userIdParsed: userId,
    membershipDays,
    hasAuthHeader: Boolean(
      event.headers?.authorization || event.headers?.Authorization,
    ),
  });

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

  console.log('[create-zpay-order] inserting order', {
    out_trade_no,
    user_id: userId,
    membership_days: membershipDays,
    amount_cny: tier.money,
  });

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

  /**
   * 与 submit.php / mapi.php 共用的签名集合。两边规则完全一致：
   * 按 key 字典序排序后 `k=v&...` + 商户 KEY 做 MD5 lowercase。
   */
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

  let sign: string;
  try {
    sign = signZpayParams(signParams, key!);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[create-zpay-order] sign failed', e);
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
  const payParams = {...signParams, sign};

  /**
   * 优先走 mapi.php（API 接口支付）：服务端 POST，拿 JSON `{code, payurl, qrcode, img}`，
   * 这样前端就能在弹窗里直接渲染二维码，不必嵌 submit.php 中转页。
   *
   * 任何分支失败（商户未开 API、网络错误、code !== 1）都自动回落到 submit.php 的旧
   * 行为（返回拼接好的 payUrl 让前端去新窗口打开），保持现有支付能力不被改坏。
   */
  const mapiGateway = (process.env.ZPAY_API_GATEWAY || 'https://zpayz.cn/mapi.php').trim();
  const mapiResult = await tryMapiCreateOrder(mapiGateway, payParams);

  /** submit.php 拼接 URL，作为兜底 / 备用「在新窗口打开支付」 */
  let submitUrl: string;
  try {
    submitUrl = buildPayUrl(gateway, payParams);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[create-zpay-order] submit URL build failed', e);
    return json(500, {
      error: 'PAY_URL_BUILD_FAILED',
      message: msg,
      debug: baseDebug({
        supabaseInsertAttempted: true,
        supabaseInsertOk: true,
        supabaseInsertError: null,
        zpaySignGenerated: true,
        payUrlGenerated: false,
      }),
    });
  }

  if (mapiResult.ok) {
    console.log('[create-zpay-order] mapi success', {
      out_trade_no,
      gateway: mapiGateway,
      httpStatus: mapiResult.httpStatus,
      contentType: mapiResult.contentType,
      hasPayurl: Boolean(mapiResult.payurl),
      hasQrcode: Boolean(mapiResult.qrcode),
      hasImg: Boolean(mapiResult.img),
      tradeNo: mapiResult.trade_no || null,
      source: 'mapi',
    });
    /** mapi 没返 payurl 时，用 submit.php 兜底，保证前端「在新窗口打开支付」永远可用 */
    return json(200, {
      payUrl: mapiResult.payurl || submitUrl,
      qrUrl: mapiResult.qrcode || undefined,
      qrImageUrl: mapiResult.img || undefined,
      source: 'mapi',
    });
  }

  console.warn('[create-zpay-order] mapi unavailable, fallback to submit.php', {
    out_trade_no,
    gateway: mapiGateway,
    reason: mapiResult.reason,
    httpStatus: mapiResult.httpStatus ?? null,
    contentType: mapiResult.contentType ?? null,
    bodySnippet: mapiResult.bodySnippet ?? null,
    code: mapiResult.code ?? null,
    msg: mapiResult.msg ?? null,
    sentParamKeys: mapiResult.sentParamKeys ?? null,
  });
  return json(200, {payUrl: submitUrl, source: 'submit'});
};

type MapiSuccess = {
  ok: true;
  httpStatus: number;
  contentType: string | null;
  payurl?: string;
  qrcode?: string;
  img?: string;
  trade_no?: string;
};
type MapiFailure = {
  ok: false;
  reason: 'http_error' | 'invalid_json' | 'business_failure' | 'network_error';
  httpStatus?: number;
  contentType?: string | null;
  /** 截断到 500 字符的原始 body，便于排查 ZPay 的真正报错文案 */
  bodySnippet?: string;
  code?: number | string;
  msg?: string;
  /** 实际发出去的字段 key 集合（不含 sign 明文），用于核对参数完整性 */
  sentParamKeys?: string[];
};

/**
 * POST 表单到 ZPay mapi.php。任何异常都吞下并返回 ok:false，让上层走 submit.php 兜底，
 * 不会因为 API 接口未开通就让整笔下单失败。
 *
 * 调试日志原则：
 *  - 永远打印 httpStatus / content-type / body 前 500 字符
 *  - 不打印 sign 明文，只打印参数 key 列表
 *  - 严格区分 4 类失败：网络 / 非 200 / 非 JSON / JSON 但 code !== 1
 */
async function tryMapiCreateOrder(
  gateway: string,
  signedParams: Record<string, string>,
): Promise<MapiSuccess | MapiFailure> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(signedParams)) {
    if (v == null || v === '') continue;
    form.set(k, v);
  }
  const sentParamKeys = Array.from(form.keys()).sort();

  console.log('[create-zpay-order] mapi request', {
    gateway,
    paramKeys: sentParamKeys,
    /** 把签名是否被加进表单标出来，但不打 sign 明文 */
    hasSign: form.has('sign'),
    bodyLength: form.toString().length,
  });

  let res: Response;
  try {
    res = await fetch(gateway, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'Accept': 'application/json,text/plain,*/*',
      },
      body: form.toString(),
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.warn('[create-zpay-order] mapi network error', {gateway, error: errMsg});
    return {ok: false, reason: 'network_error', sentParamKeys, msg: errMsg};
  }

  const contentType = res.headers.get('content-type');
  const text = await res.text().catch(() => '');
  const bodySnippet = text.slice(0, 500);

  console.log('[create-zpay-order] mapi raw response', {
    gateway,
    httpStatus: res.status,
    contentType,
    bodyLength: text.length,
    bodySnippet,
  });

  if (!res.ok) {
    return {
      ok: false,
      reason: 'http_error',
      httpStatus: res.status,
      contentType,
      bodySnippet,
      sentParamKeys,
    };
  }

  const parsed = robustParseMapiBody(text);
  if (!parsed) {
    return {
      ok: false,
      reason: 'invalid_json',
      httpStatus: res.status,
      contentType,
      bodySnippet,
      sentParamKeys,
    };
  }

  console.log('[create-zpay-order] mapi parsed', {
    code: parsed.code ?? null,
    msg: parsed.msg ?? null,
    hasPayurl: typeof parsed.payurl === 'string' && parsed.payurl.length > 0,
    hasQrcode: typeof parsed.qrcode === 'string' && parsed.qrcode.length > 0,
    hasImg: typeof parsed.img === 'string' && parsed.img.length > 0,
    /** 帮助识别接口偶发字段名变化（如 qrcode_url / pay_url 等大小写差异） */
    keys: Object.keys(parsed).sort(),
  });

  /** ZPay 协议：code === 1（数字或字符串）代表下单成功 */
  const codeOk = parsed.code === 1 || parsed.code === '1';
  if (!codeOk) {
    return {
      ok: false,
      reason: 'business_failure',
      httpStatus: res.status,
      contentType,
      bodySnippet,
      sentParamKeys,
      code: parsed.code,
      msg: parsed.msg,
    };
  }
  return {
    ok: true,
    httpStatus: res.status,
    contentType,
    payurl: typeof parsed.payurl === 'string' ? parsed.payurl : undefined,
    qrcode: typeof parsed.qrcode === 'string' ? parsed.qrcode : undefined,
    img: typeof parsed.img === 'string' ? parsed.img : undefined,
    trade_no: typeof parsed.trade_no === 'string' ? parsed.trade_no : undefined,
  };
}

type MapiParsedBody = {
  code?: number | string;
  msg?: string;
  payurl?: string;
  qrcode?: string;
  img?: string;
  trade_no?: string;
  [k: string]: unknown;
};

/**
 * 兼容多种 ZPay mapi.php 实际响应格式：
 *  1. 正常 JSON 对象：`{"code":1,"msg":"success",...}`
 *  2. 双重编码字符串：body 解出来是字符串，需要再 JSON.parse 一次（实测线上情形）
 *  3. 前后包了 BOM / 空白 / `<pre>...</pre>` / JSONP 回调外壳
 *
 * 解析失败统一返 null，由调用方上报 `invalid_json`。
 */
function robustParseMapiBody(text: string): MapiParsedBody | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  /** 去 BOM + 两侧空白 */
  let raw = text.replace(/^\uFEFF/, '').trim();
  if (!raw) return null;

  /** 兼容 jsonpCallback({...}) 这种外壳 */
  const jsonp = /^[A-Za-z_$][\w$]*\((.*)\)\s*;?\s*$/s.exec(raw);
  if (jsonp && jsonp[1]) raw = jsonp[1].trim();

  /** 兼容 <pre>{...}</pre>（PHP 调试默认输出）等 HTML 包装 */
  const htmlWrap = /<(?:pre|code)>([\s\S]*?)<\/(?:pre|code)>/i.exec(raw);
  if (htmlWrap && htmlWrap[1]) raw = htmlWrap[1].trim();

  /** 第一次解析；最多再做两次 unwrap，应对双重 / 三重编码 */
  let cur: unknown;
  try {
    cur = JSON.parse(raw);
  } catch {
    /** 兜底：从 body 里截出第一个 {...} 试一次，应对前缀杂质 */
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) return null;
    try {
      cur = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  for (let i = 0; i < 2 && typeof cur === 'string'; i += 1) {
    try {
      cur = JSON.parse(cur);
    } catch {
      return null;
    }
  }
  if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return null;
  return cur as MapiParsedBody;
}
