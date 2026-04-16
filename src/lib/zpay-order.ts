const DEFAULT_CREATE_URL = '/.netlify/functions/create-zpay-order';

function createOrderEndpoint(): string {
  const fromEnv = import.meta.env.VITE_ZPAY_CREATE_ORDER_URL as string | undefined;
  return (fromEnv && fromEnv.trim()) || DEFAULT_CREATE_URL;
}

export type CreateZpayOrderResult =
  | {ok: true; payUrl: string}
  | {ok: false; error: string; hint?: string};

/**
 * 创建 ZPay 订单并返回收银台 URL。
 * 需已登录；userId 为 Supabase Auth 的 session.user.id（UUID）。
 * TODO：服务端宜用 JWT 校验用户，而非仅信任 body。
 */
export async function createZpayOrderCheckout(
  membershipDays: 30 | 365,
  userId: string,
): Promise<CreateZpayOrderResult> {
  try {
    const res = await fetch(createOrderEndpoint(), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({membershipDays, userId}),
    });
    const data = (await res.json().catch(() => ({}))) as {
      payUrl?: string;
      error?: string;
      message?: string;
      hint?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: data.message || data.error || `HTTP ${res.status}`,
        hint: data.hint,
      };
    }
    if (!data.payUrl || !/^https?:\/\//i.test(data.payUrl)) {
      return {ok: false, error: 'INVALID_PAY_URL'};
    }
    return {ok: true, payUrl: data.payUrl};
  } catch (e) {
    console.warn('[AuraSounds] createZpayOrderCheckout', e);
    return {ok: false, error: 'NETWORK_ERROR'};
  }
}
