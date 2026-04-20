/**
 * 审计脚本：在 Phase 1 上线前确认 songs 表里不存在以下脏数据组合：
 *   midi_url IS NOT NULL AND musicxml_url IS NOT NULL AND has_practice_mode = false
 *
 * 若存在此类行，前端改用 `has_practice_mode` 判定 Practice 按钮可见性后，
 * 这批歌会"凭空消失 Practice 按钮"——需要在上线前批量修复 has_practice_mode。
 *
 * 用法：
 *   tsx scripts/audit-practice-dirty-rows.ts
 * 依赖：SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY（或回退到 VITE_ 前缀）。
 */
import 'dotenv/config';
import {createClient} from '@supabase/supabase-js';

async function main() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    console.error('[audit] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const supa = createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}});

  /** 1) 脏组合：midi+musicxml 都有但 has_practice_mode=false */
  const dirty = await supa
    .from('songs')
    .select('id, slug, title, has_practice_mode, midi_url, musicxml_url', {count: 'exact'})
    .not('midi_url', 'is', null)
    .not('musicxml_url', 'is', null)
    .eq('has_practice_mode', false);

  /** 2) 反向：has_practice_mode=true 但 URL 缺失 —— broker 会 404，用户会看到灰按钮/报错 */
  const missingMidi = await supa
    .from('songs')
    .select('id, slug', {count: 'exact'})
    .eq('has_practice_mode', true)
    .is('midi_url', null);
  const missingXml = await supa
    .from('songs')
    .select('id, slug', {count: 'exact'})
    .eq('has_practice_mode', true)
    .is('musicxml_url', null);

  /** 3) 总量 baseline */
  const total = await supa.from('songs').select('id', {count: 'exact', head: true});
  const withFlag = await supa
    .from('songs')
    .select('id', {count: 'exact', head: true})
    .eq('has_practice_mode', true);

  console.log('=== Phase 1 pre-launch data audit ===');
  console.log(`songs total: ${total.count ?? 'unknown'}`);
  console.log(`has_practice_mode = true: ${withFlag.count ?? 'unknown'}`);
  console.log('');
  console.log('[Q1] midi_url NOT NULL AND musicxml_url NOT NULL AND has_practice_mode = false');
  console.log(`  rows: ${dirty.count ?? 'error'}`);
  if (dirty.error) console.error('  error:', dirty.error.message);
  if (dirty.data && dirty.data.length) {
    console.log('  sample (up to 10):');
    for (const row of dirty.data.slice(0, 10)) {
      console.log(`    - id=${row.id} slug=${row.slug} title=${row.title}`);
    }
  }
  console.log('');
  console.log('[Q2a] has_practice_mode = true but midi_url IS NULL');
  console.log(`  rows: ${missingMidi.count ?? 'error'}`);
  if (missingMidi.error) console.error('  error:', missingMidi.error.message);
  if (missingMidi.data && missingMidi.data.length) {
    for (const row of missingMidi.data.slice(0, 10)) {
      console.log(`    - id=${row.id} slug=${row.slug}`);
    }
  }
  console.log('');
  console.log('[Q2b] has_practice_mode = true but musicxml_url IS NULL');
  console.log(`  rows: ${missingXml.count ?? 'error'}`);
  if (missingXml.error) console.error('  error:', missingXml.error.message);
  if (missingXml.data && missingXml.data.length) {
    for (const row of missingXml.data.slice(0, 10)) {
      console.log(`    - id=${row.id} slug=${row.slug}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
