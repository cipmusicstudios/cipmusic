import {randomUUID} from 'node:crypto';
import type {JWSTransactionDecodedPayload} from '@apple/app-store-server-library';
import {APPLE_PRODUCTS, APPLE_SUBSCRIPTION_GROUP_ID, AppleServiceError, type AppleEnvironment, type AppleNormalizedStatus, type TransactionSummary} from './types';
import {sha256} from './redaction';

const iso = (value?: number): string | null => value == null ? null : new Date(value).toISOString();

export function canonicalEnvironment(value: unknown): AppleEnvironment {
  const text = String(value ?? '').toLowerCase();
  if (text === 'production') return 'production';
  if (text === 'sandbox') return 'sandbox';
  throw new AppleServiceError('ENVIRONMENT_MISMATCH', 400);
}

export function summarizeTransaction(
  tx: JWSTransactionDecodedPayload,
  expectedEnvironment: AppleEnvironment,
  expectedUserId: string | null,
): TransactionSummary {
  const environment = canonicalEnvironment(tx.environment);
  if (environment !== expectedEnvironment) throw new AppleServiceError('ENVIRONMENT_MISMATCH', 400);
  if (tx.bundleId !== 'com.cipmusic.aurasounds') throw new AppleServiceError('BUNDLE_ID_MISMATCH', 400);
  if (!tx.productId || !APPLE_PRODUCTS.has(tx.productId)) throw new AppleServiceError('PRODUCT_ID_MISMATCH', 400);
  if (tx.subscriptionGroupIdentifier !== APPLE_SUBSCRIPTION_GROUP_ID) {
    throw new AppleServiceError('SUBSCRIPTION_GROUP_MISMATCH', 400);
  }
  if (!tx.transactionId || !tx.originalTransactionId || !tx.signedDate) {
    throw new AppleServiceError('APPLE_PAYLOAD_INCOMPLETE', 400);
  }
  if (tx.appAccountToken && expectedUserId && tx.appAccountToken.toLowerCase() !== expectedUserId.toLowerCase()) {
    throw new AppleServiceError('APP_ACCOUNT_TOKEN_MISMATCH', 409);
  }
  const revoked = tx.revocationDate != null;
  // Derive persisted semantics from signed fields only. Using wall-clock time here
  // would give the same immutable transaction a different replay hash after expiry.
  const expired = tx.expiresDate != null && tx.expiresDate <= tx.signedDate;
  const normalizedStatus: AppleNormalizedStatus = revoked ? 'refunded' : tx.isUpgraded ? 'upgraded' : expired ? 'expired' : 'active';
  const grantsPremium = environment === 'production' && !revoked && !tx.isUpgraded
    && Boolean(tx.expiresDate && tx.expiresDate > tx.signedDate);
  const summaryWithoutHash = {
    environment, transactionId: tx.transactionId, originalTransactionId: tx.originalTransactionId,
    productId: tx.productId, subscriptionGroupId: tx.subscriptionGroupIdentifier,
    appAccountToken: tx.appAccountToken ?? null, purchaseDate: iso(tx.purchaseDate),
    expiresDate: iso(tx.expiresDate), signedDate: iso(tx.signedDate)!, revocationDate: iso(tx.revocationDate),
    revocationReason: typeof tx.revocationReason === 'number' ? tx.revocationReason : null,
    transactionReason: tx.transactionReason ? String(tx.transactionReason) : null,
    ownershipType: tx.inAppOwnershipType ? String(tx.inAppOwnershipType) : null,
    normalizedStatus, grantsPremium,
  };
  return {...summaryWithoutHash, summaryHash: sha256(JSON.stringify(summaryWithoutHash))};
}

export function assertTransactionRequestMatch(
  summary: TransactionSummary,
  requestedTransactionId: string | undefined,
): void {
  if (requestedTransactionId && summary.transactionId !== requestedTransactionId) {
    throw new AppleServiceError('TRANSACTION_ID_MISMATCH', 400);
  }
}

export const testUuid = () => randomUUID();
