/**
 * 对「未写入 video-overrides」的 manifest 曲目逐条调用 B站搜索首页，
 * 统计未命中原因分层（412、无结果、无 UP 主命中、分数不足、分差过小等）。
 *
 * 不修改 video-overrides.json；输出 data/bilibili-miss-diagnosis-report.json *
 *   npx tsx scripts/diagnose-bilibili-miss-reasons.ts
 *   BILIBILI_DIAG_SLEEP_MS=2200 BILIBILI_DIAG_MIN_SCORE=135 npx tsx scripts/diagnose-bilibili-miss-reasons.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const MID = Number(process.env.BILIBILI_MID || '1467634');
const SLEEP_MS = Number(process.env.BILIBILI_DIAG_SLEEP_MS || '2000');
const MIN_SCORE = Number(process.env.BILIBILI_DIAG_MIN_SCORE || '135');
const SCORE_GAP = Number(process.env.BILIBILI_DIAG_SCORE_GAP || '12');
const OUT = path.join(projectRoot, 'data', 'bilibili-miss-diagnosis-report.json');
const SAMPLE_N = Math.min(80, Number(process.env.BILIBILI_DIAG_SAMPLE || '30'));
/** 仅诊断前 N 首未命中（0=全部）。风控严时先用 40～80 看分布。 */
const DIAG_MAX = Number(process.env.BILIBILI_DIAG_MAX || '0');
const DIAG_OFFLINE = process.env.BILIBILI_DIAG_OFFLINE === '1';

type ManifestTrack = {
  id: string;
  slug?: string;
  title?: string;
  displayTitle?: string;
  originalArtist?: string;
  youtubeVideoUrl?: string | null;
  artists?: { zhHans?: string; zhHant?: string; en?: string };
};

type OverrideEntry = { slugKeys?: string[] };

type Reason =
  | 'api_non_json'
  | 'api_banned_412'
  | 'api_error_other'
  | 'search_empty_rows'
  | 'no_up_in_page1'
  | 'score_below_threshold'
  | 'ambiguous_top2_gap'
  | 'missing_title_skip'
  | 'sync_drifts_above_threshold';

function sleepSync(ms: number) {
  if (ms <= 0) return;
  try {
    execFileSync('sleep', [String(Math.ceil(ms / 1000))], { stdio: 'ignore' });
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* spin */
    }
  }
}

function curlSearch(keyword: string): { ok: true; json: any } | { ok: false; kind: string; detail: string } {
  const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(
    keyword,
  )}&page=1`;
  try {
    const out = execFileSync(
      'curl',
      [
        '-sS',
        '--max-time',
        '35',
        url,
        '-H',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        '-H',
        'Referer: https://www.bilibili.com/',
        '-H',
        'Accept: application/json, text/plain, */*',
      ],
      { encoding: 'utf8', maxBuffer: 20_000_000 },
    );
    const t = out.trim();
    if (!t.startsWith('{')) {
      return { ok: false, kind: 'api_non_json', detail: t.slice(0, 120) };
    }
    return { ok: true, json: JSON.parse(t) };
  } catch (e) {
    return { ok: false, kind: 'api_non_json', detail: (e as Error).message };
  }
}

function norm(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[·・]/g, ' ')
    .trim();
}

function stripTitle(html: string): string {
  return String(html || '').replace(/<[^>]+>/g, '');
}

function titleVariants(t: ManifestTrack): string[] {
  const s = new Set<string>();
  const add = (x?: string | null) => {
    if (x && x.trim()) s.add(x.trim());
  };
  add(t.displayTitle);
  add(t.title);
  add(t.slug);
  return [...s];
}

function isRealYoutubeWatch(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  if (url.includes('/search?') || url.includes('@')) return false;
  return /[?&]v=[\w-]{11}/.test(url) || /youtu\.be\/[\w-]{11}/.test(url);
}

function artistVariants(t: ManifestTrack): string[] {
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

function scoreTrackToBiliTitle(t: ManifestTrack, biliTitleRaw: string): number {
  const hay = norm(stripTitle(biliTitleRaw));
  let sc = 0;
  const slug = (t.slug || '').trim();
  if (slug && hay.includes(norm(slug))) sc += 130;

  let bestTitle = 0;
  for (const tv of titleVariants(t)) {
    const nt = norm(tv);
    if (nt.length < 2) continue;
    if (hay.includes(nt)) bestTitle = Math.max(bestTitle, 70 + Math.min(30, nt.length));
  }
  sc += bestTitle;

  let bestArt = 0;
  for (const av of artistVariants(t)) {
    const na = norm(av);
    if (na.length < 2) continue;
    if (hay.includes(na)) bestArt = Math.max(bestArt, 45 + Math.min(20, na.length));
  }
  sc += bestArt;

  if (hay.includes('cip music') || hay.includes('cip')) sc += 8;
  return sc;
}

function loadManifestTracks(): ManifestTrack[] {
  const dir = path.join(projectRoot, 'public');
  const files = fs
    .readdirSync(dir)
    .filter(f => /^songs-manifest-chunk-\d+\.json$/.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const out: ManifestTrack[] = [];
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { tracks?: ManifestTrack[] };
    if (j.tracks?.length) out.push(...j.tracks);
  }
  return out;
}

function overrideSlugNormSet(): Set<string> {
  const p = path.join(projectRoot, 'data', 'video-overrides.json');
  const doc = JSON.parse(fs.readFileSync(p, 'utf8')) as { entries: OverrideEntry[] };
  const s = new Set<string>();
  for (const e of doc.entries || []) {
    for (const k of e.slugKeys || []) {
      s.add(norm(k));
    }
  }
  return s;
}

function classifyApiCode(code: number, message: string): Reason {
  if (code === -412) return 'api_banned_412';
  return 'api_error_other';
}

type RowDetail = {
  slug: string;
  id: string;
  reason: Reason;
  query: string;
  apiCode?: number;
  apiMessage?: string;
  pageRows?: number;
  upRowsOnPage1?: number;
  bestScore?: number;
  secondScore?: number;
  bestBvid?: string;
  bestTitleSnippet?: string;
  /** 标题里命中歌名但未命中任何艺人字段 */
  titleHitArtistMiss?: boolean;
};

function diagnoseTrack(t: ManifestTrack): RowDetail {
  const slug = (t.slug || '').trim();
  const tit = (t.displayTitle || t.title || '').trim();
  if (!slug) {
    return { slug: '', id: t.id, reason: 'missing_title_skip', query: '' };
  }
  if (!tit) {
    return { slug, id: t.id, reason: 'missing_title_skip', query: '' };
  }

  const art = t.artists?.zhHans || t.originalArtist || t.artists?.zhHant || t.artists?.en || '';
  const q = `${art} ${tit} CIP Music 钢琴`.replace(/\s+/g, ' ').trim();

  const res = curlSearch(q);
  if (!res.ok) {
    const r: RowDetail = { slug, id: t.id, reason: res.kind as Reason, query: q, apiMessage: res.detail };
    return r;
  }

  const j = res.json;
  if (j.code !== 0) {
    return {
      slug,
      id: t.id,
      reason: classifyApiCode(j.code, j.message),
      query: q,
      apiCode: j.code,
      apiMessage: String(j.message || ''),
    };
  }

  const rows = j.data?.result || [];
  if (!rows.length) {
    return { slug, id: t.id, reason: 'search_empty_rows', query: q, pageRows: 0 };
  }

  const cip = rows.filter((x: any) => x.mid === MID);
  if (!cip.length) {
    return { slug, id: t.id, reason: 'no_up_in_page1', query: q, pageRows: rows.length, upRowsOnPage1: 0 };
  }

  let best: { bvid: string; title: string; score: number } | null = null;
  let second = 0;
  for (const x of cip) {
    const title = stripTitle(x.title || '');
    const sc = scoreTrackToBiliTitle(t, title);
    if (!best || sc > best.score) {
      second = best?.score ?? 0;
      best = { bvid: x.bvid, title, score: sc };
    } else if (sc > second) second = sc;
  }

  const hay = norm(best!.title);
  let titleHit = false;
  for (const tv of titleVariants(t)) {
    const nt = norm(tv);
    if (nt.length >= 2 && hay.includes(nt)) {
      titleHit = true;
      break;
    }
  }
  let artHit = false;
  for (const av of artistVariants(t)) {
    const na = norm(av);
    if (na.length >= 2 && hay.includes(na)) {
      artHit = true;
      break;
    }
  }
  const titleHitArtistMiss = titleHit && !artHit;

  if (best!.score < MIN_SCORE) {
    return {
      slug,
      id: t.id,
      reason: 'score_below_threshold',
      query: q,
      pageRows: rows.length,
      upRowsOnPage1: cip.length,
      bestScore: best!.score,
      secondScore: second,
      bestBvid: best!.bvid,
      bestTitleSnippet: best!.title.slice(0, 160),
      titleHitArtistMiss,
    };
  }
  if (best!.score - second < SCORE_GAP && second >= MIN_SCORE - 15) {
    return {
      slug,
      id: t.id,
      reason: 'ambiguous_top2_gap',
      query: q,
      pageRows: rows.length,
      upRowsOnPage1: cip.length,
      bestScore: best!.score,
      secondScore: second,
      bestBvid: best!.bvid,
      bestTitleSnippet: best!.title.slice(0, 160),
      titleHitArtistMiss,
    };
  }

  /* 分数与分差均达标，但未在 overrides：多为同步后阈值/逻辑与当时 run 不一致 */
  return {
    slug,
    id: t.id,
    reason: 'sync_drifts_above_threshold',
    query: q,
    pageRows: rows.length,
    upRowsOnPage1: cip.length,
    bestScore: best!.score,
    secondScore: second,
    bestBvid: best!.bvid,
    bestTitleSnippet: best!.title.slice(0, 160),
    titleHitArtistMiss,
  };
}

function loadYoutubeIdSet(): Set<string> {
  const p = path.join(projectRoot, 'public', 'youtube-channel-order-cache.json');
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as { videos?: { id?: string }[] };
    const s = new Set<string>();
    for (const v of j.videos || []) {
      if (v.id && v.id.length >= 6) s.add(v.id);
    }
    return s;
  } catch {
    return new Set();
  }
}

function extractYoutubeId(url: string): string | null {
  const m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  return m?.[1] || null;
}

function main() {
  const covered = overrideSlugNormSet();
  const tracks = loadManifestTracks();
  const missed = tracks.filter(t => {
    const s = (t.slug || '').trim();
    return s && !covered.has(norm(s));
  });

  const ytIds = loadYoutubeIdSet();
  let missedWithYtWatch = 0;
  let missedYtIdInChannelCache = 0;
  for (const t of missed) {
    const u = t.youtubeVideoUrl || '';
    if (isRealYoutubeWatch(u)) {
      missedWithYtWatch++;
      const id = extractYoutubeId(u);
      if (id && ytIds.has(id)) missedYtIdInChannelCache++;
    }
  }

  const counts: Record<string, number> = {};
  const rows: RowDetail[] = [];

  const toScan =
    DIAG_OFFLINE ? [] : DIAG_MAX > 0 ? missed.slice(0, DIAG_MAX) : missed;
  let i = 0;
  for (const t of toScan) {
    i++;
    const row = diagnoseTrack(t);
    rows.push(row);
    counts[row.reason] = (counts[row.reason] || 0) + 1;
    if (i % 50 === 0) {
      console.error(`[diagnose] ${i}/${toScan.length} last=${row.slug} ${row.reason}`);
    }
    sleepSync(SLEEP_MS);
  }

  /* 确定性抽样：在「已扫描」的 missed 子集上按 slug 步进取样 */
  const scannedSlugs = new Set(rows.map(r => r.slug));
  const sorted = [...missed]
    .filter(t => scannedSlugs.has((t.slug || '').trim()))
    .sort((a, b) => (a.slug || '').localeCompare(b.slug || '', 'zh-Hans-CN'));
  const sample: RowDetail[] = [];
  const step = Math.max(1, Math.floor(sorted.length / Math.max(1, SAMPLE_N)));
  for (let k = 0; k < sorted.length && sample.length < SAMPLE_N; k += step) {
    const t = sorted[k];
    const hit = rows.find(r => r.slug === t.slug);
    if (hit) sample.push(hit);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mid: MID,
    manifestTracks: tracks.length,
    overrideCoveredSlugs: covered.size,
    missedCount: missed.length,
    offlinePrior: {
      missedWithYoutubeWatchUrl: missedWithYtWatch,
      missedYoutubeIdInChannelCache: missedYtIdInChannelCache,
      youtubeChannelCacheVideoCount: ytIds.size,
      interpretation:
        '未命中曲中若仍带正式 YouTube watch 链接，通常表示 CIP 频道已有对应 YouTube 投稿；多数情况下 B 站也有同曲钢琴稿，但因未拿到「账号视频总表」或搜索风控，未能进入候选集。',
    },
    scannedMissedCount: toScan.length,
    partial: !DIAG_OFFLINE && DIAG_MAX > 0 && toScan.length < missed.length,
    offlineOnly: DIAG_OFFLINE,
    minScoreUsed: MIN_SCORE,
    scoreGapUsed: SCORE_GAP,
    reasonCounts: counts,
    sampleForManualReview: sample,
    note:
      'reason 含义：api_non_json=返回 HTML/风控；api_banned_412=-412；search_empty_rows=无视频结果；no_up_in_page1=有结果但首页无 mid；score_below_threshold=有 UP 视频但打分低于阈值；ambiguous_top2_gap=前两名分差过小；sync_drifts_above_threshold=当前请求下分数已够但未进表(阈值/历史 run 差异)。titleHitArtistMiss 在对应行内给出。设置 BILIBILI_DIAG_OFFLINE=1 可只输出离线先验不写 reasonCounts。',
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ missed: missed.length, reasonCounts: counts, out: OUT }, null, 2));
}

main();
