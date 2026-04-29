/**
 * Phase C 验证脚本：调用 practice-asset-url Netlify Function handler，逐项确认：
 *
 *  1) 匿名（无 Authorization header）        → 401 UNAUTHENTICATED
 *  2) 无效 Bearer token                      → 401 INVALID_SESSION
 *  3) 有效 Bearer + 不存在的 trackId         → 404 TRACK_NOT_FOUND
 *  4) 有效 Bearer + has_practice_mode=true   → 200 + signed midiUrl / musicXmlUrl
 *  5) 有效 Bearer + has_practice_mode=false  → 403 PRACTICE_NOT_ENABLED
 *
 * 直接 import handler 在内存里 invoke，无需起 Netlify dev。
 *
 * Usage:
 *   tsx scripts/verify-practice-broker-auth.ts
 *
 *   可选 env:
 *     PRACTICE_VERIFY_TRACK_ID_ENABLED   has_practice_mode=true 的真实 song uuid
 *     PRACTICE_VERIFY_TRACK_ID_DISABLED  has_practice_mode=false 的真实 song uuid
 *   未提供时，脚本会自动从 `songs` 表里挑两条（按 has_practice_mode 分别取一条）。
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
  const res = (await handler(full, {} as never, () => undefined)) as unknown as Resp;
  return res;
}

function pretty(label: string, res: Resp) {
  console.log(`\n--- ${label} ---`);
  console.log('  HTTP', res.statusCode);
  try {
    const body = JSON.parse(res.body) as Record<string, unknown>;
    /** 截断 signedUrl，避免控制台噪声 */
    if (typeof body.midiUrl === 'string') {
      body.midiUrl = `${body.midiUrl.slice(0, 80)}…`;
    }
    if (typeof body.musicXmlUrl === 'string') {
      body.musicXmlUrl = `${body.musicXmlUrl.slice(0, 80)}…`;
    }
    console.log('  body', body);
  } catch {
    console.log('  body(raw)', res.body);
  }
}

async function ensureUser(email: string, password: string): Promise<{userId: string; accessToken: string}> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {auth: {persistSession: false}});
  const list = await admin.auth.admin.listUsers({page: 1, perPage: 200});
  const existing = list.data?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
  let userId = existing?.id;
  if (!userId) {
    const created = await admin.auth.admin.createUser({email, password, email_confirm: true});
    if (created.error || !created.data.user) {
      throw new Error(`createUser failed: ${created.error?.message}`);
    }
    userId = created.data.user.id;
  } else {
    await admin.auth.admin.updateUserById(userId, {password, email_confirm: true});
  }
  const anon = createClient(SUPABASE_URL, ANON_KEY, {auth: {persistSession: false}});
  const sign = await anon.auth.signInWithPassword({email, password});
  if (sign.error || !sign.data.session) throw new Error(`signIn failed: ${sign.error?.message}`);
  return {userId, accessToken: sign.data.session.access_token};
}

async function pickRealTrackId(enabled: boolean): Promise<string | null> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {auth: {persistSession: false}});
  const res = await admin
    .from('songs')
    .select('id, has_practice_mode')
    .eq('has_practice_mode', enabled)
    .not('id', 'is', null)
    .limit(1);
  return res.data?.[0]?.id ?? null;
}

(async () => {
  console.log('# practice-asset-url Phase C broker verification');

  /** 1) anonymous */
  const anon = await invoke({headers: {}, body: JSON.stringify({trackId: '11111111-1111-1111-1111-111111111111'})});
  pretty('anonymous (no Authorization)', anon);
  if (anon.statusCode !== 401) {
    console.log('FAIL: anonymous expected 401');
    process.exit(1);
  }

  /** 2) invalid token */
  const bad = await invoke({
    headers: {authorization: 'Bearer invalid-token-xyz'},
    body: JSON.stringify({trackId: '11111111-1111-1111-1111-111111111111'}),
  });
  pretty('invalid Bearer', bad);
  if (bad.statusCode !== 401) {
    console.log('FAIL: invalid Bearer expected 401');
    process.exit(1);
  }

  /** 3) valid Bearer + non-existent (well-formed) trackId */
  const email = 'phase-c-verify@example.com';
  const password = 'StrongPass!12345';
  const {userId, accessToken} = await ensureUser(email, password);
  console.log('\n  Real signed-in userId =', userId);
  const noSuch = await invoke({
    headers: {authorization: `Bearer ${accessToken}`},
    body: JSON.stringify({trackId: '00000000-0000-0000-0000-000000000000'}),
  });
  pretty('valid Bearer + non-existent trackId', noSuch);
  if (noSuch.statusCode !== 404) {
    console.log('FAIL: non-existent trackId expected 404');
    process.exit(1);
  }

  /** 4) valid Bearer + real has_practice_mode=true trackId */
  const trackEnabled =
    process.env.PRACTICE_VERIFY_TRACK_ID_ENABLED?.trim() || (await pickRealTrackId(true));
  if (!trackEnabled) {
    console.log('SKIP: no song row with has_practice_mode=true; cannot test happy path');
  } else {
    console.log('\n  Using has_practice_mode=true trackId =', trackEnabled);
    const ok = await invoke({
      headers: {authorization: `Bearer ${accessToken}`},
      body: JSON.stringify({trackId: trackEnabled}),
    });
    pretty('valid Bearer + has_practice_mode=true trackId', ok);
    if (ok.statusCode !== 200) {
      console.log('FAIL: enabled trackId expected 200');
      process.exit(1);
    }
    const parsed = JSON.parse(ok.body) as Record<string, unknown>;
    const hasMidi = typeof parsed.midiUrl === 'string' && (parsed.midiUrl as string).includes('/object/sign/');
    const hasXml = typeof parsed.musicXmlUrl === 'string' && (parsed.musicXmlUrl as string).includes('/object/sign/');
    if (!hasMidi || !hasXml) {
      console.log('FAIL: expected /object/sign/ signed URLs in midiUrl/musicXmlUrl');
      process.exit(1);
    }
  }

  /** 5) valid Bearer + has_practice_mode=false trackId */
  const trackDisabled =
    process.env.PRACTICE_VERIFY_TRACK_ID_DISABLED?.trim() || (await pickRealTrackId(false));
  if (!trackDisabled) {
    console.log('\nSKIP: no song row with has_practice_mode=false; cannot test 403 path');
  } else {
    console.log('\n  Using has_practice_mode=false trackId =', trackDisabled);
    const denied = await invoke({
      headers: {authorization: `Bearer ${accessToken}`},
      body: JSON.stringify({trackId: trackDisabled}),
    });
    pretty('valid Bearer + has_practice_mode=false trackId', denied);
    if (denied.statusCode !== 403) {
      console.log('FAIL: disabled trackId expected 403');
      process.exit(1);
    }
  }

  console.log('\nPASS: practice-asset-url broker authentication and entitlement contracts verified.');
  process.exit(0);
})().catch(err => {
  console.error('verify failed:', err);
  process.exit(1);
});
