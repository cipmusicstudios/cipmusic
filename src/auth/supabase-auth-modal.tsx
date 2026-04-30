import {useEffect, useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {X} from 'lucide-react';
import {isSupabaseConfigured, supabase} from '../lib/supabase';

export type SupabaseAuthModalMode = 'sign-in' | 'sign-up';

export type SupabaseAuthModalCopy = {
  /** Main modal title when not on forgot-password subview */
  mainHeading: string;
  tabSignIn: string;
  tabSignUp: string;
  primarySignIn: string;
  /** Primary CTA on sign-up tab (e.g. Create account) */
  primarySignUp: string;
  oauthDivider: string;
  oauthGoogle: string;
  closeAriaLabel: string;
  invalidEmailOrPassword: string;
  emailNotConfirmed: string;
  userAlreadyRegistered: string;
  alreadyHaveAccount: string;
  dontHaveAccount: string;
  emailConfirmTitle: string;
  emailConfirmBody: string;
  emailConfirmSpam: string;
  emailFieldLabel: string;
  passwordFieldLabel: string;
  forgotPasswordLink: string;
  resetPasswordTitle: string;
  resetPasswordSubtitle: string;
  sendResetLink: string;
  backToSignIn: string;
  resetEmailSentTitle: string;
  resetEmailSentBody: string;
  resetEmailSentSpam: string;
  forgotPasswordGoogleHint: string;
  setNewPasswordTitle: string;
  newPasswordFieldLabel: string;
  confirmPasswordFieldLabel: string;
  updatePasswordButton: string;
  passwordUpdatedHeading: string;
  passwordUpdatedSuccess: string;
  continueAfterReset: string;
  passwordsDoNotMatch: string;
  passwordTooShort: string;
  resetLinkInvalid: string;
  resetPasswordLoading: string;
  genericError: string;
  envMissingHint: string;
  enterEmailPassword: string;
  resetEmailRequired: string;
};

/** Map common Supabase Auth English messages to localized copy; fall back to raw message. */
export function localizeAuthErrorMessage(
  raw: string | null | undefined,
  code: string | null | undefined,
  copy: SupabaseAuthModalCopy,
): string {
  const m = (raw || '').trim();
  const c = (code || '').trim();
  const lower = m.toLowerCase();
  if (
    lower.includes('invalid login credentials') ||
    lower.includes('invalid email or password') ||
    c === 'invalid_credentials'
  ) {
    return copy.invalidEmailOrPassword;
  }
  if (lower.includes('email not confirmed') || c === 'email_not_confirmed') {
    return copy.emailNotConfirmed;
  }
  if (
    lower.includes('already registered') ||
    lower.includes('user already registered') ||
    c === 'signup_disabled' ||
    c === 'user_already_exists'
  ) {
    return copy.userAlreadyRegistered;
  }
  if (
    lower.includes('password') &&
    (lower.includes('at least 6') ||
      lower.includes('should be at least 6') ||
      lower.includes('minimum') ||
      c === 'weak_password')
  ) {
    return copy.passwordTooShort;
  }
  return m || copy.genericError;
}

type Props = {
  open: boolean;
  mode: SupabaseAuthModalMode;
  onClose: () => void;
  onSuccess?: () => void;
  onModeChange: (mode: SupabaseAuthModalMode) => void;
  authCopy?: SupabaseAuthModalCopy;
};

type AuthSubView = 'main' | 'forgot';

const inputClass =
  'supabase-auth-input w-full rounded-xl border border-white/35 bg-white/50 px-3 py-2 text-[13px] leading-normal text-[var(--color-mist-text)] shadow-[inset_0_1px_2px_rgba(255,255,255,0.4)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--color-mist-text)]/36 focus:border-[rgba(182,132,84,0.45)] focus:ring-1 focus:ring-[rgba(182,132,84,0.2)]';

/** Aligns input strips: label line + gap-0.5 + control; submit row uses invisible spacer same height as label. */
const authFormRow = 'auth-form-row flex flex-col gap-0.5';
const authFormLabelClass =
  'block min-h-[15px] text-[10px] font-semibold uppercase leading-none tracking-[0.12em] text-[var(--color-mist-text)]/42';
const authFormLabelSpacerClass = 'auth-form-label-spacer block min-h-[15px] shrink-0';

const tabBtnActive = 'bg-white/75 text-[var(--color-mist-text)] shadow-sm';
const tabBtnIdle = 'text-[var(--color-mist-text)]/55 hover:bg-white/25 hover:text-[var(--color-mist-text)]/75';

const forgotLinkClass =
  'text-[11px] font-semibold text-[var(--color-mist-text)]/52 underline decoration-[var(--color-mist-text)]/28 underline-offset-2 transition-colors hover:text-[var(--color-mist-text)]/78';

const defaultAuthCopy: SupabaseAuthModalCopy = {
  mainHeading: 'Sign in / Sign up',
  tabSignIn: 'Sign in',
  tabSignUp: 'Sign up',
  primarySignIn: 'Sign in',
  primarySignUp: 'Create account',
  oauthDivider: 'Or continue with',
  oauthGoogle: 'Google',
  closeAriaLabel: 'Close',
  invalidEmailOrPassword: 'Invalid email or password.',
  emailNotConfirmed: 'Please confirm your email before signing in.',
  userAlreadyRegistered: 'This email is already registered. Try signing in instead.',
  alreadyHaveAccount: 'Already have an account?',
  dontHaveAccount: "Don't have an account?",
  emailConfirmTitle: 'Check your email',
  emailConfirmBody:
    "If this email can be registered, we've sent a confirmation link. Please check your inbox to activate your account. If you already have an account, switch to Sign in.",
  emailConfirmSpam:
    "If you don't see the email, please check your spam or promotions folder.",
  emailFieldLabel: 'Email',
  passwordFieldLabel: 'Password',
  forgotPasswordLink: 'Forgot password?',
  resetPasswordTitle: 'Reset password',
  resetPasswordSubtitle: "Enter your email and we'll send you a reset link.",
  sendResetLink: 'Send reset link',
  backToSignIn: 'Back to sign in',
  resetEmailSentTitle: 'Next step',
  resetEmailSentBody:
    "If an account exists for this email and password login is enabled, we'll send a reset link. Please check your inbox and spam folder.",
  resetEmailSentSpam:
    "If you don't see the email, please check your spam or promotions folder.",
  forgotPasswordGoogleHint:
    'If you signed up with Google, please continue using Google sign-in instead.',
  setNewPasswordTitle: 'Set new password',
  newPasswordFieldLabel: 'New password',
  confirmPasswordFieldLabel: 'Confirm password',
  updatePasswordButton: 'Update password',
  passwordUpdatedHeading: 'Password updated',
  passwordUpdatedSuccess: 'You can now sign in.',
  continueAfterReset: 'Continue',
  passwordsDoNotMatch: 'Passwords do not match.',
  passwordTooShort: 'Password must be at least 6 characters.',
  resetLinkInvalid: 'This reset link is invalid or has expired. Please request a new reset link.',
  resetPasswordLoading: 'Verifying reset link…',
  genericError: 'Something went wrong. Please try again.',
  envMissingHint:
    'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (anon only) in project root .env.local, then restart the dev server.',
  enterEmailPassword: 'Please enter email and password.',
  resetEmailRequired: 'Please enter your email.',
};

export function SupabaseAuthModal({open, mode, onClose, onSuccess, onModeChange, authCopy}: Props) {
  const copy = authCopy ?? defaultAuthCopy;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [emailConfirmNotice, setEmailConfirmNotice] = useState(false);
  const [subView, setSubView] = useState<AuthSubView>('main');
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const envOk = isSupabaseConfigured();

  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);
    setEmailConfirmNotice(false);
    setResetEmailSent(false);
    setSubView('main');
    setBusy(false);
  }, [open, mode]);

  const handleEmailAuth = () => {
    if (!envOk) return;
    void (async () => {
      setErrorMsg(null);
      setEmailConfirmNotice(false);
      const e = email.trim();
      if (!e || !password) {
        setErrorMsg(copy.enterEmailPassword);
        return;
      }
      setBusy(true);
      try {
        if (mode === 'sign-in') {
          const {error} = await supabase.auth.signInWithPassword({email: e, password});
          setBusy(false);
          if (error) {
            const code =
              'code' in error && typeof (error as {code?: string}).code === 'string'
                ? (error as {code?: string}).code!
                : undefined;
            setErrorMsg(localizeAuthErrorMessage(error.message, code, copy));
            return;
          }
          onSuccess?.();
          onClose();
        } else {
          const {data, error} = await supabase.auth.signUp({
            email: e,
            password,
            options: {emailRedirectTo: window.location.origin},
          });
          setBusy(false);
          if (error) {
            const code =
              'code' in error && typeof (error as {code?: string}).code === 'string'
                ? (error as {code?: string}).code!
                : undefined;
            setErrorMsg(localizeAuthErrorMessage(error.message, code, copy));
            return;
          }
          if (data.session) {
            onSuccess?.();
            onClose();
          } else {
            setEmailConfirmNotice(true);
          }
        }
      } catch {
        setBusy(false);
        setErrorMsg(copy.genericError);
      }
    })();
  };

  const handleSendResetLink = () => {
    if (!envOk) return;
    void (async () => {
      setErrorMsg(null);
      setResetEmailSent(false);
      const e = email.trim();
      if (!e) {
        setErrorMsg(copy.resetEmailRequired);
        return;
      }
      setBusy(true);
      try {
        const redirectTo = `${window.location.origin}/reset-password`;
        const {error} = await supabase.auth.resetPasswordForEmail(e, {redirectTo});
        setBusy(false);
        setResetEmailSent(false);
        if (error) {
          console.error('[SupabaseAuth] resetPasswordForEmail failed', {
            email: e,
            message: error.message,
            name: error.name,
            status: 'status' in error ? (error as {status?: number}).status : undefined,
            code: 'code' in error ? String((error as {code?: string}).code) : undefined,
          });
          console.error('[SupabaseAuth] resetPasswordForEmail raw error', error);
          const code =
            'code' in error && typeof (error as {code?: string}).code === 'string'
              ? (error as {code?: string}).code!
              : undefined;
          setErrorMsg(localizeAuthErrorMessage(error.message, code, copy));
          return;
        }
        setResetEmailSent(true);
      } catch (err) {
        setBusy(false);
        setResetEmailSent(false);
        console.error('[SupabaseAuth] resetPasswordForEmail threw', err);
        setErrorMsg(copy.genericError);
      }
    })();
  };

  const handleGoogle = () => {
    if (!envOk) return;
    void (async () => {
      setErrorMsg(null);
      setEmailConfirmNotice(false);
      const {error} = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {redirectTo: window.location.origin},
      });
      if (error) {
        const code =
          'code' in error && typeof (error as {code?: string}).code === 'string'
            ? (error as {code?: string}).code!
            : undefined;
        setErrorMsg(localizeAuthErrorMessage(error.message, code, copy));
      }
    })();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="pointer-events-auto fixed inset-0 z-[340] flex items-center justify-center p-4 sm:p-5">
          <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            onClick={onClose}
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
                  {subView === 'forgot' ? copy.resetPasswordTitle : copy.mainHeading}
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--color-mist-text)]/40 transition-colors hover:bg-white/45 hover:text-[var(--color-mist-text)]/65"
                  aria-label={copy.closeAriaLabel}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>

              {!envOk ? (
                <p className="rounded-xl border border-amber-900/18 bg-amber-500/14 px-3 py-2 text-[12px] leading-snug text-amber-950/88">
                  {copy.envMissingHint}
                </p>
              ) : null}

              {subView === 'forgot' ? (
                <div className="flex flex-col gap-3">
                  <p className="m-0 text-[13px] leading-relaxed text-[var(--color-mist-text)]/72">{copy.resetPasswordSubtitle}</p>
                  <p className="m-0 text-[11px] leading-snug text-[var(--color-mist-text)]/55">{copy.forgotPasswordGoogleHint}</p>
                  <label className={authFormRow}>
                    <span className={authFormLabelClass}>{copy.emailFieldLabel}</span>
                    <input
                      type="text"
                      name="reset-email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={ev => setEmail(ev.target.value)}
                      className={inputClass}
                    />
                  </label>
                  {errorMsg ? (
                    <p className="rounded-lg border border-amber-900/15 bg-amber-500/12 px-2.5 py-1.5 text-[11px] leading-snug text-amber-950/85">
                      {errorMsg}
                    </p>
                  ) : null}
                  {resetEmailSent ? (
                    <div
                      className="rounded-2xl border-2 border-[rgba(120,150,120,0.35)] bg-[rgba(244,252,246,0.96)] px-4 py-3.5 shadow-[0_4px_14px_rgba(72,54,37,0.06)]"
                      role="status"
                    >
                      <p className="text-[15px] font-bold leading-snug text-[var(--color-mist-text)]">{copy.resetEmailSentTitle}</p>
                      <p className="mt-2 text-[12px] leading-[1.55] text-[var(--color-mist-text)]/88">{copy.resetEmailSentBody}</p>
                      <p className="mt-2 text-[11px] leading-snug text-[var(--color-mist-text)]/55">{copy.resetEmailSentSpam}</p>
                    </div>
                  ) : null}
                  <div className={authFormRow}>
                    <span className={authFormLabelSpacerClass} aria-hidden="true" />
                    <button
                      type="button"
                      disabled={busy || !envOk}
                      onClick={handleSendResetLink}
                      className="inline-flex h-10 w-full items-center justify-center rounded-2xl bg-white/80 px-4 text-[13px] font-semibold text-[var(--color-mist-text)] shadow-sm transition-colors hover:bg-white/92 disabled:opacity-55"
                    >
                      {copy.sendResetLink}
                    </button>
                  </div>
                  <div className="flex justify-center pt-0.5">
                    <button type="button" className={forgotLinkClass} onClick={() => setSubView('main')}>
                      {copy.backToSignIn}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex rounded-full bg-white/22 p-0.5">
                    <button
                      type="button"
                      onClick={() => onModeChange('sign-in')}
                      className={`flex-1 rounded-full py-2 text-[12px] font-semibold transition-all ${mode === 'sign-in' ? tabBtnActive : tabBtnIdle}`}
                    >
                      {copy.tabSignIn}
                    </button>
                    <button
                      type="button"
                      onClick={() => onModeChange('sign-up')}
                      className={`flex-1 rounded-full py-2 text-[12px] font-semibold transition-all ${mode === 'sign-up' ? tabBtnActive : tabBtnIdle}`}
                    >
                      {copy.tabSignUp}
                    </button>
                  </div>

                  <div className="flex flex-col">
                    <div className="flex flex-col gap-3">
                      <label className={authFormRow}>
                        <span className={authFormLabelClass}>{copy.emailFieldLabel}</span>
                        <input
                          type="text"
                          name="email"
                          inputMode="email"
                          autoComplete="email"
                          value={email}
                          onChange={ev => setEmail(ev.target.value)}
                          className={inputClass}
                        />
                      </label>
                      <label className={authFormRow}>
                        <span className={authFormLabelClass}>{copy.passwordFieldLabel}</span>
                        <input
                          type="password"
                          name="password"
                          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                          value={password}
                          onChange={ev => setPassword(ev.target.value)}
                          className={inputClass}
                        />
                      </label>
                      {mode === 'sign-in' ? (
                        <div className="flex justify-end pt-0.5">
                          <button type="button" className={forgotLinkClass} onClick={() => setSubView('forgot')}>
                            {copy.forgotPasswordLink}
                          </button>
                        </div>
                      ) : null}
                      {errorMsg ? (
                        <p className="rounded-lg border border-amber-900/15 bg-amber-500/12 px-2.5 py-1.5 text-[11px] leading-snug text-amber-950/85">
                          {errorMsg}
                        </p>
                      ) : null}
                      {emailConfirmNotice && mode === 'sign-up' ? (
                        <div
                          className="rounded-2xl border-2 border-[rgba(167,118,72,0.42)] bg-[rgba(255,244,228,0.98)] px-4 py-3.5 shadow-[0_4px_14px_rgba(72,54,37,0.08),0_1px_0_rgba(255,255,255,0.55)_inset]"
                          role="status"
                        >
                          <p className="text-[15px] font-bold leading-snug tracking-tight text-[var(--color-mist-text)]">
                            {copy.emailConfirmTitle}
                          </p>
                          <p className="mt-2.5 text-[12px] leading-[1.55] text-[var(--color-mist-text)]/90">
                            {copy.emailConfirmBody}
                          </p>
                          <p className="mt-2.5 text-[11px] leading-snug text-[var(--color-mist-text)]/55">
                            {copy.emailConfirmSpam}
                          </p>
                        </div>
                      ) : null}
                      <div className={authFormRow}>
                        <span className={authFormLabelSpacerClass} aria-hidden="true" />
                        <button
                          type="button"
                          disabled={busy || !envOk}
                          onClick={handleEmailAuth}
                          className="inline-flex h-10 w-full items-center justify-center rounded-2xl bg-white/80 px-4 text-[13px] font-semibold text-[var(--color-mist-text)] shadow-sm transition-colors hover:bg-white/92 disabled:opacity-55"
                        >
                          {mode === 'sign-in' ? copy.primarySignIn : copy.primarySignUp}
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 flex flex-col items-center gap-2">
                      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--color-mist-text)]/38">
                        {copy.oauthDivider}
                      </p>
                      <button
                        type="button"
                        disabled={busy || !envOk}
                        onClick={handleGoogle}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/18 px-3 py-1.5 text-[12px] font-medium text-[var(--color-mist-text)]/72 transition-colors hover:bg-white/30 hover:text-[var(--color-mist-text)]/88 disabled:opacity-55"
                      >
                        {copy.oauthGoogle}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
