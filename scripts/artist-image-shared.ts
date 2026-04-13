/**
 * Shared artist image URL validation + merge rules for:
 * - build-songs-manifest.ts
 * - fetch-artist-images.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { ARTIST_DICTIONARY } from '../src/local-import-artist-normalization.ts';
import type { ArtistImageKind } from '../src/artist-image-kind.ts';

export type { ArtistImageKind } from '../src/artist-image-kind.ts';

export type ArtistImageOverrideEntry = {
  url: string;
  source?: string;
  /** 1 = manual / curated */
  confidence?: number;
  /** When true, fetch-artist-images skips Deezer for this id */
  locked?: boolean;
  /** @deprecated use imageKind */
  kind?: string;
  imageKind?: ArtistImageKind;
};

/** public/artist-image-overrides.json (may include string fields like _comment) */
export type ArtistImageOverridesFile = Record<string, ArtistImageOverrideEntry | string | undefined>;

function getOverrideEntry(
  overrides: ArtistImageOverridesFile,
  id: string,
): ArtistImageOverrideEntry | undefined {
  const v = overrides[id];
  if (v && typeof v === 'object' && 'url' in v && typeof (v as ArtistImageOverrideEntry).url === 'string') {
    return v as ArtistImageOverrideEntry;
  }
  return undefined;
}

const BAD_DEEZER_EMPTY_HASH = /dzcdn\.net\/images\/artist\/\/\d+x\d+/;

/** Reject known-broken Deezer payloads and empty strings */
export function isValidArtistImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  /** Same-origin static assets (e.g. `public/artist-images/*`) — avoids hotlink/CORS issues. */
  if (u.startsWith('/')) return u.length > 1 && !u.includes('//');
  if (!/^https:\/\//i.test(u)) return false;
  if (BAD_DEEZER_EMPTY_HASH.test(u)) return false;
  return true;
}

export function loadArtistImageOverrides(projectRoot: string): ArtistImageOverridesFile {
  const p = path.join(projectRoot, 'public', 'artist-image-overrides.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ArtistImageOverridesFile;
  } catch {
    return {} as ArtistImageOverridesFile;
  }
}

/**
 * Merge: cache first, then overrides replace url/source/confidence when override has valid url.
 */
function legacyKindToImageKind(kind: string | undefined): ArtistImageKind | undefined {
  if (!kind) return undefined;
  if (kind === 'project_logo') return 'project_logo';
  if (kind === 'project_ost' || kind === 'key_art') return 'key_art';
  return undefined;
}

function inferImageKindForId(canonicalArtistId: string): ArtistImageKind | undefined {
  const d = ARTIST_DICTIONARY[canonicalArtistId];
  if (!d) return undefined;
  if (d.type === 'group') return 'group_photo';
  if (d.type === 'solo' || d.type === 'unknown') return 'artist_photo';
  if (d.type === 'project') return 'project_logo';
  return undefined;
}

export function resolveArtistImageKind(
  canonicalArtistId: string,
  explicit: ArtistImageKind | undefined | null,
): ArtistImageKind | undefined {
  if (explicit) return explicit;
  return inferImageKindForId(canonicalArtistId);
}

export function applyArtistImageToManifestArtist(
  canonicalArtistId: string,
  cached:
    | {
        url: string | null;
        source: string | null;
        confidence: number | null;
        imageKind?: ArtistImageKind | null;
      }
    | undefined,
  overrides: ArtistImageOverridesFile,
): {
  url: string | null;
  source: string | null;
  confidence: number | null;
  artistImageKind: ArtistImageKind | undefined;
} {
  let url = cached?.url ?? null;
  let source = cached?.source ?? null;
  let confidence = cached?.confidence ?? null;
  let imageKind: ArtistImageKind | undefined = cached?.imageKind ?? undefined;

  if (cached?.url && !isValidArtistImageUrl(cached.url)) {
    url = null;
    source = null;
    confidence = null;
    imageKind = undefined;
  }

  const o = getOverrideEntry(overrides, canonicalArtistId);
  if (o && isValidArtistImageUrl(o.url)) {
    const fromOverride =
      o.imageKind ?? legacyKindToImageKind(o.kind) ?? inferImageKindForId(canonicalArtistId);
    return {
      url: o.url.trim(),
      source: o.source ?? 'override',
      confidence: typeof o.confidence === 'number' ? o.confidence : 1,
      artistImageKind: fromOverride ?? 'artist_photo',
    };
  }

  const inferred = imageKind ?? inferImageKindForId(canonicalArtistId) ?? (url ? 'artist_photo' : undefined);
  return { url, source, confidence, artistImageKind: url ? inferred : undefined };
}

export function shouldSkipAutoFetch(canonicalArtistId: string, overrides: ArtistImageOverridesFile): boolean {
  const o = getOverrideEntry(overrides, canonicalArtistId);
  return Boolean(o?.locked && isValidArtistImageUrl(o?.url));
}
