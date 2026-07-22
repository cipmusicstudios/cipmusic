import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validatePreviewManifest } from './validate-preview-manifest.mjs';

const NOW = Date.parse('2026-07-22T00:00:00.000Z');

function validTrack(id = '550e8400-e29b-41d4-a716-446655440000', slug = '公开 曲目') {
  return {
    id, slug, title: '公开曲目', displayTitle: '公开曲目', originalArtist: '公开艺人',
    tags: ['原创'], categoryKeys: ['originals'],
    coverUrl: 'https://img.youtube.com/vi/public/default.jpg',
    mp3Url: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/songs/public/audio.mp3',
    youtubeVideoUrl: 'https://www.youtube.com/watch?v=public',
    duration: '03:00', hasPracticeMode: false, importSource: 'remote',
  };
}

function fixture({ tracks = [validTrack()], mutateCatalog, mutateChunk } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cip-preview-manifest-'));
  const publicDir = path.join(root, 'public'); fs.mkdirSync(publicDir);
  const chunk = { version: 5, kind: 'chunk', chunkIndex: 0, tracks };
  const catalog = { version: 5, kind: 'catalog', generatedAt: '2026-06-19T18:38:10.955Z', assetBaseUrl: '', trackTotal: tracks.length, chunks: [{ path: 'songs-manifest-chunk-0.json', count: tracks.length }] };
  mutateCatalog?.(catalog); mutateChunk?.(chunk);
  fs.writeFileSync(path.join(publicDir, 'songs-manifest.json'), `${JSON.stringify(catalog)}\n`);
  fs.writeFileSync(path.join(publicDir, 'songs-manifest-chunk-0.json'), `${JSON.stringify(chunk)}\n`);
  return { root, publicDir };
}

function validate(root, now = NOW) { return validatePreviewManifest({ root, now }); }
function cleanup(t, root) { t.after(() => fs.rmSync(root, { recursive: true, force: true })); }

test('accepts ordinary files, public URLs, Unicode, and public UUID identifiers', t => {
  const { root } = fixture(); cleanup(t, root);
  assert.equal(validate(root).trackTotal, 1);
});

for (const [name, value, pattern] of [
  ['protocol-relative', '//untrusted.invalid/a.mp3', /protocol-relative/],
  ['relative', '/audio/a.mp3', /invalid absolute URL/],
  ['userinfo', 'https://user:pass@hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/songs/a.mp3', /credentials/],
  ['non-default port', 'https://hngtwkayovuxhiqustsa.supabase.co:444/storage/v1/object/public/songs/a.mp3', /non-default port/],
  ['unknown scheme', 'blob:https://hngtwkayovuxhiqustsa.supabase.co/id', /HTTPS is required/],
  ['javascript scheme', 'javascript:alert(1)', /HTTPS is required/],
  ['data scheme', 'data:audio/mpeg;base64,AA==', /HTTPS is required/],
  ['file scheme', 'file:///tmp/audio.mp3', /HTTPS is required/],
  ['lookalike hostname', 'https://hngtwkayovuxhiqustsa.supabase.co.evil.invalid/a.mp3', /hostname is not allowlisted/],
  ['trailing-dot hostname', 'https://hngtwkayovuxhiqustsa.supabase.co./storage/v1/object/public/songs/a.mp3', /hostname is not allowlisted/],
  ['signed query', 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/songs/a.mp3?X-Goog-Signature=private', /signed or temporary/],
]) {
  test(`rejects ${name} URL`, t => {
    const track = validTrack(); track.mp3Url = value;
    const { root } = fixture({ tracks: [track] }); cleanup(t, root);
    assert.throws(() => validate(root), pattern);
  });
}

test('accepts allowlisted HTTPS URLs with normal public query parameters', t => {
  const track = validTrack(); track.youtubeVideoUrl = 'https://www.youtube.com/watch?v=public&list=public';
  const { root } = fixture({ tracks: [track] }); cleanup(t, root);
  assert.equal(validate(root).trackTotal, 1);
});

test('rejects non-empty catalog assetBaseUrl', t => {
  const { root } = fixture({ mutateCatalog: catalog => { catalog.assetBaseUrl = 'https://cdn.example.invalid'; } }); cleanup(t, root);
  assert.throws(() => validate(root), /self-contained absolute track URLs/);
});

for (const [field, value] of [['benignExtra', true], ['email', 'person@example.test'], ['user_id', 'public-looking'], ['internal_notes', 'not public']]) {
  test(`rejects unknown field ${field}`, t => {
    const track = validTrack(); track[field] = value;
    const { root } = fixture({ tracks: [track] }); cleanup(t, root);
    assert.throws(() => validate(root), /unknown field/);
  });
}

test('rejects nested content in a scalar catalog field', t => {
  const track = validTrack(); track.canonicalArtistId = { email: 'person@example.test' };
  const { root } = fixture({ tracks: [track] }); cleanup(t, root);
  assert.throws(() => validate(root), /canonicalArtistId: expected string or null/);
});

test('rejects duplicate slug across distinct chunks', t => {
  const { root, publicDir } = fixture({ tracks: [validTrack('id-a', 'same')] }); cleanup(t, root);
  const catalogPath = path.join(publicDir, 'songs-manifest.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  catalog.trackTotal = 2; catalog.chunks.push({ path: 'songs-manifest-chunk-1.json', count: 1 });
  fs.writeFileSync(catalogPath, JSON.stringify(catalog));
  fs.writeFileSync(path.join(publicDir, 'songs-manifest-chunk-1.json'), JSON.stringify({ version: 5, kind: 'chunk', chunkIndex: 1, tracks: [validTrack('id-b', 'same')] }));
  assert.throws(() => validate(root), /duplicate slug/);
});

for (const target of ['chunk', 'catalog']) {
  test(`rejects ${target} symlink outside snapshot root`, t => {
    const { root, publicDir } = fixture(); cleanup(t, root);
    const name = target === 'chunk' ? 'songs-manifest-chunk-0.json' : 'songs-manifest.json';
    const file = path.join(publicDir, name); const outside = path.join(root, `outside-${name}`);
    fs.renameSync(file, outside); fs.symlinkSync(outside, file);
    assert.throws(() => validate(root), /symbolic link/);
  });
}

test('rejects chunk symlink to another file inside snapshot root', t => {
  const { root, publicDir } = fixture(); cleanup(t, root);
  const chunk = path.join(publicDir, 'songs-manifest-chunk-0.json'); const other = path.join(publicDir, 'other.json');
  fs.renameSync(chunk, other); fs.symlinkSync(other, chunk);
  assert.throws(() => validate(root), /symbolic link/);
});

test('rejects symlinked snapshot parent directory', t => {
  const { root, publicDir } = fixture(); cleanup(t, root);
  const realPublic = path.join(root, 'real-public'); fs.renameSync(publicDir, realPublic); fs.symlinkSync(realPublic, publicDir);
  assert.throws(() => validate(root), /snapshot root: symbolic link/);
});

test('rejects dangling chunk symlink', t => {
  const { root, publicDir } = fixture(); cleanup(t, root);
  const chunk = path.join(publicDir, 'songs-manifest-chunk-0.json'); fs.rmSync(chunk); fs.symlinkSync(path.join(root, 'missing.json'), chunk);
  assert.throws(() => validate(root), /symbolic link/);
});

test('fails closed for missing catalog and malformed chunk', t => {
  const { root, publicDir } = fixture(); cleanup(t, root);
  fs.writeFileSync(path.join(publicDir, 'songs-manifest-chunk-0.json'), '{');
  assert.throws(() => validate(root), /invalid JSON/);
  fs.rmSync(path.join(publicDir, 'songs-manifest.json'));
  assert.throws(() => validate(root), /missing file/);
});

test('enforces 90-day freshness with an injected clock', t => {
  const { root } = fixture(); cleanup(t, root);
  assert.equal(validate(root, Date.parse('2026-09-17T18:38:10.955Z')).trackTotal, 1);
  assert.throws(() => validate(root, Date.parse('2026-09-18T18:38:10.956Z')), /90-day freshness/);
});
