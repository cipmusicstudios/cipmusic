import {build} from 'esbuild';
import {mkdir, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';

const entries = [
  'verify-app-store-transaction',
  'app-store-notifications-v2',
  'app-store-notifications-v2-sandbox',
];
const outdir = '.apple-function-build';
await rm(outdir, {recursive: true, force: true});
await mkdir(outdir, {recursive: true});

for (const name of entries) {
  const outfile = join(outdir, `${name}.mjs`);
  await build({
    entryPoints: [`netlify/functions/${name}.ts`], outfile, bundle: true,
    platform: 'node', target: 'node20', format: 'esm', sourcemap: false,
    logLevel: 'silent', external: ['better-sqlite3'],
  });
  const size = (await stat(outfile)).size;
  process.stdout.write(`${name}\t${size}\n`);
}
