/**
 * Longest-alias match of known artists inside a YouTube / CIP video title.
 * Shared by artist-canonical resolution and local-import metadata auto.
 */

import { ARTIST_DICTIONARY, getArtistAliasMap } from './local-import-artist-normalization';
import { normalizeYoutubeTitleForArtistParse } from './text-normalize-compare';

/** Solo/group matches score higher than shorter tokens; project rows are skipped (handled by source rules). */
function typeWeightForExplicitMatch(dictId: string): number {
  const t = ARTIST_DICTIONARY[dictId]?.type;
  if (t === 'project') return -1;
  if (t === 'solo') return 4000;
  if (t === 'group') return 3000;
  return 2000;
}

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

let _aliasMapCache: Record<string, string> | null = null;
function getAliasMap(): Record<string, string> {
  if (!_aliasMapCache) _aliasMapCache = getArtistAliasMap();
  return _aliasMapCache;
}

function matchKnownArtistInNormalizedVideoTitle(
  decoded: string,
): { dictId: string; displayName: string; len: number } | null {
  const normTitle = normalizeYoutubeTitleForArtistParse(decoded);
  if (!normTitle) return null;
  const aliasMap = getAliasMap();

  let bestMatch: { dictId: string; displayName: string; len: number } | null = null;

  for (const [alias, dictId] of Object.entries(aliasMap)) {
    if (alias.length < 2) continue;
    const normAlias = normalizeYoutubeTitleForArtistParse(alias);
    if (normAlias.length < 2) continue;
    const idx = normTitle.toLowerCase().indexOf(normAlias.toLowerCase());
    if (idx === -1) continue;
    const before = idx > 0 ? normTitle[idx - 1] : ' ';
    const after = idx + normAlias.length < normTitle.length ? normTitle[idx + normAlias.length] : ' ';
    const isBoundary = /[\s\-–—|(（《》】」"'',\[.:]/.test(before) || idx === 0;
    const isEndBoundary =
      /[\s\-–—|)）》】」"'',\[（(.:!?《]/.test(after) || idx + normAlias.length === normTitle.length;
    if (!isBoundary || !isEndBoundary) continue;
    const dict = ARTIST_DICTIONARY[dictId];
    const displayName = dict?.names?.zhHans || dict?.names?.en || alias;
    if (!bestMatch || normAlias.length > bestMatch.len) {
      bestMatch = { dictId, displayName, len: normAlias.length };
    }
  }

  return bestMatch;
}

/** Canonical dictionary id if a known artist alias matches (longest win; Hant/Hans-normalized). */
export function findKnownArtistDictIdInVideoTitle(title: string | null | undefined): string | undefined {
  if (!title) return undefined;
  const decoded = decodeHtmlEntities(title).trim();
  const m = matchKnownArtistInNormalizedVideoTitle(decoded);
  return m?.dictId;
}

/** Returns dictionary display name (zhHans preferred) if a known artist alias matches. */
export function findKnownArtistInVideoTitle(title: string | null | undefined): string | undefined {
  if (!title) return undefined;
  const decoded = decodeHtmlEntities(title).trim();
  const m = matchKnownArtistInNormalizedVideoTitle(decoded);
  if (!m) return undefined;
  return m.displayName;
}

/**
 * Best dictionary artist on combined video title + seed artist, preferring solo over group and longer aliases.
 * Skips `project` rows (游戏/企划名) so they do not override real singers; those use source-attribution rules instead.
 */
export function findBestExplicitArtistInHaystack(raw: string | null | undefined): { dictId: string } | null {
  if (!raw?.trim()) return null;
  const decoded = decodeHtmlEntities(raw).trim();
  const normTitle = normalizeYoutubeTitleForArtistParse(decoded);
  if (normTitle.length < 2) return null;
  const aliasMap = getAliasMap();
  const normTitleLower = normTitle.toLowerCase();

  let best: { dictId: string; score: number; idx: number; len: number } | null = null;

  for (const [alias, dictId] of Object.entries(aliasMap)) {
    if (alias.length < 2) continue;
    const tw = typeWeightForExplicitMatch(dictId);
    if (tw < 0) continue;

    const normAlias = normalizeYoutubeTitleForArtistParse(alias);
    if (normAlias.length < 2) continue;

    let searchFrom = 0;
    while (searchFrom < normTitle.length) {
      const found = normTitleLower.indexOf(normAlias.toLowerCase(), searchFrom);
      if (found === -1) break;
      const before = found > 0 ? normTitle[found - 1] : ' ';
      const after =
        found + normAlias.length < normTitle.length ? normTitle[found + normAlias.length] : ' ';
      const isBoundary = /[\s\-–—|(（《》】」"'',\[.:]/.test(before) || found === 0;
      const isEndBoundary =
        /[\s\-–—|)）》】」"'',\[（(.:!?《]/.test(after) || found + normAlias.length === normTitle.length;
      if (isBoundary && isEndBoundary) {
        const score = tw + normAlias.length;
        if (
          !best ||
          score > best.score ||
          (score === best.score && (found < best.idx || (found === best.idx && normAlias.length > best.len)))
        ) {
          best = { dictId, score, idx: found, len: normAlias.length };
        }
      }
      searchFrom = found + 1;
    }
  }

  return best ? { dictId: best.dictId } : null;
}
