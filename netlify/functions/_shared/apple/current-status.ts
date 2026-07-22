import {
  AppStoreServerAPIClient, AutoRenewStatus, Status,
} from '@apple/app-store-server-library';
import type {AppleConfig} from './config';
import {toAppleEnvironment} from './config';
import {appAccountTokenHash, sha256} from './redaction';
import {summarizeTransaction} from './transaction';
import type {
  AppleCurrentStatusProvider, AppleEnvironment, AppleNormalizedStatus,
  AppleVerifier, CurrentEntitlementStatus, TransactionSummary,
} from './types';
import {AppleServiceError} from './types';

type CurrentStatusApi = Pick<AppStoreServerAPIClient, 'getAllSubscriptionStatuses'>;
type CurrentStatusApiFactory = (environment: AppleEnvironment) => CurrentStatusApi;

const iso = (value?: number): string | null => value == null ? null : new Date(value).toISOString();

export class OfficialAppleCurrentStatusProvider implements AppleCurrentStatusProvider {
  constructor(
    private readonly config: AppleConfig,
    private readonly verifier: AppleVerifier,
    private readonly apiFactory?: CurrentStatusApiFactory,
  ) {}

  private client(environment: AppleEnvironment): CurrentStatusApi {
    return this.apiFactory?.(environment) ?? new AppStoreServerAPIClient(
      this.config.privateKey, this.config.keyId, this.config.issuerId,
      this.config.bundleId, toAppleEnvironment(environment),
    );
  }

  async lookupCurrentStatus(
    transaction: TransactionSummary,
    environment: AppleEnvironment,
  ): Promise<CurrentEntitlementStatus> {
    const response = await this.client(environment).getAllSubscriptionStatuses(transaction.transactionId);
    if (String(response.environment ?? '').toLowerCase() !== environment
      || response.bundleId !== this.config.bundleId
      || (environment === 'production' && response.appAppleId !== this.config.appId)) {
      throw new AppleServiceError('CURRENT_STATUS_INVALID', 502);
    }

    const candidates: CurrentEntitlementStatus[] = [];
    for (const group of response.data ?? []) {
      if (group.subscriptionGroupIdentifier !== transaction.subscriptionGroupId) continue;
      for (const item of group.lastTransactions ?? []) {
        if (item.originalTransactionId !== transaction.originalTransactionId || !item.signedTransactionInfo) continue;
        const currentTx = await this.verifier.verifyTransaction(item.signedTransactionInfo, environment);
        const currentFacts = summarizeTransaction(currentTx, environment, null);
        if (currentFacts.originalTransactionId !== transaction.originalTransactionId) {
          throw new AppleServiceError('CURRENT_STATUS_INVALID', 502);
        }
        const renewal = item.signedRenewalInfo
          ? await this.verifier.verifyRenewal(item.signedRenewalInfo, environment)
          : null;
        if (renewal?.originalTransactionId && renewal.originalTransactionId !== transaction.originalTransactionId) {
          throw new AppleServiceError('CURRENT_STATUS_INVALID', 502);
        }

        const status = Number(item.status);
        let normalizedStatus: AppleNormalizedStatus;
        if (currentTx.revocationDate != null || status === Status.REVOKED) normalizedStatus = 'revoked';
        else if (currentTx.isUpgraded) normalizedStatus = 'upgraded';
        else if (status === Status.EXPIRED) normalizedStatus = 'expired';
        else if (status === Status.BILLING_RETRY) normalizedStatus = 'billing_retry';
        else if (status === Status.BILLING_GRACE_PERIOD) normalizedStatus = 'grace_period';
        else if (status === Status.ACTIVE && renewal?.autoRenewStatus === AutoRenewStatus.OFF) normalizedStatus = 'canceled_active';
        else if (status === Status.ACTIVE) normalizedStatus = 'active';
        else normalizedStatus = 'unknown';

        const expiresAt = status === Status.BILLING_GRACE_PERIOD
          ? iso(renewal?.gracePeriodExpiresDate)
          : currentFacts.expiresDate;
        const statusCanGrant = ['active', 'grace_period', 'canceled_active'].includes(normalizedStatus);
        if (statusCanGrant && (expiresAt == null || Date.parse(expiresAt) <= Date.now())) {
          throw new AppleServiceError('CURRENT_STATUS_INVALID', 502);
        }
        const grantsPremium = environment === 'production' && statusCanGrant;
        const sourceSignedDateMs = Math.max(currentTx.signedDate ?? 0, renewal?.signedDate ?? 0);
        if (!sourceSignedDateMs) throw new AppleServiceError('CURRENT_STATUS_INVALID', 502);
        const stableEvidence = {
          environment,
          originalTransactionId: currentFacts.originalTransactionId,
          latestTransactionId: currentFacts.transactionId,
          productId: currentFacts.productId,
          subscriptionGroupId: currentFacts.subscriptionGroupId,
          appAccountTokenHash: currentFacts.appAccountToken ? appAccountTokenHash(currentFacts.appAccountToken) : null,
          normalizedStatus,
          grantsPremium,
          expiresAt,
          autoRenew: renewal?.autoRenewStatus == null ? null : renewal.autoRenewStatus === AutoRenewStatus.ON,
          sourceSignedDate: new Date(sourceSignedDateMs).toISOString(),
        };
        candidates.push({...stableEvidence, evidenceHash: sha256(JSON.stringify(stableEvidence))});
      }
    }
    if (!candidates.length) throw new AppleServiceError('CURRENT_STATUS_REQUIRED', 503);
    candidates.sort((a, b) => b.sourceSignedDate.localeCompare(a.sourceSignedDate));
    const latest = candidates[0];
    const sameVersion = candidates.filter(value => value.sourceSignedDate === latest.sourceSignedDate);
    if (sameVersion.some(value => value.evidenceHash !== latest.evidenceHash)) {
      throw new AppleServiceError('CURRENT_STATE_AMBIGUOUS', 409);
    }
    return latest;
  }
}
