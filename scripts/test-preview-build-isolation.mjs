#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sentinel = 'FORBIDDEN_PREVIEW_SENTINEL';
const preload = path.join(root, 'scripts', 'deny-preview-network.cjs');

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function manifestHashes(base) {
  return new Map(
    fs.readdirSync(base)
      .filter(name => /^songs-manifest(?:-chunk-\d+)?\.json$/.test(name))
      .sort()
      .map(name => [name, hash(path.join(base, name))]),
  );
}

function scanTree(dir, needle) {
  const hits = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) hits.push(...scanTree(file, needle));
    else if (fs.readFileSync(file).includes(Buffer.from(needle))) hits.push(path.relative(root, file));
  }
  return hits;
}

const sentinelVariants = [
  sentinel,
  sentinel.toLowerCase(),
  sentinel.toUpperCase(),
  encodeURIComponent(sentinel),
  Buffer.from(sentinel).toString('base64'),
  [...sentinel].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''),
];

function scanPreviewArtifacts(dir) {
  const failures = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      failures.push(...scanPreviewArtifacts(file));
      continue;
    }
    const body = fs.readFileSync(file, 'utf8');
    const relative = path.relative(root, file);
    const forbidden = [
      ['service-role variable', /SUPABASE_SERVICE_ROLE_KEY/],
      ['Google API key-shaped value', /AIza[0-9A-Za-z_-]{20,}/],
      ['signed/private URL', /https?:\/\/[^\s"'`]+(?:x-amz-signature|\/storage\/v1\/object\/(?:sign|authenticated|private)\/)[^\s"'`]*/i],
      ['MIDI/MusicXML URL', /https?:\/\/[^\s"'`]+\.(?:mid|midi|musicxml|mxl)(?:\?[^\s"'`]*)?/i],
      ['private key value', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{64,}\r?\n-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ];
    for (const [label, pattern] of forbidden) {
      if (pattern.test(body)) failures.push(`${relative}: ${label}`);
    }
    for (const match of body.matchAll(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g)) {
      try {
        const payload = JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url').toString('utf8'));
        if (payload.role === 'service_role' || payload.user_role === 'service_role') {
          failures.push(`${relative}: service-role JWT`);
        }
      } catch {
        failures.push(`${relative}: undecodable JWT-shaped value`);
      }
    }
  }
  return failures;
}

const netlifyConfig = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
assert.match(netlifyConfig, /\[build\][\s\S]*?command = "npm run build"/);
for (const context of ['deploy-preview', 'branch-deploy']) {
  assert.match(netlifyConfig, new RegExp(`\\[context\\.${context}\\][\\s\\S]*?command = "npm run build:preview"`));
  assert.match(netlifyConfig, new RegExp(`\\[context\\.${context}\\.environment\\][\\s\\S]*?VITE_MANIFEST_MODE = "committed-preview-snapshot"`));
  assert.match(netlifyConfig, new RegExp(`\\[context\\.${context}\\.environment\\][\\s\\S]*?VITE_DEPLOY_CONTEXT = "${context}"`));
}
assert.match(netlifyConfig, /\[context\.production\.environment\][\s\S]*?VITE_DEPLOY_CONTEXT = "production"[\s\S]*?VITE_MANIFEST_MODE = "production-generated"/);

const sourceHashes = manifestHashes(path.join(root, 'public'));
for (const context of ['deploy-preview', 'branch-deploy']) {
  fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
  const env = { ...process.env };
  delete env.SUPABASE_URL;
  env.VITE_SUPABASE_URL = 'https://forbidden-preview.invalid';
  env.CONTEXT = context;
  env.VITE_DEPLOY_CONTEXT = context;
  env.NETLIFY = 'true';
  env.MANIFEST_SOURCE = 'production';
  env.SUPABASE_SERVICE_ROLE_KEY = sentinel;
  env.FAIL_IF_PRODUCTION_MANIFEST_BUILDER_RUNS = '1';
  env.VITE_MANIFEST_MODE = 'committed-preview-snapshot';
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : ''}--require=${JSON.stringify(preload)}`;
  const run = spawnSync('npm', ['run', 'build:preview'], { cwd: root, env, encoding: 'utf8' });
  const output = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.equal(run.status, 0, `${context} build failed:\n${output}`);
  assert.doesNotMatch(output, /build-songs-manifest|build:manifest|SUPABASE_SERVICE_ROLE_KEY|FORBIDDEN_PREVIEW_SENTINEL/);
  assert.deepEqual(manifestHashes(path.join(root, 'public')), sourceHashes, `${context} changed the committed snapshot`);
  assert.deepEqual(manifestHashes(path.join(root, 'dist')), sourceHashes, `${context} dist manifest differs from committed snapshot`);
  for (const variant of sentinelVariants) {
    assert.doesNotMatch(output, new RegExp(variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    assert.deepEqual(scanTree(path.join(root, 'dist'), variant), [], `${context} emitted an encoded service-role sentinel`);
  }
  assert.deepEqual(scanPreviewArtifacts(path.join(root, 'dist')), [], `${context} emitted private or credential data`);
  assert.match(fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8'), /assets\/index-/);
  assert.ok(
    fs.readdirSync(path.join(root, 'dist', 'assets')).some(name =>
      fs.readFileSync(path.join(root, 'dist', 'assets', name), 'utf8').includes('Preview catalog snapshot'),
    ),
    `${context} did not render the snapshot disclosure`,
  );
  const appSource = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  assert.match(appSource, /usesCommittedPreviewManifest && !immersiveMode/);
  assert.doesNotMatch(appSource, /preview-catalog-banner[\s\S]{0,300}\bfixed\b/);
  console.log(`[preview-build] ${context}: isolated snapshot build passed`);
}

const productionEnv = {
  ...process.env,
  CONTEXT: 'production',
  NETLIFY: 'true',
  MANIFEST_SOURCE: 'production',
  VITE_DEPLOY_CONTEXT: 'production',
  VITE_MANIFEST_MODE: 'production-generated',
};
delete productionEnv.SUPABASE_SERVICE_ROLE_KEY;
delete productionEnv.SUPABASE_URL;
delete productionEnv.VITE_SUPABASE_URL;
const production = spawnSync('npm', ['run', 'build'], { cwd: root, env: productionEnv, encoding: 'utf8' });
const productionOutput = `${production.stdout || ''}\n${production.stderr || ''}`;
assert.notEqual(production.status, 0, 'production build must fail closed without service-role credentials');
assert.match(productionOutput, /build:manifest/);
assert.match(productionOutput, /Missing Supabase service-role env vars for production manifest build/);
assert.doesNotMatch(productionOutput, /committed-preview-snapshot/);
console.log('[preview-build] production missing-credential fail-closed regression passed');

const invalidProduction = spawnSync('npm', ['run', 'build'], {
  cwd: root,
  env: {
    ...productionEnv,
    VITE_MANIFEST_MODE: 'committed-preview-snapshot',
    VITE_SUPABASE_URL: 'https://nonproduction-contract-test.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'NONSECRET_PRESENT_CREDENTIAL_CANARY',
    FAIL_IF_PRODUCTION_MANIFEST_BUILDER_RUNS: '1',
  },
  encoding: 'utf8',
});
const invalidOutput = `${invalidProduction.stdout || ''}\n${invalidProduction.stderr || ''}`;
assert.notEqual(invalidProduction.status, 0);
assert.match(invalidOutput, /invalid deploy context\/manifest mode combination/);
assert.doesNotMatch(invalidOutput, /Production manifest builder canary triggered/);
console.log('[preview-build] production preview-mode misconfiguration rejected before builder');

const canaryProduction = spawnSync('npm', ['run', 'build'], {
  cwd: root,
  env: { ...productionEnv, FAIL_IF_PRODUCTION_MANIFEST_BUILDER_RUNS: '1' },
  encoding: 'utf8',
});
const canaryOutput = `${canaryProduction.stdout || ''}\n${canaryProduction.stderr || ''}`;
assert.notEqual(canaryProduction.status, 0);
assert.match(canaryOutput, /Production manifest builder canary triggered/);
console.log('[preview-build] production builder canary control passed');
