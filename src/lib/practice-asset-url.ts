/**
 * Practice 资源 broker 客户端（Phase 1 止血版）。
 *
 * 前端任何读 MIDI / MusicXML 的入口都应走这里。永远不要再从 manifest / songs 行里
 * 直接拿真实 URL —— 除了以 `/local-imports/` 开头的老 seed 静态资源（那些是
 * Netlify 静态目录，本期不在收紧范围内）。
 *
 * 签名 URL 在内存里短缓存（5 分钟），用完即弃，避免同一 track 打开 Practice
 * 时来回打 broker。
 */
import {supabase} from './supabase';

export type PracticeAssetKind = 'midi' | 'musicxml';

export type PracticeAssetResolved = {
  url: string;
  expiresAt: number;
};

export type PracticeAssetResolveSuccess = {
  ok: true;
  url: string;
  expiresAt: number;
};

/**
 * Broker 失败分类；UI 可以按 reason 决定是否弹「请登录 / 升级会员」提示。
 */
export type PracticeAssetResolveFailure = {
  ok: false;
  reason:
    | 'no_session'
    | 'unauthenticated'
    | 'premium_required'
    | 'asset_missing'
    | 'network'
    | 'server_error';
  message?: string;
  httpStatus?: number;
};

export type PracticeAssetResolveResult =
  | PracticeAssetResolveSuccess
  | PracticeAssetResolveFailure;

const BROKER_ENDPOINT = '/.netlify/functions/practice-asset-url';
/** 本地缓存稍小于服务端 TTL（600s），避免边界用到过期 URL。 */
const LOCAL_TTL_MS = 5 * 60 * 1000;

type CacheKey = `${string}::${PracticeAssetKind}`;
const cache = new Map<CacheKey, PracticeAssetResolved>();

function cacheKey(trackId: string, kind: PracticeAssetKind): CacheKey {
  return `${trackId}::${kind}` as CacheKey;
}

function readFromCache(trackId: string, kind: PracticeAssetKind): PracticeAssetResolved | null {
  const entry = cache.get(cacheKey(trackId, kind));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now() + 5_000) {
    cache.delete(cacheKey(trackId, kind));
    return null;
  }
  return entry;
}

function writeToCache(trackId: string, kind: PracticeAssetKind, url: string, expiresAt: number) {
  cache.set(cacheKey(trackId, kind), {url, expiresAt});
}

export function invalidatePracticeAssetCache(trackId?: string) {
  if (!trackId) {
    cache.clear();
    return;
  }
  cache.delete(cacheKey(trackId, 'midi'));
  cache.delete(cacheKey(trackId, 'musicxml'));
}

/**
 * 请求 broker 拿到一个短时 signed URL。失败时绝不抛，只返回结构化 reason。
 */
export async function resolvePracticeAssetUrl(
  trackId: string,
  kind: PracticeAssetKind,
): Promise<PracticeAssetResolveResult> {
  const trimmedId = trackId?.trim();
  if (!trimmedId) {
    return {ok: false, reason: 'asset_missing', message: 'Missing trackId'};
  }

  const cached = readFromCache(trimmedId, kind);
  if (cached) {
    return {ok: true, url: cached.url, expiresAt: cached.expiresAt};
  }

  let accessToken: string | null = null;
  try {
    const {data} = await supabase.auth.getSession();
    accessToken = data.session?.access_token ?? null;
  } catch {
    accessToken = null;
  }
  if (!accessToken) {
    return {ok: false, reason: 'no_session', message: 'Please sign in to use Practice Mode.'};
  }

  let res: Response;
  try {
    res = await fetch(BROKER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({trackId: trimmedId, kind}),
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'network',
      message: err instanceof Error ? err.message : 'Network error',
    };
  }

  const status = res.status;
  let payload: Record<string, unknown> = {};
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  if (res.ok && payload?.ok === true && typeof payload.url === 'string') {
    const urlStr = payload.url;
    const expiresIso = typeof payload.expiresAt === 'string' ? payload.expiresAt : null;
    const expiresAt = expiresIso ? Date.parse(expiresIso) : Date.now() + LOCAL_TTL_MS;
    const clamped = Math.min(
      Number.isFinite(expiresAt) ? expiresAt : Date.now() + LOCAL_TTL_MS,
      Date.now() + LOCAL_TTL_MS,
    );
    writeToCache(trimmedId, kind, urlStr, clamped);
    return {ok: true, url: urlStr, expiresAt: clamped};
  }

  const code = typeof payload?.code === 'string' ? payload.code : '';
  const serverMessage = typeof payload?.message === 'string' ? payload.message : '';

  if (status === 401 || code === 'UNAUTHENTICATED' || code === 'INVALID_SESSION') {
    return {ok: false, reason: 'unauthenticated', httpStatus: status, message: serverMessage};
  }
  if (status === 403 || code === 'PREMIUM_REQUIRED') {
    return {ok: false, reason: 'premium_required', httpStatus: status, message: serverMessage};
  }
  if (status === 404 || code === 'ASSET_MISSING' || code === 'SONG_NOT_FOUND' || code === 'SONG_UNPUBLISHED') {
    return {ok: false, reason: 'asset_missing', httpStatus: status, message: serverMessage};
  }
  return {ok: false, reason: 'server_error', httpStatus: status, message: serverMessage};
}

/**
 * 便捷路由：同时兼容 `/local-imports/` 静态 seed（Phase 1 不收紧这一路径）。
 * 给 Practice Panel 用，使切换逻辑只有一个入口。
 */
export async function resolvePracticeAssetForTrack(
  trackId: string,
  kind: PracticeAssetKind,
  legacyStaticUrl: string | undefined,
): Promise<PracticeAssetResolveResult> {
  if (legacyStaticUrl && legacyStaticUrl.startsWith('/local-imports/')) {
    const result: PracticeAssetResolveResult = {
      ok: true,
      url: legacyStaticUrl,
      expiresAt: Date.now() + LOCAL_TTL_MS,
    };
    return result;
  }
  return resolvePracticeAssetUrl(trackId, kind);
}
