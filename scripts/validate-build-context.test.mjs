import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBuildContext } from './validate-build-context.mjs';

for (const [context, mode, isPreview] of [
  ['production', 'production-generated', false],
  ['deploy-preview', 'committed-preview-snapshot', true],
  ['branch-deploy', 'committed-preview-snapshot', true],
]) {
  test(`accepts ${context} + ${mode}`, () => {
    assert.equal(validateBuildContext({ CONTEXT: context, VITE_DEPLOY_CONTEXT: context, VITE_MANIFEST_MODE: mode }).isPreview, isPreview);
  });
}

for (const [context, mode] of [
  ['production', 'committed-preview-snapshot'],
  ['', 'committed-preview-snapshot'],
  ['deploy-preview', 'production-generated'],
  ['unknown', 'committed-preview-snapshot'],
]) {
  test(`rejects ${context || 'missing'} + ${mode}`, () => {
    assert.throws(() => validateBuildContext({ CONTEXT: context, VITE_DEPLOY_CONTEXT: context, VITE_MANIFEST_MODE: mode }), /invalid deploy context\/manifest mode combination/);
  });
}

test('allows an entirely unset local environment', () => {
  assert.equal(validateBuildContext({}).isPreview, false);
});

test('rejects a mismatch with Netlify CONTEXT', () => {
  assert.throws(
    () => validateBuildContext({ CONTEXT: 'production', VITE_DEPLOY_CONTEXT: 'deploy-preview', VITE_MANIFEST_MODE: 'committed-preview-snapshot' }),
    /Netlify context mismatch/,
  );
});
