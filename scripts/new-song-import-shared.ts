import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type NewSongImportSpec = {
  folder?: string;
  slug?: string;
  title: string;
  displayTitle?: string;
  artist: string;
  titles?: {
    zhHans?: string;
    zhHant?: string;
    en?: string;
  };
  artists?: {
    zhHans?: string;
    zhHant?: string;
    en?: string;
  };
  category?: string;
  categoryTags?: string[];
  spotifyUrl?: string;
  youtubeUrl?: string;
  bilibiliUrl?: string;
  sheetUrl?: string;
  coverUrl?: string;
  workProjectKey?: string;
  canonicalArtistId?: string;
  coCanonicalArtistIds?: string[];
  canonicalArtistDisplayName?: string;
  artistReviewStatus?: 'ok' | 'needsReview' | 'unknown';
  matchedVideoTitle?: string;
  noSheet?: boolean;
  noExternalVideo?: boolean;
};

export type NormalizedNewSongImport = NewSongImportSpec & {
  folder: string;
  slug: string;
  title: string;
  displayTitle: string;
  titles: NonNullable<NewSongImportSpec['titles']>;
  artists: NonNullable<NewSongImportSpec['artists']>;
  categoryTags: string[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, '..');
export const localImportsRoot = path.join(projectRoot, 'public', 'local-imports');
export const mobileHandoffDir = path.join(projectRoot, 'tmp', 'new-song-import');

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    metadataPath: '',
    dryRun: argv.includes('--dry-run') || !argv.includes('--apply'),
    apply: argv.includes('--apply'),
    skipSupabase: argv.includes('--skip-supabase'),
    skipManifest: argv.includes('--skip-manifest'),
    skipVerify: argv.includes('--skip-verify'),
    skipMobileArtifact: argv.includes('--skip-mobile-artifact'),
    overwriteAssets: argv.includes('--overwrite-assets'),
    allowDuplicateTitleArtist: argv.includes('--allow-duplicate-title-artist'),
    maxNewestRank: undefined as number | undefined,
  };

  for (let index = 0; index < argv.length; index++) {
    const current = argv[index];
    const next = argv[index + 1];
    if ((current === '--metadata' || current === '--file') && next) {
      options.metadataPath = next;
      index += 1;
    } else if (current.startsWith('--metadata=')) {
      options.metadataPath = current.slice('--metadata='.length);
    } else if (current === '--max-newest-rank' && next) {
      options.maxNewestRank = Number.parseInt(next, 10);
      index += 1;
    } else if (current.startsWith('--max-newest-rank=')) {
      options.maxNewestRank = Number.parseInt(current.slice('--max-newest-rank='.length), 10);
    }
  }

  if (!options.metadataPath) {
    options.metadataPath = path.join(projectRoot, 'imports', 'new-songs.json');
  }
  return options;
}

export function readJsonFile(filePath: string): unknown {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
  const raw = fs.readFileSync(absolute, 'utf8');
  return JSON.parse(raw);
}

export function loadImportSpecs(metadataPath: string): NormalizedNewSongImport[] {
  const raw = readJsonFile(metadataPath);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { imports?: unknown }).imports)
      ? (raw as { imports: unknown[] }).imports
      : [raw];

  const imports = list.map((item, index) => normalizeImportSpec(item as NewSongImportSpec, index));
  const seen = new Set<string>();
  for (const spec of imports) {
    if (seen.has(spec.slug)) throw new Error(`Duplicate slug in metadata: "${spec.slug}"`);
    seen.add(spec.slug);
  }
  return imports;
}

function normalizeImportSpec(spec: NewSongImportSpec, index: number): NormalizedNewSongImport {
  if (!spec || typeof spec !== 'object') throw new Error(`Import #${index + 1} is not an object.`);
  const title = clean(spec.title);
  const artist = clean(spec.artist);
  if (!title) throw new Error(`Import #${index + 1} is missing title.`);
  if (!artist) throw new Error(`Import #${index + 1} is missing artist.`);

  const folder = clean(spec.folder) || clean(spec.slug) || title;
  const slug = clean(spec.slug) || folder;
  const displayTitle = clean(spec.displayTitle) || title;
  const categoryTags = cleanArray(spec.categoryTags);
  const category = clean(spec.category) || categoryTags[0] || undefined;

  return {
    ...spec,
    folder,
    slug,
    title,
    displayTitle,
    artist,
    category,
    titles: {
      zhHans: clean(spec.titles?.zhHans) || title,
      zhHant: clean(spec.titles?.zhHant) || clean(spec.titles?.zhHans) || title,
      en: clean(spec.titles?.en) || title,
    },
    artists: {
      zhHans: clean(spec.artists?.zhHans) || artist,
      zhHant: clean(spec.artists?.zhHant) || clean(spec.artists?.zhHans) || artist,
      en: clean(spec.artists?.en) || artist,
    },
    categoryTags: categoryTags.length ? categoryTags : (category ? [category] : []),
    spotifyUrl: clean(spec.spotifyUrl) || undefined,
    youtubeUrl: clean(spec.youtubeUrl) || undefined,
    bilibiliUrl: clean(spec.bilibiliUrl) || undefined,
    sheetUrl: clean(spec.sheetUrl) || undefined,
    coverUrl: clean(spec.coverUrl) || undefined,
    workProjectKey: clean(spec.workProjectKey) || undefined,
    canonicalArtistId: clean(spec.canonicalArtistId) || undefined,
    coCanonicalArtistIds: cleanArray(spec.coCanonicalArtistIds),
    canonicalArtistDisplayName: clean(spec.canonicalArtistDisplayName) || undefined,
    matchedVideoTitle:
      clean(spec.matchedVideoTitle) ||
      `${artist} — ${displayTitle}（用户指定 YouTube / Bilibili / Sheet）`,
  };
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(item => clean(item)).filter(Boolean)
    : [];
}

export function localImportFolderPath(spec: NormalizedNewSongImport) {
  return path.join(localImportsRoot, spec.folder);
}

export function listLocalImportFiles(spec: NormalizedNewSongImport) {
  const dir = localImportFolderPath(spec);
  const file = (name: string) => path.join(dir, name);
  return {
    dir,
    audio: fs.existsSync(file('audio.mp3')) ? file('audio.mp3') : null,
    midi: fs.existsSync(file('performance.mid')) ? file('performance.mid') : null,
    musicxml: fs.existsSync(file('score.musicxml')) ? file('score.musicxml') : null,
  };
}

export function hasCompletePracticeFiles(spec: NormalizedNewSongImport) {
  const files = listLocalImportFiles(spec);
  return Boolean(files.audio && files.midi && files.musicxml);
}

export function validateImportFiles(specs: NormalizedNewSongImport[]) {
  const failures: string[] = [];
  for (const spec of specs) {
    const files = listLocalImportFiles(spec);
    if (!fs.existsSync(files.dir)) {
      failures.push(`Missing folder for "${spec.slug}": ${path.relative(projectRoot, files.dir)}`);
      continue;
    }
    if (!files.audio) failures.push(`Missing audio.mp3 for "${spec.slug}" in ${path.relative(projectRoot, files.dir)}`);
    if ((files.midi && !files.musicxml) || (!files.midi && files.musicxml)) {
      failures.push(`Practice files are incomplete for "${spec.slug}"; provide both performance.mid and score.musicxml or neither.`);
    }
  }
  return failures;
}

export function validateMetadata(specs: NormalizedNewSongImport[]) {
  const failures: string[] = [];
  const youtubeRe = /^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[\w-]{11}|youtu\.be\/[\w-]{11}|youtube\.com\/shorts\/[\w-]+)/i;
  const bilibiliRe = /^https:\/\/(?:www\.)?bilibili\.com\/video\/(?:BV[\w]+|av\d+)/i;
  const spotifyRe = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/[A-Za-z0-9]+/i;
  for (const spec of specs) {
    if (spec.youtubeUrl && !youtubeRe.test(spec.youtubeUrl)) failures.push(`Invalid youtubeUrl for "${spec.slug}": ${spec.youtubeUrl}`);
    if (spec.bilibiliUrl && !bilibiliRe.test(spec.bilibiliUrl)) failures.push(`Invalid bilibiliUrl for "${spec.slug}": ${spec.bilibiliUrl}`);
    if (spec.spotifyUrl && !spotifyRe.test(spec.spotifyUrl)) failures.push(`Invalid spotifyUrl for "${spec.slug}": ${spec.spotifyUrl}`);
  }
  return failures;
}

export function tsObjectLiteral(value: unknown, indent = 2): string {
  return JSON.stringify(value, null, indent)
    .replace(/"([^"]+)":/g, (_match, key: string) => {
      if (/^[A-Za-z_$][\w$]*$/.test(key)) return `${key}:`;
      return `${JSON.stringify(key)}:`;
    });
}

export function quoteObjectKey(key: string) {
  return JSON.stringify(key);
}
