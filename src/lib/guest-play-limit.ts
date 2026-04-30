/** localStorage key for distinct tracks a guest has started playback of */
export const GUEST_PLAYED_TRACK_IDS_STORAGE_KEY = 'aura_guest_played_track_ids';

export function readGuestPlayedTrackIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(GUEST_PLAYED_TRACK_IDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function writeGuestPlayedTrackIds(ids: string[]): void {
  try {
    window.localStorage.setItem(GUEST_PLAYED_TRACK_IDS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Guest may start playback of this track (logged-in users are always allowed). */
export function guestMayStartPlayback(isGuest: boolean, trackId: string): boolean {
  if (!isGuest) return true;
  const ids = readGuestPlayedTrackIds();
  if (ids.includes(trackId)) return true;
  return ids.length < 3;
}

/** Record a track as played for guest limit; same id only stored once. */
export function recordGuestPlayedTrackIfNew(trackId: string): void {
  if (typeof window === 'undefined') return;
  const ids = readGuestPlayedTrackIds();
  if (ids.includes(trackId)) return;
  writeGuestPlayedTrackIds([...ids, trackId]);
}
