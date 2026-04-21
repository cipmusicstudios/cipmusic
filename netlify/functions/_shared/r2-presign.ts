import {GetObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';

const DEFAULT_EXPIRES_SECONDS = 60 * 60;

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  scenePrefix: string;
  expiresSeconds: number;
};

function readRequiredEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function readR2Config(): R2Config | null {
  const accountId = readRequiredEnv('CF_R2_ACCOUNT_ID');
  const accessKeyId = readRequiredEnv('CF_R2_ACCESS_KEY_ID');
  const secretAccessKey = readRequiredEnv('CF_R2_SECRET_ACCESS_KEY');
  const bucket = readRequiredEnv('CF_R2_BUCKET');
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  const scenePrefixRaw = process.env.CF_R2_SCENE_PREFIX?.trim() || 'premium-scenes';
  const scenePrefix = scenePrefixRaw.replace(/^\/+|\/+$/g, '');
  const expiresRaw = Number.parseInt(process.env.CF_R2_SCENE_EXPIRES_SECONDS || '', 10);
  const expiresSeconds =
    Number.isFinite(expiresRaw) && expiresRaw > 0
      ? Math.min(expiresRaw, 7 * 24 * 60 * 60)
      : DEFAULT_EXPIRES_SECONDS;

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    scenePrefix,
    expiresSeconds,
  };
}

export function missingR2EnvNames(): string[] {
  return ['CF_R2_ACCOUNT_ID', 'CF_R2_ACCESS_KEY_ID', 'CF_R2_SECRET_ACCESS_KEY', 'CF_R2_BUCKET'].filter(
    name => !readRequiredEnv(name),
  );
}

function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function buildSceneObjectKey(config: R2Config, filename: string): string {
  const clean = filename.replace(/^\/+/, '');
  return config.scenePrefix ? `${config.scenePrefix}/${clean}` : clean;
}

export async function createR2SignedGetUrl(
  objectKey: string,
  expiresInSeconds?: number,
): Promise<{url: string; expiresAt: string}> {
  const config = readR2Config();
  if (!config) {
    throw new Error(`Missing R2 env: ${missingR2EnvNames().join(', ')}`);
  }

  const client = createR2Client(config);
  const expiresIn = expiresInSeconds ?? config.expiresSeconds;
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: objectKey,
  });
  const url = await getSignedUrl(client, command, {expiresIn});
  return {
    url,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}
