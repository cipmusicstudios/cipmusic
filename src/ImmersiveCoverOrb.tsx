/**
 * Draggable floating cover orb to exit immersive mode. Position updates via refs during drag;
 * only commits to localStorage on pointer up.
 */
import React, {useLayoutEffect, useEffect, useRef, useCallback} from 'react';
import {Music} from 'lucide-react';

const ORB_PX = 64;
const MARGIN = 12;
const DRAG_THRESHOLD_PX = 8;
const STORAGE_KEY = 'aurasounds_immersive_orb_pos_v1';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function readStoredPosition(): {left: number; top: number} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as {left?: number; top?: number};
    if (typeof p.left !== 'number' || typeof p.top !== 'number') return null;
    return {left: p.left, top: p.top};
  } catch {
    return null;
  }
}

function defaultPosition(): {left: number; top: number} {
  const w = typeof window !== 'undefined' ? window.innerWidth : 800;
  const h = typeof window !== 'undefined' ? window.innerHeight : 600;
  return {
    left: w - ORB_PX - 24,
    top: h - ORB_PX - 28,
  };
}

function clampPosition(left: number, top: number): {left: number; top: number} {
  const w = typeof window !== 'undefined' ? window.innerWidth : 800;
  const h = typeof window !== 'undefined' ? window.innerHeight : 600;
  return {
    left: clamp(left, MARGIN, w - ORB_PX - MARGIN),
    top: clamp(top, MARGIN, h - ORB_PX - MARGIN),
  };
}

export const ImmersiveCoverOrb = React.memo(function ImmersiveCoverOrb({
  coverUrl,
  isPlaying,
  onExit,
  showControlsTitle,
}: {
  coverUrl: string | undefined;
  isPlaying: boolean;
  onExit: () => void;
  showControlsTitle: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const posRef = useRef<{left: number; top: number}>(defaultPosition());
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
  } | null>(null);
  const movedRef = useRef(false);
  const [useIconFallback, setUseIconFallback] = React.useState(false);

  const applyPos = useCallback((left: number, top: number) => {
    const p = clampPosition(left, top);
    posRef.current = p;
    const el = btnRef.current;
    if (el) {
      el.style.left = `${p.left}px`;
      el.style.top = `${p.top}px`;
    }
  }, []);

  useLayoutEffect(() => {
    const stored = readStoredPosition();
    if (stored) {
      applyPos(stored.left, stored.top);
    } else {
      applyPos(posRef.current.left, posRef.current.top);
    }
  }, [applyPos]);

  useEffect(() => {
    const onResize = () => applyPos(posRef.current.left, posRef.current.top);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [applyPos]);

  useEffect(() => {
    setUseIconFallback(false);
  }, [coverUrl]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    movedRef.current = false;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: posRef.current.left,
      originTop: posRef.current.top,
    };
    try {
      (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) movedRef.current = true;
    applyPos(d.originLeft + dx, d.originTop + dy);
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLButtonElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(posRef.current));
    } catch {
      /* ignore */
    }
    if (!movedRef.current) {
      onExit();
    }
    movedRef.current = false;
  };

  const onLostPointerCapture = (e: React.PointerEvent) => {
    if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
      dragRef.current = null;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(posRef.current));
      } catch {
        /* ignore */
      }
    }
  };

  const hasCover = Boolean(coverUrl && coverUrl.trim());
  const showIconOnly = !hasCover || useIconFallback;

  return (
    <button
      ref={btnRef}
      type="button"
      className={`immersive-cover-orb pointer-events-auto fixed z-[55] h-16 w-16 cursor-grab touch-none select-none rounded-full border-0 bg-transparent p-0 transition-transform duration-300 ease-out hover:scale-[1.03] active:cursor-grabbing active:scale-100 ${
        isPlaying ? 'immersive-cover-orb--playing' : ''
      }`}
      title={showControlsTitle}
      aria-label={showControlsTitle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={onLostPointerCapture}
    >
      {/* 外环高光 + 与背景分离 */}
      <span
        className="pointer-events-none absolute -inset-[3px] rounded-full border border-white/50 bg-[rgba(255,252,248,0.22)] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
        aria-hidden
      />
      <span className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.38)]" aria-hidden />
      <span className="relative block h-full w-full overflow-hidden rounded-full bg-[#e0d9d2] shadow-[inset_0_8px_24px_rgba(255,255,255,0.12),inset_0_-10px_28px_rgba(12,10,8,0.28)]">
        {showIconOnly ? (
          <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#f2ebe4] to-[#ddd4cc] text-[var(--color-mist-text)]/60">
            <Music className="h-8 w-8" strokeWidth={1.5} aria-hidden />
          </span>
        ) : (
          <span className="relative block h-full w-full overflow-hidden rounded-full">
            <img
              src={coverUrl!.trim()}
              alt=""
              className="h-full w-full scale-[1.1] object-cover [transform-origin:center]"
              draggable={false}
              referrerPolicy="no-referrer"
              onError={() => setUseIconFallback(true)}
            />
          </span>
        )}
        {/* 球面高光 + 边缘压暗 */}
        <span
          className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_24%,rgba(255,255,255,0.52)_0%,transparent_48%)] opacity-95"
          aria-hidden
        />
        <span
          className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_3px_12px_rgba(255,255,255,0.22),inset_0_-6px_18px_rgba(8,6,5,0.35)]"
          aria-hidden
        />
        <span
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[48%] rounded-b-full bg-gradient-to-t from-[rgba(10,8,6,0.28)] to-transparent opacity-90"
          aria-hidden
        />
      </span>
    </button>
  );
});
