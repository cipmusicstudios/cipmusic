/**
 * Targeted Storage fix: copy `performance.mid` + `score.musicxml` for the
 * 5 new songs from the `songs` (public) bucket to the `practice-assets`
 * (private) bucket — where the deployed broker (`SUPABASE_PRACTICE_BUCKET=
 * practice-assets`) actually looks for Practice resources.
 *
 * Background:
 *   - Phase D Step 4 switched the deployed broker bucket to `practice-assets`.
 *   - Older Practice songs had their files migrated via
 *     `scripts/prepare-practice-assets-migration.ts` (the 4 "REF_OK"
 *     samples in this conversation all sign successfully in
 *     `practice-assets` and FAIL in `songs`).
 *   - The 5 new songs imported in df96529 / 81fe325 were uploaded to
 *     `songs` only — never copied to `practice-assets` — so production
 *     broker fails for them with `SIGN_URL_FAILED: Object not found`.
 *
 * Safety rails:
 *   - DRY RUN by default. To apply, set:
 *       PRACTICE_MIGRATION_APPLY=1 PRACTICE_MIGRATION_CONFIRM=copy-five-new
 *   - SCOPED strictly to the 5 trackIds; the script refuses to touch any
 *     other row even if env vars are flipped.
 *   - NEVER overwrites an existing target object unless
 *     PRACTICE_MIGRATION_OVERWRITE=1 (off by default).
 *   - Writes a report to `tmp/copy-five-new-to-practice-assets.json`.
 *
 * After APPLY, run `scripts/verify-five-new-imports-practice-broker.ts`
 * with `SUPABASE_PRACTICE_BUCKET=practice-assets` to verify all 5 sign
 * cleanly in the deployed-equivalent configuration.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import {Buffer} from 'node:buffer';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';

dotenv.config({path: path.resolve(process.cwd(), '.env')});
dotenv.config({path: path.resolve(process.cwd(), '.env.local')});

const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const SOURCE_BUCKET = process.env.SUPABASE_SONGS_BUCKET?.trim() || 'songs';
const TARGET_BUCKET = process.env.SUPABASE_PRACTICE_BUCKET?.trim() || 'practice-assets';
const REQUIRED_CONFIRM = 'copy-five-new';

/** Whitelist: this script will only operate on these 5 track ids. */
const FIVE_TRACK_IDS = new Set([
  'c0d763ff-4378-4dfc-8299-938eed122eac',
  'd58c71f9-db53-4913-9622-cb02071d8c21',
  '4c828c96-de0e-4481-aff9-0ae4a3139358',
  'ae2f8edb-e1e4-4f38-8777-0a59887426af',
  '79248e52-11ca-45fd-8822-8a5f94a1cfc0',
]);

type ProbeResult = {exists: boolean; status: 'exists' | 'missing' | 'probe_error'; errorMessage?: string};

async function probeObject(supabase: SupabaseClient, bucket: string, key: string): Promise<ProbeResult> {
  const idx = key.lastIndexOf('/');
  const dir = idx < 0 ? '' : key.slice(0, idx);
  const file = idx < 0 ? key : key.slice(idx + 1);
  const res = await supabase.storage.from(bucket).list(dir, {limit: 200, offset: 0, search: file});
  if (res.error) {
    return {exists: false, status: 'probe_error', errorMessage: res.error.message};
  }
  if (!Array.isArray(res.data)) return {exists: false, status: 'probe_error', errorMessage: 'list non-array'};
  return {
    exists: res.data.some(e => e.name === file),
    status: res.data.some(e => e.name === file) ? 'exists' : 'missing',
  };
}

function contentTypeForKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.mid') || lower.endsWith('.midi')) return 'audio/midi';
  if (lower.endsWith('.musicxml')) return 'application/vnd.recordare.musicxml+xml';
  return 'application/octet-stream';
}

type CopyOutcome =
  | {ok: true; method: 'copy_api' | 'download_upload'}
  | {ok: false; message: string};

async function copyAcross(
  supabase: SupabaseClient,
  sourceKey: string,
  targetKey: string,
  overwrite: boolean,
): Promise<CopyOutcome> {
  if (overwrite) {
    await supabase.storage.from(TARGET_BUCKET).remove([targetKey]);
  }
  const tryCopy = await supabase.storage
    .from(SOURCE_BUCKET)
    .copy(sourceKey, targetKey, {destinationBucket: TARGET_BUCKET});
  if (!tryCopy.error) return {ok: true, method: 'copy_api'};

  /** Fallback: download + upload (still service-role authenticated). */
  const dl = await supabase.storage.from(SOURCE_BUCKET).download(sourceKey);
  if (dl.error || !dl.data) {
    return {
      ok: false,
      message: `copy_api_failed(${tryCopy.error?.message}); download_failed(${dl.error?.message ?? 'no data'})`,
    };
  }
  const buf = Buffer.from(await dl.data.arrayBuffer());
  const up = await supabase.storage.from(TARGET_BUCKET).upload(targetKey, buf, {
    contentType: contentTypeForKey(targetKey),
    upsert: overwrite,
  });
  if (up.error) {
    return {
      ok: false,
      message: `copy_api_failed(${tryCopy.error?.message}); upload_failed(${up.error.message})`,
    };
  }
  return {ok: true, method: 'download_upload'};
}

type Item = {
  id: string;
  slug: string;
  title: string;
  sourceMidiKey: string | null;
  sourceXmlKey: string | null;
  sourceMidiProbe: ProbeResult;
  sourceXmlProbe: ProbeResult;
  targetMidiProbeBefore: ProbeResult;
  targetXmlProbeBefore: ProbeResult;
  midiAction: 'skipped_existing' | 'copied' | 'not_applicable' | 'failed' | 'dry_run_pending';
  xmlAction: 'skipped_existing' | 'copied' | 'not_applicable' | 'failed' | 'dry_run_pending';
  midiError?: string;
  xmlError?: string;
  targetMidiProbeAfter?: ProbeResult;
  targetXmlProbeAfter?: ProbeResult;
};

function pickKey(p: string | null | undefined, u: string | null | undefined): string | null {
  const raw = (p?.trim() || u?.trim() || '') as string;
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    const m = /\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/i.exec(raw);
    return m?.[1] ?? null;
  }
  return raw.replace(/^\/+/, '');
}

(async () => {
  const applyRequested = process.env.PRACTICE_MIGRATION_APPLY?.trim() === '1';
  const confirmed = process.env.PRACTICE_MIGRATION_CONFIRM?.trim() === REQUIRED_CONFIRM;
  const overwriteEnabled = process.env.PRACTICE_MIGRATION_OVERWRITE?.trim() === '1';
  const dryRun = !(applyRequested && confirmed);

  console.log('[copy-5-new] sourceBucket=', SOURCE_BUCKET, ' targetBucket=', TARGET_BUCKET);
  if (dryRun) {
    console.log('[copy-5-new] DRY RUN ONLY (set PRACTICE_MIGRATION_APPLY=1 PRACTICE_MIGRATION_CONFIRM=' + REQUIRED_CONFIRM + ' to apply)');
  } else {
    console.log('[copy-5-new] APPLY MODE (overwriteEnabled=' + overwriteEnabled + ')');
  }
  console.log('[copy-5-new] scope: 5 track ids ONLY:');
  for (const id of FIVE_TRACK_IDS) console.log('   -', id);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {auth: {persistSession: false}, db: {schema: 'public'}});

  /** Fetch rows for the 5 ids only; bail loudly if any extra rows leak in. */
  const idsArr = [...FIVE_TRACK_IDS];
  const rowsRes = await supabase
    .from('songs')
    .select('id, slug, title, has_practice_mode, midi_path, xml_path, midi_url, musicxml_url')
    .in('id', idsArr);
  if (rowsRes.error) throw new Error('songs query failed: ' + rowsRes.error.message);
  const rows = (rowsRes.data ?? []) as Array<{
    id: string;
    slug: string | null;
    title: string | null;
    has_practice_mode: boolean | null;
    midi_path: string | null;
    xml_path: string | null;
    midi_url: string | null;
    musicxml_url: string | null;
  }>;

  for (const r of rows) {
    if (!FIVE_TRACK_IDS.has(r.id)) {
      throw new Error('FATAL: row outside whitelist id=' + r.id + ' (refusing to proceed)');
    }
  }

  const items: Item[] = [];

  for (const row of rows) {
    const sourceMidiKey = pickKey(row.midi_path, row.midi_url);
    const sourceXmlKey = pickKey(row.xml_path, row.musicxml_url);
    const item: Item = {
      id: row.id,
      slug: row.slug ?? '',
      title: row.title ?? '',
      sourceMidiKey,
      sourceXmlKey,
      sourceMidiProbe: {exists: false, status: 'missing'},
      sourceXmlProbe: {exists: false, status: 'missing'},
      targetMidiProbeBefore: {exists: false, status: 'missing'},
      targetXmlProbeBefore: {exists: false, status: 'missing'},
      midiAction: dryRun ? 'dry_run_pending' : 'not_applicable',
      xmlAction: dryRun ? 'dry_run_pending' : 'not_applicable',
    };

    if (sourceMidiKey) item.sourceMidiProbe = await probeObject(supabase, SOURCE_BUCKET, sourceMidiKey);
    if (sourceXmlKey) item.sourceXmlProbe = await probeObject(supabase, SOURCE_BUCKET, sourceXmlKey);
    if (sourceMidiKey) item.targetMidiProbeBefore = await probeObject(supabase, TARGET_BUCKET, sourceMidiKey);
    if (sourceXmlKey) item.targetXmlProbeBefore = await probeObject(supabase, TARGET_BUCKET, sourceXmlKey);

    console.log(
      `[copy-5-new] ${row.id}  ${(row.title ?? '').slice(0, 30).padEnd(30)} | mid: src=${item.sourceMidiProbe.status} tgt=${item.targetMidiProbeBefore.status} | xml: src=${item.sourceXmlProbe.status} tgt=${item.targetXmlProbeBefore.status}`,
    );

    /** Eligibility: source exists in `songs`; target not already in `practice-assets` (unless overwrite). */
    if (!dryRun && sourceMidiKey && sourceXmlKey) {
      if (item.sourceMidiProbe.status !== 'exists' || item.sourceXmlProbe.status !== 'exists') {
        item.midiAction = 'failed';
        item.xmlAction = 'failed';
        item.midiError = item.midiError || `source_missing(${item.sourceMidiProbe.status})`;
        item.xmlError = item.xmlError || `source_missing(${item.sourceXmlProbe.status})`;
      } else {
        /** MIDI */
        if (item.targetMidiProbeBefore.status === 'exists' && !overwriteEnabled) {
          item.midiAction = 'skipped_existing';
        } else {
          const r = await copyAcross(supabase, sourceMidiKey, sourceMidiKey, overwriteEnabled);
          if (r.ok) item.midiAction = 'copied';
          else {
            item.midiAction = 'failed';
            item.midiError = r.message;
          }
        }
        /** XML */
        if (item.targetXmlProbeBefore.status === 'exists' && !overwriteEnabled) {
          item.xmlAction = 'skipped_existing';
        } else {
          const r = await copyAcross(supabase, sourceXmlKey, sourceXmlKey, overwriteEnabled);
          if (r.ok) item.xmlAction = 'copied';
          else {
            item.xmlAction = 'failed';
            item.xmlError = r.message;
          }
        }
        /** Post-copy probe */
        item.targetMidiProbeAfter = await probeObject(supabase, TARGET_BUCKET, sourceMidiKey);
        item.targetXmlProbeAfter = await probeObject(supabase, TARGET_BUCKET, sourceXmlKey);
        console.log(
          `  [copy-5-new]   APPLIED: mid=${item.midiAction} (post=${item.targetMidiProbeAfter.status}) | xml=${item.xmlAction} (post=${item.targetXmlProbeAfter.status})`,
        );
      }
    }

    items.push(item);
  }

  /** Report */
  const reportDir = path.resolve(process.cwd(), 'tmp');
  fs.mkdirSync(reportDir, {recursive: true});
  const reportPath = path.join(reportDir, 'copy-five-new-to-practice-assets.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceBucket: SOURCE_BUCKET,
        targetBucket: TARGET_BUCKET,
        dryRun,
        overwriteEnabled,
        items,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('\n[copy-5-new] report:', reportPath);

  if (dryRun) {
    const wouldCopy = items.filter(
      it =>
        it.sourceMidiKey &&
        it.sourceXmlKey &&
        it.sourceMidiProbe.status === 'exists' &&
        it.sourceXmlProbe.status === 'exists' &&
        (it.targetMidiProbeBefore.status !== 'exists' || it.targetXmlProbeBefore.status !== 'exists'),
    ).length;
    const alreadyTarget = items.filter(
      it =>
        it.targetMidiProbeBefore.status === 'exists' && it.targetXmlProbeBefore.status === 'exists',
    ).length;
    console.log(`\n[copy-5-new] DRY RUN summary: wouldCopy=${wouldCopy}, alreadyInTarget=${alreadyTarget}, total=${items.length}`);
  } else {
    const copiedCount = items.filter(
      it => it.midiAction === 'copied' || it.xmlAction === 'copied',
    ).length;
    const failed = items.filter(it => it.midiAction === 'failed' || it.xmlAction === 'failed');
    console.log(`\n[copy-5-new] APPLY summary: tracksWithCopy=${copiedCount}, failed=${failed.length}, total=${items.length}`);
    if (failed.length > 0) {
      console.log('[copy-5-new] failures:');
      for (const f of failed) {
        console.log(`  - ${f.id}: midi=${f.midiAction} (${f.midiError ?? ''}) | xml=${f.xmlAction} (${f.xmlError ?? ''})`);
      }
      process.exit(1);
    }
  }
})().catch(err => {
  console.error('copy-5-new failed:', err);
  process.exit(1);
});
