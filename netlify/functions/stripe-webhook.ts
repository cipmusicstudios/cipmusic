import type {Handler, HandlerEvent, HandlerResponse} from '@netlify/functions';
import Stripe from 'stripe';
import {createSupabaseServiceClient} from './_shared/supabase-service';
import {isUuidString} from './_shared/user-id';

const TABLE = 'user_membership';

type MembershipRow = {
  user_id: string;
  premium_until: string | null;
  membership_status: string | null;
  payment_provider: string | null;
  last_payment_at: string | null;
  auto_renew: boolean | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  stripe_price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  last_payment_status: string | null;
  payment_failure_at: string | null;
  last_webhook_event: string | null;
  last_webhook_at: string | null;
};

type MembershipPatch = Partial<MembershipRow> & {user_id: string};

function textResponse(statusCode: number, body: string): HandlerResponse {
  return {
    statusCode,
    headers: {'Content-Type': 'text/plain; charset=utf-8'},
    body,
  };
}

function rawBody(event: HandlerEvent): string {
  if (!event.body) return '';
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return key ? new Stripe(key) : null;
}

function stringId(value: string | Stripe.Customer | Stripe.Subscription | Stripe.Price | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return 'id' in value && typeof value.id === 'string' ? value.id : null;
}

function isoFromUnixSeconds(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function latestLinePeriodEnd(invoice: Stripe.Invoice): string | null {
  const ends = invoice.lines.data
    .map(line => (typeof line.period?.end === 'number' ? line.period.end : null))
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (!ends.length) return null;
  return isoFromUnixSeconds(Math.max(...ends));
}

function subscriptionMembershipStatus(
  subscriptionStatus: string | null | undefined,
  eventType: Stripe.Event.Type,
): string {
  if (eventType === 'invoice.payment_failed') return 'stripe_subscription_payment_failed';
  if (eventType === 'customer.subscription.deleted') return 'stripe_subscription_canceled';
  const normalized = (subscriptionStatus || 'unknown').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  return `stripe_subscription_${normalized || 'unknown'}`;
}

function deriveAutoRenew(subscription: Stripe.Subscription | null): boolean | null {
  if (!subscription) return null;
  const st = (subscription.status || '').toLowerCase();
  if (st === 'canceled' || st === 'incomplete_expired' || st === 'unpaid') return false;
  return !subscription.cancel_at_period_end;
}

async function findMembershipByStripeRefs(
  refs: {subscriptionId?: string | null; customerId?: string | null},
): Promise<Pick<MembershipRow, 'user_id'> | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  if (refs.subscriptionId) {
    const bySub = await supabase
      .from(TABLE)
      .select('user_id')
      .eq('stripe_subscription_id', refs.subscriptionId)
      .limit(1)
      .maybeSingle();
    if (bySub.data?.user_id) return bySub.data;
  }

  if (refs.customerId) {
    const byCustomer = await supabase
      .from(TABLE)
      .select('user_id')
      .eq('stripe_customer_id', refs.customerId)
      .limit(1)
      .maybeSingle();
    if (byCustomer.data?.user_id) return byCustomer.data;
  }

  return null;
}

async function readMembership(userId: string): Promise<MembershipRow | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;
  const row = await supabase
    .from(TABLE)
    .select(
      'user_id, premium_until, membership_status, payment_provider, last_payment_at, auto_renew, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, stripe_price_id, current_period_end, cancel_at_period_end, last_payment_status, payment_failure_at, last_webhook_event, last_webhook_at',
    )
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (row.error) throw row.error;
  return (row.data as MembershipRow | null) ?? null;
}

async function upsertMembership(patch: MembershipPatch): Promise<void> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');

  const existing = await readMembership(patch.user_id);
  const nowIso = new Date().toISOString();
  const payload: MembershipRow = {
    user_id: patch.user_id,
    premium_until: patch.premium_until ?? existing?.premium_until ?? null,
    membership_status: patch.membership_status ?? existing?.membership_status ?? null,
    payment_provider: patch.payment_provider ?? existing?.payment_provider ?? null,
    last_payment_at: patch.last_payment_at ?? existing?.last_payment_at ?? null,
    auto_renew: patch.auto_renew ?? existing?.auto_renew ?? null,
    stripe_customer_id: patch.stripe_customer_id ?? existing?.stripe_customer_id ?? null,
    stripe_subscription_id: patch.stripe_subscription_id ?? existing?.stripe_subscription_id ?? null,
    stripe_subscription_status: patch.stripe_subscription_status ?? existing?.stripe_subscription_status ?? null,
    stripe_price_id: patch.stripe_price_id ?? existing?.stripe_price_id ?? null,
    current_period_end: patch.current_period_end ?? existing?.current_period_end ?? null,
    cancel_at_period_end: patch.cancel_at_period_end ?? existing?.cancel_at_period_end ?? null,
    last_payment_status: patch.last_payment_status ?? existing?.last_payment_status ?? null,
    payment_failure_at:
      patch.payment_failure_at !== undefined
        ? patch.payment_failure_at
        : existing?.payment_failure_at ?? null,
    last_webhook_event: patch.last_webhook_event ?? existing?.last_webhook_event ?? null,
    last_webhook_at: patch.last_webhook_at ?? nowIso,
  };

  const {error} = await supabase.from(TABLE).upsert(payload, {onConflict: 'user_id'});
  if (error) throw error;
}

async function fetchSubscription(
  stripe: Stripe,
  subscriptionId: string | null,
): Promise<Stripe.Subscription | null> {
  if (!subscriptionId) return null;
  return await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price'],
  });
}

function userIdFromCheckoutSession(session: Stripe.Checkout.Session): string | null {
  const candidates = [
    typeof session.client_reference_id === 'string' ? session.client_reference_id : null,
    typeof session.metadata?.user_id === 'string' ? session.metadata.user_id : null,
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && isUuidString(value)) return value;
  }
  return null;
}

function currentPeriodEndIso(
  subscription: Stripe.Subscription | null,
  invoice?: Stripe.Invoice | null,
): string | null {
  return (
    isoFromUnixSeconds(subscription?.current_period_end ?? null) ||
    (invoice ? latestLinePeriodEnd(invoice) : null) ||
    null
  );
}

async function handleCheckoutCompleted(stripe: Stripe, session: Stripe.Checkout.Session): Promise<void> {
  const userId = userIdFromCheckoutSession(session);
  const customerId = stringId(session.customer);
  const subscriptionId = stringId(session.subscription);
  if (!userId) {
    console.warn('[stripe-webhook] checkout.session.completed missing user binding', {
      checkoutSessionId: session.id,
      customerId,
      subscriptionId,
    });
    return;
  }

  const subscription = await fetchSubscription(stripe, subscriptionId);
  await upsertMembership({
    user_id: userId,
    payment_provider: 'stripe',
    membership_status: subscriptionMembershipStatus(subscription?.status, 'checkout.session.completed'),
    premium_until: currentPeriodEndIso(subscription),
    last_payment_at: new Date().toISOString(),
    auto_renew: deriveAutoRenew(subscription),
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    stripe_subscription_status: subscription?.status ?? null,
    stripe_price_id: stringId(subscription?.items.data[0]?.price ?? null),
    current_period_end: currentPeriodEndIso(subscription),
    cancel_at_period_end: subscription?.cancel_at_period_end ?? null,
    last_payment_status: 'paid',
    payment_failure_at: null,
    last_webhook_event: 'checkout.session.completed',
  });
}

async function handleInvoicePaid(stripe: Stripe, invoice: Stripe.Invoice): Promise<void> {
  const customerId = stringId(invoice.customer);
  const subscriptionId = stringId(invoice.subscription);
  const membership = await findMembershipByStripeRefs({customerId, subscriptionId});
  if (!membership?.user_id) {
    console.warn('[stripe-webhook] invoice.paid could not map membership', {
      invoiceId: invoice.id,
      customerId,
      subscriptionId,
    });
    return;
  }

  const subscription = await fetchSubscription(stripe, subscriptionId);
  const paidAt = isoFromUnixSeconds(invoice.status_transitions?.paid_at ?? null) || isoFromUnixSeconds(invoice.created);
  await upsertMembership({
    user_id: membership.user_id,
    payment_provider: 'stripe',
    membership_status: subscriptionMembershipStatus(subscription?.status, 'invoice.paid'),
    premium_until: currentPeriodEndIso(subscription, invoice),
    last_payment_at: paidAt,
    auto_renew: deriveAutoRenew(subscription),
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    stripe_subscription_status: subscription?.status ?? null,
    stripe_price_id: stringId(subscription?.items.data[0]?.price ?? null),
    current_period_end: currentPeriodEndIso(subscription, invoice),
    cancel_at_period_end: subscription?.cancel_at_period_end ?? null,
    last_payment_status: 'paid',
    payment_failure_at: null,
    last_webhook_event: 'invoice.paid',
  });
}

async function handleInvoiceFailed(stripe: Stripe, invoice: Stripe.Invoice): Promise<void> {
  const customerId = stringId(invoice.customer);
  const subscriptionId = stringId(invoice.subscription);
  const membership = await findMembershipByStripeRefs({customerId, subscriptionId});
  if (!membership?.user_id) {
    console.warn('[stripe-webhook] invoice.payment_failed could not map membership', {
      invoiceId: invoice.id,
      customerId,
      subscriptionId,
    });
    return;
  }

  const subscription = await fetchSubscription(stripe, subscriptionId);
  await upsertMembership({
    user_id: membership.user_id,
    payment_provider: 'stripe',
    membership_status: subscriptionMembershipStatus(subscription?.status, 'invoice.payment_failed'),
    premium_until: currentPeriodEndIso(subscription, invoice),
    auto_renew: deriveAutoRenew(subscription),
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    stripe_subscription_status: subscription?.status ?? null,
    stripe_price_id: stringId(subscription?.items.data[0]?.price ?? null),
    current_period_end: currentPeriodEndIso(subscription, invoice),
    cancel_at_period_end: subscription?.cancel_at_period_end ?? null,
    last_payment_status: 'failed',
    payment_failure_at: new Date().toISOString(),
    last_webhook_event: 'invoice.payment_failed',
  });
}

async function handleSubscriptionUpdated(
  eventType: 'customer.subscription.updated' | 'customer.subscription.deleted',
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId = stringId(subscription.customer);
  const subscriptionId = subscription.id;
  const membership = await findMembershipByStripeRefs({customerId, subscriptionId});
  if (!membership?.user_id) {
    console.warn(`[stripe-webhook] ${eventType} could not map membership`, {
      subscriptionId,
      customerId,
    });
    return;
  }

  const currentPeriodEnd = currentPeriodEndIso(subscription);
  await upsertMembership({
    user_id: membership.user_id,
    payment_provider: 'stripe',
    membership_status: subscriptionMembershipStatus(subscription.status, eventType),
    premium_until: currentPeriodEnd,
    auto_renew: eventType === 'customer.subscription.deleted' ? false : deriveAutoRenew(subscription),
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    stripe_subscription_status: subscription.status ?? null,
    stripe_price_id: stringId(subscription.items.data[0]?.price ?? null),
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: subscription.cancel_at_period_end ?? null,
    last_payment_status: eventType === 'customer.subscription.deleted' ? 'canceled' : undefined,
    last_webhook_event: eventType,
  });
}

export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod !== 'POST') {
    return textResponse(405, 'method_not_allowed');
  }

  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const stripe = stripeClient();

  if (!stripe || !signingSecret) {
    console.error('[stripe-webhook] missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
    return textResponse(500, 'config_error');
  }

  if (!signature) {
    console.warn('[stripe-webhook] missing stripe-signature');
    return textResponse(400, 'missing_signature');
  }

  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody(event), signature, signingSecret);
  } catch (error) {
    console.warn('[stripe-webhook] signature verification failed', error);
    return textResponse(400, 'invalid_signature');
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(stripe, stripeEvent.data.object as Stripe.Checkout.Session);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(stripe, stripeEvent.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await handleInvoiceFailed(stripe, stripeEvent.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(
          'customer.subscription.updated',
          stripeEvent.data.object as Stripe.Subscription,
        );
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionUpdated(
          'customer.subscription.deleted',
          stripeEvent.data.object as Stripe.Subscription,
        );
        break;
      default:
        break;
    }
  } catch (error) {
    console.error('[stripe-webhook] handler failed', stripeEvent.type, error);
    return textResponse(500, 'handler_error');
  }

  return textResponse(200, 'ok');
};
