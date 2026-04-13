import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();

const loadExport = (filePath, exportName) => {
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/export type[\s\S]*?};\n\n/g, '')
    .replace(new RegExp(`export const\\s+${exportName}\\s*=\\s*`), `const ${exportName} = `)
    .replace(new RegExp(`export const\\s+${exportName}\\s*:\\s*[\\s\\S]*?=\\s*`), `const ${exportName} = `)
    .replace(/ as const;/g, ';')
    .concat(`\nglobalThis.__EXPORT__ = ${exportName};\n`);

  const context = { globalThis: {} };
  vm.runInNewContext(source, context, { filename: filePath });
  return context.globalThis.__EXPORT__;
};

const seeds = loadExport(path.join(ROOT, 'src/local-import-seeds.generated.ts'), 'LOCAL_IMPORT_SEEDS');
const cip = loadExport(path.join(ROOT, 'src/local-import-cip-links.generated.ts'), 'LOCAL_IMPORT_CIP_LINKS');
const official = loadExport(path.join(ROOT, 'src/local-import-official-metadata.generated.ts'), 'LOCAL_IMPORT_OFFICIAL_METADATA');

const rows = seeds.map((seed) => {
  const cipEntry = cip[seed.slug];
  const officialEntry = official[seed.slug];
  return {
    slug: seed.slug,
    titleOverride: seed.titleOverride,
    hasCip: Boolean(cipEntry),
    matchedVideoTitle: cipEntry?.matchedVideoTitle || '',
    hasOfficialArtist: Boolean(officialEntry?.artist),
    hasOfficialCover: Boolean(officialEntry?.cover),
    officialStatus: officialEntry?.officialStatus || 'none',
    confidenceReason: officialEntry?.confidenceReason || '',
    pendingStage: officialEntry?.pendingStage || '',
  };
});

const summary = {
  seedCount: rows.length,
  cipCount: rows.filter((row) => row.hasCip).length,
  missingCipCount: rows.filter((row) => !row.hasCip).length,
  missingCip: rows.filter((row) => !row.hasCip).map((row) => row.slug),
  cipNoOfficialArtist: rows
    .filter((row) => row.hasCip && !row.hasOfficialArtist)
    .map((row) => ({
      slug: row.slug,
      officialStatus: row.officialStatus,
      confidenceReason: row.confidenceReason,
      pendingStage: row.pendingStage,
      matchedVideoTitle: row.matchedVideoTitle,
    })),
  cipNoOfficialCover: rows
    .filter((row) => row.hasCip && !row.hasOfficialCover)
    .map((row) => ({
      slug: row.slug,
      officialStatus: row.officialStatus,
      confidenceReason: row.confidenceReason,
      pendingStage: row.pendingStage,
      matchedVideoTitle: row.matchedVideoTitle,
    })),
};

console.log(JSON.stringify(summary, null, 2));
