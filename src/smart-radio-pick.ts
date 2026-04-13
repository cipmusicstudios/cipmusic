/**
 * Smart Radio：分层推荐 — 作品来源（workProjectKey）> 艺人 > 分类/标签 > 泛化。
 */
import { dictionaryCanonicalId } from './artist-canonical';
import { ARTIST_DICTIONARY } from './local-import-artist-normalization';
import type { Track } from './types/track';
import { getTrackCategoryKeysStatic, getTrackPrimaryCategoryKeyStatic, normalizeSearchStatic } from './category-keys';
import type { MusicPlaybackContext } from './music-playback-context';
import { getWorkProjectKey } from './work-project';

const RECENT_WINDOW = 12;
const TOP_N_RANDOM = 4;

function canonicalIdsForTrack(track: Track): string[] {
  const primary = track.canonicalArtistId || track.metadata.display.canonicalArtistId;
  const co = track.coCanonicalArtistIds ?? track.metadata.display.coCanonicalArtistIds ?? [];
  return Array.from(new Set([primary, ...co].filter(Boolean) as string[])).map(dictionaryCanonicalId);
}

function dictType(id: string): 'solo' | 'group' | 'project' | 'unknown' | undefined {
  const row = ARTIST_DICTIONARY[dictionaryCanonicalId(id)];
  return row?.type;
}

function isProjectId(id: string): boolean {
  return dictType(id) === 'project';
}

function normAlbum(track: Track): string {
  const a = track.sourceAlbum || track.metadataCandidates?.[0]?.album;
  return a ? normalizeSearchStatic(a) : '';
}

function tagSet(track: Track): Set<string> {
  const keys = getTrackCategoryKeysStatic(track);
  const tags = [...(track.tags || []), ...(track.metadata.display.categories?.tags || [])];
  const s = new Set<string>();
  keys.forEach(k => s.add(normalizeSearchStatic(k)));
  tags.forEach(t => s.add(normalizeSearchStatic(t)));
  return s;
}

/** 同艺人（字典里的「project」型艺人 id 不计入艺人匹配，避免与 workProjectKey 混淆） */
function sharesCanonicalArtist(current: Track, candidate: Track): boolean {
  const curIds = canonicalIdsForTrack(current);
  const candIds = canonicalIdsForTrack(candidate);
  const curNonProject = new Set(curIds.filter(id => !isProjectId(id)));
  const candNonProject = new Set(candIds.filter(id => !isProjectId(id)));
  for (const a of candNonProject) {
    if (curNonProject.has(a)) return true;
  }
  return false;
}

/**
 * 未出现在 recentIds 的优先；若都在窗口内，优先「窗口内更早出现」的（较久未播）。
 */
function compareRecency(aId: string, bId: string, recentIds: readonly string[]): number {
  const ia = recentIds.indexOf(aId);
  const ib = recentIds.indexOf(bId);
  const aMiss = ia < 0;
  const bMiss = ib < 0;
  if (aMiss !== bMiss) return aMiss ? -1 : 1;
  if (aMiss && bMiss) return 0;
  return ia - ib;
}

function stablePickIndex(seed: string, n: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return n > 0 ? h % n : 0;
}

function pickFromOrderedPool(pool: Track[], current: Track, salt: string): Track | null {
  if (pool.length === 0) return null;
  const slice = pool.slice(0, Math.min(TOP_N_RANDOM, pool.length));
  const idx = stablePickIndex(`${current.id}:${salt}:${slice[0]?.id}`, slice.length);
  return slice[idx] ?? pool[0];
}

/** 按「未最近播优先」排序后，在前 N 首内稳定随机 */
function pickWithRecencyPreference(
  pool: Track[],
  current: Track,
  recentIds: readonly string[],
  salt: string,
): Track | null {
  if (pool.length === 0) return null;
  const ordered = [...pool].sort((a, b) => compareRecency(a.id, b.id, recentIds));
  return pickFromOrderedPool(ordered, current, salt);
}

function scoreFallbackCandidate(current: Track, candidate: Track, ctx: MusicPlaybackContext): number {
  if (candidate.id === current.id) return -Infinity;

  const pkCur = getWorkProjectKey(current);
  const pkCand = getWorkProjectKey(candidate);
  const sameWork = pkCur && pkCand && pkCur === pkCand;

  const curIds = canonicalIdsForTrack(current);
  const candIds = canonicalIdsForTrack(candidate);
  const curProjects = new Set(curIds.filter(isProjectId));
  const candProjects = new Set(candIds.filter(isProjectId));
  let sharedDictProject = false;
  for (const p of candProjects) {
    if (curProjects.has(p)) {
      sharedDictProject = true;
      break;
    }
  }

  const curNonProject = new Set(curIds.filter(id => !isProjectId(id)));
  const candNonProject = new Set(candIds.filter(id => !isProjectId(id)));
  let sharedArtist = false;
  for (const a of candNonProject) {
    if (curNonProject.has(a)) {
      sharedArtist = true;
      break;
    }
  }

  const pkCur2 = getTrackPrimaryCategoryKeyStatic(current);
  const pkCand2 = getTrackPrimaryCategoryKeyStatic(candidate);
  const samePrimaryCat = pkCur2 && pkCand2 && pkCur2 === pkCand2;

  const tagsCur = tagSet(current);
  const tagsCand = tagSet(candidate);
  let tagOverlap = 0;
  tagsCand.forEach(t => {
    if (t && tagsCur.has(t)) tagOverlap++;
  });

  const albumCur = normAlbum(current);
  const albumCand = normAlbum(candidate);
  const sameAlbum = albumCur.length > 4 && albumCur === albumCand;

  let score = 0;
  if (sameWork) score += 400;
  if (sharedDictProject) score += 40;
  if (sameAlbum) score += 80;
  if (sharedArtist) score += 120;
  if (samePrimaryCat) score += 50;
  score += Math.min(40, tagOverlap * 11);

  if (ctx.musicLibraryActive) {
    if (ctx.musicView === 'artist_detail' && ctx.artistContextId) {
      const ctxId = dictionaryCanonicalId(ctx.artistContextId);
      if (candIds.includes(ctxId)) {
        if (isProjectId(ctxId)) score += 70;
        else score += 60;
      }
    }
    if (ctx.musicView === 'songs' && ctx.categoryKey && ctx.categoryKey !== 'all') {
      const keys = getTrackCategoryKeysStatic(candidate);
      if (keys.includes(ctx.categoryKey)) score += 65;
    }
  }

  return score;
}

export function pickNextSmartRadioTrack(args: {
  current: Track;
  catalog: Track[];
  recentIds: readonly string[];
  context: MusicPlaybackContext;
}): Track | null {
  const { current, catalog, recentIds, context } = args;
  const recentSet = new Set(recentIds.filter(Boolean));

  const others = catalog.filter(t => t.id !== current.id);
  if (others.length === 0) return null;

  // —— 1) 同作品来源 workProjectKey（最高） ——
  const pk = getWorkProjectKey(current);
  if (pk) {
    const sameProject = others.filter(t => getWorkProjectKey(t) === pk);
    if (sameProject.length > 0) {
      const notRecent = sameProject.filter(t => !recentSet.has(t.id));
      const pool = notRecent.length > 0 ? notRecent : sameProject;
      const picked = pickWithRecencyPreference(pool, current, recentIds, 'workProject');
      if (picked) return picked;
    }
  }

  // —— 2) 同艺人 / 组合 ——
  const sameArtist = others.filter(t => sharesCanonicalArtist(current, t));
  if (sameArtist.length > 0) {
    const notRecent = sameArtist.filter(t => !recentSet.has(t.id));
    const pool = notRecent.length > 0 ? notRecent : sameArtist;
    const picked = pickWithRecencyPreference(pool, current, recentIds, 'artist');
    if (picked) return picked;
  }

  // —— 3) 分类 / 标签 / 上下文（加权打分） ——
  const scoreAndFilter = (excludeRecent: boolean) => {
    const rows: { track: Track; score: number }[] = [];
    for (const t of others) {
      if (excludeRecent && recentSet.has(t.id)) continue;
      const s = scoreFallbackCandidate(current, t, context);
      if (s > -Infinity) rows.push({ track: t, score: s });
    }
    rows.sort((a, b) => b.score - a.score);
    return rows;
  };

  let rows = scoreAndFilter(true);
  if (rows.length === 0) rows = scoreAndFilter(false);
  if (rows.length === 0) return null;

  const topScore = rows[0].score;
  const topBand = rows.filter(r => r.score >= topScore - 10);
  const pool = topBand.slice(0, Math.min(TOP_N_RANDOM, topBand.length));
  const idx = stablePickIndex(`${current.id}:${topScore}:fb`, pool.length);
  return pool[idx]?.track ?? rows[0].track;
}

export function pushRecentTrackId(recent: string[], trackId: string, max = RECENT_WINDOW): string[] {
  const next = recent.filter(id => id !== trackId);
  next.push(trackId);
  if (next.length > max) next.splice(0, next.length - max);
  return next;
}
