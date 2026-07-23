import assert from 'node:assert/strict';
import test from 'node:test';
import {createReadMembershipHandler} from '../../netlify/functions/read-membership';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const future = new Date(Date.now() + 86_400_000).toISOString();
const yesterday = new Date(Date.now() - 86_400_000).toISOString();

function fakeClient(legacy: Record<string, unknown> | null, apple: unknown, authenticated = true) {
  let queriedUserId: string | null = null;
  const client = {
    auth: {getUser: async () => authenticated ? {data: {user: {id: userId}}, error: null} : {data: {user: null}, error: {message: 'bad'}}},
    from: () => ({select: () => ({eq: (_column: string, value: string) => {
      queriedUserId = value;
      return {limit: () => ({maybeSingle: async () => ({data: legacy, error: null})})};
    }})}),
    rpc: async (_name: string, args: {p_user_id: string}) => {
      assert.equal(args.p_user_id, queriedUserId);
      return apple;
    },
  };
  return client;
}

async function invoke(client: any, body: Record<string, unknown> = {}) {
  const prior = {...process.env};
  Object.assign(process.env, {SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test'});
  try {
    const response = await createReadMembershipHandler({createClient: () => client as any})({
      httpMethod: 'POST', headers: {authorization: 'Bearer test'}, body: JSON.stringify(body),
    } as any, {} as any);
    assert.ok(response);
    return {response, payload: JSON.parse(response.body)};
  } finally { process.env = prior; }
}

test('handler aggregates only the authenticated user and never leaks Apple evidence', async () => {
  const {response, payload} = await invoke(fakeClient(null, {data: [{environment: 'production', currently_grants_premium: true, valid_until: future}], error: null}), {user_id: otherUserId});
  assert.equal(response.statusCode, 200); assert.equal(payload.userId, userId); assert.equal(payload.isPremium, true);
  assert.doesNotMatch(response.body, /transaction|signed|jws|appAccountToken/i);
});

test('handler keeps sandbox diagnostic separate and preserves legacy when Apple RPC fails', async () => {
  const sandbox = await invoke(fakeClient(null, {data: [{environment: 'sandbox', currently_grants_premium: true, valid_until: future}], error: null}));
  assert.equal(sandbox.payload.isPremium, false); assert.equal(sandbox.payload.appleSandboxVerified, true);
  const legacy = await invoke(fakeClient({premium_until: future, membership_status: 'premium', auto_renew: false, current_period_end: future}, {data: null, error: {message: 'missing rpc'}}));
  assert.equal(legacy.payload.isPremium, true);
});

test('handler never revives expired legacy status and rejects unauthenticated callers', async () => {
  const expired = await invoke(fakeClient({premium_until: yesterday, membership_status: 'active', auto_renew: false, current_period_end: yesterday}, {data: [], error: null}));
  assert.equal(expired.payload.isPremium, false);
  const prior = {...process.env}; Object.assign(process.env, {SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test'});
  try {
    const response = await createReadMembershipHandler({createClient: () => fakeClient(null, {data: [], error: null}, false) as any})({httpMethod: 'POST', headers: {authorization: 'Bearer test'}, body: '{}'} as any, {} as any);
    assert.ok(response);
    assert.equal(response.statusCode, 401);
  } finally { process.env = prior; }
});
