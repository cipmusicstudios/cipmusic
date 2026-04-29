/**
 * Phase D Step 1 / 2 / 2.5 — practice-assets 迁移准备脚本
 *
 * 默认 **DRY RUN ONLY**：只读 songs 表 + Storage 探测，生成报告，不复制、不写 DB、不删对象。
 *
 * 受控复制（Step 2.5）需要同时满足：
 *   PRACTICE_MIGRATION_APPLY=1
 *   PRACTICE_MIGRATION_CONFIRM=copy-practice-assets
 *
 * 建议真实复制命令（本仓验证阶段请不要随手执行）：
 *   PRACTICE_MIGRATION_APPLY=1 PRACTICE_MIGRATION_CONFIRM=copy-practice-assets npm run prepare:practice-assets
 *
 * Usage:
 *   npm run prepare:practice-assets                       # dry-run（默认）
 *
 * Optional env:
 *   SUPABASE_URL / VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_SONGS_BUCKET               (default: songs)
 *   SUPABASE_PRACTICE_BUCKET            (default: practice-assets)
 *   PRACTICE_MIGRATION_PATH_MODE        stable | rotated  (default: stable; rotated 仅 dry-run 规划用)
 *   PRACTICE_MIGRATION_REPORT_PATH      (default: tmp/practice-assets-migration-report.json)
 *   PRACTICE_MIGRATION_OVERWRITE=1      (default: off) — 允许覆盖 target 已存在对象
 */
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {Buffer} from 'node:buffer';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';

dotenv.config({path: path.resolve(process.cwd(), '.env')});
dotenv.config({path: path.resolve(process.cwd(), '.env.local')});

const REQUIRED_COPY_CONFIRM = 'copy-practice-assets';

type PathMode = 'stable' | 'rotated';

type ScanStatus =
  | 'ready'
  | 'ready_target_bucket_missing'
  | 'missing_path'
  | 'missing_source_object'
  | 'target_already_exists'
  | 'probe_error'
  | 'target_probe_error';

type CopyObjectStatus = 'pending' | 'copied' | 'skipped_existing' | 'failed' | 'not_applicable';

type FinalStatus =
  | ScanStatus
  | 'copied'
  | 'skipped_existing'
  | 'partial_failure'
  | 'failed';

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
  /** Pre-copy scan status (immutable after scan pass). */
  scanStatus: ScanStatus;
  /** Back-compat: previously this was `status`. Now equals `finalStatus` after apply pass. */
  status: FinalStatus;
  finalStatus: FinalStatus;
  notes?: string[];

  midiCopyStatus: CopyObjectStatus;
  xmlCopyStatus: CopyObjectStatus;
  midiCopyError?: string;
  xmlCopyError?: string;
};

type Summary = {
  dryRun: boolean;
  applyRequested: boolean;
  confirmed: boolean;
  overwriteEnabled: boolean;

  totalPracticeTracks: number;
  readyCount: number;
  missingPathCount: number;
  missingObjectCount: number;
  targetBucketExists: boolean;
  wouldCopyObjectCount: number;
  wouldOverwriteCount: number;
  pathMode: PathMode;

  probeErrorCount: number;
  sourceProbeErrorCount: number;
  targetProbeErrorCount: number;
  ambiguousCount: number;

  copiedObjectCount: number;
  skippedExistingCount: number;
  copyFailedCount: number;
  partialFailureCount: number;
};

type ObjectProbeResult = {
  exists: boolean;
  status: 'exists' | 'missing' | 'probe_error';
  errorMessage?: string;
  attempts: number;
};

type CopyMethod = 'supabase_storage_copy_api' | 'download_upload_fallback';

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
 * Transient API failures are NOT treated as missing.
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
      return {exists: false, status: 'probe_error', errorMessage: lastError, attempts};
    }

    if (!Array.isArray(res.data)) {
      lastError = 'list returned non-array data';
      continue;
    }

    if (res.data.some((entry: {name?: string}) => entry.name === file)) {
      return {exists: true, status: 'exists', attempts};
    }

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

function contentTypeForKey(objectKey: string): string {
  const lower = objectKey.toLowerCase();
  if (lower.endsWith('.mid') || lower.endsWith('.midi')) return 'audio/midi';
  if (lower.endsWith('.musicxml')) return 'application/vnd.recordare.musicxml+xml';
  if (lower.endsWith('.mxl')) return 'application/zip';
  if (lower.endsWith('.xml')) return 'application/xml';
  return 'application/octet-stream';
}

/**
 * Cross-bucket copy prefers Supabase Storage server-side copy (`StorageFileApi.copy` → `/object/copy`).
 * Fallback: download + upload (still service-role authenticated; no signed URLs).
 */
async function copyObjectAcrossBuckets(params: {
  supabase: SupabaseClient;
  sourceBucket: string;
  targetBucket: string;
  sourceKey: string;
  targetKey: string;
  overwrite: boolean;
}): Promise<{ok: true; method: CopyMethod} | {ok: false; method: CopyMethod; message: string}> {
  const {supabase, sourceBucket, targetBucket, sourceKey, targetKey, overwrite} = params;

  if (overwrite) {
    /** Best-effort remove — if it fails, upload may still fail; caller will surface error. */
    await supabase.storage.from(targetBucket).remove([targetKey]);
  }

  const copyRes = await supabase.storage
    .from(sourceBucket)
    .copy(sourceKey, targetKey, {destinationBucket: targetBucket});

  if (!copyRes.error) {
    return {ok: true, method: 'supabase_storage_copy_api'};
  }

  const copyErrMsg = formatProbeError(copyRes.error);
  const dl = await supabase.storage.from(sourceBucket).download(sourceKey);
  if (dl.error || !dl.data) {
    return {
      ok: false,
      method: 'supabase_storage_copy_api',
      message: `copy_failed(${copyErrMsg}); download_failed(${formatProbeError(dl.error)})`,
    };
  }

  const buf = await dl.data.arrayBuffer();
  const upsert = overwrite;
  const up = await supabase.storage.from(targetBucket).upload(targetKey, Buffer.from(buf), {
    contentType: contentTypeForKey(targetKey),
    upsert,
  });
  if (up.error) {
    return {
      ok: false,
      method: 'download_upload_fallback',
      message: `copy_failed(${copyErrMsg}); upload_failed(${formatProbeError(up.error)})`,
    };
  }

  return {ok: true, method: 'download_upload_fallback'};
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
      `- ${item.id} | slug=${item.slug} | final=${item.finalStatus} | scan=${item.scanStatus} | midi=${item.sourceMidiKey ?? '-'} | xml=${item.sourceXmlKey ?? '-'}`,
    );
  }
}

function writeReportFile(
  reportPath: string,
  body: {
    generatedAt: string;
    copyMethodNote: string;
    sourceBucket: string;
    sourceBucketExists: boolean;
    targetBucket: string;
    targetBucketExists: boolean;
    pathMode: PathMode;
    summary: Summary;
    items: ReportItem[];
  },
) {
  fs.writeFileSync(reportPath, JSON.stringify(body, null, 2), 'utf8');
}

async function main() {
  const reportPath = ensureTmpReportPath(
    process.env.PRACTICE_MIGRATION_REPORT_PATH?.trim() || 'tmp/practice-assets-migration-report.json',
  );

  const applyRequested = process.env.PRACTICE_MIGRATION_APPLY?.trim() === '1';
  const confirmRaw = process.env.PRACTICE_MIGRATION_CONFIRM?.trim() || '';
  const confirmed = confirmRaw === REQUIRED_COPY_CONFIRM;
  const overwriteEnabled = process.env.PRACTICE_MIGRATION_OVERWRITE?.trim() === '1';
  const dryRun = !applyRequested || !confirmed;

  if (applyRequested && !confirmed) {
    console.error('\n[prepare-practice-assets] REFUSED: PRACTICE_MIGRATION_APPLY=1 requires confirmation.');
    console.error(
      `[prepare-practice-assets] Set PRACTICE_MIGRATION_CONFIRM=${REQUIRED_COPY_CONFIRM} to enable APPLY mode.`,
    );
    console.error('[prepare-practice-assets] No Supabase calls were made. No objects were copied.');
    console.error(
      `[prepare-practice-assets] Intentionally NOT writing ${reportPath} (avoid clobbering the last dry-run report).`,
    );
    console.error('');
    process.exit(1);
  }

  const supabaseUrl = requiredEnv(
    'SUPABASE_URL (or VITE_SUPABASE_URL)',
    process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim(),
  );
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
  const sourceBucket = process.env.SUPABASE_SONGS_BUCKET?.trim() || 'songs';
  const targetBucket = process.env.SUPABASE_PRACTICE_BUCKET?.trim() || 'practice-assets';
  const pathMode = resolvePathMode(process.env.PRACTICE_MIGRATION_PATH_MODE);

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

  if (dryRun) {
    console.log('\n[prepare-practice-assets] DRY RUN ONLY');
    console.log('[prepare-practice-assets] No DB writes. No deletions. No Netlify env changes.');
    console.log(
      `[prepare-practice-assets] Real copy requires: PRACTICE_MIGRATION_APPLY=1 PRACTICE_MIGRATION_CONFIRM=${REQUIRED_COPY_CONFIRM} npm run prepare:practice-assets`,
    );
    if (overwriteEnabled) {
      console.log('[prepare-practice-assets] NOTE: PRACTICE_MIGRATION_OVERWRITE=1 is set but ignored in dry-run.');
    }
  } else {
    console.log('\n[prepare-practice-assets] APPLY MODE');
    console.log(
      `[prepare-practice-assets] sourceBucket=${sourceBucket} targetBucket=${targetBucket} pathMode=${pathMode} overwriteEnabled=${overwriteEnabled}`,
    );
    console.log('[prepare-practice-assets] Will copy eligible Practice tracks only (scanStatus=ready).');
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

    let scanStatus: ScanStatus;
    if (!sourceMidiKey || !sourceXmlKey) {
      scanStatus = 'missing_path';
    } else {
      const midiPs = midiSourceProbeStatus;
      const xmlPs = xmlSourceProbeStatus;
      const anySourceProbeError = midiPs === 'probe_error' || xmlPs === 'probe_error';
      if (anySourceProbeError) {
        probeErrorCount += 1;
        scanStatus = 'probe_error';
      } else if (midiPs === 'missing' || xmlPs === 'missing') {
        scanStatus = 'missing_source_object';
      } else if (!targetBucketExists) {
        scanStatus = 'ready_target_bucket_missing';
      } else if (midiTargetProbeStatus === 'probe_error' || xmlTargetProbeStatus === 'probe_error') {
        probeErrorCount += 1;
        scanStatus = 'target_probe_error';
      } else if (midiTargetExists || xmlTargetExists) {
        scanStatus = 'target_already_exists';
      } else {
        scanStatus = 'ready';
      }
    }

    const initCopyStatus = (): CopyObjectStatus => {
      if (!sourceMidiKey || !sourceXmlKey) return 'not_applicable';
      if (scanStatus !== 'ready') return 'not_applicable';
      return 'pending';
    };

    const midiCopyStatus = initCopyStatus();
    const xmlCopyStatus = initCopyStatus();

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
      scanStatus,
      /** Populated after optional apply pass; scan-time equals scanStatus. */
      status: scanStatus,
      finalStatus: scanStatus,
      notes: notes.length ? notes : undefined,
      midiCopyStatus,
      xmlCopyStatus,
    });
  }

  /** ---------------- APPLY COPY PASS (optional) ---------------- */
  let copiedObjectCount = 0;
  let skippedExistingCount = 0;
  let copyFailedCount = 0;
  let partialFailureCount = 0;
  const copyMethodAcc: Record<CopyMethod, number> = {
    supabase_storage_copy_api: 0,
    download_upload_fallback: 0,
  };

  if (!dryRun) {
    const eligible = items.filter(i => i.scanStatus === 'ready');
    let processedTracks = 0;

    for (const item of eligible) {
      processedTracks += 1;
      if (processedTracks === 1 || processedTracks % 25 === 0) {
        console.log(`[prepare-practice-assets] copy progress: ${processedTracks}/${eligible.length} tracks`);
      }

      const sm = item.sourceMidiKey!;
      const sx = item.sourceXmlKey!;
      const tm = item.targetMidiKey!;
      const tx = item.targetXmlKey!;

      const copyOne = async (which: 'midi' | 'xml', sourceKey: string, targetKey: string) => {
        const beforeSrc = await probeStorageObject(supabase, sourceBucket, sourceKey);
        if (beforeSrc.status !== 'exists') {
          const msg = `pre_copy_source_not_exists(${which}: ${beforeSrc.status})`;
          return {ok: false as const, skipped: false as const, msg};
        }

        const beforeTgt = await probeStorageObject(supabase, targetBucket, targetKey);
        if (beforeTgt.status === 'probe_error') {
          const msg = `pre_copy_target_probe_error(${which}: ${beforeTgt.errorMessage ?? 'unknown'})`;
          return {ok: false as const, skipped: false as const, msg};
        }
        if (beforeTgt.status === 'exists' && !overwriteEnabled) {
          return {ok: true as const, skipped: true as const, msg: 'skipped_existing'};
        }
        if (beforeTgt.status === 'exists' && overwriteEnabled) {
          /** proceed */
        }

        const res = await copyObjectAcrossBuckets({
          supabase,
          sourceBucket,
          targetBucket,
          sourceKey,
          targetKey,
          overwrite: overwriteEnabled && beforeTgt.status === 'exists',
        });

        if (!res.ok) {
          return {ok: false as const, skipped: false as const, msg: res.message};
        }
        copyMethodAcc[res.method] += 1;

        const afterTgt = await probeStorageObject(supabase, targetBucket, targetKey);
        if (afterTgt.status !== 'exists') {
          const msg = `post_copy_target_missing(${which}: ${afterTgt.status})`;
          return {ok: false as const, skipped: false as const, msg};
        }

        return {ok: true as const, skipped: false as const, msg: 'copied'};
      };

      const midiRes = await copyOne('midi', sm, tm);
      if (midiRes.skipped) {
        item.midiCopyStatus = 'skipped_existing';
        skippedExistingCount += 1;
      } else if (midiRes.ok) {
        item.midiCopyStatus = 'copied';
        copiedObjectCount += 1;
      } else {
        item.midiCopyStatus = 'failed';
        item.midiCopyError = midiRes.msg;
        copyFailedCount += 1;
      }

      const xmlRes = await copyOne('xml', sx, tx);
      if (xmlRes.skipped) {
        item.xmlCopyStatus = 'skipped_existing';
        skippedExistingCount += 1;
      } else if (xmlRes.ok) {
        item.xmlCopyStatus = 'copied';
        copiedObjectCount += 1;
      } else {
        item.xmlCopyStatus = 'failed';
        item.xmlCopyError = xmlRes.msg;
        copyFailedCount += 1;
      }

      const midiOk = item.midiCopyStatus === 'copied' || item.midiCopyStatus === 'skipped_existing';
      const xmlOk = item.xmlCopyStatus === 'copied' || item.xmlCopyStatus === 'skipped_existing';
      const midiFail = item.midiCopyStatus === 'failed';
      const xmlFail = item.xmlCopyStatus === 'failed';

      if (midiOk && xmlOk) {
        const midiCopied = item.midiCopyStatus === 'copied';
        const xmlCopied = item.xmlCopyStatus === 'copied';
        const midiSkipped = item.midiCopyStatus === 'skipped_existing';
        const xmlSkipped = item.xmlCopyStatus === 'skipped_existing';

        if (midiCopied || xmlCopied) {
          /** At least one side was actually copied (the other may still be skipped_existing). */
          item.finalStatus = 'copied';
        } else if (midiSkipped && xmlSkipped) {
          item.finalStatus = 'skipped_existing';
        } else {
          /** Should not happen, but keep it explicit. */
          item.finalStatus = 'failed';
        }
        item.status = item.finalStatus;
      } else if ((midiFail && xmlOk) || (xmlFail && midiOk)) {
        partialFailureCount += 1;
        item.finalStatus = 'partial_failure';
        item.status = item.finalStatus;
        item.notes = [...(item.notes ?? []), 'partial_failure_track'];
      } else {
        /** Both failed (or inconsistent — treat as failed) */
        item.finalStatus = 'failed';
        item.status = item.finalStatus;
      }
    }
  } else {
    const plannedObjects = items.filter(i => i.scanStatus === 'ready').length * 2;
    console.log(`[prepare-practice-assets] Planned objects to copy (if APPLY+CONFIRM): ${plannedObjects}`);
  }

  const summary: Summary = {
    dryRun,
    applyRequested,
    confirmed,
    overwriteEnabled,
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
    copiedObjectCount,
    skippedExistingCount,
    copyFailedCount,
    partialFailureCount,
  };

  const copyMethodNote = dryRun
    ? 'dry_run_only (implementation prefers supabase.storage.from(source).copy(..., {destinationBucket: target}); fallback download+upload if copy fails)'
    : `used_methods: copy_api=${copyMethodAcc.supabase_storage_copy_api}, download_upload_fallback=${copyMethodAcc.download_upload_fallback}`;

  writeReportFile(reportPath, {
    generatedAt: new Date().toISOString(),
    copyMethodNote,
    sourceBucket,
    sourceBucketExists,
    targetBucket,
    targetBucketExists,
    pathMode,
    summary,
    items,
  });

  if (dryRun) {
    console.log('\n[prepare-practice-assets] Dry-run completed.');
  } else {
    console.log('\n[prepare-practice-assets] Apply pass completed.');
  }
  console.log(`[prepare-practice-assets] sourceBucket=${sourceBucket} targetBucket=${targetBucket}`);
  console.log(`[prepare-practice-assets] pathMode=${pathMode}`);
  console.log(`[prepare-practice-assets] report=${reportPath}`);
  console.log('\nSummary:');
  console.log(JSON.stringify(summary, null, 2));

  printSample('Sample anomalies: missing path', items, i => i.scanStatus === 'missing_path');
  printSample(
    'Sample anomalies: missing source object (confirmed)',
    items,
    i => i.scanStatus === 'missing_source_object',
  );
  printSample('Sample anomalies: source probe error (ambiguous)', items, i => i.scanStatus === 'probe_error');
  printSample(
    'Sample anomalies: target probe error (ambiguous)',
    items,
    i => i.scanStatus === 'target_probe_error',
  );
  printSample('Sample anomalies: target already exists', items, i => i.scanStatus === 'target_already_exists');
  printSample('Sample anomalies: partial failure (apply)', items, i => i.finalStatus === 'partial_failure');
}

main().catch((err) => {
  console.error('[prepare-practice-assets] failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
