export type NormalizedArtist = {
  id: string;
  names: {
    zhHans: string;
    zhHant?: string;
    en: string;
  };
  type: 'solo' | 'group' | 'project' | 'unknown';
  nationality: 'zh' | 'kr' | 'jp' | 'en' | 'other';
};

export const ARTIST_DICTIONARY: Record<string, NormalizedArtist> = {
  'tnt': { id: 'tnt', names: { zhHans: '时代少年团', zhHant: '時代少年團', en: 'Teens In Times' }, type: 'group', nationality: 'zh' },
  'ma-jia-qi': { id: 'ma-jia-qi', names: { zhHans: '马嘉祺', zhHant: '馬嘉祺', en: 'Ma Jiaqi' }, type: 'solo', nationality: 'zh' },
  'yan-hao-xiang': { id: 'yan-hao-xiang', names: { zhHans: '严浩翔', zhHant: '嚴浩翔', en: 'Yan Haoxiang' }, type: 'solo', nationality: 'zh' },
  'he-jun-lin': { id: 'he-jun-lin', names: { zhHans: '贺峻霖', zhHant: '賀峻霖', en: 'He Junlin' }, type: 'solo', nationality: 'zh' },
  'song-ya-xuan': { id: 'song-ya-xuan', names: { zhHans: '宋亚轩', zhHant: '宋亞軒', en: 'Song Yaxuan' }, type: 'solo', nationality: 'zh' },
  'liu-yao-wen': { id: 'liu-yao-wen', names: { zhHans: '刘耀文', zhHant: '劉耀文', en: 'Liu Yaowen' }, type: 'solo', nationality: 'zh' },
  'zhang-zhen-yuan': { id: 'zhang-zhen-yuan', names: { zhHans: '张真源', zhHant: '張真源', en: 'Zhang Zhenyuan' }, type: 'solo', nationality: 'zh' },
  'ding-chengxin': { id: 'ding-chengxin', names: { zhHans: '丁程鑫', zhHant: '丁程鑫', en: 'Ding Chengxin' }, type: 'solo', nationality: 'zh' },
  'tf-family-3rd': { id: 'tf-family-3rd', names: { zhHans: 'TF家族三代', zhHant: 'TF家族三代', en: 'TF Family 3rd Generation' }, type: 'group', nationality: 'zh' },

  'jay-chou': { id: 'jay-chou', names: { zhHans: '周杰伦', zhHant: '周杰倫', en: 'Jay Chou' }, type: 'solo', nationality: 'zh' },
  'mayday': { id: 'mayday', names: { zhHans: '五月天', zhHant: '五月天', en: 'Mayday' }, type: 'group', nationality: 'zh' },
  'jj-lin': { id: 'jj-lin', names: { zhHans: '林俊杰', zhHant: '林俊傑', en: 'JJ Lin' }, type: 'solo', nationality: 'zh' },
  'silence-wang': { id: 'silence-wang', names: { zhHans: '汪苏泷', zhHant: '汪蘇瀧', en: 'Silence Wang' }, type: 'solo', nationality: 'zh' },
  'zhou-shen': { id: 'zhou-shen', names: { zhHans: '周深', zhHant: '周深', en: 'Zhou Shen' }, type: 'solo', nationality: 'zh' },
  'faye-wong': { id: 'faye-wong', names: { zhHans: '王菲', zhHant: '王菲', en: 'Faye Wong' }, type: 'solo', nationality: 'zh' },
  'hua-chen-yu': { id: 'hua-chen-yu', names: { zhHans: '华晨宇', zhHant: '華晨宇', en: 'Hua Chenyu' }, type: 'solo', nationality: 'zh' },
  'joker-xue': { id: 'joker-xue', names: { zhHans: '薛之谦', zhHant: '薛之謙', en: 'Joker Xue' }, type: 'solo', nationality: 'zh' },
  'bella-yao': { id: 'bella-yao', names: { zhHans: '姚贝娜', zhHant: '姚貝娜', en: 'Bella Yao' }, type: 'solo', nationality: 'zh' },
  'li-jian': { id: 'li-jian', names: { zhHans: '李健', zhHant: '李健', en: 'Li Jian' }, type: 'solo', nationality: 'zh' },
  'liu-yu-ning': { id: 'liu-yu-ning', names: { zhHans: '刘宇宁', zhHant: '劉宇寧', en: 'Liu Yuning' }, type: 'solo', nationality: 'zh' },
  'gem': { id: 'gem', names: { zhHans: '邓紫棋', zhHant: '鄧紫棋', en: 'G.E.M.' }, type: 'solo', nationality: 'zh' },
  'stefanie-sun': { id: 'stefanie-sun', names: { zhHans: '孙燕姿', zhHant: '孫燕姿', en: 'Stefanie Sun' }, type: 'solo', nationality: 'zh' },
  'joey-yung': { id: 'joey-yung', names: { zhHans: '容祖儿', zhHant: '容祖兒', en: 'Joey Yung' }, type: 'solo', nationality: 'zh' },
  'wu-bai': { id: 'wu-bai', names: { zhHans: '伍佰', zhHant: '伍佰', en: 'Wu Bai' }, type: 'solo', nationality: 'zh' },
  'zhang-bi-chen': { id: 'zhang-bi-chen', names: { zhHans: '张碧晨', zhHant: '張碧晨', en: 'Zhang Bichen' }, type: 'solo', nationality: 'zh' },
  'angela-szu-han-chang': { id: 'angela-szu-han-chang', names: { zhHans: '张韶涵', zhHant: '張韶涵', en: 'Angela Chang' }, type: 'solo', nationality: 'zh' },

  'f4': { id: 'f4', names: { zhHans: 'F4', en: 'F4' }, type: 'group', nationality: 'zh' },
  'jerry-yan': { id: 'jerry-yan', names: { zhHans: '言承旭', en: 'Jerry Yan' }, type: 'solo', nationality: 'zh' },
  'vanness-wu': { id: 'vanness-wu', names: { zhHans: '吴建豪', zhHant: '吳建豪', en: 'Vanness Wu' }, type: 'solo', nationality: 'zh' },
  'vic-chou': { id: 'vic-chou', names: { zhHans: '周渝民', en: 'Vic Chou' }, type: 'solo', nationality: 'zh' },
  'ashin': { id: 'ashin', names: { zhHans: '阿信', en: 'Ashin' }, type: 'solo', nationality: 'zh' },
  'lay-zhang': { id: 'lay-zhang', names: { zhHans: '张艺兴', zhHant: '張藝興', en: 'Lay Zhang' }, type: 'solo', nationality: 'zh' },

  'chen-xue-ran': { id: 'chen-xue-ran', names: { zhHans: '陈雪燃', zhHant: '陳雪燃', en: 'Xueran Chen' }, type: 'solo', nationality: 'zh' },
  'chen-li': { id: 'chen-li', names: { zhHans: '陈粒', zhHant: '陳粒', en: 'Chen Li' }, type: 'solo', nationality: 'zh' },
  'dizzy-dizzo': { id: 'dizzy-dizzo', names: { zhHans: '蔡詩蕓', en: 'Dizzy Dizzo' }, type: 'solo', nationality: 'zh' },
  'shan-yi-chun': { id: 'shan-yi-chun', names: { zhHans: '单依纯', zhHant: '單依純', en: 'Shan Yichun' }, type: 'solo', nationality: 'zh' },
  /** Spotify 官方名为「盧苑儀」；简体常见「卢宛仪／卢苑仪」 */
  'lu-yuan-yi': { id: 'lu-yuan-yi', names: { zhHans: '卢宛仪', zhHant: '盧苑儀', en: 'Lu Yuanyi' }, type: 'solo', nationality: 'zh' },
  'zhang-yuan': { id: 'zhang-yuan', names: { zhHans: '张远', zhHant: '張遠', en: 'Zhang Yuan' }, type: 'solo', nationality: 'zh' },
  'zhao-lu-si': { id: 'zhao-lu-si', names: { zhHans: '赵露思', zhHant: '趙露思', en: 'Zhao Lusi' }, type: 'solo', nationality: 'zh' },
  'su-xing-jie': { id: 'su-xing-jie', names: { zhHans: '苏星婕', zhHant: '蘇星婕', en: 'Su Xingjie' }, type: 'solo', nationality: 'zh' },
  'zi-yu': { id: 'zi-yu', names: { zhHans: '梓渝', zhHant: '梓渝', en: 'Zi Yu' }, type: 'solo', nationality: 'zh' },
  'chen-xuan-xiao': { id: 'chen-xuan-xiao', names: { zhHans: '大泫', zhHant: '大泫', en: 'Da Xuan' }, type: 'solo', nationality: 'zh' },
  'lbi': { id: 'lbi', names: { zhHans: 'LBI利比', zhHant: 'LBI利比', en: 'LBI' }, type: 'solo', nationality: 'zh' },
  'wang-yan-wei': { id: 'wang-yan-wei', names: { zhHans: '王艳薇', zhHant: '王艷薇', en: 'Evangeline Wang' }, type: 'solo', nationality: 'zh' },
  'wang-he-ye': { id: 'wang-he-ye', names: { zhHans: '王赫野', zhHant: '王赫野', en: 'Wang Heye' }, type: 'solo', nationality: 'zh' },
  'feifei-princess': { id: 'feifei-princess', names: { zhHans: '菲菲公主', zhHant: '菲菲公主', en: 'Princess Feifei' }, type: 'solo', nationality: 'zh' },

  'kun': { id: 'kun', names: { zhHans: '蔡徐坤', zhHant: '蔡徐坤', en: 'KUN' }, type: 'solo', nationality: 'zh' },
  'zhang-hao': { id: 'zhang-hao', names: { zhHans: '章昊', zhHant: '章昊', en: 'Zhang Hao' }, type: 'solo', nationality: 'zh' },
  'bruno-mars': { id: 'bruno-mars', names: { zhHans: '布鲁诺·马尔斯', en: 'Bruno Mars' }, type: 'solo', nationality: 'en' },
  'seventeen': { id: 'seventeen', names: { zhHans: 'SEVENTEEN', en: 'SEVENTEEN' }, type: 'group', nationality: 'kr' },
  'eason-chan': { id: 'eason-chan', names: { zhHans: '陈奕迅', zhHant: '陳奕迅', en: 'Eason Chan' }, type: 'solo', nationality: 'zh' },

  // Korean
  'bts': { id: 'bts', names: { zhHans: '防弹少年团', zhHant: '防彈少年團', en: 'BTS' }, type: 'group', nationality: 'kr' },
  'blackpink': { id: 'blackpink', names: { zhHans: 'BLACKPINK', en: 'BLACKPINK' }, type: 'group', nationality: 'kr' },
  rose: { id: 'rose', names: { zhHans: 'Rosé', zhHant: 'Rosé', en: 'Rosé' }, type: 'solo', nationality: 'kr' },
  lisa: { id: 'lisa', names: { zhHans: 'Lisa', zhHant: 'Lisa', en: 'Lisa' }, type: 'solo', nationality: 'kr' },
  'lil-nas-x': { id: 'lil-nas-x', names: { zhHans: '利尔·纳斯·X', en: 'Lil Nas X' }, type: 'solo', nationality: 'en' },
  'aespa': { id: 'aespa', names: { zhHans: 'aespa', en: 'aespa' }, type: 'group', nationality: 'kr' },
  'ive': { id: 'ive', names: { zhHans: 'IVE', en: 'IVE' }, type: 'group', nationality: 'kr' },
  'illit': { id: 'illit', names: { zhHans: 'ILLIT', en: 'ILLIT' }, type: 'group', nationality: 'kr' },
  'i-dle': { id: 'i-dle', names: { zhHans: 'I-DLE', en: 'I-DLE' }, type: 'group', nationality: 'kr' },
  'le-sserafim': { id: 'le-sserafim', names: { zhHans: 'LE SSERAFIM', en: 'LE SSERAFIM' }, type: 'group', nationality: 'kr' },
  'tws': { id: 'tws', names: { zhHans: 'TWS', en: 'TWS' }, type: 'group', nationality: 'kr' },
  'zerobaseone': { id: 'zerobaseone', names: { zhHans: 'ZEROBASEONE', en: 'ZEROBASEONE' }, type: 'group', nationality: 'kr' },
  'boys-planet': { id: 'boys-planet', names: { zhHans: 'BOYS PLANET', en: 'BOYS PLANET' }, type: 'project', nationality: 'other' },
  'g-dragon': { id: 'g-dragon', names: { zhHans: '权志龙', zhHant: '權志龍', en: 'G-DRAGON' }, type: 'solo', nationality: 'kr' },
  'babymonster': { id: 'babymonster', names: { zhHans: 'BABYMONSTER', en: 'BABYMONSTER' }, type: 'group', nationality: 'kr' },
  'jennie': { id: 'jennie', names: { zhHans: 'JENNIE', en: 'JENNIE' }, type: 'solo', nationality: 'kr' },
  'itzy': { id: 'itzy', names: { zhHans: 'ITZY', en: 'ITZY' }, type: 'group', nationality: 'kr' },
  'newjeans': { id: 'newjeans', names: { zhHans: 'NewJeans', en: 'NewJeans' }, type: 'group', nationality: 'kr' },
  'kep1er': { id: 'kep1er', names: { zhHans: 'Kep1er', en: 'Kep1er' }, type: 'group', nationality: 'kr' },
  'triples': { id: 'triples', names: { zhHans: 'tripleS', en: 'tripleS' }, type: 'group', nationality: 'kr' },

  // Chinese Solo
  'mao-buyi': { id: 'mao-buyi', names: { zhHans: '毛不易', en: 'Mao Buyi' }, type: 'solo', nationality: 'zh' },
  'wang-lee-hom': { id: 'wang-lee-hom', names: { zhHans: '王力宏', en: 'Leehom Wang' }, type: 'solo', nationality: 'zh' },
  'karen-mok': { id: 'karen-mok', names: { zhHans: '莫文蔚', en: 'Karen Mok' }, type: 'solo', nationality: 'zh' },
  'khalil-fong': { id: 'khalil-fong', names: { zhHans: '方大同', en: 'Khalil Fong' }, type: 'solo', nationality: 'zh' },
  'wang-yi-bo': { id: 'wang-yi-bo', names: { zhHans: '王一博', en: 'Wang Yibo' }, type: 'solo', nationality: 'zh' },
  'sean-tang': { id: 'sean-tang', names: { zhHans: '唐汉霄', en: 'Sean Tang' }, type: 'solo', nationality: 'zh' },
  'patrick-brasca': { id: 'patrick-brasca', names: { zhHans: '派伟俊', en: 'Patrick Brasca' }, type: 'solo', nationality: 'zh' },
  'ding-yu-xi': { id: 'ding-yu-xi', names: { zhHans: '丁禹兮', en: 'Ding Yuxi' }, type: 'solo', nationality: 'zh' },
  'qiao-jun-cheng': { id: 'qiao-jun-cheng', names: { zhHans: '乔浚丞', en: 'Qiao Juncheng' }, type: 'solo', nationality: 'zh' },

  // Game / Projects / IP — 统一归到「其他/Other」桶（type='project' 永远 nationality='other'，
  // 与歌手/组合的国家分类彻底分开；详见 PROJECT-IP nationality rule）
  'love-and-deepspace': { id: 'love-and-deepspace', names: { zhHans: '恋与深空', zhHant: '戀與深空', en: 'Love and Deepspace' }, type: 'project', nationality: 'other' },
  'black-myth-wukong': { id: 'black-myth-wukong', names: { zhHans: '黑神话：悟空', en: 'Black Myth: Wukong' }, type: 'project', nationality: 'other' },
  'fairy-town': { id: 'fairy-town', names: { zhHans: '妖精之乡', en: 'Fairy Town' }, type: 'project', nationality: 'other' },
  'genshin-impact': { id: 'genshin-impact', names: { zhHans: '原神', en: 'Genshin Impact' }, type: 'project', nationality: 'other' },
  'honkai-star-rail': {
    id: 'honkai-star-rail',
    names: { zhHans: '崩坏：星穹铁道', en: 'Honkai: Star Rail' },
    type: 'project',
    nationality: 'other',
  },
  'honkai-impact-3': { id: 'honkai-impact-3', names: { zhHans: '崩坏3', en: 'Honkai Impact 3rd' }, type: 'project', nationality: 'other' },
  'honor-of-kings': { id: 'honor-of-kings', names: { zhHans: '王者荣耀', en: 'Honor of Kings' }, type: 'project', nationality: 'other' },
  'league-of-legends': {
    id: 'league-of-legends',
    names: { zhHans: '英雄联盟', zhHant: '英雄聯盟', en: 'League of Legends' },
    type: 'project',
    nationality: 'other',
  },
  'kpop-demon-hunters': {
    id: 'kpop-demon-hunters',
    names: { zhHans: 'KPop Demon Hunters', zhHant: 'KPop Demon Hunters', en: 'KPop Demon Hunters' },
    type: 'project',
    nationality: 'other',
  },
  /** 《崩坏：星穹铁道》知更鸟 / Chevy 演唱版本 */
  'chevy-robin': {
    id: 'chevy-robin',
    names: { zhHans: '知更鸟（Chevy）', zhHant: '知更鳥（Chevy）', en: 'Chevy' },
    type: 'solo',
    nationality: 'en',
  },
  'sarah-brightman': {
    id: 'sarah-brightman',
    names: { zhHans: '莎拉布莱曼', zhHant: '莎拉布萊曼', en: 'Sarah Brightman' },
    type: 'solo',
    nationality: 'en',
  },
  /** feat. 仅作共演展示，不单独出现在艺人网格（见 shouldShowArtistOnArtistPage：review/ 隐藏） */
  'review/yang-kun': {
    id: 'review/yang-kun',
    names: { zhHans: '杨坤', zhHant: '楊坤', en: 'Yang Kun' },
    type: 'solo',
    nationality: 'zh',
  },
  lulleaux: {
    id: 'lulleaux',
    names: { zhHans: 'Lulleaux', en: 'Lulleaux' },
    type: 'solo',
    nationality: 'en',
  },
  'paper-bride': { id: 'paper-bride', names: { zhHans: '纸嫁衣', en: 'Paper Bride' }, type: 'project', nationality: 'other' },
  'nsync': { id: 'nsync', names: { zhHans: 'NSYNC', en: 'NSYNC' }, type: 'group', nationality: 'en' },
  'alpha-drive-one': {
    id: 'alpha-drive-one',
    names: { zhHans: 'Alpha Drive One', en: 'Alpha Drive One' },
    type: 'group',
    nationality: 'kr',
  },
  'ren-jialun': { id: 'ren-jialun', names: { zhHans: '任嘉伦', en: 'Allen Ren' }, type: 'solo', nationality: 'zh' },
  'ayunga': { id: 'ayunga', names: { zhHans: '阿云嘎', en: 'Ayanga' }, type: 'solo', nationality: 'zh' },
  'na-yina': { id: 'na-yina', names: { zhHans: '那艺娜', en: 'Na Yina' }, type: 'solo', nationality: 'zh' },
  'henry-lau': { id: 'henry-lau', names: { zhHans: '刘宪华', en: 'Henry Lau' }, type: 'solo', nationality: 'zh' },
  'luo-tianyi': { id: 'luo-tianyi', names: { zhHans: '洛天依', en: 'Luo Tianyi' }, type: 'solo', nationality: 'zh' },
  'punch-kr': { id: 'punch-kr', names: { zhHans: 'PUNCH', en: 'PUNCH' }, type: 'solo', nationality: 'kr' },
  'feng-ren-ji': { id: 'feng-ren-ji', names: { zhHans: '缝纫机乐队', en: '缝纫机乐队' }, type: 'group', nationality: 'zh' },
  'tetsuya-komuro': { id: 'tetsuya-komuro', names: { zhHans: '小室哲哉', en: 'Tetsuya Komuro' }, type: 'solo', nationality: 'jp' },

  // Japanese
  'radwimps': { id: 'radwimps', names: { zhHans: 'RADWIMPS', en: 'RADWIMPS' }, type: 'group', nationality: 'jp' },
  'kenshi-yonezu': { id: 'kenshi-yonezu', names: { zhHans: '米津玄师', zhHant: '米津玄師', en: 'Kenshi Yonezu' }, type: 'solo', nationality: 'jp' },
  'mika-nakashima': { id: 'mika-nakashima', names: { zhHans: '中岛美嘉', zhHant: '中島美嘉', en: 'Mika Nakashima' }, type: 'solo', nationality: 'jp' },
  'ryuichi-sakamoto': { id: 'ryuichi-sakamoto', names: { zhHans: '坂本龙一', en: 'Ryuichi Sakamoto' }, type: 'solo', nationality: 'jp' },
  'mai-kuraki': { id: 'mai-kuraki', names: { zhHans: '仓木麻衣', en: 'Mai Kuraki' }, type: 'solo', nationality: 'jp' },
  'hiroyuki-sawano': {
    id: 'hiroyuki-sawano',
    names: { zhHans: '泽野弘之', zhHant: '澤野弘之', en: 'Hiroyuki Sawano' },
    type: 'solo',
    nationality: 'jp',
  },

  // Extra Chinese
  'into1': { id: 'into1', names: { zhHans: 'INTO1', en: 'INTO1' }, type: 'group', nationality: 'zh' },
  'by2': { id: 'by2', names: { zhHans: 'BY2', en: 'BY2' }, type: 'group', nationality: 'zh' },
  'cmj': { id: 'cmj', names: { zhHans: 'CMJ', en: 'CMJ' }, type: 'solo', nationality: 'zh' },
  'curley-gao': {
    id: 'curley-gao',
    names: { zhHans: '希林娜依·高', zhHant: '希林娜依·高', en: 'Curley Gao' },
    type: 'solo',
    nationality: 'zh',
  },
  'bonbon-girls-303': {
    id: 'bonbon-girls-303',
    names: { zhHans: '硬糖少女303', zhHant: '硬糖少女303', en: 'BonBon Girls 303' },
    type: 'group',
    nationality: 'zh',
  },
  'tfboys': { id: 'tfboys', names: { zhHans: 'TFBOYS', en: 'TFBOYS' }, type: 'group', nationality: 'zh' },
  /** 《彼岸》井胧、井迪儿；不含剧名 / OST 英文标题 */
  'jing-long-jing-dier': {
    id: 'jing-long-jing-dier',
    names: { zhHans: '井胧、井迪儿', zhHant: '井朧、井迪兒', en: 'Jing Long, Jing Dier' },
    type: 'group',
    nationality: 'zh',
  },
  'wang-yuan': { id: 'wang-yuan', names: { zhHans: '王源', en: 'Roy Wang' }, type: 'solo', nationality: 'zh' },
  'wang-jun-kai': { id: 'wang-jun-kai', names: { zhHans: '王俊凯', en: 'Karry Wang' }, type: 'solo', nationality: 'zh' },
  'yi-yang-qian-xi': { id: 'yi-yang-qian-xi', names: { zhHans: '易烊千玺', en: 'Jackson Yee' }, type: 'solo', nationality: 'zh' },
  'xiao-zhan': { id: 'xiao-zhan', names: { zhHans: '肖战', en: 'Xiao Zhan' }, type: 'solo', nationality: 'zh' },
  'yang-zi': { id: 'yang-zi', names: { zhHans: '杨紫', en: 'Yang Zi' }, type: 'solo', nationality: 'zh' },
  /** Hearts2Hearts — K-pop girl group */
  hearts2hearts: {
    id: 'hearts2hearts',
    names: { zhHans: 'Hearts2Hearts', zhHant: 'Hearts2Hearts', en: 'Hearts2Hearts' },
    type: 'group',
    nationality: 'kr',
  },
  /** KiiiKiii — K-pop girl group */
  kiiikiii: {
    id: 'kiiikiii',
    names: { zhHans: 'KiiiKiii', zhHant: 'KiiiKiii', en: 'KiiiKiii' },
    type: 'group',
    nationality: 'kr',
  },
  'm-taku': { id: 'm-taku', names: { zhHans: 'm-taku', en: 'm-taku' }, type: 'solo', nationality: 'jp' },
  'lu-han': { id: 'lu-han', names: { zhHans: '鹿晗', en: 'Lu Han' }, type: 'solo', nationality: 'zh' },
  'zhang-jie': { id: 'zhang-jie', names: { zhHans: '张杰', en: 'Jason Zhang' }, type: 'solo', nationality: 'zh' },
  'liu-yu-xin': { id: 'liu-yu-xin', names: { zhHans: '刘雨昕', en: 'Liu Yuxin' }, type: 'solo', nationality: 'zh' },
  'the9': { id: 'the9', names: { zhHans: 'THE9', en: 'THE9' }, type: 'group', nationality: 'zh' },
  'snh48': { id: 'snh48', names: { zhHans: 'SNH48', en: 'SNH48' }, type: 'group', nationality: 'zh' },
  'jackson-wang': { id: 'jackson-wang', names: { zhHans: '王嘉尔', en: 'Jackson Wang' }, type: 'solo', nationality: 'zh' },
  'wang-xin-ling': { id: 'wang-xin-ling', names: { zhHans: '王心凌', en: 'Cyndi Wang' }, type: 'solo', nationality: 'zh' },
  'ju-jing-yi': { id: 'ju-jing-yi', names: { zhHans: '鞠婧祎', en: 'Ju Jingyi' }, type: 'solo', nationality: 'zh' },
  'zhang-liang-ying': { id: 'zhang-liang-ying', names: { zhHans: '张靓颖', en: 'Jane Zhang' }, type: 'solo', nationality: 'zh' },
  'li-rong-hao': { id: 'li-rong-hao', names: { zhHans: '李荣浩', zhHant: '李榮浩', en: 'Li Ronghao' }, type: 'solo', nationality: 'zh' },
  'bai-jing-ting': { id: 'bai-jing-ting', names: { zhHans: '白敬亭', en: 'Bai Jingting' }, type: 'solo', nationality: 'zh' },
  'du-zhi-wen': { id: 'du-zhi-wen', names: { zhHans: '都智文', en: 'Bernard Du' }, type: 'solo', nationality: 'zh' },
  'zeng-ke-ni': { id: 'zeng-ke-ni', names: { zhHans: '曾可妮', zhHant: '曾可妮', en: 'Jenny Zeng' }, type: 'solo', nationality: 'zh' },
  'feng-huang-chuan-qi': { id: 'feng-huang-chuan-qi', names: { zhHans: '凤凰传奇', zhHant: '鳳凰傳奇', en: 'Phoenix Legend' }, type: 'group', nationality: 'zh' },
  'guo-ding': { id: 'guo-ding', names: { zhHans: '郭顶', zhHant: '郭頂', en: 'Guo Ding' }, type: 'solo', nationality: 'zh' },
  'xu-liang': { id: 'xu-liang', names: { zhHans: '徐良', en: 'Xu Liang' }, type: 'solo', nationality: 'zh' },
  'ge-dong-qi': { id: 'ge-dong-qi', names: { zhHans: '葛东琪', zhHant: '葛東琪', en: 'Ge Dongqi' }, type: 'solo', nationality: 'zh' },
  'hai-lai-a-mu': { id: 'hai-lai-a-mu', names: { zhHans: '海来阿木', en: 'Hai Lai A Mu' }, type: 'solo', nationality: 'zh' },
  /** Tiger Hu — strip “我为歌狂插曲” etc. in canonical layer; bucket is the singer only. */
  'hu-yan-bin': { id: 'hu-yan-bin', names: { zhHans: '胡彦斌', zhHant: '胡彥斌', en: 'Tiger Hu' }, type: 'solo', nationality: 'zh' },
  /** 《撒野》原唱 */
  'kai-se-miao': { id: 'kai-se-miao', names: { zhHans: '凯瑟喵', en: 'Kaiser' }, type: 'solo', nationality: 'zh' },
  /** 0713 / 再就业男团 — multi-vocal franchise line when a single person is not credited */
  '0713-nan-tuan': { id: '0713-nan-tuan', names: { zhHans: '0713男团', en: '0713 Boy Group' }, type: 'group', nationality: 'zh' },
  'metro-boomin': { id: 'metro-boomin', names: { zhHans: 'Metro Boomin', en: 'Metro Boomin' }, type: 'solo', nationality: 'en' },
  'ne-yo': { id: 'ne-yo', names: { zhHans: 'Ne-Yo', en: 'Ne-Yo' }, type: 'solo', nationality: 'en' },
  'pvris': { id: 'pvris', names: { zhHans: 'PVRIS', en: 'PVRIS' }, type: 'group', nationality: 'en' },
  /** 抖音/钢琴 cover 艺人 — 勿与游戏 project「Fairy Town」混淆 */
  'xiao-ye-lai-le': { id: 'xiao-ye-lai-le', names: { zhHans: '小野来了', en: 'Xiao Ye Lai Le' }, type: 'solo', nationality: 'zh' },
  /** K-pop Demon Hunters film — in-universe girl group (not the movie title as artist). */
  'huntr-x': { id: 'huntr-x', names: { zhHans: 'HUNTR/X', en: 'HUNTR/X' }, type: 'group', nationality: 'kr' },
  /** 올데이프로젝트 — K-pop boy group (CIP freeform bucket → canonical id). */
  'allday-project': {
    id: 'allday-project',
    names: { zhHans: 'ALLDAY PROJECT', en: 'ALLDAY PROJECT' },
    type: 'group',
    nationality: 'kr',
  },
  'saja-boys': { id: 'saja-boys', names: { zhHans: 'Saja Boys', en: 'Saja Boys' }, type: 'group', nationality: 'kr' },
  /** 《一笑江湖》/科目三热歌原唱 */
  'wen-ren-ting-shu': { id: 'wen-ren-ting-shu', names: { zhHans: '闻人听書', en: 'Wen Ren Tingshu' }, type: 'solo', nationality: 'zh' },
  'dao-lang': { id: 'dao-lang', names: { zhHans: '刀郎', en: 'Dao Lang' }, type: 'solo', nationality: 'zh' },
  'tai-yi': { id: 'tai-yi', names: { zhHans: '太一', en: 'Tai Yi' }, type: 'solo', nationality: 'zh' },
  'a-si': { id: 'a-si', names: { zhHans: '阿肆', en: 'A Si' }, type: 'solo', nationality: 'zh' },
  'deng-what-jun': { id: 'deng-what-jun', names: { zhHans: '等什么君', en: 'Deng Shime Jun' }, type: 'solo', nationality: 'zh' },
  'cai-jian-ya': { id: 'cai-jian-ya', names: { zhHans: '蔡健雅', en: 'Tanya Chua' }, type: 'solo', nationality: 'zh' },
  'xue-kai-qi': { id: 'xue-kai-qi', names: { zhHans: '薛凯琪', en: 'Fiona Sit' }, type: 'solo', nationality: 'zh' },
  'faye-zhan': { id: 'faye-zhan', names: { zhHans: '詹雯婷', en: 'Faye' }, type: 'solo', nationality: 'zh' },
  'zhang-miao-ge': { id: 'zhang-miao-ge', names: { zhHans: '张妙格', zhHant: '張妙格', en: 'Zhang Miaoge' }, type: 'solo', nationality: 'zh' },
  'zheng-yi-nong': { id: 'zheng-yi-nong', names: { zhHans: '郑宜农', zhHant: '鄭宜農', en: 'Zheng Yinong' }, type: 'solo', nationality: 'zh' },
  'mai-la-jiao': { id: 'mai-la-jiao', names: { zhHans: '买辣椒也用券', en: 'Mailajiao' }, type: 'solo', nationality: 'zh' },
  'li-wen-coco': { id: 'li-wen-coco', names: { zhHans: '李玟', en: 'CoCo Lee' }, type: 'solo', nationality: 'zh' },
  'cheng-huan': { id: 'cheng-huan', names: { zhHans: '承桓', en: 'Cheng Huan' }, type: 'solo', nationality: 'zh' },

  // Extra Korean
  'twice': { id: 'twice', names: { zhHans: 'TWICE', en: 'TWICE' }, type: 'group', nationality: 'kr' },
  'stray-kids': { id: 'stray-kids', names: { zhHans: 'Stray Kids', en: 'Stray Kids' }, type: 'group', nationality: 'kr' },
  'nct': { id: 'nct', names: { zhHans: 'NCT', en: 'NCT' }, type: 'group', nationality: 'kr' },
  'exo': { id: 'exo', names: { zhHans: 'EXO', en: 'EXO' }, type: 'group', nationality: 'kr' },
  'got7': { id: 'got7', names: { zhHans: 'GOT7', en: 'GOT7' }, type: 'group', nationality: 'kr' },
  'red-velvet': { id: 'red-velvet', names: { zhHans: 'Red Velvet', en: 'Red Velvet' }, type: 'group', nationality: 'kr' },
  'girls-generation': { id: 'girls-generation', names: { zhHans: '少女时代', en: "Girls' Generation" }, type: 'group', nationality: 'kr' },
  'super-junior': { id: 'super-junior', names: { zhHans: 'Super Junior', en: 'Super Junior' }, type: 'group', nationality: 'kr' },
  'enhypen': { id: 'enhypen', names: { zhHans: 'ENHYPEN', en: 'ENHYPEN' }, type: 'group', nationality: 'kr' },
  'iu': { id: 'iu', names: { zhHans: 'IU', en: 'IU' }, type: 'solo', nationality: 'kr' },
  'sunmi': { id: 'sunmi', names: { zhHans: 'Sunmi', en: 'Sunmi' }, type: 'solo', nationality: 'kr' },
  'jeon-somi': { id: 'jeon-somi', names: { zhHans: 'JEON SOMI', en: 'Jeon Somi' }, type: 'solo', nationality: 'kr' },
  'zico': { id: 'zico', names: { zhHans: 'ZICO', en: 'ZICO' }, type: 'solo', nationality: 'kr' },

  /** 《STAY》by The Kid LAROI & Justin Bieber — 仅归档 Justin Bieber 艺人桶；The Kid LAROI 不单独建桶（按用户指示）。 */
  'justin-bieber': { id: 'justin-bieber', names: { zhHans: 'Justin Bieber', zhHant: 'Justin Bieber', en: 'Justin Bieber' }, type: 'solo', nationality: 'en' },

  // Extra Western
  'adele': { id: 'adele', names: { zhHans: 'Adele', en: 'Adele' }, type: 'solo', nationality: 'en' },
  'billie-eilish': { id: 'billie-eilish', names: { zhHans: 'Billie Eilish', en: 'Billie Eilish' }, type: 'solo', nationality: 'en' },
  'alan-walker': { id: 'alan-walker', names: { zhHans: 'Alan Walker', en: 'Alan Walker' }, type: 'solo', nationality: 'en' },
  'taylor-swift': { id: 'taylor-swift', names: { zhHans: 'Taylor Swift', en: 'Taylor Swift' }, type: 'solo', nationality: 'en' },
  'shakira': { id: 'shakira', names: { zhHans: 'Shakira', en: 'Shakira' }, type: 'solo', nationality: 'en' },

  // Extra Western (batch 2)
  'christina-perri': { id: 'christina-perri', names: { zhHans: 'Christina Perri', en: 'Christina Perri' }, type: 'solo', nationality: 'en' },
  'linkin-park': { id: 'linkin-park', names: { zhHans: 'Linkin Park', en: 'Linkin Park' }, type: 'group', nationality: 'en' },
  'simon-garfunkel': { id: 'simon-garfunkel', names: { zhHans: 'Simon and Garfunkel', en: 'Simon and Garfunkel' }, type: 'group', nationality: 'en' },
  'aurora': { id: 'aurora', names: { zhHans: 'AURORA', en: 'AURORA' }, type: 'solo', nationality: 'en' },

  // Extra Korean
  'bigbang': { id: 'bigbang', names: { zhHans: 'BIGBANG', en: 'BIGBANG' }, type: 'group', nationality: 'kr' },
  'orange-caramel': { id: 'orange-caramel', names: { zhHans: 'Orange Caramel', en: 'Orange Caramel' }, type: 'group', nationality: 'kr' },
  'ailee': { id: 'ailee', names: { zhHans: 'Ailee', en: 'Ailee' }, type: 'solo', nationality: 'kr' },

  // Extra Chinese
  'cheng-xiang': { id: 'cheng-xiang', names: { zhHans: '程响', zhHant: '程響', en: 'Cheng Xiang' }, type: 'solo', nationality: 'zh' },
  'yi-zhi-liu-lian': { id: 'yi-zhi-liu-lian', names: { zhHans: '一支榴莲', en: 'Yi Zhi Liulian' }, type: 'solo', nationality: 'zh' },
  'zheng-zhi': { id: 'zheng-zhi', names: { zhHans: '郑直', zhHant: '鄭直', en: 'Zheng Zhi' }, type: 'solo', nationality: 'zh' },
  'liu-shuang': { id: 'liu-shuang', names: { zhHans: '柳爽', en: 'Liu Shuang' }, type: 'solo', nationality: 'zh' },
  'deng-jun-jun': { id: 'deng-jun-jun', names: { zhHans: '等什么君', en: 'Deng Shenme Jun' }, type: 'solo', nationality: 'zh' },
  'a-soul': { id: 'a-soul', names: { zhHans: 'A-SOUL', en: 'A-SOUL' }, type: 'group', nationality: 'zh' },
  'nicky-lee': { id: 'nicky-lee', names: { zhHans: '李玖哲', zhHant: '李玖哲', en: 'Nicky Lee' }, type: 'solo', nationality: 'zh' },
  'penny-tai': { id: 'penny-tai', names: { zhHans: '戴佩妮', en: 'Penny Tai' }, type: 'solo', nationality: 'zh' },

  // Japanese extra
  'honeyworks': { id: 'honeyworks', names: { zhHans: 'HoneyWorks', en: 'HoneyWorks' }, type: 'group', nationality: 'jp' },
  /** 《花になれ / 幻化成花》原唱指田郁也（钢琴改编按原唱归档；非花滑表演者）。 */
  'fumiya-sashida': {
    id: 'fumiya-sashida',
    names: { zhHans: '指田郁也', zhHant: '指田郁也', en: 'Fumiya Sashida' },
    type: 'solo',
    nationality: 'jp',
  },
  'koda-kumi': { id: 'koda-kumi', names: { zhHans: '倖田來未', en: 'Koda Kumi' }, type: 'solo', nationality: 'jp' },
  /** 《起风了》原曲「ヤキモチ」 */
  'takahiro': { id: 'takahiro', names: { zhHans: '高桥优', zhHant: '高橋優', en: 'Yu Takahashi' }, type: 'solo', nationality: 'jp' },
  /** CORSAK */
  'hu-meng-zhou': { id: 'hu-meng-zhou', names: { zhHans: '胡梦周', en: 'CORSAK' }, type: 'solo', nationality: 'zh' },
  'su-xin-hao': { id: 'su-xin-hao', names: { zhHans: '苏新皓', zhHant: '蘇新皓', en: 'Su Xinhao' }, type: 'solo', nationality: 'zh' },
  'zuo-hang': { id: 'zuo-hang', names: { zhHans: '左航', en: 'Zuohang' }, type: 'solo', nationality: 'zh' },
  /** 2024 春晚《上春山》三人 — 单列 project，不拆个人艺人页 */
  'shang-chun-shan-trio': {
    id: 'shang-chun-shan-trio',
    names: { zhHans: '魏晨、魏大勋、白敬亭', en: 'Wei Chen, Wei Daxun, Bai Jingting' },
    type: 'project',
    nationality: 'zh',
  },
  /** 网络曲《一笑江湖》/科目三语境 — 无固定「原唱」艺人桶 */
  'yixiao-jianghu': {
    id: 'yixiao-jianghu',
    names: { zhHans: '一笑江湖', en: 'Yi Xiao Jiang Hu' },
    type: 'project',
    nationality: 'other',
  },
  /** 《斗地主》抒情版等 — 无传统「原唱」 */
  'dou-dizhu-game': {
    id: 'dou-dizhu-game',
    names: { zhHans: '斗地主（游戏）', en: 'Dou Dizhu' },
    type: 'project',
    nationality: 'other',
  },
};

const ARTIST_COMPLEX_OVERRIDES: { match: string; ids: string[] }[] = [
  { match: '《恆星不忘》钢琴版 周杰倫/言承旭/吳建豪/周渝民/阿信 JayChou F4 MAYDAY', ids: ['jay-chou', 'jerry-yan', 'vanness-wu', 'vic-chou', 'ashin', 'f4', 'mayday'] },
  { match: 'Teens In Times - He Jun Lin / TNT时代少年团 - 贺峻霖', ids: ['tnt', 'he-jun-lin'] },
  { match: '时代少年团 贺峻霖', ids: ['he-jun-lin'] },
  { match: '时代的少年 贺峻霖', ids: ['he-jun-lin'] },
  { match: '单依纯 歌手2025', ids: ['shan-yi-chun'] },
  { match: 'Eason Chan丨Arcane: Season 2', ids: ['eason-chan'] },
];

export const EXACT_ALIAS_MAP: Record<string, string> = {
  '贺峻霖': 'he-jun-lin',
  '周深': 'zhou-shen',
  '林俊杰': 'jj-lin',
  '时代少年团': 'tnt',
  'TNT时代少年团': 'tnt',
  '严浩翔': 'yan-hao-xiang',
  '马嘉祺': 'ma-jia-qi',
  '宋亚轩': 'song-ya-xuan',
  '张真源': 'zhang-zhen-yuan',
  '丁程鑫': 'ding-chengxin',
  '刘耀文': 'liu-yao-wen',
  '汪苏泷': 'silence-wang',
  '薛之谦': 'joker-xue',
  '邓紫棋': 'gem',
  '章昊': 'zhang-hao',
  '蔡徐坤': 'kun',
  '孙燕姿': 'stefanie-sun',
  '容祖儿': 'joey-yung',

  'HUNTR/X': 'huntr-x',
  'Huntr/x': 'huntr-x',
  '阿信': 'ashin',
  'ROSÉ': 'rose',
  'i-dle (아이들)': 'i-dle',
  '아이들 (I-DLE)': 'i-dle',
  '아이들 I-DLE': 'i-dle',
  '아일릿 (ILLIT)': 'illit',
  '아일릿 ILLIT': 'illit',
  'BABYMONSTER (베이비몬스터)': 'babymonster',
  '베이비몬스터 (BABYMONSTER)': 'babymonster',
  '베이비몬스터 BABYMONSTER': 'babymonster',
  'Kep1er (케플러)': 'kep1er',
  'Kep1er 케플러': 'kep1er',
  'tripleS (트리플에스)': 'triples',
  'tripleS 트리플에스': 'triples',
  'NewJeans (뉴진스)': 'newjeans',
  'NewJeans 뉴진스': 'newjeans',
  '时代少年团 贺峻霖': 'he-jun-lin',
  'TNT时代少年团 贺峻霖': 'he-jun-lin',
  '时代少年团 严浩翔': 'yan-hao-xiang',
  'TNT时代少年团 严浩翔': 'yan-hao-xiang',
  '时代少年团 马嘉祺': 'ma-jia-qi',
  'TNT时代少年团 马嘉祺': 'ma-jia-qi',
  '时代少年团 宋亚轩': 'song-ya-xuan',
  'TNT时代少年团 宋亚轩': 'song-ya-xuan',
  '时代少年团 张真源': 'zhang-zhen-yuan',
  'TNT时代少年团 张真源': 'zhang-zhen-yuan',
  '时代少年团 刘耀文': 'liu-yao-wen',
  'TNT时代少年团 刘耀文': 'liu-yao-wen',
  '时代少年团 丁程鑫': 'ding-chengxin',
  'TNT时代少年团 丁程鑫': 'ding-chengxin',
  '周深 Charlie Zhou Shen': 'zhou-shen',
  'Charlie Zhou Shen 周深': 'zhou-shen',
  '汪苏泷 Silence Wang': 'silence-wang',
  'Silence Wang 汪苏泷': 'silence-wang',
  '薛之谦 Joker Xue': 'joker-xue',
  'Joker Xue 薛之谦': 'joker-xue',

  'INTO1': 'into1',
  'INTO1刘宇': 'into1',
  'Be Mine CHUANG2021': 'into1',
  'NSYNC': 'nsync',
  '*NSYNC': 'nsync',
  'N SYNC': 'nsync',
  'Nsync': 'nsync',
  'CHANYEOL': 'exo',
  '찬열': 'exo',
  'PUNCH': 'punch-kr',
  '펀치': 'punch-kr',
  '任嘉伦': 'ren-jialun',
  'Allen Ren': 'ren-jialun',
  '阿云嘎': 'ayunga',
  'Ayanga': 'ayunga',
  'Ayunga': 'ayunga',
  '那艺娜': 'na-yina',
  '刘宪华': 'henry-lau',
  'Henry Lau': 'henry-lau',
  '헨리': 'henry-lau',
  '洛天依': 'luo-tianyi',
  '缝纫机乐队': 'feng-ren-ji',
  '小室哲哉': 'tetsuya-komuro',
  'Tetsuya Komuro': 'tetsuya-komuro',
  'BY2': 'by2',
  'By2': 'by2',
  'CMJ': 'cmj',
  '希林娜依高': 'curley-gao',
  'TFBOYS': 'tfboys',
  'TFBOYS易烊千玺': 'yi-yang-qian-xi',
  '易烊千玺': 'yi-yang-qian-xi',
  '王源': 'wang-yuan',
  '王源(TFBOYS)': 'wang-yuan',
  'Roy Wang': 'wang-yuan',
  '王俊凯': 'wang-jun-kai',
  'Karry Wang': 'wang-jun-kai',
  '肖战': 'xiao-zhan',
  '杨紫': 'yang-zi',
  'Hearts2Hearts': 'hearts2hearts',
  'Hearts2Hearts(하츠투하츠)': 'hearts2hearts',
  KiiiKiii: 'kiiikiii',
  'KiiiKiii(키키)': 'kiiikiii',
  Rosé: 'rose',
  Rose: 'rose',
  LISA: 'lisa',
  Lisa: 'lisa',
  Lalisa: 'lisa',
  '都智文': 'du-zhi-wen',
  '曾可妮': 'zeng-ke-ni',
  'm-taku': 'm-taku',
  'M-taku': 'm-taku',
  '鹿晗': 'lu-han',
  '鹿晗LuHan': 'lu-han',
  '鹿晗 Lu Han': 'lu-han',
  'Lu Han': 'lu-han',
  'LuHan': 'lu-han',
  '张杰': 'zhang-jie',
  '张杰 Jason Zhang': 'zhang-jie',
  'Jason Zhang': 'zhang-jie',
  '刘雨昕': 'liu-yu-xin',
  'THE9': 'the9',
  'SNH48': 'snh48',
  'Jackson Wang': 'jackson-wang',
  '王嘉尔': 'jackson-wang',
  '王心凌': 'wang-xin-ling',
  'Cyndi Wang': 'wang-xin-ling',
  '鞠婧祎': 'ju-jing-yi',
  '张靓颖': 'zhang-liang-ying',
  'Jane Zhang': 'zhang-liang-ying',
  '李荣浩': 'li-rong-hao',
  '李榮浩': 'li-rong-hao',
  '李榮浩 Ronghao Li': 'li-rong-hao',
  'Ronghao Li': 'li-rong-hao',
  '白敬亭': 'bai-jing-ting',
  '凤凰传奇': 'feng-huang-chuan-qi',
  '鳳凰傳奇': 'feng-huang-chuan-qi',
  '郭顶': 'guo-ding',
  '郭頂': 'guo-ding',
  'Guo Ding': 'guo-ding',
  '徐良': 'xu-liang',
  '葛东琪': 'ge-dong-qi',
  '葛東琪': 'ge-dong-qi',
  '海来阿木': 'hai-lai-a-mu',
  '刀郎': 'dao-lang',
  '太一': 'tai-yi',
  '阿肆': 'a-si',
  '等什么君': 'deng-what-jun',
  '蔡健雅': 'cai-jian-ya',
  'Tanya Chua': 'cai-jian-ya',
  '薛凯琪': 'xue-kai-qi',
  '詹雯婷': 'faye-zhan',
  'Faye詹雯婷': 'faye-zhan',
  '张妙格': 'zhang-miao-ge',
  '張妙格': 'zhang-miao-ge',
  '郑宜农': 'zheng-yi-nong',
  '鄭宜農': 'zheng-yi-nong',
  '买辣椒也用券': 'mai-la-jiao',
  '李玟': 'li-wen-coco',
  'CoCo Lee': 'li-wen-coco',
  '承桓': 'cheng-huan',
  'Red Velvet': 'red-velvet',
  'Red Velvet 레드벨벳': 'red-velvet',
  '레드벨벳': 'red-velvet',
  "Girls' Generation": 'girls-generation',
  '소녀시대': 'girls-generation',
  "Girls' Generation 소녀시대": 'girls-generation',
  'Super Junior': 'super-junior',
  'SUPER JUNIOR': 'super-junior',
  'ENHYPEN': 'enhypen',
  'IU': 'iu',
  'IU (아이유)': 'iu',
  '아이유': 'iu',
  '아이유 (IU)': 'iu',
  'Sunmi': 'sunmi',
  'JEON SOMI': 'jeon-somi',
  'Jeon Somi': 'jeon-somi',
  'ZICO': 'zico',
  'Adele': 'adele',
  'Billie Eilish': 'billie-eilish',
  'Alan Walker': 'alan-walker',
  'Taylor Swift': 'taylor-swift',
  'Taylor Swi': 'taylor-swift',
  'Shakira': 'shakira',
  'HoneyWorks': 'honeyworks',
  'TWICE': 'twice',
  'Stray Kids': 'stray-kids',
  'NCT': 'nct',
  'EXO': 'exo',
  'GOT7': 'got7',
  '华晨宇': 'hua-chen-yu',
  '华晨宇 Hua Chenyu': 'hua-chen-yu',
  'Hua Chenyu': 'hua-chen-yu',
  '林俊傑': 'jj-lin',
  'JJ LIN': 'jj-lin',
  'JJ Lin': 'jj-lin',
  'JJ LIN 林俊杰': 'jj-lin',
  '莫文蔚': 'karen-mok',
  '莫文蔚 Karen Mok': 'karen-mok',
  'Karen Mok': 'karen-mok',
  '唐汉霄': 'sean-tang',
  '唐漢霄': 'sean-tang',
  '唐漢霄 SeanTang': 'sean-tang',
  'SeanTang': 'sean-tang',
  '派伟俊': 'patrick-brasca',
  '派偉俊': 'patrick-brasca',
  'Patrick Brasca': 'patrick-brasca',
  '张艺兴': 'lay-zhang',
  '張藝興': 'lay-zhang',
  'LAY ZHANG': 'lay-zhang',
  'LAY ZHANG 张艺兴': 'lay-zhang',
  'Lay Zhang': 'lay-zhang',
  '陈雪燃': 'chen-xue-ran',
  '陈粒': 'chen-li',
  '陳粒': 'chen-li',
  '陳粒(Chen Li)': 'chen-li',
  '赵露思': 'zhao-lu-si',
  '趙露思': 'zhao-lu-si',
  '苏星婕': 'su-xing-jie',
  '苏星婕 Su': 'su-xing-jie',
  '大泫': 'chen-xuan-xiao',
  '陈泫孝': 'chen-xuan-xiao',
  '陈泫孝(大泫)': 'chen-xuan-xiao',
  '王艳薇': 'wang-yan-wei',
  '王艷薇': 'wang-yan-wei',
  'G.E.M.鄧紫棋': 'gem',
  'G.E.M. 鄧紫棋': 'gem',
  '鄧紫棋': 'gem',
  'IVE': 'ive',
  'IVE 아이브': 'ive',
  '아이브': 'ive',
  'SEVENTEEN': 'seventeen',
  'SEVENTEEN 세븐틴': 'seventeen',
  '세븐틴': 'seventeen',
  'ZEROBASEONE': 'zerobaseone',
  'ZEROBASEONE 제로베이스원': 'zerobaseone',
  'ZEROBASEON 제로베이스원': 'zerobaseone',
  ZEROBASEON: 'zerobaseone',
  '제로베이스원': 'zerobaseone',
  'aespa': 'aespa',
  'aespa 에스파': 'aespa',
  '에스파': 'aespa',
  '米津玄師': 'kenshi-yonezu',
  '米津玄师': 'kenshi-yonezu',
  '中島美嘉': 'mika-nakashima',
  '中岛美嘉': 'mika-nakashima',
  '毛不易': 'mao-buyi',
  '王力宏': 'wang-lee-hom',
  '方大同': 'khalil-fong',
  '王一博': 'wang-yi-bo',
  '五月天': 'mayday',
  '五月天 MAYDAY': 'mayday',
  'MAYDAY': 'mayday',
  'TNT时代少年团 Teens In Times': 'tnt',
  'Teens In Times': 'tnt',
  '摩登兄弟刘宇宁': 'liu-yu-ning',
  '摩登兄弟劉宇寧': 'liu-yu-ning',
  '摩登兄弟刘宇宁(摩登兄弟劉宇寧)': 'liu-yu-ning',
  '薛之謙': 'joker-xue',
  '薛之謙 Joker': 'joker-xue',
  '蔡徐坤KUN': 'kun',
  '蔡徐坤 KUN': 'kun',
  '蔡徐坤Hug Me KUN': 'kun',
  '周杰伦': 'jay-chou',
  '周杰倫': 'jay-chou',
  '周杰伦(周杰倫)Jay Chou': 'jay-chou',
  '周杰倫 Jay Chou': 'jay-chou',
  '张碧晨': 'zhang-bi-chen',
  '張碧晨': 'zhang-bi-chen',
  'Bi Chen Zhang': 'zhang-bi-chen',
  '张碧晨 Bi Chen Zhang': 'zhang-bi-chen',
  '恋与深空': 'love-and-deepspace',
  '戀與深空': 'love-and-deepspace',
  'Love and Deepspace': 'love-and-deepspace',
  '胡彦斌': 'hu-yan-bin',
  '胡彥斌': 'hu-yan-bin',
  'Tiger Hu': 'hu-yan-bin',
  '凯瑟喵': 'kai-se-miao',
  '凯瑟猫': 'kai-se-miao',
  '0713男团': '0713-nan-tuan',
  '再就业男团': '0713-nan-tuan',
  'Metro Boomin': 'metro-boomin',
  'Ne-Yo': 'ne-yo',
  'PVRIS': 'pvris',
  '小野来了': 'xiao-ye-lai-le',
  '闻人听書': 'wen-ren-ting-shu',
  '闻人听書_': 'wen-ren-ting-shu',
  '泽野弘之': 'hiroyuki-sawano',
  '澤野弘之': 'hiroyuki-sawano',
  'Hiroyuki Sawano': 'hiroyuki-sawano',
  '井胧&井迪儿': 'jing-long-jing-dier',
  'Saja Boys': 'saja-boys',
  '黑神话:悟空': 'black-myth-wukong',
  '黑神话悟空': 'black-myth-wukong',
  'Black Myth: Wukong': 'black-myth-wukong',
  'Black Myth Wukong': 'black-myth-wukong',
  'Black Myth Wukong Celestial Symphony': 'black-myth-wukong',
  'Black Myth Wukong Piano Collection': 'black-myth-wukong',
  'Black Myth Wukong Main Theme': 'black-myth-wukong',
  'ALLDAY PROJECT': 'allday-project',
  '(여자)아이들': 'i-dle',
  '(G)I-DLE': 'i-dle',
  '(G)I-DLE YUQI': 'i-dle',
  '(G)I-DLE MIYEON': 'i-dle',
  '(G)I-DLE MINNIE': 'i-dle',
  '(여자)아이들 (G)I-DLE': 'i-dle',
  'I-DLE G': 'i-dle',
  'I-DLE MIYEON G': 'i-dle',
  'I-DLE MINNIE - G': 'i-dle',
  '아이들 우기 宋雨琦': 'i-dle',
  'BOYS PLANET': 'boys-planet',
  'BOYS ll PLANET': 'boys-planet',
  'BOYS ll PLANET singal song': 'boys-planet',
  '[BOYS PLANET]': 'boys-planet',
  '硬糖少女303': 'bonbon-girls-303',
  '希林娜依·高': 'curley-gao',
  'Christina Perri': 'christina-perri',
  'Linkin Park': 'linkin-park',
  'Simon and Garfunkel': 'simon-garfunkel',
  'AURORA': 'aurora',
  'BIGBANG': 'bigbang',
  'Orange Caramel': 'orange-caramel',
  '오렌지캬라멜': 'orange-caramel',
  'ORANGE CARAMEL': 'orange-caramel',
  '少女時代': 'girls-generation',
  '少女时代': 'girls-generation',
  'Ailee': 'ailee',
  '에일리': 'ailee',
  '로제': 'rose',
  '王嘉爾': 'jackson-wang',
  '程响': 'cheng-xiang',
  '程響': 'cheng-xiang',
  '一支榴莲': 'yi-zhi-liu-lian',
  '郑直': 'zheng-zhi',
  '鄭直': 'zheng-zhi',
  '柳爽': 'liu-shuang',
  '等什麼君': 'deng-jun-jun',
  '鄧寓君': 'deng-jun-jun',
  '邓寓君': 'deng-jun-jun',
  'A-SOUL': 'a-soul',
  '李玖哲': 'nicky-lee',
  'Nicky Lee': 'nicky-lee',
  '戴佩妮': 'penny-tai',
  'Penny Tai': 'penny-tai',
  'Penny': 'penny-tai',
  '倖田來未': 'koda-kumi',
  'Koda Kumi': 'koda-kumi',
  '指田郁也': 'fumiya-sashida',
  '指田彌也': 'fumiya-sashida',
  'Fumiya Sashida': 'fumiya-sashida',
  /** 易与「指田郁也」混写 */
  '植田裕彦': 'fumiya-sashida',
  'Hirohiko Ueda': 'fumiya-sashida',
  '卢苑仪': 'lu-yuan-yi',
  '盧苑儀': 'lu-yuan-yi',
  '卢宛仪': 'lu-yuan-yi',
  'LAY': 'lay-zhang',
};

// --- ENGINE 7.0: STATIC-HOT SYNC ---

const prepareString = (s: string) => s.normalize('NFC').trim();
const hasHan = (s: string) => /[\u3400-\u9fff]/u.test(s);
const hasHangul = (s: string) => /[\uac00-\ud7af]/u.test(s);
const hasKana = (s: string) => /[\u3040-\u30ff]/u.test(s);

const inferDynamicNationality = (value: string): NormalizedArtist['nationality'] => {
  if (hasHangul(value)) return 'kr';
  if (hasKana(value)) return 'jp';
  if (hasHan(value)) return 'zh';
  return 'other';
};

let NORM_ALIAS_CACHE: Record<string, string> | null = null;

export const getArtistAliasMap = (): Record<string, string> => {
  if (NORM_ALIAS_CACHE) return NORM_ALIAS_CACHE;
  const map: Record<string, string> = {};
  Object.entries(EXACT_ALIAS_MAP).forEach(([key, val]) => {
    map[prepareString(key)] = val;
  });
  Object.entries(ARTIST_DICTIONARY).forEach(([id, artist]) => {
    if (artist.names.zhHans) map[prepareString(artist.names.zhHans)] = id;
    if (artist.names.zhHant) map[prepareString(artist.names.zhHant)] = id;
    if (artist.names.en) map[prepareString(artist.names.en)] = id;
  });
  NORM_ALIAS_CACHE = map;
  return map;
};

/** @deprecated use getArtistAliasMap */
const getInitAliasMap = getArtistAliasMap;

/** Resolve a single cleaned segment to a known dictionary id, or undefined. */
export function lookupKnownArtistId(part: string): string | undefined {
  const aliasMap = getArtistAliasMap();
  const raw = prepareString(part);
  if (!raw) return undefined;
  if (aliasMap[raw]) return aliasMap[raw];
  const dictionarySearchKey = raw.replace(/[（(].*?[）)]/gu, '').trim();
  if (dictionarySearchKey !== raw && aliasMap[dictionarySearchKey]) return aliasMap[dictionarySearchKey];
  const lower = raw.toLowerCase();
  const hyphenated = lower.replace(/\s+/g, '-');
  if (ARTIST_DICTIONARY[lower]) return lower;
  if (ARTIST_DICTIONARY[hyphenated]) return hyphenated;
  if (aliasMap[dictionarySearchKey]) return aliasMap[dictionarySearchKey];
  return undefined;
}

export const normalizeAndExtractArtists = (rawArtistString: string | undefined): NormalizedArtist[] => {
  if (!rawArtistString) return [];

  const raw = prepareString(rawArtistString);
  const aliasMap = getInitAliasMap();

  // 0. Full match optimization
  if (aliasMap[raw]) {
    const mainId = aliasMap[raw];
    if (ARTIST_DICTIONARY[mainId]) return [ARTIST_DICTIONARY[mainId]];
  }

  // 1. Complex overrides
  const complexMatch = ARTIST_COMPLEX_OVERRIDES.find(c => prepareString(c.match) === raw);
  if (complexMatch) {
    return complexMatch.ids.map(id => ARTIST_DICTIONARY[id]).filter(Boolean);
  }

  // 2. High-power split
  const SEPARATORS = /\s*(?:&|x|feat\.?|with|、|\/|,\s|丨|(?:\s-\s)|(?:\s\s+))\s*/i;
  const parts = raw.split(SEPARATORS).map(p => prepareString(p)).filter(Boolean);

  const results: NormalizedArtist[] = [];
  const seenIds = new Set<string>();
  let hasDictionaryArtist = false;

  for (const part of parts) {
    const dictionarySearchKey = part.replace(/[（(].*?[）)]/g, '').trim();

    const lookup = (s: string) => {
      const lower = s.toLowerCase();
      const hyphenated = lower.replace(/\s+/g, '-');
      if (aliasMap[s]) return aliasMap[s];
      return ARTIST_DICTIONARY[lower] ? lower : (ARTIST_DICTIONARY[hyphenated] ? hyphenated : undefined);
    };

    const mainId = lookup(part) || lookup(dictionarySearchKey);

    if (mainId && ARTIST_DICTIONARY[mainId]) {
      const artist = ARTIST_DICTIONARY[mainId];
      if (!seenIds.has(artist.id)) {
        results.push(artist);
        seenIds.add(artist.id);
        hasDictionaryArtist = true;
      }
    } else {
      const dynamicId = `dyn-${part.replace(/\s+/g, '-').toLowerCase()}`;
      if (!seenIds.has(dynamicId)) {
        results.push({
          id: dynamicId,
          names: { zhHans: part, en: part },
          type: 'unknown',
          nationality: inferDynamicNationality(part),
        });
        seenIds.add(dynamicId);
      }
    }
  }

  if (hasDictionaryArtist && results.length > 1) {
    const filtered = results.filter(a => !a.id.startsWith('dyn-'));
    if (filtered.length > 0) return filtered;
  }

  return results;
};

/** Integrity audit: known dictionary ids resolved from a free-form artist string (excludes dyn-*). */
export function auditArtistIdsFromString(raw: string | undefined | null): Set<string> {
  const ids = new Set<string>();
  if (!raw?.trim()) return ids;
  const single = lookupKnownArtistId(raw);
  if (single) ids.add(single);
  for (const a of normalizeAndExtractArtists(raw)) {
    if (!a.id.startsWith('dyn-')) ids.add(a.id);
  }
  return ids;
}
