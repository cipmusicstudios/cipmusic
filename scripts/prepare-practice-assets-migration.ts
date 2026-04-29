/**
 * Phase D Step 1/2 准备脚本（默认 dry-run）：
 * - 从 `songs` 表读取 has_practice_mode=true 的曲目
 * - 按与 broker 一致的优先级解析 MIDI / MusicXML key：path 列优先，URL 列 fallback
 * - 校验源对象是否存在
 * - 计算未来复制到 practice-assets（或 env 覆盖 bucket）的目标 key
 * - 输出汇总 + JSON 报告（不改 DB、不复制对象、不删除对象）
 *
 * Usage:
 *   npm run prepare:practice-assets
 *
 * Optional env:
 *   SUPABASE_URL / VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_SONGS_BUCKET               (default: songs)
 *   SUPABASE_PRACTICE_BUCKET            (default: practice-assets)
 *   PRACTICE_MIGRATION_PATH_MODE        stable | rotated  (default: stable)
 *   PRACTICE_MIGRATION_REPORT_PATH      (default: tmp/practice-assets-migration-report.json)
 *
 * Safety:
 *   - 默认仅 dry-run。
 *   - 本脚本不会复制/删除任何对象，不会写 DB。
 */
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';

dotenv.config({path: path.resolve(process.cwd(), '.env')});
dotenv.config({path: path.resolve(process.cwd(), '.env.local')});

type PathMode = 'stable' | 'rotated';
type Status =
  | 'ready'
  | 'ready_target_bucket_missing'
  | 'missing_path'
  | 'missing_source_object'
  | 'target_already_exists'
  | 'probe_error'
  | 'target_probe_error';

type SongRow = {
  id: string;
  slug: string | null;
  title: string | null;
  has_practice_mode: boolean | null;
  midi_path: string | null;
  xml_path: string | null;
  midi_url: string | null;
  musicxml_url: string | null;
};

type ReportItem = {
  id: string;
  slug: string;
  title: string;
  sourceMidiKey: string | null;
  sourceXmlKey: string | null;
  targetMidiKey: string | null;
  targetXmlKey: string | null;
  midiSourceExists: boolean;
  xmlSourceExists: boolean;
  midiTargetExists: boolean;
  xmlTargetExists: boolean;
  /** Phase D Step 2+: richer probe diagnostics (keeps legacy booleans for JSON consumers). */
  midiSourceProbeStatus?: 'exists' | 'missing' | 'probe_error';
  xmlSourceProbeStatus?: 'exists' | 'missing' | 'probe_error';
  midiTargetProbeStatus?: 'exists' | 'missing' | 'probe_error';
  xmlTargetProbeStatus?: 'exists' | 'missing' | 'probe_error';
  midiSourceProbeAttempts?: number;
  xmlSourceProbeAttempts?: number;
  midiTargetProbeAttempts?: number;
  xmlTargetProbeAttempts?: number;
  midiSourceProbeError?: string;
  xmlSourceProbeError?: string;
  midiTargetProbeError?: string;
  xmlTargetProbeError?: string;
  status: Status;
  notes?: string[];
};

type Summary = {
  totalPracticeTracks: number;
  readyCount: number;
  missingPathCount: number;
  missingObjectCount: number;
  targetBucketExists: boolean;
  wouldCopyObjectCount: number;
  wouldOverwriteCount: number;
  pathMode: PathMode;
  /** Tracks where at least one MIDI/XML source probe could not be confirmed (after retries). */
  probeErrorCount: number;
  /** Sum of per-object source probe failures (midi+xml), can be > track count. */
  sourceProbeErrorCount: number;
  /** Sum of per-object target probe failures (midi+xml), can be > track count. */
  targetProbeErrorCount: number;
  /**
   * Convenience roll-up: sourceProbeErrorCount + targetProbeErrorCount.
   * (Some tracks may contribute both.)
   */
  ambiguousCount: number;
};

type ObjectProbeResult = {
  exists: boolean;
  status: 'exists' | 'missing' | 'probe_error';
  errorMessage?: string;
  attempts: number;
};

function requiredEnv(name: string, value: string | undefined): string {
  const out = value?.trim() || '';
  if (!out) {
    throw new Error(`Missing required env: ${name}`);
  }
  return out;
}

function resolvePathMode(raw: string | undefined): PathMode {
  const v = raw?.trim().toLowerCase();
  if (v === 'rotated') return 'rotated';
  return 'stable';
}

function bucketRelativeObjectKey(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    const m = /\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/i.exec(value);
    return m ? m[1] : null;
  }
  return value.replace(/^\/+/, '');
}

function pickAssetKey(pathValue: string | null | undefined, urlValue: string | null | undefined): string | null {
  const p = typeof pathValue === 'string' ? pathValue.trim() : '';
  if (p) {
    const parsed = bucketRelativeObjectKey(p);
    if (parsed) return parsed;
  }
  const u = typeof urlValue === 'string' ? urlValue.trim() : '';
  if (u) {
    const parsed = bucketRelativeObjectKey(u);
    if (parsed) return parsed;
  }
  return null;
}

function splitDirAndFile(key: string): {dir: string; file: string} {
  const normalized = key.replace(/^\/+/, '').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return {dir: '', file: normalized};
  return {dir: normalized.slice(0, idx), file: normalized.slice(idx + 1)};
}

async function bucketExists(supabase: SupabaseClient, bucket: string): Promise<boolean> {
  const res = await supabase.storage.listBuckets();
  if (res.error || !Array.isArray(res.data)) return false;
  return res.data.some((b: {name: string}) => b.name === bucket);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function isProbablyTransientStorageListError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as {message?: string; status?: string | number; code?: string};
  const msg = `${anyErr.message ?? ''} ${anyErr.status ?? ''} ${anyErr.code ?? ''}`.toLowerCase();
  return (
    msg.includes('gateway timeout') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('etimedout') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('temporar') ||
    msg.includes('unavailable') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes(' 502') ||
    msg.includes(' 503') ||
    msg.includes(' 504') ||
    msg.includes(' 429') ||
    /\b5\d\d\b/.test(msg)
  );
}

function formatProbeError(err: unknown): string {
  if (!err) return 'unknown_error';
  const anyErr = err as {message?: string; status?: string | number; code?: string};
  const parts = [anyErr.message, anyErr.status ? String(anyErr.status) : '', anyErr.code]
    .filter(Boolean)
    .join(' | ');
  const out = parts.trim() || String(err);
  /** Never allow accidental full URLs with tokens to leak into reports via error strings. */
  return out.replace(/token=[^&\s]+/gi, 'token=<redacted>');
}

/**
 * Supabase Storage object existence probe with retries.
 *
 * Primary strategy: `list(dir, { search: file })` (fast for small folders).
 * If list succeeds but finds no exact filename match, do a bounded directory scan fallback
 * (`list` without search, scan first 1000 entries). This avoids rare search false-negatives.
 *
 * Transient API failures (timeouts/5xx/network/rate-limit-ish messages) are NOT treated as missing.
 */
async function probeStorageObject(
  supabase: SupabaseClient,
  bucket: string,
  key: string,
): Promise<ObjectProbeResult> {
  const {dir, file} = splitDirAndFile(key);
  if (!file) {
    return {exists: false, status: 'missing', attempts: 0};
  }

  const delaysMs = [0, 300, 800];
  let lastError: string | undefined;
  let attempts = 0;

  for (let i = 0; i < delaysMs.length; i += 1) {
    if (delaysMs[i] > 0) await sleep(delaysMs[i]);
    attempts += 1;

    const res = await supabase.storage.from(bucket).list(dir, {
      limit: 100,
      offset: 0,
      search: file,
    });

    if (res.error) {
      lastError = formatProbeError(res.error);
      if (isProbablyTransientStorageListError(res.error)) {
        continue;
      }
      /** Non-transient error: treat as probe failure (not "missing"). */
      return {exists: false, status: 'probe_error', errorMessage: lastError, attempts};
    }

    if (!Array.isArray(res.data)) {
      lastError = 'list returned non-array data';
      continue;
    }

    if (res.data.some((entry: {name?: string}) => entry.name === file)) {
      return {exists: true, status: 'exists', attempts};
    }

    /** Search returned no exact match — fall back to scanning directory (bounded). */
    const scan = await supabase.storage.from(bucket).list(dir, {
      limit: 1000,
      offset: 0,
      sortBy: {column: 'name', order: 'asc'},
    });
    if (scan.error) {
      lastError = formatProbeError(scan.error);
      if (isProbablyTransientStorageListError(scan.error)) {
        continue;
      }
      return {exists: false, status: 'probe_error', errorMessage: lastError, attempts};
    }
    if (!Array.isArray(scan.data)) {
      lastError = 'scan list returned non-array data';
      continue;
    }
    if (scan.data.some((entry: {name?: string}) => entry.name === file)) {
      return {exists: true, status: 'exists', attempts};
    }

    return {exists: false, status: 'missing', attempts};
  }

  return {
    exists: false,
    status: 'probe_error',
    errorMessage: lastError || 'probe_failed_after_retries',
    attempts,
  };
}

async function fetchPracticeRows(supabase: SupabaseClient): Promise<SongRow[]> {
  const out: SongRow[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const res = await supabase
      .from('songs')
      .select('id, slug, title, has_practice_mode, midi_path, xml_path, midi_url, musicxml_url')
      .eq('has_practice_mode', true)
      .order('id', {ascending: true})
      .range(from, to);
    if (res.error) {
      throw new Error(`songs query failed: ${res.error.message}`);
    }
    const batch = (res.data ?? []) as SongRow[];
    out.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

function toRotatedKey(slug: string, fileName: string, token: string): string {
  return `songs/${slug}/${token}/${fileName}`;
}

function ensureTmpReportPath(rawPath: string): string {
  const fullPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
  fs.mkdirSync(path.dirname(fullPath), {recursive: true});
  return fullPath;
}

function printSample(title: string, items: ReportItem[], predicate: (item: ReportItem) => boolean) {
  const sample = items.filter(predicate).slice(0, 30);
  console.log(`\n${title}: ${sample.length > 0 ? `showing ${sample.length} sample(s)` : 'none'}`);
  for (const item of sample) {
    console.log(
      `- ${item.id} | slug=${item.slug} | status=${item.status} | midi=${item.sourceMidiKey ?? '-'} | xml=${item.sourceXmlKey ?? '-'}`,
    );
  }
}

async function main() {
  const supabaseUrl = requiredEnv(
    'SUPABASE_URL (or VITE_SUPABASE_URL)',
    process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim(),
  );
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
  const sourceBucket = process.env.SUPABASE_SONGS_BUCKET?.trim() || 'songs';
  const targetBucket = process.env.SUPABASE_PRACTICE_BUCKET?.trim() || 'practice-assets';
  const pathMode = resolvePathMode(process.env.PRACTICE_MIGRATION_PATH_MODE);
  const reportPath = ensureTmpReportPath(
    process.env.PRACTICE_MIGRATION_REPORT_PATH?.trim() || 'tmp/practice-assets-migration-report.json',
  );
  const applyFlag = process.env.PRACTICE_MIGRATION_APPLY?.trim() === '1';

  if (applyFlag) {
    throw new Error(
      'PRACTICE_MIGRATION_APPLY=1 is not supported in this phase. This script is dry-run only.',
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {persistSession: false},
    db: {schema: 'public'},
  });

  const sourceBucketExists = await bucketExists(supabase, sourceBucket);
  const targetBucketExists = await bucketExists(supabase, targetBucket);

  if (!sourceBucketExists) {
    console.error(
      `[prepare-practice-assets] ERROR: source bucket "${sourceBucket}" does not exist. Source object checks will fail.`,
    );
  }
  if (!targetBucketExists) {
    console.error(
      `[prepare-practice-assets] ERROR: target bucket "${targetBucket}" does not exist. Dry-run will continue and report output will still be generated.`,
    );
  }

  const rows = await fetchPracticeRows(supabase);
  const items: ReportItem[] = [];
  let missingPathCount = 0;
  let missingObjectCount = 0;
  let probeErrorCount = 0;
  let sourceProbeErrorCount = 0;
  let targetProbeErrorCount = 0;
  let readyCount = 0;
  let wouldCopyObjectCount = 0;
  let wouldOverwriteCount = 0;

  for (const row of rows) {
    const slug = (row.slug || '').trim() || row.id;
    const title = (row.title || '').trim() || '(untitled)';
    const sourceMidiKey = pickAssetKey(row.midi_path, row.midi_url);
    const sourceXmlKey = pickAssetKey(row.xml_path, row.musicxml_url);

    let targetMidiKey: string | null = null;
    let targetXmlKey: string | null = null;
    if (sourceMidiKey && sourceXmlKey) {
      if (pathMode === 'stable') {
        targetMidiKey = sourceMidiKey;
        targetXmlKey = sourceXmlKey;
      } else {
        const token = crypto.randomBytes(16).toString('hex');
        targetMidiKey = toRotatedKey(slug, 'performance.mid', token);
        targetXmlKey = toRotatedKey(slug, 'score.musicxml', token);
      }
    }

    let midiSourceExists = false;
    let xmlSourceExists = false;
    let midiTargetExists = false;
    let xmlTargetExists = false;
    let midiSourceProbeStatus: 'exists' | 'missing' | 'probe_error' | undefined;
    let xmlSourceProbeStatus: 'exists' | 'missing' | 'probe_error' | undefined;
    let midiTargetProbeStatus: 'exists' | 'missing' | 'probe_error' | undefined;
    let xmlTargetProbeStatus: 'exists' | 'missing' | 'probe_error' | undefined;
    let midiSourceProbeAttempts: number | undefined;
    let xmlSourceProbeAttempts: number | undefined;
    let midiTargetProbeAttempts: number | undefined;
    let xmlTargetProbeAttempts: number | undefined;
    let midiSourceProbeError: string | undefined;
    let xmlSourceProbeError: string | undefined;
    let midiTargetProbeError: string | undefined;
    let xmlTargetProbeError: string | undefined;
    const notes: string[] = [];

    if (!sourceMidiKey || !sourceXmlKey) {
      missingPathCount += 1;
      if (!sourceMidiKey) notes.push('missing_midi_key');
      if (!sourceXmlKey) notes.push('missing_xml_key');
    } else {
      const midiProbe = sourceBucketExists
        ? await probeStorageObject(supabase, sourceBucket, sourceMidiKey)
        : {exists: false, status: 'probe_error' as const, errorMessage: 'source_bucket_missing', attempts: 0};
      const xmlProbe = sourceBucketExists
        ? await probeStorageObject(supabase, sourceBucket, sourceXmlKey)
        : {exists: false, status: 'probe_error' as const, errorMessage: 'source_bucket_missing', attempts: 0};

      midiSourceProbeStatus = midiProbe.status;
      xmlSourceProbeStatus = xmlProbe.status;
      midiSourceProbeAttempts = midiProbe.attempts;
      xmlSourceProbeAttempts = xmlProbe.attempts;
      if (midiProbe.status === 'probe_error') {
        sourceProbeErrorCount += 1;
        notes.push('probe_source_midi_error');
        midiSourceProbeError = midiProbe.errorMessage;
      }
      if (xmlProbe.status === 'probe_error') {
        sourceProbeErrorCount += 1;
        notes.push('probe_source_xml_error');
        xmlSourceProbeError = xmlProbe.errorMessage;
      }

      midiSourceExists = midiProbe.status === 'exists';
      xmlSourceExists = xmlProbe.status === 'exists';

      const anySourceProbeError = midiProbe.status === 'probe_error' || xmlProbe.status === 'probe_error';
      const midiMissingConfirmed = midiProbe.status === 'missing';
      const xmlMissingConfirmed = xmlProbe.status === 'missing';

      /**
       * Missing counts only when we can actually confirm absence — never when the other side
       * is `probe_error` (ambiguous). If either side is ambiguous, the track must be `probe_error`,
       * not `missing_source_object`.
       */
      if (!anySourceProbeError) {
        if (midiMissingConfirmed) notes.push('missing_source_midi_object');
        if (xmlMissingConfirmed) notes.push('missing_source_xml_object');
        if (midiMissingConfirmed || xmlMissingConfirmed) {
          missingObjectCount += 1;
        }
      }

      const bothSourcesConfirmed =
        midiProbe.status === 'exists' && xmlProbe.status === 'exists' && sourceBucketExists;
      if (bothSourcesConfirmed) {
        readyCount += 1;
        wouldCopyObjectCount += 2;

        if (targetBucketExists && targetMidiKey && targetXmlKey) {
          const midiTgt = await probeStorageObject(supabase, targetBucket, targetMidiKey);
          const xmlTgt = await probeStorageObject(supabase, targetBucket, targetXmlKey);

          midiTargetProbeStatus = midiTgt.status;
          xmlTargetProbeStatus = xmlTgt.status;
          midiTargetProbeAttempts = midiTgt.attempts;
          xmlTargetProbeAttempts = xmlTgt.attempts;
          if (midiTgt.status === 'probe_error') {
            targetProbeErrorCount += 1;
            notes.push('probe_target_midi_error');
            midiTargetProbeError = midiTgt.errorMessage;
          }
          if (xmlTgt.status === 'probe_error') {
            targetProbeErrorCount += 1;
            notes.push('probe_target_xml_error');
            xmlTargetProbeError = xmlTgt.errorMessage;
          }

          midiTargetExists = midiTgt.status === 'exists';
          xmlTargetExists = xmlTgt.status === 'exists';

          if (midiTgt.status === 'exists') {
            wouldOverwriteCount += 1;
            notes.push('target_midi_exists');
          }
          if (xmlTgt.status === 'exists') {
            wouldOverwriteCount += 1;
            notes.push('target_xml_exists');
          }
        }
      }
    }

    let status: Status;
    if (!sourceMidiKey || !sourceXmlKey) {
      status = 'missing_path';
    } else {
      const midiPs = midiSourceProbeStatus;
      const xmlPs = xmlSourceProbeStatus;
      const anySourceProbeError = midiPs === 'probe_error' || xmlPs === 'probe_error';
      if (anySourceProbeError) {
        probeErrorCount += 1;
        status = 'probe_error';
      } else if (midiPs === 'missing' || xmlPs === 'missing') {
        status = 'missing_source_object';
      } else if (!targetBucketExists) {
        status = 'ready_target_bucket_missing';
      } else if (midiTargetProbeStatus === 'probe_error' || xmlTargetProbeStatus === 'probe_error') {
        probeErrorCount += 1;
        status = 'target_probe_error';
      } else if (midiTargetExists || xmlTargetExists) {
        status = 'target_already_exists';
      } else {
        status = 'ready';
      }
    }

    items.push({
      id: row.id,
      slug,
      title,
      sourceMidiKey,
      sourceXmlKey,
      targetMidiKey,
      targetXmlKey,
      midiSourceExists,
      xmlSourceExists,
      midiTargetExists,
      xmlTargetExists,
      midiSourceProbeStatus,
      xmlSourceProbeStatus,
      midiTargetProbeStatus,
      xmlTargetProbeStatus,
      midiSourceProbeAttempts,
      xmlSourceProbeAttempts,
      midiTargetProbeAttempts,
      xmlTargetProbeAttempts,
      midiSourceProbeError,
      xmlSourceProbeError,
      midiTargetProbeError,
      xmlTargetProbeError,
      status,
      notes: notes.length ? notes : undefined,
    });
  }

  const summary: Summary = {
    totalPracticeTracks: rows.length,
    readyCount,
    missingPathCount,
    missingObjectCount,
    targetBucketExists,
    wouldCopyObjectCount,
    wouldOverwriteCount,
    pathMode,
    probeErrorCount,
    sourceProbeErrorCount,
    targetProbeErrorCount,
    ambiguousCount: sourceProbeErrorCount + targetProbeErrorCount,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: true,
    sourceBucket,
    sourceBucketExists,
    targetBucket,
    targetBucketExists,
    pathMode,
    summary,
    items,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n[prepare-practice-assets] Dry-run completed.');
  console.log(`[prepare-practice-assets] sourceBucket=${sourceBucket} targetBucket=${targetBucket}`);
  console.log(`[prepare-practice-assets] pathMode=${pathMode}`);
  console.log(`[prepare-practice-assets] report=${reportPath}`);
  console.log('\nSummary:');
  console.log(JSON.stringify(summary, null, 2));

  printSample('Sample anomalies: missing path', items, i => i.status === 'missing_path');
  printSample('Sample anomalies: missing source object (confirmed)', items, i => i.status === 'missing_source_object');
  printSample('Sample anomalies: source probe error (ambiguous)', items, i => i.status === 'probe_error');
  printSample('Sample anomalies: target probe error (ambiguous)', items, i => i.status === 'target_probe_error');
  printSample('Sample anomalies: target already exists', items, i => i.status === 'target_already_exists');
}

main().catch((err) => {
  console.error('[prepare-practice-assets] failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
