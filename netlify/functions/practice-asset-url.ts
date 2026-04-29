import type {Handler, HandlerEvent, HandlerResponse} from '@netlify/functions';
import {createSupabaseServiceClient} from './_shared/supabase-service';

const SONGS_TABLE = 'songs';

/**
 * 谱面短链有效期（秒）。与 scenes broker 解耦：Practice 资源使用更短的窗口。
 */
const SIGNED_URL_TTL_SECONDS = 600;

/**
 * Phase D Step 0 兼容化：签名 bucket 解析。
 *
 * - `SUPABASE_PRACTICE_BUCKET` 显式配置 → 用它（未来 Phase D Step 4 切到 `practice-assets` private bucket 用）
 * - 否则 fallback 到 `SUPABASE_SONGS_BUCKET`（与历史行为一致）
 * - 再否则默认 `songs`
 *
 * 当前线上不配置 `SUPABASE_PRACTICE_BUCKET`，所以该函数返回 `'songs'`，行为与 Phase C 完全一致。
 *
 * 注意：函数式而非常量化，便于本地脚本通过 env 切换 bucket 做端到端测试，无需重启进程。
 */
function resolvePracticeBucket(): string {
  const explicit = process.env.SUPABASE_PRACTICE_BUCKET?.trim();
  if (explicit) return explicit;
  const songs = process.env.SUPABASE_SONGS_BUCKET?.trim();
  if (songs) return songs;
  return 'songs';
}

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
 * 把 DB 里存的「绝对 Supabase Storage URL 或 bucket-relative path」统一抽成 object key（不含前导 `/`），
 * 该 key 与下一步 `supabase.storage.from(<configured-bucket>).createSignedUrl(key, ttl)` 配合使用。
 *
 * Phase D Step 0：URL → key 的抽取**不再绑定具体 bucket 名**。原因：
 *  - 历史 DB 中 `midi_url` / `musicxml_url` 永远写成 `/storage/v1/object/public/songs/songs/<slug>/performance.mid`，
 *    bucket 段固定是 `songs`。
 *  - 未来 Phase D Step 4 会把签名 bucket 切到 `practice-assets`（private），但 object key 仍保留同样的相对路径
 *    （Step 2 的复制脚本要求保持 key 不变）。
 *  - 因此抽 key 时不应锁死 URL 中的 bucket 段；抽出的 `songs/<slug>/performance.mid` 可以在 `songs`
 *    或 `practice-assets` 任意一个 bucket 中签名（前提是该 bucket 里确实存在该 key）。
 *
 * 兼容样本：
 *   https://x.supabase.co/storage/v1/object/public/songs/songs/stay/performance.mid → songs/stay/performance.mid
 *   https://x.supabase.co/storage/v1/object/sign/songs/songs/stay/performance.mid?token=...
 *                                                                                → songs/stay/performance.mid
 *   songs/stay/performance.mid                                                    → 同上
 *   /songs/stay/performance.mid                                                   → 同上
 */
function bucketRelativeObjectKey(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    /** `/storage/v1/object/<public|sign>/<anybucket>/<key>` 的统一抽取，bucket 段非贪婪匹配。 */
    const m = /\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/i.exec(value);
    return m ? m[1] : null;
  }
  return value.replace(/^\/+/, '');
}

type AssetSource = 'path' | 'url' | 'none';

/**
 * Phase D Step 0：path 列优先于 url 列。
 * - DB 中 `midi_path` / `xml_path` 是 bucket-relative 字符串，未来 Phase D 真正迁移时只需更新这两列即可生效。
 * - 旧的 `midi_url` / `musicxml_url` 仍是绝对 public URL，保留作为 fallback，便于回滚。
 */
function pickAssetKey(
  pathValue: string | null | undefined,
  urlValue: string | null | undefined,
): {key: string | null; source: AssetSource} {
  const pathTrim = typeof pathValue === 'string' ? pathValue.trim() : '';
  if (pathTrim) {
    const k = bucketRelativeObjectKey(pathTrim);
    if (k) return {key: k, source: 'path'};
  }
  const urlTrim = typeof urlValue === 'string' ? urlValue.trim() : '';
  if (urlTrim) {
    const k = bucketRelativeObjectKey(urlTrim);
    if (k) return {key: k, source: 'url'};
  }
  return {key: null, source: 'none'};
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

  /**
   * Phase D Step 0：同时拉 path 列。优先级 `midi_path > midi_url`、`xml_path > musicxml_url`。
   * `midi_path` / `xml_path` 是历史就有的 bucket-relative 列（见 `migrate-local-songs-to-supabase.ts`），
   * 当前 DB 已同步写入；本轮无需做数据迁移即可启用 path-first。
   */
  const songRes = await supabase
    .from(SONGS_TABLE)
    .select('id, midi_url, midi_path, musicxml_url, xml_path, has_practice_mode')
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
    | {
        id: string;
        midi_url: string | null;
        midi_path: string | null;
        musicxml_url: string | null;
        xml_path: string | null;
        has_practice_mode: boolean | null;
      }
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

  const midiPick = pickAssetKey(row.midi_path, row.midi_url);
  const xmlPick = pickAssetKey(row.xml_path, row.musicxml_url);
  const hasMidi = Boolean(midiPick.key);
  const hasMusicXml = Boolean(xmlPick.key);

  if (!hasMidi || !hasMusicXml) {
    logLine({
      stage: 'assets_missing',
      trackId,
      userId,
      hasMidi,
      hasMusicXml,
      midiSource: midiPick.source,
      xmlSource: xmlPick.source,
      ok: false,
    });
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

  /**
   * Phase D Step 0：bucket 由 env 决定。未配置 `SUPABASE_PRACTICE_BUCKET` 时与 Phase C 完全一致（`songs`）。
   * Phase D Step 4 会通过 Netlify env 切到 `practice-assets`，此时本函数自动签名新 bucket，无需改代码。
   */
  const practiceBucket = resolvePracticeBucket();
  const [midiSign, xmlSign] = await Promise.all([
    supabase.storage.from(practiceBucket).createSignedUrl(midiPick.key as string, SIGNED_URL_TTL_SECONDS),
    supabase.storage.from(practiceBucket).createSignedUrl(xmlPick.key as string, SIGNED_URL_TTL_SECONDS),
  ]);

  if (midiSign.error || !midiSign.data?.signedUrl || xmlSign.error || !xmlSign.data?.signedUrl) {
    const errMsg = midiSign.error?.message || xmlSign.error?.message || 'createSignedUrl returned no URL';
    logLine({
      stage: 'sign_failed',
      trackId,
      userId,
      bucket: practiceBucket,
      midiSource: midiPick.source,
      xmlSource: xmlPick.source,
      ok: false,
    });
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

  /**
   * 安全日志：只记录 bucket 名 / 来源列名 / 布尔标志，**绝不**记录 path、绝不记录 signed URL。
   */
  logLine({
    stage: 'ok',
    trackId,
    userId,
    authOk: true,
    bucket: practiceBucket,
    midiSource: midiPick.source,
    xmlSource: xmlPick.source,
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
