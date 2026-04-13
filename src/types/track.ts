/**
 * Core track types shared by manifest, App, and Practice.
 */

export type MetadataCandidate = {
  title: string;
  artist: string;
  coverUrl: string;
  album?: string;
  releaseYear?: string;
  category?: string;
  source: string;
  confidence: number;
};

export type TrackMetadata = {
  identity: {
    id: string;
    slug?: string;
    importSource: 'local' | 'remote';
  };
  display: {
    title: string;
    displayTitle?: string;
    titles?: {
      zhHans?: string;
      zhHant?: string;
      en?: string;
    };
    artist?: string;
    artists?: {
      zhHans?: string;
      zhHant?: string;
      en?: string;
    };
    normalizedArtistsInfo?: {
      id: string;
      names: { zhHans: string; zhHant?: string; en: string };
      type: string;
      nationality: string;
    }[];
    /**
     * 作品级来源（电影/游戏/剧集/franchise），稳定 slug；与 artist、category 不同维。
     * 例：`kpop-demon-hunters`、`genshin-impact`。
     */
    workProjectKey?: string;
    /** Canonical aggregation id from manifest / resolution pipeline */
    canonicalArtistId?: string;
    /** When set, track also appears under these artist buckets (duets). */
    coCanonicalArtistIds?: string[];
    canonicalArtistDisplayName?: string;
    artistReviewStatus?: 'ok' | 'needsReview' | 'unknown';
    category?: string;
    categories?: {
      primary: string;
      tags?: string[];
    };
    cover?: string;
  };
  assets: {
    audioUrl: string;
    midiUrl?: string;
    musicxmlUrl?: string;
    hasPracticeAssets?: boolean;
    practiceEnabled?: boolean;
    duration?: number | null;
    durationLabel?: string;
  };
  links: {
    youtube?: string;
    video?: string;
    sheet?: string;
    bilibili?: string;
    /** When true: no published sheet URL by design; do not count as missingSheet if video exists. */
    noSheet?: boolean;
  };
  enrichment?: {
    status?: 'seed' | 'manual' | 'auto';
    titleSource?: 'slug' | 'manual' | 'auto';
    artistSource?: 'manual' | 'auto';
    categorySource?: 'manual' | 'auto';
    coverSource?: 'manual' | 'auto';
    linksSource?: 'manual' | 'auto';
    rawCategory?: string;
    mappedCategory?: string;
    mappedTags?: string[];
    /** From songs-manifest: CIP video + sheet pipeline status */
    linkStatus?: 'linked' | 'missingVideo' | 'missingSheet' | 'needsReview';
    /**
     * From build-time YouTube channel scrape (yt-dlp): smaller = newer on channel /videos tab.
     */
    youtubeSortIndex?: number | null;
    /** ISO 8601 upload date when available from yt-dlp */
    youtubePublishedAt?: string | null;
    /**
     * Build-time: monotonic ms for “newest first” list order (desc). Higher = newer.
     * Source priority: real YouTube upload date → channel index → stable fallback.
     */
    listSortPublishedAtMs?: number | null;
    /** ISO 8601 aligned with listSortPublishedAtMs (for display/debug; not always a true release date). */
    listSortPublishedAt?: string | null;
    listSortSource?: 'youtube_published' | 'youtube_channel_index' | 'fallback_no_youtube_order';
  };
};

export type Track = {
  id: string;
  title: string;
  artist: string;
  category: string;
  tags?: string[];
  /** Precomputed filter keys (from manifest); avoids runtime category normalization on list pages */
  categoryFilterKeys?: string[];
  duration: string;
  audioUrl: string;
  coverUrl: string;
  youtubeUrl?: string;
  bilibiliUrl?: string;
  sheetUrl?: string;
  midiUrl?: string;
  musicxmlUrl?: string;
  practiceEnabled?: boolean;
  metadataStatus?: 'pending' | 'needs_review' | 'approved' | 'manual';
  sourceSongTitle?: string;
  sourceArtist?: string;
  sourceCoverUrl?: string;
  sourceAlbum?: string;
  sourceReleaseYear?: string;
  sourceCategory?: string;
  sourceGenre?: string;
  metadataSource?: string;
  metadataConfidence?: number;
  metadataCandidates?: MetadataCandidate[];
  importSource?: 'local' | 'remote';
  /** Same as metadata.display.canonicalArtistId; convenient for filters */
  canonicalArtistId?: string;
  /** Duets: additional artist buckets this track is listed under */
  coCanonicalArtistIds?: string[];
  /** 与 metadata.display.workProjectKey 同步；便于快速读取 */
  workProjectKey?: string;
  metadata: TrackMetadata;
};
