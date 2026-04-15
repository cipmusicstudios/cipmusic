/**
 * 导出 B站空间视频总表（BV + 标题 + 链接）→ data/bilibili-up-1467634-snapshot.json
 *
 * 1) yt-dlp flat-playlist 拉 BV列表（遇 412 请带 Cookie）
 * 2) 对每个 BV 请求 /x/web-interface/view 补全标题（公开接口，适度节流）
 *
 * npx tsx scripts/export-bilibili-space-snapshot.ts
 *
 * 遇 412 时在本机已登录 B 站的浏览器上执行（示例）：
 *   BILIBILI_COOKIES_BROWSER=chrome npx tsx scripts/export-bilibili-space-snapshot.ts
 *
 * 或等价命令行（仅列 BV）：
 *   yt-dlp --cookies-from-browser chrome --flat-playlist --print "%(id)s" \
 *     "https://space.bilibili.com/1467634/video" > /tmp/bv.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { execYtDlpLenient, resolveYtDlp } from './yt-dlp-resolve.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const OUT = path.join(projectRoot, 'data', 'bilibili-up-1467634-snapshot.json');
const SPACE =
  process.env.BILIBILI_SPACE_URL?.trim() || 'https://space.bilibili.com/1467634/video';
const MID = Number(process.env.BILIBILI_MID || '1467634');
const VIEW_SLEEP_MS = Number(process.env.BILIBILI_VIEW_SLEEP_MS || '110');
const COOKIES_BROWSER = process.env.BILIBILI_COOKIES_BROWSER?.trim();

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

function ytDlpBaseArgs(): string[] {
  const args: string[] = ['--no-warnings', '--ignore-errors', '--flat-playlist', '--playlist-end', '5000'];
  if (COOKIES_BROWSER) {
    args.push('--cookies-from-browser', COOKIES_BROWSER);
  }
  return args;
}

function fetchBvidList(): string[] {
  if (!resolveYtDlp()) {
    throw new Error('yt-dlp 未安装（pip install yt-dlp）');
  }
  const argv = [...ytDlpBaseArgs(), '--print', '%(id)s', SPACE];
  const { stdout, stderr, status } = execYtDlpLenient(argv, {
    encoding: 'utf8',
    maxBuffer: 50_000_000,
    timeout: 900_000,
  });
  if (status !== 0 && !stdout.trim()) {
    throw new Error(stderr.slice(0, 400) || 'yt-dlp无输出');
  }
  const set = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const id = line.trim();
    if (/^BV[\w]+$/i.test(id)) {
      const norm = id.startsWith('BV') ? id : `BV${id}`;
      set.add(norm);
    }
  }
  return [...set];
}

function viewApiTitle(bvid: string): string {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  try {
    const out = execFileSync(
      'curl',
      [
        '-sS',
        '--max-time',
        '15',
        url,
        '-H',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0',
        '-H',
        'Referer: https://www.bilibili.com/',
      ],
      { encoding: 'utf8', maxBuffer: 5_000_000 },
    );
    const j = JSON.parse(out) as { code?: number; data?: { title?: string } };
    if (j.code !== 0) return '';
    return String(j.data?.title || '').trim();
  } catch {
    return '';
  }
}

function main() {
  console.log('[export-bilibili-snapshot] space=', SPACE, COOKIES_BROWSER ? `cookies=${COOKIES_BROWSER}` : '(no browser cookies)');
  const bvids = fetchBvidList();
  console.log('[export-bilibili-snapshot] BV count=', bvids.length);

  const videos: { bvid: string; title: string; url: string; index: number }[] = [];
  let i = 0;
  for (const bvid of bvids) {
    const title = viewApiTitle(bvid) || '(title_fetch_failed)';
    videos.push({
      bvid,
      title,
      url: `https://www.bilibili.com/video/${bvid}/`,
      index: i++,
    });
    if (i % 50 === 0) {
      console.error(`[export-bilibili-snapshot] titles ${i}/${bvids.length}`);
    }
    sleepSync(VIEW_SLEEP_MS);
  }

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mid: MID,
        spaceUrl: SPACE,
        videoCount: videos.length,
        videos,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const failed = videos.filter(v => v.title === '(title_fetch_failed)').length;
  console.log(
    `[export-bilibili-snapshot] 写入 ${videos.length} 条 -> ${path.relative(projectRoot, OUT)} title_fail=${failed}`,
  );
}

try {
  main();
} catch (e) {
  console.error('[export-bilibili-snapshot] 失败:', (e as Error).message);
  console.error(
    '提示：若 yt-dlp 报 412，请在本机登录 B 站后执行：BILIBILI_COOKIES_BROWSER=chrome npx tsx scripts/export-bilibili-space-snapshot.ts',
  );
  process.exit(1);
}
