import type {Handler, HandlerEvent, HandlerResponse} from '@netlify/functions';
import {createSupabaseServiceClient} from './_shared/supabase-service';

const SONGS_TABLE = 'songs';
const SONGS_BUCKET = (process.env.SUPABASE_SONGS_BUCKET?.trim() || 'songs');

/** 谱面短链有效期（秒）。与 scenes broker 解耦：Practice 资源使用更短的窗口。 */
const SIGNED_URL_TTL_SECONDS = 600;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type PracticeAssetDebug = {
  hasAuthHeader: boolean;
  authValid: boolean;
  supabaseConfigured: boolean;
  trackResolved: boolean;
  hasMidi: boolean;
  hasMusicXml: boolean;
  urlsIssued: boolean;
  errorStage?: string;
  errorMessage?: string | null;
};

function collectMissingSupabaseEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.SUPABASE_URL?.trim()) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return missing;
}

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

function logLine(fields: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v == null) {
      safe[k] = v;
    }
  }
  console.log('[practice-asset-url]', JSON.stringify(safe));
}

/**
 * `songs.midi_url` / `songs.musicxml_url` 在 DB 中既可能是绝对 public URL（`/storage/v1/object/public/<bucket>/<path>`），
 * 也可能是 bucket-relative path。这里统一抽出 bucket 内对象 key（不含前导 `/`），用于 `createSignedUrl`。
 *
 * 例：
 *   https://x.supabase.co/storage/v1/object/public/songs/songs/stay/performance.mid
 *     → songs/stay/performance.mid
 *   songs/stay/performance.mid                                                    → 同上
 *   /songs/stay/performance.mid                                                   → 同上
 */
function bucketRelativeObjectKey(raw: string, bucket: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    const publicMarker = `/storage/v1/object/public/${bucket}/`;
    const signMarker = `/storage/v1/object/sign/${bucket}/`;
    let idx = value.indexOf(publicMarker);
    let markerLen = publicMarker.length;
    if (idx < 0) {
      idx = value.indexOf(signMarker);
      markerLen = signMarker.length;
    }
    if (idx < 0) return null;
    const tail = value.slice(idx + markerLen);
    /** 已带 query（如 ?token=...）时只取 path 部分 */
    const qIdx = tail.indexOf('?');
    return qIdx >= 0 ? tail.slice(0, qIdx) : tail;
  }
  return value.replace(/^\/+/, '');
}

/**
 * Phase C 安全收口：Practice Mode 资源 broker。
 *
 * - 必须 `Authorization: Bearer <supabase_access_token>`，由 supabase.auth.getUser() 校验
 * - `userId` 仅来自 JWT，绝不信任 body
 * - 仅按 trackId 查询 `songs` 表（不接受 slug，攻击面最小）
 * - 600 秒短链；签名前 server-side 把 DB path 归一化为 bucket-relative key
 * - 本轮只校验登录态，不要求 premium（产品决策另行）
 */
export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === 'OPTIONS') {
    return {statusCode: 204, headers: corsHeaders, body: ''};
  }

  const baseDebug = (partial: Partial<PracticeAssetDebug> = {}): PracticeAssetDebug => ({
    hasAuthHeader: false,
    authValid: false,
    supabaseConfigured: Boolean(
      process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    ),
    trackResolved: false,
    hasMidi: false,
    hasMusicXml: false,
    urlsIssued: false,
    ...partial,
  });

  if (event.httpMethod !== 'POST') {
    return fail(405, 'METHOD_NOT_ALLOWED', 'POST required', baseDebug({errorStage: 'wrong_method'}));
  }

  let body: {trackId?: unknown};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return fail(400, 'INVALID_JSON', 'Invalid JSON body', baseDebug({errorStage: 'invalid_json'}));
  }

  const trackId = typeof body.trackId === 'string' ? body.trackId.trim() : '';
  if (!trackId || !UUID_RE.test(trackId)) {
    return fail(
      400,
      'INVALID_TRACK_ID',
      'trackId must be a valid Supabase UUID.',
      baseDebug({errorStage: 'invalid_track_id'}),
    );
  }

  const token = parseAuthHeader(event);
  if (!token) {
    logLine({stage: 'no_bearer', trackId, ok: false});
    return fail(
      401,
      'UNAUTHENTICATED',
      'Missing Authorization: Bearer <supabase_access_token>',
      baseDebug({errorStage: 'no_bearer'}),
    );
  }

  const missingEnv = collectMissingSupabaseEnv();
  if (missingEnv.length > 0) {
    logLine({stage: 'env_missing', trackId, ok: false});
    return fail(
      503,
      'SERVICE_ENV_INCOMPLETE',
      `Missing env: ${missingEnv.join(', ')}`,
      baseDebug({hasAuthHeader: true, errorStage: 'env_missing'}),
    );
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    logLine({stage: 'no_service_client', trackId, ok: false});
    return fail(
      503,
      'SERVICE_ENV_INCOMPLETE',
      'Could not create Supabase service client.',
      baseDebug({hasAuthHeader: true, errorStage: 'no_service_client'}),
    );
  }

  const userRes = await supabase.auth.getUser(token);
  if (userRes.error || !userRes.data?.user?.id) {
    logLine({stage: 'jwt_invalid', trackId, ok: false});
    return fail(
      401,
      'INVALID_SESSION',
      'Supabase access token could not be verified.',
      baseDebug({
        hasAuthHeader: true,
        errorStage: 'jwt_invalid',
        errorMessage: userRes.error?.message ?? null,
      }),
    );
  }
  const userId = userRes.data.user.id;

  const songRes = await supabase
    .from(SONGS_TABLE)
    .select('id, midi_url, musicxml_url, has_practice_mode')
    .eq('id', trackId)
    .limit(1)
    .maybeSingle();

  if (songRes.error) {
    logLine({stage: 'songs_query_failed', trackId, userId, ok: false});
    return fail(
      503,
      'SONGS_QUERY_FAILED',
      songRes.error.message,
      baseDebug({
        hasAuthHeader: true,
        authValid: true,
        errorStage: 'songs_query_failed',
        errorMessage: songRes.error.message,
      }),
    );
  }

  const row = songRes.data as
    | {id: string; midi_url: string | null; musicxml_url: string | null; has_practice_mode: boolean | null}
    | null;
  if (!row) {
    logLine({stage: 'track_not_found', trackId, userId, ok: false});
    return fail(
      404,
      'TRACK_NOT_FOUND',
      'Track does not exist or is not visible.',
      baseDebug({hasAuthHeader: true, authValid: true, errorStage: 'track_not_found'}),
    );
  }

  if (row.has_practice_mode !== true) {
    logLine({stage: 'practice_disabled', trackId, userId, ok: false});
    return fail(
      403,
      'PRACTICE_NOT_ENABLED',
      'Practice Mode is not enabled for this track.',
      baseDebug({
        hasAuthHeader: true,
        authValid: true,
        trackResolved: true,
        errorStage: 'practice_disabled',
      }),
    );
  }

  const midiKey = row.midi_url ? bucketRelativeObjectKey(row.midi_url, SONGS_BUCKET) : null;
  const xmlKey = row.musicxml_url ? bucketRelativeObjectKey(row.musicxml_url, SONGS_BUCKET) : null;
  const hasMidi = Boolean(midiKey);
  const hasMusicXml = Boolean(xmlKey);

  if (!hasMidi || !hasMusicXml) {
    logLine({stage: 'assets_missing', trackId, userId, hasMidi, hasMusicXml, ok: false});
    return fail(
      422,
      'PRACTICE_ASSETS_MISSING',
      'Track is flagged for Practice but underlying MIDI/MusicXML paths are missing.',
      baseDebug({
        hasAuthHeader: true,
        authValid: true,
        trackResolved: true,
        hasMidi,
        hasMusicXml,
        errorStage: 'assets_missing',
      }),
    );
  }

  const [midiSign, xmlSign] = await Promise.all([
    supabase.storage.from(SONGS_BUCKET).createSignedUrl(midiKey as string, SIGNED_URL_TTL_SECONDS),
    supabase.storage.from(SONGS_BUCKET).createSignedUrl(xmlKey as string, SIGNED_URL_TTL_SECONDS),
  ]);

  if (midiSign.error || !midiSign.data?.signedUrl || xmlSign.error || !xmlSign.data?.signedUrl) {
    const errMsg = midiSign.error?.message || xmlSign.error?.message || 'createSignedUrl returned no URL';
    logLine({stage: 'sign_failed', trackId, userId, ok: false});
    return fail(
      500,
      'SIGN_URL_FAILED',
      errMsg,
      baseDebug({
        hasAuthHeader: true,
        authValid: true,
        trackResolved: true,
        hasMidi,
        hasMusicXml,
        errorStage: 'sign_failed',
        errorMessage: errMsg,
      }),
    );
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();

  logLine({
    stage: 'ok',
    trackId,
    userId,
    authOk: true,
    hasMidi,
    hasMusicXml,
    urlsIssued: true,
    accessMode: 'supabase_storage_signed',
    expiresInSec: SIGNED_URL_TTL_SECONDS,
    ok: true,
  });

  return json(200, {
    ok: true,
    trackId,
    midiUrl: midiSign.data.signedUrl,
    musicXmlUrl: xmlSign.data.signedUrl,
    expiresAt,
    accessMode: 'supabase_storage_signed',
  });
};
