import type {HandlerEvent, HandlerResponse} from '@netlify/functions';
import type {SupabaseClient} from '@supabase/supabase-js';
import {loadAppleConfig} from './config';
import {json} from './http';
import {safeLogFields, sha256} from './redaction';
import {readRuntimeControls, type RuntimeControls} from './runtime';
import {canonicalEnvironment, summarizeTransaction} from './transaction';
import {AppleServiceError, type AppleEnvironment, type AppleVerifier} from './types';
import {OfficialAppleVerifier} from './verifier';

const KNOWN_TYPES = new Set([
  'SUBSCRIBED', 'DID_RENEW', 'DID_FAIL_TO_RENEW', 'DID_CHANGE_RENEWAL_STATUS',
  'DID_CHANGE_RENEWAL_PREF', 'EXPIRED', 'GRACE_PERIOD_EXPIRED', 'REFUND',
  'REFUND_REVERSED', 'REVOKE', 'RENEWAL_EXTENDED', 'TEST',
]);

type NotificationDeps = {
  supabase: SupabaseClient;
  readControls?: (client: SupabaseClient) => Promise<RuntimeControls>;
  verifier?: AppleVerifier;
  persistInbox?: (args: Record<string, unknown>) => Promise<{duplicate: boolean}>;
};

async function defaultPersist(client: SupabaseClient, args: Record<string, unknown>) {
  const {data, error} = await client.rpc('billing_record_app_store_notification', args);
  if (error) {
    const message = String(error.message ?? '');
    if (/NOTIFICATION_REPLAY_MISMATCH/.test(message)) throw new AppleServiceError('NOTIFICATION_REPLAY_CONFLICT', 409);
    if (/APPLE_LEDGER_WRITE_DISABLED/.test(message)) throw new AppleServiceError('FEATURE_DISABLED', 503);
    if (/ENVIRONMENT_MISMATCH/.test(message)) throw new AppleServiceError('ENVIRONMENT_MISMATCH', 400);
    throw new AppleServiceError('NOTIFICATION_INBOX_FAILED', 503);
  }
  const value: unknown = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof (value as Record<string, unknown>).duplicate !== 'boolean') {
    throw new AppleServiceError('NOTIFICATION_INBOX_RESPONSE_INVALID', 503);
  }
  return {duplicate: (value as Record<string, unknown>).duplicate as boolean};
}

export function createNotificationHandler(endpointEnvironment: AppleEnvironment, deps: NotificationDeps) {
  return async (event: HandlerEvent): Promise<HandlerResponse> => {
    if (event.httpMethod !== 'POST') return json(405, {ok: false, code: 'METHOD_NOT_ALLOWED'});
    if (Buffer.byteLength(event.body ?? '', 'utf8') > 131072) return json(413, {ok: false, code: 'BODY_TOO_LARGE'});
    let body: Record<string, unknown>;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, {ok: false, code: 'INVALID_JSON'}); }
    const signedPayload = typeof body.signedPayload === 'string' ? body.signedPayload.trim() : '';
    if (!signedPayload) return json(400, {ok: false, code: 'SIGNED_PAYLOAD_REQUIRED'});
    if (signedPayload.length > 131000) return json(413, {ok: false, code: 'BODY_TOO_LARGE'});

    try {
      const controls = await (deps.readControls ?? readRuntimeControls)(deps.supabase);
      if (!controls.appleVerificationEnabled) throw new AppleServiceError('FEATURE_DISABLED', 503);
      if (!controls.appleLedgerWriteEnabled) throw new AppleServiceError('LEDGER_WRITE_DISABLED', 503);
      const config = loadAppleConfig();
      const verifier = deps.verifier ?? new OfficialAppleVerifier(config);
      const decoded = await verifier.verifyNotification(signedPayload, endpointEnvironment);
      const payloadEnvironment = canonicalEnvironment(decoded.data?.environment);
      if (payloadEnvironment !== endpointEnvironment) throw new AppleServiceError('ENVIRONMENT_MISMATCH', 400);
      if (decoded.data?.bundleId !== config.bundleId) throw new AppleServiceError('BUNDLE_ID_MISMATCH', 400);
      if (endpointEnvironment === 'production' && decoded.data?.appAppleId !== config.appId) {
        throw new AppleServiceError('APP_ID_MISMATCH', 400);
      }
      if (!decoded.notificationUUID || !decoded.notificationType || !decoded.signedDate) {
        throw new AppleServiceError('APPLE_PAYLOAD_INCOMPLETE', 400);
      }
      let originalTransactionId: string | null = null;
      let transactionId: string | null = null;
      if (decoded.data?.signedTransactionInfo) {
        const tx = await verifier.verifyTransaction(decoded.data.signedTransactionInfo, endpointEnvironment);
        const summary = summarizeTransaction(tx, endpointEnvironment, null);
        originalTransactionId = summary.originalTransactionId;
        transactionId = summary.transactionId;
      }
      const persist = deps.persistInbox ?? (args => defaultPersist(deps.supabase, args));
      const result = await persist({
        p_endpoint_environment: endpointEnvironment,
        p_payload_environment: payloadEnvironment,
        p_notification_uuid: decoded.notificationUUID,
        p_notification_type: String(decoded.notificationType),
        p_subtype: decoded.subtype ? String(decoded.subtype) : null,
        p_signed_date: new Date(decoded.signedDate).toISOString(),
        p_original_transaction_id: originalTransactionId,
        p_transaction_id: transactionId,
        p_payload_hash: sha256(signedPayload),
      });
      const known = KNOWN_TYPES.has(String(decoded.notificationType));
      console.info('[app-store-notifications-v2]', safeLogFields({environment: endpointEnvironment,
        notificationType: String(decoded.notificationType), known, duplicate: result.duplicate}));
      return json(200, {ok: true, duplicate: result.duplicate, disposition: known ? 'accepted' : 'accepted-unknown'});
    } catch (error) {
      const known = error instanceof AppleServiceError ? error : new AppleServiceError('APPLE_NOTIFICATION_FAILED', 502);
      console.warn('[app-store-notifications-v2]', safeLogFields({environment: endpointEnvironment, code: known.code}));
      return json(known.status, {ok: false, code: known.code});
    }
  };
}
