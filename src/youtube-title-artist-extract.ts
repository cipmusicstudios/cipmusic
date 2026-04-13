/**
 * Heuristic extraction of primary artist string from CIP / YouTube titles.
 * Used before dictionary lookup; pairs with normalizeYoutubeTitleForArtistParse.
 */

import { normalizeYoutubeTitleForArtistParse } from './text-normalize-compare';

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

function foldForCompare(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[’'""「」『』《》]/g, '');
}

function artistResemblesTitle(artistClean: string, title: string): boolean {
  if (!artistClean || !title) return false;
  const a = foldForCompare(artistClean);
  const b = foldForCompare(title);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;
  return false;
}

/** Strip parenthetical hangul / extra group tags for primary name. */
function trimArtistDecorators(s: string): string {
  return s
    .replace(/\([^)]{0,40}\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NON_ARTIST_FREE = new Set(
  [
    'ost', 'bgm', 'unknown', 'various', 'va', 'n/a', 'na', 'instrumental', '钢琴', '鋼琴',
    'theme', 'themesong', 'cover', 'piano', 'acoustic', 'live', 'remix', 'edit', 'ver', 'version',
    '片头曲', '片尾曲', '主题曲', '主題曲', '插曲', '歌曲', '钢琴版', '鋼琴版',
  ].map(x => x.toLowerCase()),
);

function isGarbageArtistCandidate(s: string): boolean {
  const t = s.normalize('NFKC').trim();
  if (t.length < 2 || t.length > 52) return true;
  if (/^[\d\s._\-–—+／/]+$/.test(t)) return true;
  if (NON_ARTIST_FREE.has(t.toLowerCase())) return true;
  return false;
}

/**
 * Returns a plausible artist substring from a normalized (first-segment) YouTube title, or null.
 */
export function extractYoutubeArtistString(
  videoTitleRaw: string,
  displayTitle: string,
): string | null {
  const decoded = decodeHtmlEntities(videoTitleRaw).trim();
  if (!decoded) return null;

  let s = normalizeYoutubeTitleForArtistParse(decoded);
  s = s.split('|')[0].trim();
  s = s.replace(/\s+Piano\s+by\s+CIP\s+Music\s*$/i, '').trim();
  s = s.replace(/\s+CIP\s+Music\s*$/i, '').trim();
  s = s.replace(/\s+Cover\s+by\s+CIP\s+Music\s*$/i, '').trim();

  if (!s) return null;

  const fd = foldForCompare(displayTitle);

  // English: "Empty Love Lulleaux & Kid Princess" after normalize (quotes stripped)
  if (fd.length >= 4 && /^[A-Za-z\s.'-]+$/i.test(displayTitle.trim())) {
    const esc = displayTitle.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefixRe = new RegExp(`^${esc.replace(/\s+/g, '\\s+')}\\s+`, 'i');
    if (prefixRe.test(s)) {
      const rest = s.replace(prefixRe, '').trim();
      if (
        rest.length >= 3 &&
        rest.length <= 56 &&
        !artistResemblesTitle(rest, displayTitle) &&
        !isGarbageArtistCandidate(rest)
      ) {
        return rest;
      }
    }
  }

  // … Piano Cover - trailing artist (e.g. Ne-Yo, HENRY 刘宪华, BoA)
  const pcm = s.match(/^(.+?)\s+Piano\s+Cover\s*[-–—]\s*(.+)$/i);
  if (pcm) {
    const tail = trimArtistDecorators(pcm[2]).trim();
    const headFold = foldForCompare(pcm[1]);
    if (
      tail.length >= 2 &&
      tail.length < 56 &&
      !artistResemblesTitle(tail, displayTitle) &&
      !isGarbageArtistCandidate(tail) &&
      !(fd.length >= 4 && headFold.includes(fd))
    ) {
      if (!/^[\d\s._-]+$/.test(tail) && !/piano\s*cover/i.test(tail)) {
        return tail;
      }
    }
  }

  // Text before first 《…》 book title (e.g. 刀酱《5:20AM》, 毛华锋《信念之光》)
  const bb = s.match(/^([\s\S]{1,90}?)《[^》]+》/);
  if (bb) {
    let candidate = bb[1].trim().replace(/^[\s【\[]+/, '');
    candidate = candidate.replace(/^(电影|電影|电视剧|電視劇|手游|网游|游戏|配乐|配樂|原声|原聲|主题[曲曲]|插曲)[：:\s]*/i, '');
    candidate = trimArtistDecorators(candidate);
    if (
      candidate.length >= 2 &&
      candidate.length <= 85 &&
      !artistResemblesTitle(candidate, displayTitle) &&
      !isGarbageArtistCandidate(candidate)
    ) {
      return candidate;
    }
  }

  // 《title》artist (e.g. 《所念皆星河》CMJ …)
  const afterGuillemet = s.match(/^《[^》]+》\s*([^\s《》]{2,32})(?:\s|$)/u);
  if (afterGuillemet) {
    const candidate = trimArtistDecorators(afterGuillemet[1]).trim();
    if (
      candidate.length >= 2 &&
      !artistResemblesTitle(candidate, displayTitle) &&
      !isGarbageArtistCandidate(candidate) &&
      !/^(钢琴|鋼琴|Piano)$/i.test(candidate)
    ) {
      return candidate;
    }
  }

  // Artist - 《title》 (e.g. Hiroyuki Sawano-《Call of Silence》)
  const bd = s.match(/^(.+?)\s*[-–—]\s*《[^》]+》/);
  if (bd) {
    const candidate = trimArtistDecorators(bd[1]).trim();
    if (
      candidate.length >= 2 &&
      candidate.length <= 48 &&
      !artistResemblesTitle(candidate, displayTitle) &&
      !isGarbageArtistCandidate(candidate)
    ) {
      return candidate;
    }
  }

  // Leading English / mixed group then dash and rest (e.g. KiiiKiii - "DANCING ALONE", Lil Nas X - STAR)
  const dash = s.match(/^(.+?)\s*[-–—:：]\s*(.+)$/);
  if (dash) {
    let left = trimArtistDecorators(dash[1]).trim();
    const right = dash[2].trim();
    const foldL = foldForCompare(left);
    const foldR = foldForCompare(right);
    if (fd.length >= 2) {
      if (foldR.includes(fd) || (fd.length >= 4 && foldR.includes(fd.slice(0, Math.min(6, fd.length))))) {
        if (left.length >= 2 && !artistResemblesTitle(left, displayTitle) && !isGarbageArtistCandidate(left)) {
          return left;
        }
      }
      if (foldL.includes(fd) || (fd.length >= 4 && foldL.includes(fd.slice(0, Math.min(6, fd.length))))) {
        let alt = trimArtistDecorators(right.split(/Piano\s+Cover/i)[0] || right).trim();
        alt = alt.replace(/^《[^》]+》\s*/, '').trim();
        if (alt.length >= 2 && alt.length <= 52 && !artistResemblesTitle(alt, displayTitle) && !isGarbageArtistCandidate(alt)) {
          return alt;
        }
      }
    }
    // Heuristic: short Latin left token, longer right → left is often artist
    if (
      /^[A-Za-z0-9&.\s]{2,40}$/.test(left) &&
      right.length > left.length + 3 &&
      !/^[《]/.test(left)
    ) {
      if (!artistResemblesTitle(left, displayTitle) && !isGarbageArtistCandidate(left)) return left;
    }
  }

  // Title-first English: 'Empty Love' Lulleaux & Kid Princess
  const tf = s.match(/^[''""]([^''""]+)[''""]\s+(.+?)(?:\s+Piano\s+Cover)?$/i);
  if (tf) {
    const rest = trimArtistDecorators(tf[2]).trim();
    if (rest.length >= 3 && rest.length <= 56 && !artistResemblesTitle(rest, displayTitle) && !isGarbageArtistCandidate(rest)) {
      const restFold = foldForCompare(rest);
      if (!restFold.includes(fd) && fd.length >= 4) return rest;
      if (fd.length < 4) return rest;
    }
  }

  return null;
}

export function normalizeArtistKeyForLookup(s: string): string {
  return normalizeYoutubeTitleForArtistParse(s);
}

/**
 * Whether we may assign a stable from-youtube/* id without dictionary match.
 */
export function isSafeYoutubeFreeformArtist(name: string, displayTitle: string): boolean {
  const t = trimArtistDecorators(name).trim();
  if (isGarbageArtistCandidate(t)) return false;
  if (artistResemblesTitle(t, displayTitle)) return false;
  if (looksLikeNonArtistHeuristic(t)) return false;
  return true;
}

const NON_ARTIST_HINTS: RegExp[] = [
  /^钢琴\s/,
  /^【钢琴】/,
  /^视中秋/,
  /^本来应该/,
  /^Honkai\s*:/i,
  /^Genshin/i,
  /^原神/i,
  /^SPIDER-MAN/i,
  /^Deadpool/i,
  /^Girls\s+Planet\s+999\s+Theme\s+Song/i,
];

function looksLikeNonArtistHeuristic(s: string): boolean {
  const t = s.normalize('NFKC');
  if (NON_ARTIST_HINTS.some(re => re.test(t))) return true;
  if (/^[《「『【]/.test(t)) return true;
  return false;
}
