import test from 'node:test';
import assert from 'node:assert/strict';
import {createVerifyHandler} from '../../netlify/functions/_shared/apple/verify-handler';
import type {RuntimeControls} from '../../netlify/functions/_shared/apple/runtime';

const userId = '11111111-1111-4111-8111-111111111111';
const fakeSupabase = {} as any;
const event = (body: unknown, auth = true) => ({
  httpMethod: 'POST', body: JSON.stringify(body), headers: auth ? {authorization: 'Bearer test'} : {},
} as any);
const controls = (verification: boolean, ledger = false): RuntimeControls => ({
  appleVerificationEnabled: verification, appleLedgerWriteEnabled: ledger,
  appleMembershipWritebackEnabled: false, aggregateMode: 'off', legacyProtectionEnabled: false,
});
const withEnv = async (fn: () => Promise<void>) => {
  const old = {...process.env};
  Object.assign(process.env, {APP_STORE_ISSUER_ID: 'issuer', APP_STORE_KEY_ID: 'key',
    APP_STORE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----',
    APP_STORE_BUNDLE_ID: 'com.cipmusic.aurasounds', APP_STORE_APP_ID: '6767718789',
    APP_STORE_ENVIRONMENT: 'production'});
  try { await fn(); } finally { process.env = old; }
};

test('CORS preflight exposes the required POST headers', async () => {
  const handler = createVerifyHandler({supabase: fakeSupabase});
  const response = await handler({httpMethod: 'OPTIONS', headers: {}, body: null} as any);
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers?.['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  assert.match(String(response.headers?.['Access-Control-Allow-Headers']), /Authorization/);
});

test('all flags off calls neither Apple nor ledger', async () => {
  let apple = 0; let writes = 0;
  const handler = createVerifyHandler({supabase: fakeSupabase, authenticate: async () => userId,
    readControls: async () => controls(false),
    verifier: {verifyTransaction: async () => { apple++; return {}; }, verifyNotification: async () => ({})},
    persist: async () => { writes++; return {bindingResult: '', duplicate: false}; }});
  const response = await handler(event({signedTransactionInfo: 'a.b.c'}));
  assert.equal(response.statusCode, 503); assert.equal(apple, 0); assert.equal(writes, 0);
});

test('invalid JWT is rejected', async () => {
  const handler = createVerifyHandler({supabase: fakeSupabase, authenticate: async () => null});
  assert.equal((await handler(event({transactionId: '1'}))).statusCode, 401);
});

test('client userId is rejected before verification', async () => {
  const handler = createVerifyHandler({supabase: fakeSupabase});
  const response = await handler(event({transactionId: '1', userId}));
  assert.equal(response.statusCode, 400); assert.match(response.body, /CLIENT_USER_ID_FORBIDDEN/);
});

test('missing Apple env fails closed after feature enable', async () => {
  const old = {...process.env};
  for (const key of Object.keys(process.env)) if (key.startsWith('APP_STORE_')) delete process.env[key];
  try {
    const handler = createVerifyHandler({supabase: fakeSupabase, authenticate: async () => userId,
      readControls: async () => controls(true)});
    const response = await handler(event({transactionId: '1'}));
    assert.equal(response.statusCode, 503); assert.match(response.body, /SERVICE_ENV_INCOMPLETE/);
  } finally { process.env = old; }
});

test('verification-only does not persist', async () => withEnv(async () => {
  let writes = 0;
  const handler = createVerifyHandler({supabase: fakeSupabase, authenticate: async () => userId,
    readControls: async () => controls(true, false), lookup: {lookup: async () => ({signedTransactionInfo: 'jws', environment: 'production'})},
    verifier: {verifyTransaction: async () => ({environment: 'Production', bundleId: 'com.cipmusic.aurasounds',
      productId: 'com.cipmusic.aurasounds.premium.monthly.v2', subscriptionGroupIdentifier: '22099193',
      transactionId: '1', originalTransactionId: 'o', signedDate: Date.now(), expiresDate: Date.now() + 10000}),
      verifyNotification: async () => ({})}, persist: async () => { writes++; return {bindingResult: '', duplicate: false}; }});
  const response = await handler(event({transactionId: '1'}));
  assert.equal(response.statusCode, 200); assert.match(response.body, /verification-only/); assert.equal(writes, 0);
}));

test('JWS and transactionId mismatch is rejected', async () => withEnv(async () => {
  const handler = createVerifyHandler({supabase: fakeSupabase, authenticate: async () => userId,
    readControls: async () => controls(true), verifier: {verifyNotification: async () => ({}), verifyTransaction: async () => ({
      environment: 'Production', bundleId: 'com.cipmusic.aurasounds', productId: 'com.cipmusic.aurasounds.premium.monthly.v2',
      subscriptionGroupIdentifier: '22099193', transactionId: 'actual', originalTransactionId: 'o', signedDate: Date.now(), expiresDate: Date.now() + 10000,
    })}});
  const response = await handler(event({signedTransactionInfo: 'jws', transactionId: 'different'}));
  assert.equal(response.statusCode, 400); assert.match(response.body, /TRANSACTION_ID_MISMATCH/);
}));
