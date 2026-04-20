/**
 * Practice 资源 broker（Phase 1 止血版）
 *
 * 目的：把 MIDI / MusicXML 从前端 manifest + public bucket 直链中剥离。
 * 流程：
 *   1) 读取 `Authorization: Bearer <supabase-access-token>`
 *   2) 用 service-role 客户端的 `auth.getUser(jwt)` 验证 token，拿到真实 userId
 *   3) 查 `user_membership` 判断 premium 是否有效（与前端 `remotePremiumEntitled` 保持一致）
 *   4) 查 `songs` 行拿 `midi_url` / `musicxml_url`（可能是完整 public URL 或相对路径）
 *   5) 用 service-role 的 `storage.from(bucket).createSignedUrl(path, 600)` 签发 10 分钟 URL
 *   6) 返回 `{ ok, url, expiresAt }`
 *
 * 非目标：
 *   - 本期不签 audio.mp3 / 场景视频 / local-imports 静态资源
 *   - 本期不换 path 命名、不动 bucket 公开/私有状态
 *
 * 重要：永远不回传真实 storage path 给前端，永远不打印密钥；最小日志为
 * `trackId / kind / userId / ok`。
 */
import type {Handler, HandlerEvent, HandlerResponse} from '@netlify/functions';
import {createSupabaseServiceClient} from './_shared/supabase-service';

const SIGNED_URL_TTL_SECONDS = 600;
const ALLOWED_KINDS = ['midi', 'musicxml'] as const;
type PracticeAssetKind = (typeof ALLOWED_KINDS)[number];

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type PracticeAssetDebug = {
  userIdPresent: boolean;
  supabaseConfigured: boolean;
  membershipChecked: boolean;
  songRowFound: boolean;
  pathResolved: boolean;
  signedUrlCreated: boolean;
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
  debug: PracticeAssetDebug,
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

function isPracticeAssetKind(v: unknown): v is PracticeAssetKind {
  return typeof v === 'string' && (ALLOWED_KINDS as readonly string[]).includes(v);
}

/** 与 src/lib/membership-remote.ts::remotePremiumEntitled 同源判断。 */
function isPremiumEntitled(row: Record<string, unknown> | null): boolean {
  if (!row) return false;
  const premiumUntilRaw = row.premium_until;
  const premiumUntilIso =
    typeof premiumUntilRaw === 'string' ? premiumUntilRaw : null;
  if (premiumUntilIso) {
    const t = Date.parse(premiumUntilIso);
    if (Number.isFinite(t) && t > Date.now()) return true;
    /** 有 premium_until 但已过期或解析失败 → 不靠 status 覆盖 */
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

const DEFAULT_SONGS_BUCKET = process.env.SUPABASE_SONGS_BUCKET?.trim() || 'songs';

/**
 * DB 里 `midi_url` / `musicxml_url` 既可能是完整 public URL
 *   `https://<proj>.supabase.co/storage/v1/object/public/<bucket>/<path>`
 * 也可能是相对路径 `songs/<slug>/performance.mid`。
 * 两种都解析成 `{ bucket, path }`；无法解析返回 null。
 */
function extractStorageLocation(value: string): {bucket: string; path: string} | null {
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) {
    const m =
      /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?.*)?$/i.exec(v);
    if (!m) return null;
    const bucket = decodeURIComponent(m[1]);
    const path = decodeURIComponent(m[2]);
    if (!bucket || !path) return null;
    return {bucket, path};
  }
  /**
   * 相对值。当前迁移脚本写的就是 `songs/<slug>/...` 形式，默认桶 = `songs`。
   * 首段与桶名重合（`songs/...`）时不做特殊处理 —— 桶名前缀只是目录一部分。
   */
  const path = v.replace(/^\/+/, '');
  if (!path) return null;
  return {bucket: DEFAULT_SONGS_BUCKET, path};
}

function logLine(fields: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v == null) {
      safe[k] = v;
    }
  }
  console.log('[practice-asset-url]', JSON.stringify(safe));
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
      membershipChecked: false,
      songRowFound: false,
      pathResolved: false,
      signedUrlCreated: false,
    });
  }

  const debug: PracticeAssetDebug = {
    userIdPresent: false,
    supabaseConfigured: Boolean(
      process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    ),
    membershipChecked: false,
    songRowFound: false,
    pathResolved: false,
    signedUrlCreated: false,
  };

  let body: {trackId?: unknown; kind?: unknown};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return fail(400, 'INVALID_JSON', 'Invalid JSON body', debug);
  }

  const trackId = typeof body.trackId === 'string' ? body.trackId.trim() : '';
  const kind = body.kind;
  if (!trackId) {
    return fail(400, 'MISSING_TRACK_ID', 'trackId is required', debug);
  }
  if (!isPracticeAssetKind(kind)) {
    return fail(400, 'INVALID_KIND', 'kind must be "midi" or "musicxml"', debug);
  }

  const token = parseAuthHeader(event);
  if (!token) {
    logLine({stage: 'no_bearer', trackId, kind, ok: false});
    return fail(401, 'UNAUTHENTICATED', 'Missing Authorization: Bearer <supabase_access_token>', {
      ...debug,
      errorStage: 'no_bearer',
    });
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    logLine({stage: 'no_service_client', trackId, kind, ok: false});
    return fail(503, 'SERVICE_ENV_INCOMPLETE', 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY', {
      ...debug,
      errorStage: 'no_service_client',
    });
  }

  const userRes = await supabase.auth.getUser(token);
  if (userRes.error || !userRes.data?.user?.id) {
    logLine({stage: 'jwt_invalid', trackId, kind, ok: false});
    return fail(401, 'INVALID_SESSION', 'Supabase access token could not be verified', {
      ...debug,
      errorStage: 'jwt_invalid',
      errorMessage: userRes.error?.message ?? null,
    });
  }
  const userId = userRes.data.user.id;
  debug.userIdPresent = true;

  /**
   * 当前业务规则：Practice Mode 仅对 premium 开放（见 `PracticePanelModule.tsx`
   * 里 `!isPremium` 时的 practice-premium-overlay）。服务端与 UI 对齐：
   *   有效的 `user_membership.premium_until`（未过期）→ 放行；
   *   否则按 `membership_status / stripe_subscription_status` 视作 entitled。
   */
  const membershipRes = await supabase
    .from('user_membership')
    .select(
      'premium_until, membership_status, stripe_subscription_status, cancel_at_period_end',
    )
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  debug.membershipChecked = !membershipRes.error;
  if (membershipRes.error) {
    logLine({stage: 'membership_query_failed', trackId, kind, userId, ok: false});
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
    logLine({stage: 'not_entitled', trackId, kind, userId, ok: false});
    return fail(403, 'PREMIUM_REQUIRED', 'Practice Mode requires an active membership.', {
      ...debug,
      errorStage: 'not_entitled',
    });
  }

  const column = kind === 'midi' ? 'midi_url' : 'musicxml_url';
  const songRes = await supabase
    .from('songs')
    .select(`id, is_published, ${column}`)
    .eq('id', trackId)
    .limit(1)
    .maybeSingle();
  if (songRes.error) {
    logLine({stage: 'song_query_failed', trackId, kind, userId, ok: false});
    return fail(503, 'SONG_QUERY_FAILED', songRes.error.message, {
      ...debug,
      errorStage: 'song_query_failed',
      errorMessage: songRes.error.message,
    });
  }
  const row = (songRes.data ?? null) as
    | ({id: string; is_published?: boolean} & Record<string, unknown>)
    | null;
  if (!row) {
    logLine({stage: 'song_not_found', trackId, kind, userId, ok: false});
    return fail(404, 'SONG_NOT_FOUND', 'Song not found for trackId', {
      ...debug,
      errorStage: 'song_not_found',
    });
  }
  debug.songRowFound = true;
  /**
   * 已下架的歌不签 URL（下架往往是版权/纠错需要，下架后任何客户端也不应继续拿资源）。
   * 若列不存在则宽松放行（旧 schema）。
   */
  if (row.is_published === false) {
    logLine({stage: 'song_unpublished', trackId, kind, userId, ok: false});
    return fail(404, 'SONG_UNPUBLISHED', 'Song is not published', {
      ...debug,
      errorStage: 'song_unpublished',
    });
  }
  const rawValue = row[column];
  const rawValueStr = typeof rawValue === 'string' ? rawValue : '';
  if (!rawValueStr) {
    logLine({stage: 'asset_missing', trackId, kind, userId, ok: false});
    return fail(404, 'ASSET_MISSING', `Track has no ${kind} asset`, {
      ...debug,
      errorStage: 'asset_missing',
    });
  }
  const location = extractStorageLocation(rawValueStr);
  if (!location) {
    logLine({stage: 'path_unresolvable', trackId, kind, userId, ok: false});
    return fail(500, 'PATH_UNRESOLVABLE', 'Could not resolve storage path for asset', {
      ...debug,
      errorStage: 'path_unresolvable',
    });
  }
  debug.pathResolved = true;

  const signed = await supabase.storage
    .from(location.bucket)
    .createSignedUrl(location.path, SIGNED_URL_TTL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    logLine({stage: 'sign_failed', trackId, kind, userId, bucket: location.bucket, ok: false});
    return fail(500, 'SIGN_URL_FAILED', signed.error?.message ?? 'Failed to sign URL', {
      ...debug,
      errorStage: 'sign_failed',
      errorMessage: signed.error?.message ?? null,
    });
  }
  debug.signedUrlCreated = true;

  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  logLine({
    stage: 'ok',
    trackId,
    kind,
    userId,
    bucket: location.bucket,
    ok: true,
    ttlSec: SIGNED_URL_TTL_SECONDS,
  });
  return json(200, {
    ok: true,
    url: signed.data.signedUrl,
    expiresAt,
  });
};
