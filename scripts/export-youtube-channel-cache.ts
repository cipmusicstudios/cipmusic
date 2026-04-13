/**
 * Run yt-dlp against @CIPMusic /videos and write public/youtube-channel-order-cache.json
 * so CI / teammates can build manifest without yt-dlp. Re-run periodically to refresh order.
 *
 * Strategy (YouTube rate-limits hundreds of back-to-back video metadata fetches):
 * 1) Flat playlist: id + title + index (fast, no upload_date).
 * 2) Chunked `--playlist-items` + `--sleep-requests` + optional pause between chunks
 *    to fill `uploadDate` (YYYYMMDD) per video. Merge by id; resume skips chunks that
 *    already have dates unless YOUTUBE_EXPORT_FORCE_REFRESH=1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { execYtDlp, execYtDlpLenient, resolveYtDlp } from './yt-dlp-resolve.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outPath = path.join(projectRoot, 'public', 'youtube-channel-order-cache.json');
/** Channel /videos tab (newest-first). Override with YOUTUBE_CHANNEL_VIDEOS_URL. */
const channelUrl =
  process.env.YOUTUBE_CHANNEL_VIDEOS_URL?.trim() || 'https://www.youtube.com/@CIPMusic/videos';

function sleepSync(sec: number) {
  if (sec <= 0) return;
  try {
    execFileSync('sleep', [String(sec)], { stdio: 'ignore' });
  } catch {
    /* non-Unix: skip pause */
  }
}

type VideoRow = { id: string; title: string; index: number; uploadDate?: string };

function fetchFlatPlaylist(): VideoRow[] {
  const out = execYtDlp(
    [
      '--no-warnings',
      '--ignore-errors',
      '--flat-playlist',
      '--playlist-end',
      '10000',
      '--print',
      '%(id)s\t%(title)s',
      channelUrl,
    ],
    { encoding: 'utf8', maxBuffer: 50_000_000, timeout: 300_000 },
  );
  const videos: VideoRow[] = [];
  const lines = out.split(/\r?\n/).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    const id = parts[0]?.trim();
    const title = parts[1]?.trim() ?? '';
    if (!id || id.length < 6) continue;
    videos.push({ id, title, index: i });
  }
  return videos;
}

function loadPreviousSameChannel(): Map<string, string> {
  const idToDate = new Map<string, string>();
  if (!fs.existsSync(outPath)) return idToDate;
  try {
    const raw = JSON.parse(fs.readFileSync(outPath, 'utf8')) as {
      channelUrl?: string;
      videos?: Array<{ id?: string; uploadDate?: string }>;
    };
    if (raw.channelUrl !== channelUrl || !Array.isArray(raw.videos)) return idToDate;
    for (const v of raw.videos) {
      const id = v.id?.trim();
      const u = v.uploadDate?.trim();
      if (id && u && u !== 'NA' && u.length >= 8) idToDate.set(id, u);
    }
  } catch {
    /* ignore */
  }
  return idToDate;
}

function writeCachePartial(videos: VideoRow[]) {
  const payload = {
    channelUrl,
    generatedAt: new Date().toISOString(),
    videos,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
}

function enrichUploadDatesChunked(videos: VideoRow[]) {
  const force = process.env.YOUTUBE_EXPORT_FORCE_REFRESH === '1';
  const chunkSize = Math.max(
    1,
    Math.min(100, Number.parseInt(process.env.YOUTUBE_EXPORT_CHUNK_SIZE ?? '15', 10) || 15),
  );
  const sleepReq = Math.max(
    0.5,
    Number.parseFloat(process.env.YOUTUBE_EXPORT_SLEEP_REQUESTS ?? '2.5') || 2.5,
  );
  const pauseSec = Math.max(
    0,
    Number.parseInt(process.env.YOUTUBE_EXPORT_CHUNK_PAUSE_SEC ?? '5', 10) || 5,
  );

  const n = videos.length;
  if (n === 0) return;

  let chunksRun = 0;
  let chunksSkipped = 0;

  for (let start = 1; start <= n; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, n);
    const slice = videos.slice(start - 1, end);
    if (!force && slice.every(r => r.uploadDate)) {
      chunksSkipped++;
      continue;
    }

    const { stdout, status } = execYtDlpLenient(
      [
        '--no-warnings',
        '--ignore-errors',
        '--skip-download',
        '--playlist-items',
        `${start}-${end}`,
        '--sleep-requests',
        String(sleepReq),
        '--print',
        '%(id)s\t%(upload_date)s',
        channelUrl,
      ],
      { encoding: 'utf8', maxBuffer: 50_000_000, timeout: 900_000 },
    );

    const byId = new Map(videos.map(v => [v.id, v]));
    for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
      const parts = line.split('\t');
      const id = parts[0]?.trim();
      const upload = parts[1]?.trim();
      if (!id || !upload || upload === 'NA' || upload.length < 8) continue;
      const row = byId.get(id);
      if (row) row.uploadDate = upload;
    }

    chunksRun++;
    writeCachePartial(videos);
    console.log(
      `[export-youtube-channel-cache] upload_date chunk ${start}-${end}/${n} (yt-dlp exit ${status}); cache saved`,
    );
    sleepSync(pauseSec);
  }

  const withDate = videos.filter(v => v.uploadDate).length;
  console.log(
    `[export-youtube-channel-cache] upload dates: ${withDate}/${n} videos; chunks run=${chunksRun} skipped(resume)=${chunksSkipped}`,
  );
}

function main() {
  if (!resolveYtDlp()) {
    console.error(
      '[export-youtube-channel-cache] yt-dlp not found. Install: pip install yt-dlp  OR  brew install yt-dlp',
    );
    process.exit(1);
  }

  console.log('[export-youtube-channel-cache] Fetching flat playlist (order + titles)...');
  const videos = fetchFlatPlaylist();
  if (videos.length === 0) {
    console.error('[export-youtube-channel-cache] Empty playlist');
    process.exit(1);
  }

  const prev = loadPreviousSameChannel();
  let merged = 0;
  for (const v of videos) {
    if (!v.uploadDate && prev.has(v.id)) {
      v.uploadDate = prev.get(v.id);
      merged++;
    }
  }
  if (merged) {
    console.log(`[export-youtube-channel-cache] Merged uploadDate for ${merged} ids from existing cache`);
  }

  console.log('[export-youtube-channel-cache] Filling upload_date (chunked; may take 30–90+ min for ~600 videos)...');
  enrichUploadDatesChunked(videos);

  writeCachePartial(videos);
  const withDate = videos.filter(v => v.uploadDate).length;
  console.log(
    `[export-youtube-channel-cache] Wrote ${videos.length} videos (${withDate} with uploadDate) to ${path.relative(projectRoot, outPath)}`,
  );
}

try {
  main();
} catch (e) {
  console.error('[export-youtube-channel-cache] Failed (install yt-dlp and ensure network):', (e as Error).message);
  process.exit(1);
}
