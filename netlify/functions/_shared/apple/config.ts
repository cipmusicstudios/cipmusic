import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {Environment} from '@apple/app-store-server-library';
import type {AppleEnvironment} from './types';
import {AppleServiceError} from './types';

export type AppleConfig = {
  issuerId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
  appId: number;
  environment: AppleEnvironment;
};

const REQUIRED = [
  'APP_STORE_ISSUER_ID', 'APP_STORE_KEY_ID', 'APP_STORE_PRIVATE_KEY',
  'APP_STORE_BUNDLE_ID', 'APP_STORE_APP_ID', 'APP_STORE_ENVIRONMENT',
] as const;

export function normalizePrivateKey(value: string): string {
  return value.trim().replace(/\\n/g, '\n');
}

export function loadAppleConfig(env: NodeJS.ProcessEnv = process.env): AppleConfig {
  const missing = REQUIRED.filter(key => !env[key]?.trim());
  if (missing.length) throw new AppleServiceError('SERVICE_ENV_INCOMPLETE', 503);
  const environment = env.APP_STORE_ENVIRONMENT!.trim().toLowerCase();
  const appId = Number(env.APP_STORE_APP_ID);
  if (!['production', 'sandbox'].includes(environment) || !Number.isSafeInteger(appId)) {
    throw new AppleServiceError('SERVICE_ENV_INCOMPLETE', 503);
  }
  if (env.APP_STORE_BUNDLE_ID!.trim() !== 'com.cipmusic.aurasounds' || appId !== 6767718789) {
    throw new AppleServiceError('SERVICE_ENV_INCOMPLETE', 503);
  }
  const privateKey = normalizePrivateKey(env.APP_STORE_PRIVATE_KEY!);
  if (!privateKey.includes('BEGIN PRIVATE KEY') || !privateKey.includes('END PRIVATE KEY')) {
    throw new AppleServiceError('SERVICE_ENV_INCOMPLETE', 503);
  }
  return {
    issuerId: env.APP_STORE_ISSUER_ID!.trim(), keyId: env.APP_STORE_KEY_ID!.trim(), privateKey,
    bundleId: env.APP_STORE_BUNDLE_ID!.trim(), appId, environment: environment as AppleEnvironment,
  };
}

export function toAppleEnvironment(environment: AppleEnvironment): Environment {
  return environment === 'production' ? Environment.PRODUCTION : Environment.SANDBOX;
}

export function loadAppleRootCertificates(
  rootDir = join(
    process.env.LAMBDA_TASK_ROOT ?? process.cwd(),
    'netlify/functions/_shared/apple/apple-root-ca',
  ),
): Buffer[] {
  let files: string[];
  try {
    files = readdirSync(rootDir).filter(name => /\.(cer|der|pem)$/i.test(name)).sort();
  } catch {
    throw new AppleServiceError('APPLE_ROOT_CA_MISSING', 503);
  }
  if (!files.length) throw new AppleServiceError('APPLE_ROOT_CA_MISSING', 503);
  return files.map(name => readFileSync(join(rootDir, name)));
}
