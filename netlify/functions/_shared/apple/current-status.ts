import {
  AppStoreServerAPIClient, AutoRenewStatus, Status,
} from '@apple/app-store-server-library';
import type {AppleConfig} from './config';
import {toAppleEnvironment} from './config';
import {appAccountTokenHash, sha256} from './redaction';
import {normalizeAppleSubscriptionStatus} from './status';
import {summarizeTransaction} from './transaction';
import type {
  AppleCurrentStatusProvider, AppleEnvironment, AppleNormalizedStatus,
  AppleVerifier, CurrentEntitlementStatus, TransactionSummary,
} from './types';
import {AppleServiceError} from './types';

type CurrentStatusApi = Pick<AppStoreServerAPIClient, 'getAllSubscriptionStatuses'>;
type CurrentStatusApiFactory = (environment: AppleEnvironment) => CurrentStatusApi;

const iso = (value?: number): string | null => value == null ? null : new Date(value).toISOString();

export function currentStatusFingerprint(value: Omit<CurrentEntitlementStatus,
  'statusObservedAt' | 'statusFingerprint' | 'conflictingStatusFingerprint' | 'currentStateQuality'>): string {
  return sha256([
    value.environment, value.originalTransactionId, value.latestTransactionId, value.productId,
    value.subscriptionGroupId, value.appAccountTokenHash ?? '', value.normalizedStatus,
    String(value.grantsPremium), value.expiresAt ?? '', value.autoRenew == null ? '' : String(value.autoRenew),
    value.statusSource,
  ].join('|'));
}

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
    if (!response || String(response.environment ?? '').toLowerCase() !== environment
      || response.bundleId !== this.config.bundleId
      || (environment === 'production' && response.appAppleId !== this.config.appId)) {
      throw new AppleServiceError('CURRENT_STATUS_INVALID', 502);
    }

    const observedAt = new Date().toISOString();
    const candidates: CurrentEntitlementStatus[] = [];
    for (const group of response.data ?? []) {
      if (group.subscriptionGroupIdentifier !== transaction.subscriptionGroupId) continue;
      for (const item of group.lastTransactions ?? []) {
        if (!item.originalTransactionId || !item.signedTransactionInfo || item.status == null) {
          throw new AppleServiceError('CURRENT_STATUS_INVALID', 502);
        }
        if (item.originalTransactionId !== transaction.originalTransactionId) {
          throw new AppleServiceError('CURRENT_STATUS_INVALID', 502);
        }
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
        const expiresAt = status === Status.BILLING_GRACE_PERIOD
          ? iso(renewal?.gracePeriodExpiresDate)
          : currentFacts.expiresDate;
        const normalized = normalizeAppleSubscriptionStatus({
          status, revoked: currentTx.revocationDate != null, upgraded: currentTx.isUpgraded,
          expiresAt: currentTx.expiresDate, graceExpiresAt: renewal?.gracePeriodExpiresDate,
          autoRenewOff: renewal?.autoRenewStatus === AutoRenewStatus.OFF,
        });
        const normalizedStatus = normalized.status as AppleNormalizedStatus;
        if (normalized.grantsPremium && (expiresAt == null || Date.parse(expiresAt) <= Date.now())) {
          throw new AppleServiceError('CURRENT_STATUS_INVALID', 502);
        }
        const grantsPremium = environment === 'production' && normalized.grantsPremium;
        if (!currentTx.signedDate) throw new AppleServiceError('CURRENT_STATUS_INVALID', 502);
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
          transactionEvidenceSignedAt: new Date(currentTx.signedDate).toISOString(),
          renewalEvidenceSignedAt: renewal?.signedDate ? new Date(renewal.signedDate).toISOString() : null,
          statusSource: 'server_api_status' as const,
        };
        candidates.push({...stableEvidence, statusObservedAt: observedAt,
          statusFingerprint: currentStatusFingerprint(stableEvidence), conflictingStatusFingerprint: null,
          currentStateQuality: 'verified'});
      }
    }
    if (!candidates.length) throw new AppleServiceError('CURRENT_STATUS_REQUIRED', 503);
    const unique = [...new Map(candidates.map(value => [
      `${value.transactionEvidenceSignedAt}|${value.renewalEvidenceSignedAt ?? ''}|${value.statusFingerprint}`, value,
    ])).values()];
    unique.sort((a, b) => {
      const transactionOrder = b.transactionEvidenceSignedAt.localeCompare(a.transactionEvidenceSignedAt);
      return transactionOrder || (b.renewalEvidenceSignedAt ?? '').localeCompare(a.renewalEvidenceSignedAt ?? '');
    });
    const latest = unique[0];
    const sameEvidence = unique.filter(value =>
      value.transactionEvidenceSignedAt === latest.transactionEvidenceSignedAt
      && value.renewalEvidenceSignedAt === latest.renewalEvidenceSignedAt);
    const conflicting = sameEvidence.find(value => value.statusFingerprint !== latest.statusFingerprint);
    if (conflicting) {
      const fingerprints = [latest.statusFingerprint, conflicting.statusFingerprint].sort();
      return {...latest, normalizedStatus: 'unknown', grantsPremium: false, expiresAt: null,
        autoRenew: null, statusFingerprint: fingerprints[0], conflictingStatusFingerprint: fingerprints[1],
        currentStateQuality: 'quarantined'};
    }
    return latest;
  }
}
