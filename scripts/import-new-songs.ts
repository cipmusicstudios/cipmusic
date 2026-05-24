import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import {
  hasCompletePracticeFiles,
  loadImportSpecs,
  mobileHandoffDir,
  parseArgs,
  projectRoot,
  quoteObjectKey,
  tsObjectLiteral,
  validateImportFiles,
  validateMetadata,
  type NormalizedNewSongImport,
} from './new-song-import-shared.ts';

/**
 * Cover-from-Spotify rule (added 2026-05-24 after the TOP 5 import shipped
 * with a picsum placeholder despite a spotifyUrl being provided).
 *
 * When a spec has `spotifyUrl` and NO `coverUrl`, we fetch the track page's
 * `<meta property="og:image">` and treat that as the cover. Spotify serves
 * it from `i.scdn.co` / `image-cdn-*.spotifycdn.com`, which is the same
 * external-CDN pattern most existing K-pop / Western rows already use.
 *
 * If a spotifyUrl is present but the fetch fails (or returns no usable
 * Spotify CDN image), we STOP THE IMPORT with a clear error. Silent picsum
 * fallback is no longer allowed in this pipeline path.
 *
 * Opt-out: `--allow-cover-placeholder` keeps the old behavior for the rare
 * case where the user has explicitly accepted a placeholder.
 */
const SPOTIFY_COVER_HOSTNAMES = new Set([
  'i.scdn.co',
  'image-cdn-ak.spotifycdn.com',
  'image-cdn-fa.spotifycdn.com',
  'mosaic.scdn.co',
]);

async function resolveSpotifyCover(spotifyUrl: string): Promise<string | null> {
  try {
    // Spotify's track page returns very different HTML based on User-Agent.
    // A simple "Mozilla/5.0" yields the SEO/preview HTML which includes the
    // og:image meta tag. A full Safari UA hits a different SPA shell that
    // omits og:image and requires JS to populate the cover — useless here.
    const res = await fetch(spotifyUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    );
    if (!match) return null;
    const candidate = match[1].trim();
    try {
      const u = new URL(candidate);
      if (!SPOTIFY_COVER_HOSTNAMES.has(u.hostname)) return null;
    } catch {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

async function applyCoverFromSpotify(
  specs: NormalizedNewSongImport[],
  allowPlaceholder: boolean,
): Promise<void> {
  const failures: string[] = [];
  for (const spec of specs) {
    if (spec.coverUrl) continue;
    if (!spec.spotifyUrl) continue;
    const resolved = await resolveSpotifyCover(spec.spotifyUrl);
    if (resolved) {
      spec.coverUrl = resolved;
      console.log(
        `[import-new-songs] cover resolved from Spotify for "${spec.slug}": ${resolved}`,
      );
      continue;
    }
    const msg =
      `Could not resolve a Spotify cover for "${spec.slug}" from ${spec.spotifyUrl}. ` +
      `Pass --allow-cover-placeholder to accept the picsum fallback explicitly.`;
    if (allowPlaceholder) {
      console.warn(`[import-new-songs] WARNING: ${msg}`);
    } else {
      failures.push(msg);
    }
  }
  if (failures.length > 0) {
    throw new Error('Spotify cover resolution failed:\n- ' + failures.join('\n- '));
  }
}

const localOverridesPath = path.join(projectRoot, 'src', 'local-import-metadata-overrides.ts');
const catalogOverridesPath = path.join(projectRoot, 'src', 'data', 'catalog-overrides-locked.ts');

function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${[command, ...args].join(' ')}`);
  }
}

function entryValueStart(source: string, lineStart: number) {
  const colon = source.indexOf(':', lineStart);
  if (colon < 0) return -1;
  return source.indexOf('{', colon);
}

function findMatchingBrace(source: string, openIndex: number) {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openIndex; index < source.length; index++) {
    const ch = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findEntryRange(source: string, recordStart: number, recordEnd: number, key: string) {
  const lines = source.slice(recordStart, recordEnd).split(/\n/);
  let offset = recordStart;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (
      trimmed.startsWith(`${quoteObjectKey(key)}: {`) ||
      trimmed.startsWith(`'${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}': {`) ||
      trimmed.startsWith(`${key}: {`)
    ) {
      const open = entryValueStart(source, offset);
      const close = open >= 0 ? findMatchingBrace(source, open) : -1;
      if (close < 0) throw new Error(`Could not parse existing object entry for "${key}".`);
      let end = close + 1;
      while (source[end] === ' ' || source[end] === '\t') end += 1;
      if (source[end] === ',') end += 1;
      if (source[end] === '\r') end += 1;
      if (source[end] === '\n') end += 1;
      return { start: offset, end };
    }
    offset += line.length + 1;
  }
  return null;
}

function upsertRecordEntry(params: {
  filePath: string;
  recordName: string;
  beforeText?: string;
  key: string;
  value: Record<string, unknown>;
  dryRun: boolean;
}) {
  const { filePath, recordName, beforeText, key, value, dryRun } = params;
  const source = fs.readFileSync(filePath, 'utf8');
  const recordMarker = `export const ${recordName}`;
  const recordStart = source.indexOf(recordMarker);
  if (recordStart < 0) throw new Error(`Could not find ${recordName} in ${path.relative(projectRoot, filePath)}`);
  const objectOpen = source.indexOf('{', source.indexOf('=', recordStart));
  const recordEnd = beforeText
    ? source.indexOf(beforeText, objectOpen)
    : source.lastIndexOf('\n};');
  if (objectOpen < 0 || recordEnd < 0) throw new Error(`Could not locate object body for ${recordName}.`);

  const entry = `  ${quoteObjectKey(key)}: ${tsObjectLiteral(value, 2).replace(/\n/g, '\n  ')},\n`;
  const existing = findEntryRange(source, objectOpen + 1, recordEnd, key);
  const next = existing
    ? source.slice(0, existing.start) + entry + source.slice(existing.end)
    : source.slice(0, recordEnd) + entry + source.slice(recordEnd);

  if (dryRun) {
    console.log(`[dry-run] would ${existing ? 'replace' : 'append'} ${recordName}[${JSON.stringify(key)}]`);
    return;
  }
  fs.writeFileSync(filePath, next, 'utf8');
  console.log(`[import-new-songs] ${existing ? 'replaced' : 'appended'} ${recordName}[${JSON.stringify(key)}]`);
}

function toLocalImportOverride(spec: NormalizedNewSongImport) {
  const links: Record<string, unknown> = {};
  if (spec.youtubeUrl) {
    links.youtube = spec.youtubeUrl;
    links.video = spec.youtubeUrl;
  }
  if (spec.bilibiliUrl) links.bilibili = spec.bilibiliUrl;
  if (spec.sheetUrl) links.sheet = spec.sheetUrl;
  if (spec.noSheet) links.noSheet = true;
  if (spec.noExternalVideo) links.noExternalVideo = true;

  const out: Record<string, unknown> = {
    title: spec.title,
    displayTitle: spec.displayTitle,
    titles: spec.titles,
    artist: spec.artist,
    artists: spec.artists,
  };
  if (spec.category) out.category = spec.category;
  if (spec.categoryTags.length > 0) out.categoryTags = spec.categoryTags;
  if (spec.workProjectKey) out.workProjectKey = spec.workProjectKey;
  if (spec.coverUrl) out.cover = spec.coverUrl;
  if (spec.spotifyUrl) out.officialLinks = { spotify: spec.spotifyUrl };
  if (Object.keys(links).length > 0) out.links = links;
  if (spec.matchedVideoTitle) out.matchedVideoTitle = spec.matchedVideoTitle;
  return out;
}

function toCatalogOverride(spec: NormalizedNewSongImport) {
  const links: Record<string, unknown> = {};
  if (spec.youtubeUrl) {
    links.youtube = spec.youtubeUrl;
    links.video = spec.youtubeUrl;
  }
  if (spec.bilibiliUrl) links.bilibili = spec.bilibiliUrl;
  if (spec.sheetUrl) links.sheet = spec.sheetUrl;
  if (spec.noSheet) links.noSheet = true;
  if (spec.noExternalVideo) links.noExternalVideo = true;

  const out: Record<string, unknown> = {
    title: spec.title,
    displayTitle: spec.displayTitle,
    titles: spec.titles,
    artist: spec.artist,
    artists: spec.artists,
  };
  if (spec.category) out.category = spec.category;
  if (spec.categoryTags.length > 0) out.categoryTags = spec.categoryTags;
  if (Object.keys(links).length > 0) out.links = links;
  if (spec.workProjectKey) out.workProjectKey = spec.workProjectKey;
  if (spec.coverUrl) out.coverUrl = spec.coverUrl;
  if (spec.canonicalArtistId) out.canonicalArtistId = spec.canonicalArtistId;
  if (spec.coCanonicalArtistIds.length > 0) out.coCanonicalArtistIds = spec.coCanonicalArtistIds;
  if (spec.canonicalArtistDisplayName) out.canonicalArtistDisplayName = spec.canonicalArtistDisplayName;
  if (spec.artistReviewStatus) out.artistReviewStatus = spec.artistReviewStatus;
  if (spec.matchedVideoTitle) out.matchedVideoTitle = spec.matchedVideoTitle;
  return out;
}

function writeMetadataOverrides(specs: NormalizedNewSongImport[], dryRun: boolean) {
  for (const spec of specs) {
    upsertRecordEntry({
      filePath: localOverridesPath,
      recordName: 'LOCAL_IMPORT_METADATA_OVERRIDES',
      key: spec.slug,
      value: toLocalImportOverride(spec),
      dryRun,
    });
    upsertRecordEntry({
      filePath: catalogOverridesPath,
      recordName: 'CATALOG_OVERRIDES_BY_SLUG',
      beforeText: '\n};\n\nexport const CATALOG_OVERRIDES_BY_TRACK_ID',
      key: spec.slug,
      value: toCatalogOverride(spec),
      dryRun,
    });
  }
}

function writeMobileArtifact(specs: NormalizedNewSongImport[], metadataPath: string, dryRun: boolean) {
  const artifact = {
    generatedAt: new Date().toISOString(),
    sourceMetadata: path.relative(projectRoot, path.isAbsolute(metadataPath) ? metadataPath : path.join(projectRoot, metadataPath)),
    note:
      'Mobile rules intentionally differ from web: mainland China build/storefront should use bilibili/default zh-Hans; international builds should use YouTube regardless of selected UI language.',
    commands: {
      webImport: `npm run import:songs -- --metadata ${metadataPath} --apply`,
      webVerify: `npm run verify:new-song-import -- --metadata ${metadataPath}`,
      mobileNext:
        'Use this artifact to refresh the mobile overlay from the web manifest. Keep mobile provider selection storefront/build-based, not UI-language-based.',
    },
    songs: specs.map(spec => ({
      slug: spec.slug,
      folder: spec.folder,
      title: spec.title,
      displayTitle: spec.displayTitle,
      artist: spec.artist,
      titles: spec.titles,
      artists: spec.artists,
      category: spec.category ?? null,
      categoryTags: spec.categoryTags,
      spotifyUrl: spec.spotifyUrl ?? null,
      youtubeUrl: spec.youtubeUrl ?? null,
      bilibiliUrl: spec.bilibiliUrl ?? null,
      sheetUrl: spec.sheetUrl ?? null,
      hasPracticeMode: hasCompletePracticeFiles(spec),
      mobileVideoProvider: {
        mainlandChina: spec.bilibiliUrl ? 'bilibili' : 'youtube',
        international: 'youtube',
      },
    })),
  };
  const outPath = path.join(mobileHandoffDir, 'mobile-overlay-handoff.json');
  if (dryRun) {
    console.log(`[dry-run] would write ${path.relative(projectRoot, outPath)}`);
    return outPath;
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2), 'utf8');
  console.log(`[import-new-songs] wrote ${path.relative(projectRoot, outPath)}`);
  return outPath;
}

function printPlan(specs: NormalizedNewSongImport[]) {
  console.log('\n=== New Song Import Plan ===');
  console.table(
    specs.map(spec => ({
      slug: spec.slug,
      folder: spec.folder,
      title: spec.title,
      artist: spec.artist,
      practice: hasCompletePracticeFiles(spec),
      youtube: Boolean(spec.youtubeUrl),
      bilibili: Boolean(spec.bilibiliUrl),
      spotify: Boolean(spec.spotifyUrl),
    })),
  );
}

async function checkSupabaseDuplicates(specs: NormalizedNewSongImport[], allowDuplicateTitleArtist: boolean) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !key) {
    console.warn('[import-new-songs] Supabase duplicate preflight skipped: missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    return;
  }
  const supabase = createClient(supabaseUrl, key, { auth: { persistSession: false } });
  const failures: string[] = [];
  for (const spec of specs) {
    const bySlug = await supabase.from('songs').select('id,slug,title,artist').eq('slug', spec.slug);
    if (bySlug.error) throw bySlug.error;
    if ((bySlug.data ?? []).length > 1) {
      failures.push(`Supabase has multiple existing rows for slug "${spec.slug}".`);
    }

    if (!allowDuplicateTitleArtist) {
      const byTitleArtist = await supabase
        .from('songs')
        .select('id,slug,title,artist')
        .ilike('title', spec.title)
        .ilike('artist', spec.artist);
      if (byTitleArtist.error) throw byTitleArtist.error;
      const conflicts = (byTitleArtist.data ?? []).filter(row => row.slug !== spec.slug);
      if (conflicts.length > 0) {
        failures.push(
          `"${spec.slug}" would duplicate title+artist with existing row(s): ` +
            conflicts.map(row => `${row.slug || row.id} (${row.title} / ${row.artist})`).join(', ') +
            '. Use --allow-duplicate-title-artist only when this is intentional.',
        );
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`Supabase duplicate preflight failed:\n- ${failures.join('\n- ')}`);
  }
}

async function main() {
  const options = parseArgs();
  const specs = loadImportSpecs(options.metadataPath);
  const failures = [
    ...validateMetadata(specs),
    ...validateImportFiles(specs),
  ];
  if (failures.length > 0) {
    console.error('Import validation failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  printPlan(specs);
  // Fail-loud cover resolution: when spotifyUrl is provided but no coverUrl
  // is, fetch og:image from Spotify and use it. Refuses to fall through to
  // the picsum placeholder unless --allow-cover-placeholder is set.
  await applyCoverFromSpotify(specs, process.argv.includes('--allow-cover-placeholder'));
  await checkSupabaseDuplicates(specs, options.allowDuplicateTitleArtist);
  writeMetadataOverrides(specs, options.dryRun);
  const mobileArtifactPath = options.skipMobileArtifact
    ? ''
    : writeMobileArtifact(specs, options.metadataPath, options.dryRun);

  if (options.dryRun) {
    console.log('\nDry run complete. Re-run with --apply to update metadata, upload/write Supabase, rebuild manifests, and verify.');
    return;
  }

  run('npm', ['run', 'generate:local-imports']);

  const slugs = specs.map(spec => spec.slug).join(',');
  if (!options.skipSupabase) {
    const args = ['scripts/migrate-local-songs-to-supabase.ts', '--apply', '--only-slugs', slugs];
    if (options.overwriteAssets) args.push('--overwrite-assets');
    run('npx', ['tsx', ...args], options.overwriteAssets ? { IMPORT_ASSET_OVERWRITE: '1' } : {});
  }

  if (!options.skipManifest) {
    run('npm', ['run', 'build:manifest']);
  }

  if (!options.skipVerify) {
    const verifyArgs = ['run', 'verify:new-song-import', '--', '--metadata', options.metadataPath];
    if (options.maxNewestRank) verifyArgs.push('--max-newest-rank', String(options.maxNewestRank));
    run('npm', verifyArgs);
    const practiceSlugs = specs.filter(hasCompletePracticeFiles).map(spec => spec.slug);
    if (practiceSlugs.length > 0 && !options.skipSupabase) {
      run('npm', ['run', 'verify:practice-assets-import', '--', '--only-slugs', practiceSlugs.join(',')]);
    }
  }

  console.log('\n=== Acceptance Report ===');
  console.log(`Imported slug(s): ${slugs}`);
  console.log('Newest sort fields: written by migration for new Supabase rows and verified post-build.');
  console.log('Practice assets: complete local sets are enabled; MIDI/MusicXML remain brokered and are not emitted in public manifests.');
  console.log('Web video behavior: English -> YouTube; zh-Hans/zh-Hant -> Bilibili when provided, otherwise YouTube.');
  if (mobileArtifactPath) console.log(`Mobile handoff artifact: ${path.relative(projectRoot, mobileArtifactPath)}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
