import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { transliterate } from 'transliteration';

const ROOT = process.cwd();
const SEEDS_FILE = path.join(ROOT, 'src/local-import-seeds.generated.ts');
const OVERRIDES_FILE = path.join(ROOT, 'src/local-import-metadata-overrides.ts');
const OUT_FILE = path.join(ROOT, 'src/local-import-cip-links.generated.ts');
const CHANNEL_SEARCH = 'https://www.youtube.com/@CIPMusic/search?query=';
/** `risk`（默认）只重跑高风险 slug；`all` 全量（慎用）。 */
const CIP_LINKS_MODE = (process.env.CIP_LINKS_MODE || 'risk').trim().toLowerCase();
const CIP_LINKS_RISK_ALL = CIP_LINKS_MODE === 'all';
const MIN_POOL_SCORE = Math.max(60, Number(process.env.CIP_MIN_POOL_SCORE ?? '88') || 88);
const SHORT_TITLE_MIN_SCORE = Math.max(100, Number(process.env.CIP_SHORT_TITLE_MIN_SCORE ?? '115') || 115);
const NO_ARTIST_MIN_SCORE = Math.max(100, Number(process.env.CIP_NO_ARTIST_MIN_SCORE ?? '128') || 128);

const evaluateExportedConst = (filePath, exportName) => {
  let source = readFileSync(filePath, 'utf8');
  return evaluateExportedConstFromSource(source, exportName, filePath);
};

const evaluateExportedConstFromSource = (sourceText, exportName, filename = 'virtual.ts') => {
  let source = sourceText
    .replace(/export type[\s\S]*?};\n\n/g, '')
    .replace(new RegExp(`export const\\s+${exportName}\\s*=\\s*`), `const ${exportName} = `)
    .replace(new RegExp(`export const\\s+${exportName}\\s*:\\s*[\\s\\S]*?=\\s*`), `const ${exportName} = `)
    .replace(/\sas const;/g, ';')
    .concat(`\nglobalThis.__EXPORT__ = ${exportName};\n`);
  const context = { globalThis: {} };
  vm.runInNewContext(source, context, { filename });
  return context.globalThis.__EXPORT__;
};

/** 与 strip 后处理共用：仅当命中下列规则才「明显错误」清空（三档里的第 3 档） */
const STRIP_TOXIC_VIDEO_MATCHES = [
  {
    slug: '灯火万家',
    test: (vt) => /in bloom|zerobaseone|제로베이스원/i.test(vt || ''),
    reason: 'ZB1 In Bloom is not 灯火万家 (OST); prevents regen from re-binding wrong video',
  },
  {
    slug: '不冬眠',
    test: (vt) => /《Blue》|liu yao wen.*blue|刘耀文《blue》/i.test(vt || ''),
    reason: 'Wrong Liu Yaowen Blue upload bound to 不冬眠',
  },
  {
    slug: '你不属于我',
    test: (vt) => /《Blue》|liu yao wen.*blue|刘耀文《blue》/i.test(vt || ''),
    reason: 'Same wrong Blue video as 不冬眠',
  },
  {
    slug: '余生请多指教',
    test: (vt) => /愛丫愛丫|爱丫爱丫|by2.*ai ya/i.test(vt || ''),
    reason: 'By2 爱丫爱丫 mis-bound to 余生请多指教 title',
  },
  {
    slug: '决爱',
    test: (vt) => /风之海|sea of wind/i.test(vt || ''),
    reason: '华晨宇 风之海 mis-bound to 诀爱 slug',
  },
  {
    slug: '只因你太美',
    test: (vt) => /hug me/i.test(vt || ''),
    reason: 'Hug Me mis-bound to 只因你太美',
  },
  {
    slug: '圣诞快乐',
    test: (vt) => /epsilon|一小时钢琴|1hour piano/i.test(vt || ''),
    reason: '刘雨昕 EP hour loop is not a titled 圣诞快乐 cover',
  },
  {
    slug: '在意',
    test: (vt) => /哭泣的游戏|dusty schoolbag/i.test(vt || ''),
    reason: '哭泣的游戏 video mis-bound to 在意',
  },
  {
    slug: '我们一起闯',
    test: (vt) => /radio piano cover.*henry|헨리.*刘宪华/i.test(vt || ''),
    reason: 'Henry Radio cover mis-bound to 我们一起闯',
  },
  {
    slug: '抬起头啊',
    test: (vt) => /背对地球奔跑|sunset ocean/i.test(vt || ''),
    reason: '背对地球奔跑 mis-bound to 抬起头啊',
  },
  {
    slug: '无人乐园',
    test: (vt) => /若想念飞行/i.test(vt || ''),
    reason: '若想念飞行 mis-bound to 无人乐园',
  },
  {
    slug: '明天见',
    test: (vt) => /洄 \(by now\)|by now.*jellorio|李佳隆/i.test(vt || ''),
    reason: '洄 By Now mis-bound to 明天见',
  },
  {
    slug: '明早老地方出发',
    test: (vt) => /into1 piano collections|一周年钢琴/i.test(vt || ''),
    reason: 'INTO1 collection mis-bound to 明早老地方出发',
  },
  {
    slug: '水龙吟',
    test: (vt) => /jump to the breeze|碧蓝航线|kodakumi.*小室/i.test(vt || ''),
    reason: '碧蓝航线 Koda Kumi mis-bound to 水龙吟 (不同曲)',
  },
  {
    slug: '还在流浪',
    test: (vt) => /上海.*一九四三|shanghai 1943/i.test(vt || ''),
    reason: '上海一九四三 mis-bound to 还在流浪',
  },
  {
    slug: '这么可爱真是抱歉',
    test: (vt) => /向阳而生|growing toward the sun/i.test(vt || ''),
    reason: '向阳而生 mis-bound to 这么可爱真是抱歉',
  },
];

function loadGitSnapshotLinks() {
  const ref = process.env.CIP_PREV_SNAPSHOT_REF?.trim();
  if (!ref) return null;
  try {
    const txt = execFileSync('git', ['show', `${ref}:src/local-import-cip-links.generated.ts`], {
      encoding: 'utf8',
      maxBuffer: 40 * 1024 * 1024,
    });
    return evaluateExportedConstFromSource(txt, 'LOCAL_IMPORT_CIP_LINKS', `git:${ref}`);
  } catch (e) {
    console.warn('[cip] CIP_PREV_SNAPSHOT_REF failed:', (e && e.message) || e);
    return null;
  }
}

function obviousWrongVideo(seed, prevRow) {
  const vt = prevRow?.matchedVideoTitle || '';
  for (const { slug, test } of STRIP_TOXIC_VIDEO_MATCHES) {
    if (slug !== seed.slug) continue;
    if (test(vt)) return true;
  }
  return false;
}

const LOCAL_IMPORT_SEEDS = evaluateExportedConst(SEEDS_FILE, 'LOCAL_IMPORT_SEEDS');
const LOCAL_IMPORT_METADATA_OVERRIDES = evaluateExportedConst(
  OVERRIDES_FILE,
  'LOCAL_IMPORT_METADATA_OVERRIDES',
);

const normalize = (value) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d'"`]/g, '')
    .replace(/[()（）【】[\]{}《》“”‘’:,|\-–—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeStrictTitle = (value) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d'"`]/g, '')
    .replace(/[()（）【】[\]{}《》“”‘’:,|_\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const hasCjk = (value) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);

const AUDIO_STEM_BLACKLIST = new Set(['audio', 'score', 'performance', 'track', 'song', 'music']);

const needsPunctuationSensitiveMatch = (value) => {
  const normalized = normalize(value);
  const compact = normalized.replace(/\s+/g, '');
  return !hasCjk(value) && compact.length <= 4;
};

const extractQuotedTitles = (title) =>
  Array.from(
    title.matchAll(/[“"'‘]([^”"'’]+)[”"'’]/g),
    (match) => match[1]?.trim(),
  ).filter(Boolean);

const extractBestTitleAnchor = (title) => {
  const decoded = decodeHtmlEntities(title || '');
  const quoted = extractQuotedTitles(decoded);
  if (quoted.length > 0) return quoted[0];
  return decoded;
};

const toTitleCase = (value) =>
  value
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, char) => char.toUpperCase());

const pushCandidate = (target, value, priority = 0) => {
  const trimmed = value?.trim();
  if (!trimmed) return;
  const existing = target.find((entry) => entry.value === trimmed);
  if (existing) {
    existing.priority = Math.max(existing.priority, priority);
    return;
  }
  target.push({ value: trimmed, priority });
};

const splitDisambiguatedTitle = (value) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(.*?)\s*[（(]\s*([^()（）]+)\s*[）)]\s*$/);
  if (!match) return null;
  const baseTitle = match[1]?.trim();
  const artistHint = match[2]?.trim();
  if (!baseTitle || !artistHint) return null;
  return { baseTitle, artistHint };
};

const extractDisambiguationHintFromSeed = (seed) => {
  const override = LOCAL_IMPORT_METADATA_OVERRIDES[seed.slug];
  const candidates = [
    override?.title,
    override?.displayTitle,
    override?.titles?.zhHans,
    override?.titles?.zhHant,
    seed.titleOverride,
    seed.slug,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const disambiguated = splitDisambiguatedTitle(candidate);
    if (disambiguated?.artistHint) return disambiguated.artistHint;
  }
  return null;
};

const DISAMBIGUATION_ALIASES = {
  svt: ['svt', 'seventeen'],
  seventeen: ['seventeen', 'svt'],
  twice: ['twice'],
};

const normalizeHint = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const titleMatchesDisambiguationHint = (title, hint) => {
  if (!hint) return true;
  const normalizedTitle = normalizeHint(decodeHtmlEntities(title || ''));
  const normalizedHint = normalizeHint(hint);
  if (!normalizedTitle || !normalizedHint) return true;
  if (normalizedTitle.includes(normalizedHint)) return true;
  const aliasKey = normalizedHint.replace(/\s+/g, '');
  const aliases = DISAMBIGUATION_ALIASES[aliasKey] || [normalizedHint];
  return aliases.some((alias) => normalizedTitle.includes(normalizeHint(alias)));
};

const getCandidates = (seed) => {
  const override = LOCAL_IMPORT_METADATA_OVERRIDES[seed.slug];
  const audioStemRaw =
    typeof seed.audioFile === 'string'
      ? seed.audioFile
          .replace(/\.(mp3|wav|m4a|flac)$/i, '')
          .replace(/\s*钢琴示例.*$/i, '')
          .replace(/\s*-\s*CIP\s*Music.*$/i, '')
          .replace(/\s*编配.*$/i, '')
          .trim()
      : '';
  const audioStem =
    audioStemRaw &&
    audioStemRaw.length >= 2 &&
    !AUDIO_STEM_BLACKLIST.has(audioStemRaw.toLowerCase())
      ? audioStemRaw
      : '';
  const baseValues = [
    override?.title,
    override?.displayTitle,
    override?.titles?.zhHans,
    override?.titles?.zhHant,
    override?.titles?.en,
    seed.titleOverride,
    audioStem || undefined,
    seed.slug,
  ].filter(Boolean);
  const values = [];

  for (const value of baseValues) {
    const trimmed = value.trim();
    const disambiguated = splitDisambiguatedTitle(trimmed);
    if (disambiguated) {
      pushCandidate(values, `${disambiguated.baseTitle} ${disambiguated.artistHint}`, 220);
      pushCandidate(values, `${disambiguated.baseTitle} ${toTitleCase(disambiguated.artistHint)}`, 205);
      pushCandidate(values, disambiguated.baseTitle, 160);
    }

    pushCandidate(values, trimmed, 100);

    const dehyphenated = trimmed.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    pushCandidate(values, dehyphenated, 80);

    const unpunctuated = trimmed.replace(/[()（）【】[\]{}《》“”‘’:,|_\-–—.!?'"`]+/g, ' ').replace(/\s+/g, ' ').trim();
    pushCandidate(values, unpunctuated, 60);

    if (hasCjk(trimmed)) {
      const romanized = transliterate(trimmed).replace(/[^A-Za-z0-9\s'-]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (romanized) {
        pushCandidate(values, romanized, 40);
        pushCandidate(values, toTitleCase(romanized), 35);
      }
    }
  }

  const primaryTitle = override?.title || override?.displayTitle || seed.titleOverride;
  if (override?.artist && primaryTitle) {
    pushCandidate(values, `${override.artist} ${primaryTitle}`.trim(), 118);
    pushCandidate(values, `${primaryTitle} ${override.artist}`.trim(), 117);
  }

  return values
    .sort((a, b) => b.priority - a.priority || b.value.length - a.value.length)
    .slice(0, 6)
    .map((entry) => entry.value);
};

const stripDescriptorWords = (value) =>
  (value || '')
    .replace(/\b(piano\s+cover|piano\s+by\s+cip\s+music|cover\s+by\s+cip\s+music|cip\s+music)\b/gi, ' ')
    .replace(/钢琴完整版|钢琴版|鋼琴版|钢琴\s*cover|翻奏|演奏版/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getRelaxedCandidates = (seed) => {
  const base = getCandidates(seed);
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const t = v?.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const b of base) {
    push(b);
    const stripped = stripDescriptorWords(b);
    if (stripped && stripped !== b) push(stripped);
    const parts = stripped.split(/\s+/).filter((w) => w.length > 1);
    if (parts.length >= 2) push(parts.slice().reverse().join(' '));
    if (parts.length >= 2) push(`${parts[parts.length - 1]} ${parts[0]}`);
  }
  if (seed.slug === 'komoberi') {
    push('komorebi');
    push('komorebi m-taku');
    push('m-taku komorebi');
  }
  return out.slice(0, 14);
};

const extractWatchIds = (html) =>
  [...new Set(Array.from(html.matchAll(/watch\?v=([A-Za-z0-9_-]{11})/g)).map((m) => m[1]))];

const extractSearchResults = (html) => {
  const results = [];
  const seen = new Set();
  const pattern = /"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,1200}?"title":\{"runs":\[\{"text":"([^"]+)/g;

  for (const match of html.matchAll(pattern)) {
    const id = match[1];
    const title = decodeHtmlEntities(match[2] || '').trim();
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    results.push({ id, title });
  }

  if (results.length > 0) return results;

  return extractWatchIds(html).map((id) => ({ id, title: '' }));
};

const extractTitle = (html) => {
  const match = html.match(/<title>(.*?)<\/title>/i);
  return decodeHtmlEntities(match?.[1] || '').replace(/\s*-\s*YouTube\s*$/i, '').trim() || '';
};

const extractOEmbedTitle = (url) => {
  try {
    const payload = JSON.parse(
      execFileSync(
        'curl',
        ['-L', `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`],
        { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
      ),
    );
    return decodeHtmlEntities(payload?.title || '').trim();
  } catch {
    return '';
  }
};

const decodeHtmlEntities = (value) =>
  (value || '')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const unescapeYoutubeJsonString = (s) =>
  (s || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\u0026/g, '&');

/** Full video description from embedded ytInitialPlayerResponse (not limited to visible DOM). */
const extractYoutubeShortDescription = (html) => {
  const m = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
  if (!m?.[1]) return '';
  return unescapeYoutubeJsonString(m[1]);
};

const resolveShortUrlOnce = (url) => {
  const u = url.trim();
  if (!/bit\.ly|tinyurl\.com|tiny\.cc|goo\.gl/i.test(u)) return u;
  try {
    const out = execFileSync('curl', ['-sIL', '-A', 'Mozilla/5.0', u], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    const loc = out.match(/^location:\s*(.+)$/im);
    return loc ? loc[1].trim() : u;
  } catch {
    return u;
  }
};

const SHEET_LINE_RE =
  /譜|楽谱|樂譜|谱子|曲谱|五线谱|简谱|钢谱|PDF譜|sheet|scores?|譜面|ピアノ譜|악보|tab(s)?|buy\s*sheet|purchase\s*sheet/i;

const normalizeSheetUrlCandidate = (raw) => {
  let u = raw.trim().replace(/[),.;，。！？、]+$/g, '');
  u = u.replace(/^https:\\\/\\\//i, 'https://').replace(/\\\//g, '/');
  if (!/^https?:\/\//i.test(u)) return null;
  u = resolveShortUrlOnce(u);
  if (/mymusic/i.test(u) && /\/cipmusic\/?$/i.test(u.replace(/\/+$/, ''))) return null;
  const numeric =
    u.match(
      /^https?:\/\/(?:www\.)?(?:mymusic5\.com|mymusic\.st|mymusicfive\.com|mymusicsheet\.com)\/cipmusic\/(\d+)\b/i,
    ) || u.match(/^https?:\/\/(?:www\.)?mymusic\.st\/cipmusic\/(\d+)\b/i);
  if (numeric) {
    const id = numeric[1];
    const host = u.includes('mymusicsheet.com')
      ? 'https://www.mymusicsheet.com'
      : u.includes('mymusic.st')
        ? 'https://mymusic.st'
        : 'https://www.mymusic5.com';
    return `${host}/cipmusic/${id}`;
  }
  const gum = u.match(/^https?:\/\/(?:www\.)?gumroad\.com\/l\/[\w-]+/i);
  if (gum) return gum[0];
  return null;
};

const extractUrlsFromText = (text) => {
  const s = text || '';
  const found = new Set();
  const re = /https?:\/\/[^\s\][)">'"，,；、]+/gi;
  for (const m of s.matchAll(re)) {
    let u = m[0];
    u = u.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
    found.add(u);
  }
  return [...found];
};

const urlLineContextScore = (description, url) => {
  const lines = (description || '').split(/\n/);
  for (const line of lines) {
    if (line.includes(url) || line.replace(/\s/g, '').includes(url.replace(/^https?:\/\//, ''))) {
      return SHEET_LINE_RE.test(line) ? 120 : 10;
    }
  }
  const idx = description.indexOf(url);
  if (idx < 0) return 0;
  const slice = description.slice(Math.max(0, idx - 80), Math.min(description.length, idx + 80));
  return SHEET_LINE_RE.test(slice) ? 90 : 0;
};

const pickBestSheetUrl = (description, fullPageHtml) => {
  const blob = `${description || ''}\n${fullPageHtml || ''}`;
  const candidates = extractUrlsFromText(blob);
  let best = null;
  for (const raw of candidates) {
    const normalized = normalizeSheetUrlCandidate(raw);
    if (!normalized) continue;
    const lineScore = urlLineContextScore(description || '', raw);
    let score = 40 + lineScore;
    if (/cipmusic\/\d+/.test(normalized)) score += 200;
    if (/gumroad\.com\/l\//i.test(normalized)) score += 60;
    if (/youtube\.com|youtu\.be|patreon\.com|buymeacoffee\.com/i.test(normalized)) score -= 80;
    if (!best || score > best.score) best = { url: normalized, score };
  }
  return best && best.score >= 100 ? best.url : null;
};

const extractMymusicCatalogRows = (html) => {
  const parts = html.split('href="/cipmusic/');
  const out = [];
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];
    const idm = chunk.match(/^(\d+)"/);
    if (!idm) continue;
    const tm = chunk.match(/class="[^"]*line-clamp[^"]*"[^>]*>\s*([^<]+)/);
    const title = tm ? decodeHtmlEntities(tm[1]).replace(/<!---->/g, '').trim() : '';
    if (idm[1] && title) out.push({ id: idm[1], title });
  }
  return out;
};

const scoreCandidate = (query, title) => {
  title = decodeHtmlEntities(title || '');
  const q = normalize(query);
  const t = normalize(title);
  if (!q || !t) return -1;
  let score = 0;
  const strictQuery = normalizeStrictTitle(query);
  const strictTitle = normalizeStrictTitle(title);
  const quotedTitles = extractQuotedTitles(title).map(normalizeStrictTitle);
  const punctuationSensitive = needsPunctuationSensitiveMatch(query);

  if (punctuationSensitive) {
    const exactQuotedMatch = quotedTitles.includes(strictQuery);
    const titleHasTerminalPunctuation = quotedTitles.some((candidate) => /^.+[!?]$/.test(candidate)) || /[!?]/.test(title);
    const queryHasTerminalPunctuation = /[!?]/.test(query);

    if (exactQuotedMatch) score += 160;
    else if (strictTitle.includes(strictQuery)) score += 70;

    if (queryHasTerminalPunctuation && !exactQuotedMatch) return -1;
    if (!queryHasTerminalPunctuation && titleHasTerminalPunctuation) return -1;
  }

  if (hasCjk(query)) {
    if (t.includes(q)) score += 100;
    if (t.startsWith(q)) score += 20;
  } else {
    if (t.includes(q)) score += 80;
    const qWords = q.split(' ').filter(Boolean);
    score += qWords.filter((word) => t.includes(word)).length * 10;
  }
  if (t.includes('piano by cip music')) score += 10;
  if (t.includes('piano cover')) score += 5;
  return score;
};

const extractWatchIdFromUrl = (u) => {
  const m = (u || '').match(/[?&]v=([A-Za-z0-9_-]{11})/) || (u || '').match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return m?.[1] || null;
};

const extractWatchIdFromEntry = (row) => extractWatchIdFromUrl(row?.video || row?.youtube || '');

const COMMON_SHORT_TITLE_WORDS = new Set([
  'super',
  'home',
  'y',
  'crush',
  'stay',
  'promise',
  'fire',
  'monster',
  'celebrate',
  'diamond',
  'answer',
  'shine',
  'dna',
  'on',
  'off',
  'up',
  'down',
  'run',
  'go',
  'ai',
  'zoo',
  'normal',
  'see',
  'light',
  '相遇',
  '我们',
  '念',
  '泪桥',
  '悟',
  '舞台',
  '一杯',
  '火焰',
  'into1',
]);

const MANUAL_HIGH_RISK_SLUGS = [
  '灯火万家',
  '不冬眠',
  '你不属于我',
  '余生请多指教',
  '决爱',
  '只因你太美',
  '圣诞快乐',
  '在意',
  '我们一起闯',
  '抬起头啊',
  '无人乐园',
  '明天见',
  '明早老地方出发',
  '水龙吟',
  '还在流浪',
  '这么可爱真是抱歉',
];

function loadExtraRiskSlugs() {
  try {
    const p = path.join(ROOT, 'tmp', 'cip-high-risk-extra.json');
    if (!existsSync(p)) return [];
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const arr = j.slugs ?? j;
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function computeIdToSlugs(existing) {
  const idToSlugs = new Map();
  for (const [slug, row] of Object.entries(existing)) {
    const id = extractWatchIdFromEntry(row);
    if (!id) continue;
    if (!idToSlugs.has(id)) idToSlugs.set(id, []);
    idToSlugs.get(id).push(slug);
  }
  return idToSlugs;
}

function computeDuplicateVideoSlugs(existing) {
  const idToSlugs = computeIdToSlugs(existing);
  const out = new Set();
  for (const slugs of idToSlugs.values()) {
    if (slugs.length > 1) for (const s of slugs) out.add(s);
  }
  return out;
}

function isShortOrCommonTitleSeed(seed) {
  const override = LOCAL_IMPORT_METADATA_OVERRIDES[seed.slug];
  const t = (override?.title || override?.displayTitle || seed.titleOverride || seed.slug || '').trim();
  const compact = t.replace(/\s+/g, '');
  if (compact.length > 0 && compact.length <= 4) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 1 && t.length <= 10 && COMMON_SHORT_TITLE_WORDS.has(t.toLowerCase())) return true;
  return false;
}

function computeHighRiskSlugSet(existing, seeds) {
  const dups = computeDuplicateVideoSlugs(existing);
  const short = new Set(seeds.filter(isShortOrCommonTitleSeed).map((s) => s.slug));
  const manual = new Set(MANUAL_HIGH_RISK_SLUGS);
  for (const s of loadExtraRiskSlugs()) manual.add(s);
  return new Set([...dups, ...short, ...manual]);
}

function getExpectedArtistStrings(seed) {
  const o = LOCAL_IMPORT_METADATA_OVERRIDES[seed.slug];
  return [o?.artist, o?.artists?.zhHans, o?.artists?.zhHant, o?.artists?.en].filter(Boolean);
}

function artistTokensFromString(artistStr) {
  if (!artistStr?.trim()) return [];
  const parts = artistStr
    .split(/[,，/&]|feat\.|ft\.|×|\bx\b/gi)
    .map((x) => x.trim())
    .filter(Boolean);
  const out = [];
  for (const p of parts) {
    const nh = normalizeHint(decodeHtmlEntities(p));
    if (nh.length >= 2) out.push(nh.replace(/\s+/g, ' ').trim());
    if (hasCjk(p)) {
      const tr = transliterate(p)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      if (tr.length >= 3) out.push(tr.replace(/\s+/g, ''));
    }
  }
  return [...new Set(out)];
}

function strictArtistGate(seed, videoTitleRaw) {
  const artists = getExpectedArtistStrings(seed);
  const vt = normalizeHint(decodeHtmlEntities(videoTitleRaw || ''));
  if (!vt) return { ok: false, reason: 'empty_video_title' };
  if (artists.length === 0) return { ok: true, reason: 'no_artist_metadata', needsHighScore: true };
  for (const a of artists) {
    const tokens = artistTokensFromString(a);
    const full = normalizeHint(a).replace(/\s+/g, '');
    if (full.length >= 2 && (vt.includes(full) || vt.replace(/\s+/g, '').includes(full))) {
      return { ok: true, reason: 'artist_full' };
    }
    for (const t of tokens) {
      const compact = t.replace(/\s+/g, '');
      if (compact.length < 2) continue;
      if (vt.includes(t) || vt.replace(/\s+/g, '').includes(compact)) {
        return { ok: true, reason: 'artist_token' };
      }
    }
  }
  return { ok: false, reason: 'artist_mismatch' };
}

function getTitleCandidatesForGate(seed) {
  const override = LOCAL_IMPORT_METADATA_OVERRIDES[seed.slug];
  const raw = [
    override?.title,
    override?.displayTitle,
    override?.titles?.zhHans,
    override?.titles?.zhHant,
    override?.titles?.en,
    seed.titleOverride,
    seed.slug,
  ].filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const n = normalize(r).replace(/\s+/g, ' ').trim();
    if (n.length >= 2 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function strictTitleGate(seed, videoTitleRaw) {
  const vt = normalize(decodeHtmlEntities(videoTitleRaw || ''));
  const anchor = normalize(extractBestTitleAnchor(videoTitleRaw || ''));
  const qs = getTitleCandidatesForGate(seed);
  const quoted = extractQuotedTitles(videoTitleRaw || '').map((x) => normalize(x));
  for (const q of qs) {
    if (q.length < 2) continue;
    if (q.length <= 4) {
      if (quoted.some((qu) => qu.includes(q) || q.includes(qu))) return true;
      if (q.length >= 3 && vt.includes(q)) return true;
      continue;
    }
    if (vt.includes(q) || anchor.includes(q) || (anchor.length >= 4 && q.includes(anchor))) return true;
  }
  for (const q of qs) {
    if (q.length < 4) continue;
    for (const qu of quoted) {
      if (qu.includes(q) || q.includes(qu)) return true;
    }
  }
  return false;
}

function strictValidateBinding(seed, cand, videoIdRegistry) {
  const { id, title, score } = cand;
  const other = videoIdRegistry.map.get(id);
  if (other && other !== seed.slug) return { ok: false, reason: 'video_id_taken_by_' + other };

  const art = strictArtistGate(seed, title);
  if (!art.ok) return { ok: false, reason: art.reason };

  if (!strictTitleGate(seed, title)) return { ok: false, reason: 'title_mismatch' };

  if (art.needsHighScore && score < NO_ARTIST_MIN_SCORE) {
    return { ok: false, reason: 'no_artist_needs_high_score' };
  }

  if (isShortOrCommonTitleSeed(seed) && score < SHORT_TITLE_MIN_SCORE) {
    return { ok: false, reason: 'short_title_low_score' };
  }

  return { ok: true };
}

async function collectSearchPool(seed, disambiguationHint) {
  const pool = new Map();
  const candidates = getCandidates(seed);
  for (const candidate of candidates) {
    const searchHtml = await fetchText(`${CHANNEL_SEARCH}${encodeURIComponent(candidate)}`);
    const results = extractSearchResults(searchHtml).slice(0, 18);
    for (const result of results) {
      const { id, title } = result;
      if (!id || !title) continue;
      if (!titleMatchesDisambiguationHint(title, disambiguationHint)) continue;
      if (needsPunctuationSensitiveMatch(candidate)) {
        const titleAnchor = extractBestTitleAnchor(title);
        const queryStrict = normalizeStrictTitle(candidate);
        const anchorStrict = normalizeStrictTitle(titleAnchor);
        const queryHasTerminalPunctuation = /[!?]/.test(candidate);
        const anchorHasTerminalPunctuation = /[!?]/.test(titleAnchor);
        if (
          (queryHasTerminalPunctuation && queryStrict !== anchorStrict) ||
          (!queryHasTerminalPunctuation && anchorHasTerminalPunctuation)
        ) {
          continue;
        }
      }
      const sc = scoreCandidate(candidate, title);
      if (sc < 0 || sc < MIN_POOL_SCORE) continue;
      const prev = pool.get(id);
      if (!prev || sc > prev.score) {
        pool.set(id, { id, title, score: sc, matchTitle: candidate });
      }
    }
  }
  return [...pool.values()].sort((a, b) => b.score - a.score);
}

function buildInitialVideoRegistry(pruned, resolvingSlugs) {
  const idToSlugs = computeIdToSlugs(pruned);
  const m = new Map();
  for (const [slug, row] of Object.entries(pruned)) {
    if (resolvingSlugs.has(slug)) continue;
    const id = extractWatchIdFromEntry(row);
    if (!id) continue;
    const owners = idToSlugs.get(id) || [];
    if (owners.length > 1) continue;
    m.set(id, slug);
  }
  return m;
}

const fetchText = async (url) => {
  return execFileSync(
    'curl',
    ['-L', '-A', 'Mozilla/5.0', url],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
};

let __mymusicCatalogCache = null;
const loadMymusicCatalog = async () => {
  if (__mymusicCatalogCache) return __mymusicCatalogCache;
  const byId = new Map();
  for (let page = 1; page <= 120; page++) {
    const html = await fetchText(`https://www.mymusic5.com/cipmusic?page=${page}`);
    const rows = extractMymusicCatalogRows(html);
    if (rows.length === 0) break;
    for (const r of rows) {
      if (!byId.has(r.id)) byId.set(r.id, r);
    }
    if (rows.length < 8) break;
  }
  __mymusicCatalogCache = [...byId.values()];
  return __mymusicCatalogCache;
};

const scoreCatalogMatch = (queryRaw, itemTitleRaw) => {
  const q = normalize(queryRaw || '').replace(/\s+/g, ' ').trim();
  const t = normalize(itemTitleRaw || '').replace(/\s+/g, ' ').trim();
  if (!q || !t) return 0;
  const qc = q.replace(/\s+/g, '');
  const tc = t.replace(/\s+/g, '');
  if (tc === qc) return 220;
  if (tc.includes(qc) || qc.includes(tc)) return 180;
  let s = 0;
  const qWords = q.split(/\s/).filter((w) => w.length > 1);
  for (const w of qWords) {
    if (tc.includes(w.replace(/\s+/g, ''))) s += 42;
  }
  return s;
};

const findSheetViaMymusicCatalog = async (seed, matchedVideoTitle, catalog) => {
  const queries = [
    ...getCandidates(seed).slice(0, 5),
    stripDescriptorWords(matchedVideoTitle || ''),
    matchedVideoTitle,
    seed.slug,
    extractBestTitleAnchor(matchedVideoTitle || '') || '',
  ].filter(Boolean);
  let best = null;
  for (const item of catalog) {
    let max = 0;
    for (const q of queries) {
      max = Math.max(max, scoreCatalogMatch(q, item.title));
    }
    if (max > (best?.score ?? 0)) best = { id: item.id, score: max, title: item.title };
  }
  if (best && best.score >= 95) {
    return { url: `https://www.mymusic5.com/cipmusic/${best.id}`, score: best.score };
  }
  return null;
};

const isLikelyBrokenTitle = (value) => {
  const trimmed = value?.trim() || '';
  if (!trimmed) return true;
  if (/^https?:\/\//i.test(trimmed)) return true;
  return false;
};

const resolveSeed = async (seed, videoIdRegistry, prevRow) => {
  const override = LOCAL_IMPORT_METADATA_OVERRIDES[seed.slug];
  const overrideVideo = override?.links?.video || override?.links?.youtube;
  if (overrideVideo) {
    const videoHtml = await fetchText(overrideVideo);
    const finalTitle = extractOEmbedTitle(overrideVideo) || extractTitle(videoHtml) || seed.titleOverride || seed.slug;
    const desc = extractYoutubeShortDescription(videoHtml);
    const sheet =
      override?.links?.sheet || pickBestSheetUrl(desc, videoHtml);
    const matchedVideoTitle =
      override?.matchedVideoTitle?.trim() ||
      (isLikelyBrokenTitle(finalTitle) ? (seed.titleOverride || seed.slug) : finalTitle);
    const row = {
      youtube: override?.links?.youtube || overrideVideo,
      video: overrideVideo,
      sheet,
      matchTitle: override?.title || override?.displayTitle || seed.titleOverride || seed.slug,
      matchedVideoTitle,
      cipLinkConfidence: 'high',
    };
    const id = extractWatchIdFromEntry(row);
    if (id) videoIdRegistry.map.set(id, seed.slug);
    return { type: 'bound', row };
  }

  const disambiguationHint = extractDisambiguationHintFromSeed(seed);
  const pool = await collectSearchPool(seed, disambiguationHint);

  for (const cand of pool) {
    const gate = strictValidateBinding(seed, cand, videoIdRegistry);
    if (!gate.ok) continue;

    const matchTitleLower = (cand.matchTitle || '').trim().toLowerCase();
    if (matchTitleLower.length < 2 || AUDIO_STEM_BLACKLIST.has(matchTitleLower)) continue;

    const videoUrl = `https://www.youtube.com/watch?v=${cand.id}`;
    const videoHtml = await fetchText(videoUrl);
    const finalTitle =
      extractOEmbedTitle(videoUrl) ||
      extractTitle(videoHtml) ||
      cand.title;
    const shortDesc = extractYoutubeShortDescription(videoHtml);
    const sheet = pickBestSheetUrl(shortDesc, videoHtml);
    const combinedTitle = `${cand.title} ${finalTitle}`;

    if (hasCjk(seed.slug)) {
      const slugNorm = normalize(seed.slug).replace(/\s+/g, '');
      if (slugNorm.length >= 2) {
        const titleNorm = normalize(combinedTitle).replace(/\s+/g, '');
        let hasBigram = false;
        for (let i = 0; i <= slugNorm.length - 2; i++) {
          const bi = slugNorm.slice(i, i + 2);
          if (titleNorm.includes(bi)) {
            hasBigram = true;
            break;
          }
        }
        if (!hasBigram) continue;
      }
    }

    videoIdRegistry.map.set(cand.id, seed.slug);
    return {
      type: 'bound',
      row: {
        youtube: videoUrl,
        video: videoUrl,
        sheet,
        matchTitle: cand.matchTitle,
        matchedVideoTitle: isLikelyBrokenTitle(finalTitle) ? cand.title : finalTitle,
        cipLinkConfidence: 'high',
      },
    };
  }

  if (!prevRow || !hasYoutubeWatchUrl(prevRow)) {
    return null;
  }

  const id = extractWatchIdFromEntry(prevRow);
  if (id) {
    const owner = videoIdRegistry.map.get(id);
    if (owner && owner !== seed.slug) {
      return { type: 'strip', reason: 'video_id_conflict' };
    }
  }

  if (obviousWrongVideo(seed, prevRow)) {
    return { type: 'strip', reason: 'toxic_mismatch' };
  }

  if (id) videoIdRegistry.map.set(id, seed.slug);

  return {
    type: 'suspect',
    row: {
      ...prevRow,
      cipLinkConfidence: 'suspect',
      cipLinkReviewReason: 'strict_validation_failed_or_low_confidence',
    },
  };
};

const hasYoutubeWatchUrl = (entry) => {
  const u = entry?.video || entry?.youtube || '';
  return /watch\?v=[A-Za-z0-9_-]{11}/.test(u) || /youtu\.be\/[A-Za-z0-9_-]{11}/.test(u);
};

const main = async () => {
  const rawExisting = existsSync(OUT_FILE)
    ? evaluateExportedConst(OUT_FILE, 'LOCAL_IMPORT_CIP_LINKS')
    : {};
  let existing = { ...rawExisting };

  const gitSnap = loadGitSnapshotLinks();
  let snapshotRestoredWatchUrls = 0;
  if (gitSnap) {
    for (const seed of LOCAL_IMPORT_SEEDS) {
      const slug = seed.slug;
      const cur = existing[slug];
      const snap = gitSnap[slug];
      if (!snap) continue;
      if (!hasYoutubeWatchUrl(snap)) continue;
      if (!cur || !hasYoutubeWatchUrl(cur)) {
        existing[slug] = { ...snap };
        snapshotRestoredWatchUrls += 1;
      }
    }
    if (snapshotRestoredWatchUrls) {
      console.log('[cip] Restored from CIP_PREV_SNAPSHOT_REF:', snapshotRestoredWatchUrls, 'watch URLs');
    }
  }

  for (const seed of LOCAL_IMPORT_SEEDS) {
    const cur = existing[seed.slug];
    const mt = (cur?.matchTitle || '').trim().toLowerCase();
    if (cur && AUDIO_STEM_BLACKLIST.has(mt)) {
      delete existing[seed.slug];
    }
  }
  const highRiskSlugSet = computeHighRiskSlugSet(existing, LOCAL_IMPORT_SEEDS);
  const seedsToResolve = LOCAL_IMPORT_SEEDS.filter((seed) => {
    const cur = existing[seed.slug];
    const needsInitialResolve = !hasYoutubeWatchUrl(cur);
    const needsDisambiguationRefresh = /[（(].+[)）]/.test(seed.slug);
    const override = LOCAL_IMPORT_METADATA_OVERRIDES[seed.slug];
    const hasManualVideoOverride = Boolean(
      override?.links?.video?.trim() || override?.links?.youtube?.trim(),
    );
    if (CIP_LINKS_RISK_ALL) {
      return needsInitialResolve || needsDisambiguationRefresh || hasManualVideoOverride;
    }
    if (hasManualVideoOverride) return true;
    if (highRiskSlugSet.has(seed.slug)) return true;
    return needsInitialResolve || needsDisambiguationRefresh;
  });

  const resolvingSlugs = new Set(seedsToResolve.map((s) => s.slug));
  const videoIdRegistry = { map: buildInitialVideoRegistry(existing, resolvingSlugs) };

  const entries = [];
  for (const seed of seedsToResolve) {
    entries.push(await resolveSeed(seed, videoIdRegistry, existing[seed.slug]));
  }

  const reportStats = {
    mode: CIP_LINKS_RISK_ALL ? 'all' : 'risk',
    highRiskPoolSize: highRiskSlugSet.size,
    resolvedThisRun: seedsToResolve.length,
    snapshotRestoredWatchUrls,
    reboundToDifferentVideo: 0,
    boundHighConfidence: 0,
    suspectKeptPreviousWatchUrl: 0,
    strippedPreviousWatchUrl: 0,
    strippedDueToToxicOrDuplicate: 0,
  };

  const seedSet = new Set(LOCAL_IMPORT_SEEDS.map((s) => s.slug));
  const result = { ...existing };
  for (let i = 0; i < seedsToResolve.length; i++) {
    const slug = seedsToResolve[i].slug;
    const entry = entries[i];
    const prevRow = existing[slug];
    const prevId = extractWatchIdFromEntry(prevRow);
    if (!entry) {
      if (prevRow && hasYoutubeWatchUrl(prevRow)) {
        reportStats.strippedPreviousWatchUrl += 1;
        const next = { ...prevRow };
        delete next.youtube;
        delete next.video;
        delete next.matchedVideoTitle;
        result[slug] = next;
      } else {
        delete result[slug];
      }
      continue;
    }

    if (entry.type === 'bound') {
      reportStats.boundHighConfidence += 1;
      const newRow = entry.row;
      const newId = extractWatchIdFromEntry(newRow);
      if (prevId && newId && prevId !== newId) reportStats.reboundToDifferentVideo += 1;
      const { cipLinkReviewReason: _r, ...rest } = newRow;
      result[slug] = { ...rest, cipLinkConfidence: newRow.cipLinkConfidence || 'high' };
      continue;
    }

    if (entry.type === 'suspect') {
      reportStats.suspectKeptPreviousWatchUrl += 1;
      result[slug] = entry.row;
      continue;
    }

    if (entry.type === 'strip') {
      reportStats.strippedDueToToxicOrDuplicate += 1;
      if (prevRow && hasYoutubeWatchUrl(prevRow)) {
        reportStats.strippedPreviousWatchUrl += 1;
        const next = { ...prevRow };
        delete next.youtube;
        delete next.video;
        delete next.matchedVideoTitle;
        delete next.cipLinkConfidence;
        delete next.cipLinkReviewReason;
        result[slug] = next;
      } else {
        delete result[slug];
      }
    }
  }
  const pruned = Object.fromEntries(Object.entries(result).filter(([k]) => seedSet.has(k)));

  const sheetStats = {
    missingBefore: 0,
    fromYoutubeDescription: 0,
    fromMymusic5Catalog: 0,
    stillMissing: 0,
  };

  const needSheet = LOCAL_IMPORT_SEEDS.filter((s) => {
    const e = pruned[s.slug];
    return e && hasYoutubeWatchUrl(e) && !e.sheet;
  });
  sheetStats.missingBefore = needSheet.length;

  if (needSheet.length > 0) {
    const catalog = await loadMymusicCatalog();
    console.log(`[cip] Loaded mymusic5 catalog: ${catalog.length} rows. Re-resolving ${needSheet.length} missing sheets…`);
    for (const seed of needSheet) {
      const entry = pruned[seed.slug];
      const videoUrl = entry.video || entry.youtube;
      let sheet = null;
      let source = null;
      try {
        const html = await fetchText(videoUrl);
        const desc = extractYoutubeShortDescription(html);
        sheet = pickBestSheetUrl(desc, html);
        if (sheet) source = 'youtube_description';
        if (!sheet) {
          const hit = await findSheetViaMymusicCatalog(seed, entry.matchedVideoTitle || '', catalog);
          if (hit?.url) {
            sheet = hit.url;
            source = 'mymusic5_catalog';
          }
        }
      } catch (err) {
        console.warn(`[cip] sheet refresh failed ${seed.slug}:`, err?.message || err);
      }
      if (sheet) {
        pruned[seed.slug] = { ...entry, sheet, sheetSource: source };
        if (source === 'youtube_description') sheetStats.fromYoutubeDescription++;
        else if (source === 'mymusic5_catalog') sheetStats.fromMymusic5Catalog++;
      } else {
        sheetStats.stillMissing++;
      }
    }
    console.log('[cip] Sheet recovery:', sheetStats);
  }

  for (const { slug, test, reason } of STRIP_TOXIC_VIDEO_MATCHES) {
    const row = pruned[slug];
    if (row && test(row.matchedVideoTitle)) {
      console.warn(`[cip] Stripping toxic YouTube match for "${slug}": ${reason}`);
      const next = { ...row };
      delete next.youtube;
      delete next.video;
      delete next.matchedVideoTitle;
      delete next.matchTitle;
      pruned[slug] = next;
    }
  }

  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  writeFileSync(
    OUT_FILE,
    `export const LOCAL_IMPORT_CIP_LINKS = ${JSON.stringify(pruned, null, 2)} as const;\n`,
  );
  const boundThisRun = entries.filter((e) => e && e.type === 'bound').length;
  console.log('[cip] strict match report:', JSON.stringify(reportStats, null, 2));
  console.log(
    `Generated ${Object.keys(pruned).length} CIP links (${seedsToResolve.length} attempted, ${boundThisRun} high-confidence bound this run) -> ${OUT_FILE}`,
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
