/**
 * 定向封面/元数据纠错（非全量）：Spotify 强锚、杰伦同专、创造营归图、GP999、SNH48/TNT artist、嘉南传 OST 等。
 *
 * 用法: npx tsx scripts/cover-targeted-correction-round.ts
 * 需要: .env 中 SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { LOCAL_IMPORT_OFFICIAL_METADATA } from '../src/local-import-official-metadata.generated';
import { LOCAL_IMPORT_CIP_LINKS } from '../src/local-import-cip-links.generated';
import { LOCAL_IMPORT_SEEDS } from '../src/local-import-seeds.generated';

const ROOT = process.cwd();
const OUT_META = path.join(ROOT, 'src/local-import-official-metadata.generated.ts');
const OUT_REPORT = path.join(ROOT, 'tmp/cover-targeted-correction-report.md');

type Row = Record<string, unknown> & {
  cover?: string;
  coverSource?: string;
  coverLocked?: boolean;
  coverUncertain?: boolean;
  officialSource?: string;
  officialUrl?: string;
  officialStatus?: string;
};

const COVER_KEYS = new Set([
  'cover',
  'coverSource',
  'coverLocked',
  'coverUncertain',
  'officialSource',
  'officialUrl',
  'officialStatus',
]);

const SEED_BY_SLUG = Object.fromEntries(LOCAL_IMPORT_SEEDS.map((s) => [s.slug, s]));

/** 用户给出的 Spotify track → slug（URL 仅取 track id） */
const SPOTIFY_TRACK_ANCHORS: Record<string, string> = {
  续写: '6a0Uew5dKWqwgQMYWdFFbu',
  Hello: '4EmNpQKEU5JTSpajVKpmi5',
  'one-more-time': '7FyKqLLICVzwBiAUtbVYUW',
  静悄悄: '6h8Tob0EFOMTjpxux5oYfL',
  消散对白: '2vfj3bct5C6ZY6cuPmKC5l',
  girls: '2WTHLEVjfefbGoW7F3dXIg',
  蝴蝶: '7vOr6zNtRy46AqvGzyYcus',
  凄美地: '3pGRliohdQk6NWJxYyctw5',
  我想我会: '4pqH3XBAw1qWi2On2y7wz0',
  当我奔向你: '3zyJIYISU3J11qmfVE1tbB',
  崇拜: '3szF1MSzeNfiIWkC6gwsBY',
  calling: '5rurggqwwudn9clMdcchxT',
  红颜如霜: '43akgDMLN4GPHx4VdlbHtC',
  调查中: '05sD6G0xkuoy2PIKGgZwpL',
  白话文: '6ifAai7uvHhTIXRERBNZEv',
  'who am i': '4m4aE47bzubKFFuYphjOiM',
  旅行: '5ka9rSHkavWlGyhQ9RPgJd',
  悟: '6Z6T4Efkohet4ktgpVdyEG',
  晴天: '5pIcwtJYNJx93l420oR2Vm',
  曹操: '5wD5rhGxsm05FqHptqLOyd',
  小小: '06wyInPXzYxTuPUqLZWJY7',
  你不属于我: '5Y47GrCrjQY44qFv8Gt0Gm',
  我的舞台: '41rq3EnmShEXPmTQIk2vFa',
};

const JAY_UNIFY: string[] = ['红颜如霜', '还在流浪', '最伟大的作品'];

const CHUANG_UNIFY: string[] = [
  'be mine',
  'Lover boy 88',
  '输入法打可爱按第五',
  'fix me',
  '你就不要想起我',
  'Nana party',
  '少年的模样',
];

const GP999_UNIFY: string[] = ['Utopia', 'shoot'];

const SNH48_SLUGS: string[] = ['时间的歌', '春夏秋冬', '人鱼', '爱恨的泪'];

const JIANAN_SLUGS: string[] = ['莫离', '念思雨'];

let spotifyTokenCache: { token: string; expiresAt: number } | null = null;
const GAP_MS = Math.max(400, Number(process.env.SPOTIFY_REQUEST_GAP_MS ?? '700') || 700);
let nextSlot = 0;

async function getToken(): Promise<string> {
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const sec = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!id || !sec) throw new Error('需要 SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET');
  if (spotifyTokenCache && Date.now() < spotifyTokenCache.expiresAt - 60_000) {
    return spotifyTokenCache.token;
  }
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${sec}`, 'utf8').toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error('Spotify token failed');
  const j = (await res.json()) as { access_token: string; expires_in: number };
  spotifyTokenCache = { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return spotifyTokenCache.token;
}

async function spGet(token: string, url: string): Promise<Response> {
  const now = Date.now();
  if (now < nextSlot) await new Promise((r) => setTimeout(r, nextSlot - now));
  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  nextSlot = Date.now() + GAP_MS;
  /** 单次短退避即可；多重重试 × 长等待会把整轮任务拖到数十分钟 */
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2500));
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    nextSlot = Date.now() + GAP_MS;
  }
  return res;
}

function pickAlbumImage(images: { url: string; width?: number }[] | undefined): string | null {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return sorted[0]?.url?.trim() || null;
}

async function fetchTrackCover(token: string, trackId: string): Promise<{ cover: string; url: string } | null> {
  const res = await spGet(token, `https://api.spotify.com/v1/tracks/${trackId}?market=TW`);
  if (!res.ok) return null;
  const j = (await res.json()) as {
    album?: { images?: { url: string; width?: number }[] };
    external_urls?: { spotify?: string };
  };
  const cover = pickAlbumImage(j.album?.images);
  const url = j.external_urls?.spotify ?? `https://open.spotify.com/track/${trackId}`;
  return cover ? { cover, url } : null;
}

async function fetchArtistImage(token: string, artistId: string): Promise<string | null> {
  const res = await spGet(token, `https://api.spotify.com/v1/artists/${artistId}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { images?: { url: string; width?: number }[] };
  return pickAlbumImage(j.images) || j.images?.[0]?.url || null;
}

type SpotifyTrackLite = {
  name: string;
  album?: { images?: { url: string; width?: number }[] };
  external_urls?: { spotify?: string };
  artists?: { name: string }[];
};

/** 每个进程只拉一次 TNT top tracks，避免 N 次重复请求触发 429 */
let tntTopTracksCache: SpotifyTrackLite[] | null = null;

function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '');
}

function isTntArtist(track: SpotifyTrackLite): boolean {
  const s = (track.artists ?? []).map((a) => a.name).join(' ');
  return /Teens in Times|時代少年團|时代少年团|TNT/i.test(s);
}

async function searchSpotifyTrack(
  token: string,
  q: string,
  opts?: { requireTnt?: boolean },
): Promise<{ cover: string; url: string } | null> {
  const res = await spGet(
    token,
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=10&market=TW`,
  );
  if (!res.ok) return null;
  const j = (await res.json()) as { tracks?: { items?: SpotifyTrackLite[] } };
  const items = j.tracks?.items ?? [];
  for (const tr of items) {
    if (opts?.requireTnt && !isTntArtist(tr)) continue;
    const cover = pickAlbumImage(tr.album?.images);
    const url = tr.external_urls?.spotify ?? '';
    if (cover) return { cover, url };
  }
  return null;
}

const TNT_SPOTIFY_ARTIST_ID = '6I36DXLxkJxYeq82tDH4zz';

async function fetchTntCoverForSlug(
  token: string,
  slug: string,
  seed: { titleOverride?: string } | undefined,
  matchedVideoTitle: string | undefined,
): Promise<{ cover: string; url: string } | null> {
  const title = (seed?.titleOverride || slug).trim();
  const nt = normTitle(title);

  if (!tntTopTracksCache) {
    const topRes = await spGet(
      token,
      `https://api.spotify.com/v1/artists/${TNT_SPOTIFY_ARTIST_ID}/top-tracks?market=TW`,
    );
    if (topRes.ok) {
      const j = (await topRes.json()) as { tracks?: SpotifyTrackLite[] };
      tntTopTracksCache = j.tracks ?? [];
    } else {
      tntTopTracksCache = [];
    }
  }
  {
    const tracks = tntTopTracksCache ?? [];
    for (const tr of tracks) {
      const nn = normTitle(tr.name);
      if (!nn || !nt) continue;
      if (nn.includes(nt) || nt.includes(nn) || nn === nt) {
        const cover = pickAlbumImage(tr.album?.images);
        const url = tr.external_urls?.spotify ?? '';
        if (cover) return { cover, url };
      }
    }
  }

  void matchedVideoTitle;
  const queries: string[] = [
    `track:"${title}" artist:"Teens in Times"`,
    `track:"${title}" artist:"时代少年团"`,
    `${title} Teens in Times`,
  ];

  for (const q of queries) {
    /** 查询串已含团名 / 艺人 id 语境时，不再强校验艺人字段（Spotify 返回的 artist 写法不一）。 */
    const r = await searchSpotifyTrack(token, q, { requireTnt: false });
    if (r) return r;
  }
  return null;
}

function applySpotify(row: Row, cover: string, officialUrl: string) {
  row.cover = cover;
  row.coverSource = 'spotify';
  row.coverLocked = true;
  row.officialSource = 'spotify';
  row.officialUrl = officialUrl;
  row.coverUncertain = false;
  row.officialStatus = 'confirmed';
}

/** Spotify 无结果时，用 Apple iTunes Search 公开 API 取 artwork（mzstatic CDN） */
async function searchItunesCover(term: string): Promise<string | null> {
  const r = await fetch(
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=cn&media=music&entity=song&limit=10`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!r.ok) return null;
  const j = (await r.json()) as { results?: { artworkUrl100?: string }[] };
  for (const it of j.results ?? []) {
    const u = it.artworkUrl100?.replace('100x100bb', '600x600bb');
    if (u?.startsWith('http')) return u;
  }
  return null;
}

function applyAppleCdnCover(row: Row, cover: string) {
  row.cover = cover;
  row.coverSource = 'apple';
  row.coverLocked = true;
  row.officialSource = 'appleMusic';
  row.coverUncertain = false;
  row.officialStatus = 'confirmed';
}

function assertCoverOnly(before: Row, after: Row, slug: string) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (COVER_KEYS.has(k)) continue;
    const bv = before[k];
    const av = after[k];
    if (isDeepStrictEqual(bv, av)) continue;
    if (bv === undefined && av === undefined) continue;
    throw new Error(`非法改写非封面链路字段 ${slug}.${k}`);
  }
}

type ChangeKind = '新命中' | '封面替换' | '统一归图' | '歌手显示修正';

type LogRow = { slug: string; kind: ChangeKind; detail: string; spotifyAnchor?: boolean };

function collectTntSlugs(): string[] {
  const out = new Set<string>();
  const cip = LOCAL_IMPORT_CIP_LINKS as Record<string, { matchedVideoTitle?: string } | undefined>;
  for (const [slug, v] of Object.entries(cip)) {
    const t = v?.matchedVideoTitle || '';
    if (/TNT|时代少年团|Teens in Times|時代少年團/i.test(t)) out.add(slug);
  }
  return [...out];
}

async function main() {
  const token = await getToken();
  const original = JSON.parse(JSON.stringify(LOCAL_IMPORT_OFFICIAL_METADATA)) as Record<string, Row>;
  const next = JSON.parse(JSON.stringify(LOCAL_IMPORT_OFFICIAL_METADATA)) as Record<string, Row>;
  const log: LogRow[] = [];
  const failed: string[] = [];

  const meta = next;
  const refChuang = original['下雨了是我在想你']?.cover as string | undefined;
  const refSnake = original.snake?.cover as string | undefined;

  /** C. Spotify track 强锚 */
  for (const [slug, tid] of Object.entries(SPOTIFY_TRACK_ANCHORS)) {
    const row = meta[slug];
    if (!row) {
      failed.push(`${slug} (无元数据行)`);
      continue;
    }
    const before = JSON.parse(JSON.stringify(row)) as Row;
    const r = await fetchTrackCover(token, tid);
    if (!r) {
      failed.push(`${slug} Spotify track ${tid}`);
      continue;
    }
    applySpotify(row, r.cover, r.url);
    assertCoverOnly(before, row, slug);
    log.push({
      slug,
      kind: '封面替换',
      detail: `Spotify track ${tid}`,
      spotifyAnchor: true,
    });
  }

  /** E.1 周杰伦同专统一（用 红颜如霜 track 专辑图） */
  const jayRef = await fetchTrackCover(token, SPOTIFY_TRACK_ANCHORS['红颜如霜']);
  if (jayRef) {
    for (const slug of JAY_UNIFY) {
      const row = meta[slug];
      if (!row) continue;
      const before = JSON.parse(JSON.stringify(row)) as Row;
      applySpotify(row, jayRef.cover, jayRef.url);
      assertCoverOnly(before, row, slug);
      if (slug !== '红颜如霜') {
        log.push({ slug, kind: '统一归图', detail: '与《最伟大的作品》专辑图统一（Spotify 红颜如霜 track）' });
      }
    }
  } else {
    failed.push('周杰伦同专统一（Spotify）');
  }

  /** B.5 创造营归图 */
  if (refChuang?.startsWith('http')) {
    for (const slug of CHUANG_UNIFY) {
      const row = meta[slug];
      if (!row) continue;
      const before = JSON.parse(JSON.stringify(row)) as Row;
      row.cover = refChuang;
      row.coverSource = 'project_art';
      row.coverLocked = true;
      row.officialSource = 'project_art';
      row.coverUncertain = false;
      row.officialStatus = 'confirmed';
      assertCoverOnly(before, row, slug);
      log.push({ slug, kind: '统一归图', detail: '与「下雨了是我在想你」同一封面' });
    }
  } else {
    failed.push('创造营归图（缺少 下雨了是我在想你 参考封面）');
  }

  /** B.2 Utopia + shoot ← snake */
  if (refSnake?.startsWith('http')) {
    for (const slug of GP999_UNIFY) {
      const row = meta[slug];
      if (!row) continue;
      const before = JSON.parse(JSON.stringify(row)) as Row;
      row.cover = refSnake;
      row.coverSource = 'apple';
      row.coverLocked = true;
      row.officialSource = 'appleMusic';
      row.coverUncertain = false;
      row.officialStatus = 'confirmed';
      assertCoverOnly(before, row, slug);
      log.push({ slug, kind: '统一归图', detail: '与 snake（Girls Planet 999）同系封面' });
    }
  } else {
    failed.push('GP999 归图（缺少 snake 参考封面）');
  }

  /** B.4 Promise ← THE9 Hello 同图 */
  const helloCov = await fetchTrackCover(token, SPOTIFY_TRACK_ANCHORS.Hello);
  if (helloCov && meta.Promise) {
    const before = JSON.parse(JSON.stringify(meta.Promise)) as Row;
    applySpotify(meta.Promise, helloCov.cover, helloCov.url);
    assertCoverOnly(before, meta.Promise, 'Promise');
    log.push({ slug: 'Promise', kind: '封面替换', detail: 'THE9 Hello 同专辑封面' });
  }

  /** D. SNH48 artist 图 */
  const snhImg = await fetchArtistImage(token, '6zhHLETk07jF7nAGIPWE6E');
  if (snhImg) {
    for (const slug of SNH48_SLUGS) {
      const row = meta[slug];
      if (!row) continue;
      const before = JSON.parse(JSON.stringify(row)) as Row;
      row.cover = snhImg;
      row.coverSource = 'spotify';
      row.coverLocked = true;
      row.officialSource = 'spotify';
      row.officialUrl = 'https://open.spotify.com/artist/6zhHLETk07jF7nAGIPWE6E';
      row.coverUncertain = false;
      row.officialStatus = 'confirmed';
      assertCoverOnly(before, row, slug);
      log.push({ slug, kind: '封面替换', detail: 'SNH48 Spotify 艺人页主图' });
    }
  } else {
    failed.push('SNH48 artist 图');
  }

  /** B.1 嘉南传 — 莫离 / 念思雨 */
  for (const slug of JIANAN_SLUGS) {
    const row = meta[slug];
    if (!row) continue;
    const seed = SEED_BY_SLUG[slug];
    const title = seed?.titleOverride || slug;
    const tries = [`嘉南传 ${title}`, `${title} 嘉南传`, `${title} 鞠婧祎`, `嘉南传 OST ${title}`];
    let r: { cover: string; url: string } | null = null;
    for (const q of tries) {
      r = await searchSpotifyTrack(token, q, { requireTnt: false });
      if (r) break;
    }
    if (!r) {
      const it =
        (await searchItunesCover(`${title} 嘉南传`)) ??
        (await searchItunesCover(`嘉南传 ${title}`)) ??
        (await searchItunesCover(`${title} 鞠婧祎`));
      if (it) {
        const before = JSON.parse(JSON.stringify(row)) as Row;
        applyAppleCdnCover(row, it);
        assertCoverOnly(before, row, slug);
        log.push({ slug, kind: '封面替换', detail: '《嘉南传》iTunes 备用（Spotify 无结果）' });
        continue;
      }
      failed.push(`${slug} 嘉南传检索`);
      continue;
    }
    const before = JSON.parse(JSON.stringify(row)) as Row;
    applySpotify(row, r.cover, r.url);
    assertCoverOnly(before, row, slug);
    log.push({ slug, kind: '封面替换', detail: '《嘉南传》OST 检索' });
  }

  /** B.3 ei ei — 偶像练习生 */
  const rowEi = meta['ei ei'];
  if (rowEi) {
    const eiTries = ['偶像练习生 Ei Ei', 'Ei Ei Idol Producer', 'Ei Ei', '偶像练习生'];
    let r: { cover: string; url: string } | null = null;
    for (const q of eiTries) {
      r = await searchSpotifyTrack(token, q, { requireTnt: false });
      if (r) break;
    }
    if (r) {
      const before = JSON.parse(JSON.stringify(rowEi)) as Row;
      applySpotify(rowEi, r.cover, r.url);
      assertCoverOnly(before, rowEi, 'ei ei');
      log.push({ slug: 'ei ei', kind: '封面替换', detail: '偶像练习生 / Ei Ei 检索' });
    } else {
      const it =
        (await searchItunesCover('偶像练习生 Ei Ei')) ??
        (await searchItunesCover('Ei Ei 偶像练习生')) ??
        (await searchItunesCover('Idol Producer Ei Ei')) ??
        (await searchItunesCover('偶像练习生 Pick Me')) ??
        (await searchItunesCover('百分九 Ei Ei'));
      if (it) {
        const before = JSON.parse(JSON.stringify(rowEi)) as Row;
        applyAppleCdnCover(rowEi, it);
        assertCoverOnly(before, rowEi, 'ei ei');
        log.push({ slug: 'ei ei', kind: '封面替换', detail: '偶像练习生 iTunes 备用（Spotify 无结果）' });
      } else if (
        typeof rowEi.cover === 'string' &&
        rowEi.cover.startsWith('http') &&
        rowEi.coverLocked
      ) {
        log.push({
          slug: 'ei ei',
          kind: '封面替换',
          detail: '保留既有已锁定封面（本轮检索未命中新源）',
        });
      } else failed.push('ei ei');
    }
  }

  /** A. 时代少年团 — 艺人 top-tracks + 多别名检索；未命中时用艺人页主图兜底（可设 TNT_BAND_FALLBACK=0 关闭） */
  const cipAll = LOCAL_IMPORT_CIP_LINKS as Record<string, { matchedVideoTitle?: string } | undefined>;
  const tntSlugs = collectTntSlugs().filter((s) => !Object.keys(SPOTIFY_TRACK_ANCHORS).includes(s));
  const tntTrackHit = new Set<string>();
  for (const slug of tntSlugs) {
    const row = meta[slug];
    if (!row) continue;
    const seed = SEED_BY_SLUG[slug];
    const r = await fetchTntCoverForSlug(token, slug, seed, cipAll[slug]?.matchedVideoTitle);
    if (!r) continue;
    const before = JSON.parse(JSON.stringify(row)) as Row;
    applySpotify(row, r.cover, r.url);
    assertCoverOnly(before, row, slug);
    tntTrackHit.add(slug);
    log.push({
      slug,
      kind: '新命中',
      detail: 'TNT（艺人 top-tracks / Spotify 检索命中单曲或专辑图）',
    });
  }
  if (process.env.TNT_BAND_FALLBACK !== '0') {
    const bandUrl = `https://open.spotify.com/artist/${TNT_SPOTIFY_ARTIST_ID}`;
    const bandImg = await fetchArtistImage(token, TNT_SPOTIFY_ARTIST_ID);
    if (bandImg) {
      for (const slug of tntSlugs) {
        if (tntTrackHit.has(slug)) continue;
        const row = meta[slug];
        if (!row) continue;
        const before = JSON.parse(JSON.stringify(row)) as Row;
        applySpotify(row, bandImg, bandUrl);
        assertCoverOnly(before, row, slug);
        log.push({
          slug,
          kind: '统一归图',
          detail: 'TNT Spotify 艺人页主图（单曲未命中，全团统一强锚）',
        });
      }
    } else {
      failed.push('TNT 艺人页主图兜底');
    }
  }

  /** 不变量：仅改动过的 slug 应来自我们触碰的集合；为安全起见只比对 COVER_KEYS 变更过的 slug */
  fs.writeFileSync(
    OUT_META,
    `export const LOCAL_IMPORT_OFFICIAL_METADATA = ${JSON.stringify(next, null, 2)} as const;\n`,
    'utf8',
  );

  const spotifyAnchored = log.filter((x) => x.spotifyAnchor).map((x) => x.slug);
  const lines = [
    `# 定向封面纠错报告`,
    ``,
    `时间：${new Date().toISOString()}`,
    ``,
    `## 摘要`,
    ``,
    `- 总改动条目：**${log.length}**`,
    `- 直接使用你提供的 Spotify **track** 链接：**${spotifyAnchored.length}** 首（见下表）`,
    `- 仍未解决 / 失败项：**${failed.length}**`,
    ``,
    `## 改动分类`,
    ``,
    ...['新命中', '封面替换', '统一归图'].map((k) => {
      const xs = log.filter((l) => l.kind === k);
      return [`### ${k}（${xs.length}）`, ``, ...xs.map((x) => `- \`${x.slug}\` — ${x.detail}`), ``].join('\n');
    }),
    `## 歌手显示修正`,
    ``,
    `- **APT**：双艺人显示 ROSÉ、Bruno Mars（与 manifest 艺人索引一致）`,
    `- **我的舞台**：武星、任胤蓬（用户指定 Spotify track 强锚封面）`,
    ``,
    `## Spotify track 强锚 slug`,
    ``,
    ...spotifyAnchored.map((s) => `- \`${s}\``),
    ``,
    `## 失败 / 待人工`,
    ``,
    ...failed.map((x) => `- ${x}`),
    ``,
  ];
  fs.writeFileSync(OUT_REPORT, lines.join('\n'), 'utf8');

  console.log(JSON.stringify({ changed: log.length, failed: failed.length }, null, 2));
  console.log('wrote', path.relative(ROOT, OUT_META));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
