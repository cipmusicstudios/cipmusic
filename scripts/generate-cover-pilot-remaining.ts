/**
 * Build config/cover-pilot-batch-remaining.json for no-cover queue minus batch 1 & 2.
 *
 * Strategy (does NOT run generate-local-import-official-metadata):
 * 1) Deezer public search API (generous limits) + lightweight title/artist scoring
 * 2) Fallback: iTunes Search with conservative acceptance + slower pacing (avoid rate limits)
 *
 * Usage: npx tsx scripts/generate-cover-pilot-remaining.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_IMPORT_OFFICIAL_METADATA } from '../src/local-import-official-metadata.generated';
import { LOCAL_IMPORT_METADATA_OVERRIDES } from '../src/local-import-metadata-overrides';
import { LOCAL_IMPORT_CIP_LINKS } from '../src/local-import-cip-links.generated';

const ROOT = process.cwd();
const CC = path.join(ROOT, 'tmp/cover-categories.json');
const OUT = path.join(ROOT, 'config/cover-pilot-batch-remaining.json');
const FAIL = path.join(ROOT, 'tmp/cover-pilot-remaining-failures.txt');

const BATCH1 = path.join(ROOT, 'config/cover-pilot-batch-1.json');
const BATCH2 = path.join(ROOT, 'config/cover-pilot-batch-2.json');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  if (row?.coverLocked) return 'coverLocked（官方图已锁定）';
  if (ov?.cover?.trim()) return 'manual override 已设 cover';
  if (extractSpotifyTrackId(ov?.officialLinks?.spotify)) return '已锚定 officialLinks.spotify 曲目 ID';
  if (extractAppleTrackId(ov?.officialLinks?.appleMusic)) return '已锚定 officialLinks.appleMusic 曲目 ID';
  return null;
}

function to600(url: string | undefined): string | null {
  if (!url) return null;
  return url
    .replace(/\/\d+x\d+bb\.(jpg|webp)$/i, '/600x600bb.$1')
    .replace(/100x100bb\.jpg$/i, '600x600bb.jpg')
    .replace(/200x200bb\.jpg$/i, '600x600bb.jpg')
    .replace(/300x300bb\.jpg$/i, '600x600bb.jpg');
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[''"''「」]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const junkArtist = (a: string | undefined) =>
  !a ||
  /钢琴|Piano|cover|Cover|版|伴奏|instrumental|《.*》/.test(a) ||
  a.length < 2;

function titleForSlug(slug: string): string {
  const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug];
  const cip = (LOCAL_IMPORT_CIP_LINKS as Record<string, { matchTitle?: string } | undefined>)[slug];
  return (
    ov?.displayTitle ||
    ov?.title ||
    ov?.titles?.zhHans ||
    ov?.titles?.zhHant ||
    ov?.titles?.en ||
    cip?.matchTitle ||
    slug
  );
}

function artistForSlug(slug: string): string | undefined {
  const ov = LOCAL_IMPORT_METADATA_OVERRIDES[slug];
  const row = (LOCAL_IMPORT_OFFICIAL_METADATA as Record<string, { artist?: string }>)[slug];
  const a = ov?.artist || row?.artist;
  if (typeof a !== 'string') return undefined;
  const t = a.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (norm(t) === norm(slug)) return undefined;
  return junkArtist(t) ? undefined : t;
}

/** Extra search phrases from CIP video titles (e.g. HENRY — Radio). */
function cipExtraQueries(slug: string): string[] {
  const cip = (LOCAL_IMPORT_CIP_LINKS as Record<string, { matchedVideoTitle?: string } | undefined>)[slug];
  const mv = cip?.matchedVideoTitle;
  if (!mv) return [];
  const out: string[] = [];
  if (/HENRY|헨리|刘宪华/i.test(mv) && /radio/i.test(slug)) {
    out.push('HENRY Radio', '刘宪华 Radio');
  }
  if (/章昊|ZEROBASEONE|ZB1/i.test(mv) && /shine/i.test(slug)) {
    out.push('章昊 Shine on Me', 'ZEROBASEONE Shine');
  }
  const strip = mv.replace(/\s*Piano Cover.*$/i, '').replace(/\s*\|.*$/, '').trim();
  if (strip.length >= 8 && strip.length < 120) out.push(strip);
  return out;
}

type DeezerTrack = {
  title?: string;
  rank?: number;
  artist?: { name?: string };
  album?: { cover_xl?: string; cover_big?: string; title?: string };
};

function scoreDeezerPick(titleWant: string, artistWant: string | undefined, t: DeezerTrack): number {
  const tn = norm(t.title || '');
  const tw = norm(titleWant);
  let s = 0;
  if (tw && (tn === tw || tn.includes(tw) || tw.includes(tn))) s += 100;
  else {
    const twChars = tw.replace(/\s/g, '');
    const tnChars = tn.replace(/\s/g, '');
    if (twChars.length >= 2 && tnChars.includes(twChars.slice(0, Math.min(4, twChars.length)))) s += 40;
  }
  const an = norm(t.artist?.name || '');
  if (artistWant && !junkArtist(artistWant)) {
    const aw = norm(artistWant);
    if (aw && (an.includes(aw) || aw.includes(an))) s += 60;
    const awTok = aw.split(' ').filter((x) => x.length >= 2);
    for (const tok of awTok) if (an.includes(tok)) s += 15;
  }
  s += Math.min(40, Math.log10((t.rank ?? 1) + 10) * 10);
  return s;
}

async function deezerResolve(slug: string): Promise<{ cover: string; reason: string } | null> {
  const title = titleForSlug(slug);
  const artist = artistForSlug(slug);
  const queries: string[] = [...cipExtraQueries(slug)];
  if (artist) queries.push(`${title} ${artist}`);
  queries.push(title);
  if (slug !== title) queries.push(slug);

  for (const q of queries) {
    if (!q.trim()) continue;
    await sleep(320);
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(q.trim())}&limit=25`;
    const res = await fetch(url, { headers: { 'User-Agent': 'AuraSounds-cover-pilot/1.0' } });
    if (!res.ok) continue;
    const j = (await res.json()) as { data?: DeezerTrack[]; error?: unknown };
    const rows = j.data;
    if (!rows?.length) continue;

    let best: { t: DeezerTrack; score: number } | null = null;
    for (const t of rows) {
      const sc = scoreDeezerPick(title, artist, t);
      if (!best || sc > best.score) best = { t, score: sc };
    }
    if (best && best.score >= 65 && (best.t.album?.cover_xl || best.t.album?.cover_big)) {
      const cover = best.t.album?.cover_xl || best.t.album?.cover_big!;
      return {
        cover,
        reason: `Deezer 搜索自动匹配（query=${JSON.stringify(q.trim().slice(0, 96))}，score≈${best.score.toFixed(0)}）：${best.t.artist?.name ?? '?'} — ${best.t.title ?? '?'}`,
      };
    }
  }
  return null;
}

async function itunesSearch(term: string, country: string, entity: 'song' | 'album'): Promise<Array<{ artworkUrl100?: string; trackName?: string; artistName?: string }>> {
  const u = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=15&country=${country}`;
  const res = await fetch(u, { headers: { 'User-Agent': 'AuraSounds-cover-pilot/1.0' } });
  const text = await res.text();
  if (!text.trim().startsWith('{')) return [];
  const j = JSON.parse(text) as { results?: { artworkUrl100?: string; trackName?: string; artistName?: string }[] };
  return j.results ?? [];
}

function scoreItunesPick(titleWant: string, artistWant: string | undefined, tr: { trackName?: string; artistName?: string }): number {
  return scoreDeezerPick(
    titleWant,
    artistWant,
    {
      title: tr.trackName,
      artist: { name: tr.artistName },
      rank: 100000,
    },
  );
}

async function itunesResolve(slug: string): Promise<{ cover: string; reason: string } | null> {
  const title = titleForSlug(slug);
  const artist = artistForSlug(slug);
  const queries: string[] = [...cipExtraQueries(slug)];
  if (artist) queries.push(`${title} ${artist}`);
  queries.push(title);
  if (slug !== title) queries.push(slug);

  for (const q of queries) {
    if (!q.trim()) continue;
    const qt = q.trim();
    for (const country of ['cn', 'us', 'hk', 'tw']) {
      await sleep(550);
      let results = await itunesSearch(qt, country, 'song');
      if (!results.length) {
        await sleep(550);
        results = await itunesSearch(qt, country, 'album');
      }
      let best: { tr: (typeof results)[0]; score: number } | null = null;
      for (const tr of results) {
        const sc = scoreItunesPick(title, artist, tr);
        if (!best || sc > best.score) best = { tr, score: sc };
      }
      const first = best?.tr;
      if (best && best.score >= 82 && first?.artworkUrl100) {
        const u600 = to600(first.artworkUrl100);
        if (u600) {
          return {
            cover: u600,
            reason: `iTunes Search 保守匹配（${country}，score≈${best.score.toFixed(0)}，query=${JSON.stringify(qt.slice(0, 80))}）：${first?.artistName ?? '?'} — ${first?.trackName ?? '?'}`,
          };
        }
      }
    }
  }
  return null;
}

async function resolveOne(slug: string): Promise<{ cover: string; reason: string; source: 'deezer' | 'itunes' } | null> {
  const d = await deezerResolve(slug);
  if (d) return { ...d, source: 'deezer' };
  const i = await itunesResolve(slug);
  if (i) return { ...i, source: 'itunes' };
  return null;
}

async function main() {
  const categories = JSON.parse(fs.readFileSync(CC, 'utf8')) as {
    buckets: { noCover: { slug: string }[] };
  };
  const b1 = JSON.parse(fs.readFileSync(BATCH1, 'utf8')) as { entries: { slug: string }[] };
  const b2 = JSON.parse(fs.readFileSync(BATCH2, 'utf8')) as { entries: { slug: string }[] };
  const done = new Set([...b1.entries.map((e) => e.slug), ...b2.entries.map((e) => e.slug)]);

  const noCover = categories.buckets.noCover.map((x) => x.slug);
  const remaining = noCover.filter((s) => !done.has(s));

  const entries: Array<{
    slug: string;
    pilotCategory: string;
    cover: string;
    coverSource: string;
    coverLocked: boolean;
    coverUncertain: boolean;
    officialSource: string;
    officialStatus: string;
    reason: string;
  }> = [];

  const failures: string[] = [];
  let skipped = 0;

  for (const slug of remaining) {
    const skip = shouldSkipSlug(slug);
    if (skip) {
      skipped++;
      failures.push(`${slug}\tSKIP: ${skip}`);
      continue;
    }

    const resolved = await resolveOne(slug);
    if (!resolved) {
      failures.push(`${slug}\tFAIL: no Deezer/iTunes artwork`);
      continue;
    }

    const coverSource =
      resolved.source === 'deezer' ? 'project_art' : 'apple';
    const officialSource = resolved.source === 'deezer' ? 'project_art' : 'appleMusic';

    entries.push({
      slug,
      pilotCategory: 'placeholder',
      cover: resolved.cover,
      coverSource,
      coverLocked: false,
      coverUncertain: true,
      officialSource,
      officialStatus: 'confirmed',
      reason: resolved.reason,
    });
  }

  const cfg = {
    version: 1,
    batchLabel: 'Cover pilot — remaining no-cover queue (Deezer+iTunes fallback + Moonlight Dance)',
    description:
      '由 scripts/generate-cover-pilot-remaining.ts 生成：Deezer 主检索 + 保守 iTunes 回退；不跑 generate-local-import-official-metadata。',
    entries,
  };

  fs.writeFileSync(OUT, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  fs.writeFileSync(FAIL, `${failures.join('\n')}\n`, 'utf8');

  console.log('[generate-cover-pilot-remaining] wrote', path.relative(ROOT, OUT));
  console.log('[generate-cover-pilot-remaining] entries', entries.length, 'skipped', skipped, 'fail lines', failures.length);
  console.log('[generate-cover-pilot-remaining] failures log', path.relative(ROOT, FAIL));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
