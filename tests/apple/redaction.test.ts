import test from 'node:test';
import assert from 'node:assert/strict';
import {safeLogFields} from '../../netlify/functions/_shared/apple/redaction';

test('logs redact JWS, receipt, transaction id, UUID and secret fields', () => {
  const raw = 'do-not-log-this-value';
  const result = safeLogFields({signedPayload: raw, receipt: raw, transactionId: raw, userUuid: raw, privateKey: raw, code: 'OK'});
  assert.equal(result.code, 'OK');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(raw));
});
