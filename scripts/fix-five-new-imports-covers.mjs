/**
 * 五首新导入歌曲（commit df96529）的封面纠错 + 列表排序 writeback。
 *
 * - 用户已提供五首 Spotify track URL → 用 Spotify API 取**专辑封面**（i.scdn.co）
 * - 写回 Supabase `songs.cover_url` / `songs.source_cover_url`
 * - 同时写回 `songs.list_sort_published_at_ms` / `songs.list_sort_source`
 *   （沿用现有 manifest writeback 设计：以 supabase `created_at` 为基准锚到 Newest 顶部）
 *
 * Usage:
 *   node scripts/fix-five-new-imports-covers.mjs
 *
 * Required env (loaded from .env / .env.local):
 *   SPOTIFY_CLIENT_ID
 *   SPOTIFY_CLIENT_SECRET
 *   VITE_SUPABASE_URL (or SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/** Load .env.local if present (overrides .env). */
(() => {
  const localEnvPath = path.join(projectRoot, '.env.local');
  if (fs.existsSync(localEnvPath)) {
    const text = fs.readFileSync(localEnvPath, 'utf8');
    for (const line of text.split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
})();

/** Newest-cutoff and base must match src/songs-manifest.ts. */
const NEW_IMPORT_SORT_BASE_MS = 5_000_000_000_000;
const NEW_IMPORT_CUTOFF_MS = Date.parse('2026-04-22T00:00:00Z');

const FIVE = [
  {
    id: 'c0d763ff-4378-4dfc-8299-938eed122eac',
    slug: '一个人想着一个人',
    spotifyTrackId: '3n3zzFH7zzO0gJNaw4RKSm',
    artist: '曾沛慈',
  },
  {
    id: 'd58c71f9-db53-4913-9622-cb02071d8c21',
    slug: 'beauty and a beat',
    spotifyTrackId: '190jyVPHYjAqEaOGmMzdyk',
    artist: 'Justin Bieber',
  },
  {
    id: '4c828c96-de0e-4481-aff9-0ae4a3139358',
    slug: "it's me",
    spotifyTrackId: '1D5L58KLBbceOynTP4DQnY',
    artist: 'ILLIT',
  },
  {
    id: 'ae2f8edb-e1e4-4f38-8777-0a59887426af',
    slug: 'BonBon Girls',
    spotifyTrackId: '18WYdHm0rtDiidy0IK0GQM',
    artist: '浪姐版',
  },
  {
    id: '79248e52-11ca-45fd-8822-8a5f94a1cfc0',
    slug: 'someone to love',
    spotifyTrackId: '4UG43GqZxyhsOh3F3oGIGA',
    artist: '严浩翔',
  },
];

async function getSpotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const sec = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!id || !sec) throw new Error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in env.');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${id}:${sec}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify token failed: ${res.status}`);
  const j = await res.json();
  return j.access_token;
}

async function fetchSpotifyCover(token, trackId) {
  const r = await fetch(`https://api.spotify.com/v1/tracks/${trackId}?market=TW`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Spotify GET track ${trackId} failed: ${r.status}`);
  const j = await r.json();
  const images = (j.album?.images ?? []).slice().sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const cover = images[0]?.url;
  if (!cover) throw new Error(`No album image for Spotify track ${trackId}`);
  return {
    cover,
    albumName: j.album?.name ?? null,
    albumId: j.album?.id ?? null,
    externalUrl: j.external_urls?.spotify ?? `https://open.spotify.com/track/${trackId}`,
  };
}

async function main() {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.');
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const token = await getSpotifyToken();

  /** Pull current rows to compute list_sort values from created_at. */
  const idList = FIVE.map(x => x.id);
  const { data: rows, error: readErr } = await supabase
    .from('songs')
    .select('id, slug, title, cover_url, source_cover_url, created_at, list_sort_published_at_ms, list_sort_source')
    .in('id', idList);
  if (readErr) throw new Error(`Supabase read failed: ${readErr.message}`);
  const rowById = new Map(rows.map(r => [r.id, r]));

  const report = [];
  for (const entry of FIVE) {
    const row = rowById.get(entry.id);
    if (!row) {
      console.warn(`[skip] song ${entry.id} (${entry.slug}) not found in Supabase`);
      continue;
    }

    /** 1) Spotify album cover */
    const sp = await fetchSpotifyCover(token, entry.spotifyTrackId);

    /** 2) listSort fields — anchor to Newest top via supabase created_at */
    const createdAtMs = Date.parse(String(row.created_at));
    if (!Number.isFinite(createdAtMs)) {
      throw new Error(`Invalid created_at for ${entry.id}: ${row.created_at}`);
    }
    const listSortMs = NEW_IMPORT_SORT_BASE_MS + (createdAtMs - NEW_IMPORT_CUTOFF_MS);
    const listSortSource = 'new_import_created_at';

    /** 3) UPDATE both cover columns + list-sort columns in a single call. */
    const { error: updErr } = await supabase
      .from('songs')
      .update({
        cover_url: sp.cover,
        source_cover_url: sp.cover,
        source_album: sp.albumName,
        list_sort_published_at_ms: listSortMs,
        list_sort_source: listSortSource,
      })
      .eq('id', entry.id);
    if (updErr) {
      console.error(`[fail] ${entry.id} ${entry.slug}: ${updErr.message}`);
      continue;
    }

    report.push({
      id: entry.id,
      slug: entry.slug,
      newCover: sp.cover,
      albumName: sp.albumName,
      albumId: sp.albumId,
      spotifyUrl: sp.externalUrl,
      listSortMs,
      listSortSource,
    });
    console.log(`[ok]   ${entry.id} ${entry.slug}\n        cover=${sp.cover}\n        listSortMs=${listSortMs}`);
  }

  const outPath = path.join(projectRoot, 'tmp', 'fix-five-new-imports-covers-report.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nWrote ${path.relative(projectRoot, outPath)}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
