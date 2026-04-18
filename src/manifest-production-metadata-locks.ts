/**
 * Production（Supabase）曲目在写入 manifest 前，合并 `LOCAL_IMPORT_METADATA_OVERRIDES` 中同 slug 的修正，
 * 使艺人/分类/链接/标题等以仓库内 overrides 为 source of truth，而不被仅存在于远端库的旧字段覆盖。
 *
 * 优先级：`src/data/catalog-overrides.ts`（在 `trackToManifestEntry` 内最后再次套用）> 本层 > Supabase 原始行。
 */
import type { Track } from './types/track';
import { LOCAL_IMPORT_METADATA_OVERRIDES } from './local-import-metadata-overrides';

export function applyProductionMetadataLocks(track: Track): Track {
  if (track.importSource !== 'remote') return track;
  const slug = track.metadata?.identity?.slug;
  if (!slug) return track;
  const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug];
  if (!ov) return track;

  const nextMeta = { ...track.metadata };
  const nextDisplay = { ...nextMeta.display };
  const nextLinks = { ...nextMeta.links };
  const nextAssets = { ...nextMeta.assets };

  if (ov.title != null && ov.title !== '') {
    nextDisplay.title = ov.title;
  }
  if (ov.displayTitle != null && ov.displayTitle !== '') {
    nextDisplay.displayTitle = ov.displayTitle;
  }
  if (ov.titles) {
    nextDisplay.titles = { ...nextDisplay.titles, ...ov.titles };
  }
  if (ov.artist != null && ov.artist !== '') {
    nextDisplay.artist = ov.artist;
  }
  if (ov.artists) {
    nextDisplay.artists = { ...ov.artists };
  }
  if (ov.category != null && ov.category !== '') {
    nextDisplay.category = ov.category;
  }
  if (ov.categoryTags != null && ov.categoryTags.length > 0) {
    const primary = ov.category ?? ov.categoryTags[0] ?? nextDisplay.categories?.primary ?? track.category;
    nextDisplay.categories = {
      primary,
      tags: [...ov.categoryTags],
    };
  }
  if (ov.workProjectKey) {
    nextDisplay.workProjectKey = ov.workProjectKey;
  }
  if (ov.cover) {
    nextDisplay.cover = ov.cover;
  }

  if (ov.links) {
    const L = ov.links;
    if (L.youtube != null) nextLinks.youtube = L.youtube;
    if (L.video != null) nextLinks.video = L.video;
    if (L.bilibili != null) nextLinks.bilibili = L.bilibili;
    if (L.noSheet) {
      nextLinks.sheet = undefined;
      nextLinks.noSheet = true;
    } else if (L.sheet != null) {
      nextLinks.sheet = L.sheet;
    }
    if (L.noExternalVideo) nextLinks.noExternalVideo = true;
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
  if (ov.cover) coverUrl = ov.cover;
  if (ov.artist != null && ov.artist !== '') sourceArtist = ov.artist;
  if ((ov.displayTitle != null && ov.displayTitle !== '') || (ov.title != null && ov.title !== '')) {
    sourceSongTitle = ov.displayTitle ?? ov.title ?? sourceSongTitle;
  }
  if (ov.workProjectKey) workProjectKey = ov.workProjectKey;

  const practiceEnabled = Boolean(
    nextAssets.audioUrl && nextAssets.midiUrl && nextAssets.musicxmlUrl,
  );
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
