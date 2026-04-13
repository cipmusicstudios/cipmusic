/**
 * 按「Apple / Spotify 官方图 + 锁定」策略输出三类清单（只读 metadata，不写回）。
 * 输出：tmp/cover-stability-report.md
 *
 * 规则（与 generate / migrate 一致）：
 * - 已用 Apple 官方图并锁定：coverLocked && (coverSource===apple 或 officialSource===appleMusic)
 * - 已用 Spotify 官方图并锁定：coverLocked && (coverSource===spotify 或 officialSource===spotify)
 * - 仍需人工：无可靠商店封面，或非 Apple/Spotify 来源（manual / project_art / video / pending 等）
 */
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_IMPORT_OFFICIAL_METADATA } from '../src/local-import-official-metadata.generated';
import { LOCAL_IMPORT_METADATA_OVERRIDES } from '../src/local-import-metadata-overrides';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'tmp/cover-stability-report.md');

type Row = {
  cover?: string;
  officialSource?: string;
  coverSource?: string;
  coverLocked?: boolean;
  coverUncertain?: boolean;
  officialStatus?: string;
  artist?: string;
};

const isMzOrSpotify = (u: string | undefined) => {
  if (!u?.trim()) return false;
  const x = u.toLowerCase();
  return /mzstatic\.com\/image|i\.scdn\.co\/image/.test(x);
};

function main() {
  const meta = LOCAL_IMPORT_OFFICIAL_METADATA as Record<string, Row>;

  const appleLocked: { slug: string; note?: string }[] = [];
  const spotifyLocked: { slug: string; note?: string }[] = [];
  const needsManual: { slug: string; why: string }[] = [];

  for (const slug of Object.keys(meta).sort()) {
    const row = meta[slug];
    const cov = row.cover?.trim();
    const src = row.officialSource || '';
    const cs = row.coverSource || '';
    const locked = row.coverLocked === true;

    const isAppleRow =
      locked && (cs === 'apple' || cs === 'appleMusic' || src === 'appleMusic');
    const isSpotifyRow = locked && (cs === 'spotify' || src === 'spotify');

    if (isAppleRow) {
      appleLocked.push({ slug, note: row.coverUncertain ? 'coverUncertain' : undefined });
      continue;
    }
    if (isSpotifyRow) {
      spotifyLocked.push({ slug, note: row.coverUncertain ? 'coverUncertain' : undefined });
      continue;
    }

    // 未纳入「锁定官方」的条目：需人工或后续处理
    let why: string;
    if (!cov) {
      why = '无封面';
    } else if (locked && !isAppleRow && !isSpotifyRow) {
      why = `已锁定但非 Apple/Spotify 商店源（officialSource=${src}, coverSource=${cs || '—'}）`;
    } else if (!locked && (src === 'appleMusic' || src === 'spotify') && isMzOrSpotify(cov)) {
      why = `有 ${src} 图但未锁定（应运行 migrate-official-cover-locks 或 regenerate）`;
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

  const lines: string[] = [
    `# 封面稳定性报告`,
    ``,
    `生成时间：${new Date().toISOString()}`,
    ``,
    `## 统计`,
    ``,
    `- 已用 Apple 官方图并锁定：${appleLocked.length}`,
    `- 已用 Spotify 官方图并锁定：${spotifyLocked.length}`,
    `- Apple 与 Spotify 均未形成「锁定官方」或需人工：${needsManual.length}`,
    ``,
    `## 1. 已用 Apple 官方图并锁定`,
    ``,
    ...appleLocked.map(({ slug, note }) => `- \`${slug}\`${note ? ` — ${note}` : ''}`),
    ``,
    `## 2. 已用 Spotify 官方图并锁定`,
    ``,
    ...spotifyLocked.map(({ slug, note }) => `- \`${slug}\`${note ? ` — ${note}` : ''}`),
    ``,
    `## 3. Apple / Spotify 官方未锁定或需人工处理`,
    ``,
    ...needsManual.map(({ slug, why }) => `- \`${slug}\` — ${why}`),
    ``,
  ];

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log('[cover-stability-report] wrote', path.relative(ROOT, OUT));
}

main();
