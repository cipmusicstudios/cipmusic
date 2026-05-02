import type {Handler, HandlerEvent, HandlerResponse} from '@netlify/functions';
import {createSupabaseServiceClient} from './_shared/supabase-service';
import {
  buildSceneObjectKey,
  createR2SignedGetUrl,
  missingR2EnvNames,
  readR2Config,
} from './_shared/r2-presign';

const ALLOWED_SCENE_IDS = ['forestCafe', 'celestialDome'] as const;
type PremiumSceneId = (typeof ALLOWED_SCENE_IDS)[number];

const SCENE_OBJECT_FILENAMES: Record<PremiumSceneId, {landscape: string; portrait: string}> = {
  forestCafe: {landscape: 'forest.mp4', portrait: 'portrait/forest-portrait.mp4'},
  celestialDome: {landscape: 'starry.mp4', portrait: 'portrait/starry-portrait.mp4'},
};

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type SceneAssetDebug = {
  userIdPresent: boolean;
  supabaseConfigured: boolean;
  r2Configured: boolean;
  membershipChecked: boolean;
  sceneResolved: boolean;
  urlIssued: boolean;
  missingR2Env?: string[];
  errorStage?: string;
  errorMessage?: string | null;
};

function json(statusCode: number, body: unknown): HandlerResponse {
  return {
    statusCode,
    headers: {'Content-Type': 'application/json', ...corsHeaders},
    body: JSON.stringify(body),
  };
}

function fail(
  status: number,
  code: string,
  message: string,
  debug: SceneAssetDebug,
): HandlerResponse {
  return json(status, {ok: false, code, error: code, message, debug});
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

function isPremiumSceneId(v: unknown): v is PremiumSceneId {
  return typeof v === 'string' && (ALLOWED_SCENE_IDS as readonly string[]).includes(v);
}

function isPortraitOrientation(v: unknown): boolean {
  return v === 'portrait';
}

function isPremiumEntitled(row: Record<string, unknown> | null): boolean {
  if (!row) return false;
  const premiumUntilRaw = row.premium_until;
  const premiumUntilIso = typeof premiumUntilRaw === 'string' ? premiumUntilRaw : null;
  if (premiumUntilIso) {
    const t = Date.parse(premiumUntilIso);
    if (Number.isFinite(t) && t > Date.now()) return true;
    return false;
  }
  const statusRaw = typeof row.membership_status === 'string' ? row.membership_status : '';
  const stripeRaw =
    typeof row.stripe_subscription_status === 'string' ? row.stripe_subscription_status : '';
  const st = statusRaw.toLowerCase().trim();
  const stripeSt = stripeRaw.toLowerCase().trim();
  return (
    st === 'active' ||
    st === 'premium' ||
    st === 'stripe_subscription_active' ||
    st === 'stripe_subscription_trialing' ||
    stripeSt === 'active' ||
    stripeSt === 'trialing'
  );
}

function logLine(fields: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v == null) {
      safe[k] = v;
    }
  }
  console.log('[scene-asset-url]', JSON.stringify(safe));
}

export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === 'OPTIONS') {
    return {statusCode: 204, headers: corsHeaders, body: ''};
  }
  if (event.httpMethod !== 'POST') {
    return fail(405, 'METHOD_NOT_ALLOWED', 'POST required', {
      userIdPresent: false,
      supabaseConfigured: Boolean(
        process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
      ),
      r2Configured: Boolean(readR2Config()),
      membershipChecked: false,
      sceneResolved: false,
      urlIssued: false,
      missingR2Env: missingR2EnvNames(),
    });
  }

  const r2Config = readR2Config();
  const debug: SceneAssetDebug = {
    userIdPresent: false,
    supabaseConfigured: Boolean(
      process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    ),
    r2Configured: Boolean(r2Config),
    membershipChecked: false,
    sceneResolved: false,
    urlIssued: false,
    missingR2Env: missingR2EnvNames(),
  };

  let body: {sceneId?: unknown; orientation?: unknown};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return fail(400, 'INVALID_JSON', 'Invalid JSON body', debug);
  }

  const sceneId = body.sceneId;
  if (!isPremiumSceneId(sceneId)) {
    return fail(400, 'INVALID_SCENE_ID', 'sceneId is invalid or unsupported', {
      ...debug,
      errorStage: 'invalid_scene_id',
    });
  }

  const orientation = isPortraitOrientation(body.orientation) ? 'portrait' : 'landscape';

  const token = parseAuthHeader(event);
  if (!token) {
    logLine({stage: 'no_bearer', sceneId, ok: false});
    return fail(401, 'UNAUTHENTICATED', 'Missing Authorization: Bearer <supabase_access_token>', {
      ...debug,
      errorStage: 'no_bearer',
    });
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    logLine({stage: 'no_service_client', sceneId, ok: false});
    return fail(503, 'SERVICE_ENV_INCOMPLETE', 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY', {
      ...debug,
      errorStage: 'no_service_client',
    });
  }

  if (!r2Config) {
    logLine({stage: 'r2_env_incomplete', sceneId, ok: false});
    return fail(503, 'SCENE_STORAGE_NOT_CONFIGURED', 'Missing Cloudflare R2 signing env for premium scenes', {
      ...debug,
      errorStage: 'r2_env_incomplete',
    });
  }

  const userRes = await supabase.auth.getUser(token);
  if (userRes.error || !userRes.data?.user?.id) {
    logLine({stage: 'jwt_invalid', sceneId, ok: false});
    return fail(401, 'INVALID_SESSION', 'Supabase access token could not be verified', {
      ...debug,
      errorStage: 'jwt_invalid',
      errorMessage: userRes.error?.message ?? null,
    });
  }
  const userId = userRes.data.user.id;
  debug.userIdPresent = true;

  const membershipRes = await supabase
    .from('user_membership')
    .select('premium_until, membership_status, stripe_subscription_status, cancel_at_period_end')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  debug.membershipChecked = !membershipRes.error;
  if (membershipRes.error) {
    logLine({stage: 'membership_query_failed', sceneId, userId, ok: false});
    return fail(503, 'MEMBERSHIP_QUERY_FAILED', membershipRes.error.message, {
      ...debug,
      errorStage: 'membership_query_failed',
      errorMessage: membershipRes.error.message,
    });
  }

  const entitled = isPremiumEntitled(
    (membershipRes.data as Record<string, unknown> | null) ?? null,
  );
  if (!entitled) {
    logLine({stage: 'not_entitled', sceneId, userId, ok: false});
    return fail(403, 'PREMIUM_REQUIRED', 'Premium scene requires an active membership.', {
      ...debug,
      errorStage: 'not_entitled',
    });
  }

  const sceneFiles = SCENE_OBJECT_FILENAMES[sceneId];
  const filename = sceneFiles[orientation];
  if (!filename) {
    logLine({stage: 'scene_not_found', sceneId, userId, ok: false});
    return fail(404, 'SCENE_NOT_FOUND', 'Scene asset is not configured', {
      ...debug,
      errorStage: 'scene_not_found',
    });
  }
  debug.sceneResolved = true;

  const objectKey = buildSceneObjectKey(r2Config, filename);
  let signed: {url: string; expiresAt: string};
  try {
    signed = await createR2SignedGetUrl(objectKey, r2Config.expiresSeconds);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to sign R2 scene URL';
    logLine({stage: 'sign_failed', sceneId, userId, ok: false});
    return fail(500, 'SIGN_URL_FAILED', message, {
      ...debug,
      errorStage: 'sign_failed',
      errorMessage: message,
    });
  }
  debug.urlIssued = true;

  logLine({
    stage: 'ok',
    sceneId,
    orientation,
    userId,
    authOk: true,
    entitlementOk: true,
    ok: true,
    accessMode: 'r2_presigned_get',
    expiresInSec: r2Config.expiresSeconds,
  });
  return json(200, {
    ok: true,
    url: signed.url,
    expiresAt: signed.expiresAt,
    accessMode: 'r2_presigned_get',
  });
};
