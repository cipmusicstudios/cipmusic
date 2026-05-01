/**
 * Phase D Step 5 — public `songs` bucket 中旧 Practice MIDI/MusicXML 删除：dry-run + 受控真实删除
 *
 * 默认：**DRY RUN ONLY**（不调用 remove）
 * 真实删除须同时满足：
 *   PRACTICE_DELETE_PUBLIC_APPLY=1
 *   PRACTICE_DELETE_PUBLIC_CONFIRM=delete-public-practice-assets
 *   PRACTICE_DELETE_PUBLIC_LIMIT=<正整数>
 *
 * **绝不**删除 practice-assets bucket、绝不删除 audio.mp3、不改 DB。
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

const REQUIRED_CONFIRM = 'delete-public-practice-assets';

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

/** Item-level delete / dry-run plan status */
type DeleteStatus =
  | 'not_applicable'
  | 'planned'
  | 'deleted'
  | 'skipped_existing_missing'
  | 'blocked_missing_private_copy'
  | 'probe_error'
  | 'delete_failed'
  | 'post_delete_verify_failed';

type ObjectDetail = {
  kind: ObjectKind;
  key: string | null;
  keySource: 'path' | 'url' | 'none';
  publicStatus: 'exists' | 'missing' | 'probe_error';
  privateStatus: 'exists' | 'missing' | 'probe_error';
  publicProbeError?: string;
  privateProbeError?: string;
  outcome: ObjectOutcome;
  deleteStatus: DeleteStatus;
  deleteError?: string;
};

type TrackReport = {
  id: string;
  slug: string | null;
  title: string | null;
  objects: ObjectDetail[];
};

type Summary = {
  dryRun: boolean;
  /** legacy-friendly */
  dryRunOnly: boolean;
  noObjectsDeleted: boolean;
  applyRequested: boolean;
  confirmed: boolean;
  limit: number | null;
  plannedDeleteObjectCount: number;
  deletedObjectCount: number;
  skippedObjectCount: number;
  deleteFailedCount: number;
  postDeletePublicStillExistsCount: number;
  privateStillExistsCount: number;
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
  refusedReason?: string;
};

type PlannedItem = {
  trackIndex: number;
  objectIndex: number;
  key: string;
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

function fileBasenameLower(key: string): string {
  return splitDirAndFile(key).file.toLowerCase();
}

/** 仅允许删除 Practice 谱面资源；禁止 audio.mp3 及非白名单扩展名 */
function isAllowedPracticeAssetKey(key: string): boolean {
  const norm = key.replace(/^\/+/, '');
  if (norm.toLowerCase().includes('audio.mp3')) return false;
  const base = fileBasenameLower(key);
  if (base === 'audio.mp3') return false;
  if (base === 'performance.mid') return true;
  if (base === 'score.musicxml') return true;
  return /\.(mid|midi|musicxml|xml|mxl)$/i.test(base);
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

function parseLimit(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function refuse(message: string, detail: string): never {
  console.error('REFUSED');
  console.error(detail);
  console.error('No objects were deleted');
  throw new ExitError(message, detail);
}

class ExitError extends Error {
  constructor(
    message: string,
    public detail: string,
  ) {
    super(message);
    this.name = 'ExitError';
  }
}

function collectSafeDeletionPlan(tracks: TrackReport[]): PlannedItem[] {
  const plan: PlannedItem[] = [];
  tracks.forEach((t, trackIndex) => {
    t.objects.forEach((o, objectIndex) => {
      if (o.outcome !== 'safe_to_delete_candidate' || !o.key) return;
      if (!isAllowedPracticeAssetKey(o.key)) return;
      plan.push({trackIndex, objectIndex, key: o.key});
    });
  });
  return plan;
}

async function runDeletePass(params: {
  supabase: SupabaseClient;
  publicBucket: string;
  privateBucket: string;
  tracks: TrackReport[];
  planSlice: PlannedItem[];
}): Promise<{
  deletedObjectCount: number;
  skippedObjectCount: number;
  deleteFailedCount: number;
  postDeletePublicStillExistsCount: number;
  privateStillExistsCount: number;
}> {
  const {supabase, publicBucket, privateBucket, tracks, planSlice} = params;
  let deletedObjectCount = 0;
  let skippedObjectCount = 0;
  let deleteFailedCount = 0;
  let postDeletePublicStillExistsCount = 0;
  let privateStillExistsCount = 0;

  for (const item of planSlice) {
    const o = tracks[item.trackIndex].objects[item.objectIndex];
    if (!o.key) continue;

    if (!isAllowedPracticeAssetKey(o.key)) {
      o.deleteStatus = 'not_applicable';
      o.deleteError = 'key_not_allowed_for_delete';
      skippedObjectCount += 1;
      continue;
    }

    const pub = await probeStorageObject(supabase, publicBucket, o.key);
    const priv = await probeStorageObject(supabase, privateBucket, o.key);

    if (pub.status === 'probe_error' || priv.status === 'probe_error') {
      o.deleteStatus = 'probe_error';
      o.deleteError = pub.errorMessage || priv.errorMessage;
      skippedObjectCount += 1;
      continue;
    }
    if (!priv.exists) {
      o.deleteStatus = 'blocked_missing_private_copy';
      skippedObjectCount += 1;
      continue;
    }
    if (!pub.exists) {
      o.deleteStatus = 'skipped_existing_missing';
      skippedObjectCount += 1;
      continue;
    }

    const rm = await supabase.storage.from(publicBucket).remove([o.key]);
    if (rm.error) {
      o.deleteStatus = 'delete_failed';
      o.deleteError = formatProbeError(rm.error);
      deleteFailedCount += 1;
      skippedObjectCount += 1;
      continue;
    }

    const pubAfter = await probeStorageObject(supabase, publicBucket, o.key);
    const privAfter = await probeStorageObject(supabase, privateBucket, o.key);

    if (pubAfter.exists) {
      o.deleteStatus = 'post_delete_verify_failed';
      o.deleteError = 'public_object_still_exists_after_remove';
      postDeletePublicStillExistsCount += 1;
      deleteFailedCount += 1;
      skippedObjectCount += 1;
      continue;
    }
    if (!privAfter.exists) {
      o.deleteStatus = 'post_delete_verify_failed';
      o.deleteError = 'private_copy_missing_after_delete';
      privateStillExistsCount += 1;
      deleteFailedCount += 1;
      skippedObjectCount += 1;
      continue;
    }

    o.deleteStatus = 'deleted';
    deletedObjectCount += 1;
  }

  return {
    deletedObjectCount,
    skippedObjectCount,
    deleteFailedCount,
    postDeletePublicStillExistsCount,
    privateStillExistsCount,
  };
}

async function main(): Promise<void> {
  const applyRaw = process.env.PRACTICE_DELETE_PUBLIC_APPLY?.trim();
  const applyRequested = applyRaw === '1';
  const confirmRaw = process.env.PRACTICE_DELETE_PUBLIC_CONFIRM?.trim() || '';
  const confirmed = confirmRaw === REQUIRED_CONFIRM;
  const limitParsed = parseLimit(process.env.PRACTICE_DELETE_PUBLIC_LIMIT);

  if (applyRequested && !confirmed) {
    refuse(
      'missing_confirm',
      '缺少 PRACTICE_DELETE_PUBLIC_CONFIRM=delete-public-practice-assets',
    );
  }

  if (applyRequested && confirmed && limitParsed == null) {
    refuse(
      'missing_limit',
      '真实删除必须显式设置 PRACTICE_DELETE_PUBLIC_LIMIT=<正整数>（全量删除亦须设上限）。',
    );
  }

  /** 通过门闸后：未请求 apply → 始终 dry-run；请求 apply 则必已带 confirm + LIMIT */
  const dryRun = !applyRequested;
  if (dryRun) {
    console.log('DRY RUN ONLY — prepare-delete-public-practice-assets');
    console.log('No objects were deleted.\n');
  } else {
    console.log('APPLY MODE — deleting from public bucket only (practice-assets untouched).');
    console.log(`LIMIT=${limitParsed}\n`);
  }

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
          deleteStatus: 'not_applicable',
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
        deleteStatus: 'not_applicable',
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

  const fullPlan = collectSafeDeletionPlan(tracks);
  let plannedDeleteObjectCount = 0;
  if (limitParsed != null) {
    plannedDeleteObjectCount = Math.min(limitParsed, fullPlan.length);
  }

  if (limitParsed != null) {
    for (let i = 0; i < fullPlan.length && i < plannedDeleteObjectCount; i += 1) {
      const p = fullPlan[i];
      tracks[p.trackIndex].objects[p.objectIndex].deleteStatus = 'planned';
    }
  }

  let deletedObjectCount = 0;
  let skippedObjectCount = 0;
  let deleteFailedCount = 0;
  let postDeletePublicStillExistsCount = 0;
  let privateStillExistsCount = 0;

  if (!dryRun && limitParsed != null) {
    const planSlice = fullPlan.slice(0, plannedDeleteObjectCount);
    const del = await runDeletePass({
      supabase,
      publicBucket,
      privateBucket,
      tracks,
      planSlice,
    });
    deletedObjectCount = del.deletedObjectCount;
    skippedObjectCount = del.skippedObjectCount;
    deleteFailedCount = del.deleteFailedCount;
    postDeletePublicStillExistsCount = del.postDeletePublicStillExistsCount;
    privateStillExistsCount = del.privateStillExistsCount;
  }

  const noObjectsDeleted = dryRun || deletedObjectCount === 0;

  const summary: Summary = {
    dryRun,
    dryRunOnly: dryRun,
    noObjectsDeleted,
    applyRequested,
    confirmed: applyRequested && confirmed,
    limit: limitParsed,
    plannedDeleteObjectCount,
    deletedObjectCount,
    skippedObjectCount,
    deleteFailedCount,
    postDeletePublicStillExistsCount,
    privateStillExistsCount,
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

  if (dryRun && limitParsed == null) {
    console.log(
      `\n注意：若需真实删除，必须同时设置 ${'PRACTICE_DELETE_PUBLIC_APPLY=1'}、${'PRACTICE_DELETE_PUBLIC_CONFIRM=' + REQUIRED_CONFIRM} 与 PRACTICE_DELETE_PUBLIC_LIMIT=<正整数>。` +
        ` 当前 safe_to_delete_candidate 对象总数 = ${fullPlan.length}（与 summary.safeToDeleteObjectCount 一致）。`,
    );
  }

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
  if (e instanceof ExitError) {
    process.exit(1);
  }
  console.error(e);
  process.exit(1);
});
