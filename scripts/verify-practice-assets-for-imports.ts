/**
 * Verify that `midi_path` + `xml_path` for given song slugs (or slug→storage keys)
 * exist in the **private** Practice broker bucket (`SUPABASE_PRACTICE_BUCKET`, default `practice-assets`).
 *
 * Use after `--apply` migrations that enable Practice Mode, or CI gate before deploy:
 *
 *   tsx scripts/verify-practice-assets-for-imports.ts --only-slugs "stay,golden"
 *   npm run verify:practice-assets-import -- --only-slugs "stay,golden"
 *
 * Exit codes:
 *   0 — every requested slug with `has_practice_mode` has MIDI + XML in the private bucket
 *   2 — cli / misconfiguration errors
 *   1 — at least one required object missing / DB row ambiguous
 */
import dotenv from 'dotenv';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {
  assertPracticeBucketExists,
  probeStorageObject,
  resolveImportPracticeBucketName,
} from './lib/publish-practice-assets-to-private-bucket.ts';

dotenv.config({path: path.resolve(process.cwd(), '.env')});
dotenv.config({path: path.resolve(process.cwd(), '.env.local')});

const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

function parseOnlySlugs(): string[] | null {
  let value = '';
  const eq = process.argv.find(a => a.startsWith('--only-slugs='));
  if (eq) {
    value = eq.slice('--only-slugs='.length);
  } else {
    const idx = process.argv.indexOf('--only-slugs');
    const next = idx >= 0 ? process.argv[idx + 1] : undefined;
    if (typeof next === 'string' && !next.startsWith('-')) {
      value = next;
    }
  }
  if (!value.trim()) return null;
  return value
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean);
}

(async () => {
  const slugs = parseOnlySlugs();
  if (!slugs || slugs.length === 0) {
    console.error('Usage: tsx scripts/verify-practice-assets-for-imports.ts --only-slugs "slug-one,slug-two"');
    process.exit(2);
  }

  const practiceBucket = resolveImportPracticeBucketName();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {auth: {persistSession: false}, db: {schema: 'public'}});

  await assertPracticeBucketExists(supabase, practiceBucket);

  const rowsRes = await supabase
    .from('songs')
    .select('slug, title, has_practice_mode, midi_path, xml_path')
    .in('slug', slugs);
  if (rowsRes.error) throw new Error(rowsRes.error.message);
  const rows = (rowsRes.data ?? []) as Array<{
    slug: string;
    title: string | null;
    has_practice_mode: boolean | null;
    midi_path: string | null;
    xml_path: string | null;
  }>;

  let failures = 0;
  for (const want of slugs) {
    const row = rows.find(r => r.slug === want || r.slug?.trim() === want);
    if (!row) {
      console.error(`MISS  slug="${want}" → no matching song row`);
      failures++;
      continue;
    }
    if (!row.has_practice_mode) {
      console.warn(`SKIP  slug="${row.slug}" (has_practice_mode=false)`);
      continue;
    }
    const mk = typeof row.midi_path === 'string' ? row.midi_path.trim() : '';
    const xk = typeof row.xml_path === 'string' ? row.xml_path.trim() : '';
    if (!mk || !xk) {
      console.error(`FAIL  slug="${row.slug}" → missing midi_path/xml_path columns for Practice`);
      failures++;
      continue;
    }

    const [midiProbe, xmlProbe] = await Promise.all([
      probeStorageObject(supabase, practiceBucket, mk.replace(/^\/+/, '')),
      probeStorageObject(supabase, practiceBucket, xk.replace(/^\/+/, '')),
    ]);

    const ok = midiProbe.status === 'exists' && xmlProbe.status === 'exists';
    console.log(
      `${ok ? 'OK   ' : 'FAIL '} "${row.slug}" (${row.title ?? ''})\n` +
        `       broker bucket "${practiceBucket}": midi=${midiProbe.status}${midiProbe.errorMessage ? '(' + midiProbe.errorMessage + ')' : ''} key=${mk}\n` +
        `                                 xml=${xmlProbe.status}${xmlProbe.errorMessage ? '(' + xmlProbe.errorMessage + ')' : ''} key=${xk}`,
    );
    if (!ok) failures++;
  }

  if (failures > 0) {
    console.error(`\nVerification failed (${failures} issue(s)). Fix with migrate-local-songs (--apply) or npm run prepare:practice-assets.`);
    process.exit(1);
  }
})().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
