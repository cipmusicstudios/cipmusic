import {supabase} from './supabase';
import type {Track} from '../types/track';

export type PracticeAssetResolved = {
  midiUrl: string;
  musicXmlUrl: string;
  /** ms epoch */
  expiresAt: number;
};

export type PracticeAssetResolveSuccess = {
  ok: true;
  trackId: string;
  midiUrl: string;
  musicXmlUrl: string;
  expiresAt: number;
  accessMode: string;
};

export type PracticeAssetResolveFailure = {
  ok: false;
  reason:
    | 'no_session'
    | 'unauthenticated'
    | 'practice_not_enabled'
    | 'asset_missing'
    | 'invalid_track_id'
    | 'network'
    | 'server_error';
  message?: string;
  httpStatus?: number;
};

export type PracticeAssetResolveResult =
  | PracticeAssetResolveSuccess
  | PracticeAssetResolveFailure;

const BROKER_ENDPOINT = '/.netlify/functions/practice-asset-url';
const DEFAULT_LOCAL_TTL_MS = 5 * 60 * 1000;
const CACHE_EXPIRY_BUFFER_MS = 30 * 1000;

const cache = new Map<string, PracticeAssetResolved>();

function readFromCache(trackId: string): PracticeAssetResolved | null {
  const entry = cache.get(trackId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now() + CACHE_EXPIRY_BUFFER_MS) {
    cache.delete(trackId);
    return null;
  }
  return entry;
}

function writeToCache(trackId: string, midiUrl: string, musicXmlUrl: string, expiresAt: number) {
  cache.set(trackId, {midiUrl, musicXmlUrl, expiresAt});
}

export function invalidatePracticeAssetCache(trackId?: string) {
  if (!trackId) {
    cache.clear();
    return;
  }
  cache.delete(trackId);
}

/**
 * Phase C 安全收口：所有产品歌曲 Practice Mode 资源必须通过此 broker 拿短链；
 * 绝不直接读取 `track.midiUrl` / `track.musicxmlUrl` 永久 URL。
 */
export async function resolvePracticeAssetUrl(
  trackId: string,
): Promise<PracticeAssetResolveResult> {
  const cached = readFromCache(trackId);
  if (cached) {
    return {
      ok: true,
      trackId,
      midiUrl: cached.midiUrl,
      musicXmlUrl: cached.musicXmlUrl,
      expiresAt: cached.expiresAt,
      accessMode: 'cache',
    };
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
      body: JSON.stringify({trackId}),
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

  if (
    res.ok &&
    payload?.ok === true &&
    typeof payload.midiUrl === 'string' &&
    typeof payload.musicXmlUrl === 'string'
  ) {
    const midiUrl = payload.midiUrl;
    const musicXmlUrl = payload.musicXmlUrl;
    const expiresIso = typeof payload.expiresAt === 'string' ? payload.expiresAt : null;
    const parsedExpiresAt = expiresIso ? Date.parse(expiresIso) : Number.NaN;
    const expiresAt = Number.isFinite(parsedExpiresAt)
      ? parsedExpiresAt
      : Date.now() + DEFAULT_LOCAL_TTL_MS;
    const accessMode = typeof payload.accessMode === 'string' ? payload.accessMode : 'broker';
    writeToCache(trackId, midiUrl, musicXmlUrl, expiresAt);
    return {ok: true, trackId, midiUrl, musicXmlUrl, expiresAt, accessMode};
  }

  const code = typeof payload?.code === 'string' ? payload.code : '';
  const serverMessage = typeof payload?.message === 'string' ? payload.message : '';

  if (status === 400 && code === 'INVALID_TRACK_ID') {
    return {ok: false, reason: 'invalid_track_id', httpStatus: status, message: serverMessage};
  }
  if (status === 401 || code === 'UNAUTHENTICATED' || code === 'INVALID_SESSION') {
    return {ok: false, reason: 'unauthenticated', httpStatus: status, message: serverMessage};
  }
  if (status === 403 || code === 'PRACTICE_NOT_ENABLED') {
    return {
      ok: false,
      reason: 'practice_not_enabled',
      httpStatus: status,
      message: serverMessage,
    };
  }
  if (
    status === 404 ||
    status === 422 ||
    code === 'TRACK_NOT_FOUND' ||
    code === 'PRACTICE_ASSETS_MISSING'
  ) {
    return {ok: false, reason: 'asset_missing', httpStatus: status, message: serverMessage};
  }
  return {ok: false, reason: 'server_error', httpStatus: status, message: serverMessage};
}

/**
 * 路由 helper：
 * - local 种子 / `defaultTrack` Golden 等带本地直链的 track，原地返回（dev workflow 不打断；
 *   Golden 是 Phase D 待清理项）。
 * - remote 产品歌曲（midiUrl/musicxmlUrl 缺失）→ 走 broker 拿短链。
 * - 没有 trackId 的兜底情况返回 `invalid_track_id`，前端按 unavailable 处理。
 */
export async function resolvePracticeAssetForTrack(
  track: Track,
): Promise<PracticeAssetResolveResult> {
  const directMidi = track.midiUrl?.trim();
  const directXml = track.musicxmlUrl?.trim();
  const importSource = track.importSource;
  const isLocalLike = importSource === 'local' || track.id === 'golden_piano';

  if (isLocalLike && directMidi && directXml) {
    return {
      ok: true,
      trackId: track.id,
      midiUrl: directMidi,
      musicXmlUrl: directXml,
      expiresAt: Date.now() + DEFAULT_LOCAL_TTL_MS,
      accessMode: 'direct',
    };
  }

  const trackId = track.id?.trim();
  if (!trackId) {
    return {
      ok: false,
      reason: 'invalid_track_id',
      message: 'Track id is missing.',
    };
  }

  return resolvePracticeAssetUrl(trackId);
}
