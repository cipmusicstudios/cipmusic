/**
 * 人工修正锁定层（Catalog Overrides）
 * ────────────────────────────────────
 * **唯一优先的人工锁定数据** 在 `catalog-overrides-locked.ts`（静态字面量），**不**从
 * `local-import-metadata-overrides` 或 `TRACK_CANONICAL_BY_ID` 运行时派生。
 *
 * 优先级（固定）：
 * 1. 本模块导出的 `CATALOG_OVERRIDES_BY_SLUG` / `CATALOG_OVERRIDES_BY_TRACK_ID`（来自 locked 文件）
 * 2. `LOCAL_IMPORT_METADATA_OVERRIDES`（legacy，仅作补充；与 1 冲突时以 1 为准——manifest 管线最后套用 catalog）
 * 3. 远端/种子显式字段
 * 4. 自动推断
 *
 * **新纠错**：只改 `catalog-overrides-locked.ts`（必要时可先跑
 * `npx tsx scripts/generate-catalog-overrides-locked.ts` 再手调合并）。
 *
 * **不会** 通过本层覆盖：音频 URL、MIDI、MusicXML、duration 秒数、Practice 资源路径。
 *
 * 应用点：`applyCatalogOverridesToTrack` → `trackToManifestEntry`、`buildLocalImportTrack`。
 */

import type { Track } from '../types/track';
import type { CatalogLinksOverride, CatalogOverride } from './catalog-override-types';
import {
  CATALOG_OVERRIDES_BY_SLUG,
  CATALOG_OVERRIDES_BY_TRACK_ID,
} from './catalog-overrides-locked';

export type {
  CatalogLocalizedTitles,
  CatalogLocalizedArtists,
  CatalogLinksOverride,
  CatalogOverride,
} from './catalog-override-types';

export { CATALOG_OVERRIDES_BY_SLUG, CATALOG_OVERRIDES_BY_TRACK_ID };

function mergeCatalogLinks(
  a?: CatalogLinksOverride,
  b?: CatalogLinksOverride,
): CatalogLinksOverride | undefined {
  if (!a && !b) return undefined;
  const L = { ...a, ...b } as NonNullable<CatalogLinksOverride>;
  if (b?.noSheet) {
    L.sheet = undefined;
    L.noSheet = true;
  }
  return L;
}

/** slug + trackId 合并规则与 `getCatalogOverrideForTrack` 一致（供 manifest 构建等无完整 Track 场景）。 */
export function getMergedCatalogOverride(
  slug: string | undefined,
  trackId: string | undefined,
): CatalogOverride | undefined {
  const bySlug = slug ? CATALOG_OVERRIDES_BY_SLUG[slug] : undefined;
  const byId = trackId ? CATALOG_OVERRIDES_BY_TRACK_ID[trackId] : undefined;
  if (!bySlug && !byId) return undefined;

  const a: CatalogOverride = byId ?? {};
  const b: CatalogOverride = bySlug ?? {};
  return {
    ...a,
    ...b,
    titles: { ...a.titles, ...b.titles },
    artists: { ...a.artists, ...b.artists },
    categoryTags: b.categoryTags?.length ? b.categoryTags : a.categoryTags,
    canonicalArtistId: b.canonicalArtistId ?? a.canonicalArtistId,
    coCanonicalArtistIds: b.coCanonicalArtistIds ?? a.coCanonicalArtistIds,
    canonicalArtistDisplayName: b.canonicalArtistDisplayName ?? a.canonicalArtistDisplayName,
    artistReviewStatus: b.artistReviewStatus ?? a.artistReviewStatus,
    links: mergeCatalogLinks(a.links, b.links),
    listSortPublishedAtMs: b.listSortPublishedAtMs ?? a.listSortPublishedAtMs,
  };
}

export function getCatalogOverrideForTrack(track: Track): CatalogOverride | undefined {
  return getMergedCatalogOverride(track.metadata?.identity?.slug, track.id);
}

/**
 * 将人工锁定层应用到 `Track` 副本。**不改变**音频/MIDI/XML/duration 等资源字段。
 */
export function applyCatalogOverridesToTrack(track: Track): Track {
  const ov = getCatalogOverrideForTrack(track);
  if (!ov) return track;

  const nextMeta = { ...track.metadata };
  const nextDisplay = { ...nextMeta.display };
  const nextLinks = { ...nextMeta.links };
  const nextAssets = { ...nextMeta.assets };

  if (ov.title != null && ov.title !== '') nextDisplay.title = ov.title;
  if (ov.displayTitle != null && ov.displayTitle !== '') nextDisplay.displayTitle = ov.displayTitle;
  if (ov.titles) nextDisplay.titles = { ...nextDisplay.titles, ...ov.titles };
  if (ov.artist != null && ov.artist !== '') nextDisplay.artist = ov.artist;
  if (ov.artists) nextDisplay.artists = { ...ov.artists };
  if (ov.category != null && ov.category !== '') nextDisplay.category = ov.category;
  if (ov.categoryTags != null && ov.categoryTags.length > 0) {
    const primary = ov.category ?? ov.categoryTags[0] ?? nextDisplay.categories?.primary ?? track.category;
    nextDisplay.categories = { primary, tags: [...ov.categoryTags] };
  }
  if (ov.workProjectKey) nextDisplay.workProjectKey = ov.workProjectKey;
  if (ov.coverUrl) nextDisplay.cover = ov.coverUrl;

  if (ov.links) {
    const L = ov.links;
    if (L.noExternalVideo) nextLinks.noExternalVideo = true;
    if (L.youtube != null) nextLinks.youtube = L.youtube;
    if (L.video != null) nextLinks.video = L.video;
    if (L.bilibili != null) nextLinks.bilibili = L.bilibili;
    if (L.noSheet) {
      nextLinks.sheet = undefined;
      nextLinks.noSheet = true;
    } else if (L.sheet != null) nextLinks.sheet = L.sheet;
  }

  if (typeof ov.listSortPublishedAtMs === 'number' && Number.isFinite(ov.listSortPublishedAtMs)) {
    nextMeta.enrichment = {
      ...nextMeta.enrichment,
      listSortPublishedAtMs: ov.listSortPublishedAtMs,
      listSortPublishedAt: new Date(ov.listSortPublishedAtMs).toISOString(),
      listSortSource: 'catalog_override',
    };
  }

  nextMeta.display = nextDisplay;
  nextMeta.links = nextLinks;
  nextMeta.assets = nextAssets;

  let title = track.title;
  let artist = track.artist;
  let category = track.category;
  let tags = track.tags;
  let youtubeUrl = track.youtubeUrl;
  let bilibiliUrl = track.bilibiliUrl;
  let sheetUrl = track.sheetUrl;
  let coverUrl = track.coverUrl;
  let sourceArtist = track.sourceArtist;
  let sourceSongTitle = track.sourceSongTitle;
  let workProjectKey = track.workProjectKey;

  if (ov.title != null && ov.title !== '') title = ov.title;
  if (ov.artist != null && ov.artist !== '') artist = ov.artist;
  if (ov.category != null && ov.category !== '') category = ov.category;
  if (ov.categoryTags != null && ov.categoryTags.length > 0) tags = [...ov.categoryTags];
  if (ov.links?.youtube != null) youtubeUrl = ov.links.youtube;
  if (ov.links?.bilibili != null) bilibiliUrl = ov.links.bilibili;
  if (ov.links?.noSheet) sheetUrl = undefined;
  else if (ov.links?.sheet != null) sheetUrl = ov.links.sheet;
  if (ov.coverUrl) coverUrl = ov.coverUrl;
  if (ov.artist != null && ov.artist !== '') sourceArtist = ov.artist;
  if ((ov.displayTitle != null && ov.displayTitle !== '') || (ov.title != null && ov.title !== '')) {
    sourceSongTitle = ov.displayTitle ?? ov.title ?? sourceSongTitle;
  }
  if (ov.workProjectKey) workProjectKey = ov.workProjectKey;

  /**
   * Phase C: 不要在 catalog-override 层重算 `practiceEnabled`。
   *
   * 历史代码用 `audioUrl && midiUrl && musicxmlUrl` 来推 `practiceEnabled`，
   * 这套在 Phase A1/A2 之前还能工作（远端 Track 直接带 midiUrl / musicxmlUrl）。
   * Phase A2 收口后，anon SELECT 不再返回 `midi_url` / `musicxml_url`，
   * 远端 Track 的这两个字段在运行时永远是 `undefined`，
   * 一旦命中本层（如新导入 5 首歌的人工锁定）就会把 `practiceEnabled`
   * 静默改成 `false`，导致 Practice 按钮在 idle Supabase 替换后消失。
   *
   * 真正的 Practice 入口判定来源是 `songs.has_practice_mode` /
   * manifest 的 `hasPracticeMode`（mapper 已写入 `track.practiceEnabled`）；
   * 本层只能 pass-through，不要篡改。本层确实"不**通过本层**覆盖
   * Practice 资源路径"的契约（见本文件顶部注释 line 16）。
   *
   * 同时同步 `nextAssets.practiceEnabled` / `nextAssets.hasPracticeAssets`
   * 防止其它读取 metadata 的旧代码看到不一致的视图。
   */
  const practiceEnabled =
    typeof track.practiceEnabled === 'boolean'
      ? track.practiceEnabled
      : Boolean(nextAssets.audioUrl && nextAssets.midiUrl && nextAssets.musicxmlUrl);
  nextAssets.practiceEnabled = practiceEnabled;
  nextAssets.hasPracticeAssets = practiceEnabled;

  const out: Track = {
    ...track,
    title,
    artist,
    category,
    tags,
    youtubeUrl,
    bilibiliUrl,
    sheetUrl,
    coverUrl,
    sourceArtist,
    sourceSongTitle,
    workProjectKey,
    practiceEnabled,
    metadata: nextMeta,
  };

  if (ov.matchedVideoTitle) {
    (out as { _cipMatchedVideoTitle?: string })._cipMatchedVideoTitle = ov.matchedVideoTitle;
  }

  return out;
}
