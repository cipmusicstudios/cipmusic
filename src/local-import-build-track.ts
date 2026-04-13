import type { Track } from './types/track';
import { LOCAL_IMPORT_SEEDS } from './local-import-seeds.generated';
import { LOCAL_IMPORT_METADATA_OVERRIDES } from './local-import-metadata-overrides';
import { LOCAL_IMPORT_CIP_LINKS } from './local-import-cip-links.generated';
import {
  buildLocalImportAutoDisplay,
  buildLocalImportAutoEnrichment,
  buildLocalImportAutoLinks,
  INTENTIONAL_NO_SHEET_SLUGS,
} from './local-import-metadata-auto';
import { formatDurationLabel } from './duration-utils';

export { formatDurationLabel } from './duration-utils';

export const inferLocalImportTitle = (seed: (typeof LOCAL_IMPORT_SEEDS)[number]) =>
  seed.titleOverride || seed.slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export const getPreferredLocalImportMatchTitle = (
  seed: (typeof LOCAL_IMPORT_SEEDS)[number],
  inferredTitle: string,
  metadataOverride?: (typeof LOCAL_IMPORT_METADATA_OVERRIDES)[string],
) =>
  metadataOverride?.title ||
  metadataOverride?.titles?.zhHans ||
  metadataOverride?.titles?.zhHant ||
  inferredTitle ||
  seed.titleOverride ||
  seed.slug;

export const buildLocalImportTrack = (seed: (typeof LOCAL_IMPORT_SEEDS)[number]): Track => {
  const s = seed as typeof seed & { midiFile?: string; musicxmlFile?: string };
  const baseUrl = `/local-imports/${seed.slug}`;
  const audioUrl = `${baseUrl}/${seed.audioFile}`;
  const midiUrl = s.midiFile ? `${baseUrl}/${s.midiFile}` : undefined;
  const musicxmlUrl = s.musicxmlFile ? `${baseUrl}/${s.musicxmlFile}` : undefined;
  const practiceEnabled = Boolean(audioUrl && midiUrl && musicxmlUrl);
  const durationSeconds = (seed as { durationSeconds?: number | null }).durationSeconds ?? null;
  const durationLabel = formatDurationLabel(durationSeconds);
  const inferredTitle = inferLocalImportTitle(seed);
  const metadataOverride = LOCAL_IMPORT_METADATA_OVERRIDES[seed.slug];
  const autoEnrichment = buildLocalImportAutoEnrichment(seed.slug, metadataOverride);
  const autoDisplay = buildLocalImportAutoDisplay(seed, inferredTitle, autoEnrichment, metadataOverride);
  const matchTitle = getPreferredLocalImportMatchTitle(seed, inferredTitle, metadataOverride);
  const autoLinks = buildLocalImportAutoLinks(seed.slug, matchTitle, metadataOverride);
  const effectiveTitle = autoDisplay.displayTitle || autoDisplay.title;
  const effectiveArtist = autoDisplay.artist;
  const effectiveCategory = autoDisplay.category;
  const inferredCoverUrl = autoDisplay.cover;
  const effectiveCategoryTags = metadataOverride?.categoryTags || autoEnrichment.mappedTags || [];

  const cipLinks = (LOCAL_IMPORT_CIP_LINKS as any)[seed.slug];

  const workProjectKey = metadataOverride?.workProjectKey;

  const track: Track & {
    _cipMatchedVideoTitle?: string;
    _cipLinkConfidence?: string;
    _cipLinkReviewReason?: string;
  } = {
    id: seed.id,
    title: effectiveTitle,
    artist: effectiveArtist,
    category: effectiveCategory,
    tags: effectiveCategoryTags,
    duration: durationLabel,
    audioUrl,
    coverUrl: inferredCoverUrl,
    youtubeUrl: autoLinks.youtube,
    bilibiliUrl: autoLinks.bilibili,
    sheetUrl: autoLinks.sheet,
    musicxmlUrl,
    midiUrl,
    practiceEnabled,
    metadataStatus: 'manual',
    sourceSongTitle: effectiveTitle,
    sourceArtist: effectiveArtist,
    metadataSource: metadataOverride ? 'local-import-manual' : 'local-import-auto',
    metadataConfidence: 1,
    importSource: 'local',
    workProjectKey,
    _cipMatchedVideoTitle:
      metadataOverride?.matchedVideoTitle ??
      (metadataOverride?.links?.noExternalVideo ? undefined : cipLinks?.matchedVideoTitle) ??
      undefined,
    _cipLinkConfidence: cipLinks?.cipLinkConfidence,
    _cipLinkReviewReason: cipLinks?.cipLinkReviewReason,
    metadata: {
      identity: {
        id: seed.id,
        slug: seed.slug,
        importSource: 'local',
      },
      display: {
        title: autoDisplay.title,
        displayTitle: autoDisplay.displayTitle,
        titles: autoDisplay.titles,
        artist: effectiveArtist,
        artists: autoDisplay.artists,
        normalizedArtistsInfo: autoDisplay.normalizedArtistsInfo,
        category: effectiveCategory,
        categories: {
          primary: effectiveCategory,
          tags: effectiveCategoryTags,
        },
        cover: inferredCoverUrl,
        workProjectKey,
      },
      assets: {
        audioUrl,
        midiUrl,
        musicxmlUrl,
        hasPracticeAssets: practiceEnabled,
        practiceEnabled,
        duration: durationSeconds,
        durationLabel,
      },
      links: {
        youtube: autoLinks.youtube,
        video: autoLinks.video,
        sheet: autoLinks.sheet,
        bilibili: autoLinks.bilibili,
        noSheet: Boolean(metadataOverride?.links?.noSheet) || INTENTIONAL_NO_SHEET_SLUGS.has(seed.slug),
      },
      enrichment: {
        status: metadataOverride ? 'manual' : 'seed',
        titleSource: metadataOverride?.displayTitle || metadataOverride?.title ? 'manual' : 'slug',
        artistSource: metadataOverride?.artist ? 'manual' : autoEnrichment.artist ? 'auto' : undefined,
        categorySource: metadataOverride?.category ? 'manual' : autoEnrichment.mappedCategory ? 'auto' : undefined,
        coverSource: metadataOverride?.cover ? 'manual' : autoEnrichment.cover ? 'auto' : undefined,
        linksSource: metadataOverride?.links ? 'manual' : 'auto',
        rawCategory: autoEnrichment.rawCategory,
        mappedCategory: autoEnrichment.mappedCategory,
        mappedTags: autoEnrichment.mappedTags,
      },
    },
  };

  return track;
};
