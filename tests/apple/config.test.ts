import assert from 'node:assert/strict';
import test from 'node:test';
import {loadAppleRootCertificates} from '../../netlify/functions/_shared/apple/config';

test('production certificate loading includes the bundled Apple root certificates', () => {
  const roots = loadAppleRootCertificates();

  assert.equal(roots.length, 3);
  assert.ok(roots.every(root => Buffer.isBuffer(root) && root.length > 0));
});
