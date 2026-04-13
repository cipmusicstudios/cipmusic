/**
 * Mirrors the strict title/artist gates in `generate-local-import-cip-links.mjs`
 * for offline suspect refinement. Keep in sync when gate rules change.
 */
import { transliterate } from 'transliteration';
import type { LocalImportMetadataOverride } from '../src/local-import-metadata-overrides';

type Seed = { slug: string; titleOverride?: string; audioFile?: string };

const decodeHtmlEntities = (value: string) =>
  (value || '')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

export const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d'"`]/g, '')
    .replace(/[()（）【】[\]{}《》“”‘’:,|\-–—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeHint = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const hasCjk = (value: string) =>
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);

export function extractQuotedTitles(title: string): string[] {
  return Array.from(title.matchAll(/[“"'‘]([^”"'’]+)[”"'’]/g), (match) => match[1]?.trim()).filter(
    Boolean,
  ) as string[];
}

export function extractBestTitleAnchor(title: string): string {
  const decoded = decodeHtmlEntities(title || '');
  const quoted = extractQuotedTitles(decoded);
  if (quoted.length > 0) return quoted[0];
  return decoded;
}

export function getTitleCandidatesForGate(seed: Seed, overrides: Record<string, LocalImportMetadataOverride>): string[] {
  const override = overrides[seed.slug];
  const raw = [
    override?.title,
    override?.displayTitle,
    override?.titles?.zhHans,
    override?.titles?.zhHant,
    override?.titles?.en,
    seed.titleOverride,
    seed.slug,
  ].filter(Boolean) as string[];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const n = normalize(r).replace(/\s+/g, ' ').trim();
    if (n.length >= 2 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export function strictTitleGate(seed: Seed, videoTitleRaw: string, overrides: Record<string, LocalImportMetadataOverride>): boolean {
  const vt = normalize(decodeHtmlEntities(videoTitleRaw || ''));
  const anchor = normalize(extractBestTitleAnchor(videoTitleRaw || ''));
  const qs = getTitleCandidatesForGate(seed, overrides);
  const quoted = extractQuotedTitles(videoTitleRaw || '').map((x) => normalize(x));
  for (const q of qs) {
    if (q.length < 2) continue;
    if (q.length <= 4) {
      if (quoted.some((qu) => qu.includes(q) || q.includes(qu))) return true;
      if (q.length >= 3 && vt.includes(q)) return true;
      continue;
    }
    if (vt.includes(q) || anchor.includes(q) || (anchor.length >= 4 && q.includes(anchor))) return true;
  }
  for (const q of qs) {
    if (q.length < 4) continue;
    for (const qu of quoted) {
      if (qu.includes(q) || q.includes(qu)) return true;
    }
  }
  return false;
}

function artistTokensFromString(artistStr: string): string[] {
  if (!artistStr?.trim()) return [];
  const parts = artistStr
    .split(/[,，/&]|feat\.|ft\.|×|\bx\b/gi)
    .map((x) => x.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const nh = normalizeHint(decodeHtmlEntities(p));
    if (nh.length >= 2) out.push(nh.replace(/\s+/g, ' ').trim());
    if (hasCjk(p)) {
      const tr = transliterate(p)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      if (tr.length >= 3) out.push(tr.replace(/\s+/g, ''));
    }
  }
  return [...new Set(out)];
}

export function getExpectedArtistStrings(
  seed: Seed,
  overrides: Record<string, LocalImportMetadataOverride>,
): string[] {
  const o = overrides[seed.slug];
  return [o?.artist, o?.artists?.zhHans, o?.artists?.zhHant, o?.artists?.en].filter(Boolean) as string[];
}

/** When `extraArtists` present, gate passes if any expected OR extra artist matches video title. */
export function strictArtistGate(
  seed: Seed,
  videoTitleRaw: string,
  overrides: Record<string, LocalImportMetadataOverride>,
  extraArtists: string[] = [],
): { ok: boolean; needsHighScore: boolean; reason: string } {
  const artists = [...new Set([...getExpectedArtistStrings(seed, overrides), ...extraArtists].filter(Boolean))];
  const vt = normalizeHint(decodeHtmlEntities(videoTitleRaw || ''));
  if (!vt) return { ok: false, needsHighScore: false, reason: 'empty_video_title' };
  if (artists.length === 0) return { ok: true, needsHighScore: true, reason: 'no_artist_metadata' };
  for (const a of artists) {
    const tokens = artistTokensFromString(a);
    const full = normalizeHint(a).replace(/\s+/g, '');
    if (full.length >= 2 && (vt.includes(full) || vt.replace(/\s+/g, '').includes(full))) {
      return { ok: true, needsHighScore: false, reason: 'artist_full' };
    }
    for (const t of tokens) {
      const compact = t.replace(/\s+/g, '');
      if (compact.length < 2) continue;
      if (vt.includes(t) || vt.replace(/\s+/g, '').includes(compact)) {
        return { ok: true, needsHighScore: false, reason: 'artist_token' };
      }
    }
  }
  return { ok: false, needsHighScore: false, reason: 'artist_mismatch' };
}

const COMMON_SHORT_TITLE_WORDS = new Set([
  'super',
  'home',
  'y',
  'crush',
  'stay',
  'promise',
  'fire',
  'monster',
  'celebrate',
  'diamond',
  'answer',
  'shine',
  'dna',
  'on',
  'off',
  'up',
  'down',
  'run',
  'go',
  'ai',
  'zoo',
  'normal',
  'see',
  'light',
  '相遇',
  '我们',
  '念',
  '泪桥',
  '悟',
  '舞台',
  '一杯',
  '火焰',
  'into1',
]);

export function isShortOrCommonTitleSeed(
  seed: Seed,
  overrides: Record<string, LocalImportMetadataOverride>,
): boolean {
  const override = overrides[seed.slug];
  const t = (override?.title || override?.displayTitle || seed.titleOverride || seed.slug || '').trim();
  const compact = t.replace(/\s+/g, '');
  if (compact.length > 0 && compact.length <= 4) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 1 && t.length <= 10 && COMMON_SHORT_TITLE_WORDS.has(t.toLowerCase())) return true;
  return false;
}

/** Same scoring idea as generate script `scoreCandidate` (simplified). */
export function scoreCandidateAgainstTitle(query: string, title: string): number {
  const t = normalize(decodeHtmlEntities(title || ''));
  const q = normalize(query);
  if (!q || !t) return -1;
  let score = 0;
  if (hasCjk(query)) {
    if (t.includes(q)) score += 100;
    if (t.startsWith(q)) score += 20;
  } else {
    if (t.includes(q)) score += 80;
    const qWords = q.split(' ').filter(Boolean);
    score += qWords.filter((word) => t.includes(word)).length * 10;
  }
  if (t.includes('piano by cip music')) score += 10;
  if (t.includes('piano cover')) score += 5;
  return score;
}
