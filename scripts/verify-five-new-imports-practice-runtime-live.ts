/**
 * Live end-to-end Practice Mode entry simulation for the 5 new songs.
 *
 * This script does what the website actually does when opening Practice
 * Mode for one of the failing songs:
 *
 *   1. Fetch the row from Supabase using **exactly** the `SUPABASE_REMOTE_SONG_COLUMNS`
 *      selection the anon UI uses (so we hit the same redacted column set).
 *   2. Run `mapSupabaseRowToRemoteTrack` + `mergeCanonicalIntoTrack` (the
 *      same pipeline as `src/App.tsx` line 870-872).
 *   3. Assert `hasPracticeAssets(track) === true` (the gate for the button).
 *   4. Sign-in as the verify test user and call the broker for the resulting
 *      Track id — confirm we receive signed MIDI/MusicXML URLs.
 *
 * Run:
 *   tsx scripts/verify-five-new-imports-practice-runtime-live.ts
 */
import dotenv from 'dotenv';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import type {HandlerEvent} from '@netlify/functions';

import {mergeCanonicalIntoTrack} from '../src/songs-manifest';
import {hasPracticeAssets} from '../src/track-display';
import {toSupabaseStoragePublicUrl} from '../src/lib/supabase-storage-public-url';
import type {Track, MetadataCandidate} from '../src/types/track';

dotenv.config({path: path.resolve(process.cwd(), '.env')});
dotenv.config({path: path.resolve(process.cwd(), '.env.local')});

const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY?.trim() || '';
const SONGS_BUCKET = process.env.VITE_SUPABASE_SONGS_BUCKET?.trim() || 'songs';

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error('Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY');
  process.exit(2);
}
process.env.SUPABASE_URL = SUPABASE_URL;

const {handler: practiceBrokerHandler} = await import(
  '../netlify/functions/practice-asset-url.ts'
);

const FIVE = [
  {id: 'c0d763ff-4378-4dfc-8299-938eed122eac', label: '一个人想着一个人'},
  {id: 'd58c71f9-db53-4913-9622-cb02071d8c21', label: 'Beauty And A Beat'},
  {id: '4c828c96-de0e-4481-aff9-0ae4a3139358', label: "It's Me"},
  {id: 'ae2f8edb-e1e4-4f38-8777-0a59887426af', label: 'BonBon Girls (浪姐版)'},
  {id: '79248e52-11ca-45fd-8822-8a5f94a1cfc0', label: 'Someone to Love'},
];

/** Identical to the anon SELECT list in src/App.tsx (Phase A2 redacted). */
const SUPABASE_REMOTE_SONG_COLUMNS =
  'id,slug,title,artist,primary_category,secondary_category,duration,audio_url,cover_url,has_practice_mode,youtube_url,sheet_url,source_song_title,source_artist,source_cover_url,source_album,source_release_year,source_category,source_genre,metadata_source,metadata_confidence,metadata_status,metadata_candidates,list_sort_published_at_ms,list_sort_source';

/** Mirror of src/App.tsx:mapSupabaseRowToRemoteTrack. */
function mapSupabaseRowToRemoteTrack(song: Record<string, unknown>): Track {
  const resolve = (v: unknown) =>
    toSupabaseStoragePublicUrl(SUPABASE_URL, SONGS_BUCKET, v as string | undefined);
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

async function invokeBroker(token: string, trackId: string) {
  const event: HandlerEvent = {
    httpMethod: 'POST',
    headers: {authorization: `Bearer ${token}`},
    body: JSON.stringify({trackId}),
    rawUrl: '',
    rawQuery: '',
    path: '/.netlify/functions/practice-asset-url',
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    isBase64Encoded: false,
  } as HandlerEvent;
  return (await practiceBrokerHandler(event, {} as never, () => undefined)) as unknown as {
    statusCode: number;
    body: string;
  };
}

async function ensureTestUser(): Promise<{userId: string; accessToken: string}> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {auth: {persistSession: false}});
  const email = 'phase-c-runtime-live-5new@example.com';
  const password = 'StrongPass!12345';
  const list = await admin.auth.admin.listUsers({page: 1, perPage: 200});
  const existing = list.data?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
  let userId = existing?.id;
  if (!userId) {
    const created = await admin.auth.admin.createUser({email, password, email_confirm: true});
    if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);
    userId = created.data.user.id;
  } else {
    await admin.auth.admin.updateUserById(userId, {password, email_confirm: true});
  }
  const anon = createClient(SUPABASE_URL, ANON_KEY, {auth: {persistSession: false}});
  const sign = await anon.auth.signInWithPassword({email, password});
  if (sign.error || !sign.data.session) throw new Error(`signIn failed: ${sign.error?.message}`);
  return {userId, accessToken: sign.data.session.access_token};
}

(async () => {
  /** anon-key client matches what the website uses for the idle remote fetch */
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, {auth: {persistSession: false}});

  console.log('=== LIVE Practice Mode entry simulation ===');
  console.log('1) anon SELECT (Phase A2 redacted columns)');
  console.log('2) mapSupabaseRowToRemoteTrack → mergeCanonicalIntoTrack');
  console.log('3) hasPracticeAssets() gate');
  console.log('4) broker resolves signed MIDI / MusicXML URLs\n');

  const {accessToken, userId} = await ensureTestUser();
  console.log('signed-in test userId =', userId, '\n');

  let failures = 0;
  for (const t of FIVE) {
    const res = await anonClient
      .from('songs')
      .select(SUPABASE_REMOTE_SONG_COLUMNS)
      .eq('id', t.id)
      .maybeSingle();
    if (res.error || !res.data) {
      console.log(`SKIP ${t.id} (${t.label}): anon SELECT failed`, res.error?.message);
      failures++;
      continue;
    }
    const row = res.data as Record<string, unknown>;
    const remote = mapSupabaseRowToRemoteTrack(row);
    const finalTrack = mergeCanonicalIntoTrack(remote);
    const gate = hasPracticeAssets(finalTrack);
    if (!gate) {
      console.log(
        `FAIL ${t.id} (${t.label}): hasPracticeAssets()=false (practiceEnabled=${finalTrack.practiceEnabled}, metadataPracticeEnabled=${finalTrack.metadata.assets.practiceEnabled})`,
      );
      failures++;
      continue;
    }
    const brokerRes = await invokeBroker(accessToken, t.id);
    const parsed = JSON.parse(brokerRes.body || '{}');
    if (brokerRes.statusCode !== 200 || parsed.ok !== true) {
      console.log(`FAIL ${t.id} (${t.label}): broker HTTP ${brokerRes.statusCode}`, parsed);
      failures++;
      continue;
    }
    if (
      typeof parsed.midiUrl !== 'string' ||
      typeof parsed.musicXmlUrl !== 'string' ||
      !parsed.midiUrl.includes('/object/sign/') ||
      !parsed.musicXmlUrl.includes('/object/sign/')
    ) {
      console.log(`FAIL ${t.id} (${t.label}): broker returned non-signed URLs`, parsed);
      failures++;
      continue;
    }
    /** Confirm the signed URLs actually resolve in HTTP HEAD. */
    const [m, x] = await Promise.all([
      fetch(parsed.midiUrl as string, {method: 'HEAD'}),
      fetch(parsed.musicXmlUrl as string, {method: 'HEAD'}),
    ]);
    if (!m.ok || !x.ok) {
      console.log(`FAIL ${t.id} (${t.label}): signed URL HEAD midi=${m.status} xml=${x.status}`);
      failures++;
      continue;
    }
    console.log(
      `OK  ${t.id}  ${t.label.padEnd(28)} gate=${gate} broker=200 midi=${m.status} xml=${x.status}`,
    );
  }
  if (failures > 0) {
    console.log(`\nFAIL: ${failures} of ${FIVE.length} failed end-to-end Practice entry.`);
    process.exit(1);
  }
  console.log(`\nPASS: all ${FIVE.length} new songs pass Practice Mode entry end-to-end.`);
})().catch(err => {
  console.error('runtime-live verify failed:', err);
  process.exit(1);
});
