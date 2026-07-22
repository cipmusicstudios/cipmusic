#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');
const CATALOG_NAME = 'songs-manifest.json';
const CHUNK_NAME = /^songs-manifest-chunk-(\d+)\.json$/;
const ALLOWED_HTTPS_HOSTS = new Set([
  'cdn-images.dzcdn.net',
  'encrypted-tbn0.gstatic.com',
  'hngtwkayovuxhiqustsa.supabase.co',
  'i.scdn.co',
  'image-cdn-ak.spotifycdn.com',
  'image-cdn-fa.spotifycdn.com',
  'img.youtube.com',
  'is1-ssl.mzstatic.com',
  'mymusic.st',
  'mymusic5.com',
  'www.bilibili.com',
  'www.mymusic5.com',
  'www.mymusicfive.com',
  'www.mymusicsheet.com',
  'www.youtube.com',
  'y.gtimg.cn',
  'youtube.com',
]);
const FORBIDDEN_FIELD = /(?:midi|music_?xml|xml_path|receipt|jws|service_?role|private_?key|token_?hash)/i;
const FORBIDDEN_RAW = [
  /SUPABASE_SERVICE_ROLE_KEY/i,
  /service[_-]?role/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/,
  /(?:x-amz-signature|x-amz-credential|x-amz-security-token|signature|sig|token|policy|key-pair-id)\s*[=:]/i,
  /\.(?:mid|midi|musicxml|mxl)(?:[?"'\s]|$)/i,
  /\/storage\/v1\/object\/(?:sign|authenticated|private)\//i,
];

function fail(message) {
  throw new Error(`[preview-manifest] ${message}`);
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) fail(`${label} is missing: ${path.basename(filePath)}`);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    fail(`${label} cannot be read: ${error.message}`);
  }
  try {
    return { raw, value: JSON.parse(raw) };
  } catch {
    fail(`${label} is not valid JSON: ${path.basename(filePath)}`);
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string`);
}

function inspectValue(value, location) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectValue(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_FIELD.test(key)) fail(`forbidden field ${key} at ${location}`);
    if (typeof nested === 'string' && /^https?:\/\//i.test(nested)) {
      let url;
      try {
        url = new URL(nested);
      } catch {
        fail(`invalid URL at ${location}.${key}`);
      }
      if (url.protocol !== 'https:') fail(`non-HTTPS URL at ${location}.${key}`);
      if (!ALLOWED_HTTPS_HOSTS.has(url.hostname)) fail(`URL host is not allowlisted at ${location}.${key}`);
      for (const queryKey of url.searchParams.keys()) {
        if (/^(?:token|signature|sig|policy|key-pair-id|x-amz-.+|expires)$/i.test(queryKey)) {
          fail(`signed or credentialed URL at ${location}.${key}`);
        }
      }
      if (/\/storage\/v1\/object\/(?:sign|authenticated|private)\//i.test(url.pathname)) {
        fail(`private storage URL at ${location}.${key}`);
      }
      if (url.hostname.endsWith('.supabase.co') && !url.pathname.startsWith('/storage/v1/object/public/')) {
        fail(`non-public Supabase URL at ${location}.${key}`);
      }
    }
    inspectValue(nested, `${location}.${key}`);
  }
}

function inspectRaw(raw, label) {
  for (const pattern of FORBIDDEN_RAW) {
    if (pattern.test(raw)) fail(`${label} contains forbidden private or credential-shaped content`);
  }
}

function validateTrack(track, location, ids) {
  if (!track || typeof track !== 'object' || Array.isArray(track)) fail(`${location} must be an object`);
  for (const field of ['id', 'title', 'displayTitle', 'originalArtist', 'coverUrl', 'mp3Url', 'duration']) {
    requireString(track[field], `${location}.${field}`);
  }
  if (!Array.isArray(track.tags) || !track.tags.every(item => typeof item === 'string')) fail(`${location}.tags must be a string array`);
  if (!Array.isArray(track.categoryKeys) || !track.categoryKeys.every(item => typeof item === 'string')) fail(`${location}.categoryKeys must be a string array`);
  if (typeof track.hasPracticeMode !== 'boolean') fail(`${location}.hasPracticeMode must be boolean`);
  if (track.importSource !== 'local' && track.importSource !== 'remote') fail(`${location}.importSource is invalid`);
  if (ids.has(track.id)) fail(`duplicate track id: ${track.id}`);
  ids.add(track.id);
  inspectValue(track, location);
}

export function validatePreviewManifest({ root = DEFAULT_ROOT } = {}) {
  const publicDir = path.join(root, 'public');
  const catalogPath = path.join(publicDir, CATALOG_NAME);
  const catalogFile = readJson(catalogPath, 'catalog');
  inspectRaw(catalogFile.raw, 'catalog');
  const catalog = catalogFile.value;
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) fail('catalog must be an object');
  if (catalog.kind !== 'catalog') fail('catalog.kind must be catalog');
  if (!Number.isInteger(catalog.version) || catalog.version < 1) fail('catalog.version must be a positive integer');
  requireString(catalog.generatedAt, 'catalog.generatedAt');
  const generatedAtMs = Date.parse(catalog.generatedAt);
  if (!Number.isFinite(generatedAtMs) || new Date(generatedAtMs).toISOString() !== catalog.generatedAt) fail('catalog.generatedAt must be canonical ISO-8601');
  if (generatedAtMs > Date.now() + 300_000) fail('catalog.generatedAt cannot be in the future');
  if (!Number.isInteger(catalog.trackTotal) || catalog.trackTotal < 1) fail('catalog.trackTotal must be a positive integer');
  if (!Array.isArray(catalog.chunks) || catalog.chunks.length < 1) fail('catalog.chunks must be non-empty');
  inspectValue(catalog, 'catalog');

  const ids = new Set();
  const referencedChunks = new Set();
  let trackTotal = 0;
  catalog.chunks.forEach((chunk, index) => {
    if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) fail(`catalog.chunks[${index}] must be an object`);
    requireString(chunk.path, `catalog.chunks[${index}].path`);
    const match = CHUNK_NAME.exec(chunk.path);
    if (!match || Number(match[1]) !== index || path.basename(chunk.path) !== chunk.path) fail(`catalog.chunks[${index}].path is invalid`);
    if (referencedChunks.has(chunk.path)) fail(`duplicate chunk path: ${chunk.path}`);
    referencedChunks.add(chunk.path);
    if (!Number.isInteger(chunk.count) || chunk.count < 1) fail(`catalog.chunks[${index}].count must be positive`);
    const chunkPath = path.join(publicDir, chunk.path);
    const chunkFile = readJson(chunkPath, `chunk ${index}`);
    inspectRaw(chunkFile.raw, `chunk ${index}`);
    const chunkJson = chunkFile.value;
    if (!chunkJson || chunkJson.kind !== 'chunk' || chunkJson.version !== catalog.version || chunkJson.chunkIndex !== index || !Array.isArray(chunkJson.tracks)) {
      fail(`chunk ${index} schema does not match catalog`);
    }
    if (chunkJson.tracks.length !== chunk.count) fail(`chunk ${index} count does not match catalog`);
    chunkJson.tracks.forEach((track, trackIndex) => validateTrack(track, `chunk[${index}].tracks[${trackIndex}]`, ids));
    trackTotal += chunkJson.tracks.length;
  });

  const diskChunks = fs.readdirSync(publicDir).filter(name => CHUNK_NAME.test(name)).sort();
  if (diskChunks.length !== referencedChunks.size || diskChunks.some(name => !referencedChunks.has(name))) {
    fail('public manifest chunk files do not exactly match the catalog');
  }
  if (trackTotal !== catalog.trackTotal || ids.size !== catalog.trackTotal) fail('catalog.trackTotal does not match unique tracks');

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
