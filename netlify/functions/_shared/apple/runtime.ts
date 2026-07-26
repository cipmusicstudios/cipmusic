import type {SupabaseClient} from '@supabase/supabase-js';
import {hashAppAccountToken} from './transaction';
import {
  AppleServiceError, type AppleEnvironment, type ClaimIntent,
  type CurrentEntitlementStatus, type TransactionSummary,
} from './types';

export type RuntimeControls = {
  appleVerificationEnabled: boolean;
  appleLedgerWriteEnabled: boolean;
  appleMembershipWritebackEnabled: boolean;
  aggregateMode: 'off' | 'shadow' | 'write';
  legacyProtectionEnabled: boolean;
};

export const CLOSED_CONTROLS: RuntimeControls = {
  appleVerificationEnabled: false,
  appleLedgerWriteEnabled: false,
  appleMembershipWritebackEnabled: false,
  aggregateMode: 'off',
  legacyProtectionEnabled: false,
};

function firstRecord(data: unknown): Record<string, unknown> | null {
  const value = Array.isArray(data) ? data[0] : data;
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function readRuntimeControls(supabase: SupabaseClient): Promise<RuntimeControls> {
  const {data, error} = await supabase.rpc('billing_get_runtime_controls');
  const row = firstRecord(data);
  if (error || !row) throw new AppleServiceError('FEATURE_CONFIG_UNAVAILABLE', 503);
  if (
    typeof row.apple_verification_enabled !== 'boolean'
    || typeof row.apple_ledger_write_enabled !== 'boolean'
    || typeof row.apple_membership_writeback_enabled !== 'boolean'
    || typeof row.legacy_protection_enabled !== 'boolean'
    || !['off', 'shadow', 'write'].includes(String(row.aggregate_mode))
  ) throw new AppleServiceError('FEATURE_CONFIG_UNAVAILABLE', 503);
  return {
    appleVerificationEnabled: row.apple_verification_enabled,
    appleLedgerWriteEnabled: row.apple_ledger_write_enabled,
    appleMembershipWritebackEnabled: row.apple_membership_writeback_enabled,
    aggregateMode: String(row.aggregate_mode) as RuntimeControls['aggregateMode'],
    legacyProtectionEnabled: row.legacy_protection_enabled,
  };
}

export async function writeTransactionLedger(
  supabase: SupabaseClient,
  userId: string,
  endpointEnvironment: AppleEnvironment,
  summary: TransactionSummary,
  current: CurrentEntitlementStatus,
  claimIntent: ClaimIntent,
  legacyClaimConfirmed: boolean,
): Promise<{bindingResult: string; duplicate: boolean; currentStateQuality: string}> {
  const {data, error} = await supabase.rpc('billing_record_app_store_transaction', {
    p_user_id: userId,
    p_endpoint_environment: endpointEnvironment,
    p_payload_environment: summary.environment,
    p_transaction_id: summary.transactionId,
    p_original_transaction_id: summary.originalTransactionId,
    p_product_id: summary.productId,
    p_subscription_group_id: summary.subscriptionGroupId,
    p_app_account_token_hash: hashAppAccountToken(summary.appAccountToken),
    p_purchase_date: summary.purchaseDate,
    p_expires_date: summary.expiresDate,
    p_signed_date: summary.signedDate,
    p_revocation_date: summary.revocationDate,
    p_revocation_reason: summary.revocationReason,
    p_transaction_reason: summary.transactionReason,
    p_ownership_type: summary.ownershipType,
    p_transaction_status: summary.transactionStatus,
    p_summary_hash: summary.summaryHash,
    p_claim_intent: claimIntent,
    p_legacy_claim_confirmed: legacyClaimConfirmed,
    p_current_transaction_id: current.latestTransactionId,
    p_current_product_id: current.productId,
    p_current_subscription_group_id: current.subscriptionGroupId,
    p_current_app_account_token_hash: current.appAccountTokenHash,
    p_current_normalized_status: current.normalizedStatus,
    p_current_grants_premium: current.grantsPremium,
    p_current_expires_at: current.expiresAt,
    p_current_auto_renew: current.autoRenew,
    p_transaction_evidence_signed_at: current.transactionEvidenceSignedAt,
    p_renewal_evidence_signed_at: current.renewalEvidenceSignedAt,
    p_status_observed_at: current.statusObservedAt,
    p_status_fingerprint: current.statusFingerprint,
    p_conflicting_status_fingerprint: current.conflictingStatusFingerprint,
    p_status_source: current.statusSource,
    p_current_state_quality: current.currentStateQuality,
  });
  if (error) {
    const message = String(error.message ?? '');
    if (/ALREADY_BOUND|BINDING_BLOCKED|TOMBSTONED|APP_ACCOUNT_TOKEN_MISMATCH/.test(message)) {
      throw new AppleServiceError('SUBSCRIPTION_BOUND_TO_ANOTHER_ACCOUNT', 409);
    }
    if (/TRANSACTION_REPLAY_MISMATCH/.test(message)) {
      if (claimIntent === 'restore' && current.currentStateQuality === 'verified'
        && summary.appAccountToken == null && current.appAccountTokenHash == null) {
        return claimVerifiedUnclaimedTransaction(supabase, userId, endpointEnvironment, summary, current);
      }
      throw new AppleServiceError('TRANSACTION_REPLAY_CONFLICT', 409);
    }
    if (/LEGACY_CLAIM_CONFIRMATION_REQUIRED/.test(message)) {
      throw new AppleServiceError('LEGACY_CLAIM_CONFIRMATION_REQUIRED', 400);
    }
    if (/LEGACY_CLAIM_NOT_ALLOWED/.test(message)) {
      throw new AppleServiceError('LEGACY_CLAIM_NOT_ALLOWED', 409);
    }
    if (/APPLE_LEDGER_WRITE_DISABLED/.test(message)) {
      throw new AppleServiceError('FEATURE_DISABLED', 503);
    }
    if (/ENVIRONMENT_MISMATCH|PRODUCT_MISMATCH|SUBSCRIPTION_GROUP_MISMATCH|INVALID_PREMIUM_GRANT|SANDBOX_PRODUCTION_GRANT_FORBIDDEN|CURRENT_STATUS_INVALID|CURRENT_STATUS_FINGERPRINT_MISMATCH/.test(message)) {
      throw new AppleServiceError('VERIFIED_PAYLOAD_REJECTED', 400);
    }
    throw new AppleServiceError('LEDGER_WRITE_FAILED', 503);
  }
  const row = firstRecord(data);
  if (!row || typeof row.binding_result !== 'string' || typeof row.transaction_duplicate !== 'boolean'
    || !['verified', 'quarantined'].includes(String(row.current_state_quality))) {
    throw new AppleServiceError('LEDGER_RESPONSE_INVALID', 503);
  }
  const result = {bindingResult: row.binding_result, duplicate: row.transaction_duplicate,
    currentStateQuality: String(row.current_state_quality)};
  if (claimIntent === 'restore' && current.currentStateQuality === 'verified'
    && result.bindingResult === 'unclaimed' && result.duplicate
    && summary.appAccountToken == null && current.appAccountTokenHash == null) {
    return claimVerifiedUnclaimedTransaction(supabase, userId, endpointEnvironment, summary, current);
  }
  return result;
}

async function claimVerifiedUnclaimedTransaction(
  supabase: SupabaseClient,
  userId: string,
  environment: AppleEnvironment,
  summary: TransactionSummary,
  current: CurrentEntitlementStatus,
): Promise<{bindingResult: string; duplicate: boolean; currentStateQuality: string}> {
  const {data, error} = await supabase.rpc('billing_claim_verified_unclaimed_app_store_entitlement', {
    p_user_id: userId,
    p_environment: environment,
    p_transaction_id: summary.transactionId,
    p_original_transaction_id: summary.originalTransactionId,
    p_product_id: summary.productId,
    p_subscription_group_id: summary.subscriptionGroupId,
    p_app_account_token_hash: null,
    p_purchase_date: summary.purchaseDate,
    p_expires_date: summary.expiresDate,
    p_signed_date: summary.signedDate,
    p_revocation_date: summary.revocationDate,
    p_revocation_reason: summary.revocationReason,
    p_transaction_reason: summary.transactionReason,
    p_ownership_type: summary.ownershipType,
    p_transaction_status: summary.transactionStatus,
    p_summary_hash: summary.summaryHash,
    p_current_transaction_id: current.latestTransactionId,
    p_current_product_id: current.productId,
    p_current_subscription_group_id: current.subscriptionGroupId,
    p_current_app_account_token_hash: null,
    p_status_fingerprint: current.statusFingerprint,
  });
  if (error) {
    const message = String(error.message ?? '');
    if (/ALREADY_BOUND|BINDING_BLOCKED|TOKEN_PRESENT/.test(message)) {
      throw new AppleServiceError('SUBSCRIPTION_BOUND_TO_ANOTHER_ACCOUNT', 409);
    }
    if (/REPLAY_MISMATCH|CHAIN_MISMATCH|EVIDENCE_MISMATCH|PRODUCTION_ONLY/.test(message)) {
      throw new AppleServiceError('TRANSACTION_REPLAY_CONFLICT', 409);
    }
    if (/APPLE_LEDGER_WRITE_DISABLED/.test(message)) {
      throw new AppleServiceError('FEATURE_DISABLED', 503);
    }
    throw new AppleServiceError('LEDGER_WRITE_FAILED', 503);
  }
  const row = firstRecord(data);
  if (!row || !['claimed', 'already_claimed'].includes(String(row.binding_result))
    || row.transaction_duplicate !== true
    || !['verified', 'quarantined'].includes(String(row.current_state_quality))) {
    throw new AppleServiceError('LEDGER_RESPONSE_INVALID', 503);
  }
  return {bindingResult: String(row.binding_result), duplicate: true,
    currentStateQuality: String(row.current_state_quality)};
}
