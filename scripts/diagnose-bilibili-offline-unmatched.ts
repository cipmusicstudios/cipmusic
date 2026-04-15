/**
 * 增强 matcher 只读诊断：不写 video-overrides，输出 data/bilibili-offline-matcher-diagnosis.json
 *
 * npx tsx scripts/diagnose-bilibili-offline-unmatched.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_IMPORT_METADATA_OVERRIDES } from '../src/local-import-metadata-overrides';
import {
  bestMatchEnhanced,
  computeAutoOk,
  computeAutoOkLegacyRule,
  normLegacy,
  scoreTrackToBiliTitleLegacy,
  type BiliVideo,
  type ManifestTrack,
} from './lib/bilibili-offline-matcher';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const SNAPSHOT = path.join(projectRoot, 'data', 'bilibili-up-1467634-snapshot.json');
const OVERRIDES = path.join(projectRoot, 'data', 'video-overrides.json');
const OUT = path.join(projectRoot, 'data', 'bilibili-offline-matcher-diagnosis.json');

const AUTO_MIN = Number(process.env.BILIBILI_OFFLINE_AUTO_MIN_SCORE || '210');
const AUTO_GAP = Number(process.env.BILIBILI_OFFLINE_AUTO_GAP || '13');
const REVIEW_MIN = Number(process.env.BILIBILI_OFFLINE_REVIEW_MIN_SCORE || '115');
const AMBIGUOUS_BV_GAP = Number(process.env.BILIBILI_OFFLINE_AMBIGUOUS_BV_GAP || '18');

const meta = LOCAL_IMPORT_METADATA_OVERRIDES as Record<string, import('../src/local-import-metadata-overrides').LocalImportMetadataOverride>;

type ScoreBreakdown = import('./lib/bilibili-offline-matcher').ScoreBreakdown;

type Scored = {
  track: ManifestTrack;
  video: BiliVideo;
  breakdown: ScoreBreakdown;
  second: ScoreBreakdown | null;
};

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

function loadSnapshot(): BiliVideo[] {
  const raw = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')) as { videos?: BiliVideo[] };
  return (raw.videos || []).map(v => ({
    bvid: v.bvid,
    title: v.title || '',
    url: v.url || `https://www.bilibili.com/video/${v.bvid}/`,
  }));
}

function legacyMaxScore(t: ManifestTrack, videos: BiliVideo[]): number {
  let m = 0;
  for (const v of videos) {
    m = Math.max(m, scoreTrackToBiliTitleLegacy(t, v.title));
  }
  return m;
}

function resolveBvWinners(pairs: Scored[]): { winners: Scored[]; demoted: Scored[] } {
  const byBv = new Map<string, Scored[]>();
  for (const p of pairs) {
    const arr = byBv.get(p.video.bvid) ?? [];
    arr.push(p);
    byBv.set(p.video.bvid, arr);
  }
  const winners: Scored[] = [];
  const demoted: Scored[] = [];
  for (const arr of byBv.values()) {
    arr.sort((a, b) => b.breakdown.total - a.breakdown.total);
    if (arr.length >= 2 && arr[0].breakdown.total - arr[1].breakdown.total < AMBIGUOUS_BV_GAP) {
      demoted.push(...arr);
      continue;
    }
    winners.push(arr[0]);
    demoted.push(...arr.slice(1));
  }
  return { winners, demoted };
}

function main() {
  if (!fs.existsSync(SNAPSHOT)) {
    console.error('缺少快照:', SNAPSHOT);
    process.exit(1);
  }
  if (!fs.existsSync(OVERRIDES)) {
    console.error('缺少', OVERRIDES);
    process.exit(1);
  }

  const videos = loadSnapshot();
  const tracks = loadManifestTracks();
  const doc = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')) as {
    entries: { slugKeys?: string[] }[];
    pendingReview?: { reason?: string; items?: { slug?: string }[] }[];
  };

  const slugToEntry = new Set<string>();
  for (const e of doc.entries || []) {
    for (const k of e.slugKeys || []) {
      slugToEntry.add(normLegacy(k));
    }
  }

  const pendingMergeSlugs = new Set<string>();
  for (const pr of doc.pendingReview || []) {
    if (pr.reason !== 'bilibili_offline_merge' || !pr.items) continue;
    for (const it of pr.items) {
      const s = (it.slug || '').trim();
      if (s) pendingMergeSlugs.add(normLegacy(s));
    }
  }

  const unmatchedTracks = tracks.filter(t => {
    const slug = (t.slug || '').trim();
    return slug && !slugToEntry.has(normLegacy(slug));
  });

  const unmatchedSlugNorms = new Set(unmatchedTracks.map(t => normLegacy((t.slug || '').trim())));
  let unmatchedAlsoInPendingMerge = 0;
  for (const n of unmatchedSlugNorms) {
    if (pendingMergeSlugs.has(n)) unmatchedAlsoInPendingMerge++;
  }

  const autoCandidates: Scored[] = [];
  const reviewFromLow: Scored[] = [];
  const perTrack: {
    slug: string;
    legacyMax: number;
    enhancedTotal: number;
    inCandidateSet: boolean;
    autoOkRaw: boolean;
    bvid?: string;
    stripLift: boolean;
    youtubeLift: boolean;
    overrideLift: boolean;
    catalogTitlesLift: boolean;
    artistRuleLift: boolean;
  }[] = [];

  const attrAuto = { strip: 0, youtube: 0, override: 0, catalogTitles: 0, artistRule: 0 };
  const attrCandidate = { strip: 0, youtube: 0, override: 0, catalogTitles: 0, artistRule: 0 };

  for (const t of unmatchedTracks) {
    const slug = (t.slug || '').trim();
    const ov = meta[slug];
    const legacyMax = legacyMaxScore(t, videos);
    const m = bestMatchEnhanced(t, videos, ov, {
      includeYoutube: true,
      includeOverride: true,
      useStripHay: true,
    });
    const total = m?.breakdown.total ?? 0;
    const inCandidateSet = total >= REVIEW_MIN;

    const mNoStrip = bestMatchEnhanced(t, videos, ov, {
      includeYoutube: true,
      includeOverride: true,
      useStripHay: false,
    });
    const mNoYt = bestMatchEnhanced(t, videos, ov, {
      includeYoutube: false,
      includeOverride: true,
      useStripHay: true,
    });
    const mNoOv = bestMatchEnhanced(t, videos, ov, {
      includeYoutube: true,
      includeOverride: false,
      useStripHay: true,
    });
    const mNoCat = bestMatchEnhanced(t, videos, ov, {
      includeYoutube: true,
      includeOverride: true,
      includeCatalogTitles: false,
      useStripHay: true,
    });

    const noStripT = mNoStrip?.breakdown.total ?? 0;
    const noYtT = mNoYt?.breakdown.total ?? 0;
    const noOvT = mNoOv?.breakdown.total ?? 0;
    const noCatT = mNoCat?.breakdown.total ?? 0;
    /** 自 legacy 无法进候选，仅靠增强后跨过 REVIEW；strip 指 haystack 剥离/加强归一 */
    const stripLift = inCandidateSet && noStripT < REVIEW_MIN && legacyMax < REVIEW_MIN;
    /** YouTube 标题变体把分数从候选线以下拉到以上 */
    const youtubeLift = inCandidateSet && noYtT < REVIEW_MIN && legacyMax < REVIEW_MIN;
    /** override 变体把分数从候选线以下拉到以上 */
    const overrideLift = inCandidateSet && noOvT < REVIEW_MIN && legacyMax < REVIEW_MIN;
    /** manifest titles.* 把分数从候选线以下拉到以上 */
    const catalogTitlesLift = inCandidateSet && noCatT < REVIEW_MIN && legacyMax < REVIEW_MIN;
    const autoOkRaw = m ? computeAutoOk(m.breakdown, m.second, AUTO_MIN, AUTO_GAP) : false;
    const artistRuleLift = m
      ? autoOkRaw && !computeAutoOkLegacyRule(m.breakdown, m.second, AUTO_MIN, AUTO_GAP)
      : false;

    if (inCandidateSet) {
      if (stripLift) attrCandidate.strip++;
      if (youtubeLift) attrCandidate.youtube++;
      if (overrideLift) attrCandidate.override++;
      if (catalogTitlesLift) attrCandidate.catalogTitles++;
      if (artistRuleLift) attrCandidate.artistRule++;
    }

    perTrack.push({
      slug,
      legacyMax,
      enhancedTotal: total,
      inCandidateSet,
      autoOkRaw,
      bvid: m?.video.bvid,
      stripLift,
      youtubeLift,
      overrideLift,
      catalogTitlesLift,
      artistRuleLift,
    });

    if (!m || m.breakdown.total < REVIEW_MIN) continue;

    if (autoOkRaw) {
      autoCandidates.push({
        track: t,
        video: m.video,
        breakdown: m.breakdown,
        second: m.second,
      });
    } else {
      reviewFromLow.push({
        track: t,
        video: m.video,
        breakdown: m.breakdown,
        second: m.second,
      });
    }
  }

  const { winners, demoted } = resolveBvWinners(autoCandidates);

  /** 未做 BV 去重时满足新 AUTO 规则的条数（大量会在此处因同 BV 并列被降级） */
  const autoOkBeforeBvDedup = autoCandidates.length;

  for (const w of winners) {
    const slug = (w.track.slug || '').trim();
    const row = perTrack.find(p => p.slug === slug);
    if (!row) continue;
    if (row.stripLift) attrAuto.strip++;
    if (row.youtubeLift) attrAuto.youtube++;
    if (row.overrideLift) attrAuto.override++;
    if (row.catalogTitlesLift) attrAuto.catalogTitles++;
    if (row.artistRuleLift) attrAuto.artistRule++;
  }

  const inCandidateCount = perTrack.filter(p => p.inCandidateSet).length;
  const autoConfirmCount = winners.length;
  const demotedCount = demoted.length;
  const reviewQueueCount = reviewFromLow.length + demotedCount;
  const stillUnmatchedStrict = perTrack.filter(p => !p.inCandidateSet).length;
  const rescuedFromLegacyBelowReview = perTrack.filter(
    p => p.inCandidateSet && p.legacyMax < REVIEW_MIN,
  ).length;
  const noStrictSingleFactorLift = perTrack.filter(
    p =>
      p.inCandidateSet &&
      p.legacyMax < REVIEW_MIN &&
      !p.stripLift &&
      !p.youtubeLift &&
      !p.overrideLift &&
      !p.catalogTitlesLift,
  ).length;

  const payload = {
    generatedAt: new Date().toISOString(),
    mode: 'read_only_diagnosis',
    snapshotVideoCount: videos.length,
    overridesEntrySlugs: slugToEntry.size,
    unmatchedBeforeDiagnosis: unmatchedTracks.length,
    definitions: {
      unmatchedSlug:
        'manifest 中有 slug、但 video-overrides.entries 中尚无对应 slugKeys（无已写入的 videoUrlZhHans 行）',
      pendingMergeNote:
        '其中部分 slug 可能已出现在 pendingReview.bilibili_offline_merge，仅未写回 entries',
      stillUnmatchedByMatcher: '对上述 unmatched 曲目，增强 matcher 下全局最佳分仍 < REVIEW_MIN',
    },
    unmatchedBreakdown: {
      totalWithoutEntry: unmatchedTracks.length,
      alsoListedInPendingBilibiliMerge: unmatchedAlsoInPendingMerge,
      notInPendingBilibiliMerge: unmatchedTracks.length - unmatchedAlsoInPendingMerge,
    },
    thresholds: { AUTO_MIN, AUTO_GAP, REVIEW_MIN, AMBIGUOUS_BV_GAP },
    summary: {
      /** 增强后 best 分数 >= REVIEW_MIN */
      enterCandidateSet: inCandidateCount,
      /** 未做 BV 去重、且满足新 AUTO 阈值的条数 */
      autoOkBeforeBvDedup,
      /** BV 去重阶段因并列/多曲目被降级的 AUTO 候选条数 */
      bvDemotedFromAuto: demotedCount,
      /** 模拟 merge：通过 AUTO 且 BV 去重后胜出 */
      autoConfirmLevel: autoConfirmCount,
      /** 低分/分差不足 + BV 并列降级，应进 pendingReview */
      shouldPendingReview: reviewQueueCount,
      /** best 仍 < REVIEW_MIN，当前 matcher 下无合格候选 */
      stillUnmatchedByMatcher: stillUnmatchedStrict,
      /** 旧 matcher 峰值 < REVIEW_MIN、增强后进入候选（整体「被增强拉起」） */
      rescuedFromLegacyBelowReview,
      /**
       * 被拉起但未落入任一 strict 单因子 lift（多因子叠加或单因子去掉后仍 ≥REVIEW）
       */
      candidateNoStrictSingleFactorLift: noStrictSingleFactorLift,
    },
    attributionNotes: {
      stripLift: 'legacyMax<REVIEW 且 useStripHay=false 时总分仍<REVIEW，全量增强后进入候选',
      youtubeLift: 'legacyMax<REVIEW 且去掉 YouTube 标题变体后总分<REVIEW，全量增强后进入候选',
      overrideLift: 'legacyMax<REVIEW 且去掉 metadata overrides 变体后总分<REVIEW，全量增强后进入候选',
      catalogTitlesLift: 'legacyMax<REVIEW 且去掉 manifest titles.* 后总分<REVIEW，全量增强后进入候选',
      artistRuleLift: '新 AUTO 规则通过且旧「全分+同 gap」规则不通过（titleStrong 时 base/无 slug 放宽）',
      caveat:
        '各 lift 可叠加，计数非互斥；strip/youtube/override/catalogTitles 仅统计「legacy<REVIEW 且去掉该因子后<REVIEW、全量后≥REVIEW」的严格情形',
    },
    attributionAmongAutoWinners: attrAuto,
    attributionAmongCandidates: attrCandidate,
    samples: {
      autoWinners: winners.slice(0, 15).map(w => ({
        slug: w.track.slug,
        bvid: w.video.bvid,
        total: w.breakdown.total,
        base: w.breakdown.base,
        gap: w.breakdown.total - (w.second?.total ?? 0),
      })),
      stillUnmatched: perTrack
        .filter(p => !p.inCandidateSet)
        .slice(0, 25)
        .map(p => ({
          slug: p.slug,
          legacyMax: p.legacyMax,
          enhancedTotal: p.enhancedTotal,
        })),
    },
 };

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify(payload.summary, null, 2));
  console.log('written', OUT);
}

main();
