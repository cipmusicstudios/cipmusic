/**
 * 只读校验：检查 data/video-overrides.json（不写回、不改 manifest / 默认 videoUrl）。
 * 用于确认「pending 批量写回」后状态；勿当作写入工具。
 *
 * npx tsx scripts/verify-bilibili-video-overrides-readonly.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const OVERRIDES = path.join(projectRoot, 'data', 'video-overrides.json');

/** 上轮人工确认的 BV（仅用于校验 ZhHans 链接是否仍一致） */
const EXPECTED_ZH_BV: Record<string, string> = {
  珠玉: 'BV1NmjRzoEyj',
  向阳而生: 'BV1Z8411P7NZ',
  向阳而生日出版: 'BV18C411j77J',
  可: 'BV1ML4y1A7dD',
  爱你: 'BV12t4y1s7R8',
  'still life': 'BV1cF411G7yJ',
  'feel my rhythm': 'BV1c94y1f7ky',
  tomboy: 'BV1e34y1t71Q',
  渐暖: 'BV1ga41117XQ',
  相遇: 'BV1944y1p72S',
  花落时相遇: 'BV1ih411x7GG',
  好想我回来啊: 'BV1Yi4y1Z7UC',
  孤勇者: 'BV1Wv411M7je',
  shine: 'BV1yQ4y1i7U5',
  尾号6208: 'BV1kq4y1S7Ww',
  风暴眼: 'BV1Ao4y1U76j',
  你的名字是: 'BV1fQ4y1f7sV',
  溯: 'BV1tM4y1M74n',
  INTO1: 'BV1aQ4y1Z7zx',
  晴天: 'BV1j5411K7RK',
};

function bvidInUrl(url: string): string | null {
  const m = String(url).match(/(BV[\w]+)/);
  return m ? m[1] : null;
}

function main() {
  if (!fs.existsSync(OVERRIDES)) {
    console.error('缺少', OVERRIDES);
    process.exit(1);
  }

  const doc = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')) as {
    entries?: Array<Record<string, unknown>>;
    pendingReview?: Array<{ reason?: string; items?: unknown[] }>;
  };

  const issues: string[] = [];
  const entries = doc.entries || [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if ('videoUrl' in e) issues.push(`entries[${i}] 含禁止字段 videoUrl`);
  }

  const mergePending = doc.pendingReview?.find(p => p.reason === 'bilibili_offline_merge');
  if (mergePending?.items?.length) {
    issues.push(
      `仍存在 pendingReview.bilibili_offline_merge（${mergePending.items.length} 条），若为新批次请另案处理，勿误跑旧 apply 脚本。`,
    );
  }

  const slugToZh = new Map<string, string>();
  for (const e of entries) {
    const keys = (e.slugKeys as string[] | undefined) || [];
    const zh = e.videoUrlZhHans as string | undefined;
    if (!zh) continue;
    for (const k of keys) {
      const slug = String(k).trim();
      if (!slug) continue;
      if (slugToZh.has(slug) && slugToZh.get(slug) !== zh) {
        issues.push(`slug「${slug}」对应多条不同的 videoUrlZhHans`);
      }
      slugToZh.set(slug, zh);
    }
  }

  for (const [slug, expectBv] of Object.entries(EXPECTED_ZH_BV)) {
    const url = slugToZh.get(slug);
    if (!url) {
      issues.push(`期望校验的 slug「${slug}」未找到带 videoUrlZhHans 的条目`);
      continue;
    }
    const got = bvidInUrl(url);
    if (got !== expectBv) {
      issues.push(`slug「${slug}」BV 期望 ${expectBv}，实际 ${got ?? url}`);
    }
  }

  const report = {
    mode: 'readonly',
    overridesPath: OVERRIDES,
    entryCount: entries.length,
    hasForbiddenVideoUrlField: issues.some(m => m.includes('videoUrl')),
    bilibiliOfflineMergePendingCount: mergePending?.items?.length ?? 0,
    expectedZhSlugChecks: Object.keys(EXPECTED_ZH_BV).length,
    issues,
    ok: issues.length === 0,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
