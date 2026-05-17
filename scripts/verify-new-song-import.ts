import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  hasCompletePracticeFiles,
  listLocalImportFiles,
  loadImportSpecs,
  parseArgs,
  projectRoot,
  validateImportFiles,
  validateMetadata,
  type NormalizedNewSongImport,
} from './new-song-import-shared.ts';

type ManifestEntry = {
  id: string;
  slug?: string;
  title?: string;
  displayTitle?: string;
  hasPracticeMode?: boolean;
  youtubeVideoUrl?: string | null;
  bilibiliVideoUrl?: string | null;
  listSortPublishedAtMs?: number | null;
  listSortSource?: string | null;
};

type DbRow = {
  id: string;
  slug: string;
  title: string | null;
  artist: string | null;
  has_practice_mode: boolean | null;
  list_sort_published_at_ms: number | string | null;
  list_sort_source: string | null;
  audio_path: string | null;
  midi_path: string | null;
  xml_path: string | null;
  youtube_url: string | null;
  sheet_url: string | null;
};

function readManifestEntries() {
  const publicDir = path.join(projectRoot, 'public');
  const catalogPath = path.join(publicDir, 'songs-manifest.json');
  if (!fs.existsSync(catalogPath)) throw new Error('Missing public/songs-manifest.json. Run npm run build:manifest first.');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as {
    chunks?: Array<{ path: string; count: number }>;
  };
  const entries: ManifestEntry[] = [];
  for (const chunk of catalog.chunks ?? []) {
    const chunkPath = path.join(publicDir, chunk.path);
    const raw = JSON.parse(fs.readFileSync(chunkPath, 'utf8')) as { tracks?: ManifestEntry[] };
    entries.push(...(raw.tracks ?? []));
  }
  return entries;
}

function verifyNoPublicPracticeUrls() {
  const publicDir = path.join(projectRoot, 'public');
  const files = [
    path.join(publicDir, 'songs-manifest.json'),
    ...fs
      .readdirSync(publicDir)
      .filter(file => /^songs-manifest-chunk-\d+\.json$/.test(file))
      .map(file => path.join(publicDir, file)),
  ];
  const offenders: string[] = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    if (/"midiUrl"\s*:|"musicXmlUrl"\s*:|\.midi?\b|\.musicxml\b/i.test(raw)) {
      offenders.push(path.relative(projectRoot, file));
    }
  }
  return offenders;
}

function resolveWebVideoForLocale(entry: ManifestEntry, locale: 'en' | 'zh-Hans' | 'zh-Hant') {
  const youtube = entry.youtubeVideoUrl || undefined;
  const bilibili = entry.bilibiliVideoUrl || undefined;
  if (locale === 'zh-Hans' || locale === 'zh-Hant') return bilibili || youtube;
  return youtube || bilibili;
}

async function loadDbRows(slugs: string[]) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !key) return { skipped: true as const, rows: [] as DbRow[], duplicateWarnings: [] as string[] };
  const supabase = createClient(supabaseUrl, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('songs')
    .select('id,slug,title,artist,has_practice_mode,list_sort_published_at_ms,list_sort_source,audio_path,midi_path,xml_path,youtube_url,sheet_url')
    .in('slug', slugs);
  if (error) throw error;
  const rows = (data ?? []) as DbRow[];
  const duplicateWarnings: string[] = [];
  for (const row of rows) {
    if (!row.title || !row.artist) continue;
    const dup = await supabase
      .from('songs')
      .select('id,slug,title,artist')
      .ilike('title', row.title)
      .ilike('artist', row.artist);
    if (dup.error) throw dup.error;
    const hits = (dup.data ?? []).filter(hit => hit.slug !== row.slug);
    if (hits.length > 0) {
      duplicateWarnings.push(
        `"${row.slug}" has same title+artist as existing row(s): ${hits.map(hit => hit.slug || hit.id).join(', ')}`,
      );
    }
  }
  return { skipped: false as const, rows, duplicateWarnings };
}

function verifyManifest(specs: NormalizedNewSongImport[], entries: ManifestEntry[], maxNewestRank: number) {
  const failures: string[] = [];
  const report: Array<Record<string, unknown>> = [];
  for (const spec of specs) {
    const entry = entries.find(item => item.slug === spec.slug);
    if (!entry) {
      failures.push(`Manifest missing slug "${spec.slug}"`);
      continue;
    }
    const rank = entries.indexOf(entry) + 1;
    const completePractice = hasCompletePracticeFiles(spec);
    if (completePractice && entry.hasPracticeMode !== true) {
      failures.push(`"${spec.slug}" has audio+MIDI+MusicXML locally but manifest hasPracticeMode is not true.`);
    }
    if (!completePractice && entry.hasPracticeMode === true) {
      const files = listLocalImportFiles(spec);
      failures.push(
        `"${spec.slug}" has incomplete local practice files but manifest hasPracticeMode=true ` +
          `(audio=${Boolean(files.audio)} midi=${Boolean(files.midi)} musicxml=${Boolean(files.musicxml)}).`,
      );
    }
    if (rank > maxNewestRank) {
      failures.push(`"${spec.slug}" is rank ${rank} in Newest; expected <= ${maxNewestRank}.`);
    }
    if (typeof entry.listSortPublishedAtMs !== 'number' || !Number.isFinite(entry.listSortPublishedAtMs)) {
      failures.push(`"${spec.slug}" is missing numeric listSortPublishedAtMs in manifest.`);
    }
    if (!entry.listSortSource) {
      failures.push(`"${spec.slug}" is missing listSortSource in manifest.`);
    }

    const enVideo = resolveWebVideoForLocale(entry, 'en');
    const zhHansVideo = resolveWebVideoForLocale(entry, 'zh-Hans');
    const zhHantVideo = resolveWebVideoForLocale(entry, 'zh-Hant');
    if (spec.youtubeUrl && enVideo !== spec.youtubeUrl) {
      failures.push(`"${spec.slug}" English web video resolves to ${enVideo || '(none)'}; expected YouTube ${spec.youtubeUrl}.`);
    }
    if (spec.bilibiliUrl && zhHansVideo !== spec.bilibiliUrl) {
      failures.push(`"${spec.slug}" zh-Hans web video resolves to ${zhHansVideo || '(none)'}; expected Bilibili ${spec.bilibiliUrl}.`);
    }
    if (spec.bilibiliUrl && zhHantVideo !== spec.bilibiliUrl) {
      failures.push(`"${spec.slug}" zh-Hant web video resolves to ${zhHantVideo || '(none)'}; expected Bilibili ${spec.bilibiliUrl}.`);
    }
    if (!spec.bilibiliUrl && spec.youtubeUrl && (zhHansVideo !== spec.youtubeUrl || zhHantVideo !== spec.youtubeUrl)) {
      failures.push(`"${spec.slug}" Chinese web video should fall back to YouTube when no Bilibili URL exists.`);
    }

    report.push({
      slug: spec.slug,
      newestRank: rank,
      hasPracticeMode: entry.hasPracticeMode,
      listSortPublishedAtMs: entry.listSortPublishedAtMs,
      listSortSource: entry.listSortSource,
      webVideoEnglish: enVideo ?? null,
      webVideoZhHans: zhHansVideo ?? null,
      webVideoZhHant: zhHantVideo ?? null,
    });
  }
  return { failures, report };
}

function verifyDbRows(specs: NormalizedNewSongImport[], rows: DbRow[]) {
  const failures: string[] = [];
  for (const spec of specs) {
    const matches = rows.filter(row => row.slug === spec.slug);
    if (matches.length === 0) {
      failures.push(`Supabase missing song row for slug "${spec.slug}"`);
      continue;
    }
    if (matches.length > 1) failures.push(`Supabase has duplicate rows for slug "${spec.slug}"`);
    const row = matches[0];
    const completePractice = hasCompletePracticeFiles(spec);
    if (completePractice && row.has_practice_mode !== true) {
      failures.push(`Supabase "${spec.slug}" has audio+MIDI+MusicXML locally but has_practice_mode is not true.`);
    }
    const dbSortMs =
      row.list_sort_published_at_ms == null || row.list_sort_published_at_ms === ''
        ? NaN
        : Number(row.list_sort_published_at_ms);
    if (!Number.isFinite(dbSortMs)) {
      failures.push(`Supabase "${spec.slug}" missing list_sort_published_at_ms.`);
    }
    if (!row.list_sort_source) failures.push(`Supabase "${spec.slug}" missing list_sort_source.`);
    if (spec.youtubeUrl && row.youtube_url !== spec.youtubeUrl) {
      failures.push(`Supabase "${spec.slug}" youtube_url=${row.youtube_url || '(none)'}; expected ${spec.youtubeUrl}.`);
    }
  }
  return failures;
}

async function main() {
  const options = parseArgs();
  const specs = loadImportSpecs(options.metadataPath);
  const failures: string[] = [
    ...validateMetadata(specs),
    ...validateImportFiles(specs),
  ];
  const maxNewestRank =
    typeof options.maxNewestRank === 'number' && Number.isFinite(options.maxNewestRank) && options.maxNewestRank > 0
      ? options.maxNewestRank
      : specs.length;

  const leaks = verifyNoPublicPracticeUrls();
  if (leaks.length > 0) failures.push(`Public manifest leaked MIDI/MusicXML fields or paths: ${leaks.join(', ')}`);

  const entries = readManifestEntries();
  const manifest = verifyManifest(specs, entries, maxNewestRank);
  failures.push(...manifest.failures);

  const db = await loadDbRows(specs.map(spec => spec.slug));
  if (!db.skipped) failures.push(...verifyDbRows(specs, db.rows));

  console.log('\n=== New Song Import Verification ===');
  console.table(manifest.report);
  if (db.skipped) {
    console.warn('Supabase row verification skipped: missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }
  for (const warning of db.duplicateWarnings) console.warn(`WARN duplicate title+artist: ${warning}`);
  console.log(`Public MIDI/MusicXML leak check: ${leaks.length === 0 ? 'PASS' : 'FAIL'}`);

  if (failures.length > 0) {
    console.error('\nFAIL');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('\nPASS: new-song import checks passed.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
