/**
 * 本轮 metadata 批量补丁：读取当前 `catalog-overrides-locked`、合并修改后写回。
 * 运行：npx tsx scripts/apply-catalog-metadata-round.ts
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogOverride } from '../src/data/catalog-override-types';
import {
  CATALOG_OVERRIDES_BY_SLUG,
  CATALOG_OVERRIDES_BY_TRACK_ID,
} from '../src/data/catalog-overrides-locked';

const __dirname = dirname(fileURLToPath(import.meta.url));

const LIST_PIN_NEWEST_BASE = 4_000_000_000_000;

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function mergeEntry(base: CatalogOverride | undefined, patch: CatalogOverride): CatalogOverride {
  return { ...(base ?? {}), ...patch };
}

function tsString(s: string): string {
  return JSON.stringify(s);
}

function tsKey(k: string): string {
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k)) return k;
  return tsString(k);
}

function serializeValue(v: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return tsString(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[\n${v.map(x => `${padIn}${serializeValue(x, indent + 1)}`).join(',\n')}\n${pad}]`;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter(k => o[k] !== undefined);
    if (keys.length === 0) return '{}';
    return `{\n${keys
      .map(k => `${padIn}${tsKey(k)}: ${serializeValue(o[k], indent + 1)}`)
      .join(',\n')}\n${pad}}`;
  }
  return String(v);
}

function serializeRecord(title: string, rec: Record<string, CatalogOverride>): string {
  const keys = Object.keys(rec).sort((a, b) => a.localeCompare(b, 'en'));
  const lines = keys.map(k => `  ${tsKey(k)}: ${serializeValue(rec[k], 1)}`);
  return `export const ${title}: Record<string, CatalogOverride> = {\n${lines.join(',\n')},\n};\n`;
}

function main() {
  const slug = deepClone(CATALOG_OVERRIDES_BY_SLUG);
  const byId = deepClone(CATALOG_OVERRIDES_BY_TRACK_ID);

  const pin = (key: string, n: number) => {
    slug[key] = mergeEntry(slug[key], { listSortPublishedAtMs: LIST_PIN_NEWEST_BASE + n });
  };
  pin('爱琴海', 0);
  pin('恋人', 1);
  pin('摆脱地心引力', 2);

  const hokSolo = (s: string, artistZh: string, artistEn: string, artistHant?: string) => {
    slug[s] = mergeEntry(slug[s], {
      artist: artistZh,
      artists: { zhHans: artistZh, zhHant: artistHant ?? artistZh, en: artistEn },
      workProjectKey: 'honor-of-kings',
    });
  };
  hokSolo('明日坐标', '林俊杰', 'JJ Lin', '林俊傑');
  hokSolo('奇迹时刻', '周深', 'Zhou Shen');
  hokSolo('时结', '周深', 'Zhou Shen');
  hokSolo('无双的王者', '邓紫棋', 'G.E.M.', '鄧紫棋');

  for (const id of ['local_明日坐标', 'local_奇迹时刻', 'local_时结', 'local_无双的王者'] as const) {
    const cur = byId[id] ?? {};
    const { coCanonicalArtistIds: _drop, ...rest } = cur;
    byId[id] = {
      ...rest,
      canonicalArtistDisplayName:
        id === 'local_明日坐标' ? '林俊杰' : id === 'local_无双的王者' ? '邓紫棋' : '周深',
      artistReviewStatus: 'ok',
    };
  }

  slug['经过'] = mergeEntry(slug['经过'], {
    workProjectKey: 'genshin-impact',
    artist: '张杰',
    artists: { zhHans: '张杰', zhHant: '張杰', en: 'Jason Zhang' },
  });

  slug['希望有羽毛和翅膀'] = mergeEntry(slug['希望有羽毛和翅膀'], {
    artist: '知更鸟（Chevy）',
    artists: { zhHans: '知更鸟（Chevy）', zhHant: '知更鳥（Chevy）', en: 'Chevy' },
    workProjectKey: 'honkai-star-rail',
    categoryTags: ['游戏', '韩流流行'],
  });

  byId['local_希望有羽毛和翅膀'] = mergeEntry(byId['local_希望有羽毛和翅膀'], {
    canonicalArtistId: 'chevy-robin',
    canonicalArtistDisplayName: '知更鸟（Chevy）',
    artistReviewStatus: 'ok',
  });

  slug['于深空见证的'] = mergeEntry(slug['于深空见证的'], { workProjectKey: 'love-and-deepspace' });

  const lolSlugs = [
    'Sacrifice',
    'heavy is the crown',
    'GODS',
    'STAR WALKIN\'',
    'pop star',
    'Burn it all down',
    '孤勇者',
    '这样很好',
  ] as const;
  for (const s of lolSlugs) {
    slug[s] = mergeEntry(slug[s], { workProjectKey: 'league-of-legends' });
  }

  slug["STAR WALKIN'"] = mergeEntry(slug["STAR WALKIN'"], {
    titles: { zhHans: '逐星', zhHant: '逐星', en: 'Star Walkin\'' },
  });

  for (const k of Object.keys(slug)) {
    const a = slug[k]?.artist ?? '';
    if (/HUNTR\/X|Huntr\/x/i.test(a) || /Saja Boys/i.test(a)) {
      slug[k] = mergeEntry(slug[k], { workProjectKey: 'kpop-demon-hunters' });
    }
  }
  for (const k of ['free', 'take-down', 'golden', "How it's done", 'soda-pop', 'your-idol'] as const) {
    if (slug[k]) slug[k] = mergeEntry(slug[k], { workProjectKey: 'kpop-demon-hunters' });
  }

  slug['恋与深空主题曲'] = mergeEntry(slug['恋与深空主题曲'], {
    artist: '莎拉·布莱曼',
    artists: { zhHans: '莎拉·布莱曼', zhHant: '莎拉·布萊曼', en: 'Sarah Brightman' },
    categoryTags: ['游戏', '欧美流行'],
  });

  byId['local_恋与深空主题曲'] = mergeEntry(byId['local_恋与深空主题曲'], {
    canonicalArtistId: 'sarah-brightman',
    coCanonicalArtistIds: undefined,
    canonicalArtistDisplayName: '莎拉·布莱曼',
    artistReviewStatus: 'ok',
  });

  slug['empty love'] = mergeEntry(slug['empty love'], {
    artist: 'Lulleaux',
    artists: { zhHans: 'Lulleaux', en: 'Lulleaux' },
  });
  byId['local_empty_love'] = mergeEntry(byId['local_empty_love'], {
    canonicalArtistId: 'lulleaux',
    canonicalArtistDisplayName: 'Lulleaux',
    artistReviewStatus: 'ok',
  });

  slug['花西子'] = mergeEntry(slug['花西子'], {
    artist: '周深',
    artists: { zhHans: '周深', zhHant: '周深', en: 'Zhou Shen' },
  });
  slug['好好生活就是美好生活'] = mergeEntry(slug['好好生活就是美好生活'], {
    artist: '周深',
    artists: { zhHans: '周深', zhHant: '周深', en: 'Zhou Shen' },
  });
  slug['两个自己'] = mergeEntry(slug['两个自己'], {
    artist: '邓紫棋',
    artists: { zhHans: '邓紫棋', zhHant: '鄧紫棋', en: 'G.E.M.' },
  });
  slug['好想我回来啊'] = mergeEntry(slug['好想我回来啊'], {
    artist: '华晨宇',
    artists: { zhHans: '华晨宇', zhHant: '華晨宇', en: 'Hua Chenyu' },
  });
  slug['等你的回答'] = mergeEntry(slug['等你的回答'], {
    artist: 'TF家族三代',
    artists: { zhHans: 'TF家族三代', zhHant: 'TF家族三代', en: 'TF Family 3rd' },
  });
  slug['笨小孩的道歉信'] = mergeEntry(slug['笨小孩的道歉信'], {
    artist: 'TF家族三代',
    artists: { zhHans: 'TF家族三代', zhHant: 'TF家族三代', en: 'TF Family 3rd' },
  });

  slug['dawn to dusk'] = mergeEntry(slug['dawn to dusk'], {
    artist: '张艺兴',
    artists: { zhHans: '张艺兴', zhHant: '張藝興', en: 'Lay Zhang' },
  });
  byId['local_dawn_to_dusk'] = mergeEntry(byId['local_dawn_to_dusk'], {
    canonicalArtistId: 'lay-zhang',
    canonicalArtistDisplayName: '张艺兴',
    artistReviewStatus: 'ok',
  });

  slug['Regression'] = mergeEntry(slug['Regression'], {
    artist: '阿云嘎',
    artists: { zhHans: '阿云嘎', zhHant: '阿云嘎', en: 'Ayanga' },
    categoryTags: ['华语流行', '游戏'],
  });
  byId['local_Regression'] = mergeEntry(byId['local_Regression'], {
    canonicalArtistId: 'ayunga',
    canonicalArtistDisplayName: '阿云嘎',
    artistReviewStatus: 'ok',
  });

  slug['可'] = mergeEntry(slug['可'], {
    artist: '张靓颖、薛之谦',
    artists: { zhHans: '张靓颖、薛之谦', zhHant: '張靚穎、薛之謙', en: 'Jane Zhang, Joker Xue' },
  });
  slug['桃花诺'] = mergeEntry(slug['桃花诺'], {
    artist: '周深、宋亚轩',
    artists: { zhHans: '周深、宋亚轩', zhHant: '周深、宋亞軒', en: 'Zhou Shen, Song Yaxuan' },
  });

  slug['不眠之夜'] = mergeEntry(slug['不眠之夜'], {
    artist: '张杰',
    artists: { zhHans: '张杰', zhHant: '張杰', en: 'Jason Zhang' },
    workProjectKey: 'honkai-star-rail',
    categoryTags: ['华语流行', '游戏'],
  });
  byId['local_不眠之夜'] = {
    canonicalArtistId: 'zhang-jie',
    canonicalArtistDisplayName: '张杰',
    artistReviewStatus: 'ok',
  };

  slug['流星雨'] = mergeEntry(slug['流星雨'], {
    artist: 'F4',
    artists: { zhHans: 'F4', zhHant: 'F4', en: 'F4' },
  });

  slug['像晴天像雨天任性'] = mergeEntry(slug['像晴天像雨天任性'], {
    artist: '汪苏泷、五月天',
    artists: { zhHans: '汪苏泷、五月天', zhHant: '汪蘇瀧、五月天', en: 'Silence Wang, Mayday' },
  });

  slug['forever-forever'] = mergeEntry(slug['forever-forever'], {
    title: '恒星不忘',
    displayTitle: '恒星不忘',
    titles: { zhHans: '恒星不忘', zhHant: '恆星不忘', en: 'Forever Forever' },
    artist: '周杰伦、F4、五月天',
    artists: {
      zhHans: '周杰伦、F4、五月天',
      zhHant: '周杰倫、F4、五月天',
      en: 'Jay Chou, F4, Mayday',
    },
  });
  byId['local_forever_forever'] = {
    canonicalArtistId: 'jay-chou',
    coCanonicalArtistIds: ['f4', 'mayday'],
    canonicalArtistDisplayName: '周杰伦、F4、五月天',
    artistReviewStatus: 'ok',
  };

  const filmExtra = [
    '意气趁年少',
    '寂静之忆',
    '天地龙鳞',
    '以无旁骛之吻',
    '雪花',
    '星鱼',
    '调查中',
    '最幸运的幸运',
    '诀爱',
    '浮光',
  ];
  for (const k of filmExtra) {
    const cur = slug[k]?.categoryTags ?? [];
    slug[k] = mergeEntry(slug[k], {
      categoryTags: Array.from(new Set([...cur, '华语流行', '影视'])),
    });
  }

  slug['stay with me'] = mergeEntry(slug['stay with me'], {
    categoryTags: ['韩流流行', '影视'],
  });

  for (const k of ['斗地主', '哈基米', '新宝岛'] as const) {
    const o = slug[k];
    if (!o) continue;
    slug[k] = mergeEntry(o, { artist: '', artists: { zhHans: '', zhHant: '', en: '' } });
  }

  byId['local_哈基米'] = mergeEntry(byId['local_哈基米'], {
    canonicalArtistDisplayName: '',
    canonicalArtistId: 'review/meme-no-vocal',
    artistReviewStatus: 'unknown',
  });
  byId['local_新宝岛'] = mergeEntry(byId['local_新宝岛'], {
    canonicalArtistDisplayName: '',
    artistReviewStatus: 'unknown',
  });

  const header = `/**
 * 人工锁定快照（静态、唯一来源）— 由仓库内已确认元数据固化，**不**在运行时从 legacy / TRACK_CANONICAL 派生。
 * 新纠错请只改本文件（或运行 scripts/generate-catalog-overrides-locked.ts 再手调）。
 *
 * 生成后请通过 npm run build 校验。
 */

import type { CatalogOverride } from './catalog-override-types';

`;

  const body = `${serializeRecord('CATALOG_OVERRIDES_BY_SLUG', slug)}\n${serializeRecord('CATALOG_OVERRIDES_BY_TRACK_ID', byId)}`;
  const outPath = join(__dirname, '../src/data/catalog-overrides-locked.ts');
  writeFileSync(outPath, header + body, 'utf8');
  console.log(
    `[apply-catalog-metadata-round] wrote ${outPath} slug=${Object.keys(slug).length} trackId=${Object.keys(byId).length}`,
  );
}

main();
