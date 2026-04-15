/**
 * 从 Bilibili 搜索 API 收集 UP 主（默认 mid=1467634，CIP Music）的投稿 BV号，
 * 与 public/songs-manifest-chunk-*.json 离线对齐后，仅写入 data/video-overrides.json
 * 的简中字段（videoUrlZhHans 等），不修改 manifest / YouTube / 前端默认逻辑。
 *
 * 用法：
 *   npx tsx scripts/sync-bilibili-video-overrides.ts
 *   BILIBILI_MID=1467634 BILIBILI_SEARCH_SLEEP_MS=4500 npx tsx scripts/sync-bilibili-video-overrides.ts
 *
 * 若仅想根据已有快照离线合并（跳过联网）：
 *   BILIBILI_OFFLINE_SNAPSHOT=data/bilibili-up-1467634-snapshot.json npx tsx scripts/sync-bilibili-video-overrides.ts
 *
 * 环境常因风控返回412：可隔一段时间重试，或在本机浏览器登录后导出 Cookie 给 curl（自行扩展）。
 *
 * 逐曲搜索（更慢，但分页被 ban 时仍可能命中）：
 *   BILIBILI_MODE=per-track BILIBILI_MAX_TRACKS=200 BILIBILI_PER_TRACK_SLEEP_MS=4000 npx tsx scripts/sync-bilibili-video-overrides.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const MID = Number(process.env.BILIBILI_MID || '1467634');
const SLEEP_MS = Number(process.env.BILIBILI_SEARCH_SLEEP_MS || '4200');
const MAX_PAGES = Math.min(80, Number(process.env.BILIBILI_MAX_SEARCH_PAGES || '50'));
const OFFLINE_SNAPSHOT = process.env.BILIBILI_OFFLINE_SNAPSHOT?.trim();
const MIN_SCORE = Number(process.env.BILIBILI_MATCH_MIN_SCORE || '95');
const MODE = (process.env.BILIBILI_MODE || 'search').trim();
const PER_TRACK_MIN_SCORE = Number(process.env.BILIBILI_PER_TRACK_MIN_SCORE || '135');
const MAX_TRACKS_ENV = Number(process.env.BILIBILI_MAX_TRACKS || '0');
const PER_TRACK_SLEEP_MS = Number(process.env.BILIBILI_PER_TRACK_SLEEP_MS || '3500');
const SNAPSHOT_OUT = path.join(projectRoot, 'data', 'bilibili-up-1467634-snapshot.json');
const REPORT_PATH = path.join(projectRoot, 'data', 'bilibili-video-sync-report.json');

type ManifestTrack = {
  id: string;
  slug?: string;
  title?: string;
  displayTitle?: string;
  originalArtist?: string;
  youtubeVideoUrl?: string | null;
  artists?: { zhHans?: string; zhHant?: string; en?: string };
};

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
  pendingReview: Array<{ reason: string; detail: string; countEstimate?: number; items?: unknown[] }>;
};

type BiliVideo = { bvid: string; title: string };

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

function curlSearch(keyword: string, page: number): { ok: true; json: any } | { ok: false; error: string } {
  const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(
    keyword,
  )}&page=${page}`;
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
      return { ok: false, error: `non-json: ${t.slice(0, 80)}` };
    }
    return { ok: true, json: JSON.parse(t) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
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

function norm(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[|�·・]/g, ' ')
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

function isRealYoutubeWatch(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  if (url.includes('/search?') || url.includes('@')) return false;
  return /[?&]v=[\w-]{11}/.test(url) || /youtu\.be\/[\w-]{11}/.test(url);
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

function collectFromSearch(): { videos: BiliVideo[]; errors: string[] } {
  const byBv = new Map<string, BiliVideo>();
  const errors: string[] = [];
  const keywords = [
    'CIP Music 钢琴',
    'CIP Music Piano',
    'Piano by CIP Music',
    'CIP Music Piano Cover',
    'CIP Music',
  ];

  for (const kw of keywords) {
    let emptyStreak = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = curlSearch(kw, page);
      if (!res.ok) {
        errors.push(`${kw} p${page}: ${'error' in res ? res.error : ''}`);
        break;
      }
      const { json } = res;
      if (json.code !== 0) {
        errors.push(`${kw} p${page}: api ${json.code} ${json.message || ''}`);
        break;
      }
      const rows = json.data?.result || [];
      if (!rows.length) {
        emptyStreak++;
        if (emptyStreak >= 2) break;
        continue;
      }
      emptyStreak = 0;
      let pageHits = 0;
      for (const x of rows) {
        if (x.mid !== MID) continue;
        const title = stripTitle(x.title || '');
        byBv.set(x.bvid, { bvid: x.bvid, title });
        pageHits++;
      }
      if (pageHits === 0 && page >= 3) {
        /*该关键词前几页已无目标 UP，略过剩余页 */
        break;
      }
      sleepSync(SLEEP_MS);
    }
    sleepSync(SLEEP_MS);
  }

  return { videos: [...byBv.values()], errors };
}

function writeSnapshot(videos: BiliVideo[]) {
  try {
    fs.writeFileSync(
      SNAPSHOT_OUT,
      JSON.stringify({ generatedAt: new Date().toISOString(), mid: MID, videos }, null, 2) + '\n',
      'utf8',
    );
  } catch {
    /* ignore */
  }
}

function existingSlugNormSet(entries: VideoOverrideEntry[]): Set<string> {
  const s = new Set<string>();
  for (const e of entries) {
    for (const k of e.slugKeys || []) s.add(norm(k));
  }
  return s;
}

function resolveBvCollisions(pairs: ScoredPair[]): { winners: ScoredPair[]; conflicts: string[] } {
  const byBv = new Map<string, ScoredPair[]>();
  for (const p of pairs) {
    const arr = byBv.get(p.video.bvid) ?? [];
    arr.push(p);
    byBv.set(p.video.bvid, arr);
  }
  const winners: ScoredPair[] = [];
  const conflicts: string[] = [];
  for (const [bvid, arr] of byBv) {
    arr.sort((a, b) => b.score - a.score);
    if (arr.length >= 2 && arr[0].score - arr[1].score < 18) {
      conflicts.push(
        `ambiguous_bv ${bvid}: ${arr[0].track.slug} (${arr[0].score}) vs ${arr[1].track.slug} (${arr[1].score})`,
      );
      continue;
    }
    winners.push(arr[0]);
  }
  return { winners, conflicts };
}

function collectPerTrack(
  tracks: ManifestTrack[],
  alreadySlugNorm: Set<string>,
): { pairs: ScoredPair[]; errors: string[] } {
  const pairs: ScoredPair[] = [];
  const errors: string[] = [];
  let processed = 0;
  const maxTracks = MAX_TRACKS_ENV > 0 ? MAX_TRACKS_ENV : Number.POSITIVE_INFINITY;

  for (const t of tracks) {
    if (processed >= maxTracks) break;
    const slug = (t.slug || '').trim();
    if (!slug || alreadySlugNorm.has(norm(slug))) continue;

    const art = t.artists?.zhHans || t.originalArtist || t.artists?.zhHant || t.artists?.en || '';
    const tit = (t.displayTitle || t.title || '').trim();
    if (!tit) continue;

    const q = `${art} ${tit} CIP Music 钢琴`.replace(/\s+/g, ' ').trim();
    const res = curlSearch(q, 1);
    processed++;

    if (!res.ok) {
      errors.push(`per-track ${slug}: ${'error' in res ? res.error : ''}`);
      sleepSync(PER_TRACK_SLEEP_MS);
      continue;
    }
    if (res.json.code !== 0) {
      errors.push(`per-track ${slug}: api ${res.json.code} ${res.json.message || ''}`);
      sleepSync(PER_TRACK_SLEEP_MS);
      continue;
    }
    const rows = res.json.data?.result || [];
    const cip = rows.filter((x: any) => x.mid === MID);
    if (!cip.length) {
      sleepSync(PER_TRACK_SLEEP_MS);
      continue;
    }
    let best: ScoredPair | null = null;
    let second = 0;
    for (const x of cip) {
      const v = { bvid: x.bvid, title: stripTitle(x.title || '') };
      const sc = scoreTrackToBiliTitle(t, v.title);
      if (!best || sc > best.score) {
        second = best?.score ?? 0;
        best = { track: t, video: v, score: sc };
      } else if (sc > second) second = sc;
    }
    if (best && best.score >= PER_TRACK_MIN_SCORE && best.score - second >= 12) {
      pairs.push(best);
    }
    sleepSync(PER_TRACK_SLEEP_MS);
  }

  return { pairs, errors };
}

function loadSnapshot(p: string): BiliVideo[] {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { videos?: BiliVideo[] };
  return raw.videos?.length ? raw.videos : [];
}

type ScoredPair = { track: ManifestTrack; video: BiliVideo; score: number };

function matchCatalog(videos: BiliVideo[], tracks: ManifestTrack[]) {
  const conflicts: string[] = [];
  if (!videos.length) {
    return { assigned: [] as ScoredPair[], conflicts };
  }

  const pairs: ScoredPair[] = [];
  for (const t of tracks) {
    let best: ScoredPair | null = null;
    let second = 0;
    for (const v of videos) {
      const sc = scoreTrackToBiliTitle(t, v.title);
      if (!best || sc > best.score) {
        second = best?.score ?? 0;
        best = { track: t, video: v, score: sc };
      } else if (sc > second) {
        second = sc;
      }
    }
    if (!best || best.score < MIN_SCORE) continue;
    if (best.score - second < 12 && second >= MIN_SCORE - 15) {
      conflicts.push(`ambiguous_track slug=${t.slug} best=${best.score} second=${second}`);
      continue;
    }
    pairs.push(best);
  }

  const { winners: assigned, conflicts: bvConflicts } = resolveBvCollisions(pairs);
  conflicts.push(...bvConflicts);

  return { assigned, conflicts };
}

function mergeEntries(
  existing: OverridesFile,
  assigned: ScoredPair[],
): { entries: VideoOverrideEntry[]; skipped: string[] } {
  const bySlug = new Map<string, VideoOverrideEntry>();
  const skipped: string[] = [];

  for (const e of existing.entries) {
    for (const k of e.slugKeys || []) {
      bySlug.set(norm(k), e);
    }
  }

  const next: VideoOverrideEntry[] = [...existing.entries];

  for (const { track, video, score } of assigned) {
    const slug = (track.slug || '').trim();
    if (!slug) {
      skipped.push(`no-slug track ${track.id}`);
      continue;
    }
    const nk = norm(slug);
    const prev = bySlug.get(nk);
    const url = `https://www.bilibili.com/video/${video.bvid}/`;
    if (prev) {
      if (prev.videoUrlZhHans.replace(/\/$/, '') === url.replace(/\/$/, '')) continue;
      const manual = prev.notes && !String(prev.notes).startsWith('auto:');
      skipped.push(
        manual
          ? `slug ${slug}: keep manual override`
          : `slug ${slug}: existing override BV differs, keep first`,
      );
      continue;
    }

    const displayTitle = (track.displayTitle || track.title || slug).trim();
    const artist =
      track.artists?.zhHans ||
      track.artists?.zhHant ||
      track.originalArtist ||
      track.artists?.en ||
      '（未知）';
    const yt = isRealYoutubeWatch(track.youtubeVideoUrl) ? track.youtubeVideoUrl!.trim() : null;

    const entry: VideoOverrideEntry = {
      title: displayTitle,
      artist: artist.trim(),
      aliases: [],
      slugKeys: [slug],
      videoUrlZhHans: url,
      videoPlatformZhHans: 'bilibili',
      videoUrlDefault: yt,
      notes: `auto: B站标题近似匹配 score=${score}；B站:「${video.title.slice(0, 120)}」`,
    };
    bySlug.set(nk, entry);
    next.push(entry);
  }

  return { entries: next, skipped };
}

function main() {
  const overridesPath = path.join(projectRoot, 'data', 'video-overrides.json');
  const existing = JSON.parse(fs.readFileSync(overridesPath, 'utf8')) as OverridesFile;
  const tracks = loadManifestTracks();

  let videos: BiliVideo[] = [];
  let fetchErrors: string[] = [];
  let assigned: ScoredPair[] = [];
  let conflicts: string[] = [];

  if (MODE === 'per-track') {
    const slugSet = existingSlugNormSet(existing.entries);
    const r = collectPerTrack(tracks, slugSet);
    fetchErrors = r.errors;
    const resolved = resolveBvCollisions(r.pairs);
    assigned = resolved.winners;
    conflicts = resolved.conflicts;
  } else if (OFFLINE_SNAPSHOT) {
    const snapPath = path.isAbsolute(OFFLINE_SNAPSHOT)
      ? OFFLINE_SNAPSHOT
      : path.join(projectRoot, OFFLINE_SNAPSHOT);
    videos = loadSnapshot(snapPath);
    fetchErrors.push(`offline snapshot ${videos.length} videos`);
    const m = matchCatalog(videos, tracks);
    assigned = m.assigned;
    conflicts = m.conflicts;
  } else {
    const r = collectFromSearch();
    videos = r.videos;
    fetchErrors = r.errors;
    if (videos.length) writeSnapshot(videos);
    const m = matchCatalog(videos, tracks);
    assigned = m.assigned;
    conflicts = m.conflicts;
  }

  const { entries, skipped } = mergeEntries(existing, assigned);

  const pendingItems = [
    ...conflicts.map(c => ({ reason: 'match_conflict', detail: c })),
    ...skipped.map(s => ({ reason: 'merge_skipped', detail: s })),
    ...fetchErrors.slice(0, 200).map(e => ({ reason: 'fetch', detail: e })),
  ];

  const prevPending = Array.isArray(existing.pendingReview) ? existing.pendingReview : [];
  const modeDetail =
    MODE === 'per-track'
      ? `mode=per-track newPairs=${assigned.length} perTrackMin=${PER_TRACK_MIN_SCORE}`
      : `mode=${MODE} videos=${videos.length} batchMinScore=${MIN_SCORE}`;
  const nextDoc: OverridesFile = {
    ...existing,
    entries: entries.sort((a, b) => (a.slugKeys[0] || '').localeCompare(b.slugKeys[0] || '', 'zh-Hans-CN')),
    pendingReview: [
      {
        reason: 'auto_sync_last_run',
        detail: `${modeDetail} at ${new Date().toISOString()}`,
        items: pendingItems.slice(0, 400),
        countEstimate: pendingItems.length,
      },
      ...prevPending.filter(p => p.reason !== 'auto_sync_last_run'),
    ],
  };

  fs.writeFileSync(overridesPath, JSON.stringify(nextDoc, null, 2) + '\n', 'utf8');
  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mid: MID,
        mode: MODE,
        snapshotVideoCount: videos.length,
        assigned: assigned.length,
        conflicts: conflicts.length,
        skippedMerge: skipped.length,
        fetchErrorSample: fetchErrors.slice(0, 30),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(
    `[bilibili-video-sync] mode=${MODE} videos=${videos.length} assigned=${assigned.length} entries=${entries.length} conflicts=${conflicts.length}`,
  );
}

main();
