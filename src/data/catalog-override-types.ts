/**
 * Catalog 锁定层类型（供 `catalog-overrides.ts` / `catalog-overrides-locked.ts` 共享，避免循环依赖）。
 */

export type CatalogLocalizedTitles = {
  zhHans?: string;
  zhHant?: string;
  en?: string;
};

export type CatalogLocalizedArtists = {
  zhHans?: string;
  zhHant?: string;
  en?: string;
};

/** 与 legacy `links` 对齐的锁定外链字段 */
export type CatalogLinksOverride = {
  youtube?: string;
  video?: string;
  sheet?: string;
  bilibili?: string;
  noSheet?: boolean;
  noExternalVideo?: boolean;
};

/** 单条曲目的锁定修正（字段均为可选；出现的字段即表示人工确认，覆盖自动结果） */
export type CatalogOverride = {
  title?: string;
  displayTitle?: string;
  titles?: CatalogLocalizedTitles;
  /** 列表/详情主展示用原唱字符串 */
  artist?: string;
  artists?: CatalogLocalizedArtists;
  category?: string;
  categoryTags?: string[];
  workProjectKey?: string;
  links?: CatalogLinksOverride;
  /** 覆盖 CIP / 上下文中的视频标题提示 */
  matchedVideoTitle?: string;
  /**
   * 锁定 canonical 解析结果（覆盖 `resolveCanonicalArtist` 的输出）。
   * 仅在少数无法仅靠 `artist` 字符串表达时使用。
   */
  canonicalArtistId?: string;
  coCanonicalArtistIds?: string[];
  canonicalArtistDisplayName?: string;
  artistReviewStatus?: 'ok' | 'needsReview' | 'unknown';
  /** 锁定封面 URL（非音频资源） */
  coverUrl?: string;
  /**
   * 强制「Newest」排序用毫秒时间戳（应大于常规 YouTube 上传时间），仅少数新歌置顶时使用。
   * manifest 构建时会写入 `listSortSource: 'catalog_override'`。
   */
  listSortPublishedAtMs?: number;
};
