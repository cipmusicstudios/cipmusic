import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LogOut, UserRound } from 'lucide-react';
import { useAuthingAuth } from './authing-provider';
import { authingAvatarUrl, authingDisplayName } from './authing-profile';

type NavT = {
  settings: { logout: string };
};

/**
 * 仅已登录时在顶栏展示用户入口；未登录时不在顶栏放 Log In / Sign Up（入口在 Guest 卡片与功能弹层）。
 */
export function TopNavAuth({ t }: { t: NavT }) {
  const { isConfigured, ready, user, logout } = useAuthingAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  if (!isConfigured || !ready || !user) return null;

  const name = authingDisplayName(user);
  const avatar = authingAvatarUrl(user);

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setMenuOpen(v => !v)}
        className="topnav-auth-user flex items-center gap-2 rounded-full border border-white/25 bg-white/15 py-1 pl-1 pr-3 transition-colors hover:bg-white/22"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        {avatar ? (
          <img src={avatar} alt="" className="h-8 w-8 rounded-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/22 text-[var(--color-mist-text)]/75">
            <UserRound className="h-4 w-4" />
          </span>
        )}
        <span className="max-w-[7rem] truncate text-xs font-semibold text-[var(--color-mist-text)]/88">{name}</span>
      </button>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            className="glass-popover absolute right-0 top-full z-[60] mt-2 min-w-[180px] rounded-2xl p-2"
            role="menu"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void logout();
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[var(--color-mist-text)]/80 transition-colors hover:bg-white/30"
            >
              <LogOut className="h-4 w-4 shrink-0 opacity-70" />
              {t.settings.logout}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
