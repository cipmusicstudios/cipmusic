#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');
const CATALOG_NAME = 'songs-manifest.json';
const CHUNK_NAME = /^songs-manifest-chunk-(\d+)\.json$/;
const MAX_SNAPSHOT_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const CATALOG_FIELDS = new Set(['version', 'kind', 'generatedAt', 'assetBaseUrl', 'trackTotal', 'chunks']);
const CATALOG_CHUNK_FIELDS = new Set(['path', 'count']);
const CHUNK_FIELDS = new Set(['version', 'kind', 'chunkIndex', 'tracks']);
const TRACK_FIELDS = new Set([
  'artistResolutionNotes', 'artistReviewStatus', 'artists', 'bilibiliVideoUrl',
  'canonicalArtistDisplayName', 'canonicalArtistId', 'categoryKeys', 'coCanonicalArtistIds',
  'coverUrl', 'displayTitle', 'duration', 'durationSeconds', 'excludeFromArtistIndex',
  'hasPracticeMode', 'id', 'importSource', 'linkStatus', 'listSortPublishedAt',
  'listSortPublishedAtMs', 'listSortSource', 'mp3Url', 'originalArtist', 'sheetUrl',
  'slug', 'supabaseCreatedAt', 'tags', 'title', 'titles', 'workProjectKey',
  'youtubePublishedAt', 'youtubeSortIndex', 'youtubeVideoId', 'youtubeVideoTitle',
  'youtubeVideoUrl',
]);
const LOCALIZED_FIELDS = new Set(['en', 'zhHans', 'zhHant']);
const URL_HOSTS = {
  mp3Url: new Set(['hngtwkayovuxhiqustsa.supabase.co']),
  coverUrl: new Set([
    'cdn-images.dzcdn.net', 'encrypted-tbn0.gstatic.com', 'i.scdn.co',
    'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com', 'img.youtube.com',
    'is1-ssl.mzstatic.com', 'y.gtimg.cn',
  ]),
  youtubeVideoUrl: new Set(['youtube.com', 'www.youtube.com']),
  bilibiliVideoUrl: new Set(['www.bilibili.com']),
  sheetUrl: new Set(['mymusic.st', 'mymusic5.com', 'www.mymusic5.com', 'www.mymusicfive.com', 'www.mymusicsheet.com']),
};
const SIGNED_QUERY_KEY = /^(?:token|access_token|signature|sig|expires|expiry|policy|key-pair-id|googleaccessid|x-amz-.+|x-goog-.+)$/i;
const FORBIDDEN_RAW = [
  /SUPABASE_SERVICE_ROLE_KEY/i,
  /service[_-]?role/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/,
  /\.(?:mid|midi|musicxml|mxl)(?:[?"'\s]|$)/i,
  /\/storage\/v1\/object\/(?:sign|authenticated|private)\//i,
];

function fail(message) { throw new Error(`[preview-manifest] ${message}`); }

function ensurePlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}: expected object`);
}

function rejectUnknownFields(value, allowed, label) {
  ensurePlainObject(value, label);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label}.${key}: unknown field`);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label}: expected non-empty string`);
}

function ensureSafeRegularFile(filePath, snapshotRoot, label) {
  let stat;
  try { stat = fs.lstatSync(filePath); } catch { fail(`${label}: missing file`); }
  if (stat.isSymbolicLink()) fail(`${label}: symbolic link is not allowed`);
  if (!stat.isFile()) fail(`${label}: expected regular file`);
  const real = fs.realpathSync(filePath);
  const prefix = `${snapshotRoot}${path.sep}`;
  if (!real.startsWith(prefix)) fail(`${label}: file escapes snapshot root`);
  return real;
}

function readJson(filePath, snapshotRoot, label) {
  const safePath = ensureSafeRegularFile(filePath, snapshotRoot, label);
  const raw = fs.readFileSync(safePath, 'utf8');
  try { return { raw, value: JSON.parse(raw) }; }
  catch { fail(`${label}: invalid JSON`); }
}

function inspectRaw(raw, label) {
  for (const pattern of FORBIDDEN_RAW) if (pattern.test(raw)) fail(`${label}: forbidden private or credential-shaped content`);
}

function validatePublicUrl(value, field, location, { required = false } = {}) {
  if (value == null && !required) return;
  if (typeof value !== 'string' || value.length === 0) fail(`${location}.${field}: expected ${required ? 'non-empty string' : 'string or null'}`);
  if (value.startsWith('//')) fail(`${location}.${field}: protocol-relative URL is not allowed`);
  let url;
  try { url = new URL(value); } catch { fail(`${location}.${field}: invalid absolute URL`); }
  if (url.protocol !== 'https:') fail(`${location}.${field}: HTTPS is required`);
  if (url.username || url.password) fail(`${location}.${field}: URL credentials are not allowed`);
  if (url.port && url.port !== '443') fail(`${location}.${field}: non-default port is not allowed`);
  if (!URL_HOSTS[field].has(url.hostname)) fail(`${location}.${field}: hostname is not allowlisted`);
  for (const key of url.searchParams.keys()) if (SIGNED_QUERY_KEY.test(key)) fail(`${location}.${field}: signed or temporary query is not allowed`);
  if (/\/storage\/v1\/object\/(?:sign|authenticated|private)\//i.test(url.pathname)) fail(`${location}.${field}: private storage path is not allowed`);
  if (field === 'mp3Url' && !url.pathname.startsWith('/storage/v1/object/public/')) fail(`${location}.${field}: public storage path is required`);
}

function validateLocalized(value, label) {
  if (value == null) return;
  rejectUnknownFields(value, LOCALIZED_FIELDS, label);
  for (const [key, text] of Object.entries(value)) if (typeof text !== 'string') fail(`${label}.${key}: expected string`);
}

function validateTrack(track, location, ids, slugs) {
  rejectUnknownFields(track, TRACK_FIELDS, location);
  for (const field of ['id', 'title', 'displayTitle', 'originalArtist', 'duration', 'slug']) requireString(track[field], `${location}.${field}`);
  if (track.id !== track.id.trim() || track.id.length > 200) fail(`${location}.id: invalid identifier`);
  if (track.slug !== track.slug.trim() || track.slug.length > 240 || /[\u0000-\u001f\u007f/\\?#]/u.test(track.slug)) fail(`${location}.slug: invalid slug`);
  if (ids.has(track.id)) fail(`${location}.id: duplicate identifier`);
  if (slugs.has(track.slug)) fail(`${location}.slug: duplicate slug`);
  ids.add(track.id); slugs.add(track.slug);
  for (const field of ['tags', 'categoryKeys']) if (!Array.isArray(track[field]) || !track[field].every(item => typeof item === 'string')) fail(`${location}.${field}: expected string array`);
  for (const field of ['artistResolutionNotes', 'coCanonicalArtistIds']) if (track[field] != null && (!Array.isArray(track[field]) || !track[field].every(item => typeof item === 'string'))) fail(`${location}.${field}: expected string array or null`);
  if (typeof track.hasPracticeMode !== 'boolean') fail(`${location}.hasPracticeMode: expected boolean`);
  if (track.importSource !== 'local' && track.importSource !== 'remote') fail(`${location}.importSource: invalid value`);
  validateLocalized(track.titles, `${location}.titles`);
  validateLocalized(track.artists, `${location}.artists`);
  validatePublicUrl(track.mp3Url, 'mp3Url', location, { required: true });
  validatePublicUrl(track.coverUrl, 'coverUrl', location, { required: true });
  for (const field of ['youtubeVideoUrl', 'bilibiliVideoUrl', 'sheetUrl']) validatePublicUrl(track[field], field, location);
}

export function validatePreviewManifest({ root = DEFAULT_ROOT, now = Date.now() } = {}) {
  const publicDir = path.join(root, 'public');
  let publicStat;
  try { publicStat = fs.lstatSync(publicDir); } catch { fail('snapshot root: missing public directory'); }
  if (publicStat.isSymbolicLink()) fail('snapshot root: symbolic link is not allowed');
  if (!publicStat.isDirectory()) fail('snapshot root: expected directory');
  const snapshotRoot = fs.realpathSync(publicDir);
  const catalogFile = readJson(path.join(publicDir, CATALOG_NAME), snapshotRoot, 'catalog');
  inspectRaw(catalogFile.raw, 'catalog');
  const catalog = catalogFile.value;
  rejectUnknownFields(catalog, CATALOG_FIELDS, 'catalog');
  if (catalog.kind !== 'catalog') fail('catalog.kind: expected catalog');
  if (!Number.isInteger(catalog.version) || catalog.version < 1) fail('catalog.version: expected positive integer');
  if (catalog.assetBaseUrl !== '') fail('catalog.assetBaseUrl: Preview snapshot requires self-contained absolute track URLs');
  requireString(catalog.generatedAt, 'catalog.generatedAt');
  const generatedAtMs = Date.parse(catalog.generatedAt);
  if (!Number.isFinite(generatedAtMs) || new Date(generatedAtMs).toISOString() !== catalog.generatedAt) fail('catalog.generatedAt: expected canonical ISO-8601');
  if (generatedAtMs > now + 300_000) fail('catalog.generatedAt: future timestamp');
  if (now - generatedAtMs > MAX_SNAPSHOT_AGE_MS) fail('catalog.generatedAt: snapshot exceeds 90-day freshness policy');
  if (!Number.isInteger(catalog.trackTotal) || catalog.trackTotal < 1) fail('catalog.trackTotal: expected positive integer');
  if (!Array.isArray(catalog.chunks) || catalog.chunks.length < 1) fail('catalog.chunks: expected non-empty array');

  const ids = new Set(), slugs = new Set(), referencedChunks = new Set();
  let trackTotal = 0;
  catalog.chunks.forEach((descriptor, index) => {
    rejectUnknownFields(descriptor, CATALOG_CHUNK_FIELDS, `catalog.chunks[${index}]`);
    requireString(descriptor.path, `catalog.chunks[${index}].path`);
    const match = CHUNK_NAME.exec(descriptor.path);
    if (!match || Number(match[1]) !== index || path.basename(descriptor.path) !== descriptor.path) fail(`catalog.chunks[${index}].path: invalid chunk path`);
    if (referencedChunks.has(descriptor.path)) fail(`catalog.chunks[${index}].path: duplicate chunk path`);
    referencedChunks.add(descriptor.path);
    if (!Number.isInteger(descriptor.count) || descriptor.count < 1) fail(`catalog.chunks[${index}].count: expected positive integer`);
    const chunkFile = readJson(path.join(publicDir, descriptor.path), snapshotRoot, `chunk[${index}]`);
    inspectRaw(chunkFile.raw, `chunk[${index}]`);
    const chunk = chunkFile.value;
    rejectUnknownFields(chunk, CHUNK_FIELDS, `chunk[${index}]`);
    if (chunk.kind !== 'chunk' || chunk.version !== catalog.version || chunk.chunkIndex !== index || !Array.isArray(chunk.tracks)) fail(`chunk[${index}]: schema does not match catalog`);
    if (chunk.tracks.length !== descriptor.count) fail(`chunk[${index}].tracks: count does not match catalog`);
    chunk.tracks.forEach((track, trackIndex) => validateTrack(track, `chunk[${index}].tracks[${trackIndex}]`, ids, slugs));
    trackTotal += chunk.tracks.length;
  });
  const diskChunks = fs.readdirSync(publicDir).filter(name => CHUNK_NAME.test(name));
  if (diskChunks.length !== referencedChunks.size || diskChunks.some(name => !referencedChunks.has(name))) fail('catalog.chunks: files do not exactly match catalog');
  if (trackTotal !== catalog.trackTotal || ids.size !== catalog.trackTotal || slugs.size !== catalog.trackTotal) fail('catalog.trackTotal: does not match unique tracks');
  return { version: catalog.version, generatedAt: catalog.generatedAt, trackTotal, chunkTotal: catalog.chunks.length };
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    const result = validatePreviewManifest();
    console.log(`[preview-manifest] valid committed snapshot: ${result.trackTotal} tracks, ${result.chunkTotal} chunks, generated ${result.generatedAt}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
