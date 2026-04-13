import type { Track } from './types/track';

export const normalizeTextStatic = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
};

export const normalizeSearchStatic = (value: unknown) =>
  normalizeTextStatic(value).trim().toLowerCase();

const CATEGORY_KEY_ALIASES_STATIC: Record<string, string[]> = {
  cpop: ['华语流行', '华語流行', 'cpop', 'c-pop', 'mandopop', 'mandarin pop', 'chinese pop'],
  kpop: ['韩流流行', '韓流流行', 'kpop', 'k-pop', 'korean pop'],
  jpop: ['日系流行', '日韩流行', 'jpop', 'j-pop', 'japanese pop'],
  western: ['欧美流行', '歐美流行', 'western', 'western pop', 'pop', 'rock'],
  anime: ['动漫', '動畫', 'anime', 'anime soundtrack', 'anime film soundtrack'],
  film: ['影视', '影視', 'film', 'movie', 'soundtrack', 'ost'],
  game: ['游戏', '遊戲', 'game', 'game soundtrack'],
  instrumental: ['纯音乐', '純音樂', 'instrumental', 'piano', 'solo piano'],
  originals: ['originals', 'original', '原创', '原創'],
};

export const CATEGORY_KEY_LOOKUP_STATIC = Object.entries(CATEGORY_KEY_ALIASES_STATIC).reduce<Record<string, string>>(
  (acc, [key, aliases]) => {
    aliases.forEach(alias => {
      acc[normalizeSearchStatic(alias)] = key;
    });
    return acc;
  },
  {},
);

export const normalizeCategoryKeyStatic = (value: unknown) => {
  const normalized = normalizeSearchStatic(value);
  return CATEGORY_KEY_LOOKUP_STATIC[normalized] || normalized.replace(/[^a-z0-9\u3400-\u9fff]+/g, '');
};

export const getTrackCategoryKeysStatic = (track: Track): string[] => {
  const categories = track.metadata.display.categories;
  const rawValues = [
    categories?.primary,
    ...(categories?.tags || []),
    track.category,
    ...(Array.isArray(track.tags) ? track.tags : []),
    track.metadata.enrichment?.mappedCategory,
  ].filter(Boolean);
  const fromFields = Array.from(
    new Set(rawValues.map(value => normalizeCategoryKeyStatic(value)).filter(Boolean)),
  );
  const fromManifest = track.categoryFilterKeys || [];
  return Array.from(new Set([...fromManifest, ...fromFields]));
};

export const getTrackPrimaryCategoryKeyStatic = (track: Track) =>
  normalizeCategoryKeyStatic(track.metadata.display.categories?.primary || track.category);

/** Compute filter keys for manifest (build time). */
export const computeCategoryFilterKeysForTrack = (track: Track): string[] => {
  if (track.categoryFilterKeys?.length) return track.categoryFilterKeys;
  return getTrackCategoryKeysStatic(track);
};

export const getCoverThumbnailUrl = (url: string | undefined) => {
  if (!url) return 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?q=80&w=200&auto=format&fit=crop';
  return url.replace(/\/\d+x\d+bb\.jpg$/, '/100x100bb.jpg');
};

/** Multi-label context tags (ZH) → English row labels for the song list */
export const DISPLAY_TAG_EN_BY_ZH: Record<string, string> = {
  华语流行: 'C-pop',
  韩流流行: 'K-pop',
  日系流行: 'J-pop',
  日韩流行: 'J-pop',
  欧美流行: 'Western',
  影视: 'Film',
  动漫: 'Anime',
  游戏: 'Game',
  纯音乐: 'Instrumental',
};
