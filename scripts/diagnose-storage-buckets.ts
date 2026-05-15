/**
 * Inspect which Supabase storage buckets actually contain the
 * `<slug>/performance.mid` keys for the new vs older Practice songs.
 *
 * Tests both `songs` and `practice-assets` buckets using the service
 * role. Also list-folder probes to see what's actually under each slug.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';

dotenv.config({path: path.resolve(process.cwd(), '.env')});
dotenv.config({path: path.resolve(process.cwd(), '.env.local')});

const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const KEYS = [
  {tag: 'NEW', slugKey: 'beauty-and-a-beat-justin-bieber'},
  {tag: 'NEW', slugKey: 'someone-to-love-track-ba510f42d3'},
  {tag: 'NEW', slugKey: 'it-s-me-illit'},
  {tag: 'NEW', slugKey: 'bonbon-girls-track-9ec2ab8cdf'},
  {tag: 'NEW', slugKey: 'track-b3907eebea-track-ee1ae21192'},
  {tag: 'OLD', slugKey: 'stay'},
  {tag: 'OLD', slugKey: 'golden'},
  {tag: 'OLD', slugKey: 'track-d4d0c92fc0'},
  {tag: 'OLD', slugKey: 'track-058ad7c038'},
];

const BUCKETS = ['songs', 'practice-assets'];

(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {auth: {persistSession: false}});

  /** List existing buckets */
  const buckets = await admin.storage.listBuckets();
  console.log('Available buckets:', buckets.data?.map(b => `${b.name}(${b.public ? 'public' : 'private'})`).join(', '));
  console.log('');

  for (const k of KEYS) {
    console.log(`---- ${k.tag}  ${k.slugKey} ----`);
    for (const bucket of BUCKETS) {
      /** Try signing performance.mid */
      const midiKey = `songs/${k.slugKey}/performance.mid`;
      const xmlKey = `songs/${k.slugKey}/score.musicxml`;
      const [midiSign, xmlSign] = await Promise.all([
        admin.storage.from(bucket).createSignedUrl(midiKey, 60),
        admin.storage.from(bucket).createSignedUrl(xmlKey, 60),
      ]);
      const midiOk = !midiSign.error && !!midiSign.data?.signedUrl;
      const xmlOk = !xmlSign.error && !!xmlSign.data?.signedUrl;
      console.log(`  bucket=${bucket.padEnd(16)} mid_sign=${midiOk ? 'OK ' : 'FAIL'} (${midiSign.error?.message ?? '∅'}) | xml_sign=${xmlOk ? 'OK' : 'FAIL'} (${xmlSign.error?.message ?? '∅'})`);
    }
  }
})().catch(err => {
  console.error('failed:', err);
  process.exit(1);
});
