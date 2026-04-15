/**
 * Premium / Membership UI tokens — single source aligned with `SettingsTab` (Settings → Membership).
 * Do not duplicate these strings elsewhere; import from here.
 */
export const premiumUi = {
  /** Main column card — uses static acrylic (no backdrop-filter) for performance */
  card: 'glass-panel-static rounded-[32px] p-6',
  /** Nested row / benefit tile (matches `subtleCardClass`) */
  subtleCard: 'glass-tile rounded-[24px]',
  /** Section headings e.g. Membership, Account (matches `titleClass`) */
  title: 'text-[24px] font-semibold tracking-tight text-[var(--color-mist-text)]',
  /** Body copy on membership card (matches `bodyClass`) */
  body: 'text-sm leading-6 text-[var(--color-mist-text)]/72',
  /** Small caps lead e.g. “升级解锁” (matches premium feature lead line) */
  mutedLead: 'text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-mist-text)]/42',
  /** Benefit row title (matches benefit list item title) */
  benefitTitle: 'text-sm font-medium text-[var(--color-mist-text)]/84',
  /** Benefit row description */
  benefitDesc: 'mt-1 text-xs leading-5 text-[var(--color-mist-text)]/58',
  /** Icon chip in membership lists (matches `iconWrapClass`) */
  iconWrap: 'flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/14 bg-white/16 text-[var(--color-mist-text)]/60',
  /** Primary upgrade CTA — same as Settings “Upgrade Now” (`upgradeButtonClass`) */
  upgradeButton: 'inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(182,132,84,0.95),rgba(213,168,120,0.92))] px-6 text-[15px] font-semibold text-white shadow-[0_14px_30px_rgba(156,109,63,0.24)] transition-transform hover:translate-y-[-1px] hover:shadow-[0_18px_34px_rgba(156,109,63,0.28)]',
  /** Same gradient system as `upgradeButton`, for inline / compact CTAs (e.g. Pomodoro Start Session) */
  upgradeButtonCompact:
    'inline-flex items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(182,132,84,0.95),rgba(213,168,120,0.92))] px-8 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(156,109,63,0.24)] transition-transform hover:translate-y-[-1px] hover:shadow-[0_18px_34px_rgba(156,109,63,0.28)] active:scale-[0.98]',
  /** Secondary text / dismiss (matches logout-style weight; tuned for modal footer) */
  secondaryMuted: 'text-xs font-medium text-[var(--color-mist-text)]/54 transition-colors hover:bg-white/10 hover:text-[var(--color-mist-text)]/78 py-2 rounded-xl',
} as const;

/** Compact upgrade dialogs (Smart Radio / Practice) — same typography hierarchy as membership benefit block, with modal shell */
export const premiumUiModal = {
  /** Card + modal layout; motion wrapper adds relative + width */
  shell: `${premiumUi.card} relative flex w-full max-w-sm flex-col items-center gap-4 text-center sm:gap-5`,
  /** 更厚磨砂 + 更强实底 + 边缘高光：仅用于付费/练习提示弹窗卡体，勿当普通卡片用 */
  shellHeavy:
    'glass-modal-heavy relative flex w-full max-w-sm flex-col items-center gap-4 px-6 py-6 text-center sm:gap-5 sm:px-7 sm:py-7',
  /** Dialog title: between benefit title and section title — `text-xl` tracks readable modal scale */
  title: 'text-xl font-semibold tracking-tight text-[var(--color-mist-text)] antialiased',
  /** Description: same relationship as benefitDesc but body-sized */
  description: `${premiumUi.body} antialiased`,
} as const;
