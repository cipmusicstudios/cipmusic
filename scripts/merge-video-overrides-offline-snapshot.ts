/**
 * 基于 data/bilibili-up-1467634-snapshot.json（BV+标题总表）与 manifest 离线对齐，
 * 仅写入 videoUrlZhHans / videoPlatformZhHans；新条目 videoUrlDefault 固定为 null（不触碰应用默认 YouTube）。
 * 高置信度写入 entries；低置信度仅写入 pendingReview 供人工确认。
 *
 * npx tsx scripts/merge-video-overrides-offline-snapshot.ts
 *
 * 阈值（环境变量可覆盖）：
 *   BILIBILI_OFFLINE_AUTO_MIN_SCORE=210
 *   BILIBILI_OFFLINE_AUTO_GAP=13
 *   BILIBILI_OFFLINE_REVIEW_MIN_SCORE=115
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_IMPORT_METADATA_OVERRIDES } from '../src/local-import-metadata-overrides';
import type { LocalImportMetadataOverride } from '../src/local-import-metadata-overrides';
import {
  bestMatchEnhanced,
  computeAutoOk,
  normLegacy,
  type BiliVideo,
  type ManifestTrack,
  type ScoreBreakdown,
} from './lib/bilibili-offline-matcher';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const SNAPSHOT = path.join(projectRoot, 'data', 'bilibili-up-1467634-snapshot.json');
const OVERRIDES = path.join(projectRoot, 'data', 'video-overrides.json');
const REPORT = path.join(projectRoot, 'data', 'bilibili-offline-merge-report.json');

const AUTO_MIN = Number(process.env.BILIBILI_OFFLINE_AUTO_MIN_SCORE || '210');
const AUTO_GAP = Number(process.env.BILIBILI_OFFLINE_AUTO_GAP || '13');
const REVIEW_MIN = Number(process.env.BILIBILI_OFFLINE_REVIEW_MIN_SCORE || '115');
const AMBIGUOUS_BV_GAP = Number(process.env.BILIBILI_OFFLINE_AMBIGUOUS_BV_GAP || '18');

const meta = LOCAL_IMPORT_METADATA_OVERRIDES as Record<string, LocalImportMetadataOverride>;

type VideoOverrideEntry = {
  title: string;
  artist: string;
  aliases: string[];
  slugKeys: string[];
  videoUrlZhHans: string;
  videoPlatformZhHans: 'bilibili';
  videoUrlDefault: string | null;
  notes?: string;
};

type OverridesFile = {
  version: number;
  schema: string;
  readme?: string;
  entries: VideoOverrideEntry[];
  pendingReview: Array<{
    reason: string;
    detail?: string;
    countEstimate?: number;
    items?: unknown[];
  }>;
};

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
  const raw = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')) as {
    videos?: BiliVideo[];
  };
  return (raw.videos || []).map(v => ({
    bvid: v.bvid,
    title: v.title || '',
    url: v.url || `https://www.bilibili.com/video/${v.bvid}/`,
  }));
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
    console.error('缺少快照:', SNAPSHOT, '请先 npm run export:bilibili-space-snapshot');
    process.exit(1);
  }

  const videos = loadSnapshot();
  const tracks = loadManifestTracks();
  const doc = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')) as OverridesFile;

  const slugToEntry = new Map<string, VideoOverrideEntry>();
  for (const e of doc.entries) {
    for (const k of e.slugKeys || []) {
      slugToEntry.set(normLegacy(k), e);
    }
  }

  const autoCandidates: Scored[] = [];
  const reviewItems: Record<string, unknown>[] = [];

  for (const t of tracks) {
    const slug = (t.slug || '').trim();
    if (!slug) continue;
    const nk = normLegacy(slug);
    if (slugToEntry.has(nk)) continue;

    const ov = meta[slug];
    const m = bestMatchEnhanced(t, videos, ov, {
      includeYoutube: true,
      includeOverride: true,
      useStripHay: true,
    });
    if (!m || m.breakdown.total < REVIEW_MIN) continue;

    const autoOk = computeAutoOk(m.breakdown, m.second, AUTO_MIN, AUTO_GAP);
    const scored: Scored = {
      track: t,
      video: m.video,
      breakdown: m.breakdown,
      second: m.second,
    };

    if (autoOk) {
      autoCandidates.push(scored);
    } else {
      reviewItems.push({
        kind: 'low_score_or_tight_gap',
        slug,
        suggestedBvid: m.video.bvid,
        suggestedVideoUrlZhHans: `https://www.bilibili.com/video/${m.video.bvid}/`,
        score: m.breakdown.total,
        secondScore: m.second?.total ?? 0,
        baseScore: m.breakdown.base,
        autoThreshold: AUTO_MIN,
        gapRequired: AUTO_GAP,
        biliTitle: (m.video.title || '').slice(0, 200),
      });
    }
  }

  const { winners, demoted } = resolveBvWinners(autoCandidates);

  for (const r of demoted) {
    reviewItems.push({
      kind: 'bv_demoted_loser_or_near_tie',
      slug: r.track.slug,
      bvid: r.video.bvid,
      score: r.breakdown.total,
      secondContext: '同一 BV 多曲目或冠亚军分差过小，未自动写入',
      biliTitle: (r.video.title || '').slice(0, 200),
    });
  }

  const newEntries: VideoOverrideEntry[] = [];
  for (const w of winners) {
    const slug = (w.track.slug || '').trim();
    const nk = normLegacy(slug);
    if (slugToEntry.has(nk)) continue;

    const displayTitle = (w.track.displayTitle || w.track.title || slug).trim();
    const artist =
      w.track.artists?.zhHans ||
      w.track.artists?.zhHant ||
      w.track.originalArtist ||
      w.track.artists?.en ||
      '（未知）';

    const gap = w.breakdown.total - (w.second?.total ?? 0);
    newEntries.push({
      title: displayTitle,
      artist: artist.trim(),
      aliases: [],
      slugKeys: [slug],
      videoUrlZhHans: `https://www.bilibili.com/video/${w.video.bvid}/`,
      videoPlatformZhHans: 'bilibili',
      videoUrlDefault: null,
      notes: `offline-snapshot: total=${w.breakdown.total} base=${w.breakdown.base} gap=${gap}；B站:「${(w.video.title || '').slice(0, 120)}」`,
    });
    slugToEntry.set(nk, newEntries[newEntries.length - 1]);
  }

  const prevPending = doc.pendingReview.filter(
    p => p.reason !== 'bilibili_offline_low_confidence' && p.reason !== 'bilibili_offline_merge',
  );

  const nextDoc: OverridesFile = {
    ...doc,
    entries: [...doc.entries, ...newEntries].sort((a, b) =>
      (a.slugKeys[0] || '').localeCompare(b.slugKeys[0] || '', 'zh-Hans-CN'),
    ),
    pendingReview: [
      {
        reason: 'bilibili_offline_merge',
        detail: `snapshot=${videos.length} autoAdded=${newEntries.length} reviewQueue=${reviewItems.length} AUTO_MIN=${AUTO_MIN} at ${new Date().toISOString()}`,
        countEstimate: reviewItems.length,
        items: reviewItems.slice(0, 500),
      },
      ...prevPending,
    ],
  };

  fs.writeFileSync(OVERRIDES, JSON.stringify(nextDoc, null, 2) + '\n', 'utf8');

  const covered = new Set<string>();
  for (const e of nextDoc.entries) {
    for (const k of e.slugKeys || []) covered.add(normLegacy(k));
  }
  /** manifest 中有 slug、但合并后仍无任何 override 行：视为「当前 matcher / 流程下仍未对齐」，不表示 B 站无片源 */
  const stillUnmatchedTrackCount = tracks.filter(t => {
    const s = (t.slug || '').trim();
    return s && !covered.has(normLegacy(s));
  }).length;

  fs.writeFileSync(
    REPORT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        snapshotVideoCount: videos.length,
        autoAdded: newEntries.length,
        reviewItems: reviewItems.length,
        stillUnmatchedTrackCount,
        unmatchedByCurrentMatcher: stillUnmatchedTrackCount,
        thresholds: { AUTO_MIN, AUTO_GAP, REVIEW_MIN },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        autoAdded: newEntries.length,
        reviewItems: reviewItems.length,
        stillUnmatchedTrackCount,
        unmatchedByCurrentMatcher: stillUnmatchedTrackCount,
      },
      null,
      2,
    ),
  );
}

main();
