/**
 * Simulate the actual website Practice Mode runtime path for the 5 new songs
 * (commit df96529 / 81fe325) **without** a browser:
 *
 *   1. Load the manifest entry → `manifestEntryToTrack` (same as initial paint)
 *   2. Simulate the idle Supabase fetch using the **same** `mapSupabaseRowToRemoteTrack`
 *      + `mergeCanonicalIntoTrack` pipeline the UI uses at line 870-872 of App.tsx
 *   3. Verify the post-merge Track still has `practiceEnabled === true`
 *      and that `hasPracticeAssets(track)` returns true
 *
 * The bug we are hunting: anything in the runtime pipeline that flips
 * `practiceEnabled` to false even though `has_practice_mode = true` in DB
 * and `hasPracticeMode = true` in the public manifest.
 *
 * Usage:
 *   tsx scripts/verify-five-new-imports-practice-runtime.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import {manifestEntryToTrack} from '../src/songs-manifest';
import {mergeCanonicalIntoTrack} from '../src/songs-manifest';
import type {SongManifestEntry} from '../src/songs-manifest';
import {hasPracticeAssets} from '../src/track-display';
import type {Track, MetadataCandidate} from '../src/types/track';
import {toSupabaseStoragePublicUrl} from '../src/lib/supabase-storage-public-url';

const FIVE = [
  {id: 'c0d763ff-4378-4dfc-8299-938eed122eac', label: '一个人想着一个人'},
  {id: 'd58c71f9-db53-4913-9622-cb02071d8c21', label: 'Beauty And A Beat'},
  {id: '4c828c96-de0e-4481-aff9-0ae4a3139358', label: "It's Me"},
  {id: 'ae2f8edb-e1e4-4f38-8777-0a59887426af', label: '心愿便利贴+BonBon Girls'},
  {id: '79248e52-11ca-45fd-8822-8a5f94a1cfc0', label: 'Someone to Love'},
];

const REFERENCE_WORKING_PRACTICE_ID = 'b2e508b8-e675-41e4-a4af-1c2a20546de7'; // 曾经我也想过一了百了 (OV, older)
const REFERENCE_NO_OV_PRACTICE_ID = '3e00992c-1f2c-4c6b-be3f-175b2a6d4c9f'; // 那天下雨了 (no OV)

/** Mirror of App.tsx:mapSupabaseRowToRemoteTrack (Phase A2 anon-safe SELECT). */
function mapSupabaseRowToRemoteTrack(song: Record<string, unknown>, supabaseUrl: string, bucket: string): Track {
  const resolve = (v: unknown) =>
    toSupabaseStoragePublicUrl(supabaseUrl, bucket, v as string | undefined);
  const audioUrl = resolve(song.audio_url);
  const coverUrl = resolve(song.cover_url) || '';
  const sourceCoverUrl = resolve(song.source_cover_url) || undefined;
  const midiUrl = undefined;
  const musicxmlUrl = undefined;
  const duration = (song.duration as string) || '00:00';
  const hasPracticeAssetsRow = song.has_practice_mode === true;
  return {
    id: song.id as string,
    title: song.title as string,
    artist: song.artist as string,
    category: (song.primary_category as string) || 'Originals',
    tags: (song.secondary_category as string[]) || [],
    duration,
    audioUrl,
    coverUrl,
    musicxmlUrl,
    midiUrl,
    practiceEnabled: hasPracticeAssetsRow,
    youtubeUrl: song.youtube_url as string,
    bilibiliUrl: (song.bilibili_url as string | undefined) ?? '',
    sheetUrl: song.sheet_url as string,
    sourceSongTitle: song.source_song_title as string,
    sourceArtist: song.source_artist as string,
    sourceCoverUrl,
    sourceAlbum: song.source_album as string,
    sourceReleaseYear: song.source_release_year as string,
    sourceCategory: song.source_category as string,
    sourceGenre: song.source_genre as string,
    metadataSource: song.metadata_source as string,
    metadataConfidence: song.metadata_confidence as number,
    metadataStatus: ((song.metadata_status as string) || 'pending') as Track['metadataStatus'],
    metadataCandidates: (song.metadata_candidates as MetadataCandidate[]) || [],
    importSource: 'remote' as const,
    metadata: {
      identity: {
        id: song.id as string,
        slug: (song.slug as string | undefined) || undefined,
        importSource: 'remote' as const,
      },
      display: {
        title: song.title as string,
        artist: song.artist as string,
        category: (song.primary_category as string) || 'Originals',
        categories: {
          primary: (song.primary_category as string) || 'Originals',
          tags: (song.secondary_category as string[]) || [],
        },
        cover: coverUrl,
      },
      assets: {
        audioUrl,
        midiUrl,
        musicxmlUrl,
        hasPracticeAssets: hasPracticeAssetsRow,
        practiceEnabled: hasPracticeAssetsRow,
        durationLabel: duration,
      },
      links: {
        youtube: song.youtube_url as string,
        video: (song.bilibili_url as string | undefined) ?? '',
        sheet: song.sheet_url as string,
      },
      enrichment: {
        status: song.metadata_status === 'approved' ? 'auto' : 'manual',
      },
    },
  };
}

function loadAllManifestEntries(): SongManifestEntry[] {
  const root = path.resolve(process.cwd(), 'public');
  const catalogPath = path.join(root, 'songs-manifest.json');
  if (!fs.existsSync(catalogPath)) throw new Error('public/songs-manifest.json missing');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (Array.isArray(catalog?.tracks)) return catalog.tracks as SongManifestEntry[];
  if (catalog?.kind === 'catalog' && Array.isArray(catalog.chunks)) {
    const entries: SongManifestEntry[] = [];
    for (const ch of catalog.chunks as {path: string}[]) {
      const p = path.join(root, ch.path);
      if (!fs.existsSync(p)) continue;
      const chunk = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(chunk?.tracks)) entries.push(...(chunk.tracks as SongManifestEntry[]));
    }
    return entries;
  }
  throw new Error('Unrecognized manifest layout');
}

function reportTrack(label: string, t: Track | null): void {
  if (!t) {
    console.log(`  ${label}: <not found>`);
    return;
  }
  const gate = hasPracticeAssets(t);
  console.log(
    `  ${label}: practiceEnabled=${t.practiceEnabled} ` +
      `metaPracticeEnabled=${t.metadata.assets.practiceEnabled} ` +
      `metaHasPracticeAssets=${t.metadata.assets.hasPracticeAssets} ` +
      `midiUrl=${t.midiUrl ?? '∅'} musicxmlUrl=${t.musicxmlUrl ?? '∅'} ` +
      `→ hasPracticeAssets()=${gate}`,
  );
}

(async () => {
  const entries = loadAllManifestEntries();
  const allIds = [
    ...FIVE.map(f => f.id),
    REFERENCE_WORKING_PRACTICE_ID,
    REFERENCE_NO_OV_PRACTICE_ID,
  ];
  const supabaseUrl =
    process.env.VITE_SUPABASE_URL?.trim() || 'https://hngtwkayovuxhiqustsa.supabase.co';
  const bucket = process.env.VITE_SUPABASE_SONGS_BUCKET?.trim() || 'songs';

  let failures = 0;
  console.log('=== Runtime path simulation: manifest → idle Supabase replace ===');
  console.log('(idle replace uses mergeCanonicalIntoTrack(mapSupabaseRowToRemoteTrack(row)))\n');
  for (const id of allIds) {
    const entry = entries.find(e => e.id === id);
    if (!entry) {
      console.log(`SKIP ${id}: no manifest entry found`);
      continue;
    }
    const label = `${id}  ${entry.title}`;
    console.log(`---- ${label} ----`);

    const trackFromManifest = manifestEntryToTrack(entry);
    reportTrack('manifest paint', trackFromManifest);

    /** Simulate the idle Supabase row that the website fetches from
     * `songs` table with SUPABASE_REMOTE_SONG_COLUMNS. Use the manifest
     * entry to populate the same set of fields (no live network needed). */
    const fakeSupabaseRow: Record<string, unknown> = {
      id: entry.id,
      slug: entry.slug,
      title: entry.title,
      artist: entry.originalArtist,
      primary_category: entry.tags?.[0] ?? 'Originals',
      secondary_category: entry.tags ?? [],
      duration: entry.duration,
      audio_url: entry.mp3Url,
      cover_url: entry.coverUrl,
      has_practice_mode: true,
      youtube_url: entry.youtubeVideoUrl ?? null,
      sheet_url: entry.sheetUrl ?? null,
      metadata_status: 'manual',
    };
    const remoteTrack = mapSupabaseRowToRemoteTrack(fakeSupabaseRow, supabaseUrl, bucket);
    reportTrack('supabase map (pre-merge)', remoteTrack);

    const finalTrack = mergeCanonicalIntoTrack(remoteTrack);
    reportTrack('after mergeCanonicalIntoTrack', finalTrack);

    if (!hasPracticeAssets(finalTrack)) {
      failures++;
      console.log(
        `  ↳ FAIL: hasPracticeAssets() returned false in final post-idle track for ${entry.title}`,
      );
    } else {
      console.log(`  ↳ OK`);
    }
    console.log('');
  }

  if (failures > 0) {
    console.log(`\nFAIL: ${failures} track(s) lost practiceEnabled after the idle Supabase replace.`);
    process.exit(1);
  }
  console.log(`\nPASS: all sampled tracks preserved hasPracticeAssets() across the idle replace.`);
})().catch(err => {
  console.error('verify failed:', err);
  process.exit(1);
});
