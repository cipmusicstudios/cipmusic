/**
 * 仅处理「封面稳定性报告」第 3 类（未形成锁定官方图 / 需人工）中的条目：
 * 1) 若已有可靠 Apple（mzstatic）且元数据已标明 apple，则只补 coverLocked / coverSource，不改其他字段；
 * 2) 否则请求 Spotify（先锚定 officialLinks.spotify 曲目，再 Search），命中可靠则写入封面并锁定；
 * 3) 不修改 artist、category、tags、normalizedArtistsInfo 等；不碰 overrides.cover、suppressOfficialCover、已 coverLocked；
 * 4) 写入前校验：非待处理 slug 与改前 deepEqual。
 *
 * 用法: npx tsx scripts/cover-incremental-pending-official.ts
 * 需要: .env 中 SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { LOCAL_IMPORT_OFFICIAL_METADATA } from '../src/local-import-official-metadata.generated';
import { LOCAL_IMPORT_METADATA_OVERRIDES } from '../src/local-import-metadata-overrides';
import { LOCAL_IMPORT_CIP_LINKS } from '../src/local-import-cip-links.generated';
import { LOCAL_IMPORT_SEEDS } from '../src/local-import-seeds.generated';

const ROOT = process.cwd();
const OUT_META = path.join(ROOT, 'src/local-import-official-metadata.generated.ts');
const OUT_REPORT = path.join(ROOT, 'tmp/cover-incremental-pending-report.md');

type Row = Record<string, unknown> & {
  cover?: string;
  officialSource?: string;
  coverSource?: string;
  coverLocked?: boolean;
  coverUncertain?: boolean;
  officialUrl?: string;
  officialStatus?: string;
};

const unique = <T>(a: T[]) => Array.from(new Set(a.filter(Boolean) as T[]));

const isMzOrSpotify = (u: string | undefined) => {
  if (!u?.trim()) return false;
  const x = u.toLowerCase();
  return /mzstatic\.com\/image|i\.scdn\.co\/image/.test(x);
};

/** 与 cover-stability-report.ts 一致：得到「第 3 类」slug 列表 */
function computeNeedsManual(meta: Record<string, Row>): { slug: string; why: string }[] {
  const needsManual: { slug: string; why: string }[] = [];
  for (const slug of Object.keys(meta)) {
    const row = meta[slug];
    const cov = typeof row.cover === 'string' ? row.cover.trim() : '';
    const src = (row.officialSource as string) || '';
    const cs = (row.coverSource as string) || '';
    const locked = row.coverLocked === true;

    const isAppleRow =
      locked && (cs === 'apple' || cs === 'appleMusic' || src === 'appleMusic');
    const isSpotifyRow = locked && (cs === 'spotify' || src === 'spotify');

    if (isAppleRow || isSpotifyRow) continue;

    let why: string;
    if (!cov) {
      why = '无封面';
    } else if (locked && !isAppleRow && !isSpotifyRow) {
      why = `已锁定但非 Apple/Spotify 商店源（officialSource=${src}, coverSource=${cs || '—'}）`;
    } else if (!locked && (src === 'appleMusic' || src === 'spotify') && isMzOrSpotify(cov)) {
      why = `有 ${src} 图但未锁定`;
    } else if (src === 'manual' || LOCAL_IMPORT_METADATA_OVERRIDES[slug]?.cover) {
      why = 'manual / overrides.cover';
    } else if (/project_art|video_thumbnail|youtube|placeholder/i.test(cs + src)) {
      why = `非商店来源（${cs || src || 'unknown'}）`;
    } else if (src === 'pending' || !src) {
      why = 'pending / 无 officialSource';
    } else if (!isMzOrSpotify(cov)) {
      why = `非 mzstatic/scdn 封面（${src}）`;
    } else {
      why = `未锁定（officialSource=${src}, coverSource=${cs || '—'}）`;
    }
    needsManual.push({ slug, why });
  }
  return needsManual;
}

const SEED_BY_SLUG = Object.fromEntries(LOCAL_IMPORT_SEEDS.map((s) => [s.slug, s]));

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

const tokenize = (value: string | undefined) =>
  (value || '')
    .toLowerCase()
    .replace(/[""''「」:()\-–—.,!?/\\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

const titleTokenOverlap = (a: string, b: string) => {
  const aTokens = tokenize(a).filter((t) => t.length >= 2);
  const bTokens = new Set(tokenize(b).filter((t) => t.length >= 2));
  if (!aTokens.length || !bTokens.size) return 0;
  return aTokens.filter((t) => bTokens.has(t)).length;
};

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

let spotifyTokenCache: { token: string; expiresAt: number } | null = null;
const GAP_MS = Math.max(500, Number(process.env.SPOTIFY_REQUEST_GAP_MS ?? '2200') || 2200);
let spotifyNextSlot = 0;

async function getSpotifyAccessToken(): Promise<string | null> {
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  if (spotifyTokenCache && Date.now() < spotifyTokenCache.expiresAt - 60_000) {
    return spotifyTokenCache.token;
  }
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`, 'utf8').toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) return null;
  const expiresIn = j.expires_in ?? 3600;
  spotifyTokenCache = { token: j.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  return spotifyTokenCache.token;
}

async function spotifyApiGet(token: string, url: string): Promise<Response> {
  const now = Date.now();
  if (now < spotifyNextSlot) await new Promise((r) => setTimeout(r, spotifyNextSlot - now));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  spotifyNextSlot = Date.now() + GAP_MS;
  return res;
}

async function fetchSpotifyTrackCoverById(
  token: string,
  trackId: string,
): Promise<{ coverUrl: string | null; externalUrl: string | null }> {
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
}

const SPOTIFY_SEARCH_INTER_QUERY_MS = Math.max(
  0,
  Number(process.env.SPOTIFY_SEARCH_INTER_QUERY_MS ?? '1400') || 1400,
);

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
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=15&market=US`;
    const res = await spotifyApiGet(token, url);
    if (!res.ok) return;
    const j = (await res.json()) as { tracks?: { items?: any[] } };
    considerItems(j.tracks?.items);
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

function buildTitleArtistCandidates(slug: string): { titles: string[]; artists: string[] } {
  const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug];
  const cip = (LOCAL_IMPORT_CIP_LINKS as Record<string, { matchTitle?: string } | undefined>)[slug];
  const seed = SEED_BY_SLUG[slug];
  const row = LOCAL_IMPORT_OFFICIAL_METADATA[slug] as Row | undefined;

  const titles = unique([
    ov?.title,
    ov?.displayTitle,
    ov?.titles?.zhHans,
    ov?.titles?.zhHant,
    ov?.titles?.en,
    cip?.matchTitle,
    seed?.titleOverride,
    slug,
  ].filter(Boolean) as string[]);

  const artists = unique(
    [ov?.artist, ov?.artists?.zhHans, ov?.artists?.en, row?.artist as string | undefined].filter(
      Boolean,
    ) as string[],
  );

  return { titles, artists };
}

function canLockExistingApple(row: Row): boolean {
  if (row.coverLocked) return false;
  const cov = typeof row.cover === 'string' ? row.cover.trim() : '';
  if (!cov || !/mzstatic\.com\/image/i.test(cov)) return false;
  const src = (row.officialSource as string) || '';
  const cs = (row.coverSource as string) || '';
  const url = (row.officialUrl as string) || '';
  if (src === 'appleMusic' || cs === 'apple' || cs === 'appleMusic') return true;
  if (url.includes('music.apple.com')) return true;
  return false;
}

function applyAppleLockOnly(row: Row) {
  row.coverLocked = true;
  /** mzstatic 即 Apple CDN；覆盖 pilot 遗留的 project_art 标签，避免无法归入「Apple 已锁定」 */
  row.coverSource = 'apple';
  row.officialSource = 'appleMusic';
  row.officialStatus = 'confirmed';
}

function applySpotifyLock(row: Row, coverUrl: string, externalUrl: string | null) {
  row.cover = coverUrl;
  row.coverSource = 'spotify';
  row.coverLocked = true;
  row.officialSource = 'spotify';
  row.officialUrl = externalUrl ?? row.officialUrl;
  row.coverUncertain = false;
  row.officialStatus = 'confirmed';
}

function classifyAfterRun(meta: Record<string, Row>) {
  const appleLocked: string[] = [];
  const spotifyLocked: string[] = [];
  const stillManual: { slug: string; why: string }[] = [];

  for (const slug of Object.keys(meta).sort()) {
    const row = meta[slug];
    const cov = typeof row.cover === 'string' ? row.cover.trim() : '';
    const src = (row.officialSource as string) || '';
    const cs = (row.coverSource as string) || '';
    const locked = row.coverLocked === true;

    const isAppleRow =
      locked && (cs === 'apple' || cs === 'appleMusic' || src === 'appleMusic');
    const isSpotifyRow = locked && (cs === 'spotify' || src === 'spotify');

    if (isAppleRow) {
      appleLocked.push(slug);
      continue;
    }
    if (isSpotifyRow) {
      spotifyLocked.push(slug);
      continue;
    }

    let why: string;
    if (!cov) why = '无封面';
    else if (src === 'manual' || LOCAL_IMPORT_METADATA_OVERRIDES[slug]?.cover) why = 'manual / overrides.cover';
    else if (/project_art|video_thumbnail|youtube|placeholder/i.test(cs + src)) {
      why = `非商店来源（${cs || src || 'unknown'}）`;
    } else if (!isMzOrSpotify(cov)) why = `非 mzstatic/scdn（${src}）`;
    else why = `未锁定（officialSource=${src}, coverSource=${cs || '—'}）`;
    stillManual.push({ slug, why });
  }

  return { appleLocked, spotifyLocked, stillManual };
}

async function main() {
  const token = await getSpotifyAccessToken();
  if (!token) {
    console.error('[cover-incremental-pending] 需要 SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET');
    process.exit(1);
  }

  const original = JSON.parse(JSON.stringify(LOCAL_IMPORT_OFFICIAL_METADATA)) as Record<string, Row>;
  const next = JSON.parse(JSON.stringify(LOCAL_IMPORT_OFFICIAL_METADATA)) as Record<string, Row>;

  const pendingList = computeNeedsManual(original);
  const pendingSet = new Set(pendingList.map((p) => p.slug));

  let appleLockedOnly = 0;
  let spotifySolved = 0;
  let skippedOverride = 0;
  let skippedAlreadyLocked = 0;
  let skippedSuppress = 0;

  for (const { slug } of pendingList) {
    const row = next[slug];
    if (!row) continue;
    const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug];

    if (ov?.cover?.trim()) {
      skippedOverride += 1;
      continue;
    }
    if (ov?.suppressOfficialCover) {
      skippedSuppress += 1;
      continue;
    }
    if (row.coverLocked) {
      skippedAlreadyLocked += 1;
      continue;
    }

    if (canLockExistingApple(row)) {
      applyAppleLockOnly(row);
      appleLockedOnly += 1;
      continue;
    }

    const spotifyId = extractSpotifyTrackIdFromUrl(ov?.officialLinks?.spotify);
    let coverUrl: string | null = null;
    let externalUrl: string | null = null;

    if (spotifyId) {
      const r = await fetchSpotifyTrackCoverById(token, spotifyId);
      coverUrl = r.coverUrl;
      externalUrl = r.externalUrl;
    }

    if (!coverUrl) {
      const { titles, artists } = buildTitleArtistCandidates(slug);
      const spSearch = await searchSpotifyBestTrackCover(token, titles, artists);
      if (spSearch.coverUrl && spSearch.best) {
        const hasHint = hasStrongArtistHint(artists);
        const strict = classifySpotifySearchPick(
          { coverUrl: spSearch.coverUrl, detail: spSearch.best.detail },
          spSearch.second,
          hasHint,
        );
        if (strict.ok && !strict.uncertain) {
          coverUrl = spSearch.coverUrl;
          externalUrl = spSearch.externalUrl;
        }
      }
    }

    if (coverUrl) {
      applySpotifyLock(row, coverUrl, externalUrl);
      spotifySolved += 1;
    }
  }

  for (const slug of Object.keys(original)) {
    if (pendingSet.has(slug)) continue;
    if (!isDeepStrictEqual(original[slug], next[slug])) {
      console.error(`[cover-incremental-pending] INVARIANT FAIL: 非待处理 slug 被改动: ${slug}`);
      process.exit(1);
    }
  }

  const beforePending = new Set(pendingList.map((p) => p.slug));

  fs.writeFileSync(OUT_META, `export const LOCAL_IMPORT_OFFICIAL_METADATA = ${JSON.stringify(next, null, 2)} as const;\n`, 'utf8');

  const after = classifyAfterRun(next);
  const solvedInThisRun = appleLockedOnly + spotifySolved;
  const initialPending = pendingList.length;
  const stillAfter216 = after.stillManual.filter((x) => beforePending.has(x.slug));

  const lines = [
    `# 待处理队列增量封面报告`,
    ``,
    `生成时间：${new Date().toISOString()}`,
    ``,
    `## 执行摘要（仅针对原「第 3 类」${initialPending} 首）`,
    ``,
    `- 本脚本自动解决（新增锁定）：**${solvedInThisRun}** 首（其中仅补 Apple 锁：**${appleLockedOnly}**，新采用 Spotify：**${spotifySolved}**）`,
    `- 跳过（override 手工 cover）：${skippedOverride}`,
    `- 跳过（suppressOfficialCover）：${skippedSuppress}`,
    `- 跳过（已 coverLocked）：${skippedAlreadyLocked}`,
    `- 原 ${initialPending} 首中，本 run 后仍属「无可靠商店锁定」、需你人工：**${stillAfter216.length}**`,
    ``,
    `## 全库三类（跑完本脚本后的快照）`,
    ``,
    `- 已用 Apple 官方图并锁定：**${after.appleLocked.length}**`,
    `- 已用 Spotify 官方图并锁定：**${after.spotifyLocked.length}**`,
    `- Apple 与 Spotify 均未形成锁定、需人工：**${after.stillManual.length}**`,
    ``,
    `## 原 216 首中仍未解决（slug）`,
    ``,
    ...stillAfter216.map(({ slug, why }) => `- \`${slug}\` — ${why}`),
    ``,
  ];

  fs.mkdirSync(path.dirname(OUT_REPORT), { recursive: true });
  fs.writeFileSync(OUT_REPORT, lines.join('\n'), 'utf8');

  console.log('[cover-incremental-pending] wrote', path.relative(ROOT, OUT_META));
  console.log('[cover-incremental-pending] report', path.relative(ROOT, OUT_REPORT));
  console.log(
    JSON.stringify(
      {
        initialPending216: initialPending,
        solvedThisRun: solvedInThisRun,
        appleLockOnly: appleLockedOnly,
        spotifyLockedThisRun: spotifySolved,
        stillNeedManualInOriginal216: stillAfter216.length,
        totalAppleLocked: after.appleLocked.length,
        totalSpotifyLocked: after.spotifyLocked.length,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
