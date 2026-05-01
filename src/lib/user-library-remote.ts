/**
 * Supabase-backed user library: favorites + recently played.
 *
 * Tables (created by aurasounds-mobile/supabase/migrations/, applied to the
 * shared Supabase DB):
 *   public.user_favorites        (user_id, song_id, created_at) UNIQUE(user_id, song_id)
 *   public.user_recently_played  (user_id, song_id, played_at)  UNIQUE(user_id, song_id)
 *
 * RLS forces every read/write to the calling user — no client-side user_id
 * filtering is needed (and INSERT/UPSERT with a different user_id would be
 * rejected by the WITH CHECK policy). We still pass user_id explicitly on
 * INSERT/UPSERT because Supabase requires it in the row payload.
 *
 * All functions assume the caller has a signed-in session. Dispatching
 * (signed-in vs guest) lives in the App.tsx state plumbing.
 */
import { supabase } from './supabase';

export const LIBRARY_MAX = 20;

// ---- Favorites -------------------------------------------------------------

export async function listFavoritesRemote(): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_favorites')
    .select('song_id, created_at')
    .order('created_at', { ascending: false })
    .limit(LIBRARY_MAX);
  if (error) throw new Error(`listFavoritesRemote: ${error.message}`);
  return (data ?? []).map(row => row.song_id as string);
}

export async function addFavoriteRemote(userId: string, songId: string): Promise<void> {
  const { error } = await supabase
    .from('user_favorites')
    .upsert(
      { user_id: userId, song_id: songId },
      { onConflict: 'user_id,song_id', ignoreDuplicates: true },
    );
  if (error) throw new Error(`addFavoriteRemote: ${error.message}`);
}

export async function removeFavoriteRemote(userId: string, songId: string): Promise<void> {
  const { error } = await supabase
    .from('user_favorites')
    .delete()
    .eq('user_id', userId)
    .eq('song_id', songId);
  if (error) throw new Error(`removeFavoriteRemote: ${error.message}`);
}

// ---- Recently played -------------------------------------------------------

export async function listRecentlyPlayedRemote(): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_recently_played')
    .select('song_id, played_at')
    .order('played_at', { ascending: false })
    .limit(LIBRARY_MAX);
  if (error) throw new Error(`listRecentlyPlayedRemote: ${error.message}`);
  return (data ?? []).map(row => row.song_id as string);
}

/** UPSERT: insert new row or bump played_at on replay. */
export async function recordRecentlyPlayedRemote(userId: string, songId: string): Promise<void> {
  const { error } = await supabase
    .from('user_recently_played')
    .upsert(
      { user_id: userId, song_id: songId, played_at: new Date().toISOString() },
      { onConflict: 'user_id,song_id' },
    );
  if (error) throw new Error(`recordRecentlyPlayedRemote: ${error.message}`);
}
