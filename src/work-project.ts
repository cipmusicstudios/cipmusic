/**
 * 作品级来源（电影 / 游戏 / 剧集 / franchise），区别于 artist 与普通分类。
 * 统一字段名：workProjectKey（manifest / Track 上使用；值为稳定 slug）。
 */
import type { Track } from './types/track';

/** 从任意展示/元数据字符串推断作品 key（与 artist、category 独立） */
export function inferWorkProjectKeyFromText(haystack: string | undefined | null): string | undefined {
  if (!haystack || typeof haystack !== 'string') return undefined;
  const s = haystack.trim();
  if (!s) return undefined;
  if (/KPop Demon Hunters|KPOP Demon Hunters/i.test(s)) return 'kpop-demon-hunters';
  if (/崩坏：星穹铁道|星穹铁道|Honkai:\s*Star Rail|Honkai Star Rail/i.test(s)) return 'honkai-star-rail';
  if (/原神|Genshin Impact/i.test(s)) return 'genshin-impact';
  if (/恋与深空|Love and Deepspace/i.test(s)) return 'love-and-deepspace';
  if (/你是我的荣耀/i.test(s)) return 'ni-shi-wo-de-rong-yao';
  if (/王者荣耀|Honor of Kings/i.test(s)) return 'honor-of-kings';
  if (/英雄联盟|英雄聯盟|league\s*of\s*legends|\bLoL\b|worlds\s*anthem/i.test(s)) return 'league-of-legends';
  if (/纸嫁衣|Paper Bride/i.test(s)) return 'paper-bride';
  if (/黑神话|黑神話|Black Myth:\s*Wukong|Black Myth Wukong/i.test(s)) return 'black-myth-wukong';
  if (/恋与制作人|戀與製作人|Mr\.?\s*Love|Love and Producer/i.test(s)) return 'love-and-producer';
  return undefined;
}

export function getWorkProjectKey(track: Track): string | undefined {
  const explicit = track.workProjectKey ?? track.metadata.display.workProjectKey;
  if (explicit) return explicit;
  const src = track.sourceArtist || '';
  let k = inferWorkProjectKeyFromText(src);
  if (k) return k;
  const ytHint = (track as { _cipMatchedVideoTitle?: string })._cipMatchedVideoTitle;
  if (ytHint) {
    k = inferWorkProjectKeyFromText(ytHint);
    if (k) return k;
  }
  return undefined;
}
