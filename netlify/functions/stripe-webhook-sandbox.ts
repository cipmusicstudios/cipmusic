import type {Handler, HandlerEvent, HandlerResponse} from '@netlify/functions';
import Stripe from 'stripe';

function textResponse(statusCode: number, body: string): HandlerResponse {
  return {
    statusCode,
    headers: {'Content-Type': 'text/plain; charset=utf-8'},
    body,
  };
}

function jsonResponse(statusCode: number, body: unknown): HandlerResponse {
  return {
    statusCode,
    headers: {'Content-Type': 'application/json; charset=utf-8'},
    body: JSON.stringify(body),
  };
}

function rawBody(event: HandlerEvent): string {
  if (!event.body) return '';
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

/**
 * Sandbox endpoint: signature verification and environment isolation only.
 * It intentionally has no Supabase imports and performs no membership writes.
 */
export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod !== 'POST') {
    return textResponse(405, 'method_not_allowed');
  }

  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET_SANDBOX?.trim();
  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];

  if (!signingSecret) {
    console.error('[stripe-webhook-sandbox] missing sandbox signing secret');
    return textResponse(500, 'config_error');
  }
  if (!signature) {
    console.warn('[stripe-webhook-sandbox] missing stripe-signature');
    return textResponse(400, 'missing_signature');
  }

  let stripeEvent: Stripe.Event;
  try {
    // A secret key is not needed to verify a webhook signature.
    stripeEvent = Stripe.webhooks.constructEvent(rawBody(event), signature, signingSecret);
  } catch (error) {
    console.warn('[stripe-webhook-sandbox] signature verification failed', {
      errorName: error instanceof Error ? error.name : 'unknown_error',
    });
    return textResponse(400, 'invalid_signature');
  }

  if (stripeEvent.livemode) {
    console.warn('[stripe-webhook-sandbox] rejected live event', {
      eventId: stripeEvent.id,
      eventType: stripeEvent.type,
      livemode: stripeEvent.livemode,
    });
    return textResponse(403, 'live_event_rejected_by_sandbox_endpoint');
  }

  console.log('[stripe-webhook-sandbox] acknowledged sandbox event', {
    eventId: stripeEvent.id,
    eventType: stripeEvent.type,
    livemode: stripeEvent.livemode,
    membershipWrite: 'disabled',
  });

  return jsonResponse(200, {
    received: true,
    environment: 'sandbox',
    membership_write: 'disabled',
  });
};
