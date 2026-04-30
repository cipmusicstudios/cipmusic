import {useEffect, useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {X} from 'lucide-react';
import {isSupabaseConfigured, supabase} from '../lib/supabase';
import type {SupabaseAuthModalCopy} from './supabase-auth-modal';
import {localizeAuthErrorMessage} from './supabase-auth-modal';

const PASSWORD_MIN_LEN = 6;

const inputClass =
  'supabase-auth-input w-full rounded-xl border border-white/35 bg-white/50 px-3 py-2 text-[13px] leading-normal text-[var(--color-mist-text)] shadow-[inset_0_1px_2px_rgba(255,255,255,0.4)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--color-mist-text)]/36 focus:border-[rgba(182,132,84,0.45)] focus:ring-1 focus:ring-[rgba(182,132,84,0.2)]';

const authFormRow = 'auth-form-row flex flex-col gap-0.5';
const authFormLabelClass =
  'block min-h-[15px] text-[10px] font-semibold uppercase leading-none tracking-[0.12em] text-[var(--color-mist-text)]/42';
const authFormLabelSpacerClass = 'auth-form-label-spacer block min-h-[15px] shrink-0';

type Phase = 'loading' | 'ready' | 'invalid' | 'success';

type Props = {
  open: boolean;
  authCopy: SupabaseAuthModalCopy;
  onDone: () => void;
};

export function SupabaseResetPasswordGate({open, authCopy, onDone}: Props) {
  const c = authCopy;
  const envOk = isSupabaseConfigured();
  const [phase, setPhase] = useState<Phase>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPhase('loading');
      setPassword('');
      setConfirm('');
      setErrorMsg(null);
      setBusy(false);
      return;
    }
    if (!envOk) {
      setPhase('loading');
      return;
    }

    let cancelled = false;

    const trySession = async (): Promise<boolean> => {
      const {data} = await supabase.auth.getSession();
      if (cancelled) return false;
      if (data.session) {
        setPhase('ready');
        return true;
      }
      return false;
    };

    void (async () => {
      for (const delay of [0, 120, 400, 900]) {
        if (cancelled) return;
        if (delay) await new Promise(r => window.setTimeout(r, delay));
        const ok = await trySession();
        if (cancelled || ok) return;
      }
      if (!cancelled) setPhase('invalid');
    })();

    const {
      data: {subscription},
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY' && session) {
        setPhase('ready');
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [open, envOk]);

  const handleSubmit = () => {
    if (!envOk || phase !== 'ready') return;
    setErrorMsg(null);
    const p = password;
    const q = confirm;
    if (p.length < PASSWORD_MIN_LEN) {
      setErrorMsg(c.passwordTooShort);
      return;
    }
    if (p !== q) {
      setErrorMsg(c.passwordsDoNotMatch);
      return;
    }
    void (async () => {
      setBusy(true);
      try {
        const {error} = await supabase.auth.updateUser({password: p});
        setBusy(false);
        if (error) {
          const code =
            'code' in error && typeof (error as {code?: string}).code === 'string'
              ? (error as {code?: string}).code!
              : undefined;
          setErrorMsg(localizeAuthErrorMessage(error.message, code, c));
          return;
        }
        setPhase('success');
      } catch {
        setBusy(false);
        setErrorMsg(c.genericError);
      }
    })();
  };

  const handleCloseSuccess = () => {
    window.history.replaceState({}, '', '/');
    onDone();
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="pointer-events-auto fixed inset-0 z-[350] flex items-center justify-center p-4 sm:p-5">
        <motion.div
          initial={{opacity: 0}}
          animate={{opacity: 1}}
          exit={{opacity: 0}}
          className="absolute inset-0 bg-[rgba(38,32,28,0.2)]"
        />
        <motion.div
          initial={{opacity: 0, y: 8, scale: 0.99}}
          animate={{opacity: 1, y: 0, scale: 1}}
          exit={{opacity: 0, y: 6, scale: 0.99}}
          transition={{duration: 0.16}}
          className="relative z-[1] w-full max-w-[340px]"
          onClick={ev => ev.stopPropagation()}
        >
          <div className="glass-panel mx-auto flex max-w-full flex-col gap-3 rounded-[20px] px-4 pb-4 pt-3.5 shadow-[0_10px_32px_rgba(72,54,37,0.1)]">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-[1.05rem] font-semibold tracking-tight text-[var(--color-mist-text)]">
                {phase === 'success' ? c.passwordUpdatedHeading : c.setNewPasswordTitle}
              </h2>
              <button
                type="button"
                onClick={phase === 'success' ? handleCloseSuccess : onDone}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--color-mist-text)]/40 transition-colors hover:bg-white/45 hover:text-[var(--color-mist-text)]/65"
                aria-label={c.closeAriaLabel}
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>

            {!envOk ? (
              <p className="rounded-xl border border-amber-900/18 bg-amber-500/14 px-3 py-2 text-[12px] leading-snug text-amber-950/88">
                {c.envMissingHint}
              </p>
            ) : null}

            {envOk && phase === 'loading' ? (
              <p className="text-[13px] leading-relaxed text-[var(--color-mist-text)]/72">{c.resetPasswordLoading}</p>
            ) : null}

            {envOk && phase === 'invalid' ? (
              <p className="rounded-lg border border-amber-900/15 bg-amber-500/12 px-2.5 py-1.5 text-[11px] leading-snug text-amber-950/85">
                {c.resetLinkInvalid}
              </p>
            ) : null}

            {phase === 'success' ? (
              <div
                className="rounded-2xl border-2 border-[rgba(120,150,120,0.35)] bg-[rgba(244,252,246,0.96)] px-4 py-3.5 text-[13px] leading-relaxed text-[var(--color-mist-text)]/88"
                role="status"
              >
                {c.passwordUpdatedSuccess}
              </div>
            ) : null}

            {phase === 'ready' ? (
              <div className="flex flex-col gap-3">
                <label className={authFormRow}>
                  <span className={authFormLabelClass}>{c.newPasswordFieldLabel}</span>
                  <input
                    type="password"
                    name="new-password"
                    autoComplete="new-password"
                    value={password}
                    onChange={ev => setPassword(ev.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className={authFormRow}>
                  <span className={authFormLabelClass}>{c.confirmPasswordFieldLabel}</span>
                  <input
                    type="password"
                    name="confirm-password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={ev => setConfirm(ev.target.value)}
                    className={inputClass}
                  />
                </label>
                {errorMsg ? (
                  <p className="rounded-lg border border-amber-900/15 bg-amber-500/12 px-2.5 py-1.5 text-[11px] leading-snug text-amber-950/85">
                    {errorMsg}
                  </p>
                ) : null}
                <div className={authFormRow}>
                  <span className={authFormLabelSpacerClass} aria-hidden="true" />
                  <button
                    type="button"
                    disabled={busy || !envOk}
                    onClick={handleSubmit}
                    className="inline-flex h-10 w-full items-center justify-center rounded-2xl bg-white/80 px-4 text-[13px] font-semibold text-[var(--color-mist-text)] shadow-sm transition-colors hover:bg-white/92 disabled:opacity-55"
                  >
                    {c.updatePasswordButton}
                  </button>
                </div>
              </div>
            ) : null}

            {phase === 'success' ? (
              <button
                type="button"
                onClick={handleCloseSuccess}
                className="inline-flex h-10 w-full items-center justify-center rounded-2xl bg-white/80 px-4 text-[13px] font-semibold text-[var(--color-mist-text)] shadow-sm transition-colors hover:bg-white/92"
              >
                {c.continueAfterReset}
              </button>
            ) : null}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
