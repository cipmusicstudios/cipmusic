import type { Track } from './types/track';
import videoOverridesDoc from '../data/video-overrides.json';

function isRealBilibiliWatchUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  return /bilibili\.com\/video\/(BV[\w]+)/i.test(url) || /bilibili\.com\/video\/av\d+/i.test(url);
}

export type VideoOverrideEntry = {
  title: string;
  artist: string;
  aliases?: string[];
  slugKeys?: string[];
  videoUrlZhHans: string;
  videoPlatformZhHans: 'bilibili';
  videoUrlDefault?: string | null;
  notes?: string;
};

type VideoOverridesDoc = {
  version: number;
  schema: string;
  readme?: string;
  entries: VideoOverrideEntry[];
  pendingReview?: Array<{ reason: string; detail: string; countEstimate?: number }>;
};

const DOC = videoOverridesDoc as VideoOverridesDoc;

function normKey(s: string): string {
  return s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function trackSlug(track: Track): string {
  return (track.metadata?.identity?.slug || '').trim();
}

function titleHaystack(track: Track): string[] {
  const d = track.metadata?.display;
  const out = new Set<string>();
  const add = (x?: string | null) => {
    if (x && x.trim()) out.add(x.trim());
  };
  add(track.title);
  add(track.sourceSongTitle);
  add(d?.title);
  add(d?.displayTitle);
  add(d?.titles?.zhHans);
  add(d?.titles?.zhHant);
  add(d?.titles?.en);
  const slug = trackSlug(track);
  if (slug) add(slug);
  return [...out];
}

function artistHaystack(track: Track): string[] {
  const d = track.metadata?.display;
  const out = new Set<string>();
  const add = (x?: string | null) => {
    if (x && x.trim()) out.add(x.trim());
  };
  add(track.artist);
  add(track.sourceArtist);
  add(d?.artist);
  add(d?.artists?.zhHans);
  add(d?.artists?.zhHant);
  add(d?.artists?.en);
  add(d?.canonicalArtistDisplayName);
  return [...out];
}

function matchesSlug(entry: VideoOverrideEntry, slugNorm: string): boolean {
  if (!slugNorm || !entry.slugKeys?.length) return false;
  const set = new Set(entry.slugKeys.map(k => normKey(k)));
  return set.has(slugNorm);
}

function matchesArtistTitle(entry: VideoOverrideEntry, track: Track): boolean {
  const an = normKey(entry.artist);
  const artists = artistHaystack(track).map(normKey);
  if (!artists.some(a => a === an)) return false;

  const titles = new Set<string>([normKey(entry.title), ...(entry.aliases || []).map(normKey)]);
  const th = titleHaystack(track).map(normKey);
  return th.some(t => titles.has(t));
}

/** Resolve catalog row from `data/video-overrides.json` (slug first, then artist+title/aliases). */
export function lookupVideoOverrideEntry(track: Track): VideoOverrideEntry | undefined {
  const slugN = normKey(trackSlug(track));
  for (const e of DOC.entries) {
    if (matchesSlug(e, slugN)) return e;
  }
  for (const e of DOC.entries) {
    if (matchesArtistTitle(e, track)) return e;
  }
  return undefined;
}

/** Bilibili watch URL from overrides only (does not read track.bilibiliUrl). */
export function getVideoOverrideZhHansUrl(track: Track): string | undefined {
  const row = lookupVideoOverrideEntry(track);
  const u = row?.videoUrlZhHans;
  if (!u || !isRealBilibiliWatchUrl(u)) return undefined;
  return u.replace(/\/?$/, '');
}

export function getVideoOverridesReadme(): string | undefined {
  return DOC.readme;
}

export function getVideoOverridesEntryCount(): number {
  return DOC.entries.length;
}
