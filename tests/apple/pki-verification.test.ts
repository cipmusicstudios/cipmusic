import assert from 'node:assert/strict';
import test from 'node:test';
import {Environment, SignedDataVerifier, VerificationException} from '@apple/app-store-server-library';
import {assertAppleJwsHeader} from '../../netlify/functions/_shared/apple/verifier';
import {AppleServiceError} from '../../netlify/functions/_shared/apple/types';
import {createPkiFixture} from './pki-fixtures';

test('official Apple verifier validates an injected x5c ES256 test chain', async t => {
  const fixture = createPkiFixture();
  t.after(fixture.cleanup);
  const verifier = new SignedDataVerifier(
    [fixture.root], false, Environment.SANDBOX, 'com.cipmusic.aurasounds',
  );
  assertAppleJwsHeader(fixture.validJws);
  const decoded = await verifier.verifyAndDecodeTransaction(fixture.validJws);
  assert.equal(decoded.transactionId, 'pki-transaction');
  assert.equal(decoded.environment, Environment.SANDBOX);

  await assert.rejects(
    new SignedDataVerifier([fixture.wrongRoot], false, Environment.SANDBOX, 'com.cipmusic.aurasounds')
      .verifyAndDecodeTransaction(fixture.wrongRootJws),
    VerificationException,
  );
  await assert.rejects(verifier.verifyAndDecodeTransaction(fixture.expiredLeafJws), VerificationException);
  await assert.rejects(verifier.verifyAndDecodeTransaction(fixture.tamperedPayloadJws), VerificationException);
  assert.throws(
    () => assertAppleJwsHeader(fixture.wrongAlgorithmJws),
    (error: unknown) => error instanceof AppleServiceError && error.code === 'APPLE_JWS_ALGORITHM_INVALID',
  );
});
