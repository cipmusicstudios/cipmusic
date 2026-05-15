/**
 * Diagnose Practice Mode runtime load for the 5 new songs by GET-ing the
 * actual signed MIDI + MusicXML bodies and parsing them just like the
 * browser does:
 *
 *   1. Sign in as the verify test user → call the broker for each song.
 *   2. GET both signed URLs (not HEAD): record HTTP status, content-type,
 *      content-length, first bytes, total bytes, sha-256.
 *   3. Parse the MIDI through `@tonejs/midi` (same parser the website uses
 *      in `src/practice/PracticePanelModule.tsx`).
 *   4. Parse the MusicXML lightly to confirm it is a real `<score-partwise>`
 *      document with parts/measures.
 *   5. Compare the supabase bytes vs the local `public/local-imports/<slug>/`
 *      bytes to catch upload mismatches.
 *
 * Run:
 *   tsx scripts/diagnose-five-new-imports-practice-content.ts
 */
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import midiPkg from '@tonejs/midi';
const {Midi} = midiPkg as unknown as {Midi: typeof import('@tonejs/midi').Midi};
import type {HandlerEvent} from '@netlify/functions';

dotenv.config({path: path.resolve(process.cwd(), '.env')});
dotenv.config({path: path.resolve(process.cwd(), '.env.local')});

const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY?.trim() || '';
if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error('Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY');
  process.exit(2);
}
process.env.SUPABASE_URL = SUPABASE_URL;

const {handler: practiceBrokerHandler} = await import(
  '../netlify/functions/practice-asset-url.ts'
);

const TARGETS = [
  {
    id: 'c0d763ff-4378-4dfc-8299-938eed122eac',
    label: '一个人想着一个人',
    localSlug: '一个人想着一个人',
  },
  {
    id: 'd58c71f9-db53-4913-9622-cb02071d8c21',
    label: 'Beauty And A Beat',
    localSlug: 'beauty and a beat',
  },
  {id: '4c828c96-de0e-4481-aff9-0ae4a3139358', label: "It's Me", localSlug: "it's me"},
  {
    id: 'ae2f8edb-e1e4-4f38-8777-0a59887426af',
    label: 'BonBon Girls',
    localSlug: 'BonBon Girls',
  },
  {
    id: '79248e52-11ca-45fd-8822-8a5f94a1cfc0',
    label: 'Someone to Love',
    localSlug: 'someone to love',
  },
];

/** Sample older working Practice tracks for structural comparison. */
const REFERENCE_OK_IDS = [
  '3e00992c-1f2c-4c6b-be3f-175b2a6d4c9f', // 那天下雨了 (no OV, confirmed working)
  'be004160-2a57-430c-8169-7d8dbb915fec', // STAY (OV, confirmed working older)
  '5cf31c63-ce5c-45ca-871b-9b5a6864d8e6', // Golden (confirmed Practice-working)
];

async function invokeBroker(token: string, trackId: string) {
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
  return (await practiceBrokerHandler(event, {} as never, () => undefined)) as unknown as {
    statusCode: number;
    body: string;
  };
}

async function ensureTestUser(): Promise<{accessToken: string}> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {auth: {persistSession: false}});
  const email = 'phase-c-diagnose-5new@example.com';
  const password = 'StrongPass!12345';
  const list = await admin.auth.admin.listUsers({page: 1, perPage: 200});
  const existing = list.data?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
  let userId = existing?.id;
  if (!userId) {
    const created = await admin.auth.admin.createUser({email, password, email_confirm: true});
    if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);
    userId = created.data.user.id;
  } else {
    await admin.auth.admin.updateUserById(userId, {password, email_confirm: true});
  }
  const anon = createClient(SUPABASE_URL, ANON_KEY, {auth: {persistSession: false}});
  const sign = await anon.auth.signInWithPassword({email, password});
  if (sign.error || !sign.data.session) throw new Error(`signIn failed: ${sign.error?.message}`);
  return {accessToken: sign.data.session.access_token};
}

function sha256(buf: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function summarizeMusicXml(xmlText: string) {
  const head = xmlText.slice(0, 300).replace(/\s+/g, ' ');
  const isXmlHeader = xmlText.startsWith('<?xml');
  const partwiseMatch = xmlText.match(/<score-partwise[^>]*>/);
  const timewiseMatch = xmlText.match(/<score-timewise[^>]*>/);
  const partListMatch = xmlText.match(/<score-part\s+id="[^"]+"/g) || [];
  const partMatches = xmlText.match(/<part\s+id="[^"]+"/g) || [];
  const measureMatches = xmlText.match(/<measure\b/g) || [];
  const timeMatches = xmlText.match(/<time\b[^>]*>[\s\S]*?<\/time>/g) || [];
  return {
    isXmlHeader,
    isPartwise: !!partwiseMatch,
    isTimewise: !!timewiseMatch,
    rootDecl: partwiseMatch?.[0] || timewiseMatch?.[0] || null,
    scoreParts: partListMatch.length,
    parts: partMatches.length,
    measures: measureMatches.length,
    timeSignatureBlocks: timeMatches.length,
    sampleHead: head,
  };
}

async function getBinary(url: string): Promise<{
  status: number;
  contentType: string | null;
  contentLength: number | null;
  bytes: Uint8Array;
  firstHex: string;
}> {
  const res = await fetch(url);
  const ab = await res.arrayBuffer();
  const u8 = new Uint8Array(ab);
  const firstHex = Buffer.from(u8.slice(0, 16)).toString('hex');
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    contentLength: Number(res.headers.get('content-length') || '0') || null,
    bytes: u8,
    firstHex,
  };
}

async function getText(url: string): Promise<{
  status: number;
  contentType: string | null;
  contentLength: number | null;
  text: string;
}> {
  const res = await fetch(url);
  const text = await res.text();
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    contentLength: Number(res.headers.get('content-length') || '0') || null,
    text,
  };
}

type SongEntry = (typeof TARGETS)[number] | {id: string; label: string; localSlug?: undefined};

async function processOne(entry: SongEntry, accessToken: string): Promise<{ok: boolean; reason?: string}> {
  console.log(`\n========== ${entry.id}  ${entry.label} ==========`);
  const brokerRes = await invokeBroker(accessToken, entry.id);
  const parsed = JSON.parse(brokerRes.body || '{}');
  if (brokerRes.statusCode !== 200 || parsed.ok !== true) {
    console.log('  broker FAIL:', brokerRes.statusCode, parsed);
    return {ok: false, reason: 'broker_failed'};
  }
  const midiUrl = parsed.midiUrl as string;
  const xmlUrl = parsed.musicXmlUrl as string;
  console.log('  broker OK   accessMode=', parsed.accessMode);

  /* ----- MIDI GET ----- */
  const midi = await getBinary(midiUrl);
  console.log(
    `  MIDI GET   status=${midi.status} content-type=${midi.contentType} content-length=${midi.contentLength} actualBytes=${midi.bytes.length}`,
  );
  console.log(`             firstHex(16)=${midi.firstHex}  sha256=${sha256(midi.bytes).slice(0, 16)}…`);
  if (midi.status !== 200) {
    console.log('  → MIDI GET non-200, stopping');
    return {ok: false, reason: 'midi_get_non_200'};
  }
  const looksLikeMidi = midi.bytes[0] === 0x4d && midi.bytes[1] === 0x54 && midi.bytes[2] === 0x68 && midi.bytes[3] === 0x64;
  if (!looksLikeMidi) {
    console.log('  → MIDI body is NOT a standard MIDI file (missing MThd header). First 80 bytes:');
    console.log('     ', Buffer.from(midi.bytes.slice(0, 80)).toString('utf8'));
    return {ok: false, reason: 'midi_body_not_smf'};
  }
  let midiParse: Midi | null = null;
  try {
    midiParse = new Midi(midi.bytes.buffer.slice(midi.bytes.byteOffset, midi.bytes.byteOffset + midi.bytes.byteLength) as ArrayBuffer);
    console.log(
      `  MIDI parse OK  tracks=${midiParse.tracks.length}  ppq=${midiParse.header.ppq}  tempos=${midiParse.header.tempos.length}  timeSig=${midiParse.header.timeSignatures.length}  duration=${midiParse.duration.toFixed(2)}s`,
    );
    const trackPitchSummary = midiParse.tracks.map((t, i) => ({
      i,
      name: t.name || null,
      notes: t.notes.length,
      firstNoteMidi: t.notes[0]?.midi ?? null,
      firstNoteTime: t.notes[0]?.time ?? null,
    }));
    console.log('  MIDI tracks:', JSON.stringify(trackPitchSummary));
  } catch (err) {
    console.log('  → MIDI parse FAIL:', err instanceof Error ? err.message : err);
    return {ok: false, reason: 'midi_parse_failed'};
  }

  /* ----- MusicXML GET ----- */
  const xml = await getText(xmlUrl);
  console.log(
    `  XML  GET   status=${xml.status} content-type=${xml.contentType} content-length=${xml.contentLength} textLength=${xml.text.length}`,
  );
  console.log(`             sha256=${sha256(Buffer.from(xml.text, 'utf8')).slice(0, 16)}…`);
  if (xml.status !== 200) {
    console.log('  → XML GET non-200, stopping');
    return {ok: false, reason: 'xml_get_non_200'};
  }
  if (xml.text.startsWith('<html') || xml.text.includes('<!DOCTYPE html')) {
    console.log('  → XML body looks like HTML, not MusicXML. First 200 chars:');
    console.log('     ', xml.text.slice(0, 200));
    return {ok: false, reason: 'xml_body_html'};
  }
  const meta = summarizeMusicXml(xml.text);
  console.log(
    `  XML  shape  xmlHeader=${meta.isXmlHeader} partwise=${meta.isPartwise} timewise=${meta.isTimewise} scoreParts=${meta.scoreParts} parts=${meta.parts} measures=${meta.measures} timeSig=${meta.timeSignatureBlocks}`,
  );
  console.log(`             root: ${meta.rootDecl}`);
  if (!meta.isXmlHeader || (!meta.isPartwise && !meta.isTimewise) || meta.measures === 0) {
    console.log('  → XML structure looks invalid for OSMD.');
    return {ok: false, reason: 'xml_structure_invalid'};
  }

  /* ----- Local content comparison (only for the 5 new songs) ----- */
  if ('localSlug' in entry && entry.localSlug) {
    const localDir = path.resolve(process.cwd(), 'public', 'local-imports', entry.localSlug);
    const localMidiPath = path.join(localDir, 'performance.mid');
    const localXmlPath = path.join(localDir, 'score.musicxml');
    const compareMidi = fs.existsSync(localMidiPath)
      ? sha256(fs.readFileSync(localMidiPath)) === sha256(Buffer.from(midi.bytes))
      : 'missing-local';
    const compareXml = fs.existsSync(localXmlPath)
      ? sha256(fs.readFileSync(localXmlPath)) === sha256(Buffer.from(xml.text, 'utf8'))
      : 'missing-local';
    console.log(
      `  vs local   midiSha256Match=${compareMidi}  xmlSha256Match=${compareXml}  localMidi=${fs.existsSync(localMidiPath) ? fs.statSync(localMidiPath).size : '∅'}B  localXml=${fs.existsSync(localXmlPath) ? fs.statSync(localXmlPath).size : '∅'}B`,
    );
  }
  return {ok: true};
}

(async () => {
  const {accessToken} = await ensureTestUser();
  console.log('=== Diagnosing 5 new songs Practice content ===');
  const allEntries: SongEntry[] = [
    ...REFERENCE_OK_IDS.map(id => ({id, label: `[REFERENCE] ${id.slice(0, 8)}`})),
    ...TARGETS,
  ];
  let failures = 0;
  for (const e of allEntries) {
    const r = await processOne(e, accessToken);
    if (!r.ok) failures++;
  }
  console.log('\n=== Summary ===');
  console.log(`failures: ${failures} of ${allEntries.length}`);
})().catch(err => {
  console.error('diagnose failed:', err);
  process.exit(1);
});
