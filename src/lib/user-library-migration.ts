/**
 * One-time migration: localStorage → Supabase user library.
 *
 * Triggered after sign-in (or on app start when an existing session is
 * restored). Reads any localStorage favorites and recently-played entries
 * left over from guest mode and pushes them to the Supabase tables. Sets a
 * per-user flag so the migration runs only once per (browser, user) pair.
 *
 * Idempotent: re-running is safe because:
 *   - the migrated flag short-circuits subsequent invocations
 *   - the actual writes use UPSERT with ignoreDuplicates / ON CONFLICT
 *
 * Best-effort: if remote writes fail (network, RLS, etc.) the flag is NOT
 * set, so the next sign-in will retry. localStorage entries are preserved
 * as a read-only fallback even after a successful migration.
 */
import { supabase } from './supabase';
import { loadFavoriteIds, loadRecentTrackIds } from '../user-library-storage';

function migratedFlagKey(userId: string): string {
  return `aurasounds_lib_migrated_v1_${userId}`;
}

export async function migrateLocalLibraryToSupabase(userId: string): Promise<void> {
  if (!userId) return;
  const flagKey = migratedFlagKey(userId);

  let alreadyMigrated: string | null = null;
  try {
    alreadyMigrated = localStorage.getItem(flagKey);
  } catch {
    /* fall through and attempt anyway */
  }
  if (alreadyMigrated === '1') return;

  const favIds = loadFavoriteIds();
  const recentIds = loadRecentTrackIds();

  if (favIds.length === 0 && recentIds.length === 0) {
    safeSet(flagKey, '1');
    return;
  }

  try {
    if (favIds.length > 0) {
      const rows = favIds.map(song_id => ({ user_id: userId, song_id }));
      const { error } = await supabase
        .from('user_favorites')
        .upsert(rows, { onConflict: 'user_id,song_id', ignoreDuplicates: true });
      if (error) throw new Error(`migrate favorites: ${error.message}`);
    }

    if (recentIds.length > 0) {
      // Spread played_at by index so MRU order is preserved (front = newest).
      const baseMs = Date.now();
      const rows = recentIds.map((song_id, i) => ({
        user_id: userId,
        song_id,
        played_at: new Date(baseMs - i * 1000).toISOString(),
      }));
      const { error } = await supabase
        .from('user_recently_played')
        .upsert(rows, { onConflict: 'user_id,song_id' });
      if (error) throw new Error(`migrate recents: ${error.message}`);
    }

    safeSet(flagKey, '1');
  } catch (e) {
    console.warn('[user-library-migration] failed; will retry next sign-in:', e);
    // Do NOT set the flag — next sign-in retries.
  }

  /**
   * Note: we intentionally do NOT delete the localStorage rows. They remain
   * a read-only fallback if the user signs out, and a safety net for offline
   * mode. Source of truth for signed-in users is now Supabase.
   */
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
