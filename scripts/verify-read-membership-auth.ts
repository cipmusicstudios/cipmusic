/**
 * 上线前实证脚本：直接调用 netlify/functions/read-membership.ts 的 handler（新版），
 * 用真实 Supabase 环境 + 一次性测试账号验证两个关键场景：
 *
 *   1. 匿名请求（无 Authorization 头） → 预期 HTTP 401 UNAUTHENTICATED
 *   2. 有效 JWT + body.userId 伪造成其他 UUID → 预期返回 JWT 对应账号的 membership，
 *      而不是 body 里那个 UUID。
 *
 * 说明：线上 cipmusic.com 目前仍是旧版函数（信任 body.userId），因此必须在本地直接
 * 调用新 handler 源码才能证明新逻辑；curl 线上暂时无法测新版。
 *
 * 用法：
 *   tsx scripts/verify-read-membership-auth.ts
 * 依赖：SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_ANON_KEY
 * （自动回退到 VITE_SUPABASE_URL）
 */
import 'dotenv/config';
import {createClient} from '@supabase/supabase-js';
import {handler} from '../netlify/functions/read-membership.ts';
import type {HandlerEvent, HandlerResponse} from '@netlify/functions';

function normalizeEnv() {
  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  }
}

function makeEvent(opts: {
  headers?: Record<string, string>;
  body?: unknown;
  method?: string;
}): HandlerEvent {
  return {
    httpMethod: opts.method ?? 'POST',
    headers: opts.headers ?? {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    path: '/.netlify/functions/read-membership',
    body: opts.body == null ? null : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
    isBase64Encoded: false,
    rawUrl: 'http://local/.netlify/functions/read-membership',
    rawQuery: '',
  } as unknown as HandlerEvent;
}

async function invoke(event: HandlerEvent) {
  const res = (await handler(event, {} as never, () => {})) as HandlerResponse;
  const parsed = typeof res.body === 'string' && res.body ? JSON.parse(res.body) : null;
  return {status: res.statusCode, body: parsed};
}

function header(line: string) {
  console.log(`\n${'='.repeat(72)}\n${line}\n${'='.repeat(72)}`);
}

async function main() {
  normalizeEnv();
  const url = (process.env.SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !serviceKey || !anonKey) {
    console.error('[verify] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY');
    process.exit(1);
  }

  header('Test 1 · 匿名请求（没有 Authorization 头）');
  const anon = await invoke(makeEvent({body: {}}));
  console.log(`HTTP ${anon.status}`);
  console.log(JSON.stringify(anon.body, null, 2));

  header('Test 2 准备 · 创建一次性测试用户 + 种入独有的 user_membership 行');
  const admin = createClient(url, serviceKey, {auth: {persistSession: false, autoRefreshToken: false}});
  const anonClient = createClient(url, anonKey, {auth: {persistSession: false, autoRefreshToken: false}});

  const testEmail = `verify-read-membership-${Date.now()}@example.invalid`;
  const testPassword = `PW-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const uniquePremiumUntil = '2099-04-19T12:34:56.000Z';
  const uniqueProvider = `verify-${Date.now()}`;

  const created = await admin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });
  if (created.error || !created.data?.user?.id) {
    console.error('[verify] admin.createUser failed:', created.error);
    process.exit(1);
  }
  const realUserId = created.data.user.id;
  console.log('realUserId (来自 auth.users, JWT 稍后将解析到它):', realUserId);

  const seed = await admin.from('user_membership').upsert(
    {
      user_id: realUserId,
      premium_until: uniquePremiumUntil,
      membership_status: 'premium',
      payment_provider: uniqueProvider,
      last_payment_at: '2026-01-01T00:00:00Z',
    },
    {onConflict: 'user_id'},
  );
  if (seed.error) {
    console.error('[verify] seed user_membership failed:', seed.error);
    await admin.auth.admin.deleteUser(realUserId).catch(() => void 0);
    process.exit(1);
  }
  console.log('seeded user_membership.premium_until =', uniquePremiumUntil);
  console.log('seeded user_membership.payment_provider =', uniqueProvider);

  const signedIn = await anonClient.auth.signInWithPassword({email: testEmail, password: testPassword});
  if (signedIn.error || !signedIn.data?.session?.access_token) {
    console.error('[verify] signInWithPassword failed:', signedIn.error);
    await admin.from('user_membership').delete().eq('user_id', realUserId).catch(() => void 0);
    await admin.auth.admin.deleteUser(realUserId).catch(() => void 0);
    process.exit(1);
  }
  const accessToken = signedIn.data.session.access_token;

  const fakeUuid = '00000000-0000-0000-0000-000000000000';
  header('Test 2 · 有效 JWT + body.userId 伪造为 ' + fakeUuid);
  const authed = await invoke(
    makeEvent({
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: {userId: fakeUuid},
    }),
  );
  console.log(`HTTP ${authed.status}`);
  console.log(JSON.stringify(authed.body, null, 2));

  header('断言');
  const okStatus = authed.status === 200;
  const okFlag = authed.body?.ok === true;
  /**
   * premium_until 以 timestamptz 回传，PG 会规范化为 `+00:00`（不带 `.000Z`），
   * 语义等价但字符串不同；这里按毫秒时间值比较，避免格式差异误报。
   */
  const premiumMatches = (() => {
    const want = Date.parse(uniquePremiumUntil);
    const got = Date.parse(authed.body?.premiumUntil ?? '');
    return Number.isFinite(want) && Number.isFinite(got) && want === got;
  })();
  const matchesSeededRow = premiumMatches && authed.body?.paymentProvider === uniqueProvider;
  const fakeUuidNotLeaked =
    !(authed.body && typeof authed.body === 'object' && JSON.stringify(authed.body).includes(fakeUuid));
  console.log('HTTP 200?             ', okStatus);
  console.log('ok:true?              ', okFlag);
  console.log('返回的是 seeded 行?   ', matchesSeededRow,
    '(期望 premiumUntil =', uniquePremiumUntil, ', paymentProvider =', uniqueProvider, ')');
  console.log('响应里不含伪造 UUID?  ', fakeUuidNotLeaked);
  console.log('Test 1 HTTP 401?      ', anon.status === 401);
  console.log('Test 1 code=UNAUTHENTICATED? ', anon.body?.code === 'UNAUTHENTICATED');

  header('清理一次性测试账号');
  const delRow = await admin.from('user_membership').delete().eq('user_id', realUserId);
  console.log('delete user_membership row error:', delRow.error?.message ?? null);
  const delUser = await admin.auth.admin.deleteUser(realUserId);
  console.log('delete auth user error:', delUser.error?.message ?? null);

  const allPass =
    anon.status === 401 &&
    anon.body?.code === 'UNAUTHENTICATED' &&
    okStatus &&
    okFlag &&
    matchesSeededRow &&
    fakeUuidNotLeaked;
  console.log(`\n总体结果: ${allPass ? 'PASS' : 'FAIL'}`);
  process.exit(allPass ? 0 : 2);
}

void main();
