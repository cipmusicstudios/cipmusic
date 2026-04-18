/**
 * Multi-label category inference: IP / source tags must persist alongside language tags.
 * Used at manifest build time (trackToManifestEntry).
 */

import type { ArtistReviewStatus } from './artist-canonical';
import { ARTIST_DICTIONARY } from './local-import-artist-normalization';
import { normalizeCategoryKeyStatic } from './category-keys';
import { CATALOG_OVERRIDES_BY_SLUG } from './data/catalog-overrides';

/** Seed / UI labels that map to filter buckets (language + source + style). */
export const SOURCE_TAG_LABELS = new Set(['影视', '动漫', '游戏', '纯音乐']);

/**
 * 少数曲目：艺人国籍桶与作品语境冲突（如 LoL 全球曲被标成华语、梗曲被标成华语等），
 * 在 manifest 合并时直接使用固定展示标签（与 `metadata.identity.slug` 一致）。
 */
const SLUG_EXACT_DISPLAY_TAGS: Record<string, string[]> = {
  Sacrifice: ['游戏'],
  黑神话悟空主题曲: ['游戏'],
  'masayume chasing': ['日系流行', '动漫'],
  哈基米: ['日系流行', '动漫'],
  /** 游戏梗改编 — 仅「游戏」桶，勿与影视 OST 混排。 */
  斗地主: ['游戏'],
  'GO!': ['韩流流行'],
  'dancing-alone': ['韩流流行'],
  style: ['韩流流行'],
  messy: ['韩流流行'],
  APT: ['韩流流行'],
  'good so bad': ['韩流流行'],
  'i do me': ['韩流流行'],
  "STAR WALKIN'": ['欧美流行', '游戏'],
  'empty love': ['欧美流行'],
  'normal no more': ['欧美流行'],
  calling: ['欧美流行'],
  /** 本轮分类纠错：精确标签覆盖 merge（与 slug 一致） */
  'call of silence': ['日系流行', '动漫'],
  celestial: ['欧美流行'],
  'dreams come true': ['韩流流行'],
  snake: ['韩流流行'],
  Utopia: ['韩流流行'],
  xoxo: ['韩流流行'],
  'the feels': ['韩流流行'],
  'take-down': ['韩流流行'],
  free: ['韩流流行'],
  新宝岛: ['日系流行'],
  'bye bye bye': ['欧美流行'],
  'Burn it all down': ['欧美流行', '游戏'],
  'Forever 1': ['韩流流行'],
  shine: ['韩流流行'],
  'who am i': ['影视'],
  恋人: ['华语流行'],
  摆脱地心引力: ['华语流行'],
  爱琴海: ['华语流行'],
  璀璨冒险人: ['华语流行', '动漫'],
  'pop star': ['韩流流行', '游戏'],
  擦肩: ['华语流行', '影视'],
  调查中: ['华语流行', '影视'],
  卿卿: ['华语流行', '影视'],
  年轮: ['华语流行', '影视'],
  不惜时光: ['华语流行', '影视'],
  彼岸: ['华语流行', '影视'],
  值此今生: ['华语流行', '影视'],
  寂静之忆: ['华语流行', '影视'],
  借过一下: ['华语流行', '影视'],
  烟火星辰: ['华语流行', '影视'],
  万里: ['华语流行', '影视'],
  敬太平: ['华语流行', '影视'],
  'coming-for-you': ['华语流行', '影视'],
  'you-are-the-sun-in-my-life': ['华语流行', '影视'],
  烽月: ['华语流行', '影视'],
  桂花谣: ['华语流行', '影视'],
  若仙: ['华语流行', '影视'],
  凝眸: ['华语流行', '影视'],
  门: ['华语流行', '影视'],
  新造的人: ['华语流行', '影视'],
  若梦: ['华语流行', '影视'],
  时间之海: ['华语流行', '影视'],
  我想我会: ['华语流行', '影视'],
  万物不如你: ['华语流行', '影视'],
  '就在江湖之上': ['华语流行', '影视'],
  明明: ['华语流行', '影视'],
  唯爱: ['华语流行', '影视'],
  云之羽: ['华语流行', '影视'],
  面壁者: ['华语流行', '影视'],
  孤勇者: ['华语流行', '游戏'],
  这样很好: ['华语流行', '游戏'],
  Lalisa: ['韩流流行'],
  /** 《流浪地球2》等 — 恢复影视标签 */
  人是: ['华语流行', '影视'],
  我对缘分小心翼翼: ['华语流行', '影视'],
};

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

/**
 * 显式 workProjectKey：作品归属某游戏 IP 时，除原分类外一律补「游戏」。
 * （与 canonical 艺人桶 inferLabelsFromCanonicalArtistId 并存，去重由 dedupe 处理。）
 */
const GAME_WORK_PROJECT_KEYS = new Set([
  'honor-of-kings',
  'league-of-legends',
  'honkai-star-rail',
  'love-and-deepspace',
  'love-and-producer',
  'black-myth-wukong',
  'paper-bride',
]);

function applyWorkProjectTagAugmentation(
  displayTags: string[],
  workProjectKey: string | undefined,
): string[] {
  if (!workProjectKey) return displayTags;
  let out = [...displayTags];
  if (GAME_WORK_PROJECT_KEYS.has(workProjectKey)) {
    out = dedupePreserveOrder([...out, '游戏']);
  }
  if (workProjectKey === 'kpop-demon-hunters') {
    out = dedupePreserveOrder([...out, '影视']);
  }
  return sortTagsForDisplay(out);
}

const NFKC = (s: string) => s.normalize('NFKC');

/**
 * Labels inferred only from resolved canonical id (authoritative for IP buckets).
 */
export function inferLabelsFromCanonicalArtistId(canonicalArtistId: string | undefined): string[] {
  if (!canonicalArtistId) return [];
  if (GAME_PROJECT_IDS.has(canonicalArtistId)) return ['游戏'];
  if (canonicalArtistId === 'league-of-legends') return ['游戏'];
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
  if (/英雄联盟|league\s*of\s*legends|worlds\s*20\d\d|worlds\s+anthem/i.test(s)) {
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
    !/原神|genshin|崩坏|星穹|honkai|纸嫁衣|恋与深空|光与夜|王者荣耀|黑神话|mihoyo|英雄联盟|league\s*of\s*legends|worlds\s*20\d\d/i.test(
      s,
    )
  ) {
    out.add('影视');
  }

  return Array.from(out);
}

/** 游戏 IP 稿件里常写「主题曲」——避免误标「影视」盖住「游戏」 */
export function stripFilmWhenGameFranchiseText(tags: string[], haystack: string): string[] {
  if (
    !/原神|genshin|崩坏|崩壞|星穹|honkai|纸嫁衣|恋与深空|光与夜|王者荣耀|黑神话|mihoyo|genshin\s*impact|碧蓝航线|azur\s*lane|英雄联盟|league\s*of\s*legends|worlds\s*20\d\d|worlds\s+anthem/i.test(
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
  /** 作品级来源；用于补「游戏」/ K-pop Demon Hunters 补「影视」等 */
  workProjectKey?: string;
  /** When ok and dictionary has nationality, drop wrong language labels from seeds (e.g. 华语 + JP artist). */
  artistReviewStatus?: ArtistReviewStatus;
}): { displayTags: string[]; filterKeys: string[] } {
  const slugKey = input.slug?.trim();
  /** 人工锁定层分类优先于代码内 SLUG_EXACT 表 */
  const catalogCat = slugKey ? CATALOG_OVERRIDES_BY_SLUG[slugKey]?.categoryTags : undefined;
  if (catalogCat?.length) {
    let displayTags = sortTagsForDisplay(dedupePreserveOrder(catalogCat));
    displayTags = applyWorkProjectTagAugmentation(displayTags, input.workProjectKey);
    const filterKeys = new Set<string>();
    for (const label of displayTags) {
      const k = normalizeCategoryKeyStatic(label);
      if (k) filterKeys.add(k);
    }
    return { displayTags, filterKeys: Array.from(filterKeys) };
  }
  if (slugKey && SLUG_EXACT_DISPLAY_TAGS[slugKey]) {
    let displayTags = sortTagsForDisplay(dedupePreserveOrder(SLUG_EXACT_DISPLAY_TAGS[slugKey]));
    displayTags = applyWorkProjectTagAugmentation(displayTags, input.workProjectKey);
    const filterKeys = new Set<string>();
    for (const label of displayTags) {
      const k = normalizeCategoryKeyStatic(label);
      if (k) filterKeys.add(k);
    }
    return { displayTags, filterKeys: Array.from(filterKeys) };
  }

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
  merged = applyWorkProjectTagAugmentation(merged, input.workProjectKey);

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
