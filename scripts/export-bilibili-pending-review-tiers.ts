/**
 * 只读：将 pendingReview.bilibili_offline_merge 按 Tier A/B/C 导出，不写 video-overrides。
 *
 * npx tsx scripts/export-bilibili-pending-review-tiers.ts
 *
 * 输出：
 *   data/bilibili-pending-review-tiers.json
 *   data/bilibili-pending-review-tiers.tsv
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  artistVariants,
  normLegacy,
  normNeedle,
  stripBiliTitleForMatch,
  type ManifestTrack,
} from './lib/bilibili-offline-matcher';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const OVERRIDES = path.join(projectRoot, 'data', 'video-overrides.json');
const OUT_JSON = path.join(projectRoot, 'data', 'bilibili-pending-review-tiers.json');
const OUT_TSV = path.join(projectRoot, 'data', 'bilibili-pending-review-tiers.tsv');

type PendingItem = {
  kind?: string;
  slug?: string;
  suggestedBvid?: string;
  bvid?: string;
  suggestedVideoUrlZhHans?: string;
  biliTitle?: string;
  score?: number;
  secondScore?: number;
};

type ExportRow = {
  tier: 'A' | 'B' | 'C';
  slug: string;
  catalogTitle: string;
  artist: string;
  suggestedBvid: string;
  biliTitle: string;
  score: number;
  secondScore: number;
  gap: number;
  titleHit: boolean;
  artistHit: boolean;
  recommendation: 'auto' | 'quick-review' | 'hold';
  notes: string;
};

function loadManifestBySlug(): Map<string, ManifestTrack> {
  const dir = path.join(projectRoot, 'public');
  const m = new Map<string, ManifestTrack>();
  const files = fs
    .readdirSync(dir)
    .filter(f => /^songs-manifest-chunk-\d+\.json$/.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { tracks?: ManifestTrack[] };
    for (const t of j.tracks || []) {
      const s = (t.slug || '').trim();
      if (s) m.set(normLegacy(s), t);
    }
  }
  return m;
}

function titleHit(slug: string, biliTitle: string): boolean {
  const hayL = normLegacy(biliTitle);
  const hayS = stripBiliTitleForMatch(biliTitle);
  const sl = normLegacy(slug);
  const sn = normNeedle(slug);
  if (sl.length >= 2 && (hayL.includes(sl) || hayS.includes(sn))) return true;
  if (sn.length >= 2 && (hayS.includes(sn) || hayL.includes(sn))) return true;
  return false;
}

function artistHitFor(track: ManifestTrack | undefined, biliTitle: string): boolean {
  if (!track) return false;
  const hayL = normLegacy(biliTitle);
  const hayS = stripBiliTitleForMatch(biliTitle);
  for (const av of artistVariants(track)) {
    const nl = normLegacy(av);
    const nn = normNeedle(av);
    if (nl.length >= 2 && hayL.includes(nl)) return true;
    if (nn.length >= 2 && hayS.includes(nn)) return true;
  }
  return false;
}

function mashupHeuristic(biliTitle: string): boolean {
  const t = biliTitle;
  if ((t.match(/【/g) || []).length >= 2) return true;
  const books = [...t.matchAll(/《([^》]{1,30})》/g)];
  if (books.length >= 2) return true;
  if (/杰伦|周杰/.test(t) && /五月天/.test(t)) return true;
  if (/杰伦|周杰/.test(t) && /F4/i.test(t)) return true;
  return false;
}

function buildNotes(
  slug: string,
  biliTitle: string,
  titleHit: boolean,
  kind: string,
  tie: boolean,
): string {
  const parts: string[] = [];
  const ns = normLegacy(slug);
  const nt = normLegacy(biliTitle);

  if (kind === 'bv_demoted_loser_or_near_tie') parts.push('同一 BV 多曲目或冠亚军分差过小（merge 降级）');
  if (tie) parts.push('同分并列：score===secondScore，需人工选定 BV');

  if (ns.includes('eyes on') && nt.includes('easy on me')) parts.push('疑似错链：候选为 Adele《Easy On Me》，与 slug不符');
  if (slug.includes('世界赠与') && biliTitle.includes('世界赠予')) parts.push('alias/用字：赠与 vs 赠予');
  if (/决爱/.test(slug) && biliTitle.includes('诀爱')) parts.push('alias/用字：决爱 vs 诀爱');
  if (slug.includes('青山城下') && biliTitle.includes('青城山下')) parts.push('疑似错字/错序：青山城下 vs 青城山下');
  if (slug.includes('抬起头啊') && biliTitle.includes('抬起头来')) parts.push('alias/用字：抬起头啊 vs 抬起头来');

  if (!titleHit) {
    if (parts.every(p => !p.includes('错链'))) {
      parts.push('titleHit=false：依赖艺人/别名等弱信号命中，建议对照原文标题');
    }
  }

  if (mashupHeuristic(biliTitle)) parts.push('拼盘/多作品标题，歧义偏高');

  return parts.filter(Boolean).join('；') || '';
}

function classify(
  it: PendingItem,
  track: ManifestTrack | undefined,
  gap: number,
  tie: boolean,
  th: boolean,
  mashup: boolean,
): { tier: 'A' | 'B' | 'C'; recommendation: ExportRow['recommendation'] } {
  const kind = it.kind || '';
  const score = it.score ?? 0;

  if (kind === 'bv_demoted_loser_or_near_tie') {
    return { tier: 'C', recommendation: 'hold' };
  }

  if (tie) {
    return { tier: 'C', recommendation: 'hold' };
  }

  if (!th) {
    return { tier: 'C', recommendation: 'hold' };
  }

  if (mashup) {
    return { tier: 'C', recommendation: 'hold' };
  }

  const isTierA =
    kind === 'low_score_or_tight_gap' &&
    !tie &&
    score >= 205 &&
    score < 210 &&
    gap >= 13 &&
    th;

  if (isTierA) {
    return { tier: 'A', recommendation: 'auto' };
  }

  return { tier: 'B', recommendation: 'quick-review' };
}

function tsvEscape(s: string): string {
  return String(s).replace(/\r?\n/g, ' ').replace(/\t/g, ' ').trim();
}

function main() {
  if (!fs.existsSync(OVERRIDES)) {
    console.error('缺少', OVERRIDES);
    process.exit(1);
  }

  const doc = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')) as {
    pendingReview?: { reason?: string; items?: PendingItem[] }[];
  };
  const pr = doc.pendingReview?.find(p => p.reason === 'bilibili_offline_merge');
  const items = pr?.items || [];
  const bySlug = loadManifestBySlug();

  const rows: ExportRow[] = [];

  for (const it of items) {
    const slug = (it.slug || '').trim();
    const biliTitle = (it.biliTitle || '').trim();
    const score = it.score ?? 0;
    const secondScore = it.secondScore ?? 0;
    const gap = score - secondScore;
    const tie = score > 0 && score === secondScore;
    const suggestedBvid = (it.suggestedBvid || it.bvid || '').trim();
    const track = slug ? bySlug.get(normLegacy(slug)) : undefined;
    const catalogTitle = (track?.displayTitle || track?.title || '').trim();
    const artist = (
      track?.artists?.zhHans ||
      track?.originalArtist ||
      track?.artists?.en ||
      ''
    ).trim();

    const th = titleHit(slug, biliTitle);
    const ah = artistHitFor(track, biliTitle);
    const mash = mashupHeuristic(biliTitle);

    const { tier, recommendation } = classify(it, track, gap, tie, th, mash);
    let notes = buildNotes(slug, biliTitle, th, it.kind || '', tie);

    if (tier === 'A' && !ah) {
      notes = notes ? `${notes}；artistHit=false（建议人工扫一眼）` : 'artistHit=false（建议人工扫一眼）';
    }

    rows.push({
      tier,
      slug,
      catalogTitle: catalogTitle || slug,
      artist: artist || '（manifest 无）',
      suggestedBvid,
      biliTitle,
      score,
      secondScore,
      gap,
      titleHit: th,
      artistHit: ah,
      recommendation,
      notes,
    });
  }

  const tiers = {
    A: rows.filter(r => r.tier === 'A'),
    B: rows.filter(r => r.tier === 'B'),
    C: rows.filter(r => r.tier === 'C'),
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'data/video-overrides.json → pendingReview.bilibili_offline_merge',
    readOnly: true,
    counts: {
      total: rows.length,
      tierA: tiers.A.length,
      tierB: tiers.B.length,
      tierC: tiers.C.length,
    },
    tierCriteria: {
      A: 'low_score；205≤score<210；gap≥13；titleHit；非 tie；非拼盘；非 bv_demoted（artistHit 仅备注，不降级）',
      B: '其余非 C 的 low_score（高分差紧、或分数段较低但 titleHit 等）',
      C: 'bv_demoted；tie(gap=0)；titleHit=false；拼盘标题启发式',
    },
    tiers,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  const headers = [
    'tier',
    'slug',
    'catalogTitle',
    'artist',
    'suggestedBvid',
    'biliTitle',
    'score',
    'secondScore',
    'gap',
    'titleHit',
    'artistHit',
    'recommendation',
    'notes',
  ];
  const tsvLines = [
    headers.join('\t'),
    ...rows.map(r =>
      [
        r.tier,
        tsvEscape(r.slug),
        tsvEscape(r.catalogTitle),
        tsvEscape(r.artist),
        tsvEscape(r.suggestedBvid),
        tsvEscape(r.biliTitle),
        r.score,
        r.secondScore,
        r.gap,
        r.titleHit,
        r.artistHit,
        r.recommendation,
        tsvEscape(r.notes),
      ].join('\t'),
    ),
  ];
  fs.writeFileSync(OUT_TSV, tsvLines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify(payload.counts, null, 2));
  console.log('written', OUT_JSON);
  console.log('written', OUT_TSV);
}

main();
