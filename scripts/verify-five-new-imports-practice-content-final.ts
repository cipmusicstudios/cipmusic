/**
 * Post-fix validation: with `SUPABASE_PRACTICE_BUCKET=practice-assets`
 * (mirrors production Netlify config), confirm that the broker now
 * returns signed URLs whose **body** is a valid MIDI + MusicXML for the
 * 5 newly imported songs AND for at least one older confirmed-working
 * Practice song. Mirrors what the browser does: signed URL → GET →
 * parse MIDI → check MusicXML shape.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import midiPkg from '@tonejs/midi';
const {Midi} = midiPkg as unknown as {Midi: typeof import('@tonejs/midi').Midi};
import type {HandlerEvent} from '@netlify/functions';

dotenv.config({path: path.resolve(process.cwd(), '.env')});
dotenv.config({path: path.resolve(process.cwd(), '.env.local')});
process.env.SUPABASE_PRACTICE_BUCKET = process.env.SUPABASE_PRACTICE_BUCKET || 'practice-assets';

const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY?.trim() || '';
if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error('Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY');
  process.exit(2);
}
process.env.SUPABASE_URL = SUPABASE_URL;

const {handler} = await import('../netlify/functions/practice-asset-url.ts');

const TARGETS = [
  {id: 'c0d763ff-4378-4dfc-8299-938eed122eac', label: '一个人想着一个人', tag: 'NEW'},
  {id: 'd58c71f9-db53-4913-9622-cb02071d8c21', label: 'Beauty And A Beat', tag: 'NEW'},
  {id: '4c828c96-de0e-4481-aff9-0ae4a3139358', label: "It's Me", tag: 'NEW'},
  {id: 'ae2f8edb-e1e4-4f38-8777-0a59887426af', label: '心愿便利贴+BonBon Girls', tag: 'NEW'},
  {id: '79248e52-11ca-45fd-8822-8a5f94a1cfc0', label: 'Someone to Love', tag: 'NEW'},
  {id: 'be004160-2a57-430c-8169-7d8dbb915fec', label: 'STAY (older)', tag: 'OLD'},
  {id: '5cf31c63-ce5c-45ca-871b-9b5a6864d8e6', label: 'Golden (older)', tag: 'OLD'},
  {id: '3e00992c-1f2c-4c6b-be3f-175b2a6d4c9f', label: '那天下雨了 (older)', tag: 'OLD'},
];

async function ensureUser(): Promise<string> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {auth: {persistSession: false}});
  const email = 'phase-c-final-5new@example.com';
  const password = 'StrongPass!12345';
  const list = await admin.auth.admin.listUsers({page: 1, perPage: 200});
  const existing = list.data?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
  let userId = existing?.id;
  if (!userId) {
    const created = await admin.auth.admin.createUser({email, password, email_confirm: true});
    if (created.error || !created.data.user) throw new Error('create: ' + created.error?.message);
    userId = created.data.user.id;
  } else {
    await admin.auth.admin.updateUserById(userId, {password, email_confirm: true});
  }
  const anon = createClient(SUPABASE_URL, ANON_KEY, {auth: {persistSession: false}});
  const sign = await anon.auth.signInWithPassword({email, password});
  if (sign.error || !sign.data.session) throw new Error('sign: ' + sign.error?.message);
  return sign.data.session.access_token;
}

async function broker(token: string, trackId: string) {
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
  return (await handler(event, {} as never, () => undefined)) as unknown as {
    statusCode: number;
    body: string;
  };
}

function xmlShapeOk(text: string): boolean {
  if (!text.startsWith('<?xml')) return false;
  if (!/<score-partwise|<score-timewise/.test(text)) return false;
  return /<measure\b/.test(text);
}

(async () => {
  console.log(`=== Final validation against SUPABASE_PRACTICE_BUCKET=${process.env.SUPABASE_PRACTICE_BUCKET} ===`);
  const token = await ensureUser();
  let failures = 0;
  for (const t of TARGETS) {
    const res = await broker(token, t.id);
    if (res.statusCode !== 200) {
      console.log(`FAIL ${t.tag.padEnd(3)} ${t.id} (${t.label}): broker HTTP ${res.statusCode}`);
      console.log('   body:', res.body);
      failures++;
      continue;
    }
    const parsed = JSON.parse(res.body) as {ok: boolean; midiUrl?: string; musicXmlUrl?: string};
    if (parsed.ok !== true || !parsed.midiUrl || !parsed.musicXmlUrl) {
      console.log(`FAIL ${t.tag.padEnd(3)} ${t.id}: broker payload invalid`, parsed);
      failures++;
      continue;
    }
    const [mRes, xRes] = await Promise.all([fetch(parsed.midiUrl), fetch(parsed.musicXmlUrl)]);
    if (!mRes.ok || !xRes.ok) {
      console.log(`FAIL ${t.tag.padEnd(3)} ${t.id}: GET midi=${mRes.status} xml=${xRes.status}`);
      failures++;
      continue;
    }
    const mBuf = await mRes.arrayBuffer();
    const xText = await xRes.text();
    /** MIDI parse via @tonejs/midi (same library the browser uses) */
    let midiInfo = '';
    try {
      const midi = new Midi(mBuf);
      const trackNotes = midi.tracks.map(tr => tr.notes.length);
      midiInfo = `tracks=${midi.tracks.length} notes=[${trackNotes.join(',')}] ppq=${midi.header.ppq} duration=${midi.duration.toFixed(1)}s`;
    } catch (err) {
      console.log(`FAIL ${t.tag.padEnd(3)} ${t.id}: MIDI parse: ${err instanceof Error ? err.message : err}`);
      failures++;
      continue;
    }
    if (!xmlShapeOk(xText)) {
      console.log(`FAIL ${t.tag.padEnd(3)} ${t.id}: MusicXML shape invalid (size=${xText.length})`);
      failures++;
      continue;
    }
    console.log(
      `OK   ${t.tag.padEnd(3)} ${t.id.slice(0, 8)} ${t.label.padEnd(28)} | MIDI ${midiInfo} | XML size=${xText.length}`,
    );
  }
  if (failures > 0) {
    console.log(`\nFAIL: ${failures} failures.`);
    process.exit(1);
  }
  console.log('\nPASS: 5 new songs + older Practice songs all resolve content via production-equivalent broker.');
})().catch(err => {
  console.error('final verify failed:', err);
  process.exit(1);
});
