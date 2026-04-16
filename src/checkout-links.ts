/**
 * Upgrade checkout URLs (frontend only).
 */
export const STRIPE_CHECKOUT_MONTHLY_URL = 'https://buy.stripe.com/8x2fZj9gN9xt8Ta7veffy00';
export const STRIPE_CHECKOUT_YEARLY_URL = 'https://buy.stripe.com/14A6oJfFbdNJ2uMg1Kffy01';

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

export function openMembershipCheckoutUrl(url: string) {
  if (url.startsWith('https://') || url.startsWith('http://')) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function isCheckoutUrlReady(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://');
}
