/**
 * Account 页 Favorites / Recently Played：全宽纵向折叠卡片 + 横向列表行（无 modal、无重 blur）。
 */
import React, { memo, useMemo, useState } from 'react';
import { Heart, History, ChevronDown } from 'lucide-react';
import type { Track } from './types/track';
import { premiumUi } from './premium-ui';
import { getDisplayTrackTitle, getDisplayTrackArtist } from './track-display';

const foldCardClass = `w-full overflow-hidden ${premiumUi.subtleCard}`;

const listScrollClass =
  'max-h-[min(48vh,320px)] w-full overflow-y-auto overscroll-contain border-t border-white/10 bg-white/[0.04] px-3 py-1';

const AccountLibraryRow = memo(function AccountLibraryRow({
  id,
  track,
  currentLang,
}: {
  id: string;
  track: Track | null;
  currentLang: string;
}) {
  const title = track ? getDisplayTrackTitle(track, currentLang) : id;
  const artist = track ? getDisplayTrackArtist(track, currentLang) : '';

  return (
    <li className="flex min-h-[40px] items-center gap-3 border-b border-white/[0.08] py-1.5 last:border-b-0">
      <p className="min-w-0 flex-1 truncate text-left text-[13px] font-medium leading-snug text-[var(--color-mist-text)]/90">
        {title}
      </p>
      <p className="max-w-[48%] shrink-0 truncate text-right text-[12px] leading-snug text-[var(--color-mist-text)]/55">
        {artist || '—'}
      </p>
    </li>
  );
});

export const SettingsAccountLibraryBlock = memo(function SettingsAccountLibraryBlock({
  favoriteIds,
  recentTrackIds,
  tracks,
  currentLang,
  t,
}: {
  favoriteIds: string[];
  recentTrackIds: string[];
  tracks: Track[];
  currentLang: string;
  t: any;
}) {
  /** 同时只展开一个：点另一项会切换；再点当前项收起 */
  const [open, setOpen] = useState<null | 'favorites' | 'recent'>(null);

  const favoriteRows = useMemo(
    () =>
      favoriteIds.map(id => ({
        id,
        track: tracks.find(tr => tr.id === id) ?? null,
      })),
    [favoriteIds, tracks],
  );
  const recentRows = useMemo(
    () =>
      recentTrackIds.map(id => ({
        id,
        track: tracks.find(tr => tr.id === id) ?? null,
      })),
    [recentTrackIds, tracks],
  );

  const toggle = (key: 'favorites' | 'recent') => {
    setOpen(o => (o === key ? null : key));
  };

  return (
    <div className="settings-account-library-stack flex w-full flex-col gap-4">
      <div className={foldCardClass}>
        <button
          type="button"
          onClick={() => toggle('favorites')}
          aria-expanded={open === 'favorites'}
          className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.06]"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className={premiumUi.iconWrap}>
              <Heart className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-[var(--color-mist-text)]/88">{t.settings.myFavorites}</span>
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-[var(--color-mist-text)]/45 transition-transform duration-200 ${
              open === 'favorites' ? 'rotate-180' : ''
            }`}
            aria-hidden
          />
        </button>
        {open === 'favorites' && (
          <div className={listScrollClass} role="region" aria-label={t.settings.myFavorites}>
            {favoriteRows.length === 0 ? (
              <p className="px-2 py-4 text-sm leading-relaxed text-[var(--color-mist-text)]/58">{t.settings.favoritesEmpty}</p>
            ) : (
              <ul className="w-full">
                {favoriteRows.map(({ id, track }) => (
                  <AccountLibraryRow key={id} id={id} track={track} currentLang={currentLang} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className={foldCardClass}>
        <button
          type="button"
          onClick={() => toggle('recent')}
          aria-expanded={open === 'recent'}
          className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.06]"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className={premiumUi.iconWrap}>
              <History className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-[var(--color-mist-text)]/88">{t.settings.recentlyPlayed}</span>
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-[var(--color-mist-text)]/45 transition-transform duration-200 ${
              open === 'recent' ? 'rotate-180' : ''
            }`}
            aria-hidden
          />
        </button>
        {open === 'recent' && (
          <div className={listScrollClass} role="region" aria-label={t.settings.recentlyPlayed}>
            {recentRows.length === 0 ? (
              <p className="px-2 py-4 text-sm leading-relaxed text-[var(--color-mist-text)]/58">{t.settings.recentEmpty}</p>
            ) : (
              <ul className="w-full">
                {recentRows.map(({ id, track }) => (
                  <AccountLibraryRow key={id} id={id} track={track} currentLang={currentLang} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
