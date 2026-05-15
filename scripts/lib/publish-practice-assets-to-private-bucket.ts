/**
 * Shared helpers: after uploading Practice MIDI/MusicXML to the public `songs`
 * bucket, mirror the **same object keys** into the private broker bucket
 * (`SUPABASE_PRACTICE_BUCKET`, default `practice-assets`) so production
 * `practice-asset-url` can sign them.
 *
 * Overwrite policy: never replace existing `practice-assets` objects unless
 * `PRACTICE_MIGRATION_OVERWRITE=1` (same env as `prepare-practice-assets-migration`
 * and `copy-five-new-imports-to-practice-assets.ts`).
 */
import {Buffer} from 'node:buffer';
import type {SupabaseClient} from '@supabase/supabase-js';

export type ProbeStatus = 'exists' | 'missing' | 'probe_error';

export type ObjectProbe = {
  exists: boolean;
  status: ProbeStatus;
  errorMessage?: string;
};

export function resolveImportPracticeBucketName(): string {
  return process.env.SUPABASE_PRACTICE_BUCKET?.trim() || 'practice-assets';
}

export function isPracticeMigrationOverwriteEnabled(): boolean {
  return process.env.PRACTICE_MIGRATION_OVERWRITE?.trim() === '1';
}

export function contentTypeForPracticeKey(objectKey: string): string {
  const lower = objectKey.toLowerCase();
  if (lower.endsWith('.mid') || lower.endsWith('.midi')) return 'audio/midi';
  if (lower.endsWith('.musicxml')) return 'application/vnd.recordare.musicxml+xml';
  if (lower.endsWith('.mxl')) return 'application/zip';
  if (lower.endsWith('.xml')) return 'application/xml';
  return 'application/octet-stream';
}

type CopyMethod = 'supabase_storage_copy_api' | 'download_upload_fallback';

export async function probeStorageObject(supabase: SupabaseClient, bucket: string, key: string): Promise<ObjectProbe> {
  const idx = key.lastIndexOf('/');
  const dir = idx < 0 ? '' : key.slice(0, idx);
  const file = idx < 0 ? key : key.slice(idx + 1);
  if (!file) {
    return {exists: false, status: 'missing'};
  }
  const res = await supabase.storage.from(bucket).list(dir, {limit: 200, offset: 0, search: file});
  if (res.error) {
    return {exists: false, status: 'probe_error', errorMessage: res.error.message};
  }
  if (!Array.isArray(res.data)) {
    return {exists: false, status: 'probe_error', errorMessage: 'list returned non-array'};
  }
  const hit = res.data.some(e => e.name === file);
  return {exists: hit, status: hit ? 'exists' : 'missing'};
}

export async function assertPracticeBucketExists(supabase: SupabaseClient, practiceBucket: string): Promise<void> {
  const res = await supabase.storage.listBuckets();
  if (res.error) {
    throw new Error(`[practice-assets] listBuckets failed: ${res.error.message}`);
  }
  if (!res.data?.some(b => b.name === practiceBucket)) {
    throw new Error(
      `[practice-assets] bucket "${practiceBucket}" does not exist. Create it in Supabase or set SUPABASE_PRACTICE_BUCKET to an existing private bucket.`,
    );
  }
}

async function copyObjectAcrossBuckets(params: {
  supabase: SupabaseClient;
  sourceBucket: string;
  targetBucket: string;
  sourceKey: string;
  targetKey: string;
  overwrite: boolean;
}): Promise<{ok: true; method: CopyMethod} | {ok: false; message: string}> {
  const {supabase, sourceBucket, targetBucket, sourceKey, targetKey, overwrite} = params;

  if (overwrite) {
    await supabase.storage.from(targetBucket).remove([targetKey]);
  }

  const copyRes = await supabase.storage
    .from(sourceBucket)
    .copy(sourceKey, targetKey, {destinationBucket: targetBucket});
  if (!copyRes.error) {
    return {ok: true, method: 'supabase_storage_copy_api'};
  }

  const copyErrMsg = copyRes.error.message;
  const dl = await supabase.storage.from(sourceBucket).download(sourceKey);
  if (dl.error || !dl.data) {
    return {
      ok: false,
      message: `copy_failed(${copyErrMsg}); download_failed(${dl.error?.message ?? 'no data'})`,
    };
  }

  const buf = Buffer.from(await dl.data.arrayBuffer());
  const up = await supabase.storage.from(targetBucket).upload(targetKey, buf, {
    contentType: contentTypeForPracticeKey(targetKey),
    upsert: overwrite,
  });
  if (up.error) {
    return {
      ok: false,
      message: `copy_failed(${copyErrMsg}); upload_failed(${up.error.message})`,
    };
  }

  return {ok: true, method: 'download_upload_fallback'};
}

export type PracticeSideOutcome = 'not_applicable' | 'skipped_existing' | 'copied' | 'dry_run_pending';

export type PublishMidiXmlResult = {
  midi: PracticeSideOutcome;
  xml: PracticeSideOutcome;
  midiProbeAfter?: ObjectProbe;
  xmlProbeAfter?: ObjectProbe;
};

/**
 * When `midiKey` and `xmlKey` are set, mirrors both objects from `songsBucket`
 * into `practiceBucket` under the identical keys (Phase D stable path mode).
 */
export async function publishMidiXmlToPracticeBucket(params: {
  supabase: SupabaseClient;
  songsBucket: string;
  practiceBucket: string;
  midiKey: string | null;
  xmlKey: string | null;
  dryRun: boolean;
  overwrite: boolean;
}): Promise<PublishMidiXmlResult> {
  const {supabase, songsBucket, practiceBucket, midiKey, xmlKey, dryRun, overwrite} = params;

  if (!midiKey || !xmlKey) {
    return {midi: 'not_applicable', xml: 'not_applicable'};
  }

  if (dryRun) {
    return {midi: 'dry_run_pending', xml: 'dry_run_pending'};
  }

  const midiInSongs = await probeStorageObject(supabase, songsBucket, midiKey);
  const xmlInSongs = await probeStorageObject(supabase, songsBucket, xmlKey);
  if (midiInSongs.status !== 'exists') {
    throw new Error(
      `[practice-assets] expected MIDI in "${songsBucket}" at "${midiKey}" before private publish; probe=${midiInSongs.status} ${midiInSongs.errorMessage ?? ''}`,
    );
  }
  if (xmlInSongs.status !== 'exists') {
    throw new Error(
      `[practice-assets] expected MusicXML in "${songsBucket}" at "${xmlKey}" before private publish; probe=${xmlInSongs.status} ${xmlInSongs.errorMessage ?? ''}`,
    );
  }

  let midiOutcome: PracticeSideOutcome = 'copied';
  let xmlOutcome: PracticeSideOutcome = 'copied';

  const midiTgtBefore = await probeStorageObject(supabase, practiceBucket, midiKey);
  const xmlTgtBefore = await probeStorageObject(supabase, practiceBucket, xmlKey);

  /** MIDI */
  if (midiTgtBefore.status === 'exists' && !overwrite) {
    midiOutcome = 'skipped_existing';
  } else {
    if (midiTgtBefore.status === 'probe_error') {
      throw new Error(`[practice-assets] target MIDI probe error: ${midiTgtBefore.errorMessage ?? 'unknown'}`);
    }
    const res = await copyObjectAcrossBuckets({
      supabase,
      sourceBucket: songsBucket,
      targetBucket: practiceBucket,
      sourceKey: midiKey,
      targetKey: midiKey,
      overwrite: overwrite && midiTgtBefore.status === 'exists',
    });
    if (!res.ok) {
      throw new Error(`[practice-assets] MIDI copy failed: ${res.message}`);
    }
  }

  /** MusicXML */
  if (xmlTgtBefore.status === 'exists' && !overwrite) {
    xmlOutcome = 'skipped_existing';
  } else {
    if (xmlTgtBefore.status === 'probe_error') {
      throw new Error(`[practice-assets] target MusicXML probe error: ${xmlTgtBefore.errorMessage ?? 'unknown'}`);
    }
    const res = await copyObjectAcrossBuckets({
      supabase,
      sourceBucket: songsBucket,
      targetBucket: practiceBucket,
      sourceKey: xmlKey,
      targetKey: xmlKey,
      overwrite: overwrite && xmlTgtBefore.status === 'exists',
    });
    if (!res.ok) {
      throw new Error(`[practice-assets] MusicXML copy failed: ${res.message}`);
    }
  }

  const midiProbeAfter = await probeStorageObject(supabase, practiceBucket, midiKey);
  const xmlProbeAfter = await probeStorageObject(supabase, practiceBucket, xmlKey);
  if (midiProbeAfter.status !== 'exists') {
    throw new Error(
      `[practice-assets] post-publish MIDI missing in "${practiceBucket}" at "${midiKey}" (status=${midiProbeAfter.status})`,
    );
  }
  if (xmlProbeAfter.status !== 'exists') {
    throw new Error(
      `[practice-assets] post-publish MusicXML missing in "${practiceBucket}" at "${xmlKey}" (status=${xmlProbeAfter.status})`,
    );
  }

  return {
    midi: midiOutcome,
    xml: xmlOutcome,
    midiProbeAfter,
    xmlProbeAfter,
  };
}
