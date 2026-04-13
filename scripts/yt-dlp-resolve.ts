/**
 * Resolve `yt-dlp` CLI or `python3 -m yt_dlp` so manifest export / enrich work without Homebrew-only installs.
 */
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';

export type YtDlpInvocation = { executable: string; baseArgs: string[] };

export function resolveYtDlp(): YtDlpInvocation | null {
  try {
    execFileSync('yt-dlp', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { executable: 'yt-dlp', baseArgs: [] };
  } catch {
    try {
      execFileSync('python3', ['-m', 'yt_dlp', '--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return { executable: 'python3', baseArgs: ['-m', 'yt_dlp'] };
    } catch {
      return null;
    }
  }
}

export function execYtDlp(args: string[], options: ExecFileSyncOptions): string {
  const inv = resolveYtDlp();
  if (!inv) throw new Error('yt-dlp not found (install: pip install yt-dlp, or brew install yt-dlp)');
  return execFileSync(inv.executable, [...inv.baseArgs, ...args], options);
}

export type ExecYtDlpLenientResult = { stdout: string; status: number; stderr: string };

/**
 * Like `execYtDlp` but never throws on non-zero exit; merges stdout/stderr from the error object.
 * Use when `--ignore-errors` still yields exit 1 after many per-video failures (e.g. YouTube rate limits).
 */
export function execYtDlpLenient(args: string[], options: ExecFileSyncOptions): ExecYtDlpLenientResult {
  const inv = resolveYtDlp();
  if (!inv) throw new Error('yt-dlp not found (install: pip install yt-dlp, or brew install yt-dlp)');
  const argv = [...inv.baseArgs, ...args];
  try {
    const stdout = execFileSync(inv.executable, argv, options);
    return { stdout: typeof stdout === 'string' ? stdout : String(stdout), status: 0, stderr: '' };
  } catch (e: unknown) {
    const o = e as { stdout?: unknown; stderr?: unknown; status?: number };
    return {
      stdout: typeof o.stdout === 'string' ? o.stdout : Buffer.isBuffer(o.stdout) ? o.stdout.toString('utf8') : '',
      stderr: typeof o.stderr === 'string' ? o.stderr : Buffer.isBuffer(o.stderr) ? o.stderr.toString('utf8') : '',
      status: typeof o.status === 'number' ? o.status : 1,
    };
  }
}
