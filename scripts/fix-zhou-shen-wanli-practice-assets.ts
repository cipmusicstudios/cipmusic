/**
 * SURGICAL ONE-OFF: replace ONLY the Practice MIDI and MusicXML files for
 * 周深 / Zhou Shen — 《万里》.
 *
 *   Target song id (whitelist):  5ba8ee44-a0e7-42b4-bd9f-576dc453244b
 *   Target slug:                 万里
 *   Target artist (verified):    周深
 *   Target storage slug:         track-d162b5ee37
 *
 * What this script DOES:
 *   • Reads `public/local-imports/万里/performance.mid` and
 *     `public/local-imports/万里/score.musicxml` from disk.
 *   • Uploads them into BOTH
 *       - `songs/songs/track-d162b5ee37/performance.mid`
 *       - `songs/songs/track-d162b5ee37/score.musicxml`
 *       - `practice-assets/songs/track-d162b5ee37/performance.mid`
 *       - `practice-assets/songs/track-d162b5ee37/score.musicxml`
 *     with `upsert: true`, replacing the wrong files currently at those keys.
 *
 * What this script DOES NOT DO:
 *   • Does NOT touch `audio.mp3` (the existing audio is correct).
 *   • Does NOT modify the `songs` DB row (every field on it is already
 *     correct — only the file content at the existing storage paths is wrong).
 *   • Does NOT touch any other song. If the row at the whitelisted id
 *     doesn't match the expected slug / title / artist / storage slug, the
 *     script bails with FATAL before any write.
 *   • Does NOT touch INTO1's 万里 (which doesn't exist in the current
 *     manifest anyway, and would have a different song id).
 *
 * Safety gates (matches the convention used by `copy-five-new-imports-to-
 * practice-assets.ts` and `prepare-practice-assets-migration.ts`):
 *
 *   Default                                                    →  DRY RUN
 *   PRACTICE_MIGRATION_APPLY=1 PRACTICE_MIGRATION_CONFIRM=fix-zhou-shen-wanli
 *                                                              →  APPLY
 *
 * Writes a JSON report to `tmp/fix-zhou-shen-wanli.json` including before /
 * after object sizes and updated_at timestamps for every relevant key in
 * both buckets, so the audio.mp3 untouched-ness can be confirmed at a glance.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

// ── Hardcoded whitelist + invariants ─────────────────────────────────────────
const TARGET_SONG_ID = '5ba8ee44-a0e7-42b4-bd9f-576dc453244b';
const EXPECTED_SLUG = '万里';
const EXPECTED_TITLE = '万里';
const EXPECTED_ARTIST = '周深';
const EXPECTED_STORAGE_SLUG = 'track-d162b5ee37';
const SONGS_BUCKET = process.env.SUPABASE_SONGS_BUCKET?.trim() || 'songs';
const PRACTICE_BUCKET = process.env.SUPABASE_PRACTICE_BUCKET?.trim() || 'practice-assets';
const REQUIRED_CONFIRM = 'fix-zhou-shen-wanli';

const LOCAL_IMPORT_DIR = path.resolve(process.cwd(), 'public', 'local-imports', '万里');
const LOCAL_MIDI = path.join(LOCAL_IMPORT_DIR, 'performance.mid');
const LOCAL_XML = path.join(LOCAL_IMPORT_DIR, 'score.musicxml');

const REMOTE_MIDI_KEY = `songs/${EXPECTED_STORAGE_SLUG}/performance.mid`;
const REMOTE_XML_KEY = `songs/${EXPECTED_STORAGE_SLUG}/score.musicxml`;
const REMOTE_AUDIO_KEY = `songs/${EXPECTED_STORAGE_SLUG}/audio.mp3`;

// ── Helpers ──────────────────────────────────────────────────────────────────
type ListedObject = {
  name: string;
  size: number | null;
  updatedAt: string | null;
  contentType: string | null;
  exists: boolean;
};

async function probeWithMetadata(
  supabase: SupabaseClient,
  bucket: string,
  key: string,
): Promise<ListedObject> {
  const idx = key.lastIndexOf('/');
  const dir = idx < 0 ? '' : key.slice(0, idx);
  const file = idx < 0 ? key : key.slice(idx + 1);
  const res = await supabase.storage
    .from(bucket)
    .list(dir, { limit: 200, offset: 0, search: file });
  if (res.error) {
    return { name: file, size: null, updatedAt: null, contentType: null, exists: false };
  }
  const hit = (res.data ?? []).find((e) => e.name === file);
  if (!hit) {
    return { name: file, size: null, updatedAt: null, contentType: null, exists: false };
  }
  const meta = (hit as { metadata?: { size?: number; mimetype?: string } }).metadata;
  return {
    name: file,
    size: typeof meta?.size === 'number' ? meta.size : null,
    updatedAt: (hit as { updated_at?: string }).updated_at ?? null,
    contentType: meta?.mimetype ?? null,
    exists: true,
  };
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function inferContentType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.mid') || lower.endsWith('.midi')) return 'audio/midi';
  if (lower.endsWith('.musicxml')) return 'application/vnd.recordare.musicxml+xml';
  return 'application/octet-stream';
}

async function uploadReplace(
  supabase: SupabaseClient,
  bucket: string,
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await supabase.storage.from(bucket).upload(key, bytes, {
    upsert: true,
    contentType,
  });
  if (res.error) return { ok: false, message: res.error.message };
  return { ok: true };
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const applyRequested = process.env.PRACTICE_MIGRATION_APPLY?.trim() === '1';
  const confirmed = process.env.PRACTICE_MIGRATION_CONFIRM?.trim() === REQUIRED_CONFIRM;
  const dryRun = !(applyRequested && confirmed);

  console.log('[fix-zhou-shen-wanli] ============================================');
  console.log('[fix-zhou-shen-wanli]  Target song id:', TARGET_SONG_ID);
  console.log('[fix-zhou-shen-wanli]  Expected slug :', EXPECTED_SLUG);
  console.log('[fix-zhou-shen-wanli]  Expected title:', EXPECTED_TITLE);
  console.log('[fix-zhou-shen-wanli]  Expected artst:', EXPECTED_ARTIST);
  console.log('[fix-zhou-shen-wanli]  Storage slug  :', EXPECTED_STORAGE_SLUG);
  console.log('[fix-zhou-shen-wanli]  Songs bucket  :', SONGS_BUCKET);
  console.log('[fix-zhou-shen-wanli]  Practice bkt  :', PRACTICE_BUCKET);
  console.log('[fix-zhou-shen-wanli]  Mode          :', dryRun ? 'DRY RUN' : 'APPLY');
  console.log('[fix-zhou-shen-wanli] ============================================');
  if (dryRun) {
    console.log(
      `[fix-zhou-shen-wanli] (To apply: PRACTICE_MIGRATION_APPLY=1 PRACTICE_MIGRATION_CONFIRM=${REQUIRED_CONFIRM})`,
    );
  }

  // 1. Verify local files exist + read them.
  if (!fs.existsSync(LOCAL_MIDI)) {
    console.error(`[fix-zhou-shen-wanli] FATAL: missing local MIDI: ${LOCAL_MIDI}`);
    process.exit(2);
  }
  if (!fs.existsSync(LOCAL_XML)) {
    console.error(`[fix-zhou-shen-wanli] FATAL: missing local MusicXML: ${LOCAL_XML}`);
    process.exit(2);
  }
  const midiBytes = fs.readFileSync(LOCAL_MIDI);
  const xmlBytes = fs.readFileSync(LOCAL_XML);
  const midiSha = sha256(midiBytes);
  const xmlSha = sha256(xmlBytes);
  console.log(`[fix-zhou-shen-wanli] local performance.mid  ${midiBytes.length} bytes  sha256=${midiSha}`);
  console.log(`[fix-zhou-shen-wanli] local score.musicxml   ${xmlBytes.length} bytes  sha256=${xmlSha}`);

  // 2. Build Supabase client.
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
    db: { schema: 'public' },
  });

  // 3. Fetch the DB row by ID and verify every invariant before any write.
  const rowRes = await supabase
    .from('songs')
    .select('id,slug,title,artist,audio_path,midi_path,xml_path,has_practice_mode')
    .eq('id', TARGET_SONG_ID)
    .maybeSingle();
  if (rowRes.error) {
    console.error(`[fix-zhou-shen-wanli] FATAL: songs query failed: ${rowRes.error.message}`);
    process.exit(2);
  }
  const row = rowRes.data as
    | {
        id: string;
        slug: string | null;
        title: string | null;
        artist: string | null;
        audio_path: string | null;
        midi_path: string | null;
        xml_path: string | null;
        has_practice_mode: boolean | null;
      }
    | null;
  if (!row) {
    console.error(
      `[fix-zhou-shen-wanli] FATAL: no songs row found for id=${TARGET_SONG_ID}. Refusing to proceed.`,
    );
    process.exit(2);
  }
  console.log(`[fix-zhou-shen-wanli] DB row found:`);
  console.log(`                       id              ${row.id}`);
  console.log(`                       slug            ${row.slug}`);
  console.log(`                       title           ${row.title}`);
  console.log(`                       artist          ${row.artist}`);
  console.log(`                       audio_path      ${row.audio_path}`);
  console.log(`                       midi_path       ${row.midi_path}`);
  console.log(`                       xml_path        ${row.xml_path}`);
  console.log(`                       has_practice_mode ${row.has_practice_mode}`);

  const guardFailures: string[] = [];
  if (row.id !== TARGET_SONG_ID) guardFailures.push(`id mismatch: ${row.id}`);
  if (row.slug !== EXPECTED_SLUG)
    guardFailures.push(`slug mismatch: "${row.slug}" !== "${EXPECTED_SLUG}"`);
  if (row.title !== EXPECTED_TITLE)
    guardFailures.push(`title mismatch: "${row.title}" !== "${EXPECTED_TITLE}"`);
  if (row.artist !== EXPECTED_ARTIST)
    guardFailures.push(`artist mismatch: "${row.artist}" !== "${EXPECTED_ARTIST}"`);
  if (row.midi_path !== REMOTE_MIDI_KEY)
    guardFailures.push(`midi_path mismatch: "${row.midi_path}" !== "${REMOTE_MIDI_KEY}"`);
  if (row.xml_path !== REMOTE_XML_KEY)
    guardFailures.push(`xml_path mismatch: "${row.xml_path}" !== "${REMOTE_XML_KEY}"`);
  if (row.audio_path !== REMOTE_AUDIO_KEY)
    guardFailures.push(`audio_path mismatch: "${row.audio_path}" !== "${REMOTE_AUDIO_KEY}"`);
  if (guardFailures.length > 0) {
    console.error(`[fix-zhou-shen-wanli] FATAL: invariant guard failed:`);
    for (const failure of guardFailures) console.error(`  - ${failure}`);
    console.error(`[fix-zhou-shen-wanli] Refusing to write. No storage was touched.`);
    process.exit(2);
  }
  console.log(`[fix-zhou-shen-wanli] All invariants OK. Proceeding.`);

  // 4. Probe BEFORE state for every relevant key in both buckets, plus audio.
  console.log(`[fix-zhou-shen-wanli] BEFORE storage probes:`);
  const before = {
    songs: {
      audio: await probeWithMetadata(supabase, SONGS_BUCKET, REMOTE_AUDIO_KEY),
      midi: await probeWithMetadata(supabase, SONGS_BUCKET, REMOTE_MIDI_KEY),
      xml: await probeWithMetadata(supabase, SONGS_BUCKET, REMOTE_XML_KEY),
    },
    practice: {
      audio: await probeWithMetadata(supabase, PRACTICE_BUCKET, REMOTE_AUDIO_KEY),
      midi: await probeWithMetadata(supabase, PRACTICE_BUCKET, REMOTE_MIDI_KEY),
      xml: await probeWithMetadata(supabase, PRACTICE_BUCKET, REMOTE_XML_KEY),
    },
  };
  console.log(`  ${SONGS_BUCKET}/${REMOTE_AUDIO_KEY}   size=${before.songs.audio.size}  updated=${before.songs.audio.updatedAt}`);
  console.log(`  ${SONGS_BUCKET}/${REMOTE_MIDI_KEY}    size=${before.songs.midi.size}   updated=${before.songs.midi.updatedAt}`);
  console.log(`  ${SONGS_BUCKET}/${REMOTE_XML_KEY}     size=${before.songs.xml.size}    updated=${before.songs.xml.updatedAt}`);
  console.log(`  ${PRACTICE_BUCKET}/${REMOTE_AUDIO_KEY}  size=${before.practice.audio.size}  updated=${before.practice.audio.updatedAt}`);
  console.log(`  ${PRACTICE_BUCKET}/${REMOTE_MIDI_KEY}   size=${before.practice.midi.size}   updated=${before.practice.midi.updatedAt}`);
  console.log(`  ${PRACTICE_BUCKET}/${REMOTE_XML_KEY}    size=${before.practice.xml.size}    updated=${before.practice.xml.updatedAt}`);

  // 5. If dry-run, stop here.
  if (dryRun) {
    console.log(`\n[fix-zhou-shen-wanli] DRY RUN — would upload:`);
    console.log(`  → ${SONGS_BUCKET}/${REMOTE_MIDI_KEY}    (${midiBytes.length} bytes, sha256=${midiSha})`);
    console.log(`  → ${SONGS_BUCKET}/${REMOTE_XML_KEY}     (${xmlBytes.length} bytes,  sha256=${xmlSha})`);
    console.log(`  → ${PRACTICE_BUCKET}/${REMOTE_MIDI_KEY}   (same bytes)`);
    console.log(`  → ${PRACTICE_BUCKET}/${REMOTE_XML_KEY}    (same bytes)`);
    console.log(`[fix-zhou-shen-wanli] DRY RUN — audio.mp3 would NOT be uploaded.`);
    console.log(`[fix-zhou-shen-wanli] DRY RUN — DB row would NOT be modified.`);
    const reportDir = path.resolve(process.cwd(), 'tmp');
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, 'fix-zhou-shen-wanli.json');
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          mode: 'dry_run',
          targetSongId: TARGET_SONG_ID,
          expectedSlug: EXPECTED_SLUG,
          expectedArtist: EXPECTED_ARTIST,
          storageSlug: EXPECTED_STORAGE_SLUG,
          dbRow: row,
          local: {
            midi: { path: LOCAL_MIDI, size: midiBytes.length, sha256: midiSha },
            xml: { path: LOCAL_XML, size: xmlBytes.length, sha256: xmlSha },
          },
          before,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(`[fix-zhou-shen-wanli] report: ${path.relative(process.cwd(), reportPath)}`);
    return;
  }

  // 6. APPLY — upload performance.mid and score.musicxml to BOTH buckets.
  console.log(`\n[fix-zhou-shen-wanli] APPLY — uploading...`);
  const uploads: Array<{ bucket: string; key: string; bytes: Buffer; contentType: string }> = [
    {
      bucket: SONGS_BUCKET,
      key: REMOTE_MIDI_KEY,
      bytes: midiBytes,
      contentType: inferContentType(LOCAL_MIDI),
    },
    {
      bucket: SONGS_BUCKET,
      key: REMOTE_XML_KEY,
      bytes: xmlBytes,
      contentType: inferContentType(LOCAL_XML),
    },
    {
      bucket: PRACTICE_BUCKET,
      key: REMOTE_MIDI_KEY,
      bytes: midiBytes,
      contentType: inferContentType(LOCAL_MIDI),
    },
    {
      bucket: PRACTICE_BUCKET,
      key: REMOTE_XML_KEY,
      bytes: xmlBytes,
      contentType: inferContentType(LOCAL_XML),
    },
  ];
  const uploadResults: Array<{
    bucket: string;
    key: string;
    ok: boolean;
    message?: string;
  }> = [];
  for (const u of uploads) {
    const res = await uploadReplace(supabase, u.bucket, u.key, u.bytes, u.contentType);
    if (res.ok) {
      console.log(`  OK   ${u.bucket}/${u.key}`);
      uploadResults.push({ bucket: u.bucket, key: u.key, ok: true });
    } else {
      console.error(`  FAIL ${u.bucket}/${u.key}: ${res.message}`);
      uploadResults.push({ bucket: u.bucket, key: u.key, ok: false, message: res.message });
    }
  }

  // 7. Probe AFTER state. Verify midi+xml sizes match the local files,
  //    and audio sizes are unchanged.
  console.log(`\n[fix-zhou-shen-wanli] AFTER storage probes:`);
  const after = {
    songs: {
      audio: await probeWithMetadata(supabase, SONGS_BUCKET, REMOTE_AUDIO_KEY),
      midi: await probeWithMetadata(supabase, SONGS_BUCKET, REMOTE_MIDI_KEY),
      xml: await probeWithMetadata(supabase, SONGS_BUCKET, REMOTE_XML_KEY),
    },
    practice: {
      audio: await probeWithMetadata(supabase, PRACTICE_BUCKET, REMOTE_AUDIO_KEY),
      midi: await probeWithMetadata(supabase, PRACTICE_BUCKET, REMOTE_MIDI_KEY),
      xml: await probeWithMetadata(supabase, PRACTICE_BUCKET, REMOTE_XML_KEY),
    },
  };
  console.log(`  ${SONGS_BUCKET}/${REMOTE_AUDIO_KEY}   size=${after.songs.audio.size}  updated=${after.songs.audio.updatedAt}`);
  console.log(`  ${SONGS_BUCKET}/${REMOTE_MIDI_KEY}    size=${after.songs.midi.size}   updated=${after.songs.midi.updatedAt}`);
  console.log(`  ${SONGS_BUCKET}/${REMOTE_XML_KEY}     size=${after.songs.xml.size}    updated=${after.songs.xml.updatedAt}`);
  console.log(`  ${PRACTICE_BUCKET}/${REMOTE_AUDIO_KEY}  size=${after.practice.audio.size}  updated=${after.practice.audio.updatedAt}`);
  console.log(`  ${PRACTICE_BUCKET}/${REMOTE_MIDI_KEY}   size=${after.practice.midi.size}   updated=${after.practice.midi.updatedAt}`);
  console.log(`  ${PRACTICE_BUCKET}/${REMOTE_XML_KEY}    size=${after.practice.xml.size}    updated=${after.practice.xml.updatedAt}`);

  const failures: string[] = [];
  const checkSize = (label: string, after: number | null, expected: number) => {
    if (after !== expected) failures.push(`${label}: size=${after} expected=${expected}`);
  };
  const checkUnchanged = (label: string, beforeSize: number | null, afterSize: number | null) => {
    if (beforeSize !== afterSize) failures.push(`${label}: size changed ${beforeSize} → ${afterSize} (should be untouched)`);
  };
  checkSize(`${SONGS_BUCKET}/${REMOTE_MIDI_KEY}`, after.songs.midi.size, midiBytes.length);
  checkSize(`${SONGS_BUCKET}/${REMOTE_XML_KEY}`, after.songs.xml.size, xmlBytes.length);
  checkSize(`${PRACTICE_BUCKET}/${REMOTE_MIDI_KEY}`, after.practice.midi.size, midiBytes.length);
  checkSize(`${PRACTICE_BUCKET}/${REMOTE_XML_KEY}`, after.practice.xml.size, xmlBytes.length);
  checkUnchanged(`${SONGS_BUCKET}/${REMOTE_AUDIO_KEY}`, before.songs.audio.size, after.songs.audio.size);
  checkUnchanged(
    `${PRACTICE_BUCKET}/${REMOTE_AUDIO_KEY} (may not exist either)`,
    before.practice.audio.size,
    after.practice.audio.size,
  );

  // 8. Re-fetch DB row to confirm it's unchanged.
  const postRow = await supabase
    .from('songs')
    .select('id,slug,title,artist,audio_path,midi_path,xml_path,has_practice_mode')
    .eq('id', TARGET_SONG_ID)
    .maybeSingle();
  if (postRow.error || !postRow.data) {
    failures.push(`post DB re-fetch failed: ${postRow.error?.message ?? 'no row'}`);
  } else {
    const pr = postRow.data;
    if (pr.slug !== EXPECTED_SLUG) failures.push(`post DB slug drift: ${pr.slug}`);
    if (pr.title !== EXPECTED_TITLE) failures.push(`post DB title drift: ${pr.title}`);
    if (pr.artist !== EXPECTED_ARTIST) failures.push(`post DB artist drift: ${pr.artist}`);
    if (pr.midi_path !== REMOTE_MIDI_KEY) failures.push(`post DB midi_path drift: ${pr.midi_path}`);
    if (pr.xml_path !== REMOTE_XML_KEY) failures.push(`post DB xml_path drift: ${pr.xml_path}`);
    if (pr.audio_path !== REMOTE_AUDIO_KEY) failures.push(`post DB audio_path drift: ${pr.audio_path}`);
  }

  // 9. Write report.
  const reportDir = path.resolve(process.cwd(), 'tmp');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'fix-zhou-shen-wanli.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: 'apply',
        targetSongId: TARGET_SONG_ID,
        expectedSlug: EXPECTED_SLUG,
        expectedArtist: EXPECTED_ARTIST,
        storageSlug: EXPECTED_STORAGE_SLUG,
        dbRowBefore: row,
        dbRowAfter: postRow.data ?? null,
        local: {
          midi: { path: LOCAL_MIDI, size: midiBytes.length, sha256: midiSha },
          xml: { path: LOCAL_XML, size: xmlBytes.length, sha256: xmlSha },
        },
        before,
        after,
        uploadResults,
        failures,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\n[fix-zhou-shen-wanli] report: ${path.relative(process.cwd(), reportPath)}`);

  if (failures.length > 0) {
    console.error(`\n[fix-zhou-shen-wanli] VERIFICATION FAILED:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`\n[fix-zhou-shen-wanli] APPLY complete. All invariants verified.`);
})().catch((err) => {
  console.error('[fix-zhou-shen-wanli] failed:', err);
  process.exit(1);
});
