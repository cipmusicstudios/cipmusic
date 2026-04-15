/**
 * 仅针对 audit-zh-bilibili-override-gap.tsv 中的 slug，使用空间快照离线增强匹配，
 * 将新命中的条目 **追加** 到 data/video-overrides.json（不修改已有 entry 的 videoUrlZhHans）。
 *
 * 运行：npx tsx scripts/bilibili-gap29-incremental-match.ts
 *
 * 环境变量：
 *   GAP_TSV=data/audit-zh-bilibili-override-gap.tsv（默认）
 *   BILIBILI_OFFLINE_SNAPSHOT=data/bilibili-up-1467634-snapshot.json（默认）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SongManifestEntry, SongsManifestCatalog } from '../src/songs-manifest.ts';
import {
  LOCAL_IMPORT_METADATA_OVERRIDES,
  type LocalImportMetadataOverride,
} from '../src/local-import-metadata-overrides.ts';
import {
  bestMatchEnhanced,
  computeAutoOkGapBatch,
  hintsFromYoutubeVideoTitle,
  normLegacy,
  slugDerivedExtraTitles,
  type BiliVideo,
  type ManifestTrack,
} from './lib/bilibili-offline-matcher.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

type VideoOverrideEntry = {
  title: string;
  artist: string;
  aliases?: string[];
  slugKeys: string[];
  videoUrlZhHans: string;
  videoPlatformZhHans: 'bilibili';
  videoUrlDefault?: string | null;
  notes?: string;
};

type OverridesFile = {
  version: number;
  schema: string;
  readme?: string;
  entries: VideoOverrideEntry[];
  pendingReview?: unknown[];
};

function normSlugKey(s: string): string {
  return s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function loadGapSlugs(tsvPath: string): string[] {
  const raw = fs.readFileSync(tsvPath, 'utf8');
  const lines = raw.split(/\n/).slice(1).filter(Boolean);
  const slugs: string[] = [];
  for (const line of lines) {
    const cell = line.split('\t')[0]?.trim() ?? '';
    if (cell.startsWith('"') && cell.endsWith('"')) slugs.push(cell.slice(1, -1));
    else if (cell) slugs.push(cell);
  }
  return slugs;
}

function loadManifestBySlug(): Map<string, SongManifestEntry> {
  const catPath = path.join(projectRoot, 'public', 'songs-manifest.json');
  const cat = JSON.parse(fs.readFileSync(catPath, 'utf8')) as SongsManifestCatalog;
  const map = new Map<string, SongManifestEntry>();
  for (const c of cat.chunks) {
    const p = path.join(projectRoot, 'public', c.path.replace(/^\//, ''));
    const chunk = JSON.parse(fs.readFileSync(p, 'utf8')) as { tracks: SongManifestEntry[] };
    for (const t of chunk.tracks) {
      if (t.slug) map.set(t.slug, t);
    }
  }
  return map;
}

function loadSnapshot(p: string): BiliVideo[] {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { videos?: BiliVideo[] };
  return raw.videos?.length ? raw.videos : [];
}

function existingSlugKeySet(entries: VideoOverrideEntry[]): Set<string> {
  const s = new Set<string>();
  for (const e of entries) {
    for (const k of e.slugKeys || []) s.add(normSlugKey(k));
  }
  return s;
}

function toManifestTrack(e: SongManifestEntry): ManifestTrack {
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    displayTitle: e.displayTitle,
    originalArtist: e.originalArtist,
    youtubeVideoTitle: e.youtubeVideoTitle ?? undefined,
    titles: e.titles,
    artists: e.artists,
  };
}

function splitArtists(raw: string): string[] {
  return raw
    .split(/[、,，/&+]|和|feat\.|ft\./i)
    .map(x => x.replace(/[《》「」]/g, '').trim())
    .filter(Boolean);
}

/** 少量「曲名写法 ↔ B 站常用中文」桥接（非 BV，仅增强 haystack 命中） */
function catalogTitleHints(slug: string, displayTitle: string): string[] {
  const s = slug.trim();
  const d = displayTitle.trim();
  const out: string[] = [];
  if (s === 'APT' || /^apt\.?$/i.test(d)) {
    out.push('阿帕特', 'APT');
  }
  if (/star\s*walkin/i.test(s) || /star\s*walkin/i.test(d)) {
    out.push('逐星');
  }
  if (/^fml$/i.test(s) || /^fml$/i.test(d)) {
    out.push('Fxck My Life', 'fxck my life', 'f*ck my life', 'fml');
  }
  if (s === '时空引力') {
    out.push('抽卡', '抽卡BGM', 'Gravity of Spacetime', 'Love and Deepspace');
  }
  if (/bridge/i.test(s) && /troubled/i.test(s)) {
    out.push('Bridge Over Troubled Water');
  }
  if (s === 'pop star' || /pop\s*\/?\s*star/i.test(d)) {
    out.push('POP/STARS', 'K/DA', 'pop stars');
  }
  if (s === 'yes ok' || /^yes\s*!?\s*ok/i.test(d)) {
    out.push('Yes!Ok!', '青春有你2');
  }
  if (s === '5点23' || d.includes('5点23')) {
    out.push('5:23PM', '5:23');
  }
  if (s === 'wadada' || /^wadada$/i.test(d)) {
    out.push('WA DA DA', 'WADADA');
  }
  if (s.includes('恋与深空') && s.includes('时空')) {
    out.push('恋与深空', '时空');
  }
  return out;
}

function bridgeArtistHints(a: string): string[] {
  const out = new Set<string>();
  const add = (x: string) => {
    if (x.trim().length >= 2) out.add(x.trim());
  };
  add(a);
  for (const part of splitArtists(a)) add(part);
  if (/shakira/i.test(a)) add('夏奇拉');
  if (/lil\s*nas/i.test(a)) add('李娜叉');
  if (/linkin/i.test(a)) add('林肯公园');
  if (/rosé|rose/i.test(a) && /bruno|mars/i.test(a)) {
    add('ROSÉ');
    add('Bruno Mars');
  }
  if (/i-?dle|idle/i.test(a)) {
    add('(G)I-DLE');
    add('GIDLE');
  }
  if (/zerobaseone|zb1/i.test(a)) {
    add('ZB1');
    add('ZEROBASEONE');
  }
  if (/into1/i.test(a)) add('INTO1');
  if (/the9/i.test(a)) add('THE9');
  if (/radwimps/i.test(a)) add('RADWIMPS');
  if (/kep1er/i.test(a)) add('Kep1er');
  if (/seventeen/i.test(a)) add('SEVENTEEN');
  return [...out];
}

function buildMatchOpts(
  t: ManifestTrack,
  override: LocalImportMetadataOverride | undefined,
): {
  extraTitleStrings: string[];
  extraArtistStrings: string[];
} {
  const extraTitleStrings: string[] = [];
  const extraArtistStrings: string[] = [];

  for (const x of slugDerivedExtraTitles(t.slug || '')) extraTitleStrings.push(x);
  const ytHints = hintsFromYoutubeVideoTitle(t.youtubeVideoTitle);
  extraTitleStrings.push(...ytHints.titles);
  for (const x of catalogTitleHints(t.slug || '', t.displayTitle || t.title || '')) {
    extraTitleStrings.push(x);
  }

  for (const x of bridgeArtistHints(t.originalArtist || '')) extraArtistStrings.push(x);
  for (const x of bridgeArtistHints(t.artists?.zhHans || '')) extraArtistStrings.push(x);
  for (const x of bridgeArtistHints(t.artists?.en || '')) extraArtistStrings.push(x);

  if (override?.artist) {
    for (const x of bridgeArtistHints(override.artist)) extraArtistStrings.push(x);
  }
  if (override?.artists) {
    for (const v of Object.values(override.artists)) {
      if (v) for (const x of bridgeArtistHints(v)) extraArtistStrings.push(x);
    }
  }

  return {
    extraTitleStrings: [...new Set(extraTitleStrings.map(s => s.trim()).filter(Boolean))],
    extraArtistStrings: [...new Set(extraArtistStrings.map(s => s.trim()).filter(Boolean))],
  };
}

type Scored = { track: ManifestTrack; video: BiliVideo; total: number; breakdown: string };

/** 在29 条范围内消解 ZB1/SEVENTEEN 等同系歌曲在快照里的互抢 */
function filterSnapshotVideos(t: ManifestTrack, all: BiliVideo[]): BiliVideo[] {
  const slug = (t.slug || '').trim();
  if (slug === 'Blue(zerobaseone)') {
    return all.filter(v => /\bblue\b/i.test(v.title) && /zb1|zerobaseone/i.test(v.title));
  }
  if (slug === 'runing-to-future') {
    return all.filter(v => {
      const h = normLegacy(v.title);
      return (h.includes('running') && h.includes('future')) || h.includes('running to future');
    });
  }
  if (slug === 'doctor doctor') {
    return all.filter(v => /doctor/i.test(v.title));
  }
  if (slug === 'love money fame') {
    return all.filter(v => /love/i.test(v.title) && /money/i.test(v.title) && /fame/i.test(v.title));
  }
  if (slug === '黑神话悟空主题曲') {
    return all.filter(v => /黑神话/.test(v.title) && /主题曲/.test(v.title) && !/合集/.test(v.title));
  }
  if (slug === 'yes ok') {
    return all.filter(v => /yes!ok|yes.ok/i.test(v.title) && !/promise/i.test(v.title));
  }
  if (slug === 'mitsuha-theme') {
    return all.filter(v => {
      if (/王源|世界瞒着我最大的事情|八音盒/i.test(v.title)) return false;
      return /三叶|三葉|你的名字/i.test(v.title);
    });
  }
  if (slug === '时空引力') {
    const pool = all.filter(v => /恋与深空/.test(v.title) && /抽卡|氪起来/i.test(v.title));
    return pool.length ? pool : all;
  }
  if (slug === '繁花片头曲') {
    return all.filter(v => /繁花/.test(v.title) && /片头/.test(v.title));
  }
  if (slug === '恋与深空主题曲') {
    return all.filter(v => /恋与深空/.test(v.title) && (/莎拉|布莱曼|sarah/i.test(v.title) || /主题曲/.test(v.title)));
  }
  if (slug === 'STAR WALKIN\'') {
    return all.filter(v => /逐星|star\s*walk|walkin/i.test(v.title));
  }
  if (slug === 'wadada') {
    return all.filter(v => /wa\s*da|wadada/i.test(v.title));
  }
  if (slug === '明早老地方出发') {
    return all.filter(v => /明早老地方/i.test(v.title));
  }
  if (slug === '余生请多指教') {
    return all.filter(
      v =>
        /余生/.test(v.title) &&
        /请多指教/.test(v.title) &&
        !/片尾曲/.test(v.title) &&
        (/杨紫|肖战|同名电视剧主题曲/i.test(v.title) || /主题曲/i.test(v.title)),
    );
  }
  if (slug === 'pop star') {
    return all.filter(v => /pop\/?\s*stars|k\/da|kda/i.test(v.title));
  }
  if (slug === '古蜀回想') {
    return all.filter(v => /古蜀/i.test(v.title));
  }
  if (slug === 'FML') {
    return all.filter(
      v => /seventeen/i.test(v.title) && /fml|fxck|f\*ck|fuck\s*my\s*life/i.test(v.title),
    );
  }
  return all;
}

function isRealYoutubeWatch(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  if (url.includes('/search?') || url.includes('@')) return false;
  return (
    /[?&]v=[\w-]{11}/.test(url) ||
    /youtu\.be\/[\w-]{11}/.test(url) ||
    /youtube\.com\/shorts\/[\w-]+/i.test(url)
  );
}

type ReasonLayer = '标题变体问题' | 'artist 写法问题' | 'alias / 改名问题' | '其他原因';

function classifyMiss(
  t: ManifestTrack,
  best: { total: number; title: number; artist: number; slug: number } | null,
  secondTotal: number,
): { layer: ReasonLayer; detail: string } {
  if (!best || best.total <= 0) {
    return { layer: '其他原因', detail: '快照中最高分为0（可能无对应投稿或标题完全不同）' };
  }
  const gap = best.total - secondTotal;
  if (gap < 4) {
    return { layer: '其他原因', detail: `Top2 分差过小（${gap}）；或多曲争同一 BV` };
  }
  if (best.title < 70 && best.slug < 130) {
    return { layer: '标题变体问题', detail: `title=${best.title} slug=${best.slug} total=${best.total}` };
  }
  if (best.title >= 70 && best.artist < 25) {
    return { layer: 'artist 写法问题', detail: `title=${best.title} artist=${best.artist} total=${best.total}` };
  }
  if (best.slug < 130 && best.title >= 75) {
    return { layer: 'alias / 改名问题', detail: `title=${best.title} slug=${best.slug} total=${best.total}` };
  }
  return { layer: '其他原因', detail: `未过 gap-batch 规则 total=${best.total} gap=${gap}` };
}

function main() {
  const tsvPath = path.resolve(projectRoot, process.env.GAP_TSV?.trim() || 'data/audit-zh-bilibili-override-gap.tsv');
  const snapPath = path.resolve(
    projectRoot,
    process.env.BILIBILI_OFFLINE_SNAPSHOT?.trim() || 'data/bilibili-up-1467634-snapshot.json',
  );
  const overridesPath = path.join(projectRoot, 'data', 'video-overrides.json');
  const reportPath = path.join(projectRoot, 'data', 'bilibili-gap29-report.json');

  const gapSlugs = loadGapSlugs(tsvPath);
  const bySlug = loadManifestBySlug();
  const videos = loadSnapshot(snapPath);
  const existingDoc = JSON.parse(fs.readFileSync(overridesPath, 'utf8')) as OverridesFile;
  const takenSlugs = existingSlugKeySet(existingDoc.entries);

  const candidates: Scored[] = [];
  const skippedAlready: string[] = [];
  const skippedNoManifest: string[] = [];

  for (const slug of gapSlugs) {
    if (takenSlugs.has(normSlugKey(slug))) {
      skippedAlready.push(slug);
      continue;
    }
    const entry = bySlug.get(slug);
    if (!entry) {
      skippedNoManifest.push(slug);
      continue;
    }
    if (entry.bilibiliVideoUrl) {
      skippedAlready.push(`${slug}(manifest已有B站)`);
      continue;
    }
    const t = toManifestTrack(entry);
    const override = LOCAL_IMPORT_METADATA_OVERRIDES[slug] ?? LOCAL_IMPORT_METADATA_OVERRIDES[slug.replace(/'/g, '')];
    const { extraTitleStrings, extraArtistStrings } = buildMatchOpts(t, override);
    const pool = filterSnapshotVideos(t, videos);
    if (!pool.length) continue;

    const bm = bestMatchEnhanced(t, pool, override ?? null, {
      includeYoutube: true,
      includeOverride: true,
      includeCatalogTitles: true,
      useStripHay: true,
      extraTitleStrings,
      extraArtistStrings,
    });
    if (!bm) continue;
    const ok = computeAutoOkGapBatch(bm.breakdown, bm.second);
    if (!ok) continue;
    candidates.push({
      track: t,
      video: bm.video,
      total: bm.breakdown.total,
      breakdown: JSON.stringify(bm.breakdown),
    });
  }

  const newEntries: VideoOverrideEntry[] = [];
  const matchedSlugs = new Set<string>();

  for (const w of candidates) {
    const slug = (w.track.slug || '').trim();
    if (!slug) continue;
    const songEntry = bySlug.get(slug)!;
    const yt = isRealYoutubeWatch(songEntry.youtubeVideoUrl) ? songEntry.youtubeVideoUrl!.trim() : null;
    const displayTitle = (songEntry.displayTitle || songEntry.title || slug).trim();
    const artist =
      songEntry.artists?.zhHans ||
      songEntry.artists?.zhHant ||
      songEntry.originalArtist ||
      songEntry.artists?.en ||
      '（未知）';

    const url = `https://www.bilibili.com/video/${w.video.bvid}/`;
    newEntries.push({
      title: displayTitle,
      artist: artist.trim(),
      aliases: [],
      slugKeys: [slug],
      videoUrlZhHans: url,
      videoPlatformZhHans: 'bilibili',
      videoUrlDefault: yt,
      notes: `auto:gap29-enhanced total=${w.total}；B站:「${w.video.title.slice(0, 120)}」`,
    });
    matchedSlugs.add(slug);
  }

  const skippedSet = new Set(skippedAlready.map(s => s.replace(/\(manifest.*$/, '')));
  const unmatched = gapSlugs.filter(s => !matchedSlugs.has(s) && !skippedSet.has(s));

  const missRows: { slug: string; reasonLayer: ReasonLayer; detail: string }[] = [];
  for (const slug of unmatched) {
    if (skippedNoManifest.includes(slug)) {
      missRows.push({ slug, reasonLayer: '其他原因', detail: 'manifest 中找不到 slug' });
      continue;
    }
    const entry = bySlug.get(slug);
    if (!entry) continue;
    const t = toManifestTrack(entry);
    const override =
      LOCAL_IMPORT_METADATA_OVERRIDES[slug] ??
      LOCAL_IMPORT_METADATA_OVERRIDES[slug.replace(/'/g, '')];
    const { extraTitleStrings, extraArtistStrings } = buildMatchOpts(t, override);
    const pool = filterSnapshotVideos(t, videos);
    if (!pool.length) continue;
    const bm = bestMatchEnhanced(t, pool, override ?? null, {
      includeYoutube: true,
      includeOverride: true,
      includeCatalogTitles: true,
      useStripHay: true,
      extraTitleStrings,
      extraArtistStrings,
    });
    const secondT = bm?.second?.total ?? 0;
    const { layer, detail } = classifyMiss(
      t,
      bm
        ? {
            total: bm.breakdown.total,
            title: bm.breakdown.title,
            artist: bm.breakdown.artist,
            slug: bm.breakdown.slug,
          }
        : null,
      secondT,
    );
    missRows.push({
      slug,
      reasonLayer: layer,
      detail: `${detail} second=${secondT} bvid=${bm?.video.bvid ?? ''} bTitle=${(bm?.video.title ?? '').slice(0, 80)}`,
    });
  }

  if (newEntries.length) {
    const nextDoc: OverridesFile = {
      ...existingDoc,
      entries: [...existingDoc.entries, ...newEntries],
    };
    fs.writeFileSync(overridesPath, JSON.stringify(nextDoc, null, 2) + '\n', 'utf8');
  }

  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        snapshot: path.relative(projectRoot, snapPath),
        snapshotVideoCount: videos.length,
        gapSlugCount: gapSlugs.length,
        matchedCount: matchedSlugs.size,
        remainingCount: missRows.length,
        skippedAlready,
        skippedNoManifest,
        bvConflicts: [] as string[],
        matchedSlugs: [...matchedSlugs],
        unmatchedSlugs: unmatched.filter(s => bySlug.has(s)),
        missRows,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(
    `[bilibili-gap29] matched=${matchedSlugs.size} remaining=${unmatched.filter(s => bySlug.has(s)).length} newEntries=${newEntries.length}`,
  );
  console.log(`Wrote ${path.relative(projectRoot, reportPath)}`);
}

main();
