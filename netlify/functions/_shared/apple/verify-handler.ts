import type {HandlerEvent, HandlerResponse} from '@netlify/functions';
import type {SupabaseClient} from '@supabase/supabase-js';
import {loadAppleConfig} from './config';
import {OfficialAppleCurrentStatusProvider} from './current-status';
import {bearer, CORS_HEADERS, json} from './http';
import {safeLogFields} from './redaction';
import {readRuntimeControls, writeTransactionLedger, type RuntimeControls} from './runtime';
import {assertTransactionRequestMatch, summarizeTransaction} from './transaction';
import {AppleServiceError, type AppleCurrentStatusProvider, type AppleTransactionLookup, type AppleVerifier, type ClaimIntent} from './types';
import {OfficialAppleTransactionLookup, OfficialAppleVerifier} from './verifier';

type VerifyDeps = {
  supabase: SupabaseClient;
  readControls?: (client: SupabaseClient) => Promise<RuntimeControls>;
  authenticate?: (client: SupabaseClient, token: string) => Promise<string | null>;
  verifier?: AppleVerifier;
  lookup?: AppleTransactionLookup;
  currentStatus?: AppleCurrentStatusProvider;
  persist?: typeof writeTransactionLedger;
};

const authenticate = async (client: SupabaseClient, token: string): Promise<string | null> => {
  const result = await client.auth.getUser(token);
  return result.error ? null : result.data.user?.id ?? null;
};

export function createVerifyHandler(deps: VerifyDeps) {
  return async (event: HandlerEvent): Promise<HandlerResponse> => {
    if (event.httpMethod === 'OPTIONS') return {statusCode: 204, headers: CORS_HEADERS, body: ''};
    if (event.httpMethod !== 'POST') return json(405, {ok: false, code: 'METHOD_NOT_ALLOWED'});
    if (Buffer.byteLength(event.body ?? '', 'utf8') > 131072) return json(413, {ok: false, code: 'BODY_TOO_LARGE'});
    const token = bearer(event);
    if (!token) return json(401, {ok: false, code: 'UNAUTHENTICATED'});

    let body: Record<string, unknown>;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, {ok: false, code: 'INVALID_JSON'}); }
    if ('userId' in body || 'user_id' in body || 'authingUserId' in body) {
      return json(400, {ok: false, code: 'CLIENT_USER_ID_FORBIDDEN'});
    }
    const signedTransactionInfo = typeof body.signedTransactionInfo === 'string' ? body.signedTransactionInfo.trim() : '';
    const transactionId = typeof body.transactionId === 'string' ? body.transactionId.trim() : '';
    const claimIntent = body.claimIntent;
    if (!['purchase', 'restore', 'legacy_claim'].includes(String(claimIntent))) {
      return json(400, {ok: false, code: 'CLAIM_INTENT_REQUIRED'});
    }
    const legacyClaimConfirmed = body.legacyClaimConfirmed === true;
    if (claimIntent === 'legacy_claim' && !legacyClaimConfirmed) {
      return json(400, {ok: false, code: 'LEGACY_CLAIM_CONFIRMATION_REQUIRED'});
    }
    if (!signedTransactionInfo && !transactionId) return json(400, {ok: false, code: 'TRANSACTION_REFERENCE_REQUIRED'});
    if (signedTransactionInfo.length > 65536 || transactionId.length > 128) return json(413, {ok: false, code: 'BODY_TOO_LARGE'});

    try {
      const userId = await (deps.authenticate ?? authenticate)(deps.supabase, token);
      if (!userId) throw new AppleServiceError('INVALID_SESSION', 401);
      const controls = await (deps.readControls ?? readRuntimeControls)(deps.supabase);
      if (!controls.appleVerificationEnabled) throw new AppleServiceError('FEATURE_DISABLED', 503);

      const config = loadAppleConfig();
      const lookup = deps.lookup ?? new OfficialAppleTransactionLookup(config);
      const verifier = deps.verifier ?? new OfficialAppleVerifier(config);
      let jws = signedTransactionInfo;
      let environment = config.environment;
      if (!jws) {
        const result = await lookup.lookup(transactionId, config.environment);
        jws = result.signedTransactionInfo;
        environment = result.environment;
      }
      const decoded = await verifier.verifyTransaction(jws, environment);
      const summary = summarizeTransaction(decoded, environment, userId);
      assertTransactionRequestMatch(summary, transactionId || undefined);

      if (!controls.appleLedgerWriteEnabled) {
        return json(200, {ok: true, mode: 'verification-only', persisted: false, membershipSynced: false,
          productionEntitlementVerified: false, safeToFinishTransaction: false,
          environment: summary.environment, transactionVerified: true, currentStatusVerified: false});
      }
      const currentProvider = deps.currentStatus ?? new OfficialAppleCurrentStatusProvider(config, verifier);
      const current = await currentProvider.lookupCurrentStatus(summary, environment);
      if (current.originalTransactionId !== summary.originalTransactionId || current.environment !== environment) {
        throw new AppleServiceError('CURRENT_STATUS_INVALID', 502);
      }
      if (claimIntent === 'legacy_claim'
        && (summary.appAccountToken || current.appAccountTokenHash || !current.grantsPremium
          || current.currentStateQuality !== 'verified')) {
        throw new AppleServiceError('LEGACY_CLAIM_NOT_ALLOWED', 409);
      }
      const result = await (deps.persist ?? writeTransactionLedger)(
        deps.supabase, userId, environment, summary, current,
        claimIntent as ClaimIntent, legacyClaimConfirmed,
      );
      if (result.currentStateQuality === 'quarantined') {
        throw new AppleServiceError('CURRENT_STATE_QUARANTINED', 409);
      }
      const safelyBound = ['claimed', 'already_claimed'].includes(result.bindingResult);
      return json(200, {ok: true, mode: 'ledger-only', persisted: true, membershipSynced: false,
        productionEntitlementVerified: current.environment === 'production' && current.grantsPremium,
        // This is the sole client acknowledgement contract: the verified current
        // entitlement is durably persisted and belongs to the authenticated user.
        safeToFinishTransaction: safelyBound && result.currentStateQuality === 'verified',
        entitlementGrantsProductionPremium: current.environment === 'production' && current.grantsPremium,
        environment: summary.environment, status: current.normalizedStatus,
        transactionVerified: true, currentStatusVerified: true,
        binding: result.bindingResult, duplicate: result.duplicate});
    } catch (error) {
      const known = error instanceof AppleServiceError ? error : new AppleServiceError('APPLE_VERIFICATION_FAILED', 502);
      console.warn('[verify-app-store-transaction]', safeLogFields({code: known.code}));
      return json(known.status, {ok: false, code: known.code});
    }
  };
}
