/**
 * Artist attribution: survival-show unified IDs + source (game/show) fallbacks.
 * Used only when explicit singer resolution did not already pick a canonical id.
 */

import { normalizeYoutubeTitleForArtistParse } from './text-normalize-compare';

/** Normalize combined video title + seed artist for rule tests. */
export function buildAttributionHaystack(videoTitle: string | null | undefined, rawArtist: string | null | undefined): string {
  const a = (videoTitle || '').trim();
  const b = (rawArtist || '').trim();
  return normalizeYoutubeTitleForArtistParse(`${a} ${b}`);
}

export type SurvivalShowMatch = { canonicalId: string; note: string };

/**
 * 选秀 / 节目统一归属（仅在未命中「明确歌手」时使用，由调用方保证顺序）。
 * 顺序：更具体的节目名先匹配（Boys 2 Planet 先于 Boys Planet）。
 */
export function matchSurvivalShowUnified(haystackNormalized: string): SurvivalShowMatch | null {
  const s = haystackNormalized.normalize('NFKC').toLowerCase();

  if (
    /boys\s*2\s*planet|boys2planet|boys\s*ii\s*planet|boys\s*ll\s*planet|alpha\s*drive\s*one|love\s*is.*chains/i.test(
      s,
    )
  ) {
    return { canonicalId: 'alpha-drive-one', note: 'survival_show_boys2_planet_alpha_drive_one' };
  }
  if (/\bboys\s*planet\b/.test(s) && !/girls\s*planet/.test(s)) {
    return { canonicalId: 'zerobaseone', note: 'survival_show_boys_planet_zb1' };
  }
  if (/创造营\s*2021|chuang\s*2021|chuang2021/.test(s)) {
    return { canonicalId: 'into1', note: 'survival_show_chuang2021_into1' };
  }
  if (/girls\s*planet\s*999|girlsplanet999|\bgp\s*999\b/.test(s)) {
    return { canonicalId: 'kep1er', note: 'survival_show_gp999_kep1er' };
  }
  if (/青春有你|青你|youth\s+with\s+you|youthwithyou/.test(s)) {
    return { canonicalId: 'the9', note: 'survival_show_youth_with_you_the9' };
  }

  return null;
}

export type SourceAttributionMatch = { canonicalId: string; note: string };

/**
 * 无明确歌手时的来源归属（游戏 / 企划等），优先级低于 survival show 的调用顺序由 canonical 控制。
 */
export function matchSourceAttributionFallback(haystackNormalized: string): SourceAttributionMatch | null {
  const s = haystackNormalized.normalize('NFKC').toLowerCase();

  if (/原神|genshin\s*impact|genshinlmpact|genshin\s*lmpact/.test(s)) {
    return { canonicalId: 'genshin-impact', note: 'source_attribution_genshin_impact' };
  }
  if (/崩坏.*星穹|星穹铁道|honkai.*star\s*rail|honkai\s*:\s*star/.test(s)) {
    return { canonicalId: 'honkai-star-rail', note: 'source_attribution_honkai_star_rail' };
  }
  if (/崩坏\s*3|honkai\s*impact\s*3|崩壞\s*3rd/.test(s)) {
    return { canonicalId: 'honkai-impact-3', note: 'source_attribution_honkai_impact_3' };
  }
  if (/王者荣耀|honor\s+of\s+kings|周瑜|小乔/.test(s)) {
    return { canonicalId: 'honor-of-kings', note: 'source_attribution_honor_of_kings' };
  }
  if (/纸嫁衣/.test(s)) {
    return { canonicalId: 'paper-bride', note: 'source_attribution_paper_bride' };
  }
  /** Same IP: do not mint separate “时空引力 / 主题曲” artist buckets for OST-only lines. */
  if (
    /love\s*and\s*deepspace|恋与深空|戀與深空|gravity\s*of\s*spacetime/i.test(s) ||
    (/时空引力/i.test(s) && /deepspace|恋与深空|戀與深空/i.test(s))
  ) {
    return { canonicalId: 'love-and-deepspace', note: 'source_attribution_love_and_deepspace' };
  }

  return null;
}
