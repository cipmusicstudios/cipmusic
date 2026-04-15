/**
 * Read-only export for pre-launch audits (needsReview + zh Bilibili gap).
 * Run: npx tsx scripts/export-link-audit-lists.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SongManifestEntry, SongsManifestCatalog } from '../src/songs-manifest.ts';
import { manifestEntryToTrack } from '../src/songs-manifest.ts';
import { getTrackYoutubeUrl, getTrackBilibiliUrl } from '../src/track-display.ts';
import { getVideoOverrideZhHansUrl } from '../src/video-overrides.ts';
import { LOCAL_IMPORT_CIP_LINKS } from '../src/local-import-cip-links.generated.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'public', 'songs-manifest.json');
const outNeedsReview = path.join(root, 'data', 'audit-link-needs-review.tsv');
const outZhGap = path.join(root, 'data', 'audit-zh-bilibili-override-gap.tsv');

type CipRow = {
  cipLinkConfidence?: string;
  cipLinkReviewReason?: string;
  matchedVideoTitle?: string;
  youtube?: string;
};

const CIP_BY_SLUG = LOCAL_IMPORT_CIP_LINKS as Record<string, CipRow | undefined>;

function loadEntries(): SongManifestEntry[] {
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SongsManifestCatalog;
  if (raw.kind !== 'catalog') throw new Error('Expected catalog manifest');
  const merged: SongManifestEntry[] = [];
  for (const c of raw.chunks) {
    const p = path.join(root, 'public', c.path.replace(/^\//, ''));
    const chunk = JSON.parse(fs.readFileSync(p, 'utf8')) as { tracks: SongManifestEntry[] };
    merged.push(...chunk.tracks);
  }
  return merged;
}

function tsvCell(s: string | undefined | null): string {
  const v = (s ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  return `"${v.replace(/"/g, '""')}"`;
}

function cipForSlug(slug: string | undefined): CipRow | undefined {
  if (!slug) return undefined;
  return CIP_BY_SLUG[slug];
}

function reviewHint(entry: SongManifestEntry): { reason: string; suggestion: string } {
  const cip = cipForSlug(entry.slug);
  const conf = cip?.cipLinkConfidence ?? '(manifest only)';
  const rr = cip?.cipLinkReviewReason ?? '';
  const reason = `CIP cipLinkConfidence=${conf}${rr ? `; ${rr}` : ''}`;
  let suggestion = '建议抽样看';
  if (conf === 'suspect' && /strict|failed|low_confidence/i.test(rr)) suggestion = '必须人工看';
  else if (conf === 'suspect') suggestion = '建议抽样看（suspect）';
  return { reason, suggestion };
}

function main() {
  const entries = loadEntries();
  const needs = entries.filter(e => e.linkStatus === 'needsReview').sort((a, b) => (a.slug || '').localeCompare(b.slug || ''));

  const linesNr = [
    ['slug', 'displayTitle', 'artist', 'youtubeUrl', 'bilibiliUrl', 'youtubeVideoTitle', 'whyNeedsReview', 'suggestion'].join('\t'),
  ];
  for (const e of needs) {
    const { reason, suggestion } = reviewHint(e);
    linesNr.push(
      [
        tsvCell(e.slug),
        tsvCell(e.displayTitle || e.title),
        tsvCell(e.originalArtist || e.canonicalArtistDisplayName),
        tsvCell(e.youtubeVideoUrl ?? ''),
        tsvCell(e.bilibiliVideoUrl ?? ''),
        tsvCell(e.youtubeVideoTitle ?? ''),
        tsvCell(reason),
        tsvCell(suggestion),
      ].join('\t'),
    );
  }
  fs.writeFileSync(outNeedsReview, linesNr.join('\n') + '\n', 'utf8');

  const linesZh: string[] = [
    [
      'slug',
      'displayTitle',
      'artist',
      'youtubeUrl',
      'manifestBilibili',
      'videoOverrideZhHansHit',
      'whyNoBiliInZh',
    ].join('\t'),
  ];

  for (const e of entries) {
    const tr = manifestEntryToTrack(e);
    const yt = getTrackYoutubeUrl(tr);
    if (!yt) continue;
    const directBili = getTrackBilibiliUrl(tr);
    const ov = getVideoOverrideZhHansUrl(tr);
    if (directBili || ov) continue;

    const why =
      'manifest 无 bilibiliVideoUrl；lookupVideoOverrideEntry（slugKeys 或 artist+title）未返回 B 站 URL。';
    linesZh.push(
      [
        tsvCell(e.slug),
        tsvCell(e.displayTitle || e.title),
        tsvCell(e.originalArtist || e.canonicalArtistDisplayName),
        tsvCell(yt),
        tsvCell(''),
        tsvCell('否'),
        tsvCell(why),
      ].join('\t'),
    );
  }

  fs.writeFileSync(outZhGap, linesZh.join('\n') + '\n', 'utf8');

  console.log(`Wrote ${path.relative(root, outNeedsReview)} (${needs.length} rows)`);
  console.log(`Wrote ${path.relative(root, outZhGap)} (${linesZh.length - 1} rows)`);
}

main();
