/**
 * Phase D Step 5 — public `songs` bucket 中旧 Practice MIDI/MusicXML 删除准备（**仅 dry-run**）
 *
 * - 只读 `songs` 表 + Storage list 探测
 * - **绝不**调用 remove / 不写 DB / 不改 bucket
 * - 未来若实现真实删除，须另设双 env 门闸；本脚本 **不包含** 删除实现
 *
 * Usage:
 *   npm run prepare:delete-public-practice-assets
 *
 * Env:
 *   SUPABASE_URL 或 VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_SONGS_BUCKET（默认 songs）
 *   SUPABASE_PRACTICE_BUCKET（默认 practice-assets）
 */
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';

dotenv.config({path: path.resolve(process.cwd(), '.env')});
dotenv.config({path: path.resolve(process.cwd(), '.env.local')});

const REPORT_PATH = path.resolve(process.cwd(), 'tmp/public-practice-assets-delete-dry-run.json');

/** 硬性拒绝：即使误传删除相关 env，也不执行删除（本脚本内无 delete API 调用）。 */
const FORBIDDEN_DELETE_ENVS = [
  'PRACTICE_DELETE_PUBLIC_ASSETS',
  'PRACTICE_DELETE_CONFIRM',
  'ALLOW_DELETE_PUBLIC_PRACTICE',
];
for (const k of FORBIDDEN_DELETE_ENVS) {
  const v = process.env[k]?.trim();
  if (v && v !== '0' && v.toLowerCase() !== 'false') {
    console.error(`[prepare-delete-public-practice-assets] Refusing to run: ${k} is set. This script is DRY-RUN ONLY.`);
    process.exit(1);
  }
}

type SongRow = {
  id: string;
  slug: string | null;
  title: string | null;
  has_practice_mode: boolean | null;
  midi_path: string | null;
  xml_path: string | null;
  midi_url: string | null;
  musicxml_url: string | null;
};

type ObjectKind = 'midi' | 'xml';

type ObjectOutcome =
  | 'safe_to_delete_candidate'
  | 'blocked_missing_private_copy'
  | 'already_missing_public_copy'
  | 'probe_error'
  | 'no_key';

type ObjectDetail = {
  kind: ObjectKind;
  key: string | null;
  keySource: 'path' | 'url' | 'none';
  publicStatus: 'exists' | 'missing' | 'probe_error';
  privateStatus: 'exists' | 'missing' | 'probe_error';
  publicProbeError?: string;
  privateProbeError?: string;
  outcome: ObjectOutcome;
};

type TrackReport = {
  id: string;
  slug: string | null;
  title: string | null;
  objects: ObjectDetail[];
};

type Summary = {
  dryRunOnly: true;
  noObjectsDeleted: true;
  generatedAt: string;
  publicBucket: string;
  privateBucket: string;
  totalPracticeTracks: number;
  publicMidiExistsCount: number;
  publicXmlExistsCount: number;
  privateMidiExistsCount: number;
  privateXmlExistsCount: number;
  safeToDeleteTrackCount: number;
  safeToDeleteObjectCount: number;
  blockedMissingPrivateCopyCount: number;
  alreadyMissingPublicCopyCount: number;
  probeErrorCount: number;
  noKeyObjectCount: number;
};

function requiredEnv(name: string, value: string | undefined): string {
  const out = value?.trim() || '';
  if (!out) throw new Error(`Missing required env: ${name}`);
  return out;
}

function supabaseUrl(): string {
  return requiredEnv(
    'SUPABASE_URL',
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  );
}

function bucketRelativeObjectKey(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    const m = /\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/i.exec(value);
    return m ? m[1] : null;
  }
  return value.replace(/^\/+/, '');
}

function pickAssetKey(
  pathValue: string | null | undefined,
  urlValue: string | null | undefined,
): {key: string | null; source: 'path' | 'url' | 'none'} {
  const p = typeof pathValue === 'string' ? pathValue.trim() : '';
  if (p) {
    const k = bucketRelativeObjectKey(p);
    if (k) return {key: k, source: 'path'};
  }
  const u = typeof urlValue === 'string' ? urlValue.trim() : '';
  if (u) {
    const k = bucketRelativeObjectKey(u);
    if (k) return {key: k, source: 'url'};
  }
  return {key: null, source: 'none'};
}

function splitDirAndFile(key: string): {dir: string; file: string} {
  const normalized = key.replace(/^\/+/, '').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return {dir: '', file: normalized};
  return {dir: normalized.slice(0, idx), file: normalized.slice(idx + 1)};
}

function formatProbeError(err: unknown): string {
  if (!err) return 'unknown_error';
  const anyErr = err as {message?: string; status?: string | number; code?: string};
  const parts = [anyErr.message, anyErr.status ? String(anyErr.status) : '', anyErr.code]
    .filter(Boolean)
    .join(' | ');
  const out = parts.trim() || String(err);
  return out.replace(/token=[^&\s]+/gi, 'token=<redacted>');
}

function isProbablyTransientStorageListError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as {message?: string; status?: string | number; code?: string};
  const msg = `${anyErr.message ?? ''} ${anyErr.status ?? ''} ${anyErr.code ?? ''}`.toLowerCase();
  return (
    msg.includes('gateway timeout') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('rate limit') ||
    /\b5\d\d\b/.test(msg)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

type ProbeResult = {exists: boolean; status: 'exists' | 'missing' | 'probe_error'; errorMessage?: string};

async function probeStorageObject(
  supabase: SupabaseClient,
  bucket: string,
  key: string,
): Promise<ProbeResult> {
  const {dir, file} = splitDirAndFile(key);
  if (!file) return {exists: false, status: 'missing'};

  const delaysMs = [0, 300, 800];
  let lastError: string | undefined;

  for (let i = 0; i < delaysMs.length; i += 1) {
    if (delaysMs[i] > 0) await sleep(delaysMs[i]);

    const res = await supabase.storage.from(bucket).list(dir, {
      limit: 100,
      offset: 0,
      search: file,
    });

    if (res.error) {
      lastError = formatProbeError(res.error);
      if (isProbablyTransientStorageListError(res.error)) continue;
      return {exists: false, status: 'probe_error', errorMessage: lastError};
    }

    if (Array.isArray(res.data) && res.data.some((e: {name?: string}) => e.name === file)) {
      return {exists: true, status: 'exists'};
    }

    const scan = await supabase.storage.from(bucket).list(dir, {
      limit: 1000,
      offset: 0,
      sortBy: {column: 'name', order: 'asc'},
    });
    if (scan.error) {
      lastError = formatProbeError(scan.error);
      if (isProbablyTransientStorageListError(scan.error)) continue;
      return {exists: false, status: 'probe_error', errorMessage: lastError};
    }
    if (Array.isArray(scan.data) && scan.data.some((e: {name?: string}) => e.name === file)) {
      return {exists: true, status: 'exists'};
    }

    return {exists: false, status: 'missing'};
  }

  return {exists: false, status: 'probe_error', errorMessage: lastError || 'probe_failed_after_retries'};
}

function classifyObject(
  pub: ProbeResult,
  priv: ProbeResult,
): {outcome: ObjectOutcome; publicStatus: ProbeResult['status']; privateStatus: ProbeResult['status']} {
  const publicStatus = pub.status;
  const privateStatus = priv.status;

  if (publicStatus === 'probe_error' || privateStatus === 'probe_error') {
    return {outcome: 'probe_error', publicStatus, privateStatus};
  }
  if (!pub.exists) {
    return {outcome: 'already_missing_public_copy', publicStatus, privateStatus};
  }
  if (!priv.exists) {
    return {outcome: 'blocked_missing_private_copy', publicStatus, privateStatus};
  }
  return {outcome: 'safe_to_delete_candidate', publicStatus, privateStatus};
}

type ExtraVerification = {
  manifestChunksChecked: number;
  manifestChunksWithMidiOrMusicXmlKeys: string[];
  /** true when no chunk contained midiUrl / musicXmlUrl / musicxmlUrl on any track */
  manifestChunksOmitPracticeUrls: boolean;
  practiceCodePathNote: string;
};

function verifyManifestChunks(): ExtraVerification {
  const publicDir = path.resolve(process.cwd(), 'public');
  const files = fs
    .readdirSync(publicDir)
    .filter(f => /^songs-manifest-chunk-\d+\.json$/i.test(f))
    .sort();
  const bad: string[] = [];
  for (const f of files) {
    const p = path.join(publicDir, f);
    const raw = fs.readFileSync(p, 'utf8');
    if (/\bmidiUrl\b|\bmusicXmlUrl\b|\bmusicxmlUrl\b/.test(raw)) {
      bad.push(f);
    }
  }
  return {
    manifestChunksChecked: files.length,
    manifestChunksWithMidiOrMusicXmlKeys: bad,
    manifestChunksOmitPracticeUrls: bad.length === 0,
    practiceCodePathNote:
      'src/practice/PracticePanelModule.tsx resolves practice assets via resolvePracticeAssetForTrack() -> src/lib/practice-asset-url.ts POST /.netlify/functions/practice-asset-url (not manifest MIDI/XML URLs).',
  };
}

async function main(): Promise<void> {
  console.log('DRY RUN ONLY — prepare-delete-public-practice-assets');
  console.log('No objects were deleted and no delete API is implemented in this script.\n');

  const url = supabaseUrl();
  const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
  const publicBucket = process.env.SUPABASE_SONGS_BUCKET?.trim() || 'songs';
  const privateBucket = process.env.SUPABASE_PRACTICE_BUCKET?.trim() || 'practice-assets';

  const supabase = createClient(url, serviceKey, {
    auth: {persistSession: false, autoRefreshToken: false},
  });

  const {data: rows, error: qErr} = await supabase
    .from('songs')
    .select(
      'id, slug, title, has_practice_mode, midi_path, xml_path, midi_url, musicxml_url',
    )
    .eq('has_practice_mode', true);

  if (qErr) {
    console.error('songs query failed:', formatProbeError(qErr));
    process.exit(1);
  }

  const list = (rows || []) as SongRow[];

  const tracks: TrackReport[] = [];
  let publicMidiExistsCount = 0;
  let publicXmlExistsCount = 0;
  let privateMidiExistsCount = 0;
  let privateXmlExistsCount = 0;
  let safeToDeleteObjectCount = 0;
  let blockedMissingPrivateCopyCount = 0;
  let alreadyMissingPublicCopyCount = 0;
  let probeErrorCount = 0;
  let noKeyObjectCount = 0;

  for (const row of list) {
    const midiPick = pickAssetKey(row.midi_path, row.midi_url);
    const xmlPick = pickAssetKey(row.xml_path, row.musicxml_url);

    const objects: ObjectDetail[] = [];

    for (const {kind, pick} of [
      {kind: 'midi' as const, pick: midiPick},
      {kind: 'xml' as const, pick: xmlPick},
    ]) {
      if (!pick.key) {
        noKeyObjectCount += 1;
        objects.push({
          kind,
          key: null,
          keySource: 'none',
          publicStatus: 'missing',
          privateStatus: 'missing',
          outcome: 'no_key',
        });
        continue;
      }

      const pub = await probeStorageObject(supabase, publicBucket, pick.key);
      const priv = await probeStorageObject(supabase, privateBucket, pick.key);

      if (kind === 'midi') {
        if (pub.exists) publicMidiExistsCount += 1;
        if (priv.exists) privateMidiExistsCount += 1;
      } else {
        if (pub.exists) publicXmlExistsCount += 1;
        if (priv.exists) privateXmlExistsCount += 1;
      }

      const {outcome, publicStatus, privateStatus} = classifyObject(pub, priv);

      if (outcome === 'safe_to_delete_candidate') safeToDeleteObjectCount += 1;
      if (outcome === 'blocked_missing_private_copy') blockedMissingPrivateCopyCount += 1;
      if (outcome === 'already_missing_public_copy') alreadyMissingPublicCopyCount += 1;
      if (outcome === 'probe_error') probeErrorCount += 1;

      objects.push({
        kind,
        key: pick.key,
        keySource: pick.source,
        publicStatus,
        privateStatus,
        publicProbeError: pub.errorMessage,
        privateProbeError: priv.errorMessage,
        outcome,
      });
    }

    tracks.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      objects,
    });
  }

  let safeToDeleteTrackCount = 0;
  for (const t of tracks) {
    const relevant = t.objects.filter(o => o.outcome !== 'no_key');
    if (relevant.length === 0) continue;
    if (relevant.every(o => o.outcome === 'safe_to_delete_candidate')) safeToDeleteTrackCount += 1;
  }

  const summary: Summary = {
    dryRunOnly: true,
    noObjectsDeleted: true,
    generatedAt: new Date().toISOString(),
    publicBucket,
    privateBucket,
    totalPracticeTracks: list.length,
    publicMidiExistsCount,
    publicXmlExistsCount,
    privateMidiExistsCount,
    privateXmlExistsCount,
    safeToDeleteTrackCount,
    safeToDeleteObjectCount,
    blockedMissingPrivateCopyCount,
    alreadyMissingPublicCopyCount,
    probeErrorCount,
    noKeyObjectCount,
  };

  const extraVerification = verifyManifestChunks();
  const out = {summary, extraVerification, tracks};
  fs.mkdirSync(path.dirname(REPORT_PATH), {recursive: true});
  fs.writeFileSync(REPORT_PATH, JSON.stringify(out, null, 2), 'utf8');

  console.log('Summary:', JSON.stringify(summary, null, 2));
  console.log('\nStatic verification:', JSON.stringify(extraVerification, null, 2));
  console.log(`\nReport written: ${REPORT_PATH}`);

  const blockedSamples = tracks
    .flatMap(t =>
      t.objects
        .filter(o => o.outcome === 'blocked_missing_private_copy')
        .map(o => ({trackId: t.id, slug: t.slug, kind: o.kind, key: o.key})),
    )
    .slice(0, 20);

  const probeSamples = tracks
    .flatMap(t =>
      t.objects
        .filter(o => o.outcome === 'probe_error')
        .map(o => ({
          trackId: t.id,
          slug: t.slug,
          kind: o.kind,
          key: o.key,
          publicErr: o.publicProbeError,
          privateErr: o.privateProbeError,
        })),
    )
    .slice(0, 20);

  if (blockedSamples.length) {
    console.log('\nSample blocked_missing_private_copy (max 20):');
    console.log(JSON.stringify(blockedSamples, null, 2));
  }
  if (probeSamples.length) {
    console.log('\nSample probe_error (max 20):');
    console.log(JSON.stringify(probeSamples, null, 2));
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
