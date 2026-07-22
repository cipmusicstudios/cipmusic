import assert from 'node:assert/strict';
import test from 'node:test';
import {loadAppleRootCertificates} from '../../netlify/functions/_shared/apple/config';
import {AppleServiceError} from '../../netlify/functions/_shared/apple/types';

test('production certificate loading fails closed when no Apple roots are installed', () => {
  assert.throws(
    () => loadAppleRootCertificates(),
    (error: unknown) => error instanceof AppleServiceError
      && error.code === 'APPLE_ROOT_CA_MISSING'
      && error.status === 503,
  );
});
