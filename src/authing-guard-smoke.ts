/**
 * Authing Guard 最小复现入口：仅被 authing-smoke.html 引用。
 * 禁止 import authing-provider / 任何单例；opts 仅来自 import.meta.env。
 */

import type { GuardOptions } from '@authing/guard';

const out = document.getElementById('out')!;
const btnRedirect = document.getElementById('btn-redirect')!;
const btnEmbed = document.getElementById('btn-embed')!;

function append(line: string) {
  out.textContent += `${line}\n`;
}

function optsFromEnv(): GuardOptions | null {
  const appId = import.meta.env.VITE_AUTHING_APP_ID?.trim();
  if (!appId) return null;
  const host = import.meta.env.VITE_AUTHING_APP_HOST?.trim().replace(/\/+$/, '');
  const redirectRaw = import.meta.env.VITE_AUTHING_REDIRECT_URI?.trim();
  let redirectUri = redirectRaw || `${window.location.origin}${window.location.pathname}`;
  if (redirectRaw) {
    try {
      if (new URL(redirectRaw).origin !== window.location.origin) {
        redirectUri = `${window.location.origin}${window.location.pathname}`;
      }
    } catch {
      /* ignore */
    }
  }
  const langRaw = import.meta.env.VITE_AUTHING_LANG?.trim();
  const opts: GuardOptions = {
    appId,
    host: host || undefined,
    redirectUri,
    mode: 'normal',
    defaultScene: 'login',
    config: {},
  };
  if (langRaw) {
    (opts as GuardOptions & { lang?: string }).lang = langRaw as GuardOptions['lang'];
  }
  return opts;
}

async function runSmoke(which: 'redirect' | 'embed') {
  out.textContent = '';
  const opts = optsFromEnv();
  if (!opts) {
    append('错误：缺少 VITE_AUTHING_APP_ID，请在 .env 配置后重启 vite。');
    console.error('[Authing smoke] missing VITE_AUTHING_APP_ID');
    return;
  }

  append(`[${which}] ① 动态 import guard.min.css + @authing/guard（仅此文件内，无 Provider）`);
  await import('@authing/guard/dist/esm/guard.min.css');
  const mod = await import('@authing/guard');
  const { Guard } = mod;

  append(`[${which}] ② new Guard(opts)，opts.appId=${opts.appId.slice(0, 8)}…`);
  const instance = new Guard(opts);

  const ctor = instance.constructor;
  const ctorName = ctor?.name ?? String(ctor);
  const proto = Object.getPrototypeOf(instance);
  const protoNames = proto ? Object.getOwnPropertyNames(proto) : [];

  append(`[${which}] ③ constructor.name = ${ctorName}`);
  append(`[${which}] ④ Object.getOwnPropertyNames(Object.getPrototypeOf(instance))（${protoNames.length} 个）:`);
  append(protoNames.join(', '));

  const isGuard = instance instanceof Guard;
  append(`[${which}] ⑤ instance instanceof Guard = ${isGuard}`);
  append(`[${which}] ⑥ typeof instance.startWithRedirect = ${typeof instance.startWithRedirect}`);
  append(`[${which}] ⑦ typeof instance.start = ${typeof instance.start}`);
  append(`[${which}] ⑧ typeof instance.startRegister = ${typeof instance.startRegister}`);

  console.log('[Authing smoke] 同一 instance 引用', instance);
  console.log('[Authing smoke] constructor.name', ctorName);
  console.log('[Authing smoke] instanceof Guard', isGuard);
  console.log('[Authing smoke] prototype method names', protoNames);

  append(`[${which}] ⑨ 同一 instance 上调用（which=${which}）…`);
  try {
    if (which === 'redirect') {
      if (typeof instance.startWithRedirect !== 'function') {
        append('未调用：instance.startWithRedirect 不是 function，请改用「start(容器)」按钮或检查打包产物。');
        console.warn('[Authing smoke] skip startWithRedirect');
        return;
      }
      console.log('[Authing smoke] await instance.startWithRedirect()');
      await instance.startWithRedirect();
      append('startWithRedirect() promise 已 settle（若页面未跳转请看 Console 是否报错）。');
    } else {
      if (typeof instance.start !== 'function') {
        append('未调用：instance.start 不是 function');
        return;
      }
      let host = document.getElementById('__authing_smoke_host') as HTMLElement | null;
      if (!host) {
        host = document.createElement('div');
        host.id = '__authing_smoke_host';
        host.style.cssText =
          'position:fixed;inset:0;z-index:2147483647;display:block;pointer-events:auto;';
        document.body.appendChild(host);
      }
      console.log('[Authing smoke] await instance.start(host, true)', host);
      await instance.start(host, true);
      append('start(host, true) promise 已 settle（应出现 Guard UI）。');
    }
  } catch (e) {
    append(`调用异常（原样）: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    console.error('[Authing smoke] invoke error', e);
  }
}

btnRedirect.addEventListener('click', () => {
  void runSmoke('redirect');
});

btnEmbed.addEventListener('click', () => {
  void runSmoke('embed');
});
