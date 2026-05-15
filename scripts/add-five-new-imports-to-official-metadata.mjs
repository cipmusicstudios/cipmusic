/**
 * One-off: append the 5 newly-imported slugs from commit df96529 to
 * `src/local-import-official-metadata.generated.ts` with their resolved
 * Spotify album covers. Keeps the "covers cache" convention in sync so that:
 *
 *   - `MANIFEST_SOURCE=local` builds no longer fall back to picsum.photos
 *   - Any future `scripts/migrate-local-songs-to-supabase` re-run pushes
 *     the locked Spotify cover into `songs.cover_url`
 *
 * Idempotent — re-running is safe (rewrites the entries in-place).
 *
 * Usage:
 *   node scripts/add-five-new-imports-to-official-metadata.mjs
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const filePath = path.join(projectRoot, 'src/local-import-official-metadata.generated.ts');

/** Mirror the structure used elsewhere in this file (e.g. for "calling" / "snake"). */
const FIVE = {
  '一个人想着一个人': {
    cover: 'https://i.scdn.co/image/ab67616d0000b2732bc290220b16df50c6324586',
    artist: '曾沛慈',
    normalizedArtistsInfo: [
      {
        id: 'tseng-pei-ci',
        names: { zhHans: '曾沛慈', zhHant: '曾沛慈', en: 'Pets Tseng' },
        type: 'solo',
        nationality: 'zh',
      },
    ],
    rawCategory: 'Mandopop',
    mappedCategory: '华语流行',
    mappedTags: ['影视'],
    officialUrl: 'https://open.spotify.com/track/3n3zzFH7zzO0gJNaw4RKSm',
  },
  'beauty and a beat': {
    cover: 'https://i.scdn.co/image/ab67616d0000b2736c20c4638a558132ba95bc39',
    artist: 'Justin Bieber',
    normalizedArtistsInfo: [
      {
        id: 'justin-bieber',
        names: { zhHans: 'Justin Bieber', zhHant: 'Justin Bieber', en: 'Justin Bieber' },
        type: 'solo',
        nationality: 'en',
      },
    ],
    rawCategory: 'Pop',
    mappedCategory: '欧美流行',
    mappedTags: [],
    officialUrl: 'https://open.spotify.com/track/190jyVPHYjAqEaOGmMzdyk',
  },
  "it's me": {
    cover: 'https://i.scdn.co/image/ab67616d0000b27361eea484e31bca065904f1c6',
    artist: 'ILLIT',
    normalizedArtistsInfo: [
      {
        id: 'illit',
        names: { zhHans: 'ILLIT', zhHant: 'ILLIT', en: 'ILLIT' },
        type: 'group',
        nationality: 'kr',
      },
    ],
    rawCategory: 'K-Pop',
    mappedCategory: '韩流流行',
    mappedTags: [],
    officialUrl: 'https://open.spotify.com/track/1D5L58KLBbceOynTP4DQnY',
  },
  'BonBon Girls': {
    cover: 'https://i.scdn.co/image/ab67616d0000b273db534ad23f06f0bf4c6f776e',
    artist: '浪姐版',
    normalizedArtistsInfo: [
      {
        id: 'bonbon-girls-303',
        names: { zhHans: '浪姐版', zhHant: '浪姐版', en: 'Sisters version' },
        type: 'group',
        nationality: 'zh',
      },
    ],
    rawCategory: 'Mandopop',
    mappedCategory: '华语流行',
    mappedTags: [],
    officialUrl: 'https://open.spotify.com/track/18WYdHm0rtDiidy0IK0GQM',
  },
  'someone to love': {
    cover: 'https://i.scdn.co/image/ab67616d0000b2736997d19c29d410f08fe02f86',
    artist: '严浩翔',
    normalizedArtistsInfo: [
      {
        id: 'yan-hao-xiang',
        names: { zhHans: '严浩翔', zhHant: '嚴浩翔', en: 'Yan Haoxiang' },
        type: 'solo',
        nationality: 'zh',
      },
    ],
    rawCategory: 'Mandopop',
    mappedCategory: '华语流行',
    mappedTags: [],
    officialUrl: 'https://open.spotify.com/track/4UG43GqZxyhsOh3F3oGIGA',
  },
};

/** Load existing module via dynamic import so we can re-serialize the full object. */
const mod = await import(filePath);
const existing = mod.LOCAL_IMPORT_OFFICIAL_METADATA;
const next = JSON.parse(JSON.stringify(existing));

for (const [slug, info] of Object.entries(FIVE)) {
  next[slug] = {
    officialStatus: 'confirmed',
    cover: info.cover,
    artist: info.artist,
    normalizedArtistsInfo: info.normalizedArtistsInfo,
    rawCategory: info.rawCategory,
    mappedCategory: info.mappedCategory,
    mappedTags: info.mappedTags,
    officialSource: 'spotify',
    officialUrl: info.officialUrl,
    coverLocked: true,
    coverSource: 'spotify',
    coverUncertain: false,
  };
}

const out = `export const LOCAL_IMPORT_OFFICIAL_METADATA = ${JSON.stringify(next, null, 2)} as const;\n`;
fs.writeFileSync(filePath, out, 'utf8');
console.log(`wrote ${path.relative(projectRoot, filePath)}`);
console.log('updated slugs:', Object.keys(FIVE));
