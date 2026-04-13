/**
 * Fetch artist images for verified artists.
 * Order: (1) Deezer (2) Apple Music og:image (3) TheAudioDB (4) Spotify Web API（需 SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET）
 * Usage:
 *   npx tsx scripts/fetch-artist-images.ts              # full run (skip cached)
 *   npx tsx scripts/fetch-artist-images.ts --test        # 3-artist test
 *   npx tsx scripts/fetch-artist-images.ts --force       # re-fetch all
 *   npx tsx scripts/fetch-artist-images.ts --id=adele    # single artist
 *
 * Credentials: set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in `.env` (gitignored) or env.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTIST_DICTIONARY } from '../src/local-import-artist-normalization.ts';
import {
  applyArtistImageToManifestArtist,
  isValidArtistImageUrl,
  loadArtistImageOverrides,
  shouldSkipAutoFetch,
} from './artist-image-shared.ts';
import type { ArtistImageKind } from '../src/artist-image-kind.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(projectRoot, 'public', 'artist-manifest.json');
const cachePath = path.join(projectRoot, 'public', 'artist-images-cache.json');

type ImageCacheEntry = {
  url: string | null;
  source: string | null;
  confidence: number | null;
  attemptedAt: string;
  matchedName?: string;
  searchQuery?: string;
  imageKind?: ArtistImageKind | null;
};

type ImageCache = Record<string, ImageCacheEntry>;

type ManifestArtist = {
  canonicalArtistId: string;
  displayName: string;
  songCount: number;
  songIds: string[];
  sampleOriginalArtists: string[];
  reviewStatus: string;
  artistImageUrl?: string | null;
  artistImageSource?: string | null;
  artistImageConfidence?: number | null;
  artistImageKind?: ArtistImageKind | null;
};

type ArtistManifest = {
  version: number;
  generatedAt: string;
  artists: ManifestArtist[];
  needsReview: unknown[];
};

// ── Helpers ──

function sanitizeCache(cache: ImageCache): ImageCache {
  const out: ImageCache = { ...cache };
  let removed = 0;
  for (const [k, v] of Object.entries(out)) {
    if (!v.url || !isValidArtistImageUrl(v.url)) {
      delete out[k];
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[artist-images] Dropped ${removed} invalid cache entr(y/ies) (bad URL or empty).`);
  }
  return out;
}

function loadCache(): ImageCache {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as ImageCache;
    return sanitizeCache(raw);
  } catch {
    return {};
  }
}

function saveCache(cache: ImageCache) {
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
}

function loadManifest(): ArtistManifest {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function saveManifest(m: ArtistManifest) {
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2), 'utf8');
}

function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff\uac00-\ud7af\u3040-\u30ff]/g, '');
}

function nameSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const setA = new Set([...na]);
  const setB = new Set([...nb]);
  const intersection = [...setA].filter(c => setB.has(c)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Deezer API ──

type DeezerArtistResult = {
  id: number;
  name: string;
  picture_xl: string;
  picture_big: string;
  picture_medium: string;
  nb_fan: number;
};

async function searchDeezerArtist(
  query: string,
): Promise<DeezerArtistResult[]> {
  const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(query)}&limit=5`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: DeezerArtistResult[] };
    return json.data ?? [];
  } catch {
    return [];
  }
}

function deezerImageKindForArtistId(id: string): ArtistImageKind {
  const d = ARTIST_DICTIONARY[id];
  if (d?.type === 'group') return 'group_photo';
  if (d?.type === 'project') return 'project_logo';
  return 'artist_photo';
}

function pickBestMatch(
  results: DeezerArtistResult[],
  searchNames: string[],
): { artist: DeezerArtistResult; similarity: number } | null {
  let best: { artist: DeezerArtistResult; similarity: number } | null = null;

  for (const r of results) {
    for (const name of searchNames) {
      const sim = nameSimilarity(r.name, name);
      if (sim > (best?.similarity ?? 0)) {
        best = { artist: r, similarity: sim };
      }
    }
  }
  return best;
}

function maxNameSimilarityToArtist(
  strArtist: string,
  strAlternate: string | null | undefined,
  searchNames: string[],
): number {
  let m = 0;
  const candidates = [strArtist, strAlternate].filter((x): x is string => Boolean(x?.trim()));
  for (const c of candidates) {
    for (const sn of searchNames) {
      const sim = nameSimilarity(c, sn);
      if (sim > m) m = sim;
    }
  }
  return m;
}

/** Apple Music 艺人页 og:image → 尽量换成方形封面（与 generate-local-import-artists-metadata 一致） */
function normalizeAppleOgImageUrl(photoUrl: string): string {
  if (photoUrl.includes('1200x630')) {
    return photoUrl.replace(/1200x630[a-z]*\.[a-z]+$/i, '600x600cc.webp');
  }
  return photoUrl;
}

async function fetchAppleMusicArtistOgImage(
  allNames: string[],
): Promise<{ url: string; matchedName: string; similarity: number } | null> {
  type Candidate = { artistName: string; artistLinkUrl: string; similarity: number };
  const candidates: Candidate[] = [];
  const seenLinks = new Set<string>();

  for (const term of allNames) {
    const q = term.trim();
    if (!q) continue;
    try {
      const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=musicArtist&limit=10`;
      const searchRes = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuraSounds/1.0; +artist-image-fetch)' },
      });
      if (!searchRes.ok) {
        await sleep(120);
        continue;
      }
      const searchData = (await searchRes.json()) as {
        results?: Array<{ artistName?: string; artistLinkUrl?: string }>;
      };
      for (const row of searchData.results ?? []) {
        const link = row.artistLinkUrl;
        const aname = row.artistName;
        if (!link || !aname || seenLinks.has(link)) continue;
        const sim = maxNameSimilarityToArtist(aname, undefined, allNames);
        if (sim < 0.5) continue;
        seenLinks.add(link);
        candidates.push({ artistName: aname, artistLinkUrl: link, similarity: sim });
      }
    } catch {
      /* next term */
    }
    await sleep(120);
  }

  candidates.sort((a, b) => b.similarity - a.similarity);

  for (const c of candidates) {
    try {
      const pageRes = await fetch(c.artistLinkUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      });
      if (!pageRes.ok) {
        await sleep(80);
        continue;
      }
      const html = await pageRes.text();
      const og = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
      if (!og?.[1]) {
        await sleep(80);
        continue;
      }
      const raw = og[1].replace(/&amp;/g, '&');
      const photoUrl = normalizeAppleOgImageUrl(raw);
      if (!isValidArtistImageUrl(photoUrl)) {
        await sleep(80);
        continue;
      }
      return { url: photoUrl, matchedName: c.artistName, similarity: c.similarity };
    } catch {
      await sleep(80);
    }
  }

  return null;
}

type TheAudioDbArtistRow = {
  strArtist: string;
  strArtistAlternate?: string | null;
  strArtistThumb?: string | null;
  strArtistLogo?: string | null;
};

async function fetchTheAudioDbArtistImage(
  allNames: string[],
): Promise<{ url: string; matchedName: string; similarity: number } | null> {
  let best: { url: string; matchedName: string; similarity: number } | null = null;

  for (const term of allNames) {
    const q = term.trim();
    if (!q) continue;
    try {
      const url = `https://www.theaudiodb.com/api/v1/json/2/search.php?s=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuraSounds/1.0; +artist-image-fetch)' },
      });
      if (!res.ok) {
        await sleep(120);
        continue;
      }
      const json = (await res.json()) as { artists?: TheAudioDbArtistRow[] | null };
      const artists = json.artists;
      if (!artists?.length) {
        await sleep(120);
        continue;
      }

      for (const a of artists) {
        const sim = maxNameSimilarityToArtist(a.strArtist, a.strArtistAlternate, allNames);
        if (sim < 0.52) continue;
        const thumb = (a.strArtistThumb || a.strArtistLogo || '').trim();
        if (!thumb || !isValidArtistImageUrl(thumb)) continue;
        if (!best || sim > best.similarity) {
          best = { url: thumb, matchedName: a.strArtist, similarity: sim };
        }
      }
    } catch {
      /* next */
    }
    await sleep(120);
  }

  return best;
}

// ── Spotify Web API (Client Credentials) ──

type SpotifyApiArtist = {
  name: string;
  images: { url: string; width?: number; height?: number }[];
};

let spotifyTokenCache: { token: string; expiresAt: number } | null = null;

async function getSpotifyAccessToken(): Promise<string | null> {
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  if (spotifyTokenCache && Date.now() < spotifyTokenCache.expiresAt - 60_000) {
    return spotifyTokenCache.token;
  }
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`, 'utf8').toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    if (!res.ok) {
      console.warn(`[spotify] token HTTP ${res.status}`);
      return null;
    }
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) return null;
    const expiresIn = j.expires_in ?? 3600;
    spotifyTokenCache = {
      token: j.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    return spotifyTokenCache.token;
  } catch (e) {
    console.warn('[spotify] token error', (e as Error)?.message);
    return null;
  }
}

function pickSpotifyImageUrl(images: SpotifyApiArtist['images']): string | null {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  for (const im of sorted) {
    const u = im.url?.trim();
    if (u && isValidArtistImageUrl(u)) return u;
  }
  return null;
}

async function searchSpotifyArtists(query: string, token: string): Promise<SpotifyApiArtist[]> {
  const url = `https://api.spotify.com/v1/search?type=artist&limit=10&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const json = (await res.json()) as { artists?: { items?: SpotifyApiArtist[] } };
  return json.artists?.items ?? [];
}

function pickBestSpotifyMatch(
  items: SpotifyApiArtist[],
  searchNames: string[],
): { artist: SpotifyApiArtist; similarity: number } | null {
  let best: { artist: SpotifyApiArtist; similarity: number } | null = null;
  for (const item of items) {
    for (const sn of searchNames) {
      const sim = nameSimilarity(item.name, sn);
      if (sim > (best?.similarity ?? 0)) {
        best = { artist: item, similarity: sim };
      }
    }
  }
  return best;
}

async function fetchSpotifyArtistImage(
  allNames: string[],
): Promise<{ url: string; matchedName: string; similarity: number } | null> {
  const token = await getSpotifyAccessToken();
  if (!token) return null;

  let globalBest: { artist: SpotifyApiArtist; similarity: number } | null = null;

  for (const term of allNames) {
    const q = term.trim();
    if (!q) continue;
    try {
      const items = await searchSpotifyArtists(q, token);
      const match = pickBestSpotifyMatch(items, allNames);
      if (match && match.similarity > (globalBest?.similarity ?? 0)) {
        globalBest = match;
      }
    } catch {
      /* next */
    }
    await sleep(100);
  }

  if (!globalBest || globalBest.similarity < 0.52) return null;
  const url = pickSpotifyImageUrl(globalBest.artist.images);
  if (!url) return null;
  return { url, matchedName: globalBest.artist.name, similarity: globalBest.similarity };
}

// ── Main fetch logic ──

/** Aggregates / ambiguous buckets — do not auto-bind a random Deezer “closest string” match */
const SKIP_DEEZER_AUTO_FETCH_IDS = new Set<string>([
  /** Virtual group; Deezer collides with unrelated “Soul” artists — manual image only */
  'a-soul',
]);

async function fetchImageForArtist(
  id: string,
  displayName: string,
): Promise<ImageCacheEntry> {
  if (SKIP_DEEZER_AUTO_FETCH_IDS.has(id)) {
    return {
      url: null,
      source: null,
      confidence: null,
      attemptedAt: new Date().toISOString(),
    };
  }
  const dict = ARTIST_DICTIONARY[id];
  const searchNames: string[] = [];

  /** Prefer Latin / English queries first — Deezer matches better for global artist names */
  if (dict?.names.en) searchNames.push(dict.names.en);
  if (dict?.names.zhHans) searchNames.push(dict.names.zhHans);
  if (dict?.names.zhHant) searchNames.push(dict.names.zhHant);
  if (!searchNames.includes(displayName)) searchNames.push(displayName);

  const allNames = [...new Set(searchNames)].sort((a, b) => {
    const la = /[A-Za-z]/.test(a) ? 0 : 1;
    const lb = /[A-Za-z]/.test(b) ? 0 : 1;
    return la - lb || a.length - b.length;
  });

  let globalBest: {
    artist: DeezerArtistResult;
    similarity: number;
    query: string;
  } | null = null;

  for (const query of allNames) {
    const results = await searchDeezerArtist(query);
    if (results.length === 0) {
      await sleep(120);
      continue;
    }

    const match = pickBestMatch(results, allNames);
    if (match && match.similarity > (globalBest?.similarity ?? 0)) {
      globalBest = { ...match, query };
    }
    await sleep(120);
  }

  if (globalBest && globalBest.similarity >= 0.52) {
    const confidence =
      globalBest.similarity >= 0.95
        ? 0.98
        : globalBest.similarity >= 0.8
          ? 0.9
          : globalBest.similarity >= 0.6
            ? 0.75
            : 0.6;
    const pic = globalBest.artist.picture_xl || globalBest.artist.picture_big;
    if (!isValidArtistImageUrl(pic)) {
      return {
        url: null,
        source: null,
        confidence: null,
        attemptedAt: new Date().toISOString(),
      };
    }
    return {
      url: pic,
      source: 'deezer',
      confidence,
      attemptedAt: new Date().toISOString(),
      matchedName: globalBest.artist.name,
      searchQuery: globalBest.query,
      imageKind: deezerImageKindForArtistId(id),
    };
  }

  const apple = await fetchAppleMusicArtistOgImage(allNames);
  if (apple) {
    const confidence =
      apple.similarity >= 0.95 ? 0.88 : apple.similarity >= 0.8 ? 0.78 : 0.62;
    return {
      url: apple.url,
      source: 'apple_music',
      confidence,
      attemptedAt: new Date().toISOString(),
      matchedName: apple.matchedName,
      searchQuery: apple.matchedName,
      imageKind: deezerImageKindForArtistId(id),
    };
  }

  const audioDb = await fetchTheAudioDbArtistImage(allNames);
  if (audioDb) {
    const confidence =
      audioDb.similarity >= 0.95 ? 0.72 : audioDb.similarity >= 0.8 ? 0.65 : 0.55;
    return {
      url: audioDb.url,
      source: 'theaudiodb',
      confidence,
      attemptedAt: new Date().toISOString(),
      matchedName: audioDb.matchedName,
      searchQuery: audioDb.matchedName,
      imageKind: deezerImageKindForArtistId(id),
    };
  }

  const spotify = await fetchSpotifyArtistImage(allNames);
  if (spotify) {
    const confidence =
      spotify.similarity >= 0.95 ? 0.85 : spotify.similarity >= 0.8 ? 0.75 : 0.58;
    return {
      url: spotify.url,
      source: 'spotify',
      confidence,
      attemptedAt: new Date().toISOString(),
      matchedName: spotify.matchedName,
      searchQuery: spotify.matchedName,
      imageKind: deezerImageKindForArtistId(id),
    };
  }

  return {
    url: null,
    source: null,
    confidence: null,
    attemptedAt: new Date().toISOString(),
  };
}

// ── CLI ──

async function main() {
  const args = process.argv.slice(2);
  const isTest = args.includes('--test');
  const isForce = args.includes('--force');
  const singleId = args
    .find(a => a.startsWith('--id='))
    ?.replace('--id=', '');

  const manifest = loadManifest();
  const imageOverrides = loadArtistImageOverrides(projectRoot);
  let cache: ImageCache = loadCache();

  let targets = manifest.artists.filter(a => a.reviewStatus === 'ok');

  if (singleId) {
    targets = targets.filter(a => a.canonicalArtistId === singleId);
    if (targets.length === 0) {
      console.log(`Artist "${singleId}" not found in ok list.`);
      process.exit(1);
    }
  } else if (isTest) {
    const testIds = ['adele', 'aespa', 'alan-walker'];
    targets = targets.filter(a => testIds.includes(a.canonicalArtistId));
  }

  /** 全量 --force 才清空 cache；--test / --id 的 --force 只删掉目标 id，避免误删整库 */
  if (isForce) {
    if (singleId || isTest) {
      for (const a of targets) {
        delete cache[a.canonicalArtistId];
      }
    } else {
      cache = {};
    }
  }

  const spotifyReady = Boolean(
    process.env.SPOTIFY_CLIENT_ID?.trim() && process.env.SPOTIFY_CLIENT_SECRET?.trim(),
  );
  console.log(`\n=== Artist Image Fetch ===`);
  console.log(`Targets: ${targets.length} artists`);
  console.log(`Cache: ${Object.keys(cache).length} entries`);
  console.log(`Spotify: ${spotifyReady ? 'enabled (client credentials)' : 'disabled (set SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET)'}`);
  console.log(`Mode: ${isForce ? 'FORCE' : isTest ? 'TEST' : singleId ? `SINGLE(${singleId})` : 'FULL'}\n`);

  let fetched = 0;
  let skipped = 0;
  let succeeded = 0;
  let failed = 0;

  for (const artist of targets) {
    const id = artist.canonicalArtistId;

    if (shouldSkipAutoFetch(id, imageOverrides)) {
      skipped++;
      continue;
    }

    if (!isForce && cache[id]?.url && isValidArtistImageUrl(cache[id].url)) {
      skipped++;
      continue;
    }

    process.stdout.write(`[${fetched + skipped + 1}/${targets.length}] ${id} (${artist.displayName}) ... `);

    const entry = await fetchImageForArtist(id, artist.displayName);
    cache[id] = entry;
    fetched++;

    if (entry.url) {
      succeeded++;
      const src = entry.source ? ` [${entry.source}]` : '';
      console.log(`✓ ${entry.matchedName}${src} (conf: ${entry.confidence})`);
    } else {
      failed++;
      console.log(`✗ no match`);
    }

    await sleep(150);
  }

  saveCache(cache);

  for (const artist of manifest.artists) {
    const cached = cache[artist.canonicalArtistId];
    const merged = applyArtistImageToManifestArtist(artist.canonicalArtistId, cached, imageOverrides);
    artist.artistImageUrl = merged.url;
    artist.artistImageSource = merged.source;
    artist.artistImageConfidence = merged.confidence;
    artist.artistImageKind = merged.artistImageKind ?? null;
  }
  saveManifest(manifest);

  console.log(`\n=== Results ===`);
  console.log(`Fetched: ${fetched}  Skipped (cached): ${skipped}`);
  console.log(`Succeeded: ${succeeded}  Failed: ${failed}`);

  const allOk = manifest.artists.filter(a => a.reviewStatus === 'ok');
  const withImg = allOk.filter(a => a.artistImageUrl);
  const noImg = allOk.filter(a => !a.artistImageUrl);
  console.log(`\nTotal ok artists: ${allOk.length}`);
  console.log(`With image: ${withImg.length}`);
  console.log(`Still placeholder: ${noImg.length}`);
  if (noImg.length > 0) {
    console.log(`\nArtists without image:`);
    noImg.forEach(a => console.log(`  - ${a.canonicalArtistId} (${a.displayName})`));
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
