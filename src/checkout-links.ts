/**
 * Upgrade checkout URLs (frontend).
 *
 * **Production (Netlify)**：月/年付链接由 `/.netlify/functions/stripe-checkout-links` 在请求时从 Netlify 环境变量注入，避免 `vite build` 把旧的 `VITE_*` 永久写进 JS（此前会导致改 dashboard 仍打开旧 live link）。
 *
 * **本地 `vite dev` / localhost preview**：函数不存在时回退到 `import.meta.env.VITE_STRIPE_*`。
 */
function readCheckoutUrl(key: 'VITE_STRIPE_CHECKOUT_MONTHLY_URL' | 'VITE_STRIPE_CHECKOUT_YEARLY_URL'): string {
  const value = import.meta.env[key] as string | undefined;
  return (value && value.trim()) || '';
}

/** @deprecated 生产环境勿依赖 — 请用 `getStripeCheckoutUrls()`，否则仍是构建期写死的值 */
export const STRIPE_CHECKOUT_MONTHLY_URL = readCheckoutUrl('VITE_STRIPE_CHECKOUT_MONTHLY_URL');
/** @deprecated 生产环境勿依赖 — 请用 `getStripeCheckoutUrls()` */
export const STRIPE_CHECKOUT_YEARLY_URL = readCheckoutUrl('VITE_STRIPE_CHECKOUT_YEARLY_URL');

function useDevLikeEnvFallback(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

/**
 * 打开会员弹窗时调用：优先 Netlify Function（与当前 dashboard 环境变量一致），失败时仅在 dev/localhost 回退 VITE_*。
 */
export async function getStripeCheckoutUrls(): Promise<{monthly: string; yearly: string}> {
  const empty = {monthly: '', yearly: ''};
  try {
    const r = await fetch('/.netlify/functions/stripe-checkout-links', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`stripe-checkout-links ${r.status}`);
    const j = (await r.json()) as {monthlyUrl?: unknown; yearlyUrl?: unknown};
    const m = typeof j.monthlyUrl === 'string' ? j.monthlyUrl.trim() : '';
    const y = typeof j.yearlyUrl === 'string' ? j.yearlyUrl.trim() : '';
    if (m || y) {
      return {monthly: m, yearly: y};
    }
  } catch {
    /* fall through */
  }
  if (useDevLikeEnvFallback()) {
    return {
      monthly: readCheckoutUrl('VITE_STRIPE_CHECKOUT_MONTHLY_URL'),
      yearly: readCheckoutUrl('VITE_STRIPE_CHECKOUT_YEARLY_URL'),
    };
  }
  return empty;
}

/** @deprecated */
export const WECHAT_PAY_CHECKOUT_URL = 'PASTE_WECHAT_PAY_LINK_HERE';

/** @deprecated */
export const ZPAY_CHECKOUT_MONTHLY_URL = WECHAT_PAY_CHECKOUT_URL;
/** @deprecated */
export const ZPAY_CHECKOUT_YEARLY_URL = WECHAT_PAY_CHECKOUT_URL;
/** @deprecated */
export const MEMBERSHIP_CHECKOUT_STRIPE_MONTHLY_URL = STRIPE_CHECKOUT_MONTHLY_URL;
/** @deprecated */
export const MEMBERSHIP_CHECKOUT_STRIPE_YEARLY_URL = STRIPE_CHECKOUT_YEARLY_URL;
/** @deprecated */
export const MEMBERSHIP_CHECKOUT_STRIPE_URL = STRIPE_CHECKOUT_MONTHLY_URL;
/** @deprecated */
export const MEMBERSHIP_CHECKOUT_ZPAY_URL = WECHAT_PAY_CHECKOUT_URL;

type MembershipCheckoutUrlOptions = {
  clientReferenceId?: string | null;
  prefilledEmail?: string | null;
};

export function openMembershipCheckoutUrl(url: string, options: MembershipCheckoutUrlOptions = {}) {
  if (url.startsWith('https://') || url.startsWith('http://')) {
    const target = new URL(url);
    const clientReferenceId = options.clientReferenceId?.trim();
    const prefilledEmail = options.prefilledEmail?.trim();
    if (clientReferenceId) target.searchParams.set('client_reference_id', clientReferenceId);
    if (prefilledEmail) target.searchParams.set('prefilled_email', prefilledEmail);
    window.open(target.toString(), '_blank', 'noopener,noreferrer');
  }
}

export function isCheckoutUrlReady(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://');
}
