import React, { memo, useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { Search, ChevronLeft, ChevronDown } from 'lucide-react';
import { FixedSizeList, FixedSizeGrid, type ListChildComponentProps } from 'react-window';
import type { Track } from './types/track';
import {
  normalizeTextStatic,
  normalizeSearchStatic,
  getTrackCategoryKeysStatic,
  getTrackPrimaryCategoryKeyStatic,
  getCoverThumbnailUrl,
  DISPLAY_TAG_EN_BY_ZH,
  normalizeCategoryKeyStatic,
} from './category-keys';
import { getDisplayTrackTitle, getDisplayTrackArtist } from './track-display';
import { shouldShowArtistOnArtistPage, workProjectAugmentedArtistBucketIds } from './artist-browse-filter';
import { getWorkProjectKey } from './work-project';
import { dictionaryCanonicalId } from './artist-canonical';
import { ARTIST_DICTIONARY } from './local-import-artist-normalization';
import { getTrackListDurationLabel } from './duration-utils';
import type { ArtistImageKind } from './artist-image-kind';
import type { MusicPlaybackContext } from './music-playback-context';

const MUSIC_ALL_CATEGORY = 'all';
const SEARCH_DEBOUNCE_MS = 240;

/** 音乐页浏览区：静态磨砂（无 backdrop-filter，性能优先） */
const MUSIC_BROWSE_PANEL =
  'glass-panel-static !rounded-2xl mb-6 px-4 py-3.5 sm:px-5 sm:py-4';
const MUSIC_SEARCH_INPUT =
  'h-9 w-full min-w-0 rounded-xl border border-white/18 bg-white/[0.08] pl-9 pr-3 text-sm text-[var(--color-mist-text)] placeholder:text-[var(--color-mist-text)]/38 shadow-[inset_0_1px_2px_rgba(255,255,255,0.35)] focus:outline-none focus:border-amber-200/45 focus:bg-white/14 focus:ring-1 focus:ring-amber-200/35';
const MUSIC_SORT_TRIGGER =
  'relative flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-white/16 bg-white/[0.08] px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-mist-text)]/88 hover:bg-white/14 transition-colors';
/** 歌曲列表与艺人网格分页：每页条数（播放器上一首/下一首/连播仅在此范围内） */
const MUSIC_PAGE_SIZE = 20;
/** FixedSizeGrid 行高：略大于内容块，配合单元格内 flex 垂直居中后上下留白接近 */
const ARTIST_GRID_ROW_HEIGHT = 252;
const ARTIST_GRID_GAP_Y = 16;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Main songs list: newest first using build-time `listSortPublishedAtMs` from manifest;
 * legacy fallback uses YouTube fields then title.
 */
function compareMainSongListOrder(a: Track, b: Track): number {
  const ma = a.metadata.enrichment?.listSortPublishedAtMs;
  const mb = b.metadata.enrichment?.listSortPublishedAtMs;
  if (typeof ma === 'number' && typeof mb === 'number' && Number.isFinite(ma) && Number.isFinite(mb)) {
    if (mb !== ma) return mb - ma;
    return (
      normalizeTextStatic(a?.title).localeCompare(normalizeTextStatic(b?.title), 'en') || a.id.localeCompare(b.id)
    );
  }
  if (typeof ma === 'number' && Number.isFinite(ma) && (typeof mb !== 'number' || !Number.isFinite(mb))) return -1;
  if (typeof mb === 'number' && Number.isFinite(mb) && (typeof ma !== 'number' || !Number.isFinite(ma))) return 1;

  const enr = (t: Track) => t.metadata.enrichment;
  const ia = enr(a)?.youtubeSortIndex;
  const ib = enr(b)?.youtubeSortIndex;
  const hasIa = ia != null && Number.isFinite(Number(ia));
  const hasIb = ib != null && Number.isFinite(Number(ib));
  if (hasIa && hasIb && Number(ia) !== Number(ib)) return Number(ia) - Number(ib);
  if (hasIa && !hasIb) return -1;
  if (!hasIa && hasIb) return 1;
  const pa = enr(a)?.youtubePublishedAt;
  const pb = enr(b)?.youtubePublishedAt;
  const da = pa ? Date.parse(String(pa)) : NaN;
  const db = pb ? Date.parse(String(pb)) : NaN;
  const hasDa = Number.isFinite(da);
  const hasDb = Number.isFinite(db);
  if (hasDa && hasDb && da !== db) return db - da;
  if (hasDa && !hasDb) return -1;
  if (!hasDa && hasDb) return 1;
  return (
    normalizeTextStatic(a?.title).localeCompare(normalizeTextStatic(b?.title), 'en') || a.id.localeCompare(b.id)
  );
}

const parseDurationToSecondsStatic = (value: unknown) => {
  const [minsRaw, secsRaw] = normalizeTextStatic(value).split(':');
  const mins = Number.parseInt(minsRaw ?? '', 10);
  const secs = Number.parseInt(secsRaw ?? '', 10);
  return (Number.isFinite(mins) ? mins : 0) * 60 + (Number.isFinite(secs) ? secs : 0);
};

const SONG_ROW_HEIGHT = 76;

/** 易混歌名/俗称，拼进标题检索（正式 `title` 不变）。key = metadata.identity.slug */
const EXTRA_TRACK_TITLE_SEARCH_BY_SLUG: Record<string, string> = {
  'dancing-alone': 'Dancing Along',
};

function trackTitleSearchNormalized(track: Track): string {
  const base = track?.title ?? '';
  const slug = track?.metadata?.identity?.slug;
  const extra = slug ? EXTRA_TRACK_TITLE_SEARCH_BY_SLUG[slug] : '';
  return normalizeSearchStatic([base, extra].filter(Boolean).join(' '));
}

/**
 * Artist grid tabs: 「其他」only shows project/IP buckets + unknown rows needing review;
 * project rows do not appear under 华语/欧美/韩/日.
 */
function artistMatchesArtistCategoryFilter(a: ArtistCard, selectedArtistCategory: string): boolean {
  if (selectedArtistCategory === 'all') return true;
  const { type, region } = a;
  if (type === 'project') {
    return selectedArtistCategory === 'other';
  }
  if (selectedArtistCategory === 'other') {
    return type === 'project' || (region === 'other' && type === 'unknown');
  }
  if (selectedArtistCategory === 'group') return type === 'group';
  if (selectedArtistCategory === 'solo') return type === 'solo';
  if (selectedArtistCategory === 'zh') return region === 'zh';
  if (selectedArtistCategory === 'kr') return region === 'kr';
  if (selectedArtistCategory === 'jp') return region === 'jp';
  if (selectedArtistCategory === 'en') return region === 'en';
  return false;
}

/** Prefer ARTIST_DICTIONARY so cards never show YouTube-scraped junk on the artist grid. */
function artistCardLabelsForBucket(
  cid: string,
  infos: Track['metadata']['display']['normalizedArtistsInfo'] | undefined,
  trk: Track,
  primary: string,
  currentLang: string,
): { displayName: string; searchHaystack: string; name: string } {
  const dictRow = ARTIST_DICTIONARY[dictionaryCanonicalId(cid)];
  if (dictRow) {
    const labelEn = dictRow.names.en;
    const labelZh = dictRow.names.zhHans;
    const labelHant = dictRow.names.zhHant;
    const displayName =
      currentLang === '简体中文'
        ? labelZh || labelEn
        : currentLang === '繁體中文'
          ? labelHant || labelZh || labelEn
          : labelEn || labelZh;
    const searchHaystack = [labelZh, labelHant, labelEn].filter(Boolean).join(' ');
    return { displayName, searchHaystack, name: displayName };
  }
  const rowForName = infos?.find(r => r.id === cid);
  const cname =
    rowForName?.names?.zhHans ||
    rowForName?.names?.en ||
    (cid === primary
      ? trk.metadata.display.canonicalArtistDisplayName || trk.metadata.display.artist || trk.artist
      : undefined) ||
    trk.metadata.display.canonicalArtistDisplayName ||
    trk.metadata.display.artist ||
    trk.artist ||
    'Unknown';
  const labelEn = rowForName?.names?.en || infos?.[0]?.names?.en || cname;
  const labelZh = rowForName?.names?.zhHans || infos?.[0]?.names?.zhHans || cname;
  const labelHant = rowForName?.names?.zhHant || infos?.[0]?.names?.zhHant;
  const displayName =
    currentLang === '简体中文'
      ? labelZh || labelEn
      : currentLang === '繁體中文'
        ? labelHant || labelZh || labelEn
        : labelEn || labelZh;
  const searchHaystack = [labelZh, labelHant, labelEn, cname].filter(Boolean).join(' ');
  return { displayName, searchHaystack, name: displayName };
}

/** 与 normalizeCategoryKeyStatic 对齐的英文行展示（避免「韩流流行」与「K-POP」重复成两个 badge） */
const CATEGORY_EN_BY_FILTER_KEY: Record<string, string> = {
  cpop: 'C-pop',
  kpop: 'K-pop',
  jpop: 'J-pop',
  western: 'Western',
  film: 'Film',
  anime: 'Anime',
  game: 'Game',
  instrumental: 'Instrumental',
};

function formatTrackCategoryBadges(
  track: Track,
  songCategoryLabelMap: Map<string, string>,
  currentLang: string,
): string {
  const multi = track.metadata?.display?.categories?.tags || track.tags;

  const displayOneTag = (raw: string): string => {
    const t = typeof raw === 'string' ? raw.trim() : '';
    if (!t) return '';
    const key = normalizeCategoryKeyStatic(t);

    if (key === 'kpop') {
      if (currentLang === 'English') return 'K-pop';
      if (currentLang === '繁體中文') return '韓流流行';
      return '韩流流行';
    }
    if (currentLang === 'English') {
      return CATEGORY_EN_BY_FILTER_KEY[key] ?? DISPLAY_TAG_EN_BY_ZH[t] ?? t;
    }
    if (currentLang === '繁體中文') {
      if (key === 'cpop') return '華語流行';
      if (key === 'jpop') return '日系流行';
      if (key === 'western') return '歐美流行';
      if (key === 'film') return '影視';
      if (key === 'anime') return '動漫';
      if (key === 'game') return '遊戲';
      if (key === 'instrumental') return '純音樂';
    }
    return t;
  };

  if (Array.isArray(multi) && multi.length > 0) {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const raw of multi.slice(0, 8)) {
      const t = typeof raw === 'string' ? raw.trim() : '';
      if (!t) continue;
      const dedupeKey = normalizeCategoryKeyStatic(t) || t;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const label = displayOneTag(t);
      if (label) labels.push(label);
    }
    if (labels.length > 0) return labels.join(' · ');
  }
  const pk = getTrackPrimaryCategoryKeyStatic(track);
  return songCategoryLabelMap.get(pk) || 'Uncategorized';
}

type ArtistCard = {
  id: string;
  /** Latin / primary token (often EN); used for avatar fallback initials. */
  name: string;
  displayName: string;
  /** zh + en + name — artist search should match 周杰伦 OR Jay Chou. */
  searchHaystack: string;
  songCount: number;
  coverUrl: string;
  region: string;
  type: string;
  reviewStatus?: string;
};

type TrackSearchRow = {
  track: Track;
  titleN: string;
  artistN: string;
  catKeys: string[];
  /** Primary + co-artists (duets); use for artist detail filter. */
  artistIds: string[];
};

type SongListRowData = {
  tracks: Track[];
  /** 当前页在全局筛选结果中的起始序号（用于 # 列） */
  rowIndexOffset: number;
  currentTrackId: string;
  isPlaying: boolean;
  onSelectTrack: (t: Track, autoplay?: boolean) => void;
  currentLang: string;
  songCategoryLabelMap: Map<string, string>;
};

type ArtistGridCellData = {
  artists: ArtistCard[];
  columnCount: number;
  artistImageMap: Record<string, string>;
  artistImageKindMap: Record<string, ArtistImageKind | undefined>;
  currentLang: string;
  t: any;
  onPickArtist: (id: string) => void;
};

function artistAvatarRingClass(kind: ArtistImageKind | undefined): string {
  if (kind === 'project_logo' || kind === 'key_art') {
    return ' ring-2 ring-amber-500/25';
  }
  return '';
}

/** manifest 的 canonicalArtistId 与词典 id 对齐后再查图，避免键不一致导致整页无头像 */
function resolveArtistImageUrlFromMaps(
  artistId: string,
  artistImageMap: Record<string, string>,
  coverUrlFallback: string,
): string {
  const key = dictionaryCanonicalId(artistId);
  return artistImageMap[key] || artistImageMap[artistId] || coverUrlFallback;
}

function MusicPaginationBar({
  page,
  totalPages,
  onPrev,
  onNext,
  onPageJump,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  onPageJump?: (page: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleCommit = () => {
    setIsEditing(false);
    if (!inputValue.trim()) return;
    const num = parseInt(inputValue, 10);
    if (isNaN(num)) return;
    let target = num;
    if (target < 1) target = 1;
    if (target > totalPages) target = totalPages;
    if (target !== page && onPageJump) {
      onPageJump(target);
    }
  };

  const pageBtn =
    'rounded-xl border border-white/18 bg-white/15 px-5 py-2 text-sm font-semibold text-[var(--color-mist-text)] shadow-[0_0_14px_rgba(253,224,180,0.18)] transition-colors hover:bg-white/24 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:bg-white/15';
  
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6 border-t border-white/10 bg-white/[0.04] px-4 py-3">
      <button type="button" disabled={page <= 1} onClick={onPrev} className={pageBtn}>
        Previous
      </button>
      
      <div className="flex items-center gap-2 font-mono text-sm text-[var(--color-mist-text)]/75">
        <span>Page</span>
        {isEditing ? (
          <div className="relative flex items-center">
            <span className="text-[var(--color-mist-text)]/50 mr-1">[</span>
            <input
              ref={inputRef}
              type="text"
              className="w-10 bg-transparent text-center text-[var(--color-mist-text)] outline-none tabular-nums"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value.replace(/\D/g, ''))}
              onBlur={handleCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommit();
                else if (e.key === 'Escape') setIsEditing(false);
              }}
            />
            <span className="text-[var(--color-mist-text)]/50 ml-1">]</span>
          </div>
        ) : (
          <button
            type="button"
            className="tabular-nums hover:text-[var(--color-mist-text)] hover:underline underline-offset-2 transition-colors cursor-pointer outline-none px-1"
            onClick={() => {
              setInputValue(String(page));
              setIsEditing(true);
            }}
          >
            {page}
          </button>
        )}
        <span>/ {totalPages}</span>
      </div>

      <button type="button" disabled={page >= totalPages} onClick={onNext} className={pageBtn}>
        Next
      </button>
    </div>
  );
}

const SongRow = memo(function SongRow({ index, style, data }: ListChildComponentProps<SongListRowData>) {
  const { tracks, rowIndexOffset, currentTrackId, isPlaying, onSelectTrack, currentLang, songCategoryLabelMap } = data;
  const track = tracks[index];
  const isActive = currentTrackId === track.id;
  const coverUrl = getCoverThumbnailUrl(
    (track.metadataStatus === 'approved' && track.sourceCoverUrl) ? track.sourceCoverUrl : track.coverUrl,
  );
  return (
    <div style={style}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectTrack(track, true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectTrack(track, true);
          }
        }}
        className={`music-list-row grid grid-cols-12 gap-4 px-8 py-4 items-center cursor-pointer transition-colors border-b border-white/10 hover:bg-white/10 ${isActive ? 'bg-white/20' : ''}`}
      >
        <div className="col-span-1 text-center text-[var(--color-mist-text)]/50">
          {isActive && isPlaying ? (
            <div className="flex items-center justify-center gap-1 h-4">
              <div className="w-1 h-3 bg-[var(--color-mist-text)]/40 rounded-sm animate-pulse" />
              <div className="w-1 h-4 bg-[var(--color-mist-text)]/40 rounded-sm animate-pulse delay-75" />
              <div className="w-1 h-2 bg-[var(--color-mist-text)]/40 rounded-sm animate-pulse delay-150" />
            </div>
          ) : (
            rowIndexOffset + index + 1
          )}
        </div>
        <div className="col-span-6 flex items-center gap-4 min-h-[44px]">
          <img src={coverUrl} alt="" loading="lazy" decoding="async" className="w-10 h-10 rounded-md object-cover shadow-sm shrink-0" referrerPolicy="no-referrer" />
          <div className="flex flex-col overflow-hidden min-w-0">
            <span
              className={`font-medium truncate ${isActive ? 'text-[var(--color-mist-text)] underline decoration-amber-600/30 underline-offset-4' : 'text-[var(--color-mist-text)]'}`}
            >
              {getDisplayTrackTitle(track, currentLang) || 'Untitled'}
            </span>
            <span className="text-xs text-[var(--color-mist-text)]/60 truncate">{getDisplayTrackArtist(track, currentLang)}</span>
          </div>
        </div>
        <div className="col-span-3 flex items-center">
          <span className="px-3 py-1 rounded-full bg-white/20 text-xs text-[var(--color-mist-text)]/80 border border-white/20">
            {formatTrackCategoryBadges(track, songCategoryLabelMap, currentLang)}
          </span>
        </div>
        <div className="col-span-2 text-right text-[var(--color-mist-text)]/60 text-sm font-mono">
          {getTrackListDurationLabel(track)}
        </div>
      </div>
    </div>
  );
});

const ArtistGridCell = memo(function ArtistGridCell({
  columnIndex,
  rowIndex,
  style,
  data,
}: {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
  data: ArtistGridCellData;
}) {
  const { artists, columnCount, artistImageMap, artistImageKindMap, currentLang, t, onPickArtist } = data;
  const index = rowIndex * columnCount + columnIndex;
  if (index >= artists.length) {
    return <div style={style} className="box-border" />;
  }
  const artist = artists[index];
  const dictKey = dictionaryCanonicalId(artist.id);
  const imgKind = artistImageKindMap[dictKey] ?? artistImageKindMap[artist.id];
  const avatarSrc = resolveArtistImageUrlFromMaps(artist.id, artistImageMap, artist.coverUrl);
  return (
    <div
      style={{
        ...style,
        paddingRight: columnIndex < columnCount - 1 ? 12 : 0,
        paddingLeft: columnIndex > 0 ? 12 : 0,
        paddingBottom: ARTIST_GRID_GAP_Y,
        boxSizing: 'border-box',
      }}
      className="box-border flex items-center justify-center"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => onPickArtist(artist.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPickArtist(artist.id);
          }
        }}
        className="artist-card glass-tile w-full max-w-[220px] shrink-0 rounded-3xl px-4 py-5 cursor-pointer hover:bg-white/14 transition-colors flex flex-col items-center text-center gap-3.5 group"
      >
        <img
          src={avatarSrc}
          alt={artist.name}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          data-artist-image-kind={imgKind ?? ''}
          className={
            'artist-avatar w-32 h-32 rounded-full object-cover object-center shadow-lg group-hover:scale-105 transition-transform duration-300 shrink-0 bg-[var(--color-mist-text)]/10' +
            artistAvatarRingClass(imgKind)
          }
          onError={e => {
            const el = e.currentTarget;
            if (el.dataset.fallbackApplied) return;
            el.dataset.fallbackApplied = '1';
            el.src =
              'https://ui-avatars.com/api/?name=' +
              encodeURIComponent(artist.name) +
              '&background=404040&color=fff&size=200';
          }}
        />
        <div className="flex flex-col gap-1 min-w-0 w-full">
          <span className="font-medium text-base leading-snug text-[var(--color-mist-text)] truncate">{artist.displayName}</span>
          {artist.reviewStatus && artist.reviewStatus !== 'ok' && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700/90">
              {artist.reviewStatus === 'needsReview' ? '待审核' : '未知艺人'}
            </span>
          )}
          <span className="text-xs text-[var(--color-mist-text)]/60 leading-snug">
            {currentLang === 'English'
              ? `${artist.songCount} ${artist.songCount === 1 ? 'song' : 'songs'}`
              : t.music.songCount.replace('{{count}}', String(artist.songCount))}
          </span>
        </div>
      </div>
    </div>
  );
});

type SongListChromeProps = {
  layoutKey: string;
  artistFilter: string | null;
  filteredSongTracks: Track[];
  currentTrackId: string;
  isPlaying: boolean;
  onSelectTrack: (t: Track, autoplay?: boolean) => void;
  currentLang: string;
  songCategoryLabelMap: Map<string, string>;
  t: any;
  artistsMap: Map<string, ArtistCard>;
  artistImageMap: Record<string, string>;
  artistImageKindMap: Record<string, ArtistImageKind | undefined>;
  searchQuery: string;
  setSearchQuery: (s: string) => void;
  sortBy: 'recently_played' | 'a_z' | 'duration';
  setSortBy: (s: 'recently_played' | 'a_z' | 'duration') => void;
  songCategoryOptions: { value: string; label: string }[];
  selectedCategory: string;
  toggleCategory: (cat: string) => void;
  setMusicView: (v: 'artists' | 'songs' | 'artist_detail') => void;
  songPage: number;
  songTotalPages: number;
  onSongPageChange: (page: number) => void;
};

const SongListChrome = memo(function SongListChrome({
  layoutKey,
  artistFilter,
  filteredSongTracks,
  currentTrackId,
  isPlaying,
  onSelectTrack,
  currentLang,
  songCategoryLabelMap,
  t,
  artistsMap,
  artistImageMap,
  artistImageKindMap,
  searchQuery,
  setSearchQuery,
  sortBy,
  setSortBy,
  songCategoryOptions,
  selectedCategory,
  toggleCategory,
  setMusicView,
  songPage,
  songTotalPages,
  onSongPageChange,
}: SongListChromeProps) {
  const rowIndexOffset = (songPage - 1) * MUSIC_PAGE_SIZE;
  const listItemData = useMemo(
    (): SongListRowData => ({
      tracks: filteredSongTracks,
      rowIndexOffset,
      currentTrackId,
      isPlaying,
      onSelectTrack,
      currentLang,
      songCategoryLabelMap,
    }),
    [filteredSongTracks, rowIndexOffset, currentTrackId, isPlaying, onSelectTrack, currentLang, songCategoryLabelMap],
  );

  const listContainerRef = useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = useState(800);
  const [listHeight, setListHeight] = useState(400);

  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0) setListWidth(w);
      if (h > 0) setListHeight(h);
    });
    ro.observe(el);
    setListWidth(el.clientWidth || 800);
    setListHeight(el.clientHeight || 400);
    return () => ro.disconnect();
  }, [layoutKey]);

  return (
    <div className="flex flex-col animate-in fade-in duration-500">
      <div className={`${MUSIC_BROWSE_PANEL} space-y-3`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-3">
          <div
            className={
              artistFilter
                ? 'flex min-w-0 flex-1 flex-wrap items-center gap-3'
                : 'flex shrink-0 flex-wrap items-center gap-3'
            }
          >
            {artistFilter ? (
              <div className="flex min-w-0 items-center gap-3 sm:gap-4 animate-in slide-in-from-left-4 duration-300">
                <button
                  type="button"
                  onClick={() => setMusicView('artists')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-[var(--color-mist-text)] shadow-sm transition-colors hover:bg-white/18 active:scale-95"
                  aria-label={t.common.back}
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                {resolveArtistImageUrlFromMaps(artistFilter, artistImageMap, artistsMap.get(artistFilter)?.coverUrl) && (
                  <img
                    src={resolveArtistImageUrlFromMaps(artistFilter, artistImageMap, artistsMap.get(artistFilter)?.coverUrl)}
                    alt=""
                    referrerPolicy="no-referrer"
                    data-artist-image-kind={artistImageKindMap[dictionaryCanonicalId(artistFilter)] ?? artistImageKindMap[artistFilter] ?? ''}
                    className={
                      'h-9 w-9 shrink-0 rounded-full object-cover object-center ring-1 ring-white/25 bg-[var(--color-mist-text)]/10' +
                      artistAvatarRingClass(
                        artistImageKindMap[dictionaryCanonicalId(artistFilter)] ?? artistImageKindMap[artistFilter],
                      )
                    }
                    onError={e => {
                      const el = e.currentTarget;
                      if (el.dataset.fallbackApplied) return;
                      el.dataset.fallbackApplied = '1';
                      const nm = artistsMap.get(artistFilter)?.name || artistFilter || '?';
                      el.src =
                        'https://ui-avatars.com/api/?name=' + encodeURIComponent(nm) + '&background=404040&color=fff&size=128';
                    }}
                  />
                )}
                <span className="truncate text-lg font-semibold tracking-tight text-[var(--color-mist-text)]">
                  {artistsMap.get(artistFilter)?.displayName || artistFilter}
                </span>
              </div>
            ) : (
              <div className="music-subnav-pills glass-pill-rail h-10 shrink-0 items-center">
                <button type="button" className="glass-pill-tab glass-pill-tab--active h-9 px-4 text-sm font-medium">
                  {t.music.songs}
                </button>
                <button type="button" onClick={() => setMusicView('artists')} className="glass-pill-tab h-9 px-4 text-sm font-medium">
                  {t.music.artists}
                </button>
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2 lg:justify-end">
            <div className="relative min-w-0 flex-1 group">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-mist-text)]/35 transition-opacity group-focus-within:text-[var(--color-mist-text)]/55" />
              <input
                type="text"
                placeholder={t.nav.search}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className={MUSIC_SEARCH_INPUT}
              />
            </div>
            <div className={`${MUSIC_SORT_TRIGGER} group`}>
              <span>
                {sortBy === 'recently_played' ? 'Newest' : sortBy === 'a_z' ? 'A-Z' : 'Duration'}
              </span>
              <ChevronDown className="h-3.5 w-3.5 opacity-55 transition-transform group-hover:translate-y-px" />
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as 'recently_played' | 'a_z' | 'duration')}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label={t.music.sortBy}
              >
                <option value="recently_played">Sorted: Newest (release / YouTube)</option>
                <option value="a_z">Sorted: A-Z</option>
                <option value="duration">Sorted: Duration</option>
              </select>
            </div>
          </div>
        </div>

        {!artistFilter && (
          <div className="border-t border-white/12 pt-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {songCategoryOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggleCategory(option.value)}
                  className={`glass-filter-chip ${
                    selectedCategory === option.value ? 'glass-filter-chip--active' : 'glass-filter-chip--idle'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="music-list glass-panel-static rounded-[32px] overflow-hidden flex flex-col">
        <div className="music-list-header grid grid-cols-12 gap-4 px-8 py-4 border-b border-white/10 text-sm font-medium text-[var(--color-mist-text)]/60 uppercase tracking-wider">
          <div className="col-span-1 text-center">#</div>
          <div className="col-span-6">{t.music.title}</div>
          <div className="col-span-3">{t.music.category}</div>
          <div className="col-span-2 text-right">{t.music.duration}</div>
        </div>

        <div ref={listContainerRef} className="h-[50vh] min-h-[200px] overflow-hidden custom-scrollbar">
          {filteredSongTracks.length === 0 ? (
            <div className="px-8 py-12 text-center text-[var(--color-mist-text)]/50 text-sm">No tracks match.</div>
          ) : (
            <FixedSizeList
              height={listHeight}
              width={listWidth}
              itemCount={filteredSongTracks.length}
              itemSize={SONG_ROW_HEIGHT}
              itemData={listItemData}
              overscanCount={4}
            >
              {SongRow}
            </FixedSizeList>
          )}
        </div>

        <MusicPaginationBar
          page={songPage}
          totalPages={songTotalPages}
          onPrev={() => onSongPageChange(songPage - 1)}
          onNext={() => onSongPageChange(songPage + 1)}
          onPageJump={onSongPageChange}
        />
      </div>
    </div>
  );
});

export const MusicTab = memo(function MusicTab({
  tracks,
  currentTrackId,
  onSelectTrack,
  onPlaybackQueueChange,
  onPlaybackContextChange,
  isPlaying,
  t,
  currentLang,
}: {
  tracks: Track[];
  currentTrackId: string;
  onSelectTrack: (t: Track, autoplay?: boolean) => void;
  /** 供底部播放器「上一首/下一首」：与当前列表筛选一致（歌曲列表或艺人详情），艺人网格视图为空列表 */
  onPlaybackQueueChange?: (queue: Track[]) => void;
  /** Smart Radio：同步乐库浏览上下文（艺人页 / 分类筛选） */
  onPlaybackContextChange?: (ctx: MusicPlaybackContext) => void;
  isPlaying: boolean;
  t: any;
  currentLang: string;
}) {
  const songCategoryOptions = useMemo(
    () => [
      { value: MUSIC_ALL_CATEGORY, label: t.categories.all },
      { value: 'cpop', label: t.categories.cpop },
      { value: 'kpop', label: t.categories.kpop },
      { value: 'jpop', label: t.categories.jpop },
      { value: 'western', label: t.categories.western },
      { value: 'anime', label: t.categories.anime },
      { value: 'film', label: t.categories.film },
      { value: 'game', label: t.categories.game },
      { value: 'instrumental', label: t.categories.instrumental },
    ],
    [t],
  );

  const songCategoryLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    songCategoryOptions.forEach(o => m.set(o.value, o.label));
    return m;
  }, [songCategoryOptions]);

  const artistCategoryOptions = useMemo(
    () => [
      { value: 'all', label: t.categories.all },
      { value: 'group', label: t.categories.group },
      { value: 'solo', label: t.categories.solo },
      { value: 'zh', label: t.categories.china },
      { value: 'kr', label: t.categories.korea },
      { value: 'jp', label: t.categories.japan },
      { value: 'en', label: t.categories.us },
      { value: 'other', label: t.categories.global },
    ],
    [t],
  );

  const [musicView, setMusicView] = useState<'artists' | 'songs' | 'artist_detail'>('songs');
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedTrackSearch = useDebouncedValue(searchQuery, SEARCH_DEBOUNCE_MS);
  const [selectedCategory, setSelectedCategory] = useState<string>(MUSIC_ALL_CATEGORY);
  const [sortBy, setSortBy] = useState<'recently_played' | 'a_z' | 'duration'>('recently_played');
  const [artistSearchQuery, setArtistSearchQuery] = useState('');
  const debouncedArtistSearch = useDebouncedValue(artistSearchQuery, SEARCH_DEBOUNCE_MS);
  const [selectedArtistCategory, setSelectedArtistCategory] = useState<string>('all');
  const [artistSortBy, setArtistSortBy] = useState<'a_z' | 'z_a' | 'most_songs'>('most_songs');

  const handlePickArtist = useCallback((id: string) => {
    setSelectedArtist(id);
    setMusicView('artist_detail');
    setSelectedCategory(MUSIC_ALL_CATEGORY);
    setSearchQuery('');
  }, []);

  const [artistImageMap, setArtistImageMap] = useState<Record<string, string>>({});
  const [artistImageKindMap, setArtistImageKindMap] = useState<Record<string, ArtistImageKind | undefined>>({});
  /** 进入乐库即拉取艺人头像 manifest，避免先停在「歌曲」再进「艺人」时 map 仍为空导致整页无图；仅执行一次 */
  useEffect(() => {
    let cancelled = false;
    fetch('/artist-manifest.json')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        const kindMap: Record<string, ArtistImageKind | undefined> = {};
        (data.artists ?? []).forEach(
          (a: {
            canonicalArtistId: string;
            artistImageUrl?: string | null;
            artistImageKind?: ArtistImageKind | null;
          }) => {
            if (a.artistImageUrl) map[a.canonicalArtistId] = a.artistImageUrl;
            if (a.artistImageKind) kindMap[a.canonicalArtistId] = a.artistImageKind;
          },
        );
        setArtistImageMap(map);
        setArtistImageKindMap(kindMap);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const trackSearchIndex = useMemo((): TrackSearchRow[] => {
    return tracks.map(track => {
      const primary = track.canonicalArtistId || track.metadata.display.canonicalArtistId;
      const co = track.coCanonicalArtistIds ?? track.metadata.display.coCanonicalArtistIds ?? [];
      const artistIds = workProjectAugmentedArtistBucketIds(primary, co, getWorkProjectKey(track));
      return {
        track,
        titleN: trackTitleSearchNormalized(track),
        artistN: normalizeSearchStatic(track?.artist),
        catKeys: track.categoryFilterKeys ?? getTrackCategoryKeysStatic(track),
        artistIds,
      };
    });
  }, [tracks]);

  const { artistsMap, artists } = useMemo(() => {
    const map = new Map<string, ArtistCard>();
    tracks.forEach(trk => {
      const primary = trk.canonicalArtistId || trk.metadata.display.canonicalArtistId;
      const co = trk.coCanonicalArtistIds ?? trk.metadata.display.coCanonicalArtistIds ?? [];
      const bucketIds = workProjectAugmentedArtistBucketIds(primary, co, getWorkProjectKey(trk));
      const review = trk.metadata.display.artistReviewStatus || 'needsReview';
      if (review !== 'ok') return;

      for (const cid of bucketIds) {
        if (!cid || cid.startsWith('review/') || cid.startsWith('canon-') || cid === '__unknown__') continue;
        if (!shouldShowArtistOnArtistPage(cid)) continue;

        const infos = trk.metadata.display.normalizedArtistsInfo;
        const rowForName = infos?.find(r => r.id === cid);
        const { displayName: displayNameResolved, searchHaystack, name: avatarName } = artistCardLabelsForBucket(
          cid,
          infos,
          trk,
          primary,
          currentLang,
        );
        /**
         * 桶卡片的 type/region 必须以「桶 id 自己的字典条目」为准。
         * 否则当 workProjectKey 把一首歌挂到项目桶（如 league-of-legends），
         * 但该歌主唱是真人（如 PVRIS），rowForName 会 miss，回退到 infos[0]
         * 就会把项目卡误打成 group/en，停留在「个人/欧美」桶里；同理
         * KPop Demon Hunters 之前被 huntr-x（kr/group）压成 韩国/组合 桶。
         * 字典命中时直接用字典 type/nationality；查不到再退化到 normalizedArtistsInfo。
         */
        const dictRowForBucket = ARTIST_DICTIONARY[dictionaryCanonicalId(cid)];
        const region =
          dictRowForBucket?.nationality || rowForName?.nationality || infos?.[0]?.nationality || 'other';
        const typ = dictRowForBucket?.type || rowForName?.type || infos?.[0]?.type || 'unknown';
        if (!map.has(cid)) {
          map.set(cid, {
            id: cid,
            name: avatarName,
            displayName: displayNameResolved,
            searchHaystack,
            songCount: 1,
            coverUrl:
              'https://ui-avatars.com/api/?name=' +
              encodeURIComponent(avatarName) +
              '&background=random&color=fff&size=200',
            region,
            type: typ,
            reviewStatus: review,
          });
        } else {
          map.get(cid)!.songCount++;
        }
      }
    });
    return { artistsMap: map, artists: Array.from(map.values()) };
  }, [tracks, currentLang]);

  const artistSortNameKey = useCallback(
    (a: ArtistCard) =>
      currentLang === '简体中文' || currentLang === '繁體中文' ? a.displayName || a.name : a.name,
    [currentLang],
  );

  const toggleCategory = useCallback((cat: string) => {
    setSelectedCategory(prev => {
      if (cat === MUSIC_ALL_CATEGORY) return MUSIC_ALL_CATEGORY;
      return prev === cat ? MUSIC_ALL_CATEGORY : cat;
    });
  }, []);

  const toggleArtistCategory = useCallback((cat: string) => {
    setSelectedArtistCategory(prev => {
      if (cat === 'all') return 'all';
      return prev === cat ? 'all' : cat;
    });
  }, []);

  const filteredTracksForList = useMemo(() => {
    const q = normalizeSearchStatic(debouncedTrackSearch);
    const rows: Track[] = [];
    for (let i = 0; i < trackSearchIndex.length; i++) {
      const row = trackSearchIndex[i];
      const matchCat = selectedCategory === MUSIC_ALL_CATEGORY || row.catKeys.includes(selectedCategory);
      if (!matchCat) continue;
      if (q && !row.titleN.includes(q) && !row.artistN.includes(q)) continue;
      rows.push(row.track);
    }
    if (sortBy === 'recently_played') {
      const sorted = [...rows];
      sorted.sort(compareMainSongListOrder);
      return sorted;
    }
    if (sortBy === 'a_z') {
      const sorted = [...rows];
      sorted.sort((a, b) => normalizeTextStatic(a?.title).localeCompare(normalizeTextStatic(b?.title)));
      return sorted;
    }
    if (sortBy === 'duration') {
      const sorted = [...rows];
      sorted.sort((a, b) => parseDurationToSecondsStatic(a?.duration) - parseDurationToSecondsStatic(b?.duration));
      return sorted;
    }
    return rows;
  }, [trackSearchIndex, debouncedTrackSearch, selectedCategory, sortBy]);

  const filteredTracksArtistDetail = useMemo(() => {
    if (!selectedArtist) return [];
    const q = normalizeSearchStatic(debouncedTrackSearch);
    const rows: Track[] = [];
    for (let i = 0; i < trackSearchIndex.length; i++) {
      const row = trackSearchIndex[i];
      if (!row.artistIds.includes(selectedArtist)) continue;
      const matchCat = selectedCategory === MUSIC_ALL_CATEGORY || row.catKeys.includes(selectedCategory);
      if (!matchCat) continue;
      if (q && !row.titleN.includes(q) && !row.artistN.includes(q)) continue;
      rows.push(row.track);
    }
    if (sortBy === 'recently_played') {
      const sorted = [...rows];
      sorted.sort(compareMainSongListOrder);
      return sorted;
    }
    if (sortBy === 'a_z') {
      const sorted = [...rows];
      sorted.sort((a, b) => normalizeTextStatic(a?.title).localeCompare(normalizeTextStatic(b?.title)));
      return sorted;
    }
    if (sortBy === 'duration') {
      const sorted = [...rows];
      sorted.sort((a, b) => parseDurationToSecondsStatic(a?.duration) - parseDurationToSecondsStatic(b?.duration));
      return sorted;
    }
    return rows;
  }, [trackSearchIndex, selectedArtist, debouncedTrackSearch, selectedCategory, sortBy]);

  const [songListPage, setSongListPage] = useState(1);
  const [artistDetailSongPage, setArtistDetailSongPage] = useState(1);
  const [artistGridPage, setArtistGridPage] = useState(1);

  useEffect(() => {
    setSongListPage(1);
  }, [debouncedTrackSearch, selectedCategory, sortBy]);

  useEffect(() => {
    setArtistDetailSongPage(1);
  }, [selectedArtist, debouncedTrackSearch, selectedCategory, sortBy]);

  useEffect(() => {
    setArtistGridPage(1);
  }, [debouncedArtistSearch, selectedArtistCategory, artistSortBy]);

  const songListTotalPages = useMemo(
    () => (filteredTracksForList.length === 0 ? 1 : Math.ceil(filteredTracksForList.length / MUSIC_PAGE_SIZE)),
    [filteredTracksForList],
  );

  const artistDetailTotalPages = useMemo(
    () =>
      filteredTracksArtistDetail.length === 0 ? 1 : Math.ceil(filteredTracksArtistDetail.length / MUSIC_PAGE_SIZE),
    [filteredTracksArtistDetail],
  );

  useEffect(() => {
    setSongListPage(p => Math.min(p, songListTotalPages));
  }, [songListTotalPages]);

  useEffect(() => {
    setArtistDetailSongPage(p => Math.min(p, artistDetailTotalPages));
  }, [artistDetailTotalPages]);

  const pagedTracksMainList = useMemo(() => {
    const start = (songListPage - 1) * MUSIC_PAGE_SIZE;
    return filteredTracksForList.slice(start, start + MUSIC_PAGE_SIZE);
  }, [filteredTracksForList, songListPage]);

  const pagedTracksArtistDetail = useMemo(() => {
    const start = (artistDetailSongPage - 1) * MUSIC_PAGE_SIZE;
    return filteredTracksArtistDetail.slice(start, start + MUSIC_PAGE_SIZE);
  }, [filteredTracksArtistDetail, artistDetailSongPage]);

  const filteredArtistsForGrid = useMemo(() => {
    const q = normalizeSearchStatic(debouncedArtistSearch);
    const list = artists.filter(a => {
      const matchesSearch =
        !q ||
        normalizeSearchStatic(a.searchHaystack).includes(q) ||
        normalizeSearchStatic(a.displayName).includes(q) ||
        normalizeSearchStatic(a.name).includes(q);
      const matchesCategory = artistMatchesArtistCategoryFilter(a, selectedArtistCategory);
      return matchesSearch && matchesCategory;
    });
    if (artistSortBy === 'a_z') {
      const sorted = [...list];
      sorted.sort((a, b) =>
        normalizeTextStatic(artistSortNameKey(a)).localeCompare(normalizeTextStatic(artistSortNameKey(b))),
      );
      return sorted;
    }
    if (artistSortBy === 'z_a') {
      const sorted = [...list];
      sorted.sort((a, b) =>
        normalizeTextStatic(artistSortNameKey(b)).localeCompare(normalizeTextStatic(artistSortNameKey(a))),
      );
      return sorted;
    }
    if (artistSortBy === 'most_songs') {
      const sorted = [...list];
      sorted.sort((a, b) => {
        if (b.songCount !== a.songCount) return b.songCount - a.songCount;
        return normalizeTextStatic(artistSortNameKey(a)).localeCompare(
          normalizeTextStatic(artistSortNameKey(b)),
          'en',
        );
      });
      return sorted;
    }
    return list;
  }, [artists, debouncedArtistSearch, selectedArtistCategory, artistSortBy, artistSortNameKey]);

  const artistGridTotalPages = useMemo(
    () => (filteredArtistsForGrid.length === 0 ? 1 : Math.ceil(filteredArtistsForGrid.length / MUSIC_PAGE_SIZE)),
    [filteredArtistsForGrid],
  );

  useEffect(() => {
    setArtistGridPage(p => Math.min(p, artistGridTotalPages));
  }, [artistGridTotalPages]);

  const pagedArtistsForGrid = useMemo(() => {
    const start = (artistGridPage - 1) * MUSIC_PAGE_SIZE;
    return filteredArtistsForGrid.slice(start, start + MUSIC_PAGE_SIZE);
  }, [filteredArtistsForGrid, artistGridPage]);

  const artistGridHostRef = useRef<HTMLDivElement>(null);
  const [artistGridSize, setArtistGridSize] = useState({ width: 896, height: 480 });

  useEffect(() => {
    if (musicView !== 'artists') return;
    const el = artistGridHostRef.current;
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setArtistGridSize({ width: w, height: h });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [musicView]);

  const artistGridColumnCount = artistGridSize.width >= 1024 ? 4 : artistGridSize.width >= 640 ? 3 : 2;
  const artistColumnWidth = Math.max(120, Math.floor(artistGridSize.width / artistGridColumnCount));
  const artistRowCount =
    pagedArtistsForGrid.length === 0
      ? 0
      : Math.ceil(pagedArtistsForGrid.length / artistGridColumnCount);

  const artistGridItemData = useMemo(
    (): ArtistGridCellData => ({
      artists: pagedArtistsForGrid,
      columnCount: artistGridColumnCount,
      artistImageMap,
      artistImageKindMap,
      currentLang,
      t,
      onPickArtist: handlePickArtist,
    }),
    [
      pagedArtistsForGrid,
      artistGridColumnCount,
      artistImageMap,
      artistImageKindMap,
      currentLang,
      t,
      handlePickArtist,
    ],
  );

  const renderArtistView = () => (
    <div className="flex flex-col animate-in fade-in duration-500">
      <div className={`${MUSIC_BROWSE_PANEL} space-y-3`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-3">
          <div className="music-subnav-pills glass-pill-rail h-10 shrink-0 items-center">
            <button type="button" onClick={() => setMusicView('songs')} className="glass-pill-tab h-9 px-4 text-sm font-medium">
              {t.music.songs}
            </button>
            <button type="button" className="glass-pill-tab glass-pill-tab--active h-9 px-4 text-sm font-medium">
              {t.music.artists}
            </button>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2 lg:justify-end">
            <div className="relative min-w-0 flex-1 group">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-mist-text)]/35 transition-opacity group-focus-within:text-[var(--color-mist-text)]/55" />
              <input
                type="text"
                placeholder={t.music.searchArtists}
                value={artistSearchQuery}
                onChange={e => setArtistSearchQuery(e.target.value)}
                className={MUSIC_SEARCH_INPUT}
              />
            </div>
            <div className={`${MUSIC_SORT_TRIGGER} group`}>
              <span>
                {artistSortBy === 'a_z' ? 'A-Z' : artistSortBy === 'z_a' ? 'Z-A' : t.music.mostSongs}
              </span>
              <ChevronDown className="h-3.5 w-3.5 opacity-55 transition-transform group-hover:translate-y-px" />
              <select
                value={artistSortBy}
                onChange={e => setArtistSortBy(e.target.value as 'a_z' | 'z_a' | 'most_songs')}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label={t.music.sortBy}
              >
                <option value="a_z">Order: A-Z</option>
                <option value="z_a">Order: Z-A</option>
                <option value="most_songs">Most Songs</option>
              </select>
            </div>
          </div>
        </div>

        <div className="border-t border-white/12 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {artistCategoryOptions.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleArtistCategory(option.value)}
                className={`glass-filter-chip ${
                  selectedArtistCategory === option.value ? 'glass-filter-chip--active' : 'glass-filter-chip--idle'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        ref={artistGridHostRef}
        className="h-[min(72vh,820px)] min-h-[320px] w-full overflow-hidden rounded-[32px]"
      >
        {filteredArtistsForGrid.length === 0 ? (
          <div className="px-8 py-12 text-center text-[var(--color-mist-text)]/50 text-sm">No artists match.</div>
        ) : (
          <FixedSizeGrid
            className="custom-scrollbar"
            columnCount={artistGridColumnCount}
            columnWidth={artistColumnWidth}
            height={artistGridSize.height}
            rowCount={artistRowCount}
            rowHeight={ARTIST_GRID_ROW_HEIGHT}
            width={artistGridSize.width}
            itemData={artistGridItemData}
          >
            {ArtistGridCell as any}
          </FixedSizeGrid>
        )}
      </div>

      <MusicPaginationBar
        page={artistGridPage}
        totalPages={artistGridTotalPages}
        onPrev={() => setArtistGridPage(p => Math.max(1, p - 1))}
        onNext={() => setArtistGridPage(p => Math.min(artistGridTotalPages, p + 1))}
        onPageJump={(p) => setArtistGridPage(p)}
      />
    </div>
  );

  const songListLayoutKey = `${musicView}-${selectedArtist ?? 'all'}-p${musicView === 'songs' ? songListPage : musicView === 'artist_detail' ? artistDetailSongPage : 0}`;

  useEffect(() => {
    if (!onPlaybackQueueChange) return;
    if (musicView === 'artists') {
      onPlaybackQueueChange([]);
      return;
    }
    if (musicView === 'artist_detail') {
      const start = (artistDetailSongPage - 1) * MUSIC_PAGE_SIZE;
      onPlaybackQueueChange(filteredTracksArtistDetail.slice(start, start + MUSIC_PAGE_SIZE));
      return;
    }
    const start = (songListPage - 1) * MUSIC_PAGE_SIZE;
    onPlaybackQueueChange(filteredTracksForList.slice(start, start + MUSIC_PAGE_SIZE));
  }, [
    musicView,
    filteredTracksForList,
    filteredTracksArtistDetail,
    songListPage,
    artistDetailSongPage,
    onPlaybackQueueChange,
  ]);

  useEffect(() => {
    if (!onPlaybackContextChange) return;
    const ctx: MusicPlaybackContext = {
      musicLibraryActive: true,
      musicView,
      artistContextId: musicView === 'artist_detail' ? selectedArtist : null,
      categoryKey: musicView === 'songs' ? selectedCategory : null,
    };
    onPlaybackContextChange(ctx);
  }, [musicView, selectedArtist, selectedCategory, onPlaybackContextChange]);

  return (
    <div className="music-page w-full max-w-5xl mx-auto flex flex-col animate-in fade-in duration-500">
      {musicView === 'artists' && renderArtistView()}
      {musicView === 'songs' && (
        <SongListChrome
          layoutKey={songListLayoutKey}
          artistFilter={null}
          filteredSongTracks={pagedTracksMainList}
          songPage={songListPage}
          songTotalPages={songListTotalPages}
          onSongPageChange={setSongListPage}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          onSelectTrack={onSelectTrack}
          currentLang={currentLang}
          songCategoryLabelMap={songCategoryLabelMap}
          t={t}
          artistsMap={artistsMap}
          artistImageMap={artistImageMap}
          artistImageKindMap={artistImageKindMap}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          sortBy={sortBy}
          setSortBy={setSortBy}
          songCategoryOptions={songCategoryOptions}
          selectedCategory={selectedCategory}
          toggleCategory={toggleCategory}
          setMusicView={setMusicView}
        />
      )}
      {musicView === 'artist_detail' && selectedArtist && (
        <SongListChrome
          layoutKey={songListLayoutKey}
          artistFilter={selectedArtist}
          filteredSongTracks={pagedTracksArtistDetail}
          songPage={artistDetailSongPage}
          songTotalPages={artistDetailTotalPages}
          onSongPageChange={setArtistDetailSongPage}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          onSelectTrack={onSelectTrack}
          currentLang={currentLang}
          songCategoryLabelMap={songCategoryLabelMap}
          t={t}
          artistsMap={artistsMap}
          artistImageMap={artistImageMap}
          artistImageKindMap={artistImageKindMap}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          sortBy={sortBy}
          setSortBy={setSortBy}
          songCategoryOptions={songCategoryOptions}
          selectedCategory={selectedCategory}
          toggleCategory={toggleCategory}
          setMusicView={setMusicView}
        />
      )}
    </div>
  );
});
