/**
 * Merge `LOCAL_IMPORT_METADATA_OVERRIDES` video links into `local-import-cip-links.generated.ts`
 * without hitting YouTube (complements `generate:cip-links` for user-confirmed rows).
 *
 * Run: node scripts/sync-cip-links-from-overrides.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const OVERRIDES_FILE = path.join(ROOT, 'src/local-import-metadata-overrides.ts');
const CIP_FILE = path.join(ROOT, 'src/local-import-cip-links.generated.ts');

const evaluateExportedConst = (filePath, exportName) => {
  let source = readFileSync(filePath, 'utf8');
  source = source
    .replace(/export type[\s\S]*?};\n\n/g, '')
    .replace(new RegExp(`export const\\s+${exportName}\\s*=\\s*`), `const ${exportName} = `)
    .replace(new RegExp(`export const\\s+${exportName}\\s*:\\s*[\\s\\S]*?=\\s*`), `const ${exportName} = `)
    .replace(/\sas const;/g, ';')
    .concat(`\nglobalThis.__EXPORT__ = ${exportName};\n`);
  const context = { globalThis: {} };
  vm.runInNewContext(source, context, { filename: filePath });
  return context.globalThis.__EXPORT__;
};

const OVERRIDES = evaluateExportedConst(OVERRIDES_FILE, 'LOCAL_IMPORT_METADATA_OVERRIDES');
let cip = evaluateExportedConst(CIP_FILE, 'LOCAL_IMPORT_CIP_LINKS');

const extractWatchId = (u) => {
  const s = typeof u === 'string' ? u : '';
  const m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/) || s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return m?.[1] || null;
};

/** Slugs that have manual video/sheet in overrides and should sync into CIP. */
const SYNC_SLUGS = [
  'super shy',
  'super',
  '一杯火焰',
  'INTO1',
  '云宫迅音',
  'celestial',
  '向阳而生日出版',
  '向阳而生',
  '在故事的最终',
  '哪吒',
  '我会等',
  '当我奔向你',
  '时空引力',
  '恋与深空主题曲',
  '泪桥',
  '悟',
  '爱丫爱丫',
  'Y',
  '相遇的意义',
  '相遇',
  '芥',
  '听悲伤的情歌',
  '念思雨',
  '念',
  '我们啊',
  '我们',
  '无双的王者',
  'see the light',
  '青山城下白素贞',
  '我的舞台',
  '就是哪吒',
  'normal no more',
  '无人乐园',
  '明天见',
  '爱琴海',
  '恋人',
  '摆脱地心引力',
];

for (const slug of SYNC_SLUGS) {
  const o = OVERRIDES[slug];
  if (!o?.links) continue;

  const yt = o.links.youtube || o.links.video;
  const bilibili = o.links.bilibili;

  if (bilibili && !yt) {
    const prev = cip[slug] || {};
    const next = { ...prev };
    delete next.youtube;
    delete next.video;
    delete next.cipLinkReviewReason;
    if (o.links.sheet) next.sheet = o.links.sheet;
    if (o.matchedVideoTitle) next.matchedVideoTitle = o.matchedVideoTitle;
    next.cipLinkConfidence = 'high';
    next.cipRefineNote = 'sync_from_override_bilibili_only';
    cip[slug] = next;
    continue;
  }

  if (!yt) continue;

  const prev = cip[slug] || {};
  const next = {
    ...prev,
    youtube: yt,
    video: o.links.video || o.links.youtube,
    cipLinkConfidence: 'high',
    cipRefineNote: 'sync_from_override',
  };
  delete next.cipLinkReviewReason;
  if (o.links.sheet) next.sheet = o.links.sheet;
  if (o.matchedVideoTitle) next.matchedVideoTitle = o.matchedVideoTitle;
  if (o.title || o.displayTitle) next.matchTitle = o.displayTitle || o.title || prev.matchTitle || slug;

  cip[slug] = next;
}

const idToSlug = new Map();
for (const [slug, row] of Object.entries(cip)) {
  const id = extractWatchId(row);
  if (!id) continue;
  if (!idToSlug.has(id)) idToSlug.set(id, []);
  idToSlug.get(id).push(slug);
}
const dupIds = [...idToSlug.entries()].filter(([, slugs]) => slugs.length > 1);
if (dupIds.length) {
  console.warn('[sync-cip] Duplicate videoIds after merge (review manually):');
  for (const [id, slugs] of dupIds) {
    console.warn(`  ${id}: ${slugs.join(', ')}`);
  }
}

writeFileSync(
  CIP_FILE,
  `export const LOCAL_IMPORT_CIP_LINKS = ${JSON.stringify(cip, null, 2)} as const;\n`,
);
console.log(`[sync-cip] Wrote ${CIP_FILE} (${Object.keys(cip).length} keys).`);
