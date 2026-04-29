import type { Track } from './types/track';
import { normalizeTextStatic } from './category-keys';
import { isRealBilibiliUrl, isRealSheetUrl, isRealYoutubeWatchUrl } from './track-display';
import {
  resolveCanonicalArtist,
  dictionaryCanonicalId,
  ensureBlackpinkCoBucket,
  type ArtistReviewStatus,
} from './artist-canonical';
import {
  applyCatalogOverridesToTrack,
  getCatalogOverrideForTrack,
  getMergedCatalogOverride,
} from './data/catalog-overrides';
import { ARTIST_DICTIONARY } from './local-import-artist-normalization';
import { buildRomanizedFallbackTitle } from './local-import-metadata-auto';
import { inferBrowseClassificationForUnknownArtist } from './artist-browse-classify';
import { workProjectAugmentedArtistBucketIds } from './artist-browse-filter';
import { parseDurationMmSsToSeconds } from './duration-utils';
import { mergeTrackCategoryLabels } from './track-category-inference';
import type { ArtistImageKind } from './artist-image-kind';
import { inferWorkProjectKeyFromText } from './work-project';
export type { ArtistImageKind } from './artist-image-kind';

/**
 * Slug → 作品项目（build manifest 时写入；本地 seed 可用 overrides.workProjectKey 覆盖）。
 * 与 Supabase 行并存时以显式 Track 字段优先。
 */
export const MANIFEST_WORK_PROJECT_KEY_BY_SLUG: Record<string, string> = {
  Sacrifice: 'league-of-legends',
  'heavy is the crown': 'league-of-legends',
  /** Worlds 2024 — 与 slug `GODS`（全大写）一致 */
  GODS: 'league-of-legends',
  "STAR WALKIN'": 'league-of-legends',
  'pop star': 'league-of-legends',
  'Burn it all down': 'league-of-legends',
  孤勇者: 'league-of-legends',
  这样很好: 'league-of-legends',
  free: 'kpop-demon-hunters',
  'take-down': 'kpop-demon-hunters',
  golden: 'kpop-demon-hunters',
  "How it's done": 'kpop-demon-hunters',
  'soda-pop': 'kpop-demon-hunters',
  'your-idol': 'kpop-demon-hunters',
};

// ── Correct category from confirmed artist nationality ──

const NATIONALITY_TO_CATEGORY: Record<string, string> = {
  zh: '华语流行',
  kr: '韩流流行',
  jp: '日系流行',
  en: '欧美流行',
  other: '欧美流行',
};

const NATIONALITY_TO_KEY: Record<string, string> = {
  zh: 'cpop',
  kr: 'kpop',
  jp: 'jpop',
  en: 'western',
  other: 'western',
};

/** Context / source / style labels merged with language —「纯音乐」参与筛选与展示 */
const CONTEXT_CATEGORY_TAGS = new Set(['影视', '动漫', '游戏', '纯音乐']);

/** Solo + ok + in dictionary → replace seed `artists.*` so UI never shows holiday/video-title junk (e.g. 「七夕快乐！」). */
function artistsFromDictionaryIfSoloOk(
  canonicalArtistId: string,
  coCanonicalArtistIds: string[] | undefined,
  artistReviewStatus: ArtistReviewStatus,
  /** When set and differs from the dictionary primary name, keep track-level `artists` (e.g. INTO1刘宇 vs INTO1). */
  canonicalArtistDisplayName?: string | null,
): { zhHans?: string; zhHant?: string; en?: string } | undefined {
  if (artistReviewStatus !== 'ok') return undefined;
  if (coCanonicalArtistIds && coCanonicalArtistIds.length > 0) return undefined;
  const row = ARTIST_DICTIONARY[dictionaryCanonicalId(canonicalArtistId)];
  if (!row) return undefined;
  const display = canonicalArtistDisplayName?.trim();
  if (display) {
    const zh = row.names.zhHans?.trim();
    const en = row.names.en?.trim();
    if (display !== zh && display !== en) return undefined;
  }
  return {
    zhHans: row.names.zhHans,
    zhHant: row.names.zhHant ?? row.names.zhHans,
    en: row.names.en,
  };
}

function computeCategoryFromArtist(
  canonicalArtistId: string,
  reviewStatus: ArtistReviewStatus,
  existingTags: string[],
): { primaryCategory: string; categoryKey: string; tags: string[] } {
  const contextTags = existingTags.filter(t => CONTEXT_CATEGORY_TAGS.has(t));
  const dict = ARTIST_DICTIONARY[canonicalArtistId];

  if (reviewStatus === 'ok' && dict) {
    const nat = dict.nationality;
    const primary = NATIONALITY_TO_CATEGORY[nat] || '华语流行';
    const key = NATIONALITY_TO_KEY[nat] || 'cpop';
    const tags = [primary, ...contextTags];
    return { primaryCategory: primary, categoryKey: key, tags };
  }

  if (contextTags.length > 0) {
    return { primaryCategory: contextTags[0], categoryKey: 'film', tags: contextTags };
  }

  return { primaryCategory: '华语流行', categoryKey: 'cpop', tags: ['华语流行'] };
}

// ── Clean display title: strip internal disambiguation like "(twice)" ──

const DISAMBIGUATION_PATTERN = /\s*\((?:twice|ive|aespa|seventeen|svt|bts|blackpink|newjeans|illit|le.sserafim|i-?dle|g-?idle|zerobaseone|zb1|itzy|enhypen|babymonster|tws|kep1er|triples|stray.kids|skz|txt|nct|exo|got7|red.velvet|rv|gidle|girls.generation|snsd|super.junior|sj|shinee|f4|tfboys|tnt|snh48|the9|into1|boys.planet|girls.planet|produce|创造营|偶像练习生|青春有你|明日之子|iz\*?one|izone|wjsn|mamamoo|ateez|treasure|riize|boynextdoor|xikers|plave|nmixx|viviz|loona|fromis.9|dreamcatcher|everglow|cravity|tempest|oneus|onewe|astro|ab6ix|cix|drippin|e'last|mcnd|mirae|omega.x|p1harmony|verivery|wei|younite|too|just.b|kingdom|luminous)\)$/i;

function cleanDisplayTitle(raw: string): string {
  return raw.replace(DISAMBIGUATION_PATTERN, '').trim();
}

/** Runtime-configurable manifest URL; override via VITE_SONGS_MANIFEST_URL for CDN. */
export const getSongsManifestUrl = () => {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  return env?.VITE_SONGS_MANIFEST_URL?.trim() || '/songs-manifest.json';
};

export type LinkStatus = 'linked' | 'missingVideo' | 'missingSheet' | 'needsReview';

export type SongManifestEntry = {
  id: string;
  title: string;
  displayTitle: string;
  /** Raw artist string from import / DB (audit trail). */
  originalArtist: string;
  /** Present after pipeline v2; older manifests get filled at runtime via resolveCanonicalArtist. */
  canonicalArtistId?: string;
  /** Duets / collabs: also aggregate under these canonical ids. */
  coCanonicalArtistIds?: string[];
  canonicalArtistDisplayName?: string;
  artistReviewStatus?: ArtistReviewStatus;
  artistResolutionNotes?: string[];
  /** Multi-label: language + 影视/动漫/游戏/纯音乐 等可并存 */
  tags: string[];
  /** 与 UI 筛选 chip 对应的归一化 key（cpop / game / film / …），命中任一即展示 */
  categoryKeys: string[];
  coverUrl: string;
  mp3Url: string;
  midiUrl: string | null;
  musicXmlUrl: string | null;
  duration: string;
  /** Seconds from MP3 analysis or metadata; mirrors Track.metadata.assets.duration */
  durationSeconds?: number | null;
  hasPracticeMode: boolean;
  importSource: 'local' | 'remote';
  slug?: string;
  youtubeVideoUrl?: string | null;
  youtubeVideoTitle?: string | null;
  youtubeVideoId?: string | null;
  /** When CIP has no YouTube but a manual Bilibili watch URL exists. */
  bilibiliVideoUrl?: string | null;
  sheetUrl?: string | null;
  linkStatus?: LinkStatus;
  /** Localized titles for UI (EN / 简 / 繁); optional on older manifests */
  titles?: Track['metadata']['display']['titles'];
  artists?: Track['metadata']['display']['artists'];
  /**
   * From `scripts/enrich-manifest-youtube-order.ts` (yt-dlp @CIPMusic /videos). Smaller = newer.
   */
  youtubeSortIndex?: number | null;
  /** ISO 8601 when upload_date available from yt-dlp */
  youtubePublishedAt?: string | null;
  /**
   * Build-time stable sort key: higher = newer. See `assignManifestListSort`.
   */
  listSortPublishedAtMs?: number | null;
  listSortPublishedAt?: string | null;
  listSortSource?:
    | 'youtube_published'
    | 'youtube_channel_index'
    | 'fallback_no_youtube_order'
    | 'catalog_override'
    | 'new_import_created_at';
  /** ISO 8601 Supabase `songs.created_at`; used to pin newly imported songs on top of Newest. */
  supabaseCreatedAt?: string | null;
  /**
   * 作品级来源（电影/游戏/剧集等），稳定 slug；可与推断逻辑并存，显式优先。
   */
  workProjectKey?: string;
};

/** ~2011 anchor: only-`youtubeSortIndex` rows sort below real upload timestamps but newer index = larger ms. */
const LIST_SORT_CHANNEL_INDEX_BASE_MS = 1_300_000_000_000;
const LIST_SORT_FALLBACK_BASE_MS = 400_000_000_000;

/**
 * Base epoch for "newly imported" songs' sort key. Much larger than any real
 * YouTube upload timestamp (≈1.7e12) and larger than legacy `catalog_override`
 * pins (≈4e12) so any song with Supabase `created_at` ≥ cutoff floats to the
 * very top of Newest, ordered by creation time.
 */
const NEW_IMPORT_SORT_BASE_MS = 5_000_000_000_000;
/**
 * 归档日 — any song whose Supabase `created_at` is after this instant is
 * treated as "a newly added song" and gets pinned to the top of Newest.
 * Songs imported before this cutoff keep their existing YouTube-based order so
 * we don't reshuffle the whole catalog for old imports.
 */
const NEW_IMPORT_CUTOFF_MS = Date.parse('2026-04-22T00:00:00Z');

function stableIdJitterMs(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 86_400_000;
}

/**
 * Fills list sort fields from YouTube enrichment (upload date > channel index > fallback).
 * Call after `enrichManifestEntriesWithYoutubeOrder`.
 */
export function assignManifestListSort(entry: SongManifestEntry): SongManifestEntry {
  if (
    entry.listSortSource === 'catalog_override' &&
    typeof entry.listSortPublishedAtMs === 'number' &&
    Number.isFinite(entry.listSortPublishedAtMs)
  ) {
    return entry;
  }
  /** Pin every song imported after the cutoff to the top of Newest via Supabase `created_at`. */
  const createdAtMs = entry.supabaseCreatedAt
    ? Date.parse(String(entry.supabaseCreatedAt))
    : NaN;
  if (Number.isFinite(createdAtMs) && createdAtMs >= NEW_IMPORT_CUTOFF_MS) {
    const ms = NEW_IMPORT_SORT_BASE_MS + (createdAtMs - NEW_IMPORT_CUTOFF_MS);
    return {
      ...entry,
      listSortPublishedAtMs: ms,
      listSortPublishedAt: new Date(ms).toISOString(),
      listSortSource: 'new_import_created_at',
    };
  }
  const ytMs = entry.youtubePublishedAt ? Date.parse(String(entry.youtubePublishedAt)) : NaN;
  if (Number.isFinite(ytMs)) {
    return {
      ...entry,
      listSortPublishedAtMs: ytMs,
      listSortPublishedAt: new Date(ytMs).toISOString(),
      listSortSource: 'youtube_published',
    };
  }
  const idx = entry.youtubeSortIndex;
  if (idx != null && Number.isFinite(Number(idx))) {
    const n = Number(idx);
    const ms = LIST_SORT_CHANNEL_INDEX_BASE_MS - n * 86_400_000;
    return {
      ...entry,
      listSortPublishedAtMs: ms,
      listSortPublishedAt: new Date(ms).toISOString(),
      listSortSource: 'youtube_channel_index',
    };
  }
  const ms = LIST_SORT_FALLBACK_BASE_MS + stableIdJitterMs(entry.id);
  return {
    ...entry,
    listSortPublishedAtMs: ms,
    listSortPublishedAt: new Date(ms).toISOString(),
    listSortSource: 'fallback_no_youtube_order',
  };
}

/** 应用 `catalog-overrides-locked` 中的 `listSortPublishedAtMs`（Newest 置顶）。 */
export function applyCatalogListSortToManifestEntry(entry: SongManifestEntry): SongManifestEntry {
  const cov = getMergedCatalogOverride(entry.slug, entry.id);
  const ms = cov?.listSortPublishedAtMs;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return entry;
  return {
    ...entry,
    listSortPublishedAtMs: ms,
    listSortPublishedAt: new Date(ms).toISOString(),
    listSortSource: 'catalog_override',
  };
}

/**
 * Final safety net for the English UI title: if the manifest would serialize
 * `titles.en` containing Han characters (either because an override left it as
 * Chinese, or the romanization pipeline never ran), replace it with a
 * pinyin/romanized fallback derived from the display title. Never emits
 * Chinese in `titles.en`.
 */
function sanitizeTitlesForEnglishUI<T extends { zhHans?: string; zhHant?: string; en?: string } | undefined>(
  titles: T,
  fallbackZh: string,
): T {
  if (!titles) return titles;
  const hasHanEn = !!titles.en && /[\p{Script=Han}]/u.test(titles.en);
  if (titles.en && !hasHanEn) return titles;
  const zhSource = titles.zhHans || titles.zhHant || fallbackZh || '';
  if (!zhSource) return titles;
  if (!/[\p{Script=Han}]/u.test(zhSource) && titles.en) return titles;
  const rom = buildRomanizedFallbackTitle(zhSource);
  if (!rom) return titles;
  return { ...titles, en: rom } as T;
}

/** Default song list: newest (largest listSortPublishedAtMs) first. */
export function compareSongManifestEntriesByReleaseDesc(a: SongManifestEntry, b: SongManifestEntry): number {
  const ma = a.listSortPublishedAtMs ?? 0;
  const mb = b.listSortPublishedAtMs ?? 0;
  if (mb !== ma) return mb - ma;
  const ta = normalizeTextStatic(a.displayTitle || a.title);
  const tb = normalizeTextStatic(b.displayTitle || b.title);
  const c = ta.localeCompare(tb, 'en');
  if (c !== 0) return c;
  return a.id.localeCompare(b.id);
}

export type SongsManifest = {
  version: number;
  generatedAt: string;
  assetBaseUrl: string;
  tracks: SongManifestEntry[];
};

/** Sharded manifest: tiny catalog + N chunk files under `public/` (see build-songs-manifest). */
export type SongsManifestCatalog = {
  version: number;
  kind: 'catalog';
  generatedAt: string;
  assetBaseUrl: string;
  trackTotal: number;
  chunks: { path: string; count: number }[];
};

export type SongsManifestChunkFile = {
  version: number;
  kind: 'chunk';
  chunkIndex: number;
  tracks: SongManifestEntry[];
};

export function isSongsManifestCatalog(raw: unknown): raw is SongsManifestCatalog {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as SongsManifestCatalog).kind === 'catalog' &&
    Array.isArray((raw as SongsManifestCatalog).chunks)
  );
}

/** Resolve `songs-manifest-chunk-0.json` relative to the catalog URL. */
export function resolveSongsManifestChunkUrl(manifestUrl: string, chunkRelativePath: string): string {
  try {
    return new URL(chunkRelativePath, manifestUrl).href;
  } catch {
    const base = manifestUrl.replace(/[^/]*$/, '');
    return `${base}${chunkRelativePath.replace(/^\//, '')}`;
  }
}

export type ArtistManifestEntry = {
  canonicalArtistId: string;
  displayName: string;
  songCount: number;
  songIds: string[];
  sampleOriginalArtists: string[];
  reviewStatus: ArtistReviewStatus;
  artistImageUrl?: string | null;
  artistImageSource?: string | null;
  artistImageConfidence?: number | null;
  /** From cache / overrides — optional on older manifests */
  artistImageKind?: ArtistImageKind | null;
};

export type ArtistManifest = {
  version: 1;
  generatedAt: string;
  artists: ArtistManifestEntry[];
  needsReview: {
    trackId: string;
    displayTitle: string;
    originalArtist: string;
    canonicalArtistId: string;
    notes: string[];
  }[];
};

export function normalizedArtistsFromCanonicalFields(
  canonicalArtistId: string,
  canonicalArtistDisplayName: string,
  artistReviewStatus: ArtistReviewStatus,
  coCanonicalArtistIds?: string[],
): Track['metadata']['display']['normalizedArtistsInfo'] {
  if (artistReviewStatus !== 'ok') return undefined;
  if (canonicalArtistId === '__unknown__' || canonicalArtistId.startsWith('review/')) return undefined;
  const dict = ARTIST_DICTIONARY[canonicalArtistId];
  const coExtras = (coCanonicalArtistIds ?? [])
    .filter(id => id && id !== canonicalArtistId)
    .map(id => ARTIST_DICTIONARY[id])
    .filter(Boolean) as (typeof ARTIST_DICTIONARY)[string][];
  if (dict) {
    const base = [
      {
        id: dict.id,
        names: { zhHans: dict.names.zhHans, zhHant: dict.names.zhHant, en: dict.names.en },
        type: dict.type,
        nationality: dict.nationality,
      },
    ];
    const coRows = coExtras.map(d => ({
      id: d.id,
      names: { zhHans: d.names.zhHans, zhHant: d.names.zhHant, en: d.names.en },
      type: d.type,
      nationality: d.nationality,
    }));
    return [...base, ...coRows];
  }
  const inferred = inferBrowseClassificationForUnknownArtist(canonicalArtistId, canonicalArtistDisplayName);
  return [
    {
      id: canonicalArtistId,
      names: {
        zhHans: canonicalArtistDisplayName,
        en: canonicalArtistDisplayName,
      },
      type: inferred.type,
      nationality: inferred.nationality,
    },
  ];
}

function normalizedInfoFromManifestEntry(entry: SongManifestEntry): Track['metadata']['display']['normalizedArtistsInfo'] {
  const r = ensureCanonicalOnEntry(entry);
  return normalizedArtistsFromCanonicalFields(
    r.canonicalArtistId,
    r.canonicalArtistDisplayName,
    r.artistReviewStatus,
    r.coCanonicalArtistIds,
  );
}

export function ensureCanonicalOnEntry(entry: SongManifestEntry): Required<
  Pick<SongManifestEntry, 'canonicalArtistId' | 'canonicalArtistDisplayName' | 'artistReviewStatus'>
> &
  SongManifestEntry {
  /**
   * Always re-run resolution from seed + video title. Manifest JSON may contain stale canonical
   * fields from an older build; preview/dev must reflect current `resolveCanonicalArtist` rules
   * without requiring a manual `npm run build:manifest` refresh.
   *
   * **必须与 `trackToManifestEntry` 一致**：再合并 `catalog-overrides-locked`（canonical / co /
   * display / review / workProjectKey），否则运行时 Track 会丢 locked 多艺人或项目归属。
   */
  const resolution = resolveCanonicalArtist({
    rawArtist: entry.originalArtist || '',
    displayTitle: entry.displayTitle || entry.title || '',
    trackId: entry.id,
    slug: entry.slug,
    tags: entry.tags || [],
    videoTitleHint: entry.youtubeVideoTitle || null,
  });
  const cov = getMergedCatalogOverride(entry.slug, entry.id);
  let merged = resolution;
  if (
    cov &&
    (cov.canonicalArtistId ||
      cov.coCanonicalArtistIds ||
      cov.canonicalArtistDisplayName != null ||
      cov.artistReviewStatus != null)
  ) {
    merged = ensureBlackpinkCoBucket({
      ...resolution,
      canonicalArtistId: cov.canonicalArtistId ?? resolution.canonicalArtistId,
      coCanonicalArtistIds: cov.coCanonicalArtistIds ?? resolution.coCanonicalArtistIds,
      canonicalArtistDisplayName: cov.canonicalArtistDisplayName ?? resolution.canonicalArtistDisplayName,
      artistReviewStatus: cov.artistReviewStatus ?? resolution.artistReviewStatus,
      notes: [...resolution.notes, 'catalog_override_canonical'],
    });
  }

  const workProjectKey =
    cov?.workProjectKey ??
    entry.workProjectKey ??
    (entry.slug ? MANIFEST_WORK_PROJECT_KEY_BY_SLUG[entry.slug] : undefined) ??
    inferWorkProjectKeyFromText(
      [entry.originalArtist, entry.displayTitle || entry.title, entry.youtubeVideoTitle].filter(Boolean).join(' '),
    );

  return {
    ...entry,
    canonicalArtistId: merged.canonicalArtistId,
    canonicalArtistDisplayName: merged.canonicalArtistDisplayName,
    artistReviewStatus: merged.artistReviewStatus,
    artistResolutionNotes: merged.notes.length ? merged.notes : entry.artistResolutionNotes,
    coCanonicalArtistIds: merged.coCanonicalArtistIds ?? entry.coCanonicalArtistIds,
    workProjectKey,
  };
}

/** Apply canonical artist resolution to any track (e.g. Supabase rows). */
export function mergeCanonicalIntoTrack(track: Track): Track {
  const base = applyCatalogOverridesToTrack(track);
  const rawDisplayTitle =
    base.metadata.display.displayTitle || base.sourceSongTitle || base.title;
  const displayTitle = cleanDisplayTitle(rawDisplayTitle);
  const rawArtist = base.sourceArtist || base.artist || '';
  const videoHint = (base as { _cipMatchedVideoTitle?: string })._cipMatchedVideoTitle || null;
  const cov = getMergedCatalogOverride(base.metadata?.identity?.slug, base.id);
  let resolution = resolveCanonicalArtist({
    rawArtist,
    displayTitle,
    trackId: base.id,
    slug: base.metadata.identity.slug,
    tags: base.tags || base.metadata.display.categories?.tags || [],
    videoTitleHint: videoHint,
  });
  if (
    cov &&
    (cov.canonicalArtistId ||
      cov.coCanonicalArtistIds ||
      cov.canonicalArtistDisplayName != null ||
      cov.artistReviewStatus != null)
  ) {
    resolution = ensureBlackpinkCoBucket({
      ...resolution,
      canonicalArtistId: cov.canonicalArtistId ?? resolution.canonicalArtistId,
      coCanonicalArtistIds: cov.coCanonicalArtistIds ?? resolution.coCanonicalArtistIds,
      canonicalArtistDisplayName: cov.canonicalArtistDisplayName ?? resolution.canonicalArtistDisplayName,
      artistReviewStatus: cov.artistReviewStatus ?? resolution.artistReviewStatus,
      notes: [...resolution.notes, 'catalog_override_canonical'],
    });
  }
  const displayArtist = resolution.canonicalArtistDisplayName || rawArtist;
  const existingContextTags = (base.tags || base.metadata.display.categories?.tags || [])
    .filter(t => CONTEXT_CATEGORY_TAGS.has(t));
  const { primaryCategory } = computeCategoryFromArtist(
    resolution.canonicalArtistId,
    resolution.artistReviewStatus,
    existingContextTags,
  );
  return {
    ...base,
    title: displayTitle,
    artist: displayArtist,
    category: primaryCategory,
    canonicalArtistId: resolution.canonicalArtistId,
    coCanonicalArtistIds: resolution.coCanonicalArtistIds,
    metadata: {
      ...base.metadata,
      display: {
        ...base.metadata.display,
        displayTitle,
        artist: displayArtist,
        canonicalArtistId: resolution.canonicalArtistId,
        coCanonicalArtistIds: resolution.coCanonicalArtistIds,
        canonicalArtistDisplayName: resolution.canonicalArtistDisplayName,
        artistReviewStatus: resolution.artistReviewStatus,
        category: primaryCategory,
        categories: {
          ...base.metadata.display.categories,
          primary: primaryCategory,
        },
        normalizedArtistsInfo: normalizedArtistsFromCanonicalFields(
          resolution.canonicalArtistId,
          resolution.canonicalArtistDisplayName,
          resolution.artistReviewStatus,
          resolution.coCanonicalArtistIds,
        ),
      },
    },
  };
}

export function manifestEntryToTrack(entry: SongManifestEntry): Track {
  const e = ensureCanonicalOnEntry(assignManifestListSort(entry));
  const { primaryCategory } = computeCategoryFromArtist(
    e.canonicalArtistId,
    e.artistReviewStatus,
    (e.tags || []).filter(t => CONTEXT_CATEGORY_TAGS.has(t)),
  );
  const categoryPrimary = primaryCategory || e.tags[0] || 'Originals';
  /**
   * Phase C 恢复 Practice 入口：Phase A1 已把 midiUrl / musicXmlUrl 从公开 manifest 移除，
   * 这两个字段在运行时永远是 undefined。Practice 是否可用统一基于 `hasPracticeMode` 标志位，
   * 真正的资源 URL 在打开 Practice 时由 `practice-asset-url` broker 现签现取。
   */
  const practiceEnabled = Boolean(e.hasPracticeMode);
  const durationSeconds =
    typeof e.durationSeconds === 'number' && Number.isFinite(e.durationSeconds) && e.durationSeconds > 0
      ? e.durationSeconds
      : parseDurationMmSsToSeconds(e.duration);
  const displayArtist = e.canonicalArtistDisplayName || e.originalArtist;
  const manifestArtists =
    artistsFromDictionaryIfSoloOk(
      e.canonicalArtistId,
      e.coCanonicalArtistIds,
      e.artistReviewStatus,
      e.canonicalArtistDisplayName,
    ) ?? e.artists;
  const yt =
 e.youtubeVideoUrl && isRealYoutubeWatchUrl(e.youtubeVideoUrl) ? e.youtubeVideoUrl : undefined;
  const sheet = e.sheetUrl && isRealSheetUrl(e.sheetUrl) ? e.sheetUrl : undefined;
  const bili =
    e.bilibiliVideoUrl && isRealBilibiliUrl(e.bilibiliVideoUrl) ? e.bilibiliVideoUrl : undefined;

  return {
    id: e.id,
    title: e.displayTitle || e.title,
    artist: displayArtist,
    category: categoryPrimary,
    tags: e.tags,
    categoryFilterKeys: e.categoryKeys.length ? e.categoryKeys : undefined,
    duration: e.duration,
    audioUrl: e.mp3Url,
    coverUrl: e.coverUrl,
    youtubeUrl: yt,
    bilibiliUrl: bili,
    sheetUrl: sheet,
    midiUrl: e.midiUrl || undefined,
    musicxmlUrl: e.musicXmlUrl || undefined,
    practiceEnabled,
    metadataStatus: 'manual',
    sourceSongTitle: e.displayTitle || e.title,
    sourceArtist: e.originalArtist,
    canonicalArtistId: e.canonicalArtistId,
    coCanonicalArtistIds: e.coCanonicalArtistIds,
    workProjectKey: e.workProjectKey,
    metadataSource: 'manifest',
    metadataConfidence: 1,
    importSource: e.importSource,
    metadata: {
      identity: {
        id: e.id,
        slug: e.slug,
        importSource: e.importSource,
      },
      display: {
        title: e.title,
        displayTitle: e.displayTitle,
        titles: e.titles,
        artist: displayArtist,
        artists: manifestArtists,
        normalizedArtistsInfo: normalizedInfoFromManifestEntry(e),
        canonicalArtistId: e.canonicalArtistId,
        coCanonicalArtistIds: e.coCanonicalArtistIds,
        canonicalArtistDisplayName: e.canonicalArtistDisplayName,
        artistReviewStatus: e.artistReviewStatus,
        workProjectKey: e.workProjectKey,
        category: categoryPrimary,
        categories: {
          primary: categoryPrimary,
          tags: e.tags,
        },
        cover: e.coverUrl,
      },
      assets: {
        audioUrl: e.mp3Url,
        midiUrl: e.midiUrl || undefined,
        musicxmlUrl: e.musicXmlUrl || undefined,
        hasPracticeAssets: practiceEnabled,
        practiceEnabled,
        duration: durationSeconds ?? null,
        durationLabel: e.duration,
      },
      links: {
        youtube: yt,
        video: yt,
        sheet: sheet,
        bilibili: bili,
      },
      enrichment: {
        status: 'auto',
        mappedTags: e.tags,
        linkStatus: e.linkStatus,
        youtubeSortIndex: e.youtubeSortIndex ?? undefined,
        youtubePublishedAt: e.youtubePublishedAt ?? undefined,
        listSortPublishedAtMs: e.listSortPublishedAtMs ?? undefined,
        listSortPublishedAt: e.listSortPublishedAt ?? undefined,
        listSortSource: e.listSortSource ?? undefined,
      },
    },
  };
}

/** When building manifest from full Track objects (build script). */
export function trackToManifestEntry(track: Track, assetBaseUrl: string): SongManifestEntry {
  /** 1) 人工锁定层（最高优先级）— 再进入 canonical / 分类合并 */
  const locked = applyCatalogOverridesToTrack(track);
  const cov = getCatalogOverrideForTrack(locked);

  const rel = (u: string) => (assetBaseUrl && u.startsWith('/') ? `${assetBaseUrl.replace(/\/$/, '')}${u}` : u);
  const originalArtist = locked.sourceArtist || locked.artist;
  const rawDisplayTitle = locked.metadata.display.displayTitle || locked.metadata.display.title || locked.title;
  const displayTitle = cleanDisplayTitle(rawDisplayTitle);

  const rawYtUrl = locked.metadata.links?.youtube || locked.youtubeUrl || null;
  const ytTitle = (locked as { _cipMatchedVideoTitle?: string })._cipMatchedVideoTitle || null;

  let resolution = resolveCanonicalArtist({
    rawArtist: originalArtist,
    displayTitle,
    trackId: locked.id,
    slug: locked.metadata.identity.slug,
    tags: locked.tags || locked.metadata.display.categories?.tags || [],
    videoTitleHint: ytTitle,
  });

  if (
    cov &&
    (cov.canonicalArtistId ||
      cov.coCanonicalArtistIds ||
      cov.canonicalArtistDisplayName != null ||
      cov.artistReviewStatus != null)
  ) {
    resolution = ensureBlackpinkCoBucket({
      ...resolution,
      canonicalArtistId: cov.canonicalArtistId ?? resolution.canonicalArtistId,
      coCanonicalArtistIds: cov.coCanonicalArtistIds ?? resolution.coCanonicalArtistIds,
      canonicalArtistDisplayName: cov.canonicalArtistDisplayName ?? resolution.canonicalArtistDisplayName,
      artistReviewStatus: cov.artistReviewStatus ?? resolution.artistReviewStatus,
      notes: [...resolution.notes, 'catalog_override_canonical'],
    });
  }

  const seedTags = locked.tags || locked.metadata.display.categories?.tags || [];
  const existingContextTags = seedTags.filter(t => CONTEXT_CATEGORY_TAGS.has(t));
  const { primaryCategory, categoryKey, tags: computedTags } = computeCategoryFromArtist(
    resolution.canonicalArtistId,
    resolution.artistReviewStatus,
    existingContextTags,
  );

  const workProjectKeyForCategories =
    locked.workProjectKey ??
    locked.metadata.display.workProjectKey ??
    (locked.metadata.identity.slug
      ? MANIFEST_WORK_PROJECT_KEY_BY_SLUG[locked.metadata.identity.slug]
      : undefined) ??
    inferWorkProjectKeyFromText([originalArtist, displayTitle, ytTitle].filter(Boolean).join(' '));

  const merged = mergeTrackCategoryLabels({
    primaryLanguageLabel: primaryCategory,
    languageCategoryKey: categoryKey,
    seedTags,
    computedTagsFromArtist: computedTags,
    canonicalArtistId: resolution.canonicalArtistId,
    displayTitle,
    originalArtist,
    youtubeVideoTitle: ytTitle,
    slug: locked.metadata.identity.slug,
    workProjectKey: workProjectKeyForCategories,
    artistReviewStatus: resolution.artistReviewStatus,
  });
  const finalTags = merged.displayTags;
  const categoryKeys = merged.filterKeys;

  const ytVideoId = rawYtUrl ? extractVideoId(rawYtUrl) : null;
  const ytUrl = ytVideoId ? rawYtUrl : null;
  const rawBili = locked.metadata.links?.bilibili || locked.bilibiliUrl || null;
  const biliUrl = rawBili && isRealBilibiliUrl(rawBili) ? rawBili : null;
  const rawSheetLink = locked.metadata.links?.sheet || locked.sheetUrl || null;
  const sheetLink = rawSheetLink && !rawSheetLink.includes('keyword=') ? rawSheetLink : null;

  const cipLinkConfidence = (locked as { _cipLinkConfidence?: string })._cipLinkConfidence;
  const intentionalNoSheet = Boolean(locked.metadata.links?.noSheet);

  let linkStatus: LinkStatus;
  if (cipLinkConfidence === 'suspect' && ytVideoId) {
    linkStatus = 'needsReview';
  } else if (!ytVideoId && !biliUrl) {
    linkStatus = 'missingVideo';
  } else if (!sheetLink && !intentionalNoSheet) {
    linkStatus = 'missingSheet';
  } else {
    linkStatus = 'linked';
  }

  const assetDur = locked.metadata.assets?.duration;
  const durationSeconds =
    typeof assetDur === 'number' && Number.isFinite(assetDur) && assetDur > 0
      ? assetDur
      : parseDurationMmSsToSeconds(locked.duration);

  return {
    id: locked.id,
    title: locked.metadata.display.title,
    displayTitle,
    originalArtist,
    canonicalArtistId: resolution.canonicalArtistId,
    coCanonicalArtistIds: resolution.coCanonicalArtistIds,
    canonicalArtistDisplayName: resolution.canonicalArtistDisplayName,
    artistReviewStatus: resolution.artistReviewStatus,
    artistResolutionNotes: resolution.notes.length ? resolution.notes : undefined,
    tags: finalTags,
    categoryKeys,
    coverUrl: locked.coverUrl,
    mp3Url: rel(locked.audioUrl),
    midiUrl: locked.midiUrl ? rel(locked.midiUrl) : null,
    musicXmlUrl: locked.musicxmlUrl ? rel(locked.musicxmlUrl) : null,
    duration: locked.duration,
    durationSeconds: durationSeconds ?? null,
    hasPracticeMode: Boolean(locked.practiceEnabled),
    importSource: locked.importSource || 'local',
    slug: locked.metadata.identity.slug,
    youtubeVideoUrl: ytUrl,
    youtubeVideoTitle: ytTitle,
    youtubeVideoId: ytVideoId,
    bilibiliVideoUrl: biliUrl,
    sheetUrl: sheetLink,
    linkStatus,
    titles: sanitizeTitlesForEnglishUI(locked.metadata.display.titles, locked.title),
    artists:
      artistsFromDictionaryIfSoloOk(
        resolution.canonicalArtistId,
        resolution.coCanonicalArtistIds,
        resolution.artistReviewStatus,
        resolution.canonicalArtistDisplayName,
      ) ?? locked.metadata.display.artists,
    workProjectKey:
      locked.workProjectKey ??
      locked.metadata.display.workProjectKey ??
      (locked.metadata.identity.slug
        ? MANIFEST_WORK_PROJECT_KEY_BY_SLUG[locked.metadata.identity.slug]
        : undefined) ??
      inferWorkProjectKeyFromText(
        [originalArtist, displayTitle, ytTitle].filter(Boolean).join(' '),
      ),
    supabaseCreatedAt:
      (locked.metadata.enrichment as { supabaseCreatedAt?: string | null } | undefined)
        ?.supabaseCreatedAt ?? null,
  };
}

function extractVideoId(url: string): string | null {
  const m =
    url.match(/[?&]v=([a-zA-Z0-9_-]{11})/) ||
    url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) ||
    url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i);
  return m?.[1] || null;
}

export function buildArtistManifestFromSongs(entries: SongManifestEntry[], generatedAt: string): ArtistManifest {
  const full = entries.map(ensureCanonicalOnEntry);
  const byId = new Map<string, { songIds: string[]; samples: Set<string>; review: ArtistReviewStatus }>();

  for (const e of full) {
    const bucketIds = workProjectAugmentedArtistBucketIds(
      e.canonicalArtistId,
      e.coCanonicalArtistIds,
      e.workProjectKey,
    );
    for (const aid of bucketIds) {
      const cur = byId.get(aid) ?? {
        songIds: [] as string[],
        samples: new Set<string>(),
        review: e.artistReviewStatus ?? 'ok',
      };
      if (!cur.songIds.includes(e.id)) cur.songIds.push(e.id);
      cur.samples.add(e.originalArtist);
      if (e.artistReviewStatus === 'needsReview') cur.review = 'needsReview';
      else if (e.artistReviewStatus === 'unknown' && cur.review === 'ok') cur.review = 'unknown';
      byId.set(aid, cur);
    }
  }

  const artists: ArtistManifestEntry[] = Array.from(byId.entries()).map(([canonicalArtistId, v]) => ({
    canonicalArtistId,
    displayName:
      ARTIST_DICTIONARY[canonicalArtistId]?.names.zhHans ||
      ARTIST_DICTIONARY[canonicalArtistId]?.names.en ||
      full.find(en => en.canonicalArtistId === canonicalArtistId)?.canonicalArtistDisplayName ||
      canonicalArtistId,
    songCount: v.songIds.length,
    songIds: v.songIds,
    sampleOriginalArtists: Array.from(v.samples).slice(0, 5),
    reviewStatus: v.review,
    artistImageUrl: null,
    artistImageSource: null,
    artistImageConfidence: null,
  }));

  artists.sort((a, b) => {
    if (b.songCount !== a.songCount) return b.songCount - a.songCount;
    return a.displayName.localeCompare(b.displayName, 'en');
  });

  const needsReview = full
    .filter(e => e.artistReviewStatus === 'needsReview')
    .map(e => ({
      trackId: e.id,
      displayTitle: e.displayTitle || e.title,
      originalArtist: e.originalArtist,
      canonicalArtistId: e.canonicalArtistId,
      notes: e.artistResolutionNotes ?? [],
    }));

  return { version: 1, generatedAt, artists, needsReview };
}
