import React from 'react';

/** 顶部 / 底部播放器共用的沉浸模式入口（hover 显示，小圆、暖白玻璃、减号） */
const BTN =
  'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-white/45 bg-gradient-to-b from-white/55 to-[rgba(255,252,248,0.42)] text-[var(--color-mist-text)] shadow-[0_2px_8px_rgba(72,54,37,0.12),inset_0_1px_0_rgba(255,255,255,0.55)] transition-[opacity,background-color,border-color] duration-200 md:hover:border-white/55 md:hover:from-white/62 md:hover:to-[rgba(255,252,248,0.5)]';

const MINUS =
  'pointer-events-none flex h-full w-full items-center justify-center text-[17px] font-semibold leading-none tracking-tight [transform:translateY(-0.5px)]';

const VIS_BASE =
  'pointer-events-none opacity-0 transition-opacity duration-200 max-md:pointer-events-auto max-md:opacity-100 md:pointer-events-none md:opacity-0';

type Props = {
  onClick: () => void;
  title: string;
  /** 底部：锚定 player-bar，`group` 在 app-chrome-shell */
  variant: 'player';
} | {
  onClick: () => void;
  title: string;
  /** 顶部：`group/topnav` 在 topnav-bar */
  variant: 'topnav';
};

export const ImmersiveModeEntryButton = React.memo(function ImmersiveModeEntryButton(
  props: Props,
) {
  const { onClick, title, variant } = props;
  /** 顶/底均锚定各自磨砂条右上角半嵌（≈ -6px），与 BottomPlayer 一致 */
  const position = 'absolute -top-1.5 -right-1.5';
  const groupHover =
    variant === 'player'
      ? 'md:group-hover/player:pointer-events-auto md:group-hover/player:opacity-100'
      : 'md:group-hover/topnav:pointer-events-auto md:group-hover/topnav:opacity-100';
  const zNav = variant === 'topnav' ? 'z-[22]' : 'z-[25]';

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`${VIS_BASE} ${position} ${zNav} ${BTN} ${groupHover}`}
    >
      <span className={MINUS} aria-hidden>
        −
      </span>
    </button>
  );
});
