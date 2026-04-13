/**
 * One-off: iTunes Search → mzstatic 600×600 for cover pilot batch-28-nocover.json
 * Run: node scripts/build-cover-pilot-28-apple.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'config/cover-pilot-batch-28-nocover.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const to600 = (u) =>
  u
    ?.replace(/\/\d+x\d+bb\.(jpg|webp)$/i, '/600x600bb.$1')
    .replace(/100x100bb\.jpg$/i, '600x600bb.jpg');

/** slug → search query (best-effort after artist overrides) */
const ROWS = [
  { slug: 'Mantra', q: 'JENNIE Mantra', cat: 'placeholder' },
  { slug: '于深空见证的', q: '张韶涵 于深空见证的', cat: 'placeholder' },
  { slug: '以无旁骛之吻', q: '周深 以无旁骛之吻', cat: 'placeholder' },
  { slug: '你离开的村落', q: '纸嫁衣 你离开的村落', cat: 'ost_project' },
  { slug: '借过一下', q: '周深 借过一下', cat: 'placeholder' },
  { slug: '古蜀回想', q: 'INTO1 古蜀回想', cat: 'placeholder' },
  { slug: '在故事的最终', q: '张碧晨 在故事的最终', cat: 'placeholder' },
  { slug: '寂静之忆', q: '希林娜依高 寂静之忆', cat: 'placeholder' },
  { slug: '岁月里的花', q: '莫文蔚 岁月里的花', cat: 'placeholder' },
  { slug: '幻化成花', q: '指田郁也 幻化成花', cat: 'placeholder' },
  { slug: '抬起头啊', q: '时代少年团 抬起头来', cat: 'placeholder' },
  { slug: '新时代 冬奥运', q: 'INTO1 新时代', cat: 'placeholder' },
  { slug: '无人乐园', q: '王俊凯 无人乐园', cat: 'placeholder' },
  { slug: '春天对花所做的事', q: '希林娜依高 春天对花所做的事', cat: 'placeholder' },
  { slug: '晨光里有你', q: '华晨宇 晨光里有你', cat: 'placeholder' },
  { slug: '爱到1440', q: '时代少年团 爱到1440', cat: 'placeholder' },
  { slug: '爱错', q: '王力宏 爱错', cat: 'placeholder' },
  { slug: '理想之途', q: '时代少年团 理想之途', cat: 'placeholder' },
  { slug: '登顶', q: '时代少年团 登顶', cat: 'placeholder' },
  { slug: '百忧戒', q: '时代少年团 百忧戒', cat: 'placeholder' },
  { slug: '约定之初', q: '光与夜之恋 约定之初', cat: 'ost_project' },
  { slug: '背对地球奔跑', q: '时代少年团 背对地球奔跑', cat: 'placeholder' },
  { slug: '若想念飞行', q: '马嘉祺 若想念飞行', cat: 'placeholder' },
  /** 封面用团单曲；艺人展示已改为马嘉祺（overrides）。 */
  { slug: '蜉蝣', q: '时代少年团 蜉蝣', cat: 'placeholder' },
  { slug: '那些我没说的话', q: '时代少年团 那些我没说的话', cat: 'placeholder' },
  { slug: '镜花水月', q: '张真源 镜花水月', cat: 'placeholder' },
  {
    slug: '黑神话悟空主题曲',
    q: '黑神话悟空',
    cat: 'ost_project',
  },
];

async function search(term, country = 'cn') {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=8&country=${country}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'AuraSounds-cover-batch28/1.0' } });
  const text = await res.text();
  if (!text.trim().startsWith('{')) return null;
  return JSON.parse(text);
}

async function main() {
  const entries = [];
  for (const row of ROWS) {
    await sleep(450);
    let payload = await search(row.q, 'cn');
    let hit = payload?.results?.find((r) => r.artworkUrl100);
    if (!hit) {
      await sleep(450);
      payload = await search(row.q, 'us');
      hit = payload?.results?.find((r) => r.artworkUrl100);
    }
    if (!hit) {
      console.error('[batch28] MISS', row.slug, row.q);
      continue;
    }
    const cover = to600(hit.artworkUrl100);
    if (!cover) {
      console.error('[batch28] NO600', row.slug);
      continue;
    }
    entries.push({
      slug: row.slug,
      pilotCategory: row.cat,
      cover,
      coverSource: 'apple',
      coverLocked: false,
      coverUncertain: false,
      officialSource: 'appleMusic',
      officialStatus: 'confirmed',
      reason: `用户指定艺人/标题后 iTunes 检索：${hit.artistName} — ${hit.trackName}（query=${JSON.stringify(row.q)}）`,
    });
    console.log('[batch28]', row.slug, 'OK');
  }

  const cfg = {
    version: 1,
    batchLabel: 'Cover pilot batch 28 — remaining no-cover (Apple Music artwork)',
    description:
      '28 首无封面队列：排除已删「不想你离开啊」；overrides 已更新艺人；封面来自 iTunes Search。',
    entries,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  console.log('[batch28] wrote', entries.length, 'entries →', path.relative(ROOT, OUT));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
