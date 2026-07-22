import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationHandler} from '../../netlify/functions/_shared/apple/notification-handler';

const fakeSupabase = {} as any;
const event = {httpMethod: 'POST', headers: {}, body: JSON.stringify({signedPayload: 'a.b.c'})} as any;
const closed = {appleVerificationEnabled: false, appleLedgerWriteEnabled: false,
  appleMembershipWritebackEnabled: false, aggregateMode: 'off' as const, legacyProtectionEnabled: false};
const open = {...closed, appleVerificationEnabled: true, appleLedgerWriteEnabled: true};

function installEnv() {
  Object.assign(process.env, {APP_STORE_ISSUER_ID: 'issuer', APP_STORE_KEY_ID: 'key',
    APP_STORE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----',
    APP_STORE_BUNDLE_ID: 'com.cipmusic.aurasounds', APP_STORE_APP_ID: '6767718789',
    APP_STORE_ENVIRONMENT: 'production'});
}

test('notification flags off call neither verifier nor inbox', async () => {
  let verified = 0; let persisted = 0;
  const handler = createNotificationHandler('production', {supabase: fakeSupabase,
    readControls: async () => closed, verifier: {verifyTransaction: async () => ({}),
      verifyNotification: async () => { verified++; return {}; }, verifyRenewal: async () => ({})},
    persistInbox: async () => { persisted++; return {duplicate: false}; }});
  const response = await handler(event);
  assert.equal(response.statusCode, 503); assert.equal(verified, 0); assert.equal(persisted, 0);
});

test('notification environment mismatch is rejected before inbox', async () => {
  installEnv(); let persisted = 0;
  const handler = createNotificationHandler('production', {supabase: fakeSupabase,
    readControls: async () => open, verifier: {verifyTransaction: async () => ({}),
      verifyRenewal: async () => ({}),
      verifyNotification: async () => ({notificationUUID: '11111111-1111-4111-8111-111111111111',
        notificationType: 'TEST', signedDate: Date.now(), data: {environment: 'Sandbox',
          bundleId: 'com.cipmusic.aurasounds', appAppleId: 6767718789}})},
    persistInbox: async () => { persisted++; return {duplicate: false}; }});
  const response = await handler(event);
  assert.equal(response.statusCode, 400); assert.equal(persisted, 0);
});

test('notification duplicate returns idempotent 200', async () => {
  installEnv();
  const handler = createNotificationHandler('production', {supabase: fakeSupabase,
    readControls: async () => open, verifier: {verifyTransaction: async () => ({}),
      verifyRenewal: async () => ({}),
      verifyNotification: async () => ({notificationUUID: '11111111-1111-4111-8111-111111111111',
        notificationType: 'TEST', signedDate: Date.now(), data: {environment: 'Production',
          bundleId: 'com.cipmusic.aurasounds', appAppleId: 6767718789}})},
    persistInbox: async () => ({duplicate: true})});
  const response = await handler(event);
  assert.equal(response.statusCode, 200); assert.match(response.body, /"duplicate":true/);
});

test('oversized signed payload returns 413 before verification', async () => {
  const handler = createNotificationHandler('production', {supabase: fakeSupabase});
  const response = await handler({httpMethod: 'POST', headers: {},
    body: JSON.stringify({signedPayload: 'x'.repeat(131001)})} as any);
  assert.equal(response.statusCode, 413);
  assert.match(response.body, /BODY_TOO_LARGE/);
});
