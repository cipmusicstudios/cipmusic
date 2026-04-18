/**
 * 防止 manifest 重建时把「已有有效时长」覆盖成 00:00：
 * 从上一版 public/songs-manifest-chunk-*.json 读取 duration，在探测失败时回填。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SongManifestEntry } from '../src/songs-manifest.ts';
import { isBadDurationLabel, parseDurationMmSsToSeconds } from '../src/duration-utils.ts';

export type PriorDuration = {
  duration: string;
  durationSeconds: number | null | undefined;
};

export function isValidManifestDuration(entry: Pick<SongManifestEntry, 'duration' | 'durationSeconds'>): boolean {
  if (typeof entry.durationSeconds === 'number' && Number.isFinite(entry.durationSeconds) && entry.durationSeconds > 0) {
    return true;
  }
  return !isBadDurationLabel(entry.duration);
}

function normalizeSeconds(p: PriorDuration): number | null {
  if (typeof p.durationSeconds === 'number' && Number.isFinite(p.durationSeconds) && p.durationSeconds > 0) {
    return p.durationSeconds;
  }
  return parseDurationMmSsToSeconds(p.duration);
}

/**
 * 读取当前仓库内上一版 catalog + chunk，建立 id 与 `slug:...` 双索引。
 */
export function loadPriorManifestDurations(projectRoot: string): Map<string, PriorDuration> {
  const map = new Map<string, PriorDuration>();
  const catalogPath = path.join(projectRoot, 'public', 'songs-manifest.json');
  if (!fs.existsSync(catalogPath)) return map;

  let catalog: { chunks?: { path: string }[] };
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as { chunks?: { path: string }[] };
  } catch {
    return map;
  }

  const chunks = catalog.chunks ?? [];
  for (const c of chunks) {
    const chunkPath = path.join(projectRoot, 'public', c.path);
    if (!fs.existsSync(chunkPath)) continue;
    let body: { tracks?: SongManifestEntry[] };
    try {
      body = JSON.parse(fs.readFileSync(chunkPath, 'utf8')) as { tracks?: SongManifestEntry[] };
    } catch {
      continue;
    }
    for (const t of body.tracks ?? []) {
      if (!t?.id) continue;
      const pd: PriorDuration = {
        duration: typeof t.duration === 'string' ? t.duration : '00:00',
        durationSeconds: t.durationSeconds ?? null,
      };
      map.set(t.id, pd);
      if (t.slug) {
        map.set(`slug:${t.slug}`, pd);
      }
    }
  }
  return map;
}

function lookupPrior(prior: Map<string, PriorDuration>, id: string, slug?: string): PriorDuration | undefined {
  const byId = prior.get(id);
  if (byId) return byId;
  if (slug) return prior.get(`slug:${slug}`);
  return undefined;
}

export type DurationMergeStats = {
  total: number;
  /** 合并前本次构建已视为有效 */
  buildValidBeforeMerge: number;
  /** 合并前无效、且从上一版 manifest 回填成功 */
  preservedFromPrior: number;
  /** 合并后仍无效（含新曲尚无 prior、或 prior 本身也是坏的） */
  stillInvalidAfterMerge: number;
  /** 合并后仍显示 00:00 的数量（与 stillInvalid 一致，单独命名便于日志告警） */
  writtenAsZero: number;
};

/**
 * 若本次 entry 时长无效，而 prior 中有有效值，则写回 duration / durationSeconds。
 * 绝不把「本次已成功探测」的有效值降级。
 */
export function mergePriorDurationsIntoEntries(
  entries: SongManifestEntry[],
  prior: Map<string, PriorDuration>,
): { entries: SongManifestEntry[]; stats: DurationMergeStats } {
  let preservedFromPrior = 0;
  let buildValidBeforeMerge = 0;

  const next = entries.map(e => {
    if (isValidManifestDuration(e)) {
      buildValidBeforeMerge++;
      return e;
    }

    const p = lookupPrior(prior, e.id, e.slug);
    if (p && isValidManifestDuration({ duration: p.duration, durationSeconds: p.durationSeconds })) {
      preservedFromPrior++;
      const sec = normalizeSeconds(p);
      return {
        ...e,
        duration: p.duration,
        durationSeconds: sec ?? e.durationSeconds ?? null,
      };
    }

    return e;
  });

  const stillInvalidAfterMerge = next.filter(e => !isValidManifestDuration(e)).length;

  return {
    entries: next,
    stats: {
      total: next.length,
      buildValidBeforeMerge,
      preservedFromPrior,
      stillInvalidAfterMerge,
      writtenAsZero: stillInvalidAfterMerge,
    },
  };
}
