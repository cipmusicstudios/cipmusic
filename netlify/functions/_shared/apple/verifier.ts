import {
  APIException, AppStoreServerAPIClient, SignedDataVerifier,
  type JWSTransactionDecodedPayload, type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';
import type {AppleConfig} from './config';
import {loadAppleRootCertificates, toAppleEnvironment} from './config';
import type {AppleEnvironment, AppleTransactionLookup, AppleVerifier} from './types';
import {AppleServiceError} from './types';

export function assertAppleJwsHeader(jws: string): void {
  const encodedHeader = jws.split('.')[0];
  if (!encodedHeader) throw new AppleServiceError('APPLE_JWS_HEADER_INVALID', 400);
  try {
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (header.alg !== 'ES256') throw new AppleServiceError('APPLE_JWS_ALGORITHM_INVALID', 400);
    if (!Array.isArray(header.x5c) || header.x5c.length !== 3
      || header.x5c.some(value => typeof value !== 'string' || value.length === 0)) {
      throw new AppleServiceError('APPLE_JWS_CERT_CHAIN_INVALID', 400);
    }
  } catch (error) {
    if (error instanceof AppleServiceError) throw error;
    throw new AppleServiceError('APPLE_JWS_HEADER_INVALID', 400);
  }
}

export class OfficialAppleVerifier implements AppleVerifier {
  constructor(private readonly config: AppleConfig, private readonly roots = loadAppleRootCertificates()) {}

  private verifier(environment: AppleEnvironment): SignedDataVerifier {
    return new SignedDataVerifier(
      this.roots, true, toAppleEnvironment(environment), this.config.bundleId,
      environment === 'production' ? this.config.appId : undefined,
    );
  }

  verifyTransaction(jws: string, environment: AppleEnvironment): Promise<JWSTransactionDecodedPayload> {
    assertAppleJwsHeader(jws);
    return this.verifier(environment).verifyAndDecodeTransaction(jws);
  }

  verifyNotification(jws: string, environment: AppleEnvironment): Promise<ResponseBodyV2DecodedPayload> {
    assertAppleJwsHeader(jws);
    return this.verifier(environment).verifyAndDecodeNotification(jws);
  }

  verifyRenewal(jws: string, environment: AppleEnvironment) {
    assertAppleJwsHeader(jws);
    return this.verifier(environment).verifyAndDecodeRenewalInfo(jws);
  }
}

export class OfficialAppleTransactionLookup implements AppleTransactionLookup {
  constructor(private readonly config: AppleConfig) {}

  private client(environment: AppleEnvironment): AppStoreServerAPIClient {
    return new AppStoreServerAPIClient(
      this.config.privateKey, this.config.keyId, this.config.issuerId,
      this.config.bundleId, toAppleEnvironment(environment),
    );
  }

  async lookup(transactionId: string, environment: AppleEnvironment) {
    try {
      const result = await this.client(environment).getTransactionInfo(transactionId);
      if (!result.signedTransactionInfo) throw new AppleServiceError('APPLE_EMPTY_RESPONSE', 502);
      return {signedTransactionInfo: result.signedTransactionInfo, environment};
    } catch (error) {
      const mayFallback = environment === 'production' && error instanceof APIException && error.httpStatusCode === 404;
      if (!mayFallback) throw error;
      const result = await this.client('sandbox').getTransactionInfo(transactionId);
      if (!result.signedTransactionInfo) throw new AppleServiceError('APPLE_EMPTY_RESPONSE', 502);
      return {signedTransactionInfo: result.signedTransactionInfo, environment: 'sandbox' as const};
    }
  }
}
