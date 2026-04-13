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
  emit();
}

/** Seek / pause sync / practice transport — always notify subscribers. */
export function setPlaybackTimelineTime(time: number) {
  if (snapshot.currentTime === time) return;
  snapshot = { ...snapshot, currentTime: time };
  emit();
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
