import type { LOCAL_IMPORT_SEEDS } from './local-import-seeds.generated';
import type { LocalImportMetadataOverride } from './local-import-metadata-overrides';
import { LOCAL_IMPORT_CIP_LINKS } from './local-import-cip-links.generated';
import { LOCAL_IMPORT_OFFICIAL_METADATA } from './local-import-official-metadata.generated';
import { transliterate } from 'transliteration';

const CIP_YOUTUBE_CHANNEL_SEARCH_BASE = 'https://www.youtube.com/@CIPMusic/search?query=';
const CIP_SHEET_SEARCH_BASE = 'https://www.mymusic5.com/cipmusic?keyword=';

/**
 * Slugs confirmed as video-only catalog (no mymusic/CIP sheet URL). Keeps manifest `linked` when a watch URL exists.
 */
export const INTENTIONAL_NO_SHEET_SLUGS = new Set<string>([
  'girls',
  'SPOT',
  '想你的365天',
  'time to shine',
  '男儿歌',
  '两个自己',
  '寂静之忆',
  'xoxo',
  '一些悲伤又美好的事',
  'u+me=love',
  'shoot',
  'the feels',
  'my universe',
  '秋天前',
  '意气趁年少',
  'radio',
  'the eve',
  "you can't sit with us",
  'a thousand years',
  '所念皆星河',
  'yes ok',
  'Catallena',
  'love story',
  'willow',
  'cure for me',
  '爱如火',
  '未闻花名',
  '都选c',
  '你不属于我',
  '只因你太美',
]);

const encodeLookupQuery = (value: string) => encodeURIComponent(value.trim());
const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const toTitleCase = (value: string) =>
  value
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, char: string) => char.toUpperCase());

const normalizeLatinTitle = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const sanitizeExtractedEnglishCandidate = (value: string) =>
  value
    .replace(/\bPiano Cover\b/gi, '')
    .replace(/\bTheme Song\b/gi, '')
    .replace(/\bOfficial\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const scoreEnglishTitleCandidate = (candidate: string, anchors: string[]) => {
  const normalizedCandidate = normalizeLatinTitle(candidate);
  if (!normalizedCandidate) return -1;
  let score = 1;

  for (const anchor of anchors) {
    const normalizedAnchor = normalizeLatinTitle(anchor);
    if (!normalizedAnchor) continue;
    if (normalizedCandidate === normalizedAnchor) score += 100;
    else if (normalizedCandidate.includes(normalizedAnchor)) score += 45;
    else if (normalizedAnchor.includes(normalizedCandidate)) score += 25;
  }

  if (normalizedCandidate.includes('theme song')) score -= 20;
  if (normalizedCandidate.includes('piano cover')) score -= 20;

  return score;
};

const extractEnglishTitleFromVideoTitle = (title: string | undefined, anchors: string[]) => {
  if (!title) return undefined;
  const decoded = decodeHtmlEntities(title).trim();
  const candidates: string[] = [];
  const patterns = [
    /[“"]([^”"]*[A-Za-z][^”"]*)[”"]/g,
    /[‘']([^’']*[A-Za-z][^’']*)[’']/g,
  ];

  for (const pattern of patterns) {
    const matches = Array.from(decoded.matchAll(pattern))
      .map(match => match[1]?.trim())
      .filter(Boolean) as string[];

    for (const candidate of matches) {
      const normalized = sanitizeExtractedEnglishCandidate(candidate);
      if (/[A-Za-z]/.test(normalized) && normalized.length >= 2) {
        candidates.push(normalized);
      }
    }
  }

  const postTitleParentheticalMatch = decoded.match(/[”"』》」]\s*[（(]([^）)]*[A-Za-z][^）)]*)[）)]/);
  if (postTitleParentheticalMatch?.[1]) {
    const normalized = sanitizeExtractedEnglishCandidate(postTitleParentheticalMatch[1]);
    if (/[A-Za-z]/.test(normalized) && normalized.length >= 2) {
      candidates.push(normalized);
    }
  }

  const explicitDashMatch = decoded.match(/-\s*[“"]?([A-Za-z][A-Za-z0-9\s'&-]+?)[”"]?\s+Piano Cover/i);
  if (explicitDashMatch?.[1]) candidates.push(explicitDashMatch[1].trim());

  const best = Array.from(new Set(candidates))
    .map(candidate => ({ candidate, score: scoreEnglishTitleCandidate(candidate, anchors) }))
    .sort((a, b) => b.score - a.score)[0];

  if (best && best.score > 1) return best.candidate;

  return undefined;
};

const buildRomanizedFallbackTitle = (title: string) => {
  const romanized = transliterate(title)
    .replace(/[^A-Za-z0-9\s'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return romanized ? toTitleCase(romanized) : undefined;
};

const containsHan = (value: string | undefined) => /[\p{Script=Han}]/u.test(value || '');

const normalizeArtistSegment = (value: string) =>
  value
    .replace(/^电影《[^》]+》\s*/i, '')
    .replace(/^電影《[^》]+》\s*/i, '')
    .replace(/^《[^》]+》\s*(?:OST|片头曲|片頭曲|片尾曲|主題曲|主题曲)\s*/i, '')
    .replace(/^“[^”]+”\s*(?:OST|Theme Song)\s*/i, '')
    .replace(/\s+\d{4}春晚歌曲.*$/i, '')
    .replace(/\s+(?:OST|片头曲|片頭曲|片尾曲|主題曲|主题曲).*$/i, '')
    .replace(/\s*\|\s*Piano by CIP Music.*$/i, '')
    .replace(/\s+钢琴版.*$/i, '')
    .replace(/\s+鋼琴版.*$/i, '')
    .replace(/\s+Piano Cover.*$/i, '')
    .replace(/\s+-\s*$/g, '')
    .trim();

const splitLocalizedArtistSegment = (value: string) => {
  const normalized = normalizeArtistSegment(value);
  if (!normalized) {
    return { zhHans: undefined, zhHant: undefined, en: undefined };
  }

  const strippedTitleFragments = normalized
    .replace(/[“"'‘][^“”"'‘’]+[”"'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parenValue = strippedTitleFragments.match(/[（(]([^）)]+)[）)]/)?.[1]?.trim();
  const withoutParens = strippedTitleFragments.replace(/[（(][^）)]+[）)]/g, ' ').replace(/\s+/g, ' ').trim();

  const zhCandidate = withoutParens
    .replace(/[A-Za-z][A-Za-z0-9 .&'’/-]*/g, ' ')
    .replace(/[“”"'‘’]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, ' ')
    .trim();

  const englishChunks = [
    ...withoutParens.match(/[A-Za-z][A-Za-z0-9 .&'’/-]*/g) || [],
    ...(parenValue && /[A-Za-z]/.test(parenValue) ? [parenValue] : []),
  ].map(chunk => chunk.trim()).filter(Boolean);

  const enCandidate = Array.from(new Set(englishChunks)).join(' ').replace(/\s+/g, ' ').trim();

  return {
    zhHans: containsHan(zhCandidate) ? zhCandidate : undefined,
    zhHant: containsHan(zhCandidate) ? zhCandidate : undefined,
    en: enCandidate || undefined,
  };
};

const extractLocalizedArtistsFromVideoTitle = (title: string | undefined, fallbackArtist?: string) => {
  const fallbackIsHan = containsHan(fallbackArtist);
  if (!title) {
    return {
      zhHans: fallbackIsHan ? fallbackArtist : undefined,
      zhHant: fallbackIsHan ? fallbackArtist : undefined,
      en: fallbackIsHan ? undefined : fallbackArtist,
    };
  }

  const decoded = decodeHtmlEntities(title).trim();
  const prefixBeforeSong =
    decoded.match(/^《[^》]+》\s*(?:OST|片头曲|片頭曲|片尾曲|主題曲|主题曲)\s+(.+?)《/)?.[1]?.trim() ||
    decoded.match(/^(.+?)《/)?.[1]?.trim() ||
    decoded.match(/^(.+?)\s*[“"'‘]/)?.[1]?.trim() ||
    decoded.match(/^(.+?)\s*-\s*[“"'‘]/)?.[1]?.trim() ||
    undefined;

  let normalizedPrefix = prefixBeforeSong
    ? normalizeArtistSegment(prefixBeforeSong.replace(/^【[^】]*】\s*/, ''))
    : undefined;
  const INVALID_PREFIX_RE = /^(电影|電影|游戏|遊戲|动漫|動漫|主题曲|主題曲|ost|theme|钢琴|鋼琴|piano|当|本来|如果|这|那|我|你|他|她|和|也|在|是|有|了)$/i;
  if (normalizedPrefix && (INVALID_PREFIX_RE.test(normalizedPrefix) || normalizedPrefix.length < 2)) {
    normalizedPrefix = undefined;
  }

  // Pattern: "ARTIST - SONG Piano Cover | ..." or "ARTIST - SONG | Piano ..."
  if (!normalizedPrefix) {
    const dashMatch = decoded.match(/^(.+?)\s+[-–—]\s+.+?(?:\s+Piano\b|\s+\|)/i);
    if (dashMatch?.[1]) {
      const candidate = normalizeArtistSegment(dashMatch[1]);
      if (candidate && candidate.length >= 2) normalizedPrefix = candidate;
    }
  }

  // Pattern: "ARTIST(한국어/カタカナ) - SONG ..."
  if (!normalizedPrefix) {
    const koJaMatch = decoded.match(/^([A-Za-z][\w\s&.'*-]+?)\s*[（(]/);
    if (koJaMatch?.[1]) {
      const candidate = normalizeArtistSegment(koJaMatch[1]);
      if (candidate && candidate.length >= 2) normalizedPrefix = candidate;
    }
  }

  // Pattern: "SONG Piano Cover - ARTIST ..." (song first, artist after dash)
  if (!normalizedPrefix) {
    const afterDash = decoded.match(/Piano\s+Cover\s+[-–—]\s+(.+?)(?:\s+钢琴|\s+\||\s*$)/i);
    if (afterDash?.[1]) {
      const candidate = normalizeArtistSegment(afterDash[1]);
      if (candidate && candidate.length >= 2) normalizedPrefix = candidate;
    }
  }

  let zhHans: string | undefined;
  let zhHant: string | undefined;
  let en: string | undefined = fallbackArtist;

  if (normalizedPrefix) {
    const localized = splitLocalizedArtistSegment(normalizedPrefix);
    zhHans = localized.zhHans;
    zhHant = localized.zhHant || localized.zhHans;
    if (localized.en) en = localized.en;
  }

  return {
    zhHans,
    zhHant,
    en: en || fallbackArtist,
  };
};

export type LocalImportAutoEnrichment = {
  displayTitle?: string;
  cover?: string;
  artist?: string;
  rawCategory?: string;
  mappedCategory?: string;
  mappedTags?: string[];
  officialUrl?: string;
  officialSource?: string;
  /** Pilot / layered cover policy (preferred over inferring from officialSource). */
  coverSource?: string;
  coverLocked?: boolean;
  coverUncertain?: boolean;
};

export const buildLocalImportAutoEnrichment = (
  slug: string,
  override?: LocalImportMetadataOverride,
) => {
  const officialMetadata = (LOCAL_IMPORT_OFFICIAL_METADATA as any)[slug];
  const useOfficialCover = !override?.suppressOfficialCover && officialMetadata?.cover;

  /** 已锁定的 Apple / Spotify / QQ 商店封面优先于 overrides 里旧的 YouTube/手填 thumb，避免重抓图后仍被覆盖。 */
  const cs = officialMetadata?.coverSource as string | undefined;
  const lockedStoreCover =
    officialMetadata?.coverLocked === true &&
    officialMetadata?.cover &&
    /^(apple|appleMusic|spotify|qqMusic)$/i.test(cs || '');

  let resolvedCover: string | undefined;
  if (override?.suppressOfficialCover && override?.cover) {
    resolvedCover = override.cover as string;
  } else if (lockedStoreCover) {
    resolvedCover = officialMetadata.cover as string;
  } else {
    resolvedCover =
      (override?.cover as string | undefined) ||
      (useOfficialCover ? (officialMetadata.cover as string | undefined) : undefined);
  }

  return {
    displayTitle: officialMetadata?.displayTitle,
    cover: resolvedCover,
    artist: override?.artist || undefined,
    rawCategory: undefined,
    mappedCategory: undefined,
    mappedTags: (override?.categoryTags || []) as string[],
    officialUrl: officialMetadata?.officialUrl,
    officialSource: officialMetadata?.officialSource,
    coverSource: officialMetadata?.coverSource as string | undefined,
    coverLocked: officialMetadata?.coverLocked as boolean | undefined,
    coverUncertain: officialMetadata?.coverUncertain as boolean | undefined,
  } satisfies LocalImportAutoEnrichment;
};

export const buildLocalImportAutoLinks = (
  slug: string,
  title: string,
  override?: LocalImportMetadataOverride,
) => {
  const cipLinks = (LOCAL_IMPORT_CIP_LINKS as any)[slug];
  const query = encodeLookupQuery(title);
  const youtubeSearchUrl = `${CIP_YOUTUBE_CHANNEL_SEARCH_BASE}${query}`;
  const sheetSearchUrl = `${CIP_SHEET_SEARCH_BASE}${query}&viewType=sheet`;
  /** Manual Bilibili-only: do not fall back to CIP YouTube or channel search. */
  const blockCipYoutube = Boolean(
    override?.links?.bilibili && !override?.links?.youtube && !override?.links?.video,
  );
  const noExternalVideo = Boolean(override?.links?.noExternalVideo);
  const noSheet = Boolean(override?.links?.noSheet) || INTENTIONAL_NO_SHEET_SLUGS.has(slug);
  const skipYoutubeFallback = blockCipYoutube || noExternalVideo;
  const cipYt = skipYoutubeFallback ? undefined : cipLinks?.youtube || cipLinks?.video;
  const youtubeFallback = skipYoutubeFallback ? undefined : youtubeSearchUrl;

  return {
    bilibili: noExternalVideo ? undefined : override?.links?.bilibili,
    youtube: override?.links?.youtube || cipYt || youtubeFallback,
    video:
      override?.links?.video ||
      override?.links?.youtube ||
      cipYt ||
      (noExternalVideo ? undefined : override?.links?.bilibili) ||
      youtubeFallback,
    sheet: noSheet ? undefined : override?.links?.sheet || cipLinks?.sheet || sheetSearchUrl,
  };
};

import { normalizeAndExtractArtists } from './local-import-artist-normalization';
import { findKnownArtistInVideoTitle } from './artist-from-video-title';

export const buildLocalImportAutoDisplay = (
  seed: (typeof LOCAL_IMPORT_SEEDS)[number],
  inferredTitle: string,
  autoEnrichment: LocalImportAutoEnrichment,
  override?: LocalImportMetadataOverride,
) => {
  const cipLinks = (LOCAL_IMPORT_CIP_LINKS as any)[seed.slug];
  const preferredLocalChineseTitle =
    (containsHan(override?.displayTitle) && override?.displayTitle) ||
    (containsHan(override?.title) && override?.title) ||
    (containsHan(inferredTitle) && inferredTitle) ||
    (containsHan(seed.titleOverride) && seed.titleOverride) ||
    (containsHan(seed.slug) && seed.slug) ||
    undefined;
  const englishAnchors = [
    override?.titles?.en,
    seed.titleOverride,
    inferredTitle,
  ].filter(Boolean) as string[];
  const autoEnglishTitle =
    extractEnglishTitleFromVideoTitle(cipLinks?.matchedVideoTitle, englishAnchors) ||
    buildRomanizedFallbackTitle(override?.title || override?.displayTitle || override?.titles?.zhHans || inferredTitle);
  const localizedArtists = extractLocalizedArtistsFromVideoTitle(cipLinks?.matchedVideoTitle, undefined);
  const dictArtist = (!localizedArtists.zhHans && !localizedArtists.en)
    ? findKnownArtistInVideoTitle(cipLinks?.matchedVideoTitle || '')
    : undefined;
  const preferredArtist =
    override?.artist ||
    override?.artists?.zhHans ||
    override?.artists?.zhHant ||
    override?.artists?.en ||
    localizedArtists.zhHans ||
    localizedArtists.zhHant ||
    localizedArtists.en ||
    dictArtist ||
    autoEnrichment.artist ||
    '';

  const normalizedArtistsInfo = normalizeAndExtractArtists(preferredArtist);

  const effectiveDisplayTitle = override?.displayTitle || autoEnrichment.displayTitle;
  return {
    title: override?.title || inferredTitle,
    displayTitle: effectiveDisplayTitle,
    titles: {
      zhHans: override?.titles?.zhHans || preferredLocalChineseTitle,
      ...override?.titles,
      en: override?.titles?.en || effectiveDisplayTitle || autoEnglishTitle,
    },
    artist: preferredArtist,
    artists: {
      zhHans: override?.artists?.zhHans || localizedArtists.zhHans,
      zhHant: override?.artists?.zhHant || localizedArtists.zhHant || localizedArtists.zhHans,
      en: override?.artists?.en || localizedArtists.en,
    },
    normalizedArtistsInfo,
    category: override?.category || autoEnrichment.mappedCategory,
    /** autoEnrichment.cover 已合并「锁定商店封面优先于 overrides.cover」；此处勿再让 override.cover 抢先覆盖。 */
    cover:
      autoEnrichment.cover ||
      `https://picsum.photos/seed/${encodeURIComponent(seed.id)}/300/300`,
  };
};
