/**
 * Canonical artist resolution for manifests and UI aggregation.
 * Priority: (1) explicit singer in video+seed (solo/group in dictionary, not project rows)
 * → (2) survival-show unified IDs → (3) game/show source attribution
 * → (4) YouTube structured extract + alias + freeform. Uncertain → needsReview.
 */
import { ARTIST_DICTIONARY, lookupKnownArtistId } from './local-import-artist-normalization';
import {
  findBestExplicitArtistInHaystack,
  findKnownArtistDictIdInVideoTitle,
} from './artist-from-video-title';
import {
  buildAttributionHaystack,
  matchSourceAttributionFallback,
  matchSurvivalShowUnified,
} from './artist-attribution-rules';
import {
  extractYoutubeArtistString,
  isSafeYoutubeFreeformArtist,
  normalizeArtistKeyForLookup,
} from './youtube-title-artist-extract';

export type ArtistReviewStatus = 'ok' | 'needsReview' | 'unknown';

export type CanonicalArtistResolution = {
  originalArtistRaw: string;
  canonicalArtistId: string;
  canonicalArtistDisplayName: string;
  artistReviewStatus: ArtistReviewStatus;
  notes: string[];
  /** When set, track also appears under these artist buckets (duets / collaborations). */
  coCanonicalArtistIds?: string[];
};

const NFKC = (s: string) => s.normalize('NFKC').trim();

/** Trim stray separators often left by bad scrapes (“- 歌手”, “| 歌手”). */
function stripArtistFieldNoise(s: string): string {
  return NFKC(s)
    .replace(/^[\s\-–—:|｜]+/g, '')
    .replace(/[\s\-–—:|｜]+$/g, '')
    .trim();
}

/** Manual: raw substring → canonical id (expand in PR as you audit). */
const CANONICAL_MERGE_OVERRIDES: Record<string, string> = {};

/**
 * Old freeform `from-youtube/...` buckets → real dictionary ids after rule fixes.
 * Applied after resolution so manifests and UI converge without re-seeding everything.
 */
const LEGACY_CANONICAL_ID_REDIRECTS: Record<string, string> = {
  'from-youtube/胡彦斌-我为歌狂-插曲': 'hu-yan-bin',
  'from-youtube/巫哲小说': 'kai-se-miao',
  'from-youtube/love-and-deepspace-恋与深空-抽卡bgm': 'love-and-deepspace',
  'from-youtube/时空引力-gravity-of-spacetime-love-and-deepspace': 'love-and-deepspace',
  'from-youtube/boys-ll-planet-love-is': 'alpha-drive-one',
  'from-youtube/kpop-demon-hunters-saja-boys': 'saja-boys',
  'from-youtube/kpop-demon-hunters': 'huntr-x',
  'from-youtube/治愈系-科目三抒情古风钢琴版-tik-tok-hit-song': 'wen-ren-ting-shu',
  'from-youtube/ne-yo': 'ne-yo',
  'from-youtube/fairy-town-小野来了': 'xiao-ye-lai-le',
  'from-youtube/ft.-pvris-worlds-2021-league-of-legends': 'pvris',
  'from-youtube/进撃の巨人-season-2-hiroyuki-sawano': 'hiroyuki-sawano',
  'from-youtube/井胧-井迪儿-drama-love-between-fairy-and-devil': 'jing-long-jing-dier',
  'from-youtube/镌刻-钢琴版-张碧晨zhang-bichen-电视剧': 'zhang-bi-chen',
  'from-youtube/allday-project': 'allday-project',
};

/** UI / search: resolve legacy freeform ids to merged dictionary ids (same as manifest redirects). */
export function dictionaryCanonicalId(canonicalArtistId: string): string {
  return LEGACY_CANONICAL_ID_REDIRECTS[canonicalArtistId] ?? canonicalArtistId;
}

function applyCanonicalIdRedirects(res: CanonicalArtistResolution): CanonicalArtistResolution {
  const to = LEGACY_CANONICAL_ID_REDIRECTS[res.canonicalArtistId];
  if (!to) return res;
  return {
    ...res,
    canonicalArtistId: to,
    canonicalArtistDisplayName: displayNameForDictionaryId(to),
    notes: [...res.notes, 'legacy_canonical_redirect'],
  };
}

export type TrackCanonicalFix = {
  canonicalId: string;
  note: string;
  /** When set, overrides dictionary display name (e.g. review buckets not in ARTIST_DICTIONARY). */
  displayNameOverride?: string;
  artistReviewStatus?: ArtistReviewStatus;
  /** Duet / collab: also aggregate under these canonical ids (e.g. both singers get this song). */
  coCanonicalArtistIds?: string[];
};

/** Per-track overrides when seed/YouTube parsing cannot express the real singer or project bucket. */
export const TRACK_CANONICAL_BY_ID: Record<string, TrackCanonicalFix> = {
  local_bye_bye_bye: { canonicalId: 'nsync', note: 'manual_confirmed_nsync' },
  /** 哈基米 — 无明确原唱；梗曲封面，不按标题误解析歌手。 */
  local_哈基米: {
    canonicalId: 'review/meme-no-vocal',
    displayNameOverride: '（无原唱）',
    artistReviewStatus: 'unknown',
    note: 'hakimi_meme_no_vocal',
  },
  local_撒野: { canonicalId: 'kai-se-miao', note: 'track_saye_vocalist_凯瑟喵' },
  /** 《陈情令》无羁 — 双原唱，同时归入王一博、肖战艺人桶。 */
  local_无羁: {
    canonicalId: 'wang-yi-bo',
    coCanonicalArtistIds: ['xiao-zhan'],
    displayNameOverride: '王一博、肖战',
    note: 'the_untamed_wuji_both_vocalists',
  },
  local_经过: { canonicalId: 'zhang-jie', note: 'track_passing_memories_zhang_jie' },
  local_莫离: { canonicalId: 'ju-jing-yi', note: 'track_mo_li_ju_jingyi' },
  local_续写: { canonicalId: 'shan-yi-chun', note: 'track_xu_xie_shan_yichun' },
  local_菩萨蛮: { canonicalId: 'bella-yao', note: 'track_pusa_man_yaobeina' },
  local_笼: { canonicalId: 'zhang-bi-chen', note: 'track_long_zhang_bichen_film' },
  local_来生戏: { canonicalId: 'paper-bride', note: 'track_laishengxi_paper_bride_series' },
  local_明日坐标: {
    canonicalId: 'jj-lin',
    coCanonicalArtistIds: ['honor-of-kings'],
    displayNameOverride: '林俊杰、王者荣耀',
    note: 'hok_ten_year_atlas_jj_lin',
  },
  local_奇迹时刻: {
    canonicalId: 'zhou-shen',
    coCanonicalArtistIds: ['honor-of-kings'],
    displayNameOverride: '周深、王者荣耀',
    note: 'hok_friends_day_miracle_zhou',
  },
  local_时结: {
    canonicalId: 'zhou-shen',
    coCanonicalArtistIds: ['honor-of-kings'],
    displayNameOverride: '周深、王者荣耀',
    note: 'hok_glory_festival_shijie_zhou',
  },
  local_无双的王者: {
    canonicalId: 'gem',
    coCanonicalArtistIds: ['honor-of-kings'],
    displayNameOverride: '邓紫棋、王者荣耀',
    note: 'hok_worlds_peerless_king_gem',
  },
  local_如故: { canonicalId: 'zhang-bi-chen', note: 'track_rugu_zhang_bichen_ost' },
  /** 《悟》梦幻西游手游孙悟空角色曲 — 原唱张艺兴。 */
  local_悟: { canonicalId: 'lay-zhang', note: 'track_wu_fantasy_westward_lay_zhang' },
  /** 《你是我的荣耀》OST；原唱米卡+希林娜依·高 — 归档希林艺人桶，曲下保留双人署名。 */
  local_陷入爱情: {
    canonicalId: 'curley-gao',
    displayNameOverride: '希林娜依·高、INTO1 米卡',
    note: 'yamg_fall_in_love_mika_curley_primary_curley',
  },
  /** 《周生如故》人物主题曲。 */
  local_如一: { canonicalId: 'ren-jialun', note: 'zhou_sheng_gu_ruyi_allen_ren' },
  local_洄: { canonicalId: 'wang-yuan', note: 'track_hui_roy_wang_no_feat' },
  /** 《可》双人曲 — 同时归入张靓颖、薛之谦。 */
  local_可: {
    canonicalId: 'zhang-liang-ying',
    coCanonicalArtistIds: ['joker-xue'],
    displayNameOverride: '张靓颖、薛之谦',
    note: 'duet_ke_jane_and_joker',
  },
  local_旅行: {
    canonicalId: 'tf-family-3rd',
    displayNameOverride: 'TF家族三代（苏新皓、左航）',
    note: 'track_lvxing_tf3_su_zuo',
  },
  /** APT. — 合作曲；主桶 ROSÉ，副桶 Bruno Mars，列表展示全名。 */
  local_APT: {
    canonicalId: 'rose',
    coCanonicalArtistIds: ['bruno-mars'],
    displayNameOverride: 'Rosé和Bruno Mars',
    artistReviewStatus: 'ok',
    note: 'apt_rosé_bruno_mars_collab',
  },
  local_斗地主: { canonicalId: 'dou-dizhu-game', note: 'track_dou_dizhu_game_no_vocalist' },
  local_冒险计划: { canonicalId: 'into1', note: 'track_maoxian_jihua_into1' },
  local_白话文: {
    canonicalId: 'into1',
    displayNameOverride: 'INTO1刘宇',
    artistReviewStatus: 'ok',
    note: 'track_baihuawen_liu_yu_into1_credit',
  },
  /** F4 Thailand OST — Spotify 署名为四人合唱；不建独立艺人词条（review 桶仅作归档）。 */
  local_who_am_i: {
    canonicalId: 'review/f4-thailand-who-am-i-ost',
    displayNameOverride: 'BRIGHT、WIN METAWIN、Dew Jirawat、Nani Hirunkit',
    artistReviewStatus: 'ok',
    note: 'track_f4_thailand_who_am_i_spotify_credit_no_dict',
  },
  local_没出息: {
    canonicalId: 'review/local-meichuxi-no-vocal',
    displayNameOverride: '\u201C本来应该从从容容游刃有余\u201D',
    artistReviewStatus: 'unknown',
    note: 'track_meichuxi_subtitle_from_video',
  },
  local_起风了: { canonicalId: 'takahiro', note: 'track_qifengle_takahiro_yakimochi' },
  local_上春山: { canonicalId: 'shang-chun-shan-trio', note: 'track_cctv_trio_single_bucket' },
  local_溯: { canonicalId: 'hu-meng-zhou', note: 'track_su_reverse_corsak' },
  local_调查中: {
    canonicalId: 'zhou-shen',
    coCanonicalArtistIds: ['hu-meng-zhou'],
    displayNameOverride: '周深、胡梦周',
    note: 'duet_diaochazhong_zhou_corsak',
  },
  local_天地龙鳞: { canonicalId: 'wang-lee-hom', note: 'track_tiandilonglin_leehom' },
  local_小小: { canonicalId: 'joey-yung', note: 'track_xiaoxiao_joey_yung' },
  local_新宝岛: {
    canonicalId: 'review/local-xinbaodao-no-vocal',
    displayNameOverride: '（无原唱）',
    artistReviewStatus: 'unknown',
    note: 'track_xinbaodao_no_vocal_credit',
  },
  /** 特摄 OST — 不保留「毛华锋」独立艺人卡；归档为 review 桶（仅曲目列表展示）。 */
  local_信念之光: {
    canonicalId: 'review/ultraman-trigger-belief-light',
    displayNameOverride: '《特利迦奥特曼》信念之光',
    artistReviewStatus: 'needsReview',
    note: 'ultraman_ost_no_mao_huafeng_artist_card',
  },
  /** 《恋与深空》游戏侧发行；归档至 love-and-deepspace 艺人桶。 */
  local_春天对花所做的事: {
    canonicalId: 'love-and-deepspace',
    displayNameOverride: '恋与深空',
    note: 'love_and_deepspace_spring_flowers_curley_vocal_game_bucket',
  },
  local_夜蝶: { canonicalId: 'snh48', note: 'track_yedie_snh48' },
  local_姻缘: { canonicalId: 'kep1er', note: 'track_yinyuan_kep1er_gp999' },
  local_有你: { canonicalId: 'tnt', note: 'track_youni_tnt' },
  local_朱雀: { canonicalId: 'tnt', note: 'track_zhuque_tnt' },
  local_渐暖: { canonicalId: 'tnt', note: 'track_jiannuan_tnt' },
  /** 《芥》丁程鑫个人单曲 — 归档丁程鑫艺人桶（非团桶）。 */
  local_芥: { canonicalId: 'ding-chengxin', note: 'track_jie_ding_chengxin_solo' },
  local_珠玉: { canonicalId: 'shan-yi-chun', note: 'track_zhuyu_shan_yichun_only' },
  local_乘风: {
    canonicalId: 'review/chengfeng-theme-no-vocal',
    displayNameOverride: '乘风破浪的姐姐',
    artistReviewStatus: 'ok',
    note: 'track_chengfeng_sisters_who_make_waves_theme_display_only',
  },
  local_春雪: { canonicalId: 'zhou-shen', note: 'track_chunxue_zhou_shen_terry_note_in_meta' },
  local_飞天: { canonicalId: 'lay-zhang', note: 'track_feitian_lay' },
  local_孤勇者: { canonicalId: 'eason-chan', note: 'track_guyongzhe_eason' },
  local_坏女孩: { canonicalId: 'xu-liang', note: 'track_huainvhai_xu_liang_no_xiaoling_bucket' },
  local_科目三: { canonicalId: 'yixiao-jianghu', note: 'track_kemu_yixiao_jianghu_project' },
  local_铃芽之旅: { canonicalId: 'zhou-shen', note: 'track_suzume_radwimps_cover_zhou' },
  local_一路生花: {
    canonicalId: 'zhou-shen',
    coCanonicalArtistIds: ['angela-szu-han-chang'],
    displayNameOverride: '周深、张韶涵',
    note: 'duet_yilu_shenghua_zhou_angela',
  },
  local_M八七: { canonicalId: 'kenshi-yonezu', note: 'track_m87_yonezu_anime' },
  local_像你这样的朋友: { canonicalId: '0713-nan-tuan', note: 'track_0713_group_multivocal' },
  local_恋与深空主题曲: { canonicalId: 'love-and-deepspace', note: 'track_lds_theme_unified_project' },
  local_时空引力: { canonicalId: 'love-and-deepspace', note: 'track_lds_same_ip_as_theme' },
  local_有梦好甜蜜: { canonicalId: 'hu-yan-bin', note: 'track_strip_ost_suffix_to_singer' },
  /** Spider-Verse “Calling” — not AoT / Call of Silence */
  local_calling: { canonicalId: 'metro-boomin', note: 'track_spiderverse_calling_ost' },
  local_chains: { canonicalId: 'alpha-drive-one', note: 'track_boys2_planet_chains' },
  local_free: { canonicalId: 'huntr-x', note: 'track_kpop_movie_huntr_x_not_movie_title' },
  local_take_down: { canonicalId: 'huntr-x', note: 'track_kpop_movie_huntr_x_not_movie_title' },
  local_soda_pop: { canonicalId: 'saja-boys', note: 'track_kpop_movie_saja_boys' },
  local_your_idol: { canonicalId: 'saja-boys', note: 'track_kpop_movie_saja_boys' },
  /** 《余生，请多指教》— 主桶杨紫、副桶肖战；非「组合艺人」词条。 */
  local_余生请多指教: {
    canonicalId: 'yang-zi',
    coCanonicalArtistIds: ['xiao-zhan'],
    displayNameOverride: '杨紫',
    artistReviewStatus: 'ok',
    note: 'oath_of_love_yang_zi_primary_xiao_zhan_co',
  },
  /** 同上（Supabase 行 / manifest 远程 id）。 */
  '08d4ba85-3267-46c6-8ff2-47e43ea5135f': {
    canonicalId: 'yang-zi',
    coCanonicalArtistIds: ['xiao-zhan'],
    displayNameOverride: '杨紫',
    artistReviewStatus: 'ok',
    note: 'remote_oath_of_love_dual_bucket',
  },
  '86934514-6ca8-41c2-bee0-e2a600d906de': {
    canonicalId: 'review/meme-no-vocal',
    displayNameOverride: '（无原唱）',
    artistReviewStatus: 'unknown',
    note: 'remote_hakimi_no_vocal',
  },
  'f32015b8-c2da-4d14-b341-9b93482f2d1e': {
    canonicalId: 'dou-dizhu-game',
    displayNameOverride: '（无原唱）',
    artistReviewStatus: 'ok',
    note: 'remote_dou_dizhu_game_bucket',
  },
  '312afe3d-ee3c-4a6c-829a-85b05d9a1c9a': {
    canonicalId: 'hearts2hearts',
    artistReviewStatus: 'ok',
    note: 'remote_style_hearts2hearts',
  },
  '25349319-a16a-4628-900f-db645bfcc630': {
    canonicalId: 'rose',
    artistReviewStatus: 'ok',
    note: 'remote_messy_rosé',
  },
  'e17a0211-1411-4406-aadb-5d9235a268d0': {
    canonicalId: 'rose',
    coCanonicalArtistIds: ['bruno-mars'],
    displayNameOverride: 'Rosé和Bruno Mars',
    artistReviewStatus: 'ok',
    note: 'remote_apt_rosé_bruno',
  },
  'da08d496-7d6a-4c9d-9a2c-b0e13050881f': {
    canonicalId: 'zerobaseone',
    artistReviewStatus: 'ok',
    note: 'remote_good_so_bad_zb1',
  },
  '66c8d624-fa20-45b6-84e2-8dbae7a0b5e8': {
    canonicalId: 'kiiikiii',
    artistReviewStatus: 'ok',
    note: 'remote_i_do_me',
  },
  '7087d95a-e7dc-498b-b70a-580fdfdb935e': {
    canonicalId: 'kiiikiii',
    artistReviewStatus: 'ok',
    note: 'remote_dancing_alone',
  },
  /** Arcane S2 / 陈奕迅；曾误解析原唱字段。 */
  'ad55d05d-c0cb-46fc-89b8-5f779540874d': {
    canonicalId: 'eason-chan',
    displayNameOverride: '陈奕迅',
    artistReviewStatus: 'ok',
    note: 'remote_zheyang_hen_hao_arcane_eason',
  },
  /** Worlds 2022 anthem。 */
  '725e0fea-983b-459f-b027-104aaf0bacb7': {
    canonicalId: 'lil-nas-x',
    displayNameOverride: 'Lil Nas X',
    artistReviewStatus: 'ok',
    note: 'remote_star_walkin_worlds',
  },
  local_Falling_You_刘耀文: {
    canonicalId: 'liu-yao-wen',
    displayNameOverride: '刘耀文',
    artistReviewStatus: 'ok',
    note: 'falling_you_liu_yaowen_folder',
  },
  local_Falling_You_都智文_曾可妮: {
    canonicalId: 'du-zhi-wen',
    coCanonicalArtistIds: ['zeng-ke-ni'],
    displayNameOverride: '都智文、曾可妮',
    artistReviewStatus: 'ok',
    note: 'falling_you_du_zhiwen_zeng_keni_folder',
  },
  /** 《骄阳似我》OST 误绑章昊；本音频为 Kep1er《Shine》(GP999)。 */
  'bca4dd1b-8dcd-44ba-9b49-e0523faa3b90': {
    canonicalId: 'kep1er',
    displayNameOverride: 'Kep1er',
    artistReviewStatus: 'ok',
    note: 'remote_shine_kep1er_not_zhang_hao',
  },
  /** 《陈情令》无羁 — 远端行。 */
  '671d8dce-5f47-4d69-8891-5b3763d10d43': {
    canonicalId: 'wang-yi-bo',
    coCanonicalArtistIds: ['xiao-zhan'],
    displayNameOverride: '王一博、肖战',
    artistReviewStatus: 'ok',
    note: 'remote_wuji_both_vocalists',
  },
  local_全世界在你身后: {
    canonicalId: 'du-zhi-wen',
    displayNameOverride: '都智文',
    artistReviewStatus: 'ok',
    note: 'track_the_world_is_behind_you_du_zhiwen',
  },
  local_笨小孩的道歉信: {
    canonicalId: 'tf-family-3rd',
    displayNameOverride: 'TF家族三代',
    artistReviewStatus: 'ok',
    note: 'track_tf3_apology_letter',
  },
  local_等你的回答: {
    canonicalId: 'tf-family-3rd',
    displayNameOverride: 'TF家族三代',
    artistReviewStatus: 'ok',
    note: 'track_tf3_waiting_for_your_answer',
  },
  local_花西子: {
    canonicalId: 'zhou-shen',
    displayNameOverride: '周深',
    artistReviewStatus: 'ok',
    note: 'track_huaxizi_zhou_shen',
  },
  local_万里: {
    canonicalId: 'zhou-shen',
    displayNameOverride: '周深',
    artistReviewStatus: 'ok',
    note: 'track_wan_li_zhou_shen',
  },
  local_好好生活就是美好生活: {
    canonicalId: 'zhou-shen',
    displayNameOverride: '周深',
    artistReviewStatus: 'ok',
    note: 'track_haohao_shenghuo_zhou_shen',
  },
  local_桃花诺: {
    canonicalId: 'zhou-shen',
    coCanonicalArtistIds: ['song-ya-xuan'],
    displayNameOverride: '周深、宋亚轩',
    artistReviewStatus: 'ok',
    note: 'track_taohua_nuo_zhou_song',
  },
  local_forever_forever: {
    canonicalId: 'jay-chou',
    coCanonicalArtistIds: ['mayday', 'f4'],
    displayNameOverride: '周杰伦、五月天、F4',
    artistReviewStatus: 'ok',
    note: 'track_forever_forever_jay_mayday_f4',
  },
  local_像晴天像雨天任性: {
    canonicalId: 'silence-wang',
    coCanonicalArtistIds: ['mayday'],
    displayNameOverride: '汪苏泷、五月天',
    artistReviewStatus: 'ok',
    note: 'track_like_sunday_mayday_collab',
  },
  local_流星雨: {
    canonicalId: 'f4',
    displayNameOverride: 'F4',
    artistReviewStatus: 'ok',
    note: 'track_meteor_rain_f4',
  },
  local_dawn_to_dusk: {
    canonicalId: 'lay-zhang',
    displayNameOverride: '张艺兴',
    artistReviewStatus: 'ok',
    note: 'track_dawn_to_dusk_lay_only',
  },
  local_在加纳共和国离婚: {
    canonicalId: 'zhang-bi-chen',
    displayNameOverride: '张碧晨、杨坤',
    artistReviewStatus: 'ok',
    note: 'track_divorce_ghana_zhang_yangkun_no_yang_bucket',
  },
  local_我的舞台: {
    canonicalId: 'review/local-wodewutai-wuxing-ren',
    displayNameOverride: '武星、任胤蓬',
    artistReviewStatus: 'ok',
    note: 'track_my_stage_wuxing_renyinpeng_no_dict',
  },
  local_snake: { canonicalId: 'kep1er', artistReviewStatus: 'ok', note: 'track_snake_kep1er' },
  local_Utopia: { canonicalId: 'kep1er', artistReviewStatus: 'ok', note: 'track_utopia_kep1er' },
  local_xoxo: { canonicalId: 'jeon-somi', artistReviewStatus: 'ok', note: 'track_xoxo_somi' },
  local_the_feels: { canonicalId: 'twice', artistReviewStatus: 'ok', note: 'track_the_feels_twice' },
  local_dreams_come_true: { canonicalId: 'aespa', artistReviewStatus: 'ok', note: 'track_dreams_come_true_aespa' },
  local_Forever_1: { canonicalId: 'girls-generation', artistReviewStatus: 'ok', note: 'track_forever1_snsd' },
  local_Lalisa: {
    canonicalId: 'lisa',
    artistReviewStatus: 'ok',
    note: 'track_lalisa_lisa_solo',
  },
  local_pop_star: {
    canonicalId: 'league-of-legends',
    displayNameOverride: 'K/DA',
    artistReviewStatus: 'ok',
    note: 'track_popstar_kda_lol_virtual',
  },
  local_不眠之夜: {
    canonicalId: 'honkai-star-rail',
    coCanonicalArtistIds: ['zhang-jie'],
    displayNameOverride: '张杰、HOYO-MiX',
    artistReviewStatus: 'ok',
    note: 'track_hsr_white_night_zhang_jie_vocal',
  },
  /** Worlds 2021 — 产品口径归「英雄联盟」IP 原声（表演者 PVRIS）。 */
  local_Burn_it_all_down: {
    canonicalId: 'league-of-legends',
    displayNameOverride: '英雄联盟',
    artistReviewStatus: 'ok',
    note: 'track_worlds2021_burn_league_ip',
  },
  /** Fairy Town in title is the song; 小野来了 is the pianist / performer. */
  local_童话镇: { canonicalId: 'xiao-ye-lai-le', note: 'track_fairy_town_xiao_ye_lai_le' },
  /** AoT OST — composer only, not the anime title string. */
  local_call_of_silence: { canonicalId: 'hiroyuki-sawano', note: 'track_call_of_silence_sawano' },
  /** 苍兰诀 OST — credited singers only, not drama English title. */
  local_彼岸: { canonicalId: 'jing-long-jing-dier', note: 'track_canglan_jue_bian_singers' },
  /** 《花になれ / 幻化成花》原唱指田郁也；封面为花滑节目用曲语境，不按表演者羽生结弦归档。 */
  local_幻化成花: { canonicalId: 'fumiya-sashida', note: 'track_hana_ni_nare_vocalist_sashida_not_skater' },
  /** 《斛珠夫人》OST — 歌手张碧晨，勿把 YouTube 标题里的歌名/英文名并进艺人名。 */
  local_镌刻: { canonicalId: 'zhang-bi-chen', note: 'track_juan_ke_zhang_bichen_clean_credit' },
  /** 视频标题节日祝福语非艺人名 — 原唱王心凌。 */
  local_彩虹的微笑: { canonicalId: 'wang-xin-ling', note: 'track_cyndi_wang_strip_qixi_greeting' },
  /** aespa《Girls》— 曾误归 tripleS《Girls Never Die》。 */
  local_girls: { canonicalId: 'aespa', note: 'track_aespa_girls_not_triples_girls_never_die' },
  /** 合作曲 — 产品侧只展示主艺人周杰伦（勿带派偉俊/钢琴版尾缀）。 */
  local_Six_Degrees: { canonicalId: 'jay-chou', note: 'track_six_degrees_jay_chou_primary_credit' },
  /** ZICO《SPOT! (feat. JENNIE)》— 曾误配 Spider-Verse「Calling」相关视频；合作曲同时归入 JENNIE。 */
  local_SPOT: {
    canonicalId: 'zico',
    coCanonicalArtistIds: ['jennie'],
    note: 'track_zico_spot_feat_jennie_dual_bucket',
  },
};

const DESCRIPTOR_PATTERNS: RegExp[] = [
  /\s*[\|｜]\s*[^|]*$/gi,
  /\s*钢琴版\s*/gi,
  /\s*鋼琴版\s*/gi,
  /\s*piano\s*version\s*/gi,
  /\s*piano\s*cover\s*/gi,
  /\bPiano\s*Cover\b/gi,
  /\bPiano\s*Collections?\b/gi,
  /\bpiano\b/gi,
  /\bcover\s*by\b/gi,
  /\s*cover\s*/gi,
  /\s*练习曲\s*/g,
  /\s*纯音乐\s*/g,
  /\s*纯伴奏\s*/g,
  /\s*伴奏版\s*/g,
  /\s*抒情版\s*/g,
  /\s*inst\.?\s*/gi,
  /\s*instrumental\s*/gi,
  /\bOST\b/gi,
  /\bBGM\b/gi,
  /\s*片尾曲\s*/g,
  /\s*片头曲\s*/g,
  /\s*插曲\s*/g,
  /\s*推广曲\s*/g,
  /\s*主题曲\s*/g,
  /\s*主題曲\s*/g,
  /\s*启航曲\s*/g,
  /\s*theme\s*song\s*/gi,
  /\s*short\s*ver\.?\s*/gi,
  /\s*TV\s*size\s*/gi,
  /\s*完整版\s*/g,
  /\s*抖音\s*/g,
  /\s*热门\s*/g,
  /「[^」]+」\s*$/g,
  /《[^》]+》\s*/g,
  /\s*第\d+集\s*/g,
  /\s*EP\d*\s*/gi,
  /\s*vol\.?\s*\d+\s*/gi,
  /\bSeason\s*\d+\b/gi,
  /\bWorlds?\s+\d{4}\s*Anthem\b/gi,
  /\bMain\s*Theme\b/gi,
  /\bCelestial\s*Symphony\b/gi,
  /\bsingal\s*song\b/gi,
  /\bsignal\s*song\b/gi,
  /\s*情人节新歌\s*/g,
  /\s*七夕快乐[!！]?\s*/g,
  /\s*跨年晚会\s*/g,
  /\s*奇妙夜\s*/g,
  /\s*电视剧\s*/gi,
  /\s*電視劇\s*/gi,
  /\s*电影\s*/g,
  /\s*電影\s*/g,
  /\s*动漫\s*/g,
  /\s*動漫\s*/g,
  /\s*综艺\s*/g,
  /\s*游戏\s*/g,
  /\s*古风\s*/g,
  /\s*舒缓治愈助眠[吗嗎]?\s*/g,
  /\s*离谱[!！]?这也能\s*/g,
  /\s*新歌\s*/g,
  /\bHug\s*Me\b/gi,
];

const LEADING_JUNK = /^(电影|電影|电视剧|電視劇|动漫|動漫|手游|网游|游戏|配乐|配樂|原声|原聲)[：:]\s*/i;

const SEPARATOR_SPLIT = /\s*(?:&|×|x(?![a-z])|feat\.?|ft\.?|with|、|\/|,\s|丨|＋|\+|(?:\s-\s)|(?:\s{2,}))\s*/i;

const NON_ARTIST_EXACT = new Set(
  [
    'ost', 'bgm', 'unknown', 'various', 'va', 'n/a', 'na', 'instrumental', '钢琴', '鋼琴', '练习曲', '纯音乐',
    'theme', 'themesong', 'cover', 'piano', 'acoustic', 'live', 'remix', 'edit', 'ver', 'version',
    '片头曲', '片尾曲', '主题曲', '主題曲', '插曲', '歌曲', '钢琴版', '鋼琴版', '抒情版',
    '古风', '情古风', '游戏', '动漫', '電視劇', '电视剧', '电影', '電影', '综艺',
    '周年', 'radio', 'echo', 'fi', 'it', 'unicorn', 'cmj', 'asmrz', 'deadpool',
  ].map(s => s.toLowerCase()),
);

function stripDescriptors(s: string): string {
  let out = NFKC(s);
  out = out.replace(LEADING_JUNK, '');
  for (const re of DESCRIPTOR_PATTERNS) {
    out = out.replace(re, ' ');
  }
  /** Strip repeated “《歌名》钢琴版 …” prefixes so performer at the end survives. */
  let prev: string;
  do {
    prev = out;
    out = out.replace(/^《[^》]+》\s*(?:钢琴版|鋼琴版)?\s*/u, ' ');
  } while (out !== prev);
  out = NFKC(out.replace(/\s+/g, ' '))
    .replace(/^["'「『【\s]+|["'」』】\s]+$/g, '')
    .replace(/^[\s\-–—:|｜]+/g, '')
    .replace(/[\s\-–—:|｜]+$/g, '')
    .replace(/[\s–—\-]+$/g, '')
    .trim();
  return out;
}

function slugifyForCanonical(display: string): string {
  const base = NFKC(display)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+.-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base.slice(0, 80) || 'x';
}

function foldForCompare(s: string): string {
  return NFKC(s)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[’'""「」『』《》]/g, '');
}

const NON_ARTIST_PATTERNS: RegExp[] = [
  /^[【\[《「『].*[】\]》」』]$/,
  /进撃の巨人|Attack\s*On\s*Titan/i,
  /Honkai.*Star\s*Rail/i,
  /崩坏.*星穹铁道|崩坏.*星轨铁道/,
  /原神|Genshin\s*Impact/i,
  /偶像练习生/,
  /创造营\d*/,
  /Girls\s*Planet\s*\d*/i,
  /KPOP\s*Demon\s*Hunters/i,
  /Blossoms\s*Shanghai/i,
  /繁花/,
  /光与夜之恋/,
  /纸嫁衣\d*/,
  /乘风破浪/,
  /你是我的荣耀/,
  /吉星出租/,
  /^钢琴\s/,
  /^【钢琴】/,
  /斗地主/,
  /新宝[岛島]/,
  /^本来应该/,
  /的夜跨年/,
  /^视中秋/,
  /^洄\s*\(By Now\)/i,
  /^溯Reverse/i,
  /^回到過去/,
  /^天地龍鱗/,
  /^彼岸\s*The\s*Other/i,
  /^愛丫愛丫/,
  /^我们啊$/,
  /^致郁系$/,
  /^就是南方凯$/,
  /^K\s*er$/i,
  /^m-taku$/i,
  /^Lady\s*Nana$/i,
  /^Lil\s+Nas$/i,
  /^24k\w+$/i,
  /^JORKER$/i,
  /^ØzcarWang$/i,
  /^Pu\s+Shu$/i,
  /^CORTIS/i,
  /^ALLDAY\s*PROJECT/i,
  /^Hearts2Hearts/i,
  /^KiiiKiii/i,
  /^F4\s*Thailand/i,
  /^Ailee/i,
  /^Nicky\s*Lee$/i,
  /^倖田來未/,
];

function isGarbageString(s: string): boolean {
  const t = NFKC(s);
  if (!t) return true;
  if (t.length < 2) return true;
  if (/^[\d\s._\-–—+／/]+$/.test(t)) return true;
  if (/^[^\p{L}\p{N}]+$/u.test(t)) return true;
  if (/…|\.\.\.|…\s*$/.test(t) && t.length < 6) return true;
  if (NON_ARTIST_EXACT.has(t.toLowerCase())) return true;
  return false;
}

function looksLikeNonArtist(s: string): boolean {
  const t = NFKC(s);
  if (NON_ARTIST_PATTERNS.some(re => re.test(t))) return true;
  if (/^[《「『【\[]/.test(t)) return true;
  if (/[》」』】\]]$/.test(t) && !/[)\)）]$/.test(t)) return true;
  if (/[：:]/.test(t) && !lookupKnownArtistId(t.split(/[：:]/)[0])) return true;
  if (/Penacony|WHITE\s*NIGHT/i.test(t)) return true;
  return false;
}

function looksLikeTruncation(s: string): boolean {
  return /[,，、]$/.test(s) || /\.{3,}$/.test(s) || /…\s*$/.test(s);
}

function displayNameForDictionaryId(id: string): string {
  const row = ARTIST_DICTIONARY[id];
  if (row) return row.names.zhHans || row.names.en || id;
  return id;
}

function primarySegment(raw: string): string {
  const parts = raw
    .split(SEPARATOR_SPLIT)
    .map(p => NFKC(p))
    .filter(Boolean);
  if (parts.length === 0) return '';
  const scored = parts.map(part => {
    const id = lookupKnownArtistId(part);
    return { part, id, known: Boolean(id) };
  });
  const knownFirst = scored.find(s => s.known);
  if (knownFirst) return knownFirst.part;
  return parts[0];
}

/**
 * If cleaned artist is the same as title (or nearly), it's probably mis-tagged.
 */
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

function artistContainedInTags(artistClean: string, tags: string[]): boolean {
  const a = foldForCompare(artistClean);
  if (!a || a.length < 2) return false;
  return tags.some(tag => foldForCompare(tag) === a || (a.length >= 3 && foldForCompare(tag).includes(a)));
}

/** When seed/metadata artist is uncertain, prefer a known-artist match from the CIP / YouTube title. */
/**
 * Explicit singer (dict solo/group) > survival show > game/show source — uses video + seed together.
 */
function tryPrioritizedAttribution(
  videoHint: string | null | undefined,
  raw0: string,
  notes: string[],
): CanonicalArtistResolution | null {
  const combined = [videoHint, raw0].filter(Boolean).join('\n');
  const explicit = findBestExplicitArtistInHaystack(combined);
  if (explicit) {
    const merge = CANONICAL_MERGE_OVERRIDES[explicit.dictId];
    const finalId = merge || explicit.dictId;
    return {
      originalArtistRaw: raw0,
      canonicalArtistId: finalId,
      canonicalArtistDisplayName: displayNameForDictionaryId(finalId),
      artistReviewStatus: 'ok',
      notes: [...notes, 'priority_explicit_artist_in_haystack'],
    };
  }

  const normHay = buildAttributionHaystack(videoHint, raw0);
  const surv = matchSurvivalShowUnified(normHay);
  if (surv) {
    const merge = CANONICAL_MERGE_OVERRIDES[surv.canonicalId];
    const finalId = merge || surv.canonicalId;
    return {
      originalArtistRaw: raw0,
      canonicalArtistId: finalId,
      canonicalArtistDisplayName: displayNameForDictionaryId(finalId),
      artistReviewStatus: 'ok',
      notes: [...notes, surv.note],
    };
  }

  const src = matchSourceAttributionFallback(normHay);
  if (src) {
    const merge = CANONICAL_MERGE_OVERRIDES[src.canonicalId];
    const finalId = merge || src.canonicalId;
    return {
      originalArtistRaw: raw0,
      canonicalArtistId: finalId,
      canonicalArtistDisplayName: displayNameForDictionaryId(finalId),
      artistReviewStatus: 'ok',
      notes: [...notes, src.note],
    };
  }

  return null;
}

function applyVideoTitleFallback(
  res: CanonicalArtistResolution,
  videoHint: string | null | undefined,
  raw0: string,
): CanonicalArtistResolution {
  const hint = NFKC(videoHint || '').trim();
  if (!hint || res.artistReviewStatus === 'ok') return res;

  const dictId = findKnownArtistDictIdInVideoTitle(hint);
  if (!dictId) return res;
  const merge = CANONICAL_MERGE_OVERRIDES[dictId];
  const finalId = merge || dictId;
  return {
    originalArtistRaw: raw0,
    canonicalArtistId: finalId,
    canonicalArtistDisplayName: displayNameForDictionaryId(finalId),
    artistReviewStatus: 'ok',
    notes: [...res.notes, 'video_title_dictionary_match'],
  };
}

/**
 * YouTube / CIP video title first: structured extract → longest dictionary alias → safe freeform id.
 */
function tryResolveFromYoutubeTitleFirst(
  videoHint: string | null | undefined,
  displayTitle: string,
  raw0: string,
  notes: string[],
): CanonicalArtistResolution | null {
  const hint = NFKC(videoHint || '').trim();
  if (!hint) return null;

  const extracted = extractYoutubeArtistString(hint, displayTitle);
  if (extracted) {
    const variants = Array.from(
      new Set(
        [extracted, extracted.split(/[、,，]/)[0]?.trim(), extracted.split(/\s*\/\s*/)[0]?.trim()].filter(
          Boolean,
        ) as string[],
      ),
    );
    for (const seg0 of variants) {
      const seg =
        seg0.replace(/[\s–—\-.]+$/g, '').replace(/^["'「『]+|["'」』]+$/g, '').trim() || seg0;
      if (!seg) continue;
      const knownId =
        lookupKnownArtistId(seg) ||
        lookupKnownArtistId(stripDescriptors(seg)) ||
        lookupKnownArtistId(normalizeArtistKeyForLookup(seg));
      if (knownId) {
        const merge = CANONICAL_MERGE_OVERRIDES[knownId] || CANONICAL_MERGE_OVERRIDES[seg];
        const finalId = merge || knownId;
        return {
          originalArtistRaw: raw0,
          canonicalArtistId: finalId,
          canonicalArtistDisplayName: displayNameForDictionaryId(finalId),
          artistReviewStatus: 'ok',
          notes: [...notes, 'youtube_title_structured_dict'],
        };
      }
    }
    const mainSeg = extracted
      .replace(/[\s–—\-.]+$/g, '')
      .replace(/^["'「『]+|["'」』]+$/g, '')
      .trim();
    if (mainSeg && isSafeYoutubeFreeformArtist(mainSeg, displayTitle)) {
      const slug = slugifyForCanonical(mainSeg);
      return {
        originalArtistRaw: raw0,
        canonicalArtistId: `from-youtube/${slug}`,
        canonicalArtistDisplayName: mainSeg.slice(0, 52),
        artistReviewStatus: 'ok',
        notes: [...notes, 'youtube_title_freeform'],
      };
    }
  }

  const dictFromAlias = findKnownArtistDictIdInVideoTitle(hint);
  if (dictFromAlias) {
    const merge = CANONICAL_MERGE_OVERRIDES[dictFromAlias];
    const finalId = merge || dictFromAlias;
    return {
      originalArtistRaw: raw0,
      canonicalArtistId: finalId,
      canonicalArtistDisplayName: displayNameForDictionaryId(finalId),
      artistReviewStatus: 'ok',
      notes: [...notes, 'video_title_dictionary_match'],
    };
  }

  return null;
}

function resolveCanonicalArtistCore(input: {
  rawArtist: string;
  displayTitle: string;
  trackId: string;
  slug?: string;
  tags?: string[];
  /** Prefer longest known-artist alias match from CIP / YouTube title when present. */
  videoTitleHint?: string | null;
}): CanonicalArtistResolution {
  const notes: string[] = [];
  const tags = input.tags ?? [];
  const raw0 = stripArtistFieldNoise(input.rawArtist || '');
  const videoHint = input.videoTitleHint ?? null;

  const trackFix = TRACK_CANONICAL_BY_ID[input.trackId];
  if (trackFix) {
    const merge = CANONICAL_MERGE_OVERRIDES[trackFix.canonicalId];
    const finalId = merge || trackFix.canonicalId;
    const status: ArtistReviewStatus = trackFix.artistReviewStatus ?? 'ok';
    const displayName =
      trackFix.displayNameOverride ??
      (ARTIST_DICTIONARY[finalId] ? displayNameForDictionaryId(finalId) : finalId);
    const co = trackFix.coCanonicalArtistIds?.length ? [...trackFix.coCanonicalArtistIds] : undefined;
    return {
      originalArtistRaw: raw0,
      canonicalArtistId: finalId,
      canonicalArtistDisplayName: displayName,
      artistReviewStatus: status,
      notes: [trackFix.note],
      coCanonicalArtistIds: co?.length ? co : undefined,
    };
  }

  const prior = tryPrioritizedAttribution(videoHint, raw0, notes);
  if (prior) return prior;

  if (videoHint?.trim()) {
    const yt = tryResolveFromYoutubeTitleFirst(videoHint, input.displayTitle, raw0, notes);
    if (yt) return yt;
  }

  if (!raw0) {
    return applyVideoTitleFallback(
      {
        originalArtistRaw: '',
        canonicalArtistId: '__unknown__',
        canonicalArtistDisplayName: 'Unknown artist',
        artistReviewStatus: 'unknown',
        notes: ['empty_artist'],
      },
      videoHint,
      raw0,
    );
  }

  let cleaned = stripDescriptors(raw0);
  cleaned = cleaned.replace(/^《[^》]+》\s*/, '').replace(/^"[^"]+"\s*/, '').trim();
  if (!cleaned) cleaned = raw0;

  if (isGarbageString(cleaned)) {
    return applyVideoTitleFallback(
      {
        originalArtistRaw: raw0,
        canonicalArtistId: '__unknown__',
        canonicalArtistDisplayName: 'Unknown artist',
        artistReviewStatus: 'unknown',
        notes: [...notes, 'garbage_after_strip'],
      },
      videoHint,
      raw0,
    );
  }

  if (artistResemblesTitle(cleaned, input.displayTitle)) {
    return applyVideoTitleFallback(
      {
        originalArtistRaw: raw0,
        canonicalArtistId: `review/${input.trackId}`,
        canonicalArtistDisplayName: cleaned,
        artistReviewStatus: 'needsReview',
        notes: [...notes, 'artist_matches_title'],
      },
      videoHint,
      raw0,
    );
  }

  if (artistContainedInTags(cleaned, tags)) {
    return applyVideoTitleFallback(
      {
        originalArtistRaw: raw0,
        canonicalArtistId: `review/${input.trackId}`,
        canonicalArtistDisplayName: cleaned,
        artistReviewStatus: 'needsReview',
        notes: [...notes, 'artist_looks_like_tag'],
      },
      videoHint,
      raw0,
    );
  }

  if (looksLikeTruncation(cleaned)) {
    notes.push('possible_truncation');
  }

  if (looksLikeNonArtist(cleaned)) {
    return applyVideoTitleFallback(
      {
        originalArtistRaw: raw0,
        canonicalArtistId: `review/${input.trackId}`,
        canonicalArtistDisplayName: cleaned,
        artistReviewStatus: 'needsReview',
        notes: [...notes, 'non_artist_pattern'],
      },
      videoHint,
      raw0,
    );
  }

  const segment = primarySegment(cleaned);
  const segRaw = segment || cleaned;
  const seg = segRaw.replace(/[\s–—\-.]+$/g, '').replace(/^["'「『]+|["'」』]+$/g, '').trim() || segRaw;
  const knownId = lookupKnownArtistId(cleaned) || lookupKnownArtistId(seg);

  if (knownId) {
    const merge = CANONICAL_MERGE_OVERRIDES[knownId] || CANONICAL_MERGE_OVERRIDES[seg];
    const finalId = merge || knownId;
    const name = displayNameForDictionaryId(finalId);
    return {
      originalArtistRaw: raw0,
      canonicalArtistId: finalId,
      canonicalArtistDisplayName: name,
      artistReviewStatus: 'ok',
      notes,
    };
  }

  if (looksLikeNonArtist(seg)) {
    return applyVideoTitleFallback(
      {
        originalArtistRaw: raw0,
        canonicalArtistId: `review/${input.trackId}`,
        canonicalArtistDisplayName: seg,
        artistReviewStatus: 'needsReview',
        notes: [...notes, 'non_artist_pattern_seg'],
      },
      videoHint,
      raw0,
    );
  }

  if (/dyn-/.test(seg)) {
    notes.push('legacy_dyn_rejected');
  }

  const slug = slugifyForCanonical(seg);

  if (seg.length > 48) {
    return applyVideoTitleFallback(
      {
        originalArtistRaw: raw0,
        canonicalArtistId: `review/${input.trackId}`,
        canonicalArtistDisplayName: seg.slice(0, 48) + '…',
        artistReviewStatus: 'needsReview',
        notes: [...notes, 'too_long_unverified'],
      },
      videoHint,
      raw0,
    );
  }

  if (notes.includes('possible_truncation')) {
    return applyVideoTitleFallback(
      {
        originalArtistRaw: raw0,
        canonicalArtistId: `review/${input.trackId}`,
        canonicalArtistDisplayName: seg,
        artistReviewStatus: 'needsReview',
        notes,
      },
      videoHint,
      raw0,
    );
  }

  // ALL dictionary-miss → needsReview (never display as artist card)
  return applyVideoTitleFallback(
    {
      originalArtistRaw: raw0,
      canonicalArtistId: `review/${input.trackId}`,
      canonicalArtistDisplayName: seg,
      artistReviewStatus: 'needsReview',
      notes: [...notes, 'dictionary_miss'],
    },
    videoHint,
    raw0,
  );
}

/** 导出供 manifest 在应用 catalog canonical 覆盖后再次套用 */
export function ensureBlackpinkCoBucket(res: CanonicalArtistResolution): CanonicalArtistResolution {
  const id = dictionaryCanonicalId(res.canonicalArtistId);
  if (id !== 'jennie' && id !== 'rose' && id !== 'lisa') return res;
  const co = res.coCanonicalArtistIds ?? [];
  if (co.includes('blackpink')) return res;
  return { ...res, coCanonicalArtistIds: [...co, 'blackpink'] };
}

export function resolveCanonicalArtist(input: {
  rawArtist: string;
  displayTitle: string;
  trackId: string;
  slug?: string;
  tags?: string[];
  videoTitleHint?: string | null;
}): CanonicalArtistResolution {
  return ensureBlackpinkCoBucket(applyCanonicalIdRedirects(resolveCanonicalArtistCore(input)));
}
