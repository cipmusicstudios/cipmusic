/**
 * One-off report: classify all CIP `suspect` rows (same buckets as cip-suspect-refine.ts)
 * and emit a markdown breakdown for manual review.
 *
 * Run: npx tsx scripts/export-suspect-review-breakdown.ts
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_IMPORT_SEEDS } from '../src/local-import-seeds.generated.ts';
import { LOCAL_IMPORT_METADATA_OVERRIDES } from '../src/local-import-metadata-overrides.ts';
import type { LocalImportMetadataOverride } from '../src/local-import-metadata-overrides.ts';
import { LOCAL_IMPORT_CIP_LINKS } from '../src/local-import-cip-links.generated.ts';
import { findKnownArtistDictIdInVideoTitle } from '../src/artist-from-video-title.ts';
import {
  strictArtistGate,
  strictTitleGate,
  isShortOrCommonTitleSeed,
  getExpectedArtistStrings,
  hasCjk,
} from './cip-gates.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'tmp');

type CipRow = {
  youtube?: string;
  video?: string;
  sheet?: string;
  matchTitle?: string;
  matchedVideoTitle?: string;
  cipLinkConfidence?: string;
  cipLinkReviewReason?: string;
  [k: string]: unknown;
};

const overrides = LOCAL_IMPORT_METADATA_OVERRIDES as Record<string, LocalImportMetadataOverride>;
const links = LOCAL_IMPORT_CIP_LINKS as Record<string, CipRow>;

function extractWatchId(row: CipRow | undefined): string | null {
  const u = row?.video || row?.youtube || '';
  const m = u.match(/[?&]v=([A-Za-z0-9_-]{11})/) || u.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return m?.[1] || null;
}

function computeIdToSlugs(all: Record<string, CipRow>): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const [slug, row] of Object.entries(all)) {
    const id = extractWatchId(row);
    if (!id) continue;
    if (!m.has(id)) m.set(id, []);
    m.get(id)!.push(slug);
  }
  return m;
}

const OST_GAME_PATTERNS =
  /OST|主题曲|片尾|插曲|动漫|番剧|游戏|王者荣耀|G\.?E\.?M|NeZha|哪吒|恋与深空|Love and Deepspace|Black Myth|悟空|Wukong|THE9|SEVENTEEN|Into1|INTO1/i;

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
  all: Record<string, CipRow>,
): { bucket: Bucket; note: string } {
  const vt = row.matchedVideoTitle || '';
  const idMap = computeIdToSlugs(all);
  const id = extractWatchId(row);
  const owners = id ? idMap.get(id) || [] : [];

  if (owners.length > 1) {
    return {
      bucket: 'same_name_conflict',
      note: `同一 videoId 仍被 ${owners.length} 个 slug 占用（含 suspect）`,
    };
  }

  if (OST_GAME_PATTERNS.test(vt)) {
    return { bucket: 'ost_game_anime_project', note: '视频标题含 OST / 游戏 / 动漫 / 企划类关键词（自动规则命中）' };
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

  return { bucket: 'other', note: '未归入上述子类（多为标题门槛未过等）' };
}

type UserCat = '1' | '2' | '3a' | '3b' | '4' | '5';

function userCatLabel(cat: UserCat): string {
  switch (cat) {
    case '1':
      return '1）短标题 / 常见标题';
    case '2':
      return '2）同名歌曲冲突（同一 videoId 多 slug）';
    case '3a':
      return '3a）标题基本可对齐，但歌手 / 原唱匹配弱';
    case '3b':
      return '3b）词典艺人与元数据歌手可能不一致';
    case '4':
      return '4）OST / 游戏 / 动漫 / 项目曲（标题含 IP 线索）';
    case '5':
      return '5）其它';
    default:
      return cat;
  }
}

function bucketToUserCat(bucket: Bucket): UserCat {
  if (bucket === 'short_common_title') return '1';
  if (bucket === 'same_name_conflict') return '2';
  if (bucket === 'title_ok_artist_weak') return '3a';
  if (bucket === 'title_similar_artist_risk') return '3b';
  if (bucket === 'ost_game_anime_project') return '4';
  return '5';
}

function main() {
  const manifestPath = path.join(ROOT, 'public/songs-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    tracks: Array<{
      slug?: string;
      title?: string;
      displayTitle?: string;
      originalArtist?: string;
    }>;
  };
  const bySlug = new Map(manifest.tracks.map((t) => [t.slug || '', t]));

  const seedBySlug = new Map(LOCAL_IMPORT_SEEDS.map((s) => [s.slug, s]));

  const suspects = Object.entries(links).filter(([, r]) => r.cipLinkConfidence === 'suspect');

  type Row = {
    slug: string;
    title: string;
    artist: string;
    videoUrl: string;
    videoTitle: string;
    cipReason: string;
    bucket: Bucket;
    note: string;
    userCat: UserCat;
    missingSeed: boolean;
  };

  const rows: Row[] = [];
  for (const [slug, row] of suspects) {
    const seed = seedBySlug.get(slug);
    const m = bySlug.get(slug);
    const { bucket, note } = seed
      ? classifySuspect(seed, row, links)
      : { bucket: 'other' as Bucket, note: '无对应 seed，无法跑分桶规则' };
    const userCat = bucketToUserCat(bucket);
    rows.push({
      slug,
      title: m?.displayTitle || m?.title || slug,
      artist: m?.originalArtist || '（manifest 无）',
      videoUrl: (row.video || row.youtube || '').trim() || '（无）',
      videoTitle: (row.matchedVideoTitle || '').trim() || '（无）',
      cipReason: (row.cipLinkReviewReason || '（无）').trim(),
      bucket,
      note,
      userCat,
      missingSeed: !seed,
    });
  }

  rows.sort((a, b) => {
    const o = a.userCat.localeCompare(b.userCat);
    if (o !== 0) return o;
    return a.slug.localeCompare(b.slug, 'zh-Hans-CN');
  });

  const byCat = new Map<UserCat, Row[]>();
  for (const r of rows) {
    if (!byCat.has(r.userCat)) byCat.set(r.userCat, []);
    byCat.get(r.userCat)!.push(r);
  }

  const order: UserCat[] = ['1', '2', '3a', '3b', '4', '5'];
  const summaryLines: string[] = [
    '# CIP suspect（needsReview）151 首 — 问题类型分组',
    '',
    `生成时间：${new Date().toISOString()}（与 \`cip-suspect-refine.ts\` 分桶逻辑一致）`,
    '',
    '## 总体判断（先看这段）',
    '',
    '- **视频链接本身**：每首都有 YouTube（或少数 B 站）；suspect **不是**「没视频」，而是 **自动校验认为「歌名/歌手/置信规则」未达标**（\`cipLinkReviewReason\` 多为 `strict_validation_failed_or_low_confidence`）。',
    '- **同名冲突（第 2 类）**：同一 `videoId` 被多个 slug 引用，需要拆链或改绑定 —— 这是**链接级**问题。',
    '- **第 4 类（OST/IP）**：视频标题里出现 OST/游戏/番剧等关键词，规则优先归此类；**多数是 IP/企划归属 + 元数据怎么写**，不一定是「链错视频」。',
    '- **第 1 类（短标题）**：**标题太短或太常见**，自动打分容易不够，**更像「标题歧义」** 而非单纯歌手错。',
    '- **第 3a / 3b**：**标题相对可信，主要卡在「原唱 / 元数据歌手是否在视频标题里对上」**；3b 额外含「词典里认出的艺人名和当前元数据可能打架」。',
    '',
    '## 各组数量',
    '',
  ];

  for (const cat of order) {
    const list = byCat.get(cat) ?? [];
    summaryLines.push(`- ${userCatLabel(cat)}：**${list.length}**`);
  }
  summaryLines.push(`- **合计**：**${rows.length}**（应与 CIP 中 suspect 行数一致）`);
  summaryLines.push('');

  for (const cat of order) {
    const list = byCat.get(cat) ?? [];
    summaryLines.push(`## ${userCatLabel(cat)}（${list.length}）`, '');
    if (list.length === 0) {
      summaryLines.push('（无）', '');
      continue;
    }
    for (const r of list) {
      summaryLines.push(`### ${r.title}`, '');
      summaryLines.push(`- **slug**：\`${r.slug}\``);
      summaryLines.push(`- **当前 artist（manifest originalArtist）**：${r.artist}`);
      summaryLines.push(`- **当前视频标题（matchedVideoTitle）**：${r.videoTitle}`);
      summaryLines.push(`- **CIP 标记 suspect 原因字段**：\`${r.cipReason}\``);
      summaryLines.push(`- **分桶说明**：${r.note}`);
      if (r.missingSeed) summaryLines.push('- **注意**：缺少 seed，分桶可能不准');
      summaryLines.push(`- **内部 bucket**：\`${r.bucket}\``);
      summaryLines.push('');
    }
  }

  mkdirSync(TMP, { recursive: true });
  const outPath = path.join(TMP, 'suspect-151-review-breakdown.md');
  writeFileSync(outPath, summaryLines.join('\n'), 'utf8');
  console.log(`Wrote ${outPath} (${rows.length} rows)`);
}

main();
