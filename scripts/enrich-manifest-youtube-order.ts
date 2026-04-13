/**
 * Enrich songs-manifest entries with YouTube channel order (newest-first index) and optional upload dates.
 *
 * Priority: (1) `public/youtube-channel-order-cache.json` if present (commit-friendly for CI),
 * (2) `yt-dlp` channel scrape, (3) skip with warning.
 *
 * Env: YOUTUBE_CHANNEL_VIDEOS_URL (default https://www.youtube.com/@CIPMusic/videos)
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SongManifestEntry } from '../src/songs-manifest.ts';
import { execYtDlp, resolveYtDlp } from './yt-dlp-resolve.ts';

const DEFAULT_CHANNEL = 'https://www.youtube.com/@CIPMusic/videos';
const CACHE_REL = ['public', 'youtube-channel-order-cache.json'];

/** Lowercase, strip noise words, keep letters/numbers/CJK for loose matching */
export function normForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/piano\s*cover|cover\s*by|piano\s*by|official\s*(mv|video)?|mv|live|feat\.|ft\.|钢琴|版|ost/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleScore(trackTitle: string, videoTitle: string): number {
  const A = normForMatch(trackTitle);
  const B = normForMatch(videoTitle);
  if (!A || !B) return 0;
  if (A.includes(B) || B.includes(A)) return 0.95;
  const ta = new Set(A.split(' ').filter(x => x.length > 1));
  const tb = new Set(B.split(' ').filter(x => x.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) {
    if (tb.has(x)) inter++;
  }
  return inter / Math.max(ta.size, tb.size, 1);
}

type YtRow = { id: string; title: string; index: number; uploadDate?: string };

function loadOrderCache(projectRoot: string): YtRow[] | null {
  const cachePath = path.join(projectRoot, ...CACHE_REL);
  if (!fs.existsSync(cachePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as {
      videos?: Array<{ id: string; title?: string; index?: number; uploadDate?: string }>;
    };
    const v = raw.videos;
    if (!Array.isArray(v) || v.length === 0) return null;
    return v.map((row, i) => ({
      id: String(row.id),
      title: row.title ?? '',
      index: typeof row.index === 'number' ? row.index : i,
      uploadDate: row.uploadDate,
    }));
  } catch {
    return null;
  }
}

function parseUploadDateToIso(ymd: string | undefined): string | undefined {
  if (!ymd || ymd === 'NA' || ymd.length < 8) return undefined;
  const y = ymd.slice(0, 4);
  const m = ymd.slice(4, 6);
  const d = ymd.slice(6, 8);
  const iso = `${y}-${m}-${d}T12:00:00.000Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? iso : undefined;
}

/**
 * Fetch channel /videos tab as flat playlist: line order = newest-first on typical channel layout.
 */
function fetchChannelRows(channelUrl: string): YtRow[] {
  const out = execYtDlp(
    [
      '--no-warnings',
      '--ignore-errors',
      '--flat-playlist',
      '--playlist-end',
      '10000',
      '--print',
      '%(id)s\t%(title)s\t%(upload_date)s',
      channelUrl,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 50_000_000,
      timeout: 240_000,
    },
  );
  const rows: YtRow[] = [];
  const lines = out.split(/\r?\n/).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    const id = parts[0]?.trim();
    const title = parts[1]?.trim() ?? '';
    const upload = parts[2]?.trim();
    if (!id || id.length < 6) continue;
    rows.push({
      id,
      title,
      index: i,
      uploadDate: upload && upload !== 'NA' ? upload : undefined,
    });
  }
  return rows;
}

export function enrichManifestEntriesWithYoutubeOrder(
  entries: SongManifestEntry[],
  opts?: { channelUrl?: string; verbose?: boolean; projectRoot?: string },
): { entries: SongManifestEntry[]; stats: { matchedById: number; matchedByTitle: number; unmatched: number } } {
  const projectRoot = opts?.projectRoot ?? process.cwd();
  const channelUrl = opts?.channelUrl?.trim() || process.env.YOUTUBE_CHANNEL_VIDEOS_URL?.trim() || DEFAULT_CHANNEL;

  let rows: YtRow[] | null = loadOrderCache(projectRoot);
  if (rows?.length) {
    if (opts?.verbose !== false) {
      console.log(`[enrich-manifest-youtube] Using ${rows.length} videos from ${path.join(...CACHE_REL)}`);
    }
  } else if (resolveYtDlp()) {
    try {
      if (opts?.verbose !== false) {
        console.log(`[enrich-manifest-youtube] Fetching channel list via yt-dlp: ${channelUrl}`);
      }
      rows = fetchChannelRows(channelUrl);
      if (opts?.verbose !== false) {
        console.log(`[enrich-manifest-youtube] Got ${rows.length} video rows from channel`);
      }
    } catch (e) {
      console.warn('[enrich-manifest-youtube] yt-dlp failed; skipping enrich:', (e as Error).message);
      rows = null;
    }
  } else {
    if (opts?.verbose !== false) {
      console.warn(
        '[enrich-manifest-youtube] No cache and no yt-dlp; skip YouTube order (run: npm run export:youtube-channel-cache  or  pip install yt-dlp)',
      );
    }
    rows = null;
  }

  if (!rows?.length) {
    return {
      entries,
      stats: { matchedById: 0, matchedByTitle: 0, unmatched: entries.length },
    };
  }

  const idToRow = new Map<string, YtRow>();
  for (const r of rows) {
    if (!idToRow.has(r.id)) idToRow.set(r.id, r);
  }

  const usedTitleIndices = new Set<number>();
  let matchedById = 0;
  let matchedByTitle = 0;

  const nextEntries = entries.map(entry => {
    const vid = entry.youtubeVideoId?.trim();
    let sortIndex: number | undefined;
    let publishedAt: string | undefined;

    if (vid && idToRow.has(vid)) {
      const r = idToRow.get(vid)!;
      sortIndex = r.index;
      publishedAt = parseUploadDateToIso(r.uploadDate);
      matchedById++;
      return {
        ...entry,
        youtubeSortIndex: sortIndex,
        youtubePublishedAt: publishedAt ?? entry.youtubePublishedAt,
      };
    }

    const display = entry.displayTitle || entry.title || '';
    let best: { row: YtRow; score: number } | null = null;
    for (const r of rows) {
      if (usedTitleIndices.has(r.index)) continue;
      const sc = titleScore(display, r.title);
      if (!best || sc > best.score) best = { row: r, score: sc };
    }
    if (best && best.score >= 0.32) {
      usedTitleIndices.add(best.row.index);
      sortIndex = best.row.index;
      publishedAt = parseUploadDateToIso(best.row.uploadDate);
      matchedByTitle++;
      return {
        ...entry,
        youtubeSortIndex: sortIndex,
        youtubePublishedAt: publishedAt ?? entry.youtubePublishedAt,
      };
    }

    return {
      ...entry,
      youtubeSortIndex: undefined,
      youtubePublishedAt: entry.youtubePublishedAt,
    };
  });

  const withOrder = nextEntries.filter(e => e.youtubeSortIndex != null && Number.isFinite(e.youtubeSortIndex)).length;
  const unmatched = nextEntries.length - withOrder;

  return {
    entries: nextEntries,
    stats: {
      matchedById,
      matchedByTitle,
      unmatched,
    },
  };
}
