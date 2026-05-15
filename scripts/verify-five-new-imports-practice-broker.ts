/**
 * Verify that the Practice Mode broker (`netlify/functions/practice-asset-url`)
 * can resolve MIDI / MusicXML signed URLs for each of the five newly imported
 * songs from commit df96529:
 *
 *   c0d763ff-4378-4dfc-8299-938eed122eac  一个人想着一个人
 *   d58c71f9-db53-4913-9622-cb02071d8c21  Beauty And A Beat
 *   4c828c96-de0e-4481-aff9-0ae4a3139358  It's Me
 *   ae2f8edb-e1e4-4f38-8777-0a59887426af  心愿便利贴+BonBon Girls
 *   79248e52-11ca-45fd-8822-8a5f94a1cfc0  Someone to Love
 *
 * Invokes the handler in-process (no Netlify dev needed). Creates / uses a
 * disposable test account to obtain a valid Bearer JWT.
 *
 * Usage:
 *   tsx scripts/verify-five-new-imports-practice-broker.ts
 */
import dotenv from 'dotenv';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import type {HandlerEvent} from '@netlify/functions';

dotenv.config({path: path.resolve(process.cwd(), '.env')});
dotenv.config({path: path.resolve(process.cwd(), '.env.local')});

const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY?.trim() || '';

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error('Missing required env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY');
  process.exit(2);
}
process.env.SUPABASE_URL = SUPABASE_URL;

const {handler} = await import('../netlify/functions/practice-asset-url.ts');

const FIVE = [
  {id: 'c0d763ff-4378-4dfc-8299-938eed122eac', label: '一个人想着一个人'},
  {id: 'd58c71f9-db53-4913-9622-cb02071d8c21', label: 'Beauty And A Beat'},
  {id: '4c828c96-de0e-4481-aff9-0ae4a3139358', label: "It's Me"},
  {id: 'ae2f8edb-e1e4-4f38-8777-0a59887426af', label: 'BonBon Girls (浪姐版)'},
  {id: '79248e52-11ca-45fd-8822-8a5f94a1cfc0', label: 'Someone to Love'},
];

type Resp = {statusCode: number; body: string};

async function invoke(event: Partial<HandlerEvent>): Promise<Resp> {
  const full: HandlerEvent = {
    httpMethod: 'POST',
    headers: {},
    body: '{}',
    rawUrl: '',
    rawQuery: '',
    path: '/.netlify/functions/practice-asset-url',
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    isBase64Encoded: false,
    ...event,
  } as HandlerEvent;
  return (await handler(full, {} as never, () => undefined)) as unknown as Resp;
}

async function ensureUser(email: string, password: string): Promise<{userId: string; accessToken: string}> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {auth: {persistSession: false}});
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
  return {userId, accessToken: sign.data.session.access_token};
}

type BrokerOk = {
  ok: true;
  trackId: string;
  midiUrl: string;
  musicXmlUrl: string;
  expiresAt: string;
  accessMode: string;
};

(async () => {
  const {accessToken, userId} = await ensureUser('phase-c-verify-5new@example.com', 'StrongPass!12345');
  console.log('signed-in userId =', userId);

  const failures: string[] = [];

  for (const t of FIVE) {
    const res = await invoke({
      headers: {authorization: `Bearer ${accessToken}`},
      body: JSON.stringify({trackId: t.id}),
    });
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      parsed = {raw: res.body};
    }
    if (res.statusCode !== 200) {
      console.log(`FAIL ${t.id} (${t.label}) → HTTP ${res.statusCode}`, parsed);
      failures.push(`${t.id} (${t.label}): HTTP ${res.statusCode} ${(parsed.code as string) || ''}`);
      continue;
    }
    const ok = parsed as BrokerOk;
    const midiOk = typeof ok.midiUrl === 'string' && ok.midiUrl.includes('/object/sign/');
    const xmlOk = typeof ok.musicXmlUrl === 'string' && ok.musicXmlUrl.includes('/object/sign/');
    if (!midiOk || !xmlOk) {
      console.log(`FAIL ${t.id} (${t.label}) — missing signed URLs`, {midiOk, xmlOk});
      failures.push(`${t.id} (${t.label}): missing signed URLs`);
      continue;
    }
    /** Verify the signed URLs actually return 200 (sanity check on storage path). */
    const [midiHead, xmlHead] = await Promise.all([
      fetch(ok.midiUrl, {method: 'HEAD'}),
      fetch(ok.musicXmlUrl, {method: 'HEAD'}),
    ]);
    if (!midiHead.ok || !xmlHead.ok) {
      console.log(
        `FAIL ${t.id} (${t.label}) signed URL fetch — midi=${midiHead.status} xml=${xmlHead.status}`,
      );
      failures.push(`${t.id} (${t.label}): fetch midi=${midiHead.status} xml=${xmlHead.status}`);
      continue;
    }
    console.log(
      `OK   ${t.id} (${t.label})  accessMode=${ok.accessMode} midi=${midiHead.status} xml=${xmlHead.status}`,
    );
  }

  if (failures.length === 0) {
    console.log('\nPASS: broker resolves signed Practice assets for all 5 new song IDs.');
    process.exit(0);
  }
  console.log('\nFAIL summary:\n  - ' + failures.join('\n  - '));
  process.exit(1);
})().catch(err => {
  console.error('verify failed:', err);
  process.exit(1);
});
