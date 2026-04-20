import type { Track } from './types/track';
import { dictionaryCanonicalId } from './artist-canonical';
import { ARTIST_DICTIONARY } from './local-import-artist-normalization';
import { getVideoOverrideZhHansUrl } from './video-overrides';

/** True if URL is a concrete YouTube watch page (not channel search / browse). */
export function isRealYoutubeWatchUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  if (url.includes('/search?') || url.includes('@')) return false;
  return (
    /[?&]v=[\w-]{11}/.test(url) ||
    /youtu\.be\/[\w-]{11}/.test(url) ||
    /youtube\.com\/shorts\/[\w-]+/i.test(url)
  );
}

/** True if URL is a concrete CIP sheet page on mymusic (not keyword search fallback). */
export function isRealSheetUrl(url?: string | null): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if ((url.includes('mymusic') || url.includes('cipmusic')) && url.includes('keyword=')) return false;
  if (
    /(?:www\.)?(?:mymusic5\.com|mymusic\.st|mymusicfive\.com|mymusicsheet\.com)\/cipmusic\/\d+/i.test(url)
  ) {
    return true;
  }
  if (/gumroad\.com\/l\/[\w-]+/i.test(url)) return true;
  return false;
}

/** Bilibili video page (BV / av). */
export function isRealBilibiliUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  return /bilibili\.com\/video\/(BV[\w]+)/i.test(url) || /bilibili\.com\/video\/av\d+/i.test(url);
}

export function getTrackBilibiliUrl(track: Track): string | undefined {
  const u = track.bilibiliUrl || track.metadata?.links?.bilibili;
  if (!isRealBilibiliUrl(u)) return undefined;
  return u.replace(/\/?$/, '');
}

/**
 * 曲目已有 B 站链接时沿用；否则在「简体中文」下使用 `data/video-overrides.json` 的 videoUrlZhHans。
 */
export function getTrackBilibiliUrlForLocale(track: Track, currentLang: string): string | undefined {
  const direct = getTrackBilibiliUrl(track);
  if (direct) return direct;
  if (currentLang === '简体中文') return getVideoOverrideZhHansUrl(track);
  return undefined;
}

export function getTrackYoutubeUrl(track: Track): string | undefined {
  const u = track.youtubeUrl || track.metadata?.links?.youtube || track.metadata?.links?.video;
  return isRealYoutubeWatchUrl(u) ? u : undefined;
}

export function getTrackSheetUrl(track: Track): string | undefined {
  const u = track.sheetUrl || track.metadata?.links?.sheet;
  return isRealSheetUrl(u) ? u : undefined;
}

/**
 * True when the track has a real YouTube watch URL,或 B 站视频页，或在简中模式下命中 video-overrides。
 */
export function trackHasExternalVideo(track: Track, currentLang?: string): boolean {
  const yt = getTrackYoutubeUrl(track);
  const bili = getTrackBilibiliUrl(track);
  const zhBili = currentLang === '简体中文' ? getVideoOverrideZhHansUrl(track) : undefined;
  return Boolean(yt || bili || zhBili);
}

export const getLocalizedTrackTitle = (track: Track, currentLang: string) => {
  const titles = track.metadata.display.titles;
  const fallbackTitle = track.metadata.display.displayTitle || track.metadata.display.title || track.title;

  if (!titles) return fallbackTitle;
  if (currentLang === '简体中文') return titles.zhHans || titles.zhHant || titles.en || fallbackTitle;
  if (currentLang === '繁體中文') return titles.zhHant || titles.zhHans || titles.en || fallbackTitle;
  return titles.en || titles.zhHans || titles.zhHant || fallbackTitle;
};

/** UI 标题始终走 manifest 多语言字段；勿因 approved 的 sourceSongTitle 绕过 locale（source 常为平台原始中文名）。 */
export const getDisplayTrackTitle = (track: Track, currentLang = 'English') =>
  getLocalizedTrackTitle(track, currentLang);

function shouldHideArtistLine(s: string | undefined): boolean {
  const t = (s ?? '').trim();
  if (!t) return true;
  return /（无原唱）|無原唱|Unknown\s*Artist/i.test(t);
}

/** Seed / video-parse lines like "Be Mine CHUANG2021" — show canonical INTO1 instead. */
function artistFieldsMentionChuang2021(track: Track): boolean {
  const d = track.metadata.display;
  const hay = [
    d.artists?.en,
    d.artists?.zhHans,
    d.artists?.zhHant,
    d.artist,
    track.artist,
    track.sourceArtist,
  ]
    .filter(Boolean)
    .join(' ');
  return /chuang\s*2021|创造营\s*2021|創造營\s*2021/i.test(hay);
}

export const getLocalizedTrackArtist = (track: Track, currentLang: string) => {
  const d = track.metadata.display;
  const artists = d.artists;
  const fallbackArtist = d.artist || track.artist;

  if (d.artistReviewStatus === 'ok' && d.canonicalArtistDisplayName && artistFieldsMentionChuang2021(track)) {
    return d.canonicalArtistDisplayName;
  }

  /** 多艺人 / co-artist / review 桶：不能仅用词典「主艺人」单名，否则第二位（如杨坤、Bruno Mars）被吃掉。 */
  const coMerged = Array.from(
    new Set(
      [...(track.coCanonicalArtistIds ?? []), ...(d.coCanonicalArtistIds ?? [])].filter(
        Boolean,
      ) as string[],
    ),
  );
  const isMultiArtist = coMerged.length > 0;
  if (d.artistReviewStatus === 'ok' && isMultiArtist) {
    if (artists) {
      if (currentLang === '简体中文') return artists.zhHans || artists.zhHant || artists.en || d.canonicalArtistDisplayName || fallbackArtist;
      if (currentLang === '繁體中文') return artists.zhHant || artists.zhHans || artists.en || d.canonicalArtistDisplayName || fallbackArtist;
      return artists.en || artists.zhHans || artists.zhHant || d.canonicalArtistDisplayName || fallbackArtist;
    }
    if (d.canonicalArtistDisplayName?.trim()) return d.canonicalArtistDisplayName.trim();
  }

  const cid = d.canonicalArtistId;
  if (d.artistReviewStatus === 'ok' && cid) {
    const row = ARTIST_DICTIONARY[dictionaryCanonicalId(cid)];
    const disp = d.canonicalArtistDisplayName?.trim();
    const zh = row?.names.zhHans?.trim();
    const zt = row?.names.zhHant?.trim() || zh;
    const en = row?.names.en?.trim();
    /** 词典团名仅在与 locked「展示名」一致时使用；否则视为组合桶下的成员/别名行（如 i-dle + Minnie），交给下方 `artists`。 */
    const displayMatchesDictionary =
      row &&
      (!disp || disp === zh || disp === zt || disp === en);
    if (row && displayMatchesDictionary) {
      if (currentLang === '简体中文') return row.names.zhHans || row.names.en;
      if (currentLang === '繁體中文') return row.names.zhHant || row.names.zhHans || row.names.en;
      return row.names.en || row.names.zhHans;
    }
  }

  if (!artists) return fallbackArtist;
  if (currentLang === '简体中文') return artists.zhHans || artists.zhHant || artists.en || fallbackArtist;
  if (currentLang === '繁體中文') return artists.zhHant || artists.zhHans || artists.en || fallbackArtist;
  return artists.en || artists.zhHans || artists.zhHant || fallbackArtist;
};

export const getDisplayTrackArtist = (track: Track, currentLang = 'English') => {
  const raw =
    track.metadataStatus === 'approved' && track.sourceArtist
      ? track.sourceArtist
      : getLocalizedTrackArtist(track, currentLang);
  return shouldHideArtistLine(raw) ? '' : raw;
};

/**
 * Phase 1 之后，Supabase-origin 曲目的 `midiUrl` / `musicxmlUrl` 会在前端
 * 永远是 `undefined`（真实 URL 改由 broker 签发）。因此不能再用 URL 是否存在
 * 来判断 Practice 能否用，必须以 `practiceEnabled` / `metadata.assets.hasPracticeAssets`
 * 为主，仅对 legacy local-imports 保留 URL 兜底。
 */
export const hasPracticeAssets = (track: Track) => {
  if (track.practiceEnabled === true) return true;
  if (track.metadata?.assets?.hasPracticeAssets === true) return true;
  if (track.practiceEnabled === false) return false;
  return Boolean(track.audioUrl && track.midiUrl && track.musicxmlUrl);
};
