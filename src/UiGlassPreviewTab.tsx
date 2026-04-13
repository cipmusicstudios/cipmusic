import { memo } from 'react';
import { Sparkles } from 'lucide-react';
import { premiumUi } from './premium-ui';

/** 与 MusicTab 工具栏同族，便于对照 */
const MUSIC_STRIP_DEMO = 'glass-panel !rounded-2xl px-4 py-3.5 sm:px-5 sm:py-4';

type PreviewCopy = {
  title: string;
  subtitle: string;
  labelPanel: string;
  descPanel: string;
  labelActive: string;
  descActive: string;
  labelEffect: string;
  descEffect: string;
  labelTile: string;
  descTile: string;
  labelUtility: string;
  descUtility: string;
  labelPopover: string;
  descPopover: string;
  labelPlayer: string;
  descPlayer: string;
  labelMusicStrip: string;
  descMusicStrip: string;
  labelPremiumCard: string;
  sampleRow: string;
  sampleTile: string;
};

export const UiGlassPreviewTab = memo(function UiGlassPreviewTab({ t }: { t: { uiPreview: PreviewCopy } }) {
  const u = t.uiPreview;

  return (
    <div className="w-full max-w-5xl mx-auto pb-16 animate-in fade-in duration-500">
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 text-[var(--color-mist-text)]/88 mb-2">
          <Sparkles className="w-5 h-5 opacity-70" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">{u.title}</h1>
        </div>
        <p className="text-sm text-[var(--color-mist-text)]/58 max-w-xl mx-auto leading-relaxed">{u.subtitle}</p>
      </div>

      <div className="relative rounded-[32px] overflow-hidden border border-white/15">
        <div
          className="absolute inset-0 pointer-events-none opacity-90"
          style={{
            background: `linear-gradient(135deg, rgba(182,132,84,0.14) 0%, transparent 42%, rgba(99,160,200,0.1) 100%),
              repeating-linear-gradient(90deg, transparent, transparent 44px, rgba(255,255,255,0.05) 44px, rgba(255,255,255,0.05) 45px)`,
          }}
        />
        <div className="relative p-6 sm:p-8 flex flex-col gap-8">
          <div className="grid gap-6 md:grid-cols-2">
            <figure className="flex flex-col gap-2 min-w-0">
              <figcaption className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-mist-text)]/45">
                {u.labelPanel}
              </figcaption>
              <div className="glass-panel rounded-[24px] p-5 text-sm text-[var(--color-mist-text)]/78">{u.descPanel}</div>
            </figure>
            <figure className="flex flex-col gap-2 min-w-0">
              <figcaption className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-mist-text)]/45">
                {u.labelActive}
              </figcaption>
              <div className="glass-panel-active rounded-[24px] p-5 text-sm text-[var(--color-mist-text)]">{u.descActive}</div>
            </figure>
            <figure className="flex flex-col gap-2 min-w-0 md:col-span-2">
              <figcaption className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-mist-text)]/45">
                {u.labelEffect}
              </figcaption>
              <div className="glass-effect rounded-[28px] p-6 text-sm text-[var(--color-mist-text)]/78">{u.descEffect}</div>
            </figure>
          </div>

          <figure className="flex flex-col gap-2">
            <figcaption className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-mist-text)]/45">
              {u.labelMusicStrip}
            </figcaption>
            <div className={`${MUSIC_STRIP_DEMO} flex flex-wrap items-center gap-3 text-sm text-[var(--color-mist-text)]/72`}>
              <span className="font-medium text-[var(--color-mist-text)]/88">{u.descMusicStrip}</span>
              <span className="rounded-lg bg-black/[0.06] px-3 py-1 text-xs">Demo</span>
            </div>
          </figure>

          <div className="grid gap-6 md:grid-cols-2">
            <figure className="flex flex-col gap-3 min-w-0">
              <figcaption className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-mist-text)]/45">
                {u.labelTile}
              </figcaption>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="glass-tile rounded-2xl px-3 py-4 text-center text-xs text-[var(--color-mist-text)]/65">
                    {u.sampleTile} {i + 1}
                  </div>
                ))}
              </div>
              <p className="text-xs text-[var(--color-mist-text)]/50 leading-relaxed">{u.descTile}</p>
            </figure>
            <figure className="flex flex-col gap-3 min-w-0">
              <figcaption className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-mist-text)]/45">
                {u.labelUtility}
              </figcaption>
              <div className="flex flex-col gap-2">
                {[1, 2, 3].map(i => (
                  <div
                    key={i}
                    className="glass-utility rounded-xl px-4 py-3 border border-white/10 text-sm text-[var(--color-mist-text)]/70"
                  >
                    {u.sampleRow} {i}
                  </div>
                ))}
              </div>
              <p className="text-xs text-[var(--color-mist-text)]/50 leading-relaxed">{u.descUtility}</p>
            </figure>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <figure className="flex flex-col gap-2 relative min-h-[120px]">
              <figcaption className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-mist-text)]/45">
                {u.labelPopover}
              </figcaption>
              <div className="relative flex-1 min-h-[100px] rounded-2xl border border-dashed border-white/20 flex items-center justify-center p-4">
                <div className="glass-popover rounded-2xl p-3 text-sm text-[var(--color-mist-text)]/80 shadow-lg">{u.descPopover}</div>
              </div>
            </figure>
            <figure className="flex flex-col gap-2 min-w-0">
              <figcaption className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-mist-text)]/45">
                {u.labelPlayer}
              </figcaption>
              <div className="player-bar rounded-t-2xl rounded-b-xl px-4 py-3 flex items-center gap-3 text-xs text-[var(--color-mist-text)]/70">
                <div className="h-10 w-10 rounded-lg bg-white/25 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate text-[var(--color-mist-text)]/88">Track title</div>
                  <div className="truncate opacity-60">Artist</div>
                </div>
                <span className="shrink-0 opacity-50 tabular-nums">0:42</span>
              </div>
              <p className="text-xs text-[var(--color-mist-text)]/50 leading-relaxed">{u.descPlayer}</p>
            </figure>
          </div>

          <figure className="flex flex-col gap-2">
            <figcaption className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-mist-text)]/45">
              {u.labelPremiumCard}
            </figcaption>
            <div className={premiumUi.card}>
              <p className="text-sm text-[var(--color-mist-text)]/72 leading-relaxed">{premiumUi.body}</p>
            </div>
          </figure>
        </div>
      </div>
    </div>
  );
});
