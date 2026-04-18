/**
 * 本地导入用 metadata 补丁（历史批量录入）。
 * **已确认的锁定元数据** 以 `src/data/catalog-overrides-locked.ts` 为准（由 `catalog-overrides.ts` 应用）；本文件不再驱动 catalog。
 * 仅作 legacy 补充，优先级低于 catalog；新纠错请只改 locked 文件。
 */
export type LocalizedDisplayTitles = {
  zhHans?: string;
  zhHant?: string;
  en?: string;
};

export type LocalizedDisplayArtists = {
  zhHans?: string;
  zhHant?: string;
  en?: string;
};

export type LocalImportMetadataOverride = {
  title?: string;
  displayTitle?: string;
  titles?: LocalizedDisplayTitles;
  artist?: string;
  artists?: LocalizedDisplayArtists;
  category?: string;
  categoryTags?: string[];
  /** 作品级来源 slug，写入 manifest / Track（与 artist、category 独立） */
  workProjectKey?: string;
  cover?: string;
  /**
   * When true, skip Apple/Spotify official cover from auto-enrichment so we do not bind
   * wrong artwork for ambiguous short titles (e.g. "Hello") when CIP video is authoritative.
   */
  suppressOfficialCover?: boolean;
  officialLinks?: {
    appleMusic?: string;
    spotify?: string;
    youtube?: string;
  };
  links?: {
    youtube?: string;
    video?: string;
    sheet?: string;
    /** Bilibili watch page when there is no YouTube upload */
    bilibili?: string;
    /**
     * When true: no playable external video for this track; do not use CIP YouTube or channel search fallback.
     */
    noExternalVideo?: boolean;
    /**
     * When true: do not attach any sheet URL (wrong catalog match or no published sheet).
     */
    noSheet?: boolean;
  };
  /** Overrides CIP matched video title shown on manifest / player context */
  matchedVideoTitle?: string;
};

export const LOCAL_IMPORT_METADATA_OVERRIDES: Record<string, LocalImportMetadataOverride> = {
  幻化成花: {
    artist: '指田郁也',
    artists: {
      zhHans: '指田郁也',
      zhHant: '指田郁也',
      en: 'Fumiya Sashida',
    },
  },
  /** 巫哲小说改编曲；原唱凯瑟喵。 */
  撒野: {
    artist: '凯瑟喵',
    artists: { zhHans: '凯瑟喵', en: 'Kaiser' },
  },
  /**
   * 刘耀文《Blue》— 界面只显示「Blue」（仅 B 大写），与曲库内 ZEROBASEONE《BLUE》全大写区分；
   * slug 仍用 `blue（刘耀文）` 作唯一键与文件夹名。
   */
  'blue（刘耀文）': {
    displayTitle: 'Blue',
    title: 'Blue',
    titles: { zhHans: 'Blue', zhHant: 'Blue', en: 'Blue' },
    artist: '刘耀文',
    artists: { zhHans: '刘耀文', zhHant: '劉耀文', en: 'Liu Yaowen' },
    categoryTags: ['华语流行'],
  },
  'Blue(zerobaseone)': {
    displayTitle: 'Blue',
    title: 'Blue',
    titles: { zhHans: 'Blue', zhHant: 'Blue', en: 'Blue' },
    artist: 'ZEROBASEONE',
    artists: { zhHans: 'ZEROBASEONE', zhHant: 'ZEROBASEONE', en: 'ZEROBASEONE' },
    links: {
      sheet: 'https://www.mymusic5.com/cipmusic/257776',
    },
    categoryTags: ['韩流流行'],
  },
  /** 双人曲 — 同时归入张靓颖、薛之谦。 */
  可: {
    artist: '张靓颖、薛之谦',
    artists: { zhHans: '张靓颖、薛之谦', en: 'Jane Zhang, Joker Xue' },
    categoryTags: ['华语流行'],
  },
  /** 家族曲；归档 TF 家族三代，曲下标注成员。 */
  旅行: {
    artist: 'TF家族三代（苏新皓、左航）',
    artists: { zhHans: 'TF家族三代（苏新皓、左航）', zhHant: 'TF家族三代（蘇新皓、左航）', en: 'TF Family 3rd (Su Xinhao, Zuohang)' },
    categoryTags: ['华语流行'],
  },
  /** 网络梗曲 / 游戏配乐感 — 无固定「原唱」歌手。 */
  斗地主: {
    artist: '（无原唱）',
    artists: { zhHans: '（无原唱）' },
    categoryTags: ['游戏'],
  },
  /** 梗曲翻奏 — 勿将视频标题误作歌手。 */
  哈基米: {
    artist: '（无原唱）',
    artists: { zhHans: '（无原唱）' },
    categoryTags: ['日系流行', '动漫'],
  },
  /** KiiiKiii《DANCING ALONE》— 与「Dancing Along」为同一英文检索常用名。 */
  'dancing-alone': {
    title: 'Dancing Alone',
    displayTitle: 'Dancing Alone',
    titles: { zhHans: 'Dancing Alone', en: 'DANCING ALONE' },
    artist: 'KiiiKiii',
    artists: { zhHans: 'KiiiKiii', zhHant: 'KiiiKiii', en: 'KiiiKiii' },
    categoryTags: ['韩流流行'],
  },
  /** CHUANG2021 曲目。 */
  冒险计划: {
    artist: 'INTO1',
    artists: { zhHans: 'INTO1', en: 'INTO1' },
    categoryTags: ['华语流行'],
  },
  /** 刘宇《白话文》— 展示「INTO1刘宇」；封面与用户指定 Spotify 单曲一致（非旧 gala / 团版缩略图）。 */
  白话文: {
    artist: 'INTO1刘宇',
    artists: { zhHans: 'INTO1刘宇', zhHant: 'INTO1劉宇', en: 'INTO1 Liu Yu' },
    suppressOfficialCover: true,
    cover: 'https://i.scdn.co/image/ab67616d0000b273663d33e72b48d7d0a615a617',
    officialLinks: {
      spotify: 'https://open.spotify.com/track/6tsQTWl3WdinO4RSvhNEkJ',
    },
    categoryTags: ['华语流行'],
  },
  没出息: {
    artist: '\u201C本来应该从从容容游刃有余\u201D',
    artists: {
      zhHans: '\u201C本来应该从从容容游刃有余\u201D',
      zhHant: '\u201C本來應該從從容容遊刃有餘\u201D',
    },
    categoryTags: ['华语流行'],
  },
  /** 原曲「ヤキモチ」高桥优。 */
  起风了: {
    artist: '高桥优',
    artists: { zhHans: '高桥优', zhHant: '高橋優', en: 'Yu Takahashi (Takahiro)' },
    categoryTags: ['华语流行'],
  },
  /** 春晚三人舞台 — 不拆个人艺人页。 */
  上春山: {
    artist: '魏晨、魏大勋、白敬亭',
    artists: { zhHans: '魏晨、魏大勋、白敬亭', en: 'Wei Chen, Wei Daxun, Bai Jingting' },
    categoryTags: ['华语流行'],
  },
  溯: {
    artist: '胡梦周',
    artists: { zhHans: '胡梦周', en: 'CORSAK' },
    categoryTags: ['华语流行'],
  },
  调查中: {
    artist: '周深、胡梦周',
    artists: { zhHans: '周深、胡梦周', en: 'Zhou Shen, CORSAK' },
    categoryTags: ['华语流行'],
  },
  天地龙鳞: {
    artist: '王力宏',
    artists: { zhHans: '王力宏', en: 'Leehom Wang' },
    categoryTags: ['华语流行'],
    links: { noSheet: true },
  },
  小小: {
    artist: '容祖儿',
    artists: { zhHans: '容祖儿', zhHant: '容祖兒', en: 'Joey Yung' },
    categoryTags: ['华语流行'],
  },
  新宝岛: {
    artist: '（无原唱）',
    artists: { zhHans: '（无原唱）' },
    categoryTags: ['日系流行'],
  },
  /** 奥特曼中文主题曲 — 展示为特摄 IP，不挂「毛华锋」独立艺人词条。 */
  信念之光: {
    artist: '《特利迦奥特曼》',
    artists: { zhHans: '《特利迦奥特曼》', en: 'Ultraman Trigger' },
    categoryTags: ['动漫'],
  },
  夜蝶: {
    artist: 'SNH48',
    artists: { zhHans: 'SNH48', en: 'SNH48' },
    categoryTags: ['华语流行'],
  },
  姻缘: {
    artist: "Kep1er（Girls' Planet 999）",
    artists: { zhHans: "Kep1er（Girls' Planet 999）", en: 'Kep1er (GP999)' },
    categoryTags: ['韩流流行'],
    links: { noSheet: true },
  },
  有你: {
    artist: '时代少年团',
    artists: { zhHans: '时代少年团', zhHant: '時代少年團', en: 'Teens In Times' },
    categoryTags: ['华语流行'],
  },
  朱雀: {
    artist: '时代少年团',
    artists: { zhHans: '时代少年团', zhHant: '時代少年團', en: 'Teens In Times' },
    categoryTags: ['华语流行'],
  },
  渐暖: {
    artist: '时代少年团',
    artists: { zhHans: '时代少年团', zhHant: '時代少年團', en: 'Teens In Times' },
    categoryTags: ['华语流行'],
  },
  珠玉: {
    artist: '单依纯',
    artists: { zhHans: '单依纯', zhHant: '單依純', en: 'Shan Yichun' },
    categoryTags: ['华语流行'],
  },
  /** 节目启航曲 — 展示「乘风破浪的姐姐」，不建独立艺人词条（canonical 仍为 review 桶）。 */
  乘风: {
    artist: '乘风破浪的姐姐',
    artists: { zhHans: '乘风破浪的姐姐', zhHant: '乘风破浪的姐姐' },
    categoryTags: ['华语流行'],
  },
  /** 周深 + 制作人钟天利 — 钟天利不建艺人条目。 */
  春雪: {
    artist: '周深、钟天利',
    artists: { zhHans: '周深、钟天利', en: 'Zhou Shen, Terry Zhong' },
    categoryTags: ['华语流行'],
  },
  飞天: {
    artist: '张艺兴',
    artists: { zhHans: '张艺兴', zhHant: '張藝興', en: 'Lay Zhang' },
    categoryTags: ['华语流行'],
  },
  孤勇者: {
    artist: '陈奕迅',
    artists: { zhHans: '陈奕迅', zhHant: '陳奕迅', en: 'Eason Chan' },
    categoryTags: ['华语流行'],
  },
  /** 徐良 feat. 小凌 — 小凌不建条目。 */
  坏女孩: {
    artist: '徐良',
    artists: { zhHans: '徐良（feat. 小凌）', en: 'Xu Liang feat. Xiao Ling' },
    categoryTags: ['华语流行'],
  },
  /** 网络热曲《一笑江湖》语境。 */
  科目三: {
    artist: '一笑江湖',
    artists: { zhHans: '一笑江湖（《一笑江湖》）', en: 'Yi Xiao Jiang Hu' },
    categoryTags: ['华语流行'],
  },
  铃芽之旅: {
    artist: '周深',
    artists: { zhHans: '周深', en: 'Zhou Shen' },
    categoryTags: ['华语流行', '动漫'],
  },
  一路生花: {
    artist: '周深、张韶涵',
    artists: { zhHans: '周深、张韶涵', en: 'Zhou Shen, Angela Chang' },
    categoryTags: ['华语流行'],
  },
  /** 米津玄师 · 新·奥特曼主题曲 M87。 */
  M八七: {
    artist: '米津玄师',
    artists: { zhHans: '米津玄师', zhHant: '米津玄師', en: 'Kenshi Yonezu' },
    categoryTags: ['日系流行', '动漫'],
  },
  'you-are-the-sun-in-my-life': {
    artist: '卢宛仪',
    artists: {
      zhHans: '卢宛仪',
      zhHant: '盧苑儀',
      en: 'Lu Yuanyi',
    },
  },
  /** Kep1er《Shine》（Girls Planet 999）；曾误绑骄阳似我 OST，已按曲库/B站片源纠正。 */
  shine: {
    artist: 'Kep1er',
    artists: {
      zhHans: 'Kep1er',
      zhHant: 'Kep1er',
      en: 'Kep1er',
    },
    category: '韩流流行',
    categoryTags: ['韩流流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=krvKaVcFBEE',
      video: 'https://www.youtube.com/watch?v=krvKaVcFBEE',
      bilibili: 'https://www.bilibili.com/video/BV1yQ4y1i7U5/',
      sheet: 'https://mymusic5.com/cipmusic/348048',
    },
    matchedVideoTitle: 'Kep1er《Shine》钢琴完整版（附谱）| Piano by CIP Music',
  },
  /** BIGBANG《Still Life》；简繁界面标题用「春夏秋冬」，英文仍可用 Still Life。 */
  'still life': {
    displayTitle: '春夏秋冬',
    title: 'Still Life',
    titles: {
      zhHans: '春夏秋冬',
      zhHant: '春夏秋冬',
      en: 'Still Life',
    },
  },
  '5点23': {
    title: '5点23',
    displayTitle: '5点23',
    artist: '宋亚轩',
    artists: {
      zhHans: '宋亚轩',
      zhHant: '宋亞軒',
      en: 'Song Yaxuan',
    },
    category: '华语流行',
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=ELYeig0W59g',
      video: 'https://www.youtube.com/watch?v=ELYeig0W59g',
    },
  },
  '世界赠与我的': {
    title: '世界赠予我的',
    displayTitle: '世界赠予我的',
    titles: {
      zhHans: '世界赠予我的',
      zhHant: '世界贈予我的',
      en: 'The World Gave Me',
    },
    artist: '王菲',
    artists: {
      zhHans: '王菲',
      zhHant: '王菲',
      en: 'Faye Wong',
    },
    category: '华语流行',
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=1Jh0N1vPrpA',
      video: 'https://www.youtube.com/watch?v=1Jh0N1vPrpA',
    },
  },
  '爱如火': {
    title: '爱如火',
    displayTitle: '爱如火',
    artist: '那艺娜',
    artists: { zhHans: '那艺娜', en: 'Nayi Na' },
    links: {
      bilibili: 'https://www.bilibili.com/video/BV14A41117BD/',
    },
  },
  'heya': {
    title: 'HEYA',
    displayTitle: 'HEYA',
    artist: 'IVE',
    artists: {
      zhHans: 'IVE',
      zhHant: 'IVE',
      en: 'IVE',
    },
    category: '韩流流行',
    officialLinks: {
      appleMusic: 'https://music.apple.com/us/album/heya/1741070979?i=1741071167&uo=4',
    },
    /** Catalog only: no CIP YouTube to bind; do not chase channel search. */
    links: { noExternalVideo: true },
  },
  'birds-of-a-feather': {
    officialLinks: {
      appleMusic: 'https://music.apple.com/us/song/birds-of-a-feather/1739659142',
    },
    links: {
      youtube: 'https://www.youtube.com/watch?v=fD6_gbvI1lg',
      video: 'https://www.youtube.com/watch?v=fD6_gbvI1lg',
      sheet: 'https://mymusic.st/cipmusic/278554',
    },
  },
  'swim': {
    links: {
      youtube: 'https://www.youtube.com/watch?v=asWBvqMfeY0',
      video: 'https://www.youtube.com/watch?v=asWBvqMfeY0',
      sheet: 'https://mymusic5.com/cipmusic/369512',
    },
  },
  'Go': {
    links: {
      youtube: 'https://www.youtube.com/watch?v=ozl5kzVTYvM',
      video: 'https://www.youtube.com/watch?v=ozl5kzVTYvM',
    },
  },
  'zoo': {
    links: {
      youtube: 'https://www.youtube.com/watch?v=qmv7jLQmKcw',
      video: 'https://www.youtube.com/watch?v=qmv7jLQmKcw',
      sheet: 'https://mymusic5.com/cipmusic/341127',
    },
  },
  'soda-pop': {
    workProjectKey: 'kpop-demon-hunters',
    links: {
      youtube: 'https://www.youtube.com/watch?v=bkgFKxWLrS0',
      video: 'https://www.youtube.com/watch?v=bkgFKxWLrS0',
      sheet: 'https://www.mymusicfive.com/cipmusic/310661',
    },
  },
  '太阳之子': {
    title: '太阳之子',
    displayTitle: '太阳之子',
    titles: {
      zhHans: '太阳之子',
      zhHant: '太陽之子',
      en: 'Children of the Sun',
    },
    links: {
      youtube: 'https://www.youtube.com/watch?v=K64y751to_s',
      video: 'https://www.youtube.com/watch?v=K64y751to_s',
      sheet: 'https://mymusic5.com/cipmusic/370339',
    },
  },
  '人之爱': {
    title: '人之爱',
    displayTitle: '人之爱',
    titles: {
      zhHans: '人之爱',
      zhHant: '人之愛',
    },
    links: {
      youtube: 'https://www.youtube.com/watch?v=oNiNfJOFKwY',
      video: 'https://www.youtube.com/watch?v=oNiNfJOFKwY',
      sheet: 'https://mymusic5.com/cipmusic/346654',
    },
  },
  'mitsuha-theme': {
    title: '三叶的主题',
    displayTitle: '三叶的主题',
    titles: {
      zhHans: '《你的名字》三叶的主题',
      zhHant: '《你的名字》三葉的主題',
      en: 'Mitsuha Theme',
    },
    artist: 'RADWIMPS',
    artists: {
      zhHans: 'RADWIMPS',
      zhHant: 'RADWIMPS',
      en: 'RADWIMPS',
    },
    links: {
      youtube: 'https://www.youtube.com/watch?v=qEcFX7JOHBQ',
      video: 'https://www.youtube.com/watch?v=qEcFX7JOHBQ',
      sheet: 'https://mymusic.st/cipmusic/187940',
    },
  },
  '像晴天像雨天任性': {
    title: '像晴天像雨天任性',
    displayTitle: '像晴天像雨天任性',
    officialLinks: {
      youtube: 'https://www.youtube.com/watch?v=g8upcg_IP3M',
    },
  },
  '借过一下': {
    artist: '周深',
    artists: { zhHans: '周深', en: 'Charlie Zhou Shen' },
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E5%80%9F%E9%81%8E%E4%B8%80%E4%B8%8B-%E9%9B%BB%E8%A6%96%E5%8A%87-%E6%85%B6%E9%A4%98%E5%B9%B4%E7%AC%AC%E4%BA%8C%E5%AD%A3-%E7%89%87%E5%B0%BE%E6%9B%B2/1746687445?i=1746687455',
    },
    links: {
      video: 'https://www.youtube.com/watch?v=D-Z5fX0fL8k',
    },
  },
  '若仙': {
    artist: '周深',
    artists: { zhHans: '周深', zhHant: '周深', en: 'Charlie Zhou Shen' },
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E8%8B%A5%E4%BB%99-%E5%BD%B1%E8%A6%96%E5%8A%87-%E4%BB%99%E5%8F%B0%E6%9C%89%E6%A8%B9-%E7%89%87%E5%B0%BE%E4%B8%BB%E9%A1%8C%E6%9B%B2/1779927652?i=1779927653',
    },
    links: {
      video: 'https://www.youtube.com/watch?v=0hK9R3HkFNc',
    },
  },
  '蜉蝣': {
    artist: '马嘉祺',
    artists: { zhHans: '马嘉祺', en: 'Ma Jiaqi' },
    cover:
      'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/e6/22/8d/e6228d40-e622-a4ce-928d-008b0691e530/6923356187284.jpg/600x600bb.jpg',
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E8%9C%89%E8%9C%A3/1752495006?i=1752495111',
    },
  },
  '经过': {
    artist: '张杰',
    artists: { zhHans: '张杰', zhHant: '張杰', en: 'Jason Zhang' },
    categoryTags: ['游戏', '华语流行'],
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E7%B6%93%E9%81%8E-%E5%8E%9F%E7%A5%9E-%E5%9B%9B%E9%80%B1%E5%B9%B4%E4%B8%BB%E9%A1%8C%E6%9B%B2/1772655078?i=1772655088',
    },
  },
  '爱错': {
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E6%84%9B%E9%8C%AF/155700755?i=155700877',
    },
  },
  '温暖的房子': {
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E6%BA%AB%E6%9A%96%E7%9A%84%E6%88%BF%E5%AD%90-live/1759620703?i=1759620716',
    },
  },
  /** CIP/视频标题含「钢琴版」等前缀；Apple 条目误标为「钢琴版」。歌手仅为胡彦斌。 */
  '有梦好甜蜜': {
    artist: '胡彦斌',
    artists: {
      zhHans: '胡彦斌',
      zhHant: '胡彥斌',
      en: 'Tiger Hu',
    },
    category: '华语流行',
    categoryTags: ['华语流行', '影视'],
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E6%9C%89%E6%A2%A6%E5%A5%BD%E7%94%9C%E8%9C%9C/934020999?i=934021134&uo=4',
    },
  },
  '相思莫负': {
    artist: '纸嫁衣',
    artists: { zhHans: '纸嫁衣', en: 'Paper Bride' },
    categoryTags: ['游戏'],
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E7%9B%B8%E6%80%9D%E8%8E%AB%E8%B2%A0-%E9%81%8A%E6%88%B2-%E7%B4%99%E5%AB%81%E8%A1%A3-%E7%B3%BB%E5%88%97%E6%8E%A8%E5%BB%A3%E6%9B%B2/1699757656?i=1699757657',
    },
  },
  'Mantra': {
    officialLinks: {
      appleMusic: 'https://music.apple.com/us/album/mantra/1771146307?i=1771146310',
    },
  },
  '青春赞歌': {
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E9%9D%92%E6%98%A5%E8%AE%9A%E6%AD%8C/1752358826?i=1752358842',
    },
  },
  '才二十三': {
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E6%89%8D%E4%BA%8C%E5%8D%81%E4%B8%89/1715456286?i=1715456299',
    },
  },
  '等你的回答': {
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E7%AD%89%E4%BD%A0%E7%9A%84%E5%9B%9E%E7%AD%94/1754406213?i=1754406214',
    },
  },
  '觅境': {
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E8%B0%A7%E5%A2%83/1754294025?i=1754294038',
    },
  },
  '镜花水月': {
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E9%95%9C%E8%8A%B1%E6%B0%B4%E6%9C%88/1715454652?i=1715454664',
    },
  },
  '登顶': {
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E7%99%BB%E9%A1%B6/1715455919?i=1715455931',
    },
  },
  '敢问路在何方': {
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E6%95%A2%E5%95%8F%E8%B7%AF%E5%9C%A8%E4%BD%95%E6%96%B9/1763785125?i=1763785265',
    },
  },
  'candy(svt)': {
    displayTitle: 'Candy',
    artist: 'SEVENTEEN',
    artists: { zhHans: 'SEVENTEEN', en: 'SEVENTEEN' },
  },
  'candy(twice)': {
    displayTitle: 'Candy',
    artist: 'TWICE',
    artists: { zhHans: 'TWICE', en: 'TWICE' },
  },
  'candy': {
    "cover": "https://i.scdn.co/image/ab67616d0000b273bbcf5847ef8d115aa0f6f212",
  },
  'chains': {
    "cover": "https://i.scdn.co/image/ab67616d0000b273703358054c2cdd845922372d",
  },
  'Girlfriend': {
    artist: 'I-DLE',
    artists: { zhHans: 'I-DLE', zhHant: 'I-DLE', en: 'I-DLE' },
    cover: 'https://i.scdn.co/image/ab67616d0000b273933c0bd9c8d2348c4ee2920e',
  },
  her: {
    artist: 'I-DLE',
    artists: { zhHans: 'I-DLE', zhHant: 'I-DLE', en: 'I-DLE' },
    cover: 'https://i.scdn.co/image/ab67616d0000b2731804e13d115367b1efcad348',
  },
  'Hola solar': {
    cover: 'https://img.youtube.com/vi/IxCDazUjslI/hqdefault.jpg',
  },
  'HOME': {
    displayTitle: 'HOME',
    artist: '王源',
    artists: { zhHans: '王源', en: 'Roy Wang' },
  },
  'eyes on me': {
    displayTitle: 'Easy On Me',
    title: 'Easy On Me',
    artist: 'Adele',
    artists: { zhHans: 'Adele', en: 'Adele' },
  },
  'home sweet home': {
    displayTitle: 'Home Sweet Home',
    artist: 'G-DRAGON',
    artists: { zhHans: '权志龙', en: 'G-DRAGON' },
    cover: 'https://i.scdn.co/image/ab67616d0000b273a21648a0459a96e6a17b8f9e',
  },
  'ei ei': {
    artist: '蔡徐坤',
    artists: { zhHans: '蔡徐坤', en: 'KUN' },
    categoryTags: ['华语流行'],
  },
  'jump to the breeze': {
    categoryTags: ['日系流行', '游戏'],
  },
  'HOT': {
    cover: 'https://img.youtube.com/vi/jp9BfPexADw/hqdefault.jpg',
  },
  '洄': {
    artist: '王源',
    artists: { zhHans: '王源', en: 'Roy Wang' },
  },
  '明天见': {
    title: '明天见',
    displayTitle: '明天见',
    artist: 'TFBOYS',
    artists: { zhHans: 'TFBOYS', zhHant: 'TFBOYS', en: 'TFBOYS' },
    links: {
      youtube: 'https://www.youtube.com/watch?v=rMViS3qU7JI',
      video: 'https://www.youtube.com/watch?v=rMViS3qU7JI',
      sheet: 'https://www.mymusic5.com/cipmusic/120423',
    },
    matchedVideoTitle: 'TFBOYS十周年新歌《明天见》 Piano Cover | Piano by CIP Music',
  },
  '输入法打可爱按第五': {
    artist: '创造营2021',
    artists: { zhHans: '创造营2021', en: 'CHUANG 2021' },
  },
  '除夕': {
    artist: 'A-SOUL',
    artists: { zhHans: 'A-SOUL', en: 'A-SOUL' },
  },
  '音你心动': {
    artist: '王者荣耀',
    artists: { zhHans: '王者荣耀', en: 'Honor of Kings' },
    categoryTags: ['游戏'],
  },
  /** 《F4 Thailand》OST — 原唱与封面同用户指定 Spotify 单曲（BRIGHT / WIN / Dew / Nani）。 */
  'who am i': {
    artist: 'BRIGHT、WIN METAWIN、Dew Jirawat、Nani Hirunkit',
    artists: {
      zhHans: 'BRIGHT、WIN METAWIN、Dew Jirawat、Nani Hirunkit',
      zhHant: 'BRIGHT、WIN METAWIN、Dew Jirawat、Nani Hirunkit',
      en: 'BRIGHT, WIN METAWIN, Dew Jirawat, Nani Hirunkit',
    },
    suppressOfficialCover: true,
    cover: 'https://i.scdn.co/image/ab67616d0000b27300c593f93b5a263acaaec654',
    officialLinks: {
      spotify: 'https://open.spotify.com/track/4m4aE47bzubKFFuYphjOiM',
    },
    categoryTags: ['影视'],
  },
  /** 《崩坏：星穹铁道》— 封面与用户指定 Spotify 单曲一致（Robin / HOYO-MiX / Chevy）。 */
  希望有羽毛和翅膀: {
    suppressOfficialCover: true,
    cover: 'https://i.scdn.co/image/ab67616d0000b273cc68eea0db7110e3b8cca14e',
    officialLinks: {
      spotify: 'https://open.spotify.com/track/3FUaNR2HD1XaeOmw4puhkz',
    },
  },
  /** aespa《Dreams Come True》SM STATION — 封面与用户指定 Spotify 单曲一致（避免错误商店图）。 */
  'dreams come true': {
    artist: 'aespa',
    artists: { zhHans: 'aespa', zhHant: 'aespa', en: 'aespa' },
    categoryTags: ['韩流流行'],
    suppressOfficialCover: true,
    cover: 'https://i.scdn.co/image/ab67616d0000b2735b1ee39743c40b88a80b4ccf',
    officialLinks: {
      spotify: 'https://open.spotify.com/track/6rVCUwfnuYTAsX4P9fIdIu',
    },
  },
  /** 少女时代《Forever 1》— 简繁「少女时代」，英文「Girls' Generation」。 */
  'Forever 1': {
    titles: {
      zhHans: 'Forever 1',
      zhHant: 'Forever 1',
      en: "Girls' Generation — Forever 1",
    },
    artist: "Girls' Generation",
    artists: {
      zhHans: '少女时代',
      zhHant: '少女時代',
      en: "Girls' Generation",
    },
    categoryTags: ['韩流流行'],
  },
  /** Girls Planet 999 任务曲；界面显示完整符号。 */
  'u+me=love': {
    title: 'You+Me=Love',
    displayTitle: 'You+Me=Love',
    titles: {
      zhHans: 'You+Me=Love',
      zhHant: 'You+Me=Love',
      en: 'You+Me=Love',
    },
  },
  /** 英雄联盟 Worlds 2022；简中「逐星」。 */
  "STAR WALKIN'": {
    artist: 'Lil Nas X',
    artists: { zhHans: 'Lil Nas X', zhHant: 'Lil Nas X', en: 'Lil Nas X' },
    categoryTags: ['欧美流行', '游戏'],
    titles: {
      zhHans: '逐星',
      zhHant: '逐星',
      en: "Star Walkin'",
    },
    workProjectKey: 'league-of-legends',
  },
  漠河舞厅: {
    links: { noSheet: true },
  },
  /** aespa《Life's Too Short (English Version)》— 与 Spotify 单曲一致；曾误显为「Life」。 */
  "life's too short": {
    title: "Life's Too Short (English Version)",
    displayTitle: "Life's Too Short (English Version)",
    titles: {
      en: "Life's Too Short (English Version)",
      zhHans: "Life's Too Short (English Version)",
      zhHant: "Life's Too Short (English Version)",
    },
    artist: 'aespa',
    artists: { zhHans: 'aespa', zhHant: 'aespa', en: 'aespa' },
    suppressOfficialCover: true,
    cover: 'https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e02545fe4de74c3238f9cffc720',
    officialLinks: {
      spotify: 'https://open.spotify.com/track/2mgzUVvDpb1zMSB4glLQ6T',
    },
    categoryTags: ['韩流流行'],
  },
  '荣耀同行': {
    artist: '王者荣耀',
    artists: { zhHans: '王者荣耀', en: 'Honor of Kings' },
    categoryTags: ['游戏'],
  },
  '约定之初': {
    artist: '光与夜之恋',
    artists: { zhHans: '光与夜之恋', en: 'Light and Night' },
    categoryTags: ['游戏'],
  },
  '鸳鸯债': {
    artist: '纸嫁衣',
    artists: { zhHans: '纸嫁衣', en: 'Paper Bride' },
    categoryTags: ['游戏'],
  },
  /** B 站完整版；谱面用 mymusic 正式页。 */
  不冬眠: {
    artist: '刘耀文',
    artists: { zhHans: '刘耀文', zhHant: '劉耀文', en: 'Liu Yaowen' },
    links: {
      youtube: 'https://www.youtube.com/watch?v=7ZG9ddgw68s',
      video: 'https://www.youtube.com/watch?v=7ZG9ddgw68s',
      bilibili: 'https://www.bilibili.com/video/BV1a14y1A721/',
      sheet: 'https://mymusic5.com/cipmusic/375227',
    },
    matchedVideoTitle: '【钢琴】时代少年团刘耀文《不冬眠》钢琴完整版（附谱）',
  },
  勾指起誓: {
    artist: '洛天依',
    artists: { zhHans: '洛天依', en: 'Luo Tianyi' },
    categoryTags: ['华语流行'],
  },
  你眼里的光: {
    artist: '老番茄',
    artists: { zhHans: '老番茄', en: 'Lao Fanqie' },
    categoryTags: ['华语流行'],
  },
  /** CIP catalog matched a wrong sheet; this upload has no published score. */
  想你的365天: {
    links: { noSheet: true },
  },
  /** Video title prefixed English song name — performer is 小野来了 only. */
  童话镇: {
    artist: '小野来了',
    artists: { zhHans: '小野来了', zhHant: '小野来了', en: 'Xiao Ye Lai Le' },
  },
  /**
   * CIP 曾将「Shoot」误绑为《Shooting Star》同一支视频；正确为 qQ4BygxXbTE，且无公开乐谱。
   */
  shoot: {
    links: {
      youtube: 'https://www.youtube.com/watch?v=qQ4BygxXbTE',
      video: 'https://www.youtube.com/watch?v=qQ4BygxXbTE',
      noSheet: true,
    },
    matchedVideoTitle: 'Kep1er 케플러 《Shoot》 Piano Cover | Piano by CIP Music',
  },
  /** CHUANG2021 舞台 — 统一归 INTO1，勿将「歌名 + CHUANG2021」当作艺人名。 */
  'be mine': {
    artist: 'INTO1',
    artists: { zhHans: 'INTO1', zhHant: 'INTO1', en: 'INTO1' },
  },
  'yes ok': {
    artist: 'THE9',
    artists: { zhHans: 'THE9', zhHant: 'THE9', en: 'THE9' },
    categoryTags: ['华语流行'],
  },
  你就不要想起我: {
    artist: 'INTO1',
    artists: { zhHans: 'INTO1', zhHant: 'INTO1', en: 'INTO1' },
    categoryTags: ['华语流行'],
  },
  /** 与派偉俊合作 — 列表/艺人桶只展示周杰伦，勿带「派偉俊 钢琴版」尾缀。 */
  'Six Degrees': {
    artist: '周杰伦',
    artists: { zhHans: '周杰伦', zhHant: '周杰倫', en: 'Jay Chou' },
  },
  余生请多指教: {
    title: '余生，请多指教',
    displayTitle: '余生，请多指教',
    titles: {
      zhHans: '余生，请多指教',
      zhHant: '餘生，請多指教',
      en: 'The Oath of Love',
    },
    /** 列表主展示杨紫；肖战通过 canonical co-bucket 关联同一首歌（非组合艺人词条）。 */
    artist: '杨紫',
    artists: { zhHans: '杨紫', zhHant: '杨紫', en: 'Yang Zi' },
    category: '华语流行',
    categoryTags: ['影视', '华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=WG-VJHtcxeo',
      video: 'https://www.youtube.com/watch?v=WG-VJHtcxeo',
      sheet: 'https://www.mymusicsheet.com/cipmusic/43719',
    },
    matchedVideoTitle:
      '《余生，请多指教》钢琴版 杨紫&肖战 - The Oath Of Love OST Piano Cover Yang Zi & Xiao Zhan',
  },
  你不属于我: {
    artist: '周兴哲',
    artists: { zhHans: '周兴哲', zhHant: '周興哲', en: 'Eric Chou' },
    links: {
      youtube: 'https://www.youtube.com/watch?v=pW2lrJceTzk',
      video: 'https://www.youtube.com/watch?v=pW2lrJceTzk',
      noSheet: true,
    },
    matchedVideoTitle: '你不属于我 (钢琴版)',
  },
  决爱: {
    title: '诀爱',
    displayTitle: '诀爱',
    titles: { zhHans: '诀爱', zhHant: '訣愛' },
    links: {
      youtube: 'https://www.youtube.com/watch?v=85rR7AxxMgs',
      video: 'https://www.youtube.com/watch?v=85rR7AxxMgs',
      sheet: 'https://mymusic.st/cipmusic/72615',
    },
    matchedVideoTitle:
      '诀爱 Burning Love - Faye 詹雯婷（苍兰诀OST）Drama Love Between Fairy And Devil OST Piano Cover  | CIP Music',
  },
  你的名字是: {
    title: '你的名字是世界瞒着我最大的事情',
    displayTitle: '你的名字是世界瞒着我最大的事情',
    titles: {
      zhHans: '你的名字是世界瞒着我最大的事情',
      zhHant: '你的名字是世界瞞著我最大的事情',
      en: 'My Miss Stranger',
    },
    matchedVideoTitle:
      '王源（TFBOYS）《你的名字是世界瞒着我最大的事情》钢琴版 TFBOYS Roy Wang My Miss Stranger Piano Cover',
  },
  只因你太美: {
    artist: '蔡徐坤',
    artists: { zhHans: '蔡徐坤', en: 'KUN' },
    links: {
      bilibili: 'https://www.bilibili.com/video/BV1Ax4y1M7fM/',
      noSheet: true,
    },
    matchedVideoTitle: '【致郁系】《只因你太美》唯美忧伤韩剧风钢琴版',
  },
  /** 71789 实为《哭泣的游戏》谱；公开《在意》演奏与谱未在频道检索到，暂不绑外链与谱。 */
  在意: {
    artist: '周深',
    artists: { zhHans: '周深', en: 'Charlie Zhou Shen' },
    links: { noExternalVideo: true, noSheet: true },
  },
  'fix me': {
    title: 'Fix me',
    displayTitle: 'Fix me',
    artist: 'INTO1',
    artists: { zhHans: 'INTO1', zhHant: 'INTO1', en: 'INTO1' },
  },
  我们一起闯: {
    links: {
      youtube: 'https://www.youtube.com/watch?v=vhJVbfek83k',
      video: 'https://www.youtube.com/watch?v=vhJVbfek83k',
      sheet: 'https://www.mymusicsheet.com/cipmusic/33758',
    },
    matchedVideoTitle:
      'CHUANG 2021 Theme Song"Chuang To-Gather, Go!" Piano Cover《我们一起闯》创造营2021主题曲 钢琴',
  },
  '于深空见证的': {
    artist: '张韶涵',
    artists: { zhHans: '张韶涵', zhHant: '張韶涵', en: 'Angela Chang' },
    categoryTags: ['华语流行', '游戏'],
  },
  '以无旁骛之吻': {
    artist: '周深',
    artists: { zhHans: '周深', en: 'Charlie Zhou Shen' },
    categoryTags: ['华语流行'],
  },
  '你离开的村落': {
    artist: '纸嫁衣',
    artists: { zhHans: '纸嫁衣', en: 'Paper Bride' },
    categoryTags: ['游戏'],
  },
  古蜀回想: {
    artist: 'INTO1',
    artists: { zhHans: 'INTO1', en: 'INTO1' },
    categoryTags: ['华语流行'],
  },
  寂静之忆: {
    artist: '希林娜依·高',
    artists: { zhHans: '希林娜依·高', zhHant: '希林娜依·高', en: 'Curley Gao' },
    categoryTags: ['华语流行'],
  },
  '新时代 冬奥运': {
    artist: 'INTO1',
    artists: { zhHans: 'INTO1', en: 'INTO1' },
    categoryTags: ['华语流行'],
  },
  '春天对花所做的事': {
    artist: '恋与深空',
    artists: { zhHans: '恋与深空', zhHant: '戀與深空', en: 'Love and Deepspace' },
    categoryTags: ['华语流行', '游戏'],
  },
  抬起头啊: {
    title: '抬起头来',
    displayTitle: '抬起头来',
    titles: { zhHans: '抬起头来', zhHant: '抬起頭來' },
    artist: '时代少年团',
    artists: { zhHans: '时代少年团', zhHant: '時代少年團', en: 'Teens in Times' },
    category: '华语流行',
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=xnU2ymYQmj4',
      video: 'https://www.youtube.com/watch?v=xnU2ymYQmj4',
      sheet: 'https://mymusic.st/cipmusic/97088',
    },
    matchedVideoTitle:
      'TNT时代少年团 马嘉祺 宋亚轩 张真源《抬起头来》钢琴版 Teens In Times Ma Jiaqi Song Yaxuan Zhang Zhenyuan Wish Piano Cover | CIP Music',
  },
  光亮: {
    links: {
      sheet: 'https://www.mymusic5.com/cipmusic/49061',
    },
  },
  无人乐园: {
    artist: '王俊凯',
    artists: { zhHans: '王俊凯', zhHant: '王俊凱', en: 'Karry Wang' },
    category: '华语流行',
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=2TcJqYwJhoQ',
      video: 'https://www.youtube.com/watch?v=2TcJqYwJhoQ',
      sheet: 'https://www.mymusic5.com/cipmusic/373321',
    },
    matchedVideoTitle:
      "王俊凯《无人乐园》钢琴版 Karry Wang Junkai - 'No One's Paradise' Piano Cover | Piano by CIP Music",
  },
  爱琴海: {
    title: '爱琴海',
    displayTitle: '爱琴海',
    titles: { zhHans: '爱琴海', zhHant: '愛琴海', en: 'Aegean Sea' },
    artist: '周杰伦',
    artists: { zhHans: '周杰伦', zhHant: '周杰倫', en: 'Jay Chou' },
    category: '华语流行',
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=BM8Fz49vLpg',
      video: 'https://www.youtube.com/watch?v=BM8Fz49vLpg',
      bilibili: 'https://www.bilibili.com/video/BV1C3DxBBEGX',
      sheet: 'https://www.mymusic5.com/cipmusic/374036',
    },
  },
  恋人: {
    title: '恋人',
    displayTitle: '恋人',
    titles: { zhHans: '恋人', zhHant: '戀人', en: 'Lover' },
    artist: '李荣浩',
    artists: { zhHans: '李荣浩', zhHant: '李榮浩', en: 'Li Ronghao' },
    category: '华语流行',
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=tB4Bmv-JjXA',
      video: 'https://www.youtube.com/watch?v=tB4Bmv-JjXA',
      bilibili: 'https://www.bilibili.com/video/BV1RPQhBrEQM/',
      sheet: 'https://www.mymusic5.com/cipmusic/374985',
    },
  },
  摆脱地心引力: {
    title: '摆脱地心引力',
    displayTitle: '摆脱地心引力',
    titles: { zhHans: '摆脱地心引力', zhHant: '擺脫地心引力', en: 'Escape Gravity' },
    artist: '时代少年团',
    artists: { zhHans: '时代少年团', zhHant: '時代少年團', en: 'Teens in Times' },
    category: '华语流行',
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=bxtYrbUOQPM',
      video: 'https://www.youtube.com/watch?v=bxtYrbUOQPM',
      bilibili: 'https://www.bilibili.com/video/BV18jdvB9EA8',
      sheet: 'https://www.mymusic5.com/cipmusic/376065',
    },
  },
  /** 本地导入拆条：文件夹名含区分；界面只显示「Falling You」。 */
  'Falling You（刘耀文）': {
    title: 'Falling You',
    displayTitle: 'Falling You',
    titles: { zhHans: 'Falling You', zhHant: 'Falling You', en: 'Falling You' },
    artist: '刘耀文',
    artists: { zhHans: '刘耀文', zhHant: '劉耀文', en: 'Liu Yaowen' },
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=De-FuM4-G04',
      video: 'https://www.youtube.com/watch?v=De-FuM4-G04',
      bilibili: 'https://www.bilibili.com/video/BV1dF411L7SP',
      sheet: 'https://mymusic.st/cipmusic/64427',
    },
    matchedVideoTitle:
      'TNT时代少年团 刘耀文《Falling You》钢琴版 Teens In Times Liu Yaowen Piano Cover | CIP Music',
  },
  'Falling You（都智文 曾可妮）': {
    title: 'Falling You',
    displayTitle: 'Falling You',
    titles: { zhHans: 'Falling You', zhHant: 'Falling You', en: 'Falling You' },
    artist: '都智文',
    artists: { zhHans: '都智文、曾可妮', zhHant: '都智文、曾可妮', en: 'Bernard Du, Jenny Zeng' },
    categoryTags: ['华语流行', '影视'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=XNcEv7WXb8U',
      video: 'https://www.youtube.com/watch?v=XNcEv7WXb8U',
      bilibili: 'https://www.bilibili.com/video/BV1hg411H7dB',
      sheet: 'https://mymusic.st/cipmusic/87942',
    },
    matchedVideoTitle:
      'Falling You - 曾可妮 Jenny Zeng & 都智文 Baby.J（点燃我，温暖你 电视剧OST）| CIP Music',
  },
  /**
   * 远端 Supabase 拆条后与 slug 对齐（执行 `scripts/sql/falling-you-rebuild.sql` 后生效）。
   * 在迁移前，仍可继续用 slug `falling you` 的覆盖锁定刘耀文版元数据。
   */
  'falling you': {
    title: 'Falling You',
    displayTitle: 'Falling You',
    titles: { zhHans: 'Falling You', zhHant: 'Falling You', en: 'Falling You' },
    artist: '刘耀文',
    artists: { zhHans: '刘耀文', zhHant: '劉耀文', en: 'Liu Yaowen' },
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=De-FuM4-G04',
      video: 'https://www.youtube.com/watch?v=De-FuM4-G04',
      bilibili: 'https://www.bilibili.com/video/BV1dF411L7SP',
      sheet: 'https://mymusic.st/cipmusic/64427',
    },
  },
  'falling-you-liu-yao-wen': {
    title: 'Falling You',
    displayTitle: 'Falling You',
    titles: { zhHans: 'Falling You', zhHant: 'Falling You', en: 'Falling You' },
    artist: '刘耀文',
    artists: { zhHans: '刘耀文', zhHant: '劉耀文', en: 'Liu Yaowen' },
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=De-FuM4-G04',
      video: 'https://www.youtube.com/watch?v=De-FuM4-G04',
      bilibili: 'https://www.bilibili.com/video/BV1dF411L7SP',
      sheet: 'https://mymusic.st/cipmusic/64427',
    },
  },
  'falling-you-du-zeng': {
    title: 'Falling You',
    displayTitle: 'Falling You',
    titles: { zhHans: 'Falling You', zhHant: 'Falling You', en: 'Falling You' },
    artist: '都智文',
    artists: { zhHans: '都智文、曾可妮', zhHant: '都智文、曾可妮', en: 'Bernard Du, Jenny Zeng' },
    categoryTags: ['华语流行', '影视'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=XNcEv7WXb8U',
      video: 'https://www.youtube.com/watch?v=XNcEv7WXb8U',
      bilibili: 'https://www.bilibili.com/video/BV1hg411H7dB',
      sheet: 'https://mymusic.st/cipmusic/87942',
    },
  },
  全世界在你身后: {
    artist: '都智文',
    artists: { zhHans: '都智文', zhHant: '都智文', en: 'Bernard Du' },
    categoryTags: ['华语流行', '影视'],
  },
  'masayume chasing': {
    links: { noSheet: true },
  },
  明早老地方出发: {
    links: {
      youtube: 'https://www.youtube.com/watch?v=Q6VHL6K_ttM',
      video: 'https://www.youtube.com/watch?v=Q6VHL6K_ttM',
      sheet: 'https://www.mymusicsheet.com/cipmusic/54089',
    },
    matchedVideoTitle: 'INTO1 “See You” Piano《明早老地方，出发》钢琴版  | Piano Cover by CIP Music',
  },
  水龙吟: {
    title: '水龙吟',
    displayTitle: '水龙吟',
    titles: {
      zhHans: '水龙吟',
      zhHant: '水龍吟',
      en: 'Samudrartha (Shuilongyin)',
    },
    artist: 'HOYO-MiX',
    artists: {
      zhHans: 'HOYO-MiX',
      zhHant: 'HOYO-MiX',
      en: 'HOYO-MiX',
    },
    category: '日韩流行',
    categoryTags: ['游戏'],
    matchedVideoTitle:
      'Honkai: Star Rail EP:"Samudrartha"《崩坏：星穹铁道》EP 《水龙吟》Piano Cover | Piano by CIP Music',
    links: {
      youtube: 'https://www.youtube.com/watch?v=pHgEU0pvsyg',
      video: 'https://www.youtube.com/watch?v=pHgEU0pvsyg',
      sheet: 'https://mymusic.st/cipmusic/119426',
    },
  },
  还在流浪: {
    links: {
      youtube: 'https://www.youtube.com/watch?v=mpW_hWs47EI',
      video: 'https://www.youtube.com/watch?v=mpW_hWs47EI',
      sheet: 'https://mymusic.st/cipmusic/70317',
    },
    matchedVideoTitle:
      '周杰倫 Jay Chou ’還在流浪 Still Wandering‘ 鋼琴版 Piano Cover | Piano by CIP Music',
  },
  这么可爱真是抱歉: {
    links: {
      youtube: 'https://www.youtube.com/watch?v=xAOin7atTRE',
      video: 'https://www.youtube.com/watch?v=xAOin7atTRE',
      sheet: 'https://mymusic.st/cipmusic/121021',
    },
    matchedVideoTitle:
      'HoneyWorks /（CV：早見沙織）"可愛くてごめん"《这么可爱真是抱歉》Piano Cover | Piano by CIP Music',
  },
  名场面: {
    title: '名场面',
    displayTitle: '名场面',
    titles: { zhHans: '名场面', zhHant: '名場面', en: 'Famous Scene' },
    artist: '华晨宇',
    artists: { zhHans: '华晨宇', zhHant: '華晨宇', en: 'Hua Chenyu' },
    category: '华语流行',
    categoryTags: ['华语流行', '游戏'],
    cover: 'https://img.youtube.com/vi/AI--uQ-dIIs/hqdefault.jpg',
    officialLinks: {
      youtube: 'https://www.youtube.com/watch?v=AI--uQ-dIIs',
    },
    matchedVideoTitle:
      '华晨宇《名场面》钢琴版 「火星演唱会」十周年开场曲 「希忘Hope」- Famous Scene Piano Cover | Piano by CIP Music',
    links: {
      youtube: 'https://www.youtube.com/watch?v=AI--uQ-dIIs',
      video: 'https://www.youtube.com/watch?v=AI--uQ-dIIs',
      sheet: 'https://mymusic.st/cipmusic/59893',
    },
  },
  都选c: {
    title: '都选C',
    displayTitle: '都选C',
    titles: { zhHans: '都选C', zhHant: '都選C', en: 'Choose C' },
    artist: '缝纫机乐队',
    artists: { zhHans: '缝纫机乐队', zhHant: '縫紉機樂隊', en: 'Sewing Machine Band' },
    category: '华语流行',
    categoryTags: ['影视'],
    cover: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/0c/15/3f/0c153f4c-f6dd-b5cc-1b67-fc0056dcfff9/cover.jpg/600x600bb.jpg',
    officialLinks: {
      appleMusic: 'https://music.apple.com/cn/album/%E9%83%BD%E9%80%89c/1502706428?i=1502706631',
    },
    links: {
      bilibili: 'https://www.bilibili.com/video/BV1kv411e7kz/',
      noSheet: true,
    },
    matchedVideoTitle: '《都选C》抒情版 - 电影《缝纫机乐队》插曲',
  },
  /**
   * CIP + Apple "Hello" collided with THE9 piano cover; official cover was a western "Hello" release.
   */
  Hello: {
    title: 'Hello',
    displayTitle: 'Hello',
    titles: { zhHans: 'Hello', zhHant: 'Hello', en: 'Hello' },
    artist: 'THE9',
    artists: { zhHans: 'THE9', zhHant: 'THE9', en: 'THE9' },
    category: '华语流行',
    categoryTags: ['华语流行'],
    matchedVideoTitle: 'Hello - THE9 Piano Cover 钢琴版',
    links: {
      youtube: 'https://www.youtube.com/watch?v=lXWDJVq0ZZs',
      video: 'https://www.youtube.com/watch?v=lXWDJVq0ZZs',
      sheet: 'https://www.mymusicsheet.com/cipmusic/38250',
    },
  },
  /**
   * CIP 曾误绑 ZB1「In Bloom」；已用手动核验的 CIP 钢琴版视频（非 ZB1）。
   */
  灯火万家: {
    title: '灯火万家',
    displayTitle: '灯火万家',
    artist: '王赫野',
    artists: { zhHans: '王赫野', zhHant: '王赫野', en: 'Wang Heye' },
    category: '华语流行',
    categoryTags: ['影视'],
    matchedVideoTitle:
      '《我的人间烟火》OST《灯火万家》王赫野 钢琴版 | Piano Cover by CIP Music',
    links: {
      youtube: 'https://www.youtube.com/watch?v=lM6n8YPsXSI',
      video: 'https://www.youtube.com/watch?v=lM6n8YPsXSI',
      sheet: 'https://mymusic.st/cipmusic/117610',
    },
  },
  /** 刘宇宁：副标题/艺人行仅「刘宇宁」，去掉摩登兄弟、OST 英文名、曲名前缀等杂质。 */
  '就在江湖之上': {
    artist: '刘宇宁',
    artists: { zhHans: '刘宇宁', zhHant: '劉宇寧', en: 'Liu Yuning' },
  },
  '意气趁年少': {
    artist: '刘宇宁',
    artists: { zhHans: '刘宇宁', zhHant: '劉宇寧', en: 'Liu Yuning' },
  },
  '烟火星辰': {
    artist: '刘宇宁',
    artists: { zhHans: '刘宇宁', zhHant: '劉宇寧', en: 'Liu Yuning' },
  },
  /** 《你是我的荣耀》OST；原唱 INTO1 米卡 + 希林娜依·高 — 艺人归档希林。 */
  陷入爱情: {
    artist: '希林娜依·高',
    artists: { zhHans: '希林娜依·高、INTO1 米卡', en: 'Curley Gao, Mika (INTO1)' },
    categoryTags: ['影视', '华语流行'],
  },
  /** 《陈情令》片尾曲；双原唱王一博、肖战（与艺人桶双归一致）。 */
  无羁: {
    artist: '王一博、肖战',
    artists: { zhHans: '王一博、肖战', en: 'Wang Yibo, Xiao Zhan' },
    category: '华语流行',
    categoryTags: ['华语流行', '影视'],
  },
  莫离: {
    artist: '鞠婧祎',
    artists: { zhHans: '鞠婧祎', zhHant: '鞠婧禕', en: 'Ju Jingyi' },
    categoryTags: ['影视', '华语流行'],
    links: { noSheet: true },
  },
  续写: {
    artist: '单依纯',
    artists: { zhHans: '单依纯', zhHant: '單依純', en: 'Shan Yichun' },
    categoryTags: ['影视', '华语流行'],
  },
  菩萨蛮: {
    artist: '姚贝娜',
    artists: { zhHans: '姚贝娜', zhHant: '姚貝娜', en: 'Bella Yao' },
    categoryTags: ['影视', '华语流行'],
  },
  镌刻: {
    artist: '张碧晨',
    artists: { zhHans: '张碧晨', zhHant: '張碧晨', en: 'Zhang Bichen' },
    categoryTags: ['影视', '华语流行'],
  },
  笼: {
    artist: '张碧晨',
    artists: { zhHans: '张碧晨', zhHant: '張碧晨', en: 'Zhang Bichen' },
    categoryTags: ['影视', '华语流行'],
  },
  来生戏: {
    artist: '纸嫁衣',
    artists: { zhHans: '纸嫁衣', zhHant: '紙嫁衣', en: 'Paper Bride' },
    categoryTags: ['游戏'],
  },
  明日坐标: {
    artist: '林俊杰、王者荣耀',
    artists: { zhHans: '林俊杰、王者荣耀', zhHant: '林俊傑、王者榮耀', en: 'JJ Lin, Honor of Kings' },
    categoryTags: ['游戏', '华语流行'],
  },
  奇迹时刻: {
    artist: '周深、王者荣耀',
    artists: { zhHans: '周深、王者荣耀', en: 'Zhou Shen, Honor of Kings' },
    categoryTags: ['游戏', '华语流行'],
  },
  时结: {
    artist: '周深、王者荣耀',
    artists: { zhHans: '周深、王者荣耀', en: 'Zhou Shen, Honor of Kings' },
    categoryTags: ['游戏', '华语流行'],
  },
  如一: {
    artist: '任嘉伦',
    artists: { zhHans: '任嘉伦', en: 'Allen Ren' },
    categoryTags: ['影视', '华语流行'],
  },
  如故: {
    artist: '张碧晨',
    artists: { zhHans: '张碧晨', zhHant: '張碧晨', en: 'Zhang Bichen' },
    categoryTags: ['影视', '华语流行'],
  },
  '烽月': {
    artist: '刘宇宁',
    artists: { zhHans: '刘宇宁', zhHant: '劉宇寧', en: 'Liu Yuning' },
  },
  /**
   * (G)I-DLE：统一「I-DLE」。Apple/元数据常产生「I-DLE G」或成员名单独署名。
   */
  Allergy: {
    artist: 'I-DLE',
    artists: { zhHans: 'I-DLE', zhHant: 'I-DLE', en: 'I-DLE' },
  },
  'could it be': {
    artist: 'I-DLE',
    artists: { zhHans: 'I-DLE', zhHant: 'I-DLE', en: 'I-DLE' },
  },
  drive: {
    artist: 'I-DLE',
    artists: { zhHans: 'I-DLE', zhHant: 'I-DLE', en: 'I-DLE' },
  },
  Mono: {
    artist: 'I-DLE',
    artists: { zhHans: 'I-DLE', zhHant: 'I-DLE', en: 'I-DLE' },
  },
  nxde: {
    artist: 'I-DLE',
    artists: { zhHans: 'I-DLE', zhHant: 'I-DLE', en: 'I-DLE' },
  },
  'pop star': {
    title: 'Pop/Star',
    displayTitle: 'Pop/Star',
    titles: { zhHans: 'Pop/Star', zhHant: 'Pop/Star', en: 'Pop/Star' },
    artist: 'K/DA',
    artists: { zhHans: 'K/DA', zhHant: 'K/DA', en: 'K/DA' },
    category: '韩流流行',
    categoryTags: ['韩流流行', '游戏'],
    links: { noSheet: true },
    workProjectKey: 'league-of-legends',
  },
  'queen card': {
    artist: 'I-DLE',
    artists: { zhHans: 'I-DLE', zhHant: 'I-DLE', en: 'I-DLE' },
  },
  tomboy: {
    artist: 'I-DLE',
    artists: { zhHans: 'I-DLE', zhHant: 'I-DLE', en: 'I-DLE' },
  },
  /**
   * Same piece as the removed duplicate slug `圣诞快乐` (excluded from seeds).
   * UI primary title uses Chinese 「圣诞快乐」; English legal title kept in `titles.en`.
   */
  'Merry Christmas Mr.Lawrence': {
    title: '圣诞快乐，劳伦斯先生',
    displayTitle: '圣诞快乐，劳伦斯先生',
    titles: {
      zhHans: '圣诞快乐，劳伦斯先生',
      zhHant: '聖誕快樂，勞倫斯先生',
      en: 'Merry Christmas, Mr. Lawrence',
    },
    artist: '坂本龙一',
    artists: { zhHans: '坂本龙一', zhHant: '坂本龍一', en: 'Ryuichi Sakamoto' },
    category: '日韩流行',
    categoryTags: ['纯音乐', '影视'],
    cover: 'https://img.youtube.com/vi/QtzqbeDBQGI/hqdefault.jpg',
    matchedVideoTitle:
      'Ryuichi Sakamoto - “Merry Christmas Mr. Lawrence” Piano Cover | Piano by CIP Music',
    links: {
      youtube: 'https://www.youtube.com/watch?v=QtzqbeDBQGI',
      video: 'https://www.youtube.com/watch?v=QtzqbeDBQGI',
      sheet: 'https://www.mymusic5.com/cipmusic/158001',
    },
  },
  komorebi: {
    title: 'Komorebi',
    displayTitle: 'Komorebi',
    artist: 'm-taku',
    artists: { zhHans: 'm-taku', en: 'm-taku' },
    category: '日韩流行',
    categoryTags: ['纯音乐'],
    cover: 'https://img.youtube.com/vi/IpXoozpm_eg/hqdefault.jpg',
    matchedVideoTitle:
      'm-taku 《Komorebi》(警笛版）“叶隙间洒落的阳光” Piano Cover | Piano by CIP Music',
    links: {
      youtube: 'https://www.youtube.com/watch?v=IpXoozpm_eg',
      video: 'https://www.youtube.com/watch?v=IpXoozpm_eg',
      sheet: 'https://mymusic.st/cipmusic/121517',
    },
  },
  /** aespa《Girls》— 主频道视频见 @CIPMusic 搜索；谱见简介为 n/a。 */
  girls: {
    artist: 'aespa',
    artists: { zhHans: 'aespa', zhHant: 'aespa', en: 'aespa' },
    category: '韩流流行',
    categoryTags: ['韩流流行'],
    suppressOfficialCover: true,
    cover: 'https://img.youtube.com/vi/Rfv2kFBQ5hY/maxresdefault.jpg',
    matchedVideoTitle: "aespa 에스파 'Girls' Piano Cover | CIP Music",
    links: {
      youtube: 'https://www.youtube.com/watch?v=Rfv2kFBQ5hY',
      video: 'https://www.youtube.com/watch?v=Rfv2kFBQ5hY',
      noSheet: true,
    },
  },
  /** 周深河南卫视中秋《若思念便思念》；slug 与目录仍为「思念便思念」。 */
  思念便思念: {
    title: '若思念便思念',
    displayTitle: '若思念便思念',
    titles: {
      zhHans: '若思念便思念',
      zhHant: '若思念便思念',
      en: 'If I Miss You, I Miss You',
    },
    artist: '周深',
    artists: { zhHans: '周深', zhHant: '周深', en: 'Zhou Shen' },
    officialLinks: {
      appleMusic:
        'https://music.apple.com/us/album/%E8%8B%A5%E6%80%9D%E5%BF%B5%E4%BE%BF%E6%80%9D%E5%BF%B5/1586439972?i=1586439977&uo=4',
    },
  },
  /** 原曲为 ZICO《SPOT! (feat. JENNIE)》；曾误链 Spider-Verse「Calling」钢琴版。 */
  SPOT: {
    title: 'SPOT!',
    displayTitle: 'SPOT!',
    titles: {
      zhHans: 'SPOT!',
      zhHant: 'SPOT!',
      en: 'SPOT!',
    },
    artist: 'ZICO',
    artists: { zhHans: 'ZICO', zhHant: 'ZICO', en: 'ZICO' },
    category: '韩流流行',
    categoryTags: ['韩流流行'],
    officialLinks: {
      appleMusic: 'https://music.apple.com/us/album/spot-feat-jennie/1742019065?i=1742019076',
    },
    matchedVideoTitle: "ZICO (지코) 'SPOT! (feat. JENNIE)' Official MV",
    links: {
      youtube: 'https://www.youtube.com/watch?v=xfqBQ2XhBCg',
      video: 'https://www.youtube.com/watch?v=xfqBQ2XhBCg',
      noSheet: true,
    },
  },

  // ── 艺人显示口径（canonical 与 seed original对齐；不新建词条）──
  /** HUNTR/X 为歌手名；KPOP Demon Hunters 为作品/项目名。 */
  free: {
    artist: 'HUNTR/X',
    artists: { zhHans: 'HUNTR/X', zhHant: 'HUNTR/X', en: 'HUNTR/X' },
    categoryTags: ['韩流流行', '影视'],
    workProjectKey: 'kpop-demon-hunters',
  },
  'take-down': {
    artist: 'HUNTR/X',
    artists: { zhHans: 'HUNTR/X', zhHant: 'HUNTR/X', en: 'HUNTR/X' },
    categoryTags: ['韩流流行', '影视'],
    workProjectKey: 'kpop-demon-hunters',
  },
  golden: { workProjectKey: 'kpop-demon-hunters' },
  'your-idol': { workProjectKey: 'kpop-demon-hunters' },
  "How it's done": { workProjectKey: 'kpop-demon-hunters' },
  'call of silence': {
    artist: '泽野弘之',
    artists: { zhHans: '泽野弘之', zhHant: '澤野弘之', en: 'Hiroyuki Sawano' },
  },
  calling: {
    artist: 'Metro Boomin',
    artists: { zhHans: 'Metro Boomin', en: 'Metro Boomin' },
  },
  彼岸: {
    artist: '井胧、井迪儿',
    artists: { zhHans: '井胧、井迪儿', zhHant: '井朧、井迪兒', en: 'Jing Long, Jing Dier' },
  },
  'Bridge over troubled water': {
    title: 'Bridge over troubled water',
    displayTitle: 'Bridge over troubled water',
    titles: {
      zhHans: '忧愁河上的金桥',
      zhHant: '憂愁河上的金橋',
      en: 'Bridge Over Troubled Water',
    },
    artist: 'Simon and Garfunkel',
    artists: {
      zhHans: 'Simon and Garfunkel',
      zhHant: 'Simon and Garfunkel',
      en: 'Simon and Garfunkel',
    },
    links: {
      youtube: 'https://www.youtube.com/watch?v=NMUIDV3m3zk',
      video: 'https://www.youtube.com/watch?v=NMUIDV3m3zk',
    },
  },
  'Burn it all down': {
    title: 'Burn it all down',
    displayTitle: 'Burn it all down',
    titles: {
      zhHans: '不可阻挡',
      zhHant: '不可阻擋',
      en: 'Burn It All Down',
    },
    artist: '英雄联盟',
    artists: { zhHans: '英雄联盟', zhHant: '英雄聯盟', en: 'League of Legends' },
    workProjectKey: 'league-of-legends',
    links: {
      youtube: 'https://www.youtube.com/watch?v=JWbhkFJSz4E',
      video: 'https://www.youtube.com/watch?v=JWbhkFJSz4E',
    },
  },

  // ── CIP 冲突 / suspect 定向修正（歌名 + 原唱 + 独立 videoId；一视频一曲目）──
  'super shy': {
    artist: 'NewJeans',
    artists: { zhHans: 'NewJeans', zhHant: 'NewJeans', en: 'NewJeans' },
    categoryTags: ['韩流流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=YBskJoHUViQ',
      video: 'https://www.youtube.com/watch?v=YBskJoHUViQ',
    },
    matchedVideoTitle:
      'NewJeans  뉴진스 《Super Shy》 Piano Cover | Piano by CIP Music',
  },
  super: {
    artist: 'SEVENTEEN',
    artists: { zhHans: 'SEVENTEEN', zhHant: 'SEVENTEEN', en: 'SEVENTEEN' },
    categoryTags: ['韩流流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=VS0i_Bkol_I',
      video: 'https://www.youtube.com/watch?v=VS0i_Bkol_I',
    },
    matchedVideoTitle: "SEVENTEEN (세븐틴) '손오공' (Super) Piano Cover | CIP Music",
  },
  一杯火焰: {
    artist: 'INTO1',
    artists: { zhHans: 'INTO1', zhHant: 'INTO1', en: 'INTO1' },
    links: {
      youtube: 'https://www.youtube.com/watch?v=_-dHnxQtwgI',
      video: 'https://www.youtube.com/watch?v=_-dHnxQtwgI',
    },
    matchedVideoTitle: "INTO1《一杯火焰》钢琴版 INTO1 'Together Somewhere' Piano Cover | CIP Music",
  },
  INTO1: {
    artist: 'INTO1',
    artists: { zhHans: 'INTO1', zhHant: 'INTO1', en: 'INTO1' },
    links: {
      youtube: 'https://www.youtube.com/watch?v=5rXo0iPaNww',
      video: 'https://www.youtube.com/watch?v=5rXo0iPaNww',
    },
    matchedVideoTitle: 'INTO1 Piano Cover - 创造营CHUANG2021 Debut Song - INTO1 钢琴',
  },
  云宫迅音: {
    title: '云宫迅音',
    displayTitle: '云宫迅音',
    artist: '黑神话：悟空',
    artists: { zhHans: '黑神话：悟空', zhHant: '黑神话：悟空', en: 'Black Myth: Wukong' },
    categoryTags: ['游戏'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=djFnKGRE0rQ',
      video: 'https://www.youtube.com/watch?v=djFnKGRE0rQ',
    },
    matchedVideoTitle:
      'Black Myth: Wukong Celestial Symphony  Piano Cover《黑神话：悟空》版《云宫迅音》 钢琴版  | Piano by CIP Music',
  },
  celestial: {
    artist: 'Ed Sheeran',
    artists: { zhHans: '艾德·希兰', zhHant: '艾德·希蘭', en: 'Ed Sheeran' },
    categoryTags: ['欧美流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=XKVaCqB568E',
      video: 'https://www.youtube.com/watch?v=XKVaCqB568E',
    },
    matchedVideoTitle: 'Ed Sheeran & Pokémon - Celestial Piano Cover | CIP Music',
  },
  /** 15 分钟日出 LIVE 版 */
  向阳而生日出版: {
    artist: '华晨宇',
    artists: { zhHans: '华晨宇', zhHant: '華晨宇', en: 'Hua Chenyu' },
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=slkIcIS-VaY',
      video: 'https://www.youtube.com/watch?v=slkIcIS-VaY',
      sheet: 'https://mymusic.st/cipmusic/169723',
    },
    matchedVideoTitle:
      "华晨宇 Hua Chenyu 《向阳而生》日出LIVE15分钟版 'Growing Toward the Sun' Piano Cover | Piano by CIP Music",
  },
  /** 常规钢琴版（非 15 分钟 LIVE） */
  向阳而生: {
    artist: '华晨宇',
    artists: { zhHans: '华晨宇', zhHant: '華晨宇', en: 'Hua Chenyu' },
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=fipvke-Q5o4',
      video: 'https://www.youtube.com/watch?v=fipvke-Q5o4',
      sheet: 'https://mymusic.st/cipmusic/169723',
    },
    matchedVideoTitle:
      "华晨宇《向阳而生》钢琴版 Hua Chenyu 'Growing Toward the Sun' Piano Cover | Piano by CIP Music",
  },
  在故事的最终: {
    artist: '张碧晨',
    artists: { zhHans: '张碧晨', zhHant: '張碧晨', en: 'Zhang Bichen' },
    categoryTags: ['影视', '华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=PFGcLLaqGUo',
      video: 'https://www.youtube.com/watch?v=PFGcLLaqGUo',
    },
    matchedVideoTitle:
      '《哪吒之魔童闹海》（NeZha 2）片尾曲 张碧晨（Zhang Bichen）《在故事的最终》钢琴版 Piano Cover | Piano by CIP Music',
  },
  /** 时代少年团《哪吒》单曲（与《就是哪吒》角色曲区分） */
  哪吒: {
    artist: '时代少年团',
    artists: { zhHans: '时代少年团', zhHant: '時代少年團', en: 'Teens in Times' },
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=N5ne2BvRgQc',
      video: 'https://www.youtube.com/watch?v=N5ne2BvRgQc',
      sheet: 'https://www.mymusic5.com/cipmusic/49395',
    },
    matchedVideoTitle: '哪吒钢琴版 - TNT时代少年团 NeZha Piano Cover - Teens In Times',
  },
  /** 唐汉霄《就是哪吒》电影角色曲（与 TNT《哪吒》区分） */
  就是哪吒: {
    artist: '唐汉霄',
    artists: { zhHans: '唐汉霄', zhHant: '唐漢霄', en: 'Sean Tang' },
    categoryTags: ['影视', '华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=v6uafKvOvYU',
      video: 'https://www.youtube.com/watch?v=v6uafKvOvYU',
      sheet: 'https://mymusic.st/cipmusic/250557',
    },
    matchedVideoTitle:
      '唐漢霄 SeanTang 《哪吒之魔童闹海》（NeZha 2）哪吒角色曲《就是哪吒》钢琴版 Piano Cover | Piano by CIP Music',
  },
  我会等: {
    artist: '承桓',
    artists: { zhHans: '承桓', zhHant: '承桓', en: 'Cheng Huan' },
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=cPn2K0mgmJ0',
      video: 'https://www.youtube.com/watch?v=cPn2K0mgmJ0',
    },
    matchedVideoTitle: '承桓 《我会等》钢琴版 Piano Cover | Piano by CIP Music',
  },
  当我奔向你: {
    artist: '林晨阳',
    artists: { zhHans: '林晨阳', zhHant: '林晨陽', en: 'Lin Chenyang' },
    categoryTags: ['影视', '华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=zvESg9Or6FM',
      video: 'https://www.youtube.com/watch?v=zvESg9Or6FM',
    },
    matchedVideoTitle:
      '林晨阳《当我飞奔向你》"When I Fly Towards You" 主题曲《当我奔向你》钢琴版  Piano Cover | Piano by CIP Music',
  },
  时空引力: {
    title: '时空引力',
    displayTitle: '时空引力',
    artist: '《恋与深空》',
    artists: { zhHans: '恋与深空', zhHant: '戀與深空', en: 'Love and Deepspace' },
    categoryTags: ['游戏'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=wKoxdA188kE',
      video: 'https://www.youtube.com/watch?v=wKoxdA188kE',
    },
    matchedVideoTitle:
      '时空引力 Gravity of Spacetime - Love and Deepspace《恋与深空》（戀與深空）抽卡BGM Piano Cover | Piano by CIP Music',
  },
  恋与深空主题曲: {
    artist: '莎拉·布莱曼',
    artists: { zhHans: '莎拉·布莱曼', zhHant: '莎拉·布萊曼', en: 'Sarah Brightman' },
    categoryTags: ['游戏', '欧美流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=a4QyrJfM6Tg',
      video: 'https://www.youtube.com/watch?v=a4QyrJfM6Tg',
    },
    matchedVideoTitle:
      'Sarah Brightman（莎拉·布莱曼） - Love and Deepspace《恋与深空》（戀與深空） Piano Cover | Piano by CIP Music',
  },
  泪桥: {
    artist: '伍佰',
    artists: { zhHans: '伍佰', zhHant: '伍佰', en: 'Wu Bai' },
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=OmqQcKoeQzU',
      video: 'https://www.youtube.com/watch?v=OmqQcKoeQzU',
    },
    matchedVideoTitle: "伍佰《泪桥》钢琴版 Wu Bai 'Tear Bridge' Piano Cover | Piano by CIP Music",
  },
  悟: {
    artist: '张艺兴',
    artists: { zhHans: '张艺兴', zhHant: '張藝興', en: 'Lay Zhang' },
    categoryTags: ['华语流行', '游戏'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=rmcDxQ8Ourg',
      video: 'https://www.youtube.com/watch?v=rmcDxQ8Ourg',
    },
    matchedVideoTitle:
      'LAY (张艺兴/레이) - 悟(WU) 钢琴版  梦幻西游手游孙悟空角色曲 (Fantasy Westward Journey OST) | Piano Cover by CIP Music',
  },
  爱丫爱丫: {
    artist: 'BY2',
    artists: { zhHans: 'BY2', zhHant: 'BY2', en: 'BY2' },
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=pKnPm3zaDpg',
      video: 'https://www.youtube.com/watch?v=pKnPm3zaDpg',
    },
    matchedVideoTitle:
      '愛丫愛丫 钢琴版 By2 “爱我的话 给我回答” 抖音热门歌曲 Ai Ya Ai Ya Piano Cover By2 TikTok Hit Song | Piano by CIP Music',
  },
  /** 严浩翔《Y》 */
  Y: {
    title: 'Y',
    displayTitle: 'Y',
    artist: '严浩翔',
    artists: { zhHans: '严浩翔', zhHant: '嚴浩翔', en: 'Yan Haoxiang' },
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=HelDzClk5X8',
      video: 'https://www.youtube.com/watch?v=HelDzClk5X8',
    },
    matchedVideoTitle:
      'Y 钢琴版 TNT时代少年团 严浩翔 Teens In Times YanHaoxiang Y piano cover',
  },
  相遇的意义: {
    artist: 'SEVENTEEN',
    artists: { zhHans: 'SEVENTEEN', zhHant: 'SEVENTEEN', en: 'SEVENTEEN' },
    categoryTags: ['韩流流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=_S6-U1V5uE0',
      video: 'https://www.youtube.com/watch?v=_S6-U1V5uE0',
    },
    matchedVideoTitle:
      'SEVENTEEN 세븐틴《相遇的意义》 (The meaning of meeting / 만남의 의미)  Piano Cover | Piano by CIP Music',
  },
  相遇: {
    artist: '时代少年团',
    artists: { zhHans: '时代少年团', zhHant: '時代少年團', en: 'Teens in Times' },
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=y7GSUJunFPc',
      video: 'https://www.youtube.com/watch?v=y7GSUJunFPc',
    },
    matchedVideoTitle:
      "TNT时代少年团《相遇》钢琴版 - 'Me Before You' Piano Cover Teens In Times | Piano Cover by CIP Music",
  },
  芥: {
    artist: '丁程鑫',
    artists: { zhHans: '丁程鑫', zhHant: '丁程鑫', en: 'Ding Chengxin' },
    categoryTags: ['华语流行'],
    officialLinks: {
      spotify: 'https://open.spotify.com/track/2c7yZrTzhuHhc2zjw8AC9g',
    },
    links: {
      youtube: 'https://www.youtube.com/watch?v=PocM0dFQcXg',
      video: 'https://www.youtube.com/watch?v=PocM0dFQcXg',
    },
    matchedVideoTitle:
      '时代少年团 丁程鑫《芥》钢琴版 Teens In Times(TNT) Ding ChengXin - “Reach for the light” Piano Cover',
  },
  听悲伤的情歌: {
    artist: '苏星婕',
    artists: { zhHans: '苏星婕', zhHant: '蘇星婕', en: 'Su Xingjie' },
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=sHIwRpKPRFI',
      video: 'https://www.youtube.com/watch?v=sHIwRpKPRFI',
    },
    matchedVideoTitle:
      '苏星婕 Su Xingjie 《听悲伤的情歌》钢琴版 Piano Cover | Piano by CIP Music',
  },
  念思雨: {
    artist: '鞠婧祎',
    artists: { zhHans: '鞠婧祎', zhHant: '鞠婧禕', en: 'Ju Jingyi' },
    categoryTags: ['影视', '华语流行'],
    links: {
      noSheet: true,
      youtube: 'https://www.youtube.com/watch?v=nQJ6gQzCVIw',
      video: 'https://www.youtube.com/watch?v=nQJ6gQzCVIw',
    },
    matchedVideoTitle:
      "《念思雨》钢琴 鞠婧祎 曾舜晞 《嘉南传》Missing the rain Piano Cover - 'Rebirth For You' OST - Kiku Ju & Joseph Zeng",
  },
  念: {
    artist: '刘宇宁',
    artists: { zhHans: '刘宇宁', zhHant: '劉宇寧', en: 'Liu Yuning' },
    categoryTags: ['影视', '华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=G6NBPSdbkrM',
      video: 'https://www.youtube.com/watch?v=G6NBPSdbkrM',
    },
    matchedVideoTitle:
      '念 Rememberance 摩登兄弟刘宇宁 Liu Yuning 电影《古董局中局》主题曲  Schemes In Antiques Theme Song',
  },
  我们啊: {
    artist: 'THE9',
    artists: { zhHans: 'THE9', zhHant: 'THE9', en: 'THE9' },
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=aTEx6Vn1TEY',
      video: 'https://www.youtube.com/watch?v=aTEx6Vn1TEY',
    },
    matchedVideoTitle:
      '我们啊 钢琴版 THE9 毕业同名EP《THE NINE》Disband EP Piano Cover',
  },
  我们: {
    artist: '肖战',
    artists: { zhHans: '肖战', zhHant: '肖戰', en: 'Xiao Zhan' },
    categoryTags: ['华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=4aTQn-0f84c',
      video: 'https://www.youtube.com/watch?v=4aTQn-0f84c',
    },
    matchedVideoTitle: "肖战《我们》钢琴版 Xiao Zhan - ‘WM’ Piano Cover  | Piano by CIP Music",
  },
  无双的王者: {
    artist: '邓紫棋、王者荣耀',
    artists: { zhHans: '邓紫棋、王者荣耀', zhHant: '鄧紫棋、王者榮耀', en: 'G.E.M., Honor of Kings' },
    categoryTags: ['游戏', '华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=9suY3gakE2o',
      video: 'https://www.youtube.com/watch?v=9suY3gakE2o',
    },
    matchedVideoTitle:
      '《无双的王者 》钢琴版 鄧紫棋 - Peerless King Piano Cover G.E.M. - 王者荣耀2021世界冠军杯主题曲 Honor of Kings Theme Song',
  },
  'see the light': {
    title: 'See The Light',
    displayTitle: 'See The Light',
    artist: '《现在拨打的电话》OST',
    artists: { zhHans: '《现在拨打的电话》OST', en: 'When The Phone Rings OST' },
    categoryTags: ['影视', '韩语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=KYXB8Bl3XCA',
      video: 'https://www.youtube.com/watch?v=KYXB8Bl3XCA',
    },
    matchedVideoTitle:
      '"When The Phone Rings(지금 거신 전화는)"OST - "See The Light" Piano Cover | Piano by CIP Music',
  },
  /**
   * 曲目实为《青城山下白素贞》；slug 仍为「青山城下白素贞」。
   */
  青山城下白素贞: {
    title: '青城山下白素贞',
    displayTitle: '青城山下白素贞',
    titles: { zhHans: '青城山下白素贞', zhHant: '青城山下白素貞' },
    artist: '鞠婧祎',
    artists: { zhHans: '鞠婧祎', zhHant: '鞠婧禕', en: 'Ju Jingyi' },
    categoryTags: ['影视', '华语流行'],
    links: {
      youtube: 'https://www.youtube.com/watch?v=2p0HQNauGFg',
      video: 'https://www.youtube.com/watch?v=2p0HQNauGFg',
    },
    matchedVideoTitle:
      '《青城山下白素贞》鞠婧祎 钢琴版《新白娘子传奇》插曲（前世今生）- The Legend of the White Snake OST Piano Cover - Kiku Ju Jingyi',
  },
  /**
   * ROSÉ & Bruno Mars 合作曲；双艺人显示，Rosé 列前（勿只标 Mars）。
   */
  APT: {
    displayTitle: 'APT.',
    title: 'APT.',
    artist: 'Rosé和Bruno Mars',
    artists: {
      zhHans: 'Rosé和Bruno Mars',
      zhHant: 'Rosé和Bruno Mars',
      en: 'Rosé & Bruno Mars',
    },
    categoryTags: ['韩流流行'],
  },
  /** 武星、任胤蓬 舞台曲；封面以 Spotify track 为准。 */
  我的舞台: {
    title: '我的舞台',
    displayTitle: '我的舞台',
    artist: '武星、任胤蓬',
    artists: { zhHans: '武星、任胤蓬', zhHant: '武星、任胤蓬', en: 'Wu Xing, Ren Yinpeng' },
    categoryTags: ['华语流行'],
    officialLinks: {
      spotify: 'https://open.spotify.com/track/41rq3EnmShEXPmTQIk2vFa',
    },
    links: {
      bilibili: 'https://www.bilibili.com/video/BV13K4y1n7nm/',
    },
    matchedVideoTitle: '《我的舞台》武星、任胤蓬（用户指定 Bilibili 片源）',
  },
  /** CIP 钢琴版；仅 B 站（曾误绑 Zootopia《Zoo》同 id） */
  'normal no more': {
    title: 'Normal No More',
    displayTitle: 'Normal No More',
    artist: 'TYSM',
    artists: { zhHans: 'TYSM', en: 'TYSM' },
    categoryTags: ['欧美流行'],
    links: {
      youtube: 'https://youtube.com/shorts/qUqr2ewWD74?feature=share',
      video: 'https://youtube.com/shorts/qUqr2ewWD74?feature=share',
      bilibili: 'https://www.bilibili.com/video/BV1A14y1777Z/',
      sheet: 'https://mymusic5.com/cipmusic/341127',
    },
    matchedVideoTitle: '【钢琴】战歌起！Normal No More (附免费钢琴谱）',
  },
};
