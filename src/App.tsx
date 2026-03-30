/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, Volume1, VolumeX,
  Search, Settings, Music, CloudRain, CloudLightning, Clock,
  User, Repeat, Shuffle, ChevronLeft, ChevronRight,
  Lock, Moon, Flame, Waves, Wind, MoonStar,
  TreePine, AudioLines, Coffee, BookOpen, Youtube, Brain,
  Piano, X, Activity, AlarmClock, Timer, Globe, ExternalLink, MessageCircle, Tv,
  Mail, Radio, Sparkles, Smartphone, TreeDeciduous, Library,
  Heart, History
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { Midi } from '@tonejs/midi';
import { en } from './locales/en';
import { zhCN } from './locales/zh-cn';
import { zhTW } from './locales/zh-tw';

const translations: Record<string, any> = {
  'English': en,
  '简体中文': zhCN,
  '繁體中文': zhTW
};

type View = 'home' | 'music' | 'focus' | 'settings' | 'admin';

export type MetadataCandidate = {
  title: string;
  artist: string;
  coverUrl: string;
  album?: string;
  releaseYear?: string;
  category?: string;
  source: string;
  confidence: number;
};

export type Track = {
  id: string;
  title: string;
  artist: string;
  category: string;
  tags?: string[];
  duration: string;
  audioUrl: string;
  coverUrl: string;
  youtubeUrl?: string;
  bilibiliUrl?: string;
  sheetUrl?: string;
  midiUrl?: string;
  musicxmlUrl?: string;
  metadataStatus?: 'pending' | 'needs_review' | 'approved' | 'manual';
  sourceSongTitle?: string;
  sourceArtist?: string;
  sourceCoverUrl?: string;
  sourceAlbum?: string;
  sourceReleaseYear?: string;
  sourceCategory?: string;
  sourceGenre?: string;
  metadataSource?: string;
  metadataConfidence?: number;
  metadataCandidates?: MetadataCandidate[];
};

const defaultTrack: Track = {
  id: 'golden_piano',
  title: 'Golden Piano',
  artist: 'HUNTR/X',
  category: 'K-pop',
  tags: ['Film'],
  duration: '03:12',
  audioUrl: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/music/Golden-piano.mp3',
  coverUrl: 'https://picsum.photos/seed/golden/100/100',
  youtubeUrl: 'https://www.youtube.com/watch?v=Z_00MYjo0-Q',
  sheetUrl: 'https://www.mymusic5.com/cipmusic/309097',
  midiUrl: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/midi/golden-piano.midi'
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

function BackgroundLayer({ scene }: { scene: Scene }) {
  const [videoError, setVideoError] = useState(false);

  React.useEffect(() => {
    setVideoError(false);
  }, [scene.url]);

  const style: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    width: '100vw',
    height: '100vh',
    objectFit: 'cover',
    zIndex: -1,
    pointerEvents: 'none'
  };

  if (scene.type === 'image' || videoError) {
    return (
      <img
        key={scene.url}
        src={scene.url}
        alt={scene.name}
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        style={style}
      />
    );
  }

  return (
    <video
      key={scene.url}
      src={scene.url}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      poster={scene.thumbnail}
      onError={() => setVideoError(true)}
      style={style}
    />
  );
}
export default function App() {
  const [activeView, setActiveView] = useState<View>('home');


  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track>(defaultTrack);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoadingTracks, setIsLoadingTracks] = useState(true);
  const [artistsData, setArtistsData] = useState<any[]>([]);
  const [currentLang, setCurrentLang] = useState('English');
  const t = translations[currentLang] || en;
  const [showSheetOptions, setShowSheetOptions] = useState(false);

  useEffect(() => {
    async function fetchArtists() {
      const { data, error } = await supabase.from('artists').select('*');
      if (!error && data) {
        setArtistsData(data);
      }
    }
    fetchArtists();
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
          liveTrack.sourceArtist !== currentTrack.sourceArtist)
      ) {
        setCurrentTrack(liveTrack);
      }
    }
  }, [tracks, currentTrack]);

  useEffect(() => {
    async function fetchSongs() {
      const { data, error } = await supabase.from('songs').select('*');
      if (error) {
        console.error('Error fetching songs:', error);
        return;
      }

      const formattedTracks = (data || []).map(song => ({
        id: song.id,
        title: song.title,
        artist: song.artist,
        category: song.primary_category || 'Originals',
        tags: song.secondary_category || [],
        duration: song.duration || '00:00',
        audioUrl: song.audio_url,
        coverUrl: song.cover_url || '',
        musicxmlUrl: song.musicxml_url,
        midiUrl: song.midi_url,
        youtubeUrl: song.youtube_url,
        bilibiliUrl: song.bilibili_url,
        sheetUrl: song.sheet_url,
        sourceSongTitle: song.source_song_title,
        sourceArtist: song.source_artist,
        sourceCoverUrl: song.source_cover_url,
        sourceAlbum: song.source_album,
        sourceReleaseYear: song.source_release_year,
        sourceCategory: song.source_category,
        sourceGenre: song.source_genre,
        metadataSource: song.metadata_source,
        metadataConfidence: song.metadata_confidence,
        metadataStatus: song.metadata_status || 'pending',
        metadataCandidates: song.metadata_candidates || [],
      }));

      setTracks(formattedTracks);
      // 数据加载后，尝试将 Golden Piano 设为默认曲目
      if (formattedTracks.length > 0) {
        const defaultSong = formattedTracks.find(t => t.title === 'Golden Piano') || formattedTracks[0];
        setCurrentTrack(defaultSong);
      }
      setIsLoadingTracks(false);
    }

    fetchSongs();
  }, []);
  const [activeSceneId, setActiveSceneId] = useState<string>('tideHaven');
  const [showPracticePanel, setShowPracticePanel] = useState(false);
  const isLocalPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname) || window.location.hostname.startsWith('192.168.');
  const showDevTierPreview = import.meta.env.DEV || isLocalPreview;
  // DEV: pass ?premium=1 in URL to test premium behaviour without a real auth system
  const [isPremium, setIsPremium] = useState(() =>
    new URLSearchParams(window.location.search).get('premium') === '1'
  );
  const [devAccountTier, setDevAccountTier] = useState<'guest' | 'basic' | 'premium' | null>(null);
  const [showGuestFeaturePrompt, setShowGuestFeaturePrompt] = useState(false);
  const accountTier = devAccountTier ?? (isPremium ? 'premium' : 'basic');
  const isGuest = accountTier === 'guest';
  const hasPremiumAccess = accountTier === 'premium';

  // ── Global Ambient Engine (survives page navigation) ───────────────
  const AMBIENT_AUDIO_URLS: Record<string, string> = {
    window_rain: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/windowrain.mp3',
    thunderstorm: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/thunderstorm.mp3',
    ocean: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/ocean.mp3',
    forest: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/forest.mp3',
    white_noise: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/white%20noise.mp3',
    night_ambient: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/night.mp3',
    library: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/library.mp3',
    fireplace: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/fireplace.mp3',
    cafe: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/cafe.mp3',
  };
  const AMBIENT_LIMIT_FREE = 1;
  const AMBIENT_LIMIT_PREMIUM = 3;

  const [activeAmbiences, setActiveAmbiences] = useState<string[]>([]);
  const [ambienceVolumes, setAmbienceVolumes] = useState<Record<string, number>>({
    window_rain: 50, thunderstorm: 50, ocean: 50, forest: 50,
    white_noise: 50, night_ambient: 50, library: 50, fireplace: 50, cafe: 50,
  });
  const [ambienceToast, setAmbienceToast] = useState<string | null>(null);
  const ambienceAudioRefs = React.useRef<Record<string, HTMLAudioElement>>({});
  const toastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const showAmbienceToast = (msg: string) => {
    setAmbienceToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setAmbienceToast(null), 3500);
  };

  const toggleAmbience = (id: string) => {
    if (isGuest) {
      setShowGuestFeaturePrompt(true);
      return;
    }
    const limit = hasPremiumAccess ? AMBIENT_LIMIT_PREMIUM : AMBIENT_LIMIT_FREE;
    if (activeAmbiences.includes(id)) {
      setActiveAmbiences(prev => prev.filter(a => a !== id));
    } else {
      if (activeAmbiences.length >= limit) {
        if (hasPremiumAccess) {
          showAmbienceToast(`Max ${AMBIENT_LIMIT_PREMIUM} ambiences reached for Premium members`);
        } else {
          showAmbienceToast(t.common.ambienceLimit);
        }
        return; // do NOT replace, just block + notify
      }
      setActiveAmbiences(prev => [...prev, id]);
    }
  };

  // Sync all audio elements whenever active set or volumes change
  useEffect(() => {
    Object.entries(AMBIENT_AUDIO_URLS).forEach(([id, url]) => {
      const isActive = activeAmbiences.includes(id);
      if (!ambienceAudioRefs.current[id]) {
        const audio = new Audio(url);
        audio.loop = true;
        audio.preload = 'none';
        ambienceAudioRefs.current[id] = audio;
      }
      const audio = ambienceAudioRefs.current[id];
      audio.volume = (ambienceVolumes[id] ?? 50) / 100;
      if (isActive) {
        if (audio.paused) audio.play().catch(() => { });
      } else {
        if (!audio.paused) { audio.pause(); audio.currentTime = 0; }
      }
    });
  }, [activeAmbiences, ambienceVolumes]);

  // Cleanup on full app unmount only
  useEffect(() => {
    return () => {
      (Object.values(ambienceAudioRefs.current) as HTMLAudioElement[]).forEach(a => { a.pause(); a.src = ''; });
    };
  }, []);
  // ── End Ambient Engine ────────────────────────────────────────────

  // Lifted playback state
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  // Auto-close Practice Mode when navigating away
  useEffect(() => {
    setShowPracticePanel(false);
  }, [activeView]);

  const activeScene = SCENES.find(s => s.id === activeSceneId) || SCENES[0];

  // Click-outside-main-panel → go Home
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeView === 'home') return;
    // Only trigger if the click target is the backdrop itself (not a child)
    if (e.target === e.currentTarget) setActiveView('home');
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center relative text-[var(--color-mist-text)]"
      onClick={handleBackdropClick}
    >
      <BackgroundLayer scene={activeScene} />

      <TopNav
        activeView={activeView}
        setActiveView={setActiveView}
        tracks={tracks}
        currentLang={currentLang}
        setCurrentLang={setCurrentLang}
        t={t}
        onSelectTrack={(t) => {
          setCurrentTrack(t);
          setIsPlaying(true);
          setActiveView('home');
        }}
      />

      <main
        className="flex-1 w-full max-w-6xl mx-auto px-6 pt-32 pb-32 z-10 relative"
        onClick={e => e.stopPropagation()}
      >
        {activeView === 'home' && (
          <HomeTab
            t={t}
          />
        )}
        {activeView === 'music' && (
          <MusicTab
            tracks={tracks}
            artistsData={artistsData}
            currentTrack={currentTrack}
            setCurrentTrack={setCurrentTrack}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            t={t}
            currentLang={currentLang}
          />
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
            isPremium={hasPremiumAccess}
            isGuest={isGuest}
            onGuestFeatureBlocked={() => setShowGuestFeaturePrompt(true)}
            showAmbienceToast={showAmbienceToast}
            t={t}
          />
        )}
        {activeView === 'settings' && (
          <SettingsTab
            isPremium={hasPremiumAccess}
            setIsPremium={setIsPremium}
            isGuest={isGuest}
            accountTier={accountTier}
            showDevPreview={showDevTierPreview}
            setDevAccountTier={setDevAccountTier}
            setActiveView={setActiveView}
            setShowSheetOptions={setShowSheetOptions}
            currentLang={currentLang}
            t={t}
          />
        )}
        {activeView === 'admin' && <AdminTab tracks={tracks} setTracks={setTracks} artistsData={artistsData} setArtistsData={setArtistsData} />}
        {/* ── WeChat QR Modal (Pure Supplemental Entry) ── */}
        <AnimatePresence>
          {showSheetOptions && (
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-6">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowSheetOptions(false)}
                className="absolute inset-0 bg-black/40 backdrop-blur-md"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="relative glass-panel p-10 max-w-sm w-full bg-white/10 border-white/20 shadow-2xl flex flex-col items-center gap-6"
              >
                <div className="flex flex-col items-center text-center gap-2">
                  <h3 className="text-xl font-bold text-white tracking-tight">
                    {t.settings.wechatQrTitle}
                  </h3>
                  <p className="text-xs text-white/50 leading-relaxed font-medium">
                    {t.settings.wechatQrDesc}
                  </p>
                </div>

                <div className="relative p-2 bg-white rounded-2xl shadow-xl transition-transform hover:scale-[1.02] duration-500 overflow-hidden">
                  <img
                    src="https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/pics/gzh.jpg"
                    alt=""
                    className="w-48 h-48 object-contain"
                  />
                </div>

                <button
                  onClick={() => setShowSheetOptions(false)}
                  className="mt-2 py-2.5 px-8 rounded-full bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-widest text-white/80 transition-all border border-white/10"
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
              className="absolute inset-0 bg-[rgba(245,236,226,0.38)] backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="relative w-full max-w-md rounded-[32px] border border-white/40 bg-[rgba(255,250,245,0.72)] px-8 py-8 shadow-[0_24px_60px_rgba(92,68,44,0.18)] backdrop-blur-xl"
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
                    onClick={() => setShowGuestFeaturePrompt(false)}
                    className="flex-1 rounded-2xl bg-white/82 px-5 py-3 text-sm font-semibold text-[var(--color-mist-text)] shadow-sm transition-colors hover:bg-white"
                  >
                    {t.common.signUp}
                  </button>
                  <button
                    onClick={() => setShowGuestFeaturePrompt(false)}
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

      {showPracticePanel && (
        <PracticePanel
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          playbackRate={playbackRate}
          setPlaybackRate={setPlaybackRate}
          onClose={() => setShowPracticePanel(false)}
          isPremium={isPremium}
          setActiveView={setActiveView}
          t={t}
        />
      )}

      <BottomPlayer
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        currentTime={currentTime}
        setCurrentTime={setCurrentTime}
        duration={duration}
        setDuration={setDuration}
        playbackRate={playbackRate}
        setPlaybackRate={setPlaybackRate}
        showPracticePanel={showPracticePanel}
        setShowPracticePanel={setShowPracticePanel}
        isPremium={isPremium}
        currentLang={currentLang}
        setShowSheetOptions={setShowSheetOptions}
        t={t}
      />
      {ambienceToast && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-2xl bg-black/70 backdrop-blur-md border border-white/15 text-white text-sm font-medium shadow-xl animate-in fade-in slide-in-from-bottom-3 duration-300 max-w-sm text-center">
          {ambienceToast}
        </div>
      )}
    </div>
  );
}

function PracticePanel({
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  setPlaybackRate,
  onClose,
  isPremium,
  setActiveView,
  t
}: {
  currentTrack: Track,
  isPlaying: boolean,
  currentTime: number,
  duration: number,
  playbackRate: number,
  setPlaybackRate: (v: number) => void,
  onClose: () => void,
  isPremium: boolean,
  setActiveView: (v: View) => void,
  t: any
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [midiNotes, setMidiNotes] = useState<any[]>([]);
  const [midiHeader, setMidiHeader] = useState<any>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const redLineRef = React.useRef<HTMLDivElement>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const osmdRef = React.useRef<OpenSheetMusicDisplay | null>(null);
  const currentTimeRef = React.useRef(currentTime);
  const lastMonotonicTimeRef = React.useRef(currentTime);
  const renderedBlockRef = React.useRef(-1);

  const loopRangeRef = React.useRef<HTMLDivElement>(null);
  const loopStartBlockRef = React.useRef<HTMLDivElement>(null);
  const loopEndBlockRef = React.useRef<HTMLDivElement>(null);

  // Practice Mode Lite Core Features Enablement
  const diagMaster = true;
  const diagScore = true;
  const diagKeyboard = true;
  const diagMeasure = true;
  const diagScroll = true;
  const diagBgAnim = true;

  const diagRef = React.useRef({ diagMaster, diagScore, diagKeyboard, diagMeasure, diagScroll });
  React.useEffect(() => {
    diagRef.current = { diagMaster, diagScore, diagKeyboard, diagMeasure, diagScroll };
  }, [diagMaster, diagScore, diagKeyboard, diagMeasure, diagScroll]);

  const [handFilter, setHandFilter] = useState<'both' | 'left' | 'right'>('both');
  const [noteNameMode, setNoteNameMode] = useState<'off' | 'letter' | 'number'>('letter');
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [metronomeVol, setMetronomeVol] = useState(50);

  const stateRefs = React.useRef({ handFilter, noteNameMode, metronomeOn, metronomeVol, isPlaying });
  React.useEffect(() => {
    stateRefs.current = { handFilter, noteNameMode, metronomeOn, metronomeVol, isPlaying };
  }, [handFilter, noteNameMode, metronomeOn, metronomeVol, isPlaying]);

  const lastMetronomeBeatRef = React.useRef(-1);
  const audioCtxRef = React.useRef<AudioContext | null>(null);

  // Handle A-B Looping State seamlessly across frames using strict Measure indexes
  const [loopM1, setLoopM1] = useState<number | null>(null);
  const [loopM2, setLoopM2] = useState<number | null>(null);
  const [isLoopSelectMode, setIsLoopSelectMode] = useState(false);
  const loopRef = React.useRef<{ M1: number | null, M2: number | null }>({ M1: null, M2: null });
  const currentMeasureIndexRef = React.useRef(0);

  React.useEffect(() => {
    loopRef.current = { M1: loopM1, M2: loopM2 };
  }, [loopM1, loopM2]);

  // When loop is fully established, immediately seek audio to M1 and exit select mode
  React.useEffect(() => {
    if (loopM1 === null || loopM2 === null) return;
    // Auto-exit selection mode when loop is complete
    setIsLoopSelectMode(false);
    const audio = document.querySelector('audio') as HTMLAudioElement | null;
    if (!audio || !midiHeader) return;
    const beatsPerM = midiHeader.timeSignatures?.[0]?.timeSignature?.[0] ?? 4;
    const safeFirst = (() => {
      const vn = midiNotes.filter(n => typeof n.ticks === 'number');
      const ft = vn.length > 0 ? vn.reduce((m, n) => Math.min(m, n.ticks), Infinity) : 0;
      return Number.isFinite(ft) ? ft : 0;
    })();
    const tickForMeasure = (idx: number) => {
      const targetTick = (idx * beatsPerM * midiHeader.ppq) + safeFirst;
      let act = midiHeader.tempos[0];
      for (let i = midiHeader.tempos.length - 1; i >= 0; i--) {
        if (targetTick >= midiHeader.tempos[i].ticks) { act = midiHeader.tempos[i]; break; }
      }
      return act.time + ((targetTick - act.ticks) / midiHeader.ppq) / (act.bpm / 60);
    };
    // Always seek to loop start when loop is set
    audio.currentTime = tickForMeasure(loopM1);
  }, [loopM1, loopM2]);

  // Clear loop when track changes
  useEffect(() => {
    setLoopM1(null);
    setLoopM2(null);
    setIsLoopSelectMode(false);
  }, [currentTrack.id]);

  const handleContainerClick = (e: React.MouseEvent) => {
    const osmd = osmdRef.current;
    const container = containerRef.current;
    if (!osmd || !container || !midiHeader) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const magicScale = 10.0 * osmd.zoom;
    const mh = 170 * (osmd.zoom / 0.55);

    if (!osmd.GraphicSheet?.MeasureList) return;

    let clickedMIdx = -1;
    osmd.GraphicSheet.MeasureList.forEach((measures, idx) => {
      const m = measures[0];
      if (!m?.PositionAndShape) return;
      const mx = m.PositionAndShape.AbsolutePosition.x * magicScale;
      const my = m.PositionAndShape.AbsolutePosition.y * magicScale;
      const mw = m.PositionAndShape.Size.width * magicScale;
      if (x >= mx && x <= mx + mw && y >= my - 30 && y <= my + mh) {
        clickedMIdx = idx;
      }
    });

    if (clickedMIdx === -1) return;

    if (isLoopSelectMode) {
      // Loop selection mode: first click = start, second click = end
      if (loopM1 === null) {
        setLoopM1(clickedMIdx);
      } else {
        setLoopM1(Math.min(loopM1, clickedMIdx));
        setLoopM2(Math.max(loopM1, clickedMIdx));
      }
    } else {
      // Normal mode: click measure = seek audio to that measure and play
      const beatsPerM = midiHeader.timeSignatures?.[0]?.timeSignature?.[0] ?? 4;
      const validNotes = midiNotes.filter(n => typeof n.ticks === 'number');
      const safeFirst = validNotes.length > 0 ? validNotes.reduce((m, n) => Math.min(m, n.ticks), Infinity) : 0;
      const targetTick = (clickedMIdx * beatsPerM * midiHeader.ppq) + (Number.isFinite(safeFirst) ? safeFirst : 0);
      let act = midiHeader.tempos[0];
      for (let i = midiHeader.tempos.length - 1; i >= 0; i--) {
        if (targetTick >= midiHeader.tempos[i].ticks) { act = midiHeader.tempos[i]; break; }
      }
      const seekSecs = act.time + ((targetTick - act.ticks) / midiHeader.ppq) / (act.bpm / 60);
      const audio = document.querySelector('audio') as HTMLAudioElement | null;
      if (audio) {
        audio.currentTime = seekSecs;
        if (audio.paused) audio.play().catch(() => { });
      }
    }
  };

  // Keep ref sync
  React.useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // Load MIDI Notes and Time Map
  React.useEffect(() => {
    if (!currentTrack.midiUrl) return;
    fetch(currentTrack.midiUrl)
      .then(res => res.arrayBuffer())
      .then(buf => {
        const midi = new Midi(buf);

        // Save tempo map for physical time alignment
        setMidiHeader({
          tempos: midi.header.tempos,
          ppq: midi.header.ppq,
          timeSignatures: midi.header.timeSignatures,
        });

        // Heuristically map Left/Right hand based on average track pitch
        const trackPitches = midi.tracks
          .filter(t => t.notes.length > 0)
          .map(t => {
            const avg = t.notes.reduce((sum, n) => sum + n.midi, 0) / t.notes.length;
            return { track: t, avgPitch: avg };
          })
          .sort((a, b) => b.avgPitch - a.avgPitch); // Highest pitch first

        const rightTrack = trackPitches[0]?.track; // Usually Treble
        const leftTrack = trackPitches[1]?.track;  // Usually Bass

        const notes: any[] = [];
        midi.tracks.forEach(track => {
          if (track.notes.length === 0) return;
          const hand = track === rightTrack ? 'right' : track === leftTrack ? 'left' : 'right';

          track.notes.forEach(note => {
            notes.push({
              name: note.name, // e.g., "C4", "F#4"
              time: note.time,
              duration: note.duration,
              ticks: note.ticks,
              hand
            });
          });
        });

        // Performance Pass: Pre-sort chronologically for O(1) sliding window lookups
        notes.sort((a, b) => a.time - b.time);
        setMidiNotes(notes);
      })
      .catch(console.error);
  }, [currentTrack.midiUrl]);

  // Load MusicXML and Initialize OSMD
  React.useEffect(() => {
    if (!containerRef.current) return;

    if (!currentTrack.musicxmlUrl) {
      setLoadError("No MusicXML available for this track.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    containerRef.current.innerHTML = '';

    // Create OSMD instance
    const osmd = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: false,
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawPartNames: false,
      backend: "svg"
    });

    // Shrink internal zoom heavily to safely fit container height natively without CSS scale destruction
    osmd.zoom = 0.55;
    osmdRef.current = osmd;

    // Set OSMD to single system format (Endless) and limit initial render to First Block (4 measures)
    osmd.setOptions({
      pageBottomMargin: 0,
      pageTopMargin: 0,
      pageFormat: "Endless",
      spacingBetweenTextAndSystem: 0,
      drawFromMeasureNumber: 1,
      drawUpToMeasureNumber: Number.MAX_SAFE_INTEGER,
      cursorsOptions: [{ type: 0, color: "transparent", alpha: 0, follow: false }]
    } as any);

    osmd.load(currentTrack.musicxmlUrl).then(() => {
      osmd.render();
      renderedBlockRef.current = 0;
      osmd.cursor.show();
      setIsLoading(false);
    }).catch((err) => {
      console.error("OSMD Load Error", err);
      setLoadError(err.message || "Failed to parse or load sheet music.");
      setIsLoading(false);
    });

    return () => {
      osmd.clear();
      osmdRef.current = null;
    };
  }, [currentTrack.musicxmlUrl]);

  // Global Time Loop Syncing
  React.useEffect(() => {
    if (isLoading || !osmdRef.current) return;

    // Performance Pass: Single query for isolated elements
    const audioElement = document.querySelector('audio');
    if (!audioElement) return;

    // Performance Pass: Precaching 88 keys to bypass querySelector in 60fps loop
    const keyNodes = new Map<string, { el: HTMLElement, span: HTMLElement | null }>();
    whiteKeys.forEach(n => {
      const wKey = document.querySelector(`[data-note="${n}"]`) as HTMLElement;
      if (wKey) {
        keyNodes.set(n, { el: wKey, span: wKey.querySelector('span') as HTMLElement });
      }

      const sharp = `${n.charAt(0)}#${n.slice(1)}`;
      const flat = `${n.charAt(0)}b${n.slice(1)}`;

      const bKey1 = document.querySelector(`[data-note="${sharp}"]`) as HTMLElement;
      if (bKey1) {
        keyNodes.set(sharp, { el: bKey1, span: bKey1.querySelector('span') as HTMLElement });
      }

      const bKey2 = document.querySelector(`[data-alt-note="${flat}"]`) as HTMLElement;
      if (bKey2) {
        keyNodes.set(flat, { el: bKey2, span: bKey2.querySelector('span') as HTMLElement });
      }
    });

    let animationId: number;
    let smoothedY = 0; // GPU lerp state for vertical scrolling
    let lastTimeSecs = currentTimeRef.current;

    // Cache latest stringified keys to prevent 60fps React rerender storms
    let prevRightStr = "";
    let prevLeftStr = "";

    // Sliding window pointer avoiding O(N) filters
    let trackStartIndex = 0;
    let prevNoteMode = noteNameMode;

    const getJianpuLabel = (note: string, isBlack: boolean) => {
      const name = note.charAt(0);
      const accidental = note.includes('#') ? '#' : (note.includes('b') ? 'b' : '');
      const octave = parseInt(note.replace(/[A-Gb#]/g, '')) || 4;
      const map: Record<string, string> = { 'C': '1', 'D': '2', 'E': '3', 'F': '4', 'G': '5', 'A': '6', 'B': '7' };
      const digit = map[name] || '';

      const dotSize = isBlack ? '2.5px' : '3.5px';
      const fontSize = isBlack ? '10px' : '15px'; // Slightly smaller black labels for better fit
      const dotHtml = `<div style="width: ${dotSize}; height: ${dotSize}; border-radius: 50%; background: currentColor;"></div>`;

      let dotsAbove = '';
      let dotsBelow = '';

      if (octave >= 5) {
        const count = octave - 4;
        // Standard Jianpu: Vertical stacking for multiple dots
        dotsAbove = `<div style="display: flex; flex-direction: column-reverse; align-items: center; gap: 1px; margin-bottom: 2px;">${Array(count).fill(dotHtml).join('')}</div>`;
      } else if (octave <= 3) {
        const count = 4 - octave;
        // Standard Jianpu: Vertical stacking for multiple dots
        dotsBelow = `<div style="display: flex; flex-direction: column; align-items: center; gap: 1px; margin-top: 2px;">${Array(count).fill(dotHtml).join('')}</div>`;
      }

      return `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; transform: translateY(${isBlack ? '0' : '1px'})">
            ${dotsAbove}
            <div style="font-size: ${fontSize}; font-weight: 900; line-height: 1; font-family: 'Outfit', sans-serif; display: flex; align-items: flex-start;">
                <span>${digit}</span>
                ${accidental ? `<span style="font-size: 0.7em; margin-left: 0.5px; opacity: 0.9;">${accidental}</span>` : ''}
            </div>
            ${dotsBelow}
        </div>`;
    };

    const tick = () => {
      const osmd = osmdRef.current;

      if (!osmd || !osmd.cursor || !osmd.cursor.Iterator || !midiHeader) {
        animationId = requestAnimationFrame(tick);
        return;
      }

      // Bypass React's 4fps onTimeUpdate throttle for true 60fps audio sync precision
      const timeSecs = audioElement.currentTime;

      // Calculate delta to handle seeks cleanly
      if (Math.abs(timeSecs - lastTimeSecs) > 1.0) {
        lastTimeSecs = timeSecs;
        trackStartIndex = 0; // reset pointer on heavy seek
      }

      // Local helper: get audio time for OSMD measure index by looking at MIDI notes in that measure
      // Strategy: find the minimum note time among notes whose tick position falls in the measure.
      // Fall back to PPQ*beatsPerMeasure formula if MIDI note lookup yields nothing.
      const getSecsForMeasureOsmd = (osmdMIdx: number): number => {
        const osmd = osmdRef.current;
        if (!osmd?.GraphicSheet?.MeasureList) return 0;
        const list = osmd.GraphicSheet.MeasureList;
        if (osmdMIdx >= list.length) return audioElement.duration || 9999;
        if (osmdMIdx < 0) return 0;

        // Try to find the first MIDI note that visually belongs at or after this measure's x position
        const gm = list[osmdMIdx]?.[0];
        if (!gm?.PositionAndShape) return 0;
        const magicScale = 10.0 * osmd.zoom;
        const targetX = gm.PositionAndShape.AbsolutePosition.x * magicScale; // px in OSMD space

        // Build a cache of OSMD measure boundaries sorted by x position for time lookup
        // Use measure index order directly (OSMD gives sequential layout)
        // The simplest reliable mapping: scan midiNotes and find the first note whose
        // xFraction (via tick->measureBeat) maps to >= osmdMIdx.
        // Since we already have the PPQ-based measureIndex in tick(), derive beatsPerMeasure.
        const beatsPerMeasure = midiHeader.timeSignatures?.[0]?.timeSignature?.[0] ?? 4;
        const safeFirst = (() => {
          const vn = midiNotes.filter(n => typeof n.ticks === 'number');
          const ft = vn.length > 0 ? vn.reduce((m, n) => Math.min(m, n.ticks), Infinity) : 0;
          return Number.isFinite(ft) ? ft : 0;
        })();
        const targetTick = (osmdMIdx * beatsPerMeasure * midiHeader.ppq) + safeFirst;

        // Find active tempo at this tick
        let active = midiHeader.tempos[0];
        for (let i = midiHeader.tempos.length - 1; i >= 0; i--) {
          if (targetTick >= midiHeader.tempos[i].ticks) { active = midiHeader.tempos[i]; break; }
        }
        const tElapsed = targetTick - active.ticks;
        const bElapsed = tElapsed / midiHeader.ppq;
        const sElapsed = bElapsed / (active.bpm / 60);
        return active.time + sElapsed;
      };

      // Enforce loop boundary: if playing and current time is BEFORE loop start, seek to start
      if (loopRef.current.M1 !== null && loopRef.current.M2 !== null && !audioElement.paused) {
        const mEndSecs = getSecsForMeasureOsmd(loopRef.current.M2 + 1);
        const mStartSecs = getSecsForMeasureOsmd(loopRef.current.M1);
        if (timeSecs >= mEndSecs || timeSecs < mStartSecs) {
          audioElement.currentTime = mStartSecs;
          lastTimeSecs = mStartSecs;
          trackStartIndex = 0;
          animationId = requestAnimationFrame(tick);
          return;
        }
      }
      const checkStart = Math.min(lastTimeSecs, timeSecs);

      // Performance Pass: O(1) Sliding Window rather than generic filter over 5000 array elements
      // Forward the starting pointer for notes that are safely in the past (assume 10s max note hold)
      while (trackStartIndex < midiNotes.length && midiNotes[trackStartIndex].time < timeSecs - 10.0) {
        trackStartIndex++;
      }

      const currentActive = [];
      for (let i = trackStartIndex; i < midiNotes.length; i++) {
        const n = midiNotes[i];
        if (n.time > timeSecs + 0.5) break; // Prune future loop evaluation due to ascending sort

        const visualEnd = n.time + Math.max(0.1, n.duration);
        const isCurrentlyActive = timeSecs >= n.time && timeSecs <= visualEnd;
        const startedJustNow = n.time >= checkStart && n.time <= timeSecs;

        if (isCurrentlyActive || startedJustNow) {
          currentActive.push(n);
        }
      }

      const { handFilter, noteNameMode, metronomeOn, metronomeVol, isPlaying: currentIsPlaying } = stateRefs.current;

      const newRight = currentActive.filter(n => n.hand === 'right' && (handFilter === 'both' || handFilter === 'right')).map(n => n.name);
      const newLeft = currentActive.filter(n => n.hand === 'left' && (handFilter === 'both' || handFilter === 'left')).map(n => n.name);

      const newRightStr = newRight.join(',');
      const newLeftStr = newLeft.join(',');

      // Detect Mode change to trigger full keyboard label refresh
      const modeChanged = noteNameMode !== prevNoteMode;

      // Direct DOM Mutation for Zero-Rerender Keyboard Highlighting (60fps performance fix)
      if (diagRef.current.diagMaster && diagRef.current.diagKeyboard && (newRightStr !== prevRightStr || newLeftStr !== prevLeftStr || modeChanged)) {
        const rSet = new Set(newRight);
        const lSet = new Set(newLeft);

        // If mode changed, we must refresh all 88 keys. Otherwise just the diff.
        let notesToUpdate: string[];
        if (modeChanged) {
          notesToUpdate = Array.from(keyNodes.keys());
          prevNoteMode = noteNameMode;
        } else {
          const prevRSet = new Set(prevRightStr ? prevRightStr.split(',') : []);
          const prevLSet = new Set(prevLeftStr ? prevLeftStr.split(',') : []);
          notesToUpdate = Array.from(new Set([...newRight, ...newLeft, ...prevRSet, ...prevLSet]));
        }

        notesToUpdate.forEach(note => {
          if (!note) return;
          // Find instantly in pre-cached Map
          const nodeData = keyNodes.get(note);
          if (nodeData && nodeData.el) {
            const { el, span } = nodeData;
            const isBlack = el.hasAttribute('data-is-black');
            const isRight = rSet.has(note);
            const isLeft = lSet.has(note);
            const isActive = isRight || isLeft;

            // Update Label Content if mode switched or if active (efficiency: only update what's visible or changed)
            if (span && (modeChanged || isActive)) {
              if (noteNameMode === 'number') {
                span.innerHTML = getJianpuLabel(note, isBlack);
              } else {
                span.innerText = note;
              }
            }

            // Apply direct DOM state to prevent CSS bleeding
            if (span) {
              // For C notes, retain semi-transparent text if inactive, otherwise fully hide
              const isC = !isBlack && note.startsWith('C');
              if (isActive && noteNameMode !== 'off') {
                span.style.opacity = '1';
                span.style.color = isBlack ? 'white' : 'black';
              } else {
                span.style.opacity = isC && noteNameMode !== 'off' ? '0.3' : '0';
                span.style.color = 'black';
              }
            }

            if (isBlack) {
              el.className = isRight
                ? 'absolute top-0 right-0 w-[60%] h-[60%] rounded-b-sm z-30 translate-x-1/2 border-x border-b border-black/80 transition-all duration-[50ms] flex items-end justify-center pb-1'
                : isLeft
                  ? 'absolute top-0 right-0 w-[60%] h-[60%] rounded-b-sm z-30 translate-x-1/2 border-x border-b border-black/80 transition-all duration-[50ms] flex items-end justify-center pb-1'
                  : 'absolute top-0 right-0 w-[60%] h-[60%] rounded-b-sm z-30 translate-x-1/2 shadow-xl border-x border-b border-black/80 transition-all duration-[50ms] bg-[#111] hover:bg-black flex items-end justify-center pb-1';
              if (isRight) {
                el.style.backgroundColor = '#B05A3A';  // apricot-rose dark — matches white key #E3A07A
                el.style.boxShadow = '0 0 12px 2px rgba(227,160,122,0.72), inset 0 1px 0 rgba(255,210,170,0.30)';
              } else if (isLeft) {
                el.style.backgroundColor = '#2A9080';  // teal dark (black key)
                el.style.boxShadow = '0 0 12px 2px rgba(95,184,165,0.72), inset 0 1px 0 rgba(150,235,220,0.30)';
              } else {
                el.style.backgroundColor = '';
                el.style.boxShadow = '';
              }
            } else {
              el.className = isRight
                ? 'flex-1 border-r border-[#1a1a1a] last:border-0 relative flex flex-col justify-end items-center pb-2 transition-all duration-[50ms] z-10 scale-[1.02]'
                : isLeft
                  ? 'flex-1 border-r border-[#1a1a1a] last:border-0 relative flex flex-col justify-end items-center pb-2 transition-all duration-[50ms] z-10 scale-[1.02]'
                  : 'flex-1 border-r border-[#1a1a1a] last:border-0 relative flex flex-col justify-end items-center pb-2 transition-all duration-[50ms] bg-[#fffff0]';
              if (isRight) {
                el.style.backgroundColor = '#E3A07A';  // apricot rose — exact
                el.style.boxShadow = 'inset 0 -18px 30px rgba(227,160,122,0.55), 0 0 6px rgba(227,160,122,0.18)';
              } else if (isLeft) {
                el.style.backgroundColor = '#5FB8A5';  // teal — exact
                el.style.boxShadow = 'inset 0 -18px 30px rgba(95,184,165,0.55), 0 0 6px rgba(95,184,165,0.18)';
              } else {
                el.style.backgroundColor = '';
                el.style.boxShadow = '';
              }
            }
            // Reset border radius on white keys after applying className
            if (!isBlack) (el as HTMLElement).style.borderRadius = '0 0 3px 3px';
          }
        });

        prevRightStr = newRightStr;
        prevLeftStr = newLeftStr;
      }

      lastTimeSecs = timeSecs;

      // 2. Map physical seconds to abstract MIDI Ticks exactly via Tempo Curve
      const tempos = midiHeader.tempos;
      let activeTempo = tempos[0];
      for (let i = tempos.length - 1; i >= 0; i--) {
        if (timeSecs >= tempos[i].time) {
          activeTempo = tempos[i];
          break;
        }
      }
      const secondsSinceTempoChange = Math.max(0, timeSecs - activeTempo.time);
      const beatsElapsed = secondsSinceTempoChange * (activeTempo.bpm / 60);
      const ticksElapsed = beatsElapsed * midiHeader.ppq;
      const currentTickOrig = activeTempo.ticks + ticksElapsed;

      // ORIGIN CALIBRATION: Subtract the pre-music DAW silence offset
      // Prevent NaN cascades by skipping completely invalid ticks
      const validNotes = midiNotes.filter(n => typeof n.ticks === 'number');
      const firstMidiTick = validNotes.length > 0
        ? validNotes.reduce((min, n) => Math.min(min, n.ticks), Infinity)
        : 0;

      // Extra safety check in case the origin math breaks
      const safeFirstTick = Number.isFinite(firstMidiTick) ? firstMidiTick : 0;
      const currentTick = Math.max(0, currentTickOrig - safeFirstTick);

      const currentBeatGlobal = Math.floor(currentTickOrig / midiHeader.ppq);
      const beatsPerMeasure = midiHeader.timeSignatures?.[0]?.timeSignature?.[0] ?? 4;

      if (metronomeOn && currentIsPlaying && currentBeatGlobal >= 0) {
        if (lastMetronomeBeatRef.current === -1) {
          lastMetronomeBeatRef.current = currentBeatGlobal;
        } else if (currentBeatGlobal > lastMetronomeBeatRef.current) {
          lastMetronomeBeatRef.current = currentBeatGlobal;
          if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          }
          if (audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume();
          }
          const ctx = audioCtxRef.current;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const isAccent = (currentBeatGlobal % beatsPerMeasure) === 0;
          osc.frequency.setValueAtTime(isAccent ? 880 : 600, ctx.currentTime);
          gain.gain.setValueAtTime((metronomeVol / 100) * 0.5, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.05);
        }
      } else if (!currentIsPlaying || !metronomeOn) {
        lastMetronomeBeatRef.current = currentBeatGlobal;
      }

      // 3. OSMD MeasureList index — use beatsPerMeasure from MIDI time sig
      const targetFraction = currentTick / (midiHeader.ppq * beatsPerMeasure);
      const measureIndex = Number.isFinite(targetFraction) ? Math.floor(targetFraction) : 0;
      currentMeasureIndexRef.current = measureIndex;
      const measureRatio = Number.isFinite(targetFraction) ? Math.max(0, Math.min(1, targetFraction - measureIndex)) : 0;

      // 5. Calculate Local X and Y mapping (Lite 2.0: Measure-Level Only)
      let cursorX = 0;
      let cursorY = 0;
      let cursorWidth = 0;
      let cursorHeight = 80;

      if (osmd.GraphicSheet && osmd.GraphicSheet.MeasureList) {
        const measures = osmd.GraphicSheet.MeasureList;
        const localIndex = Math.max(0, measureIndex);

        const safeIndex = Math.min(localIndex, Math.max(0, measures.length - 1));
        const currentMeasure = measures[safeIndex] ? measures[safeIndex][0] : null;

        if (currentMeasure && currentMeasure.PositionAndShape) {
          const magicScale = 10.0 * osmd.zoom; // OSMD unit conversion to pixel ratio

          // Exactly lock to the bounding box of the whole measure
          cursorX = currentMeasure.PositionAndShape.AbsolutePosition.x * magicScale;
          cursorY = currentMeasure.PositionAndShape.AbsolutePosition.y * magicScale;
          cursorWidth = currentMeasure.PositionAndShape.Size.width * magicScale;

          // Dynamic cursor height based on grand staff approximation
          cursorHeight = 170 * (osmd.zoom / 0.55);
        }
      }

      // 6. Apply rapid tracking: Move Cursor Box and Pan Container Vertically
      if (redLineRef.current && scrollContainerRef.current) {

        // Measure Highlight Application
        if (diagRef.current.diagMaster && diagRef.current.diagMeasure && cursorHeight > 0) {
          redLineRef.current.style.display = 'block';
          redLineRef.current.style.transform = `translate(${cursorX}px, ${cursorY}px)`;
          redLineRef.current.style.width = `${cursorWidth}px`;
          redLineRef.current.style.height = `${cursorHeight}px`;
        } else {
          redLineRef.current.style.display = 'none';
        }

        // Score display and CSS Single-Line Masking
        if (diagRef.current.diagMaster && diagRef.current.diagScore) {
          scrollContainerRef.current.style.opacity = '1';

          // Lite 2.0 Single Line Masking Logic
          if (diagRef.current.diagMeasure && cursorHeight > 0) {
            // Generous margin for extreme high ledger lines and chords way above the staff
            const paddingTop = 75;
            // Buffer to not clip the bass line or pedaling
            const paddingBottom = 15;
            const scrollHeightAdjusted = cursorHeight + paddingBottom;

            scrollContainerRef.current.style.clipPath = `inset(${Math.max(0, cursorY - paddingTop)}px 0px calc(100% - ${cursorY + scrollHeightAdjusted}px) 0px)`;
          } else {
            scrollContainerRef.current.style.clipPath = 'none';
          }
        } else {
          scrollContainerRef.current.style.opacity = '0';
        }

        // Performance Pass: Cached parent height approximation prevents DOM Reflow/Layout Thrashing
        const parentHeight = window.innerHeight * 0.65;

        // Center the entire grand staff system height (cursorY + cursorHeight/2) inside the visible block
        const systemCenterY = cursorY + (cursorHeight / 2);

        // Let the system stably hover securely lower so ledger notes peek safely inside the 65vh container
        const targetScrollY = (parentHeight / 2) - systemCenterY + 20;

        // Skip lerp if jump is massive, otherwise gently slide to the next line when cursorY changes
        if (Math.abs(targetScrollY - smoothedY) > 400) {
          smoothedY = targetScrollY;
        } else {
          smoothedY += (targetScrollY - smoothedY) * 0.1;
        }

        // Prevent scrolling above the canvas top, and enforce a slight padding
        const maxScroll = 40;

        // Auto Follow Toggle
        if (diagRef.current.diagMaster && diagRef.current.diagScroll) {
          scrollContainerRef.current.style.transform = `translateY(${Math.min(maxScroll, smoothedY)}px)`;
        } else {
          scrollContainerRef.current.style.transform = `translateY(0px)`;
        }

        // Measure-based Loop Block Rendering (no vertical bars; only fill blocks)
        // Renders up to 3 blocks: the start measure, the end measure, and the middle range if same line.
        if (loopRangeRef.current && loopStartBlockRef.current && loopEndBlockRef.current && osmd.GraphicSheet?.MeasureList) {
          const list = osmd.GraphicSheet.MeasureList;
          const m1Idx = loopRef.current.M1;
          const m2Idx = loopRef.current.M2;
          const magicScale = 10.0 * osmd.zoom;
          const h = 170 * (osmd.zoom / 0.55);

          if (m1Idx !== null && list[m1Idx]?.[0]?.PositionAndShape) {
            const gm1 = list[m1Idx][0];
            const x1 = gm1.PositionAndShape.AbsolutePosition.x * magicScale;
            const y1 = gm1.PositionAndShape.AbsolutePosition.y * magicScale;
            const w1 = gm1.PositionAndShape.Size.width * magicScale;

            // Always show the start block
            loopStartBlockRef.current.style.display = 'block';
            loopStartBlockRef.current.style.left = `${x1}px`;
            loopStartBlockRef.current.style.top = `${y1}px`;
            loopStartBlockRef.current.style.width = `${w1}px`;
            loopStartBlockRef.current.style.height = `${h}px`;

            if (m2Idx !== null && list[m2Idx]?.[0]?.PositionAndShape) {
              const gm2 = list[m2Idx][0];
              const x2 = gm2.PositionAndShape.AbsolutePosition.x * magicScale;
              const y2 = gm2.PositionAndShape.AbsolutePosition.y * magicScale;
              const w2 = gm2.PositionAndShape.Size.width * magicScale;

              loopEndBlockRef.current.style.display = 'block';
              loopEndBlockRef.current.style.left = `${x2}px`;
              loopEndBlockRef.current.style.top = `${y2}px`;
              loopEndBlockRef.current.style.width = `${w2}px`;
              loopEndBlockRef.current.style.height = `${h}px`;

              // Range fill: same row only
              if (Math.abs(y1 - y2) < 20 && x2 > x1) {
                loopRangeRef.current.style.display = 'block';
                loopRangeRef.current.style.left = `${x1}px`;
                loopRangeRef.current.style.top = `${y1}px`;
                loopRangeRef.current.style.width = `${x2 + w2 - x1}px`;
                loopRangeRef.current.style.height = `${h}px`;
              } else {
                loopRangeRef.current.style.display = 'none';
              }
            } else {
              loopEndBlockRef.current.style.display = 'none';
              loopRangeRef.current.style.display = 'none';
            }
          } else {
            loopStartBlockRef.current.style.display = 'none';
            loopEndBlockRef.current.style.display = 'none';
            loopRangeRef.current.style.display = 'none';
          }
        }
      }

      animationId = requestAnimationFrame(tick);
    };

    tick();
    return () => cancelAnimationFrame(animationId);
  }, [isLoading, midiNotes, midiHeader]);

  // 88 keys: A0 to C8
  const whiteKeys = [
    'A0', 'B0',
    'C1', 'D1', 'E1', 'F1', 'G1', 'A1', 'B1',
    'C2', 'D2', 'E2', 'F2', 'G2', 'A2', 'B2',
    'C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3',
    'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4',
    'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5',
    'C6', 'D6', 'E6', 'F6', 'G6', 'A6', 'B6',
    'C7', 'D7', 'E7', 'F7', 'G7', 'A7', 'B7',
    'C8'
  ];

  const hasBlackRight = (note: string) => {
    const name = note.charAt(0);
    return name !== 'E' && name !== 'B';
  };

  return (
    <div className="fixed bottom-24 left-0 right-0 h-[65vh] z-40 animate-in slide-in-from-bottom duration-500">
      <div className="w-full h-full glass-effect border-t border-white/40 flex flex-col rounded-t-[40px] shadow-2xl overflow-hidden bg-[var(--color-mist-bg)] relative">

        {/* PREMIUM STATIC OVERLAY */}
        {!isPremium && (
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) onClose();
            }}
            className="absolute inset-0 z-[60] bg-black/40 backdrop-blur-[6px] flex flex-col items-center justify-center pointer-events-auto cursor-pointer animate-in fade-in duration-500"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="glass-panel p-12 max-w-lg w-[90%] flex flex-col items-center text-center gap-8 border border-white/20 shadow-[0_32px_80px_rgba(0,0,0,0.6)] bg-white/10 cursor-default relative overflow-hidden group rounded-[48px]"
            >
              <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent"></div>

              <div className="w-24 h-24 rounded-full bg-amber-500/15 flex items-center justify-center mb-2 border border-amber-500/20 shadow-[0_0_40px_rgba(245,158,11,0.2)] transition-transform duration-700 group-hover:rotate-[360deg]">
                <Lock className="w-12 h-12 text-amber-500" strokeWidth={1} />
              </div>

              <div className="flex flex-col gap-4">
                <h3 className="text-3xl font-black text-white tracking-tight drop-shadow-lg">{t.practice.premiumTitle}</h3>
                <p className="text-[17px] text-white/70 leading-relaxed font-medium px-4">
                  {t.practice.premiumDesc}
                </p>
              </div>

              <div className="w-full flex flex-col gap-4 mt-2">
                <button
                  onClick={() => {
                    onClose();
                    setActiveView('settings');
                  }}
                  className="w-full py-5 rounded-[24px] bg-amber-600 hover:bg-amber-500 text-[17px] font-bold text-white tracking-wide transition-all duration-300 shadow-xl shadow-amber-600/30 hover:shadow-amber-500/50 active:scale-[0.98] outline-none border-none"
                >
                  {t.common.learnMore}
                </button>
                <button
                  onClick={onClose}
                  className="w-full py-3 rounded-[16px] bg-white/5 hover:bg-white/10 text-sm font-bold text-white/40 hover:text-white/60 transition-all border border-white/10"
                >
                  {t.common.maybeLater}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 1) Staff Section (65% height to securely fit large Grand Staff layout without clipping) */}
        <div className="h-[65%] relative flex flex-col justify-start overflow-hidden w-full bg-[#f8f6f0] shadow-inner">

          <div className="absolute top-0 w-full h-full flex flex-col items-start overflow-hidden pt-4">
            <div ref={scrollContainerRef} className="relative w-full px-[5vw] transition-none origin-top">
              <div
                ref={containerRef}
                className={`w-full opacity-90 mix-blend-multiply cursor-pointer`}
                onClick={handleContainerClick}
              ></div>

              {/* Loop Block Highlights — mint/ice-green, border-dominant, ultra-light fill */}
              {/* Middle range: barely-there fill + light continuous border */}
              {/* Loop — sky blue, distinct from coral current-measure and teal left-hand */}
              <div ref={loopRangeRef} className="absolute top-0 z-20 pointer-events-none ml-[5vw]" style={{ display: 'none', left: 0, background: 'rgba(100,170,240,0.18)', border: '1.5px solid rgba(64,140,220,0.60)' }}></div>
              <div ref={loopStartBlockRef} className="absolute top-0 z-21 pointer-events-none ml-[5vw]" style={{ display: 'none', left: 0, background: 'rgba(100,170,240,0.24)', border: '2px solid rgba(64,140,220,0.78)', borderLeft: '3px solid rgba(40,120,210,0.90)' }}></div>
              <div ref={loopEndBlockRef} className="absolute top-0 z-21 pointer-events-none ml-[5vw]" style={{ display: 'none', left: 0, background: 'rgba(100,170,240,0.24)', border: '2px solid rgba(64,140,220,0.78)', borderRight: '3px solid rgba(40,120,210,0.90)' }}></div>

              {/* Current Measure — dusty coral, clearly readable, does not compress notes */}
              <div
                ref={redLineRef}
                className="absolute top-0 z-30 pointer-events-none transition-all duration-300 ml-[5vw]"
                style={{ left: 0, background: 'rgba(224,146,132,0.24)', border: '1.5px solid rgba(201,112,96,0.78)', borderTop: '2.5px solid rgba(201,112,96,0.90)', borderRadius: '3px' }}
              ></div>
            </div>
          </div>

          {isLoading && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#f8f6f0] backdrop-blur-md">
              <div className="w-8 h-8 border-2 border-amber-900/20 border-t-amber-900 rounded-full animate-spin"></div>
              <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-amber-900/40">{t.player.loadingMusicxml}</span>
            </div>
          )}

          {loadError && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#f8f6f0] backdrop-blur-md">
              <Search className="w-8 h-8 text-red-500/50" />
              <span className="text-[12px] font-bold text-red-500/80">{loadError}</span>
            </div>
          )}



          {/* Top/bottom gradient overlays to make the paper roll look elegant */}
          <div className="absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-black/20 to-transparent z-10 pointer-events-none"></div>
          <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/20 to-transparent z-10 pointer-events-none"></div>
        </div>

        {/* 2) 88-Key Piano Keyboard (25% height) */}
        <div className="h-[25%] px-0 pb-1 flex relative select-none bg-black/40 pt-2 border-t-[4px] border-[#8b0000]/60">
          <div className="flex w-full h-full relative">
            {whiteKeys.map((note) => {
              const isC = note.startsWith('C');
              const sharpNote = `${note.charAt(0)}#${note.slice(1)}`;
              const flatNote = `${note.charAt(0)}b${note.slice(1)}`;

              return (
                <div
                  key={note}
                  data-note={note}
                  className="flex-1 border-r border-[#1a1a1a] last:border-0 relative flex flex-col justify-end items-center pb-2 transition-all duration-[50ms] bg-[#fffff0]"
                  style={{ borderRadius: '0 0 3px 3px' }}
                >
                  <span className="text-[9.5px] font-bold mb-1 transition-opacity pointer-events-none" style={{ opacity: isC ? '0.3' : '0' }}>{note}</span>

                  {/* Black Key Positioning */}
                  {hasBlackRight(note) && note !== 'C8' && (
                    <div
                      data-note={sharpNote}
                      data-alt-note={flatNote}
                      data-is-black="true"
                      className="absolute top-0 right-0 w-[60%] h-[60%] rounded-b-sm z-30 translate-x-1/2 shadow-xl border-x border-b border-black/80 transition-all duration-[50ms] bg-[#111] hover:bg-black flex items-end justify-center pb-1"
                    >
                      <span className="text-[7px] font-bold transition-opacity pointer-events-none text-white/40" style={{ opacity: '0' }}>{sharpNote}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 3) Control Strip (10% height) */}
        <div className="h-[10%] min-h-[40px] flex items-center justify-between px-6 lg:px-10 bg-black/60 shadow-inner overflow-x-auto no-scrollbar border-t border-white/5 relative z-50">
          <div className="flex items-center gap-4 lg:gap-6 shrink-0 h-full">

            <span className="text-[10px] uppercase font-bold text-white/40 tracking-widest flex items-center gap-1.5 shrink-0 hidden md:flex">
              <Piano className="w-3.5 h-3.5 text-amber-500/80" />
              {t.player.practice}
            </span>

            <div className="w-px h-6 bg-white/10 mx-1 hidden md:block"></div>

            {/* Loop Controls */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Main Loop button OR status display */}
              {loopM1 === null && loopM2 === null ? (
                <button
                  onClick={() => setIsLoopSelectMode(m => !m)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold transition-all ${isLoopSelectMode
                    ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/50 hover:bg-blue-500/30'
                    : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80'
                    }`}
                >
                  <Repeat className="w-3 h-3" />
                  {isLoopSelectMode ? t.common.cancel : t.player.loop}
                </button>
              ) : loopM2 === null ? (
                // M1 set, waiting for M2
                <span className="text-[10px] text-blue-400 font-bold tracking-wide flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                  M{loopM1! + 1} – click end
                </span>
              ) : (
                // Loop fully set
                <span className="text-[11px] text-blue-400 font-bold tracking-wider flex items-center gap-1.5 bg-blue-500/10 px-2.5 py-0.5 rounded-full ring-1 ring-blue-500/30">
                  <Repeat className="w-3 h-3" />
                  Loop: M{loopM1! + 1}–M{loopM2 + 1}
                </span>
              )}

              {/* Clear — only visible when any loop state exists */}
              {(loopM1 !== null || isLoopSelectMode) && (
                <button
                  onClick={() => { setLoopM1(null); setLoopM2(null); setIsLoopSelectMode(false); }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold transition-all bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70 border border-white/10"
                >
                  <X className="w-3 h-3" />
                  {t.common.clear}
                </button>
              )}
            </div>

            <div className="w-px h-6 bg-white/10 mx-1"></div>

            {/* Hand Filter */}
            <div className="flex gap-0.5 p-0.5 bg-white/5 rounded-full border border-white/10 shrink-0">
              <button
                onClick={() => setHandFilter('both')}
                className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${handFilter === 'both' ? 'bg-white/20 text-white shadow-sm' : 'text-white/40 hover:text-white/80'}`}
              >{t.player.handBoth}</button>
              <button
                onClick={() => setHandFilter('left')}
                className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${handFilter === 'left' ? 'bg-[#5FB8A5]/40 text-[#5FB8A5] shadow-sm' : 'text-white/40 hover:text-white/80'}`}
              >{t.player.handLeft}</button>
              <button
                onClick={() => setHandFilter('right')}
                className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${handFilter === 'right' ? 'bg-[#E3A07A]/40 text-[#E3A07A] shadow-sm' : 'text-white/40 hover:text-white/80'}`}
              >{t.player.handRight}</button>
            </div>

            <div className="w-px h-6 bg-white/10 mx-1 hidden sm:block"></div>

            {/* Note Names Modes Toggle */}
            <div className="flex gap-0.5 p-0.5 bg-white/5 rounded-full border border-white/10 shrink-0 hidden sm:flex items-center">
              <button
                onClick={() => setNoteNameMode('off')}
                className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${noteNameMode === 'off' ? 'bg-white/20 text-white shadow-sm' : 'text-white/40 hover:text-white/80'}`}
              >{t.common.off}</button>
              <button
                onClick={() => setNoteNameMode('letter')}
                className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${noteNameMode === 'letter' ? 'bg-white/20 text-white shadow-sm' : 'text-white/40 hover:text-white/80'}`}
              >{t.player.letter}</button>
              <button
                onClick={() => setNoteNameMode('number')}
                className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${noteNameMode === 'number' ? 'bg-blue-500/30 text-blue-300 shadow-sm' : 'text-white/40 hover:text-white/80'}`}
              >{t.player.number}</button>
            </div>

            <div className="w-px h-6 bg-white/10 mx-1"></div>

            {/* Metronome */}
            <div className={`flex items-center rounded-full border transition-all shrink-0 h-8 ${metronomeOn ? 'border-amber-500/30 bg-amber-500/10' : 'border-white/10 bg-white/5'}`}>
              <button
                onClick={() => setMetronomeOn(!metronomeOn)}
                className={`flex items-center h-full px-4 rounded-l-full text-[10px] font-extrabold uppercase tracking-widest transition-all border-r border-white/5 ${metronomeOn ? 'text-amber-500' : 'text-white/40 hover:text-white/60'
                  }`}
              >
                {t.player.metronome}
              </button>
              <div className="px-3 flex items-center w-20">
                <input
                  type="range" min="0" max="100"
                  value={metronomeVol} onChange={e => setMetronomeVol(parseInt(e.target.value))}
                  className="w-full h-1 appearance-none bg-white/20 rounded accent-amber-500 cursor-pointer"
                />
              </div>
            </div>

          </div>

          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white/10 text-white/80 hover:bg-white/20 border border-white/20 transition-colors shrink-0 ml-4"
          >
            <X className="w-3.5 h-3.5 text-white/60" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Close</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function HomeTab({ t }: { t: any }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center animate-in fade-in duration-700 min-h-[60vh] text-center">
      {/* Empty centered content as requested */}
    </div>
  );
}

function TopNav({ activeView, setActiveView, tracks, onSelectTrack, currentLang, setCurrentLang, t }: {
  activeView: View,
  setActiveView: (v: View) => void,
  tracks: Track[],
  onSelectTrack: (t: Track) => void,
  currentLang: string,
  setCurrentLang: (v: string) => void,
  t: any
}) {
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
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
    { id: 'home', label: t.nav.home, icon: <Music className="w-4 h-4" /> },
    { id: 'music', label: t.nav.music },
    { id: 'focus', label: t.nav.focus },
    { id: 'settings', label: t.nav.settings }
  ];

  const activeLang = languages.find(l => l.name === currentLang) || languages[0];

  return (
    <header className="fixed top-6 left-0 right-0 z-50 flex justify-center px-6">
      <div className="glass-panel rounded-full px-6 py-3 flex items-center justify-between gap-4 max-w-6xl w-full shadow-md">

        {/* Empty div to balance the flex layout since brand is gone */}
        <div className="w-8 hidden md:block"></div>

        <nav className="flex items-center justify-center gap-2 md:gap-4 overflow-x-auto custom-scrollbar flex-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveView(tab.id)}
              className={`px-5 md:px-6 py-2 rounded-full transition-all duration-300 font-medium whitespace-nowrap flex items-center gap-2 ${activeView === tab.id
                ? 'glass-panel-active text-[var(--color-mist-text)] shadow-lg'
                : 'text-[var(--color-mist-text)]/60 hover:text-[var(--color-mist-text)] hover:bg-white/10'
                }`}
            >
              {tab.icon && tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-4 shrink-0">
          <div className="relative hidden lg:block">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-mist-text)]/40" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              className="bg-white/15 border border-white/25 rounded-full pl-9 pr-4 py-1.5 text-sm w-48 focus:outline-none focus:bg-white/25 transition-colors text-[var(--color-mist-text)] placeholder-[var(--color-mist-text)]/40"
            />

            <AnimatePresence>
              {showResults && searchQuery.trim() !== '' && (
                <>
                  <div className="fixed inset-0 z-[-1]" onClick={() => setShowResults(false)}></div>
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute top-full left-0 right-0 mt-3 glass-panel p-2 flex flex-col gap-1 min-w-[240px] shadow-2xl border border-white/20 z-[60] max-h-[400px] overflow-y-auto no-scrollbar"
                  >
                    {tracks.filter(t =>
                      normalizeSearchText(t?.title).includes(normalizeSearchText(searchQuery)) ||
                      normalizeSearchText(t?.artist).includes(normalizeSearchText(searchQuery))
                    ).map(track => (
                      <button
                        key={track.id}
                        onClick={() => {
                          onSelectTrack(track);
                          setSearchQuery('');
                          setShowResults(false);
                        }}
                        className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/20 transition-all text-left group"
                      >
                        <img src={track.sourceCoverUrl || track.coverUrl} className="w-10 h-10 rounded-lg object-cover shadow-sm" alt="" />
                        <div className="flex flex-col overflow-hidden">
                          <span className="text-sm font-bold text-[var(--color-mist-text)] truncate">{track.title}</span>
                          <span className="text-[10px] text-[var(--color-mist-text)]/50 truncate group-hover:text-[var(--color-mist-text)]/80 transition-colors uppercase font-bold tracking-tight">{track.artist}</span>
                        </div>
                      </button>
                    ))}
                    {tracks.filter(t =>
                      normalizeSearchText(t?.title).includes(normalizeSearchText(searchQuery)) ||
                      normalizeSearchText(t?.artist).includes(normalizeSearchText(searchQuery))
                    ).length === 0 && (
                        <div className="p-4 text-center text-xs text-[var(--color-mist-text)]/40 italic">No matches found</div>
                      )}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          <div className="relative">
            <button
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="px-3 py-1.5 rounded-full bg-white/15 flex items-center gap-2 hover:bg-white/25 transition-colors shrink-0 border border-white/25 text-[var(--color-mist-text)]"
            >
              <Globe className="w-4 h-4" />
              <span className="text-xs font-bold tracking-wider">{activeLang.code}</span>
            </button>

            <AnimatePresence>
              {showLangMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute top-full right-0 mt-3 glass-panel p-2 flex flex-col gap-1 min-w-[160px] shadow-xl border border-white/20 z-[60]"
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
    </header>
  );
}

function BottomPlayer({
  currentTrack,
  isPlaying,
  setIsPlaying,
  currentTime,
  setCurrentTime,
  duration,
  setDuration,
  playbackRate,
  setPlaybackRate,
  showPracticePanel,
  setShowPracticePanel,
  isPremium,
  currentLang,
  setShowSheetOptions,
  t
}: {
  currentTrack: Track,
  isPlaying: boolean,
  setIsPlaying: (v: boolean) => void,
  currentTime: number,
  setCurrentTime: (v: number) => void,
  duration: number,
  setDuration: (v: number) => void,
  playbackRate: number,
  setPlaybackRate: (v: number) => void,
  showPracticePanel: boolean,
  setShowPracticePanel: (v: boolean) => void,
  isPremium: boolean,
  currentLang: string,
  setShowSheetOptions: (v: boolean) => void,
  t: any
}) {
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<'repeat' | 'shuffle'>('repeat');
  const [smartRadioActive, setSmartRadioActive] = useState(false);
  const [showPremiumPrompt, setShowPremiumPrompt] = useState(false);

  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  const [lastVolume, setLastVolume] = useState(0.7);
  const audioRef = React.useRef<HTMLAudioElement>(null);

  const speeds = [0.5, 0.75, 1, 1.25, 1.5];

  // 【修复】解决因为浏览器缓存机制过快导致 onLoadedMetadata 事件不触发、引起时长始终为 0:00 的隐形 Bug
  React.useEffect(() => {
    if (audioRef.current && audioRef.current.readyState >= 1) {
      setDuration(audioRef.current.duration);
    }
  }, [currentTrack.audioUrl, setDuration]);

  React.useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  React.useEffect(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.play().catch(e => console.error("Playback failed", e));
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying, currentTrack.audioUrl]);

  React.useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (audioRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = x / rect.width;
      audioRef.current.currentTime = percentage * duration;
    }
  };

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSmartRadioClick = () => {
    if (isPremium) {
      setSmartRadioActive(!smartRadioActive);
    } else {
      setShowPremiumPrompt(true);
    }
  };

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-50 flex justify-center">
      <audio
        ref={audioRef}
        src={currentTrack.audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
      />
      {/* Premium Prompt Modal */}
      <AnimatePresence>
        {showPremiumPrompt && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPremiumPrompt(false)}
              className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative glass-panel p-8 rounded-[40px] max-w-sm w-full flex flex-col items-center gap-6 text-center shadow-2xl border border-white/30"
            >
              <div className="w-16 h-16 rounded-full bg-amber-600/10 flex items-center justify-center text-amber-600">
                <Sparkles className="w-8 h-8" />
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-xl font-bold text-[var(--color-mist-text)]">{t.premium.smartRadioTitle}</h3>
                <p className="text-sm text-[var(--color-mist-text)]/60 leading-relaxed">
                  {t.premium.smartRadioDesc}
                </p>
              </div>
              <button
                onClick={() => setShowPremiumPrompt(false)}
                className="w-full py-4 rounded-2xl bg-amber-600 text-white font-bold shadow-lg shadow-amber-600/20 hover:bg-amber-700 transition-colors"
              >
                {t.common.upgrade}
              </button>
              <button
                onClick={() => setShowPremiumPrompt(false)}
                className="text-xs font-bold uppercase tracking-widest text-[var(--color-mist-text)]/40 hover:text-[var(--color-mist-text)]/60 transition-colors"
              >
                Maybe Later
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="player-bar p-4 flex items-center gap-6 w-full px-6 md:px-12 h-24">
        <div className="flex items-center gap-4 w-1/4 min-w-[200px]">
          <img
            src={(currentTrack.metadataStatus === 'approved' && currentTrack.sourceCoverUrl) ? currentTrack.sourceCoverUrl : (currentTrack.coverUrl || 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?q=80&w=200&auto=format&fit=crop')}
            alt="Album Art"
            className="w-14 h-14 rounded-lg object-cover shadow-md"
            referrerPolicy="no-referrer"
          />
          <div className="flex flex-col overflow-hidden">
            <span className="font-medium text-[var(--color-mist-text)] truncate">{(currentTrack.metadataStatus === 'approved' && currentTrack.sourceSongTitle) ? currentTrack.sourceSongTitle : currentTrack.title}</span>
            <span className="text-sm text-[var(--color-mist-text)]/60 truncate">{(currentTrack.metadataStatus === 'approved' && currentTrack.sourceArtist) ? currentTrack.sourceArtist : currentTrack.artist}</span>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center gap-2">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setPlaybackMode(playbackMode === 'repeat' ? 'shuffle' : 'repeat')}
              className={`transition-all duration-300 flex flex-col items-center gap-0.5 ${playbackMode === 'shuffle' ? 'text-amber-600' : 'text-[var(--color-mist-text)]/60 hover:text-[var(--color-mist-text)]'}`}
              title={playbackMode === 'repeat' ? "Switch to Shuffle" : "Switch to Repeat"}
            >
              {playbackMode === 'repeat' ? <Repeat className="w-4 h-4" /> : <Shuffle className="w-4 h-4" />}
              <div className={`w-1 h-1 rounded-full bg-current transition-opacity ${playbackMode === 'shuffle' ? 'opacity-100' : 'opacity-0'}`}></div>
            </button>

            <button className="text-[var(--color-mist-text)]/80 hover:text-[var(--color-mist-text)] transition-colors">
              <SkipBack className="w-5 h-5 fill-current" />
            </button>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors text-[var(--color-mist-text)] border border-white/30"
            >
              {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
            </button>
            <button className="text-[var(--color-mist-text)]/80 hover:text-[var(--color-mist-text)] transition-colors">
              <SkipForward className="w-5 h-5 fill-current" />
            </button>

            <div className="relative flex flex-col items-center">
              <button
                onClick={handleSmartRadioClick}
                className={`transition-all duration-300 flex flex-col items-center gap-0.5 ${isPremium
                  ? (smartRadioActive ? 'text-amber-600 scale-110' : 'text-[var(--color-mist-text)]/60 hover:text-[var(--color-mist-text)]')
                  : 'text-[var(--color-mist-text)]/20 hover:text-[var(--color-mist-text)]/40'
                  }`}
                title="Smart Radio"
              >
                <Radio className="w-4 h-4" />
                {isPremium && smartRadioActive && (
                  <div className="w-1 h-1 rounded-full bg-amber-600 animate-pulse"></div>
                )}
              </button>
              {isPremium && smartRadioActive && (
                <span className="absolute -bottom-6 whitespace-nowrap text-[8px] font-bold uppercase tracking-widest text-amber-600/60 animate-in fade-in slide-in-from-top-1 duration-500">
                  {t.premium.smartRadioTitle}
                </span>
              )}
            </div>
          </div>

          <div className="w-full max-w-2xl flex items-center gap-3 text-xs text-[var(--color-mist-text)]/50 font-mono">
            <span>{formatTime(currentTime)}</span>
            <div
              className="flex-1 h-1 bg-white/15 rounded-full overflow-hidden cursor-pointer group"
              onClick={handleProgressClick}
            >
              <div
                className="h-full bg-[var(--color-mist-text)]/40 group-hover:bg-[var(--color-mist-text)]/60 transition-colors relative"
                style={{ width: `${(currentTime / duration) * 100}%` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-[var(--color-mist-text)] rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"></div>
              </div>
            </div>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="w-1/4 min-w-[200px] flex items-center justify-end gap-5">
          <button
            onClick={() => currentTrack.midiUrl && setShowPracticePanel(!showPracticePanel)}
            disabled={!currentTrack.midiUrl}
            className={`flex flex-col items-center gap-1 transition-all ${!currentTrack.midiUrl
              ? 'opacity-20 cursor-not-allowed'
              : showPracticePanel
                ? 'text-[var(--color-mist-text)] scale-110'
                : 'text-[var(--color-mist-text)]/60 hover:text-[var(--color-mist-text)]'
              }`}
            title={currentTrack.midiUrl ? t.player.practiceMode : t.player.practiceNotAvailable}
          >
            <Piano className="w-5 h-5" />
            <span className="text-[10px] uppercase tracking-tighter font-medium">{t.music.practice}</span>
          </button>

          <button
            onClick={() => {
              if (currentTrack) {
                // Logic: 只有 简体中文 跳 Bilibili，其他（EN, 繁體）跳 YouTube
                const isCN = currentLang === '简体中文';
                const url = isCN
                  ? (currentTrack.bilibiliUrl || currentTrack.youtubeUrl)
                  : (currentTrack.youtubeUrl || currentTrack.bilibiliUrl);
                if (url) window.open(url, '_blank');
              }
            }}
            disabled={!currentTrack.youtubeUrl && !currentTrack.bilibiliUrl}
            className={`flex flex-col items-center gap-1 transition-colors ${(currentTrack.youtubeUrl || currentTrack.bilibiliUrl) ? 'text-[var(--color-mist-text)]/60 hover:text-[var(--color-mist-text)]' : 'text-[var(--color-mist-text)]/20 cursor-not-allowed'}`}
            title={currentTrack.youtubeUrl || currentTrack.bilibiliUrl ? t.player.watchVideo : t.player.videoNotAvailable}
          >
            <Youtube className="w-5 h-5" />
            <span className="text-[10px] uppercase tracking-tighter font-bold">{t.player.video}</span>
          </button>

          <button
            onClick={() => currentTrack.sheetUrl && window.open(currentTrack.sheetUrl, '_blank')}
            disabled={!currentTrack.sheetUrl}
            className={`flex flex-col items-center gap-1 transition-colors ${currentTrack.sheetUrl ? 'text-[var(--color-mist-text)]/60 hover:text-[var(--color-mist-text)]' : 'text-[var(--color-mist-text)]/20 cursor-not-allowed'}`}
            title={currentTrack.sheetUrl ? t.player.sheetMusic : t.player.sheetNotAvailable}
          >
            <BookOpen className="w-5 h-5" />
            <span className="text-[10px] uppercase tracking-tighter font-bold">{t.player.sheet}</span>
          </button>

          <div className="relative">
            <button
              onClick={() => setShowSpeedMenu(!showSpeedMenu)}
              className="text-[var(--color-mist-text)]/60 hover:text-[var(--color-mist-text)] transition-colors flex flex-col items-center gap-1 min-w-[40px]"
              title="Playback Speed"
            >
              <Clock className="w-5 h-5" />
              <span className="text-[10px] font-medium">{playbackRate}x</span>
            </button>

            {showSpeedMenu && (
              <div className="absolute bottom-full mb-4 right-0 glass-panel p-2 flex flex-col gap-1 min-w-[80px] animate-in slide-in-from-bottom-2 duration-200">
                {speeds.map(s => (
                  <button
                    key={s}
                    onClick={() => {
                      setPlaybackRate(s);
                      setShowSpeedMenu(false);
                    }}
                    className={`px-3 py-1.5 text-xs rounded-lg text-left transition-colors ${playbackRate === s ? 'bg-white/20 text-[var(--color-mist-text)]' : 'text-[var(--color-mist-text)]/60 hover:bg-white/10'}`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (isMuted) {
                  setIsMuted(false);
                  if (volume === 0) setVolume(lastVolume || 0.7);
                } else {
                  setLastVolume(volume);
                  setIsMuted(true);
                }
              }}
              className="text-[var(--color-mist-text)]/60 hover:text-[var(--color-mist-text)] transition-colors"
            >
              {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : volume < 0.5 ? <Volume1 className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <div
              className="w-20 h-1 bg-white/20 rounded-full overflow-hidden cursor-pointer group"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const newVolume = Math.max(0, Math.min(1, x / rect.width));
                setVolume(newVolume);
                if (newVolume > 0) setIsMuted(false);
              }}
            >
              <div
                className="h-full bg-[var(--color-mist-text)]/60 group-hover:bg-[var(--color-mist-text)] transition-colors"
                style={{ width: `${isMuted ? 0 : volume * 100}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

function MusicTab({
  tracks,
  artistsData,
  currentTrack,
  setCurrentTrack,
  isPlaying,
  setIsPlaying,
  t,
  currentLang
}: {
  tracks: Track[],
  artistsData: any[],
  currentTrack: Track,
  setCurrentTrack: (t: Track) => void,
  isPlaying: boolean,
  setIsPlaying: (v: boolean) => void,
  t: any,
  currentLang: string
}) {
  const normalizeText = (value: unknown) => {
    if (typeof value === 'string') return value;
    if (value == null) return '';
    return String(value);
  };
  const normalizeSearchValue = (value: unknown) => normalizeText(value).trim().toLowerCase();
  const normalizeCategoryKey = (value: unknown) => normalizeSearchValue(value).replace(/[^a-z0-9]+/g, '');
  const parseDurationToSeconds = (value: unknown) => {
    const [minsRaw, secsRaw] = normalizeText(value).split(':');
    const mins = Number.parseInt(minsRaw ?? '', 10);
    const secs = Number.parseInt(secsRaw ?? '', 10);
    return (Number.isFinite(mins) ? mins : 0) * 60 + (Number.isFinite(secs) ? secs : 0);
  };
  const MUSIC_ALL_CATEGORY = 'all';
  const artistCategoryOptions = [
    { value: 'all', label: t.categories.all },
    { value: 'male', label: t.categories.male },
    { value: 'female', label: t.categories.female },
    { value: 'group', label: t.categories.group },
    { value: 'solo', label: t.categories.solo },
    { value: 'us', label: t.categories.us },
    { value: 'korea', label: t.categories.korea },
    { value: 'japan', label: t.categories.japan },
    { value: 'china', label: t.categories.china },
    { value: 'global', label: t.categories.global }
  ];
  const songCategoryOptions = [
    { value: MUSIC_ALL_CATEGORY, label: t.categories.all },
    { value: 'cpop', label: t.categories.cpop },
    { value: 'kpop', label: t.categories.kpop },
    { value: 'jpop', label: t.categories.jpop },
    { value: 'western', label: t.categories.western },
    { value: 'anime', label: t.categories.anime },
    { value: 'film', label: t.categories.film },
    { value: 'game', label: t.categories.game },
    { value: 'instrumental', label: t.categories.instrumental },
    { value: 'originals', label: 'Originals' }
  ];
  const [musicView, setMusicView] = useState<'artists' | 'songs' | 'artist_detail'>('artists');
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([MUSIC_ALL_CATEGORY]);
  const [sortBy, setSortBy] = useState<'recently_played' | 'a_z' | 'duration'>('recently_played');

  const [artistSearchQuery, setArtistSearchQuery] = useState('');
  const [selectedArtistCategories, setSelectedArtistCategories] = useState<string[]>(['all']);
  const [artistSortBy, setArtistSortBy] = useState<'a_z' | 'z_a' | 'most_songs'>('a_z');

  const artistsMap = new Map<string, { name: string, displayName: string, songCount: number, coverUrl: string, region: string, gender: string, type: string }>();

  // 1. Initialize from true artistsData
  artistsData.forEach(a => {
    const artistName = normalizeText(a?.name).trim() || 'Unknown Artist';
    const fallbackArtistAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(artistName) + '&background=random&color=fff&size=200';
    const coverUrl = (a.metadata_status === 'approved' && a.source_artist_image_url) ? a.source_artist_image_url : fallbackArtistAvatar;
    const displayName = normalizeText((a.metadata_status === 'approved' && a.source_artist_name) ? a.source_artist_name : artistName).trim() || artistName;

    artistsMap.set(artistName, {
      name: artistName,
      displayName: displayName,
      songCount: 0,
      coverUrl: coverUrl,
      region: normalizeText(a.source_region || a.region || 'Global').trim() || 'Global',
      gender: normalizeText(a.gender || 'Mixed').trim() || 'Mixed',
      type: normalizeText(a.type || 'Group').trim() || 'Group'
    });
  });

  // 2. Aggregate song count purely based on tracks array
  tracks.forEach(t => {
    const artistName = normalizeText(t?.artist).trim() || 'Unknown Artist';
    if (artistsMap.has(artistName)) {
      artistsMap.get(artistName)!.songCount++;
    } else {
      // 容错：防止有孤儿数据
      const fallbackArtistAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(artistName) + '&background=random&color=fff&size=200';
      artistsMap.set(artistName, {
        name: artistName,
        displayName: artistName,
        songCount: 1,
        coverUrl: fallbackArtistAvatar,
        region: 'Global',
        gender: 'Mixed',
        type: 'Group'
      });
    }
  });

  const artists = Array.from(artistsMap.values());

  const toggleCategory = (cat: string) => {
    if (cat === MUSIC_ALL_CATEGORY) {
      setSelectedCategories([MUSIC_ALL_CATEGORY]);
    } else {
      let newCats = selectedCategories.filter(c => c !== MUSIC_ALL_CATEGORY);
      if (newCats.includes(cat)) {
        newCats = newCats.filter(c => c !== cat);
        if (newCats.length === 0) newCats = [MUSIC_ALL_CATEGORY];
      } else {
        newCats.push(cat);
      }
      setSelectedCategories(newCats);
    }
  };

  const toggleArtistCategory = (cat: string) => {
    if (cat === 'all') {
      setSelectedArtistCategories(['all']);
    } else {
      let newCats = selectedArtistCategories.filter(c => c !== 'all');
      if (newCats.includes(cat)) {
        newCats = newCats.filter(c => c !== cat);
        if (newCats.length === 0) newCats = ['all'];
      } else {
        newCats.push(cat);
      }
      setSelectedArtistCategories(newCats);
    }
  };

  const renderArtists = () => {
    let filteredArtists = artists.filter(a => {
      const matchesSearch = normalizeSearchValue(a.name).includes(normalizeSearchValue(artistSearchQuery));
      const artistTokens = [
        normalizeCategoryKey(a.gender),
        normalizeCategoryKey(a.type),
        normalizeCategoryKey(a.region)
      ];
      const matchesCategory = selectedArtistCategories.includes('all') ||
        selectedArtistCategories.some(selected => artistTokens.includes(selected));

      return matchesSearch && matchesCategory;
    });

    if (artistSortBy === 'a_z') {
      filteredArtists.sort((a, b) => normalizeText(a.name).localeCompare(normalizeText(b.name)));
    } else if (artistSortBy === 'z_a') {
      filteredArtists.sort((a, b) => normalizeText(b.name).localeCompare(normalizeText(a.name)));
    } else if (artistSortBy === 'most_songs') {
      filteredArtists.sort((a, b) => b.songCount - a.songCount);
    }

    return (
      <div className="flex flex-col animate-in fade-in duration-500">
        <div className="flex flex-col gap-6 mb-8 p-8 rounded-[32px] glass-effect border border-white/20 shadow-xl">
          <div className="flex justify-between items-center">
            <h2 className="text-3xl font-medium tracking-wide text-[var(--color-mist-text)] drop-shadow-sm">{t.music.artists}</h2>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-mist-text)]/40" />
                <input
                  type="text"
                  placeholder={t.music.searchArtists}
                  value={artistSearchQuery}
                  onChange={(e) => setArtistSearchQuery(e.target.value)}
                  className="bg-white/10 glass-utility border border-white/20 rounded-full pl-12 pr-6 py-2.5 text-sm w-64 focus:outline-none focus:bg-white/20 transition-colors text-[var(--color-mist-text)] placeholder-[var(--color-mist-text)]/40"
                />
              </div>
              <select
                value={artistSortBy}
                onChange={(e) => setArtistSortBy(e.target.value as any)}
                className="bg-white/10 glass-utility border border-white/20 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:bg-white/20 transition-colors text-[var(--color-mist-text)] appearance-none cursor-pointer"
              >
                <option value="a_z" className="bg-[#d6d0c8] text-[var(--color-mist-text)]">{t.music.az}</option>
                <option value="z_a" className="bg-[#d6d0c8] text-[var(--color-mist-text)]">{t.music.za}</option>
                <option value="most_songs" className="bg-[#d6d0c8] text-[var(--color-mist-text)]">{t.music.mostSongs}</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {artistCategoryOptions.map(option => (
              <button
                key={option.value}
                onClick={() => toggleArtistCategory(option.value)}
                className={`px-4 py-1.5 rounded-full text-sm transition-colors border ${selectedArtistCategories.includes(option.value)
                  ? 'bg-white/30 border-white/40 text-[var(--color-mist-text)] shadow-sm'
                  : 'bg-white/10 border-white/20 text-[var(--color-mist-text)]/70 hover:bg-white/20'
                  }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredArtists.map(artist => (
            <div
              key={artist.name}
              onClick={() => {
                setSelectedArtist(artist.name);
                setMusicView('artist_detail');
                setSelectedCategories([MUSIC_ALL_CATEGORY]);
                setSearchQuery('');
              }}
              className="glass-panel p-6 rounded-3xl cursor-pointer hover:bg-white/10 transition-colors flex flex-col items-center text-center gap-4 group"
            >
              <img
                src={artist.coverUrl}
                alt={artist.name}
                className="w-32 h-32 rounded-full object-cover shadow-lg group-hover:scale-105 transition-transform duration-300"
                referrerPolicy="no-referrer"
              />
              <div className="flex flex-col">
                <span className="font-medium text-lg text-[var(--color-mist-text)]">{artist.displayName}</span>
                <span className="text-sm text-[var(--color-mist-text)]/60">
                  {currentLang === 'English' ?
                    `${artist.songCount} ${artist.songCount === 1 ? 'song' : 'songs'}` :
                    t.music.songCount.replace('{{count}}', String(artist.songCount))
                  }
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderSongsList = (artistFilter: string | null) => {
    let filteredTracks = tracks.filter(t => {
      const trackArtist = normalizeText(t?.artist).trim();
      if (artistFilter && trackArtist !== artistFilter) return false;

      const normalizedSearch = normalizeSearchValue(searchQuery);
      const categoryKey = normalizeCategoryKey(t?.category);
      const tagKeys = Array.isArray(t?.tags) ? t.tags.map(tag => normalizeCategoryKey(tag)).filter(Boolean) : [];
      const matchesSearch = normalizedSearch === '' ||
        normalizeSearchValue(t?.title).includes(normalizedSearch) ||
        categoryKey.includes(normalizedSearch.replace(/[^a-z0-9]+/g, '')) ||
        normalizeSearchValue(trackArtist).includes(normalizedSearch) ||
        tagKeys.some(tag => tag.includes(normalizedSearch.replace(/[^a-z0-9]+/g, '')));

      const matchesCategory = selectedCategories.includes(MUSIC_ALL_CATEGORY) ||
        selectedCategories.includes(categoryKey) ||
        tagKeys.some(tag => selectedCategories.includes(tag));

      return matchesSearch && matchesCategory;
    });

    if (sortBy === 'a_z') {
      filteredTracks.sort((a, b) => normalizeText(a?.title).localeCompare(normalizeText(b?.title)));
    } else if (sortBy === 'duration') {
      filteredTracks.sort((a, b) => parseDurationToSeconds(a?.duration) - parseDurationToSeconds(b?.duration));
    }

    return (
      <div className="flex flex-col animate-in fade-in duration-500">
        <div className="flex flex-col gap-6 mb-8 p-8 rounded-[32px] glass-effect border border-white/20 shadow-xl">
          <div className="flex justify-between items-center">
            {artistFilter ? (
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setMusicView('artists')}
                  className="w-10 h-10 rounded-full bg-white/20 glass-utility flex items-center justify-center hover:bg-white/30 transition-colors text-[var(--color-mist-text)] border border-white/20"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <h2 className="text-3xl font-medium tracking-wide text-[var(--color-mist-text)] drop-shadow-sm">{artistFilter}</h2>
              </div>
            ) : (
              <h2 className="text-3xl font-medium tracking-wide text-[var(--color-mist-text)] drop-shadow-sm">{t.music.all + ' ' + t.music.songs}</h2>
            )}
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-mist-text)]/40" />
                <input
                  type="text"
                  placeholder={t.nav.search}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-white/10 glass-utility border border-white/20 rounded-full pl-12 pr-6 py-2.5 text-sm w-64 focus:outline-none focus:bg-white/20 transition-colors text-[var(--color-mist-text)] placeholder-[var(--color-mist-text)]/40"
                />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-white/10 glass-utility border border-white/20 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:bg-white/20 transition-colors text-[var(--color-mist-text)] appearance-none cursor-pointer"
              >
                <option value="recently_played" className="bg-[#d6d0c8] text-[var(--color-mist-text)]">{t.music.recentlyPlayed}</option>
                <option value="a_z" className="bg-[#d6d0c8] text-[var(--color-mist-text)]">{t.music.az}</option>
                <option value="duration" className="bg-[#d6d0c8] text-[var(--color-mist-text)]">{t.music.duration}</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {songCategoryOptions.map(option => {
              const isSelected = selectedCategories.includes(option.value);

              return (
                <button
                  key={option.value}
                  onClick={() => toggleCategory(option.value)}
                  className={`px-4 py-1.5 rounded-full text-sm transition-colors border ${isSelected
                    ? 'bg-white/25 border-white/30 text-[var(--color-mist-text)] shadow-sm'
                    : 'bg-white/10 border-white/20 text-[var(--color-mist-text)]/60 hover:bg-white/20'
                    }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="glass-panel rounded-[32px] overflow-hidden flex flex-col">
          <div className="grid grid-cols-12 gap-4 px-8 py-4 border-b border-white/10 text-sm font-medium text-[var(--color-mist-text)]/60 uppercase tracking-wider">
            <div className="col-span-1 text-center">#</div>
            <div className="col-span-6">{t.music.title}</div>
            <div className="col-span-3">{t.music.category}</div>
            <div className="col-span-2 text-right">{t.music.duration}</div>
          </div>

          <div className="flex flex-col overflow-y-auto max-h-[50vh] custom-scrollbar">
            {filteredTracks.map((track, index) => {
              const isActive = currentTrack.id === track.id;
              return (
                <div
                  key={track.id}
                  onClick={() => {
                    setCurrentTrack(track);
                    setIsPlaying(true);
                  }}
                  className={`grid grid-cols-12 gap-4 px-8 py-4 items-center cursor-pointer transition-colors border-b border-white/10 last:border-0 hover:bg-white/10 ${isActive ? 'bg-white/20' : ''}`}
                >
                  <div className="col-span-1 text-center text-[var(--color-mist-text)]/50">
                    {isActive && isPlaying ? (
                      <div className="flex items-center justify-center gap-1 h-4">
                        <div className="w-1 h-3 bg-[var(--color-mist-text)]/40 rounded-sm animate-pulse"></div>
                        <div className="w-1 h-4 bg-[var(--color-mist-text)]/40 rounded-sm animate-pulse delay-75"></div>
                        <div className="w-1 h-2 bg-[var(--color-mist-text)]/40 rounded-sm animate-pulse delay-150"></div>
                      </div>
                    ) : (
                      index + 1
                    )}
                  </div>
                  <div className="col-span-6 flex items-center gap-4">
                    <img src={(track.metadataStatus === 'approved' && track.sourceCoverUrl) ? track.sourceCoverUrl : (track.coverUrl || 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?q=80&w=200&auto=format&fit=crop')} alt={track.title} className="w-10 h-10 rounded-md object-cover shadow-sm" referrerPolicy="no-referrer" />
                    <div className="flex flex-col overflow-hidden">
                      <span className={`font-medium truncate ${isActive ? 'text-[var(--color-mist-text)] underline decoration-amber-600/30 underline-offset-4' : 'text-[var(--color-mist-text)]'}`}>{normalizeText(track.title) || 'Untitled'}</span>
                      <span className="text-xs text-[var(--color-mist-text)]/60 truncate">{normalizeText(track.artist) || 'Unknown Artist'}</span>
                    </div>
                  </div>
                  <div className="col-span-3 flex items-center">
                    <span className="px-3 py-1 rounded-full bg-white/20 text-xs text-[var(--color-mist-text)]/80 border border-white/20">
                      {songCategoryOptions.find(option => option.value === normalizeCategoryKey(track.category))?.label || normalizeText(track.category) || 'Uncategorized'}
                    </span>
                  </div>
                  <div className="col-span-2 text-right text-[var(--color-mist-text)]/60 text-sm font-mono">
                    {normalizeText(track.duration) || '00:00'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col animate-in fade-in duration-500">
      {musicView !== 'artist_detail' && (
        <div className="flex justify-center mb-8">
          <div className="glass-effect border border-white/10 rounded-full p-1 flex items-center shadow-lg">
            <button
              onClick={() => setMusicView('artists')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${musicView === 'artists' ? 'bg-white/20 text-[var(--color-mist-text)] shadow-sm' : 'text-[var(--color-mist-text)]/60 hover:text-[var(--color-mist-text)]'}`}
            >
              {t.music.artists}
            </button>
            <button
              onClick={() => setMusicView('songs')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${musicView === 'songs' ? 'bg-white/20 text-[var(--color-mist-text)] shadow-sm' : 'text-[var(--color-mist-text)]/60 hover:text-[var(--color-mist-text)]'}`}
            >
              {t.music.songs}
            </button>
          </div>
        </div>
      )}

      {musicView === 'artists' && renderArtists()}
      {musicView === 'songs' && renderSongsList(null)}
      {musicView === 'artist_detail' && renderSongsList(selectedArtist)}
    </div>
  );
}

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
        className="absolute left-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full glass-effect flex items-center justify-center text-[var(--color-mist-text)] opacity-60 hover:opacity-100 hover:scale-105 transition-all duration-300 shadow-xl border border-white/30"
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
        className="absolute right-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full glass-effect flex items-center justify-center text-[var(--color-mist-text)] opacity-60 hover:opacity-100 hover:scale-105 transition-all duration-300 shadow-xl border border-white/30"
        aria-label="Scroll right"
      >
        <ChevronRight className="w-6 h-6" />
      </button>
    </div>
  );
}

function FocusTab({
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
  activeAmbiences: string[],
  setActiveAmbiences: React.Dispatch<React.SetStateAction<string[]>>,
  ambienceVolumes: Record<string, number>,
  setAmbienceVolumes: (v: Record<string, number>) => void,
  toggleAmbience: (id: string) => void,
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

  const isPremium_local = false; // UI only — now using prop

  // Ambience catalog — each item is an independently playable sound layer
  const ambienceGroups = [
    {
      title: t.ambient.nature,
      items: [
        {
          id: 'window_rain',
          name: t.ambient.windowRain,
          icon: CloudRain,
          imageUrl: 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=800&q=80',
          audioUrl: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/windowrain.mp3',
          tag: 'nature',
        },
        {
          id: 'thunderstorm',
          name: t.ambient.thunderstorm,
          icon: CloudLightning,
          imageUrl: 'https://images.unsplash.com/photo-1605727216801-e27ce1d0cc28?auto=format&fit=crop&w=800&q=80',
          audioUrl: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/thunderstorm.mp3',
          tag: 'nature',
        },
        {
          id: 'ocean',
          name: t.ambient.ocean,
          icon: Waves,
          imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80',
          audioUrl: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/ocean.mp3',
          tag: 'nature',
        },
        {
          id: 'forest',
          name: t.ambient.forest,
          icon: TreeDeciduous,
          imageUrl: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=800&q=80',
          audioUrl: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/forest.mp3',
          tag: 'nature',
        },
        {
          id: 'white_noise',
          name: t.ambient.whiteNoise,
          icon: Wind,
          imageUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80',
          audioUrl: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/whitenoise.mp3',
          tag: 'white_noise',
        },
        {
          id: 'night_ambient',
          name: t.ambient.nightAmbient,
          icon: Moon,
          imageUrl: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=800&q=80',
          audioUrl: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/night.mp3',
          tag: 'nature',
        },
        {
          id: 'library',
          name: t.ambient.library,
          icon: Library,
          imageUrl: 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=800&q=80',
          audioUrl: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/library.mp3',
          tag: 'indoor',
        },
        {
          id: 'fireplace',
          name: t.ambient.fireplace,
          icon: Flame,
          imageUrl: 'https://images.unsplash.com/photo-1542181961-9590d0c79dab?auto=format&fit=crop&w=800&q=80',
          audioUrl: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/fireplace.mp3',
          tag: 'indoor',
        },
        {
          id: 'cafe',
          name: t.ambient.cafe,
          icon: Coffee,
          imageUrl: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=800&q=80',
          audioUrl: 'https://hngtwkayovuxhiqustsa.supabase.co/storage/v1/object/public/sfx/cafe.mp3',
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
    const toApply = isPremium ? preset.ambience : preset.ambience.slice(0, 1);
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
    <div className="w-full max-w-5xl mx-auto animate-in fade-in duration-500 pb-12">
      <div className="glass-effect p-8 rounded-[40px] flex flex-col gap-10">

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
                  <img src={scene.thumbnail} alt={t.themes[scene.id as keyof typeof t.themes]} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" referrerPolicy="no-referrer" />
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
          <h3 className="text-lg font-medium text-[var(--color-mist-text)] ml-1">{t.home.ambience}</h3>
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

          <div className="glass-panel px-6 py-5 flex flex-col gap-5 shadow-sm">

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
                    className="px-8 py-2.5 rounded-full bg-amber-600 text-white text-sm font-bold hover:bg-amber-500 transition-all shadow-lg shadow-amber-900/20 active:scale-95"
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
                      status === 'paused' ? 'bg-amber-500/20 text-amber-400' :
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
}

function SettingsTab({
  isPremium,
  setIsPremium,
  isGuest,
  accountTier,
  showDevPreview,
  setDevAccountTier,
  setActiveView,
  setShowSheetOptions,
  currentLang,
  t
}: {
  isPremium: boolean,
  setIsPremium: (v: boolean) => void,
  isGuest: boolean,
  accountTier: 'guest' | 'basic' | 'premium',
  showDevPreview: boolean,
  setDevAccountTier: (v: 'guest' | 'basic' | 'premium' | null) => void,
  setActiveView: (v: View) => void,
  setShowSheetOptions: (v: boolean) => void,
  currentLang: string,
  t: any
}) {
  const accountName = isGuest ? t.settings.guestTitle : 'AlexChenMusic';
  const accountEmail = isGuest ? '' : 'alex.chen@example.com';
  const planName = isPremium ? t.settings.premiumPlanName : t.settings.basicPlanName;
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
  const cardClass = 'glass-panel rounded-[32px] border border-white/18 bg-white/10 p-6 shadow-[0_18px_40px_rgba(72,54,37,0.12)] backdrop-blur-xl';
  const subtleCardClass = 'rounded-[24px] border border-white/16 bg-white/12 shadow-[0_10px_24px_rgba(72,54,37,0.08)]';
  const titleClass = 'text-[24px] font-semibold tracking-tight text-[var(--color-mist-text)]';
  const bodyClass = 'text-sm leading-6 text-[var(--color-mist-text)]/72';
  const infoLabelClass = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-mist-text)]/38';
  const infoValueClass = 'mt-2 text-[15px] font-medium text-[var(--color-mist-text)]/88';
  const actionButtonClass = 'inline-flex h-11 items-center justify-center rounded-2xl px-4 text-sm font-semibold transition-colors';
  const primaryButtonClass = `${actionButtonClass} bg-white/70 text-[var(--color-mist-text)] shadow-sm hover:bg-white/85`;
  const secondaryButtonClass = `${actionButtonClass} border border-white/18 bg-white/14 text-[var(--color-mist-text)]/84 hover:bg-white/22`;
  const tertiaryButtonClass = 'inline-flex h-10 items-center justify-center rounded-2xl px-3 text-sm font-medium text-[var(--color-mist-text)]/68 transition-colors hover:bg-white/12 hover:text-[var(--color-mist-text)]/84';
  const badgeClass = `inline-flex h-7 items-center rounded-full px-3 text-[11px] font-semibold whitespace-nowrap ${isGuest ? 'bg-white/35 text-[var(--color-mist-text)]/78' : isPremium ? 'bg-amber-500/18 text-amber-800/80' : 'bg-white/35 text-[var(--color-mist-text)]/78'}`;
  const iconWrapClass = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/14 bg-white/16 text-[var(--color-mist-text)]/60';
  const detailRowClass = 'flex items-start justify-between gap-4';
  const benefitCards = t.premium.benefits.slice(0, 4);
  const memberCenterTitle = currentLang === 'English' ? 'Membership' : t.settings.memberCenter;
  const premiumFeatureLead = currentLang === 'English'
    ? 'Available with Premium'
    : currentLang === '繁體中文'
      ? '升級後可解鎖'
      : '升级后可解锁';
  const premiumManageAction = () => {
    window.open('mailto:cipmusicstudios@gmail.com?subject=Membership%20Support', '_blank');
  };
  const upgradeButtonClass = 'inline-flex h-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(182,132,84,0.95),rgba(213,168,120,0.92))] px-6 text-[15px] font-semibold text-white shadow-[0_14px_30px_rgba(156,109,63,0.24)] transition-transform hover:translate-y-[-1px] hover:shadow-[0_18px_34px_rgba(156,109,63,0.28)]';
  const handleGuestPrimary = () => {
    if (showDevPreview) setDevAccountTier('basic');
  };
  const handleGuestSecondary = () => {
    if (showDevPreview) setDevAccountTier('basic');
  };
  const handleUpgrade = () => {
    if (showDevPreview) setDevAccountTier('premium');
    setIsPremium(true);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-20">
      {showDevPreview && (
        <div className="self-start rounded-full border border-white/18 bg-white/18 px-2 py-2 shadow-[0_12px_30px_rgba(72,54,37,0.08)] backdrop-blur-md">
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

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.06fr_1.02fr_0.88fr]">
        <section className={`${cardClass} flex min-h-[520px] flex-col`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={iconWrapClass}>
                <User className="h-4.5 w-4.5" />
              </div>
              <h2 className={titleClass}>{isGuest ? t.settings.guestTitle : t.settings.account}</h2>
            </div>
            {!isGuest && (
              <span className={badgeClass}>
                {isPremium ? t.settings.premiumMember : t.settings.freeMember}
              </span>
            )}
          </div>

          {isGuest ? (
            <div className="mt-6 flex flex-1 flex-col gap-6">
              <div className={`${subtleCardClass} flex min-h-[210px] flex-col items-center justify-center gap-4 px-6 py-8 text-center`}>
                <div className="flex h-16 w-16 items-center justify-center rounded-[24px] border border-white/36 bg-white/40 text-[var(--color-mist-text)]/76 shadow-sm">
                  <Lock className="h-7 w-7" />
                </div>
                <p className={`${bodyClass} max-w-[24rem]`}>{t.settings.guestDesc}</p>
              </div>
              <div className="mt-auto grid gap-3 sm:grid-cols-2">
                <button onClick={handleGuestPrimary} className={primaryButtonClass}>{t.common.signUp}</button>
                <button onClick={handleGuestSecondary} className={secondaryButtonClass}>{t.common.logIn}</button>
              </div>
            </div>
          ) : (
            <div className="mt-6 flex flex-1 flex-col gap-4">
              <div className={`${subtleCardClass} grid gap-4 px-4 py-4`}>
                <div>
                  <p className={infoLabelClass}>{t.settings.username}</p>
                  <p className={infoValueClass}>{accountName}</p>
                </div>
                <div>
                  <p className={infoLabelClass}>{t.settings.email}</p>
                  <p className={infoValueClass}>{accountEmail}</p>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-white/14 pt-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-mist-text)]/42">{t.settings.signInMethod}</span>
                  <span className="text-sm font-medium text-[var(--color-mist-text)]/70">Google</span>
                </div>
              </div>

              <div className={`${subtleCardClass} flex items-center justify-between gap-3 px-3 py-3`}>
                <button className={secondaryButtonClass}>{t.settings.changePassword}</button>
                <button className="inline-flex h-10 items-center justify-center rounded-2xl px-3 text-sm font-medium text-[var(--color-mist-text)]/54 transition-colors hover:bg-white/10 hover:text-[var(--color-mist-text)]/78">
                  {t.settings.logout}
                </button>
              </div>

              <div className="mt-auto grid gap-3 sm:grid-cols-2">
                <button className={`${subtleCardClass} flex items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-white/18`}>
                  <div className={iconWrapClass}>
                    <Heart className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-semibold text-[var(--color-mist-text)]/86">{t.settings.myFavorites}</span>
                </button>
                <button className={`${subtleCardClass} flex items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-white/18`}>
                  <div className={iconWrapClass}>
                    <History className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-semibold text-[var(--color-mist-text)]/86">{t.settings.recentlyPlayed}</span>
                </button>
              </div>
            </div>
          )}
        </section>

        <section className={`${cardClass} flex min-h-[520px] flex-col`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={iconWrapClass}>
                <Sparkles className="h-4.5 w-4.5" />
              </div>
              <h2 className={titleClass}>{memberCenterTitle}</h2>
            </div>
            {!isGuest && (
              <span className={badgeClass}>
                {isPremium ? t.settings.premiumMember : t.settings.freeMember}
              </span>
            )}
          </div>

          <div className="mt-6 flex flex-1 flex-col gap-5">
            {isGuest ? (
              <>
                <div className={`${subtleCardClass} px-4 py-4`}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-mist-text)]/42">
                    {t.settings.premiumFeatures}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-mist-text)]/72">
                    {premiumFeatureLead}
                  </p>
                </div>
                <div className="grid gap-3">
                  {benefitCards.map((benefit: any) => (
                    <div key={benefit.title} className={`${subtleCardClass} flex items-start gap-3 px-4 py-4`}>
                      <div className={iconWrapClass}>
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--color-mist-text)]/84">{benefit.title}</p>
                        <p className="mt-1 text-xs leading-5 text-[var(--color-mist-text)]/58">{benefit.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : isPremium ? (
              <>
                <p className={bodyClass}>{t.settings.premiumDescShort}</p>
                <div className={`${subtleCardClass} grid gap-4 px-5 py-5`}>
                  <div className={detailRowClass}>
                    <span className="text-sm text-[var(--color-mist-text)]/64">{t.settings.currentPlan}</span>
                    <span className="text-sm font-semibold text-[var(--color-mist-text)]/88">{planName}</span>
                  </div>
                  <div className={detailRowClass}>
                    <span className="text-sm text-[var(--color-mist-text)]/64">{t.settings.autoRenew}</span>
                    <span className="text-sm font-semibold text-[var(--color-mist-text)]/88">{t.common.enabled}</span>
                  </div>
                  <div className={detailRowClass}>
                    <span className="text-sm text-[var(--color-mist-text)]/64">{t.settings.membershipEnds}</span>
                    <span className="text-sm font-semibold text-[var(--color-mist-text)]/88">{t.common.longTerm}</span>
                  </div>
                  <div className={detailRowClass}>
                    <span className="text-sm text-[var(--color-mist-text)]/64">{t.settings.membershipStatus}</span>
                    <span className="text-sm font-semibold text-[var(--color-mist-text)]/88">{t.settings.membershipActive}</span>
                  </div>
                </div>
                <div className={`${subtleCardClass} grid gap-4 px-4 py-4`}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-mist-text)]/42">
                    {t.settings.premiumBenefits}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {benefitCards.map((benefit: any) => (
                      <div key={benefit.title} className="rounded-2xl border border-white/14 bg-white/10 px-3 py-2.5 text-sm text-[var(--color-mist-text)]/72">
                        {benefit.title}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-auto pt-1">
                  <button onClick={premiumManageAction} className={secondaryButtonClass}>
                    {t.settings.manageMembership}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-[var(--color-mist-text)]/60">
                  {premiumFeatureLead}
                </p>
                <div className="grid gap-3">
                  {benefitCards.map((benefit: any) => (
                    <div key={benefit.title} className={`${subtleCardClass} flex items-start gap-3 px-4 py-4`}>
                      <div className={iconWrapClass}>
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--color-mist-text)]/84">{benefit.title}</p>
                        <p className="mt-1 text-xs leading-5 text-[var(--color-mist-text)]/58">{benefit.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-auto pt-1">
                  <button onClick={handleUpgrade} className={upgradeButtonClass}>{t.settings.upgradeNow}</button>
                </div>
              </>
            )}
          </div>
        </section>

        <section className={`${cardClass} flex min-h-[520px] flex-col`}>
          <div className="flex items-center gap-3">
            <div className={iconWrapClass}>
              <ExternalLink className="h-4.5 w-4.5" />
            </div>
            <h2 className={titleClass}>{t.settings.links}</h2>
          </div>

          <div className="mt-6 flex flex-1 flex-col gap-3">
            {links.map(link => {
              const Icon = link.icon;
              return (
                <button
                  key={link.label}
                  onClick={() => link.qr ? setShowSheetOptions(true) : window.open(link.url!, '_blank')}
                  className={`${subtleCardClass} flex items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-white/18`}
                >
                  <div className="flex items-center gap-3">
                    <div className={iconWrapClass}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-medium text-[var(--color-mist-text)]/84">{link.label}</span>
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
}

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

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col animate-in fade-in duration-500 pb-20">
      <div className="glass-panel p-8 rounded-[32px] border border-white/20">
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
            {safeTracks.map(track => (
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
                          <div key={idx} className="w-[240px] flex-shrink-0 glass-panel p-4 rounded-xl flex flex-col gap-3 group relative overflow-hidden border border-white/10">
                            <img src={cand.coverUrl} alt="Cover" className="w-full aspect-square object-cover rounded-[10px] shadow-lg bg-black/20" />
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
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {Array.isArray(artistsData) && artistsData.map(artist => (
              <div key={artist.name} className="glass-utility p-5 rounded-2xl flex flex-col gap-4 border border-white/10 transition-all hover:bg-white/5">
                <div
                  className="flex items-center justify-between cursor-pointer group"
                  onClick={() => setExpandedArtistId(expandedArtistId === artist.name ? null : artist.name)}
                >
                  <div className="flex items-center gap-5">
                    <img
                      src={artist.source_artist_image_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(artist.name) + '&background=random&color=fff&size=50'}
                      alt={artist.name}
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
                          <div key={idx} className="w-[200px] flex-shrink-0 glass-panel p-4 rounded-xl flex flex-col gap-3 group relative overflow-hidden border border-white/10">
                            <img src={cand.imageUrl || 'https://ui-avatars.com/api/?name=No+Image'} alt="Artist" className="w-full aspect-square object-cover rounded-full shadow-lg bg-black/20" />
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
          </div>
        )}
      </div>
    </div>
  );
}
