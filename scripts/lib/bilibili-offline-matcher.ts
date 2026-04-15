/**
 * B 站空间快照离线匹配：归一化、打分与 AUTO 判定（供 merge 与 diagnose 共用）。
 */
import type { LocalImportMetadataOverride } from '../../src/local-import-metadata-overrides';

export type ManifestTrack = {
  id: string;
  slug?: string;
  title?: string;
  displayTitle?: string;
  originalArtist?: string;
  youtubeVideoTitle?: string;
  titles?: { zhHans?: string; zhHant?: string; en?: string };
  artists?: { zhHans?: string; zhHant?: string; en?: string };
};

export type BiliVideo = { bvid: string; title: string; url?: string };

/** 与历史脚本一致，用于 legacy 打分对照 */
export function normLegacy(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[·・]/g, ' ')
    .trim();
}

const UNICODE_DASH = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;

/** 针对方括号 / 歌名片等 needle 的归一 */
export function normNeedle(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[·・．]/g, ' ')
    .replace(UNICODE_DASH, '-')
    .replace(/[""''`´]/g, '')
    .trim();
}

const SUFFIX_RE =
  /(?:完整版|钢琴完整版|附谱|钢琴版|钢琴\s*cover|cover|ost\b|pv\b|mv\b|剧情版|独奏版|抒情版|情感化|钢琴改编|钢琴独奏)/gi;

/** 去掉空白与常见标点，用于 Yes!Ok! vs yes ok、ByeByeBye vs bye bye bye 等宽松匹配 */
export function normCompact(s: string): string {
  return normNeedle(s)
    .replace(/[\s!?.·'"''`,，。、]/g, '')
    .replace(/\//g, '');
}

/**
 * B 站标题：去标签、书名号、括号块、常见后缀，再折叠空白（用于 haystack）。
 */
export function stripBiliTitleForMatch(raw: string): string {
  let x = normNeedle(raw);
  x = x.replace(/【[^】]{1,20}】/g, ' ');
  x = x.replace(/[《〈]([^》〉]{1,80})[》〉]/g, ' $1 ');
  x = x.replace(/[「『]([^」』]{1,80})[」』]/g, ' $1 ');
  x = x.replace(/\([^)]{0,48}\)/g, ' ');
  x = x.replace(/（[^）]{0,48}）/g, ' ');
  x = x.replace(/\[[^\]]{0,48}\]/g, ' ');
  x = x.replace(SUFFIX_RE, ' ');
  x = x.replace(/\s+/g, ' ').trim();
  return x;
}

export function titleVariants(
  t: ManifestTrack,
  override?: LocalImportMetadataOverride | null,
  opts?: {
    includeYoutube?: boolean;
    includeOverride?: boolean;
    /** manifest 内 titles.zhHans/zhHant/en */
    includeCatalogTitles?: boolean;
  },
): string[] {
  const includeYoutube = opts?.includeYoutube !== false;
  const includeOverride = opts?.includeOverride !== false;
  const includeCatalogTitles = opts?.includeCatalogTitles !== false;
  const s = new Set<string>();
  const add = (x?: string | null) => {
    if (x && x.trim()) s.add(x.trim());
  };
  add(t.displayTitle);
  add(t.title);
  add(t.slug);
  if (includeYoutube) {
    add(t.youtubeVideoTitle);
    const yt = t.youtubeVideoTitle?.trim();
    if (yt) {
      const cut = yt.split(/\s*\|\s*/)[0]?.trim();
      if (cut) add(cut);
      const cut2 = yt.replace(/\s*\|\s*Piano by CIP Music\s*$/i, '').trim();
      if (cut2) add(cut2);
    }
  }
  if (includeCatalogTitles) {
    add(t.titles?.zhHans);
    add(t.titles?.zhHant);
    add(t.titles?.en);
  }
  if (includeOverride && override) {
    add(override.title);
    add(override.displayTitle);
    add(override.titles?.zhHans);
    add(override.titles?.zhHant);
    add(override.titles?.en);
    add(override.matchedVideoTitle);
  }
  return [...s];
}

export function artistVariants(t: ManifestTrack): string[] {
  const s = new Set<string>();
  const add = (x?: string | null) => {
    if (x && x.trim()) s.add(x.trim());
  };
  add(t.originalArtist);
  add(t.artists?.zhHans);
  add(t.artists?.zhHant);
  add(t.artists?.en);
  return [...s];
}

export type ScoreBreakdown = {
  slug: number;
  title: number;
  artist: number;
  cip: number;
  base: number;
  total: number;
  titleStrong: boolean;
};

function hayPair(
  biliTitleRaw: string,
  useStripHay: boolean,
): { hayLegacy: string; hayStrip: string } {
  if (!biliTitleRaw || biliTitleRaw === '(title_fetch_failed)') {
    return { hayLegacy: '', hayStrip: '' };
  }
  const hayLegacy = normLegacy(biliTitleRaw);
  const hayStrip = useStripHay ? stripBiliTitleForMatch(biliTitleRaw) : hayLegacy;
  return { hayLegacy, hayStrip };
}

function slugScore(slug: string, hayLegacy: string, hayStrip: string): number {
  if (!slug.trim()) return 0;
  const a = normLegacy(slug);
  const b = normNeedle(slug);
  const inL = hayLegacy.includes(a);
  const inS = hayStrip.includes(b);
  if (!inL && !inS) return 0;
  return 130;
}

function titleScoreForHay(
  variants: string[],
  hayLegacy: string,
  hayStrip: string,
): number {
  const hayCompact = normCompact(hayStrip);
  let best = 0;
  for (const tv of variants) {
    const nl = normLegacy(tv);
    const ns = normNeedle(tv);
    if (nl.length < 2 && ns.length < 2) continue;
    let local = 0;
    if (nl.length >= 2 && hayLegacy.includes(nl)) {
      local = Math.max(local, 70 + Math.min(30, nl.length));
    }
    if (ns.length >= 2 && hayStrip.includes(ns)) {
      local = Math.max(local, 70 + Math.min(30, ns.length));
    }
    const nc = normCompact(tv);
    if (nc.length >= 4 && hayCompact.includes(nc)) {
      local = Math.max(local, 68 + Math.min(26, nc.length));
    }
    best = Math.max(best, local);
  }
  return best;
}

function artistScoreForHay(
  variants: string[],
  hayLegacy: string,
  hayStrip: string,
): number {
  const hayCompact = normCompact(hayStrip);
  let best = 0;
  for (const av of variants) {
    const nl = normLegacy(av);
    const ns = normNeedle(av);
    if (nl.length < 2 && ns.length < 2) continue;
    let local = 0;
    if (nl.length >= 2 && hayLegacy.includes(nl)) {
      local = Math.max(local, 45 + Math.min(20, nl.length));
    }
    if (ns.length >= 2 && hayStrip.includes(ns)) {
      local = Math.max(local, 45 + Math.min(20, ns.length));
    }
    const nc = normCompact(av);
    if (nc.length >= 3 && hayCompact.includes(nc)) {
      local = Math.max(local, 40 + Math.min(18, nc.length));
    }
    best = Math.max(best, local);
  }
  return best;
}

function cipScore(hayLegacy: string, hayStrip: string): number {
  if (hayLegacy.includes('cip music') || hayLegacy.includes('cip')) return 8;
  if (hayStrip.includes('cip music') || hayStrip.includes('cip')) return 8;
  return 0;
}

export type ComputeScoreOpts = {
  includeYoutube?: boolean;
  includeOverride?: boolean;
  includeCatalogTitles?: boolean;
  /** false 时 hayStrip 与 hayLegacy 相同（对照：仅靠旧归一化 haystack） */
  useStripHay?: boolean;
  /** 增量匹配：slug派生 / YouTube 书名号片段等，不计入 titleVariants 本体 */
  extraTitleStrings?: string[];
  extraArtistStrings?: string[];
};

export function computeScoreBreakdown(
  t: ManifestTrack,
  biliTitleRaw: string,
  override?: LocalImportMetadataOverride | null,
  variantOpts?: ComputeScoreOpts,
): ScoreBreakdown {
  const useStripHay = variantOpts?.useStripHay !== false;
  const { hayLegacy, hayStrip } = hayPair(biliTitleRaw, useStripHay);
  if (!hayLegacy && !hayStrip) {
    return {
      slug: 0,
      title: 0,
      artist: 0,
      cip: 0,
      base: 0,
      total: 0,
      titleStrong: false,
    };
  }
  const slug = slugScore((t.slug || '').trim(), hayLegacy, hayStrip);
  const tvars = [...titleVariants(t, override, variantOpts), ...(variantOpts?.extraTitleStrings || [])];
  const avars = [...artistVariants(t), ...(variantOpts?.extraArtistStrings || [])];
  const title = titleScoreForHay(tvars, hayLegacy, hayStrip);
  const artist = artistScoreForHay(avars, hayLegacy, hayStrip);
  const cip = cipScore(hayLegacy, hayStrip);
  const base = slug + title + cip;
  const total = base + artist;
  const titleStrong = slug >= 130 || title >= 85;
  return { slug, title, artist, cip, base, total, titleStrong };
}

/** 与旧 merge 脚本一致的总分（便于对照诊断） */
export function scoreTrackToBiliTitleLegacy(t: ManifestTrack, biliTitleRaw: string): number {
  if (!biliTitleRaw || biliTitleRaw === '(title_fetch_failed)') return 0;
  const hay = normLegacy(biliTitleRaw);
  let sc = 0;
  const slug = (t.slug || '').trim();
  if (slug && hay.includes(normLegacy(slug))) sc += 130;
  let bestTitle = 0;
  for (const tv of titleVariants(t, null, { includeYoutube: false, includeOverride: false })) {
    const nt = normLegacy(tv);
    if (nt.length < 2) continue;
    if (hay.includes(nt)) bestTitle = Math.max(bestTitle, 70 + Math.min(30, nt.length));
  }
  sc += bestTitle;
  let bestArt = 0;
  for (const av of artistVariants(t)) {
    const na = normLegacy(av);
    if (na.length < 2) continue;
    if (hay.includes(na)) bestArt = Math.max(bestArt, 45 + Math.min(20, na.length));
  }
  sc += bestArt;
  if (hay.includes('cip music') || hay.includes('cip')) sc += 8;
  return sc;
}

export type BestMatchEnhanced = {
  video: BiliVideo;
  breakdown: ScoreBreakdown;
  second: ScoreBreakdown | null;
};

export function bestMatchEnhanced(
  t: ManifestTrack,
  videos: BiliVideo[],
  override?: LocalImportMetadataOverride | null,
  variantOpts?: ComputeScoreOpts,
): BestMatchEnhanced | null {
  const rows: { video: BiliVideo; breakdown: ScoreBreakdown }[] = [];
  for (const v of videos) {
    rows.push({
      video: v,
      breakdown: computeScoreBreakdown(t, v.title, override, variantOpts),
    });
  }
  rows.sort((a, b) => b.breakdown.total - a.breakdown.total);
  const best = rows[0];
  if (!best || best.breakdown.total <= 0) return null;
  const second = rows.length >= 2 ? rows[1].breakdown : null;
  return { video: best.video, breakdown: best.breakdown, second };
}

export function computeAutoOk(
  best: ScoreBreakdown,
  second: ScoreBreakdown | null,
  autoMin: number,
  autoGap: number,
): boolean {
  const sTotal = second?.total ?? 0;
  const sBase = second?.base ?? 0;
  const gapFull = best.total - sTotal;
  const gapBase = best.base - sBase;

  if (best.titleStrong && best.slug >= 130) {
    return best.base >= autoMin && gapBase >= autoGap;
  }
  if (best.titleStrong && best.slug < 130 && best.title >= 90) {
    return best.total >= 195 && gapFull >= autoGap;
  }
  return best.total >= autoMin && gapFull >= autoGap;
}

export function computeAutoOkLegacyRule(
  best: ScoreBreakdown,
  second: ScoreBreakdown | null,
  autoMin: number,
  autoGap: number,
): boolean {
  const sTotal = second?.total ?? 0;
  const gapFull = best.total - sTotal;
  return best.total >= autoMin && gapFull >= autoGap;
}

/** 仅用于小批量离线增量：在标准 AUTO 规则上略放宽，仍要求与第二名拉开分差 */
export function computeAutoOkGapBatch(
  best: ScoreBreakdown,
  second: ScoreBreakdown | null,
): boolean {
  if (computeAutoOk(best, second, 195, 12)) return true;
  const sTotal = second?.total ?? 0;
  const gapFull = best.total - sTotal;
  if (gapFull < 4) return false;
  /** 标题很强、总分中等：降低对 artist 命中分的依赖 */
  if (best.title >= 90 && best.total >= 95 && gapFull >= 12) return true;
  if (best.title >= 75 && best.total >= 100 && gapFull >= 6) return true;
  if (best.total >= 118 && gapFull >= 6) return true;
  if (best.total >= 125 && gapFull >= 18) return true;
  if (best.title >= 70 && best.total >= 72 && gapFull >= 14) return true;
  if (best.title >= 88 && best.base >= 85 && gapFull >= 8) return true;
  if (best.slug >= 130 && best.total >= 100 && gapFull >= 6) return true;
  if (best.total >= 130 && gapFull >= 4) return true;
  /** 快照子集过滤后：允许略紧的 Top2 分差 */
  if (best.total >= 112 && gapFull >= 1 && best.title >= 73) return true;
  if (best.total >= 99 && gapFull >= 1 && best.title >= 85) return true;
  /** 子集仅 2 个强候选时：总分与标题已较高，允许 gap=1 */
  if (best.total >= 100 && gapFull >= 1 && best.title >= 72) return true;
  return false;
}

/** slug 派生：连字符、括号、常见拼写；供增量匹配 extraTitleStrings */
export function slugDerivedExtraTitles(slug: string): string[] {
  const s = slug.trim();
  if (!s) return [];
  const out = new Set<string>();
  const add = (x: string) => {
    const t = x.trim();
    if (t.length >= 2) out.add(t);
  };
  add(s.replace(/[()（）]/g, ' ').replace(/\s+/g, ' ').trim());
  const noParen = s.replace(/\([^)]*\)/g, '').replace(/（[^）]*）/g, '').trim();
  add(noParen);
  const inParen =
    s.match(/\(([^)]+)\)/)?.[1]?.trim() || s.match(/（([^）]+)）/)?.[1]?.trim() || '';
  if (inParen.length >= 2) add(inParen);
  const spaced = s
    .replace(/[·・．]/g, ' ')
    .replace(/[_/]+/g, ' ')
    .replace(/-+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  add(spaced);
  add(
    spaced
      .replace(/\bruning\b/gi, 'running')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  if (/zerobaseone|zb1/i.test(s)) {
    add('zb1');
    add('zerobaseone');
  }
  return [...out];
}

/** 从 YouTube 视频标题抽取《中文》片段与较长拉丁片段，增强与 B 站中文标题的桥接 */
export function hintsFromYoutubeVideoTitle(yt?: string | null): { titles: string[]; artists: string[] } {
  const titles: string[] = [];
  const artists: string[] = [];
  if (!yt?.trim()) return { titles, artists };
  const h = yt.trim();
  for (const m of h.matchAll(/《([^》]{2,48})》/g)) {
    titles.push(m[1].trim());
  }
  for (const m of h.matchAll(/「([^」]{2,48})」/g)) {
    titles.push(m[1].trim());
  }
  const latin = h.match(/[a-z0-9][a-z0-9\s!'./-]{3,80}/gi) ?? [];
  for (const frag of latin) {
    const t = frag.trim();
    if (t.length >= 4 && /[a-z]/i.test(t)) titles.push(t);
  }
  return { titles, artists };
}
