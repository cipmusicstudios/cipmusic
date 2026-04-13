/**
 * Normalization for library integrity checks (audit script + rules).
 * — NFKC, full/half width, punctuation, OST noise, zh-Hant→Hans (opencc-js).
 */

import { Converter } from 'opencc-js/t2cn';

let t2cn: ((s: string) => string) | null = null;
function toHans(s: string): string {
  if (!t2cn) t2cn = Converter({ from: 'tw', to: 'cn' });
  try {
    return t2cn(s);
  } catch {
    return s;
  }
}

/** Common title typos vs video / official spelling (slug may keep filesystem name). */
const TITLE_DISPLAY_ALIASES: [RegExp, string][] = [[/决爱/g, '诀爱']];

const OST_NOISE_RE =
  /\s*(?:\||[-–—])?\s*(?:piano\s*cover|钢琴版|鋼琴版|ost|theme\s*song|主题曲|主題曲|插曲|片尾曲|片头曲|片頭曲|live|现场版|現場版|acoustic|version|mv|official\s*video|short\s*ver|tv\s*size|完整版|抒情版|纯音乐|纯伴奏|伴奏版|inst\.?|instrumental)\b/gi;

/** Extra tokens often trailing YouTube music uploads (stripped for artist parsing only). */
const YOUTUBE_PARSE_NOISE_RE =
  /\s*(?:抖音|热门|短视频|治愈系|慢版|新歌|钢琴|鋼琴|练习曲)\b/gi;

const YOUTUBE_TAIL_PIPE = /\s*(\|\s*)?(Piano\s+by\s+CIP\s+Music|CIP\s+Music|Cover\s+by\s+CIP\s+Music)\s*$/gi;

const PUNCT_UNIFY = /[＂＇｀´'"''「」『』【】［］〔〕]/g;

/** Full-width ASCII digits / letters → half-width */
export function toHalfWidthAscii(s: string): string {
  return s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
}

export function stripOstAndVersionNoise(s: string): string {
  let t = s;
  for (let i = 0; i < 4; i++) {
    const next = t.replace(OST_NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

export function unifyPunctuation(s: string): string {
  return s.replace(PUNCT_UNIFY, ' ');
}

export function applyTitleTypoAliases(s: string): string {
  let t = s;
  for (const [re, rep] of TITLE_DISPLAY_ALIASES) {
    t = t.replace(re, rep);
  }
  return t;
}

/**
 * NFKC + half-width + punctuation + OST/version noise + Hant→Hans for parsing artist from video titles.
 * Does not lowercase (keeps readable strings for display / substring tests).
 */
export function normalizeYoutubeTitleForArtistParse(raw: string | null | undefined): string {
  if (raw == null) return '';
  let s = String(raw).normalize('NFKC');
  s = toHalfWidthAscii(s);
  s = applyTitleTypoAliases(s);
  s = unifyPunctuation(s);
  s = stripOstAndVersionNoise(s);
  for (let i = 0; i < 3; i++) {
    const next = s.replace(YOUTUBE_PARSE_NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
    if (next === s) break;
    s = next;
  }
  s = s.replace(YOUTUBE_TAIL_PIPE, '').trim();
  s = toHans(s);
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Full pipeline for comparing artist/title strings in audits.
 */
export function normalizeForIntegrityCompare(raw: string | null | undefined): string {
  if (raw == null) return '';
  let s = String(raw).normalize('NFKC');
  s = toHalfWidthAscii(s);
  s = unifyPunctuation(s);
  s = stripOstAndVersionNoise(s);
  s = toHans(s);
  s = s.replace(/\s+/g, ' ').trim().toLowerCase();
  return s;
}

export function normalizeTitleForVideoAnchor(displayTitle: string): string {
  let s = displayTitle.normalize('NFKC');
  s = toHalfWidthAscii(s);
  s = applyTitleTypoAliases(s);
  s = unifyPunctuation(s);
  s = toHans(s);
  return s.trim();
}

/** e.g. "5点23" vs video "5:23PM" */
export function digitClockAnchorOk(displayTitle: string, videoTitle: string): boolean {
  const compact = displayTitle.replace(/\s/g, '');
  const m = compact.match(/(\d{1,2})[:：．.](\d{1,2})/) || compact.match(/(\d{1,2})点(\d{1,2})/);
  if (!m) return false;
  const h = m[1];
  const min = m[2];
  const v = videoTitle.replace(/\s/g, '');
  if (v.includes(`${h}:${min}`) || v.includes(`${h}：${min}`) || v.includes(`${h}点${min}`)) return true;
  if (new RegExp(`${h}\\s*:?\\s*${min}\\s*pm`, 'i').test(v)) return true;
  return false;
}

export function hanChars(s: string): string[] {
  return Array.from(s.normalize('NFC')).filter(ch => /[\p{Script=Han}]/u.test(ch));
}

/** Shared Han after Hant→Hans + typo aliases on title side */
export function cjkTitleVideoShareHan(displayTitle: string, videoTitle: string | null | undefined): boolean {
  if (!videoTitle) return false;
  const tNorm = normalizeTitleForVideoAnchor(displayTitle);
  const vNorm = toHans(videoTitle.normalize('NFKC'));
  const th = hanChars(tNorm);
  if (th.length === 0) return true;
  return th.some(ch => vNorm.includes(ch));
}
