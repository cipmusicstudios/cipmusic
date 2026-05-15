/**
 * Compare DB `songs` rows for the 5 new songs vs older confirmed-working
 * Practice songs. Focus on `midi_url`, `midi_path`, `musicxml_url`,
 * `xml_path`, `audio_url`, `slug`, `has_practice_mode`.
 *
 * Then for each path/url, do a service-role storage HEAD on **both**
 * the `songs` bucket and any other declared `SUPABASE_*` bucket, so we
 * can see which bucket actually contains the object on the deployed
 * Supabase project.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';

dotenv.config({path: path.resolve(process.cwd(), '.env')});
dotenv.config({path: path.resolve(process.cwd(), '.env.local')});

const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const TARGETS = [
  {id: 'c0d763ff-4378-4dfc-8299-938eed122eac', tag: 'NEW', label: '一个人想着一个人'},
  {id: 'd58c71f9-db53-4913-9622-cb02071d8c21', tag: 'NEW', label: 'Beauty And A Beat'},
  {id: '4c828c96-de0e-4481-aff9-0ae4a3139358', tag: 'NEW', label: "It's Me"},
  {id: 'ae2f8edb-e1e4-4f38-8777-0a59887426af', tag: 'NEW', label: '心愿便利贴+BonBon Girls'},
  {id: '79248e52-11ca-45fd-8822-8a5f94a1cfc0', tag: 'NEW', label: 'Someone to Love'},
  {id: '3e00992c-1f2c-4c6b-be3f-175b2a6d4c9f', tag: 'OLD', label: '那天下雨了'},
  {id: 'be004160-2a57-430c-8169-7d8dbb915fec', tag: 'OLD', label: 'STAY'},
  {id: '5cf31c63-ce5c-45ca-871b-9b5a6864d8e6', tag: 'OLD', label: 'Golden'},
  {id: 'b2e508b8-e675-41e4-a4af-1c2a20546de7', tag: 'OLD', label: '曾经我也想过一了百了'},
];

const COLS =
  'id, slug, title, audio_url, midi_url, midi_path, musicxml_url, xml_path, has_practice_mode, created_at';

(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {auth: {persistSession: false}});
  for (const t of TARGETS) {
    const res = await admin.from('songs').select(COLS).eq('id', t.id).maybeSingle();
    if (res.error) {
      console.log(`${t.tag}  ${t.id}  ${t.label}  → query error`, res.error.message);
      continue;
    }
    const row = res.data as Record<string, unknown> | null;
    if (!row) {
      console.log(`${t.tag}  ${t.id}  ${t.label}  → NO ROW`);
      continue;
    }
    console.log(`---- ${t.tag}  ${t.id}  ${t.label}  ----`);
    console.log(`  slug=${JSON.stringify(row.slug)}  has_practice_mode=${row.has_practice_mode}  created_at=${row.created_at}`);
    console.log(`  audio_url   : ${row.audio_url ?? '(null)'}`);
    console.log(`  midi_url    : ${row.midi_url ?? '(null)'}`);
    console.log(`  midi_path   : ${row.midi_path ?? '(null)'}`);
    console.log(`  musicxml_url: ${row.musicxml_url ?? '(null)'}`);
    console.log(`  xml_path    : ${row.xml_path ?? '(null)'}`);
  }
})().catch(err => {
  console.error('failed:', err);
  process.exit(1);
});
