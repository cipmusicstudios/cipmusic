/**
 * Build public/songs-manifest.json from production song rows (Node only).
 * Run after updating the Supabase `songs` table.
 *
 * Local-import fallback is still available via `MANIFEST_SOURCE=local` for offline
 * maintenance, but the default build path now uses the production catalog source.
 *
 * 数据源选择（重要）：
 * - 显式 `MANIFEST_SOURCE=local|production` 优先。
 * - 否则 Netlify CI（`NETLIFY`）→ production。
 * - 否则若 `.env` / `.env.local` 中已有 `SUPABASE_SERVICE_ROLE_KEY` + Supabase URL → production
 *   （避免本地 `npm run build` 误用 local 种子覆盖 chunk，导致全站 /local-imports + 00:00）。
 * - 否则 → local，并 console.warn。
 *
 * ── 时长防回退（metadata 与 asset 分离）──
 * - 每次写入前会读取当前 `public/songs-manifest-chunk-*.json` 作为「上一版时长」。
 * - 若本次构建某条的 duration / durationSeconds 无效（00:00 / 探测失败），而上一版有效，则保留上一版，绝不把好数据覆盖成坏数据。
 * - `MANIFEST_METADATA_ONLY=1`：跳过 local-imports 的 MP3 探测，仅适合改 metadata；时长依赖 DB（production）或与上一版 manifest 合并（local）。
 * - `vite build` 的 prebuild 默认带 `MANIFEST_METADATA_ONLY=1`，避免无完整本地音频时 prebuild 把全库写成 00:00。
 * - 需要全量重探测本地 MP3 时：`npm run build:manifest`（勿设 MANIFEST_METADATA_ONLY），且建议本地有完整 `public/local-imports`。
 * - `MANIFEST_SKIP_DURATION_MERGE=1`：关闭与上一版合并（仅调试）。
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { parseFile } from 'music-metadata';
import { LOCAL_IMPORT_SEEDS } from '../src/local-import-seeds.generated.ts';
import { buildLocalImportTrack } from '../src/local-import-build-track.ts';
import { buildRomanizedFallbackTitle } from '../src/local-import-metadata-auto.ts';
import {
  trackToManifestEntry,
  buildArtistManifestFromSongs,
  assignManifestListSort,
  applyCatalogListSortToManifestEntry,
  compareSongManifestEntriesByReleaseDesc,
  MANIFEST_WORK_PROJECT_KEY_BY_SLUG,
  type SongManifestEntry,
} from '../src/songs-manifest.ts';
import type { Track } from '../src/types/track.ts';
import { formatDurationLabel, isBadDurationLabel } from '../src/duration-utils.ts';
import {
  applyArtistImageToManifestArtist,
  loadArtistImageOverrides,
} from './artist-image-shared.ts';
import type { ArtistImageKind } from '../src/artist-image-kind.ts';
import { enrichManifestEntriesWithYoutubeOrder } from './enrich-manifest-youtube-order.ts';
import { LOCAL_IMPORT_METADATA_OVERRIDES } from '../src/local-import-metadata-overrides.ts';
import {
  loadPriorManifestDurations,
  mergePriorDurationsIntoEntries,
  isValidManifestDuration,
} from './manifest-duration-merge.ts';
import { applyProductionMetadataLocks } from '../src/manifest-production-metadata-locks.ts';
import { writebackListSortFields } from './writeback-list-sort.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.local') });

const outPath = path.join(projectRoot, 'public', 'songs-manifest.json');
const publicDir = path.join(projectRoot, 'public');
const artistOutPath = path.join(projectRoot, 'public', 'artist-manifest.json');

/** Local-first UI defaults must live in chunk 0 so first paint can resolve `setCurrentTrack`. */
const MANIFEST_CHUNK_TARGET = 96;
const MANIFEST_PRIORITY_TRACK_IDS = new Set(['soda_pop', 'golden_piano']);
const imagesCachePath = path.join(projectRoot, 'public', 'artist-images-cache.json');
const SUPABASE_SONGS_BUCKET = process.env.SUPABASE_SONGS_BUCKET?.trim() || 'songs';

const ASSET_BASE = process.env.VITE_ASSET_BASE_URL?.trim() || '';

/** 远端 `songs.sheet_url` 未及时更正时，仅覆盖乐谱链接（不影响音频/封面等）。 */
const PRODUCTION_SHEET_URL_BY_SLUG: Record<string, string> = {
  无人乐园: 'https://www.mymusic5.com/cipmusic/373321',
  光亮: 'https://www.mymusic5.com/cipmusic/49061',
  哪吒: 'https://www.mymusic5.com/cipmusic/49395',
};

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
  /** 仅存在于 Supabase 的曲目：用 overrides.titles 补简繁英展示名（如「逐星」）。 */
  for (const [slug, ov] of Object.entries(LOCAL_IMPORT_METADATA_OVERRIDES)) {
    const t = ov.titles;
    if (!t || (!t.zhHans && !t.zhHant && !t.en)) continue;
    const prev = bySlug.get(slug);
    bySlug.set(slug, { ...prev, ...t });
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

function resolveManifestSource(): 'production' | 'local' {
  const explicit = process.env.MANIFEST_SOURCE?.trim().toLowerCase();
  if (explicit === 'local' || explicit === 'production') return explicit;

  if (process.env.NETLIFY) return 'production';

  const supabaseUrl = getEnvValue('VITE_SUPABASE_URL', 'SUPABASE_URL');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (supabaseUrl && serviceKey) return 'production';

  console.warn(
    '[build-songs-manifest] MANIFEST_SOURCE=local — 未设置 MANIFEST_SOURCE，非 Netlify，且缺少 SUPABASE_SERVICE_ROLE_KEY 或 Supabase URL。将写入 /local-imports/… 种子数据；若需与线上一致，请在 .env.local 配置密钥后重跑，或显式 MANIFEST_SOURCE=production。',
  );
  return 'local';
}

const MANIFEST_SOURCE = resolveManifestSource();

/** 为 true 时跳过 local-imports MP3 探测；时长完全依赖本次构建结果 + 与上一版 manifest 合并（适合仅改 metadata）。 */
const MANIFEST_METADATA_ONLY =
  process.env.MANIFEST_METADATA_ONLY === '1' || process.env.MANIFEST_METADATA_ONLY === 'true';

/** 为 true 时跳过「探测失败则回填上一版 duration」逻辑（仅调试用）。 */
const MANIFEST_SKIP_DURATION_MERGE =
  process.env.MANIFEST_SKIP_DURATION_MERGE === '1' || process.env.MANIFEST_SKIP_DURATION_MERGE === 'true';

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
  let titles: DisplayTitles | undefined = fromLocal ? { ...fromLocal } : undefined;
  /**
   * Pinyin/romanization safety net for the English UI. If the display title contains Han
   * characters and no `titles.en` is present (either because the local-import seed was
   * removed after Supabase migration, or the Supabase row never had a manual English
   * title), synthesize a romanized fallback so the English UI never shows raw Chinese.
   */
  const hasHan = /[\p{Script=Han}]/u.test(title || '');
  if (hasHan) {
    if (!titles) titles = {};
    if (!titles.zhHans) titles.zhHans = title;
    /**
     * Repair Chinese leakage: a few seeds/overrides ended up with
     * `titles.en === <Chinese>` (e.g. 人之爱, 灯火万家). Treat Han-char en as
     * missing and regenerate a romanized fallback so the English UI never
     * displays raw Chinese characters.
     */
    const enHasHan = !!titles.en && /[\p{Script=Han}]/u.test(titles.en);
    if (!titles.en || enHasHan) {
      const rom = buildRomanizedFallbackTitle(title || '');
      if (rom) titles.en = rom;
    }
  }

  const createdAtIso = pickString(row, 'created_at');
  const sheetFromDb = pickString(row, 'sheet_url') || undefined;
  const noSheet = LOCAL_IMPORT_METADATA_OVERRIDES[slug]?.links?.noSheet === true;
  const sheetUrl = noSheet ? undefined : PRODUCTION_SHEET_URL_BY_SLUG[slug] ?? sheetFromDb;
  const bilibiliFromOverride = LOCAL_IMPORT_METADATA_OVERRIDES[slug]?.links?.bilibili?.trim();
  const workProjectKey = MANIFEST_WORK_PROJECT_KEY_BY_SLUG[slug];

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
    bilibiliUrl: bilibiliFromOverride,
    sheetUrl,
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
    workProjectKey,
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
        workProjectKey,
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
        bilibili: bilibiliFromOverride,
        sheet: sheetUrl,
        noSheet,
      },
      enrichment: {
        status: pickString(row, 'metadata_status') === 'approved' ? 'auto' : 'manual',
        supabaseCreatedAt: createdAtIso,
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
  if (MANIFEST_METADATA_ONLY) {
    console.log(
      '[build-songs-manifest] MANIFEST_METADATA_ONLY=1 — 跳过 local-imports MP3 时长探测（将用上一版 manifest 回填无效时长）',
    );
  } else {
    console.log('[build-songs-manifest] Probing MP3 durations (local imports)…');
    tracks = await enrichAllTracks(tracks, projectRoot, 8);
  }
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
  console.log(`[build-songs-manifest] MANIFEST_SOURCE=${MANIFEST_SOURCE}`);
  if (MANIFEST_METADATA_ONLY && MANIFEST_SOURCE === 'production') {
    console.warn(
      '[build-songs-manifest] MANIFEST_METADATA_ONLY 与 MANIFEST_SOURCE=production 同时存在：Supabase 行仍带时长；仅跳过 local 探测（本模式对 production 无影响）',
    );
  }
  const rawTracks = MANIFEST_SOURCE === 'local' ? await loadLocalImportTracks() : await loadProductionTracks();
  const tracks =
    MANIFEST_SOURCE === 'production' ? rawTracks.map(applyProductionMetadataLocks) : rawTracks;

  const beforeBad = tracks.filter(t => t.importSource === 'local' && t.practiceEnabled && isBadDurationLabel(t.duration));
  let entries = tracks.map(t => trackToManifestEntry(t, ASSET_BASE));
  const ytEnrich = enrichManifestEntriesWithYoutubeOrder(entries, { verbose: true, projectRoot });
  entries = ytEnrich.entries.map(e => applyCatalogListSortToManifestEntry(assignManifestListSort(e)));
  entries.sort(compareSongManifestEntriesByReleaseDesc);

  const priorDurations = loadPriorManifestDurations(projectRoot);
  let durationMergeStats: ReturnType<typeof mergePriorDurationsIntoEntries>['stats'] | null = null;
  if (MANIFEST_SKIP_DURATION_MERGE) {
    console.warn(
      '[build-songs-manifest] MANIFEST_SKIP_DURATION_MERGE=1 — 未与上一版 manifest 合并时长（不推荐）',
    );
  } else {
    const merged = mergePriorDurationsIntoEntries(entries, priorDurations);
    entries = merged.entries;
    durationMergeStats = merged.stats;
  }
  const sortYtPub = entries.filter(e => e.listSortSource === 'youtube_published').length;
  const sortYtIdx = entries.filter(e => e.listSortSource === 'youtube_channel_index').length;
  const sortFb = entries.filter(e => e.listSortSource === 'fallback_no_youtube_order').length;
  console.log(
    `[build-songs-manifest] YouTube channel order: id=${ytEnrich.stats.matchedById} title≈${ytEnrich.stats.matchedByTitle} unmatched=${ytEnrich.stats.unmatched}`,
  );
  console.log(
    `[build-songs-manifest] listSort: youtube_published=${sortYtPub} youtube_channel_index=${sortYtIdx} fallback_no_youtube_order=${sortFb} (tracks array sorted newest-first)`,
  );

  // ── List-sort writeback to Supabase songs (off by default) ──────────────────
  // Triggered only when MANIFEST_WRITEBACK_LIST_SORT=1 (live) or
  // MANIFEST_WRITEBACK_LIST_SORT_DRY_RUN=1 (no DB writes). Uses the service
  // role key (SUPABASE_SERVICE_ROLE_KEY); must run only in trusted Node env.
  // Safe-guarded: only runs against MANIFEST_SOURCE=production, because
  // local-import seed ids are not Supabase UUIDs and would all be skipped.
  const writebackLive = process.env.MANIFEST_WRITEBACK_LIST_SORT === '1';
  const writebackDryRun = process.env.MANIFEST_WRITEBACK_LIST_SORT_DRY_RUN === '1';
  if (writebackLive || writebackDryRun) {
    if (MANIFEST_SOURCE !== 'production') {
      console.warn(
        `[build-songs-manifest] writeback skipped: MANIFEST_SOURCE=${MANIFEST_SOURCE}. ` +
          'Writeback only supported when source=production (ids must be Supabase UUIDs).',
      );
    } else {
      try {
        const wbStats = await writebackListSortFields(entries, { dryRun: writebackDryRun });
        console.log(
          `[build-songs-manifest] writeback list_sort: ` +
            `scanned=${wbStats.totalScanned} attempted=${wbStats.attempted} ` +
            `updated=${wbStats.updated} ` +
            `skippedNoId=${wbStats.skippedNoId} skippedNonUuid=${wbStats.skippedNonUuid} ` +
            `skippedNoSortValue=${wbStats.skippedNoSortValue} ` +
            `failed=${wbStats.failed} dryRun=${wbStats.dryRun}`,
        );
        if (wbStats.failures.length > 0) {
          console.error(
            '[build-songs-manifest] writeback failures (first 10):',
            wbStats.failures.slice(0, 10),
          );
        }
      } catch (e) {
        console.error(
          '[build-songs-manifest] writeback error — manifest build continues; DB not modified:',
          e instanceof Error ? e.message : e,
        );
      }
    }
  } else {
    console.log(
      '[build-songs-manifest] writeback list_sort: SKIPPED ' +
        '(set MANIFEST_WRITEBACK_LIST_SORT=1 to enable, or MANIFEST_WRITEBACK_LIST_SORT_DRY_RUN=1 for dry-run).',
    );
  }

  const generatedAt = new Date().toISOString();

  let firstChunkSize = MANIFEST_CHUNK_TARGET;
  for (let i = 0; i < entries.length; i++) {
    if (MANIFEST_PRIORITY_TRACK_IDS.has(entries[i].id)) {
      firstChunkSize = Math.max(firstChunkSize, i + 1);
    }
  }

  /**
   * Phase A1 安全收口：MIDI / MusicXML 是付费谱面源文件，绝不能进入公开 manifest。
   * 直接删除 `midiUrl` / `musicXmlUrl` 字段（连键名都不输出），避免任何字符串扫描扫到 `.mid` / `.musicxml`。
   * 仍保留 `hasPracticeMode` 标志（来自 DB `songs.has_practice_mode`），让前端 UI 能知道
   * 哪些歌曲未来在 broker 上线后将开放 Practice Mode。`mp3Url` 本轮暂不收口，避免普通播放断链。
   */
  const sanitizeForPublicManifest = (entry: SongManifestEntry): Omit<SongManifestEntry, 'midiUrl' | 'musicXmlUrl'> => {
    const {midiUrl: _midiUrl, musicXmlUrl: _musicXmlUrl, ...rest} = entry;
    void _midiUrl;
    void _musicXmlUrl;
    return rest;
  };

  const chunkMetas: { path: string; count: number }[] = [];
  let offset = 0;
  let chunkIndex = 0;
  while (offset < entries.length) {
    const remaining = entries.length - offset;
    const size =
      chunkIndex === 0
        ? Math.min(firstChunkSize, remaining)
        : Math.min(MANIFEST_CHUNK_TARGET, remaining);
    const slice = entries.slice(offset, offset + size).map(sanitizeForPublicManifest);
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

  const durationOk = entries.filter(e => isValidManifestDuration(e)).length;
  const durationBad = entries.filter(e => !isValidManifestDuration(e));

  console.log(`\n=== Song Linking Pipeline Results ===`);
  console.log(`Tracks: ${entries.length}`);
  console.log(`  linked (video + sheet): ${linked}`);
  console.log(`  missingVideo: ${missingVideo}`);
  console.log(`  missingSheet: ${missingSheet}`);
  console.log(`\n=== Duration (after build + prior-manifest merge) ===`);
  console.log(`  total tracks: ${entries.length}`);
  if (durationMergeStats) {
    console.log(`  valid from this build (probe/DB, before merge): ${durationMergeStats.buildValidBeforeMerge}`);
    console.log(`  preserved from previous manifest (probe/DB failed → kept prior): ${durationMergeStats.preservedFromPrior}`);
    console.log(`  still invalid after merge: ${durationMergeStats.stillInvalidAfterMerge}`);
    console.log(`  written as 00:00 / null: ${durationMergeStats.writtenAsZero}`);
  }
  console.log(`  valid duration (final): ${durationOk}`);
  console.log(`  still invalid (final): ${durationBad.length}`);
  if (priorDurations.size === 0 && entries.length > 0) {
    console.log(
      '  note: 未找到可合并的上一版 public/songs-manifest.json / chunk（首建或路径缺失）；无法从旧 manifest 回填时长。',
    );
  }
  if (MANIFEST_SOURCE === 'local' && !MANIFEST_METADATA_ONLY) {
    console.log(
      '  note: MANIFEST_SOURCE=local 且已探测 MP3；若仍大量 00:00，多为 public/local-imports 缺文件，合并步骤会尽量保留旧 chunk 中的时长。',
    );
  }
  if (beforeBad.length > 0) {
    console.log(`  note: ${beforeBad.length} practice tracks had 00:00 before probe; check remaining list if non-zero.`);
  }
  if (durationMergeStats && durationMergeStats.writtenAsZero > 0) {
    console.warn(
      `\n[build-songs-manifest] 仍有 ${durationMergeStats.writtenAsZero} 条曲目时长为 00:00：多为上一版 manifest 中也无有效值、或新曲目尚无 prior。请补全音频探测（npm run build:manifest，勿带 MANIFEST_METADATA_ONLY）或从 Supabase production 构建。`,
    );
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
