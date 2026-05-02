import {supabase} from './supabase';

export type PremiumSceneId = 'forestCafe' | 'celestialDome';

/** 背景视频朝向：与 broker 请求体一致，默认 landscape 兼容旧客户端 */
export type SceneVideoOrientation = 'landscape' | 'portrait';

export type SceneAssetResolved = {
  url: string;
  expiresAt: number;
};

export type SceneAssetResolveSuccess = {
  ok: true;
  url: string;
  expiresAt: number;
  accessMode: string;
};

export type SceneAssetResolveFailure = {
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

export type SceneAssetResolveResult =
  | SceneAssetResolveSuccess
  | SceneAssetResolveFailure;

const BROKER_ENDPOINT = '/.netlify/functions/scene-asset-url';
const DEFAULT_LOCAL_TTL_MS = 55 * 60 * 1000;

const cache = new Map<string, SceneAssetResolved>();

function normalizeOrientation(v: SceneVideoOrientation | undefined): SceneVideoOrientation {
  return v === 'portrait' ? 'portrait' : 'landscape';
}

function cacheStorageKey(sceneId: PremiumSceneId, orientation: SceneVideoOrientation): string {
  return `${sceneId}:${orientation}`;
}

function readFromCache(sceneId: PremiumSceneId, orientation: SceneVideoOrientation): SceneAssetResolved | null {
  const key = cacheStorageKey(sceneId, orientation);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now() + 60_000) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function writeToCache(sceneId: PremiumSceneId, orientation: SceneVideoOrientation, url: string, expiresAt: number) {
  cache.set(cacheStorageKey(sceneId, orientation), {url, expiresAt});
}

export function invalidateSceneAssetCache(sceneId?: PremiumSceneId) {
  if (!sceneId) {
    cache.clear();
    return;
  }
  cache.delete(cacheStorageKey(sceneId, 'landscape'));
  cache.delete(cacheStorageKey(sceneId, 'portrait'));
}

export async function resolveSceneAssetUrl(
  sceneId: PremiumSceneId,
  options?: {orientation?: SceneVideoOrientation},
): Promise<SceneAssetResolveResult> {
  const orientation = normalizeOrientation(options?.orientation);
  const cached = readFromCache(sceneId, orientation);
  if (cached) {
    return {ok: true, url: cached.url, expiresAt: cached.expiresAt, accessMode: 'cache'};
  }

  let accessToken: string | null = null;
  try {
    const {data} = await supabase.auth.getSession();
    accessToken = data.session?.access_token ?? null;
  } catch {
    accessToken = null;
  }
  if (!accessToken) {
    return {ok: false, reason: 'no_session', message: 'Please sign in to use premium scenes.'};
  }

  let res: Response;
  try {
    res = await fetch(BROKER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({sceneId, orientation}),
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
    const parsedExpiresAt = expiresIso ? Date.parse(expiresIso) : Number.NaN;
    const expiresAt =
      Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : Date.now() + DEFAULT_LOCAL_TTL_MS;
    const accessMode = typeof payload.accessMode === 'string' ? payload.accessMode : 'broker';
    writeToCache(sceneId, orientation, urlStr, expiresAt);
    return {ok: true, url: urlStr, expiresAt, accessMode};
  }

  const code = typeof payload?.code === 'string' ? payload.code : '';
  const serverMessage = typeof payload?.message === 'string' ? payload.message : '';

  if (status === 401 || code === 'UNAUTHENTICATED' || code === 'INVALID_SESSION') {
    return {ok: false, reason: 'unauthenticated', httpStatus: status, message: serverMessage};
  }
  if (status === 403 || code === 'PREMIUM_REQUIRED') {
    return {ok: false, reason: 'premium_required', httpStatus: status, message: serverMessage};
  }
  if (status === 404 || code === 'SCENE_NOT_FOUND' || code === 'SCENE_UNAVAILABLE') {
    return {ok: false, reason: 'asset_missing', httpStatus: status, message: serverMessage};
  }
  return {ok: false, reason: 'server_error', httpStatus: status, message: serverMessage};
}
