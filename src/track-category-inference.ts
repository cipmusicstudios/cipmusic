/**
 * Multi-label category inference: IP / source tags must persist alongside language tags.
 * Used at manifest build time (trackToManifestEntry).
 */

import type { ArtistReviewStatus } from './artist-canonical';
import { ARTIST_DICTIONARY } from './local-import-artist-normalization';
import { normalizeCategoryKeyStatic } from './category-keys';

/** Seed / UI labels that map to filter buckets (language + source + style). */
export const SOURCE_TAG_LABELS = new Set(['影视', '动漫', '游戏', '纯音乐']);

/** Canonical artist ids that always imply 「游戏」. */
const GAME_PROJECT_IDS = new Set([
  'love-and-deepspace',
  'genshin-impact',
  'honkai-star-rail',
  'honkai-impact-3',
  'honor-of-kings',
  'paper-bride',
  'black-myth-wukong',
  /** 《斗地主》抒情版等 — 无固定原唱，按游戏 IP 归档 */
  'dou-dizhu-game',
]);

const NFKC = (s: string) => s.normalize('NFKC');

/**
 * Labels inferred only from resolved canonical id (authoritative for IP buckets).
 */
export function inferLabelsFromCanonicalArtistId(canonicalArtistId: string | undefined): string[] {
  if (!canonicalArtistId) return [];
  if (GAME_PROJECT_IDS.has(canonicalArtistId)) return ['游戏'];
  return [];
}

/**
 * Text/title hints when canonical is solo artist but song is clearly from an IP.
 */
export function inferLabelsFromHaystack(haystack: string): string[] {
  const s = NFKC(haystack);
  const out = new Set<string>();

  if (/恋与深空|戀與深空|love\s*and\s*deepspace/i.test(s)) {
    out.add('游戏');
  }
  if (/崩坏|崩壞|星穹铁道|星穹鐵道|honkai|genshin|原神|米哈游|mihoyo/i.test(s)) {
    out.add('游戏');
  }
  if (/王者荣耀|honor\s*of\s*kings|纸嫁衣|黑神话|黑神話|光与夜之恋|光與夜之戀|light\s*and\s*night/i.test(s)) {
    out.add('游戏');
  }
  if (/碧蓝航线|azur\s*lane/i.test(s)) {
    out.add('游戏');
  }

  if (
    /进击的巨人|進擊的巨人|attack\s*on\s*titan|shingeki|泽野弘之|澤野弘之|Hiroyuki\s*Sawano/i.test(s) ||
    /君の名は|电影《你的名字》|《你的名字》.*君の名は|三叶|三葉|前前前世/i.test(s)
  ) {
    out.add('动漫');
  }

  if (/电视剧|電視劇|电影|影片|插曲|片头曲|片尾曲|影视原声|原声带/i.test(s)) {
    out.add('影视');
  }
  /** 选秀 / 偶像综艺「主题曲」不应标成影视 OST */
  const realityTalentTheme =
    /偶像练习生|創造營|创造营|青春有你|PRODUCE\s*101|PRODUCE\s*48|BOYS\s*PLANET|GIRLS\s*PLANET|pick\s*me|选秀/i.test(
      s,
    );
  if (
    /主题曲|主題曲/.test(s) &&
    !realityTalentTheme &&
    !/原神|genshin|崩坏|星穹|honkai|纸嫁衣|恋与深空|光与夜|王者荣耀|黑神话|mihoyo/i.test(s)
  ) {
    out.add('影视');
  }

  return Array.from(out);
}

/** 游戏 IP 稿件里常写「主题曲」——避免误标「影视」盖住「游戏」 */
export function stripFilmWhenGameFranchiseText(tags: string[], haystack: string): string[] {
  if (
    !/原神|genshin|崩坏|崩壞|星穹|honkai|纸嫁衣|恋与深空|光与夜|王者荣耀|黑神话|mihoyo|genshin\s*impact|碧蓝航线|azur\s*lane/i.test(
      haystack,
    )
  ) {
    return tags;
  }
  return tags.filter(t => t !== '影视');
}

function dedupePreserveOrder(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of labels) {
    const t = x.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * If canonical says 游戏 IP, drop erroneous 「影视」 from seeds/auto unless text hints TV/film.
 */
export function stripFilmWhenGameCanonical(
  tags: string[],
  canonicalArtistId: string | undefined,
  haystack: string,
): string[] {
  const gameCanon = canonicalArtistId && GAME_PROJECT_IDS.has(canonicalArtistId);
  if (!gameCanon) return tags;
  const filmOk =
    /电视剧|电影|影片|卫视|央视|网剧|纪录片|综艺(?!选秀)|ost.*剧|影视原声/i.test(haystack) ||
    /我的人间烟火|人间烟火/.test(haystack);
  if (filmOk) return tags;
  return tags.filter(t => t !== '影视');
}

const TAG_ORDER: string[] = [
  '华语流行',
  '韩流流行',
  '日韩流行',
  '日系流行',
  '欧美流行',
  '影视',
  '动漫',
  '游戏',
  '纯音乐',
];

/** Labels that normalize to filter keys via category-keys (avoid dropping unknown language labels). */
const KNOWN_LANGUAGE_LABELS = new Set([
  '华语流行',
  '韩流流行',
  '日韩流行',
  '日系流行',
  '欧美流行',
]);

function sortTagsForDisplay(tags: string[]): string[] {
  const idx = (t: string) => {
    const i = TAG_ORDER.indexOf(t);
    return i === -1 ? 100 : i;
  };
  return [...tags].sort((a, b) => idx(a) - idx(b) || a.localeCompare(b, 'zh-Hans'));
}

/**
 * Merge language primary + seed tags + computed + inferred; dedupe; strip conflicting 影视 for game IPs.
 */
function languageTagFromDictionaryNationality(nat: string | undefined): string | undefined {
  if (nat === 'zh') return '华语流行';
  if (nat === 'kr') return '韩流流行';
  if (nat === 'jp') return '日系流行';
  if (nat === 'en') return '欧美流行';
  return undefined;
}

export function mergeTrackCategoryLabels(input: {
  primaryLanguageLabel: string;
  languageCategoryKey: string;
  seedTags: string[];
  computedTagsFromArtist: string[];
  canonicalArtistId: string | undefined;
  displayTitle: string;
  originalArtist: string;
  youtubeVideoTitle: string | null | undefined;
  slug: string | undefined;
  /** When ok and dictionary has nationality, drop wrong language labels from seeds (e.g. 华语 + JP artist). */
  artistReviewStatus?: ArtistReviewStatus;
}): { displayTags: string[]; filterKeys: string[] } {
  const haystack = [
    input.displayTitle,
    input.originalArtist,
    input.youtubeVideoTitle || '',
    input.slug || '',
  ].join(' ');

  let merged = dedupePreserveOrder([
    ...input.seedTags,
    ...input.computedTagsFromArtist,
    ...inferLabelsFromCanonicalArtistId(input.canonicalArtistId),
    ...inferLabelsFromHaystack(haystack),
  ]);

  merged = stripFilmWhenGameCanonical(merged, input.canonicalArtistId, haystack);
  merged = stripFilmWhenGameFranchiseText(merged, haystack);

  const dictNat =
    input.artistReviewStatus === 'ok' && input.canonicalArtistId
      ? ARTIST_DICTIONARY[input.canonicalArtistId]?.nationality
      : undefined;
  const canonLang = languageTagFromDictionaryNationality(dictNat);
  const languagePrimary = canonLang ?? input.primaryLanguageLabel;

  const nonLang = merged.filter(t => !KNOWN_LANGUAGE_LABELS.has(t));
  merged = dedupePreserveOrder([languagePrimary, ...nonLang]);
  merged = sortTagsForDisplay(merged);

  const filterKeys = new Set<string>();
  if (canonLang) {
    const k = normalizeCategoryKeyStatic(languagePrimary);
    if (k) filterKeys.add(k);
  } else {
    filterKeys.add(input.languageCategoryKey);
  }
  for (const label of merged) {
    const k = normalizeCategoryKeyStatic(label);
    if (k) filterKeys.add(k);
  }

  return {
    displayTags: merged,
    filterKeys: Array.from(filterKeys),
  };
}
