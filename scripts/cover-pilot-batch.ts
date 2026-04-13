/**
 * Pilot-only: merge curated cover patches into LOCAL_IMPORT_OFFICIAL_METADATA.
 * Does NOT run generate-local-import-official-metadata (no Apple/Spotify search, no category/artist recompute).
 *
 * After any pilot run you MUST regenerate the manifest or the site will still show old covers:
 *   npm run cover:pilot:sync     → pilot + build:manifest
 *   npm run cover:pilot:release  → pilot + build:manifest + vite build (then deploy dist)
 *
 * Usage:
 *   npm run cover:pilot
 *   npm run cover:pilot -- --config=config/cover-pilot-batch-2.json
 *   COVER_PILOT_CONFIG=config/cover-pilot-batch-2.json npm run cover:pilot
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { LOCAL_IMPORT_OFFICIAL_METADATA } from '../src/local-import-official-metadata.generated';
import { LOCAL_IMPORT_METADATA_OVERRIDES } from '../src/local-import-metadata-overrides';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'src/local-import-official-metadata.generated.ts');

function resolveConfigPath(): string {
  const eq = process.argv.find(a => a.startsWith('--config='));
  if (eq) return eq.slice('--config='.length);
  const idx = process.argv.indexOf('--config');
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const env = process.env.COVER_PILOT_CONFIG?.trim();
  if (env) return env;
  return 'config/cover-pilot-batch-1.json';
}

type PilotEntry = {
  slug: string;
  pilotCategory: string;
  cover: string;
  coverSource: string;
  coverLocked: boolean;
  coverUncertain: boolean;
  officialSource?: string;
  officialStatus?: string;
  reason: string;
  /** 文档用：git 未还原时仍可在报告里写「真正修前」封面 URL */
  reportPreviousCover?: string;
  reportPreviousOfficialSource?: string;
};

type ConfigFile = {
  version: number;
  batchLabel?: string;
  entries: PilotEntry[];
};

const extractAppleTrackId = (url: string | undefined): string | null => {
  if (!url) return null;
  const m = url.match(/\/song\/[^/]+\/(\d+)/i) || url.match(/[?&]i=(\d+)/i);
  return m?.[1] ?? null;
};

const extractSpotifyTrackId = (url: string | undefined): string | null => {
  if (!url) return null;
  const m =
    url.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([a-zA-Z0-9]+)/) ||
    url.match(/spotify:track:([a-zA-Z0-9]+)/);
  return m?.[1] ?? null;
};

function shouldSkipSlug(slug: string): string | null {
  const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug];
  const row = LOCAL_IMPORT_OFFICIAL_METADATA[slug] as { coverLocked?: boolean } | undefined;
  if (row?.coverLocked) return 'coverLocked（Apple/Spotify 官方图已锁定，批处理不覆盖）';
  if (ov?.cover?.trim()) return 'manual override 已设 cover';
  if (extractSpotifyTrackId(ov?.officialLinks?.spotify)) return '已锚定 officialLinks.spotify 曲目 ID';
  if (extractAppleTrackId(ov?.officialLinks?.appleMusic)) return '已锚定 officialLinks.appleMusic 曲目 ID';
  return null;
}

function main() {
  const configRel = resolveConfigPath();
  const CONFIG = path.resolve(ROOT, configRel);
  const reportBase = path.basename(CONFIG, '.json');
  const REPORT = path.join(ROOT, 'tmp', `${reportBase}-report.md`);

  if (!fs.existsSync(CONFIG)) {
    console.error('[cover-pilot] missing', CONFIG);
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) as ConfigFile;
  const prev = JSON.parse(JSON.stringify(LOCAL_IMPORT_OFFICIAL_METADATA)) as Record<string, Record<string, unknown>>;
  const next = JSON.parse(JSON.stringify(prev)) as Record<string, Record<string, unknown>>;

  const pilotSlugs = new Set(cfg.entries.map((e) => e.slug));
  const reportRows: string[] = [];

  for (const e of cfg.entries) {
    const skip = shouldSkipSlug(e.slug);
    if (skip) {
      console.warn(`[cover-pilot] SKIP ${e.slug}: ${skip}`);
      continue;
    }
    const row = next[e.slug];
    if (!row) {
      console.error(`[cover-pilot] unknown slug: ${e.slug}`);
      process.exit(1);
    }

    const before = JSON.parse(JSON.stringify(prev[e.slug])) as Record<string, unknown>;
    const beforeCover = e.reportPreviousCover ?? String(before.cover ?? '');

    row.cover = e.cover;
    row.coverSource = e.coverSource;
    row.coverLocked = e.coverLocked;
    row.coverUncertain = e.coverUncertain;
    if (e.officialSource !== undefined) row.officialSource = e.officialSource;
    if (e.officialStatus !== undefined) row.officialStatus = e.officialStatus;

    const title =
      (LOCAL_IMPORT_METADATA_OVERRIDES[e.slug]?.displayTitle ||
        LOCAL_IMPORT_METADATA_OVERRIDES[e.slug]?.title ||
        row.artist ||
        e.slug) as string;

    const beforeSrc =
      e.reportPreviousOfficialSource ??
      (before.coverSource as string | undefined) ??
      (before.officialSource as string | undefined) ??
      '（无）';
    reportRows.push(`
### ${e.slug}

| 字段 | 修前 | 修后 |
|------|------|------|
| 歌曲名（展示参考） | ${String(title)} | 同左（未改 metadata 标题字段） |
| slug | \`${e.slug}\` | 同左 |
| 原封面 | ${beforeCover ? `\`${beforeCover}\`` : '（无）'} | \`${e.cover}\` |
| coverSource（或 legacy officialSource） | \`${beforeSrc}\` | \`${e.coverSource}\` |
| coverLocked | ${String(before.coverLocked ?? '（无）')} | \`${e.coverLocked}\` |
| coverUncertain | ${String(before.coverUncertain ?? '（无）')} | \`${e.coverUncertain}\` |

**pilot 类型**: \`${e.pilotCategory}\`

**为何这样改**: ${e.reason}
`);

    console.log(`[cover-pilot] patched ${e.slug}`);
  }

  for (const slug of Object.keys(prev)) {
    if (pilotSlugs.has(slug)) continue;
    if (!isDeepStrictEqual(prev[slug], next[slug])) {
      console.error(`[cover-pilot] INVARIANT FAIL: non-pilot slug mutated: ${slug}`);
      process.exit(1);
    }
  }

  const header = `export const LOCAL_IMPORT_OFFICIAL_METADATA = ${JSON.stringify(next, null, 2)} as const;\n`;
  fs.writeFileSync(OUT, header, 'utf8');

  const batchTitle = cfg.batchLabel || reportBase;
  const reportBody = `# ${batchTitle} — 修前 / 修后对照

> 配置：\`${path.relative(ROOT, CONFIG)}\` · 生成自 \`npm run cover:pilot\` · 仅合并 pilot 行，非 pilot 行 deepEqual 校验通过。

${reportRows.join('\n')}
`;
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, reportBody, 'utf8');

  console.log('[cover-pilot] config', path.relative(ROOT, CONFIG));
  console.log('[cover-pilot] wrote', path.relative(ROOT, OUT));
  console.log('[cover-pilot] report', path.relative(ROOT, REPORT));
  console.log(
    '[cover-pilot] 下一步（必做）: 运行 `npm run build:manifest`，否则 `songs-manifest.json` 仍为旧封面、网站不会变。',
  );
  console.log('[cover-pilot] 推荐: `npm run cover:pilot:sync`；部署前再 `npm run build` 或 `npm run cover:pilot:release`。');
}

main();
