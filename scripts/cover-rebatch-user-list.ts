/**
 * 仅处理用户指定歌单：按 Apple Music → Spotify → QQ 重抓封面并锁定。
 * 只改写 cover 链路字段；「在意」跳过封面（仅依赖 overrides 里已改的歌手）。
 *
 * 用法: npx tsx scripts/cover-rebatch-user-list.ts
 * 需要: .env 中 SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET（Spotify 步骤；缺失则跳过 Spotify）
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
const OUT_REPORT = path.join(ROOT, 'tmp/cover-rebatch-user-list-report.md');

const COVER_PATCH_KEYS = new Set([
  'cover',
  'coverSource',
  'coverLocked',
  'coverUncertain',
  'officialStatus',
  'officialUrl',
  'officialSource',
]);

type Row = Record<string, unknown> & {
  cover?: string;
  officialSource?: string;
  coverSource?: string;
  coverLocked?: boolean;
  coverUncertain?: boolean;
  officialUrl?: string;
  officialStatus?: string;
  artist?: string;
};

const unique = <T>(a: T[]) => Array.from(new Set(a.filter(Boolean) as T[]));

/** 用户名单（slug 与 seeds 一致）；库中不存在的 slug 会在运行时跳过并记入报告 */
const USER_REBATCH_SLUGS: string[] = [
  '无人乐园',
  '那天下雨了',
  '太阳之子',
  '无趣生活指南',
  '才二十三',
  '你我经历的一刻',
  '万里',
  '冬日来信',
  '这一程',
  'chains',
  '登顶',
  'Hola solar',
  '即兴曲',
  '曾经我也想过一了百了',
  'Girlfriend',
  '遇见',
  '至少我还算快乐',
  'HOT',
  'moonlight dance',
  '若仙',
  '在故事的最终',
  'her',
  '晨光里有你',
  'home sweet home',
  '我们',
  'Mantra',
  '镜花水月',
  '爱错',
  '相思莫负',
  '经过',
  'heavy is the crown',
  '云宫迅音',
  '耻辱柱',
  '谧境',
  '敢问路在何方',
  '借过一下',
  '希望有羽毛和翅膀',
  '奇迹时刻',
  '蜃楼',
  '失恋循环',
  '非我不可',
  '繁花片头曲',
  '好想爱这个世界啊',
  'no complaints',
  'komorebi',
  '这么可爱真是抱歉',
  '水龙吟',
  '躺着真舒服',
  '灯火万家',
  '我想我会',
  '想你的365天',
  '笼',
  '耀眼的你',
  'Here I am',
  '偷',
  '面壁者',
  '哭泣的游戏',
  '侠',
  'hug me',
  '绝配',
  '幻化成花',
  '红颜如霜',
  '还在流浪',
  '最伟大的作品',
  '可',
  '你要快乐',
  '不惜时光',
  '乘风',
  'falling you',
  '擦肩',
  '披风',
  '白话文',
  'who am i',
  '年轮',
  '爱丫爱丫',
  '名场面',
  '光字片',
  '渐暖',
  '雪花',
  '星鱼',
  '雪龙吟',
  'time to shine',
  '相遇',
  'wadada',
  '有你',
  '花西子',
  '男儿歌',
  '走，一起去看日出吧',
  '念',
  '寂静之忆',
  '斗地主',
  '哪吒',
  'stay with me',
  '念思雨',
  '莫离',
  'another dream',
  '飞天',
  'shoot',
  '剩下的盛夏',
  '秋天前',
  'Got You',
  '意气趁年少',
  '新时代 冬奥运',
  'Lalisa',
  '续写',
  '傻瓜',
  '陷入爱情',
  '烟火星辰',
  'into the fire',
  '约定之初',
  '练习曲',
  'ei ei',
  'of course',
  '热爱105度的你',
  'Hello',
  '时间的歌',
  '春夏秋冬',
  '人鱼',
  '爱恨的泪',
  'Promise',
  'be mine',
  '少年的模样',
  'Lover boy 88',
  'Nana party',
  '输入法打可爱按第五',
  '有梦好甜蜜',
  '你就不要想起我',
  'fix me',
  '小小',
  '不冬眠',
  '明天见',
  '都选c',
  '你不属于我',
  '只因你太美',
  '我的舞台',
  '在意',
];

const SKIP_COVER_SLUGS = new Set(['在意']);

const ALIAS_GROUPS: string[][] = [
  ['时代少年团', 'TNT', 'TNT时代少年团', 'Teens in Times', 'TEENS IN TIMES'],
  ['蔡徐坤', 'KUN', 'Cai Xukun', 'CAI XUKUN'],
  ['周深', 'Charlie Zhou Shen', 'Zhou Shen', 'CHARLIE ZHOU SHEN'],
  ['刘耀文', 'Liu Yaowen'],
  ['马嘉祺', 'Ma Jiaqi'],
  ['丁程鑫', 'Ding Chengxin'],
  ['宋亚轩', 'Song Yaxuan'],
  ['严浩翔', 'Yan Haoxiang'],
  ['贺峻霖', 'He Junlin'],
  ['张真源', 'Zhang Zhenyuan'],
];

function expandArtistAliases(artists: string[]): string[] {
  const out = new Set<string>();
  for (const raw of artists) {
    const a = (raw || '').trim();
    if (!a) continue;
    out.add(a);
    for (const group of ALIAS_GROUPS) {
      const hit = group.some((g) => a.includes(g) || g.includes(a));
      if (hit) group.forEach((g) => out.add(g));
    }
  }
  return [...out].filter(Boolean);
}

const SEED_BY_SLUG = Object.fromEntries(LOCAL_IMPORT_SEEDS.map((s) => [s.slug, s]));

function extractAppleTrackIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/song\/[^/]+\/(\d+)/i) || url.match(/[?&]i=(\d+)/i);
  return m?.[1] ?? null;
}

function extractSpotifyTrackIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m =
    url.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([a-zA-Z0-9]+)/) ||
    url.match(/spotify:track:([a-zA-Z0-9]+)/);
  return m?.[1] ?? null;
}

function to600(url: string | undefined): string | null {
  if (!url) return null;
  return url
    .replace(/\/\d+x\d+bb\.(jpg|webp)$/i, '/600x600bb.$1')
    .replace(/100x100bb\.jpg$/i, '600x600bb.jpg')
    .replace(/200x200bb\.jpg$/i, '600x600bb.jpg')
    .replace(/300x300bb\.jpg$/i, '600x600bb.jpg');
}

function buildTitleArtist(slug: string): { titles: string[]; artists: string[] } {
  const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug as keyof typeof LOCAL_IMPORT_METADATA_OVERRIDES];
  const cip = (LOCAL_IMPORT_CIP_LINKS as Record<string, { matchTitle?: string } | undefined>)[slug];
  const seed = SEED_BY_SLUG[slug];
  const row = LOCAL_IMPORT_OFFICIAL_METADATA[slug as keyof typeof LOCAL_IMPORT_OFFICIAL_METADATA] as Row | undefined;

  const titles = unique(
    [
      ov?.title,
      ov?.displayTitle,
      ov?.titles?.zhHans,
      ov?.titles?.zhHant,
      ov?.titles?.en,
      cip?.matchTitle,
      seed?.titleOverride,
      slug,
    ].filter(Boolean) as string[],
  );

  const baseArtists = unique(
    [ov?.artist, ov?.artists?.zhHans, ov?.artists?.en, row?.artist].filter(Boolean) as string[],
  );
  const artists = expandArtistAliases(baseArtists);

  return { titles, artists };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[''"''「」]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const junkArtist = (a: string | undefined) =>
  !a ||
  /钢琴|Piano|cover|Cover|版|伴奏|instrumental|《.*》/.test(a) ||
  a.length < 2;

function scoreItunesPick(
  titleWants: string[],
  artistWants: string[],
  tr: { trackName?: string; artistName?: string },
): number {
  const tn = norm(tr.trackName || '');
  const an = norm(tr.artistName || '');
  let best = 0;
  for (const tw of titleWants) {
    const w = norm(tw);
    if (!w) continue;
    if (tn === w) best = Math.max(best, 100);
    else if (tn.includes(w) || w.includes(tn)) best = Math.max(best, 85);
    else if (w.length >= 2 && tn.includes(w.slice(0, Math.min(6, w.length)))) best = Math.max(best, 55);
  }
  let art = 0;
  for (const aw0 of artistWants) {
    const aw = norm(aw0);
    if (!aw || junkArtist(aw0)) continue;
    if (an.includes(aw) || aw.includes(an)) art = Math.max(art, 60);
    for (const tok of aw.split(/\s+/).filter((x) => x.length >= 2)) {
      if (an.includes(tok)) art = Math.max(art, 35);
    }
  }
  return best + Math.min(art, 80);
}

async function itunesSearch(
  term: string,
  country: string,
  entity: 'song' | 'album',
): Promise<
  {
    artworkUrl100?: string;
    trackName?: string;
    artistName?: string;
    trackViewUrl?: string;
    collectionViewUrl?: string;
  }[]
> {
  const u = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=25&country=${country}`;
  const res = await fetch(u, { headers: { 'User-Agent': 'AuraSounds-cover-rebatch/1.0' } });
  const text = await res.text();
  if (!text.trim().startsWith('{')) return [];
  const j = JSON.parse(text) as {
    results?: {
      artworkUrl100?: string;
      trackName?: string;
      artistName?: string;
      trackViewUrl?: string;
      collectionViewUrl?: string;
    }[];
  };
  return j.results ?? [];
}

async function itunesLookup(
  trackId: string,
  country: string,
): Promise<{
  artworkUrl100?: string;
  trackViewUrl?: string;
  trackName?: string;
  artistName?: string;
} | null> {
  const u = `https://itunes.apple.com/lookup?id=${encodeURIComponent(trackId)}&country=${country}&entity=song`;
  const res = await fetch(u, { headers: { 'User-Agent': 'AuraSounds-cover-rebatch/1.0' } });
  const text = await res.text();
  if (!text.trim().startsWith('{')) return null;
  const j = JSON.parse(text) as {
    results?: {
      artworkUrl100?: string;
      trackViewUrl?: string;
      trackName?: string;
      artistName?: string;
      wrapperType?: string;
    }[];
  };
  const r = j.results?.find((x) => x.wrapperType === 'track' || x.trackName);
  return r || null;
}

const APPLE_GAP_MS = Math.max(350, Number(process.env.APPLE_COVER_GAP_MS ?? '550') || 550);
let appleNext = 0;
async function applePause() {
  const now = Date.now();
  if (now < appleNext) await new Promise((r) => setTimeout(r, appleNext - now));
  appleNext = Date.now() + APPLE_GAP_MS;
}

async function tryAppleForSlug(slug: string): Promise<{
  cover: string;
  officialUrl: string | null;
  note: string;
} | null> {
  const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug as keyof typeof LOCAL_IMPORT_METADATA_OVERRIDES];
  const { titles, artists } = buildTitleArtist(slug);
  const appleUrl = ov?.officialLinks?.appleMusic;
  const tid = extractAppleTrackIdFromUrl(appleUrl);
  if (tid) {
    for (const country of ['cn', 'hk', 'tw', 'us']) {
      await applePause();
      const hit = await itunesLookup(tid, country);
      const u600 = to600(hit?.artworkUrl100);
      if (u600) {
        return {
          cover: u600,
          officialUrl: hit?.trackViewUrl ?? appleUrl ?? null,
          note: `lookup id=${tid} ${country}`,
        };
      }
    }
  }

  const queries: string[] = [];
  const t0 = titles[0] || '';
  const aList = artists.slice(0, 6);
  for (const a of aList) {
    if (t0 && a) queries.push(`${t0} ${a}`, `${a} ${t0}`);
  }
  for (const t of titles.slice(0, 3)) {
    if (t) queries.push(t);
  }

  const hasHan = /[\p{Script=Han}]/u.test(t0);
  const countries = hasHan ? (['cn', 'hk', 'tw'] as const) : (['us', 'gb', 'cn'] as const);

  const seenQ = new Set<string>();
  const minScore = artists.some((x) => !junkArtist(x) && norm(x).length >= 2) ? 78 : 88;

  for (const q of queries) {
    const qt = q.trim();
    if (!qt || seenQ.has(qt)) continue;
    seenQ.add(qt);
    if (seenQ.size > 10) break;

    for (const country of countries) {
      await applePause();
      let results = await itunesSearch(qt, country, 'song');
      if (!results.length) {
        await applePause();
        results = await itunesSearch(qt, country, 'album');
      }
      let best: { tr: (typeof results)[0]; score: number } | null = null;
      for (const tr of results) {
        const sc = scoreItunesPick(titles, artists, tr);
        if (!best || sc > best.score) best = { tr, score: sc };
      }
      if (best && best.score >= minScore && best.tr.artworkUrl100) {
        const u600 = to600(best.tr.artworkUrl100);
        if (u600) {
          return {
            cover: u600,
            officialUrl: best.tr.trackViewUrl || best.tr.collectionViewUrl || null,
            note: `search score≈${best.score.toFixed(0)} ${country} q=${JSON.stringify(qt.slice(0, 64))}`,
          };
        }
      }
    }
  }
  return null;
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
const SPOTIFY_GAP_MS = Math.max(500, Number(process.env.SPOTIFY_REQUEST_GAP_MS ?? '2200') || 2200);
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
  spotifyNextSlot = Date.now() + SPOTIFY_GAP_MS;
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
  market: string,
): Promise<{
  coverUrl: string | null;
  externalUrl: string | null;
  best: { track: any; detail: SpotifyScoreDetail } | null;
  second: { detail: SpotifyScoreDetail } | null;
}> {
  const titles = [...new Set(titleCandidates.filter(Boolean))].slice(0, 6);
  const artists = [...new Set(artistCandidates.filter(Boolean))].slice(0, 8);
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
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=15&market=${encodeURIComponent(market)}`;
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

/** 华语曲在 US market 常搜不到；略放宽且要求歌手命中，避免乱图 */
function classifySpotifyRebatchRelaxed(
  best: { coverUrl: string | null; detail: SpotifyScoreDetail },
  second: { detail: SpotifyScoreDetail } | null,
  hasArtistHint: boolean,
): { ok: boolean } {
  if (!best.coverUrl) return { ok: false };
  const d = best.detail;
  const gap = second ? d.total - second.detail.total : 100;
  if (gap < 6) return { ok: false };
  if (!hasArtistHint) return { ok: false };
  if (!d.artistMatched) return { ok: false };
  if (d.total < 92) return { ok: false };
  if (d.titleMax < 55 && !d.titleExact) return { ok: false };
  return { ok: true };
}

async function trySpotifyForSlug(
  slug: string,
  token: string | null,
): Promise<{ cover: string; officialUrl: string | null; note: string } | null> {
  if (!token) return null;
  const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug as keyof typeof LOCAL_IMPORT_METADATA_OVERRIDES];
  const { titles, artists } = buildTitleArtist(slug);
  const sid = extractSpotifyTrackIdFromUrl(ov?.officialLinks?.spotify);
  if (sid) {
    const r = await fetchSpotifyTrackCoverById(token, sid);
    if (r.coverUrl) {
      return { cover: r.coverUrl, officialUrl: r.externalUrl, note: `track id ${sid}` };
    }
  }
  const hasHint = hasStrongArtistHint(artists);
  for (const market of ['US', 'TW', 'HK']) {
    const spSearch = await searchSpotifyBestTrackCover(token, titles, artists, market);
    if (!spSearch.coverUrl || !spSearch.best) continue;
    const strict = classifySpotifySearchPick(
      { coverUrl: spSearch.coverUrl, detail: spSearch.best.detail },
      spSearch.second,
      hasHint,
    );
    if (strict.ok && !strict.uncertain) {
      return {
        cover: spSearch.coverUrl,
        officialUrl: spSearch.externalUrl,
        note: `search ${market}`,
      };
    }
    const relaxed = classifySpotifyRebatchRelaxed(
      { coverUrl: spSearch.coverUrl, detail: spSearch.best.detail },
      spSearch.second,
      hasHint,
    );
    if (relaxed.ok) {
      return {
        cover: spSearch.coverUrl,
        officialUrl: spSearch.externalUrl,
        note: `search ${market} (relaxed)`,
      };
    }
  }
  return null;
}

const stripEm = (s: string) => s.replace(/<\/?.em>/gi, '').replace(/<[^>]+>/g, '');
const normQq = (s: string) =>
  stripEm(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type QqSong = {
  songname?: string;
  albumid?: number;
  albummid?: string;
  singer?: { name?: string }[];
  songmid?: string;
};

function albumCoverUrl(albummid: string, px: 300 | 500 = 500): string {
  return `https://y.gtimg.cn/music/photo_new/T002R${px}x${px}M000${albummid}.jpg`;
}

const QQ_GAP_MS = Math.max(200, Number(process.env.QQ_COVER_REQUEST_GAP_MS ?? '500') || 500);
let qqNext = 0;

async function qqSearchSongs(keyword: string): Promise<QqSong[]> {
  const now = Date.now();
  if (now < qqNext) await new Promise((r) => setTimeout(r, qqNext - now));
  qqNext = Date.now() + QQ_GAP_MS;

  const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=25&w=${encodeURIComponent(keyword)}&format=json`;
  const res = await fetch(url, {
    headers: {
      Referer: 'https://y.qq.com/',
      'User-Agent': 'Mozilla/5.0 (compatible; AuraSounds-cover-rebatch/1.0)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { data?: { song?: { list?: QqSong[] } } };
  return j?.data?.song?.list ?? [];
}

async function verifyImageOk(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (r.ok) return true;
    const r2 = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    return r2.ok && (Number(r2.headers.get('content-length')) || 0) > 500;
  } catch {
    return false;
  }
}

function scoreQqHit(song: QqSong, titles: string[], artists: string[]): { score: number } {
  const sn = stripEm(song.songname || '');
  const albumid = song.albumid ?? 0;
  const amid = (song.albummid || '').trim();
  if (albumid <= 0 || amid.length < 8) {
    return { score: 0 };
  }

  let bestTitle = 0;
  const nsong = normQq(sn);
  for (const t of titles) {
    const nt = normQq(t);
    if (!nt) continue;
    if (nsong === nt) {
      bestTitle = 100;
      break;
    }
    if (nsong.includes(nt) || nt.includes(nsong)) {
      bestTitle = Math.max(bestTitle, 88);
    }
  }

  const singerLine = (song.singer || []).map((s) => s.name || '').join(' ');
  const nsing = normQq(singerLine);
  let bestArt = 0;
  for (const a of artists) {
    const na = normQq(a);
    if (na.length < 2) continue;
    if (nsing.includes(na) || na.split(/\s+/).some((w) => w.length > 1 && nsing.includes(w))) {
      bestArt = 85;
      break;
    }
  }

  const hasArtistHint = artists.some((a) => normQq(a).length >= 2);
  let score = bestTitle + bestArt;
  if (!hasArtistHint) {
    if (bestTitle >= 88) score = bestTitle + 40;
    else score = bestTitle;
  }

  return { score };
}

function isReliableQqHit(song: QqSong, titles: string[], artists: string[]): boolean {
  const { score } = scoreQqHit(song, titles, artists);
  const hasArtistHint = artists.some((a) => normQq(a).length >= 2);
  const sn = stripEm(song.songname || '');
  const nt0 = titles[0] ? normQq(titles[0]) : '';
  const titleExact = nt0 && normQq(sn) === nt0;

  if (hasArtistHint) {
    return score >= 165;
  }
  return titleExact && score >= 130;
}

async function pickBestQqCover(
  titles: string[],
  artists: string[],
): Promise<{ url: string; song: QqSong } | null> {
  const primary = artists.length ? `${artists[0]} ${titles[0] || ''}`.trim() : (titles[0] || '').trim();
  const secondary = titles.length > 1 ? `${artists[0] || ''} ${titles[1]}`.trim() : '';
  const tertiary = (titles[0] || '').trim();

  const queries = unique([primary, secondary, tertiary].filter(Boolean));
  let pool: QqSong[] = [];
  for (const q of queries) {
    const list = await qqSearchSongs(q);
    pool = pool.concat(list);
    if (pool.length >= 8) break;
  }

  const seen = new Set<string>();
  const ranked: { song: QqSong; score: number }[] = [];
  for (const song of pool) {
    const id = `${song.songmid || ''}-${song.albumid}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const { score } = scoreQqHit(song, titles, artists);
    if (score < 80) continue;
    ranked.push({ song, score });
  }
  ranked.sort((a, b) => b.score - a.score);

  for (const { song } of ranked) {
    if (!isReliableQqHit(song, titles, artists)) continue;
    const amid = (song.albummid || '').trim();
    if (!amid || (song.albumid ?? 0) <= 0) continue;
    const url = albumCoverUrl(amid, 500);
    if (await verifyImageOk(url)) {
      return { url, song };
    }
  }

  return null;
}

function applyApple(row: Row, cover: string, officialUrl: string | null) {
  row.cover = cover;
  row.coverSource = 'apple';
  row.coverLocked = true;
  row.officialSource = 'appleMusic';
  row.coverUncertain = false;
  row.officialStatus = 'confirmed';
  if (officialUrl) row.officialUrl = officialUrl;
}

function applySpotify(row: Row, cover: string, officialUrl: string | null) {
  row.cover = cover;
  row.coverSource = 'spotify';
  row.coverLocked = true;
  row.officialSource = 'spotify';
  row.coverUncertain = false;
  row.officialStatus = 'confirmed';
  if (officialUrl) row.officialUrl = officialUrl;
}

function applyQq(row: Row, cover: string) {
  row.cover = cover;
  row.coverSource = 'qqMusic';
  row.coverLocked = true;
  row.coverUncertain = false;
  row.officialStatus = 'confirmed';
}

function assertOnlyCoverChanged(before: Row, after: Row, slug: string) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (COVER_PATCH_KEYS.has(k)) continue;
    const bv = before[k];
    const av = after[k];
    if (isDeepStrictEqual(bv, av)) continue;
    if (bv === undefined && av === undefined) continue;
    throw new Error(`非法改写非封面字段 ${slug}.${k}`);
  }
}

type Outcome =
  | { slug: string; source: 'apple' | 'spotify' | 'qq'; note: string }
  | { slug: string; source: 'skip'; reason: string }
  | { slug: string; source: 'none'; reason: string };

function loadRequestedSlugs(): string[] {
  const file = process.env.COVER_REBATCH_SLUGS_FILE?.trim();
  if (!file) return USER_REBATCH_SLUGS;
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  const text = fs.readFileSync(abs, 'utf8');
  return text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

async function main() {
  const original = JSON.parse(JSON.stringify(LOCAL_IMPORT_OFFICIAL_METADATA)) as Record<string, Row>;
  const next = JSON.parse(JSON.stringify(LOCAL_IMPORT_OFFICIAL_METADATA)) as Record<string, Row>;

  const requested = loadRequestedSlugs();
  const missingInCatalog = requested.filter((s) => !original[s]);
  const slugs = requested.filter((s) => Boolean(original[s]));

  const token = await getSpotifyAccessToken();
  if (!token) {
    console.warn('[cover-rebatch] 无 SPOTIFY_CLIENT_ID/SECRET，将跳过 Spotify 步骤');
  }

  const appleHits: string[] = [];
  const spotifyHits: string[] = [];
  const qqHits: string[] = [];
  const tripleMiss: string[] = [];
  const skipped: string[] = [];
  const outcomes: Outcome[] = [];
  const aliasNoteSlugs: string[] = [];

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    console.error(`[cover-rebatch] ${i + 1}/${slugs.length} ${slug}`);
    const beforeRow = JSON.parse(JSON.stringify(next[slug])) as Row;
    const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug as keyof typeof LOCAL_IMPORT_METADATA_OVERRIDES];
    const baseArt = unique(
      [ov?.artist, ov?.artists?.zhHans, ov?.artists?.en, beforeRow.artist].filter(Boolean) as string[],
    );
    const expandedArtists = expandArtistAliases(baseArt);
    const baseSet = new Set(baseArt);
    if (expandedArtists.some((x) => !baseSet.has(x))) aliasNoteSlugs.push(slug);

    if (SKIP_COVER_SLUGS.has(slug)) {
      skipped.push(slug);
      outcomes.push({ slug, source: 'skip', reason: '用户要求不改封面（在意）' });
      continue;
    }

    if (ov?.suppressOfficialCover) {
      skipped.push(slug);
      outcomes.push({ slug, source: 'skip', reason: 'suppressOfficialCover' });
      continue;
    }

    const a = await tryAppleForSlug(slug);
    if (a) {
      applyApple(next[slug], a.cover, a.officialUrl);
      assertOnlyCoverChanged(beforeRow, next[slug], slug);
      appleHits.push(slug);
      outcomes.push({ slug, source: 'apple', note: a.note });
      continue;
    }

    const s = await trySpotifyForSlug(slug, token);
    if (s) {
      applySpotify(next[slug], s.cover, s.officialUrl);
      assertOnlyCoverChanged(beforeRow, next[slug], slug);
      spotifyHits.push(slug);
      outcomes.push({ slug, source: 'spotify', note: s.note });
      continue;
    }

    const { titles, artists } = buildTitleArtist(slug);
    const q = await pickBestQqCover(titles, artists);
    if (q) {
      applyQq(next[slug], q.url);
      assertOnlyCoverChanged(beforeRow, next[slug], slug);
      qqHits.push(slug);
      outcomes.push({ slug, source: 'qq', note: 'qq search' });
      continue;
    }

    tripleMiss.push(slug);
    outcomes.push({ slug, source: 'none', reason: 'Apple/Spotify/QQ 均无可靠命中' });
  }

  const allowedChange = new Set(slugs);
  for (const slug of Object.keys(original)) {
    if (allowedChange.has(slug)) continue;
    if (!isDeepStrictEqual(original[slug], next[slug])) {
      console.error(`[cover-rebatch] INVARIANT FAIL: 非名单 slug 被改动 ${slug}`);
      process.exit(1);
    }
  }

  fs.writeFileSync(
    OUT_META,
    `export const LOCAL_IMPORT_OFFICIAL_METADATA = ${JSON.stringify(next, null, 2)} as const;\n`,
    'utf8',
  );

  const processedCover = slugs.filter(
    (s) =>
      !SKIP_COVER_SLUGS.has(s) &&
      !LOCAL_IMPORT_METADATA_OVERRIDES[s as keyof typeof LOCAL_IMPORT_METADATA_OVERRIDES]?.suppressOfficialCover,
  );
  const solved = appleHits.length + spotifyHits.length + qqHits.length;
  const stillManual = tripleMiss.length;

  const lines: string[] = [
    `# 用户歌单封面重抓报告`,
    ``,
    `生成时间：${new Date().toISOString()}`,
    ``,
    `## 摘要`,
    ``,
    `- 名单内库中存在的 slug：**${slugs.length}**`,
    `- 库中无元数据（未处理）：**${missingInCatalog.length}**`,
    `- 跳过封面：**${skipped.length}**（${skipped.join('、') || '—'}）`,
    `- 本次重处理（尝试抓图）：**${processedCover.length}**`,
    `- **解决（锁定封面）：${solved}**（Apple ${appleHits.length} / Spotify ${spotifyHits.length} / QQ ${qqHits.length}）`,
    `- **三边仍无可靠命中：${stillManual}**`,
    ``,
    `## 1. Apple 命中并锁定（${appleHits.length}）`,
    ``,
    ...appleHits.map((s) => `- \`${s}\``),
    ``,
    `## 2. Spotify 命中并锁定（${spotifyHits.length}）`,
    ``,
    ...spotifyHits.map((s) => `- \`${s}\``),
    ``,
    `## 3. QQ 音乐命中并锁定（${qqHits.length}）`,
    ``,
    ...qqHits.map((s) => `- \`${s}\``),
    ``,
    `## 4. 三边均无可靠命中（${tripleMiss.length}）`,
    ``,
    ...tripleMiss.map((s) => `- \`${s}\``),
    ``,
    `## 库中无 local-import 元数据的名单 slug（${missingInCatalog.length}）`,
    ``,
    ...missingInCatalog.map((s) => `- \`${s}\`（请确认是否尚未入库或 slug 不同）`),
    ``,
    `## 别名扩展曾参与搜索的 slug（供参考，${aliasNoteSlugs.length}）`,
    ``,
    ...aliasNoteSlugs.map((s) => `- \`${s}\``),
    ``,
  ];

  fs.mkdirSync(path.dirname(OUT_REPORT), { recursive: true });
  fs.writeFileSync(OUT_REPORT, lines.join('\n'), 'utf8');

  console.log(
    JSON.stringify(
      {
        slugsInCatalog: slugs.length,
        missingInCatalog: missingInCatalog.length,
        apple: appleHits.length,
        spotify: spotifyHits.length,
        qq: qqHits.length,
        unsolved: tripleMiss.length,
        skipped,
      },
      null,
      2,
    ),
  );
  console.log('[cover-rebatch] wrote', path.relative(ROOT, OUT_META));
  console.log('[cover-rebatch] report', path.relative(ROOT, OUT_REPORT));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
