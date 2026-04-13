/**
 * 游客「立即注册 / 登录」跳转 URL。
 * 在环境变量中配置（见 .env.example）；未配置时由调用方决定 fallback（如 Dev Preview 切到 basic）。
 */
export function getAuthSignupUrl(): string {
  const v = import.meta.env.VITE_AUTH_SIGNUP_URL;
  return typeof v === 'string' ? v.trim() : '';
}

export function getAuthLoginUrl(): string {
  const v = import.meta.env.VITE_AUTH_LOGIN_URL;
  return typeof v === 'string' ? v.trim() : '';
}

/** 在新标签页打开；url 为空则返回 false。 */
export function openAuthUrlInNewTab(url: string): boolean {
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
