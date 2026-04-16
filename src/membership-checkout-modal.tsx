import {useEffect, useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {X} from 'lucide-react';
import {STRIPE_CHECKOUT_MONTHLY_URL, STRIPE_CHECKOUT_YEARLY_URL, isCheckoutUrlReady, openMembershipCheckoutUrl} from './checkout-links';
import {createZpayOrderCheckout, type CreateZpayOrderResult} from './lib/zpay-order';

export type UpgradeBillingCardCopy = {
  title: string;
  price: string;
  description: string;
  action: string;
};

export type UpgradeChannelCardCopy = {
  title: string;
  description: string;
  action: string;
};

/** English / 繁體中文：僅 Stripe 月付 + 年付 */
export type UpgradeModalCopyStripeOnly = {
  mode: 'stripe-only';
  title: string;
  subtitle: string;
  disclaimer: string;
  linkNotReadyHint: string;
  monthly: UpgradeBillingCardCopy;
  yearly: UpgradeBillingCardCopy;
};

/** 简体中文：第一层选支付方式，第二层选 Stripe 方案或微信时长 */
export type UpgradeModalCopyZhCN = {
  mode: 'zh-cn';
  disclaimer: string;
  linkNotReadyHint: string;
  zpayNeedLogin: string;
  zpayFailed: string;
  zpayFunctionUnavailable: string;
  zpayServiceNotConfigured: string;
  step1: {
    title: string;
    subtitle: string;
    international: UpgradeChannelCardCopy;
    wechat: UpgradeChannelCardCopy;
  };
  step2Intl: {
    title: string;
    subtitle: string;
    monthly: UpgradeBillingCardCopy;
    yearly: UpgradeBillingCardCopy;
  };
  step2Wechat: {
    title: string;
    subtitle: string;
    days30: UpgradeBillingCardCopy;
    days365: UpgradeBillingCardCopy;
  };
};

export type UpgradeModalCopy = UpgradeModalCopyStripeOnly | UpgradeModalCopyZhCN;

const choiceCardClass =
  'group flex h-full w-full min-h-0 flex-col rounded-[18px] border border-white/46 bg-[linear-gradient(168deg,rgba(255,252,248,0.98)_0%,rgba(246,240,233,0.95)_100%)] px-3 py-2.5 text-left shadow-[0_5px_16px_rgba(72,54,37,0.07)] transition-[background,box-shadow,border-color,opacity] duration-200 hover:border-white/58 hover:bg-[linear-gradient(168deg,rgba(255,254,252,0.99)_0%,rgba(250,245,238,0.97)_100%)] hover:shadow-[0_8px_20px_rgba(72,54,37,0.09)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(182,132,84,0.45)] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgba(238,230,224,0.9)] disabled:cursor-not-allowed disabled:opacity-[0.72] disabled:hover:border-white/46 disabled:hover:shadow-[0_5px_16px_rgba(72,54,37,0.07)]';

function tryOpenStripe(
  url: string,
  onClose: () => void,
  userId: string | null,
  onRequireLogin?: () => void,
) {
  if (!userId) {
    onRequireLogin?.();
    return;
  }
  if (!isCheckoutUrlReady(url)) {
    console.warn('[AuraSounds] Stripe URL not ready:', url);
    return;
  }
  openMembershipCheckoutUrl(url);
  onClose();
}

function BillingChoiceCard({
  card,
  stripeUrl,
  onClose,
  linkNotReadyHint,
  userId,
  onRequireLogin,
}: {
  card: UpgradeBillingCardCopy;
  stripeUrl: string;
  onClose: () => void;
  linkNotReadyHint: string;
  userId: string | null;
  onRequireLogin?: () => void;
}) {
  const ready = isCheckoutUrlReady(stripeUrl);
  return (
    <button
      type="button"
      disabled={!ready}
      onClick={() => tryOpenStripe(stripeUrl, onClose, userId, onRequireLogin)}
      className={choiceCardClass}
    >
      <span className="shrink-0 text-[15px] font-bold leading-snug tracking-tight text-[var(--color-mist-text)]/92">{card.title}</span>
      <span className="mt-1 shrink-0 text-[1.05rem] font-semibold leading-snug tracking-tight text-[var(--color-mist-text)]/88">
        {card.price}
      </span>
      <span className="mt-1 block min-h-[2.5rem] shrink-0 text-[13px] leading-snug text-[var(--color-mist-text)]/56">{card.description}</span>
      {!ready ? (
        <span className="mt-0.5 text-[10px] font-medium text-[var(--color-mist-text)]/45">{linkNotReadyHint}</span>
      ) : null}
      <span className="mt-auto self-end pt-1 text-[12px] font-semibold tracking-tight text-[rgba(140,108,72,0.92)] transition-colors group-hover:text-[rgba(120,88,58,0.98)]">
        {card.action}
      </span>
    </button>
  );
}

function ChannelChoiceCard({
  card,
  onClick,
}: {
  card: UpgradeChannelCardCopy;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={choiceCardClass}>
      <span className="shrink-0 text-[15px] font-bold leading-snug tracking-tight text-[var(--color-mist-text)]/92">{card.title}</span>
      <span className="mt-1 block min-h-[3.25rem] shrink-0 text-[13px] leading-snug text-[var(--color-mist-text)]/58">{card.description}</span>
      <span className="mt-auto self-end pt-1 text-[12px] font-semibold tracking-tight text-[rgba(140,108,72,0.92)] transition-colors group-hover:text-[rgba(120,88,58,0.98)]">
        {card.action}
      </span>
    </button>
  );
}

function zpayFailureUserMessage(
  result: Extract<CreateZpayOrderResult, {ok: false}>,
  copy: Pick<
    UpgradeModalCopyZhCN,
    'zpayNeedLogin' | 'zpayFailed' | 'zpayFunctionUnavailable' | 'zpayServiceNotConfigured'
  >,
): string {
  const c = result.code ?? result.error;
  if (c === 'AUTH_REQUIRED') return copy.zpayNeedLogin;
  if (c === 'FUNCTION_UNAVAILABLE' || c === 'NETWORK_ERROR') return copy.zpayFunctionUnavailable;
  if (
    c === 'ZPAY_NOT_CONFIGURED' ||
    c === 'ZPAY_URLS_NOT_CONFIGURED' ||
    c === 'SUPABASE_NOT_CONFIGURED' ||
    c === 'SERVICE_ENV_INCOMPLETE'
  ) {
    return copy.zpayServiceNotConfigured;
  }
  return copy.zpayFailed;
}

function ZpayBillingCard({
  card,
  days,
  userId,
  onRequireLogin,
  zpayNeedLogin,
  zpayFailed,
  zpayFunctionUnavailable,
  zpayServiceNotConfigured,
  zpayBusy,
  setZpayBusy,
  setZpayError,
}: {
  card: UpgradeBillingCardCopy;
  days: 30 | 365;
  userId: string | null;
  onRequireLogin?: () => void;
  zpayNeedLogin: string;
  zpayFailed: string;
  zpayFunctionUnavailable: string;
  zpayServiceNotConfigured: string;
  zpayBusy: null | 30 | 365;
  setZpayBusy: (v: null | 30 | 365) => void;
  setZpayError: (v: string | null) => void;
}) {
  const busy = zpayBusy !== null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() =>
        void (async () => {
          setZpayError(null);
          if (!userId) {
            onRequireLogin?.();
            setZpayError(zpayNeedLogin);
            return;
          }
          setZpayBusy(days);
          const result = await createZpayOrderCheckout(days, userId);
          setZpayBusy(null);
          if (result.ok === true) {
            window.location.href = result.payUrl;
            return;
          }
          const failed = result;
          console.warn('[AuraSounds] ZPay order failed', {
            code: failed.code,
            error: failed.error,
            hint: failed.hint,
            debug: failed.debug,
          });
          setZpayError(
            zpayFailureUserMessage(failed, {
              zpayNeedLogin,
              zpayFailed,
              zpayFunctionUnavailable,
              zpayServiceNotConfigured,
            }),
          );
        })()
      }
      className={choiceCardClass}
    >
      <span className="shrink-0 text-[15px] font-bold leading-snug tracking-tight text-[var(--color-mist-text)]/92">{card.title}</span>
      <span className="mt-1 shrink-0 text-[1.05rem] font-semibold leading-snug tracking-tight text-[var(--color-mist-text)]/88">{card.price}</span>
      <span className="mt-1 block min-h-[2.5rem] shrink-0 text-[13px] leading-snug text-[var(--color-mist-text)]/56">{card.description}</span>
      <span className="mt-auto self-end pt-1 text-[12px] font-semibold tracking-tight text-[rgba(140,108,72,0.92)] transition-colors group-hover:text-[rgba(120,88,58,0.98)]">
        {zpayBusy === days ? '…' : card.action}
      </span>
    </button>
  );
}

type ZhCNSubStep = 'channels' | 'intl-stripe' | 'wechat-zpay';

export function MembershipCheckoutModal({
  open,
  onClose,
  copy,
  closeLabel,
  backLabel,
  userId,
  onRequireLogin,
}: {
  open: boolean;
  onClose: () => void;
  copy: UpgradeModalCopy;
  closeLabel: string;
  backLabel: string;
  /** Supabase Auth session.user.id */
  userId: string | null;
  /** 未登录点击付费入口时触发（如 Google OAuth） */
  onRequireLogin?: () => void;
}) {
  const [zhStep, setZhStep] = useState<ZhCNSubStep>('channels');
  const [zpayBusy, setZpayBusy] = useState<null | 30 | 365>(null);
  const [zpayError, setZpayError] = useState<string | null>(null);

  useEffect(() => {
    if (open && copy.mode === 'zh-cn') {
      setZhStep('channels');
      setZpayError(null);
      setZpayBusy(null);
    }
  }, [open, copy]);

  const handleClose = () => {
    onClose();
    if (copy.mode === 'zh-cn') {
      setZhStep('channels');
      setZpayError(null);
      setZpayBusy(null);
    }
  };

  let title = '';
  let subtitle: string | null = '';
  let showBack = false;
  let onBack: (() => void) | undefined;

  if (copy.mode === 'stripe-only') {
    title = copy.title;
    subtitle = copy.subtitle;
  } else {
    if (zhStep === 'channels') {
      title = copy.step1.title;
      subtitle = copy.step1.subtitle;
    } else if (zhStep === 'intl-stripe') {
      title = copy.step2Intl.title;
      subtitle = copy.step2Intl.subtitle;
      showBack = true;
      onBack = () => {
        setZhStep('channels');
        setZpayError(null);
      };
    } else {
      title = copy.step2Wechat.title;
      subtitle = copy.step2Wechat.subtitle;
      showBack = true;
      onBack = () => {
        setZhStep('channels');
        setZpayError(null);
      };
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="pointer-events-auto fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-5">
          <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            onClick={handleClose}
            className="absolute inset-0 bg-[rgba(38,32,28,0.26)]"
          />
          <motion.div
            initial={{opacity: 0, y: 8}}
            animate={{opacity: 1, y: 0}}
            exit={{opacity: 0, y: 6}}
            transition={{duration: 0.16}}
            className="relative z-[1] w-full max-w-[420px]"
            onClick={e => e.stopPropagation()}
          >
            <div className="glass-panel-static mx-auto flex max-w-full flex-col gap-2 rounded-[20px] px-3.5 pb-3 pt-2.5 text-left sm:gap-2.5 sm:px-4 sm:pb-3.5 sm:pt-3">
              <div className="flex items-start justify-between gap-2.5">
                <div className="min-w-0">
                  {showBack ? (
                    <button
                      type="button"
                      onClick={onBack}
                      className="mb-1 text-[12px] font-medium text-[var(--color-mist-text)]/48 transition-colors hover:text-[var(--color-mist-text)]/72"
                    >
                      ← {backLabel}
                    </button>
                  ) : null}
                  <h3 className="text-[1.1rem] font-semibold leading-tight tracking-tight text-[var(--color-mist-text)] sm:text-[1.2rem]">
                    {title}
                  </h3>
                  {subtitle ? (
                    <p className="mt-0.5 text-[13px] leading-snug text-[var(--color-mist-text)]/54">{subtitle}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--color-mist-text)]/38 transition-colors hover:bg-white/45 hover:text-[var(--color-mist-text)]/62"
                  aria-label={closeLabel}
                >
                  <X className="h-4 w-4" strokeWidth={2} aria-hidden />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2 auto-rows-fr sm:grid-cols-2 sm:items-stretch sm:gap-2.5">
                {copy.mode === 'stripe-only' ? (
                  <>
                    <BillingChoiceCard
                      card={copy.monthly}
                      stripeUrl={STRIPE_CHECKOUT_MONTHLY_URL}
                      onClose={handleClose}
                      linkNotReadyHint={copy.linkNotReadyHint}
                      userId={userId}
                      onRequireLogin={onRequireLogin}
                    />
                    <BillingChoiceCard
                      card={copy.yearly}
                      stripeUrl={STRIPE_CHECKOUT_YEARLY_URL}
                      onClose={handleClose}
                      linkNotReadyHint={copy.linkNotReadyHint}
                      userId={userId}
                      onRequireLogin={onRequireLogin}
                    />
                  </>
                ) : zhStep === 'channels' ? (
                  <>
                    <ChannelChoiceCard card={copy.step1.international} onClick={() => setZhStep('intl-stripe')} />
                    <ChannelChoiceCard card={copy.step1.wechat} onClick={() => setZhStep('wechat-zpay')} />
                  </>
                ) : zhStep === 'intl-stripe' ? (
                  <>
                    <BillingChoiceCard
                      card={copy.step2Intl.monthly}
                      stripeUrl={STRIPE_CHECKOUT_MONTHLY_URL}
                      onClose={handleClose}
                      linkNotReadyHint={copy.linkNotReadyHint}
                      userId={userId}
                      onRequireLogin={onRequireLogin}
                    />
                    <BillingChoiceCard
                      card={copy.step2Intl.yearly}
                      stripeUrl={STRIPE_CHECKOUT_YEARLY_URL}
                      onClose={handleClose}
                      linkNotReadyHint={copy.linkNotReadyHint}
                      userId={userId}
                      onRequireLogin={onRequireLogin}
                    />
                  </>
                ) : (
                  <>
                    <ZpayBillingCard
                      card={copy.step2Wechat.days30}
                      days={30}
                      userId={userId}
                      onRequireLogin={onRequireLogin}
                      zpayNeedLogin={copy.zpayNeedLogin}
                      zpayFailed={copy.zpayFailed}
                      zpayFunctionUnavailable={copy.zpayFunctionUnavailable}
                      zpayServiceNotConfigured={copy.zpayServiceNotConfigured}
                      zpayBusy={zpayBusy}
                      setZpayBusy={setZpayBusy}
                      setZpayError={setZpayError}
                    />
                    <ZpayBillingCard
                      card={copy.step2Wechat.days365}
                      days={365}
                      userId={userId}
                      onRequireLogin={onRequireLogin}
                      zpayNeedLogin={copy.zpayNeedLogin}
                      zpayFailed={copy.zpayFailed}
                      zpayFunctionUnavailable={copy.zpayFunctionUnavailable}
                      zpayServiceNotConfigured={copy.zpayServiceNotConfigured}
                      zpayBusy={zpayBusy}
                      setZpayBusy={setZpayBusy}
                      setZpayError={setZpayError}
                    />
                  </>
                )}
              </div>

              {copy.mode === 'zh-cn' && zpayError ? (
                <p className="text-[11px] leading-snug text-amber-900/75">{zpayError}</p>
              ) : null}

              <p className="text-[10px] leading-relaxed text-[var(--color-mist-text)]/42 sm:text-[11px]">{copy.disclaimer}</p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
