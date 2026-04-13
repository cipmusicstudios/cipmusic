/**
 * Reads public/songs-manifest.json and writes public/missing-sheet-tracks.tsv
 * for all tracks with linkStatus === 'missingSheet'.
 *
 * Run after: npm run build:manifest
 * Executes curl per YouTube id to read shortDescription (slow).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'public', 'songs-manifest.json');
const outPath = path.join(root, 'public', 'missing-sheet-tracks.tsv');

function fetchShortDesc(videoId) {
  if (!videoId) return '';
  try {
    const html = execFileSync(
      'curl',
      ['-sL', '-A', 'Mozilla/5.0', `https://www.youtube.com/watch?v=${videoId}`],
      { encoding: 'utf8', maxBuffer: 22 * 1024 * 1024 },
    );
    const mm = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
    if (!mm) return '';
    return mm[1]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\u0026/g, '&');
  } catch {
    return '';
  }
}

function classifyReason(snippet, hasBiliOnly) {
  if (hasBiliOnly) {
    return '仅有Bilibili未配YouTube；管线未解析B站简介，可手动override links.sheet或后续加B站解析';
  }
  const s = snippet || '';
  if (/无谱听弹|无\s*谱\s*听弹|play\s*by\s*listening|I\s*play\s*by\s*listening/i.test(s)) {
    return 'YouTube简介明示听弹、无固定售卖谱链';
  }
  if (/♬\s*谱子[：:]\s*无|谱子[：:]\s*无谱|谱子\s*：\s*无/i.test(s)) {
    return 'YouTube简介「谱子」处标明无谱或听弹';
  }
  if (/仅?\s*总店|曲库总入口|other\s*piano\s*sheets?\s*:\s*http[^\n]*cipmusic[^\d]/i.test(s)) {
    return '简介仅有mymusicsheet/cipmusic总入口链接（无/cipmusic/数字）';
  }
  if (/mymusicsheet\.com\/cipmusic\s*(\n|$)/i.test(s)) {
    return '简介仅有mymusicsheet/cipmusic总入口链接（无/cipmusic/数字）';
  }
  if (/patreon\.com/i.test(s) && !/cipmusic\/\d+/.test(s)) {
    return '简介主要引导Patreon等，未出现mymusic单品数字链接';
  }
  return '简介与mymusic5目录均未得到可信数字谱链（或防误配匹配分未过阈值）';
}

function escapeCell(v) {
  const str = String(v);
  if (/[\t\n\r"]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const miss = m.tracks.filter((t) => t.linkStatus === 'missingSheet');

const rows = [
  [
    'slug',
    'display_title',
    'original_artist',
    'youtube_video_url',
    'youtube_video_id',
    'bilibili_video_url',
    'reason_zh',
    'short_description_excerpt',
  ],
];

for (const t of miss) {
  const vid = t.youtubeVideoId || '';
  const hasBiliOnly = !vid && t.bilibiliVideoUrl;
  const fullDesc = hasBiliOnly ? '' : fetchShortDesc(vid);
  const excerpt = fullDesc.replace(/\s+/g, ' ').slice(0, 280);
  rows.push([
    t.slug ?? '',
    t.displayTitle ?? t.title ?? '',
    t.originalArtist ?? '',
    t.youtubeVideoUrl ?? '',
    vid,
    t.bilibiliVideoUrl ?? '',
    classifyReason(fullDesc, Boolean(hasBiliOnly)),
    excerpt,
  ]);
}

const tsv = rows.map((r) => r.map(escapeCell).join('\t')).join('\n') + '\n';
fs.writeFileSync(outPath, tsv, 'utf8');
console.log(`Wrote ${path.relative(root, outPath)} (${miss.length} data rows + header)`);
