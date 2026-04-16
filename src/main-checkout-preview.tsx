import {StrictMode, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Sparkles} from 'lucide-react';
import {en} from './locales/en';
import {zhCN} from './locales/zh-cn';
import {zhTW} from './locales/zh-tw';
import {premiumUi} from './premium-ui';
import {MembershipCheckoutModal} from './membership-checkout-modal';
import './index.css';

const LANGS = [
  {id: 'en', label: 'English', t: en},
  {id: 'zh-cn', label: '简体中文', t: zhCN},
  {id: 'zh-tw', label: '\u7e41\u9ad4\u4e2d\u6587', t: zhTW},
] as const;

function CheckoutModalPreview() {
  const [langIdx, setLangIdx] = useState(0);
  const [open, setOpen] = useState(true);
  const {t, label} = {t: LANGS[langIdx].t, label: LANGS[langIdx].label};

  return (
    <div className="min-h-screen px-4 py-8 text-[var(--color-mist-text)]">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">会员支付弹窗 · 预览</h1>
            <p className="mt-1 text-sm text-[var(--color-mist-text)]/58">
              切换语言与开关弹窗，对照正式站 Settings → Membership 样式。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {LANGS.map((L, i) => (
              <button
                key={L.id}
                type="button"
                onClick={() => setLangIdx(i)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  i === langIdx
                    ? 'bg-[var(--color-mist-text)] text-[#f7f4ef]'
                    : 'border border-white/25 bg-white/20 text-[var(--color-mist-text)]/75 hover:bg-white/30'
                }`}
              >
                {L.label}
              </button>
            ))}
          </div>
        </header>

        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-mist-text)]/42">
          当前语言 · {label}
        </p>

        <section className={`${premiumUi.card} flex flex-col gap-4`}>
          <div className="flex items-center gap-3">
            <div className={premiumUi.iconWrap}>
              <Sparkles className="h-4.5 w-4.5" />
            </div>
            <h2 className={premiumUi.title}>Membership（示意）</h2>
          </div>
          <p className={premiumUi.body}>{t.settings.upgradeToUnlock}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setOpen(true)} className={premiumUi.upgradeButton}>
              {t.settings.upgradeNow}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-12 items-center justify-center rounded-2xl border border-white/22 bg-white/14 px-5 text-sm font-semibold text-[var(--color-mist-text)]/78 hover:bg-white/22"
            >
              {t.common.close} 弹窗
            </button>
          </div>
        </section>

        <p className="text-center text-xs text-[var(--color-mist-text)]/45">
          开发：运行 <code className="rounded bg-white/30 px-1 py-0.5">npm run dev</code> 后打开本页 —{' '}
          <code className="rounded bg-white/30 px-1 py-0.5">/index-checkout-preview.html</code>
        </p>
      </div>

      <MembershipCheckoutModal
        open={open}
        onClose={() => setOpen(false)}
        copy={t.settings.upgradeModal}
        closeLabel={t.common.close}
        backLabel={t.common.back}
        userId={null}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CheckoutModalPreview />
  </StrictMode>,
);
