/**
 * Premium scenes broker 验证脚本：
 *   1) 匿名请求 -> 401
 *   2) basic 登录用户 -> 403 PREMIUM_REQUIRED
 *   3) premium 登录用户 -> 200 + R2 presigned URL（只验证签名格式，不访问真实 R2）
 *
 * 说明：
 * - 直接调用当前源码里的 `netlify/functions/scene-asset-url.ts` handler。
 * - 使用真实 Supabase 环境创建一次性测试用户。
 * - R2 presigned URL 生成本地完成，不要求当前机器具备真实 R2 凭证；脚本会注入
 *   临时测试用的假值，只验证 broker 已进入“真正签名 URL”分支。
 */
import 'dotenv/config';
import {createClient} from '@supabase/supabase-js';
import type {HandlerEvent, HandlerResponse} from '@netlify/functions';
import {handler} from '../netlify/functions/scene-asset-url.ts';

function normalizeEnv() {
  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  }
  process.env.CF_R2_ACCOUNT_ID ||= 'testaccount1234567890abcdef1234567890';
  process.env.CF_R2_ACCESS_KEY_ID ||= 'test-access-key';
  process.env.CF_R2_SECRET_ACCESS_KEY ||= 'test-secret-key';
  process.env.CF_R2_BUCKET ||= 'aurasounds-premium-scenes';
  process.env.CF_R2_SCENE_PREFIX ||= 'premium-scenes';
  process.env.CF_R2_SCENE_EXPIRES_SECONDS ||= '3600';
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
    path: '/.netlify/functions/scene-asset-url',
    body: opts.body == null ? null : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
    isBase64Encoded: false,
    rawUrl: 'http://local/.netlify/functions/scene-asset-url',
    rawQuery: '',
  } as unknown as HandlerEvent;
}

async function invoke(event: HandlerEvent) {
  const res = (await handler(event, {} as never, () => {})) as HandlerResponse;
  const parsed = typeof res.body === 'string' && res.body ? JSON.parse(res.body) : null;
  return {status: res.statusCode, body: parsed};
}

async function createUser(
  admin: ReturnType<typeof createClient>,
  anonClient: ReturnType<typeof createClient>,
  kind: 'basic' | 'premium',
) {
  const email = `verify-scene-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`;
  const password = `PW-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user?.id) {
    throw created.error ?? new Error(`createUser failed for ${kind}`);
  }
  const userId = created.data.user.id;
  if (kind === 'premium') {
    const seeded = await admin.from('user_membership').upsert(
      {
        user_id: userId,
        premium_until: '2099-04-19T12:34:56.000Z',
        membership_status: 'premium',
        payment_provider: 'verify-scene-broker',
        last_payment_at: '2026-01-01T00:00:00Z',
      },
      {onConflict: 'user_id'},
    );
    if (seeded.error) {
      await admin.auth.admin.deleteUser(userId).catch(() => void 0);
      throw seeded.error;
    }
  }
  const signedIn = await anonClient.auth.signInWithPassword({email, password});
  if (signedIn.error || !signedIn.data.session?.access_token) {
    await admin.from('user_membership').delete().eq('user_id', userId).catch(() => void 0);
    await admin.auth.admin.deleteUser(userId).catch(() => void 0);
    throw signedIn.error ?? new Error(`signIn failed for ${kind}`);
  }
  return {
    userId,
    accessToken: signedIn.data.session.access_token,
    async cleanup() {
      await admin.from('user_membership').delete().eq('user_id', userId).catch(() => void 0);
      await admin.auth.admin.deleteUser(userId).catch(() => void 0);
    },
  };
}

async function main() {
  normalizeEnv();
  const url = (process.env.SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !serviceKey || !anonKey) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY');
  }

  const admin = createClient(url, serviceKey, {auth: {persistSession: false, autoRefreshToken: false}});
  const anonClient = createClient(url, anonKey, {auth: {persistSession: false, autoRefreshToken: false}});

  const anonymous = await invoke(makeEvent({body: {sceneId: 'forestCafe'}}));
  console.log('anonymous:', JSON.stringify(anonymous, null, 2));

  const basic = await createUser(admin, anonClient, 'basic');
  const premium = await createUser(admin, anonClient, 'premium');

  try {
    const basicRes = await invoke(
      makeEvent({
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${basic.accessToken}`,
        },
        body: {sceneId: 'forestCafe'},
      }),
    );
    console.log('basic:', JSON.stringify(basicRes, null, 2));

    const premiumRes = await invoke(
      makeEvent({
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${premium.accessToken}`,
        },
        body: {sceneId: 'celestialDome'},
      }),
    );
    console.log('premium:', JSON.stringify(premiumRes, null, 2));

    const signedUrl = premiumRes.body?.url as string | undefined;
    const allPass =
      anonymous.status === 401 &&
      anonymous.body?.code === 'UNAUTHENTICATED' &&
      basicRes.status === 403 &&
      basicRes.body?.code === 'PREMIUM_REQUIRED' &&
      premiumRes.status === 200 &&
      premiumRes.body?.ok === true &&
      typeof signedUrl === 'string' &&
      signedUrl.includes('.r2.cloudflarestorage.com') &&
      signedUrl.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256') &&
      premiumRes.body?.accessMode === 'r2_presigned_get';

    console.log(`scene broker overall: ${allPass ? 'PASS' : 'FAIL'}`);
    process.exit(allPass ? 0 : 2);
  } finally {
    await basic.cleanup();
    await premium.cleanup();
  }
}

void main().catch(error => {
  console.error('[verify-scene-broker-auth]', error);
  process.exit(1);
});
