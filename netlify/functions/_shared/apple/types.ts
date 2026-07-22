import type {
  JWSRenewalInfoDecodedPayload, JWSTransactionDecodedPayload, ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';

export const APPLE_PRODUCTS = new Set([
  'com.cipmusic.aurasounds.premium.monthly.v2',
  'com.cipmusic.aurasounds.premium.yearly.v2',
]);
export const APPLE_SUBSCRIPTION_GROUP_ID = '22099193';

export type AppleEnvironment = 'production' | 'sandbox';
export type AppleNormalizedStatus =
  | 'active' | 'expired' | 'grace_period' | 'billing_retry' | 'revoked'
  | 'refunded' | 'upgraded' | 'canceled_active' | 'unknown';

export type ClaimIntent = 'purchase' | 'restore' | 'legacy_claim';

export type TransactionSummary = {
  environment: AppleEnvironment;
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  subscriptionGroupId: string;
  appAccountToken: string | null;
  purchaseDate: string | null;
  expiresDate: string | null;
  signedDate: string;
  revocationDate: string | null;
  revocationReason: number | null;
  transactionReason: string | null;
  ownershipType: string | null;
  transactionStatus: 'recorded' | 'revoked' | 'upgraded';
  summaryHash: string;
};

export type CurrentEntitlementStatus = {
  environment: AppleEnvironment;
  originalTransactionId: string;
  latestTransactionId: string;
  productId: string;
  subscriptionGroupId: string;
  appAccountTokenHash: string | null;
  normalizedStatus: AppleNormalizedStatus;
  grantsPremium: boolean;
  expiresAt: string | null;
  autoRenew: boolean | null;
  sourceSignedDate: string;
  evidenceHash: string;
};

export interface AppleVerifier {
  verifyTransaction(jws: string, environment: AppleEnvironment): Promise<JWSTransactionDecodedPayload>;
  verifyNotification(jws: string, environment: AppleEnvironment): Promise<ResponseBodyV2DecodedPayload>;
  verifyRenewal(jws: string, environment: AppleEnvironment): Promise<JWSRenewalInfoDecodedPayload>;
}

export interface AppleTransactionLookup {
  lookup(transactionId: string, environment: AppleEnvironment): Promise<{signedTransactionInfo: string; environment: AppleEnvironment}>;
}

export interface AppleCurrentStatusProvider {
  lookupCurrentStatus(
    transaction: TransactionSummary,
    environment: AppleEnvironment,
  ): Promise<CurrentEntitlementStatus>;
}

export class AppleServiceError extends Error {
  constructor(public readonly code: string, public readonly status: number, message = code) {
    super(message);
  }
}
