import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const importsRoot = path.join(projectRoot, 'public', 'local-imports');
const outputFile = path.join(projectRoot, 'src', 'local-import-seeds.generated.ts');

/** Slugs removed from the catalog (user request) */
const EXCLUDED_SLUGS = new Set([
  /** 已由 `Falling You（刘耀文）` / `Falling You（都智文 曾可妮）` 两文件夹拆条替代。 */
  'falling you',
  '生如夏花',
  /** Merged into `Merry Christmas Mr.Lawrence` (same piece; duplicate catalog entry removed). */
  '圣诞快乐',
  /** Typo duplicate of `komorebi`; canonical track + assets live under `komorebi`. */
  'komoberi',
  /** Duplicate of `mitsuha-theme` (same piece; wrong 华语流行 tagging). */
  '三叶的主题',
  /** User request: remove from catalog. */
  '没有你',
  /** User request: remove from catalog (duplicate/low-quality listing). */
  '不想你离开啊',
]);

const STANDARD_FILES = {
  audioFile: 'audio.mp3',
  musicxmlFile: 'score.musicxml',
  midiFile: 'performance.mid',
};

const FILE_TYPE_RULES = {
  audioFile: {
    targetName: STANDARD_FILES.audioFile,
    extensions: ['.mp3'],
  },
  musicxmlFile: {
    targetName: STANDARD_FILES.musicxmlFile,
    extensions: ['.musicxml'],
  },
  midiFile: {
    targetName: STANDARD_FILES.midiFile,
    extensions: ['.mid', '.midi'],
  },
};

const hasCjkCharacters = (value) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);

const toTitleFromSlug = (slug) =>
  slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const inferTitleFromSlug = (slug) => (hasCjkCharacters(slug) ? slug : toTitleFromSlug(slug));

const slugToId = (slug) => {
  const normalized = slug
    .normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '_')
    .replace(/^_+|_+$/g, '');

  return `local_${normalized || 'track'}`;
};

const directories = fs.existsSync(importsRoot)
  ? fs.readdirSync(importsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  : [];

const seeds = [];
const warnings = [];

const listVisibleFiles = (dirPath) =>
  fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);

const findMatchingFiles = (files, extensions) =>
  files.filter((file) => extensions.includes(path.extname(file).toLowerCase()));

const rankCandidate = (field, fileName, stats) => {
  const lower = fileName.toLowerCase();
  let score = 0;

  if (field === 'audioFile') {
    if (lower.includes('cip music') && (lower.includes('编配演奏') || lower.includes('piano cover'))) score += 200;
    if (lower.includes('钢琴示例')) score += 120;
    if (lower.includes('audio')) score += 20;
  }

  if (field === 'midiFile') {
    // Prefer the newest MIDI file when duplicates exist.
    score += Math.floor(stats.mtimeMs / 1000);
  }

  if (field === 'musicxmlFile') {
    if (lower.includes('mscz')) score += 120;
    if (lower.includes('score')) score += 40;
    // Prefer recently exported MusicXML variants.
    score += Math.floor(stats.mtimeMs / 2000);
  }

  return score;
};

const pickBestCandidate = (field, dirPath, matches) => {
  const ranked = matches.map((name) => {
    const fullPath = path.join(dirPath, name);
    const stats = fs.statSync(fullPath);
    return {
      name,
      score: rankCandidate(field, name, stats),
      mtimeMs: stats.mtimeMs,
    };
  });

  ranked.sort((a, b) => b.score - a.score || b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
  return ranked[0];
};

const standardizeSongFolderFiles = (slug, dirPath) => {
  const files = listVisibleFiles(dirPath);
  const resolved = {};
  let missingRequiredAudio = false;

  for (const [field, rule] of Object.entries(FILE_TYPE_RULES)) {
    const matches = findMatchingFiles(files, rule.extensions);

    if (matches.length === 0) {
      if (field === 'audioFile') {
        warnings.push(`Skipping "${slug}" because no ${field} was found (${rule.extensions.join(', ')})`);
        missingRequiredAudio = true;
      } else {
        warnings.push(`"${slug}" missing optional ${field}; Practice Mode will be disabled.`);
      }
      continue;
    }

    const uniqueMatches = Array.from(new Set(matches));
    const chosen = pickBestCandidate(field, dirPath, uniqueMatches);
    const sourceName = chosen.name;
    const targetName = rule.targetName;
    const sourcePath = path.join(dirPath, sourceName);
    const targetPath = path.join(dirPath, targetName);

    if (uniqueMatches.length > 1) {
      const ignored = uniqueMatches.filter((name) => name !== sourceName);
      warnings.push(`Using "${sourceName}" for "${slug}" ${field}; ignored: ${ignored.join(', ')}`);
    }

    if (sourceName !== targetName) {
      if (!fs.existsSync(targetPath)) {
        fs.renameSync(sourcePath, targetPath);
        resolved[field] = targetName;
      } else {
        // Keep both files when target already exists; use selected source in seed.
        resolved[field] = sourceName;
      }
    } else {
      resolved[field] = targetName;
    }
  }

  return missingRequiredAudio ? null : resolved;
};

for (const entry of directories) {
  const slug = entry.name;
  if (EXCLUDED_SLUGS.has(slug)) {
    continue;
  }
  const dirPath = path.join(importsRoot, slug);
  const standardizedFiles = standardizeSongFolderFiles(slug, dirPath);

  if (!standardizedFiles) {
    continue;
  }

  seeds.push({
    id: slugToId(slug),
    slug,
    ...standardizedFiles,
    titleOverride: inferTitleFromSlug(slug),
  });
}

seeds.sort((a, b) => a.slug.localeCompare(b.slug));

const fileContents = `export const LOCAL_IMPORT_SEEDS = ${JSON.stringify(seeds, null, 2)} as const;\n`;

fs.writeFileSync(outputFile, fileContents, 'utf8');

if (warnings.length > 0) {
  console.warn('[generate-local-import-seeds] Warnings:');
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
}

console.log(`[generate-local-import-seeds] Wrote ${seeds.length} seed(s) to ${path.relative(projectRoot, outputFile)}`);
