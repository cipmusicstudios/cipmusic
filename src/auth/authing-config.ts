import type { GuardOptions } from '@authing/guard';
import { getAuthingSiteUiLang, mapSiteLangToAuthingLang } from './authing-site-locale';

/** 开发环境调试日志（生产环境不输出）。 */
export function authingDevLog(...args: unknown[]) {
  if (import.meta.env.DEV) console.log('[Authing]', ...args);
}

/** 前端可公开的 Guard 初始化参数（不要在此放 secret）。 */
export function isAuthingConfigured(): boolean {
  const id = import.meta.env.VITE_AUTHING_APP_ID;
  return typeof id === 'string' && id.trim().length > 0;
}

function trimOpt(v: string | undefined): string | undefined {
  if (v == null) return undefined;
  const t = v.trim();
  return t || undefined;
}

/** Authing 控制台「应用域名」，勿带末尾 / */
function normalizeHost(host: string | undefined): string | undefined {
  if (!host) return undefined;
  return host.replace(/\/+$/, '');
}

/**
 * Guard 在 getPublicConfig / trackSession 等步骤会请求 Authing；失败常见原因见日志。
 */
export function authingNetworkHint(err: unknown): void {
  if (!import.meta.env.DEV) return;
  const msg = err instanceof Error ? err.message : String(err);
  if (!/fetch|network|Failed to fetch/i.test(msg)) return;
  console.warn(
    '[Authing] 请求 Authing 失败（Failed to fetch）。请检查：\n' +
      '1) .env 中 VITE_AUTHING_APP_HOST 是否为控制台「应用域名」完整 URL（如 https://你的租户.authing.cn），勿写错协议或域名；\n' +
      '2) VITE_AUTHING_APP_ID 是否与控制台一致；\n' +
      '3) 本机网络 / 代理 / 广告拦截是否拦截了对 *.authing.cn 的请求；\n' +
      '4) 修改 .env 后需重启 vite dev server。',
  );
}

/**
 * 供 GuardProvider 使用；未配置 appId 时返回 null（应用仍可运行，仅无 Authing）。
 */
export function getAuthingGuardOptions(): GuardOptions | null {
  const appId = trimOpt(import.meta.env.VITE_AUTHING_APP_ID);
  if (!appId) return null;

  const host = normalizeHost(trimOpt(import.meta.env.VITE_AUTHING_APP_HOST));
  const redirectFromEnv = trimOpt(import.meta.env.VITE_AUTHING_REDIRECT_URI);
  let redirectUri =
    redirectFromEnv ?? (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '');

  if (import.meta.env.DEV && redirectFromEnv && typeof window !== 'undefined') {
    try {
      if (new URL(redirectFromEnv).origin !== window.location.origin) {
        const fallback = `${window.location.origin}${window.location.pathname}`;
        console.warn(
          '[Authing] VITE_AUTHING_REDIRECT_URI 与当前页面 origin 不一致（例如 dev 改用了 3001）。已改用当前地址：',
          fallback,
          '请在 Authing 控制台「登录回调 URL」中加入该地址。',
        );
        redirectUri = fallback;
      }
    } catch {
      /* ignore */
    }
  }

  const langRaw = trimOpt(import.meta.env.VITE_AUTHING_LANG);
  const lang = (langRaw ?? mapSiteLangToAuthingLang(getAuthingSiteUiLang())) as GuardOptions['lang'];

  const opts: GuardOptions = {
    appId,
    host,
    redirectUri: redirectUri || undefined,
    /** 默认嵌入/弹层用 normal；若运行时走 startWithRedirect 仍由 Guard 内部处理 */
    mode: 'normal',
    defaultScene: 'login',
    config: {},
    lang,
  };

  if (import.meta.env.DEV && !host) {
    console.warn(
      '[Authing] 未设置 VITE_AUTHING_APP_HOST。若出现 getPublicConfig Failed to fetch，请在 .env 中设置控制台「应用域名」。',
    );
  }

  return opts;
}
