const DEFAULT_CREATE_URL = '/.netlify/functions/create-zpay-order';

function createOrderEndpoint(): string {
  const fromEnv = import.meta.env.VITE_ZPAY_CREATE_ORDER_URL as string | undefined;
  return (fromEnv && fromEnv.trim()) || DEFAULT_CREATE_URL;
}

/** 与 netlify/functions/create-zpay-order 返回的 debug 对齐（不含敏感信息） */
export type CreateZpayOrderDebug = {
  missingEnv?: string[];
  userIdPresent?: boolean;
  membershipDays?: number | null;
  membershipDaysValid?: boolean;
  supabaseConfigured?: boolean;
  supabaseInsertAttempted?: boolean;
  supabaseInsertOk?: boolean | null;
  supabaseInsertError?: string | null;
  zpaySignGenerated?: boolean | null;
  payUrlGenerated?: boolean | null;
};

export type CreateZpayOrderResult =
  | {ok: true; payUrl: string}
  | {
      ok: false;
      error: string;
      code?: string;
      hint?: string;
      debug?: CreateZpayOrderDebug;
    };

function looksLikeHtml(body: string): boolean {
  const t = body.trimStart().slice(0, 64).toLowerCase();
  return t.startsWith('<!') || t.startsWith('<html') || t.startsWith('<head') || t.startsWith('<body');
}

/**
 * 创建 ZPay 订单并返回收银台 URL。
 * 需已登录；userId 为 Supabase Auth 的 session.user.id（UUID）。
 * TODO：服务端宜用 JWT 校验用户，而非仅信任 body。
 */
export async function createZpayOrderCheckout(
  membershipDays: 30 | 365,
  userId: string,
): Promise<CreateZpayOrderResult> {
  const endpoint = createOrderEndpoint();
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({membershipDays, userId}),
    });
  } catch (e) {
    console.warn('[AuraSounds] createZpayOrderCheckout network error', e);
    return {ok: false, error: 'NETWORK_ERROR', code: 'NETWORK_ERROR'};
  }

  const raw = await res.text().catch(() => '');
  const trimmed = raw.trim();
  const isHtml = looksLikeHtml(trimmed);

  let data: {
    payUrl?: string;
    error?: string;
    message?: string;
    hint?: string;
    debug?: CreateZpayOrderDebug;
  } = {};

  if (trimmed && !isHtml) {
    try {
      data = JSON.parse(trimmed) as typeof data;
    } catch {
      data = {};
    }
  }

  const debug = data.debug;

  /** Vite /静态预览常返回 200 + index.html，或 404 HTML，Netlify Function 实际未执行 */
  if (
    isHtml ||
    (res.status === 404 && !data.payUrl) ||
    (res.ok && !data.payUrl && !data.error && trimmed.length > 0 && !trimmed.startsWith('{'))
  ) {
    console.warn('[AuraSounds] createZpayOrderCheckout function unavailable or non-JSON response', {
      endpoint,
      status: res.status,
      contentSnippet: trimmed.slice(0, 120),
    });
    return {
      ok: false,
      error: 'FUNCTION_UNAVAILABLE',
      code: 'FUNCTION_UNAVAILABLE',
      debug,
    };
  }

  if (!res.ok) {
    const code = data.error || `HTTP_${res.status}`;
    const errMsg = data.message || data.error || `HTTP ${res.status}`;
    console.warn('[AuraSounds] createZpayOrderCheckout server error', {
      endpoint,
      status: res.status,
      code,
      message: errMsg,
      hint: data.hint,
      debug,
    });
    return {
      ok: false,
      error: errMsg,
      code,
      hint: data.hint,
      debug,
    };
  }

  if (!data.payUrl || !/^https?:\/\//i.test(data.payUrl)) {
    console.warn('[AuraSounds] createZpayOrderCheckout invalid payUrl', {endpoint, status: res.status, data, debug});
    return {
      ok: false,
      error: data.error || 'INVALID_PAY_URL',
      code: 'INVALID_PAY_URL',
      hint: data.hint,
      debug,
    };
  }

  return {ok: true, payUrl: data.payUrl};
}
