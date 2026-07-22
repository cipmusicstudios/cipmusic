import type {SupabaseClient} from '@supabase/supabase-js';
import {AppleServiceError, type AppleEnvironment, type TransactionSummary} from './types';

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
  allowLegacyClaim: boolean,
): Promise<{bindingResult: string; duplicate: boolean}> {
  const {data, error} = await supabase.rpc('billing_record_app_store_transaction', {
    p_user_id: userId,
    p_endpoint_environment: endpointEnvironment,
    p_payload_environment: summary.environment,
    p_transaction_id: summary.transactionId,
    p_original_transaction_id: summary.originalTransactionId,
    p_product_id: summary.productId,
    p_subscription_group_id: summary.subscriptionGroupId,
    p_app_account_token: summary.appAccountToken,
    p_purchase_date: summary.purchaseDate,
    p_expires_date: summary.expiresDate,
    p_signed_date: summary.signedDate,
    p_revocation_date: summary.revocationDate,
    p_revocation_reason: summary.revocationReason,
    p_transaction_reason: summary.transactionReason,
    p_ownership_type: summary.ownershipType,
    p_normalized_status: summary.normalizedStatus,
    p_grants_premium: summary.grantsPremium,
    p_auto_renew: null,
    p_summary_hash: summary.summaryHash,
    p_allow_legacy_claim: allowLegacyClaim,
  });
  if (error) {
    const message = String(error.message ?? '');
    if (/ALREADY_BOUND|BINDING_BLOCKED|TOMBSTONED|APP_ACCOUNT_TOKEN_MISMATCH/.test(message)) {
      throw new AppleServiceError('SUBSCRIPTION_BOUND_TO_ANOTHER_ACCOUNT', 409);
    }
    if (/TRANSACTION_REPLAY_MISMATCH/.test(message)) {
      throw new AppleServiceError('TRANSACTION_REPLAY_CONFLICT', 409);
    }
    if (/APPLE_LEDGER_WRITE_DISABLED/.test(message)) {
      throw new AppleServiceError('FEATURE_DISABLED', 503);
    }
    if (/ENVIRONMENT_MISMATCH|PRODUCT_MISMATCH|SUBSCRIPTION_GROUP_MISMATCH|INVALID_PREMIUM_GRANT|SANDBOX_PRODUCTION_GRANT_FORBIDDEN/.test(message)) {
      throw new AppleServiceError('VERIFIED_PAYLOAD_REJECTED', 400);
    }
    throw new AppleServiceError('LEDGER_WRITE_FAILED', 503);
  }
  const row = firstRecord(data);
  if (!row || typeof row.binding_result !== 'string' || typeof row.transaction_duplicate !== 'boolean') {
    throw new AppleServiceError('LEDGER_RESPONSE_INVALID', 503);
  }
  return {bindingResult: row.binding_result, duplicate: row.transaction_duplicate};
}
