import {randomUUID} from 'node:crypto';
import type {JWSTransactionDecodedPayload} from '@apple/app-store-server-library';
import {APPLE_PRODUCTS, APPLE_SUBSCRIPTION_GROUP_ID, AppleServiceError, type AppleEnvironment, type TransactionSummary} from './types';
import {appAccountTokenHash, sha256} from './redaction';

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
  const transactionStatus: TransactionSummary['transactionStatus'] = tx.revocationDate != null
    ? 'revoked' : tx.isUpgraded ? 'upgraded' : 'recorded';
  const summaryWithoutHash = {
    environment, transactionId: tx.transactionId, originalTransactionId: tx.originalTransactionId,
    productId: tx.productId, subscriptionGroupId: tx.subscriptionGroupIdentifier,
    appAccountToken: tx.appAccountToken ?? null, purchaseDate: iso(tx.purchaseDate),
    expiresDate: iso(tx.expiresDate), signedDate: iso(tx.signedDate)!, revocationDate: iso(tx.revocationDate),
    revocationReason: typeof tx.revocationReason === 'number' ? tx.revocationReason : null,
    transactionReason: tx.transactionReason ? String(tx.transactionReason) : null,
    ownershipType: tx.inAppOwnershipType ? String(tx.inAppOwnershipType) : null,
    transactionStatus,
  };
  return {...summaryWithoutHash, summaryHash: sha256(JSON.stringify(summaryWithoutHash))};
}


export function hashAppAccountToken(value: string | null): string | null {
  return value ? appAccountTokenHash(value) : null;
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
