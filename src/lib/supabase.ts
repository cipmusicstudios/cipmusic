import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

/**
 * 是否已配置可用于登录与 API 的 Supabase 环境变量（仅使用 VITE_SUPABASE_ANON_KEY，勿用 service_role）。
 * 在项目根目录 `.env.local` 中配置；拒绝明显占位，避免 OAuth 指向错误站点。
 */
export function isSupabaseConfigured(): boolean {
  if (!rawUrl || !rawKey) return false;
  const u = rawUrl.toLowerCase();
  if (u.includes('invalid-env-not-configured')) return false;
  if (/^placeholder/i.test(rawKey) || rawKey === 'placeholder-anon') return false;
  return true;
}

if (!isSupabaseConfigured()) {
  console.error(
    '[AuraSounds] Supabase: add project root `.env.local` with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (anon only). Restart dev/preview server after saving.',
  );
}

/** 未配置时使用不可解析占位，避免误用本地/CI 的 placeholder 域名发起 OAuth */
const resolvedUrl = isSupabaseConfigured() ? rawUrl : 'https://invalid-env-not-configured.local';
const resolvedKey = isSupabaseConfigured()
  ? rawKey
  : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyZWYiOiJpbnZhbGlkLWVudiJ9.invalid-not-a-real-key';

export const supabase = createClient(resolvedUrl, resolvedKey);
