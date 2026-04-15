/**
 * Full-library integrity report: duration, link/cover/video consistency, CIP drift.
 * Run: npm run audit:library
 * (Run after npm run build:manifest for up-to-date durations.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SongManifestEntry, SongsManifest, SongsManifestCatalog, SongsManifestChunkFile } from '../src/songs-manifest.ts';
import { runAllManifestChecks, summarizeDuration } from '../src/library-integrity-rules.ts';
import { LOCAL_IMPORT_CIP_LINKS } from '../src/local-import-cip-links.generated.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(projectRoot, 'public', 'songs-manifest.json');
const reportPath = path.join(projectRoot, 'public', 'library-integrity-report.json');

function main() {
  if (!fs.existsSync(manifestPath)) {
    console.error('Missing public/songs-manifest.json — run npm run build:manifest first.');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SongsManifest | SongsManifestCatalog;
  let entries: SongManifestEntry[];
  if ('tracks' in raw && Array.isArray(raw.tracks)) {
    entries = raw.tracks;
  } else if ((raw as SongsManifestCatalog).kind === 'catalog') {
    const catalog = raw as SongsManifestCatalog;
    const merged: SongManifestEntry[] = [];
    for (const c of catalog.chunks) {
      const diskPath = path.join(projectRoot, 'public', c.path.replace(/^\//, ''));
      const chunkRaw = JSON.parse(fs.readFileSync(diskPath, 'utf8')) as SongsManifestChunkFile;
      merged.push(...chunkRaw.tracks);
    }
    entries = merged;
  } else {
    console.error('Unrecognized songs-manifest.json shape');
    process.exit(1);
    return;
  }

  const cipBySlug = LOCAL_IMPORT_CIP_LINKS as Record<string, { matchedVideoTitle?: string; youtube?: string; video?: string }>;

  const issues = runAllManifestChecks(entries, cipBySlug);
  const durationSummary = summarizeDuration(entries);

  const byCode: Record<string, number> = {};
  for (const i of issues) {
    byCode[i.code] = (byCode[i.code] || 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    manifestGeneratedAt: (raw as { generatedAt?: string }).generatedAt,
    trackCount: entries.length,
    durationSummary,
    issueCount: issues.length,
    issuesByCode: byCode,
    issues,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n=== Library integrity audit ===');
  console.log(`Tracks: ${entries.length}`);
  console.log(`Duration OK (non-00:00 label): ${durationSummary.ok}`);
  console.log(`Duration invalid label: ${durationSummary.badCount}`);
  console.log(`Entries with durationSeconds > 0: ${durationSummary.withSeconds}`);
  console.log(`Issues: ${issues.length}`);
  for (const [code, n] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${code}: ${n}`);
  }
  console.log(`\nWrote ${path.relative(projectRoot, reportPath)}`);

  const errors = issues.filter(i => i.severity === 'error');
  if (errors.length > 0) {
    console.warn(`\n${errors.length} error-level issue(s) — review report JSON.`);
  }
}

main();
