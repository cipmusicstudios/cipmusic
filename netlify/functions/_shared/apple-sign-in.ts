import {createSign} from 'crypto';
import type {SupabaseClient} from '@supabase/supabase-js';

const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const TOKEN_TABLE = 'apple_sign_in_tokens';
const SECRET_TABLE = 'server_secrets';
const APPLE_PRIVATE_KEY_SECRET_NAME = 'apple_sign_in_private_key';

type SupabaseServiceClient = SupabaseClient;

export type AppleTokenStoreResult =
  | {status: 'stored'; hasRefreshToken: true}
  | {status: 'not_configured'; missingEnv: string[]}
  | {status: 'no_refresh_token'}
  | {status: 'failed'; message: string};

export type AppleTokenRevocationResult =
  | {status: 'revoked'}
  | {status: 'not_found'}
  | {status: 'not_configured'; missingEnv: string[]}
  | {status: 'skipped_missing_table'}
  | {status: 'failed'; message: string};

function readAppleIdentifiers(): {
  clientId: string;
  teamId: string;
  keyId: string;
  missing: string[];
} {
  const clientId =
    process.env.APPLE_SIGN_IN_CLIENT_ID?.trim() ||
    process.env.APPLE_CLIENT_ID?.trim() ||
    '';
  const teamId = process.env.APPLE_SIGN_IN_TEAM_ID?.trim() || process.env.APPLE_TEAM_ID?.trim() || '';
  const keyId = process.env.APPLE_SIGN_IN_KEY_ID?.trim() || process.env.APPLE_KEY_ID?.trim() || '';

  const missing: string[] = [];
  if (!clientId) missing.push('APPLE_SIGN_IN_CLIENT_ID');
  if (!teamId) missing.push('APPLE_SIGN_IN_TEAM_ID');
  if (!keyId) missing.push('APPLE_SIGN_IN_KEY_ID');

  return {clientId, teamId, keyId, missing};
}

async function readApplePrivateKey(
  supabase: SupabaseServiceClient,
): Promise<{privateKey: string; missing: string[]; message?: string}> {
  const {data, error} = await supabase
    .from(SECRET_TABLE)
    .select('secret_value')
    .eq('name', APPLE_PRIVATE_KEY_SECRET_NAME)
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return {
        privateKey: '',
        missing: ['APPLE_SIGN_IN_PRIVATE_KEY_SECRET'],
        message: 'Apple Sign in private key secret table is missing.',
      };
    }
    return {
      privateKey: '',
      missing: ['APPLE_SIGN_IN_PRIVATE_KEY_SECRET'],
      message: 'Apple Sign in private key could not be loaded.',
    };
  }

  const raw =
    data && typeof (data as {secret_value?: unknown}).secret_value === 'string'
      ? (data as {secret_value: string}).secret_value.trim()
      : '';
  const privateKey = raw.replace(/\\n/g, '\n');
  if (!privateKey) {
    return {privateKey: '', missing: ['APPLE_SIGN_IN_PRIVATE_KEY_SECRET']};
  }
  return {privateKey, missing: []};
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function createAppleClientSecret(
  supabase: SupabaseServiceClient,
): Promise<{clientId: string; clientSecret: string; missingEnv: string[]; message?: string}> {
  const env = readAppleIdentifiers();
  const key = await readApplePrivateKey(supabase);
  const missingEnv = [...env.missing, ...key.missing];
  if (missingEnv.length > 0) {
    return {
      clientId: env.clientId,
      clientSecret: '',
      missingEnv,
      ...(key.message ? {message: key.message} : {}),
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({alg: 'ES256', kid: env.keyId, typ: 'JWT'}));
  const payload = base64Url(
    JSON.stringify({
      iss: env.teamId,
      iat: now,
      exp: now + 30 * 24 * 60 * 60,
      aud: 'https://appleid.apple.com',
      sub: env.clientId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signer = createSign('SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64Url(signer.sign(key.privateKey));
  return {clientId: env.clientId, clientSecret: `${signingInput}.${signature}`, missingEnv: []};
}

function isMissingTableError(error: {code?: string | null; message?: string | null}): boolean {
  const code = error.code != null ? String(error.code) : '';
  const message = error.message ?? '';
  return code === '42P01' || code === 'PGRST205' || /relation .* does not exist/i.test(message);
}

async function applePost(
  url: string,
  fields: Record<string, string>,
): Promise<{ok: true; json: Record<string, unknown>} | {ok: false; message: string}> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams(fields).toString(),
    });
  } catch (err) {
    return {ok: false, message: err instanceof Error ? err.message : String(err)};
  }

  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }

  if (!res.ok) {
    const message =
      typeof json.error === 'string'
        ? json.error
        : typeof json.error_description === 'string'
        ? json.error_description
        : `Apple request failed with HTTP ${res.status}`;
    return {ok: false, message};
  }
  return {ok: true, json};
}

async function exchangeAuthorizationCode(
  supabase: SupabaseServiceClient,
  authorizationCode: string,
): Promise<{ok: true; refreshToken: string | null} | {ok: false; message: string; missingEnv?: string[]}> {
  const {clientId, clientSecret, missingEnv, message} = await createAppleClientSecret(supabase);
  if (missingEnv.length > 0) {
    return {ok: false, message: message ?? 'Apple Sign in server credentials are incomplete.', missingEnv};
  }

  const exchanged = await applePost(TOKEN_URL, {
    client_id: clientId,
    client_secret: clientSecret,
    code: authorizationCode,
    grant_type: 'authorization_code',
  });
  if (exchanged.ok === false) return {ok: false, message: exchanged.message};

  const refreshToken =
    typeof exchanged.json.refresh_token === 'string' ? exchanged.json.refresh_token : null;
  return {ok: true, refreshToken};
}

async function revokeRefreshToken(
  supabase: SupabaseServiceClient,
  refreshToken: string,
): Promise<{ok: true} | {ok: false; message: string; missingEnv?: string[]}> {
  const {clientId, clientSecret, missingEnv, message} = await createAppleClientSecret(supabase);
  if (missingEnv.length > 0) {
    return {ok: false, message: message ?? 'Apple Sign in server credentials are incomplete.', missingEnv};
  }

  const revoked = await applePost(REVOKE_URL, {
    client_id: clientId,
    client_secret: clientSecret,
    token: refreshToken,
    token_type_hint: 'refresh_token',
  });
  if (revoked.ok === false) return {ok: false, message: revoked.message};
  return {ok: true};
}

export async function storeAppleAuthorizationCode(
  supabase: SupabaseServiceClient,
  input: {userId: string; authorizationCode: string; appleUserId?: string | null},
): Promise<AppleTokenStoreResult> {
  const exchanged = await exchangeAuthorizationCode(supabase, input.authorizationCode);
  if (exchanged.ok === false) {
    if (exchanged.missingEnv?.length) {
      return {status: 'not_configured', missingEnv: exchanged.missingEnv};
    }
    return {status: 'failed', message: exchanged.message};
  }
  if (!exchanged.refreshToken) return {status: 'no_refresh_token'};

  const {error} = await supabase.from(TOKEN_TABLE).upsert(
    {
      user_id: input.userId,
      apple_user_id: input.appleUserId ?? null,
      refresh_token: exchanged.refreshToken,
      updated_at: new Date().toISOString(),
      revoked_at: null,
      revoke_error: null,
    },
    {onConflict: 'user_id'},
  );

  if (error) return {status: 'failed', message: error.message};
  return {status: 'stored', hasRefreshToken: true};
}

export async function revokeStoredAppleToken(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<AppleTokenRevocationResult> {
  const row = await supabase
    .from(TOKEN_TABLE)
    .select('refresh_token')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (row.error) {
    if (isMissingTableError(row.error)) return {status: 'skipped_missing_table'};
    return {status: 'failed', message: row.error.message};
  }

  const refreshToken =
    row.data && typeof (row.data as {refresh_token?: unknown}).refresh_token === 'string'
      ? (row.data as {refresh_token: string}).refresh_token
      : null;
  if (!refreshToken) return {status: 'not_found'};

  const revoked = await revokeRefreshToken(supabase, refreshToken);
  if (revoked.ok === false) {
    if (revoked.missingEnv?.length) {
      return {status: 'not_configured', missingEnv: revoked.missingEnv};
    }
    await supabase
      .from(TOKEN_TABLE)
      .update({revoke_error: revoked.message, updated_at: new Date().toISOString()})
      .eq('user_id', userId);
    return {status: 'failed', message: revoked.message};
  }

  await supabase
    .from(TOKEN_TABLE)
    .update({revoked_at: new Date().toISOString(), revoke_error: null, updated_at: new Date().toISOString()})
    .eq('user_id', userId);
  return {status: 'revoked'};
}
