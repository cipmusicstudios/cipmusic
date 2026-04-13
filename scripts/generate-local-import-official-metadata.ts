/**
 * 官方元数据生成（含封面）。
 *
 * 封面策略：优先 Apple（含锚定曲目与高分搜索命中），再 Spotify 锚定，再 Spotify 搜索，最后 manual/prev/弱 Apple。
 * 凡采用 Apple Music / Spotify 可靠官方图时写入 coverLocked=true，后续运行不会覆盖（见 preserveLockedCover）。
 * 目标不是「全库 Spotify」，而是任一侧有可靠官方图即采用并锁定。
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { transliterate } from 'transliteration';
import { LOCAL_IMPORT_SEEDS } from '../src/local-import-seeds.generated';
import { LOCAL_IMPORT_METADATA_OVERRIDES } from '../src/local-import-metadata-overrides';
import { LOCAL_IMPORT_CIP_LINKS } from '../src/local-import-cip-links.generated';
import { LOCAL_IMPORT_OFFICIAL_METADATA as PREV_METADATA } from '../src/local-import-official-metadata.generated';
import { normalizeAndExtractArtists, ARTIST_DICTIONARY } from '../src/local-import-artist-normalization';

const ROOT = process.cwd();
const OUTPUT_FILE = path.join(ROOT, 'src/local-import-official-metadata.generated.ts');

const fetchText = (url: string) => {
  try {
    return execFileSync('curl', ['-L', '--max-time', '20', '--connect-timeout', '10', url], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return null;
  }
};

const safeParseJson = (text: string | null) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const buildArtworkUrl = (value: string | undefined) => (value ? value.replace(/\/100x100bb\.jpg$/, '/600x600bb.jpg') : undefined);

const normalize = (value: string | undefined) =>
  (value || '')
    .toLowerCase()
    .replace(/[“”"'‘’:()\-–—.,!?/\\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeComparableTitle = (value: string | undefined) =>
  normalize(
    transliterate(value || '')
      .replace(/[^A-Za-z0-9\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );

const tokenize = (value: string | undefined) => normalize(value).split(' ').filter(Boolean);

const titleTokenOverlap = (a: string, b: string) => {
  const aTokens = tokenize(normalizeComparableTitle(a)).filter(token => token.length >= 2);
  const bTokens = new Set(tokenize(normalizeComparableTitle(b)).filter(token => token.length >= 2));
  if (!aTokens.length || !bTokens.size) return 0;
  return aTokens.filter(token => bTokens.has(token)).length;
};

const cleanCipArtistSegment = (value: string | undefined) =>
  (value || '')
    .replace(/^(电影|電影)$/i, '')
    .replace(/^电影《[^》]+》\s*/i, '')
    .replace(/^電影《[^》]+》\s*/i, '')
    .replace(/^.+?(?:片头曲|片頭曲|片尾曲|主题曲|主題曲|插曲|OST)\s+/i, '')
    .replace(/^《[^》]+》\s*(?:OST|片头曲|片頭曲|片尾曲|主題曲|主题曲)\s*/i, '')
    .replace(/^“[^”]+”\s*(?:OST|Theme Song)\s*/i, '')
    .replace(/\s*[“"][^”"]+[”"]\s*Anthem\s*/i, ' ')
    .replace(/\s+\d{4}春晚歌曲.*$/i, '')
    .replace(/\s+(?:OST|片头曲|片頭曲|片尾曲|主題曲|主题曲).*$/i, '')
    .replace(/\s*\|\s*Piano by CIP Music.*$/i, '')
    .replace(/\s+钢琴版.*$/i, '')
    .replace(/\s+鋼琴版.*$/i, '')
    .replace(/\s+Piano Cover.*$/i, '')
    .replace(/\s+(?:theme song|opening|ending|插曲|片头曲|片頭曲|片尾曲|主题曲|主題曲).*$/i, '')
    .replace(/\s+-\s*$/g, '')
    .trim();

const stripDecorativeSongContext = (value: string | undefined) =>
  (value || '')
    .replace(/[“"'‘’]+/g, ' ')
    .replace(/\b(?:theme song|opening|ending|ost|soundtrack|piano cover)\b/gi, ' ')
    .replace(/\b(?:电视剧|電影|电影|片头曲|片頭曲|片尾曲|插曲|主题曲|主題曲)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const decodeHtmlEntities = (value: string | undefined) =>
  (value || '')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const extractIdentityFromCipTitle = (title: string | undefined) => {
  const decoded = decodeHtmlEntities(title || '').trim();
  if (!decoded) {
    return {
      artist: undefined,
      englishTitle: undefined,
      originalTitle: undefined,
    };
  }

  const angleBracketTitles = Array.from(decoded.matchAll(/《([^》]+)》/g))
    .map(match => match[1]?.trim())
    .filter(Boolean);
  const likelySongTitleInBrackets = (() => {
    if (!angleBracketTitles.length) return undefined;
    if (/^(电影|電影)《/.test(decoded) || /^《/.test(decoded)) {
      return angleBracketTitles.at(-1);
    }
    return angleBracketTitles[0];
  })();
  const leftOfDash = decoded.split(/\s+[—-]\s+/)[0]?.trim() || '';
  const trailingChineseArtist = leftOfDash.match(/([一-龥]{2,6})$/u)?.[1]?.trim();

  const artistMatch =
    decoded.match(/^《[^》]+》\s*(?:OST|片头曲|片頭曲|片尾曲|主題曲|主题曲)\s+(.+?)《/) ||
    decoded.match(/^(.+?)\s*《/) ||
    decoded.match(/^(.+?)\s*[“"'‘]([A-Za-z][^”"'’]*)[”"'’]/) ||
    decoded.match(/^(.+?)\s*-\s*[A-Za-z][A-Za-z0-9\s'&()\-]+?\s+Piano Cover/i) ||
    decoded.match(/^(.+?)\s*[—-]\s*[“"'‘]/) ||
    decoded.match(/^(.+?)\s*[—-]\s*《/) ||
    decoded.match(/^(.+?)\s*\[/);

  let artist = cleanCipArtistSegment(artistMatch?.[1]?.trim());
  if (
    artist &&
    trailingChineseArtist &&
    (artist.includes('《') || artist.includes('（') || artist.includes('(') || artist.length > trailingChineseArtist.length + 4)
  ) {
    artist = trailingChineseArtist;
  }
  if (!artist && leftOfDash && !leftOfDash.includes('《')) {
    artist = cleanCipArtistSegment(leftOfDash);
  }
  if (!artist && trailingChineseArtist) {
    artist = trailingChineseArtist;
  }
  const originalTitle = likelySongTitleInBrackets || decoded.match(/[「『]([^」』]+)[」』]/)?.[1]?.trim() || decoded.match(/[“"]([^”"]*[^\x00-\x7F][^”"]*)[”"]/)?.[1]?.trim();

  const dashEnglishTitle = decoded
    .match(/^\S.+?\s*-\s*([^|]+?)\s+Piano Cover/i)?.[1]
    ?.replace(/\s*[（(][^A-Za-z)]*[）)]/g, '')
    ?.replace(/\s+/g, ' ')
    ?.trim();

  const englishTitleCandidates = [
    angleBracketTitles.find(value => /[A-Za-z]/.test(value)),
    dashEnglishTitle,
  ].filter(Boolean);

  const englishTitle = englishTitleCandidates[0];

  return {
    artist: artist || undefined,
    englishTitle: englishTitle || undefined,
    originalTitle: originalTitle || undefined,
  };
};

const unique = (values: any[]) => Array.from(new Set(values.filter(Boolean)));

const scoreArtistMatch = (cipArtist: string | undefined, result: any) => {
  if (!cipArtist || !result) return 0;
  const normalizedArtists = normalizeAndExtractArtists(cipArtist);
  const resultArtistTokens = new Set(tokenize((result.artistName || '') + ' ' + (result.collectionArtistName || '')));
  let bestScore = 0;
  for (const norm of normalizedArtists) {
    const artistTokens = tokenize(norm.names.zhHans + ' ' + norm.names.en);
    const matches = artistTokens.filter(t => resultArtistTokens.has(t)).length;
    const score = (matches / Math.max(1, artistTokens.length)) * 100;
    if (score > bestScore) bestScore = score;
    const haystack = normalize((result.artistName || '') + ' ' + (result.collectionArtistName || ''));
    if (haystack.includes(normalize(norm.names.zhHans)) || haystack.includes(normalize(norm.names.en))) {
      bestScore = Math.max(bestScore, 90);
    }
  }
  return bestScore;
};

const isStrongTitleMatch = (identity: any, result: any) => {
  const trackName = normalize(result?.trackName);
  const collectionName = normalize(result?.collectionName);
  const comparableTrackName = normalizeComparableTitle(result?.trackName);
  const comparableCollectionName = normalizeComparableTitle(result?.collectionName);
  const candidates = [identity?.originalTitle, identity?.englishTitle].filter(Boolean).map(normalize);
  const comparableCandidates = [identity?.originalTitle, identity?.englishTitle].filter(Boolean).map(normalizeComparableTitle);

  return candidates.some(candidate => trackName === candidate || trackName.includes(candidate) || collectionName.includes(candidate)) ||
         comparableCandidates.some(candidate => comparableTrackName === candidate || comparableTrackName.includes(candidate) || comparableCollectionName.includes(candidate));
};

const mapCategory = (slug: string, result: any, cipIdentity: any, normalizedArtists: any[]) => {
  const primaryArtist = normalizedArtists[0];
  const genre = (result?.primaryGenreName || '').toLowerCase();
  
  const bag = normalize([
    genre,
    result?.trackName,
    result?.collectionName,
    result?.artistName,
    cipIdentity?.artist,
    cipIdentity?.originalTitle,
    cipIdentity?.englishTitle,
  ].filter(Boolean).join(' '));
  const bagTokens = new Set(tokenize(bag));

  const inferPrimary = () => {
    if (primaryArtist && primaryArtist.nationality !== 'other') {
      switch (primaryArtist.nationality) {
        case 'zh': return '华语流行';
        case 'kr': return '韩流流行';
        case 'jp': return '日系流行';
        case 'en': return '欧美流行';
      }
    }
    // Fallback based on genre signal if artist nationality is unknown
    if (genre.includes('k-pop') || genre.includes('kpop') || genre.includes('korean')) return '韩流流行';
    if (genre.includes('mandopop') || genre.includes('chinese') || genre.includes('cantopop')) return '华语流行';
    if (genre.includes('j-pop') || genre.includes('jpop') || genre.includes('japanese')) return '日系流行';
    if (genre.includes('pop') || genre.includes('rock') || genre.includes('alternative') || genre.includes('singer-songwriter')) return '欧美流行';
    return undefined;
  };

  const inferTags = (primary: string | undefined) => {
    const tags: string[] = [];
    const hasPhrase = (p: string) => bag.includes(normalize(p));
    if (hasPhrase('anime') || hasPhrase('your name') || hasPhrase('动漫')) tags.push('动漫');
    if (hasPhrase('film') || hasPhrase('movie') || hasPhrase('ost') || hasPhrase('soundtrack') || hasPhrase('片头曲') || hasPhrase('主题曲') || hasPhrase('opening') || hasPhrase('ending') || bagTokens.has('op') || bagTokens.has('ed')) tags.push('影视');
    if (hasPhrase('game') || hasPhrase('video game') || hasPhrase('league of legends')) tags.push('游戏');
    if (hasPhrase('instrumental') || hasPhrase('bgm') || hasPhrase('piano')) tags.push('纯音乐');
    return unique(tags).filter(tag => tag !== primary);
  };

  const mappedCategory = inferPrimary();
  return {
    rawCategory: result?.primaryGenreName,
    mappedCategory,
    mappedTags: inferTags(mappedCategory),
  };
};

const extractAppleMusicTrackId = (url: string | undefined) => {
  if (!url) return null;
  const match = url.match(/\/song\/[^/]+\/(\d+)/i) || url.match(/[?&]i=(\d+)/i);
  return match?.[1] || null;
};

const lookupAppleMusicTrack = (trackId: string | null) => {
  if (!trackId) return null;
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(trackId)}&entity=song`;
  const text = fetchText(url);
  const payload = safeParseJson(text);
  return payload?.results?.find((r: any) => r.wrapperType === 'track' || r.kind === 'song') || null;
};

const scoreAppleResult = (candidate: string, result: any) => {
  const queryTokens = tokenize(candidate);
  const haystack = normalize([result.trackName, result.collectionName, result.artistName].filter(Boolean).join(' '));
  let score = 0;
  for (const token of queryTokens) if (haystack.includes(token)) score += 8;
  if (normalize(result.trackName) === normalize(candidate)) score += 35;
  return score;
};

const pickBestAppleResult = (slug: string, seed: any, override: any, cipIdentity: any) => {
  const candidates = Array.from(
    new Set([
      override?.title,
      override?.displayTitle,
      override?.titles?.zhHans,
      override?.titles?.zhHant,
      override?.titles?.en,
      (LOCAL_IMPORT_CIP_LINKS as any)[seed.slug]?.matchTitle,
      cipIdentity.originalTitle,
      cipIdentity.englishTitle,
      seed.titleOverride,
      seed.slug,
    ].filter(Boolean)),
  ) as string[];
  let best: any = null;
  for (const title of candidates) {
    const queries = [
      cipIdentity.artist ? `${title} ${cipIdentity.artist}` : null,
      override?.artist ? `${title} ${override.artist}` : null,
      title,
    ].filter(Boolean) as string[];
    for (const query of queries) {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=5`;
      const payload = safeParseJson(fetchText(url));
      for (const result of (payload?.results || [])) {
        const score = scoreAppleResult(title, result) + scoreArtistMatch(cipIdentity.artist, result);
        if (!best || score > best.score) best = { score, result, cipIdentity };
      }
    }
  }
  return best;
};

// ── Spotify Web API: album art for tracks (preferred when SPOTIFY_CLIENT_ID/SECRET are set) ──

let spotifyTokenCache: { token: string; expiresAt: number } | null = null;
let spotify429Warned = false;
/** Next time a Spotify API call may start (global pacing to reduce 429). */
let spotifyNextSlot = 0;
const SPOTIFY_MIN_GAP_MS = Math.max(500, Number(process.env.SPOTIFY_REQUEST_GAP_MS ?? '2200') || 2200);
/** 同一首歌多次 Search 查询之间的额外间隔（毫秒）。 */
const SPOTIFY_SEARCH_INTER_QUERY_MS = Math.max(0, Number(process.env.SPOTIFY_SEARCH_INTER_QUERY_MS ?? '1400') || 1400);
/** Repeated non-429 failures (403/400/5xx/网络) — open circuit。 */
let spotifyNon429Failures = 0;
const SPOTIFY_NON429_CIRCUIT_MAX = (() => {
  const raw = process.env.SPOTIFY_NON429_CIRCUIT_MAX;
  if (raw === '0' || raw === 'off') return 1_000_000;
  const n = Number(raw ?? '40');
  return Number.isFinite(n) && n > 0 ? n : 40;
})();
let spotifyCircuitOpen = false;

/** RFC 7231 Retry-After：秒数或 HTTP-date；缺失时保守默认 60s；上限 1h 防异常值。 */
function parseRetryAfterMs(res: Response): number {
  const ra = res.headers.get('retry-after');
  if (!ra) return 60_000;
  const trimmed = ra.trim();
  if (/^\d+$/.test(trimmed)) {
    const sec = parseInt(trimmed, 10);
    return Math.min(Math.max(sec, 1) * 1000, 3_600_000);
  }
  const when = Date.parse(trimmed);
  if (!Number.isNaN(when)) {
    return Math.min(Math.max(when - Date.now(), 0), 3_600_000);
  }
  return 60_000;
}

/** 429 时最多休眠多久再重试 1 次（毫秒）。默认 90s，避免 Retry-After=3600 挂死终端；设 0 则不休眠、不重试并 circuit。 */
function spotify429MaxWaitCapMs(): number {
  const raw = process.env.SPOTIFY_429_MAX_WAIT_MS;
  if (raw === undefined || raw === '') return 90_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 90_000;
}

/**
 * Spotify Web API GET：请求间隔 + 429 时在 **SPOTIFY_429_MAX_WAIT_MS** 上限内休眠后**仅再试 1 次**。
 */
async function spotifyApiGet(token: string, url: string): Promise<Response> {
  if (spotifyCircuitOpen) {
    return new Response('', { status: 429, statusText: 'Too Many Requests' });
  }

  const runFetch = async (): Promise<Response> => {
    const now = Date.now();
    if (now < spotifyNextSlot) await new Promise((r) => setTimeout(r, spotifyNextSlot - now));
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    spotifyNextSlot = Date.now() + SPOTIFY_MIN_GAP_MS;
    return res;
  };

  let res = await runFetch();
  if (res.ok) {
    spotifyNon429Failures = 0;
    return res;
  }
  if (res.status === 401) {
    console.error('[spotify] Web API 401 Unauthorized（凭据或 token 对 api.spotify.com 无效）。中止。');
    process.exit(1);
  }
  if (res.status !== 429) {
    spotifyNon429Failures += 1;
    if (spotifyNon429Failures <= 3) {
      console.warn(`[spotify] Web API HTTP ${res.status}（非 429），若持续出现请检查应用权限或查询串。`);
    }
    if (spotifyNon429Failures >= SPOTIFY_NON429_CIRCUIT_MAX) {
      spotifyCircuitOpen = true;
      console.warn(
        '[spotify] circuit open: 多次非 429 错误 — 本 run 跳过 Spotify（请用 Apple / 上一版封面 / 稍后重试）。',
      );
    }
    return res;
  }

  const retryAfterMs = parseRetryAfterMs(res);
  const capMs = spotify429MaxWaitCapMs();
  if (capMs === 0) {
    if (!spotify429Warned) {
      spotify429Warned = true;
      console.warn(
        `[spotify] HTTP 429 — SPOTIFY_429_MAX_WAIT_MS=0：不等待、不重试；本 run 关闭 Spotify（服务端 Retry-After 约 ${(retryAfterMs / 1000).toFixed(0)}s，请冷却后再跑）。`,
      );
    }
    spotifyCircuitOpen = true;
    return res;
  }

  const waitMs = Math.min(retryAfterMs, capMs);
  if (!spotify429Warned) {
    spotify429Warned = true;
    console.warn(
      `[spotify] HTTP 429 — 将等待 ${(waitMs / 1000).toFixed(0)}s 后重试 1 次（上限 SPOTIFY_429_MAX_WAIT_MS=${capMs}ms；完整 Retry-After 为 ${(retryAfterMs / 1000).toFixed(0)}s）。`,
    );
  }
  await new Promise((r) => setTimeout(r, waitMs));

  res = await runFetch();
  if (res.ok) spotifyNon429Failures = 0;
  return res;
}

/**
 * 可选预检（默认关闭）。必须用单次 `fetch`，**不要**走 `spotifyApiGet`：
 * 否则首次 Search 若 429 会按 Retry-After 休眠整段（常见 3600s），预检阶段会无意义阻塞。
 */
async function spotifySearchPreflightOk(token: string): Promise<boolean> {
  try {
    const res = await fetch(
      'https://api.spotify.com/v1/search?q=' + encodeURIComponent('a') + '&type=track&limit=1&market=US',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.status === 429) {
      const w = parseRetryAfterMs(res);
      console.warn(
        `[spotify] 预检 429 — Retry-After ${(w / 1000).toFixed(0)}s，本 run 跳过 Spotify（请冷却后再试）。`,
      );
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

type SpotifySearchPolicy = {
  searchAll: boolean;
  prioritySlugs: Set<string>;
  priorityFile: string | null;
  /** 本 run 内允许 Spotify Search 的歌曲数上限；Infinity 表示不限制（仍仅在 priority 内，除非 searchAll）。 */
  batchLimit: number;
};

function loadSpotifySearchPolicy(): SpotifySearchPolicy {
  const searchAll = process.env.SPOTIFY_SEARCH_ALL === '1';
  const raw = process.env.SPOTIFY_PRIORITY_LIMIT;
  let batchLimit: number;
  if (raw === undefined || raw === '') {
    batchLimit = 50;
  } else {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) batchLimit = 50;
    else if (n === 0) batchLimit = Infinity;
    else batchLimit = n;
  }

  if (searchAll) {
    return { searchAll: true, prioritySlugs: new Set(), priorityFile: null, batchLimit: Infinity };
  }

  const file = process.env.SPOTIFY_PRIORITY_FILE
    ? path.resolve(ROOT, process.env.SPOTIFY_PRIORITY_FILE.trim())
    : path.join(ROOT, 'tmp/cover-categories.json');

  if (!fs.existsSync(file)) {
    console.warn(
      `[spotify] 未找到优先队列文件 ${path.relative(ROOT, file)} — 跳过 Spotify Search（仍会请求 officialLinks.spotify 单曲）。请先运行: npm run audit:cover-categories`,
    );
    return { searchAll: false, prioritySlugs: new Set(), priorityFile: null, batchLimit };
  }

  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { spotifyRefreshPrioritySlugs?: string[] };
    const arr = j.spotifyRefreshPrioritySlugs ?? [];
    return { searchAll: false, prioritySlugs: new Set(arr), priorityFile: file, batchLimit };
  } catch {
    console.warn(`[spotify] 无法解析 ${path.relative(ROOT, file)} — 跳过 Spotify Search。`);
    return { searchAll: false, prioritySlugs: new Set(), priorityFile: file, batchLimit };
  }
}

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
    console.warn('[spotify] token', (e as Error)?.message);
    return null;
  }
}

function extractSpotifyTrackIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m =
    url.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([a-zA-Z0-9]+)/) ||
    url.match(/spotify:track:([a-zA-Z0-9]+)/);
  return m?.[1] ?? null;
}

function pickSpotifyAlbumImage(images: { url: string; width?: number }[] | undefined): string | null {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const u = sorted[0]?.url?.trim();
  return u && /^https:\/\//i.test(u) ? u : null;
}

function normSpotify(s: string | undefined): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type SpotifyScoreDetail = {
  total: number;
  titleMax: number;
  artistPts: number;
  artistMatched: boolean;
  titleExact: boolean;
};

function scoreSpotifyTrackDetailed(
  track: { name: string; artists: { name: string }[] },
  titleCandidates: string[],
  artistCandidates: string[],
): SpotifyScoreDetail {
  const tn = normSpotify(track.name);
  const an = track.artists.map((a) => normSpotify(a.name)).join(' ');
  let titleMax = 0;
  let titleExact = false;
  for (const t of titleCandidates) {
    const nt = normSpotify(t);
    if (!nt) continue;
    if (tn === nt) {
      titleMax = Math.max(titleMax, 120);
      titleExact = true;
    } else if (tn.includes(nt) || nt.includes(tn)) {
      titleMax = Math.max(titleMax, 72);
    } else {
      titleMax = Math.max(titleMax, titleTokenOverlap(t, track.name) * 6);
    }
  }
  let artistPts = 0;
  let artistMatched = false;
  for (const ar of artistCandidates) {
    const na = normSpotify(ar);
    if (!na || na.length < 2) continue;
    if (an.includes(na) || na.split(/\s+/).some((w) => w.length > 1 && an.includes(w))) {
      artistMatched = true;
      artistPts += 55;
    }
  }
  const total = titleMax + Math.min(artistPts, 110);
  return { total, titleMax, artistPts, artistMatched, titleExact };
}

function hasStrongArtistHint(artistCandidates: string[]): boolean {
  return artistCandidates.some((a) => normSpotify(a).length >= 2);
}

/** YouTube / placeholder / obvious bad Apple thumbs — prefer replacing via Spotify when possible. */
function isSuspiciousCoverUrl(u: string | undefined): boolean {
  if (!u) return true;
  const x = u.toLowerCase();
  if (/ytimg\.com|\.ggpht\.com|googleusercontent\.com/i.test(x)) return true;
  if (/youtube\.com\//i.test(x)) return true;
  if (/placeholder|via\.placeholder|picsum\.photos|dummyimage\./i.test(x)) return true;
  if (/gravatar\.com\/avatar/i.test(x)) return true;
  if (/mzstatic\.com/i.test(x) && /untitled\.jpg/i.test(x)) return true;
  return false;
}

function classifySpotifySearchPick(
  best: { coverUrl: string | null; detail: SpotifyScoreDetail },
  second: { detail: SpotifyScoreDetail } | null,
  hasArtistHint: boolean,
): { ok: boolean; uncertain: boolean } {
  if (!best.coverUrl) return { ok: false, uncertain: false };
  const d = best.detail;
  const gap = second ? d.total - second.detail.total : 100;
  if (gap < 10) return { ok: false, uncertain: true };
  if (d.total < 90) return { ok: false, uncertain: d.total >= 78 };
  if (hasArtistHint) {
    if (!d.artistMatched && !d.titleExact) return { ok: false, uncertain: false };
    if (!d.artistMatched && d.titleMax <= 72) return { ok: false, uncertain: true };
  }
  if (d.total < 108 && !d.artistMatched && !d.titleExact) return { ok: false, uncertain: true };
  return { ok: true, uncertain: false };
}

/** Only for replacing known-bad artwork — stricter artist + title floor, looser gap. */
function classifySpotifySearchPickRelaxed(
  best: { coverUrl: string | null; detail: SpotifyScoreDetail },
  second: { detail: SpotifyScoreDetail } | null,
  hasArtistHint: boolean,
): boolean {
  if (!best.coverUrl) return false;
  const d = best.detail;
  const gap = second ? d.total - second.detail.total : 100;
  if (gap < 8) return false;
  if (d.total < 80) return false;
  if (!hasArtistHint) return d.titleExact && d.total >= 95;
  return d.artistMatched && d.titleMax >= 48;
}

async function fetchSpotifyTrackCoverById(
  token: string,
  trackId: string,
): Promise<{ coverUrl: string | null; externalUrl: string | null }> {
  try {
    const res = await spotifyApiGet(
      token,
      `https://api.spotify.com/v1/tracks/${encodeURIComponent(trackId)}?market=US`,
    );
    if (!res.ok) return { coverUrl: null, externalUrl: null };
    const j = (await res.json()) as {
      album?: { images?: { url: string; width?: number }[] };
      external_urls?: { spotify?: string };
    };
    return {
      coverUrl: pickSpotifyAlbumImage(j.album?.images),
      externalUrl: j.external_urls?.spotify ?? null,
    };
  } catch {
    return { coverUrl: null, externalUrl: null };
  }
}

async function searchSpotifyBestTrackCover(
  token: string,
  titleCandidates: string[],
  artistCandidates: string[],
): Promise<{
  coverUrl: string | null;
  externalUrl: string | null;
  best: { track: any; detail: SpotifyScoreDetail } | null;
  second: { detail: SpotifyScoreDetail } | null;
}> {
  const titles = [...new Set(titleCandidates.filter(Boolean))].slice(0, 6);
  const artists = [...new Set(artistCandidates.filter(Boolean))].slice(0, 4);
  const byTrackId = new Map<string, { track: any; detail: SpotifyScoreDetail }>();

  const considerItems = (items: any[] | undefined) => {
    for (const tr of items ?? []) {
      const id = tr?.id as string | undefined;
      if (!id) continue;
      const detail = scoreSpotifyTrackDetailed(tr, titles, artists);
      const prev = byTrackId.get(id);
      if (!prev || detail.total > prev.detail.total) byTrackId.set(id, { track: tr, detail });
    }
  };

  const fetchSearch = async (q: string) => {
    if (!q.trim()) return;
    try {
      const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=15&market=US`;
      const res = await spotifyApiGet(token, url);
      if (!res.ok) return;
      const j = (await res.json()) as { tracks?: { items?: any[] } };
      considerItems(j.tracks?.items);
    } catch {
      /* next query */
    }
    if (SPOTIFY_SEARCH_INTER_QUERY_MS > 0) {
      await new Promise((r) => setTimeout(r, SPOTIFY_SEARCH_INTER_QUERY_MS));
    }
  };

  const t0 = titles[0] || '';
  const a0 = artists[0] || '';
  if (t0 && a0) await fetchSearch(`track:"${t0}" artist:"${a0}"`);
  const rankedMid = [...byTrackId.values()].sort((a, b) => b.detail.total - a.detail.total);
  const topMid = rankedMid[0]?.detail.total ?? 0;
  if (topMid < 95 && t0 && a0) await fetchSearch(`${t0} ${a0}`);
  const ranked2 = [...byTrackId.values()].sort((a, b) => b.detail.total - a.detail.total);
  const top2 = ranked2[0]?.detail.total ?? 0;
  if (top2 < 85 && t0) await fetchSearch(t0);

  const ranked = [...byTrackId.values()].sort((a, b) => b.detail.total - a.detail.total);
  const b0 = ranked[0];
  const b1 = ranked[1];
  if (!b0) return { coverUrl: null, externalUrl: null, best: null, second: null };
  return {
    coverUrl: pickSpotifyAlbumImage(b0.track.album?.images),
    externalUrl: b0.track.external_urls?.spotify ?? null,
    best: b0,
    second: b1 ? { detail: b1.detail } : null,
  };
}

const main = async () => {
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  const partial = Boolean(id || secret) && !(id && secret);
  if (partial) {
    console.error('[spotify] 配置不完整：需要同时设置 SPOTIFY_CLIENT_ID 与 SPOTIFY_CLIENT_SECRET。');
    process.exit(1);
  }
  if (!id || !secret) {
    console.error('[spotify] 未读取到 SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET（请在项目根 .env 配置）。');
    process.exit(1);
  }
  const spotifyTokenProbe = await getSpotifyAccessToken();
  if (!spotifyTokenProbe) {
    console.error('[spotify] access token 获取失败，请检查密钥与网络。');
    process.exit(1);
  }
  console.log('[spotify] 已读取 SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET；access token 获取成功。');
  const spotifyToken = spotifyTokenProbe;

  const spotifySearchPolicy = loadSpotifySearchPolicy();
  if (spotifySearchPolicy.searchAll) {
    console.log(
      `[spotify] Search 模式：全库（SPOTIFY_SEARCH_ALL=1）。429 重试等待受 SPOTIFY_429_MAX_WAIT_MS 上限约束（默认 90s）；间隔仍受 SPOTIFY_REQUEST_GAP_MS 等约束。`,
    );
  } else if (spotifySearchPolicy.prioritySlugs.size > 0) {
    const lim = Number.isFinite(spotifySearchPolicy.batchLimit)
      ? `${spotifySearchPolicy.batchLimit} 首/本 run`
      : '不限制（仅队列内）';
    console.log(
      `[spotify] Search 模式：分批优先队列 | 队列 ${spotifySearchPolicy.prioritySlugs.size} 条（${path.relative(ROOT, spotifySearchPolicy.priorityFile || '')}）| 本 run Search 上限 ${lim}。全库请设 SPOTIFY_SEARCH_ALL=1。`,
    );
  }

  let spotifyPreflightPassed: boolean | null = null;
  if (process.env.SPOTIFY_PREFLIGHT === '1') {
    const preOk = await spotifySearchPreflightOk(spotifyToken);
    spotifyPreflightPassed = preOk;
    if (!preOk) {
      spotifyCircuitOpen = true;
      console.warn(
        '[spotify] 预检未通过 — 不跑全量生成、不改写 local-import-official-metadata.generated.ts（避免无意义重写）。限流恢复后去掉 429 再设 SPOTIFY_PREFLIGHT=1 重试。',
      );
      console.log(`[spotify] 退出码 0；输出文件未修改：${path.relative(ROOT, OUTPUT_FILE)}`);
      return;
    }
    console.log('[spotify] 预检通过（SPOTIFY_PREFLIGHT=1）。');
  }

  const prevAll = PREV_METADATA as Record<
    string,
    {
      cover?: string;
      officialSource?: string;
      officialUrl?: string;
      coverLocked?: boolean;
      coverSource?: string;
      coverUncertain?: boolean;
    }
  >;

  const generated: any = {};
  let spotifyCovers = 0;
  let appleCovers = 0;
  let keptManualCovers = 0;
  let retainedPreviousCovers = 0;
  let noCoverCount = 0;
  let preservedLockedCovers = 0;
  const uncertainSlugs: string[] = [];
  let spotifySearchBudgetUsed = 0;
  let spotifySearchRunCount = 0;

  const takeSpotifySearchSlot = (slug: string): boolean => {
    if (spotifyCircuitOpen) return false;
    if (spotifySearchPolicy.searchAll) return true;
    if (!spotifySearchPolicy.prioritySlugs.has(slug)) return false;
    if (
      Number.isFinite(spotifySearchPolicy.batchLimit) &&
      spotifySearchBudgetUsed >= (spotifySearchPolicy.batchLimit as number)
    ) {
      return false;
    }
    spotifySearchBudgetUsed += 1;
    return true;
  };

  for (const seed of LOCAL_IMPORT_SEEDS) {
    const override = LOCAL_IMPORT_METADATA_OVERRIDES[seed.slug];
    const cipLinks = (LOCAL_IMPORT_CIP_LINKS as any)[seed.slug];
    const cipIdentity = extractIdentityFromCipTitle(cipLinks?.matchedVideoTitle);
    const prev = prevAll[seed.slug];
    const prevCover = prev?.cover;
    const prevSource = prev?.officialSource;
    const prevOfficialUrl = prev?.officialUrl;

    const minScoreApple = cipIdentity.artist || override?.artist ? 40 : 50;
    let finalResult: any = null;
    let appleMatchScore = 0;
    const anchoredTrackId = extractAppleMusicTrackId(override?.officialLinks?.appleMusic);
    if (anchoredTrackId) {
      finalResult = lookupAppleMusicTrack(anchoredTrackId);
      appleMatchScore = finalResult ? 100 : 0;
    } else {
      const best = pickBestAppleResult(seed.slug, seed, override, cipIdentity);
      if (best && best.score >= minScoreApple) {
        finalResult = best.result;
        appleMatchScore = best.score;
      }
    }

    const rawArtistString =
      override?.artist ||
      override?.artists?.zhHans ||
      override?.artists?.en ||
      cipIdentity.artist ||
      finalResult?.artistName ||
      seed.slug;
    const normalizedArtistsInfo = normalizeAndExtractArtists(rawArtistString);
    const primaryArtist = normalizedArtistsInfo[0];

    const titleCandidates = Array.from(
      new Set(
        [
          override?.title,
          override?.displayTitle,
          override?.titles?.zhHans,
          override?.titles?.zhHant,
          override?.titles?.en,
          cipLinks?.matchTitle,
          cipIdentity.originalTitle,
          cipIdentity.englishTitle,
          seed.titleOverride,
          seed.slug,
        ].filter(Boolean) as string[],
      ),
    );
    const artistCandidates = Array.from(
      new Set(
        [
          override?.artist,
          override?.artists?.zhHans,
          override?.artists?.en,
          cipIdentity.artist,
          rawArtistString,
          primaryArtist?.names?.zhHans,
          primaryArtist?.names?.en,
        ].filter(Boolean) as string[],
      ),
    );
    const hasArtistHint = hasStrongArtistHint(artistCandidates);
    const manualCover = override?.cover;

    let coverUrl: string | undefined;
    let officialSource: string = 'pending';
    let officialUrlOut: string | undefined = finalResult?.trackViewUrl;
    let coverSourceOut: string | undefined;
    let coverLockedOut = false;
    let coverUncertainOut = false;

    const appleArtwork = finalResult?.artworkUrl100 ? buildArtworkUrl(finalResult.artworkUrl100) : undefined;
    const appleTrustworthy =
      Boolean(anchoredTrackId) || appleMatchScore >= Math.max(minScoreApple + 8, 52);

    const prevRow = prev;
    const preserveLockedCover =
      Boolean(prevRow?.coverLocked && prevRow.cover?.trim() && !override?.suppressOfficialCover);

    if (override?.suppressOfficialCover) {
      coverUrl = manualCover;
      officialSource = manualCover ? 'manual' : 'suppressed';
      if (!manualCover) noCoverCount += 1;
    } else if (preserveLockedCover) {
      coverUrl = prevRow!.cover;
      officialSource =
        prevRow!.officialSource && prevRow!.officialSource !== 'pending'
          ? prevRow!.officialSource!
          : 'retained';
      officialUrlOut = prevRow!.officialUrl ?? officialUrlOut;
      coverSourceOut =
        prevRow!.coverSource ||
        (prevRow!.officialSource === 'spotify'
          ? 'spotify'
          : prevRow!.officialSource === 'appleMusic'
            ? 'apple'
            : undefined);
      coverLockedOut = true;
      if (prevRow!.coverUncertain) coverUncertainOut = true;
      preservedLockedCovers += 1;
    } else {
      const spotifyOvId = extractSpotifyTrackIdFromUrl(override?.officialLinks?.spotify);
      let spFromId: { coverUrl: string | null; externalUrl: string | null } = { coverUrl: null, externalUrl: null };
      if (spotifyOvId) {
        spFromId = await fetchSpotifyTrackCoverById(spotifyToken, spotifyOvId);
      }

      const tryApplePrimary =
        appleArtwork && appleTrustworthy && !isSuspiciousCoverUrl(appleArtwork);

      if (tryApplePrimary) {
        coverUrl = appleArtwork;
        officialSource = 'appleMusic';
        officialUrlOut = finalResult?.trackViewUrl;
        appleCovers += 1;
        coverSourceOut = 'apple';
        coverLockedOut = true;
      } else if (spFromId.coverUrl) {
        coverUrl = spFromId.coverUrl ?? undefined;
        officialSource = 'spotify';
        if (spFromId.externalUrl) officialUrlOut = spFromId.externalUrl;
        spotifyCovers += 1;
        coverSourceOut = 'spotify';
        coverLockedOut = true;
      } else {
        let spSearch: Awaited<ReturnType<typeof searchSpotifyBestTrackCover>> = {
          coverUrl: null,
          externalUrl: null,
          best: null,
          second: null,
        };
        if (takeSpotifySearchSlot(seed.slug)) {
          spotifySearchRunCount += 1;
          spSearch = await searchSpotifyBestTrackCover(spotifyToken, titleCandidates, artistCandidates);
        }

        let usedSpotify = false;
        if (spSearch.coverUrl && spSearch.best) {
          const strict = classifySpotifySearchPick(
            { coverUrl: spSearch.coverUrl, detail: spSearch.best.detail },
            spSearch.second,
            hasArtistHint,
          );
          let ok = strict.ok;
          let markUncertain = strict.uncertain;
          const wantReplaceBad =
            isSuspiciousCoverUrl(manualCover) ||
            isSuspiciousCoverUrl(prevCover) ||
            (prevSource === 'appleMusic' && isSuspiciousCoverUrl(prevCover));
          if (!ok && wantReplaceBad) {
            if (
              classifySpotifySearchPickRelaxed(
                { coverUrl: spSearch.coverUrl, detail: spSearch.best.detail },
                spSearch.second,
                hasArtistHint,
              )
            ) {
              ok = true;
              markUncertain = true;
            }
          }
          if (markUncertain) uncertainSlugs.push(seed.slug);
          if (ok) {
            coverUrl = spSearch.coverUrl ?? undefined;
            officialSource = 'spotify';
            if (spSearch.externalUrl) officialUrlOut = spSearch.externalUrl;
            spotifyCovers += 1;
            usedSpotify = true;
            coverSourceOut = 'spotify';
            coverLockedOut = !markUncertain;
            if (markUncertain) coverUncertainOut = true;
          }
        }

        if (!usedSpotify) {
          if (manualCover && !isSuspiciousCoverUrl(manualCover)) {
            coverUrl = manualCover;
            officialSource = 'manual';
            keptManualCovers += 1;
          } else if (prevCover && !isSuspiciousCoverUrl(prevCover)) {
            coverUrl = prevCover;
            officialSource = prevSource && prevSource !== 'pending' ? prevSource : 'retained';
            officialUrlOut = prevOfficialUrl ?? officialUrlOut;
            retainedPreviousCovers += 1;
          } else if (manualCover) {
            coverUrl = manualCover;
            officialSource = 'manual';
            keptManualCovers += 1;
            uncertainSlugs.push(seed.slug);
          } else if (appleArtwork) {
            coverUrl = appleArtwork;
            officialSource = 'appleMusic';
            officialUrlOut = finalResult?.trackViewUrl;
            appleCovers += 1;
            uncertainSlugs.push(seed.slug);
            coverSourceOut = 'apple';
            coverUncertainOut = true;
          } else {
            noCoverCount += 1;
          }
        }
      }
    }

    // Final check for category mapping
    const { rawCategory, mappedCategory, mappedTags } = mapCategory(seed.slug, finalResult, cipIdentity, normalizedArtistsInfo);

    const finalMappedCategory = override?.category || mappedCategory || 'Uncategorized';
    const finalMappedTags = unique([...(override?.categoryTags || []), ...(mappedTags || []), '纯音乐']).filter(tag => tag !== finalMappedCategory);

    const rowOut: Record<string, unknown> = {
      officialStatus: coverUrl || finalResult ? 'confirmed' : 'pending',
      cover: coverUrl,
      artist: primaryArtist ? (primaryArtist.names.zhHans || primaryArtist.names.en) : rawArtistString,
      normalizedArtistsInfo,
      rawCategory,
      mappedCategory: finalMappedCategory,
      mappedTags: finalMappedTags,
      officialSource,
      officialUrl: officialUrlOut,
    };
    if (coverSourceOut) rowOut.coverSource = coverSourceOut;
    if (coverLockedOut) rowOut.coverLocked = true;
    if (coverUncertainOut) rowOut.coverUncertain = true;
    generated[seed.slug] = rowOut;
    await new Promise((r) => setTimeout(r, 120));
  }

  const total = Object.keys(generated).length;
  const uncertainUnique = [...new Set(uncertainSlugs)];
  const spotifyMiss = total - spotifyCovers;

  let upgradedToSpotifyThisRun = 0;
  /** 原先有封面但 officialSource 非 spotify，本轮改为 Spotify 官方图 */
  let replacedNonSpotifyCoverWithSpotify = 0;
  for (const seed of LOCAL_IMPORT_SEEDS) {
    const prev = prevAll[seed.slug];
    const cur = generated[seed.slug] as { officialSource?: string; cover?: string };
    if (cur.officialSource !== 'spotify') continue;
    if (prev?.officialSource !== 'spotify') upgradedToSpotifyThisRun += 1;
    const hadCover = Boolean(prev?.cover?.trim());
    if (hadCover && prev?.officialSource !== 'spotify') replacedNonSpotifyCoverWithSpotify += 1;
  }

  let priorityQueueStillWithoutSpotify = 0;
  if (!spotifySearchPolicy.searchAll && spotifySearchPolicy.prioritySlugs.size > 0) {
    for (const slug of spotifySearchPolicy.prioritySlugs) {
      const cur = generated[slug] as { officialSource?: string } | undefined;
      if (cur?.officialSource !== 'spotify') priorityQueueStillWithoutSpotify += 1;
    }
  }

  const output = `export const LOCAL_IMPORT_OFFICIAL_METADATA = ${JSON.stringify(generated, null, 2)} as const;\n`;
  fs.writeFileSync(OUTPUT_FILE, output, 'utf8');

  const report = {
    totalSongs: total,
    spotifyAccessTokenOk: true,
    spotifyPreflightRan: process.env.SPOTIFY_PREFLIGHT === '1',
    spotifyPreflightPassed,
    /** 预检未失败且运行中未出现 429、未因错误断开 Spotify 线路时视为 Search 可用 */
    spotifySearchLikelyStableThisRun:
      spotifyPreflightPassed !== false && !spotify429Warned && !spotifyCircuitOpen,
    spotify429ObservedThisRun: spotify429Warned,
    spotifyCircuitOpenAtEnd: spotifyCircuitOpen,
    spotifyOfficialCovers: spotifyCovers,
    spotifyUpgradedToSpotifyThisRun: upgradedToSpotifyThisRun,
    spotifyReplacedPreviousNonSpotifyCoverThisRun: replacedNonSpotifyCoverWithSpotify,
    preservedLockedCoversSkippedRegenerate: preservedLockedCovers,
    spotifyPriorityQueueSize: spotifySearchPolicy.searchAll ? 0 : spotifySearchPolicy.prioritySlugs.size,
    spotifyPriorityQueueStillWithoutSpotifyAfterRun: priorityQueueStillWithoutSpotify,
    spotifySearchMode: spotifySearchPolicy.searchAll
      ? 'all'
      : spotifySearchPolicy.prioritySlugs.size > 0
        ? 'priority_batch'
        : 'search_off',
    spotifySearchPrioritySlotsUsed: spotifySearchBudgetUsed,
    spotifySearchRunCount,
    spotifySearchBatchLimit: Number.isFinite(spotifySearchPolicy.batchLimit)
      ? spotifySearchPolicy.batchLimit
      : 'unlimited',
    keptManualOverride: keptManualCovers,
    retainedPreviousCover: retainedPreviousCovers,
    appleFallbackThisRun: appleCovers,
    noCover: noCoverCount,
    noSpotifyCoverThisRun: spotifyMiss,
    uncertainReviewCount: uncertainUnique.length,
    uncertainSlugsSample: uncertainUnique.slice(0, 80),
    outputFile: path.relative(ROOT, OUTPUT_FILE),
  };
  console.log(`Generated metadata for ${total} songs.`);
  console.log('[report:official-metadata]', JSON.stringify(report, null, 2));
};

main().catch(console.error);
