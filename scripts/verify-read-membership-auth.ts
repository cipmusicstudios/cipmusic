/**
 * Phase B 验证脚本：调用 read-membership Netlify Function handler，确认：
 *
 *  1) 匿名（无 Authorization header）→ 401 UNAUTHENTICATED
 *  2) 无效 Bearer token       → 401 INVALID_SESSION
 *  3) 有效 Bearer token + body 伪造 userId
 *     → 仍然只返回 JWT 对应用户自己的 membership（forged userId 被忽略）
 *
 * 不需要本地起 Netlify dev；直接 import handler 在内存里 invoke。
 *
 * Usage:
 *   tsx scripts/verify-read-membership-auth.ts
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

const {handler} = await import('../netlify/functions/read-membership.ts');

type Resp = {statusCode: number; body: string};

async function invoke(event: Partial<HandlerEvent>): Promise<Resp> {
  const full: HandlerEvent = {
    httpMethod: 'POST',
    headers: {},
    body: '{}',
    rawUrl: '',
    rawQuery: '',
    path: '/.netlify/functions/read-membership',
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
    console.log('  body', JSON.parse(res.body));
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

(async () => {
  console.log('# read-membership Phase B JWT verification');

  /** 1) anonymous */
  const anon = await invoke({headers: {}, body: '{}'});
  pretty('anonymous (no Authorization)', anon);

  /** 2) invalid token */
  const bad = await invoke({headers: {authorization: 'Bearer invalid-token-xyz'}, body: '{}'});
  pretty('invalid Bearer', bad);

  /** 3) valid token + forged body.userId */
  const email = 'phase-b-verify@example.com';
  const password = 'StrongPass!12345';
  const {userId, accessToken} = await ensureUser(email, password);
  console.log('\n  Real signed-in userId =', userId);
  const forgedBody = JSON.stringify({userId: '00000000-0000-0000-0000-000000000000'});
  const ok = await invoke({headers: {authorization: `Bearer ${accessToken}`}, body: forgedBody});
  pretty('valid token + forged body.userId', ok);

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(ok.body) as Record<string, unknown>;
  } catch {
    /** ignore */
  }
  const returnedUserId = parsed.userId;
  if (ok.statusCode === 200 && returnedUserId === userId) {
    console.log('\nPASS: response userId matches JWT user, forged body.userId IGNORED.');
    process.exit(0);
  }
  console.log('\nFAIL: expected response userId to match JWT user.');
  process.exit(1);
})().catch(err => {
  console.error('verify failed:', err);
  process.exit(1);
});
