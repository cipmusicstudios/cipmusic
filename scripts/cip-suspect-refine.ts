/**
 * Re-classify CIP `suspect` rows, auto-promote easy wins to `high`, and emit a small manual-review list.
 *
 * Run: `tsx scripts/cip-suspect-refine.ts`
 * - `CIP_REFINE_FETCH=1` — refresh YouTube oEmbed title once before gates (network).
 * - `CIP_REFINE_SHEET=1` — fetch mymusic sheet HTML to guess artist (network).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { LOCAL_IMPORT_SEEDS } from '../src/local-import-seeds.generated.ts';
import { LOCAL_IMPORT_METADATA_OVERRIDES } from '../src/local-import-metadata-overrides.ts';
import type { LocalImportMetadataOverride } from '../src/local-import-metadata-overrides.ts';
import {
  findKnownArtistInVideoTitle,
  findKnownArtistDictIdInVideoTitle,
  findBestExplicitArtistInHaystack,
} from '../src/artist-from-video-title.ts';
import { ARTIST_DICTIONARY } from '../src/local-import-artist-normalization.ts';
import {
  strictArtistGate,
  strictTitleGate,
  isShortOrCommonTitleSeed,
  scoreCandidateAgainstTitle,
  getExpectedArtistStrings,
  hasCjk,
} from './cip-gates.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CIP_FILE = path.join(ROOT, 'src/local-import-cip-links.generated.ts');
const TMP = path.join(ROOT, 'tmp');

const NO_ARTIST_MIN_SCORE = Math.max(100, Number(process.env.CIP_NO_ARTIST_MIN_SCORE ?? '128') || 128);
const SHORT_TITLE_MIN_SCORE = Math.max(100, Number(process.env.CIP_SHORT_TITLE_MIN_SCORE ?? '115') || 115);
const REFINE_FETCH = process.env.CIP_REFINE_FETCH === '1';
const REFINE_SHEET = process.env.CIP_REFINE_SHEET !== '0';

type CipRow = {
  youtube?: string;
  video?: string;
  sheet?: string;
  matchTitle?: string;
  matchedVideoTitle?: string;
  cipLinkConfidence?: string;
  cipLinkReviewReason?: string;
  cipSuspectCategory?: string;
  cipSuspectNote?: string;
  cipRefineNote?: string;
  [k: string]: unknown;
};

const overrides = LOCAL_IMPORT_METADATA_OVERRIDES as Record<string, LocalImportMetadataOverride>;

function parseCipFile(): Record<string, CipRow> {
  const text = readFileSync(CIP_FILE, 'utf8');
  const m = text.match(/export const LOCAL_IMPORT_CIP_LINKS = (\{[\s\S]*\})\s*as const/);
  if (!m) throw new Error('Could not parse local-import-cip-links.generated.ts');
  return JSON.parse(m[1]) as Record<string, CipRow>;
}

function writeCipFile(data: Record<string, CipRow>) {
  mkdirSync(path.dirname(CIP_FILE), { recursive: true });
  writeFileSync(CIP_FILE, `export const LOCAL_IMPORT_CIP_LINKS = ${JSON.stringify(data, null, 2)} as const;\n`);
}

function extractWatchId(row: CipRow | undefined): string | null {
  const u = row?.video || row?.youtube || '';
  const m = u.match(/[?&]v=([A-Za-z0-9_-]{11})/) || u.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return m?.[1] || null;
}

const fetchText = (url: string) =>
  execFileSync('curl', ['-sL', '-A', 'Mozilla/5.0', '--max-time', '25', url], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

function extractOEmbedTitle(videoUrl: string): string | null {
  try {
    const id =
      videoUrl.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] || videoUrl.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)?.[1];
    if (!id) return null;
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;
    const j = JSON.parse(fetchText(oembed)) as { title?: string };
    return j.title?.trim() || null;
  } catch {
    return null;
  }
}

function tryExtractArtistFromSheetHtml(html: string): string | null {
  const blob = html.replace(/\s+/g, ' ');
  const patterns: RegExp[] = [
    /(?:Artist|歌手|演唱|原唱|作曲)\s*[:：]\s*([^<\n|]{2,40})/i,
    /"authorName"\s*:\s*"([^"]{2,40})"/,
    /property="og:title"\s+content="([^"]+)"/i,
  ];
  for (const re of patterns) {
    const m = blob.match(re);
    if (m?.[1] && /[\p{Script=Han}]|[A-Za-z]{2,}/u.test(m[1])) {
      return m[1].replace(/\s*[\-|｜].*$/, '').trim();
    }
  }
  return null;
}

function computeIdToSlugs(links: Record<string, CipRow>): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const [slug, row] of Object.entries(links)) {
    const id = extractWatchId(row);
    if (!id) continue;
    if (!m.has(id)) m.set(id, []);
    m.get(id)!.push(slug);
  }
  return m;
}

/** True if another row with the same videoId is already `high` (or non-suspect). */
function videoIdConflict(slug: string, id: string, links: Record<string, CipRow>): boolean {
  const owners = computeIdToSlugs(links).get(id) || [];
  const others = owners.filter((s) => s !== slug);
  if (others.length === 0) return false;
  return others.some((s) => links[s]?.cipLinkConfidence !== 'suspect');
}

const OST_GAME_PATTERNS =
  /OST|主题曲|片尾|插曲|动漫|番剧|游戏|王者荣耀|G\.?E\.?M|NeZha|哪吒|恋与深空|Love and Deepspace|Black Myth|悟空|Wukong|THE9|SEVENTEEN|Into1|INTO1/i;

/** 分桶用「短/常见标题」：比生成脚本里的 isShortOrCommonTitleSeed 更窄，避免绝大多数中文歌名被标成短标题。 */
function narrowShortOrAmbiguousTitle(seed: (typeof LOCAL_IMPORT_SEEDS)[number]): boolean {
  const o = overrides[seed.slug];
  const t = (o?.title || o?.displayTitle || seed.titleOverride || seed.slug || '').trim();
  const compact = t.replace(/\s+/g, '');
  const engToken = /^[a-z][a-z0-9\s'-]*$/i.test(t) && !hasCjk(t);
  if (engToken && t.replace(/\s+/g, ' ').split(/\s+/).filter(Boolean).length <= 2 && t.length <= 12) {
    return true;
  }
  if (hasCjk(t) && compact.length <= 2) return true;
  return isShortOrCommonTitleSeed(seed, overrides);
}

function splitDisambiguatedArtistHint(seed: (typeof LOCAL_IMPORT_SEEDS)[number]): string | null {
  const o = overrides[seed.slug];
  const candidates = [o?.title, o?.displayTitle, o?.titles?.zhHans, seed.titleOverride, seed.slug].filter(Boolean) as string[];
  for (const c of candidates) {
    const mm = c.trim().match(/^(.*?)\s*[（(]\s*([^()（）]+)\s*[）)]\s*$/);
    if (mm?.[2]) return mm[2].trim();
  }
  return null;
}

type Bucket =
  | 'title_ok_artist_weak'
  | 'title_similar_artist_risk'
  | 'short_common_title'
  | 'same_name_conflict'
  | 'ost_game_anime_project'
  | 'other';

function classifySuspect(
  seed: (typeof LOCAL_IMPORT_SEEDS)[number],
  row: CipRow,
  links: Record<string, CipRow>,
): { bucket: Bucket; note: string } {
  const vt = row.matchedVideoTitle || '';
  const idMap = computeIdToSlugs(links);
  const id = extractWatchId(row);
  const owners = id ? idMap.get(id) || [] : [];

  if (owners.length > 1) {
    return {
      bucket: 'same_name_conflict',
      note: `同一 videoId 仍被 ${owners.length} 个 slug 占用（含 suspect）`,
    };
  }

  if (OST_GAME_PATTERNS.test(vt)) {
    return { bucket: 'ost_game_anime_project', note: '标题含 OST / 游戏 / 动漫 / 企划类线索' };
  }

  const metaArtists = getExpectedArtistStrings(seed, overrides);
  const vtDict = findKnownArtistDictIdInVideoTitle(vt);
  const titleOk = strictTitleGate(seed, vt, overrides);
  const baseArt = strictArtistGate(seed, vt, overrides, []);

  if (metaArtists.length > 0 && vtDict) {
    return {
      bucket: 'title_similar_artist_risk',
      note: '视频标题可识别到词典艺人，与元数据歌手可能不一致',
    };
  }

  if (titleOk && metaArtists.length > 0 && !baseArt.ok) {
    return { bucket: 'title_ok_artist_weak', note: '标题可对齐，元数据歌手未在视频标题中显式命中' };
  }

  if (titleOk && !baseArt.ok) {
    return { bucket: 'title_ok_artist_weak', note: '标题可对齐，歌手仍弱匹配（含无元数据歌手）' };
  }

  if (narrowShortOrAmbiguousTitle(seed)) {
    return { bucket: 'short_common_title', note: '短标题 / 常见英文词 / 极短中文名，易撞歌名' };
  }

  return { bucket: 'other', note: '未归入上述子类' };
}

function collectAutoArtists(seed: (typeof LOCAL_IMPORT_SEEDS)[number], vt: string, sheetArtist: string | null): string[] {
  const out: string[] = [];
  const a = findKnownArtistInVideoTitle(vt);
  if (a) out.push(a);
  const best = findBestExplicitArtistInHaystack(vt);
  if (best) {
    const dict = ARTIST_DICTIONARY[best.dictId];
    const name = dict?.names?.zhHans || dict?.names?.en;
    if (name) out.push(name);
  }
  if (sheetArtist) out.push(sheetArtist);
  const hint = splitDisambiguatedArtistHint(seed);
  if (hint) out.push(hint);
  return [...new Set(out.map((x) => x.trim()).filter(Boolean))];
}

function tryPromote(
  slug: string,
  seed: (typeof LOCAL_IMPORT_SEEDS)[number],
  row: CipRow,
  links: Record<string, CipRow>,
  freshTitle: string | null,
): { ok: boolean; detail: string } {
  const vt = (freshTitle || row.matchedVideoTitle || '').trim();
  if (!vt) return { ok: false, detail: '无视频标题' };

  const o = overrides[seed.slug];
  const primaryQuery = o?.title || o?.displayTitle || seed.titleOverride || seed.slug;
  const score = scoreCandidateAgainstTitle(primaryQuery, vt);

  let sheetArtist: string | null = null;
  const sheetUrl = typeof row.sheet === 'string' && /mymusic|cipmusic/i.test(row.sheet) ? row.sheet : null;
  if (sheetUrl && REFINE_SHEET) {
    try {
      const html = fetchText(sheetUrl);
      sheetArtist = tryExtractArtistFromSheetHtml(html);
    } catch {
      /* ignore */
    }
  }

  const extras = collectAutoArtists(seed, vt, sheetArtist);
  const art = strictArtistGate(seed, vt, overrides, extras);
  if (!strictTitleGate(seed, vt, overrides)) {
    return { ok: false, detail: '标题门槛仍失败' };
  }
  if (!art.ok) {
    return { ok: false, detail: `歌手门槛失败（已合并词典/谱面/括号提示 ${extras.length} 条）` };
  }

  if (art.needsHighScore && score < NO_ARTIST_MIN_SCORE) {
    return { ok: false, detail: `无元数据歌手且搜索分不足 (${score} < ${NO_ARTIST_MIN_SCORE})` };
  }
  if (isShortOrCommonTitleSeed(seed, overrides) && score < SHORT_TITLE_MIN_SCORE) {
    return { ok: false, detail: `短标题且分不足 (${score} < ${SHORT_TITLE_MIN_SCORE})` };
  }

  const id = extractWatchId(row);
  if (id && videoIdConflict(slug, id, links)) {
    return { ok: false, detail: '与其它非 suspect 行共享 videoId，无法自动升为 high' };
  }

  return { ok: true, detail: `auto_ok score=${score} extras=${extras.join(';') || 'none'}` };
}

function main() {
  mkdirSync(TMP, { recursive: true });
  let links = parseCipFile();
  const seedBySlug = new Map(LOCAL_IMPORT_SEEDS.map((s) => [s.slug, s]));

  const report: {
    generatedAt: string;
    suspectBefore: number;
    autoPromoted: number;
    manualRemaining: number;
    bucketCounts: Partial<Record<Bucket, number>>;
    promoted: { slug: string; detail: string }[];
    manual: { slug: string; bucket: Bucket; note: string; reason: string }[];
    strip15: null | {
      source: string;
      note: string;
      items: { slug: string; reason: 'video_id_duplicate'; oldVideoId: string; note: string }[];
    };
    fileTotals?: { autoPromotedRowsInCipFile: number; suspectRowsInCipFile: number };
  } = {
    generatedAt: new Date().toISOString(),
    suspectBefore: 0,
    autoPromoted: 0,
    manualRemaining: 0,
    bucketCounts: {},
    promoted: [],
    manual: [],
    strip15: null,
  };

  const suspects = Object.entries(links).filter(([, r]) => r.cipLinkConfidence === 'suspect');
  report.suspectBefore = suspects.length;

  for (const [slug, row] of suspects) {
    const seed = seedBySlug.get(slug);
    if (!seed) continue;

    const { bucket, note } = classifySuspect(seed, row, links);
    report.bucketCounts[bucket] = (report.bucketCounts[bucket] || 0) + 1;

    const videoUrl = (row.video || row.youtube || '').trim();
    let fresh: string | null = null;
    if (REFINE_FETCH && videoUrl) {
      fresh = extractOEmbedTitle(videoUrl);
    }

    const first = tryPromote(slug, seed, row, links, null);
    const second =
      fresh && fresh !== row.matchedVideoTitle ? tryPromote(slug, seed, row, links, fresh) : null;
    const chosen = first.ok ? first : second?.ok ? second : first;

    if (chosen.ok) {
      const next: CipRow = {
        ...row,
        cipLinkConfidence: 'high',
        cipRefineNote: `auto_promoted:${chosen.detail}`,
      };
      delete next.cipLinkReviewReason;
      links[slug] = next;
      report.autoPromoted += 1;
      report.promoted.push({ slug, detail: chosen.detail });
      continue;
    }

    const reason =
      !first.ok && second && !second.ok ? `${first.detail}；oembed 重试：${second.detail}` : chosen.detail;
    report.manual.push({
      slug,
      bucket,
      note,
      reason,
    });
  }

  report.manualRemaining = report.manual.length;

  try {
    const oldS = execFileSync('git', ['show', '69c22a7:src/local-import-cip-links.generated.ts'], {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    });
    const m = oldS.match(/export const LOCAL_IMPORT_CIP_LINKS = (\{[\s\S]*\})\s*as const/);
    const old = m ? (JSON.parse(m[1]) as Record<string, CipRow>) : null;
    if (old) {
      function vid(r: CipRow | undefined) {
        const u = r?.video || r?.youtube || '';
        const mm = u.match(/[?&]v=([A-Za-z0-9_-]{11})/) || u.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
        return mm?.[1] || null;
      }
      const lost: { slug: string; oldVideoId: string }[] = [];
      for (const slug of Object.keys(old)) {
        const ov = vid(old[slug]);
        const nv = vid(links[slug]);
        if (ov && !nv) lost.push({ slug, oldVideoId: ov });
      }
      report.strip15 = {
        source: 'git 69c22a7 vs current (lost watch URL)',
        note:
          '本批均为「一视频多曲目」去重后的败方（videoId 冲突），不是 post-pass toxic 规则单独清空；建议为每首另找独立 CIP 钢琴版链接。',
        items: lost.map((x) => ({
          slug: x.slug,
          reason: 'video_id_duplicate' as const,
          oldVideoId: x.oldVideoId,
          note: '旧快照中与其它曲目共用同一 videoId，本轮去重后清空败方链接；需另找独立钢琴版或改 slug 绑定',
        })),
      };
    }
  } catch {
    /* no git */
  }

  writeCipFile(links);

  const autoPromotedTotalInFile = Object.values(links).filter((r) =>
    String(r.cipRefineNote || '').startsWith('auto_promoted'),
  ).length;
  const suspectTotalInFile = Object.values(links).filter((r) => r.cipLinkConfidence === 'suspect').length;
  report.fileTotals = {
    autoPromotedRowsInCipFile: autoPromotedTotalInFile,
    suspectRowsInCipFile: suspectTotalInFile,
  };

  const jsonPath = path.join(TMP, 'cip-suspect-refine-report.json');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  let md = `# CIP suspect 精炼报告\n\n`;
  md += `- 本轮处理前 suspect：${report.suspectBefore}\n`;
  md += `- 本轮自动升为 high：${report.autoPromoted}\n`;
  md += `- 本轮结束后仍需人工：${report.manualRemaining}\n`;
  md += `- **当前文件累计**（含历史轮次 auto_promoted）：自动提升 ${autoPromotedTotalInFile} 条；剩余 suspect ${suspectTotalInFile} 条\n\n`;
  md += `## 分桶统计\n\n`;
  for (const [k, v] of Object.entries(report.bucketCounts)) {
    md += `- ${k}：${v}\n`;
  }
  md += `\n## 仍需人工（附原因）\n\n`;
  for (const line of report.manual) {
    md += `- **${line.slug}** [${line.bucket}] ${line.note} — *${line.reason}*\n`;
  }
  if (report.strip15?.items.length) {
    md += `\n## 15 首去重清空（videoId 冲突败方）\n\n`;
    for (const it of report.strip15.items) {
      md += `- **${it.slug}** — \`${it.oldVideoId}\` — ${it.note}\n`;
    }
  }
  writeFileSync(path.join(TMP, 'cip-manual-review-list.md'), md, 'utf8');

  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${jsonPath} and tmp/cip-manual-review-list.md`);
}

main();
