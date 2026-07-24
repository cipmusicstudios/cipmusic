import assert from 'node:assert/strict';
import test from 'node:test';
import {createSceneAssetUrlHandler} from '../../netlify/functions/scene-asset-url';

const authenticatedUserId = '11111111-1111-4111-8111-111111111111';
const forgedUserId = '22222222-2222-4222-8222-222222222222';
const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

type LegacyRow = {
  premium_until: string | null;
  membership_status: string | null;
  auto_renew: boolean | null;
  current_period_end: string | null;
} | null;

function fakeClient(legacy: LegacyRow, appleResult: unknown) {
  const observed = {legacyUserId: null as string | null, rpcUserId: null as string | null};
  const client = {
    auth: {
      getUser: async () => ({data: {user: {id: authenticatedUserId}}, error: null}),
    },
    from: (table: string) => {
      assert.equal(table, 'user_membership');
      return {
        select: (columns: string) => {
          assert.equal(columns, 'premium_until, membership_status, auto_renew, current_period_end');
          return {
            eq: (column: string, value: string) => {
              assert.equal(column, 'user_id');
              observed.legacyUserId = value;
              return {
                limit: () => ({
                  maybeSingle: async () => ({data: legacy, error: null}),
                }),
              };
            },
          };
        },
      };
    },
    rpc: async (name: string, args: {p_user_id: string}) => {
      assert.equal(name, 'billing_get_current_entitlement_summary');
      observed.rpcUserId = args.p_user_id;
      if (appleResult instanceof Error) throw appleResult;
      return appleResult;
    },
  };
  return {client, observed};
}

async function invoke(
  legacy: LegacyRow,
  appleResult: unknown,
  body: Record<string, unknown> = {},
) {
  const prior = {...process.env};
  Object.assign(process.env, {
    SUPABASE_URL: 'https://example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    CF_R2_ACCOUNT_ID: 'account',
    CF_R2_ACCESS_KEY_ID: 'access',
    CF_R2_SECRET_ACCESS_KEY: 'secret',
    CF_R2_BUCKET: 'bucket',
  });
  const {client, observed} = fakeClient(legacy, appleResult);
  try {
    const response = await createSceneAssetUrlHandler({
      createClient: () => client as any,
      createSignedGetUrl: async objectKey => ({
        url: `https://assets.test/${objectKey}`,
        expiresAt: future,
      }),
      appleRpcTimeoutMs: 20,
    })(
      {
        httpMethod: 'POST',
        headers: {authorization: 'Bearer test'},
        body: JSON.stringify({
          sceneId: 'forestCafe',
          orientation: 'landscape',
          ...body,
        }),
      } as any,
      {} as any,
    );
    assert.ok(response);
    return {response, payload: JSON.parse(response.body), observed};
  } finally {
    process.env = prior;
  }
}

test('Apple Production active entitlement grants a Premium Scene URL', async () => {
  const result = await invoke(null, {
    data: [{environment: 'production', currently_grants_premium: true, valid_until: future}],
    error: null,
  });
  assert.equal(result.response.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.match(result.payload.url, /premium-scenes\/forest\.mp4$/);
});

test('Apple Sandbox entitlement never grants a Premium Scene URL', async () => {
  const result = await invoke(null, {
    data: [{environment: 'sandbox', currently_grants_premium: true, valid_until: future}],
    error: null,
  });
  assert.equal(result.response.statusCode, 403);
  assert.equal(result.payload.code, 'PREMIUM_REQUIRED');
});

test('expired or revoked Apple entitlement does not grant a Premium Scene URL', async () => {
  for (const validUntil of [past, null]) {
    const result = await invoke(null, {
      data: [{environment: 'production', currently_grants_premium: false, valid_until: validUntil}],
      error: null,
    });
    assert.equal(result.response.statusCode, 403);
    assert.equal(result.payload.code, 'PREMIUM_REQUIRED');
  }
});

test('Stripe or ZPay legacy membership still grants a Premium Scene URL', async () => {
  for (const membershipStatus of ['stripe_subscription_active', 'premium']) {
    const result = await invoke(
      {
        premium_until: future,
        membership_status: membershipStatus,
        auto_renew: membershipStatus === 'stripe_subscription_active',
        current_period_end: future,
      },
      {data: [], error: null},
    );
    assert.equal(result.response.statusCode, 200, membershipStatus);
  }
});

test('a user without membership is denied a Premium Scene URL', async () => {
  const result = await invoke(null, {data: [], error: null});
  assert.equal(result.response.statusCode, 403);
  assert.equal(result.payload.code, 'PREMIUM_REQUIRED');
});

test('a forged body userId cannot replace the authenticated JWT user', async () => {
  const result = await invoke(
    null,
    {
      data: [{environment: 'production', currently_grants_premium: true, valid_until: future}],
      error: null,
    },
    {userId: forgedUserId},
  );
  assert.equal(result.response.statusCode, 200);
  assert.equal(result.observed.legacyUserId, authenticatedUserId);
  assert.equal(result.observed.rpcUserId, authenticatedUserId);
  assert.notEqual(result.observed.rpcUserId, forgedUserId);
});

test('aggregate RPC error fails closed for an Apple-only user', async () => {
  const result = await invoke(null, {data: null, error: {message: 'rpc unavailable'}});
  assert.equal(result.response.statusCode, 403);
  assert.equal(result.payload.code, 'PREMIUM_REQUIRED');

  const rejected = await invoke(null, new Error('private rpc rejection'));
  assert.equal(rejected.response.statusCode, 403);
  assert.equal(rejected.payload.code, 'PREMIUM_REQUIRED');
  assert.doesNotMatch(rejected.response.body, /private rpc rejection|billing_get_current/i);
});
