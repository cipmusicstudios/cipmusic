#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseRef = process.env.TYPESCRIPT_DIFF_BASE || 'origin/main';
const dependencies = process.env.NODE_MODULES_DIR || path.join(root, 'node_modules');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cip-tsc-diff-'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: options.encoding ?? 'utf8', maxBuffer: 200 * 1024 * 1024, ...options });
  if (options.allowFailure !== true && result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result;
}

function extractErrors(output) {
  return output.split('\n')
    .filter(line => /\(\d+,\d+\): error TS\d+:/.test(line))
    .map(line => line.replace(/\(\d+,\d+\)/, '(L,C)').replaceAll('\\', '/'));
}

try {
  assert.ok(fs.existsSync(dependencies), `node_modules not found: ${dependencies}`);
  const dirs = { base: path.join(tmp, 'base'), head: path.join(tmp, 'head') };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir);
  for (const [name, ref] of [['base', baseRef], ['head', 'HEAD']]) {
    const archive = run('git', ['archive', ref], { cwd: root, encoding: null });
    run('tar', ['-x', '-C', dirs[name]], { input: archive.stdout });
    fs.symlinkSync(dependencies, path.join(dirs[name], 'node_modules'));
  }
  const workingDiff = run('git', ['diff', '--binary', 'HEAD'], { cwd: root, encoding: null }).stdout;
  if (workingDiff.length > 0) run('git', ['apply', '--binary', '-'], { cwd: dirs.head, input: workingDiff });
  const results = {};
  const rawCounts = {};
  for (const [name, dir] of Object.entries(dirs)) {
    const tsc = spawnSync(path.join(dependencies, '.bin', 'tsc'), ['--noEmit'], { cwd: dir, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
    const errors = extractErrors(`${tsc.stdout || ''}\n${tsc.stderr || ''}`);
    rawCounts[name] = errors.length;
    results[name] = new Set(errors);
  }
  const added = [...results.head].filter(error => !results.base.has(error));
  assert.deepEqual(added, [], `HEAD adds TypeScript errors:\n${added.join('\n')}`);
  console.log(`[typescript-diff] no new errors; raw base=${rawCounts.base}, raw head=${rawCounts.head}, normalized base=${results.base.size}, normalized head=${results.head.size}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
