/**
 * 剩余华语向封面专项：QQ 优先 → Apple → Spotify；支持专辑封面兜底与多组合搜索。
 * 不处理：水龙吟、灯火万家、shoot、Hello（仅报告为建议人工锚定）。
 *
 * 用法: npx tsx scripts/cover-cpop-remaining.ts
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
const OUT_REPORT = path.join(ROOT, 'tmp/cover-cpop-remaining-report.md');
const OUT_TAXONOMY = path.join(ROOT, 'tmp/cover-cpop-remaining-taxonomy.md');

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

/** 二轮报告里「三边均无」；下列四首仅人工锚定，本脚本不自动搜 */
const NO_AUTO_RETRY = new Set(['水龙吟', '灯火万家', 'shoot', 'Hello']);

const REMAINING_UNSOLVED_76: string[] = [
  '水龙吟',
  '灯火万家',
  'shoot',
  'Hello',
  '晨光里有你',
  '耻辱柱',
  '借过一下',
  '蜃楼',
  '失恋循环',
  'komorebi',
  '这么可爱真是抱歉',
  '躺着真舒服',
  '我想我会',
  '耀眼的你',
  '幻化成花',
  '红颜如霜',
  '还在流浪',
  '最伟大的作品',
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
  '雪花',
  '雪龙吟',
  'time to shine',
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
  '剩下的盛夏',
  '秋天前',
  'Got You',
  '意气趁年少',
  '新时代 冬奥运',
  'Lalisa',
  '傻瓜',
  '陷入爱情',
  '烟火星辰',
  'into the fire',
  '约定之初',
  '练习曲',
  'ei ei',
  'of course',
  '热爱105度的你',
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
  '你就不要想起我',
  'fix me',
  '小小',
  '不冬眠',
  '明天见',
  '你不属于我',
  '只因你太美',
  '我的舞台',
];

const JAY_ALBUM_SLUGS = new Set(['红颜如霜', '还在流浪', '最伟大的作品']);
const SNH48_SLUGS = new Set(['时间的歌', '春夏秋冬', '人鱼', '爱恨的泪']);
const CHUANG_INTO1_SLUGS = new Set([
  '少年的模样',
  'Lover boy 88',
  'Nana party',
  '输入法打可爱按第五',
  '你就不要想起我',
  'fix me',
]);
const GLORY_SLUGS = new Set(['陷入爱情', '烟火星辰']);

const ALIAS_GROUPS: string[][] = [
  ['时代少年团', 'TNT', 'TNT时代少年团', 'Teens in Times', 'TEENS IN TIMES', '时代少年'],
  ['蔡徐坤', 'KUN', 'Cai Xukun', 'CAI XUKUN', 'KUN蔡徐坤'],
  ['周深', 'Charlie Zhou Shen', 'Zhou Shen', 'CHARLIE ZHOU SHEN', 'Charlie'],
  ['刘耀文', 'Liu Yaowen'],
  ['马嘉祺', 'Ma Jiaqi'],
  ['丁程鑫', 'Ding Chengxin'],
  ['宋亚轩', 'Song Yaxuan'],
  ['严浩翔', 'Yan Haoxiang'],
  ['贺峻霖', 'He Junlin'],
  ['张真源', 'Zhang Zhenyuan'],
  ['王源', 'Roy Wang', 'Karry Wang', '王俊凯', '易烊千玺', 'TFBOYS'],
  ['INTO1', '创造营2021', '创造营'],
  ['SNH48', 'SNH48 GROUP'],
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

function scoreItunesAlbum(
  collectionName: string | undefined,
  artistName: string | undefined,
  albumWant: string[],
  artistWants: string[],
): number {
  const cn = norm(collectionName || '');
  const an = norm(artistName || '');
  let ts = 0;
  for (const w of albumWant) {
    const x = norm(w);
    if (!x) continue;
    if (cn.includes(x) || x.includes(cn)) ts = Math.max(ts, 95);
    else if (cn.includes(x.slice(0, Math.min(8, x.length)))) ts = Math.max(ts, 70);
  }
  let ar = 0;
  for (const aw0 of artistWants) {
    const aw = norm(aw0);
    if (!aw) continue;
    if (an.includes(aw) || aw.includes(an)) ar = Math.max(ar, 70);
  }
  return ts + ar;
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
    collectionName?: string;
    wrapperType?: string;
  }[]
> {
  const u = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=25&country=${country}`;
  const res = await fetch(u, { headers: { 'User-Agent': 'AuraSounds-cover-cpop/1.0' } });
  const text = await res.text();
  if (!text.trim().startsWith('{')) return [];
  const j = JSON.parse(text) as {
    results?: {
      artworkUrl100?: string;
      trackName?: string;
      artistName?: string;
      trackViewUrl?: string;
      collectionViewUrl?: string;
      collectionName?: string;
      wrapperType?: string;
    }[];
  };
  return j.results ?? [];
}

async function itunesLookup(trackId: string, country: string) {
  const u = `https://itunes.apple.com/lookup?id=${encodeURIComponent(trackId)}&country=${country}&entity=song`;
  const res = await fetch(u, { headers: { 'User-Agent': 'AuraSounds-cover-cpop/1.0' } });
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
  return j.results?.find((x) => x.trackName || x.wrapperType === 'track') || null;
}

const APPLE_GAP_MS = Math.max(300, Number(process.env.APPLE_COVER_GAP_MS ?? '450') || 450);
let appleNext = 0;
async function applePause() {
  const now = Date.now();
  if (now < appleNext) await new Promise((r) => setTimeout(r, appleNext - now));
  appleNext = Date.now() + APPLE_GAP_MS;
}

let jayAlbumArtCache: string | null | undefined;

async function tryJayChouGreatestWorksAlbumCover(): Promise<string | null> {
  if (jayAlbumArtCache !== undefined) return jayAlbumArtCache;
  jayAlbumArtCache = null;
  const queries = ['最伟大的作品 周杰伦', 'Greatest Works of Art Jay Chou', '周杰伦 最伟大的作品'];
  for (const q of queries) {
    for (const country of ['cn', 'tw', 'hk']) {
      await applePause();
      const results = await itunesSearch(q, country, 'album');
      let best: { tr: (typeof results)[0]; score: number } | null = null;
      for (const tr of results) {
        const sc = scoreItunesAlbum(tr.collectionName, tr.artistName, ['最伟大的作品', 'Greatest Works'], [
          '周杰伦',
          'Jay Chou',
        ]);
        if (!best || sc > best.score) best = { tr, score: sc };
      }
      if (best && best.score >= 115 && best.tr.artworkUrl100) {
        const u = to600(best.tr.artworkUrl100);
        if (u) {
          jayAlbumArtCache = u;
          return u;
        }
      }
    }
  }
  await applePause();
  const qq = await qqSearchSongs('最伟大的作品 周杰伦');
  for (const s of qq.slice(0, 8)) {
    const sn = stripEm(s.songname || '');
    if (norm(sn).includes('最伟大的作品') || norm(sn).includes('红颜')) {
      const amid = (s.albummid || '').trim();
      if (amid.length >= 8) {
        const url = albumCoverUrl(amid, 500);
        if (await verifyImageOk(url)) {
          jayAlbumArtCache = url;
          return url;
        }
      }
    }
  }
  return null;
}

/** QQ */
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

const QQ_GAP_MS = Math.max(180, Number(process.env.QQ_COVER_REQUEST_GAP_MS ?? '400') || 400);
let qqNext = 0;

async function qqSearchSongs(keyword: string): Promise<QqSong[]> {
  const now = Date.now();
  if (now < qqNext) await new Promise((r) => setTimeout(r, qqNext - now));
  qqNext = Date.now() + QQ_GAP_MS;

  const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=30&w=${encodeURIComponent(keyword)}&format=json`;
  const res = await fetch(url, {
    headers: {
      Referer: 'https://y.qq.com/',
      'User-Agent': 'Mozilla/5.0 (compatible; AuraSounds-cover-cpop/1.0)',
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

function scoreQqHit(
  song: QqSong,
  titles: string[],
  artists: string[],
  albumBonus: string[] = [],
): { score: number } {
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

  let alb = 0;
  for (const hint of albumBonus) {
    const h = normQq(hint);
    if (h.length >= 2 && nsong.includes(h)) alb = Math.max(alb, 25);
  }

  const hasArtistHint = artists.some((a) => normQq(a).length >= 2);
  let score = bestTitle + bestArt + alb;
  if (!hasArtistHint) {
    if (bestTitle >= 88) score = bestTitle + 40;
    else score = bestTitle;
  }

  return { score };
}

function isReliableQqHit(
  song: QqSong,
  titles: string[],
  artists: string[],
  albumBonus: string[] = [],
  relaxedAlbum = false,
): boolean {
  const { score } = scoreQqHit(song, titles, artists, albumBonus);
  const hasArtistHint = artists.some((a) => normQq(a).length >= 2);
  const sn = stripEm(song.songname || '');
  const nt0 = titles[0] ? normQq(titles[0]) : '';
  const titleExact = nt0 && normQq(sn) === nt0;

  const threshold = relaxedAlbum && hasArtistHint ? 148 : hasArtistHint ? 158 : 130;
  if (hasArtistHint) {
    return score >= threshold;
  }
  return titleExact && score >= 125;
}

function buildExpandedQueries(slug: string, titles: string[], artists: string[]): string[] {
  const t0 = titles[0] || '';
  const a0 = artists[0] || '';
  const cip = (LOCAL_IMPORT_CIP_LINKS as Record<string, { matchedVideoTitle?: string } | undefined>)[slug];
  const mv = cip?.matchedVideoTitle || '';
  const out: string[] = [];

  const push = (s: string) => {
    const x = s.trim();
    if (x) out.push(x);
  };

  if (t0 && a0) {
    push(`${t0} ${a0}`);
    push(`${a0} ${t0}`);
    push(`${t0} ${a0} 主题曲`);
    push(`${t0} ${a0} 插曲`);
    push(`${t0} ${a0} OST`);
    push(`${t0} ${a0} 片尾曲`);
    push(`${t0} ${a0} 片头曲`);
  }
  for (const a of artists.slice(0, 5)) {
    for (const t of titles.slice(0, 3)) {
      if (t && a) push(`${t} ${a}`);
    }
  }
  if (JAY_ALBUM_SLUGS.has(slug)) {
    push(`${t0} 周杰伦`);
    push(`周杰伦 ${t0}`);
  }
  if (SNH48_SLUGS.has(slug)) {
    push(`SNH48 ${t0}`);
    push(`${t0} SNH48`);
  }
  if (CHUANG_INTO1_SLUGS.has(slug)) {
    push(`创造营2021 ${t0}`);
    push(`INTO1 ${t0}`);
    push(`${t0} INTO1`);
    push(`创造营 ${t0}`);
  }
  if (GLORY_SLUGS.has(slug)) {
    push(`${t0} 你是我的荣耀`);
    push(`你是我的荣耀 ${t0}`);
    push(`${t0} 杨洋`);
  }
  if (/[\p{Script=Han}]/u.test(t0) && a0 && /[A-Za-z]{2,}/u.test(a0)) {
    push(`${t0} ${a0}`);
  }
  for (const a of artists) {
    if (/[\p{Script=Han}]/u.test(t0) && /[A-Za-z]{2,}/u.test(a)) push(`${a} ${t0}`);
  }
  if (mv.length > 12 && mv.length < 200) {
    const strip = mv.replace(/\s*Piano Cover.*$/i, '').replace(/\s*\|.*$/, '').trim();
    if (strip.length > 8) push(strip.slice(0, 120));
  }

  return unique(out);
}

async function tryQqAll(
  slug: string,
  titles: string[],
  artists: string[],
  albumBonus: string[],
): Promise<{ url: string; albumSubstitute: boolean; note: string } | null> {
  const queries = buildExpandedQueries(slug, titles, artists);
  let pool: QqSong[] = [];
  const seenQ = new Set<string>();
  for (const q of queries) {
    if (seenQ.has(q)) continue;
    seenQ.add(q);
    const list = await qqSearchSongs(q);
    pool = pool.concat(list);
    if (pool.length >= 40) break;
  }

  const seen = new Set<string>();
  const ranked: { song: QqSong; score: number; relaxed: boolean }[] = [];
  for (const song of pool) {
    const id = `${song.songmid || ''}-${song.albummid}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const { score } = scoreQqHit(song, titles, artists, albumBonus);
    if (score < 70) continue;
    const rel = isReliableQqHit(song, titles, artists, albumBonus, false);
    const rel2 = !rel && isReliableQqHit(song, titles, artists, albumBonus, true);
    ranked.push({ song, score, relaxed: rel2 });
  }
  ranked.sort((a, b) => b.score - a.score);

  for (const { song, relaxed } of ranked) {
    const ok =
      isReliableQqHit(song, titles, artists, albumBonus, relaxed) ||
      (albumBonus.length > 0 && isReliableQqHit(song, titles, artists, albumBonus, true));
    if (!ok) continue;
    const amid = (song.albummid || '').trim();
    if (!amid || (song.albumid ?? 0) <= 0) continue;
    const url = albumCoverUrl(amid, 500);
    if (await verifyImageOk(url)) {
      const sub = !stripEm(song.songname || '').includes(titles[0]?.slice(0, 3) || '___');
      return {
        url,
        albumSubstitute: albumBonus.length > 0 || sub,
        note: `qq ${relaxed ? 'relaxed' : 'strict'}`,
      };
    }
  }
  return null;
}

async function tryAppleTrackAndAlbum(
  slug: string,
  titles: string[],
  artists: string[],
  albumHints: string[],
): Promise<{ cover: string; officialUrl: string | null; albumSubstitute: boolean; note: string } | null> {
  const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug as keyof typeof LOCAL_IMPORT_METADATA_OVERRIDES];
  const tid = extractAppleTrackIdFromUrl(ov?.officialLinks?.appleMusic);
  if (tid) {
    for (const country of ['cn', 'tw', 'hk', 'us']) {
      await applePause();
      const hit = await itunesLookup(tid, country);
      const u600 = to600(hit?.artworkUrl100);
      if (u600) {
        return {
          cover: u600,
          officialUrl: hit?.trackViewUrl ?? null,
          albumSubstitute: false,
          note: `lookup ${country}`,
        };
      }
    }
  }

  const queries: string[] = [];
  const t0 = titles[0] || '';
  for (const a of artists.slice(0, 6)) {
    if (t0 && a) queries.push(`${t0} ${a}`, `${a} ${t0}`);
  }
  for (const h of albumHints) {
    queries.push(`${h} ${artists[0] || ''}`.trim());
    queries.push(`${t0} ${h}`);
  }
  for (const t of titles.slice(0, 2)) {
    if (t) queries.push(t);
  }

  const countries = /[\p{Script=Han}]/u.test(t0) ? (['cn', 'hk', 'tw'] as const) : (['us', 'tw', 'cn'] as const);
  const minScore = artists.some((x) => !junkArtist(x) && norm(x).length >= 2) ? 74 : 85;

  const seen = new Set<string>();
  for (const q of queries) {
    const qt = q.trim();
    if (!qt || seen.has(qt)) continue;
    seen.add(qt);
    if (seen.size > 14) break;

    for (const country of countries) {
      await applePause();
      let results = await itunesSearch(qt, country, 'song');
      if (!results.length) {
        await applePause();
        results = await itunesSearch(qt, country, 'album');
      }
      let best: { tr: (typeof results)[0]; score: number; isAlbum: boolean } | null = null;
      for (const tr of results) {
        const isAlb = Boolean(tr.collectionName && !tr.trackName);
        const sc = isAlb
          ? scoreItunesAlbum(tr.collectionName, tr.artistName, titles.concat(albumHints), artists)
          : scoreItunesPick(titles, artists, tr);
        const adj = isAlb ? sc : sc;
        if (!best || adj > best.score) best = { tr, score: adj, isAlbum: isAlb };
      }
      if (best && best.score >= minScore - (best.isAlbum ? 5 : 0) && best.tr.artworkUrl100) {
        const u600 = to600(best.tr.artworkUrl100);
        if (u600) {
          return {
            cover: u600,
            officialUrl: best.tr.trackViewUrl || best.tr.collectionViewUrl || null,
            albumSubstitute: best.isAlbum,
            note: `apple ${country} ${best.isAlbum ? 'album' : 'track'}`,
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
  if (gap < 8) return { ok: false, uncertain: true };
  if (d.total < 88) return { ok: false, uncertain: d.total >= 75 };
  if (hasArtistHint) {
    if (!d.artistMatched && !d.titleExact) return { ok: false, uncertain: false };
    if (!d.artistMatched && d.titleMax <= 72) return { ok: false, uncertain: true };
  }
  if (d.total < 100 && !d.artistMatched && !d.titleExact) return { ok: false, uncertain: true };
  return { ok: true, uncertain: false };
}

let spotifyTokenCache: { token: string; expiresAt: number } | null = null;
const SPOTIFY_GAP_MS = Math.max(500, Number(process.env.SPOTIFY_REQUEST_GAP_MS ?? '2000') || 2000);
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
    `https://api.spotify.com/v1/tracks/${encodeURIComponent(trackId)}?market=TW`,
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

const SPOTIFY_SEARCH_INTER_QUERY_MS = Math.max(0, Number(process.env.SPOTIFY_SEARCH_INTER_QUERY_MS ?? '1200') || 1200);

async function searchSpotifyBestTrackCover(
  token: string,
  titleCandidates: string[],
  artistCandidates: string[],
  market: string,
) {
  const titles = [...new Set(titleCandidates.filter(Boolean))].slice(0, 8);
  const artists = [...new Set(artistCandidates.filter(Boolean))].slice(0, 10);
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
  if (topMid < 92 && t0 && a0) await fetchSearch(`${t0} ${a0}`);
  const ranked2 = [...byTrackId.values()].sort((a, b) => b.detail.total - a.detail.total);
  const top2 = ranked2[0]?.detail.total ?? 0;
  if (top2 < 80 && t0) await fetchSearch(t0);

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

async function trySpotifyLast(
  slug: string,
  token: string | null,
  titles: string[],
  artists: string[],
): Promise<{ cover: string; officialUrl: string | null; note: string } | null> {
  if (!token) return null;
  const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug as keyof typeof LOCAL_IMPORT_METADATA_OVERRIDES];
  const sid = extractSpotifyTrackIdFromUrl(ov?.officialLinks?.spotify);
  if (sid) {
    const r = await fetchSpotifyTrackCoverById(token, sid);
    if (r.coverUrl) return { cover: r.coverUrl, officialUrl: r.externalUrl, note: `id ${sid}` };
  }
  const hasHint = hasStrongArtistHint(artists);
  for (const market of ['TW', 'HK', 'US']) {
    const spSearch = await searchSpotifyBestTrackCover(token, titles, artists, market);
    if (!spSearch.coverUrl || !spSearch.best) continue;
    const strict = classifySpotifySearchPick(
      { coverUrl: spSearch.coverUrl, detail: spSearch.best.detail },
      spSearch.second,
      hasHint,
    );
    if (strict.ok && !strict.uncertain) {
      return { cover: spSearch.coverUrl, officialUrl: spSearch.externalUrl, note: `sp ${market}` };
    }
  }
  return null;
}

function applyQq(row: Row, cover: string) {
  row.cover = cover;
  row.coverSource = 'qqMusic';
  row.coverLocked = true;
  row.coverUncertain = false;
  row.officialStatus = 'confirmed';
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

function hasStoreLock(row: Row | undefined): boolean {
  if (!row || row.coverLocked !== true) return false;
  const cs = String(row.coverSource || '');
  const src = String(row.officialSource || '');
  const cov = String(row.cover || '');
  const ok =
    /^(apple|appleMusic|spotify|qqMusic)$/i.test(cs) ||
    src === 'appleMusic' ||
    src === 'spotify';
  const urlOk = /mzstatic|y\.gtimg\.cn|scdn\.co/i.test(cov);
  return ok && urlOk;
}

type Taxon =
  | '正规单曲但搜索未命中'
  | 'OST/项目/推广/主题曲类'
  | '短标题或重名高风险'
  | '艺人别名或团名中英混用'
  | '平台正式发行名与库内不一致'
  | '宜用专辑封面替代单曲图';

function classifyTaxonomy(slug: string): { primary: Taxon; tags: string[] } {
  const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug as keyof typeof LOCAL_IMPORT_METADATA_OVERRIDES];
  const cip = (LOCAL_IMPORT_CIP_LINKS as Record<string, { matchedVideoTitle?: string } | undefined>)[slug];
  const mv = cip?.matchedVideoTitle || '';
  const blob = `${ov?.title || ''}${ov?.displayTitle || ''}${mv}${slug}`;
  const tags: string[] = [];

  if (
    JAY_ALBUM_SLUGS.has(slug) ||
    SNH48_SLUGS.has(slug) ||
    CHUANG_INTO1_SLUGS.has(slug) ||
    GLORY_SLUGS.has(slug)
  ) {
    tags.push('专辑兜底候选');
  }
  if (/主题曲|插曲|片头|片尾|OST|原声|影视|推广|动画|游戏|企划|综艺/.test(blob)) {
    tags.push('OST/影视');
  }
  const zhTitle = ov?.titles?.zhHans || ov?.title || slug;
  if (zhTitle && [...zhTitle].length <= 2) {
    tags.push('短标题');
  }
  if (
    /周深|TNT|时代少年|蔡徐坤|KUN|Teens|Charlie|SNH48|INTO1|创造营/.test(blob) ||
    expandArtistAliases([ov?.artist || '']).length > 3
  ) {
    tags.push('别名');
  }
  if (JAY_ALBUM_SLUGS.has(slug) || SNH48_SLUGS.has(slug) || CHUANG_INTO1_SLUGS.has(slug) || GLORY_SLUGS.has(slug)) {
    return { primary: '宜用专辑封面替代单曲图', tags };
  }
  if (/主题曲|插曲|片头|片尾|OST|原声/.test(blob)) {
    return { primary: 'OST/项目/推广/主题曲类', tags };
  }
  if (tags.includes('短标题')) {
    return { primary: '短标题或重名高风险', tags };
  }
  if (tags.includes('别名')) {
    return { primary: '艺人别名或团名中英混用', tags };
  }
  return { primary: '正规单曲但搜索未命中', tags };
}

async function resolveOneSlug(
  slug: string,
  spotifyToken: string | null,
): Promise<{
  source: 'qq' | 'apple' | 'spotify' | 'none';
  coverUrl: string | null;
  officialUrl: string | null;
  albumSubstitute: boolean;
  note: string;
}> {
  const { titles, artists } = buildTitleArtist(slug);
  const albumBonus: string[] = [];
  if (GLORY_SLUGS.has(slug)) albumBonus.push('你是我的荣耀');
  if (CHUANG_INTO1_SLUGS.has(slug)) albumBonus.push('创造营2021', 'INTO1');
  if (SNH48_SLUGS.has(slug)) albumBonus.push('SNH48');

  if (JAY_ALBUM_SLUGS.has(slug)) {
    const jay = await tryJayChouGreatestWorksAlbumCover();
    if (jay) {
      return {
        source: 'apple',
        coverUrl: jay,
        officialUrl: null,
        albumSubstitute: true,
        note: '周杰伦《最伟大的作品》专辑封面兜底',
      };
    }
  }

  const qq = await tryQqAll(slug, titles, artists, albumBonus);
  if (qq) {
    return {
      source: 'qq',
      coverUrl: qq.url,
      officialUrl: null,
      albumSubstitute: qq.albumSubstitute,
      note: qq.note,
    };
  }

  const ap = await tryAppleTrackAndAlbum(slug, titles, artists, albumBonus);
  if (ap) {
    return {
      source: 'apple',
      coverUrl: ap.cover,
      officialUrl: ap.officialUrl,
      albumSubstitute: ap.albumSubstitute,
      note: ap.note,
    };
  }

  const sp = await trySpotifyLast(slug, spotifyToken, titles, artists);
  if (sp) {
    return {
      source: 'spotify',
      coverUrl: sp.cover,
      officialUrl: sp.officialUrl,
      albumSubstitute: false,
      note: sp.note,
    };
  }

  return { source: 'none', coverUrl: null, officialUrl: null, albumSubstitute: false, note: '' };
}

async function main() {
  const token = await getSpotifyAccessToken();
  if (!token) console.warn('[cover-cpop] 无 SPOTIFY_* ，Spotify 步骤将跳过');

  const original = JSON.parse(JSON.stringify(LOCAL_IMPORT_OFFICIAL_METADATA)) as Record<string, Row>;
  const next = JSON.parse(JSON.stringify(LOCAL_IMPORT_OFFICIAL_METADATA)) as Record<string, Row>;

  const processSlugs = REMAINING_UNSOLVED_76.filter((s) => !NO_AUTO_RETRY.has(s));

  const taxonomyLines: string[] = [
    `# 剩余未解决歌曲 · 失败原因分型（跑批前启发式）`,
    ``,
    `说明：以下为规则自动分型，便于对照；单曲与「专辑兜底」可并存标签。`,
    ``,
  ];
  const byCat = new Map<Taxon, string[]>();
  for (const slug of processSlugs) {
    const { primary, tags } = classifyTaxonomy(slug);
    if (!byCat.has(primary)) byCat.set(primary, []);
    byCat.get(primary)!.push(slug);
    taxonomyLines.push(`- **${slug}** → ${primary}${tags.length ? `（${tags.join('、')}）` : ''}`);
  }
  for (const [k, slugs] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    taxonomyLines.push(``);
    taxonomyLines.push(`## ${k}（${slugs.length}）`);
    taxonomyLines.push(``);
    taxonomyLines.push(...slugs.map((s) => `- \`${s}\``));
  }
  fs.mkdirSync(path.dirname(OUT_TAXONOMY), { recursive: true });
  fs.writeFileSync(OUT_TAXONOMY, taxonomyLines.join('\n') + '\n', 'utf8');

  let solved = 0;
  let skippedPreLocked = 0;
  let qqN = 0,
    appleN = 0,
    spotifyN = 0,
    albumSubN = 0;
  const solvedRows: { slug: string; source: string; albumSub: boolean; note: string }[] = [];
  const failedAfterAttempt: string[] = [];

  for (let i = 0; i < processSlugs.length; i++) {
    const slug = processSlugs[i];
    console.error(`[cover-cpop] ${i + 1}/${processSlugs.length} ${slug}`);
    const row = next[slug];
    if (!row) continue;
    if (hasStoreLock(row)) {
      skippedPreLocked += 1;
      continue;
    }

    const beforeRow = JSON.parse(JSON.stringify(row)) as Row;
    const r = await resolveOneSlug(slug, token);

    if (r.source === 'none' || !r.coverUrl) {
      failedAfterAttempt.push(slug);
      continue;
    }

    if (r.source === 'qq') applyQq(row, r.coverUrl);
    else if (r.source === 'apple') applyApple(row, r.coverUrl, r.officialUrl);
    else if (r.source === 'spotify') applySpotify(row, r.coverUrl, r.officialUrl);

    assertOnlyCoverChanged(beforeRow, row, slug);
    solved++;
    if (r.source === 'qq') qqN++;
    else if (r.source === 'apple') appleN++;
    else if (r.source === 'spotify') spotifyN++;
    if (r.albumSubstitute) albumSubN++;
    solvedRows.push({ slug, source: r.source, albumSub: r.albumSubstitute, note: r.note });
  }

  const allowed = new Set(processSlugs);
  for (const slug of Object.keys(original)) {
    if (allowed.has(slug)) continue;
    if (!isDeepStrictEqual(original[slug], next[slug])) {
      console.error(`[cover-cpop] INVARIANT FAIL: ${slug}`);
      process.exit(1);
    }
  }

  fs.writeFileSync(
    OUT_META,
    `export const LOCAL_IMPORT_OFFICIAL_METADATA = ${JSON.stringify(next, null, 2)} as const;\n`,
    'utf8',
  );

  const stillNoLock = processSlugs.filter((s) => !hasStoreLock(next[s]));
  const stillTax: string[] = [];
  for (const slug of stillNoLock) {
    const { primary } = classifyTaxonomy(slug);
    stillTax.push(`- \`${slug}\` — ${primary}`);
  }

  const report = [
    `# 华语专项封面重抓报告`,
    ``,
    `生成时间：${new Date().toISOString()}`,
    ``,
    `## 摘要`,
    ``,
    `- 本批处理 slug 数（排除人工锚定四首）：**${processSlugs.length}**`,
    `- **跑批前已有商店锁定（跳过尝试）：${skippedPreLocked}**`,
    `- **本轮新锁定封面：${solved}**`,
    `- 其中 QQ：**${qqN}** · Apple：**${appleN}** · Spotify：**${spotifyN}**`,
    `- **专辑图替代单曲图（标记）：${albumSubN}**`,
    `- **本轮曾尝试但仍未命中（QQ→Apple→Spotify 皆未写入）：${failedAfterAttempt.length}**`,
    `- **本批结束后仍无商店锁定：${stillNoLock.length}**`,
    ``,
    `## 建议人工锚定（不再自动猜）`,
    ``,
    ...[...NO_AUTO_RETRY].map((s) => `- \`${s}\``),
    ``,
    `## 本轮解决明细`,
    ``,
    ...solvedRows.map(
      (x) =>
        `- \`${x.slug}\` — ${x.source}${x.albumSub ? ' · 含专辑兜底' : ''} — ${x.note}`,
    ),
    ``,
    `## 仍未解决及分型`,
    ``,
    ...(failedAfterAttempt.length
      ? [
          `以下为 **本轮实际尝试后** 仍未锁定的 slug：`,
          ``,
          ...failedAfterAttempt.map((s) => {
            const { primary } = classifyTaxonomy(s);
            return `- \`${s}\` — ${primary}`;
          }),
          ``,
        ]
      : [`（本轮尝试队列中无此类；或已全部具备商店锁定）`, ``]),
    ...(stillNoLock.length && stillNoLock.length !== failedAfterAttempt.length
      ? [
          ``,
          `**本批结束后仍无锁定（与上表可能因手工改库而不完全一致）：**`,
          ``,
          ...stillTax,
        ]
      : []),
    ``,
    `## 分型说明`,
    ``,
    `启发式分型见：\`${path.relative(ROOT, OUT_TAXONOMY)}\``,
    ``,
  ];

  fs.writeFileSync(OUT_REPORT, report.join('\n'), 'utf8');

  console.log(
    JSON.stringify(
      {
        processed: processSlugs.length,
        skippedPreLocked,
        solved,
        qq: qqN,
        apple: appleN,
        spotify: spotifyN,
        albumSubstitute: albumSubN,
        failedAfterAttempt: failedAfterAttempt.length,
        stillNoLock: stillNoLock.length,
      },
      null,
      2,
    ),
  );
  console.log('[cover-cpop] wrote', path.relative(ROOT, OUT_META));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
