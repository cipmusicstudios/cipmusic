/**
 * Playback time + duration live outside App state so audio/practice updates
 * do not re-render the full app shell. Subscribe only where needed (practice UI, sync points).
 */
import { useSyncExternalStore } from 'react';

export type PlaybackTimelineSnapshot = {
  currentTime: number;
  duration: number;
};

let snapshot: PlaybackTimelineSnapshot = { currentTime: 0, duration: 0 };
const listeners = new Set<() => void>();

/**
 * Throttle for React UI subscriber notifications (~4 Hz).
 * The internal snapshot value is always updated immediately so that
 * non-React consumers (Practice RAF → getPlaybackTimelineSnapshot()) get
 * the latest value. Only the `emit()` call to useSyncExternalStore
 * subscribers is throttled during normal continuous playback.
 */
const PLAYBACK_UI_EMIT_THRESHOLD_SECS = 0.23;

/** Track the last time we actually notified React subscribers */
let lastEmittedTime = 0;

function emit() {
  for (const l of listeners) l();
}

export function getPlaybackTimelineSnapshot(): PlaybackTimelineSnapshot {
  return snapshot;
}

export function subscribePlaybackTimeline(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function resetPlaybackTimeline() {
  snapshot = { currentTime: 0, duration: 0 };
  lastEmittedTime = 0;
  emit();
}

/**
 * Update the current playback time.
 * - Always updates the internal snapshot (for non-React readers).
 * - Only emits to React subscribers if the change exceeds the UI threshold,
 *   OR if `forceEmit` is true (used for seeks, pauses, loop resets).
 */
export function setPlaybackTimelineTime(time: number, forceEmit = false) {
  if (snapshot.currentTime === time) return;
  snapshot = { ...snapshot, currentTime: time };

  if (forceEmit) {
    lastEmittedTime = time;
    emit();
    return;
  }

  // Throttle: only notify React UI subscribers at ~4 Hz
  const delta = Math.abs(time - lastEmittedTime);
  if (delta >= PLAYBACK_UI_EMIT_THRESHOLD_SECS) {
    lastEmittedTime = time;
    emit();
  }
}

export function setPlaybackTimelineDuration(d: number) {
  if (snapshot.duration === d) return;
  snapshot = { ...snapshot, duration: d };
  emit();
}

/** Practice / paused sync: subscribe only to currentTime changes. */
export function usePlaybackTimelineTime(): number {
  return useSyncExternalStore(
    subscribePlaybackTimeline,
    () => snapshot.currentTime,
    () => snapshot.currentTime,
  );
}

/** Duration from main audio metadata — updates rarely. */
export function usePlaybackDurationValue(): number {
  return useSyncExternalStore(
    subscribePlaybackTimeline,
    () => snapshot.duration,
    () => snapshot.duration,
  );
}
