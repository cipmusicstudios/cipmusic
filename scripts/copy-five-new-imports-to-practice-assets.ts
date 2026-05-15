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
import {createClient} from '@supabase/supabase-js';
import {probeStorageObject, publishMidiXmlToPracticeBucket} from './lib/publish-practice-assets-to-private-bucket.ts';

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

    if (sourceMidiKey) item.sourceMidiProbe = await probeStorageObject(supabase, SOURCE_BUCKET, sourceMidiKey);
    if (sourceXmlKey) item.sourceXmlProbe = await probeStorageObject(supabase, SOURCE_BUCKET, sourceXmlKey);
    if (sourceMidiKey) item.targetMidiProbeBefore = await probeStorageObject(supabase, TARGET_BUCKET, sourceMidiKey);
    if (sourceXmlKey) item.targetXmlProbeBefore = await probeStorageObject(supabase, TARGET_BUCKET, sourceXmlKey);

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
        try {
          const pub = await publishMidiXmlToPracticeBucket({
            supabase,
            songsBucket: SOURCE_BUCKET,
            practiceBucket: TARGET_BUCKET,
            midiKey: sourceMidiKey,
            xmlKey: sourceXmlKey,
            dryRun: false,
            overwrite: overwriteEnabled,
          });
          const side = (v: typeof pub.midi): Item['midiAction'] => {
            if (v === 'dry_run_pending') return 'dry_run_pending';
            if (v === 'not_applicable') return 'not_applicable';
            if (v === 'skipped_existing') return 'skipped_existing';
            return 'copied';
          };
          item.midiAction = side(pub.midi);
          item.xmlAction = side(pub.xml);
          item.targetMidiProbeAfter = pub.midiProbeAfter;
          item.targetXmlProbeAfter = pub.xmlProbeAfter;
          console.log(
            `  [copy-5-new]   APPLIED: mid=${item.midiAction} (post=${item.targetMidiProbeAfter?.status}) | xml=${item.xmlAction} (post=${item.targetXmlProbeAfter?.status})`,
          );
        } catch (err) {
          item.midiAction = 'failed';
          item.xmlAction = 'failed';
          const msg = err instanceof Error ? err.message : String(err);
          item.midiError = msg;
          item.xmlError = msg;
        }
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
