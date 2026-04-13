/**
 * Favorites + Recently Played (localStorage, max 20 each, FIFO).
 */
export const LIBRARY_MAX = 20;
const KEY_FAVORITES = 'aurasounds_favorites_v1';
const KEY_RECENT = 'aurasounds_recently_played_v1';

function parseIdList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return [];
  }
}

export function loadFavoriteIds(): string[] {
  try {
    const list = parseIdList(localStorage.getItem(KEY_FAVORITES));
    return dedupePreserveOrder(list).slice(0, LIBRARY_MAX);
  } catch {
    return [];
  }
}

export function saveFavoriteIds(ids: string[]): void {
  try {
    localStorage.setItem(KEY_FAVORITES, JSON.stringify(ids.slice(0, LIBRARY_MAX)));
  } catch {
    /* ignore */
  }
}

export function loadRecentTrackIds(): string[] {
  try {
    const list = parseIdList(localStorage.getItem(KEY_RECENT));
    return dedupePreserveOrder(list).slice(0, LIBRARY_MAX);
  } catch {
    return [];
  }
}

export function saveRecentTrackIds(ids: string[]): void {
  try {
    localStorage.setItem(KEY_RECENT, JSON.stringify(ids.slice(0, LIBRARY_MAX)));
  } catch {
    /* ignore */
  }
}

function dedupePreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Toggle favorite; newest additions first; cap at LIBRARY_MAX (drop oldest in list). */
export function toggleFavoriteList(prev: string[], trackId: string): string[] {
  const i = prev.indexOf(trackId);
  if (i >= 0) return prev.filter(id => id !== trackId);
  const next = [trackId, ...prev.filter(id => id !== trackId)];
  return next.slice(0, LIBRARY_MAX);
}

/** Move trackId to front (most recent); cap at LIBRARY_MAX. */
export function touchRecentList(prev: string[], trackId: string): string[] {
  const next = [trackId, ...prev.filter(id => id !== trackId)];
  return next.slice(0, LIBRARY_MAX);
}
