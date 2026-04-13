/**
 * Shared duration formatting / parsing for manifest, local imports, and audits.
 * Keep this module free of seed/manifest side effects so it is safe to import from songs-manifest (browser bundle).
 */

import type { Track } from './types/track';

export function formatDurationLabel(totalSeconds: number | null | undefined): string {
  if (!Number.isFinite(totalSeconds ?? NaN) || !totalSeconds || totalSeconds <= 0) return '00:00';
  const secs = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Parse "mm:ss" or "h:mm:ss" to seconds; returns null if invalid or empty. */
export function parseDurationMmSsToSeconds(label: string | null | undefined): number | null {
  if (label == null || typeof label !== 'string') return null;
  const t = label.trim();
  if (!t || t === '00:00') return null;
  const parts = t.split(':').map(p => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map(p => Number.parseInt(p, 10));
  if (nums.some(n => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) {
    const [mm, ss] = nums;
    if (ss > 59) return null;
    return mm * 60 + ss;
  }
  const [hh, mm, ss] = nums;
  if (mm > 59 || ss > 59) return null;
  return hh * 3600 + mm * 60 + ss;
}

export function isBadDurationLabel(label: string | null | undefined): boolean {
  const s = parseDurationMmSsToSeconds(label);
  return s == null || s <= 0;
}

/**
 * List UI: prefer manifest `track.duration`, then seconds from metadata, then durationLabel.
 * Ensures manifest-backfilled seconds still show if top-level string ever lags.
 */
export function getTrackListDurationLabel(track: Track): string {
  const top = track.duration?.trim();
  if (top && top !== '00:00' && !isBadDurationLabel(top)) return top;
  const sec = track.metadata?.assets?.duration;
  if (typeof sec === 'number' && Number.isFinite(sec) && sec > 0) return formatDurationLabel(sec);
  const dl = track.metadata?.assets?.durationLabel?.trim();
  if (dl && dl !== '00:00' && !isBadDurationLabel(dl)) return dl;
  return top && top.length > 0 ? top : '00:00';
}
