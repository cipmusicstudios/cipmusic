import type {Handler, HandlerEvent, HandlerResponse} from '@netlify/functions';
import {createSupabaseServiceClient} from './_shared/supabase-service';
import {storeAppleAuthorizationCode} from './_shared/apple-sign-in';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(statusCode: number, body: unknown): HandlerResponse {
  return {
    statusCode,
    headers: {'Content-Type': 'application/json', ...corsHeaders},
    body: JSON.stringify(body),
  };
}

function parseAuthHeader(event: HandlerEvent): string | null {
  const headers = event.headers ?? {};
  const raw =
    headers['authorization'] ||
    headers['Authorization'] ||
    (headers as Record<string, string | undefined>)['AUTHORIZATION'];
  if (!raw || typeof raw !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!m) return null;
  const token = m[1].trim();
  return token || null;
}

function parseBody(event: HandlerEvent): Record<string, unknown> {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === 'OPTIONS') {
    return {statusCode: 204, headers: corsHeaders, body: ''};
  }
  if (event.httpMethod !== 'POST') {
    return json(405, {ok: false, code: 'METHOD_NOT_ALLOWED', message: 'POST required'});
  }

  const token = parseAuthHeader(event);
  if (!token) {
    return json(401, {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Missing Authorization: Bearer <supabase_access_token>',
    });
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return json(503, {
      ok: false,
      code: 'SERVICE_ENV_INCOMPLETE',
      message: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for Netlify Functions.',
    });
  }

  const userRes = await supabase.auth.getUser(token);
  if (userRes.error || !userRes.data?.user?.id) {
    return json(401, {
      ok: false,
      code: 'INVALID_SESSION',
      message: 'Supabase access token could not be verified.',
    });
  }

  const body = parseBody(event);
  const authorizationCode =
    typeof body.authorizationCode === 'string' ? body.authorizationCode.trim() : '';
  const appleUserId = typeof body.appleUserId === 'string' ? body.appleUserId.trim() : null;
  if (!authorizationCode) {
    return json(400, {
      ok: false,
      code: 'MISSING_AUTHORIZATION_CODE',
      message: 'Apple authorizationCode is required.',
    });
  }

  const stored = await storeAppleAuthorizationCode(supabase, {
    userId: userRes.data.user.id,
    authorizationCode,
    appleUserId,
  });

  if (stored.status === 'stored') {
    return json(200, {ok: true, appleCredentialStorage: stored.status});
  }

  const statusCode = stored.status === 'not_configured' ? 503 : 502;
  return json(statusCode, {
    ok: false,
    code:
      stored.status === 'not_configured'
        ? 'APPLE_SIGN_IN_NOT_CONFIGURED'
        : stored.status === 'no_refresh_token'
        ? 'APPLE_REFRESH_TOKEN_MISSING'
        : 'APPLE_TOKEN_STORE_FAILED',
    message:
      stored.status === 'not_configured'
        ? 'Apple Sign in server credentials are not configured.'
        : stored.status === 'no_refresh_token'
        ? 'Apple did not return a refresh token for this authorization code.'
        : stored.message,
    ...(stored.status === 'not_configured' ? {missingEnv: stored.missingEnv} : {}),
  });
};
