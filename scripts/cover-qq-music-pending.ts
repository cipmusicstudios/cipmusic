/**
 * 仅对「封面稳定性报告」第 3 类中可处理条目：用 QQ 音乐搜索（歌名+歌手）取专辑封面，命中可靠则只写 cover 相关字段并锁定。
 * 不修改：artist、normalizedArtistsInfo、mappedCategory、mappedTags、rawCategory、officialUrl、officialSource 等。
 *
 * 用法: npx tsx scripts/cover-qq-music-pending.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { LOCAL_IMPORT_OFFICIAL_METADATA } from '../src/local-import-official-metadata.generated';
import { LOCAL_IMPORT_METADATA_OVERRIDES } from '../src/local-import-metadata-overrides';
import { LOCAL_IMPORT_CIP_LINKS } from '../src/local-import-cip-links.generated';
import { LOCAL_IMPORT_SEEDS } from '../src/local-import-seeds.generated';

const ROOT = process.cwd();
const OUT_META = path.join(ROOT, 'src/local-import-official-metadata.generated.ts');
const OUT_REPORT = path.join(ROOT, 'tmp/cover-qq-music-pending-report.md');

/** 仅允许写入的字段（封面链路） */
const COVER_PATCH_KEYS = new Set(['cover', 'coverSource', 'coverLocked', 'coverUncertain', 'officialStatus']);

type Row = Record<string, unknown>;

const unique = <T>(a: T[]) => Array.from(new Set(a.filter(Boolean) as T[]));

const isMzOrSpotify = (u: string | undefined) => {
  if (!u?.trim()) return false;
  const x = u.toLowerCase();
  return /mzstatic\.com\/image|i\.scdn\.co\/image/.test(x);
};

/** 与 cover-stability-report.ts 一致 */
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

function buildTitleArtist(slug: string): { titles: string[]; artists: string[] } {
  const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug];
  const cip = (LOCAL_IMPORT_CIP_LINKS as Record<string, { matchTitle?: string } | undefined>)[slug];
  const seed = SEED_BY_SLUG[slug];
  const row = LOCAL_IMPORT_OFFICIAL_METADATA[slug] as Row | undefined;

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

  const artists = unique(
    [ov?.artist, ov?.artists?.zhHans, ov?.artists?.en, row?.artist as string | undefined].filter(
      Boolean,
    ) as string[],
  );

  return { titles, artists };
}

const stripEm = (s: string) => s.replace(/<\/?.em>/gi, '').replace(/<[^>]+>/g, '');

const norm = (s: string) =>
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
};

function albumCoverUrl(albummid: string, px: 300 | 500 = 500): string {
  return `https://y.gtimg.cn/music/photo_new/T002R${px}x${px}M000${albummid}.jpg`;
}

const GAP_MS = Math.max(200, Number(process.env.QQ_COVER_REQUEST_GAP_MS ?? '500') || 500);
let nextSlot = 0;

async function qqSearchSongs(keyword: string): Promise<QqSong[]> {
  const now = Date.now();
  if (now < nextSlot) await new Promise((r) => setTimeout(r, nextSlot - now));
  nextSlot = Date.now() + GAP_MS;

  const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=25&w=${encodeURIComponent(keyword)}&format=json`;
  const res = await fetch(url, {
    headers: {
      Referer: 'https://y.qq.com/',
      'User-Agent': 'Mozilla/5.0 (compatible; AuraSounds-cover/1.0)',
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

function scoreHit(song: QqSong, titles: string[], artists: string[]): { score: number; reason: string } {
  const sn = stripEm(song.songname || '');
  const albumid = song.albumid ?? 0;
  const amid = (song.albummid || '').trim();
  if (albumid <= 0 || amid.length < 8) {
    return { score: 0, reason: '无有效专辑' };
  }

  let bestTitle = 0;
  let titleReason = '';
  const nsong = norm(sn);
  for (const t of titles) {
    const nt = norm(t);
    if (!nt) continue;
    if (nsong === nt) {
      bestTitle = 100;
      titleReason = 'title=';
      break;
    }
    if (nsong.includes(nt) || nt.includes(nsong)) {
      bestTitle = Math.max(bestTitle, 88);
      titleReason = 'title≈';
    }
  }

  const singerLine = (song.singer || []).map((s) => s.name || '').join(' ');
  const nsing = norm(singerLine);
  let bestArt = 0;
  let artReason = '';
  for (const a of artists) {
    const na = norm(a);
    if (na.length < 2) continue;
    if (nsing.includes(na) || na.split(/\s+/).some((w) => w.length > 1 && nsing.includes(w))) {
      bestArt = 85;
      artReason = 'artist';
      break;
    }
  }

  const hasArtistHint = artists.some((a) => norm(a).length >= 2);
  let score = bestTitle + bestArt;
  if (!hasArtistHint) {
    /** 无歌手提示时更依赖标题 */
    if (bestTitle >= 88) score = bestTitle + 40;
    else score = bestTitle;
  }

  return {
    score,
    reason: `${titleReason}${artReason || (hasArtistHint ? 'no-art' : 'solo-title')}`,
  };
}

/** 可靠：有专辑图 + 标题强匹配 +（有歌手时）歌手匹配 */
function isReliableHit(song: QqSong, titles: string[], artists: string[]): boolean {
  const { score } = scoreHit(song, titles, artists);
  const hasArtistHint = artists.some((a) => norm(a).length >= 2);
  const sn = stripEm(song.songname || '');
  const nt0 = titles[0] ? norm(titles[0]) : '';
  const titleExact = nt0 && norm(sn) === nt0;

  if (hasArtistHint) {
    return score >= 165;
  }
  return titleExact && score >= 130;
}

async function pickBestQqCover(titles: string[], artists: string[]): Promise<{ url: string; song: QqSong } | null> {
  const primary = artists.length
    ? `${artists[0]} ${titles[0] || ''}`.trim()
    : (titles[0] || '').trim();
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
    const id = `${song.songmid || ''}-${song.albummid}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const { score } = scoreHit(song, titles, artists);
    if (score < 80) continue;
    ranked.push({ song, score });
  }
  ranked.sort((a, b) => b.score - a.score);

  for (const { song } of ranked) {
    if (!isReliableHit(song, titles, artists)) continue;
    const amid = (song.albummid || '').trim();
    if (!amid || (song.albumid ?? 0) <= 0) continue;
    const url = albumCoverUrl(amid, 500);
    if (await verifyImageOk(url)) {
      return { url, song };
    }
  }

  return null;
}

function assertNonCoverUnchanged(before: Row, after: Row, slug: string) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (COVER_PATCH_KEYS.has(k)) continue;
    const bv = before[k];
    const av = after[k];
    if (isDeepStrictEqual(bv, av)) continue;
    if (bv === undefined && av === undefined) continue;
    throw new Error(`[cover-qq] 非法改写非封面字段 ${slug}.${k}`);
  }
}

async function main() {
  const original = JSON.parse(JSON.stringify(LOCAL_IMPORT_OFFICIAL_METADATA)) as Record<string, Row>;
  const next = JSON.parse(JSON.stringify(LOCAL_IMPORT_OFFICIAL_METADATA)) as Record<string, Row>;

  const needsAll = computeNeedsManual(original);
  const eligible: string[] = [];
  for (const { slug } of needsAll) {
    const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug];
    const row = original[slug];
    if (ov?.cover?.trim()) continue;
    if (ov?.suppressOfficialCover) continue;
    if (row.coverLocked === true) continue;
    eligible.push(slug);
  }
  const eligibleSet = new Set(eligible);

  const success: string[] = [];
  const failed: { slug: string; reason: string }[] = [];

  for (const slug of eligible) {
    const beforeRow = JSON.parse(JSON.stringify(next[slug])) as Row;
    const { titles, artists } = buildTitleArtist(slug);
    if (!titles.length) {
      failed.push({ slug, reason: '无标题候选' });
      continue;
    }

    try {
      const picked = await pickBestQqCover(titles, artists);
      if (!picked) {
        failed.push({ slug, reason: 'QQ 无可靠命中或图片校验失败' });
        continue;
      }

      const row = next[slug];
      row.cover = picked.url;
      row.coverSource = 'qqMusic';
      row.coverLocked = true;
      row.coverUncertain = false;
      row.officialStatus = 'confirmed';

      assertNonCoverUnchanged(beforeRow, row, slug);
      success.push(slug);
    } catch (e) {
      failed.push({ slug, reason: (e as Error)?.message || String(e) });
      Object.assign(next[slug], beforeRow);
    }
  }

  for (const slug of Object.keys(original)) {
    if (eligibleSet.has(slug)) continue;
    if (!isDeepStrictEqual(original[slug], next[slug])) {
      console.error(`[cover-qq] INVARIANT FAIL: 非 eligible slug 被改动 ${slug}`);
      process.exit(1);
    }
  }

  fs.writeFileSync(OUT_META, `export const LOCAL_IMPORT_OFFICIAL_METADATA = ${JSON.stringify(next, null, 2)} as const;\n`, 'utf8');

  const stillManual = needsAll
    .filter(({ slug }) => {
      const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug];
      if (ov?.cover?.trim()) return true;
      if (ov?.suppressOfficialCover) return true;
      if (original[slug].coverLocked === true) return true;
      const r = next[slug];
      const locked = r.coverLocked === true;
      const cs = (r.coverSource as string) || '';
      const src = (r.officialSource as string) || '';
      const appleOk = locked && (cs === 'apple' || cs === 'appleMusic' || src === 'appleMusic');
      const spotifyOk = locked && (cs === 'spotify' || src === 'spotify');
      const qqOk = locked && cs === 'qqMusic';
      return !appleOk && !spotifyOk && !qqOk;
    })
    .map(({ slug, why }) => ({ slug, why }));

  const lines = [
    `# QQ 音乐封面增量（待处理池）`,
    ``,
    `生成时间：${new Date().toISOString()}`,
    ``,
    `## 摘要`,
    ``,
    `- 本批 eligible（待处理池且未 manual/未 suppress/未锁定）:${eligible.length} 首`,
    `- **本次 QQ 成功补图并锁定:** ${success.length} 首`,
    `- **eligible 内未命中可靠 QQ 封面:** ${failed.length} 首`,
    `- **全库仍无 Apple/Spotify/QQ 可靠锁定封面（约等于仍需人工）:** ${stillManual.length} 首`,
    ``,
    `## 本次修改的文件`,
    ``,
    `- \`src/local-import-official-metadata.generated.ts\`（仅 eligible 成功项的 cover / coverSource / coverLocked / coverUncertain / officialStatus）`,
    `- \`tmp/cover-qq-music-pending-report.md\`（本报告）`,
    ``,
    `## 元数据污染检查`,
    ``,
    `- 脚本对每个成功项校验：除 ${[...COVER_PATCH_KEYS].join('、')} 外字段与改前一致`,
    `- **未修改** artist、normalizedArtistsInfo、mappedCategory、mappedTags、rawCategory、officialUrl、officialSource`,
    ``,
    `## QQ 补图成功（${success.length}）`,
    ``,
    ...success.map((s) => `- \`${s}\``),
    ``,
    `## 仍需人工 / 仍未可靠封面（全库快照 ${stillManual.length}）`,
    ``,
    ...stillManual.map(({ slug, why }) => `- \`${slug}\` — ${why}`),
    ``,
  ];

  fs.mkdirSync(path.dirname(OUT_REPORT), { recursive: true });
  fs.writeFileSync(OUT_REPORT, lines.join('\n'), 'utf8');

  console.log('[cover-qq] wrote', path.relative(ROOT, OUT_META));
  console.log('[cover-qq] report', path.relative(ROOT, OUT_REPORT));
  console.log(
    JSON.stringify(
      {
        eligibleCount: eligible.length,
        qqSuccess: success.length,
        qqFailedEligible: failed.length,
        stillManualOverall: stillManual.length,
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
