/**
 * 一次性 / 按需：从当前 legacy + TRACK_CANONICAL 生成 `catalog-overrides-locked.ts` 静态快照。
 * 日常纠错请直接编辑 `src/data/catalog-overrides-locked.ts`，勿依赖本脚本。
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACK_CANONICAL_BY_ID, type TrackCanonicalFix } from '../src/artist-canonical';
import { LOCAL_IMPORT_METADATA_OVERRIDES, type LocalImportMetadataOverride } from '../src/local-import-metadata-overrides';
import type { CatalogOverride } from '../src/data/catalog-override-types';

const __dirname = dirname(fileURLToPath(import.meta.url));

function legacyImportToCatalogOverride(ov: LocalImportMetadataOverride): CatalogOverride {
  return {
    title: ov.title,
    displayTitle: ov.displayTitle,
    titles: ov.titles,
    artist: ov.artist,
    artists: ov.artists,
    category: ov.category,
    categoryTags: ov.categoryTags,
    workProjectKey: ov.workProjectKey,
    coverUrl: ov.cover,
    links: ov.links,
    matchedVideoTitle: ov.matchedVideoTitle,
  };
}

function trackCanonicalToCatalogOverride(fix: TrackCanonicalFix): CatalogOverride {
  return {
    canonicalArtistId: fix.canonicalId,
    coCanonicalArtistIds: fix.coCanonicalArtistIds,
    canonicalArtistDisplayName: fix.displayNameOverride,
    artistReviewStatus: fix.artistReviewStatus,
  };
}

function tsString(s: string): string {
  return JSON.stringify(s);
}

function tsKey(k: string): string {
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k)) return k;
  return tsString(k);
}

function serializeValue(v: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return tsString(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[\n${v.map(x => `${padIn}${serializeValue(x, indent + 1)}`).join(',\n')}\n${pad}]`;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter(k => o[k] !== undefined);
    if (keys.length === 0) return '{}';
    return `{\n${keys
      .map(k => `${padIn}${tsKey(k)}: ${serializeValue(o[k], indent + 1)}`)
      .join(',\n')}\n${pad}}`;
  }
  return String(v);
}

function serializeRecord(title: string, rec: Record<string, CatalogOverride>): string {
  const keys = Object.keys(rec).sort((a, b) => a.localeCompare(b, 'en'));
  const lines = keys.map(k => `  ${tsKey(k)}: ${serializeValue(rec[k], 1)}`);
  return `export const ${title}: Record<string, CatalogOverride> = {\n${lines.join(',\n')},\n};\n`;
}

const bySlug = Object.fromEntries(
  Object.entries(LOCAL_IMPORT_METADATA_OVERRIDES).map(([slug, ov]) => [slug, legacyImportToCatalogOverride(ov)]),
) as Record<string, CatalogOverride>;

const byId = Object.fromEntries(
  Object.entries(TRACK_CANONICAL_BY_ID).map(([id, fix]) => [id, trackCanonicalToCatalogOverride(fix)]),
) as Record<string, CatalogOverride>;

const header = `/**
 * 人工锁定快照（静态、唯一来源）— 由仓库内已确认元数据固化，**不**在运行时从 legacy / TRACK_CANONICAL 派生。
 * 新纠错请只改本文件（或先跑 \`npx tsx scripts/generate-catalog-overrides-locked.ts\` 再手调）。
 *
 * 由 \`scripts/generate-catalog-overrides-locked.ts\` 生成；生成后请通过 \`npm run build\` 校验。
 */

import type { CatalogOverride } from './catalog-override-types';

`;

const body = `${serializeRecord('CATALOG_OVERRIDES_BY_SLUG', bySlug)}\n${serializeRecord('CATALOG_OVERRIDES_BY_TRACK_ID', byId)}`;

const outPath = join(__dirname, '../src/data/catalog-overrides-locked.ts');
writeFileSync(outPath, header + body, 'utf8');

console.log(
  `[generate-catalog-overrides-locked] wrote ${outPath} (slug=${Object.keys(bySlug).length}, trackId=${Object.keys(byId).length})`,
);
