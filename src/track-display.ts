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

  const cid = d.canonicalArtistId;
  if (d.artistReviewStatus === 'ok' && cid) {
    const row = ARTIST_DICTIONARY[dictionaryCanonicalId(cid)];
    if (row) {
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

export const getDisplayTrackArtist = (track: Track, currentLang = 'English') =>
  (track.metadataStatus === 'approved' && track.sourceArtist)
    ? track.sourceArtist
    : getLocalizedTrackArtist(track, currentLang);

export const hasPracticeAssets = (track: Track) =>
  Boolean(track.audioUrl && track.midiUrl && track.musicxmlUrl);
