import type {Handler} from '@netlify/functions';

/**
 * Stripe Payment Link URLs for the membership modal — read at request time from Netlify env,
 * so updating dashboard values does not require a new frontend bundle.
 */
export const handler: Handler = async () => {
  const monthly =
    process.env.STRIPE_CHECKOUT_MONTHLY_URL?.trim() ||
    process.env.VITE_STRIPE_CHECKOUT_MONTHLY_URL?.trim() ||
    '';
  const yearly =
    process.env.STRIPE_CHECKOUT_YEARLY_URL?.trim() ||
    process.env.VITE_STRIPE_CHECKOUT_YEARLY_URL?.trim() ||
    '';

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({monthlyUrl: monthly, yearlyUrl: yearly}),
  };
};
