/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, memo, Suspense, useRef } from 'react';
import { supabase } from './lib/supabase';
import { toSupabaseStoragePublicUrl } from './lib/supabase-storage-public-url';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, Volume1, VolumeX,
  Search, Settings, CloudRain, CloudLightning, Clock,
  User, ChevronLeft, ChevronRight, ChevronDown,
  Lock, Moon, Flame, Waves, Wind, MoonStar,
  TreePine, AudioLines, Coffee, BookOpen, Youtube, Brain,
  Piano, X, Activity, AlarmClock, Timer, Globe, ExternalLink, MessageCircle, Tv,
  Mail, Radio, Sparkles, Smartphone, TreeDeciduous, Library,
  Heart, History
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { en } from './locales/en';
import { zhCN } from './locales/zh-cn';
import { zhTW } from './locales/zh-tw';
import type { View } from './types/view';
import { premiumUi, premiumUiModal } from './premium-ui';
import {MembershipCheckoutModal} from './membership-checkout-modal';
import {ImmersiveCoverOrb} from './ImmersiveCoverOrb';
import {ImmersiveModeEntryButton} from './ImmersiveModeEntryButton';
import {
  accountAutoRenewLabel,
  daysUntilDate,
  fetchRemoteUserMembership,
  formatMembershipDateOnly,
  normalizePaymentProvider,
  remotePremiumEntitled,
  type RemoteMembershipFetchFailureReason,
  type RemoteUserMembership,
} from './lib/membership-remote';
import { SettingsAccountLibraryBlock } from './settings-account-library';
import { UiGlassPreviewTab } from './UiGlassPreviewTab';
import { supabaseUserDisplayName, useSupabaseAuth } from './auth/supabase-auth-provider';
import { SupabaseAuthModal, type SupabaseAuthModalMode } from './auth/supabase-auth-modal';
import { SupabaseResetPasswordGate } from './auth/supabase-reset-password-gate';
import { defaultMusicPlaybackContext, type MusicPlaybackContext } from './music-playback-context';
import { pickNextSmartRadioTrack, pushRecentTrackId } from './smart-radio-pick';
import {
  loadFavoriteIds,
  saveFavoriteIds,
  loadRecentTrackIds,
  saveRecentTrackIds,
  toggleFavoriteList,
  touchRecentList,
} from './user-library-storage';
import type { Track, MetadataCandidate, TrackMetadata } from './types/track';
export type { MetadataCandidate, Track, TrackMetadata } from './types/track';
import type { PracticeSeekDebug } from './practice/practice-types';
import {
  normalizeTextStatic,
  normalizeSearchStatic,
  getTrackCategoryKeysStatic,
} from './category-keys';
import {
  getSongsManifestUrl,
  manifestEntryToTrack,
  mergeCanonicalIntoTrack,
  isSongsManifestCatalog,
  resolveSongsManifestChunkUrl,
} from './songs-manifest';
import type { SongManifestEntry } from './songs-manifest';
import {
  getPlaybackTimelineSnapshot,
  resetPlaybackTimeline,
  setPlaybackTimelineDuration,
  setPlaybackTimelineTime,
  usePlaybackDurationValue,
  usePlaybackTimelineTime,
} from './playback-timeline-store';
import {
  getDisplayTrackTitle,
  getDisplayTrackArtist,
  getTrackYoutubeUrl,
  getTrackBilibiliUrlForLocale,
  trackHasExternalVideo,
  getTrackSheetUrl,
  hasPracticeAssets,
} from './track-display';

type MembershipFetchIssue = 'none' | RemoteMembershipFetchFailureReason;

const PracticePanel = React.lazy(() =>
  import('./practice/PracticePanelModule').then(m => ({ default: m.PracticePanel })),
);

const MusicTabLazy = React.lazy(() => import('./MusicTab').then(m => ({ default: m.MusicTab })));

const translations: Record<string, any> = {
  'English': en,
  '简体中文': zhCN,
  '繁體中文': zhTW
};

const defaultTrack: Track = {
  id: 'golden_piano',
  title: 'Golden',
  artist: 'HUNTR/X',
  category: 'K-pop',
  tags: ['Film'],
  duration: '03:12',
  audioUrl: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/music/Golden-piano.mp3',
  coverUrl: 'https://picsum.photos/seed/golden/100/100',
  youtubeUrl: 'https://www.youtube.com/watch?v=Z_00MYjo0-Q',
  sheetUrl: 'https://www.mymusic5.com/cipmusic/309097',
  midiUrl: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/midi/golden-piano.midi',
  practiceEnabled: true,
  metadata: {
    identity: {
      id: 'golden_piano',
      importSource: 'remote',
    },
    display: {
      title: 'Golden',
      titles: {
        en: 'Golden',
      },
      artist: 'HUNTR/X',
      category: 'K-pop',
      categories: {
        primary: '韩流流行',
        tags: ['影视', '动漫'],
      },
      cover: 'https://picsum.photos/seed/golden/100/100',
      normalizedArtistsInfo: [{ id: 'huntr-x', names: { zhHans: 'HUNTR/X', en: 'HUNTR/X' }, type: 'group', nationality: 'other' }],
    },
    assets: {
      audioUrl: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/music/Golden-piano.mp3',
      midiUrl: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/midi/golden-piano.midi',
      hasPracticeAssets: true,
      practiceEnabled: true,
      durationLabel: '03:12',
    },
    links: {
      youtube: 'https://www.youtube.com/watch?v=Z_00MYjo0-Q',
      sheet: 'https://www.mymusic5.com/cipmusic/309097',
    },
  },
};

const BG_FALLBACK_IMAGE_URL = "https://i.imgur.com/o9yXFgS.png";
export type Scene = {
  id: string;
  name: string;
  tag: string;
  type: 'image' | 'video';
  url: string;
  thumbnail: string;
  premiumOnly?: boolean;
};

export const SCENES: Scene[] = [
  { id: 'tideHaven', name: 'Tidal Oasis', tag: 'cafe', type: 'video', url: 'https://pub-9240560f200a43d8a64bb9102acd49e9.r2.dev/pianocafe.mp4', thumbnail: BG_FALLBACK_IMAGE_URL, premiumOnly: false },
  { id: 'rainlightHall', name: 'Rainlight Oasis', tag: 'rain', type: 'video', url: 'https://pub-9240560f200a43d8a64bb9102acd49e9.r2.dev/rainhall.mp4', thumbnail: 'https://i.imgur.com/iq2hWwS.jpeg', premiumOnly: false },
  { id: 'forestCafe', name: 'Forest Oasis', tag: 'forest', type: 'video', url: 'https://pub-9240560f200a43d8a64bb9102acd49e9.r2.dev/forest.mp4', thumbnail: 'https://i.imgur.com/GGg2cSI.jpeg', premiumOnly: true },
  { id: 'celestialDome', name: 'Celestial Oasis', tag: 'night', type: 'video', url: 'https://pub-9240560f200a43d8a64bb9102acd49e9.r2.dev/starry.mp4', thumbnail: 'https://i.imgur.com/E5TWs8E.jpeg', premiumOnly: true },
];

/** Remote `songs` columns used in UI (avoid `select('*')` payload). Full rows load after idle. */
/**
 * 与当前 Supabase 表结构一致（远端若无 bilibili_url 列则勿选，否则会 42703）。
 * Phase 1 止血：`midi_url` / `musicxml_url` 不再由 anon 客户端直接查询，真实 URL
 * 改由 `/.netlify/functions/practice-asset-url` broker 按需签发；前端只通过
 * `has_practice_mode` 布尔判断 Practice 按钮是否可点。
 */
const SUPABASE_REMOTE_SONG_COLUMNS =
  'id,slug,title,artist,primary_category,secondary_category,duration,audio_url,cover_url,has_practice_mode,youtube_url,sheet_url,source_song_title,source_artist,source_cover_url,source_album,source_release_year,source_category,source_genre,metadata_source,metadata_confidence,metadata_status,metadata_candidates';

const SUPABASE_SONGS_BUCKET = (import.meta.env.VITE_SUPABASE_SONGS_BUCKET as string | undefined)?.trim() || 'songs';

/**
 * 与 `scripts/build-songs-manifest.ts` 的 `toPublicStorageUrl` 一致：库内若存相对路径（如 `songs/slug/audio.mp3`），
 * 必须展开为 `https://…/storage/v1/object/public/{bucket}/…`，否则浏览器会把 `audio.mp3` 解析成站点根路径 `/audio.mp3`。
 */
function mapSupabaseRowToRemoteTrack(song: Record<string, unknown>): Track {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const resolve = (v: unknown) => toSupabaseStoragePublicUrl(supabaseUrl, SUPABASE_SONGS_BUCKET, v as string | undefined);
  const audioUrl = resolve(song.audio_url);
  const coverUrl = resolve(song.cover_url) || '';
  const sourceCoverUrl = resolve(song.source_cover_url) || undefined;
  const duration = (song.duration as string) || '00:00';
  /**
   * Phase 1 止血：不再从 DB 读 midi_url / musicxml_url。Practice 按钮可见性完全取决于
   * 服务端 `has_practice_mode` 布尔；真实 URL 由 practice-asset-url broker 签发。
   *
   * 不再绑定 `audio_url`：DB 约束上 has_practice_mode=true 的行已保证 audio/midi/xml 齐全
   * （见 scripts/audit-practice-dirty-rows.ts 的 Q2a/Q2b 结果=0）。同时 Phase 3 会把
   * audio_url 也从 anon select 里拿掉、改为 signed broker 签发，那时若继续绑定
   * `Boolean(song.audio_url)`，会导致所有 Practice 按钮一夜之间消失。
   */
  const hasPracticeAssetsRow = song.has_practice_mode === true;

  return {
    id: song.id as string,
    title: song.title as string,
    artist: song.artist as string,
    category: (song.primary_category as string) || 'Originals',
    tags: (song.secondary_category as string[]) || [],
    duration,
    audioUrl,
    coverUrl,
    musicxmlUrl: undefined,
    midiUrl: undefined,
    practiceEnabled: hasPracticeAssetsRow,
    youtubeUrl: song.youtube_url as string,
    bilibiliUrl: (song.bilibili_url as string | undefined) ?? '',
    sheetUrl: song.sheet_url as string,
    sourceSongTitle: song.source_song_title as string,
    sourceArtist: song.source_artist as string,
    sourceCoverUrl,
    sourceAlbum: song.source_album as string,
    sourceReleaseYear: song.source_release_year as string,
    sourceCategory: song.source_category as string,
    sourceGenre: song.source_genre as string,
    metadataSource: song.metadata_source as string,
    metadataConfidence: song.metadata_confidence as number,
    metadataStatus: (song.metadata_status as string) || 'pending',
    metadataCandidates: (song.metadata_candidates as MetadataCandidate[]) || [],
    importSource: 'remote' as const,
    metadata: {
      identity: {
        id: song.id as string,
        slug: (song.slug as string | undefined) || undefined,
        importSource: 'remote' as const,
      },
      display: {
        title: song.title as string,
        artist: song.artist as string,
        category: (song.primary_category as string) || 'Originals',
        categories: {
          primary: (song.primary_category as string) || 'Originals',
          tags: (song.secondary_category as string[]) || [],
        },
        cover: coverUrl,
      },
      assets: {
        audioUrl,
        midiUrl: undefined,
        musicxmlUrl: undefined,
        hasPracticeAssets: hasPracticeAssetsRow,
        practiceEnabled: hasPracticeAssetsRow,
        durationLabel: duration,
      },
      links: {
        youtube: song.youtube_url as string,
        video: (song.bilibili_url as string | undefined) ?? '',
        sheet: song.sheet_url as string,
      },
      enrichment: {
        status: song.metadata_status === 'approved' ? 'auto' : 'manual',
      },
    },
  };
}

type AmbientKey =
  | 'window_rain'
  | 'thunderstorm'
  | 'ocean'
  | 'forest'
  | 'white_noise'
  | 'night_ambient'
  | 'library'
  | 'fireplace'
  | 'cafe';

type AmbientCatalogItem = {
  id: AmbientKey;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  imageUrl: string;
  audioUrl: string;
  tag: string;
};

const AMBIENCE_AUDIO_URLS: Record<AmbientKey, string> = {
  window_rain: '/ambience/windowrain.mp3',
  thunderstorm: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/thunderstorm.mp3',
  ocean: '/ambience/ocean.mp3',
  forest: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/forest.mp3',
  white_noise: '/ambience/white-noise.mp3',
  night_ambient: '/ambience/night.mp3',
  library: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/library.mp3',
  fireplace: '/ambience/fireplace.mp3',
  cafe: '/ambience/cafe.mp3',
};

const AMBIENCE_DEFAULT_VOLUMES: Record<AmbientKey, number> = {
  window_rain: 55,
  thunderstorm: 50,
  ocean: 55,
  forest: 65,
  white_noise: 50,
  night_ambient: 90,
  library: 82,
  fireplace: 88,
  cafe: 78,
};

const AMBIENCE_GAIN_TRIMS: Record<AmbientKey, number> = {
  window_rain: 1,
  thunderstorm: 1,
  ocean: 1,
  forest: 1.2,
  white_noise: 1,
  night_ambient: 2.2,
  library: 1.8,
  fireplace: 1.9,
  cafe: 1.6,
};
const AMBIENCE_KEYS = Object.keys(AMBIENCE_AUDIO_URLS) as AmbientKey[];
const AMBIENCE_FADE_IN_MS = 180;
const AMBIENCE_FADE_OUT_MS = 220;

const BackgroundLayer = memo(function BackgroundLayer({
  scene,
  lightweight = false,
}: {
  scene: Scene;
  lightweight?: boolean;
}) {
  const [videoError, setVideoError] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [showImg, setShowImg] = useState(true);

  React.useEffect(() => {
    setVideoError(false);
    setVideoReady(false);
    setShowImg(true);
  }, [scene.url]);

  React.useEffect(() => {
    // 跨越 220ms 的 opacity fade-out 后，彻底卸载 <img> 释放显存图层
    if (videoReady && scene.type === 'video') {
      const tmr = setTimeout(() => setShowImg(false), 300);
      return () => clearTimeout(tmr);
    }
  }, [videoReady, scene.type]);

  const wrapperStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    width: '100vw',
    height: '100vh',
    zIndex: 0,
    pointerEvents: 'none',
    isolation: 'isolate',
    contain: 'paint',
  };

  const mediaStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    width: '100vw',
    height: '100vh',
    objectFit: 'cover',
    zIndex: 0,
    pointerEvents: 'none',
    transform: 'translateZ(0)',
    backfaceVisibility: 'hidden',
    willChange: 'opacity, transform',
  };

  const canUseVideo = scene.type === 'video' && !lightweight && !videoError;

  return (
    <div style={wrapperStyle}>
      {showImg && (
        <img
          src={scene.thumbnail || scene.url}
          alt={scene.name}
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
          loading="eager"
          decoding="async"
          fetchPriority="high"
          style={{
            ...mediaStyle,
            opacity: canUseVideo && videoReady ? 0 : 1,
            transition: 'opacity 220ms ease',
          }}
        />
      )}
      {canUseVideo && (
        <video
          src={scene.url}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster={scene.thumbnail}
          onLoadedData={() => setVideoReady(true)}
          onCanPlay={() => setVideoReady(true)}
          onError={() => setVideoError(true)}
          style={{
            ...mediaStyle,
            opacity: videoReady ? 1 : 0,
            transition: 'opacity 220ms ease',
          }}
        />
      )}
    </div>
  );
});

export default function App() {
  const [activeView, setActiveView] = useState<View>(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace(/^#/, '');
      if (hash === 'glass-ui') return 'uiPreview';
      if (hash === 'settings-preview') return 'settings';
    }
    return 'home';
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track>(defaultTrack);
  const [tracks, setTracks] = useState<Track[]>([]);
  /** 仅乐库页：与 MusicTab 当前筛选一致的曲目顺序，供底部播放器上一首/下一首 */
  const [musicLibraryPlaybackQueue, setMusicLibraryPlaybackQueue] = useState<Track[]>([]);
  /** Smart Radio：乐库内浏览上下文（艺人页 / 分类），由 MusicTab 同步 */
  const [musicTabContext, setMusicTabContext] = useState<MusicPlaybackContext>(defaultMusicPlaybackContext);
  const smartRadioRecentRef = React.useRef<string[]>([]);
  /** 交叉淡入淡出结束后，主音频从该秒继续（避免 React 重置到 0） */
  const playbackHandoffRef = React.useRef<number | null>(null);

  const [isLoadingTracks, setIsLoadingTracks] = useState(true);
  const [artistsData, setArtistsData] = useState<any[]>([]);
  /** 首屏仅用静态背景图；空闲后再挂 `<video>`，避免首帧解码阻塞 */
  const [homeBackgroundVideoEnabled, setHomeBackgroundVideoEnabled] = useState(false);
  const [currentLang, setCurrentLang] = useState('English');
  const t = translations[currentLang] || en;
  const { session } = useSupabaseAuth();
  const [appPathname, setAppPathname] = useState(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/',
  );
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<SupabaseAuthModalMode>('sign-in');
  const [checkoutBump, setCheckoutBump] = useState(0);
  const pendingCheckoutAfterAuthRef = useRef(false);

  const openAuthModal = useCallback((mode: SupabaseAuthModalMode, afterAuth?: 'checkout') => {
    setAuthModalMode(mode);
    pendingCheckoutAfterAuthRef.current = afterAuth === 'checkout';
    setAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    pendingCheckoutAfterAuthRef.current = false;
    setAuthModalOpen(false);
  }, []);

  const clearResetPasswordPath = useCallback(() => {
    window.history.replaceState({}, '', '/');
    setAppPathname('/');
  }, []);

  useEffect(() => {
    const onPop = () => setAppPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const handleAuthModalSuccess = useCallback(() => {
    if (pendingCheckoutAfterAuthRef.current) {
      pendingCheckoutAfterAuthRef.current = false;
      setCheckoutBump(b => b + 1);
    }
  }, []);
  const musicPlaybackContext = useMemo((): MusicPlaybackContext => {
    if (activeView !== 'music') {
      return { ...defaultMusicPlaybackContext, musicLibraryActive: false };
    }
    return { ...musicTabContext, musicLibraryActive: true };
  }, [activeView, musicTabContext]);
  const [showSheetOptions, setShowSheetOptions] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const { data, error } = await supabase.from('artists').select('*');
      if (!cancelled && !error && data) {
        setArtistsData(data);
      }
    };
    const kick = () => {
      if (cancelled) return;
      void run();
    };
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(kick, { timeout: 5000 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }
    const t = window.setTimeout(kick, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const enable = () => {
      if (!cancelled) setHomeBackgroundVideoEnabled(true);
    };
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(enable, { timeout: 2600 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }
    const t = window.setTimeout(enable, 2600);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  // 【修复】同步状态：确保任何针对 tracks 数组的采用动作，能实时倒灌回正在播放的 currentTrack
  useEffect(() => {
    if (currentTrack) {
      const liveTrack = tracks.find(t => t.id === currentTrack.id);
      if (
        liveTrack &&
        (liveTrack.metadataStatus !== currentTrack.metadataStatus ||
          liveTrack.sourceCoverUrl !== currentTrack.sourceCoverUrl ||
          liveTrack.sourceSongTitle !== currentTrack.sourceSongTitle ||
          liveTrack.sourceArtist !== currentTrack.sourceArtist ||
          liveTrack.youtubeUrl !== currentTrack.youtubeUrl ||
          liveTrack.sheetUrl !== currentTrack.sheetUrl ||
          liveTrack.bilibiliUrl !== currentTrack.bilibiliUrl ||
          liveTrack.audioUrl !== currentTrack.audioUrl ||
          liveTrack.duration !== currentTrack.duration ||
          liveTrack.midiUrl !== currentTrack.midiUrl ||
          liveTrack.musicxmlUrl !== currentTrack.musicxmlUrl)
      ) {
        setCurrentTrack(liveTrack);
      }
    }
  }, [tracks, currentTrack]);

  useEffect(() => {
    let cancelled = false;
    let remoteIdleId: number | undefined;
    let remoteTimerId: ReturnType<typeof window.setTimeout> | undefined;

    async function fetchSongs() {
      const ensureCategoryKeys = (t: Track): Track =>
        t.categoryFilterKeys?.length ? t : { ...t, categoryFilterKeys: getTrackCategoryKeysStatic(t) };

      const mergeLocalRemote = (localList: Track[], remoteList: Track[]) => {
        const localIds = new Set(localList.map(t => t.id));
        return [...localList, ...remoteList.filter(r => !localIds.has(r.id))];
      };

      const dedupeTracksById = (arr: Track[]): Track[] => {
        const seen = new Set<string>();
        return arr.filter(t => {
          if (seen.has(t.id)) return false;
          seen.add(t.id);
          return true;
        });
      };

      let localEntries: SongManifestEntry[] = [];
      const manifestUrl = getSongsManifestUrl();

      try {
        const manifestRes = await fetch(manifestUrl, { cache: 'default' });
        if (manifestRes.ok) {
          const raw = await manifestRes.json();
          if (raw && Array.isArray(raw.tracks)) {
            localEntries = raw.tracks as SongManifestEntry[];
          } else if (isSongsManifestCatalog(raw) && raw.chunks?.length) {
            const first = raw.chunks[0];
            const chunkRes = await fetch(resolveSongsManifestChunkUrl(manifestUrl, first.path), {
              cache: 'default',
            });
            if (chunkRes.ok) {
              const chunkJson = await chunkRes.json();
              localEntries = (chunkJson.tracks ?? []) as SongManifestEntry[];
            } else {
              console.warn('[songs] chunk0 HTTP', chunkRes.status, first.path);
            }

            if (!cancelled && raw.chunks.length > 1) {
              const rest = raw.chunks.slice(1);
              void (async () => {
                let acc = localEntries.slice();
                for (const ch of rest) {
                  if (cancelled) return;
                  await new Promise<void>(resolve => {
                    if (typeof requestIdleCallback !== 'undefined') {
                      requestIdleCallback(() => resolve(), { timeout: 3000 });
                    } else {
                      setTimeout(resolve, 0);
                    }
                  });
                  if (cancelled) return;
                  try {
                    const cr = await fetch(resolveSongsManifestChunkUrl(manifestUrl, ch.path), {
                      cache: 'default',
                    });
                    if (!cr.ok) {
                      console.warn('[songs] chunk HTTP', cr.status, ch.path);
                      continue;
                    }
                    const cj = await cr.json();
                    acc = acc.concat((cj.tracks ?? []) as SongManifestEntry[]);
                    if (cancelled) return;
                    const mappedLocals = dedupeTracksById(
                      acc.map(e => ensureCategoryKeys(manifestEntryToTrack(e))),
                    );
                    setTracks(prev => {
                      const remoteOnly = prev.filter(t => t.importSource === 'remote');
                      return mergeLocalRemote(mappedLocals, remoteOnly);
                    });
                  } catch (e) {
                    console.warn('[songs] chunk fetch failed', ch.path, e);
                  }
                }
              })();
            }
          }
        } else {
          console.warn('[songs] manifest HTTP', manifestRes.status, manifestUrl);
        }
      } catch (err) {
        console.warn('[songs] manifest fetch failed', err);
      }

      const localTracks = dedupeTracksById(localEntries.map(e => ensureCategoryKeys(manifestEntryToTrack(e))));

      const mergedLocalOnly: Track[] = [...localTracks.map(ensureCategoryKeys)];

      if (!cancelled) {
        setTracks(mergedLocalOnly);
        if (mergedLocalOnly.length > 0) {
          const defaultSong =
            mergedLocalOnly.find(t => t.id === 'local_soda_pop') ||
            mergedLocalOnly.find(t => t.id === 'golden_piano') ||
            mergedLocalOnly[0];
          setCurrentTrack(defaultSong);
        }
        setIsLoadingTracks(false);
      }

      const loadRemoteSongsWhenIdle = () => {
        if (cancelled) return;
        void (async () => {
          const { data, error } = await supabase.from('songs').select(SUPABASE_REMOTE_SONG_COLUMNS);
          if (cancelled) return;
          if (error) {
            console.error('Error fetching songs:', error);
            return;
          }
          const rows = data || [];
          setTracks(prev => {
            const nonRemote = prev.filter(t => t.importSource !== 'remote');
            const localIds = new Set(nonRemote.map(t => t.id));
            const added = rows
              .filter(row => row.id != null && !localIds.has(row.id as string))
              .map(row =>
                ensureCategoryKeys(mergeCanonicalIntoTrack(mapSupabaseRowToRemoteTrack(row as Record<string, unknown>))),
              );
            return [...nonRemote, ...added];
          });
        })();
      };

      if (typeof requestIdleCallback !== 'undefined') {
        remoteIdleId = requestIdleCallback(loadRemoteSongsWhenIdle, { timeout: 1800 });
      } else {
        remoteTimerId = window.setTimeout(loadRemoteSongsWhenIdle, 0);
      }
    }

    fetchSongs();
    return () => {
      cancelled = true;
      if (remoteIdleId !== undefined && typeof cancelIdleCallback !== 'undefined') {
        cancelIdleCallback(remoteIdleId);
      }
      if (remoteTimerId !== undefined) {
        window.clearTimeout(remoteTimerId);
      }
    };
  }, []);

  const [activeSceneId, setActiveSceneId] = useState<string>('tideHaven');
  const [showPracticePanel, setShowPracticePanel] = useState(false);
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [practiceMidiOutputVolume, setPracticeMidiOutputVolume] = useState(0.7);
  const [practiceMidiOutputMuted, setPracticeMidiOutputMuted] = useState(false);
  const isLocalPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname) || window.location.hostname.startsWith('192.168.');
  const showDevTierPreview = import.meta.env.DEV || isLocalPreview;
  // DEV: pass ?premium=1 in URL to test premium behaviour without a real auth system
  const [isPremium, setIsPremium] = useState(() =>
    new URLSearchParams(window.location.search).get('premium') === '1'
  );
  const [devAccountTier, setDevAccountTier] = useState<'guest' | 'basic' | 'premium' | null>(null);
  const [showGuestFeaturePrompt, setShowGuestFeaturePrompt] = useState(false);
  const accountTier = devAccountTier ?? (isPremium ? 'premium' : 'basic');
  /** Dev「访客」模式，或未登录 Supabase（logout 后必须走此分支，避免假 Basic 账号 UI） */
  const isGuest = accountTier === 'guest' || !session?.user;

  /** 与 read-membership 同步的 Supabase user id；访客 / Dev 访客不请求 */
  const membershipUserId = useMemo(() => {
    if (isGuest || !session?.user?.id) return null;
    return String(session.user.id);
  }, [isGuest, session?.user?.id]);

  const [remoteMembership, setRemoteMembership] = useState<RemoteUserMembership | null>(null);
  const [remoteMembershipLoading, setRemoteMembershipLoading] = useState(false);
  const [membershipFetchIssue, setMembershipFetchIssue] = useState<MembershipFetchIssue>('none');
  const [remoteMembershipRetryToken, setRemoteMembershipRetryToken] = useState(0);

  const isRemotePremiumActive = useMemo(
    () => remotePremiumEntitled(remoteMembership),
    [remoteMembership],
  );

  React.useEffect(() => {
    if (!membershipUserId) {
      setRemoteMembership(null);
      setRemoteMembershipLoading(false);
      setMembershipFetchIssue('none');
      return;
    }
    let cancelled = false;
    setRemoteMembershipLoading(true);
    setMembershipFetchIssue('none');
    void (async () => {
      const result = await fetchRemoteUserMembership(membershipUserId);
      if (cancelled) return;
      setRemoteMembershipLoading(false);
      if (result.ok === true) {
        setRemoteMembership(result.data);
        setMembershipFetchIssue('none');
      } else {
        setRemoteMembership(null);
        setMembershipFetchIssue(result.reason);
        if (result.reason === 'function_unavailable') {
          const host = typeof window !== 'undefined' ? window.location.hostname : '';
          const isLocal =
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host === '[::1]' ||
            host.endsWith('.local');
          console.warn(
            isLocal
              ? 'read-membership function unavailable in local preview'
              : `[read-membership] endpoint unreachable (status ${result.httpStatus ?? 'network'})`,
          );
        } else {
          console.warn('[read-membership] request failed', {
            httpStatus: result.httpStatus,
            code: result.serverCode ?? result.reason,
            message: result.serverMessage,
            debug: result.serverDebug,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [membershipUserId, remoteMembershipRetryToken]);

  /**
   * 全站 Premium 能力门控单一来源：远程会员有效 || Dev 显式 Premium || URL ?premium=1（便于本地试）
   * Dev 下 basic/guest 强制非 Premium，便于对照测试。
   */
  const resolvedPremiumAccess = useMemo(() => {
    if (showDevTierPreview && devAccountTier === 'premium') return true;
    if (isPremium) return true;
    if (isGuest) return false;
    return isRemotePremiumActive;
  }, [showDevTierPreview, devAccountTier, isPremium, isGuest, isRemotePremiumActive]);

  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => loadFavoriteIds());
  const [recentTrackIds, setRecentTrackIds] = useState<string[]>(() => loadRecentTrackIds());
  const toggleFavorite = React.useCallback((trackId: string) => {
    if (isGuest) return;
    setFavoriteIds(prev => {
      const next = toggleFavoriteList(prev, trackId);
      saveFavoriteIds(next);
      return next;
    });
  }, [isGuest]);

  const [settingsMembershipScrollToken, setSettingsMembershipScrollToken] = useState(0);
  const openSettingsMembership = useCallback(() => {
    setActiveView('settings');
    setSettingsMembershipScrollToken(n => n + 1);
  }, []);

  // ── Global Ambient Engine (survives page navigation) ───────────────
  const AMBIENT_LIMIT_FREE = 1;
  const AMBIENT_LIMIT_PREMIUM = 3;

  const [activeAmbiences, setActiveAmbiences] = useState<AmbientKey[]>([]);
  const [ambienceVolumes, setAmbienceVolumes] = useState<Record<AmbientKey, number>>(AMBIENCE_DEFAULT_VOLUMES);
  const [ambienceToast, setAmbienceToast] = useState<string | null>(null);
  const ambienceAudioRefs = React.useRef<Record<AmbientKey, HTMLAudioElement>>({} as Record<AmbientKey, HTMLAudioElement>);
  const ambienceFadeFrames = React.useRef<Partial<Record<AmbientKey, number>>>({});
  const toastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const showAmbienceToast = (msg: string) => {
    setAmbienceToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setAmbienceToast(null), 3500);
  };

  const cancelAmbienceFade = (id: AmbientKey) => {
    const frame = ambienceFadeFrames.current[id];
    if (frame) {
      cancelAnimationFrame(frame);
      delete ambienceFadeFrames.current[id];
    }
  };

  const ensureAmbientAudio = (id: AmbientKey) => {
    if (!ambienceAudioRefs.current[id]) {
      const audio = new Audio(AMBIENCE_AUDIO_URLS[id]);
      audio.loop = true;
      audio.preload = 'auto';
      audio.crossOrigin = 'anonymous';
      audio.load();
      ambienceAudioRefs.current[id] = audio;
    }
    return ambienceAudioRefs.current[id];
  };

  const getAmbientTargetVolume = (id: AmbientKey, sliderValue = ambienceVolumes[id] ?? AMBIENCE_DEFAULT_VOLUMES[id]) => {
    return Math.min(1, (sliderValue / 100) * AMBIENCE_GAIN_TRIMS[id]);
  };

  const rampAmbientVolume = (id: AmbientKey, to: number, durationMs: number, onDone?: () => void) => {
    const audio = ensureAmbientAudio(id);
    cancelAmbienceFade(id);
    const from = audio.volume;
    if (durationMs <= 0 || Math.abs(from - to) < 0.01) {
      audio.volume = to;
      onDone?.();
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      audio.volume = from + (to - from) * progress;
      if (progress < 1) {
        ambienceFadeFrames.current[id] = requestAnimationFrame(tick);
      } else {
        delete ambienceFadeFrames.current[id];
        onDone?.();
      }
    };
    ambienceFadeFrames.current[id] = requestAnimationFrame(tick);
  };

  const startAmbientPlayback = async (id: AmbientKey) => {
    const audio = ensureAmbientAudio(id);
    const targetVolume = getAmbientTargetVolume(id);
    cancelAmbienceFade(id);
    audio.loop = true;
    if (audio.paused) {
      audio.volume = 0.0001;
      try {
        await audio.play();
      } catch (error) {
        console.error(`Failed to play ambience ${id}`, error);
        showAmbienceToast(currentLang === 'English' ? 'Ambient audio failed to start' : currentLang === '繁體中文' ? '環境音效播放失敗' : '环境音效播放失败');
        setActiveAmbiences(prev => prev.filter(activeId => activeId !== id));
        return;
      }
    }
    rampAmbientVolume(id, targetVolume, AMBIENCE_FADE_IN_MS);
  };

  const stopAmbientPlayback = (id: AmbientKey, resetToStart = true) => {
    const audio = ambienceAudioRefs.current[id];
    if (!audio) return;
    cancelAmbienceFade(id);
    if (audio.paused) {
      if (resetToStart) audio.currentTime = 0;
      return;
    }
    rampAmbientVolume(id, 0, AMBIENCE_FADE_OUT_MS, () => {
      audio.pause();
      if (resetToStart) audio.currentTime = 0;
      audio.volume = getAmbientTargetVolume(id);
    });
  };

  const syncActiveAmbiences = (nextIds: AmbientKey[]) => {
    const deduped = Array.from(new Set(nextIds));
    AMBIENCE_KEYS.forEach(id => {
      if (deduped.includes(id)) {
        void startAmbientPlayback(id);
      } else {
        stopAmbientPlayback(id);
      }
    });
    setActiveAmbiences(deduped);
  };

  const toggleAmbience = (id: AmbientKey) => {
    if (isGuest) {
      setShowGuestFeaturePrompt(true);
      return;
    }

    if (activeAmbiences.includes(id)) {
      stopAmbientPlayback(id);
      setActiveAmbiences(prev => prev.filter(a => a !== id));
      return;
    }

    if (!resolvedPremiumAccess) {
      if (activeAmbiences.length >= AMBIENT_LIMIT_FREE) {
        showAmbienceToast(t.common.ambienceLimit);
      }
      syncActiveAmbiences([id]);
      return;
    }

    if (activeAmbiences.length >= AMBIENT_LIMIT_PREMIUM) {
      showAmbienceToast(currentLang === 'English' ? `For the best listening experience, you can mix up to ${AMBIENT_LIMIT_PREMIUM} ambience layers.` : currentLang === '繁體中文' ? `為確保最佳聆聽體驗，最多可同時混合 ${AMBIENT_LIMIT_PREMIUM} 個環境音。` : `为保证最佳聆听体验，最多可同时混合 ${AMBIENT_LIMIT_PREMIUM} 个环境音。`);
      return;
    }

    syncActiveAmbiences([...activeAmbiences, id]);
  };

  useEffect(() => {
    AMBIENCE_KEYS.forEach(id => {
      const audio = ambienceAudioRefs.current[id];
      const shouldBeActive = activeAmbiences.includes(id);
      if (shouldBeActive) {
        if (!audio || audio.paused) {
          void startAmbientPlayback(id);
        }
      } else if (audio && !audio.paused) {
        stopAmbientPlayback(id);
      }
    });
  }, [activeAmbiences]);

  useEffect(() => {
    activeAmbiences.forEach(id => {
      const audio = ambienceAudioRefs.current[id];
      if (audio && !audio.paused) {
        rampAmbientVolume(id, getAmbientTargetVolume(id), 120);
      }
    });
  }, [activeAmbiences, ambienceVolumes]);

  // Cleanup on full app unmount only
  useEffect(() => {
    return () => {
      AMBIENCE_KEYS.forEach(id => {
        cancelAmbienceFade(id);
        const audio = ambienceAudioRefs.current[id];
        if (audio) {
          audio.pause();
          audio.src = '';
        }
      });
    };
  }, []);
  // ── End Ambient Engine ────────────────────────────────────────────

  // Playback time/duration live in playback-timeline-store (not here) to avoid app-wide re-renders.
  const [playbackRate, setPlaybackRate] = useState(1);
  const [practiceTransportSeekTarget, setPracticeTransportSeekTarget] = useState<number | null>(null);
  const [practiceSeekDebug, setPracticeSeekDebug] = useState<PracticeSeekDebug>({
    targetTime: null,
    snappedTime: null,
    snappedMeasure: null,
    snappedBeatNumber: null,
    measureStartTime: null,
    actualTime: null,
    targetDelta: null,
    actualDelta: null,
    seekedEventTime: null,
    playCallTime: null,
    playEventTime: null,
    playingEventTime: null,
    mainSeekedEventTime: null,
    clickSeekedEventTime: null,
    mainPlayEventTime: null,
    clickPlayEventTime: null,
    mainPlayingEventTime: null,
    clickPlayingEventTime: null,
    firstStableMainTime: null,
    firstStableClickTime: null,
    firstStableDiff: null,
    firstStablePerfTime: null,
  });
  const [practiceSnapNotice, setPracticeSnapNotice] = useState<string | null>(null);
  const practiceSnapNoticeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    resetPlaybackTimeline();
    setPracticeTransportSeekTarget(null);
    setPracticeSeekDebug({
      targetTime: null,
      snappedTime: null,
      snappedMeasure: null,
      snappedBeatNumber: null,
      measureStartTime: null,
      actualTime: null,
      targetDelta: null,
      actualDelta: null,
      seekedEventTime: null,
      playCallTime: null,
      playEventTime: null,
      playingEventTime: null,
      mainSeekedEventTime: null,
      clickSeekedEventTime: null,
      mainPlayEventTime: null,
      clickPlayEventTime: null,
      mainPlayingEventTime: null,
      clickPlayingEventTime: null,
      firstStableMainTime: null,
      firstStableClickTime: null,
      firstStableDiff: null,
      firstStablePerfTime: null,
    });
  }, [currentTrack.id]);

  const showPracticeSnapNotice = (message: string) => {
    setPracticeSnapNotice(message);
    if (practiceSnapNoticeTimerRef.current) clearTimeout(practiceSnapNoticeTimerRef.current);
    practiceSnapNoticeTimerRef.current = setTimeout(() => setPracticeSnapNotice(null), 1800);
  };

  const selectTrackForPlayback = React.useCallback((track: Track, autoplay = true) => {
    playbackHandoffRef.current = null;
    setShowPracticePanel(false);
    setPracticeTransportSeekTarget(null);
    resetPlaybackTimeline();
    smartRadioRecentRef.current = pushRecentTrackId(smartRadioRecentRef.current, track.id);
    if (!isGuest) {
      setRecentTrackIds(prev => {
        const next = touchRecentList(prev, track.id);
        saveRecentTrackIds(next);
        return next;
      });
    }
    setCurrentTrack(track);
    setIsPlaying(autoplay);
  }, [isGuest]);

  const getNextSmartRadioTrack = React.useCallback((): Track | null => {
    return pickNextSmartRadioTrack({
      current: currentTrack,
      catalog: tracks,
      recentIds: smartRadioRecentRef.current,
      context: musicPlaybackContext,
    });
  }, [currentTrack, tracks, musicPlaybackContext]);

  const advancePlaybackWithCrossfadeHandoff = React.useCallback((track: Track, resumeAtSec: number) => {
    playbackHandoffRef.current = resumeAtSec;
    smartRadioRecentRef.current = pushRecentTrackId(smartRadioRecentRef.current, track.id);
    if (!isGuest) {
      setRecentTrackIds(prev => {
        const next = touchRecentList(prev, track.id);
        saveRecentTrackIds(next);
        return next;
      });
    }
    setShowPracticePanel(false);
    setPracticeTransportSeekTarget(null);
    resetPlaybackTimeline();
    setPlaybackTimelineTime(resumeAtSec, true);
    setCurrentTrack(track);
    setIsPlaying(true);
  }, [isGuest]);

  const handleTopNavSelectTrack = React.useCallback(
    (track: Track) => {
      selectTrackForPlayback(track, true);
      setActiveView('home');
    },
    [selectTrackForPlayback],
  );

  // Auto-close Practice Mode when navigating away
  useEffect(() => {
    setShowPracticePanel(false);
  }, [activeView]);

  const activeScene = SCENES.find(s => s.id === activeSceneId) || SCENES[0];
  const lightweightPracticeMode = showPracticePanel;
  const practiceIsolatedMode = showPracticePanel;

  useEffect(() => {
    if (!showPracticePanel) return;

    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setAmbienceToast(null);
    AMBIENCE_KEYS.forEach(id => {
      cancelAmbienceFade(id);
      const audio = ambienceAudioRefs.current[id];
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
    setActiveAmbiences([]);
  }, [showPracticePanel]);

  useEffect(() => {
    if (!showPracticePanel) return;
    if (!hasPracticeAssets(currentTrack)) {
      setShowPracticePanel(false);
    }
  }, [currentTrack, showPracticePanel]);

  useEffect(() => {
    if (!immersiveMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImmersiveMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [immersiveMode]);

  useEffect(() => {
    if (showPracticePanel) setImmersiveMode(false);
  }, [showPracticePanel]);

  useEffect(() => {
    if (activeView === 'settings') setImmersiveMode(false);
  }, [activeView]);

  // Click-outside-main-panel → go Home
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeView === 'home') return;
    // Only trigger if the click target is the backdrop itself (not a child)
    if (e.target === e.currentTarget) setActiveView('home');
  };

  return (
    <div
      className="isolate min-h-[100dvh] flex flex-col items-center relative text-[var(--color-mist-text)]"
      onClick={handleBackdropClick}
    >
      {/* Portrait Mode Blocker */}
      <div className="fixed inset-0 z-[9999] bg-[#0E0B0A] flex-col items-center justify-center p-8 text-center hidden [@media(pointer:coarse)_and_(orientation:portrait)]:flex">
        <svg className="w-12 h-12 text-white/50 mb-6 mx-auto animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
        <h2 className="text-xl font-medium text-[var(--color-mist-text)] mb-3 text-balance">{currentLang === '简体中文' ? '请横向旋转设备使用' : currentLang === '繁體中文' ? '請橫向旋轉設備使用' : 'Please rotate your device'}</h2>
        <p className="text-[var(--color-mist-text)]/60 text-sm leading-relaxed max-w-[280px]">
          {currentLang === '简体中文' ? 'AuraSounds 专为横版体验设计，请横屏获得最佳沉浸感。' : currentLang === '繁體中文' ? 'AuraSounds 專為橫版體驗設計，請橫屏獲得最佳沉浸感。' : 'AuraSounds is designed for landscape mode. Please rotate your device for the best experience.'}
        </p>
      </div>

      <BackgroundLayer
        scene={activeScene}
        lightweight={lightweightPracticeMode || !homeBackgroundVideoEnabled}
      />

      {!practiceIsolatedMode && (
        <>
          <TopNav
            activeView={activeView}
            setActiveView={setActiveView}
            currentLang={currentLang}
            setCurrentLang={setCurrentLang}
            t={t}
            onSelectTrack={handleTopNavSelectTrack}
            immersiveMode={immersiveMode}
            onEnterImmersive={() => setImmersiveMode(true)}
            immersiveEntryHidden={showPracticePanel}
          />

          <main
            className={`flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-24 md:pt-32 pb-32 md:pb-32 z-10 relative transition-all duration-300 ease-out ${
              immersiveMode ? 'pointer-events-none opacity-0 translate-y-1' : ''
            }`}
            onClick={e => e.stopPropagation()}
            aria-hidden={immersiveMode}
          >
            {activeView === 'home' && (
              <HomeTab
                t={t}
              />
            )}
            {activeView === 'music' && (
              <Suspense fallback={<div className="w-full max-w-5xl mx-auto py-20 text-center text-[var(--color-mist-text)]/50">Loading library…</div>}>
                <MusicTabLazy
                  tracks={tracks}
                  currentTrackId={currentTrack.id}
                  onSelectTrack={selectTrackForPlayback}
                  onPlaybackQueueChange={setMusicLibraryPlaybackQueue}
                  onPlaybackContextChange={setMusicTabContext}
                  isPlaying={isPlaying}
                  t={t}
                  currentLang={currentLang}
                />
              </Suspense>
            )}
            {activeView === 'focus' && (
              <FocusTab
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                setIsPlaying={setIsPlaying}
                activeSceneId={activeSceneId}
                setActiveSceneId={setActiveSceneId}
                setActiveView={setActiveView}
                activeAmbiences={activeAmbiences}
                setActiveAmbiences={setActiveAmbiences}
                ambienceVolumes={ambienceVolumes}
                setAmbienceVolumes={setAmbienceVolumes}
                toggleAmbience={toggleAmbience}
                isPremium={resolvedPremiumAccess}
                isGuest={isGuest}
                onGuestFeatureBlocked={() => setShowGuestFeaturePrompt(true)}
                showAmbienceToast={showAmbienceToast}
                t={t}
              />
            )}
            {activeView === 'settings' && (
              <SettingsTab
                resolvedPremiumAccess={resolvedPremiumAccess}
                isGuest={isGuest}
                accountTier={accountTier}
                showDevPreview={showDevTierPreview}
                setDevAccountTier={setDevAccountTier}
                setActiveView={setActiveView}
                setShowSheetOptions={setShowSheetOptions}
                currentLang={currentLang}
                settingsMembershipScrollToken={settingsMembershipScrollToken}
                favoriteIds={favoriteIds}
                recentTrackIds={recentTrackIds}
                tracks={tracks}
                t={t}
                openAuthModal={openAuthModal}
                checkoutBump={checkoutBump}
                onSignedOut={() => setDevAccountTier(null)}
                remoteMembership={remoteMembership}
                remoteMembershipLoading={remoteMembershipLoading}
                membershipFetchIssue={membershipFetchIssue}
                onMembershipRetry={() => setRemoteMembershipRetryToken(n => n + 1)}
              />
            )}
            {activeView === 'admin' && <AdminTab tracks={tracks} setTracks={setTracks} artistsData={artistsData} setArtistsData={setArtistsData} />}
            {activeView === 'uiPreview' && <UiGlassPreviewTab t={t} />}
            <AnimatePresence>
              {showSheetOptions && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-6">
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setShowSheetOptions(false)}
                    className="absolute inset-0 bg-black/50"
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98, y: 8 }}
                    className="relative flex w-full max-w-sm flex-col items-center gap-5 rounded-[24px] border border-[rgba(90,72,52,0.1)] bg-[#fffaf5] p-8 shadow-[0_20px_48px_rgba(42,32,24,0.12)]"
                  >
                    <div className="flex flex-col items-center gap-2 text-center">
                      <h3 className="text-lg font-semibold tracking-tight text-[var(--color-mist-text)]">
                        {t.settings.wechatQrTitle}
                      </h3>
                      <p className="text-xs font-medium leading-relaxed text-[var(--color-mist-text)]/55">
                        {t.settings.wechatQrDesc}
                      </p>
                    </div>

                    <div className="relative overflow-hidden rounded-2xl border border-[rgba(90,72,52,0.08)] bg-white p-2 shadow-sm">
                      <img
                        src="https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/pics/gzh.jpg"
                        alt=""
                        className="h-48 w-48 object-contain"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowSheetOptions(false)}
                      className="rounded-full border border-[rgba(90,72,52,0.14)] bg-white/90 px-8 py-2.5 text-xs font-semibold tracking-wide text-[var(--color-mist-text)]/78 transition-colors hover:bg-white"
                    >
                      {t.common.close}
                    </button>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </main>

          <AnimatePresence>
            {showGuestFeaturePrompt && (
              <div className="fixed inset-0 z-[320] flex items-center justify-center p-6">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowGuestFeaturePrompt(false)}
                  className="absolute inset-0 bg-[rgba(245,236,226,0.52)]"
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 12 }}
                  className="relative glass-panel w-full max-w-md rounded-[32px] px-8 py-8"
                >
                  <div className="flex flex-col gap-4 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/50 bg-white/55 text-[var(--color-mist-text)]/78">
                      <User className="h-6 w-6" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <h3 className="text-2xl font-semibold tracking-tight text-[var(--color-mist-text)]">
                        {t.settings.guestPromptTitle}
                      </h3>
                      <p className="text-sm leading-6 text-[var(--color-mist-text)]/72">
                        {t.settings.guestPromptDesc}
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => {
                          setShowGuestFeaturePrompt(false);
                          openAuthModal('sign-up');
                        }}
                        className="flex-1 rounded-2xl bg-white/82 px-5 py-3 text-sm font-semibold text-[var(--color-mist-text)] shadow-sm transition-colors hover:bg-white"
                      >
                        {t.common.signUp}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowGuestFeaturePrompt(false);
                          openAuthModal('sign-in');
                        }}
                        className="flex-1 rounded-2xl border border-white/36 bg-white/34 px-5 py-3 text-sm font-semibold text-[var(--color-mist-text)]/86 transition-colors hover:bg-white/48"
                      >
                        {t.common.logIn}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </>
      )}

      {showPracticePanel && hasPracticeAssets(currentTrack) && (
        <Suspense fallback={null}>
          <PracticePanel
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            playbackRate={playbackRate}
            setPlaybackRate={setPlaybackRate}
            onClose={() => setShowPracticePanel(false)}
            isPremium={resolvedPremiumAccess}
            setActiveView={setActiveView}
            practiceSeekDebug={practiceSeekDebug}
            setPracticeSeekDebug={setPracticeSeekDebug}
            onPracticeSnap={showPracticeSnapNotice}
            practiceSeekTarget={practiceTransportSeekTarget}
            setPracticeSeekTarget={setPracticeTransportSeekTarget}
            practiceMidiOutputVolume={practiceMidiOutputVolume}
            practiceMidiOutputMuted={practiceMidiOutputMuted}
            t={t}
          />
        </Suspense>
      )}

      <BottomPlayer
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        playbackRate={playbackRate}
        setPlaybackRate={setPlaybackRate}
        showPracticePanel={showPracticePanel}
        setShowPracticePanel={setShowPracticePanel}
        isPremium={resolvedPremiumAccess}
        currentLang={currentLang}
        setShowSheetOptions={setShowSheetOptions}
        setPracticeSeekDebug={setPracticeSeekDebug}
        onPracticeSnap={showPracticeSnapNotice}
        setPracticeSeekTarget={setPracticeTransportSeekTarget}
        setPracticeMidiOutputVolume={setPracticeMidiOutputVolume}
        setPracticeMidiOutputMuted={setPracticeMidiOutputMuted}
        musicLibrarySkipEnabled={activeView === 'music'}
        musicLibraryPlaybackQueue={musicLibraryPlaybackQueue}
        onMusicLibrarySkipToTrack={selectTrackForPlayback}
        onOpenSettingsMembership={openSettingsMembership}
        playbackHandoffRef={playbackHandoffRef}
        getNextSmartRadioTrack={getNextSmartRadioTrack}
        advancePlaybackWithCrossfadeHandoff={advancePlaybackWithCrossfadeHandoff}
        onSmartRadioToast={showAmbienceToast}
        isFavorite={!isGuest && favoriteIds.includes(currentTrack.id)}
        onToggleFavorite={toggleFavorite}
        isGuest={isGuest}
        onGuestFavoriteBlocked={() => setShowGuestFeaturePrompt(true)}
        immersiveMode={immersiveMode}
        onEnterImmersive={() => setImmersiveMode(true)}
        t={t}
      />
      {immersiveMode && !showPracticePanel && (
        <ImmersiveCoverOrb
          coverUrl={
            (currentTrack.metadataStatus === 'approved' && currentTrack.sourceCoverUrl
              ? currentTrack.sourceCoverUrl
              : currentTrack.coverUrl) || undefined
          }
          isPlaying={isPlaying}
          onExit={() => setImmersiveMode(false)}
          showControlsTitle={t.player.showControls}
        />
      )}
      {showPracticePanel && practiceSnapNotice && (
        <div className="fixed bottom-16 md:bottom-28 left-1/2 -translate-x-1/2 z-[210] rounded-full border border-white/20 bg-[rgba(255,249,242,0.94)] px-4 py-1.5 md:py-2 text-[10px] md:text-xs font-semibold text-[var(--color-mist-text)] shadow-sm">
          {practiceSnapNotice}
        </div>
      )}
      {!practiceIsolatedMode && ambienceToast && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-2xl bg-black/70 backdrop-blur-md border border-white/15 text-white text-sm font-medium shadow-xl animate-in fade-in slide-in-from-bottom-3 duration-300 max-w-sm text-center">
          {ambienceToast}
        </div>
      )}
      <SupabaseAuthModal
        open={authModalOpen}
        mode={authModalMode}
        onClose={closeAuthModal}
        onSuccess={handleAuthModalSuccess}
        onModeChange={setAuthModalMode}
        authCopy={t.authModal}
      />
      <SupabaseResetPasswordGate
        open={appPathname === '/reset-password'}
        authCopy={t.authModal}
        onDone={clearResetPasswordPath}
      />
    </div>
  );
}

const HomeTab = memo(function HomeTab({ t }: { t: any }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center animate-in fade-in duration-700 min-h-[60vh] text-center">
      {/* Empty centered content as requested */}
    </div>
  );
});

const TopNav = memo(function TopNav({
  activeView,
  setActiveView,
  onSelectTrack,
  currentLang,
  setCurrentLang,
  t,
  immersiveMode = false,
  onEnterImmersive,
  immersiveEntryHidden = false,
}: {
  activeView: View,
  setActiveView: (v: View) => void,
  onSelectTrack: (t: Track) => void,
  currentLang: string,
  setCurrentLang: (v: string) => void,
  t: any,
  immersiveMode?: boolean,
  onEnterImmersive: () => void,
  immersiveEntryHidden?: boolean,
}) {
  const [showLangMenu, setShowLangMenu] = useState(false);
  const normalizeSearchText = (value: unknown) => {
    if (typeof value === 'string') return value.toLowerCase();
    if (value == null) return '';
    return String(value).toLowerCase();
  };


  const languages = [
    { name: 'English', code: 'EN' },
    { name: '简体中文', code: '简中' },
    { name: '繁體中文', code: '繁中' }
  ];

  const tabs: { id: View, label: string, icon?: React.ReactNode }[] = [
    { id: 'home', label: t.nav.home },
    { id: 'music', label: t.nav.music },
    { id: 'focus', label: t.nav.focus },
    { id: 'settings', label: t.nav.settings },
  ];

  const activeLang = languages.find(l => l.name === currentLang) || languages[0];

  return (
    <header
      className={`topnav-header fixed top-6 left-0 right-0 z-50 flex justify-center px-0 pointer-events-none transition-all duration-300 ease-out ${
        immersiveMode ? 'opacity-0 -translate-y-[120%]' : ''
      }`}
      aria-hidden={immersiveMode}
    >
      <div
        className={`app-chrome-shell w-full max-w-5xl overflow-visible px-3 md:px-6 transition-all duration-300 ease-out ${
          immersiveMode ? 'pointer-events-none' : 'pointer-events-auto'
        }`}
      >
        <div className="topnav-bar glass-panel group/topnav relative w-full overflow-visible rounded-full py-2.5 shadow-md md:py-3">
          <nav className="topnav-tabs flex items-center justify-center gap-4 overflow-x-auto custom-scrollbar pl-2.5 pr-14 sm:gap-5 sm:pr-16 md:gap-6 md:pl-3 md:pr-[4.5rem]">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveView(tab.id)}
                className={`topnav-tab glass-pill-tab flex items-center gap-1.5 whitespace-nowrap px-4 py-2.5 font-medium md:px-5 [&_svg]:h-4 [&_svg]:w-4 md:[&_svg]:h-5 md:[&_svg]:w-5 ${activeView === tab.id ? 'glass-pill-tab--active shadow-sm' : ''}`}
              >
                {tab.icon && tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>

          {!immersiveMode && !immersiveEntryHidden && (
            <ImmersiveModeEntryButton
              variant="topnav"
              onClick={onEnterImmersive}
              title={t.player.immersiveMode}
            />
          )}

          <div className="topnav-right pointer-events-auto absolute right-1.5 top-1/2 z-[35] flex -translate-y-1/2 items-center gap-1.5 sm:right-2 sm:gap-2 md:right-3 md:gap-3">
            <div className="relative">
            <button
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="topnav-lang-btn flex shrink-0 items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-2.5 py-1.5 text-[var(--color-mist-text)] transition-colors hover:bg-white/25"
            >
              <Globe className="h-3.5 w-3.5" />
              <span className="text-[11px] font-bold tracking-wider">{activeLang.code}</span>
            </button>

            <AnimatePresence>
              {showLangMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="glass-popover absolute top-full right-0 mt-3 rounded-2xl p-2 flex flex-col gap-1 min-w-[160px] z-[60]"
                >
                  {languages.map(lang => (
                    <button
                      key={lang.name}
                      onClick={() => {
                        setCurrentLang(lang.name);
                        setShowLangMenu(false);
                      }}
                      className={`px-4 py-2 text-sm rounded-xl text-left transition-colors flex items-center justify-between ${currentLang === lang.name ? 'bg-white/20 text-[var(--color-mist-text)]' : 'text-[var(--color-mist-text)]/60 hover:bg-white/10'}`}
                    >
                      <span>{lang.name === '繁體中文' ? '繁體中文' : lang.name}</span>
                      {currentLang === lang.name && <div className="w-1.5 h-1.5 rounded-full bg-amber-600/60"></div>}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          </div>
        </div>
      </div>
    </header>
  );
});

/** Progress + time labels: main-audio ticks are local state only; practice reads timeline store. */
const PlayerProgressStrip = memo(function PlayerProgressStrip({
  showPracticePanel,
  compactPracticeMode,
  audioRef,
  trackId,
  formatTime,
  progressBarRef,
  onPointerDown,
  progressSyncTick,
}: {
  showPracticePanel: boolean;
  compactPracticeMode: boolean;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  trackId: string;
  formatTime: (time: number) => string;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  progressSyncTick: number;
}) {
  const [mainUiTime, setMainUiTime] = useState(0);
  const practiceTime = usePlaybackTimelineTime();
  const duration = usePlaybackDurationValue();
  const displayTime = showPracticePanel ? practiceTime : mainUiTime;

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio || showPracticePanel) return;
    const onTick = () => setMainUiTime(audio.currentTime);
    const onSeeked = () => setMainUiTime(audio.currentTime);
    audio.addEventListener('timeupdate', onTick);
    audio.addEventListener('seeked', onSeeked);
    return () => {
      audio.removeEventListener('timeupdate', onTick);
      audio.removeEventListener('seeked', onSeeked);
    };
  }, [audioRef, trackId, showPracticePanel]);

  React.useEffect(() => {
    setMainUiTime(0);
  }, [trackId]);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio || showPracticePanel) return;
    setMainUiTime(audio.currentTime);
  }, [progressSyncTick, audioRef, showPracticePanel]);

  const pct = duration > 0 ? (displayTime / duration) * 100 : 0;

  return (
    <div
      className={`w-full ${compactPracticeMode ? 'max-w-5xl' : ''} flex min-w-0 items-center gap-2 text-[11px] sm:text-xs text-[var(--color-mist-text)]/50 font-mono tabular-nums`}
    >
      <span className="shrink-0 min-w-[2.75rem] text-right">{formatTime(displayTime)}</span>
      <div
        ref={progressBarRef}
        className="min-w-0 flex-1 h-1 bg-white/15 rounded-full overflow-hidden group cursor-pointer"
        onPointerDown={onPointerDown}
      >
        <div
          className="h-full bg-[var(--color-mist-text)]/40 group-hover:bg-[var(--color-mist-text)]/60 transition-colors relative"
          style={{ width: `${pct}%` }}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-[var(--color-mist-text)] rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"></div>
        </div>
      </div>
      <span className="shrink-0 min-w-[3.25rem] text-left">{formatTime(duration)}</span>
    </div>
  );
});

const BottomPlayer = memo(function BottomPlayer({
  currentTrack,
  isPlaying,
  setIsPlaying,
  playbackRate,
  setPlaybackRate,
  showPracticePanel,
  setShowPracticePanel,
  isPremium,
  currentLang,
  setShowSheetOptions,
  setPracticeSeekDebug,
  onPracticeSnap,
  setPracticeSeekTarget,
  setPracticeMidiOutputVolume,
  setPracticeMidiOutputMuted,
  musicLibrarySkipEnabled,
  musicLibraryPlaybackQueue,
  onMusicLibrarySkipToTrack,
  onOpenSettingsMembership,
  playbackHandoffRef,
  getNextSmartRadioTrack,
  advancePlaybackWithCrossfadeHandoff,
  onSmartRadioToast,
  isFavorite,
  onToggleFavorite,
  isGuest,
  onGuestFavoriteBlocked,
  immersiveMode,
  onEnterImmersive,
  t
}: {
  currentTrack: Track,
  isPlaying: boolean,
  setIsPlaying: (v: boolean) => void,
  playbackRate: number,
  setPlaybackRate: (v: number) => void,
  showPracticePanel: boolean,
  setShowPracticePanel: (v: boolean) => void,
  isPremium: boolean,
  currentLang: string,
  setShowSheetOptions: (v: boolean) => void,
  setPracticeSeekDebug: React.Dispatch<React.SetStateAction<PracticeSeekDebug>>,
  onPracticeSnap: (message: string) => void,
  setPracticeSeekTarget: React.Dispatch<React.SetStateAction<number | null>>,
  setPracticeMidiOutputVolume: React.Dispatch<React.SetStateAction<number>>,
  setPracticeMidiOutputMuted: React.Dispatch<React.SetStateAction<boolean>>,
  musicLibrarySkipEnabled: boolean,
  musicLibraryPlaybackQueue: Track[],
  onMusicLibrarySkipToTrack: (track: Track, autoplay: boolean) => void,
  onOpenSettingsMembership: () => void,
  playbackHandoffRef: React.MutableRefObject<number | null>,
  getNextSmartRadioTrack: () => Track | null,
  advancePlaybackWithCrossfadeHandoff: (track: Track, resumeAtSec: number) => void,
  onSmartRadioToast: (msg: string) => void,
  isFavorite: boolean,
  onToggleFavorite: (trackId: string) => void,
  isGuest: boolean,
  onGuestFavoriteBlocked: () => void,
  immersiveMode: boolean,
  onEnterImmersive: () => void,
  t: any
}) {
  const compactPracticeMode = false;
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showVolumePopover, setShowVolumePopover] = useState(false);
  const playerToolsRef = React.useRef<HTMLDivElement>(null);
  const [smartRadioActive, setSmartRadioActive] = useState(false);
  const [premiumGateReason, setPremiumGateReason] = useState<null | 'smartRadio'>(null);

  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  const [lastVolume, setLastVolume] = useState(0.7);
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const progressBarRef = React.useRef<HTMLDivElement>(null);
  const isScrubbingRef = React.useRef(false);
  const scrubClientXRef = React.useRef<number | null>(null);
  const prevShowPracticePanelRef = React.useRef(showPracticePanel);
  const pendingSeekDebugRef = React.useRef<{
    targetTime: number | null;
    snappedTime: number | null;
    snappedMeasure: number | null;
    snappedBeatNumber: number | null;
    measureStartTime: number | null;
  }>({
    targetTime: null,
    snappedTime: null,
    snappedMeasure: null,
    snappedBeatNumber: null,
    measureStartTime: null,
  });
  const practicePlaybackTimingRef = React.useRef<{
    seekedEventTime: number | null;
    playCallTime: number | null;
    playEventTime: number | null;
    playingEventTime: number | null;
  }>({
    seekedEventTime: null,
    playCallTime: null,
    playEventTime: null,
    playingEventTime: null,
  });
  const dualAudioSyncProbeRef = React.useRef({ mainSeekedSeen: false });
  const [progressSyncTick, setProgressSyncTick] = useState(0);

  /** Smart Radio：提前预缓冲下一首；最后 2 秒仅主轨 fade out，副轨不播放（handoff 后下一首全音量起播、无淡入） */
  const PRELOAD_SECONDS_BEFORE_END = 8;
  const FADE_WINDOW_SEC = 2;
  const crossfadeAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const crossfadePhaseRef = React.useRef<'idle' | 'loading' | 'prepared' | 'running'>('idle');
  const crossfadeNextTrackRef = React.useRef<Track | null>(null);
  const crossfadeStartedForTrackIdRef = React.useRef<string | null>(null);
  const crossfadeRafRef = React.useRef<number | null>(null);
  const crossfadeRunningRef = React.useRef(false);
  const crossfadeSkipEndedRef = React.useRef(false);
  const speeds = [0.5, 0.75, 1, 1.25, 1.5];
  const canUsePractice = currentTrack.practiceEnabled ?? hasPracticeAssets(currentTrack);

  React.useEffect(() => {
    if (!showSpeedMenu && !showVolumePopover) return;
    const onDown = (e: MouseEvent) => {
      const el = playerToolsRef.current;
      if (el && !el.contains(e.target as Node)) {
        setShowSpeedMenu(false);
        setShowVolumePopover(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showSpeedMenu, showVolumePopover]);
  const resolvedYoutubeUrl = getTrackYoutubeUrl(currentTrack);
  const resolvedBilibiliUrl = getTrackBilibiliUrlForLocale(currentTrack, currentLang);
  const canOpenExternalVideo = trackHasExternalVideo(currentTrack, currentLang);
  const resolvedSheetUrl = getTrackSheetUrl(currentTrack);
  const linkStatus = currentTrack.metadata?.enrichment?.linkStatus;

  // 【修复】解决因为浏览器缓存机制过快导致 onLoadedMetadata 事件不触发、引起时长始终为 0:00 的隐形 Bug
  React.useEffect(() => {
    if (audioRef.current && audioRef.current.readyState >= 1) {
      const d = audioRef.current.duration;
      if (Number.isFinite(d)) setPlaybackTimelineDuration(d);
    }
  }, [currentTrack.audioUrl]);

  React.useEffect(() => {
    const audio = audioRef.current;
    pendingSeekDebugRef.current = {
      targetTime: null,
      snappedTime: null,
      snappedMeasure: null,
      snappedBeatNumber: null,
      measureStartTime: null,
    };
    isScrubbingRef.current = false;
    scrubClientXRef.current = null;
    crossfadePhaseRef.current = 'idle';
    crossfadeStartedForTrackIdRef.current = null;
    crossfadeNextTrackRef.current = null;
    crossfadeRunningRef.current = false;
    const sec = crossfadeAudioRef.current;
    if (sec) {
      sec.pause();
      sec.src = '';
    }
    const handoff = playbackHandoffRef.current;
    if (handoff != null && Number.isFinite(handoff)) {
      playbackHandoffRef.current = null;
      const applyMeta = () => {
        const el = audioRef.current;
        if (!el) return;
        const d = el.duration;
        if (Number.isFinite(d)) setPlaybackTimelineDuration(d);
        try {
          el.currentTime = handoff;
        } catch {
          /* ignore */
        }
        setPlaybackTimelineTime(handoff, true);
      };
      if (audio) {
        if (audio.readyState >= 1) applyMeta();
        else audio.addEventListener('loadedmetadata', () => applyMeta(), { once: true });
      }
      setProgressSyncTick(x => x + 1);
      return;
    }
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    resetPlaybackTimeline();
    setProgressSyncTick(x => x + 1);
  }, [currentTrack.id]);

  React.useEffect(() => {
    if (showPracticePanel || !audioRef.current) return;
    if (!isPlaying) {
      const live = audioRef.current.currentTime;
      if (Number.isFinite(live)) {
        setPlaybackTimelineTime(live, true);
        setProgressSyncTick(x => x + 1);
      }
    }
  }, [isPlaying, showPracticePanel]);

  React.useEffect(() => {
    if (crossfadeRunningRef.current) return;
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = isMuted;
    }
    setPracticeMidiOutputVolume(volume);
    setPracticeMidiOutputMuted(isMuted);
  }, [volume, isMuted, setPracticeMidiOutputMuted, setPracticeMidiOutputVolume]);

  React.useEffect(() => {
    if (!isPlaying || !isPremium || !smartRadioActive || showPracticePanel) {
      if (crossfadeRafRef.current != null) {
        cancelAnimationFrame(crossfadeRafRef.current);
        crossfadeRafRef.current = null;
      }
      return;
    }
    const tick = () => {
      const main = audioRef.current;
      const sec = crossfadeAudioRef.current;
      if (!main || !sec) {
        crossfadeRafRef.current = requestAnimationFrame(tick);
        return;
      }
      const dur = main.duration;
      const ct = main.currentTime;
      if (!Number.isFinite(dur) || dur <= 0 || !Number.isFinite(ct)) {
        crossfadeRafRef.current = requestAnimationFrame(tick);
        return;
      }
      const remaining = dur - ct;
      const eff = volume * (isMuted ? 0 : 1);
      const minDurForFade = FADE_WINDOW_SEC + 1.2;

      // 提前预缓冲下一首（不播放），避免进入叠化窗口时才 decode
      if (
        crossfadePhaseRef.current === 'idle' &&
        crossfadeStartedForTrackIdRef.current !== currentTrack.id &&
        remaining <= PRELOAD_SECONDS_BEFORE_END &&
        remaining > FADE_WINDOW_SEC + 0.2 &&
        dur >= minDurForFade
      ) {
        const next = getNextSmartRadioTrack();
        if (next) {
          crossfadeStartedForTrackIdRef.current = currentTrack.id;
          crossfadeNextTrackRef.current = next;
          crossfadePhaseRef.current = 'loading';
          sec.preload = 'auto';
          sec.src = next.audioUrl;
          sec.load();
          const markPrepared = () => {
            sec.removeEventListener('canplaythrough', markPrepared);
            sec.removeEventListener('canplay', markPrepared);
            if (crossfadePhaseRef.current === 'loading') crossfadePhaseRef.current = 'prepared';
          };
          sec.addEventListener('canplaythrough', markPrepared);
          sec.addEventListener('canplay', markPrepared);
        }
      }

      // 最后 2 秒：仅主轨线性 fade out；副轨只预缓冲不播放，下一首 handoff 后从 0 秒全音量起播（无淡入）
      if (
        (crossfadePhaseRef.current === 'prepared' || crossfadePhaseRef.current === 'loading') &&
        dur >= minDurForFade &&
        remaining <= FADE_WINDOW_SEC &&
        remaining > 0 &&
        crossfadeNextTrackRef.current
      ) {
        if (!crossfadeRunningRef.current) {
          crossfadePhaseRef.current = 'running';
          crossfadeRunningRef.current = true;
        }
      }

      if (crossfadePhaseRef.current === 'running' && crossfadeNextTrackRef.current) {
        const pLin = Math.max(0, Math.min(1, remaining / FADE_WINDOW_SEC));
        main.volume = eff * pLin;

        if (remaining <= 0.04 || pLin <= 0.02) {
          const next = crossfadeNextTrackRef.current;
          crossfadePhaseRef.current = 'idle';
          crossfadeRunningRef.current = false;
          crossfadeSkipEndedRef.current = true;
          main.pause();
          sec.pause();
          sec.src = '';
          sec.load();
          main.volume = eff * (isMuted ? 0 : 1);
          advancePlaybackWithCrossfadeHandoff(next, 0);
          if (crossfadeRafRef.current != null) {
            cancelAnimationFrame(crossfadeRafRef.current);
            crossfadeRafRef.current = null;
          }
          return;
        }
      }

      crossfadeRafRef.current = requestAnimationFrame(tick);
    };
    crossfadeRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (crossfadeRafRef.current != null) {
        cancelAnimationFrame(crossfadeRafRef.current);
        crossfadeRafRef.current = null;
      }
    };
  }, [
    isPlaying,
    isPremium,
    smartRadioActive,
    showPracticePanel,
    currentTrack.id,
    currentTrack.audioUrl,
    volume,
    isMuted,
    playbackRate,
    getNextSmartRadioTrack,
    advancePlaybackWithCrossfadeHandoff,
  ]);

  const timelineDuration = usePlaybackDurationValue();

  React.useEffect(() => {
    if (audioRef.current) {
      if (showPracticePanel) {
        audioRef.current.pause();
        return;
      }
      const snap = getPlaybackTimelineSnapshot();
      const audioDuration = Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : 0;
      const live = audioRef.current.currentTime;
      const basis = Number.isFinite(live) && live > 0.001 ? live : snap.currentTime;
      const cap = audioDuration || snap.duration || 0;
      const targetTime = Math.max(0, Math.min(cap, basis));
      if (Number.isFinite(targetTime) && Math.abs(audioRef.current.currentTime - targetTime) > 0.05) {
        audioRef.current.currentTime = targetTime;
      }
      if (isPlaying) {
        practicePlaybackTimingRef.current.playCallTime = performance.now();
        audioRef.current.play().catch(e => console.error("Playback failed", e));
      } else {
        audioRef.current.pause();
      }
    }
  }, [currentTrack.audioUrl, timelineDuration, isPlaying, showPracticePanel]);

  React.useEffect(() => {
    const audio = audioRef.current;
    const wasShowingPractice = prevShowPracticePanelRef.current;
    prevShowPracticePanelRef.current = showPracticePanel;
    if (!audio) return;
    if (!wasShowingPractice || showPracticePanel) return;

    const syncFromAudio = () => {
      const audioDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const snap = getPlaybackTimelineSnapshot();
      const clampedTime = Math.max(0, Math.min(audioDuration || snap.duration || 0, audio.currentTime));
      if (audioDuration > 0) {
        setPlaybackTimelineDuration(audioDuration);
      }
      pendingSeekDebugRef.current = {
        targetTime: null,
        snappedTime: null,
        snappedMeasure: null,
        snappedBeatNumber: null,
        measureStartTime: null,
      };
      isScrubbingRef.current = false;
      scrubClientXRef.current = null;
      audio.currentTime = clampedTime;
      setPlaybackTimelineTime(clampedTime, true);
      setProgressSyncTick(x => x + 1);
    };

    const rafId = window.requestAnimationFrame(syncFromAudio);
    return () => window.cancelAnimationFrame(rafId);
  }, [showPracticePanel]);

  React.useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const d = audioRef.current.duration;
      if (Number.isFinite(d)) setPlaybackTimelineDuration(d);
    }
  };

  const applySeek = (targetTime: number) => {
    if (showPracticePanel) {
      setPracticeSeekTarget(targetTime);
      setPlaybackTimelineTime(targetTime, true);
      return;
    }
    if (!audioRef.current) return;

    pendingSeekDebugRef.current = {
      targetTime,
      snappedTime: targetTime,
      snappedMeasure: null,
      snappedBeatNumber: null,
      measureStartTime: null,
    };
    setPracticeSeekDebug({
      targetTime,
      snappedTime: targetTime,
      snappedMeasure: null,
      snappedBeatNumber: null,
      measureStartTime: null,
      actualTime: targetTime,
      targetDelta: 0,
      actualDelta: 0,
      seekedEventTime: practicePlaybackTimingRef.current.seekedEventTime,
      playCallTime: practicePlaybackTimingRef.current.playCallTime,
      playEventTime: practicePlaybackTimingRef.current.playEventTime,
      playingEventTime: practicePlaybackTimingRef.current.playingEventTime,
      mainSeekedEventTime: null,
      clickSeekedEventTime: null,
      mainPlayEventTime: null,
      clickPlayEventTime: null,
      mainPlayingEventTime: null,
      clickPlayingEventTime: null,
      firstStableMainTime: null,
      firstStableClickTime: null,
      firstStableDiff: null,
      firstStablePerfTime: null,
    });
    audioRef.current.currentTime = targetTime;
    setPlaybackTimelineTime(targetTime, true);
    setProgressSyncTick(x => x + 1);
  };

  const seekFromClientX = (clientX: number) => {
    const bar = progressBarRef.current;
    if (!bar || !audioRef.current) return;
    const rect = bar.getBoundingClientRect();
    const clampedX = Math.max(rect.left, Math.min(clientX, rect.right));
    const percentage = rect.width > 0 ? (clampedX - rect.left) / rect.width : 0;
    const snap = getPlaybackTimelineSnapshot();
    const effectiveDuration = showPracticePanel
      ? snap.duration
      : (Number.isFinite(audioRef.current.duration) && audioRef.current.duration > 0 ? audioRef.current.duration : snap.duration);
    applySeek(percentage * effectiveDuration);
  };

  const handleProgressPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    isScrubbingRef.current = true;
    scrubClientXRef.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    seekFromClientX(e.clientX);
  };

  React.useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!isScrubbingRef.current) return;
      scrubClientXRef.current = e.clientX;
      seekFromClientX(e.clientX);
    };

    const handlePointerUp = () => {
      isScrubbingRef.current = false;
      scrubClientXRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [showPracticePanel]);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleSeeked = () => {
      if (showPracticePanel) return;
      const { targetTime, snappedTime, snappedMeasure, snappedBeatNumber, measureStartTime } = pendingSeekDebugRef.current;
      if (targetTime === null && snappedTime === null) return;
      const actualTime = audio.currentTime;
      practicePlaybackTimingRef.current.seekedEventTime = performance.now();
      dualAudioSyncProbeRef.current.mainSeekedSeen = true;
      setPracticeSeekDebug(prev => ({
        ...prev,
        targetTime,
        snappedTime,
        snappedMeasure,
        snappedBeatNumber,
        measureStartTime,
        actualTime,
        targetDelta: targetTime !== null && snappedTime !== null ? snappedTime - targetTime : null,
        actualDelta: snappedTime !== null ? actualTime - snappedTime : null,
        seekedEventTime: practicePlaybackTimingRef.current.seekedEventTime,
        playCallTime: practicePlaybackTimingRef.current.playCallTime,
        playEventTime: practicePlaybackTimingRef.current.playEventTime,
        playingEventTime: practicePlaybackTimingRef.current.playingEventTime,
        mainSeekedEventTime: practicePlaybackTimingRef.current.seekedEventTime,
      }));
      pendingSeekDebugRef.current = {
        targetTime: null,
        snappedTime: null,
        snappedMeasure: null,
        snappedBeatNumber: null,
        measureStartTime: null,
      };
      setPlaybackTimelineTime(actualTime, true);
      setProgressSyncTick(x => x + 1);
    };

    const handlePlayEvent = () => {
      if (showPracticePanel) return;
      practicePlaybackTimingRef.current.playEventTime = performance.now();
      setPracticeSeekDebug(prev => ({
        ...prev,
        playEventTime: practicePlaybackTimingRef.current.playEventTime,
        mainPlayEventTime: practicePlaybackTimingRef.current.playEventTime,
      }));
    };

    const handlePlayingEvent = () => {
      if (showPracticePanel) return;
      practicePlaybackTimingRef.current.playingEventTime = performance.now();
      setPracticeSeekDebug(prev => ({
        ...prev,
        playingEventTime: practicePlaybackTimingRef.current.playingEventTime,
        mainPlayingEventTime: practicePlaybackTimingRef.current.playingEventTime,
      }));
    };

    audio.addEventListener('seeked', handleSeeked);
    audio.addEventListener('play', handlePlayEvent);
    audio.addEventListener('playing', handlePlayingEvent);
    return () => {
      audio.removeEventListener('seeked', handleSeeked);
      audio.removeEventListener('play', handlePlayEvent);
      audio.removeEventListener('playing', handlePlayingEvent);
    };
  }, [setPracticeSeekDebug, showPracticePanel]);

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSmartRadioClick = () => {
    if (isPremium) {
      const next = !smartRadioActive;
      setSmartRadioActive(next);
      if (next) {
        onSmartRadioToast(t.premium.smartRadioFirstHint);
      } else {
        onSmartRadioToast(t.premium.smartRadioOffToast);
      }
    } else {
      setPremiumGateReason('smartRadio');
    }
  };

  const handleFavoriteClick = () => {
    if (isGuest) {
      onGuestFavoriteBlocked();
      return;
    }
    onToggleFavorite(currentTrack.id);
  };

  const handleMusicLibrarySkipBack = () => {
    if (!musicLibrarySkipEnabled || musicLibraryPlaybackQueue.length === 0) return;
    const idx = musicLibraryPlaybackQueue.findIndex(t => t.id === currentTrack.id);
    if (idx <= 0) return;
    onMusicLibrarySkipToTrack(musicLibraryPlaybackQueue[idx - 1], isPlaying);
  };

  const handleMusicLibrarySkipForward = () => {
    if (!musicLibrarySkipEnabled || musicLibraryPlaybackQueue.length === 0) return;
    const idx = musicLibraryPlaybackQueue.findIndex(t => t.id === currentTrack.id);
    if (idx < 0 || idx >= musicLibraryPlaybackQueue.length - 1) return;
    onMusicLibrarySkipToTrack(musicLibraryPlaybackQueue[idx + 1], isPlaying);
  };

  /** 自动续播：Smart Radio 开启时优先智能选曲；否则乐库页按列表顺序 */
  const handleMainAudioEnded = () => {
    if (showPracticePanel) {
      setIsPlaying(false);
      return;
    }
    if (crossfadeSkipEndedRef.current) {
      crossfadeSkipEndedRef.current = false;
      return;
    }
    if (isPremium && smartRadioActive) {
      const smartNext = getNextSmartRadioTrack();
      if (smartNext) {
        onMusicLibrarySkipToTrack(smartNext, true);
        return;
      }
    }
    if (musicLibrarySkipEnabled && musicLibraryPlaybackQueue.length > 0) {
      const idx = musicLibraryPlaybackQueue.findIndex(t => t.id === currentTrack.id);
      if (idx >= 0 && idx < musicLibraryPlaybackQueue.length - 1) {
        const nextTrack = musicLibraryPlaybackQueue[idx + 1];
        onMusicLibrarySkipToTrack(nextTrack, true);
        return;
      }
    }
    setIsPlaying(false);
  };

  return (
    <footer className="player-bar-dock fixed bottom-0 left-0 right-0 z-50 flex flex-col items-center overflow-visible px-0 pb-2.5 pt-0 md:pb-4 pointer-events-none">
      <audio
        ref={audioRef}
        data-role="main-player"
        className="sr-only"
        src={currentTrack.audioUrl}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleMainAudioEnded}
      />
      <audio ref={crossfadeAudioRef} className="hidden" preload="auto" playsInline aria-hidden />
      {/* Premium Prompt Modal */}
      <AnimatePresence>
        {premiumGateReason && (
          <div className="pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPremiumGateReason(null)}
              className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.22 }}
              className={premiumUiModal.shellHeavy}
            >
              <div className={premiumUi.iconWrap}>
                <Sparkles className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              </div>
              <div className="relative z-[1] flex flex-col gap-1.5">
                <h3 className={premiumUiModal.title}>{t.premium.smartRadioTitle}</h3>
                <p className={premiumUiModal.description}>{t.premium.smartRadioDesc}</p>
              </div>
              <div className="relative z-[1] flex w-full flex-col gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setPremiumGateReason(null);
                    onOpenSettingsMembership();
                  }}
                  className={premiumUi.upgradeButton}
                >
                  {t.common.upgrade}
                </button>
                <button type="button" onClick={() => setPremiumGateReason(null)} className={premiumUi.secondaryMuted}>
                  {t.common.maybeLater}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div
        className={`app-chrome-shell group/player relative w-full max-w-5xl overflow-visible px-3 md:px-6 transition-all duration-300 ease-out ${
          immersiveMode ? 'translate-y-[115%] opacity-0 pointer-events-none' : 'pointer-events-auto'
        }`}
      >
        <div
          className={`player-bar pointer-events-auto relative w-full overflow-visible ${compactPracticeMode ? 'flex px-4 gap-4' : 'grid grid-cols-[minmax(0,1fr)_minmax(0,2.05fr)_minmax(12.75rem,auto)] items-center gap-x-3 gap-y-1 py-2.5 px-4 sm:gap-x-4 sm:px-4 lg:px-5'}`}
        >
        {!compactPracticeMode && !showPracticePanel && !immersiveMode && (
          <ImmersiveModeEntryButton
            variant="player"
            onClick={onEnterImmersive}
            title={t.player.immersiveMode}
          />
        )}
        <div className={`player-info ${compactPracticeMode ? 'flex items-center gap-3 w-auto min-w-0 max-w-[32%]' : 'flex min-w-0 items-center gap-3 justify-self-start sm:gap-3.5'}`}>
          <img
            src={(currentTrack.metadataStatus === 'approved' && currentTrack.sourceCoverUrl) ? currentTrack.sourceCoverUrl : (currentTrack.coverUrl || 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?q=80&w=200&auto=format&fit=crop')}
            alt="Album Art"
            className={`player-cover ${compactPracticeMode ? 'w-11 h-11 rounded-md object-cover' : 'w-14 h-14 rounded-lg object-cover shadow-md shrink-0'}`}
            referrerPolicy="no-referrer"
          />
          <div className="flex flex-col overflow-hidden">
            <span className={`player-title font-medium text-[var(--color-mist-text)] truncate ${compactPracticeMode ? 'text-sm' : ''}`}>{getDisplayTrackTitle(currentTrack, currentLang)}</span>
            <span className={`player-artist truncate text-[var(--color-mist-text)]/60 ${compactPracticeMode ? 'text-xs' : 'text-sm'}`}>{getDisplayTrackArtist(currentTrack, currentLang)}</span>
          </div>
        </div>

        <div className={`player-center flex min-w-0 flex-col items-stretch gap-1.5 justify-self-center pr-1 sm:pr-2 ${compactPracticeMode ? 'flex-1' : 'w-full max-w-full'}`}>
          <div className={`flex w-full items-center justify-center ${compactPracticeMode ? 'gap-4' : 'gap-0'}`}>
            {compactPracticeMode ? (
              <button
                type="button"
                onClick={() => setIsPlaying(!isPlaying)}
                className="player-play-btn w-11 h-11 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors text-[var(--color-mist-text)] border border-white/30"
              >
                {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
              </button>
            ) : (
              <div className="flex w-full max-w-xl shrink-0 items-center justify-center gap-4 sm:gap-5">
                <button
                  type="button"
                  onClick={handleFavoriteClick}
                  aria-pressed={!isGuest ? isFavorite : undefined}
                  aria-label={
                    isGuest
                      ? `${t.settings.guestPromptTitle} — ${getDisplayTrackTitle(currentTrack, currentLang)}`
                      : isFavorite
                        ? `${t.player.removeFavorite} — ${getDisplayTrackTitle(currentTrack, currentLang)}`
                        : `${t.player.addFavorite} — ${getDisplayTrackTitle(currentTrack, currentLang)}`
                  }
                  title={
                    isGuest
                      ? t.settings.guestPromptTitle
                      : isFavorite
                        ? t.player.removeFavorite
                        : t.player.addFavorite
                  }
                  className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-[color,filter] duration-200 active:scale-95 ${
                    isGuest
                      ? 'text-[var(--color-mist-text)]/28 hover:text-[var(--color-mist-text)]/48'
                      : isFavorite
                        ? ''
                        : 'text-[var(--color-mist-text)]/50 hover:text-[var(--color-mist-text)]/80'
                  }`}
                >
                  <Heart
                    className={`h-5 w-5 translate-y-px transition-[filter,color] duration-300 ${
                      !isGuest && isFavorite
                        ? 'text-[#b8956a] [filter:drop-shadow(0_0_5px_rgba(235,210,170,0.75))_drop-shadow(0_0_14px_rgba(195,155,105,0.45))_drop-shadow(0_0_22px_rgba(175,130,85,0.18))]'
                        : ''
                    }`}
                    fill={!isGuest && isFavorite ? 'currentColor' : 'none'}
                    strokeWidth={1.5}
                    aria-hidden
                  />
                </button>
                <button
                  type="button"
                  onClick={handleMusicLibrarySkipBack}
                  className="text-[var(--color-mist-text)]/80 hover:text-[var(--color-mist-text)] transition-colors"
                >
                  <SkipBack className="w-[1.15rem] h-[1.15rem] fill-current" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="player-play-btn w-10 h-10 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors text-[var(--color-mist-text)] border border-white/30"
                >
                  {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                </button>
                <button
                  type="button"
                  onClick={handleMusicLibrarySkipForward}
                  className="text-[var(--color-mist-text)]/80 hover:text-[var(--color-mist-text)] transition-colors"
                >
                  <SkipForward className="w-[1.15rem] h-[1.15rem] fill-current" />
                </button>
                <button
                  type="button"
                  onClick={handleSmartRadioClick}
                  aria-pressed={isPremium ? smartRadioActive : undefined}
                  aria-label={
                    isPremium
                      ? `${t.premium.smartRadioTitle}. ${t.premium.smartRadioTooltipHint} ${smartRadioActive ? t.common.enabled : t.common.disabled}.`
                      : t.premium.smartRadioTitle
                  }
                  title={`${t.premium.smartRadioTitle} — ${t.premium.smartRadioTooltipHint}`}
                  className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-[color,filter] duration-200 active:scale-95 ${
                    isPremium
                      ? smartRadioActive
                        ? ''
                        : 'text-[var(--color-mist-text)]/50 hover:text-[var(--color-mist-text)]/80'
                      : 'text-[var(--color-mist-text)]/28 hover:text-[var(--color-mist-text)]/48'
                  }`}
                >
                  <Radio
                    className={`h-5 w-5 translate-y-px transition-[filter,color] duration-300 ${
                      isPremium && smartRadioActive
                        ? 'text-[#b8956a] [filter:drop-shadow(0_0_5px_rgba(235,210,170,0.75))_drop-shadow(0_0_14px_rgba(195,155,105,0.45))_drop-shadow(0_0_22px_rgba(175,130,85,0.18))]'
                        : ''
                    }`}
                    strokeWidth={1.5}
                    aria-hidden
                  />
                </button>
              </div>
            )}
          </div>

          <PlayerProgressStrip
            showPracticePanel={showPracticePanel}
            compactPracticeMode={compactPracticeMode}
            audioRef={audioRef}
            trackId={currentTrack.id}
            formatTime={formatTime}
            progressBarRef={progressBarRef}
            onPointerDown={handleProgressPointerDown}
            progressSyncTick={progressSyncTick}
          />
        </div>

        <div
          ref={playerToolsRef}
          className={`player-right-col flex shrink-0 items-center ${compactPracticeMode ? 'w-auto min-w-0 gap-3' : 'min-w-0 justify-self-end pl-1 sm:pl-2'}`}
        >
          <div className={`flex flex-none items-center ${compactPracticeMode ? 'gap-3' : 'gap-0.5 sm:gap-1'}`}>
            <button
              type="button"
              onClick={() => canUsePractice && setShowPracticePanel(!showPracticePanel)}
              disabled={!canUsePractice}
              className={`flex min-w-[2.75rem] shrink-0 flex-col items-center gap-0.5 rounded-lg px-0.5 py-1 transition-all sm:min-w-[2.875rem] ${!canUsePractice
                ? 'cursor-not-allowed opacity-25'
                : showPracticePanel
                  ? 'bg-white/28 text-[var(--color-mist-text)] shadow-md ring-1 ring-white/40'
                  : 'text-[var(--color-mist-text)]/60 hover:bg-white/16 hover:text-[var(--color-mist-text)]'
                }`}
              title={canUsePractice ? `${t.player.practiceMode} — ${t.music.practice}` : t.player.practiceNotAvailable}
              aria-label={canUsePractice ? t.player.practiceMode : t.player.practiceNotAvailable}
            >
              <Piano className="h-5 w-5" />
              <span className="text-[10px] font-medium uppercase tracking-tighter">{t.music.practice}</span>
            </button>

            {!compactPracticeMode && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (!currentTrack || !canOpenExternalVideo) return;
                    const isCN = currentLang === '简体中文';
                    const url = isCN
                      ? (resolvedBilibiliUrl || resolvedYoutubeUrl)
                      : (resolvedYoutubeUrl || resolvedBilibiliUrl);
                    if (url) window.open(url, '_blank');
                  }}
                  disabled={!canOpenExternalVideo}
                  className={`flex min-w-[2.75rem] shrink-0 flex-col items-center gap-0.5 rounded-lg px-0.5 py-1 transition-colors sm:min-w-[2.875rem] ${canOpenExternalVideo
                    ? 'text-[var(--color-mist-text)]/60 hover:bg-white/16 hover:text-[var(--color-mist-text)]'
                    : 'cursor-not-allowed text-[var(--color-mist-text)]/22 opacity-55'
                    }`}
                  title={
                    canOpenExternalVideo
                      ? t.player.watchVideo
                      : linkStatus === 'missingVideo'
                        ? t.player.videoMissingCip
                        : t.player.videoNotAvailable
                  }
                  aria-disabled={!canOpenExternalVideo}
                  aria-label={t.player.video}
                >
                  <Youtube className="h-5 w-5" />
                  <span className="text-[10px] font-medium uppercase tracking-tighter">{t.player.video}</span>
                </button>

                <button
                  type="button"
                  onClick={() => resolvedSheetUrl && window.open(resolvedSheetUrl, '_blank')}
                  disabled={!resolvedSheetUrl}
                  className={`flex min-w-[2.75rem] shrink-0 flex-col items-center gap-0.5 rounded-lg px-0.5 py-1 transition-colors sm:min-w-[2.875rem] ${resolvedSheetUrl
                    ? 'text-[var(--color-mist-text)]/60 hover:bg-white/16 hover:text-[var(--color-mist-text)]'
                    : 'cursor-not-allowed text-[var(--color-mist-text)]/22 opacity-55'
                    }`}
                  title={
                    resolvedSheetUrl
                      ? t.player.sheetMusic
                      : linkStatus === 'missingSheet' && canOpenExternalVideo
                        ? t.player.sheetMissingFromVideo
                        : t.player.sheetNotAvailable
                  }
                  aria-disabled={!resolvedSheetUrl}
                  aria-label={t.player.sheet}
                >
                  <BookOpen className="h-5 w-5" />
                  <span className="text-[10px] font-medium uppercase tracking-tighter">{t.player.sheet}</span>
                </button>

                <div className="relative flex shrink-0 flex-col items-center">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSpeedMenu(s => !s);
                      setShowVolumePopover(false);
                    }}
                    className="flex min-w-[2.75rem] flex-col items-center gap-0.5 rounded-lg px-0.5 py-1 text-[var(--color-mist-text)]/60 transition-colors hover:bg-white/16 hover:text-[var(--color-mist-text)] sm:min-w-[2.875rem]"
                    title={`${t.player.playbackSpeed} (${playbackRate}x)`}
                    aria-label={`${t.player.speed} ${playbackRate}x`}
                    aria-expanded={showSpeedMenu}
                    aria-haspopup="true"
                  >
                    <Clock className="h-5 w-5" />
                    <span className="text-[10px] font-medium uppercase tracking-tighter">{t.player.speed}</span>
                  </button>

                  {showSpeedMenu && (
                    <div className="glass-popover absolute bottom-full right-0 z-20 mb-3 flex min-w-[5.5rem] animate-in flex-col gap-0.5 rounded-2xl p-2 duration-200 slide-in-from-bottom-2">
                      {speeds.map(s => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            setPlaybackRate(s);
                            setShowSpeedMenu(false);
                          }}
                          className={`rounded-lg px-3 py-1.5 text-left text-xs transition-colors ${playbackRate === s ? 'bg-white/20 text-[var(--color-mist-text)]' : 'text-[var(--color-mist-text)]/60 hover:bg-white/10'}`}
                        >
                          {s}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative flex shrink-0 flex-col items-center">
                  <button
                    type="button"
                    onClick={() => {
                      setShowVolumePopover(s => !s);
                      setShowSpeedMenu(false);
                    }}
                    className="flex min-w-[2.75rem] flex-col items-center gap-0.5 rounded-lg px-0.5 py-1 text-[var(--color-mist-text)]/60 transition-colors hover:bg-white/16 hover:text-[var(--color-mist-text)] sm:min-w-[2.875rem]"
                    title={t.player.volume}
                    aria-expanded={showVolumePopover}
                    aria-label={t.player.volume}
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX className="h-5 w-5" />
                    ) : volume < 0.5 ? (
                      <Volume1 className="h-5 w-5" />
                    ) : (
                      <Volume2 className="h-5 w-5" />
                    )}
                    <span className="text-[10px] font-medium uppercase tracking-tighter">{t.player.volume}</span>
                  </button>

                  {showVolumePopover && (
                    <div className="glass-popover absolute bottom-full right-0 z-20 mb-3 flex w-[8.5rem] animate-in flex-col gap-2 rounded-2xl p-3 duration-200 slide-in-from-bottom-2">
                      <div
                        className="group h-2 w-full cursor-pointer overflow-hidden rounded-full bg-white/22"
                        onClick={e => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const x = e.clientX - rect.left;
                          const newVolume = Math.max(0, Math.min(1, x / rect.width));
                          setVolume(newVolume);
                          if (newVolume > 0) setIsMuted(false);
                        }}
                        onKeyDown={e => e.preventDefault()}
                        role="presentation"
                      >
                        <div
                          className="h-full bg-[var(--color-mist-text)]/55 transition-colors group-hover:bg-[var(--color-mist-text)]/75"
                          style={{ width: `${isMuted ? 0 : volume * 100}%` }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (isMuted) {
                            setIsMuted(false);
                            if (volume === 0) setVolume(lastVolume || 0.7);
                          } else {
                            setLastVolume(volume);
                            setIsMuted(true);
                          }
                        }}
                        className="text-center text-[10px] font-medium text-[var(--color-mist-text)]/50 hover:text-[var(--color-mist-text)]/78"
                      >
                        {isMuted ? t.player.unmute : t.player.mute}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      </div>
    </footer>
  );
});

function HorizontalScroller({ children, showHint = false, t }: { children: React.ReactNode, showHint?: boolean, t: any }) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [hintVisible, setHintVisible] = React.useState(showHint);

  React.useEffect(() => {
    if (showHint) {
      const timer = setTimeout(() => setHintVisible(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showHint]);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 400;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className="relative group/scroller w-full">
      <AnimatePresence>
        {hintVisible && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            className="absolute -top-7 right-6 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 pointer-events-none z-40"
          >
            {t.tags.scroll}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Left Arrow - Positioned in the safe padding area */}
      <button
        onClick={() => scroll('left')}
        className="absolute left-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full glass-tile flex items-center justify-center text-[var(--color-mist-text)] opacity-60 hover:opacity-100 hover:scale-105 transition-all duration-300"
        aria-label="Scroll left"
      >
        <ChevronLeft className="w-6 h-6" />
      </button>

      {/* Scroll Track — overflow-y: visible so selected card's top glow/shadow isn't clipped */}
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto no-scrollbar pb-2 pt-3 px-16 scroll-smooth"
        style={{ overflowY: 'visible' }}
      >
        {children}
      </div>

      {/* Right Arrow - Positioned in the safe padding area */}
      <button
        onClick={() => scroll('right')}
        className="absolute right-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full glass-tile flex items-center justify-center text-[var(--color-mist-text)] opacity-60 hover:opacity-100 hover:scale-105 transition-all duration-300"
        aria-label="Scroll right"
      >
        <ChevronRight className="w-6 h-6" />
      </button>
    </div>
  );
}

const FocusTab = memo(function FocusTab({
  currentTrack,
  isPlaying,
  setIsPlaying,
  activeSceneId,
  setActiveSceneId,
  setActiveView,
  activeAmbiences,
  setActiveAmbiences,
  ambienceVolumes,
  setAmbienceVolumes,
  toggleAmbience,
  isPremium,
  isGuest,
  onGuestFeatureBlocked,
  showAmbienceToast,
  t
}: {
  currentTrack: Track,
  isPlaying: boolean,
  setIsPlaying: (v: boolean) => void,
  activeSceneId: string,
  setActiveSceneId: (id: string) => void,
  setActiveView: (v: View) => void,
  activeAmbiences: AmbientKey[],
  setActiveAmbiences: React.Dispatch<React.SetStateAction<AmbientKey[]>>,
  ambienceVolumes: Record<AmbientKey, number>,
  setAmbienceVolumes: (v: Record<AmbientKey, number>) => void,
  toggleAmbience: (id: AmbientKey) => void,
  isPremium: boolean,
  isGuest: boolean,
  onGuestFeatureBlocked: () => void,
  showAmbienceToast: (msg: string) => void,
  t: any
}) {
  // volumes alias so existing inner code keeps working
  const volumes = ambienceVolumes;
  const setVolumes = setAmbienceVolumes;

  // Pomodoro preset
  const [pomoPreset, setPomoPreset] = useState<'classic' | 'custom'>('classic');
  const [pomoFocus, setPomoFocus] = useState('25');
  const [pomoBreak, setPomoBreak] = useState('5');

  // Fade-out setting (applies to music + ambience)
  const [fadeOut, setFadeOut] = useState<'Off' | '30s' | '1m'>('Off');

  // ── Session state machine ──────────────────────────────────────────
  type SessionStatus = 'idle' | 'focus' | 'break' | 'paused' | 'finished';
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [pausedPhase, setPausedPhase] = useState<'focus' | 'break'>('focus');
  const [secsLeft, setSecsLeft] = useState<number>(0);
  const [totalSecs, setTotalSecs] = useState<number>(0); // for progress ring
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFadingRef = React.useRef(false);
  const notifAudioRef = React.useRef<HTMLAudioElement | null>(null);

  // Pre-load notif sound
  React.useEffect(() => {
    notifAudioRef.current = new Audio('https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/notif.mp3');
    notifAudioRef.current.volume = 0.1;
    return () => { clearIntervalSafe(); clearFadeSafe(); };
  }, []);

  const activeFocusMins = pomoPreset === 'classic' ? 25 : Math.max(1, parseInt(pomoFocus) || 25);
  const activeBreakMins = pomoPreset === 'classic' ? 5 : Math.max(1, parseInt(pomoBreak) || 5);

  const playNotif = () => { try { const a = new Audio('https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/notif.mp3'); a.volume = 0.1; a.play().catch(() => { }); } catch (_) { } };

  const clearIntervalSafe = () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };
  const clearFadeSafe = () => { if (fadeTimerRef.current) { clearTimeout(fadeTimerRef.current); fadeTimerRef.current = null; } };

  // Fade music + ambience: find main audio + all ambience <audio> elements and ramp volume to 0 over fadeDuration ms
  const triggerFadeOut = (fadeDurationMs: number) => {
    if (isFadingRef.current) return;
    isFadingRef.current = true;
    const audios = Array.from(document.querySelectorAll('audio')) as HTMLAudioElement[];
    const startVols = audios.map(a => a.volume);
    const steps = 40;
    const stepMs = fadeDurationMs / steps;
    let step = 0;
    const tick = () => {
      step++;
      audios.forEach((a, i) => { a.volume = Math.max(0, startVols[i] * (1 - step / steps)); });
      if (step < steps) fadeTimerRef.current = setTimeout(tick, stepMs);
    };
    fadeTimerRef.current = setTimeout(tick, stepMs);
  };

  // Start an interval that ticks secsLeft down; calls onEnd when done
  const runInterval = (onEnd: () => void, fadeOffsetSecs?: number) => {
    clearIntervalSafe();
    intervalRef.current = setInterval(() => {
      setSecsLeft(prev => {
        const next = prev - 1;
        // Trigger fade when close to end
        if (fadeOffsetSecs && next === fadeOffsetSecs && !isFadingRef.current) {
          triggerFadeOut(fadeOffsetSecs * 1000);
        }
        if (next <= 0) {
          clearIntervalSafe();
          onEnd();
          return 0;
        }
        return next;
      });
    }, 1000);
  };

  const fadeOffsetSecs = fadeOut === '30s' ? 30 : fadeOut === '1m' ? 60 : undefined;

  const startBreak = () => {
    const secs = activeBreakMins * 60;
    setStatus('break');
    setSecsLeft(secs);
    setTotalSecs(secs);
    isFadingRef.current = false;
    clearFadeSafe();
    playNotif();
    runInterval(() => {
      playNotif();
      setStatus('finished');
      setSecsLeft(0);
    });
  };

  const handleStartSession = () => {
    if (isGuest) {
      onGuestFeatureBlocked();
      return;
    }
    clearIntervalSafe(); clearFadeSafe();
    isFadingRef.current = false;
    const secs = activeFocusMins * 60;
    setStatus('focus');
    setSecsLeft(secs);
    setTotalSecs(secs);
    playNotif();
    runInterval(startBreak, fadeOffsetSecs);
  };

  const handlePauseResume = () => {
    if (status === 'paused') {
      const phase = pausedPhase;
      setStatus(phase);
      runInterval(
        phase === 'focus' ? startBreak : () => { playNotif(); setStatus('finished'); setSecsLeft(0); },
        phase === 'focus' ? fadeOffsetSecs : undefined
      );
    } else {
      clearIntervalSafe();
      setPausedPhase(status as 'focus' | 'break');
      setStatus('paused');
    }
  };

  const handleResetSession = () => {
    clearIntervalSafe(); clearFadeSafe();
    isFadingRef.current = false;
    // Restore audio volumes to 1
    Array.from(document.querySelectorAll('audio') as NodeListOf<HTMLAudioElement>).forEach(a => { a.volume = 1; });
    setStatus('idle');
    setSecsLeft(0);
  };

  const fmtSecs = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const progress = totalSecs > 0 ? 1 - secsLeft / totalSecs : 0;

  // Ambience catalog — each item is an independently playable sound layer
  const ambienceGroups: { title: string; items: AmbientCatalogItem[] }[] = [
    {
      title: t.ambient.nature,
      items: [
        {
          id: 'window_rain',
          name: t.ambient.windowRain,
          icon: CloudRain,
          imageUrl: 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=800&q=80',
          audioUrl: AMBIENCE_AUDIO_URLS.window_rain,
          tag: 'nature',
        },
        {
          id: 'thunderstorm',
          name: t.ambient.thunderstorm,
          icon: CloudLightning,
          imageUrl: 'https://images.unsplash.com/photo-1605727216801-e27ce1d0cc28?auto=format&fit=crop&w=800&q=80',
          audioUrl: AMBIENCE_AUDIO_URLS.thunderstorm,
          tag: 'nature',
        },
        {
          id: 'ocean',
          name: t.ambient.ocean,
          icon: Waves,
          imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80',
          audioUrl: AMBIENCE_AUDIO_URLS.ocean,
          tag: 'nature',
        },
        {
          id: 'forest',
          name: t.ambient.forest,
          icon: TreeDeciduous,
          imageUrl: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=800&q=80',
          audioUrl: AMBIENCE_AUDIO_URLS.forest,
          tag: 'nature',
        },
        {
          id: 'white_noise',
          name: t.ambient.whiteNoise,
          icon: Wind,
          imageUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80',
          audioUrl: AMBIENCE_AUDIO_URLS.white_noise,
          tag: 'white_noise',
        },
        {
          id: 'night_ambient',
          name: t.ambient.nightAmbient,
          icon: Moon,
          imageUrl: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=800&q=80',
          audioUrl: AMBIENCE_AUDIO_URLS.night_ambient,
          tag: 'nature',
        },
        {
          id: 'library',
          name: t.ambient.library,
          icon: Library,
          imageUrl: 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=800&q=80',
          audioUrl: AMBIENCE_AUDIO_URLS.library,
          tag: 'indoor',
        },
        {
          id: 'fireplace',
          name: t.ambient.fireplace,
          icon: Flame,
          imageUrl: 'https://images.unsplash.com/photo-1542181961-9590d0c79dab?auto=format&fit=crop&w=800&q=80',
          audioUrl: AMBIENCE_AUDIO_URLS.fireplace,
          tag: 'indoor',
        },
        {
          id: 'cafe',
          name: t.ambient.cafe,
          icon: Coffee,
          imageUrl: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=800&q=80',
          audioUrl: AMBIENCE_AUDIO_URLS.cafe,
          tag: 'indoor',
        }
      ]
    }
  ];

  // Ambient audio engine is now in App (global) — no local engine needed.

  const focusPresets = [
    { id: 'deep', name: 'Deep Work', icon: Brain, ambience: ['white_noise'], volume: 40 },
    { id: 'read', name: 'Reading', icon: BookOpen, ambience: ['library'], volume: 30 },
    { id: 'relax', name: 'Relaxation', icon: Coffee, ambience: ['window_rain', 'fireplace'], volume: 50 },
    { id: 'nature', name: 'Nature Walk', icon: TreePine, ambience: ['forest', 'ocean'], volume: 45 },
  ];

  const applyPreset = (preset: typeof focusPresets[0]) => {
    if (isGuest) {
      onGuestFeatureBlocked();
      return;
    }
    const toApply = (isPremium ? preset.ambience : preset.ambience.slice(0, 1)) as AmbientKey[];
    const newVols = { ...volumes };
    toApply.forEach(id => { newVols[id] = preset.volume; });
    setVolumes(newVols);
    setActiveAmbiences(toApply);
  };

  const ambientItems = ambienceGroups.flatMap(g => g.items);

  const TomatoIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2c.5 0 1 .5 1 1v1.5c1.8.3 3.3 1.5 4 3.1.2.5 0 1.1-.5 1.3s-1.1 0-1.3-.5c-.5-1.1-1.5-1.9-2.7-2.1V7.5c0 .6-.4 1-1 1s-1-.4-1-1V6.4c-1.2.2-2.2 1-2.7 2.1-.2.5-.8.7-1.3.5s-.7-.8-.5-1.3c.7-1.6 2.2-2.8 4-3.1V3c0-.6.4-1 1-1z" />
      <path d="M12 9c-4.4 0-8 3.6-8 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8z" />
    </svg>
  );

  return (
    <div className="focus-page w-full max-w-5xl mx-auto animate-in fade-in duration-500 pb-12">
      <div className="focus-panel glass-effect-static p-8 rounded-[40px] flex flex-col gap-10">

        {/* 1) THEME STRIP */}
        <div className="flex flex-col gap-4">
          <h3 className="text-lg font-medium text-[var(--color-mist-text)] ml-1">{t.home.theme}</h3>
          <HorizontalScroller showHint t={t}>
            {SCENES.map(scene => {
              const locked = scene.premiumOnly && !isPremium;
              const isActive = activeSceneId === scene.id;
              return (
                <div
                  key={scene.id}
                  onClick={() => {
                    if (locked) {
                      showAmbienceToast(t.home.upgradeUnlock);
                      return;
                    }
                    setActiveSceneId(scene.id);
                  }}
                  className={`relative w-56 h-32 rounded-2xl overflow-hidden shrink-0 cursor-pointer group transition-all duration-300 ${isActive
                    ? 'shadow-[0_0_0_2px_rgba(255,255,255,0.5),0_8px_24px_rgba(0,0,0,0.35)] -translate-y-1.5 scale-[1.02]'
                    : 'hover:shadow-[0_4px_16px_rgba(0,0,0,0.2)] hover:-translate-y-0.5'
                    }`}
                >
                  <img
                    src={scene.thumbnail}
                    alt={t.themes[scene.id as keyof typeof t.themes]}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                  />
                  {locked && (
                    <div className="absolute inset-0 bg-black/15 backdrop-blur-[0.5px] flex flex-col items-center justify-center gap-1.5 z-20">
                      <div className="bg-white/10 p-2 rounded-full backdrop-blur-md border border-white/20 shadow-xl">
                        <Lock className="w-5 h-5 text-white" />
                      </div>
                      <span className="text-[10px] font-extrabold text-white uppercase tracking-[0.15em] px-2 py-0.5 rounded bg-black/20 backdrop-blur-sm border border-white/10 shadow-sm">{t.common.premium}</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-mist-text)]/60 via-transparent to-transparent"></div>
                  <div className="absolute bottom-3 left-3 flex flex-col">
                    <span className="text-white text-sm font-medium">{t.themes[scene.id as keyof typeof t.themes]}</span>
                    <span className="text-[10px] text-white/80 bg-white/20 px-2 py-0.5 rounded-full w-fit mt-1 glass-utility border border-white/20">{t.tags[scene.tag as keyof typeof t.tags]}</span>
                  </div>
                  {isActive && (
                    <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white/90 flex items-center justify-center shadow">
                      <svg className="w-3 h-3 text-black/70" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                  )}
                </div>
              );
            })}
          </HorizontalScroller>
        </div>

        {/* 2) AMBIENT STRIP */}
        <div className="flex flex-col gap-4">
          <div className="ml-1 flex flex-col gap-1">
            <h3 className="text-lg font-medium text-[var(--color-mist-text)]">{t.home.ambience}</h3>
            <p className="text-xs text-[var(--color-mist-text)]/56">{t.common.ambienceLimit}</p>
          </div>
          <HorizontalScroller showHint t={t}>
            {ambientItems.map(amb => {
              const Icon = amb.icon;
              const isActive = activeAmbiences.includes(amb.id);
              return (
                <div
                  key={amb.id}
                  onClick={() => toggleAmbience(amb.id)}
                  className={`relative w-56 h-32 rounded-2xl overflow-hidden shrink-0 cursor-pointer group transition-all duration-300 ${isActive
                    ? 'shadow-[0_0_0_2px_rgba(255,255,255,0.45),0_8px_24px_rgba(0,0,0,0.35)] -translate-y-1.5 scale-[1.02]'
                    : 'hover:shadow-[0_4px_16px_rgba(0,0,0,0.2)] hover:-translate-y-0.5'
                    }`}
                >
                  <img src={(amb as any).imageUrl} alt={amb.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" referrerPolicy="no-referrer" />
                  <div className={`absolute inset-0 transition-colors ${isActive ? 'bg-[var(--color-mist-text)]/15' : 'bg-[var(--color-mist-text)]/40 group-hover:bg-[var(--color-mist-text)]/20'}`}></div>
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-mist-text)]/60 via-transparent to-transparent"></div>
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <Icon className={`w-8 h-8 transition-transform duration-300 ${isActive ? 'scale-110 text-white' : 'text-white/80 group-hover:scale-110'}`} />
                    <span className="text-white text-sm font-medium tracking-wide">{amb.name}</span>
                  </div>
                  {isActive && (
                    <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white/90 flex items-center justify-center shadow">
                      <svg className="w-3 h-3 text-black/70" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                  )}
                  {isActive && (
                    <div className="absolute bottom-3 left-3 right-3 p-2 bg-white/20 glass-utility rounded-xl border border-white/20 animate-in slide-in-from-bottom-2 duration-300" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <Volume2 className="w-3 h-3 text-white" />
                        <input type="range" min="0" max="100"
                          value={volumes[amb.id] ?? 50}
                          onChange={e => setVolumes({ ...volumes, [amb.id]: parseInt(e.target.value) })}
                          className="w-full h-1 rounded-full appearance-none bg-white/30 outline-none accent-white"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </HorizontalScroller>

          {/* Active Ambience Pills — shown when at least 1 is active */}
          {activeAmbiences.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mt-1 animate-in fade-in duration-300">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-mist-text)]/40 shrink-0">{t.ambient.nowPlaying}</span>
              {activeAmbiences.map(id => {
                const item = ambientItems.find(a => a.id === id);
                if (!item) return null;
                const Icon = item.icon;
                return (
                  <button
                    key={id}
                    onClick={() => toggleAmbience(id)}
                    className="flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full bg-white/15 hover:bg-white/25 border border-white/20 text-[var(--color-mist-text)] text-xs font-medium transition-all group"
                  >
                    <Icon className="w-3 h-3 opacity-70" />
                    <span>{item.name}</span>
                    <span className="ml-0.5 text-[var(--color-mist-text)]/40 group-hover:text-[var(--color-mist-text)]/80 transition-colors">×</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 3) SESSION / POMODORO PANEL */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 ml-1">
            <TomatoIcon className="w-4 h-4 text-[var(--color-mist-text)]/60" />
            <h3 className="text-lg font-medium text-[var(--color-mist-text)]">{t.home.pomodoro}</h3>
          </div>

          <div className="glass-panel-static px-6 py-5 flex flex-col gap-5 shadow-sm">

            {/* ── IDLE: 3-column grid layout ────────────────────── */}
            {status === 'idle' && (
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-6 animate-in fade-in duration-300">

                {/* LEFT: Preset Cards */}
                <div className="flex items-center gap-4 flex-wrap">
                  {/* Classic Card */}
                  <button
                    onClick={() => setPomoPreset('classic')}
                    className={`px-5 py-3 rounded-2xl flex flex-col items-start gap-2 transition-all duration-300 border ${pomoPreset === 'classic'
                      ? 'bg-white/35 border-white/50 text-[var(--color-mist-text)] shadow-[0_8px_30px_rgb(0,0,0,0.12)] -translate-y-1 scale-[1.03]'
                      : 'bg-white/10 border-white/10 text-[var(--color-mist-text)]/40 hover:bg-white/20 hover:border-white/20'
                      }`}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">{t.home.classic}</span>
                    <div className="flex items-end gap-1 leading-none">
                      <span className="text-2xl font-bold">25</span>
                      <span className="text-sm font-medium opacity-20 mb-1">/</span>
                      <span className="text-lg font-bold opacity-80">5</span>
                    </div>
                  </button>

                  {/* Custom Card (Container for direct-editable inputs) */}
                  <div
                    onClick={() => setPomoPreset('custom')}
                    className={`px-5 py-3 rounded-2xl flex flex-col items-start gap-2 transition-all duration-300 border cursor-pointer ${pomoPreset === 'custom'
                      ? 'bg-white/35 border-white/50 text-[var(--color-mist-text)] shadow-[0_8px_30px_rgb(0,0,0,0.12)] -translate-y-1 scale-[1.03]'
                      : 'bg-white/10 border-white/10 text-[var(--color-mist-text)]/40 hover:bg-white/20 hover:border-white/20 group'
                      }`}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">{t.home.custom}</span>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col items-center gap-1">
                        <input
                          type="number"
                          min="1" max="999"
                          value={pomoFocus}
                          onChange={e => { setPomoPreset('custom'); setPomoFocus(e.target.value); }}
                          onClick={e => e.stopPropagation()}
                          className={`w-14 bg-white/10 border border-white/10 rounded-lg py-1 text-lg font-bold text-center focus:outline-none focus:bg-white/20 transition-all ${pomoPreset === 'custom' ? 'text-[var(--color-mist-text)]' : 'text-[var(--color-mist-text)]/40'
                            }`}
                        />
                        <span className="text-[7px] font-bold uppercase opacity-30">{t.home.focusDuration}</span>
                      </div>
                      <span className="text-white/20 font-bold mb-4">:</span>
                      <div className="flex flex-col items-center gap-1">
                        <input
                          type="number"
                          min="0" max="999"
                          value={pomoBreak}
                          onChange={e => { setPomoPreset('custom'); setPomoBreak(e.target.value); }}
                          onClick={e => e.stopPropagation()}
                          className={`w-14 bg-white/10 border border-white/10 rounded-lg py-1 text-lg font-bold text-center focus:outline-none focus:bg-white/20 transition-all ${pomoPreset === 'custom' ? 'text-[var(--color-mist-text)]' : 'text-[var(--color-mist-text)]/40'
                            }`}
                        />
                        <span className="text-[7px] font-bold uppercase opacity-30">{t.home.breakDuration}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 border-l border-white/10 pl-6">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-mist-text)]/40">{t.home.fadeOutLabel}</span>
                  <div className="flex gap-1.5">
                    {(['Off', '30s', '1m'] as const).map(v => (
                      <button
                        key={v}
                        onClick={() => setFadeOut(v)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border ${fadeOut === v
                          ? 'bg-white/30 border-white/40 text-[var(--color-mist-text)]'
                          : 'bg-white/8 border-white/10 text-[var(--color-mist-text)]/40 hover:bg-white/15'
                          }`}
                      >
                        {v === 'Off' ? t.home.fadeOutOff : v === '30s' ? t.home.fadeOut30 : t.home.fadeOut1m}
                      </button>
                    ))}
                  </div>
                  <span className="text-[10px] text-[var(--color-mist-text)]/25 leading-tight">{t.home.fadeDesc}</span>
                </div>

                {/* RIGHT: Start button */}
                <div className="border-l border-white/10 pl-6">
                  <button
                    onClick={handleStartSession}
                    className={`${premiumUi.upgradeButtonCompact} rounded-full`}
                  >
                    {t.home.startSession}
                  </button>
                </div>
              </div>
            )}
            {/* ── ACTIVE / PAUSED / FINISHED: live view ─────────────── */}
            {status !== 'idle' && (
              <div className="flex items-center justify-between gap-6 animate-in fade-in duration-300">

                {/* Phase badge + big countdown */}
                <div className="flex flex-col gap-1">
                  <div className={`self-start px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider mb-1 ${status === 'focus' ? 'bg-white/20 text-[var(--color-mist-text)]/80' :
                    status === 'break' ? 'bg-emerald-500/20 text-emerald-400' :
                      status === 'paused' ? 'bg-white/18 text-[var(--color-mist-text)]/75' :
                        'bg-white/10 text-[var(--color-mist-text)]/50'
                    }`}>
                    {status === 'focus' ? t.home.focusTime :
                      status === 'break' ? t.home.breakTime :
                        status === 'paused' ? `${t.home.pause} · ${pausedPhase === 'focus' ? t.home.focusTime : t.home.breakTime}` :
                          t.home.sessionComplete}
                  </div>
                  {status !== 'finished' ? (
                    <span className="text-[44px] font-bold tracking-tight text-[var(--color-mist-text)] tabular-nums leading-none">
                      {fmtSecs(secsLeft)}
                    </span>
                  ) : (
                    <span className="text-2xl font-bold text-[var(--color-mist-text)]/60">{t.common.done} ✓</span>
                  )}
                </div>

                {/* Controls */}
                <div className="flex items-center gap-2 shrink-0">
                  {status !== 'finished' && (
                    <button
                      onClick={handlePauseResume}
                      className="px-6 py-2.5 rounded-full bg-white/10 text-white text-sm font-bold hover:bg-white/20 transition-all active:scale-95"
                    >
                      {status === 'paused' ? t.home.resume : t.home.pause}
                    </button>
                  )}
                  <button
                    onClick={handleResetSession}
                    className="px-6 py-2.5 rounded-full bg-white/5 text-white/40 text-sm font-bold hover:bg-white/10 transition-all active:scale-95"
                  >
                    {t.home.reset}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

const SettingsTab = memo(function SettingsTab({
  resolvedPremiumAccess,
  isGuest,
  accountTier,
  showDevPreview,
  setDevAccountTier,
  setActiveView,
  setShowSheetOptions,
  currentLang,
  settingsMembershipScrollToken,
  favoriteIds,
  recentTrackIds,
  tracks,
  t,
  openAuthModal,
  checkoutBump,
  onSignedOut,
  remoteMembership,
  remoteMembershipLoading,
  membershipFetchIssue,
  onMembershipRetry,
}: {
  resolvedPremiumAccess: boolean,
  isGuest: boolean,
  accountTier: 'guest' | 'basic' | 'premium',
  showDevPreview: boolean,
  setDevAccountTier: (v: 'guest' | 'basic' | 'premium' | null) => void,
  setActiveView: (v: View) => void,
  setShowSheetOptions: (v: boolean) => void,
  currentLang: string,
  settingsMembershipScrollToken: number,
  favoriteIds: string[],
  recentTrackIds: string[],
  tracks: Track[],
  t: any,
  openAuthModal: (mode: SupabaseAuthModalMode, afterAuth?: 'checkout') => void,
  checkoutBump: number,
  onSignedOut: () => void,
  remoteMembership: RemoteUserMembership | null,
  remoteMembershipLoading: boolean,
  membershipFetchIssue: MembershipFetchIssue,
  onMembershipRetry: () => void,
}) {
  const { session, user, signOut } = useSupabaseAuth();
  const lastCheckoutBumpRef = useRef(0);
  const userId = useMemo(() => {
    if (isGuest || !user?.id) return null;
    return String(user.id);
  }, [isGuest, user?.id]);

  const [portalComingSoonShown, setPortalComingSoonShown] = useState(false);

  React.useEffect(() => {
    setPortalComingSoonShown(false);
  }, [userId]);

  const isRemotePremiumActive = useMemo(
    () => remotePremiumEntitled(remoteMembership),
    [remoteMembership],
  );
  const isRemoteExpired = useMemo(() => {
    const iso = remoteMembership?.premiumUntil;
    if (!iso) return false;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return false;
    return t <= Date.now();
  }, [remoteMembership?.premiumUntil]);

  /** 远程有效期满之外，Dev / URL 门控下的 Premium 也走「已开通」展示 */
  const showMembershipAsActive = isRemotePremiumActive || (resolvedPremiumAccess && !isRemoteExpired);

  /** 与全站门控一致；Account 徽章与 Focus / Player 同源 */
  const effectivePremium = resolvedPremiumAccess;

  const accountPremiumUntilIso = remoteMembership?.premiumUntil ?? null;
  const accountMembershipDaysLeft = daysUntilDate(accountPremiumUntilIso);
  const accountMembershipDateLabel =
    accountPremiumUntilIso && !Number.isNaN(new Date(accountPremiumUntilIso).getTime())
      ? formatMembershipDateOnly(accountPremiumUntilIso, currentLang)
      : '—';
  const accountPaymentProvider = normalizePaymentProvider(remoteMembership?.paymentProvider);
  const accountAutoRenewDisplayText = accountAutoRenewLabel(remoteMembership, {
    membershipAutoRenewOn: t.settings.membershipAutoRenewOn,
    membershipAutoRenewOff: t.settings.membershipAutoRenewOff,
    membershipAutoRenewUnknown: t.settings.membershipAutoRenewUnknown,
  });

  const accountName = isGuest
    ? t.settings.guestTitle
    : user
      ? supabaseUserDisplayName(user)
      : '—';
  const accountEmail = isGuest ? '' : user?.email || '—';
  const links = [
    { label: t.settings.youtube, icon: Youtube, url: 'https://www.youtube.com/@CIPMusic' },
    { label: t.settings.bilibili, icon: Tv, url: 'https://space.bilibili.com/1467634/' },
    { label: t.settings.wechat, icon: MessageCircle, qr: true },
    { label: t.settings.sheetStore, icon: BookOpen, url: 'https://www.mymusic5.com/cipmusic' },
    { label: t.settings.contact, icon: Mail, url: 'mailto:cipmusicstudios@gmail.com' }
  ];
  const tierOptions: { value: 'guest' | 'basic' | 'premium', label: string }[] = [
    { value: 'guest', label: t.settings.guestMode },
    { value: 'basic', label: t.settings.basicMode },
    { value: 'premium', label: t.settings.premiumMode }
  ];
  const infoLabelClass = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-mist-text)]/38';
  const infoValueClass = 'mt-2 text-[15px] font-medium text-[var(--color-mist-text)]/88';
  const actionButtonClass = 'inline-flex h-11 items-center justify-center rounded-2xl px-4 text-sm font-semibold transition-colors';
  const primaryButtonClass = `${actionButtonClass} bg-white/70 text-[var(--color-mist-text)] shadow-sm hover:bg-white/85`;
  const tertiaryButtonClass = 'inline-flex h-10 items-center justify-center rounded-2xl px-3 text-sm font-medium text-[var(--color-mist-text)]/68 transition-colors hover:bg-white/12 hover:text-[var(--color-mist-text)]/84';
  const badgeClass = `inline-flex h-7 items-center rounded-full px-3 text-[11px] font-semibold whitespace-nowrap ${isGuest ? 'bg-white/35 text-[var(--color-mist-text)]/78' : effectivePremium ? 'bg-amber-500/18 text-amber-800/80' : 'bg-white/35 text-[var(--color-mist-text)]/78'}`;
  const accountMembershipRowClass = 'flex items-baseline justify-between gap-3 py-1';
  const accountMembershipLabelClass = 'shrink-0 text-xs leading-snug text-[var(--color-mist-text)]/56';
  const accountMembershipValueClass =
    'min-w-0 max-w-[60%] text-right text-sm font-medium leading-snug text-[var(--color-mist-text)]/88 sm:max-w-[64%]';
  const accountMembershipValueHighlightClass =
    'min-w-0 max-w-[60%] text-right text-sm font-semibold leading-snug text-[var(--color-mist-text)]/92 sm:max-w-[64%]';
  const benefitCards = t.premium.benefits.slice(0, 4);
  const memberCenterTitle = isGuest
    ? currentLang === 'English'
      ? 'Premium Features'
      : currentLang === '繁體中文'
        ? '高級會員權益'
        : '高级会员权益'
    : currentLang === 'English'
      ? 'Membership'
      : t.settings.memberCenter;
  const premiumFeatureLead = currentLang === 'English'
    ? 'Premium only'
    : currentLang === '繁體中文'
      ? '升級解鎖'
      : '升级解锁';
  const guestFreeValue = currentLang === 'English'
    ? 'Free signup includes favorites, recently played, ambience, and Pomodoro.'
    : currentLang === '繁體中文'
      ? '免費註冊即可使用收藏、最近播放、環境音效與番茄鐘。'
      : '免费注册即可使用收藏、最近播放、环境音效与番茄钟。';
  const guestPremiumValue = currentLang === 'English'
    ? 'Premium adds these extra features'
    : currentLang === '繁體中文'
      ? '升級後再解鎖以下高級功能'
      : '升级后再解锁以下高级功能';
  const guestFreeList = currentLang === 'English'
    ? [
        { label: 'Favorites', icon: Heart },
        { label: 'Recently Played', icon: History },
        { label: 'Ambience', icon: AudioLines },
        { label: 'Pomodoro', icon: Timer }
      ]
    : currentLang === '繁體中文'
      ? [
          { label: '收藏', icon: Heart },
          { label: '最近播放', icon: History },
          { label: '環境音效', icon: AudioLines },
          { label: '番茄鐘', icon: Timer }
        ]
      : [
          { label: '收藏', icon: Heart },
          { label: '最近播放', icon: History },
          { label: '环境音效', icon: AudioLines },
          { label: '番茄钟', icon: Timer }
        ];
  const guestFreeLead = currentLang === 'English'
    ? 'Free signup unlocks'
    : currentLang === '繁體中文'
      ? '免費註冊後可使用'
      : '免费注册后可使用';
  const guestPremiumSummary = currentLang === 'English'
    ? 'Beyond free signup, Premium also unlocks'
    : currentLang === '繁體中文'
      ? '除免費註冊權益外，升級後還可解鎖'
      : '除免费注册权益外，升级后还可解锁';
  /** Guest 会员说明两行：统一字号/字重/行高/色值，仅用间距区分层次 */
  const guestMembershipIntroClass =
    'm-0 text-[13px] font-normal leading-relaxed text-[var(--color-mist-text)]/64';
  const manageButtonClass = 'inline-flex h-12 w-full items-center justify-center rounded-2xl bg-white/72 px-6 text-[15px] font-semibold text-[var(--color-mist-text)] shadow-[0_12px_28px_rgba(92,68,44,0.14)] transition-colors hover:bg-white/86';
  const handleGuestAuthCta = () => {
    openAuthModal('sign-in');
  };
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const handleUpgrade = () => {
    if (!session?.user) {
      openAuthModal('sign-in', 'checkout');
      return;
    }
    setCheckoutOpen(true);
  };

  React.useEffect(() => {
    if (checkoutBump > lastCheckoutBumpRef.current) {
      lastCheckoutBumpRef.current = checkoutBump;
      setCheckoutOpen(true);
    }
  }, [checkoutBump]);
  const upgradeModalCopy = t.settings.upgradeModal;

  React.useEffect(() => {
    if (settingsMembershipScrollToken <= 0) return;
    const id = window.setTimeout(() => {
      document.getElementById('settings-membership-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 80);
    return () => window.clearTimeout(id);
  }, [settingsMembershipScrollToken]);

  return (
    <div className="settings-page mx-auto flex w-full max-w-6xl flex-col gap-6 pb-20">
      <MembershipCheckoutModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        copy={upgradeModalCopy}
        closeLabel={t.common.close}
        backLabel={t.common.back}
        userId={userId}
        onRequireLogin={() => openAuthModal('sign-in')}
      />
      {showDevPreview && (
        <div className="glass-tile self-start rounded-full px-2 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-mist-text)]/56">
              {t.settings.devPreview}
            </span>
            <div className="flex rounded-full bg-white/24 p-1">
              {tierOptions.map(option => (
                <button
                  key={option.value}
                  onClick={() => setDevAccountTier(option.value)}
                  className={`min-w-[88px] rounded-full px-4 py-2 text-xs font-semibold transition-colors ${accountTier === option.value ? 'bg-[var(--color-mist-text)] text-[#181411]' : 'text-[var(--color-mist-text)]/72 hover:bg-white/10'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="settings-grid grid grid-cols-1 gap-5 xl:grid-cols-[1.06fr_1.02fr_0.88fr] xl:items-stretch">
        <section
          className={`settings-card ${premiumUi.card} !p-5 flex min-h-0 flex-col sm:!px-6 xl:h-full xl:min-h-[32rem]`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={premiumUi.iconWrap}>
                <User className="h-4.5 w-4.5" />
              </div>
              <h2 className={premiumUi.title}>{isGuest ? t.settings.guestTitle : t.settings.account}</h2>
            </div>
            {!isGuest && (
              <span className={badgeClass}>
                {effectivePremium ? t.settings.premiumMember : t.settings.freeMember}
              </span>
            )}
          </div>

          {isGuest ? (
            <div className="mt-6 flex min-h-0 flex-1 flex-col gap-0">
              <div className={`${premiumUi.subtleCard} px-4 py-4`}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-mist-text)]/42">
                  {guestFreeLead}
                </p>
                <div className="mt-3 grid gap-2">
                  {guestFreeList.map(item => {
                    const Icon = item.icon;
                    return (
                    <div key={item.label} className="settings-guest-item flex items-center gap-3 rounded-2xl border border-white/14 bg-white/10 px-3 py-3">
                      <div className={premiumUi.iconWrap}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="text-sm font-medium text-[var(--color-mist-text)]/82">{item.label}</span>
                    </div>
                  )})}
                </div>
              </div>
              <div className="settings-guest-auth-actions mt-7 flex w-full flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={handleGuestAuthCta}
                  className={`${primaryButtonClass} h-11 w-full max-w-[280px] px-5 text-[14px] font-semibold leading-snug`}
                >
                  {t.settings.guestAuthCta}
                </button>
                <p className="max-w-[300px] text-center text-[11px] font-normal leading-relaxed text-[var(--color-mist-text)]/45">
                  {t.settings.guestAuthCtaHint}
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-1 flex-col gap-2.5">
              <div className={`settings-account-info-card ${premiumUi.subtleCard} flex flex-col gap-2.5 px-4 py-2.5`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={infoLabelClass}>{t.settings.username}</p>
                    <p className="mt-1 text-[15px] font-medium leading-snug text-[var(--color-mist-text)]/88">{accountName}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void signOut().then(() => onSignedOut());
                    }}
                    className="logout-btn mt-0.5 shrink-0 rounded-full border border-white/28 bg-white/18 px-3 py-1.5 text-[11px] font-semibold text-[var(--color-mist-text)]/62 transition-colors hover:bg-white/28 hover:text-[var(--color-mist-text)]/78"
                  >
                    {t.settings.logout}
                  </button>
                </div>
                <div>
                  <p className={infoLabelClass}>{t.settings.email}</p>
                  <p className="mt-1 text-[15px] font-medium leading-snug text-[var(--color-mist-text)]/88">{accountEmail}</p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                {!remoteMembershipLoading && membershipFetchIssue === 'request_failed' ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                    <p className="m-0 flex-1 rounded-lg border border-amber-900/12 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-950/85">
                      {t.settings.membershipRefreshFailedHint}
                    </p>
                    <button
                      type="button"
                      onClick={() => onMembershipRetry()}
                      className={`${tertiaryButtonClass} shrink-0 self-start`}
                    >
                      {t.settings.membershipRetry}
                    </button>
                  </div>
                ) : null}
                <div className={`${premiumUi.subtleCard} settings-account-membership-compact rounded-xl px-4 py-3`}>
                  {remoteMembershipLoading ? (
                    <p className="text-sm leading-snug text-[var(--color-mist-text)]/70">{t.settings.membershipLoading}</p>
                  ) : showMembershipAsActive ? (
                    <>
                      <div className="flex flex-col gap-1">
                        <div className={accountMembershipRowClass}>
                          <span className={accountMembershipLabelClass}>{t.settings.currentPlan}</span>
                          <span className={accountMembershipValueHighlightClass}>{t.settings.premiumPlanName}</span>
                        </div>
                        <div className={accountMembershipRowClass}>
                          <span className={accountMembershipLabelClass}>{t.settings.autoRenew}</span>
                          <span className={accountMembershipValueClass}>{accountAutoRenewDisplayText}</span>
                        </div>
                        <div className={accountMembershipRowClass}>
                          <span className={accountMembershipLabelClass}>{t.settings.membershipEnds}</span>
                          <span className={accountMembershipValueClass}>{accountMembershipDateLabel}</span>
                        </div>
                        <div className={accountMembershipRowClass}>
                          <span className={accountMembershipLabelClass}>{t.settings.accessStatus}</span>
                          <span className={accountMembershipValueHighlightClass}>{t.settings.accessStatusActive}</span>
                        </div>
                      </div>
                      {accountMembershipDaysLeft != null && accountMembershipDaysLeft >= 0 ? (
                        <p className="mt-2 text-xs leading-snug text-[var(--color-mist-text)]/58">
                          {t.settings.membershipDaysRemaining.replace('{n}', String(accountMembershipDaysLeft))}
                        </p>
                      ) : null}
                      {accountMembershipDaysLeft != null && accountMembershipDaysLeft > 0 && accountMembershipDaysLeft <= 7 ? (
                        <p className="mt-1.5 text-xs font-medium leading-snug text-amber-900/82">
                          {t.settings.membershipExpiresInDays.replace('{n}', String(accountMembershipDaysLeft))}
                        </p>
                      ) : null}
                    </>
                  ) : isRemoteExpired ? (
                    <>
                      <p className="mb-2 text-xs leading-snug text-amber-900/85">{t.settings.membershipExpiredNotice}</p>
                      <div className="flex flex-col gap-1">
                        <div className={accountMembershipRowClass}>
                          <span className={accountMembershipLabelClass}>{t.settings.currentPlan}</span>
                          <span className={accountMembershipValueHighlightClass}>{t.settings.freeMember}</span>
                        </div>
                        <div className={accountMembershipRowClass}>
                          <span className={accountMembershipLabelClass}>{t.settings.autoRenew}</span>
                          <span className={accountMembershipValueClass}>{accountAutoRenewDisplayText}</span>
                        </div>
                        <div className={accountMembershipRowClass}>
                          <span className={accountMembershipLabelClass}>{t.settings.membershipEnds}</span>
                          <span className={accountMembershipValueClass}>{t.settings.membershipValidityExpired}</span>
                        </div>
                        <div className={accountMembershipRowClass}>
                          <span className={accountMembershipLabelClass}>{t.settings.accessStatus}</span>
                          <span className={accountMembershipValueHighlightClass}>{t.settings.accessStatusExpired}</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <div className={accountMembershipRowClass}>
                        <span className={accountMembershipLabelClass}>{t.settings.currentPlan}</span>
                        <span className={accountMembershipValueHighlightClass}>{t.settings.freeMember}</span>
                      </div>
                      <div className={accountMembershipRowClass}>
                        <span className={accountMembershipLabelClass}>{t.settings.autoRenew}</span>
                        <span className={accountMembershipValueClass}>{accountAutoRenewDisplayText}</span>
                      </div>
                      <div className={accountMembershipRowClass}>
                        <span className={accountMembershipLabelClass}>{t.settings.membershipEnds}</span>
                        <span className={accountMembershipValueClass}>{t.settings.membershipValidityDash}</span>
                      </div>
                      <div className={accountMembershipRowClass}>
                        <span className={accountMembershipLabelClass}>{t.settings.accessStatus}</span>
                        <span className={accountMembershipValueHighlightClass}>{t.settings.accessStatusNotActivated}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-2">
                <SettingsAccountLibraryBlock
                  favoriteIds={favoriteIds}
                  recentTrackIds={recentTrackIds}
                  tracks={tracks}
                  currentLang={currentLang}
                  t={t}
                />
              </div>
            </div>
          )}
        </section>

        <section
          id="settings-membership-section"
          className={`settings-card ${premiumUi.card} !p-5 scroll-mt-28 flex min-h-0 flex-col sm:!px-6 xl:h-full xl:min-h-[32rem]`}
        >
          <div className="flex items-center gap-3">
            <div className={premiumUi.iconWrap}>
              <Sparkles className="h-4.5 w-4.5" />
            </div>
            <h2 className={premiumUi.title}>{memberCenterTitle}</h2>
          </div>

          <div className="mt-2.5 flex min-h-0 flex-1 flex-col gap-4">
            {isGuest ? (
              <>
                <div className="flex flex-col gap-2">
                  <p className={guestMembershipIntroClass}>{t.settings.membershipGuestHint}</p>
                  <p className={guestMembershipIntroClass}>{guestPremiumSummary}</p>
                </div>
                <div className="settings-premium-benefits flex min-h-0 flex-col gap-4">
                  {benefitCards.map((benefit: any) => (
                    <div key={benefit.title} className={`${premiumUi.subtleCard} flex items-start gap-3.5 px-4 py-3`}>
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-white/14 bg-white/14 text-[var(--color-mist-text)]/60">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div className="flex min-w-0 flex-col gap-[1px] pt-[2px]">
                        <p className="m-0 text-[14px] font-[650] leading-tight text-[var(--color-mist-text)]/90">{benefit.title}</p>
                        <p className="m-0 text-[13px] font-normal leading-tight text-[var(--color-mist-text)]/65">{benefit.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-mist-text)]/42 leading-snug">
                  {premiumFeatureLead}
                </p>
                <div className="settings-premium-benefits flex min-h-0 flex-col gap-4">
                  {benefitCards.map((benefit: any) => (
                    <div key={benefit.title} className={`${premiumUi.subtleCard} flex items-start gap-3.5 px-4 py-3`}>
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-white/14 bg-white/14 text-[var(--color-mist-text)]/60">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div className="flex min-w-0 flex-col gap-[1px] pt-[2px]">
                        <p className="m-0 text-[14px] font-[650] leading-tight text-[var(--color-mist-text)]/90">{benefit.title}</p>
                        <p className="m-0 text-[13px] font-normal leading-tight text-[var(--color-mist-text)]/65">{benefit.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 shrink-0 pt-0.5">
                  {remoteMembershipLoading ? (
                    <p className="text-center text-[12px] leading-snug text-[var(--color-mist-text)]/58">
                      {t.settings.membershipLoading}
                    </p>
                  ) : showMembershipAsActive ? (
                    accountPaymentProvider === 'stripe' ? (
                      <>
                        <button type="button" onClick={() => setPortalComingSoonShown(true)} className={manageButtonClass}>
                          {t.settings.manageMembership}
                        </button>
                        {portalComingSoonShown ? (
                          <p className="mt-2 text-center text-[12px] leading-snug text-[var(--color-mist-text)]/62">
                            {t.settings.subscriptionPortalComingSoon}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <button type="button" onClick={handleUpgrade} className={premiumUi.upgradeButton}>
                        {t.settings.renewMembership}
                      </button>
                    )
                  ) : (
                    <button type="button" onClick={handleUpgrade} className={premiumUi.upgradeButton}>
                      {t.settings.upgradeNow}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        <section className={`settings-card ${premiumUi.card} !p-5 flex min-h-0 flex-col sm:!px-6 xl:h-full xl:min-h-[32rem]`}>
          <div className="flex items-center gap-3">
            <div className={premiumUi.iconWrap}>
              <ExternalLink className="h-4.5 w-4.5" />
            </div>
            <h2 className={premiumUi.title}>{t.settings.links}</h2>
          </div>

          <div className="mt-6 flex min-h-0 flex-1 flex-col gap-4">
            {links.map(link => {
              const Icon = link.icon;
              return (
                <button
                  key={link.label}
                  onClick={() => link.qr ? setShowSheetOptions(true) : window.open(link.url!, '_blank')}
                  className={`${premiumUi.subtleCard} flex items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-white/18`}
                >
                  <div className="flex items-center gap-3">
                    <div className={premiumUi.iconWrap}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="min-w-0 break-words text-sm font-medium leading-snug text-[var(--color-mist-text)]/84">{link.label}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[var(--color-mist-text)]/42" />
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
});

function AdminTab({ tracks, setTracks, artistsData, setArtistsData }: { tracks: Track[], setTracks: React.Dispatch<React.SetStateAction<Track[]>>, artistsData: any[], setArtistsData: React.Dispatch<React.SetStateAction<any[]>> }) {
  const [adminView, setAdminView] = useState<'songs' | 'artists'>('songs');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // songs state
  const [fetchingIds, setFetchingIds] = useState<Record<string, boolean>>({});
  const [isAdopting, setIsAdopting] = useState<Record<string, boolean>>({});

  // artists state
  const [expandedArtistId, setExpandedArtistId] = useState<string | null>(null);
  const [fetchingArtistIds, setFetchingArtistIds] = useState<Record<string, boolean>>({});
  const [isAdoptingArtist, setIsAdoptingArtist] = useState<Record<string, boolean>>({});

  // Artist Actions
  const handleFetchSpotifyArtist = async (artist: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setFetchingArtistIds(prev => ({ ...prev, [artist.name]: true }));

    try {
      const { data: candidates, error } = await supabase.functions.invoke('fetch-spotify-artist', {
        body: { artistName: artist.name }
      });
      if (error) throw error;

      // 注意：这一步完全只是保存在前端本地状态！
      setArtistsData(prev => prev.map(a => a.name === artist.name ? {
        ...a,
        metadata_status: 'needs_review',
        metadata_candidates: candidates || []
      } : a));

      setExpandedArtistId(artist.name);
    } catch (err: any) {
      console.error("Failed to fetch Spotify", err);
      alert("Failed to fetch Spotify: " + err.message);
    } finally {
      setFetchingArtistIds(prev => ({ ...prev, [artist.name]: false }));
    }
  };

  const handleAdoptSpotifyArtist = async (artist: any, cand: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsAdoptingArtist(prev => ({ ...prev, [artist.name]: true }));

    try {
      const updates = {
        source_artist_name: cand.name,
        source_artist_image_url: cand.imageUrl,
        source_genres: cand.genres,
        metadata_status: 'approved',
        metadata_source: cand.source,
        metadata_confidence: cand.confidence
      };

      const { data, error } = await supabase.from('artists').update(updates).eq('name', artist.name).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Update blocked by RLS (0 rows updated). 临时策略还没生效！");

      // 更新本地状态引发重绘
      setArtistsData(prev => prev.map(a => a.name === artist.name ? {
        ...a,
        ...updates
      } : a));

      setExpandedArtistId(null);
    } catch (err: any) {
      console.error("Adoption failed", err);
      alert("Adopt Artist failed: " + err.message);
    } finally {
      setIsAdoptingArtist(prev => ({ ...prev, [artist.name]: false }));
    }
  };

  const handleAdoptMatch = async (track: Track, cand: MetadataCandidate, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsAdopting(prev => ({ ...prev, [track.id]: true }));

    try {
      const updates = {
        source_song_title: cand.title,
        source_artist: cand.artist,
        source_cover_url: cand.coverUrl,
        source_album: cand.album || null,
        source_release_year: cand.releaseYear || null,
        source_category: cand.category || null,
        source_genre: cand.category || null,
        metadata_source: cand.source,
        metadata_confidence: cand.confidence,
        metadata_status: 'approved'
      };

      const { data, error } = await supabase.from('songs').update(updates).eq('id', track.id).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Update blocked by RLS (0 rows updated).");

      setTracks(prev => prev.map(t => t.id === track.id ? {
        ...t,
        sourceSongTitle: updates.source_song_title,
        sourceArtist: updates.source_artist,
        sourceCoverUrl: updates.source_cover_url,
        sourceAlbum: updates.source_album,
        sourceReleaseYear: updates.source_release_year,
        sourceCategory: updates.source_category,
        sourceGenre: updates.source_genre,
        metadataSource: updates.metadata_source,
        metadataConfidence: updates.metadata_confidence,
        metadataStatus: 'approved' as any
      } : t));

      setExpandedId(null);

    } catch (err) {
      console.error("Adoption failed", err);
    } finally {
      setIsAdopting(prev => ({ ...prev, [track.id]: false }));
    }
  };

  const handleFetchMetadata = async (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    setFetchingIds(prev => ({ ...prev, [track.id]: true }));

    try {
      // 1. 搜索关键词：title + artist
      const searchTerm = encodeURIComponent(track.title + ' ' + (track.artist || ''));
      const res = await fetch(`https://itunes.apple.com/search?term=${searchTerm}&entity=song&limit=3`);
      const data = await res.json();

      let candidates = [];
      let newStatus = 'needs_review';

      if (data.results && data.results.length > 0) {
        // 2. 取前三补充到 candidates 格式
        candidates = data.results.map((r: any, idx: number) => ({
          title: r.trackName,
          artist: r.artistName,
          coverUrl: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '600x600bb') : '',
          album: r.collectionName,
          releaseYear: r.releaseDate ? r.releaseDate.substring(0, 4) : undefined,
          category: r.primaryGenreName,
          source: 'itunes',
          confidence: idx === 0 ? 0.95 : (idx === 1 ? 0.85 : 0.75) // 第一版简单排序置信度
        }));
      } else {
        // 3. 处理无结果情况
        candidates = [];
        newStatus = 'manual';
      }

      // 4. 写回数据库，补充 source = 'itunes'
      const { data: updateData, error } = await supabase.from('songs').update({
        metadata_status: newStatus,
        metadata_source: 'itunes',
        metadata_candidates: candidates
      }).eq('id', track.id).select();

      if (error) throw error;
      if (!updateData || updateData.length === 0) throw new Error("RLS blocked candidate saving.");

      // 5. 刷新前台本地数据，引发重绘
      setTracks(prev => prev.map(t => t.id === track.id ? {
        ...t,
        metadataStatus: newStatus as any,
        metadataCandidates: candidates
      } : t));

      setExpandedId(track.id);

    } catch (err) {
      console.error("Failed to fetch itunes data", err);
    } finally {
      setFetchingIds(prev => ({ ...prev, [track.id]: false }));
    }
  };

  const safeTracks = Array.isArray(tracks) ? tracks : [];
  const [adminSongLimit, setAdminSongLimit] = useState(40);
  const [adminArtistLimit, setAdminArtistLimit] = useState(40);

  const adminTracksSlice = useMemo(() => safeTracks.slice(0, adminSongLimit), [safeTracks, adminSongLimit]);
  const artistsListSafe = Array.isArray(artistsData) ? artistsData : [];
  const adminArtistsSlice = useMemo(() => artistsListSafe.slice(0, adminArtistLimit), [artistsListSafe, adminArtistLimit]);

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col animate-in fade-in duration-500 pb-20">
      <div className="glass-panel-static p-8 rounded-[32px]">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-3xl font-medium tracking-wide text-[var(--color-mist-text)]">Metadata Diagnostics</h2>
          <div className="flex bg-black/20 rounded-full p-1 border border-white/5">
            <button
              onClick={() => setAdminView('songs')}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${adminView === 'songs' ? 'bg-indigo-500/20 text-indigo-300 shadow-sm' : 'text-white/40 hover:text-white/80'}`}
            >
              Songs
            </button>
            <button
              onClick={() => setAdminView('artists')}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${adminView === 'artists' ? 'bg-emerald-500/20 text-emerald-300 shadow-sm' : 'text-white/40 hover:text-white/80'}`}
            >
              Artists
            </button>
          </div>
        </div>

        {adminView === 'songs' ? (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-[var(--color-mist-text)]/50">
              Showing {adminTracksSlice.length} / {safeTracks.length} songs (load more to reduce initial render cost)
            </p>
            {adminTracksSlice.map(track => (
              <div key={track.id} className="glass-utility p-5 rounded-2xl flex flex-col gap-4 border border-white/10 transition-all hover:bg-white/5">
                <div
                  className="flex items-center justify-between cursor-pointer group"
                  onClick={() => setExpandedId(expandedId === track.id ? null : track.id)}
                >
                  <div className="flex items-center gap-5">
                    <span className="font-bold text-lg drop-shadow-sm">{track.title}</span>
                    <span className={`text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider ${track.metadataStatus === 'approved' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                      track.metadataStatus === 'needs_review' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                        track.metadataStatus === 'manual' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' :
                          'bg-white/10 text-[var(--color-mist-text)]/60'
                      }`}>
                      {track.metadataStatus || 'pending'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={(e) => handleFetchMetadata(track, e)}
                      disabled={fetchingIds[track.id]}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 transition-colors text-xs font-medium mr-2 border border-indigo-500/30 z-10"
                    >
                      <Search className={`w-3.5 h-3.5 ${fetchingIds[track.id] ? 'animate-pulse opacity-50' : ''}`} />
                      {fetchingIds[track.id] ? 'Fetching...' : 'Fetch iTunes'}
                    </button>
                    <span className="text-xs text-[var(--color-mist-text)]/40 group-hover:text-[var(--color-mist-text)]/90 transition-colors tracking-wide">
                      {expandedId === track.id ? 'Collapse Metadata' : 'Inspect Details'}
                    </span>
                    {expandedId === track.id ? <ChevronLeft className="w-4 h-4 -rotate-90 opacity-50" /> : <ChevronRight className="w-4 h-4 opacity-50" />}
                  </div>
                </div>

                {expandedId === track.id && (
                  <div className="pt-6 border-t border-white/10 mt-2 animate-in slide-in-from-top-2 duration-400">
                    {(!track.metadataCandidates || !Array.isArray(track.metadataCandidates) || track.metadataCandidates.length === 0) ? (
                      <div className="py-12 w-full flex items-center justify-center bg-black/10 rounded-xl border border-white/5 border-dashed">
                        <p className="text-sm text-[var(--color-mist-text)]/40 italic flex items-center gap-2 font-medium">
                          <Search className="w-4 h-4 opacity-50" />
                          No candidates fetched yet (or no results matched).
                        </p>
                      </div>
                    ) : (
                      <div className="flex overflow-x-auto gap-5 pb-4 custom-scrollbar items-start">
                        {track.metadataCandidates.map((cand, idx) => (
                          <div key={idx} className="w-[240px] flex-shrink-0 glass-tile p-4 rounded-xl flex flex-col gap-3 group relative overflow-hidden">
                            <img src={cand.coverUrl} alt="Cover" loading="lazy" decoding="async" className="w-full aspect-square object-cover rounded-[10px] shadow-lg bg-black/20" />
                            <div className="flex flex-col gap-1 mt-1">
                              <span className="font-bold text-[13px] leading-tight line-clamp-1">{cand.title}</span>
                              <span className="text-[11px] text-[var(--color-mist-text)]/70 line-clamp-1">{cand.artist}</span>
                            </div>
                            <div className="flex flex-col gap-1.5 text-[10px] bg-black/20 p-3 rounded-lg border border-white/5 font-mono mt-1">
                              <div className="flex flex-wrap justify-between gap-1 items-center">
                                <span className="opacity-50">Src:</span>
                                <span className="text-amber-500 font-bold px-1.5 py-0.5 bg-amber-500/10 rounded text-[9px] uppercase">{cand.source}</span>
                              </div>
                              <div className="flex justify-between items-center mt-0.5">
                                <span className="opacity-50">Conf:</span>
                                <span className={`font-bold ${cand.confidence > 0.8 ? 'text-emerald-400' : 'text-amber-400'}`}>{(cand.confidence * 100).toFixed(0)}%</span>
                              </div>
                              {cand.album && <div className="flex justify-between mt-0.5"><span className="opacity-50">Alb:</span> <span className="line-clamp-1 max-w-[120px] text-right ml-2">{cand.album}</span></div>}
                            </div>
                            <button
                              onClick={(e) => handleAdoptMatch(track, cand, e)}
                              disabled={isAdopting[track.id]}
                              className="mt-2 text-[10px] w-full py-1.5 rounded bg-emerald-500/20 text-emerald-400 font-bold uppercase tracking-wider transition-colors hover:bg-emerald-500/30 border border-emerald-500/20 disabled:opacity-50"
                            >
                              {isAdopting[track.id] ? 'Saving...' : '✔ Adopt Match'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {safeTracks.length > adminTracksSlice.length ? (
              <button
                type="button"
                onClick={() => setAdminSongLimit(n => n + 40)}
                className="py-3 rounded-xl bg-indigo-500/15 text-indigo-200 text-sm font-medium border border-indigo-500/30 hover:bg-indigo-500/25"
              >
                Load more songs ({safeTracks.length - adminTracksSlice.length} remaining)
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-[var(--color-mist-text)]/50">
              Showing {adminArtistsSlice.length} / {artistsListSafe.length} artists
            </p>
            {adminArtistsSlice.map(artist => (
              <div key={artist.name} className="glass-utility p-5 rounded-2xl flex flex-col gap-4 border border-white/10 transition-all hover:bg-white/5">
                <div
                  className="flex items-center justify-between cursor-pointer group"
                  onClick={() => setExpandedArtistId(expandedArtistId === artist.name ? null : artist.name)}
                >
                  <div className="flex items-center gap-5">
                    <img
                      src={artist.source_artist_image_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(artist.name) + '&background=random&color=fff&size=50'}
                      alt={artist.name}
                      loading="lazy"
                      decoding="async"
                      className="w-10 h-10 rounded-full border border-white/20 object-cover"
                    />
                    <span className="font-bold text-lg drop-shadow-sm">{artist.name}</span>
                    <span className={`text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider ${artist.metadata_status === 'approved' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                      artist.metadata_status === 'needs_review' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                        'bg-white/10 text-[var(--color-mist-text)]/60'
                      }`}>
                      {artist.metadata_status || 'pending'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={(e) => handleFetchSpotifyArtist(artist, e)}
                      disabled={fetchingArtistIds[artist.name]}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors text-xs font-medium mr-2 border border-emerald-500/30 z-10"
                    >
                      <Search className={`w-3.5 h-3.5 ${fetchingArtistIds[artist.name] ? 'animate-pulse opacity-50' : ''}`} />
                      {fetchingArtistIds[artist.name] ? 'Fetching...' : 'Fetch Spotify'}
                    </button>
                    {expandedArtistId === artist.name ? <ChevronLeft className="w-4 h-4 -rotate-90 opacity-50" /> : <ChevronRight className="w-4 h-4 opacity-50" />}
                  </div>
                </div>

                {expandedArtistId === artist.name && (
                  <div className="pt-6 border-t border-white/10 mt-2 animate-in slide-in-from-top-2 duration-400">
                    {(!artist.metadata_candidates || !Array.isArray(artist.metadata_candidates) || artist.metadata_candidates.length === 0) ? (
                      <div className="py-12 w-full flex items-center justify-center bg-black/10 rounded-xl border border-white/5 border-dashed">
                        <p className="text-sm text-[var(--color-mist-text)]/40 italic flex items-center gap-2 font-medium">
                          <Search className="w-4 h-4 opacity-50" />
                          No Spotify candidates fetched yet.
                        </p>
                      </div>
                    ) : (
                      <div className="flex overflow-x-auto gap-5 pb-4 custom-scrollbar items-start">
                        {artist.metadata_candidates.map((cand: any, idx: number) => (
                          <div key={idx} className="w-[200px] flex-shrink-0 glass-tile p-4 rounded-xl flex flex-col gap-3 group relative overflow-hidden">
                            <img src={cand.imageUrl || 'https://ui-avatars.com/api/?name=No+Image'} alt="Artist" loading="lazy" decoding="async" className="w-full aspect-square object-cover rounded-full shadow-lg bg-black/20" />
                            <div className="flex flex-col gap-1 mt-1 text-center">
                              <span className="font-bold text-[14px] leading-tight line-clamp-1">{cand.name}</span>
                              <span className="text-[10px] text-[var(--color-mist-text)]/70 line-clamp-1 uppercase tracking-wide">
                                {(cand.genres || []).slice(0, 2).join(' • ')}
                              </span>
                            </div>
                            <div className="flex justify-between items-center text-[10px] bg-black/20 px-3 py-2 rounded-lg border border-white/5 font-mono mt-1">
                              <span className="text-emerald-500 font-bold uppercase">{cand.source}</span>
                              <span className={`font-bold ${cand.confidence > 0.8 ? 'text-emerald-400' : 'text-amber-400'}`}>{(cand.confidence * 100).toFixed(0)}%</span>
                            </div>
                            <button
                              onClick={(e) => handleAdoptSpotifyArtist(artist, cand, e)}
                              disabled={isAdoptingArtist[artist.name]}
                              className="mt-2 text-[10px] w-full py-2 rounded bg-emerald-500/20 text-emerald-400 font-bold uppercase tracking-wider transition-colors hover:bg-emerald-500/30 border border-emerald-500/20 disabled:opacity-50"
                            >
                              {isAdoptingArtist[artist.name] ? 'Saving...' : '✔ Adopt Artist'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {artistsListSafe.length > adminArtistsSlice.length ? (
              <button
                type="button"
                onClick={() => setAdminArtistLimit(n => n + 40)}
                className="py-3 rounded-xl bg-emerald-500/15 text-emerald-200 text-sm font-medium border border-emerald-500/30 hover:bg-emerald-500/25"
              >
                Load more artists ({artistsListSafe.length - adminArtistsSlice.length} remaining)
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
