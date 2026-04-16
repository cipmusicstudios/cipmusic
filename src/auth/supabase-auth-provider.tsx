import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export function supabaseUserDisplayName(user: User | null): string {
  if (!user) return '';
  const m = user.user_metadata as Record<string, unknown> | undefined;
  const full = m?.full_name ?? m?.name;
  if (typeof full === 'string' && full.trim()) return full.trim();
  const email = user.email;
  if (email) return email.split('@')[0] ?? email;
  return 'User';
}

export function supabaseUserAvatarUrl(user: User | null): string | null {
  if (!user) return null;
  const m = user.user_metadata as Record<string, unknown> | undefined;
  const u = m?.avatar_url ?? m?.picture;
  return typeof u === 'string' && u ? u : null;
}

type SupabaseAuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithOtp: (email: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
};

const SupabaseAuthContext = createContext<SupabaseAuthContextValue | null>(null);

export function SupabaseAuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setSession(null);
      setLoading(false);
      return;
    }
    let mounted = true;
    void supabase.auth.getSession().then(({ data: { session: next } }) => {
      if (!mounted) return;
      setSession(next);
      setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      console.error('[SupabaseAuth] signInWithGoogle skipped: Supabase env not configured');
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) console.error('[SupabaseAuth] signInWithGoogle', error);
  }, []);

  const signInWithOtp = useCallback(async (email: string) => {
    if (!isSupabaseConfigured()) {
      return { error: new Error('Supabase not configured') };
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    return { error: error ? new Error(error.message) : null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    (): SupabaseAuthContextValue => ({
      session,
      user: session?.user ?? null,
      loading,
      signInWithGoogle,
      signInWithOtp,
      signOut,
    }),
    [session, loading, signInWithGoogle, signInWithOtp, signOut],
  );

  return <SupabaseAuthContext.Provider value={value}>{children}</SupabaseAuthContext.Provider>;
}

export function useSupabaseAuth(): SupabaseAuthContextValue {
  const ctx = useContext(SupabaseAuthContext);
  if (!ctx) throw new Error('useSupabaseAuth must be used within SupabaseAuthProvider');
  return ctx;
}
