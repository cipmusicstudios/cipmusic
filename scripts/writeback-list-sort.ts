/**
 * Writeback helper: persist computed manifest sort fields back to Supabase
 * `public.songs`.
 *
 * Why a separate file: keeps the build-songs-manifest.ts main flow tidy and
 * makes this writeback unit-testable. It is a Node-only utility — never
 * imported from web client code, never bundled. It uses the Supabase service
 * role key (via SUPABASE_SERVICE_ROLE_KEY) which must NEVER appear in the
 * client bundle.
 *
 * Behaviour:
 *   - UPDATEs are scoped by id (= songs.id, a UUID).
 *   - Only the two new columns are written:
 *       list_sort_published_at_ms  (bigint)
 *       list_sort_source           (text)
 *   - No INSERT, no DELETE, no other column modifications.
 *   - Entries are skipped (and counted) when:
 *       * id is missing
 *       * id is not a UUID (i.e. local-import seeds like 'golden_piano')
 *       * listSortPublishedAtMs is missing or non-finite
 *       * listSortSource is missing or empty
 *   - Idempotent: running twice with the same inputs produces identical rows.
 *   - Optional dry-run mode logs every intended UPDATE without calling Supabase.
 *
 * Required environment:
 *   - VITE_SUPABASE_URL or SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 * Throws if either is missing in non-dry-run mode.
 */

import { createClient } from '@supabase/supabase-js';

export interface ListSortWritebackEntry {
  id?: string;
  listSortPublishedAtMs?: number | null;
  listSortSource?: string;
}

export interface ListSortWritebackOptions {
  /** When true, log what would be updated but do not call Supabase. */
  dryRun?: boolean;
  /** Override Supabase URL; otherwise read from VITE_SUPABASE_URL or SUPABASE_URL. */
  supabaseUrl?: string;
  /** Override service role key; otherwise read from SUPABASE_SERVICE_ROLE_KEY. */
  serviceRoleKey?: string;
  /** Parallel UPDATEs. Default 8; clamped to [1, 32]. */
  concurrency?: number;
}

export interface ListSortWritebackStats {
  totalScanned: number;
  attempted: number;
  updated: number;
  skippedNoId: number;
  skippedNonUuid: number;
  skippedNoSortValue: number;
  failed: number;
  failures: Array<{ id: string; error: string }>;
  dryRun: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export async function writebackListSortFields(
  entries: ListSortWritebackEntry[],
  opts: ListSortWritebackOptions = {},
): Promise<ListSortWritebackStats> {
  const stats: ListSortWritebackStats = {
    totalScanned: entries.length,
    attempted: 0,
    updated: 0,
    skippedNoId: 0,
    skippedNonUuid: 0,
    skippedNoSortValue: 0,
    failed: 0,
    failures: [],
    dryRun: opts.dryRun === true,
  };

  // Filter to writable candidates.
  const candidates: Array<{ id: string; ms: number; source: string }> = [];
  for (const e of entries) {
    const id = (e.id ?? '').trim();
    if (!id) {
      stats.skippedNoId++;
      continue;
    }
    if (!isUuid(id)) {
      stats.skippedNonUuid++;
      continue;
    }
    const ms = e.listSortPublishedAtMs;
    const source = (e.listSortSource ?? '').trim();
    if (typeof ms !== 'number' || !Number.isFinite(ms) || !source) {
      stats.skippedNoSortValue++;
      continue;
    }
    candidates.push({ id, ms, source });
  }

  stats.attempted = candidates.length;

  if (opts.dryRun === true) {
    for (const c of candidates) {
      console.log(
        `[writeback-list-sort][dry-run] would UPDATE songs WHERE id=${c.id} ` +
          `SET list_sort_published_at_ms=${c.ms}, list_sort_source=${c.source}`,
      );
    }
    return stats;
  }

  // Live mode requires both URL and service role key.
  const url = (opts.supabaseUrl ?? process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim();
  const key = (opts.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) {
    throw new Error(
      'writebackListSortFields: missing required env. Need (VITE_SUPABASE_URL or SUPABASE_URL) AND SUPABASE_SERVICE_ROLE_KEY. Service role key must NEVER ship to the client; use Node build env only.',
    );
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 8, 32));
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= candidates.length) return;
      const c = candidates[i];
      const { error } = await supabase
        .from('songs')
        .update({
          list_sort_published_at_ms: c.ms,
          list_sort_source: c.source,
        })
        .eq('id', c.id);
      if (error) {
        stats.failed++;
        stats.failures.push({ id: c.id, error: error.message });
      } else {
        stats.updated++;
      }
    }
  }

  const workerCount = Math.min(concurrency, candidates.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return stats;
}
