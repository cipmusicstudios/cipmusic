/**
 * 一次性迁移：为已有 Apple Music / Spotify 官方封面的条目补齐 coverSource，并设 coverLocked=true，
 * 避免后续 generate / pilot 批处理覆盖。
 *
 * 用法: npx tsx scripts/migrate-official-cover-locks.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_IMPORT_OFFICIAL_METADATA } from '../src/local-import-official-metadata.generated';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'src/local-import-official-metadata.generated.ts');

type Row = {
  cover?: string;
  officialSource?: string;
  coverSource?: string;
  coverLocked?: boolean;
  coverUncertain?: boolean;
  [k: string]: unknown;
};

const isStoreCoverUrl = (u: string | undefined): boolean => {
  if (!u?.trim()) return false;
  const x = u.toLowerCase();
  if (/i\.scdn\.co\/image/i.test(x)) return true;
  if (/mzstatic\.com\/image/i.test(x)) return true;
  return false;
};

function main() {
  const meta = JSON.parse(JSON.stringify(LOCAL_IMPORT_OFFICIAL_METADATA)) as Record<string, Row>;
  let lockedApple = 0;
  let lockedSpotify = 0;
  let skipped = 0;

  for (const slug of Object.keys(meta)) {
    const row = meta[slug];
    if (row.coverLocked === true) {
      skipped += 1;
      continue;
    }
    const src = row.officialSource || '';
    const cov = row.cover?.trim();
    if (!cov || !isStoreCoverUrl(cov)) continue;

    if (src === 'appleMusic') {
      row.coverLocked = true;
      if (!row.coverSource) row.coverSource = 'apple';
      lockedApple += 1;
    } else if (src === 'spotify') {
      row.coverLocked = true;
      if (!row.coverSource) row.coverSource = 'spotify';
      lockedSpotify += 1;
    }
  }

  const header = `export const LOCAL_IMPORT_OFFICIAL_METADATA = ${JSON.stringify(meta, null, 2)} as const;\n`;
  fs.writeFileSync(OUT, header, 'utf8');
  console.log('[migrate-official-cover-locks] wrote', path.relative(ROOT, OUT));
  console.log(
    JSON.stringify(
      { lockedApple, lockedSpotify, alreadyLockedSkipped: skipped, total: Object.keys(meta).length },
      null,
      2,
    ),
  );
}

main();
