/**
 * Which canonical ids may appear on the Music → Artists grid.
 * Hides IP / drama / movie / show title buckets that are not real performing entities.
 */
import { ARTIST_DICTIONARY } from './local-import-artist-normalization';

/** Game / IP project rows we still show as a single “project” card (logo / key art). */
const PROJECT_ARTISTS_ALLOWED_ON_GRID = new Set<string>([
  'love-and-deepspace',
  'genshin-impact',
  'honkai-star-rail',
  'honkai-impact-3',
  'honor-of-kings',
  'paper-bride',
  'black-myth-wukong',
  'fairy-town',
]);

/**
 * `from-youtube/...` freeform buckets that resolve to real performers (or OST composers),
 * not drama / variety / marketing title strings.
 */
const FROM_YOUTUBE_PERFORMER_ALLOWLIST = new Set<string>([
  'from-youtube/lil-nas-x',
  'from-youtube/lulleaux-kid-princess',
  'from-youtube/cortis',
  'from-youtube/kiiikiii',
  'from-youtube/hearts2hearts',
  'from-youtube/刀酱',
  'from-youtube/black-myth',
  'from-youtube/于冬然',
  'from-youtube/尹露浠',
  'from-youtube/asmrz',
  'from-youtube/吉星出租',
  'from-youtube/就是南方凯',
  'from-youtube/spider',
]);

export function shouldShowArtistOnArtistPage(canonicalArtistId: string | undefined): boolean {
  if (!canonicalArtistId) return false;
  if (canonicalArtistId.startsWith('review/') || canonicalArtistId.startsWith('canon-') || canonicalArtistId === '__unknown__') {
    return false;
  }

  const row = ARTIST_DICTIONARY[canonicalArtistId];
  if (row?.type === 'project') {
    return PROJECT_ARTISTS_ALLOWED_ON_GRID.has(canonicalArtistId);
  }

  if (canonicalArtistId.startsWith('from-youtube/')) {
    return FROM_YOUTUBE_PERFORMER_ALLOWLIST.has(canonicalArtistId);
  }

  return true;
}
