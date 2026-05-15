/**
 * Local import → Supabase migration.
 *
 * `--apply` uploads `audio.mp3` to the public `songs` bucket (`SUPABASE_SONGS_BUCKET` / `--bucket`, default `songs`).
 * When both `performance.mid` and `score.musicxml` exist locally, we also **mirror the same object keys**
 * into `SUPABASE_PRACTICE_BUCKET` (default `practice-assets`) so Netlify `practice-asset-url` can sign them.
 *
 * Practice mirror env:
 *   - `SUPABASE_PRACTICE_BUCKET` — private broker bucket (optional; default `practice-assets`).
 *   - `PRACTICE_MIGRATION_OVERWRITE=1` — replace objects that already exist in the practice bucket.
 *       Default: skip existing targets (safe, no silent overwrite).
 *
 * Post-import verification:
 *   `npm run verify:practice-assets-import -- --only-slugs "slug-a,slug-b"`
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { parseFile } from 'music-metadata';
import { buildLocalImportTrack } from '../src/local-import-build-track.ts';
import {
  assertPracticeBucketExists,
  isPracticeMigrationOverwriteEnabled,
  publishMidiXmlToPracticeBucket,
  resolveImportPracticeBucketName,
} from './lib/publish-practice-assets-to-private-bucket.ts';

type SongSeed = {
  id: string;
  slug: string;
  audioFile: string;
  midiFile?: string;
  musicxmlFile?: string;
  titleOverride?: string;
};

type LocalSongFolder = {
  slug: string;
  storageSlug: string;
  dirPath: string;
  seed: SongSeed;
  files: {
    audio: string | null;
    midi: string | null;
    musicxml: string | null;
  };
};

type MigrationRow = {
  slug: string;
  title: string;
  artist: string;
  primary_category: string;
  secondary_category: string[];
  audio_path: string;
  audio_url: string;
  midi_path: string | null;
  midi_url: string | null;
  xml_path: string | null;
  musicxml_url: string | null;
  cover_url: string;
  youtube_url: string;
  sheet_url: string;
  duration: string;
  is_published: boolean;
  has_practice_mode: boolean;
  source_song_title: string | null;
  source_artist: string | null;
  source_cover_url: string | null;
  source_album: string | null;
  source_release_year: string | null;
  source_category: string | null;
  source_genre: string | null;
  metadata_status: string;
  metadata_source: string;
  metadata_confidence: number;
};

type ExistingSongRow = {
  slug?: string | null;
  title?: string | null;
  artist?: string | null;
  primary_category?: string | null;
  secondary_category?: string[] | null;
  audio_path?: string | null;
  audio_url?: string | null;
  midi_path?: string | null;
  midi_url?: string | null;
  xml_path?: string | null;
  musicxml_url?: string | null;
  cover_url?: string | null;
  youtube_url?: string | null;
  sheet_url?: string | null;
  duration?: string | null;
  source_song_title?: string | null;
  source_artist?: string | null;
  source_cover_url?: string | null;
  source_album?: string | null;
  source_release_year?: string | null;
  source_category?: string | null;
  source_genre?: string | null;
  metadata_status?: string | null;
  metadata_source?: string | null;
  metadata_confidence?: number | null;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const localImportsRoot = path.join(projectRoot, 'public', 'local-imports');
const defaultSongsBucket = 'songs';

function hasCjkCharacters(value: string) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);
}

function toTitleFromSlug(slug: string) {
  return slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function inferTitleFromSlug(slug: string) {
  return hasCjkCharacters(slug) ? slug : toTitleFromSlug(slug);
}

function slugToId(slug: string) {
  const normalized = slug
    .normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return `local_${normalized || 'track'}`;
}

function toAsciiSafeBaseSlug(source: string) {
  const normalized = source
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  if (normalized) return normalized;

  const hash = createHash('sha1').update(source).digest('hex').slice(0, 10);
  return `track-${hash}`;
}

/**
 * Storage slug = "<base>-<artist>"，例如：
 *   ("Go",  "BLACKPINK") -> "go-blackpink"
 *   ("GO!", "CORTIS")    -> "go-cortis"
 *
 * 这样不同 artist 的同名/近似名歌（如 BLACKPINK 的 "Go" 与 CORTIS 的 "GO!"）
 * 会落到不同的 storage path，避免上传时静默互相覆盖。
 *
 * 不传 artist 时退化为 base only（仅在 dry-run 之类拿不到 artist 的早期阶段使用，
 * 真正写库前会在 runMigrationMode 里用 resolveFinalStorageSlug 重算一次）。
 */
function toAsciiSafeStorageSlug(source: string, artistName?: string | null) {
  const base = toAsciiSafeBaseSlug(source);
  const artistPart = artistName ? toAsciiSafeBaseSlug(artistName) : '';
  if (!artistPart) return base;
  if (base.endsWith(`-${artistPart}`) || base === artistPart) return base;
  return `${base}-${artistPart}`;
}

/** 从 "songs/<slug>/audio.mp3" 抽出 "<slug>" — 用于保持已有行的存储路径不被改写。 */
function extractStorageSlugFromAudioPath(audioPath: string | null | undefined) {
  if (typeof audioPath !== 'string') return '';
  const match = audioPath.match(/^songs\/([^/]+)\//);
  return match ? match[1] : '';
}

/**
 * 决定本次写库 / 上传要用的最终 storage slug：
 *   1) 数据库已有 row 且其 audio_path 已写好 → 沿用，避免把老歌挪到新格式（会断旧链接）。
 *   2) 否则用 artist-aware 版（base + '-' + artist）。
 */
function resolveFinalStorageSlug(
  folder: LocalSongFolder,
  resolvedArtist: string,
  existingRow?: ExistingSongRow,
): string {
  const existingSlug = extractStorageSlugFromAudioPath(existingRow?.audio_path);
  if (existingSlug) return existingSlug;
  return toAsciiSafeStorageSlug(folder.slug, resolvedArtist);
}

/**
 * 写库 / 上传前的 collision guard：
 * 如果计算出的 storage slug 对应的 audio_path 已经被另一首歌（不同 slug）占用，
 * 直接抛错，避免静默覆盖（这就是 Go vs GO! 这次撞库的根因）。
 */
async function assertStorageSlugFree(
  supabase: ReturnType<typeof createClient>,
  storageSlug: string,
  songSlug: string,
) {
  const audioPath = `songs/${storageSlug}/audio.mp3`;
  const { data, error } = await supabase
    .from('songs')
    .select('id,slug,title,artist,audio_path')
    .eq('audio_path', audioPath)
    .neq('slug', songSlug);
  if (error) throw error;
  if (data && data.length > 0) {
    const occupied = data[0] as { slug?: string | null; title?: string | null; artist?: string | null };
    throw new Error(
      `[migrate] storage path collision: '${audioPath}' already used by song slug='${occupied.slug}' ` +
        `(${occupied.title} / ${occupied.artist}). Refusing to overwrite. ` +
        `Disambiguate the local folder name (e.g. include artist), or repoint the existing row first.`,
    );
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run') || !args.includes('--apply'),
    sampleCount: 0,
    skipExisting: args.includes('--skip-existing'),
    deleteSongId: '',
    deleteSongSlug: '',
    bucket: (process.env.SUPABASE_SONGS_BUCKET?.trim() || defaultSongsBucket),
    onlySlugs: [] as string[],
  };

  for (let index = 0; index < args.length; index++) {
    const current = args[index];
    const next = args[index + 1];
    if ((current === '--sample' || current === '--limit') && next) {
      options.sampleCount = Math.max(0, Number.parseInt(next, 10) || 0);
      index += 1;
    } else if (current === '--delete-song-id' && next) {
      options.deleteSongId = next.trim();
      index += 1;
    } else if (current === '--delete-song-slug' && next) {
      options.deleteSongSlug = next.trim();
      index += 1;
    } else if (current === '--bucket' && next) {
      options.bucket = next.trim();
      index += 1;
    } else if (current === '--only-slugs' && next) {
      options.onlySlugs = next
        .split(/[,，]/)
        .map(s => s.trim())
        .filter(Boolean);
      index += 1;
    } else if (current === '--apply') {
      options.dryRun = false;
    }
  }

  return options;
}

function listVisibleFiles(dirPath: string) {
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter(entry => entry.isFile() && !entry.name.startsWith('.'))
    .map(entry => entry.name);
}

function rankFileCandidate(field: 'audio' | 'midi' | 'musicxml', fileName: string, stats: fs.Stats) {
  const lower = fileName.toLowerCase();
  let score = 0;

  if (field === 'audio') {
    if (lower === 'audio.mp3') score += 1000;
    if (lower.includes('cip music')) score += 200;
    if (lower.includes('钢琴示例') || lower.includes('piano cover')) score += 120;
    if (lower.includes('audio')) score += 40;
  }

  if (field === 'midi') {
    if (lower === 'performance.mid') score += 1000;
    if (lower.includes('performance')) score += 80;
    score += Math.floor(stats.mtimeMs / 1000);
  }

  if (field === 'musicxml') {
    if (lower === 'score.musicxml') score += 1000;
    if (lower.includes('score')) score += 80;
    score += Math.floor(stats.mtimeMs / 2000);
  }

  return score;
}

function pickBestFile(field: 'audio' | 'midi' | 'musicxml', dirPath: string, files: string[], extensions: string[]) {
  const matches = files.filter(file => extensions.includes(path.extname(file).toLowerCase()) || file.toLowerCase() === `${field}${extensions[0]}`);
  if (matches.length === 0) return null;
  const ranked = matches
    .map(name => {
      const fullPath = path.join(dirPath, name);
      const stats = fs.statSync(fullPath);
      return {
        name,
        score: rankFileCandidate(field, name, stats),
        mtimeMs: stats.mtimeMs,
      };
    })
    .sort((left, right) => right.score - left.score || right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
  return ranked[0]?.name ?? null;
}

function scanLocalSongFolders(): LocalSongFolder[] {
  if (!fs.existsSync(localImportsRoot)) {
    throw new Error(`Missing local import root: ${path.relative(projectRoot, localImportsRoot)}`);
  }

  const folderEntries = fs.readdirSync(localImportsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory());
  const folders: LocalSongFolder[] = [];

  for (const entry of folderEntries) {
    const slug = entry.name;
    const dirPath = path.join(localImportsRoot, slug);
    const files = listVisibleFiles(dirPath);
    const audio = pickBestFile('audio', dirPath, files, ['.mp3']);
    if (!audio) continue;
    const midi = pickBestFile('midi', dirPath, files, ['.mid', '.midi']);
    const musicxml = pickBestFile('musicxml', dirPath, files, ['.musicxml']);

    folders.push({
      slug,
      storageSlug: toAsciiSafeStorageSlug(slug),
      dirPath,
      seed: {
        id: slugToId(slug),
        slug,
        audioFile: audio,
        midiFile: midi ?? undefined,
        musicxmlFile: musicxml ?? undefined,
        titleOverride: inferTitleFromSlug(slug),
      },
      files: {
        audio,
        midi,
        musicxml,
      },
    });
  }

  folders.sort((left, right) => left.slug.localeCompare(right.slug));
  return folders;
}

function ffprobeDurationSeconds(fsPath: string): number | null {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', fsPath],
      { encoding: 'utf8', maxBuffer: 2_000_000 },
    ).trim();
    const value = Number.parseFloat(out);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function readDurationLabel(audioFilePath: string) {
  try {
    const metadata = await parseFile(audioFilePath);
    let durationSeconds = metadata.format.duration;
    const fallback = ffprobeDurationSeconds(audioFilePath);
    if (fallback != null && fallback > 0) {
      if (!Number.isFinite(durationSeconds) || durationSeconds == null || durationSeconds <= 0 || Math.abs(durationSeconds - fallback) > 3) {
        durationSeconds = fallback;
      }
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds == null || durationSeconds <= 0) {
      return { durationSeconds: null, durationLabel: '00:00' };
    }
    const wholeSeconds = Math.max(1, Math.round(durationSeconds));
    const minutes = Math.floor(wholeSeconds / 60);
    const seconds = wholeSeconds % 60;
    return {
      durationSeconds,
      durationLabel: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
    };
  } catch {
    return { durationSeconds: null, durationLabel: '00:00' };
  }
}

function toStoragePath(slug: string, fileName: string) {
  if (!fileName) return null;
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.mp3')) return `songs/${slug}/audio.mp3`;
  if (lower.endsWith('.mid') || lower.endsWith('.midi')) return `songs/${slug}/performance.mid`;
  if (lower.endsWith('.musicxml')) return `songs/${slug}/score.musicxml`;
  return null;
}

function toPublicStorageUrl(supabaseUrl: string, bucket: string, objectPath: string | null) {
  if (!objectPath) return null;
  return `${supabaseUrl.replace(/\/+$/g, '')}/storage/v1/object/public/${bucket}/${encodeURI(objectPath)}`;
}

async function uploadFile(supabase: ReturnType<typeof createClient>, bucket: string, localPath: string, remotePath: string, contentType: string, dryRun: boolean) {
  if (dryRun) {
    return;
  }
  const fileBytes = fs.readFileSync(localPath);
  const result = await supabase.storage.from(bucket).upload(remotePath, fileBytes, {
    upsert: true,
    contentType,
  });
  if (result.error) {
    throw result.error;
  }
}

function inferContentType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.mid') || lower.endsWith('.midi')) return 'audio/midi';
  if (lower.endsWith('.musicxml')) return 'application/vnd.recordare.musicxml+xml';
  return 'application/octet-stream';
}

function pickPreferredString(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

function buildMigrationRow(
  folder: LocalSongFolder,
  storageSlug: string,
  durationLabel: string,
  supabaseUrl: string,
  bucket: string,
  existingRow?: ExistingSongRow,
): MigrationRow {
  const track = buildLocalImportTrack(folder.seed);
  const resolvedTitle = pickPreferredString(existingRow?.title, track.title, inferTitleFromSlug(folder.slug));
  const resolvedArtist =
    pickPreferredString(existingRow?.artist, track.artist, track.sourceArtist, resolvedTitle) || resolvedTitle;
  const audioPath = toStoragePath(storageSlug, folder.files.audio ?? '');
  const midiPath = folder.files.midi ? toStoragePath(storageSlug, folder.files.midi) : null;
  const xmlPath = folder.files.musicxml ? toStoragePath(storageSlug, folder.files.musicxml) : null;
  const practiceEnabled = Boolean(audioPath && midiPath && xmlPath);
  const primaryCategory = pickPreferredString(existingRow?.primary_category, track.category, 'Originals') || 'Originals';
  const secondaryCategory = Array.isArray(track.tags)
    ? track.tags.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const existingSecondaryCategory = Array.isArray(existingRow?.secondary_category)
    ? existingRow.secondary_category.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const audioUrl = toPublicStorageUrl(supabaseUrl, bucket, audioPath || `songs/${storageSlug}/audio.mp3`);
  const midiUrl = toPublicStorageUrl(supabaseUrl, bucket, midiPath);
  const musicxmlUrl = toPublicStorageUrl(supabaseUrl, bucket, xmlPath);

  return {
    slug: folder.slug,
    title: resolvedTitle,
    artist: resolvedArtist,
    primary_category: primaryCategory,
    secondary_category: existingSecondaryCategory.length > 0 ? existingSecondaryCategory : secondaryCategory,
    audio_path:
      pickPreferredString(existingRow?.audio_path, audioPath, `songs/${storageSlug}/audio.mp3`),
    audio_url:
      pickPreferredString(
        existingRow?.audio_url,
        audioUrl,
        `${supabaseUrl.replace(/\/+$/g, '')}/storage/v1/object/public/${bucket}/songs/${storageSlug}/audio.mp3`,
      ),
    midi_path: pickPreferredString(existingRow?.midi_path, midiPath) || null,
    midi_url: pickPreferredString(existingRow?.midi_url, midiUrl) || null,
    xml_path: pickPreferredString(existingRow?.xml_path, xmlPath) || null,
    musicxml_url: pickPreferredString(existingRow?.musicxml_url, musicxmlUrl) || null,
    cover_url: pickPreferredString(existingRow?.cover_url, track.coverUrl, track.sourceCoverUrl),
    youtube_url: pickPreferredString(existingRow?.youtube_url, track.youtubeUrl),
    sheet_url: pickPreferredString(existingRow?.sheet_url, track.sheetUrl),
    duration: pickPreferredString(existingRow?.duration, durationLabel, '00:00'),
    is_published: true,
    has_practice_mode: practiceEnabled,
    source_song_title: pickPreferredString(existingRow?.source_song_title, track.sourceSongTitle, resolvedTitle) || null,
    source_artist: pickPreferredString(existingRow?.source_artist, track.sourceArtist, resolvedArtist) || null,
    source_cover_url: pickPreferredString(existingRow?.source_cover_url, track.sourceCoverUrl, track.coverUrl) || null,
    source_album: pickPreferredString(existingRow?.source_album, track.sourceAlbum) || null,
    source_release_year: pickPreferredString(existingRow?.source_release_year, track.sourceReleaseYear) || null,
    source_category: pickPreferredString(existingRow?.source_category, track.sourceCategory, track.category) || null,
    source_genre: pickPreferredString(existingRow?.source_genre, track.sourceGenre) || null,
    metadata_status: pickPreferredString(existingRow?.metadata_status, 'approved'),
    metadata_source: pickPreferredString(existingRow?.metadata_source, 'migration'),
    metadata_confidence:
      typeof existingRow?.metadata_confidence === 'number' && Number.isFinite(existingRow.metadata_confidence)
        ? existingRow.metadata_confidence
        : 1,
  };
}

function buildSupabaseClient() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }
  return { supabaseUrl, client: createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } }) };
}

async function loadExistingSongSlugs(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase.from('songs').select('slug');
  if (error) throw error;
  return new Set(
    (data ?? [])
      .map(row => (typeof row.slug === 'string' ? row.slug.trim() : ''))
      .filter(Boolean),
  );
}

async function loadExistingSongsBySlug(
  supabase: ReturnType<typeof createClient>,
  slugs: string[],
) {
  const rows = new Map<string, ExistingSongRow>();
  for (let index = 0; index < slugs.length; index += 200) {
    const chunk = slugs.slice(index, index + 200);
    const { data, error } = await supabase.from('songs').select('*').in('slug', chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      if (typeof row.slug === 'string' && row.slug.trim()) {
        rows.set(row.slug.trim(), row as ExistingSongRow);
      }
    }
  }
  return rows;
}

async function ensureBucketExists(supabase: ReturnType<typeof createClient>, bucket: string, dryRun: boolean) {
  if (dryRun) return;
  const { data, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  if (!data.some(entry => entry.name === bucket)) {
    const created = await supabase.storage.createBucket(bucket, { public: true });
    if (created.error) throw created.error;
  }
}

async function ensureArtistRowExists(
  supabase: ReturnType<typeof createClient>,
  artistName: string,
  dryRun: boolean,
) {
  if (dryRun || !artistName.trim()) return;

  const attempts: Array<{ payload: Record<string, string>; conflict: string }> = [
    { payload: { artist: artistName }, conflict: 'artist' },
    { payload: { name: artistName }, conflict: 'name' },
    { payload: { artist: artistName, name: artistName }, conflict: 'artist' },
    { payload: { artist: artistName, name: artistName }, conflict: 'name' },
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    const result = await supabase.from('artists').upsert(attempt.payload, { onConflict: attempt.conflict }).select();
    if (!result.error) return;
    lastError = result.error;
    const message = (result.error.message || '').toLowerCase();
    const code = (result.error as { code?: string }).code ?? '';
    if (
      message.includes('column') ||
      message.includes('constraint') ||
      message.includes('duplicate key') ||
      code === '42703' ||
      code === '42P10'
    ) {
      continue;
    }
    throw result.error;
  }

  if (lastError) {
    throw lastError;
  }
}

async function runDeleteMode(options: ReturnType<typeof parseArgs>) {
  if (options.dryRun) {
    console.log(`[dry-run] Would delete song row and storage objects for ${options.deleteSongId || options.deleteSongSlug}`);
    return;
  }

  const supabase = buildSupabaseClient();
  const bucketCandidates = ['songs', 'music', 'midi', 'xml'];
  const lookupKey = options.deleteSongId || options.deleteSongSlug;
  if (!lookupKey) {
    throw new Error('Pass --delete-song-id <id> or --delete-song-slug <slug>.');
  }

  const { data: songs, error } = await supabase
    .from('songs')
    .select('*')
    .or(`id.eq.${lookupKey},slug.eq.${lookupKey}`);
  if (error) throw error;
  if (!songs?.length) {
    console.log(`No song row matched ${lookupKey}.`);
    return;
  }

  for (const song of songs) {
    const storageValues = [song.audio_path, song.audio_url, song.midi_path, song.midi_url, song.xml_path, song.musicxml_url]
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    for (const value of storageValues) {
      const match = value.match(/\/object\/public\/([^/]+)\/(.+)$/);
      if (!match) continue;
      const bucket = match[1];
      const objectPath = match[2];
      await supabase.storage.from(bucket).remove([objectPath]);
    }
    for (const bucket of bucketCandidates) {
      await supabase.storage.from(bucket).remove([
        `songs/${song.slug}/audio.mp3`,
        `songs/${song.slug}/performance.mid`,
        `songs/${song.slug}/score.musicxml`,
      ]);
    }
    const deleteResult = await supabase.from('songs').delete().or(`id.eq.${song.id},slug.eq.${song.slug}`);
    if (deleteResult.error) throw deleteResult.error;
    console.log(`Deleted song row: ${song.slug || song.id}`);
  }
}

async function runMigrationMode(options: ReturnType<typeof parseArgs>) {
  const folders = scanLocalSongFolders();
  const dryRun = options.dryRun;
  const bucket = options.bucket;
  const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    throw new Error('Missing VITE_SUPABASE_URL/SUPABASE_URL.');
  }

  let candidateFolders = folders;
  if (options.onlySlugs.length > 0) {
    const want = new Set(options.onlySlugs);
    candidateFolders = folders.filter(folder => want.has(folder.slug));
  }
  if (options.skipExisting) {
    const { client: supabase } = buildSupabaseClient();
    const existingSlugs = await loadExistingSongSlugs(supabase);
    candidateFolders = folders.filter(folder => !existingSlugs.has(folder.slug));
  }

  const selectedFolders = options.sampleCount > 0 ? candidateFolders.slice(0, options.sampleCount) : candidateFolders;

  if (!dryRun) {
    const { supabaseUrl: resolvedSupabaseUrl, client: supabase } = buildSupabaseClient();
    await ensureBucketExists(supabase, bucket, dryRun);
    const practiceBucketName = resolveImportPracticeBucketName();
    let assertedPracticeBucket = false;
    const existingSongsBySlug = await loadExistingSongsBySlug(
      supabase,
      selectedFolders.map(folder => folder.slug),
    );

    for (const folder of selectedFolders) {
      const existingRow = existingSongsBySlug.get(folder.slug);

      // 先解析 artist，再算 storage slug —— 这样 BLACKPINK Go 与 CORTIS GO!
      // 不会被压成同一个 "songs/go/audio.mp3"。
      const draftTrack = buildLocalImportTrack(folder.seed);
      const resolvedArtistForSlug = pickPreferredString(
        existingRow?.artist,
        draftTrack.artist,
        draftTrack.sourceArtist,
      );
      const storageSlug = resolveFinalStorageSlug(folder, resolvedArtistForSlug, existingRow);

      // 撞库 guard：另一首歌已经占用了同一个 audio_path → 抛错而不是静默覆盖。
      await assertStorageSlugFree(supabase, storageSlug, folder.slug);

      const audioLocalPath = path.join(folder.dirPath, folder.files.audio as string);
      const midiLocalPath = folder.files.midi ? path.join(folder.dirPath, folder.files.midi) : null;
      const xmlLocalPath = folder.files.musicxml ? path.join(folder.dirPath, folder.files.musicxml) : null;

      const audioRemotePath = `songs/${storageSlug}/audio.mp3`;
      const midiRemotePath = `songs/${storageSlug}/performance.mid`;
      const xmlRemotePath = `songs/${storageSlug}/score.musicxml`;

      await uploadFile(supabase, bucket, audioLocalPath, audioRemotePath, inferContentType(folder.files.audio as string), dryRun);
      if (midiLocalPath && folder.files.midi) {
        await uploadFile(supabase, bucket, midiLocalPath, midiRemotePath, inferContentType(folder.files.midi), dryRun);
      }
      if (xmlLocalPath && folder.files.musicxml) {
        await uploadFile(supabase, bucket, xmlLocalPath, xmlRemotePath, inferContentType(folder.files.musicxml), dryRun);
      }

      const hasPracticeFiles = Boolean(
        midiLocalPath && xmlLocalPath && folder.files.midi && folder.files.musicxml,
      );
      if (hasPracticeFiles) {
        if (!assertedPracticeBucket) {
          await assertPracticeBucketExists(supabase, practiceBucketName);
          assertedPracticeBucket = true;
        }
        const overwritePractice = isPracticeMigrationOverwriteEnabled();
        const publishResult = await publishMidiXmlToPracticeBucket({
          supabase,
          songsBucket: bucket,
          practiceBucket: practiceBucketName,
          midiKey: midiRemotePath,
          xmlKey: xmlRemotePath,
          dryRun: false,
          overwrite: overwritePractice,
        });
        console.log(
          `[migrate-local-songs] practice broker bucket "${practiceBucketName}": MIDI ${publishResult.midi}, XML ${publishResult.xml}` +
            (overwritePractice ? ' (overwrite=1)' : ''),
        );
      }

      const { durationLabel } = await readDurationLabel(audioLocalPath);
      const row = buildMigrationRow(
        folder,
        storageSlug,
        durationLabel,
        resolvedSupabaseUrl,
        bucket,
        existingRow,
      );
      await ensureArtistRowExists(supabase, row.artist, dryRun);
      const upsertResult = await supabase
        .from('songs')
        .upsert(row, { onConflict: 'slug' })
        .select('slug');
      if (upsertResult.error) throw upsertResult.error;
      console.log(`Migrated ${folder.slug}`);
    }
    return;
  }

  console.log(`[dry-run] local folders: ${folders.length}`);
  console.log(`[dry-run] selected: ${selectedFolders.length}`);
  console.log(`[dry-run] bucket: ${bucket}`);
  const practiceBucketDry = resolveImportPracticeBucketName();
  const overwriteDry = isPracticeMigrationOverwriteEnabled();
  console.log(
    `[dry-run] Practice broker mirror target SUPABASE_PRACTICE_BUCKET="${practiceBucketDry}" overwrite PRACTICE_MIGRATION_OVERWRITE=${overwriteDry ? '1' : '(off)'}`,
  );

  /** Best-effort: match apply-mode storageSlug when service role credentials are available. */
  let existingRowsDry = new Map<string, ExistingSongRow>();
  try {
    const { client: sbDry } = buildSupabaseClient();
    existingRowsDry = await loadExistingSongsBySlug(
      sbDry,
      selectedFolders.map(f => f.slug),
    );
  } catch {
    /** Missing SUPABASE_SERVICE_ROLE_KEY → preview uses folder slug + artist heuristic only */
  }

  for (const folder of selectedFolders) {
    const audioLocalPath = path.join(folder.dirPath, folder.files.audio as string);
    const { durationLabel } = await readDurationLabel(audioLocalPath);
    const draftTrack = buildLocalImportTrack(folder.seed);
    const existingRowDry = existingRowsDry.get(folder.slug);
    const resolvedArtistForSlug = pickPreferredString(
      existingRowDry?.artist,
      draftTrack.artist,
      draftTrack.sourceArtist,
    );
    const storageSlug = resolveFinalStorageSlug(folder, resolvedArtistForSlug, existingRowDry);
    const row = buildMigrationRow(folder, storageSlug, durationLabel, supabaseUrl, bucket, existingRowDry);
    console.log(
      JSON.stringify(
        {
          slug: row.slug,
          storage_slug: storageSlug,
          title: row.title,
          artist: row.artist,
          primary_category: row.primary_category,
          secondary_category: row.secondary_category,
          audio_path: row.audio_path,
          audio_url: row.audio_url,
          midi_path: row.midi_path,
          midi_url: row.midi_url,
          xml_path: row.xml_path,
          musicxml_url: row.musicxml_url,
          cover_url: row.cover_url,
          youtube_url: row.youtube_url,
          sheet_url: row.sheet_url,
          duration: row.duration,
          is_published: row.is_published,
          has_practice_mode: row.has_practice_mode,
        },
        null,
        2,
      ),
    );
    if (row.has_practice_mode) {
      console.log(
        `  [dry-run] (--apply would mirror performance.mid + score.musicxml to "${practiceBucketDry}" keys: ${row.midi_path}; ${row.xml_path})`,
      );
    }
  }
}

async function main() {
  const options = parseArgs();
  if (options.deleteSongId || options.deleteSongSlug) {
    await runDeleteMode(options);
    return;
  }
  await runMigrationMode(options);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
