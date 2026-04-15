/**
 * Build public/songs-manifest.json from production song rows (Node only).
 * Run after updating the Supabase `songs` table.
 *
 * Local-import fallback is still available via `MANIFEST_SOURCE=local` for offline
 * maintenance, but the default build path now uses the production catalog source.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { parseFile } from 'music-metadata';
import { LOCAL_IMPORT_SEEDS } from '../src/local-import-seeds.generated.ts';
import { buildLocalImportTrack } from '../src/local-import-build-track.ts';
import {
  trackToManifestEntry,
  buildArtistManifestFromSongs,
  assignManifestListSort,
  compareSongManifestEntriesByReleaseDesc,
} from '../src/songs-manifest.ts';
import type { Track } from '../src/types/track.ts';
import { formatDurationLabel, isBadDurationLabel } from '../src/duration-utils.ts';
import {
  applyArtistImageToManifestArtist,
  loadArtistImageOverrides,
} from './artist-image-shared.ts';
import type { ArtistImageKind } from '../src/artist-image-kind.ts';
import { enrichManifestEntriesWithYoutubeOrder } from './enrich-manifest-youtube-order.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outPath = path.join(projectRoot, 'public', 'songs-manifest.json');
const publicDir = path.join(projectRoot, 'public');
const artistOutPath = path.join(projectRoot, 'public', 'artist-manifest.json');

/** Local-first UI defaults must live in chunk 0 so first paint can resolve `setCurrentTrack`. */
const MANIFEST_CHUNK_TARGET = 96;
const MANIFEST_PRIORITY_TRACK_IDS = new Set(['soda_pop', 'golden_piano']);
const imagesCachePath = path.join(projectRoot, 'public', 'artist-images-cache.json');
const MANIFEST_SOURCE = (
  process.env.MANIFEST_SOURCE?.trim() ||
  (process.env.NETLIFY ? 'production' : 'local')
).toLowerCase();
const SUPABASE_SONGS_BUCKET = process.env.SUPABASE_SONGS_BUCKET?.trim() || 'songs';

const ASSET_BASE = process.env.VITE_ASSET_BASE_URL?.trim() || '';

type ImageCacheEntry = {
  url: string | null;
  source: string | null;
  confidence: number | null;
  imageKind?: ArtistImageKind | null;
};

type SupabaseSongRow = Record<string, unknown>;

type DisplayTitles = NonNullable<Track['metadata']['display']['titles']>;

/** 与 local manifest 同源：用 buildLocalImportTrack 抽出的 titles，按 slug / 中文标题 对齐 production 行。 */
let productionLocalTitleLookups: {
  bySlug: Map<string, DisplayTitles>;
  byZhTitle: Map<string, DisplayTitles>;
} | null = null;

function getProductionLocalTitleLookups() {
  if (productionLocalTitleLookups) return productionLocalTitleLookups;
  const bySlug = new Map<string, DisplayTitles>();
  const byZhTitle = new Map<string, DisplayTitles>();
  for (const seed of LOCAL_IMPORT_SEEDS) {
    const track = buildLocalImportTrack(seed);
    const raw = track.metadata.display.titles;
    if (!raw) continue;
    if (!raw.zhHans && !raw.zhHant && !raw.en) continue;
    const titles: DisplayTitles = { ...raw };
    bySlug.set(seed.slug, titles);
    const d = track.metadata.display;
    if (d.title?.trim()) byZhTitle.set(d.title.trim(), titles);
    const dt = d.displayTitle?.trim();
    if (dt && dt !== d.title?.trim()) byZhTitle.set(dt, titles);
  }
  productionLocalTitleLookups = { bySlug, byZhTitle };
  return productionLocalTitleLookups;
}

function loadImagesCache(): Record<string, ImageCacheEntry> {
  try {
    const raw = fs.readFileSync(imagesCachePath, 'utf8');
    return JSON.parse(raw) as Record<string, ImageCacheEntry>;
  } catch {
    return {};
  }
}

function getEnvValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function normalizeTrackId(id: string, audioUrl: string | undefined): string {
  if (!id.startsWith('local_')) return id;
  if (audioUrl && audioUrl.startsWith('/local-imports/')) return id;
  return id.replace(/^local_/, '');
}

function pickString(row: SupabaseSongRow, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pickNumber(row: SupabaseSongRow, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return undefined;
}

function toPublicStorageUrl(supabaseUrl: string, bucket: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  const cleanBase = supabaseUrl.replace(/\/$/, '');
  const cleanBucket = bucket.replace(/^\/+|\/+$/g, '');
  const cleanPath = value.replace(/^\/+/, '');
  return `${cleanBase}/storage/v1/object/public/${cleanBucket}/${cleanPath}`;
}

function mapSupabaseSongRowToTrack(row: SupabaseSongRow, supabaseUrl: string): Track | null {
  const rawId = pickString(row, 'id');
  const title = pickString(row, 'title');
  const artist = pickString(row, 'artist');
  const isPublished = row.is_published === true;
  if (!isPublished) return null;
  const audioUrl = toPublicStorageUrl(
    supabaseUrl,
    SUPABASE_SONGS_BUCKET,
    pickString(row, 'audio_url', 'audio_path', 'mp3_url'),
  );
  const coverUrl = pickString(row, 'cover_url') || '';
  const durationSeconds = pickNumber(row, 'duration_seconds', 'durationSeconds');
  const durationLabel = pickString(row, 'duration', 'duration_label') || (durationSeconds ? formatDurationLabel(durationSeconds) : '00:00');
  const midiUrl = toPublicStorageUrl(supabaseUrl, SUPABASE_SONGS_BUCKET, pickString(row, 'midi_url', 'midi_path'));
  const musicxmlUrl = toPublicStorageUrl(supabaseUrl, SUPABASE_SONGS_BUCKET, pickString(row, 'musicxml_url', 'xml_path', 'music_xml_url'));
  if (!rawId || !title || !artist || !audioUrl) return null;
  if (audioUrl.includes('/local-imports/')) return null;
  const id = normalizeTrackId(rawId, audioUrl);
  const primaryCategory = pickString(row, 'primary_category') || 'Originals';
  const secondaryCategory = row.secondary_category;
  const tags = Array.isArray(secondaryCategory)
    ? secondaryCategory.filter((value): value is string => typeof value === 'string')
    : [];
  const slug = pickString(row, 'slug') || id;
  const { bySlug, byZhTitle } = getProductionLocalTitleLookups();
  const fromLocal = bySlug.get(slug) || (title ? byZhTitle.get(title.trim()) : undefined);
  const titles: DisplayTitles | undefined = fromLocal ? { ...fromLocal } : undefined;

  return {
    id,
    title,
    artist,
    category: primaryCategory,
    tags,
    duration: durationLabel,
    audioUrl,
    coverUrl,
    youtubeUrl: pickString(row, 'youtube_url') || undefined,
    sheetUrl: pickString(row, 'sheet_url') || undefined,
    midiUrl: midiUrl || undefined,
    musicxmlUrl: musicxmlUrl || undefined,
    practiceEnabled: Boolean(audioUrl && midiUrl && musicxmlUrl),
    metadataStatus: (pickString(row, 'metadata_status') as Track['metadataStatus']) || 'approved',
    sourceSongTitle: pickString(row, 'source_song_title') || title,
    sourceArtist: pickString(row, 'source_artist') || artist,
    sourceCoverUrl: pickString(row, 'source_cover_url') || undefined,
    sourceAlbum: pickString(row, 'source_album') || undefined,
    sourceReleaseYear: pickString(row, 'source_release_year') || undefined,
    sourceCategory: pickString(row, 'source_category') || undefined,
    sourceGenre: pickString(row, 'source_genre') || undefined,
    metadataSource: pickString(row, 'metadata_source') || 'production-manifest',
    metadataConfidence: pickNumber(row, 'metadata_confidence') ?? 1,
    metadataCandidates: Array.isArray(row.metadata_candidates) ? (row.metadata_candidates as Track['metadataCandidates']) : undefined,
    importSource: 'remote',
    metadata: {
      identity: {
        id,
        slug,
        importSource: 'remote',
      },
      display: {
        title,
        artist,
        category: primaryCategory,
        categories: {
          primary: primaryCategory,
          tags,
        },
        cover: coverUrl,
        ...(titles ? { titles } : {}),
      },
      assets: {
        audioUrl,
        midiUrl,
        musicxmlUrl,
        hasPracticeAssets: Boolean(audioUrl && midiUrl && musicxmlUrl),
        practiceEnabled: Boolean(audioUrl && midiUrl && musicxmlUrl),
        duration: durationSeconds ?? null,
        durationLabel,
      },
      links: {
        youtube: pickString(row, 'youtube_url') || undefined,
        sheet: pickString(row, 'sheet_url') || undefined,
      },
      enrichment: {
        status: pickString(row, 'metadata_status') === 'approved' ? 'auto' : 'manual',
      },
    },
  };
}

async function loadProductionTracks(): Promise<Track[]> {
  const supabaseUrl = getEnvValue('VITE_SUPABASE_URL', 'SUPABASE_URL');
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase service-role env vars for production manifest build.');
  }
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
  const { data, error } = await supabase.from('songs').select('*');
  if (error) throw error;
  const tracks = (data ?? [])
    .map(row => mapSupabaseSongRowToTrack(row as SupabaseSongRow, supabaseUrl))
    .filter((track): track is Track => Boolean(track));
  const rejectedLocalAudio = tracks.filter(track => track.audioUrl.includes('/local-imports/'));
  if (rejectedLocalAudio.length > 0) {
    throw new Error(`Production catalog still contains ${rejectedLocalAudio.length} local-import audio rows.`);
  }
  const badDuration = tracks.filter(track => isBadDurationLabel(track.duration));
  if (badDuration.length > 0) {
    throw new Error(`Production catalog still contains ${badDuration.length} tracks with invalid duration labels.`);
  }
  return tracks;
}

async function loadLocalImportTracks(): Promise<Track[]> {
  let tracks = LOCAL_IMPORT_SEEDS.map(buildLocalImportTrack);
  console.log('[build-songs-manifest] Probing MP3 durations (local imports)…');
  tracks = await enrichAllTracks(tracks, projectRoot, 8);
  return tracks;
}

function ffprobeDurationSeconds(fsPath: string): number | null {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', fsPath],
      { encoding: 'utf8', maxBuffer: 2_000_000 },
    ).trim();
    const n = Number.parseFloat(out);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function enrichDurationFromMp3(track: Track, root: string): Promise<Track> {
  if (!track.audioUrl?.startsWith('/local-imports/')) return track;
  const fsPath = path.join(root, 'public', track.audioUrl.replace(/^\//, ''));
  if (!fs.existsSync(fsPath)) return track;
  try {
    const meta = await parseFile(fsPath);
    let sec = meta.format.duration;
    /** 部分 MP3 的容器/标签会给出错误总时长；ffprobe 与 music-metadata 差 >3s 时以 ffprobe 为准。 */
    const ff = ffprobeDurationSeconds(fsPath);
    if (ff != null && ff > 0) {
      if (!Number.isFinite(sec) || sec == null || sec <= 0 || Math.abs(sec - ff) > 3) {
        sec = ff;
      }
    } else if (!Number.isFinite(sec) || sec == null || sec <= 0) {
      sec = undefined;
    }
    if (!Number.isFinite(sec) || sec == null || sec <= 0) return track;
    const label = formatDurationLabel(sec);
    return {
      ...track,
      duration: label,
      metadata: {
        ...track.metadata,
        assets: {
          ...track.metadata.assets,
          duration: sec,
          durationLabel: label,
        },
      },
    };
  } catch {
    return track;
  }
}

async function enrichAllTracks(tracks: Track[], root: string, concurrency = 8): Promise<Track[]> {
  const out = tracks.slice();
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= out.length) break;
      out[i] = await enrichDurationFromMp3(out[i], root);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, out.length || 1) }, () => worker()));
  return out;
}

async function main() {
  const tracks = MANIFEST_SOURCE === 'local' ? await loadLocalImportTracks() : await loadProductionTracks();

  const beforeBad = tracks.filter(t => t.importSource === 'local' && t.practiceEnabled && isBadDurationLabel(t.duration));
  let entries = tracks.map(t => trackToManifestEntry(t, ASSET_BASE));
  const ytEnrich = enrichManifestEntriesWithYoutubeOrder(entries, { verbose: true, projectRoot });
  entries = ytEnrich.entries.map(assignManifestListSort);
  entries.sort(compareSongManifestEntriesByReleaseDesc);
  const sortYtPub = entries.filter(e => e.listSortSource === 'youtube_published').length;
  const sortYtIdx = entries.filter(e => e.listSortSource === 'youtube_channel_index').length;
  const sortFb = entries.filter(e => e.listSortSource === 'fallback_no_youtube_order').length;
  console.log(
    `[build-songs-manifest] YouTube channel order: id=${ytEnrich.stats.matchedById} title≈${ytEnrich.stats.matchedByTitle} unmatched=${ytEnrich.stats.unmatched}`,
  );
  console.log(
    `[build-songs-manifest] listSort: youtube_published=${sortYtPub} youtube_channel_index=${sortYtIdx} fallback_no_youtube_order=${sortFb} (tracks array sorted newest-first)`,
  );
  const generatedAt = new Date().toISOString();

  let firstChunkSize = MANIFEST_CHUNK_TARGET;
  for (let i = 0; i < entries.length; i++) {
    if (MANIFEST_PRIORITY_TRACK_IDS.has(entries[i].id)) {
      firstChunkSize = Math.max(firstChunkSize, i + 1);
    }
  }

  const chunkMetas: { path: string; count: number }[] = [];
  let offset = 0;
  let chunkIndex = 0;
  while (offset < entries.length) {
    const remaining = entries.length - offset;
    const size =
      chunkIndex === 0
        ? Math.min(firstChunkSize, remaining)
        : Math.min(MANIFEST_CHUNK_TARGET, remaining);
    const slice = entries.slice(offset, offset + size);
    const chunkPath = `songs-manifest-chunk-${chunkIndex}.json`;
    const chunkBody = {
      version: 5,
      kind: 'chunk' as const,
      chunkIndex,
      tracks: slice,
    };
    fs.writeFileSync(path.join(publicDir, chunkPath), JSON.stringify(chunkBody, null, 2), 'utf8');
    chunkMetas.push({ path: chunkPath, count: slice.length });
    offset += slice.length;
    chunkIndex += 1;
  }

  const catalog = {
    version: 5,
    kind: 'catalog' as const,
    generatedAt,
    assetBaseUrl: ASSET_BASE,
    trackTotal: entries.length,
    chunks: chunkMetas,
  };

  const artistManifest = buildArtistManifestFromSongs(entries, generatedAt);

  const imagesCache = loadImagesCache();
  const imageOverrides = loadArtistImageOverrides(projectRoot);
  for (const artist of artistManifest.artists) {
    const cached = imagesCache[artist.canonicalArtistId];
    const merged = applyArtistImageToManifestArtist(artist.canonicalArtistId, cached, imageOverrides);
    artist.artistImageUrl = merged.url;
    artist.artistImageSource = merged.source;
    artist.artistImageConfidence = merged.confidence;
    artist.artistImageKind = merged.artistImageKind ?? null;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2), 'utf8');
  fs.writeFileSync(artistOutPath, JSON.stringify(artistManifest, null, 2), 'utf8');

  const linked = entries.filter(e => e.linkStatus === 'linked').length;
  const missingVideo = entries.filter(e => e.linkStatus === 'missingVideo').length;
  const missingSheet = entries.filter(e => e.linkStatus === 'missingSheet').length;
  const okArtists = artistManifest.artists.filter(a => a.reviewStatus === 'ok').length;
  const reviewArtists = artistManifest.artists.filter(a => a.reviewStatus !== 'ok').length;
  const withImage = artistManifest.artists.filter(a => a.artistImageUrl).length;

  const durationOk = entries.filter(e => !isBadDurationLabel(e.duration)).length;
  const durationBad = entries.filter(e => isBadDurationLabel(e.duration));

  console.log(`\n=== Song Linking Pipeline Results ===`);
  console.log(`Tracks: ${entries.length}`);
  console.log(`  linked (video + sheet): ${linked}`);
  console.log(`  missingVideo: ${missingVideo}`);
  console.log(`  missingSheet: ${missingSheet}`);
  console.log(`\n=== Duration (after MP3 probe) ===`);
  console.log(`  valid duration: ${durationOk}`);
  console.log(`  still invalid (no MP3 / unreadable): ${durationBad.length}`);
  if (beforeBad.length > 0) {
    console.log(`  note: ${beforeBad.length} practice tracks had 00:00 before probe; check remaining list if non-zero.`);
  }
  if (durationBad.length > 0 && durationBad.length <= 40) {
    durationBad.forEach(e => console.log(`    - ${e.slug ?? e.id}: ${e.displayTitle || e.title}`));
  } else if (durationBad.length > 40) {
    durationBad.slice(0, 25).forEach(e => console.log(`    - ${e.slug ?? e.id}: ${e.displayTitle || e.title}`));
    console.log(`    … and ${durationBad.length - 25} more`);
  }

  console.log(`\nArtists: ${artistManifest.artists.length}`);
  console.log(`  ok: ${okArtists}`);
  console.log(`  needsReview/unknown: ${reviewArtists}`);
  console.log(`  with image: ${withImage}`);
  console.log(`NeedsReview entries: ${artistManifest.needsReview.length}`);
  console.log(
    `\nWrote catalog + ${chunkMetas.length} chunk file(s) (${entries.length} tracks) to ${path.relative(projectRoot, outPath)}`,
  );
  console.log(
    `Wrote ${artistManifest.artists.length} artist buckets & ${artistManifest.needsReview.length} needsReview to ${path.relative(projectRoot, artistOutPath)}`,
  );

  const categoryDist: Record<string, number> = {};
  for (const e of entries) {
    for (const k of e.categoryKeys) {
      categoryDist[k] = (categoryDist[k] || 0) + 1;
    }
  }
  console.log(`\nCategory distribution:`);
  for (const [k, v] of Object.entries(categoryDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  if (missingVideo > 0) {
    console.log(`\nMissing video tracks:`);
    entries.filter(e => e.linkStatus === 'missingVideo').forEach(e => {
      console.log(`  - ${e.slug}: ${e.displayTitle || e.title}`);
    });
  }

  if (durationBad.length > 0) {
    console.warn(
      '\n[build-songs-manifest] WARNING: Some tracks still have invalid duration after MP3 probe. Run: npm run audit:library',
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
