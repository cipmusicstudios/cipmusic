/**
 * 人工锁定快照（静态、唯一来源）— 由仓库内已确认元数据固化，**不**在运行时从 legacy / TRACK_CANONICAL 派生。
 * 新纠错请只改本文件（或运行 scripts/generate-catalog-overrides-locked.ts 再手调）。
 *
 * 生成后请通过 npm run build 校验。
 */

import type { CatalogOverride } from './catalog-override-types';

export const CATALOG_OVERRIDES_BY_SLUG: Record<string, CatalogOverride> = {
  "5点23": {
    title: "5点23",
    displayTitle: "5点23",
    artist: "宋亚轩",
    artists: {
      zhHans: "宋亚轩",
      zhHant: "宋亞軒",
      en: "Song Yaxuan"
    },
    category: "华语流行",
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=ELYeig0W59g",
      video: "https://www.youtube.com/watch?v=ELYeig0W59g"
    }
  },
  Allergy: {
    artist: "I-DLE",
    artists: {
      zhHans: "I-DLE",
      zhHant: "I-DLE",
      en: "I-DLE"
    }
  },
  APT: {
    title: "APT.",
    displayTitle: "APT.",
    artist: "Rosé和Bruno Mars",
    artists: {
      zhHans: "Rosé和Bruno Mars",
      zhHant: "Rosé和Bruno Mars",
      en: "Rosé & Bruno Mars"
    },
    categoryTags: [
      "韩流流行"
    ],
    canonicalArtistId: "rose",
    coCanonicalArtistIds: [
      "bruno-mars"
    ],
    canonicalArtistDisplayName: "Rosé和Bruno Mars",
    artistReviewStatus: "ok"
  },
  "be mine": {
    artist: "INTO1",
    artists: {
      zhHans: "INTO1",
      zhHant: "INTO1",
      en: "INTO1"
    }
  },
  "birds-of-a-feather": {
    links: {
      youtube: "https://www.youtube.com/watch?v=fD6_gbvI1lg",
      video: "https://www.youtube.com/watch?v=fD6_gbvI1lg",
      sheet: "https://mymusic.st/cipmusic/278554"
    }
  },
  "Blue(zerobaseone)": {
    title: "Blue",
    displayTitle: "Blue",
    titles: {
      zhHans: "Blue",
      zhHant: "Blue",
      en: "Blue"
    },
    artist: "ZEROBASEONE",
    artists: {
      zhHans: "ZEROBASEONE",
      zhHant: "ZEROBASEONE",
      en: "ZEROBASEONE"
    },
    categoryTags: [
      "韩流流行"
    ],
    links: {
      sheet: "https://www.mymusic5.com/cipmusic/257776"
    }
  },
  "blue（刘耀文）": {
    title: "Blue",
    displayTitle: "Blue",
    titles: {
      zhHans: "Blue",
      zhHant: "Blue",
      en: "Blue"
    },
    artist: "刘耀文",
    artists: {
      zhHans: "刘耀文",
      zhHant: "劉耀文",
      en: "Liu Yaowen"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "Bridge over troubled water": {
    title: "Bridge over troubled water",
    displayTitle: "Bridge over troubled water",
    titles: {
      zhHans: "忧愁河上的金桥",
      zhHant: "憂愁河上的金橋",
      en: "Bridge Over Troubled Water"
    },
    artist: "Simon and Garfunkel",
    artists: {
      zhHans: "Simon and Garfunkel",
      zhHant: "Simon and Garfunkel",
      en: "Simon and Garfunkel"
    },
    links: {
      youtube: "https://www.youtube.com/watch?v=NMUIDV3m3zk",
      video: "https://www.youtube.com/watch?v=NMUIDV3m3zk"
    }
  },
  "Burn it all down": {
    title: "Burn it all down",
    displayTitle: "Burn it all down",
    titles: {
      zhHans: "不可阻挡",
      zhHant: "不可阻擋",
      en: "Burn It All Down"
    },
    artist: "英雄联盟",
    artists: {
      zhHans: "英雄联盟",
      zhHant: "英雄聯盟",
      en: "League of Legends"
    },
    workProjectKey: "league-of-legends",
    links: {
      youtube: "https://www.youtube.com/watch?v=JWbhkFJSz4E",
      video: "https://www.youtube.com/watch?v=JWbhkFJSz4E"
    }
  },
  "call of silence": {
    artist: "泽野弘之",
    artists: {
      zhHans: "泽野弘之",
      zhHant: "澤野弘之",
      en: "Hiroyuki Sawano"
    }
  },
  calling: {
    artist: "Metro Boomin",
    artists: {
      zhHans: "Metro Boomin",
      en: "Metro Boomin"
    }
  },
  candy: {
    coverUrl: "https://i.scdn.co/image/ab67616d0000b273bbcf5847ef8d115aa0f6f212"
  },
  "candy(svt)": {
    displayTitle: "Candy",
    artist: "SEVENTEEN",
    artists: {
      zhHans: "SEVENTEEN",
      en: "SEVENTEEN"
    }
  },
  "candy(twice)": {
    displayTitle: "Candy",
    artist: "TWICE",
    artists: {
      zhHans: "TWICE",
      en: "TWICE"
    }
  },
  celestial: {
    artist: "Ed Sheeran",
    artists: {
      zhHans: "艾德·希兰",
      zhHant: "艾德·希蘭",
      en: "Ed Sheeran"
    },
    categoryTags: [
      "欧美流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=XKVaCqB568E",
      video: "https://www.youtube.com/watch?v=XKVaCqB568E"
    },
    matchedVideoTitle: "Ed Sheeran & Pokémon - Celestial Piano Cover | CIP Music"
  },
  chains: {
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b273adcb3091457ba49bbc306275"
  },
  "could it be": {
    artist: "宋雨琦",
    artists: {
      zhHans: "宋雨琦",
      zhHant: "宋雨琦",
      en: "YUQI"
    },
    coverUrl: "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b27305176d244d705d78a92c3d02",
    canonicalArtistId: "i-dle",
    canonicalArtistDisplayName: "宋雨琦",
    artistReviewStatus: "ok"
  },
  "dancing-alone": {
    title: "Dancing Alone",
    displayTitle: "Dancing Alone",
    titles: {
      zhHans: "Dancing Alone",
      en: "DANCING ALONE"
    },
    artist: "KiiiKiii",
    artists: {
      zhHans: "KiiiKiii",
      zhHant: "KiiiKiii",
      en: "KiiiKiii"
    },
    categoryTags: [
      "韩流流行"
    ]
  },
  "dawn to dusk": {
    artist: "张艺兴",
    artists: {
      zhHans: "张艺兴",
      zhHant: "張藝興",
      en: "Lay Zhang"
    }
  },
  Fade: {
    title: "Faded",
    displayTitle: "Faded",
    titles: {
      en: "Faded"
    }
  },
  "dreams come true": {
    artist: "aespa",
    artists: {
      zhHans: "aespa",
      zhHant: "aespa",
      en: "aespa"
    },
    categoryTags: [
      "韩流流行"
    ],
    coverUrl: "https://i.scdn.co/image/ab67616d0000b2735b1ee39743c40b88a80b4ccf"
  },
  drive: {
    artist: "赵美延",
    artists: {
      zhHans: "赵美延",
      zhHant: "趙美延",
      en: "MIYEON"
    },
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b2739f253ee40c24e4742299ab16",
    canonicalArtistId: "i-dle",
    canonicalArtistDisplayName: "赵美延",
    artistReviewStatus: "ok"
  },
  "ei ei": {
    artist: "蔡徐坤",
    artists: {
      zhHans: "蔡徐坤",
      en: "KUN"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "empty love": {
    artist: "Lulleaux",
    artists: {
      zhHans: "Lulleaux",
      en: "Lulleaux"
    }
  },
  "eyes on me": {
    title: "Easy On Me",
    displayTitle: "Easy On Me",
    artist: "Adele",
    artists: {
      zhHans: "Adele",
      en: "Adele"
    }
  },
  /**
   * Supabase 行 `slug` 与下列键一致；manifest 不再含 Falling You（仅远端两条）。
   * 勿再增加第三条同标题混用 slug。
   */
  "Falling You（刘耀文）": {
    title: "Falling You",
    displayTitle: "Falling You",
    titles: {
      zhHans: "Falling You",
      zhHant: "Falling You",
      en: "Falling You"
    },
    coverUrl: "https://i.ytimg.com/vi/De-FuM4-G04/hqdefault.jpg",
    artist: "刘耀文",
    artists: {
      zhHans: "刘耀文",
      zhHant: "劉耀文",
      en: "Liu Yaowen"
    },
    canonicalArtistId: "liu-yao-wen",
    canonicalArtistDisplayName: "刘耀文",
    artistReviewStatus: "ok",
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=De-FuM4-G04",
      video: "https://www.youtube.com/watch?v=De-FuM4-G04",
      bilibili: "https://www.bilibili.com/video/BV1dF411L7SP",
      sheet: "https://mymusic.st/cipmusic/64427"
    },
    matchedVideoTitle: "TNT时代少年团 刘耀文《Falling You》钢琴版 Teens In Times Liu Yaowen Piano Cover | CIP Music"
  },
  "Falling You（都智文 曾可妮）": {
    title: "Falling You",
    displayTitle: "Falling You",
    titles: {
      zhHans: "Falling You",
      zhHant: "Falling You",
      en: "Falling You"
    },
    coverUrl:
      "https://i.scdn.co/image/ab67616d0000b273a3677ba94a4ad68ddc6f4563",
    artist: "都智文",
    artists: {
      zhHans: "都智文、曾可妮",
      zhHant: "都智文、曾可妮",
      en: "Bernard Du, Jenny Zeng"
    },
    canonicalArtistId: "du-zhi-wen",
    coCanonicalArtistIds: [
      "zeng-ke-ni"
    ],
    canonicalArtistDisplayName: "都智文、曾可妮",
    artistReviewStatus: "ok",
    categoryTags: [
      "华语流行",
      "影视"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=XNcEv7WXb8U",
      video: "https://www.youtube.com/watch?v=XNcEv7WXb8U",
      bilibili: "https://www.bilibili.com/video/BV1hg411H7dB",
      sheet: "https://mymusic.st/cipmusic/87942"
    },
    matchedVideoTitle: "Falling You - 曾可妮 Jenny Zeng & 都智文 Baby.J（点燃我，温暖你 电视剧OST）| CIP Music"
  },
  "fix me": {
    title: "Fix me",
    displayTitle: "Fix me",
    artist: "INTO1",
    artists: {
      zhHans: "INTO1",
      zhHant: "INTO1",
      en: "INTO1"
    }
  },
  "Forever 1": {
    titles: {
      zhHans: "Forever 1",
      zhHant: "Forever 1",
      en: "Girls' Generation — Forever 1"
    },
    artist: "Girls' Generation",
    artists: {
      zhHans: "少女时代",
      zhHant: "少女時代",
      en: "Girls' Generation"
    },
    categoryTags: [
      "韩流流行"
    ]
  },
  "forever-forever": {
    title: "恒星不忘",
    displayTitle: "恒星不忘",
    titles: {
      zhHans: "恒星不忘",
      zhHant: "恆星不忘",
      en: "Forever Forever"
    },
    artist: "周杰伦、F4、五月天",
    artists: {
      zhHans: "周杰伦、F4、五月天",
      zhHant: "周杰倫、F4、五月天",
      en: "Jay Chou, F4, Mayday"
    },
    canonicalArtistId: "jay-chou",
    coCanonicalArtistIds: [
      "f4",
      "mayday"
    ],
    canonicalArtistDisplayName: "周杰伦、F4、五月天",
    artistReviewStatus: "ok"
  },
  free: {
    artist: "HUNTR/X",
    artists: {
      zhHans: "HUNTR/X",
      zhHant: "HUNTR/X",
      en: "HUNTR/X"
    },
    categoryTags: [
      "韩流流行",
      "影视"
    ],
    workProjectKey: "kpop-demon-hunters"
  },
  Girlfriend: {
    artist: "I-DLE",
    artists: {
      zhHans: "I-DLE",
      zhHant: "I-DLE",
      en: "I-DLE"
    },
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b273dcda0178cb863ce4ded9481b"
  },
  girls: {
    artist: "aespa",
    artists: {
      zhHans: "aespa",
      zhHant: "aespa",
      en: "aespa"
    },
    category: "韩流流行",
    categoryTags: [
      "韩流流行"
    ],
    coverUrl: "https://img.youtube.com/vi/Rfv2kFBQ5hY/maxresdefault.jpg",
    links: {
      youtube: "https://www.youtube.com/watch?v=Rfv2kFBQ5hY",
      video: "https://www.youtube.com/watch?v=Rfv2kFBQ5hY",
      noSheet: true
    },
    matchedVideoTitle: "aespa 에스파 'Girls' Piano Cover | CIP Music"
  },
  Go: {
    links: {
      youtube: "https://www.youtube.com/watch?v=ozl5kzVTYvM",
      video: "https://www.youtube.com/watch?v=ozl5kzVTYvM"
    }
  },
  GODS: {
    workProjectKey: "league-of-legends"
  },
  golden: {
    workProjectKey: "kpop-demon-hunters"
  },
  "heavy is the crown": {
    categoryTags: [
      "欧美流行",
      "游戏"
    ],
    workProjectKey: "league-of-legends"
  },
  Hello: {
    title: "Hello",
    displayTitle: "Hello",
    titles: {
      zhHans: "Hello",
      zhHant: "Hello",
      en: "Hello"
    },
    artist: "THE9",
    artists: {
      zhHans: "THE9",
      zhHant: "THE9",
      en: "THE9"
    },
    category: "华语流行",
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=lXWDJVq0ZZs",
      video: "https://www.youtube.com/watch?v=lXWDJVq0ZZs",
      sheet: "https://www.mymusicsheet.com/cipmusic/38250"
    },
    matchedVideoTitle: "Hello - THE9 Piano Cover 钢琴版"
  },
  her: {
    artist: "Minnie",
    artists: {
      zhHans: "Minnie",
      zhHant: "Minnie",
      en: "Minnie"
    },
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b27351055be5de5e3767480cd529",
    canonicalArtistId: "i-dle",
    canonicalArtistDisplayName: "Minnie",
    artistReviewStatus: "ok"
  },
  heya: {
    title: "HEYA",
    displayTitle: "HEYA",
    artist: "IVE",
    artists: {
      zhHans: "IVE",
      zhHant: "IVE",
      en: "IVE"
    },
    category: "韩流流行",
    links: {
      noExternalVideo: true
    }
  },
  "Hola solar": {
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b273116fef0bd1cf6d9e801659cb"
  },
  HOME: {
    displayTitle: "HOME",
    artist: "王源",
    artists: {
      zhHans: "王源",
      en: "Roy Wang"
    }
  },
  "home sweet home": {
    displayTitle: "Home Sweet Home",
    artist: "G-DRAGON",
    artists: {
      zhHans: "权志龙",
      en: "G-DRAGON"
    },
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b2730c8549d4dad1c1e95f316736"
  },
  HOT: {
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b2731fc0f4faafaa183cc70297e5"
  },
  "How it's done": {
    workProjectKey: "kpop-demon-hunters"
  },
  INTO1: {
    artist: "INTO1",
    artists: {
      zhHans: "INTO1",
      zhHant: "INTO1",
      en: "INTO1"
    },
    links: {
      youtube: "https://www.youtube.com/watch?v=5rXo0iPaNww",
      video: "https://www.youtube.com/watch?v=5rXo0iPaNww"
    },
    matchedVideoTitle: "INTO1 Piano Cover - 创造营CHUANG2021 Debut Song - INTO1 钢琴"
  },
  "jump to the breeze": {
    categoryTags: [
      "日系流行",
      "游戏"
    ]
  },
  komorebi: {
    title: "Komorebi",
    displayTitle: "Komorebi",
    artist: "m-taku",
    artists: {
      zhHans: "m-taku",
      en: "m-taku"
    },
    category: "日韩流行",
    categoryTags: [
      "纯音乐"
    ],
    coverUrl: "https://img.youtube.com/vi/IpXoozpm_eg/hqdefault.jpg",
    links: {
      youtube: "https://www.youtube.com/watch?v=IpXoozpm_eg",
      video: "https://www.youtube.com/watch?v=IpXoozpm_eg",
      sheet: "https://mymusic.st/cipmusic/121517"
    },
    matchedVideoTitle: "m-taku 《Komorebi》(警笛版）“叶隙间洒落的阳光” Piano Cover | Piano by CIP Music"
  },
  "life's too short": {
    title: "Life's Too Short (English Version)",
    displayTitle: "Life's Too Short (English Version)",
    titles: {
      en: "Life's Too Short (English Version)",
      zhHans: "Life's Too Short (English Version)",
      zhHant: "Life's Too Short (English Version)"
    },
    artist: "aespa",
    artists: {
      zhHans: "aespa",
      zhHant: "aespa",
      en: "aespa"
    },
    categoryTags: [
      "韩流流行"
    ],
    coverUrl: "https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e02545fe4de74c3238f9cffc720"
  },
  Mantra: {},
  "masayume chasing": {
    links: {
      noSheet: true
    }
  },
  "Merry Christmas Mr.Lawrence": {
    title: "圣诞快乐，劳伦斯先生",
    displayTitle: "圣诞快乐，劳伦斯先生",
    titles: {
      zhHans: "圣诞快乐，劳伦斯先生",
      zhHant: "聖誕快樂，勞倫斯先生",
      en: "Merry Christmas, Mr. Lawrence"
    },
    artist: "坂本龙一",
    artists: {
      zhHans: "坂本龙一",
      zhHant: "坂本龍一",
      en: "Ryuichi Sakamoto"
    },
    category: "日韩流行",
    categoryTags: [
      "纯音乐",
      "影视"
    ],
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b27332dcf48f178d033db0c4b041",
    links: {
      youtube: "https://www.youtube.com/watch?v=QtzqbeDBQGI",
      video: "https://www.youtube.com/watch?v=QtzqbeDBQGI",
      sheet: "https://www.mymusic5.com/cipmusic/158001"
    },
    matchedVideoTitle: "Ryuichi Sakamoto - “Merry Christmas Mr. Lawrence” Piano Cover | Piano by CIP Music"
  },
  "mitsuha-theme": {
    title: "三叶的主题",
    displayTitle: "三叶的主题",
    titles: {
      zhHans: "《你的名字》三叶的主题",
      zhHant: "《你的名字》三葉的主題",
      en: "Mitsuha Theme"
    },
    artist: "RADWIMPS",
    artists: {
      zhHans: "RADWIMPS",
      zhHant: "RADWIMPS",
      en: "RADWIMPS"
    },
    links: {
      youtube: "https://www.youtube.com/watch?v=qEcFX7JOHBQ",
      video: "https://www.youtube.com/watch?v=qEcFX7JOHBQ",
      sheet: "https://mymusic.st/cipmusic/187940"
    }
  },
  Mono: {
    artist: "I-DLE",
    artists: {
      zhHans: "I-DLE",
      zhHant: "I-DLE",
      en: "I-DLE"
    }
  },
  "M八七": {
    artist: "米津玄师",
    artists: {
      zhHans: "米津玄师",
      zhHant: "米津玄師",
      en: "Kenshi Yonezu"
    },
    categoryTags: [
      "日系流行",
      "动漫"
    ]
  },
  "normal no more": {
    title: "Normal No More",
    displayTitle: "Normal No More",
    artist: "TYSM",
    artists: {
      zhHans: "TYSM",
      en: "TYSM"
    },
    categoryTags: [
      "欧美流行"
    ],
    coverUrl: "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273c538f32f862b9a5fe49502c4",
    links: {
      youtube: "https://youtube.com/shorts/qUqr2ewWD74?feature=share",
      video: "https://youtube.com/shorts/qUqr2ewWD74?feature=share",
      bilibili: "https://www.bilibili.com/video/BV1A14y1777Z/",
      sheet: "https://mymusic5.com/cipmusic/341127"
    },
    matchedVideoTitle: "【钢琴】战歌起！Normal No More (附免费钢琴谱）"
  },
  nxde: {
    artist: "I-DLE",
    artists: {
      zhHans: "I-DLE",
      zhHant: "I-DLE",
      en: "I-DLE"
    }
  },
  "pop star": {
    title: "POP/STARS",
    displayTitle: "POP/STARS",
    titles: {
      zhHans: "POP/STARS",
      zhHant: "POP/STARS",
      en: "POP/STARS"
    },
    artist: "K/DA",
    artists: {
      zhHans: "K/DA",
      zhHant: "K/DA",
      en: "K/DA"
    },
    category: "韩流流行",
    categoryTags: [
      "韩流流行",
      "游戏"
    ],
    workProjectKey: "league-of-legends",
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b2739703a4afd5c93a80bc13382b",
    links: {
      noSheet: true
    }
  },
  "queen card": {
    artist: "I-DLE",
    artists: {
      zhHans: "I-DLE",
      zhHant: "I-DLE",
      en: "I-DLE"
    }
  },
  Regression: {
    artist: "阿云嘎",
    artists: {
      zhHans: "阿云嘎",
      zhHant: "阿云嘎",
      en: "Ayanga"
    },
    categoryTags: [
      "华语流行",
      "游戏"
    ]
  },
  Sacrifice: {
    workProjectKey: "league-of-legends"
  },
  "see the light": {
    title: "See The Light",
    displayTitle: "See The Light",
    artist: "《现在拨打的电话》OST",
    artists: {
      zhHans: "《现在拨打的电话》OST",
      en: "When The Phone Rings OST"
    },
    categoryTags: [
      "影视",
      "韩语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=KYXB8Bl3XCA",
      video: "https://www.youtube.com/watch?v=KYXB8Bl3XCA"
    },
    matchedVideoTitle: "\"When The Phone Rings(지금 거신 전화는)\"OST - \"See The Light\" Piano Cover | Piano by CIP Music"
  },
  shine: {
    artist: "Kep1er",
    artists: {
      zhHans: "Kep1er",
      zhHant: "Kep1er",
      en: "Kep1er"
    },
    category: "韩流流行",
    categoryTags: [
      "韩流流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=krvKaVcFBEE",
      video: "https://www.youtube.com/watch?v=krvKaVcFBEE",
      bilibili: "https://www.bilibili.com/video/BV1yQ4y1i7U5/",
      sheet: "https://mymusic5.com/cipmusic/348048"
    },
    matchedVideoTitle: "Kep1er《Shine》钢琴完整版（附谱）| Piano by CIP Music"
  },
  shoot: {
    links: {
      youtube: "https://www.youtube.com/watch?v=qQ4BygxXbTE",
      video: "https://www.youtube.com/watch?v=qQ4BygxXbTE",
      noSheet: true
    },
    matchedVideoTitle: "Kep1er 케플러 《Shoot》 Piano Cover | Piano by CIP Music"
  },
  "Six Degrees": {
    artist: "周杰伦",
    artists: {
      zhHans: "周杰伦",
      zhHant: "周杰倫",
      en: "Jay Chou"
    }
  },
  "soda-pop": {
    workProjectKey: "kpop-demon-hunters",
    links: {
      youtube: "https://www.youtube.com/watch?v=bkgFKxWLrS0",
      video: "https://www.youtube.com/watch?v=bkgFKxWLrS0",
      sheet: "https://www.mymusicfive.com/cipmusic/310661"
    }
  },
  SPOT: {
    title: "SPOT!",
    displayTitle: "SPOT!",
    titles: {
      zhHans: "SPOT!",
      zhHant: "SPOT!",
      en: "SPOT!"
    },
    artist: "ZICO",
    artists: {
      zhHans: "ZICO",
      zhHant: "ZICO",
      en: "ZICO"
    },
    category: "韩流流行",
    categoryTags: [
      "韩流流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=xfqBQ2XhBCg",
      video: "https://www.youtube.com/watch?v=xfqBQ2XhBCg",
      noSheet: true
    },
    matchedVideoTitle: "ZICO (지코) 'SPOT! (feat. JENNIE)' Official MV"
  },
  "STAR WALKIN'": {
    titles: {
      zhHans: "逐星",
      zhHant: "逐星",
      en: "Star Walkin'"
    },
    artist: "Lil Nas X",
    artists: {
      zhHans: "Lil Nas X",
      zhHant: "Lil Nas X",
      en: "Lil Nas X"
    },
    categoryTags: [
      "欧美流行",
      "游戏"
    ],
    workProjectKey: "league-of-legends"
  },
  stay: {
    title: "STAY",
    displayTitle: "STAY (with Justin Bieber)",
    titles: {
      zhHans: "STAY (with Justin Bieber)",
      zhHant: "STAY (with Justin Bieber)",
      en: "STAY (with Justin Bieber)"
    },
    artist: "The Kid LAROI、Justin Bieber",
    artists: {
      zhHans: "The Kid LAROI、Justin Bieber",
      zhHant: "The Kid LAROI、Justin Bieber",
      en: "The Kid LAROI, Justin Bieber"
    },
    category: "欧美流行",
    categoryTags: [
      "欧美流行"
    ],
    coverUrl: "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273b4d59e6fa7e5e7cbc57ac33a",
    links: {
      youtube: "https://www.youtube.com/watch?v=F-ewK_t7Jpo",
      video: "https://www.youtube.com/watch?v=F-ewK_t7Jpo",
      bilibili: "https://www.bilibili.com/video/BV1zGdCBbEqW/",
      sheet: "https://www.mymusic5.com/cipmusic/376593"
    },
    matchedVideoTitle: "The Kid LAROI, Justin Bieber - STAY (Official Video)"
  },
  "stay with me": {
    categoryTags: [
      "韩流流行",
      "影视"
    ]
  },
  "still life": {
    title: "Still Life",
    displayTitle: "春夏秋冬",
    titles: {
      zhHans: "春夏秋冬",
      zhHant: "春夏秋冬",
      en: "Still Life"
    }
  },
  super: {
    artist: "SEVENTEEN",
    artists: {
      zhHans: "SEVENTEEN",
      zhHant: "SEVENTEEN",
      en: "SEVENTEEN"
    },
    categoryTags: [
      "韩流流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=VS0i_Bkol_I",
      video: "https://www.youtube.com/watch?v=VS0i_Bkol_I"
    },
    matchedVideoTitle: "SEVENTEEN (세븐틴) '손오공' (Super) Piano Cover | CIP Music"
  },
  "super shy": {
    artist: "NewJeans",
    artists: {
      zhHans: "NewJeans",
      zhHant: "NewJeans",
      en: "NewJeans"
    },
    categoryTags: [
      "韩流流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=YBskJoHUViQ",
      video: "https://www.youtube.com/watch?v=YBskJoHUViQ"
    },
    matchedVideoTitle: "NewJeans  뉴진스 《Super Shy》 Piano Cover | Piano by CIP Music"
  },
  swim: {
    links: {
      youtube: "https://www.youtube.com/watch?v=asWBvqMfeY0",
      video: "https://www.youtube.com/watch?v=asWBvqMfeY0",
      sheet: "https://mymusic5.com/cipmusic/369512"
    }
  },
  "take-down": {
    artist: "HUNTR/X",
    artists: {
      zhHans: "HUNTR/X",
      zhHant: "HUNTR/X",
      en: "HUNTR/X"
    },
    categoryTags: [
      "韩流流行",
      "影视"
    ],
    workProjectKey: "kpop-demon-hunters"
  },
  tomboy: {
    artist: "I-DLE",
    artists: {
      zhHans: "I-DLE",
      zhHant: "I-DLE",
      en: "I-DLE"
    }
  },
  "u+me=love": {
    title: "You+Me=Love",
    displayTitle: "You+Me=Love",
    titles: {
      zhHans: "You+Me=Love",
      zhHant: "You+Me=Love",
      en: "You+Me=Love"
    }
  },
  "who am i": {
    artist: "BRIGHT、WIN METAWIN、Dew Jirawat、Nani Hirunkit",
    artists: {
      zhHans: "BRIGHT、WIN METAWIN、Dew Jirawat、Nani Hirunkit",
      zhHant: "BRIGHT、WIN METAWIN、Dew Jirawat、Nani Hirunkit",
      en: "BRIGHT, WIN METAWIN, Dew Jirawat, Nani Hirunkit"
    },
    categoryTags: [
      "影视"
    ],
    coverUrl: "https://i.scdn.co/image/ab67616d0000b27300c593f93b5a263acaaec654"
  },
  Y: {
    title: "Y",
    displayTitle: "Y",
    artist: "严浩翔",
    artists: {
      zhHans: "严浩翔",
      zhHant: "嚴浩翔",
      en: "Yan Haoxiang"
    },
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=HelDzClk5X8",
      video: "https://www.youtube.com/watch?v=HelDzClk5X8"
    },
    matchedVideoTitle: "Y 钢琴版 TNT时代少年团 严浩翔 Teens In Times YanHaoxiang Y piano cover"
  },
  "yes ok": {
    artist: "THE9",
    artists: {
      zhHans: "THE9",
      zhHant: "THE9",
      en: "THE9"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "you-are-the-sun-in-my-life": {
    artist: "卢宛仪",
    artists: {
      zhHans: "卢宛仪",
      zhHant: "盧苑儀",
      en: "Lu Yuanyi"
    }
  },
  "your-idol": {
    workProjectKey: "kpop-demon-hunters"
  },
  zoo: {
    links: {
      youtube: "https://www.youtube.com/watch?v=qmv7jLQmKcw",
      video: "https://www.youtube.com/watch?v=qmv7jLQmKcw",
      sheet: "https://mymusic5.com/cipmusic/341127"
    }
  },
  "一杯火焰": {
    artist: "INTO1",
    artists: {
      zhHans: "INTO1",
      zhHant: "INTO1",
      en: "INTO1"
    },
    links: {
      youtube: "https://www.youtube.com/watch?v=_-dHnxQtwgI",
      video: "https://www.youtube.com/watch?v=_-dHnxQtwgI"
    },
    matchedVideoTitle: "INTO1《一杯火焰》钢琴版 INTO1 'Together Somewhere' Piano Cover | CIP Music"
  },
  "一路生花": {
    artist: "周深、张韶涵",
    artists: {
      zhHans: "周深、张韶涵",
      zhHant: "周深、張韶涵",
      en: "Zhou Shen, Angela Chang"
    },
    categoryTags: [
      "华语流行"
    ],
    canonicalArtistId: "zhou-shen",
    coCanonicalArtistIds: [
      "angela-szu-han-chang"
    ],
    canonicalArtistDisplayName: "周深、张韶涵",
    artistReviewStatus: "ok"
  },
  "上春山": {
    artist: "魏晨、魏大勋、白敬亭",
    artists: {
      zhHans: "魏晨、魏大勋、白敬亭",
      en: "Wei Chen, Wei Daxun, Bai Jingting"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "不冬眠": {
    artist: "刘耀文",
    artists: {
      zhHans: "刘耀文",
      zhHant: "劉耀文",
      en: "Liu Yaowen"
    },
    links: {
      youtube: "https://www.youtube.com/watch?v=7ZG9ddgw68s",
      video: "https://www.youtube.com/watch?v=7ZG9ddgw68s",
      bilibili: "https://www.bilibili.com/video/BV1a14y1A721/",
      sheet: "https://mymusic5.com/cipmusic/375227"
    },
    matchedVideoTitle: "【钢琴】时代少年团刘耀文《不冬眠》钢琴完整版（附谱）"
  },
  "不眠之夜": {
    titles: {
      en: "WHITE NIGHT"
    },
    artist: "张杰",
    artists: {
      zhHans: "张杰",
      zhHant: "張杰",
      en: "Jason Zhang"
    },
    workProjectKey: "honkai-star-rail",
    categoryTags: [
      "华语流行",
      "游戏"
    ]
  },
  "世界赠与我的": {
    title: "世界赠予我的",
    displayTitle: "世界赠予我的",
    titles: {
      zhHans: "世界赠予我的",
      zhHant: "世界贈予我的",
      en: "The World Gave Me"
    },
    artist: "王菲",
    artists: {
      zhHans: "王菲",
      zhHant: "王菲",
      en: "Faye Wong"
    },
    category: "华语流行",
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=1Jh0N1vPrpA",
      video: "https://www.youtube.com/watch?v=1Jh0N1vPrpA"
    }
  },
  "两个自己": {
    artist: "邓紫棋",
    artists: {
      zhHans: "邓紫棋",
      zhHant: "鄧紫棋",
      en: "G.E.M."
    }
  },
  "乘风": {
    artist: "乘风破浪的姐姐",
    artists: {
      zhHans: "乘风破浪的姐姐",
      zhHant: "乘风破浪的姐姐"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "于深空见证的": {
    titles: {
      en: "Witnessed By Deepspace"
    },
    artist: "张韶涵",
    artists: {
      zhHans: "张韶涵",
      zhHant: "張韶涵",
      en: "Angela Chang"
    },
    categoryTags: [
      "华语流行",
      "游戏"
    ],
    workProjectKey: "love-and-deepspace"
  },
  "云宫迅音": {
    title: "云宫迅音",
    displayTitle: "云宫迅音",
    titles: {
      en: "Celestial Symphony"
    },
    artist: "黑神话：悟空",
    artists: {
      zhHans: "黑神话：悟空",
      zhHant: "黑神话：悟空",
      en: "Black Myth: Wukong"
    },
    categoryTags: [
      "游戏"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=djFnKGRE0rQ",
      video: "https://www.youtube.com/watch?v=djFnKGRE0rQ"
    },
    matchedVideoTitle: "Black Myth: Wukong Celestial Symphony  Piano Cover《黑神话：悟空》版《云宫迅音》 钢琴版  | Piano by CIP Music"
  },
  "人之爱": {
    title: "人之爱",
    displayTitle: "人之爱",
    titles: {
      zhHans: "人之爱",
      zhHant: "人之愛"
    },
    links: {
      youtube: "https://www.youtube.com/watch?v=oNiNfJOFKwY",
      video: "https://www.youtube.com/watch?v=oNiNfJOFKwY",
      sheet: "https://mymusic5.com/cipmusic/346654"
    }
  },
  "以无旁骛之吻": {
    artist: "周深",
    artists: {
      zhHans: "周深",
      en: "Charlie Zhou Shen"
    },
    categoryTags: [
      "华语流行",
      "影视"
    ]
  },
  "余生请多指教": {
    title: "余生，请多指教",
    displayTitle: "余生，请多指教",
    titles: {
      zhHans: "余生，请多指教",
      zhHant: "餘生，請多指教",
      en: "The Oath of Love"
    },
    artist: "杨紫",
    artists: {
      zhHans: "杨紫、肖战",
      zhHant: "楊紫、肖戰",
      en: "Yang Zi, Xiao Zhan"
    },
    canonicalArtistId: "yang-zi",
    coCanonicalArtistIds: [
      "xiao-zhan"
    ],
    canonicalArtistDisplayName: "杨紫、肖战",
    artistReviewStatus: "ok",
    category: "华语流行",
    categoryTags: [
      "影视",
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=WG-VJHtcxeo",
      video: "https://www.youtube.com/watch?v=WG-VJHtcxeo",
      sheet: "https://www.mymusicsheet.com/cipmusic/43719"
    },
    matchedVideoTitle: "《余生，请多指教》钢琴版 杨紫&肖战 - The Oath Of Love OST Piano Cover Yang Zi & Xiao Zhan"
  },
  "你不属于我": {
    artist: "周兴哲",
    artists: {
      zhHans: "周兴哲",
      zhHant: "周興哲",
      en: "Eric Chou"
    },
    links: {
      youtube: "https://www.youtube.com/watch?v=pW2lrJceTzk",
      video: "https://www.youtube.com/watch?v=pW2lrJceTzk",
      noSheet: true
    },
    matchedVideoTitle: "你不属于我 (钢琴版)"
  },
  "你就不要想起我": {
    artist: "INTO1",
    artists: {
      zhHans: "INTO1",
      zhHant: "INTO1",
      en: "INTO1"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "你的名字是": {
    title: "你的名字是世界瞒着我最大的事情",
    displayTitle: "你的名字是世界瞒着我最大的事情",
    titles: {
      zhHans: "你的名字是世界瞒着我最大的事情",
      zhHant: "你的名字是世界瞞著我最大的事情",
      en: "My Miss Stranger"
    },
    matchedVideoTitle: "王源（TFBOYS）《你的名字是世界瞒着我最大的事情》钢琴版 TFBOYS Roy Wang My Miss Stranger Piano Cover"
  },
  "你眼里的光": {
    artist: "老番茄",
    artists: {
      zhHans: "老番茄",
      en: "Lao Fanqie"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "你离开的村落": {
    artist: "纸嫁衣",
    artists: {
      zhHans: "纸嫁衣",
      en: "Paper Bride"
    },
    categoryTags: [
      "游戏"
    ]
  },
  "信念之光": {
    artist: "《特利迦奥特曼》",
    artists: {
      zhHans: "《特利迦奥特曼》",
      en: "Ultraman Trigger"
    },
    categoryTags: [
      "动漫"
    ]
  },
  "借过一下": {
    artist: "周深",
    artists: {
      zhHans: "周深",
      en: "Charlie Zhou Shen"
    },
    links: {
      video: "https://www.youtube.com/watch?v=D-Z5fX0fL8k"
    }
  },
  "像晴天像雨天任性": {
    title: "像晴天像雨天任性",
    displayTitle: "像晴天像雨天任性",
    artist: "汪苏泷、五月天",
    artists: {
      zhHans: "汪苏泷、五月天",
      zhHant: "汪蘇瀧、五月天",
      en: "Silence Wang, Mayday"
    },
    canonicalArtistId: "silence-wang",
    coCanonicalArtistIds: [
      "mayday"
    ],
    canonicalArtistDisplayName: "汪苏泷、五月天",
    artistReviewStatus: "ok"
  },
  "在加纳共和国离婚": {
    canonicalArtistId: "zhang-bi-chen",
    coCanonicalArtistIds: [
      "review/yang-kun"
    ],
    canonicalArtistDisplayName: "张碧晨、杨坤",
    artistReviewStatus: "ok"
  },
  "光亮": {
    links: {
      sheet: "https://www.mymusic5.com/cipmusic/49061"
    }
  },
  "全世界在你身后": {
    artist: "都智文",
    artists: {
      zhHans: "都智文",
      zhHant: "都智文",
      en: "Bernard Du"
    },
    categoryTags: [
      "华语流行",
      "影视"
    ]
  },
  "冒险计划": {
    artist: "INTO1",
    artists: {
      zhHans: "INTO1",
      en: "INTO1"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "最幸运的幸运": {
    categoryTags: [
      "华语流行",
      "影视"
    ]
  },
  "决爱": {
    title: "诀爱",
    displayTitle: "诀爱",
    titles: {
      zhHans: "诀爱",
      zhHant: "訣愛"
    },
    links: {
      youtube: "https://www.youtube.com/watch?v=85rR7AxxMgs",
      video: "https://www.youtube.com/watch?v=85rR7AxxMgs",
      sheet: "https://mymusic.st/cipmusic/72615"
    },
    matchedVideoTitle: "诀爱 Burning Love - Faye 詹雯婷（苍兰诀OST）Drama Love Between Fairy And Devil OST Piano Cover  | CIP Music"
  },
  "勾指起誓": {
    artist: "洛天依",
    artists: {
      zhHans: "洛天依",
      en: "Luo Tianyi"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "古蜀回想": {
    artist: "INTO1",
    artists: {
      zhHans: "INTO1",
      en: "INTO1"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "只因你太美": {
    artist: "蔡徐坤",
    artists: {
      zhHans: "蔡徐坤",
      en: "KUN"
    },
    links: {
      bilibili: "https://www.bilibili.com/video/BV1Ax4y1M7fM/",
      noSheet: true
    },
    matchedVideoTitle: "【致郁系】《只因你太美》唯美忧伤韩剧风钢琴版"
  },
  "可": {
    artist: "张靓颖、薛之谦",
    artists: {
      zhHans: "张靓颖、薛之谦",
      zhHant: "張靚穎、薛之謙",
      en: "Jane Zhang, Joker Xue"
    },
    categoryTags: [
      "华语流行"
    ],
    canonicalArtistId: "zhang-liang-ying",
    coCanonicalArtistIds: [
      "joker-xue"
    ],
    canonicalArtistDisplayName: "张靓颖、薛之谦",
    artistReviewStatus: "ok"
  },
  "名场面": {
    title: "名场面",
    displayTitle: "名场面",
    titles: {
      zhHans: "名场面",
      zhHant: "名場面",
      en: "Famous Scene"
    },
    artist: "华晨宇",
    artists: {
      zhHans: "华晨宇",
      zhHant: "華晨宇",
      en: "Hua Chenyu"
    },
    category: "华语流行",
    categoryTags: [
      "华语流行",
      "游戏"
    ],
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b27358fec9c550daf90f7030f34b",
    links: {
      youtube: "https://www.youtube.com/watch?v=AI--uQ-dIIs",
      video: "https://www.youtube.com/watch?v=AI--uQ-dIIs",
      sheet: "https://mymusic.st/cipmusic/59893"
    },
    matchedVideoTitle: "华晨宇《名场面》钢琴版 「火星演唱会」十周年开场曲 「希忘Hope」- Famous Scene Piano Cover | Piano by CIP Music"
  },
  "向阳而生": {
    artist: "华晨宇",
    artists: {
      zhHans: "华晨宇",
      zhHant: "華晨宇",
      en: "Hua Chenyu"
    },
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=fipvke-Q5o4",
      video: "https://www.youtube.com/watch?v=fipvke-Q5o4",
      sheet: "https://mymusic.st/cipmusic/169723"
    },
    matchedVideoTitle: "华晨宇《向阳而生》钢琴版 Hua Chenyu 'Growing Toward the Sun' Piano Cover | Piano by CIP Music"
  },
  "向阳而生日出版": {
    artist: "华晨宇",
    artists: {
      zhHans: "华晨宇",
      zhHant: "華晨宇",
      en: "Hua Chenyu"
    },
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=slkIcIS-VaY",
      video: "https://www.youtube.com/watch?v=slkIcIS-VaY",
      sheet: "https://mymusic.st/cipmusic/169723"
    },
    matchedVideoTitle: "华晨宇 Hua Chenyu 《向阳而生》日出LIVE15分钟版 'Growing Toward the Sun' Piano Cover | Piano by CIP Music"
  },
  "听悲伤的情歌": {
    artist: "苏星婕",
    artists: {
      zhHans: "苏星婕",
      zhHant: "蘇星婕",
      en: "Su Xingjie"
    },
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=sHIwRpKPRFI",
      video: "https://www.youtube.com/watch?v=sHIwRpKPRFI"
    },
    matchedVideoTitle: "苏星婕 Su Xingjie 《听悲伤的情歌》钢琴版 Piano Cover | Piano by CIP Music"
  },
  "哈基米": {
    artist: "",
    artists: {
      zhHans: "",
      zhHant: "",
      en: ""
    },
    categoryTags: [
      "日系流行",
      "动漫"
    ]
  },
  "哪吒": {
    artist: "时代少年团",
    artists: {
      zhHans: "时代少年团",
      zhHant: "時代少年團",
      en: "Teens in Times"
    },
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=N5ne2BvRgQc",
      video: "https://www.youtube.com/watch?v=N5ne2BvRgQc",
      sheet: "https://www.mymusic5.com/cipmusic/49395"
    },
    matchedVideoTitle: "哪吒钢琴版 - TNT时代少年团 NeZha Piano Cover - Teens In Times"
  },
  "在意": {
    artist: "周深",
    artists: {
      zhHans: "周深",
      en: "Charlie Zhou Shen"
    },
    links: {
      noExternalVideo: true,
      noSheet: true
    }
  },
  "在故事的最终": {
    artist: "张碧晨",
    artists: {
      zhHans: "张碧晨",
      zhHant: "張碧晨",
      en: "Zhang Bichen"
    },
    categoryTags: [
      "影视",
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=PFGcLLaqGUo",
      video: "https://www.youtube.com/watch?v=PFGcLLaqGUo"
    },
    matchedVideoTitle: "《哪吒之魔童闹海》（NeZha 2）片尾曲 张碧晨（Zhang Bichen）《在故事的最终》钢琴版 Piano Cover | Piano by CIP Music"
  },
  "坏女孩": {
    artist: "徐良",
    artists: {
      zhHans: "徐良（feat. 小凌）",
      en: "Xu Liang feat. Xiao Ling"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "夜蝶": {
    artist: "SNH48",
    artists: {
      zhHans: "SNH48",
      en: "SNH48"
    },
    categoryTags: [
      "华语流行"
    ],
    coverUrl: "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273b61b44933400a00266bcaefe"
  },
  "天地龙鳞": {
    artist: "王力宏",
    artists: {
      zhHans: "王力宏",
      en: "Leehom Wang"
    },
    categoryTags: [
      "华语流行",
      "影视"
    ],
    links: {
      noSheet: true
    }
  },
  "太阳之子": {
    title: "太阳之子",
    displayTitle: "太阳之子",
    titles: {
      zhHans: "太阳之子",
      zhHant: "太陽之子",
      en: "Children of the Sun"
    },
    links: {
      youtube: "https://www.youtube.com/watch?v=K64y751to_s",
      video: "https://www.youtube.com/watch?v=K64y751to_s",
      sheet: "https://mymusic5.com/cipmusic/370339"
    }
  },
  "奇迹时刻": {
    artist: "周深",
    artists: {
      zhHans: "周深",
      zhHant: "周深",
      en: "Zhou Shen"
    },
    categoryTags: [
      "游戏",
      "华语流行"
    ],
    workProjectKey: "honor-of-kings"
  },
  "好好生活就是美好生活": {
    artist: "周深",
    artists: {
      zhHans: "周深",
      zhHant: "周深",
      en: "Zhou Shen"
    }
  },
  "好想我回来啊": {
    artist: "华晨宇",
    artists: {
      zhHans: "华晨宇",
      zhHant: "華晨宇",
      en: "Hua Chenyu"
    }
  },
  "如一": {
    artist: "任嘉伦",
    artists: {
      zhHans: "任嘉伦",
      en: "Allen Ren"
    },
    categoryTags: [
      "影视",
      "华语流行"
    ]
  },
  "如故": {
    artist: "张碧晨",
    artists: {
      zhHans: "张碧晨",
      zhHant: "張碧晨",
      en: "Zhang Bichen"
    },
    categoryTags: [
      "影视",
      "华语流行"
    ]
  },
  "姻缘": {
    artist: "Kep1er（Girls' Planet 999）",
    artists: {
      zhHans: "Kep1er（Girls' Planet 999）",
      en: "Kep1er (GP999)"
    },
    categoryTags: [
      "韩流流行"
    ],
    links: {
      noSheet: true
    }
  },
  "孤勇者": {
    artist: "陈奕迅",
    artists: {
      zhHans: "陈奕迅",
      zhHant: "陳奕迅",
      en: "Eason Chan"
    },
    categoryTags: [
      "华语流行"
    ],
    workProjectKey: "league-of-legends"
  },
  "寂静之忆": {
    artist: "希林娜依·高",
    artists: {
      zhHans: "希林娜依·高",
      zhHant: "希林娜依·高",
      en: "Curley Gao"
    },
    categoryTags: [
      "华语流行",
      "影视"
    ]
  },
  "小小": {
    artist: "容祖儿",
    artists: {
      zhHans: "容祖儿",
      zhHant: "容祖兒",
      en: "Joey Yung"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "就在江湖之上": {
    artist: "刘宇宁",
    artists: {
      zhHans: "刘宇宁",
      zhHant: "劉宇寧",
      en: "Liu Yuning"
    }
  },
  "就是哪吒": {
    artist: "唐汉霄",
    artists: {
      zhHans: "唐汉霄",
      zhHant: "唐漢霄",
      en: "Sean Tang"
    },
    categoryTags: [
      "影视",
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=v6uafKvOvYU",
      video: "https://www.youtube.com/watch?v=v6uafKvOvYU",
      sheet: "https://mymusic.st/cipmusic/250557"
    },
    matchedVideoTitle: "唐漢霄 SeanTang 《哪吒之魔童闹海》（NeZha 2）哪吒角色曲《就是哪吒》钢琴版 Piano Cover | Piano by CIP Music"
  },
  "希望有羽毛和翅膀": {
    titles: {
      en: "Hope is the thing with feathers"
    },
    coverUrl: "https://i.scdn.co/image/ab67616d0000b273cc68eea0db7110e3b8cca14e",
    artist: "知更鸟（Chevy）",
    artists: {
      zhHans: "知更鸟（Chevy）",
      zhHant: "知更鳥（Chevy）",
      en: "Chevy"
    },
    workProjectKey: "honkai-star-rail",
    categoryTags: [
      "游戏",
      "韩流流行"
    ]
  },
  "幻化成花": {
    titles: {
      en: "Hana ni Nare"
    },
    artist: "指田郁也",
    artists: {
      zhHans: "指田郁也",
      zhHant: "指田郁也",
      en: "Fumiya Sashida"
    }
  },
  "当我奔向你": {
    artist: "林晨阳",
    artists: {
      zhHans: "林晨阳",
      zhHant: "林晨陽",
      en: "Lin Chenyang"
    },
    categoryTags: [
      "影视",
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=zvESg9Or6FM",
      video: "https://www.youtube.com/watch?v=zvESg9Or6FM"
    },
    matchedVideoTitle: "林晨阳《当我飞奔向你》\"When I Fly Towards You\" 主题曲《当我奔向你》钢琴版  Piano Cover | Piano by CIP Music"
  },
  "彼岸": {
    artist: "井胧、井迪儿",
    artists: {
      zhHans: "井胧、井迪儿",
      zhHant: "井朧、井迪兒",
      en: "Jing Long, Jing Dier"
    }
  },
  "念": {
    artist: "刘宇宁",
    artists: {
      zhHans: "刘宇宁",
      zhHant: "劉宇寧",
      en: "Liu Yuning"
    },
    categoryTags: [
      "影视",
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=G6NBPSdbkrM",
      video: "https://www.youtube.com/watch?v=G6NBPSdbkrM"
    },
    matchedVideoTitle: "念 Rememberance 摩登兄弟刘宇宁 Liu Yuning 电影《古董局中局》主题曲  Schemes In Antiques Theme Song"
  },
  "念思雨": {
    artist: "鞠婧祎",
    artists: {
      zhHans: "鞠婧祎",
      zhHant: "鞠婧禕",
      en: "Ju Jingyi"
    },
    categoryTags: [
      "影视",
      "华语流行"
    ],
    links: {
      noSheet: true,
      youtube: "https://www.youtube.com/watch?v=nQJ6gQzCVIw",
      video: "https://www.youtube.com/watch?v=nQJ6gQzCVIw"
    },
    matchedVideoTitle: "《念思雨》钢琴 鞠婧祎 曾舜晞 《嘉南传》Missing the rain Piano Cover - 'Rebirth For You' OST - Kiku Ju & Joseph Zeng"
  },
  "思念便思念": {
    title: "若思念便思念",
    displayTitle: "若思念便思念",
    titles: {
      zhHans: "若思念便思念",
      zhHant: "若思念便思念",
      en: "If I Miss You, I Miss You"
    },
    artist: "周深",
    artists: {
      zhHans: "周深",
      zhHant: "周深",
      en: "Zhou Shen"
    }
  },
  "恋与深空主题曲": {
    titles: {
      en: "Love and Deep Space Theme Song"
    },
    artist: "莎拉布莱曼",
    artists: {
      zhHans: "莎拉布莱曼",
      zhHant: "莎拉布萊曼",
      en: "Sarah Brightman"
    },
    categoryTags: [
      "游戏"
    ],
    workProjectKey: "love-and-deepspace",
    links: {
      youtube: "https://www.youtube.com/watch?v=a4QyrJfM6Tg",
      video: "https://www.youtube.com/watch?v=a4QyrJfM6Tg"
    },
    matchedVideoTitle: "Sarah Brightman（莎拉·布莱曼） - Love and Deepspace《恋与深空》（戀與深空） Piano Cover | Piano by CIP Music"
  },
  "恋人": {
    title: "恋人",
    displayTitle: "恋人",
    titles: {
      zhHans: "恋人",
      zhHant: "戀人",
      en: "Lover"
    },
    artist: "李荣浩",
    artists: {
      zhHans: "李荣浩",
      zhHant: "李榮浩",
      en: "Li Ronghao"
    },
    category: "华语流行",
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=tB4Bmv-JjXA",
      video: "https://www.youtube.com/watch?v=tB4Bmv-JjXA",
      bilibili: "https://www.bilibili.com/video/BV1RPQhBrEQM/",
      sheet: "https://www.mymusic5.com/cipmusic/374985"
    },
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b27332dfecd9b32bd9c31a6d086e",
    listSortPublishedAtMs: 4000000000001
  },
  "悟": {
    artist: "张艺兴",
    artists: {
      zhHans: "张艺兴",
      zhHant: "張藝興",
      en: "Lay Zhang"
    },
    categoryTags: [
      "华语流行",
      "游戏"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=rmcDxQ8Ourg",
      video: "https://www.youtube.com/watch?v=rmcDxQ8Ourg"
    },
    matchedVideoTitle: "LAY (张艺兴/레이) - 悟(WU) 钢琴版  梦幻西游手游孙悟空角色曲 (Fantasy Westward Journey OST) | Piano Cover by CIP Music"
  },
  "想你的365天": {
    links: {
      noSheet: true
    }
  },
  "意气趁年少": {
    artist: "刘宇宁",
    artists: {
      zhHans: "刘宇宁",
      zhHant: "劉宇寧",
      en: "Liu Yuning"
    },
    categoryTags: [
      "华语流行",
      "影视"
    ]
  },
  "我们": {
    artist: "肖战",
    artists: {
      zhHans: "肖战",
      zhHant: "肖戰",
      en: "Xiao Zhan"
    },
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=4aTQn-0f84c",
      video: "https://www.youtube.com/watch?v=4aTQn-0f84c"
    },
    matchedVideoTitle: "肖战《我们》钢琴版 Xiao Zhan - ‘WM’ Piano Cover  | Piano by CIP Music"
  },
  "我们一起闯": {
    links: {
      youtube: "https://www.youtube.com/watch?v=vhJVbfek83k",
      video: "https://www.youtube.com/watch?v=vhJVbfek83k",
      sheet: "https://www.mymusicsheet.com/cipmusic/33758"
    },
    matchedVideoTitle: "CHUANG 2021 Theme Song\"Chuang To-Gather, Go!\" Piano Cover《我们一起闯》创造营2021主题曲 钢琴"
  },
  "我们啊": {
    artist: "THE9",
    artists: {
      zhHans: "THE9",
      zhHant: "THE9",
      en: "THE9"
    },
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=aTEx6Vn1TEY",
      video: "https://www.youtube.com/watch?v=aTEx6Vn1TEY"
    },
    matchedVideoTitle: "我们啊 钢琴版 THE9 毕业同名EP《THE NINE》Disband EP Piano Cover"
  },
  "我会等": {
    artist: "承桓",
    artists: {
      zhHans: "承桓",
      zhHant: "承桓",
      en: "Cheng Huan"
    },
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=cPn2K0mgmJ0",
      video: "https://www.youtube.com/watch?v=cPn2K0mgmJ0"
    },
    matchedVideoTitle: "承桓 《我会等》钢琴版 Piano Cover | Piano by CIP Music"
  },
  "我的舞台": {
    title: "我的舞台",
    displayTitle: "我的舞台",
    artist: "武星、任胤蓬",
    artists: {
      zhHans: "武星、任胤蓬",
      zhHant: "武星、任胤蓬",
      en: "Wu Xing, Ren Yinpeng"
    },
    categoryTags: [
      "华语流行"
    ],
    links: {
      bilibili: "https://www.bilibili.com/video/BV13K4y1n7nm/"
    },
    matchedVideoTitle: "《我的舞台》武星、任胤蓬（用户指定 Bilibili 片源）"
  },
  "才二十三": {
    titles: {
      en: "Twenty three"
    }
  },
  "抬起头啊": {
    title: "抬起头来",
    displayTitle: "抬起头来",
    titles: {
      zhHans: "抬起头来",
      zhHant: "抬起頭來"
    },
    artist: "时代少年团",
    artists: {
      zhHans: "时代少年团",
      zhHant: "時代少年團",
      en: "Teens in Times"
    },
    category: "华语流行",
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=xnU2ymYQmj4",
      video: "https://www.youtube.com/watch?v=xnU2ymYQmj4",
      sheet: "https://mymusic.st/cipmusic/97088"
    },
    matchedVideoTitle: "TNT时代少年团 马嘉祺 宋亚轩 张真源《抬起头来》钢琴版 Teens In Times Ma Jiaqi Song Yaxuan Zhang Zhenyuan Wish Piano Cover | CIP Music"
  },
  "摆脱地心引力": {
    title: "摆脱地心引力",
    displayTitle: "摆脱地心引力",
    titles: {
      zhHans: "摆脱地心引力",
      zhHant: "擺脫地心引力",
      en: "Escape Gravity"
    },
    artist: "时代少年团",
    artists: {
      zhHans: "时代少年团",
      zhHant: "時代少年團",
      en: "Teens in Times"
    },
    category: "华语流行",
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=bxtYrbUOQPM",
      video: "https://www.youtube.com/watch?v=bxtYrbUOQPM",
      bilibili: "https://www.bilibili.com/video/BV18jdvB9EA8",
      sheet: "https://www.mymusic5.com/cipmusic/376065"
    },
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b2738499af7b8c00639f6aed67fa",
    listSortPublishedAtMs: 4000000000002
  },
  "撒野": {
    artist: "凯瑟喵",
    artists: {
      zhHans: "凯瑟喵",
      en: "Kaiser"
    }
  },
  "敢问路在何方": {
    categoryTags: [
      "华语流行",
      "游戏"
    ]
  },
  "斗地主": {
    artist: "",
    artists: {
      zhHans: "",
      zhHant: "",
      en: ""
    },
    categoryTags: [
      "游戏"
    ]
  },
  "新宝岛": {
    titles: {
      en: "ShinTakarajima"
    },
    artist: "",
    artists: {
      zhHans: "",
      zhHant: "",
      en: ""
    },
    categoryTags: [
      "日系流行"
    ]
  },
  "新时代 冬奥运": {
    artist: "INTO1",
    artists: {
      zhHans: "INTO1",
      en: "INTO1"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "旅行": {
    artist: "TF家族三代（苏新皓、左航）",
    artists: {
      zhHans: "TF家族三代（苏新皓、左航）",
      zhHant: "TF家族三代（蘇新皓、左航）",
      en: "TF Family 3rd (Su Xinhao, Zuohang)"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "无人乐园": {
    artist: "王俊凯",
    artists: {
      zhHans: "王俊凯",
      zhHant: "王俊凱",
      en: "Karry Wang"
    },
    category: "华语流行",
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=2TcJqYwJhoQ",
      video: "https://www.youtube.com/watch?v=2TcJqYwJhoQ",
      sheet: "https://www.mymusic5.com/cipmusic/373321"
    },
    matchedVideoTitle: "王俊凯《无人乐园》钢琴版 Karry Wang Junkai - 'No One's Paradise' Piano Cover | Piano by CIP Music"
  },
  "无双的王者": {
    artist: "邓紫棋",
    artists: {
      zhHans: "邓紫棋",
      zhHant: "鄧紫棋",
      en: "G.E.M."
    },
    categoryTags: [
      "游戏",
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=9suY3gakE2o",
      video: "https://www.youtube.com/watch?v=9suY3gakE2o"
    },
    matchedVideoTitle: "《无双的王者 》钢琴版 鄧紫棋 - Peerless King Piano Cover G.E.M. - 王者荣耀2021世界冠军杯主题曲 Honor of Kings Theme Song",
    workProjectKey: "honor-of-kings"
  },
  "无羁": {
    artist: "王一博、肖战",
    artists: {
      zhHans: "王一博、肖战",
      en: "Wang Yibo, Xiao Zhan"
    },
    category: "华语流行",
    categoryTags: [
      "华语流行",
      "影视"
    ]
  },
  "时空引力": {
    title: "时空引力",
    displayTitle: "时空引力",
    titles: {
      en: "Gravity of Spacetime"
    },
    artist: "《恋与深空》",
    artists: {
      zhHans: "恋与深空",
      zhHant: "戀與深空",
      en: "Love and Deepspace"
    },
    categoryTags: [
      "游戏"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=wKoxdA188kE",
      video: "https://www.youtube.com/watch?v=wKoxdA188kE"
    },
    matchedVideoTitle: "时空引力 Gravity of Spacetime - Love and Deepspace《恋与深空》（戀與深空）抽卡BGM Piano Cover | Piano by CIP Music"
  },
  "时结": {
    artist: "周深",
    artists: {
      zhHans: "周深",
      zhHant: "周深",
      en: "Zhou Shen"
    },
    categoryTags: [
      "游戏",
      "华语流行"
    ],
    workProjectKey: "honor-of-kings"
  },
  "明天见": {
    title: "明天见",
    displayTitle: "明天见",
    artist: "TFBOYS",
    artists: {
      zhHans: "TFBOYS",
      zhHant: "TFBOYS",
      en: "TFBOYS"
    },
    links: {
      youtube: "https://www.youtube.com/watch?v=rMViS3qU7JI",
      video: "https://www.youtube.com/watch?v=rMViS3qU7JI",
      sheet: "https://www.mymusic5.com/cipmusic/120423"
    },
    matchedVideoTitle: "TFBOYS十周年新歌《明天见》 Piano Cover | Piano by CIP Music"
  },
  "明日坐标": {
    titles: {
      en: "Atlas of Tomorrow"
    },
    artist: "林俊杰",
    artists: {
      zhHans: "林俊杰",
      zhHant: "林俊傑",
      en: "JJ Lin"
    },
    categoryTags: [
      "游戏",
      "华语流行"
    ],
    workProjectKey: "honor-of-kings"
  },
  "明早老地方出发": {
    links: {
      youtube: "https://www.youtube.com/watch?v=Q6VHL6K_ttM",
      video: "https://www.youtube.com/watch?v=Q6VHL6K_ttM",
      sheet: "https://www.mymusicsheet.com/cipmusic/54089"
    },
    matchedVideoTitle: "INTO1 “See You” Piano《明早老地方，出发》钢琴版  | Piano Cover by CIP Music"
  },
  "星鱼": {
    categoryTags: [
      "华语流行",
      "影视"
    ]
  },
  "春天对花所做的事": {
    titles: {
      en: "Spring and Flowers"
    },
    artist: "恋与深空",
    artists: {
      zhHans: "恋与深空",
      zhHant: "戀與深空",
      en: "Love and Deepspace"
    },
    categoryTags: [
      "华语流行",
      "游戏"
    ]
  },
  "晨光里有你": {
    coverUrl: "https://i.scdn.co/image/ab67616d0000b2736572e8914c66d0254ac5f194"
  },
  "春雪": {
    artist: "周深、钟天利",
    artists: {
      zhHans: "周深、钟天利",
      en: "Zhou Shen, Terry Zhong"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "有你": {
    artist: "时代少年团",
    artists: {
      zhHans: "时代少年团",
      zhHant: "時代少年團",
      en: "Teens In Times"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "有梦好甜蜜": {
    artist: "胡彦斌",
    artists: {
      zhHans: "胡彦斌",
      zhHant: "胡彥斌",
      en: "Tiger Hu"
    },
    category: "华语流行",
    categoryTags: [
      "华语流行",
      "影视"
    ]
  },
  "朱雀": {
    artist: "时代少年团",
    artists: {
      zhHans: "时代少年团",
      zhHant: "時代少年團",
      en: "Teens In Times"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "来生戏": {
    artist: "纸嫁衣",
    artists: {
      zhHans: "纸嫁衣",
      zhHant: "紙嫁衣",
      en: "Paper Bride"
    },
    categoryTags: [
      "游戏"
    ]
  },
  "桃花诺": {
    artist: "周深、宋亚轩",
    artists: {
      zhHans: "周深、宋亚轩",
      zhHant: "周深、宋亞軒",
      en: "Zhou Shen, Song Yaxuan"
    },
    canonicalArtistId: "zhou-shen",
    coCanonicalArtistIds: [
      "song-ya-xuan"
    ],
    canonicalArtistDisplayName: "周深、宋亚轩",
    artistReviewStatus: "ok"
  },
  "水龙吟": {
    title: "水龙吟",
    displayTitle: "水龙吟",
    titles: {
      zhHans: "水龙吟",
      zhHant: "水龍吟",
      en: "Samudrartha (Shuilongyin)"
    },
    artist: "Kiryo",
    artists: {
      zhHans: "Kiryo",
      zhHant: "Kiryo",
      en: "Kiryo"
    },
    category: "日韩流行",
    categoryTags: [
      "游戏"
    ],
    workProjectKey: "honkai-star-rail",
    coverUrl: "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273c04a40debb1910dbea4969f8",
    canonicalArtistId: "honkai-star-rail",
    canonicalArtistDisplayName: "Kiryo",
    artistReviewStatus: "ok",
    links: {
      youtube: "https://www.youtube.com/watch?v=pHgEU0pvsyg",
      video: "https://www.youtube.com/watch?v=pHgEU0pvsyg",
      sheet: "https://mymusic.st/cipmusic/119426"
    },
    matchedVideoTitle: "Honkai: Star Rail EP:\"Samudrartha\"《崩坏：星穹铁道》EP 《水龙吟》Piano Cover | Piano by CIP Music"
  },
  "没出息": {
    artist: "“本来应该从从容容游刃有余”",
    artists: {
      zhHans: "“本来应该从从容容游刃有余”",
      zhHant: "“本來應該從從容容遊刃有餘”"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "泪桥": {
    artist: "伍佰",
    artists: {
      zhHans: "伍佰",
      zhHant: "伍佰",
      en: "Wu Bai"
    },
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=OmqQcKoeQzU",
      video: "https://www.youtube.com/watch?v=OmqQcKoeQzU"
    },
    matchedVideoTitle: "伍佰《泪桥》钢琴版 Wu Bai 'Tear Bridge' Piano Cover | Piano by CIP Music"
  },
  "洄": {
    artist: "王源",
    artists: {
      zhHans: "王源",
      en: "Roy Wang"
    },
    coverUrl: "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b2734d770944e1bdb664a4b350bf"
  },
  "流星雨": {
    artist: "F4",
    artists: {
      zhHans: "F4",
      zhHant: "F4",
      en: "F4"
    }
  },
  "浮光": {
    categoryTags: [
      "华语流行",
      "影视"
    ]
  },
  "渐暖": {
    artist: "时代少年团",
    artists: {
      zhHans: "时代少年团",
      zhHant: "時代少年團",
      en: "Teens In Times"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "温暖的房子": {},
  "溯": {
    artist: "胡梦周",
    artists: {
      zhHans: "胡梦周",
      en: "CORSAK"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "漠河舞厅": {
    links: {
      noSheet: true
    }
  },
  "灯火万家": {
    title: "灯火万家",
    displayTitle: "灯火万家",
    artist: "王赫野",
    artists: {
      zhHans: "王赫野",
      zhHant: "王赫野",
      en: "Wang Heye"
    },
    category: "华语流行",
    categoryTags: [
      "影视"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=lM6n8YPsXSI",
      video: "https://www.youtube.com/watch?v=lM6n8YPsXSI",
      sheet: "https://mymusic.st/cipmusic/117610"
    },
    matchedVideoTitle: "《我的人间烟火》OST《灯火万家》王赫野 钢琴版 | Piano Cover by CIP Music",
    coverUrl: "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273c289b8f87741a999f5b964e5"
  },
  "烟火星辰": {
    artist: "刘宇宁",
    artists: {
      zhHans: "刘宇宁",
      zhHant: "劉宇寧",
      en: "Liu Yuning"
    }
  },
  "烽月": {
    artist: "刘宇宁",
    artists: {
      zhHans: "刘宇宁",
      zhHant: "劉宇寧",
      en: "Liu Yuning"
    }
  },
  "爱丫爱丫": {
    artist: "BY2",
    artists: {
      zhHans: "BY2",
      zhHant: "BY2",
      en: "BY2"
    },
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=pKnPm3zaDpg",
      video: "https://www.youtube.com/watch?v=pKnPm3zaDpg"
    },
    matchedVideoTitle: "愛丫愛丫 钢琴版 By2 “爱我的话 给我回答” 抖音热门歌曲 Ai Ya Ai Ya Piano Cover By2 TikTok Hit Song | Piano by CIP Music"
  },
  "爱如火": {
    title: "爱如火",
    displayTitle: "爱如火",
    artist: "那艺娜",
    artists: {
      zhHans: "那艺娜",
      en: "Nayi Na"
    },
    links: {
      bilibili: "https://www.bilibili.com/video/BV14A41117BD/"
    }
  },
  "爱琴海": {
    title: "爱琴海",
    displayTitle: "爱琴海",
    titles: {
      zhHans: "爱琴海",
      zhHant: "愛琴海",
      en: "Aegean Sea"
    },
    artist: "周杰伦",
    artists: {
      zhHans: "周杰伦",
      zhHant: "周杰倫",
      en: "Jay Chou"
    },
    category: "华语流行",
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=BM8Fz49vLpg",
      video: "https://www.youtube.com/watch?v=BM8Fz49vLpg",
      bilibili: "https://www.bilibili.com/video/BV1C3DxBBEGX",
      sheet: "https://www.mymusic5.com/cipmusic/374036"
    },
    coverUrl: "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b2734ccab3d7484963c55e110586",
    listSortPublishedAtMs: 4000000000000
  },
  "爱错": {},
  "珠玉": {
    artist: "单依纯",
    artists: {
      zhHans: "单依纯",
      zhHant: "單依純",
      en: "Shan Yichun"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "登顶": {},
  "白话文": {
    artist: "INTO1刘宇",
    artists: {
      zhHans: "INTO1刘宇",
      zhHant: "INTO1劉宇",
      en: "INTO1 Liu Yu"
    },
    categoryTags: [
      "华语流行"
    ],
    coverUrl: "https://i.scdn.co/image/ab67616d0000b273663d33e72b48d7d0a615a617"
  },
  "相思莫负": {
    artist: "纸嫁衣",
    artists: {
      zhHans: "纸嫁衣",
      en: "Paper Bride"
    },
    categoryTags: [
      "游戏"
    ]
  },
  "相遇": {
    artist: "时代少年团",
    artists: {
      zhHans: "时代少年团",
      zhHant: "時代少年團",
      en: "Teens in Times"
    },
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=y7GSUJunFPc",
      video: "https://www.youtube.com/watch?v=y7GSUJunFPc"
    },
    matchedVideoTitle: "TNT时代少年团《相遇》钢琴版 - 'Me Before You' Piano Cover Teens In Times | Piano Cover by CIP Music"
  },
  "相遇的意义": {
    artist: "SEVENTEEN",
    artists: {
      zhHans: "SEVENTEEN",
      zhHant: "SEVENTEEN",
      en: "SEVENTEEN"
    },
    categoryTags: [
      "韩流流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=_S6-U1V5uE0",
      video: "https://www.youtube.com/watch?v=_S6-U1V5uE0"
    },
    matchedVideoTitle: "SEVENTEEN 세븐틴《相遇的意义》 (The meaning of meeting / 만남의 의미)  Piano Cover | Piano by CIP Music"
  },
  "科目三": {
    artist: "一笑江湖",
    artists: {
      zhHans: "一笑江湖（《一笑江湖》）",
      en: "Yi Xiao Jiang Hu"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "童话镇": {
    artist: "小野来了",
    artists: {
      zhHans: "小野来了",
      zhHant: "小野来了",
      en: "Xiao Ye Lai Le"
    }
  },
  "笨小孩的道歉信": {
    artist: "TF家族三代",
    artists: {
      zhHans: "TF家族三代",
      zhHant: "TF家族三代",
      en: "TF Family 3rd"
    }
  },
  "笼": {
    artist: "张碧晨",
    artists: {
      zhHans: "张碧晨",
      zhHant: "張碧晨",
      en: "Zhang Bichen"
    },
    categoryTags: [
      "影视",
      "华语流行"
    ]
  },
  "等你的回答": {
    artist: "TF家族三代",
    artists: {
      zhHans: "TF家族三代",
      zhHant: "TF家族三代",
      en: "TF Family 3rd"
    }
  },
  "约定之初": {
    coverUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRhr0zyQmLm0SW_2RbKiB1r_c9HzFybApT72Q&s",
    artist: "光与夜之恋",
    artists: {
      zhHans: "光与夜之恋",
      en: "Light and Night"
    },
    categoryTags: [
      "游戏"
    ]
  },
  "经过": {
    titles: {
      en: "Passing By"
    },
    artist: "张杰",
    artists: {
      zhHans: "张杰",
      zhHant: "張杰",
      en: "Jason Zhang"
    },
    categoryTags: [
      "游戏",
      "华语流行"
    ],
    workProjectKey: "genshin-impact",
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b2735e0708ac188de6ab857bc6ee"
  },
  "续写": {
    artist: "单依纯",
    artists: {
      zhHans: "单依纯",
      zhHant: "單依純",
      en: "Shan Yichun"
    },
    categoryTags: [
      "影视",
      "华语流行"
    ]
  },
  "芥": {
    artist: "丁程鑫",
    artists: {
      zhHans: "丁程鑫",
      zhHant: "丁程鑫",
      en: "Ding Chengxin"
    },
    categoryTags: [
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=PocM0dFQcXg",
      video: "https://www.youtube.com/watch?v=PocM0dFQcXg"
    },
    matchedVideoTitle: "时代少年团 丁程鑫《芥》钢琴版 Teens In Times(TNT) Ding ChengXin - “Reach for the light” Piano Cover"
  },
  "花西子": {
    artist: "周深",
    artists: {
      zhHans: "周深",
      zhHant: "周深",
      en: "Zhou Shen"
    }
  },
  "若仙": {
    artist: "周深",
    artists: {
      zhHans: "周深",
      zhHant: "周深",
      en: "Charlie Zhou Shen"
    },
    links: {
      video: "https://www.youtube.com/watch?v=0hK9R3HkFNc"
    }
  },
  "荣耀同行": {
    artist: "王者荣耀",
    artists: {
      zhHans: "王者荣耀",
      en: "Honor of Kings"
    },
    categoryTags: [
      "游戏"
    ],
    workProjectKey: "honor-of-kings"
  },
  "莫离": {
    artist: "鞠婧祎",
    artists: {
      zhHans: "鞠婧祎",
      zhHant: "鞠婧禕",
      en: "Ju Jingyi"
    },
    categoryTags: [
      "影视",
      "华语流行"
    ],
    links: {
      noSheet: true
    }
  },
  "菩萨蛮": {
    artist: "姚贝娜",
    artists: {
      zhHans: "姚贝娜",
      zhHant: "姚貝娜",
      en: "Bella Yao"
    },
    categoryTags: [
      "影视",
      "华语流行"
    ]
  },
  "蜉蝣": {
    artist: "马嘉祺",
    artists: {
      zhHans: "马嘉祺",
      en: "Ma Jiaqi"
    },
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b27346c8143c4fc22a5005559114"
  },
  "觅境": {},
  "诀爱": {
    categoryTags: [
      "华语流行",
      "影视"
    ]
  },
  "调查中": {
    artist: "周深、胡梦周",
    artists: {
      zhHans: "周深、胡梦周",
      en: "Zhou Shen, CORSAK"
    },
    categoryTags: [
      "华语流行",
      "影视"
    ]
  },
  "起风了": {
    artist: "高桥优",
    artists: {
      zhHans: "高桥优",
      zhHant: "高橋優",
      en: "Yu Takahashi (Takahiro)"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "输入法打可爱按第五": {
    artist: "创造营2021",
    artists: {
      zhHans: "创造营2021",
      en: "CHUANG 2021"
    }
  },
  "还在流浪": {
    links: {
      youtube: "https://www.youtube.com/watch?v=mpW_hWs47EI",
      video: "https://www.youtube.com/watch?v=mpW_hWs47EI",
      sheet: "https://mymusic.st/cipmusic/70317"
    },
    matchedVideoTitle: "周杰倫 Jay Chou ’還在流浪 Still Wandering‘ 鋼琴版 Piano Cover | Piano by CIP Music"
  },
  "这么可爱真是抱歉": {
    titles: {
      en: "Kawaikute Gomen"
    },
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b2735ab8edf3cacc736fd4a62c63",
    links: {
      youtube: "https://www.youtube.com/watch?v=xAOin7atTRE",
      video: "https://www.youtube.com/watch?v=xAOin7atTRE",
      sheet: "https://mymusic.st/cipmusic/121021"
    },
    matchedVideoTitle: "HoneyWorks /（CV：早見沙織）\"可愛くてごめん\"《这么可爱真是抱歉》Piano Cover | Piano by CIP Music"
  },
  "这样很好": {
    titles: {
      en: "Isha's Song"
    },
    workProjectKey: "league-of-legends"
  },
  "曾经我也想过一了百了": {
    titles: {
      en: "Boku Ga Shinou To Omottanowa"
    }
  },
  "勿听": {
    titles: {
      en: "Listen Not"
    },
    categoryTags: [
      "华语流行",
      "游戏"
    ]
  },
  "轻涟": {
    titles: {
      en: "La vaguelette"
    },
    categoryTags: [
      "华语流行",
      "游戏"
    ]
  },
  "雨过后的风景": {
    titles: {
      en: "The Scenery After the Rain"
    }
  },
  "黑神话悟空主题曲": {
    titles: {
      en: "Black Myth: Wukong Theme Song"
    }
  },
  "都选c": {
    title: "都选C",
    displayTitle: "都选C",
    titles: {
      zhHans: "都选C",
      zhHant: "都選C",
      en: "Choose C"
    },
    artist: "缝纫机乐队",
    artists: {
      zhHans: "缝纫机乐队",
      zhHant: "縫紉機樂隊",
      en: "Sewing Machine Band"
    },
    category: "华语流行",
    categoryTags: [
      "影视"
    ],
    coverUrl: "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/0c/15/3f/0c153f4c-f6dd-b5cc-1b67-fc0056dcfff9/cover.jpg/600x600bb.jpg",
    links: {
      bilibili: "https://www.bilibili.com/video/BV1kv411e7kz/",
      noSheet: true
    },
    matchedVideoTitle: "《都选C》抒情版 - 电影《缝纫机乐队》插曲"
  },
  "铃芽之旅": {
    artist: "周深",
    artists: {
      zhHans: "周深",
      en: "Zhou Shen"
    },
    categoryTags: [
      "华语流行",
      "动漫"
    ]
  },
  "镌刻": {
    artist: "张碧晨",
    artists: {
      zhHans: "张碧晨",
      zhHant: "張碧晨",
      en: "Zhang Bichen"
    },
    categoryTags: [
      "影视",
      "华语流行"
    ]
  },
  "镜花水月": {},
  "除夕": {
    artist: "A-SOUL",
    artists: {
      zhHans: "A-SOUL",
      en: "A-SOUL"
    }
  },
  "陷入爱情": {
    artist: "希林娜依·高",
    artists: {
      zhHans: "希林娜依·高、INTO1 米卡",
      en: "Curley Gao, Mika (INTO1)"
    },
    categoryTags: [
      "影视",
      "华语流行"
    ]
  },
  "雪花": {
    categoryTags: [
      "华语流行",
      "影视"
    ]
  },
  "青山城下白素贞": {
    title: "青城山下白素贞",
    displayTitle: "青城山下白素贞",
    titles: {
      zhHans: "青城山下白素贞",
      zhHant: "青城山下白素貞"
    },
    artist: "鞠婧祎",
    artists: {
      zhHans: "鞠婧祎",
      zhHant: "鞠婧禕",
      en: "Ju Jingyi"
    },
    categoryTags: [
      "影视",
      "华语流行"
    ],
    links: {
      youtube: "https://www.youtube.com/watch?v=2p0HQNauGFg",
      video: "https://www.youtube.com/watch?v=2p0HQNauGFg"
    },
    matchedVideoTitle: "《青城山下白素贞》鞠婧祎 钢琴版《新白娘子传奇》插曲（前世今生）- The Legend of the White Snake OST Piano Cover - Kiku Ju Jingyi"
  },
  "青春赞歌": {
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b2736c498180e56f57e7d7bcdb86"
  },
  "音你心动": {
    artist: "王者荣耀",
    artists: {
      zhHans: "王者荣耀",
      en: "Honor of Kings"
    },
    categoryTags: [
      "游戏"
    ],
    workProjectKey: "honor-of-kings",
    coverUrl: "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273f98c845fbbb7ff194dbf68d0"
  },
  "another dream": {
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b273789aa2775dc8ee1fd589c65d"
  },
  "eyes for you": {
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b2733c2d1e7534cfa8829fc4b3e4"
  },
  "into the fire": {
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b273220f86132bf073b5e6563d56"
  },
  "shooting star": {
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b27305d8920de1d23339ef6a5e5d"
  },
  silence: {
    coverUrl: "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273eb83df068860d2654064f511"
  },
  "so sick": {
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b2739aeedbb4cb36e64f3ed65a3b"
  },
  "U&I": {
    title: "U&I",
    displayTitle: "U&I",
    titles: {
      zhHans: "U&I",
      zhHant: "U&I",
      en: "U&I"
    },
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b273559980e6399e8a46d104709d"
  },
  "你之于我": {
    coverUrl: "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b27353e34a05f14c0d4ca789d6ac"
  },
  "好想爱这个世界啊": {
    coverUrl: "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273ad8d753d177c8ea780bb7aeb"
  },
  "普通到不普通的人生": {
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b2736572e8914c66d0254ac5f194"
  },
  "耀眼的你": {
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b273c56eda7c053530c8dc4b0115"
  },
  "走，一起去看日出吧": {
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b2736affb0ce31b1ae9fdf2f7ca0"
  },
  "1.1": {
    title: "1.1",
    displayTitle: "1.1",
    titles: {
      zhHans: "1.1",
      zhHant: "1.1",
      en: "1.1"
    }
  },
  "5.20am": {
    title: "5:20AM",
    displayTitle: "5:20AM",
    titles: {
      zhHans: "5:20AM",
      zhHant: "5:20AM",
      en: "5:20AM"
    }
  },
  "cure for me": {
    artist: "AURORA",
    artists: {
      zhHans: "AURORA",
      zhHant: "AURORA",
      en: "AURORA"
    },
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b2733e0d05346299e86c58f75123",
    canonicalArtistId: "aurora",
    canonicalArtistDisplayName: "AURORA",
    artistReviewStatus: "ok"
  },
  "of course": {
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b273559980e6399e8a46d104709d"
  },
  willow: {
    title: "Willow",
    displayTitle: "Willow",
    titles: {
      zhHans: "Willow",
      zhHant: "Willow",
      en: "Willow"
    }
  },
  "热爱105度的你": {
    title: "热爱105°C的你",
    displayTitle: "热爱105°C的你",
    titles: {
      zhHans: "热爱105°C的你",
      zhHant: "熱愛105°C的你",
      en: "Re Ai 105°C De Ni"
    },
    coverUrl: "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b2735ad385b1d970cd88397f8eb4"
  },
  "所念皆星河": {
    artist: "CMJ",
    artists: {
      zhHans: "CMJ",
      zhHant: "CMJ",
      en: "CMJ"
    },
    canonicalArtistId: "cmj",
    canonicalArtistDisplayName: "CMJ",
    artistReviewStatus: "ok"
  },
  "练习曲": {
    coverUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b273559980e6399e8a46d104709d"
  },
  "飞天": {
    artist: "张艺兴",
    artists: {
      zhHans: "张艺兴",
      zhHant: "張藝興",
      en: "Lay Zhang"
    },
    categoryTags: [
      "华语流行"
    ]
  },
  "鸳鸯债": {
    artist: "纸嫁衣",
    artists: {
      zhHans: "纸嫁衣",
      en: "Paper Bride"
    },
    categoryTags: [
      "游戏"
    ]
  },
};

export const CATALOG_OVERRIDES_BY_TRACK_ID: Record<string, CatalogOverride> = {
  "08d4ba85-3267-46c6-8ff2-47e43ea5135f": {
    canonicalArtistId: "yang-zi",
    coCanonicalArtistIds: [
      "xiao-zhan"
    ],
    canonicalArtistDisplayName: "杨紫、肖战",
    artistReviewStatus: "ok",
    artists: {
      zhHans: "杨紫、肖战",
      zhHant: "楊紫、肖戰",
      en: "Yang Zi, Xiao Zhan"
    }
  },
  "0afae8ea-d7d9-4578-ab8f-91376d41e605": {
    coverUrl: "https://i.scdn.co/image/ab67616d0000b2736572e8914c66d0254ac5f194"
  },
  "67b3b15b-648d-41ab-ada6-2f66233fda64": {
    canonicalArtistId: "zhou-shen",
    coCanonicalArtistIds: [
      "song-ya-xuan"
    ],
    canonicalArtistDisplayName: "周深、宋亚轩",
    artistReviewStatus: "ok",
    artists: {
      zhHans: "周深、宋亚轩",
      zhHant: "周深、宋亞軒",
      en: "Zhou Shen, Song Yaxuan"
    }
  },
  "25349319-a16a-4628-900f-db645bfcc630": {
    canonicalArtistId: "rose",
    artistReviewStatus: "ok"
  },
  "312afe3d-ee3c-4a6c-829a-85b05d9a1c9a": {
    canonicalArtistId: "hearts2hearts",
    artistReviewStatus: "ok"
  },
  "66c8d624-fa20-45b6-84e2-8dbae7a0b5e8": {
    canonicalArtistId: "kiiikiii",
    artistReviewStatus: "ok"
  },
  "671d8dce-5f47-4d69-8891-5b3763d10d43": {
    canonicalArtistId: "wang-yi-bo",
    coCanonicalArtistIds: [
      "xiao-zhan"
    ],
    canonicalArtistDisplayName: "王一博、肖战",
    artistReviewStatus: "ok"
  },
  "7087d95a-e7dc-498b-b70a-580fdfdb935e": {
    canonicalArtistId: "kiiikiii",
    artistReviewStatus: "ok"
  },
  "725e0fea-983b-459f-b027-104aaf0bacb7": {
    canonicalArtistId: "lil-nas-x",
    canonicalArtistDisplayName: "Lil Nas X",
    artistReviewStatus: "ok"
  },
  "86934514-6ca8-41c2-bee0-e2a600d906de": {
    canonicalArtistId: "review/meme-no-vocal",
    canonicalArtistDisplayName: "（无原唱）",
    artistReviewStatus: "unknown"
  },
  "ad55d05d-c0cb-46fc-89b8-5f779540874d": {
    canonicalArtistId: "eason-chan",
    canonicalArtistDisplayName: "陈奕迅",
    artistReviewStatus: "ok"
  },
  "bca4dd1b-8dcd-44ba-9b49-e0523faa3b90": {
    canonicalArtistId: "kep1er",
    canonicalArtistDisplayName: "Kep1er",
    artistReviewStatus: "ok"
  },
  "da08d496-7d6a-4c9d-9a2c-b0e13050881f": {
    canonicalArtistId: "zerobaseone",
    artistReviewStatus: "ok"
  },
  "e17a0211-1411-4406-aadb-5d9235a268d0": {
    canonicalArtistId: "rose",
    coCanonicalArtistIds: [
      "bruno-mars"
    ],
    canonicalArtistDisplayName: "Rosé和Bruno Mars",
    artistReviewStatus: "ok"
  },
  "f32015b8-c2da-4d14-b341-9b93482f2d1e": {
    canonicalArtistId: "dou-dizhu-game",
    canonicalArtistDisplayName: "（无原唱）",
    artistReviewStatus: "ok"
  },
  local_APT: {
    canonicalArtistId: "rose",
    coCanonicalArtistIds: [
      "bruno-mars"
    ],
    canonicalArtistDisplayName: "Rosé和Bruno Mars",
    artistReviewStatus: "ok"
  },
  local_Burn_it_all_down: {
    canonicalArtistId: "league-of-legends",
    canonicalArtistDisplayName: "英雄联盟",
    artistReviewStatus: "ok"
  },
  local_bye_bye_bye: {
    canonicalArtistId: "nsync"
  },
  local_call_of_silence: {
    canonicalArtistId: "hiroyuki-sawano"
  },
  local_calling: {
    canonicalArtistId: "metro-boomin"
  },
  local_chains: {
    canonicalArtistId: "alpha-drive-one"
  },
  local_dawn_to_dusk: {
    canonicalArtistId: "lay-zhang",
    canonicalArtistDisplayName: "张艺兴",
    artistReviewStatus: "ok"
  },
  local_dreams_come_true: {
    canonicalArtistId: "aespa",
    artistReviewStatus: "ok"
  },
  local_empty_love: {
    canonicalArtistId: "lulleaux",
    canonicalArtistDisplayName: "Lulleaux",
    artistReviewStatus: "ok"
  },
  "local_Falling_You_刘耀文": {
    canonicalArtistId: "liu-yao-wen",
    canonicalArtistDisplayName: "刘耀文",
    artistReviewStatus: "ok",
    links: {
      youtube: "https://www.youtube.com/watch?v=De-FuM4-G04",
      video: "https://www.youtube.com/watch?v=De-FuM4-G04",
      bilibili: "https://www.bilibili.com/video/BV1dF411L7SP",
      sheet: "https://mymusic.st/cipmusic/64427"
    }
  },
  "local_Falling_You_都智文_曾可妮": {
    canonicalArtistId: "du-zhi-wen",
    coCanonicalArtistIds: [
      "zeng-ke-ni"
    ],
    canonicalArtistDisplayName: "都智文、曾可妮",
    artistReviewStatus: "ok",
    links: {
      youtube: "https://www.youtube.com/watch?v=XNcEv7WXb8U",
      video: "https://www.youtube.com/watch?v=XNcEv7WXb8U",
      bilibili: "https://www.bilibili.com/video/BV1hg411H7dB",
      sheet: "https://mymusic.st/cipmusic/87942"
    }
  },
  local_Forever_1: {
    canonicalArtistId: "girls-generation",
    artistReviewStatus: "ok"
  },
  local_forever_forever: {
    canonicalArtistId: "jay-chou",
    coCanonicalArtistIds: [
      "f4",
      "mayday"
    ],
    canonicalArtistDisplayName: "周杰伦、F4、五月天",
    artistReviewStatus: "ok"
  },
  local_free: {
    canonicalArtistId: "huntr-x"
  },
  local_girls: {
    canonicalArtistId: "aespa"
  },
  local_Lalisa: {
    canonicalArtistId: "lisa",
    artistReviewStatus: "ok"
  },
  "local_M八七": {
    canonicalArtistId: "kenshi-yonezu"
  },
  local_pop_star: {
    canonicalArtistId: "league-of-legends",
    canonicalArtistDisplayName: "K/DA",
    artistReviewStatus: "ok"
  },
  local_Regression: {
    canonicalArtistId: "ayunga",
    canonicalArtistDisplayName: "阿云嘎",
    artistReviewStatus: "ok"
  },
  local_Six_Degrees: {
    canonicalArtistId: "jay-chou"
  },
  local_snake: {
    canonicalArtistId: "kep1er",
    artistReviewStatus: "ok"
  },
  local_soda_pop: {
    canonicalArtistId: "saja-boys"
  },
  local_SPOT: {
    canonicalArtistId: "zico",
    coCanonicalArtistIds: [
      "jennie"
    ]
  },
  local_take_down: {
    canonicalArtistId: "huntr-x"
  },
  local_the_feels: {
    canonicalArtistId: "twice",
    artistReviewStatus: "ok"
  },
  local_Utopia: {
    canonicalArtistId: "kep1er",
    artistReviewStatus: "ok"
  },
  local_who_am_i: {
    canonicalArtistId: "review/f4-thailand-who-am-i-ost",
    canonicalArtistDisplayName: "BRIGHT、WIN METAWIN、Dew Jirawat、Nani Hirunkit",
    artistReviewStatus: "ok"
  },
  local_xoxo: {
    canonicalArtistId: "jeon-somi",
    artistReviewStatus: "ok"
  },
  local_your_idol: {
    canonicalArtistId: "saja-boys"
  },
  "local_一路生花": {
    canonicalArtistId: "zhou-shen",
    coCanonicalArtistIds: [
      "angela-szu-han-chang"
    ],
    canonicalArtistDisplayName: "周深、张韶涵"
  },
  "local_万里": {
    canonicalArtistId: "zhou-shen",
    canonicalArtistDisplayName: "周深",
    artistReviewStatus: "ok"
  },
  "local_上春山": {
    canonicalArtistId: "shang-chun-shan-trio"
  },
  "local_不眠之夜": {
    canonicalArtistId: "zhang-jie",
    canonicalArtistDisplayName: "张杰",
    artistReviewStatus: "ok"
  },
  "local_乘风": {
    canonicalArtistId: "review/chengfeng-theme-no-vocal",
    canonicalArtistDisplayName: "乘风破浪的姐姐",
    artistReviewStatus: "ok"
  },
  "local_余生请多指教": {
    canonicalArtistId: "yang-zi",
    coCanonicalArtistIds: [
      "xiao-zhan"
    ],
    canonicalArtistDisplayName: "杨紫、肖战",
    artistReviewStatus: "ok",
    artists: {
      zhHans: "杨紫、肖战",
      zhHant: "楊紫、肖戰",
      en: "Yang Zi, Xiao Zhan"
    }
  },
  "local_信念之光": {
    canonicalArtistId: "review/ultraman-trigger-belief-light",
    canonicalArtistDisplayName: "《特利迦奥特曼》信念之光",
    artistReviewStatus: "needsReview"
  },
  "local_像你这样的朋友": {
    canonicalArtistId: "0713-nan-tuan"
  },
  "local_像晴天像雨天任性": {
    canonicalArtistId: "silence-wang",
    coCanonicalArtistIds: [
      "mayday"
    ],
    canonicalArtistDisplayName: "汪苏泷、五月天",
    artistReviewStatus: "ok"
  },
  "local_全世界在你身后": {
    canonicalArtistId: "du-zhi-wen",
    canonicalArtistDisplayName: "都智文",
    artistReviewStatus: "ok"
  },
  "local_冒险计划": {
    canonicalArtistId: "into1"
  },
  "local_可": {
    canonicalArtistId: "zhang-liang-ying",
    coCanonicalArtistIds: [
      "joker-xue"
    ],
    canonicalArtistDisplayName: "张靓颖、薛之谦"
  },
  "local_哈基米": {
    canonicalArtistId: "review/meme-no-vocal",
    canonicalArtistDisplayName: "",
    artistReviewStatus: "unknown"
  },
  "local_在加纳共和国离婚": {
    canonicalArtistId: "zhang-bi-chen",
    coCanonicalArtistIds: [
      "review/yang-kun"
    ],
    canonicalArtistDisplayName: "张碧晨、杨坤",
    artistReviewStatus: "ok"
  },
  "local_坏女孩": {
    canonicalArtistId: "xu-liang"
  },
  "local_夜蝶": {
    canonicalArtistId: "snh48"
  },
  "local_天地龙鳞": {
    canonicalArtistId: "wang-lee-hom"
  },
  "local_奇迹时刻": {
    canonicalArtistId: "zhou-shen",
    canonicalArtistDisplayName: "周深",
    artistReviewStatus: "ok"
  },
  "local_好好生活就是美好生活": {
    canonicalArtistId: "zhou-shen",
    canonicalArtistDisplayName: "周深",
    artistReviewStatus: "ok"
  },
  "local_如一": {
    canonicalArtistId: "ren-jialun"
  },
  "local_如故": {
    canonicalArtistId: "zhang-bi-chen"
  },
  "local_姻缘": {
    canonicalArtistId: "kep1er"
  },
  "local_孤勇者": {
    canonicalArtistId: "eason-chan"
  },
  "local_小小": {
    canonicalArtistId: "joey-yung"
  },
  "local_希望有羽毛和翅膀": {
    canonicalArtistId: "chevy-robin",
    canonicalArtistDisplayName: "知更鸟（Chevy）",
    artistReviewStatus: "ok"
  },
  "local_幻化成花": {
    canonicalArtistId: "fumiya-sashida"
  },
  "local_彩虹的微笑": {
    canonicalArtistId: "wang-xin-ling"
  },
  "local_彼岸": {
    canonicalArtistId: "jing-long-jing-dier"
  },
  "local_恋与深空主题曲": {
    canonicalArtistId: "sarah-brightman",
    canonicalArtistDisplayName: "莎拉布莱曼",
    artistReviewStatus: "ok"
  },
  "local_悟": {
    canonicalArtistId: "lay-zhang"
  },
  "local_我的舞台": {
    canonicalArtistId: "review/local-wodewutai-wuxing-ren",
    canonicalArtistDisplayName: "武星、任胤蓬",
    artistReviewStatus: "ok"
  },
  "local_撒野": {
    canonicalArtistId: "kai-se-miao"
  },
  "local_斗地主": {
    canonicalArtistId: "dou-dizhu-game"
  },
  "local_新宝岛": {
    canonicalArtistId: "review/local-xinbaodao-no-vocal",
    canonicalArtistDisplayName: "",
    artistReviewStatus: "unknown"
  },
  "local_旅行": {
    canonicalArtistId: "tf-family-3rd",
    canonicalArtistDisplayName: "TF家族三代（苏新皓、左航）"
  },
  "local_无双的王者": {
    canonicalArtistId: "gem",
    canonicalArtistDisplayName: "邓紫棋",
    artistReviewStatus: "ok"
  },
  "local_无羁": {
    canonicalArtistId: "wang-yi-bo",
    coCanonicalArtistIds: [
      "xiao-zhan"
    ],
    canonicalArtistDisplayName: "王一博、肖战"
  },
  "local_时空引力": {
    canonicalArtistId: "love-and-deepspace"
  },
  "local_时结": {
    canonicalArtistId: "zhou-shen",
    canonicalArtistDisplayName: "周深",
    artistReviewStatus: "ok"
  },
  "local_明日坐标": {
    canonicalArtistId: "jj-lin",
    canonicalArtistDisplayName: "林俊杰",
    artistReviewStatus: "ok"
  },
  "local_春天对花所做的事": {
    canonicalArtistId: "love-and-deepspace",
    canonicalArtistDisplayName: "恋与深空"
  },
  "local_春雪": {
    canonicalArtistId: "zhou-shen"
  },
  "local_有你": {
    canonicalArtistId: "tnt"
  },
  "local_有梦好甜蜜": {
    canonicalArtistId: "hu-yan-bin"
  },
  "local_朱雀": {
    canonicalArtistId: "tnt"
  },
  "local_来生戏": {
    canonicalArtistId: "paper-bride"
  },
  "local_桃花诺": {
    canonicalArtistId: "zhou-shen",
    coCanonicalArtistIds: [
      "song-ya-xuan"
    ],
    canonicalArtistDisplayName: "周深、宋亚轩",
    artistReviewStatus: "ok"
  },
  "local_没出息": {
    canonicalArtistId: "review/local-meichuxi-no-vocal",
    canonicalArtistDisplayName: "“本来应该从从容容游刃有余”",
    artistReviewStatus: "unknown"
  },
  "local_洄": {
    canonicalArtistId: "wang-yuan"
  },
  "local_流星雨": {
    canonicalArtistId: "f4",
    canonicalArtistDisplayName: "F4",
    artistReviewStatus: "ok"
  },
  "local_渐暖": {
    canonicalArtistId: "tnt"
  },
  "local_溯": {
    canonicalArtistId: "hu-meng-zhou"
  },
  "local_珠玉": {
    canonicalArtistId: "shan-yi-chun"
  },
  "local_白话文": {
    canonicalArtistId: "into1",
    canonicalArtistDisplayName: "INTO1刘宇",
    artistReviewStatus: "ok"
  },
  "local_科目三": {
    canonicalArtistId: "yixiao-jianghu"
  },
  "local_童话镇": {
    canonicalArtistId: "xiao-ye-lai-le"
  },
  "local_笨小孩的道歉信": {
    canonicalArtistId: "tf-family-3rd",
    canonicalArtistDisplayName: "TF家族三代",
    artistReviewStatus: "ok"
  },
  "local_笼": {
    canonicalArtistId: "zhang-bi-chen"
  },
  "local_等你的回答": {
    canonicalArtistId: "tf-family-3rd",
    canonicalArtistDisplayName: "TF家族三代",
    artistReviewStatus: "ok"
  },
  "local_经过": {
    canonicalArtistId: "zhang-jie"
  },
  "local_续写": {
    canonicalArtistId: "shan-yi-chun"
  },
  "local_芥": {
    canonicalArtistId: "ding-chengxin"
  },
  "local_花西子": {
    canonicalArtistId: "zhou-shen",
    canonicalArtistDisplayName: "周深",
    artistReviewStatus: "ok"
  },
  "local_莫离": {
    canonicalArtistId: "ju-jing-yi"
  },
  "local_菩萨蛮": {
    canonicalArtistId: "bella-yao"
  },
  "local_调查中": {
    canonicalArtistId: "zhou-shen",
    coCanonicalArtistIds: [
      "hu-meng-zhou"
    ],
    canonicalArtistDisplayName: "周深、胡梦周"
  },
  "local_起风了": {
    canonicalArtistId: "takahiro"
  },
  "local_铃芽之旅": {
    canonicalArtistId: "zhou-shen"
  },
  "local_镌刻": {
    canonicalArtistId: "zhang-bi-chen"
  },
  "local_陷入爱情": {
    canonicalArtistId: "curley-gao",
    canonicalArtistDisplayName: "希林娜依·高、INTO1 米卡"
  },
  "local_飞天": {
    canonicalArtistId: "lay-zhang"
  },
};
