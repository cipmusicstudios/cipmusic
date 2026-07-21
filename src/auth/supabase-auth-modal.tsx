import {useEffect, useMemo, useState} from 'react';
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
  /** Kept for older locale objects; the normal email flow now uses sendLoginCode. */
  primarySignUp: string;
  oauthDivider: string;
  oauthGoogle: string;
  oauthApple: string;
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
  sendLoginCode: string;
  enterCodeTitle: string;
  loginCodeSentBody: string;
  codeFieldLabel: string;
  verifyAndContinue: string;
  changeEmail: string;
  resendLoginCode: string;
  codeDeliveryHint: string;
  codeResent: string;
  enterEmail: string;
  enterLoginCode: string;
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

type AuthStep = 'email' | 'code';

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
  'text-[11px] font-semibold text-[var(--color-mist-text)]/52 underline decoration-[var(--color-mist-text)]/28 underline-offset-2 transition-colors hover:text-[var(--color-mist-text)]/78 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:text-[var(--color-mist-text)]/52';

const defaultAuthCopy: SupabaseAuthModalCopy = {
  mainHeading: 'Sign in / Sign up',
  tabSignIn: 'Sign in',
  tabSignUp: 'Sign up',
  primarySignIn: 'Send login code',
  primarySignUp: 'Send login code',
  oauthDivider: 'Or continue with',
  oauthGoogle: 'Google',
  oauthApple: 'Continue with Apple',
  closeAriaLabel: 'Close',
  invalidEmailOrPassword: 'Invalid email or login code.',
  emailNotConfirmed: 'Please verify your email code before continuing.',
  userAlreadyRegistered: 'This email is already registered. Try signing in instead.',
  alreadyHaveAccount: 'Already have an account?',
  dontHaveAccount: "Don't have an account?",
  emailConfirmTitle: 'Check your email',
  emailConfirmBody:
    "If this email can receive a login code, we've sent one. Please check your inbox.",
  emailConfirmSpam:
    "If you don't see the email, please check your spam or promotions folder.",
  emailFieldLabel: 'Email',
  passwordFieldLabel: 'Login code',
  sendLoginCode: 'Send login code',
  enterCodeTitle: 'Enter the code sent to your email',
  loginCodeSentBody: 'Use the login code we sent to this email address.',
  codeFieldLabel: 'Login code',
  verifyAndContinue: 'Verify and continue',
  changeEmail: 'Change email',
  resendLoginCode: 'Resend code',
  codeDeliveryHint:
    "Didn’t receive the code? Please check your spam, promotions, or other inbox folders, and search for “CIP Music” or “noreply@cipmusic.com”.",
  codeResent: 'Code resent',
  enterEmail: 'Please enter your email.',
  enterLoginCode: 'Please enter the login code from your email.',
  forgotPasswordLink: 'Use login code',
  resetPasswordTitle: 'Reset password',
  resetPasswordSubtitle: "Enter your email and we'll send you a reset link.",
  sendResetLink: 'Send reset link',
  backToSignIn: 'Back to sign in',
  resetEmailSentTitle: 'Next step',
  resetEmailSentBody:
    "If a reset link is available for this email, we'll send one. Please check your inbox and spam folder.",
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
  enterEmailPassword: 'Please enter your email.',
  resetEmailRequired: 'Please enter your email.',
};

export function SupabaseAuthModal({open, mode, onClose, onSuccess, onModeChange, authCopy}: Props) {
  const copy = authCopy ?? defaultAuthCopy;
  const [email, setEmail] = useState('');
  const [otpEmail, setOtpEmail] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [authStep, setAuthStep] = useState<AuthStep>('email');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const envOk = isSupabaseConfigured();
  const resendSecondsLeft = useMemo(
    () => Math.max(0, Math.ceil((resendAvailableAt - nowMs) / 1000)),
    [nowMs, resendAvailableAt],
  );

  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setResetEmailSent(false);
    setOtpEmail('');
    setOtpToken('');
    setAuthStep('email');
    setResendAvailableAt(0);
    setNowMs(Date.now());
    setBusy(false);
  }, [open, mode]);

  useEffect(() => {
    if (!open || resendSecondsLeft <= 0) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, resendSecondsLeft]);

  const sendLoginCode = async (e: string) => {
    const {error} = await supabase.auth.signInWithOtp({
      email: e,
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: true,
      },
    });
    if (error) return {error};
    const sentAt = Date.now();
    setNowMs(sentAt);
    setResendAvailableAt(sentAt + 60_000);
    return {error: null};
  };

  const handleSendLoginCode = (resend = false) => {
    if (!envOk) return;
    void (async () => {
      setErrorMsg(null);
      setSuccessMsg(null);
      if (resend && resendSecondsLeft > 0) return;
      const e = (resend ? otpEmail || email : email).trim();
      if (!e) {
        setErrorMsg(copy.enterEmail);
        return;
      }
      setBusy(true);
      try {
        const {error} = await sendLoginCode(e);
        setBusy(false);
        if (error) {
          const code =
            'code' in error && typeof (error as {code?: string}).code === 'string'
              ? (error as {code?: string}).code!
              : undefined;
          setErrorMsg(localizeAuthErrorMessage(error.message, code, copy));
          return;
        }
        setOtpEmail(e);
        setOtpToken('');
        setAuthStep('code');
        if (resend) setSuccessMsg(copy.codeResent);
      } catch {
        setBusy(false);
        setErrorMsg(copy.genericError);
      }
    })();
  };

  const handleVerifyLoginCode = () => {
    if (!envOk) return;
    void (async () => {
      setErrorMsg(null);
      setSuccessMsg(null);
      const e = (otpEmail || email).trim();
      const token = otpToken.trim().replace(/\s+/g, '');
      if (!e) {
        setErrorMsg(copy.enterEmail);
        setAuthStep('email');
        return;
      }
      if (!token) {
        setErrorMsg(copy.enterLoginCode);
        return;
      }
      setBusy(true);
      try {
        const {data, error} = await supabase.auth.verifyOtp({
          email: e,
          token,
          type: 'email',
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
        const {data: current} = await supabase.auth.getSession();
        if (!data.session && !current.session) {
          setErrorMsg(copy.genericError);
          return;
        }
        onSuccess?.();
        onClose();
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
      setSuccessMsg(null);
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
      setSuccessMsg(null);
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

  const handleApple = () => {
    if (!envOk) return;
    void (async () => {
      setErrorMsg(null);
      setSuccessMsg(null);
      const {error} = await supabase.auth.signInWithOAuth({
        provider: 'apple',
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
                  {authStep === 'code' ? copy.enterCodeTitle : copy.mainHeading}
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

              <div className="flex flex-col">
                <div className="flex flex-col gap-3">
                  {authStep === 'email' ? (
                    <>
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
                      <p className="m-0 text-[11px] leading-snug text-[var(--color-mist-text)]/52">
                        {copy.codeDeliveryHint}
                      </p>
                      {errorMsg ? (
                        <p className="rounded-lg border border-amber-900/15 bg-amber-500/12 px-2.5 py-1.5 text-[11px] leading-snug text-amber-950/85">
                          {errorMsg}
                        </p>
                      ) : null}
                      {successMsg ? (
                        <p className="rounded-lg border border-emerald-900/10 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-emerald-950/78">
                          {successMsg}
                        </p>
                      ) : null}
                      <div className={authFormRow}>
                        <span className={authFormLabelSpacerClass} aria-hidden="true" />
                        <button
                          type="button"
                          disabled={busy || !envOk}
                          onClick={() => handleSendLoginCode()}
                          className="inline-flex h-10 w-full items-center justify-center rounded-2xl bg-white/80 px-4 text-[13px] font-semibold text-[var(--color-mist-text)] shadow-sm transition-colors hover:bg-white/92 disabled:opacity-55"
                        >
                          {copy.sendLoginCode}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="m-0 text-[12px] leading-relaxed text-[var(--color-mist-text)]/68">
                        {copy.loginCodeSentBody}
                        {otpEmail ? <span className="font-semibold text-[var(--color-mist-text)]/86"> {otpEmail}</span> : null}
                      </p>
                      <button
                        type="button"
                        className={`${forgotLinkClass} self-start`}
                        onClick={() => {
                          setAuthStep('email');
                          setOtpToken('');
                          setErrorMsg(null);
                        }}
                      >
                        {copy.changeEmail}
                      </button>
                      <label className={authFormRow}>
                        <span className={authFormLabelClass}>{copy.codeFieldLabel}</span>
                        <input
                          type="text"
                          name="login-code"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={otpToken}
                          onChange={ev => setOtpToken(ev.target.value)}
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
                          onClick={handleVerifyLoginCode}
                          className="inline-flex h-10 w-full items-center justify-center rounded-2xl bg-white/80 px-4 text-[13px] font-semibold text-[var(--color-mist-text)] shadow-sm transition-colors hover:bg-white/92 disabled:opacity-55"
                        >
                          {copy.verifyAndContinue}
                        </button>
                      </div>
                      <div className="flex justify-center pt-0.5">
                        <button
                          type="button"
                          className={forgotLinkClass}
                          disabled={busy || !envOk || resendSecondsLeft > 0}
                          onClick={() => handleSendLoginCode(true)}
                        >
                          {resendSecondsLeft > 0 ? `${copy.resendLoginCode} (${resendSecondsLeft}s)` : copy.resendLoginCode}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div className="mt-6 flex flex-col items-center gap-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--color-mist-text)]/38">
                    {copy.oauthDivider}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      disabled={busy || !envOk}
                      onClick={handleApple}
                      className="inline-flex min-h-8 items-center gap-2 rounded-full bg-black px-4 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-black/80 disabled:opacity-55"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                        <path d="M17.05 12.54c-.03-3.1 2.53-4.61 2.65-4.68a5.69 5.69 0 0 0-4.48-2.42c-1.88-.2-3.7 1.13-4.66 1.13-.98 0-2.46-1.11-4.06-1.08a5.94 5.94 0 0 0-5 3.05c-2.16 3.74-.55 9.24 1.52 12.26 1.04 1.48 2.25 3.14 3.85 3.08 1.56-.06 2.14-.99 4.02-.99 1.86 0 2.41.99 4.03.95 1.68-.02 2.73-1.49 3.73-2.98a12.2 12.2 0 0 0 1.7-3.45 5.34 5.34 0 0 1-3.3-4.87ZM14 3.45A5.42 5.42 0 0 0 15.24-.44a5.53 5.53 0 0 0-3.58 1.85 5.16 5.16 0 0 0-1.28 3.74A4.58 4.58 0 0 0 14 3.45Z" />
                      </svg>
                      {copy.oauthApple}
                    </button>
                    <button
                      type="button"
                      disabled={busy || !envOk}
                      onClick={handleGoogle}
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-white/30 bg-white/18 px-3 py-1.5 text-[12px] font-medium text-[var(--color-mist-text)]/72 transition-colors hover:bg-white/30 hover:text-[var(--color-mist-text)]/88 disabled:opacity-55"
                    >
                      {copy.oauthGoogle}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
