/**
 * Artist grid browse buckets (Music → Artists): type + nationality for filters.
 * Used when ARTIST_DICTIONARY has no row (e.g. legacy `from-youtube/*` ids).
 * Goal: keep 「其他」 for project/IP-like rows only; real performers get solo/group + region.
 */
import type { NormalizedArtist } from './local-import-artist-normalization';

export type BrowseClassification = {
  type: NormalizedArtist['type'];
  nationality: NormalizedArtist['nationality'];
  /** True when heuristics could not confidently assign region/type */
  needsReview?: boolean;
};

/** Explicit overrides — canonical id → browse classification */
const BROWSE_OVERRIDES: Record<string, BrowseClassification> = {
  'bonbon-girls-303': { type: 'group', nationality: 'zh' },

  'from-youtube/kiiikiii': { type: 'group', nationality: 'kr' },
  'from-youtube/asmrz': { type: 'group', nationality: 'kr' },
  'from-youtube/cortis': { type: 'group', nationality: 'kr' },
  'from-youtube/hearts2hearts': { type: 'group', nationality: 'kr' },

  'from-youtube/lil-nas-x': { type: 'solo', nationality: 'en' },
  'from-youtube/lulleaux-kid-princess': { type: 'group', nationality: 'en' },

  'from-youtube/于冬然': { type: 'solo', nationality: 'zh' },
  'from-youtube/刀酱': { type: 'solo', nationality: 'zh' },
  'from-youtube/吉星出租': { type: 'solo', nationality: 'zh' },
  'from-youtube/就是南方凯': { type: 'solo', nationality: 'zh' },
  'from-youtube/尹露浠': { type: 'solo', nationality: 'zh' },
  'from-youtube/林晨阳': { type: 'solo', nationality: 'zh' },
  'from-youtube/郑业成': { type: 'solo', nationality: 'zh' },

  'from-youtube/武星-任胤蓬-用户指定': { type: 'group', nationality: 'zh' },
  'from-youtube/王宇宙leto-乔浚丞': { type: 'group', nationality: 'zh' },

  'from-youtube/fairy-tail-op-妖精的尾巴-フェアリーテイル-boa-보아': { type: 'project', nationality: 'other' },
  'from-youtube/bilibili-2021毕业歌': { type: 'project', nationality: 'other' },
  'from-youtube/blossoms-shanghai': { type: 'project', nationality: 'other' },
  'from-youtube/ed-sheeran-pokémon': { type: 'project', nationality: 'other' },
  'from-youtube/when-the-phone-rings': { type: 'project', nationality: 'other' },
  'from-youtube/光与夜之恋': { type: 'project', nationality: 'other' },
};

const NFKC = (s: string) => s.normalize('NFKC');
const hasHan = (s: string) => /[\u3400-\u9fff]/u.test(s);
const hasHangul = (s: string) => /[\uac00-\ud7af]/u.test(s);
const hasKana = (s: string) => /[\u3040-\u30ff]/u.test(s);

/** Slug/title hints that this row is an IP / show / campaign, not a person */
const PROJECT_SLUG_RE =
  /(op|ed|ost|主题曲|插曲|妖精的尾巴|pokemon|pokémon|bilibili|毕业歌|恋与|深空|原神|星穹|纸嫁衣|王者荣耀|光与夜|毕业|电视剧|用户指定|when-the-phone)/i;

const GROUP_SLUG_RE =
  /(girls|boys|303|group|band|project|duo|trio|quartet|heart|hearts|kiii|asmrz|cortis|bonbon|twice|aespa|ive|illit|itzy|kep1er|zb1|nct|wayv)/i;

function heuristicClassify(canonicalArtistId: string, displayName: string): BrowseClassification {
  const slug = canonicalArtistId.startsWith('from-youtube/')
    ? canonicalArtistId.slice('from-youtube/'.length)
    : canonicalArtistId;
  const hay = `${slug} ${displayName}`;
  const h = NFKC(hay);

  if (PROJECT_SLUG_RE.test(h) || (slug.length > 40 && /主题曲|OST|钢琴版|cover/i.test(h))) {
    return { type: 'project', nationality: 'other' };
  }

  if (GROUP_SLUG_RE.test(slug) || /&|×|x\s+/i.test(displayName)) {
    let nationality: NormalizedArtist['nationality'] = 'other';
    if (hasHangul(h) || /[a-z]{2,}-[a-z]{2,}/i.test(slug)) nationality = 'kr';
    else if (hasHan(h)) nationality = 'zh';
    else if (hasKana(h)) nationality = 'jp';
    else if (/^[a-z0-9\s&.'-]+$/i.test(displayName.trim()) && !hasHan(h)) nationality = 'en';
    return { type: 'group', nationality };
  }

  if (hasHangul(h)) return { type: 'solo', nationality: 'kr' };
  if (hasKana(h)) return { type: 'solo', nationality: 'jp' };
  if (hasHan(h)) return { type: 'solo', nationality: 'zh' };

  if (/^[a-z][a-z0-9\s.'-]*$/i.test(displayName.trim()) || /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+/.test(displayName.trim())) {
    return { type: 'solo', nationality: 'en' };
  }

  return { type: 'unknown', nationality: 'other', needsReview: true };
}

/**
 * When `ARTIST_DICTIONARY` has no entry, infer browse type + nationality for filters.
 */
export function inferBrowseClassificationForUnknownArtist(
  canonicalArtistId: string,
  displayName: string,
): BrowseClassification {
  const trimmed = displayName.trim() || canonicalArtistId;
  const o = BROWSE_OVERRIDES[canonicalArtistId];
  if (o) return { ...o };

  return heuristicClassify(canonicalArtistId, trimmed);
}
