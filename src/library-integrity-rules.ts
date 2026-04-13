/**
 * Deterministic integrity checks for songs-manifest + optional cross-refs to CIP / official metadata.
 * Used by scripts/audit-library-integrity.ts — keep logic pure and side-effect free.
 */

import type { SongManifestEntry } from './songs-manifest';
import { isBadDurationLabel, parseDurationMmSsToSeconds } from './duration-utils';
import { auditArtistIdsFromString } from './local-import-artist-normalization';
import {
  cjkTitleVideoShareHan,
  digitClockAnchorOk,
  normalizeForIntegrityCompare,
  normalizeTitleForVideoAnchor,
} from './text-normalize-compare';

export type IntegrityIssue = {
  code: string;
  severity: 'error' | 'warn';
  trackId: string;
  slug?: string;
  displayTitle?: string;
  message: string;
  hints?: string[];
};

const hasHan = (s: string) => /[\p{Script=Han}]/u.test(s);

function shareTokenNormalized(title: string, videoTitle: string | null | undefined, minLen: number): boolean {
  if (!videoTitle) return false;
  const t = normalizeForIntegrityCompare(title).replace(/[^a-z0-9\u3400-\u9fff]+/gi, ' ');
  const v = normalizeForIntegrityCompare(videoTitle);
  const tokens = t.split(/\s+/).filter(w => w.length >= minLen);
  return tokens.some(w => v.includes(w));
}

export function checkDurationLocalPractice(e: SongManifestEntry): IntegrityIssue | null {
  if (!e.hasPracticeMode || !e.mp3Url?.startsWith('/local-imports/')) return null;
  if (isBadDurationLabel(e.duration) || (e.durationSeconds != null && e.durationSeconds <= 0)) {
    return {
      code: 'DURATION_INVALID_WITH_MP3',
      severity: 'error',
      trackId: e.id,
      slug: e.slug,
      displayTitle: e.displayTitle || e.title,
      message: 'Practice track has local MP3 but duration is 00:00 / missing after pipeline.',
      hints: ['Run npm run build:manifest (MP3 probe)', 'If still bad, re-encode MP3 or inspect file with ffprobe'],
    };
  }
  return null;
}

/** Known toxic pattern: Chinese OST title paired with unrelated K-pop upload. */
export function checkZb1InBloomWrongBinding(e: SongManifestEntry): IntegrityIssue | null {
  const title = e.displayTitle || e.title;
  if (!title.includes('灯火万家')) return null;
  const vt = e.youtubeVideoTitle || '';
  if (/in bloom|zerobaseone|제로베이스원|zb1/i.test(vt) && !/王赫野|人间烟火|杨洋/i.test(vt)) {
    return {
      code: 'VIDEO_BINDING_LIKELY_WRONG_KPOP',
      severity: 'error',
      trackId: e.id,
      slug: e.slug,
      displayTitle: title,
      message: 'Video title suggests ZB1/In Bloom while display title is 灯火万家 (historical mis-link).',
      hints: ['Use local-import-metadata-overrides to fix links or disable wrong video'],
    };
  }
  return null;
}

/** Short Latin title: official-style cover (Apple) while video clearly names another act. */
export function checkHelloStyleCoverVideoSplit(e: SongManifestEntry): IntegrityIssue | null {
  const title = normalizeForIntegrityCompare(e.displayTitle || e.title);
  if (title !== 'hello') return null;
  const vt = e.youtubeVideoTitle || '';
  const cover = e.coverUrl || '';
  const videoNamesThe9 = /the9|钢琴版\s*$/i.test(vt) || /the9/i.test(vt);
  const coverLooksApple = /mzstatic\.com|apple/i.test(cover);
  if (videoNamesThe9 && coverLooksApple && !/the9/i.test(cover)) {
    return {
      code: 'COVER_VIDEO_ARTIST_MISMATCH_SHORT_TITLE',
      severity: 'warn',
      trackId: e.id,
      slug: e.slug,
      displayTitle: e.displayTitle || e.title,
      message: 'Hello: video references THE9 but cover URL looks like Apple western catalog.',
      hints: ['Set suppressOfficialCover + YouTube thumbnail cover in metadata overrides'],
    };
  }
  return null;
}

export function checkCjkTitleVideoAnchor(e: SongManifestEntry): IntegrityIssue | null {
  const title = e.displayTitle || e.title;
  if (!e.youtubeVideoUrl || !e.youtubeVideoTitle) return null;
  if (!hasHan(title)) return null;
  if (title.length < 2) return null;
  const vt = e.youtubeVideoTitle;
  if (!hasHan(vt)) return null;

  const slug = e.slug || '';
  if ((slug === '勿听' || title.includes('勿听')) && /黑神话|悟空|wukong|black\s*myth/i.test(vt)) {
    return null;
  }

  if (digitClockAnchorOk(title, vt)) return null;
  if (cjkTitleVideoShareHan(title, vt)) return null;
  if (shareTokenNormalized(normalizeTitleForVideoAnchor(title), vt, 3)) return null;

  return {
    code: 'CJK_TITLE_HAN_MISMATCH_WITH_VIDEO_HAN',
    severity: 'warn',
    trackId: e.id,
    slug: e.slug,
    displayTitle: title,
    message: 'Video title contains CJK but shares no Han characters with song title (likely wrong upload).',
    hints: ['Compare with CIP matched row', 'Add override links if mismatch'],
  };
}

export function checkCanonicalArtistVsOriginal(e: SongManifestEntry): IntegrityIssue | null {
  if (e.artistReviewStatus !== 'ok') return null;
  const fromYoutubeVideo =
    e.artistResolutionNotes?.some(n =>
      [
        'video_title_dictionary_match',
        'youtube_title_structured_dict',
        'youtube_title_freeform',
        'priority_explicit_artist_in_haystack',
      ].includes(n),
    ) ?? false;
  if (fromYoutubeVideo) return null;
  if (e.artistResolutionNotes?.some(n => n.startsWith('survival_show_'))) return null;
  if (e.artistResolutionNotes?.some(n => n.startsWith('source_attribution_'))) return null;
  if (e.artistResolutionNotes?.some(n => n.startsWith('manual_confirmed_'))) return null;
  if (e.canonicalArtistId?.startsWith('from-youtube/')) return null;
  const oRaw = e.originalArtist || '';
  const cRaw = e.canonicalArtistDisplayName || '';
  if (!oRaw.trim() || !cRaw.trim()) return null;

  const oIds = auditArtistIdsFromString(oRaw);
  const cIds = auditArtistIdsFromString(cRaw);
  for (const id of oIds) {
    if (cIds.has(id)) return null;
  }

  const o = normalizeForIntegrityCompare(oRaw);
  const c = normalizeForIntegrityCompare(cRaw);
  if (!o || !c) return null;
  if (o === c) return null;
  if (o.includes(c) || c.includes(o)) return null;

  return {
    code: 'ORIGINAL_ARTIST_VS_CANONICAL_DISPLAY_MISMATCH',
    severity: 'warn',
    trackId: e.id,
    slug: e.slug,
    displayTitle: e.displayTitle || e.title,
    message: `originalArtist (${e.originalArtist}) differs from canonical display (${e.canonicalArtistDisplayName}) after normalization.`,
    hints: ['May be intentional (feat.)', 'Verify artist dictionary + overrides'],
  };
}

export type CipRow = { matchedVideoTitle?: string; youtube?: string; video?: string };

/** CIP file still points to a toxic combo while manifest was fixed (drift on next cip regen). */
export function checkCipManifestDrift(
  e: SongManifestEntry,
  slug: string,
  cip: CipRow | undefined,
): IntegrityIssue | null {
  if (!cip?.matchedVideoTitle) return null;
  const title = e.displayTitle || e.title;
  const vt = cip.matchedVideoTitle;
  if (title.includes('灯火万家') && /in bloom|zerobaseone/i.test(vt)) {
    return {
      code: 'CIP_STILL_HAS_TOXIC_MATCH_REGEN_WILL_REGRESS',
      severity: 'error',
      trackId: e.id,
      slug,
      displayTitle: title,
      message: 'CIP still pairs 灯火万家 with ZB1/In Bloom.',
      hints: ['Run generate:cip-links after strip rules', 'Or edit local-import-cip-links.generated.ts'],
    };
  }
  return null;
}

export function runAllManifestChecks(
  entries: SongManifestEntry[],
  cipBySlug?: Record<string, CipRow>,
): IntegrityIssue[] {
  const out: IntegrityIssue[] = [];
  for (const e of entries) {
    const slug = e.slug || '';
    const push = (x: IntegrityIssue | null) => {
      if (x) out.push(x);
    };
    push(checkDurationLocalPractice(e));
    push(checkZb1InBloomWrongBinding(e));
    push(checkHelloStyleCoverVideoSplit(e));
    push(checkCjkTitleVideoAnchor(e));
    push(checkCanonicalArtistVsOriginal(e));
    if (cipBySlug && slug) push(checkCipManifestDrift(e, slug, cipBySlug[slug]));
  }
  return out;
}

export function summarizeDuration(entries: SongManifestEntry[]) {
  const ok = entries.filter(e => !isBadDurationLabel(e.duration)).length;
  const bad = entries.filter(e => isBadDurationLabel(e.duration));
  const withSeconds = entries.filter(
    e => typeof e.durationSeconds === 'number' && (e.durationSeconds ?? 0) > 0,
  ).length;
  return { ok, badCount: bad.length, badSlugs: bad.map(e => e.slug || e.id), withSeconds };
}

export { parseDurationMmSsToSeconds, isBadDurationLabel };
