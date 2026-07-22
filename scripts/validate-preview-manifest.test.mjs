import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validatePreviewManifest } from './validate-preview-manifest.mjs';

function validTrack(id = 'track-1') {
  return {
    id,
    title: 'Public track',
    displayTitle: 'Public track',
    originalArtist: 'Public artist',
    tags: ['Originals'],
    categoryKeys: ['originals'],
    coverUrl: 'https://img.youtube.com/vi/public/default.jpg',
    mp3Url: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/songs/public/audio.mp3',
    duration: '03:00',
    hasPracticeMode: false,
    importSource: 'remote',
  };
}

function fixture(mutator = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cip-preview-manifest-'));
  const publicDir = path.join(root, 'public');
  fs.mkdirSync(publicDir);
  const catalog = {
    version: 5,
    kind: 'catalog',
    generatedAt: '2026-06-19T18:38:10.955Z',
    assetBaseUrl: '',
    trackTotal: 1,
    chunks: [{ path: 'songs-manifest-chunk-0.json', count: 1 }],
  };
  const chunk = { version: 5, kind: 'chunk', chunkIndex: 0, tracks: [validTrack()] };
  mutator({ catalog, chunk, publicDir });
  if (!fs.existsSync(path.join(publicDir, 'songs-manifest.json'))) {
    fs.writeFileSync(path.join(publicDir, 'songs-manifest.json'), `${JSON.stringify(catalog)}\n`);
  }
  if (!fs.existsSync(path.join(publicDir, 'songs-manifest-chunk-0.json'))) {
    fs.writeFileSync(path.join(publicDir, 'songs-manifest-chunk-0.json'), `${JSON.stringify(chunk)}\n`);
  }
  return root;
}

test('accepts a complete public metadata snapshot', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(validatePreviewManifest({ root }), {
    version: 5,
    generatedAt: '2026-06-19T18:38:10.955Z',
    trackTotal: 1,
    chunkTotal: 1,
  });
});

test('fails closed when catalog is missing', t => {
  const root = fixture(({ publicDir }) => fs.writeFileSync(path.join(publicDir, 'songs-manifest.json'), 'null'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.rmSync(path.join(root, 'public', 'songs-manifest.json'));
  assert.throws(() => validatePreviewManifest({ root }), /catalog is missing/);
});

test('fails closed when a chunk is malformed JSON', t => {
  const root = fixture(({ publicDir }) => fs.writeFileSync(path.join(publicDir, 'songs-manifest-chunk-0.json'), '{'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => validatePreviewManifest({ root }), /not valid JSON/);
});

test('fails closed when a referenced chunk is missing', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.rmSync(path.join(root, 'public', 'songs-manifest-chunk-0.json'));
  assert.throws(() => validatePreviewManifest({ root }), /chunk 0 is missing/);
});

test('rejects duplicate track ids with a per-chunk count check', t => {
  const root = fixture(({ catalog, chunk }) => {
    catalog.trackTotal = 2;
    catalog.chunks[0].count = 2;
    chunk.tracks.push(validTrack());
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => validatePreviewManifest({ root }), /duplicate track id/);
});

test('rejects private practice fields', t => {
  const root = fixture(({ chunk }) => { chunk.tracks[0].midiUrl = '/private/song.mid'; });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(
    () => validatePreviewManifest({ root }),
    /forbidden field midiUrl|forbidden private or credential-shaped content/,
  );
});

test('rejects signed URLs', t => {
  const root = fixture(({ chunk }) => { chunk.tracks[0].mp3Url += '?token=private'; });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => validatePreviewManifest({ root }), /credential-shaped|signed or credentialed/);
});

test('rejects non-allowlisted URL hosts', t => {
  const root = fixture(({ chunk }) => { chunk.tracks[0].coverUrl = 'https://private.example/cover.jpg'; });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => validatePreviewManifest({ root }), /not allowlisted/);
});

test('rejects catalog and chunk count mismatch', t => {
  const root = fixture(({ catalog }) => { catalog.trackTotal = 2; });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => validatePreviewManifest({ root }), /trackTotal/);
});

test('rejects a non-canonical generatedAt timestamp', t => {
  const root = fixture(({ catalog }) => { catalog.generatedAt = 'June 19, 2026'; });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => validatePreviewManifest({ root }), /canonical ISO-8601/);
});

test('rejects nested token hash fields', t => {
  const root = fixture(({ chunk }) => { chunk.tracks[0].metadata = { app_account_token_hash: 'not-public' }; });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => validatePreviewManifest({ root }), /forbidden field app_account_token_hash/);
});
