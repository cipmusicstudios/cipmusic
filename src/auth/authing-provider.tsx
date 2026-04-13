import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import type { User } from '@authing/guard';
import { authingDevLog, authingNetworkHint, getAuthingGuardOptions } from './authing-config';
import { AUTHING_GUARD_LOGIN_EVENT, openAuthingGuardEmbed } from './authing-guard-embed';

function shouldTryRedirectCallback(): boolean {
  const { search, hash } = window.location;
  return /[?&#](code|state)=/.test(search) || /[?&#](code|state)=/.test(hash);
}

export type AuthingAuthContextValue = {
  isConfigured: boolean;
  ready: boolean;
  user: User | null;
  openLogin: () => Promise<void>;
  openRegister: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<User | null>;
};

const noopAsync = async () => {};

const disabledValue: AuthingAuthContextValue = {
  isConfigured: false,
  ready: true,
  user: null,
  openLogin: noopAsync,
  openRegister: noopAsync,
  logout: noopAsync,
  refreshUser: async () => null,
};

const AuthingAuthContext = createContext<AuthingAuthContextValue>(disabledValue);

type AuthErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type AuthErrorBoundaryState = { failed: boolean };

class AuthingAuthErrorBoundary extends Component<AuthErrorBoundaryProps, AuthErrorBoundaryState> {
  state: AuthErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AuthErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Authing] Auth 子树错误，已降级为无登录模块', error, info.componentStack);
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

function AuthingAuthInner({ children }: { children: ReactNode }) {
  const opts = useMemo(() => getAuthingGuardOptions(), []);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onLogin = (e: Event) => {
      const ce = e as CustomEvent<User>;
      if (ce.detail) setUser(ce.detail);
    };
    window.addEventListener(AUTHING_GUARD_LOGIN_EVENT, onLogin);
    return () => window.removeEventListener(AUTHING_GUARD_LOGIN_EVENT, onLogin);
  }, []);

  useEffect(() => {
    if (!opts) {
      setReady(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await import('@authing/guard/dist/esm/guard.min.css');
        const { Guard } = await import('@authing/guard');
        const guard = new Guard(opts);
        if (cancelled) return;
        if (shouldTryRedirectCallback()) {
          try {
            await guard.handleRedirectCallback();
            try {
              const clean = `${window.location.origin}${window.location.pathname}`;
              window.history.replaceState({}, document.title, clean);
            } catch {
              /* ignore */
            }
          } catch {
            /* 非 OIDC 回调 */
          }
        }
        try {
          const u = await guard.trackSession();
          if (!cancelled) setUser(u);
        } catch {
          /* ignore */
        }
      } catch (e) {
        console.error('[Authing] 会话恢复失败', e);
        authingNetworkHint(e);
        authingDevLog('session bootstrap threw', e);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opts]);

  const openLogin = useCallback(() => openAuthingGuardEmbed('login'), []);
  const openRegister = useCallback(() => openAuthingGuardEmbed('register'), []);

  const refreshUser = useCallback(async (): Promise<User | null> => {
    const o = getAuthingGuardOptions();
    if (!o) return null;
    try {
      const { Guard } = await import('@authing/guard');
      const guard = new Guard(o);
      const u = await guard.trackSession();
      setUser(u);
      return u;
    } catch {
      return null;
    }
  }, []);

  const logout = useCallback(async () => {
    authingDevLog('logout');
    const o = getAuthingGuardOptions();
    try {
      if (o) {
        const { Guard } = await import('@authing/guard');
        const guard = new Guard(o);
        const redirect = import.meta.env.VITE_AUTHING_LOGOUT_REDIRECT_URI?.trim();
        await guard.logout({
          redirectUri: redirect || `${window.location.origin}${window.location.pathname}`,
        });
      }
    } catch (e) {
      console.error('[Authing] logout', e);
    }
    setUser(null);
  }, []);

  const isConfigured = Boolean(opts);

  const value = useMemo<AuthingAuthContextValue>(
    () => ({
      isConfigured,
      ready,
      user,
      openLogin,
      openRegister,
      logout,
      refreshUser,
    }),
    [isConfigured, ready, user, openLogin, openRegister, logout, refreshUser],
  );

  return <AuthingAuthContext.Provider value={value}>{children}</AuthingAuthContext.Provider>;
}

export function AuthingAppRoot({ children }: { children: ReactNode }) {
  const opts = useMemo(() => getAuthingGuardOptions(), []);

  if (!opts) {
    return <AuthingAuthContext.Provider value={disabledValue}>{children}</AuthingAuthContext.Provider>;
  }

  return (
    <AuthingAuthErrorBoundary
      fallback={
        <AuthingAuthContext.Provider value={disabledValue}>{children}</AuthingAuthContext.Provider>
      }
    >
      <AuthingAuthInner>{children}</AuthingAuthInner>
    </AuthingAuthErrorBoundary>
  );
}

export function useAuthingAuth(): AuthingAuthContextValue {
  return useContext(AuthingAuthContext);
}
