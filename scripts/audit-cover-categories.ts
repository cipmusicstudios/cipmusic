/**
 * 将当前 LOCAL_IMPORT_OFFICIAL_METADATA 按封面可信度分为 4 类（只读，不改写 cover）。
 * 输出：tmp/cover-categories.json + 控制台摘要。
 *
 * 新策略请以 `cover-stability-report.ts`（三分类：Apple 锁定 / Spotify 锁定 / 需人工）与
 * `generate-local-import-official-metadata.ts`（coverLocked 保留、Apple 优先于 Spotify 搜索）为准。
 *
 * 本审计保留旧启发式：
 * 1. 已确认正确：officialSource === spotify；或 appleMusic 且 overrides 含锚定曲目 id
 * 2. Apple 搜索命中可能不准：appleMusic 且无锚定
 * 3. manual：officialSource === manual
 * 4. 仍无 cover
 */
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_IMPORT_OFFICIAL_METADATA } from '../src/local-import-official-metadata.generated';
import { LOCAL_IMPORT_METADATA_OVERRIDES } from '../src/local-import-metadata-overrides';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'tmp/cover-categories.json');

const extractAppleMusicTrackId = (url: string | undefined): string | null => {
  if (!url) return null;
  const match = url.match(/\/song\/[^/]+\/(\d+)/i) || url.match(/[?&]i=(\d+)/i);
  return match?.[1] || null;
};

type Bucket = {
  slug: string;
  officialSource: string;
  officialUrl?: string;
};

const meta = LOCAL_IMPORT_OFFICIAL_METADATA as Record<
  string,
  { cover?: string; officialSource?: string; officialUrl?: string; officialStatus?: string }
>;

const confirmedCorrect: Bucket[] = [];
const appleSearchUncertain: Bucket[] = [];
const manualOverride: Bucket[] = [];
const noCover: { slug: string; officialSource?: string; officialStatus?: string }[] = [];
const otherWithCover: Bucket[] = [];

for (const slug of Object.keys(meta)) {
  const row = meta[slug];
  const cover = row.cover?.trim();
  const src = row.officialSource || '';

  if (!cover) {
    noCover.push({ slug, officialSource: src, officialStatus: row.officialStatus });
    continue;
  }

  if (src === 'manual') {
    manualOverride.push({ slug, officialSource: src, officialUrl: row.officialUrl });
    continue;
  }

  if (src === 'spotify') {
    confirmedCorrect.push({ slug, officialSource: src, officialUrl: row.officialUrl });
    continue;
  }

  if (src === 'appleMusic') {
    const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug];
    const overrideAnchored = extractAppleMusicTrackId(ov?.officialLinks?.appleMusic);
    if (overrideAnchored) {
      confirmedCorrect.push({ slug, officialSource: src, officialUrl: row.officialUrl });
    } else {
      appleSearchUncertain.push({ slug, officialSource: src, officialUrl: row.officialUrl });
    }
    continue;
  }

  otherWithCover.push({ slug, officialSource: src || '(unknown)', officialUrl: row.officialUrl });
}

const spotifyRefreshFirst = [
  ...appleSearchUncertain.map((b) => b.slug),
  ...noCover.map((b) => b.slug),
];

const report = {
  generatedAt: new Date().toISOString(),
  totals: {
    all: Object.keys(meta).length,
    confirmedCorrect: confirmedCorrect.length,
    appleSearchUncertain: appleSearchUncertain.length,
    manualOverride: manualOverride.length,
    noCover: noCover.length,
    otherWithCover: otherWithCover.length,
  },
  /** Spotify 恢复后建议优先重抓：第 2 类 + 第 4 类（去重后顺序：先 2 后 4） */
  spotifyRefreshPrioritySlugs: [...new Set(spotifyRefreshFirst)],
  buckets: {
    confirmedCorrect,
    appleSearchUncertain,
    manualOverride,
    noCover,
    otherWithCover,
  },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log('[audit-cover-categories] wrote', path.relative(ROOT, OUT));
console.log(JSON.stringify(report.totals, null, 2));
