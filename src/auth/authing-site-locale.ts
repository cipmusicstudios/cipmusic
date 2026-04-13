import type { Lang } from '@authing/guard';

/** App TopNav `languages.name`：English / \u7b80\u4f53\u4e2d\u6587 / \u7e41\u9ad4\u4e2d\u6587 */
export const AUTHING_SITE_LANG_DEFAULT = 'English';

let siteUiLang = AUTHING_SITE_LANG_DEFAULT;

export function setAuthingSiteUiLang(lang: string): void {
  siteUiLang = lang?.trim() || AUTHING_SITE_LANG_DEFAULT;
}

export function getAuthingSiteUiLang(): string {
  return siteUiLang;
}

export function mapSiteLangToAuthingLang(site: string): Lang {
  const map: Record<string, Lang> = {
    English: 'en-US' as Lang,
    '\u7b80\u4f53\u4e2d\u6587': 'zh-CN' as Lang,
    '\u7e41\u9ad4\u4e2d\u6587': 'zh-TW' as Lang,
  };
  return map[site] ?? ('en-US' as Lang);
}

export function authingModalCloseLabel(siteLang: string): string {
  if (siteLang === '\u7b80\u4f53\u4e2d\u6587') return '\u5173\u95ed';
  if (siteLang === '\u7e41\u9ad4\u4e2d\u6587') return '\u95dc\u9589';
  return 'Close';
}
