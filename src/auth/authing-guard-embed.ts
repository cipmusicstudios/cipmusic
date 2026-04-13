/**
 * 关闭钮在 body 上 fixed。每次布局在弹窗已打开的真实 DOM 上解析「白卡」包围盒（优先 #shell，
 * Guard 尚未撑开时回退 mount 内 .authing-g2-render-module 等），再贴右上角；并用 RO/MO/连帧
 * 覆盖 Guard 异步渲染导致的首次测量条带高度错误。
 */

import type { GuardOptions, User } from '@authing/guard';
import { authingDevLog, getAuthingGuardOptions } from './authing-config';
import {
  authingModalCloseLabel,
  getAuthingSiteUiLang,
  mapSiteLangToAuthingLang,
  setAuthingSiteUiLang,
} from './authing-site-locale';

export const AUTHING_MAIN_EMBED_HOST_ID = '__authing_main_guard_host';

/**
 * 全屏 host 不可高于 Ant/rc 下拉（常见 1050–1150），否则语言菜单 portal 画在 host 下面无法点击。
 * 关闭钮须高于下拉，避免被盖住。
 */
const EMBED_Z_INDEX_HOST = 800;
const EMBED_Z_INDEX_CLOSE = 1250;

const EMBED_BACKDROP_ID = '__authing_main_embed_backdrop';
const EMBED_CARD_WRAP_ID = '__authing_main_embed_card_wrap';
const EMBED_SHELL_ID = '__authing_main_embed_shell';
const EMBED_GUARD_MOUNT_ID = '__authing_main_embed_guard_mount';
const EMBED_CLOSE_BTN_ID = '__authing_main_embed_close_btn';

const CLOSE_BTN_PX = 28;
const CLOSE_CORNER_TOP_PX = 28;
const CLOSE_CORNER_RIGHT_PX = 22;

/** shell 已展开时认为可信的最小尺寸（px） */
const LIVE_SHELL_MIN_W = 180;
const LIVE_SHELL_MIN_H = 120;
/** 回退节点（Guard 根 / 视图容器）最小尺寸 */
const LIVE_FALLBACK_MIN_W = 160;
const LIVE_FALLBACK_MIN_H = 100;

function builtinModalCloseHideCss(): string {
  return `
#${AUTHING_MAIN_EMBED_HOST_ID} button.g2-modal-close,
#${AUTHING_MAIN_EMBED_HOST_ID} .g2-modal-close {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
  width: 0 !important;
  height: 0 !important;
  overflow: hidden !important;
}
`.trim();
}

/** 语言下拉面若在 mount 内或全局 portal，抬高 z-index，避免仍低于关闭钮或 host 子层叠上下文 */
function guardEmbedLanguageMenuCss(): string {
  const z = EMBED_Z_INDEX_CLOSE + 50;
  return `
.g2-change-language-menu,
.g2-change-language-container .g2-change-language-menu {
  z-index: ${z} !important;
}
`.trim();
}

export const AUTHING_GUARD_LOGIN_EVENT = 'authing:guard-login';

export { setAuthingSiteUiLang, getAuthingSiteUiLang } from './authing-site-locale';

function embedLog(...args: unknown[]) {
  console.log('[Authing main embed]', ...args);
}

function perfMark(label: string, t0: number) {
  embedLog(`[embed perf] ${label}`, { msFromOpen: Math.round((performance.now() - t0) * 10) / 10 });
}

let embedVisibilityCleanup: (() => void) | null = null;
let embedLangDebugCleanup: (() => void) | null = null;
let embedLangMenuDomMo: MutationObserver | null = null;

function clearEmbedAuxiliaryProbes() {
  if (embedVisibilityCleanup) {
    embedVisibilityCleanup();
    embedVisibilityCleanup = null;
  }
  if (embedLangDebugCleanup) {
    embedLangDebugCleanup();
    embedLangDebugCleanup = null;
  }
  if (embedLangMenuDomMo) {
    embedLangMenuDomMo.disconnect();
    embedLangMenuDomMo = null;
  }
}

function attachAuthingVisibleProbe(t0: number, mount: HTMLElement) {
  if (embedVisibilityCleanup) {
    embedVisibilityCleanup();
    embedVisibilityCleanup = null;
  }
  let done = false;
  const check = (): boolean => {
    const mod = mount.querySelector('.authing-g2-render-module');
    if (!mod) return false;
    const r = (mod as HTMLElement).getBoundingClientRect();
    return r.width >= 200 && r.height >= 80;
  };

  const finish = (reason: string) => {
    if (done) return;
    done = true;
    perfMark(`authing_content_visible (${reason})`, t0);
    cleanup();
  };

  const mo = new MutationObserver(() => {
    if (check()) finish('guard_mount_module_sized');
  });
  mo.observe(mount, { subtree: true, childList: true, attributes: true });

  const ro = new ResizeObserver(() => {
    if (check()) finish('guard_mount_resize');
  });
  ro.observe(mount);

  let rafN = 0;
  const rafPoll = () => {
    if (done) return;
    if (check()) {
      finish('raf_poll');
      return;
    }
    rafN += 1;
    if (rafN < 160) requestAnimationFrame(rafPoll);
  };
  requestAnimationFrame(rafPoll);

  function cleanup() {
    mo.disconnect();
    ro.disconnect();
    embedVisibilityCleanup = null;
  }

  embedVisibilityCleanup = cleanup;
}

function attachEmbedLangDebugProbes() {
  if (!import.meta.env.DEV) return;
  embedLangDebugCleanup?.();
  embedLangMenuDomMo?.disconnect();
  embedLangMenuDomMo = null;
  const onPointerDown = (e: Event) => {
    const t = e.target as HTMLElement | null;
    const hit = t?.closest?.('[class*="g2-change-language"]');
    if (hit) {
      embedLog('[embed debug] pointerdown on language UI', {
        className: (hit as HTMLElement).className?.toString?.()?.slice(0, 160),
      });
    }
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  embedLangDebugCleanup = () => document.removeEventListener('pointerdown', onPointerDown, true);

  embedLangMenuDomMo = new MutationObserver(records => {
    for (const r of records) {
      r.addedNodes.forEach(n => {
        if (n.nodeType !== Node.ELEMENT_NODE) return;
        const el = n as HTMLElement;
        const isMenu =
          el.classList?.contains('g2-change-language-menu') ||
          Boolean(el.querySelector?.('.g2-change-language-menu'));
        if (isMenu) {
          const menu =
            el.classList?.contains('g2-change-language-menu') ? el : (el.querySelector('.g2-change-language-menu') as HTMLElement);
          const cs = menu ? window.getComputedStyle(menu) : null;
          embedLog('[embed debug] language menu node added', {
            tag: el.tagName,
            className: el.className?.toString?.()?.slice(0, 120),
            menuZ: cs?.zIndex,
            menuRect: menu?.getBoundingClientRect(),
          });
        }
      });
    }
  });
  embedLangMenuDomMo.observe(document.body, { childList: true, subtree: true });
}

type EmbedDebugApi = { describe: () => Record<string, unknown> };

function setEmbedDebug(api: EmbedDebugApi | null) {
  const w = window as unknown as { __AUTHING_GUARD_EMBED_DEBUG?: EmbedDebugApi | null };
  w.__AUTHING_GUARD_EMBED_DEBUG = api;
}

let activeEmbedGuard: import('@authing/guard').Guard | null = null;
let activeEscapeHandler: ((e: KeyboardEvent) => void) | null = null;
let bodyOverflowBefore: string | null = null;

let closeLayoutRaf = 0;
let closeLayoutRO: ResizeObserver | null = null;
let closeLayoutMO: MutationObserver | null = null;
let closeLayoutWin: (() => void) | null = null;
let closeLayoutScroll: (() => void) | null = null;

function clearCloseLayoutWatchers() {
  if (closeLayoutRO) {
    closeLayoutRO.disconnect();
    closeLayoutRO = null;
  }
  if (closeLayoutMO) {
    closeLayoutMO.disconnect();
    closeLayoutMO = null;
  }
  if (closeLayoutWin) {
    window.removeEventListener('resize', closeLayoutWin);
    closeLayoutWin = null;
  }
  if (closeLayoutScroll) {
    document.removeEventListener('scroll', closeLayoutScroll, true);
    closeLayoutScroll = null;
  }
  if (closeLayoutRaf) {
    cancelAnimationFrame(closeLayoutRaf);
    closeLayoutRaf = 0;
  }
}

function rectArea(r: DOMRect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

/**
 * 主站运行时：从真实 DOM 取当前可见「白卡」外框（与 Guard 渲染阶段无关地重复调用）。
 */
function resolveLiveWhiteCardRect(): DOMRect | null {
  const shell = document.getElementById(EMBED_SHELL_ID);
  const mount = document.getElementById(EMBED_GUARD_MOUNT_ID);
  const wrap = document.getElementById(EMBED_CARD_WRAP_ID);

  if (shell) {
    const sr = shell.getBoundingClientRect();
    if (sr.width >= LIVE_SHELL_MIN_W && sr.height >= LIVE_SHELL_MIN_H) {
      return sr;
    }
  }

  const candidates: DOMRect[] = [];
  const push = (r: DOMRect, minW: number, minH: number) => {
    if (r.width >= minW && r.height >= minH) candidates.push(r);
  };

  if (wrap) push(wrap.getBoundingClientRect(), LIVE_FALLBACK_MIN_W, LIVE_FALLBACK_MIN_H);
  if (shell) push(shell.getBoundingClientRect(), LIVE_FALLBACK_MIN_W, LIVE_FALLBACK_MIN_H);
  if (mount) {
    push(mount.getBoundingClientRect(), LIVE_FALLBACK_MIN_W, LIVE_FALLBACK_MIN_H);
    const mod = mount.querySelector<HTMLElement>('.authing-g2-render-module');
    if (mod) push(mod.getBoundingClientRect(), LIVE_FALLBACK_MIN_W, LIVE_FALLBACK_MIN_H);
    const panel = mount.querySelector<HTMLElement>('.g2-view-container-2-login, .g2-view-container');
    if (panel) push(panel.getBoundingClientRect(),120, LIVE_FALLBACK_MIN_H);
  }

  let best: DOMRect | null = null;
  let bestA = 0;
  for (const r of candidates) {
    const a = rectArea(r);
    if (a > bestA) {
      bestA = a;
      best = r;
    }
  }
  return best;
}

function layoutCloseToLiveCard() {
  const btn = document.getElementById(EMBED_CLOSE_BTN_ID);
  if (!btn) return;
  const r = resolveLiveWhiteCardRect();
  if (!r || r.width < 80 || r.height < 60) return;

  const sz = CLOSE_BTN_PX;
  const topPx = r.top + CLOSE_CORNER_TOP_PX;
  const leftPx = r.right - CLOSE_CORNER_RIGHT_PX - sz;

  btn.style.setProperty('position', 'fixed', 'important');
  btn.style.setProperty('top', `${Math.round(topPx)}px`, 'important');
  btn.style.setProperty('left', `${Math.round(leftPx)}px`, 'important');
  btn.style.setProperty('right', 'auto', 'important');
  btn.style.setProperty('bottom', 'auto', 'important');
  btn.style.setProperty('margin', '0', 'important');
  btn.style.setProperty('z-index', String(EMBED_Z_INDEX_CLOSE), 'important');
}

function scheduleCloseLayout() {
  if (closeLayoutRaf) cancelAnimationFrame(closeLayoutRaf);
  closeLayoutRaf = requestAnimationFrame(() => {
    closeLayoutRaf = 0;
    layoutCloseToLiveCard();
  });
}

function burstScheduleCloseLayout(frames: number) {
  let n = 0;
  const tick = () => {
    scheduleCloseLayout();
    n += 1;
    if (n < frames) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function attachCloseFixedLayout(nodes: { cardWrap: HTMLElement; shell: HTMLElement; guardMount: HTMLElement }) {
  clearCloseLayoutWatchers();
  closeLayoutRO = new ResizeObserver(() => scheduleCloseLayout());
  closeLayoutRO.observe(nodes.cardWrap);
  closeLayoutRO.observe(nodes.shell);
  closeLayoutRO.observe(nodes.guardMount);

  closeLayoutMO = new MutationObserver(() => scheduleCloseLayout());
  closeLayoutMO.observe(nodes.guardMount, { childList: true, subtree: true });

  closeLayoutWin = () => scheduleCloseLayout();
  closeLayoutScroll = () => scheduleCloseLayout();
  window.addEventListener('resize', closeLayoutWin);
  document.addEventListener('scroll', closeLayoutScroll, true);
  scheduleCloseLayout();
}

function removeEscapeListener() {
  if (activeEscapeHandler) {
    document.removeEventListener('keydown', activeEscapeHandler);
    activeEscapeHandler = null;
  }
}

function restoreBodyScroll() {
  if (bodyOverflowBefore !== null) {
    document.body.style.overflow = bodyOverflowBefore;
    bodyOverflowBefore = null;
  }
}

function destroyAuthingMainEmbed(from?: string) {
  const hadSomething = Boolean(activeEmbedGuard || document.getElementById(AUTHING_MAIN_EMBED_HOST_ID));
  if (hadSomething || (from && from !== 'reopen: teardown previous')) {
    embedLog('destroyAuthingMainEmbed', { from: from ?? 'unknown' });
  }
  removeEscapeListener();
  clearCloseLayoutWatchers();
  clearEmbedAuxiliaryProbes();
  restoreBodyScroll();

  if (activeEmbedGuard) {
    try {
      activeEmbedGuard.unmount();
    } catch {
      /* ignore */
    }
    activeEmbedGuard = null;
  }

  const host = document.getElementById(AUTHING_MAIN_EMBED_HOST_ID);
  if (host?.parentNode) {
    host.parentNode.removeChild(host);
  }
  const floatingClose = document.getElementById(EMBED_CLOSE_BTN_ID);
  if (floatingClose?.parentNode) {
    floatingClose.parentNode.removeChild(floatingClose);
  }
  setEmbedDebug(null);
}

export function syncAuthingGuardEmbedLangFromSite(): void {
  const site = getAuthingSiteUiLang();
  const authingLang = mapSiteLangToAuthingLang(site);
  const embedOpen = Boolean(activeEmbedGuard);
  embedLog('sync authing lang ->', { site, authingLang, embedOpen });
  if (!activeEmbedGuard) return;
  try {
    activeEmbedGuard.changeLang(authingLang);
    embedLog('sync authing lang -> changeLang() invoked', authingLang);
  } catch (e) {
    embedLog('sync authing lang -> changeLang() failed', e);
  }
}

function buildFloatingCloseButton(requestClose: (reason: string) => void): HTMLButtonElement {
  const closeLabel = authingModalCloseLabel(getAuthingSiteUiLang());
  const closeBtn = document.createElement('button');
  closeBtn.id = EMBED_CLOSE_BTN_ID;
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', closeLabel);
  closeBtn.setAttribute('data-authing-embed', 'floating-close');
  closeBtn.textContent = '\u00d7';
  const sz = CLOSE_BTN_PX;
  closeBtn.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    `width:${sz}px`,
    `height:${sz}px`,
    'margin:0',
    'padding:0',
    'border:1px solid rgba(15,23,42,0.12)',
    'border-radius:9999px',
    'cursor:pointer',
    'font-size:16px',
    'line-height:1',
    'display:flex',
    'visibility:visible',
    'opacity:1',
    'align-items:center',
    'justify-content:center',
    'color:rgba(15,23,42,0.55)',
    'background:#fff',
    'box-shadow:0 2px 8px rgba(0,0,0,0.12)',
    'pointer-events:auto',
  ].join(';');
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.background = '#fafafa';
    closeBtn.style.color = 'rgba(15,23,42,0.8)';
  });
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.background = '#fff';
    closeBtn.style.color = 'rgba(15,23,42,0.55)';
  });
  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    embedLog('close button click');
    requestClose('close button');
  });
  return closeBtn;
}

function buildModalShell(guardMount: HTMLElement): { backdrop: HTMLElement; cardWrap: HTMLElement; shell: HTMLElement } {
  const closeLabel = authingModalCloseLabel(getAuthingSiteUiLang());

  const backdrop = document.createElement('div');
  backdrop.id = EMBED_BACKDROP_ID;
  backdrop.setAttribute('data-authing-embed', 'backdrop');
  backdrop.style.cssText = [
    'position:absolute',
    'inset:0',
    'z-index:0',
    'pointer-events:auto',
    'background:rgba(15,23,42,0.45)',
    'backdrop-filter:blur(6px)',
    '-webkit-backdrop-filter:blur(6px)',
  ].join(';');

  const cardWrap = document.createElement('div');
  cardWrap.id = EMBED_CARD_WRAP_ID;
  cardWrap.setAttribute('data-authing-embed', 'card-wrap');
  cardWrap.style.cssText = [
    'position:relative',
    'z-index:1',
    'pointer-events:auto',
    'width:min(440px,calc(100vw - 48px))',
    'max-height:min(90vh,720px)',
    'display:flex',
    'flex-direction:column',
    'flex-shrink:0',
    'box-sizing:border-box',
  ].join(';');

  const shell = document.createElement('div');
  shell.id = EMBED_SHELL_ID;
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-modal', 'true');
  shell.setAttribute('aria-label', closeLabel);
  shell.setAttribute('data-authing-embed', 'shell');
  shell.style.cssText = [
    'position:relative',
    'flex:1',
    'min-height:0',
    'width:100%',
    'display:flex',
    'flex-direction:column',
    'align-items:stretch',
    'border-radius:16px',
    'background:rgba(255,255,255,0.96)',
    'box-shadow:0 25px 50px -12px rgba(0,0,0,0.35)',
    'border:1px solid rgba(255,255,255,0.35)',
    'overflow:visible',
    'pointer-events:auto',
    'box-sizing:border-box',
  ].join(';');

  const stopShellBubble = (e: MouseEvent) => {
    e.stopPropagation();
  };
  shell.addEventListener('mousedown', stopShellBubble);
  shell.addEventListener('click', stopShellBubble);

  guardMount.id = EMBED_GUARD_MOUNT_ID;
  guardMount.setAttribute('data-authing-embed', 'guard-root');
  guardMount.style.cssText = [
    'flex:1',
    'min-height:0',
    'width:100%',
    'overflow:auto',
    'pointer-events:auto',
    'box-sizing:border-box',
  ].join(';');

  shell.appendChild(guardMount);
  cardWrap.appendChild(shell);

  return { backdrop, cardWrap, shell };
}

function ensureMainEmbedHost(): HTMLElement {
  destroyAuthingMainEmbed('reopen: teardown previous');

  const host = document.createElement('div');
  host.id = AUTHING_MAIN_EMBED_HOST_ID;
  host.setAttribute('data-authing-guard-host', 'main');
  host.style.cssText = [
    'position:fixed',
    'inset:0',
    `z-index:${EMBED_Z_INDEX_HOST}`,
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:24px',
    'box-sizing:border-box',
    'pointer-events:none',
  ].join(';');

  document.body.appendChild(host);
  embedLog('host created', { id: AUTHING_MAIN_EMBED_HOST_ID });
  return host;
}

export async function openAuthingGuardEmbed(intent: 'login' | 'register'): Promise<void> {
  const t0 = performance.now();
  perfMark('openAuthingGuardEmbed_called (user action invoked this fn)', t0);
  embedLog('openAuthingGuardEmbed called', { intent });

  const base = getAuthingGuardOptions();
  if (!base) {
    console.warn('[Authing main embed] aborted: no VITE_AUTHING_APP_ID / getAuthingGuardOptions null');
    authingDevLog('openAuthingGuardEmbed: 未配置 VITE_AUTHING_APP_ID');
    return;
  }

  const prevCss = (base.config?.contentCSS as string | undefined) ?? '';
  const opts: GuardOptions = {
    ...base,
    config: {
      ...(base.config ?? {}),
      contentCSS: [prevCss, builtinModalCloseHideCss(), guardEmbedLanguageMenuCss()].filter(Boolean).join('\n'),
    },
    defaultScene: intent === 'register' ? 'register' : 'login',
    lang: mapSiteLangToAuthingLang(getAuthingSiteUiLang()),
  };

  perfMark('before_dynamic_import_guard_css', t0);
  await import('@authing/guard/dist/esm/guard.min.css');
  perfMark('after_dynamic_import_guard_css', t0);

  perfMark('before_dynamic_import_guard_js', t0);
  const { Guard } = await import('@authing/guard');
  perfMark('after_dynamic_import_guard_js', t0);

  ensureMainEmbedHost();
  perfMark('after_embed_host_mounted', t0);

  const guardMount = document.createElement('div');

  const requestClose = (reason: string) => {
    destroyAuthingMainEmbed(reason);
  };

  const { backdrop, cardWrap, shell } = buildModalShell(guardMount);
  const closeBtn = buildFloatingCloseButton(requestClose);

  backdrop.addEventListener('click', () => {
    requestClose('backdrop');
  });

  const host = document.getElementById(AUTHING_MAIN_EMBED_HOST_ID)!;
  host.appendChild(backdrop);
  host.appendChild(cardWrap);
  document.body.appendChild(closeBtn);

  attachCloseFixedLayout({ cardWrap, shell, guardMount });
  attachAuthingVisibleProbe(t0, guardMount);
  attachEmbedLangDebugProbes();

  setEmbedDebug({
    describe: () => {
      const h = document.getElementById(AUTHING_MAIN_EMBED_HOST_ID);
      if (!h) return { open: false };
      const btn = document.getElementById(EMBED_CLOSE_BTN_ID);
      return {
        open: true,
        closeButtonParentId: btn?.parentElement?.id ?? null,
      };
    },
  });

  bodyOverflowBefore = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  activeEscapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      requestClose('escape');
    }
  };
  document.addEventListener('keydown', activeEscapeHandler);

  perfMark('before_new_Guard', t0);
  const instance = new Guard(opts);
  perfMark('after_new_Guard', t0);
  activeEmbedGuard = instance;

  try {
    const instAny = instance as unknown as { on?: (ev: string, fn: () => void) => void };
    instAny.on?.('load', () => perfMark('guard_event_load', t0));
  } catch {
    /* ignore */
  }

  instance.on('login', (u: User) => {
    window.dispatchEvent(new CustomEvent<User>(AUTHING_GUARD_LOGIN_EVENT, { detail: u }));
    requestClose('login');
  });

  try {
    perfMark('before_Guard_start', t0);
    await instance.start(guardMount, true);
    perfMark('after_Guard_start_promise_resolved', t0);
    try {
      instance.changeContentCSS(String(opts.config?.contentCSS ?? ''));
      perfMark('after_changeContentCSS', t0);
    } catch {
      /* ignore */
    }
    burstScheduleCloseLayout(48);
    for (const ms of [0, 16, 50, 120, 280, 600]) {
      window.setTimeout(scheduleCloseLayout, ms);
    }
  } catch (e) {
    console.error('[Authing main embed] start failed', e);
    requestClose('start failed');
  }
}
