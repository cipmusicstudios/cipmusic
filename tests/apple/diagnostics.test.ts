import test from 'node:test';
import assert from 'node:assert/strict';
import {appleExceptionFields, logAppleDiagnostic} from '../../netlify/functions/_shared/apple/diagnostics';

test('Apple exception diagnostics retain safe SDK metadata', () => {
  class APIException extends Error {
    httpStatusCode = 401;
    apiError = 4010000;
    code = 'APPLE_AUTH';
  }
  const fields = appleExceptionFields(new APIException('Authentication failed'));
  assert.deepEqual(fields, {
    exceptionType: 'APIException', httpStatus: 401, apiError: 4010000,
    errorCode: 'APPLE_AUTH', message: 'Authentication failed',
  });
});

test('Apple diagnostics redact credentials and transaction URL identifiers', () => {
  const secret = 'eyJheader.payload.signature';
  const transactionId = '2000001234567890';
  const error = new Error(`Bearer user-token ${secret} /transactions/${transactionId}`);
  const fields = appleExceptionFields(error);
  const serialized = JSON.stringify(fields);
  assert.doesNotMatch(serialized, /user-token/);
  assert.doesNotMatch(serialized, new RegExp(transactionId));
  assert.doesNotMatch(serialized, /eyJheader/);
});

test('diagnostic logger never emits sensitive-key field values', () => {
  const original = console.warn;
  const calls: unknown[][] = [];
  console.warn = (...args: unknown[]) => { calls.push(args); };
  try {
    logAppleDiagnostic('warn', 'lookup_failed', {
      transactionId: 'do-not-log', authorization: 'Bearer do-not-log', privateKey: 'do-not-log',
      httpStatus: 403,
    });
  } finally { console.warn = original; }
  const serialized = JSON.stringify(calls);
  assert.doesNotMatch(serialized, /do-not-log/);
  assert.match(serialized, /403/);
});
