#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

const PREVIEW_CONTEXTS = new Set(['deploy-preview', 'branch-deploy']);

export function validateBuildContext(env = process.env) {
  const netlifyContext = env.CONTEXT?.trim() || '';
  const context = env.VITE_DEPLOY_CONTEXT?.trim() || '';
  const mode = env.VITE_MANIFEST_MODE?.trim() || '';
  if (!netlifyContext && !context && !mode) return { context: 'local', mode: 'local-default', isPreview: false };
  if (netlifyContext !== context) {
    throw new Error(`[build-context] Netlify context mismatch: CONTEXT=${netlifyContext || 'missing'}, VITE_DEPLOY_CONTEXT=${context || 'missing'}`);
  }
  if (context === 'production' && mode === 'production-generated') return { context, mode, isPreview: false };
  if (PREVIEW_CONTEXTS.has(context) && mode === 'committed-preview-snapshot') return { context, mode, isPreview: true };
  throw new Error(`[build-context] invalid deploy context/manifest mode combination: context=${context || 'missing'}, mode=${mode || 'missing'}`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = validateBuildContext();
    console.log(`[build-context] valid: ${result.context}/${result.mode}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
