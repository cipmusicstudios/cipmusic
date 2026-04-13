/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { 
  Play, Pause, SkipBack, SkipForward, Volume2, Volume1, VolumeX,
  Search, Settings, Music, CloudRain, Clock, 
  User, Edit2, Repeat, Shuffle, ChevronLeft, ChevronRight,
  Lock, Moon, Flame, Waves, Wind, MoonStar,
  TreePine, AudioLines, Coffee, BookOpen, Youtube, Brain,
  Piano, X, Activity, AlarmClock, Timer, Globe, ExternalLink, MessageCircle, Tv,
  Radio, Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { Midi } from '@tonejs/midi';

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
};

export const SCENES: Scene[] = [
  { id: 'cozy_loft', name: 'Tide Haven', tag: 'Warm', type: 'video', url: 'https://pub-9240560f200a43d8a64bb9102acd49e9.r2.dev/pianocafe.mp4', thumbnail: BG_FALLBACK_IMAGE_URL },
  { id: 'rainy_window', name: 'Rainlight Hall', tag: 'Rain', type: 'video', url: 'https://pub-9240560f200a43d8a64bb9102acd49e9.r2.dev/rainhall.mp4', thumbnail: 'https://i.imgur.com/iq2hWwS.jpeg' },
  { id: 'night_city', name: 'Forest Café', tag: 'Nature', type: 'video', url: 'https://pub-9240560f200a43d8a64bb9102acd49e9.r2.dev/forest.mp4', thumbnail: 'https://i.imgur.com/GGg2cSI.jpeg' },
  { id: 'ocean_view', name: 'Celestial Dome', tag: 'Night', type: 'video', url: 'https://pub-9240560f200a43d8a64bb9102acd49e9.r2.dev/starry.mp4', thumbnail: 'https://i.imgur.com/E5TWs8E.jpeg' },
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
  const [activeSceneId, setActiveSceneId] = useState<string>('cozy_loft');
  const [showPracticePanel, setShowPracticePanel] = useState(false);
  const [isPremium, setIsPremium] = useState(false);

  // Lifted playback state
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  const activeScene = SCENES.find(s => s.id === activeSceneId) || SCENES[0];

  return (
    <div className="min-h-screen flex flex-col items-center relative text-[var(--color-mist-text)]">
      <BackgroundLayer scene={activeScene} />
      
      <TopNav activeView={activeView} setActiveView={setActiveView} />
      
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 pt-32 pb-32 z-10 relative">
        {activeView === 'home' && <HeroOverlay />}
        {activeView === 'music' && (
          <MusicTab 
            tracks={tracks}
            artistsData={artistsData}
            currentTrack={currentTrack} 
            setCurrentTrack={setCurrentTrack} 
            isPlaying={isPlaying} 
            setIsPlaying={setIsPlaying} 
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
          />
        )}
        {activeView === 'settings' && <SettingsTab isPremium={isPremium} setIsPremium={setIsPremium} setActiveView={setActiveView} />}
        {activeView === 'admin' && <AdminTab tracks={tracks} setTracks={setTracks} artistsData={artistsData} setArtistsData={setArtistsData} />}
      </main>

      {showPracticePanel && (
        <PracticePanel 
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          playbackRate={playbackRate}
          setPlaybackRate={setPlaybackRate}
          onClose={() => setShowPracticePanel(false)} 
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
      />
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
  onClose 
}: { 
  currentTrack: Track, 
  isPlaying: boolean,
  currentTime: number,
  duration: number,
  playbackRate: number,
  setPlaybackRate: (v: number) => void,
  onClose: () => void 
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeLeftNotes, setActiveLeftNotes] = useState<string[]>([]);
  const [activeRightNotes, setActiveRightNotes] = useState<string[]>([]);
  const [midiNotes, setMidiNotes] = useState<any[]>([]);
  const [midiHeader, setMidiHeader] = useState<any>(null);
  
  const containerRef = React.useRef<HTMLDivElement>(null);
  const redLineRef = React.useRef<HTMLDivElement>(null);
  const osmdRef = React.useRef<OpenSheetMusicDisplay | null>(null);
  const currentTimeRef = React.useRef(currentTime);
  const lastMonotonicTimeRef = React.useRef(currentTime);
  const renderedBlockRef = React.useRef(-1);
  const previousColoredNotesRef = React.useRef<any[]>([]);

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
            ppq: midi.header.ppq
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
              hand
            });
          });
        });
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
      drawUpToMeasureNumber: 4,
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
    
    let animationId: number;
    let smoothedX = 0; // GPU lerp state
    let forceTeleport = false; // Hard-snap flag to prevent backward animation

    const tick = () => {
      const osmd = osmdRef.current;
      if (!osmd || !osmd.cursor || !osmd.cursor.Iterator || !midiHeader) {
        animationId = requestAnimationFrame(tick);
        return;
      }

      const timeSecs = currentTimeRef.current;
      
      // 1. Keyboard Highlight precisely mapped to Dual Hand MIDI map
      const currentActive = midiNotes.filter(n => timeSecs >= n.time && timeSecs <= n.time + n.duration);
      setActiveRightNotes(currentActive.filter(n => n.hand === 'right').map(n => n.name));
      setActiveLeftNotes(currentActive.filter(n => n.hand === 'left').map(n => n.name));

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
      // (Using reduce cleanly prevents the original unsorted array bug)
      const firstMidiTick = midiNotes.length > 0 
          ? midiNotes.reduce((min, n) => Math.min(min, n.ticks || Infinity), Infinity) 
          : 0;
          
      const currentTick = Math.max(0, currentTickOrig - firstMidiTick); 

      // 3. Measure-Anchored Math Formula
      const MEASURES_PER_BLOCK = 4;
      const targetFraction = currentTick / (midiHeader.ppq * 4);
      const measureIndex = Math.floor(targetFraction);
      const measureRatio = Math.max(0, Math.min(1, targetFraction - measureIndex));

      // 4. Block Page-Turning Check (Fast Redraw)
      const targetBlock = Math.floor(measureIndex / MEASURES_PER_BLOCK);
      
      if (targetBlock !== renderedBlockRef.current && osmd.GraphicSheet) {
        const startNum = targetBlock * MEASURES_PER_BLOCK + 1;
        osmd.setOptions({
          drawFromMeasureNumber: startNum,
          drawUpToMeasureNumber: startNum + MEASURES_PER_BLOCK - 1
        });
        osmd.render(); // This takes ~20ms, swapping 4 measures instantaneously
        renderedBlockRef.current = targetBlock;
        forceTeleport = true; // Hard-snap the red line to the new slice origin
      }

      // 5. Calculate Red Line Absolute X mapping inside current 4-measure slice
      let absoluteX = 0;
      if (osmd.GraphicSheet && osmd.GraphicSheet.MeasureList) {
        const measures = osmd.GraphicSheet.MeasureList;
        // The MeasureList ONLY contains the strictly rendered measures (max 4)
        const localIndex = measureIndex % MEASURES_PER_BLOCK;
        
        // Pin bounds safely if we seek past the end of the song
        const safeIndex = Math.max(0, Math.min(localIndex, measures.length - 1));
        const safeNextIndex = Math.min(safeIndex + 1, measures.length - 1);
        
        // Grab Staff 0's Measure object for the X reference
        const currentMeasure = measures[safeIndex] ? measures[safeIndex][0] : null;
        const nextMeasure = measures[safeNextIndex] ? measures[safeNextIndex][0] : null;

        if (currentMeasure && currentMeasure.PositionAndShape) {
           const magicScale = 10.0 * osmd.zoom; // OSMD unit conversion to pixel ratio
           
           // CRITICAL FIX: Base mapping on the FIRST ACTUAL NOTE physically drawn in the measure, 
           // completely ignoring empty clef/signature padding at the start of the measure box.
           const currentFirstEntry = currentMeasure.staffEntries && currentMeasure.staffEntries.length > 0 
                ? currentMeasure.staffEntries[0] 
                : null;
                
           const nextFirstEntry = (safeNextIndex > safeIndex && nextMeasure && nextMeasure.staffEntries && nextMeasure.staffEntries.length > 0)
                ? nextMeasure.staffEntries[0]
                : null;

           const startX = currentFirstEntry && currentFirstEntry.PositionAndShape
                ? currentFirstEntry.PositionAndShape.AbsolutePosition.x * magicScale
                : currentMeasure.PositionAndShape.AbsolutePosition.x * magicScale;
           
           let endX;
           if (nextFirstEntry && nextFirstEntry.PositionAndShape) {
               endX = nextFirstEntry.PositionAndShape.AbsolutePosition.x * magicScale;
           } else if (safeNextIndex > safeIndex && nextMeasure && nextMeasure.PositionAndShape) {
               endX = nextMeasure.PositionAndShape.AbsolutePosition.x * magicScale;
           } else {
               // Extrapolate the very last measure width dynamically based on its own geometric bounding box
               endX = (currentMeasure.PositionAndShape.AbsolutePosition.x + currentMeasure.PositionAndShape.Size.width) * magicScale;
           }
           
           absoluteX = startX + measureRatio * (endX - startX);
        }
      }

      // 6. Apply rapid tracking to Sweep the RED LINE visually
      if (absoluteX >= 0 && redLineRef.current) {
        // TELEPORT SHIELD: Instantly teleport if block swapped, or if user seek delta is massive.
        // This permanently kills ALL backward flow and bouncy rubber-banding effects.
        if (forceTeleport || Math.abs(absoluteX - smoothedX) > 20) {
           smoothedX = absoluteX;
           forceTeleport = false; // Consume flag
        } else {
           // Normal micro-damping for 1-5px frame deltas allows 60fps silken tracking
           smoothedX += (absoluteX - smoothedX) * 0.4;
        }
        redLineRef.current.style.transform = `translateX(${smoothedX}px)`;
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
    <div className="fixed bottom-24 left-0 right-0 h-[45vh] z-40 animate-in slide-in-from-bottom duration-500">
      <div className="w-full h-full glass-effect border-t border-white/40 flex flex-col rounded-t-[40px] shadow-2xl overflow-hidden bg-white/5">
        
        {/* 1) Staff Section (55% height) */}
        {/* Layout cleanly aligned to top-left. No more hidden horizontal spans. */}
        <div className="h-[55%] relative flex flex-col justify-start overflow-hidden w-full bg-[#f8f6f0] shadow-inner">
          
          <div className="absolute top-0 h-full w-full flex items-start">
            <div 
              ref={containerRef} 
              className="osmd-container opacity-90 origin-top-left mix-blend-multiply w-full px-[5vw]" 
            ></div>
          </div>

          {isLoading && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/10 backdrop-blur-md">
              <div className="w-8 h-8 border-2 border-amber-900/20 border-t-amber-900 rounded-full animate-spin"></div>
              <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-amber-900/40">Loading MusicXML...</span>
            </div>
          )}

          {loadError && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#f8f6f0] backdrop-blur-md">
              <Search className="w-8 h-8 text-red-500/50" />
              <span className="text-[12px] font-bold text-red-500/80">{loadError}</span>
            </div>
          )}
          
          {/* Fixed Visual Read-Line (Now Sweeping Rulers) */}
          <div 
            ref={redLineRef}
            className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-30 pointer-events-none hidden md:block shadow-[0_0_10px_rgba(239,68,68,0.6)] ml-[5vw]"
            style={{ left: 0 }}
          ></div>
          
          {/* Top/bottom gradient overlays to make the paper roll look elegant */}
          <div className="absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-black/20 to-transparent z-10 pointer-events-none"></div>
          <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/20 to-transparent z-10 pointer-events-none"></div>
        </div>

        {/* 2) 88-Key Piano Keyboard (35% height) */}
        <div className="h-[35%] px-0 pb-1 flex relative select-none bg-black/40 pt-2 border-t-[4px] border-[#8b0000]/60">
          <div className="flex w-full h-full relative">
            {whiteKeys.map((note) => {
              const isC = note.startsWith('C');
              const isRightWhite = activeRightNotes.includes(note);
              const isLeftWhite = activeLeftNotes.includes(note);
              const isRightBlack = activeRightNotes.includes(note + '#') || activeRightNotes.includes(note + 'b');
              const isLeftBlack = activeLeftNotes.includes(note + '#') || activeLeftNotes.includes(note + 'b');

              // Determine visual hierarchy (Right hand gold, Left hand cyan)
              const activeWhiteClass = isRightWhite 
                  ? 'bg-amber-400 shadow-[inset_0_-15px_30px_rgba(251,191,36,0.8)] z-10 scale-[1.02]' 
                  : isLeftWhite 
                  ? 'bg-cyan-400 shadow-[inset_0_-15px_30px_rgba(34,211,238,0.8)] z-10 scale-[1.02]' 
                  : 'bg-[#fffff0]';
                  
              const activeBlackClass = isRightBlack
                  ? 'bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.9)]'
                  : isLeftBlack
                  ? 'bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.9)]'
                  : 'bg-[#111] hover:bg-black';

              return (
                <div 
                  key={note} 
                  className={`flex-1 border-r border-[#1a1a1a] last:border-0 relative flex flex-col justify-end items-center pb-2 transition-all duration-[50ms] ${activeWhiteClass}`}
                  style={{ borderRadius: '0 0 3px 3px' }}
                >
                  {isC && (
                    <span className={`text-[9px] font-bold ${(isRightWhite || isLeftWhite) ? 'text-black' : 'text-black/30'} mb-1`}>{note}</span>
                  )}
                  
                  {/* Black Key Positioning */}
                  {hasBlackRight(note) && note !== 'C8' && (
                    <div 
                      className={`absolute top-0 right-0 w-[60%] h-[60%] rounded-b-sm z-30 translate-x-1/2 shadow-xl border-x border-b border-black/80 transition-all duration-[50ms] ${activeBlackClass}`}
                    ></div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 3) Control Strip (10% height) */}
        <div className="h-[10%] min-h-[40px] flex items-center justify-between px-10 bg-black/60 shadow-inner">
          <div className="flex items-center gap-8">
            <span className="text-[10px] uppercase font-bold text-white/40 tracking-widest flex items-center gap-2">
              <Piano className="w-3.5 h-3.5 text-amber-500/80" />
              Practice Environment (BETA)
            </span>
          </div>
          
          <button 
            onClick={onClose}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 text-white/80 hover:bg-white/20 border border-white/20 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Close</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function HeroOverlay() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center animate-in fade-in duration-700 min-h-[60vh] text-center">
      {/* Clean background with no centered overlay text */}
    </div>
  );
}

function TopNav({ activeView, setActiveView }: { activeView: View, setActiveView: (v: View) => void }) {
  const [currentLang, setCurrentLang] = useState('English');
  const [showLangMenu, setShowLangMenu] = useState(false);

  const languages = [
    { name: 'English', code: 'EN' },
    { name: '中文', code: 'ZH' },
    { name: '한국어', code: 'KR' },
    { name: 'Español', code: 'ES' },
    { name: 'Bahasa Indonesia', code: 'ID' },
    { name: 'ไทย', code: 'TH' },
    { name: 'Tiếng Việt', code: 'VN' }
  ];

  const tabs: { id: View, label: string, icon?: React.ReactNode }[] = [
    { id: 'home', label: 'Home', icon: <Music className="w-4 h-4" /> },
    { id: 'music', label: 'Music' },
    { id: 'focus', label: 'Focus' },
    { id: 'settings', label: 'Settings' }
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
              className={`px-5 md:px-6 py-2 rounded-full transition-all duration-300 font-medium whitespace-nowrap flex items-center gap-2 ${
                activeView === tab.id 
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
              className="bg-white/15 border border-white/25 rounded-full pl-9 pr-4 py-1.5 text-sm w-48 focus:outline-none focus:bg-white/25 transition-colors text-[var(--color-mist-text)] placeholder-[var(--color-mist-text)]/40"
            />
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
                      <span>{lang.name}</span>
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
  isPremium
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
  isPremium: boolean
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
                <h3 className="text-xl font-bold text-[var(--color-mist-text)]">Smart Radio</h3>
                <p className="text-sm text-[var(--color-mist-text)]/60 leading-relaxed">
                  Keep the music flowing with automatically matched songs. This is a premium feature.
                </p>
              </div>
              <button 
                onClick={() => setShowPremiumPrompt(false)}
                className="w-full py-4 rounded-2xl bg-amber-600 text-white font-bold shadow-lg shadow-amber-600/20 hover:bg-amber-700 transition-colors"
              >
                Upgrade to Premium
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
                className={`transition-all duration-300 flex flex-col items-center gap-0.5 ${
                  isPremium 
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
                  Smart Radio On
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
            className={`flex flex-col items-center gap-1 transition-all ${
              !currentTrack.midiUrl 
                ? 'opacity-20 cursor-not-allowed' 
                : showPracticePanel 
                  ? 'text-[var(--color-mist-text)] scale-110' 
                  : 'text-[var(--color-mist-text)]/60 hover:text-[var(--color-mist-text)]'
            }`}
            title={currentTrack.midiUrl ? "Practice Mode" : "Practice mode not available"}
          >
            <Piano className="w-5 h-5" />
            <span className="text-[10px] uppercase tracking-tighter font-medium">Practice</span>
          </button>

          <button 
            onClick={() => currentTrack.youtubeUrl && window.open(currentTrack.youtubeUrl, '_blank')}
            disabled={!currentTrack.youtubeUrl}
            className={`flex flex-col items-center gap-1 transition-colors ${currentTrack.youtubeUrl ? 'text-[var(--color-mist-text)]/60 hover:text-[var(--color-mist-text)]' : 'text-[var(--color-mist-text)]/20 cursor-not-allowed'}`}
            title={currentTrack.youtubeUrl ? "Watch Video" : "Video not available"}
          >
            <Youtube className="w-5 h-5" />
            <span className="text-[10px] uppercase tracking-tighter font-medium">Video</span>
          </button>

          <button 
            onClick={() => currentTrack.sheetUrl && window.open(currentTrack.sheetUrl, '_blank')}
            disabled={!currentTrack.sheetUrl}
            className={`flex flex-col items-center gap-1 transition-colors ${currentTrack.sheetUrl ? 'text-[var(--color-mist-text)]/60 hover:text-[var(--color-mist-text)]' : 'text-[var(--color-mist-text)]/20 cursor-not-allowed'}`}
            title={currentTrack.sheetUrl ? "Sheet Music" : "Sheet music not available"}
          >
            <BookOpen className="w-5 h-5" />
            <span className="text-[10px] uppercase tracking-tighter font-medium">Sheet</span>
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
  setIsPlaying 
}: { 
  tracks: Track[],
  artistsData: any[],
  currentTrack: Track, 
  setCurrentTrack: (t: Track) => void,
  isPlaying: boolean,
  setIsPlaying: (v: boolean) => void
}) {
  const [musicView, setMusicView] = useState<'artists' | 'songs' | 'artist_detail'>('artists');
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['All']);
  const [sortBy, setSortBy] = useState<'recently_played' | 'a_z' | 'duration'>('recently_played');

  const [artistSearchQuery, setArtistSearchQuery] = useState('');
  const [selectedArtistCategories, setSelectedArtistCategories] = useState<string[]>(['All']);
  const [artistSortBy, setArtistSortBy] = useState<'a_z' | 'z_a' | 'most_songs'>('a_z');

  const categories = ['All', 'C-pop', 'K-pop', 'J-pop', 'Western', 'Anime', 'Film', 'Game', 'Originals'];
  const artistCategoriesList = ['All', 'Male', 'Female', 'Group', 'Solo', 'US', 'Korea', 'Japan', 'China', 'Global'];

  const artistsMap = new Map<string, { name: string, displayName: string, songCount: number, coverUrl: string, region: string, gender: string, type: string }>();
  
  // 1. Initialize from true artistsData
  artistsData.forEach(a => {
    const fallbackArtistAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(a.name) + '&background=random&color=fff&size=200';
    const coverUrl = (a.metadata_status === 'approved' && a.source_artist_image_url) ? a.source_artist_image_url : fallbackArtistAvatar;
    const displayName = (a.metadata_status === 'approved' && a.source_artist_name) ? a.source_artist_name : a.name;

    artistsMap.set(a.name, {
      name: a.name,
      displayName: displayName,
      songCount: 0,
      coverUrl: coverUrl,
      region: a.source_region || a.region || 'Global',
      gender: a.gender || 'Mixed',
      type: a.type || 'Group'
    });
  });

  // 2. Aggregate song count purely based on tracks array
  tracks.forEach(t => {
    if (artistsMap.has(t.artist)) {
      artistsMap.get(t.artist)!.songCount++;
    } else {
      // 容错：防止有孤儿数据
      const fallbackArtistAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(t.artist) + '&background=random&color=fff&size=200';
      artistsMap.set(t.artist, {
        name: t.artist,
        displayName: t.artist,
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
    if (cat === 'All') {
      setSelectedCategories(['All']);
    } else {
      let newCats = selectedCategories.filter(c => c !== 'All');
      if (newCats.includes(cat)) {
        newCats = newCats.filter(c => c !== cat);
        if (newCats.length === 0) newCats = ['All'];
      } else {
        newCats.push(cat);
      }
      setSelectedCategories(newCats);
    }
  };

  const toggleArtistCategory = (cat: string) => {
    if (cat === 'All') {
      setSelectedArtistCategories(['All']);
    } else {
      let newCats = selectedArtistCategories.filter(c => c !== 'All');
      if (newCats.includes(cat)) {
        newCats = newCats.filter(c => c !== cat);
        if (newCats.length === 0) newCats = ['All'];
      } else {
        newCats.push(cat);
      }
      setSelectedArtistCategories(newCats);
    }
  };

  const renderArtists = () => {
    let filteredArtists = artists.filter(a => {
      const matchesSearch = a.name.toLowerCase().includes(artistSearchQuery.toLowerCase());
      
      const matchesCategory = selectedArtistCategories.includes('All') || 
        selectedArtistCategories.includes(a.gender) ||
        selectedArtistCategories.includes(a.type) ||
        selectedArtistCategories.includes(a.region);

      return matchesSearch && matchesCategory;
    });

    if (artistSortBy === 'a_z') {
      filteredArtists.sort((a, b) => a.name.localeCompare(b.name));
    } else if (artistSortBy === 'z_a') {
      filteredArtists.sort((a, b) => b.name.localeCompare(a.name));
    } else if (artistSortBy === 'most_songs') {
      filteredArtists.sort((a, b) => b.songCount - a.songCount);
    }

    return (
      <div className="flex flex-col animate-in fade-in duration-500">
        <div className="flex flex-col gap-6 mb-8 p-8 rounded-[32px] glass-effect border border-white/20 shadow-xl">
          <div className="flex justify-between items-center">
            <h2 className="text-3xl font-medium tracking-wide text-[var(--color-mist-text)] drop-shadow-sm">Artists</h2>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-mist-text)]/40" />
                <input 
                  type="text" 
                  placeholder="Search artists..." 
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
                <option value="a_z" className="bg-[#d6d0c8] text-[var(--color-mist-text)]">A–Z</option>
                <option value="z_a" className="bg-[#d6d0c8] text-[var(--color-mist-text)]">Z–A</option>
                <option value="most_songs" className="bg-[#d6d0c8] text-[var(--color-mist-text)]">Most Songs</option>
              </select>
            </div>
          </div>
          
            <div className="flex items-center gap-2 flex-wrap">
              {artistCategoriesList.map(cat => (
                <button
                  key={cat}
                  onClick={() => toggleArtistCategory(cat)}
                  className={`px-4 py-1.5 rounded-full text-sm transition-colors border ${
                    selectedArtistCategories.includes(cat) 
                      ? 'bg-white/30 border-white/40 text-[var(--color-mist-text)] shadow-sm' 
                      : 'bg-white/10 border-white/20 text-[var(--color-mist-text)]/70 hover:bg-white/20'
                  }`}
                >
                  {cat}
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
                setSelectedCategories(['All']);
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
                <span className="text-sm text-[var(--color-mist-text)]/60">{artist.songCount} {artist.songCount === 1 ? 'song' : 'songs'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderSongsList = (artistFilter: string | null) => {
    let filteredTracks = tracks.filter(t => {
      if (artistFilter && t.artist !== artistFilter) return false;

      const matchesSearch = t.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            t.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            t.artist.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (t.tags && t.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())));
      
      const matchesCategory = selectedCategories.includes('All') || 
                              selectedCategories.includes(t.category) ||
                              (t.tags && t.tags.some(tag => selectedCategories.includes(tag)));

      return matchesSearch && matchesCategory;
    });

    if (sortBy === 'a_z') {
      filteredTracks.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'duration') {
      filteredTracks.sort((a, b) => {
        const timeA = a.duration.split(':').map(Number);
        const timeB = b.duration.split(':').map(Number);
        const secA = timeA[0] * 60 + timeA[1];
        const secB = timeB[0] * 60 + timeB[1];
        return secA - secB;
      });
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
              <h2 className="text-3xl font-medium tracking-wide text-[var(--color-mist-text)] drop-shadow-sm">All Songs</h2>
            )}
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-mist-text)]/40" />
                <input 
                  type="text" 
                  placeholder="Search songs, artists, or tags..." 
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
                <option value="recently_played" className="bg-[#d6d0c8] text-[var(--color-mist-text)]">Recently Played</option>
                <option value="a_z" className="bg-[#d6d0c8] text-[var(--color-mist-text)]">A–Z</option>
                <option value="duration" className="bg-[#d6d0c8] text-[var(--color-mist-text)]">Duration</option>
              </select>
            </div>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`px-4 py-1.5 rounded-full text-sm transition-colors border ${
                  selectedCategories.includes(cat) 
                    ? 'bg-white/25 border-white/30 text-[var(--color-mist-text)] shadow-sm' 
                    : 'bg-white/10 border-white/20 text-[var(--color-mist-text)]/60 hover:bg-white/20'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="glass-panel rounded-[32px] overflow-hidden flex flex-col">
          <div className="grid grid-cols-12 gap-4 px-8 py-4 border-b border-white/10 text-sm font-medium text-[var(--color-mist-text)]/60 uppercase tracking-wider">
            <div className="col-span-1 text-center">#</div>
            <div className="col-span-6">Title</div>
            <div className="col-span-3">Category</div>
            <div className="col-span-2 text-right">Duration</div>
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
                      <span className={`font-medium truncate ${isActive ? 'text-[var(--color-mist-text)] underline decoration-amber-600/30 underline-offset-4' : 'text-[var(--color-mist-text)]'}`}>{track.title}</span>
                      <span className="text-xs text-[var(--color-mist-text)]/60 truncate">{track.artist}</span>
                    </div>
                  </div>
                  <div className="col-span-3 flex items-center">
                    <span className="px-3 py-1 rounded-full bg-white/20 text-xs text-[var(--color-mist-text)]/80 border border-white/20">
                      {track.category}
                    </span>
                  </div>
                  <div className="col-span-2 text-right text-[var(--color-mist-text)]/60 text-sm font-mono">
                    {track.duration}
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
              Artists
            </button>
            <button 
              onClick={() => setMusicView('songs')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${musicView === 'songs' ? 'bg-white/20 text-[var(--color-mist-text)] shadow-sm' : 'text-[var(--color-mist-text)]/60 hover:text-[var(--color-mist-text)]'}`}
            >
              Songs
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

function HorizontalScroller({ children, showHint = false }: { children: React.ReactNode, showHint?: boolean }) {
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
            Scroll &rarr;
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

      {/* Scroll Track with Symmetric Padding */}
      <div 
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto no-scrollbar pb-2 px-16 scroll-smooth"
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
  setActiveView
}: { 
  currentTrack: Track, 
  isPlaying: boolean, 
  setIsPlaying: (v: boolean) => void,
  activeSceneId: string,
  setActiveSceneId: (id: string) => void,
  setActiveView: (v: View) => void
}) {
  const [sessionMode, setSessionMode] = useState<'timer' | 'pomodoro'>('timer');
  const [activeAmbiences, setActiveAmbiences] = useState<string[]>([]);
  const [volumes, setVolumes] = useState<Record<string, number>>({ rain: 50, fire: 50, ocean: 50, nature: 50, night: 50, noise: 50, cafe: 50, library: 50 });
  
  // Timer state
  const [timerPreset, setTimerPreset] = useState<number | null>(null);
  const [customTimer, setCustomTimer] = useState('');
  
  // Pomodoro state
  const [pomoPreset, setPomoPreset] = useState<'25/5' | '50/10' | 'custom'>('25/5');
  const [pomoFocus, setPomoFocus] = useState('25');
  const [pomoBreak, setPomoBreak] = useState('5');
  const [pomoCycles, setPomoCycles] = useState('4');

  // Shared Session state
  const [fadeOut, setFadeOut] = useState('Off');
  const [endBehavior, setEndBehavior] = useState('Stop');

  const isPremium = false; // UI only

  const ambienceGroups = [
    {
      title: 'Nature',
      items: [
        { id: 'rain', name: 'Rain', icon: CloudRain, imageUrl: 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=800&q=80' },
        { id: 'ocean', name: 'Ocean', icon: Waves, imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80' },
        { id: 'nature', name: 'Forest', icon: TreePine, imageUrl: 'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=800&q=80' },
      ]
    },
    {
      title: 'Indoor',
      items: [
        { id: 'fire', name: 'Fireplace', icon: Flame, imageUrl: 'https://images.unsplash.com/photo-1516533075015-a3838414c3ca?auto=format&fit=crop&w=800&q=80' },
        { id: 'cafe', name: 'Cafe', icon: Coffee, imageUrl: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=800&q=80' },
        { id: 'library', name: 'Library', icon: BookOpen, imageUrl: 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=800&q=80' },
      ]
    },
    {
      title: 'Ambient',
      items: [
        { id: 'night', name: 'Night Ambience', icon: MoonStar, imageUrl: 'https://images.unsplash.com/photo-1502134249126-9f3755a50d78?auto=format&fit=crop&w=800&q=80' },
        { id: 'noise', name: 'White Noise', icon: AudioLines, imageUrl: 'https://images.unsplash.com/photo-1554034483-04fda0d3507b?auto=format&fit=crop&w=800&q=80' },
      ]
    }
  ];

  const toggleAmbience = (id: string) => {
    if (activeAmbiences.includes(id)) {
      setActiveAmbiences(activeAmbiences.filter(a => a !== id));
    } else {
      if (!isPremium && activeAmbiences.length >= 1) {
        // Free users can only have 1 active. Replace the active one.
        setActiveAmbiences([id]);
      } else if (isPremium && activeAmbiences.length >= 3) {
        // Premium users can have up to 3 active
        setActiveAmbiences([...activeAmbiences.slice(1), id]);
      } else {
        setActiveAmbiences([...activeAmbiences, id]);
      }
    }
  };

  const focusPresets = [
    { id: 'deep', name: 'Deep Work', icon: Brain, ambience: ['noise'], volume: 40 },
    { id: 'read', name: 'Reading', icon: BookOpen, ambience: ['library'], volume: 30 },
    { id: 'relax', name: 'Relaxation', icon: Coffee, ambience: ['rain', 'fire'], volume: 50 },
    { id: 'nature', name: 'Nature Walk', icon: TreePine, ambience: ['nature', 'ocean'], volume: 45 },
  ];

  const applyPreset = (preset: typeof focusPresets[0]) => {
    setActiveAmbiences(preset.ambience);
    const newVolumes = { ...volumes };
    preset.ambience.forEach(id => {
      newVolumes[id] = preset.volume;
    });
    setVolumes(newVolumes);
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
          <h3 className="text-lg font-medium text-[var(--color-mist-text)] ml-1">Theme</h3>
          <HorizontalScroller showHint>
            {SCENES.map(scene => (
              <div 
                key={scene.id}
                onClick={() => {
                  setActiveSceneId(scene.id);
                  setTimeout(() => setActiveView('home'), 200);
                }}
                className={`relative w-56 h-32 rounded-2xl overflow-hidden shrink-0 cursor-pointer group transition-all ${activeSceneId === scene.id ? 'ring-2 ring-white ring-offset-2 ring-offset-white/20' : 'hover:ring-1 hover:ring-white/50'}`}
              >
                <img src={scene.thumbnail} alt={scene.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" referrerPolicy="no-referrer" />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-mist-text)]/60 via-transparent to-transparent"></div>
                <div className="absolute bottom-3 left-3 flex flex-col">
                  <span className="text-white text-sm font-medium">{scene.name}</span>
                  <span className="text-[10px] text-white/80 bg-white/20 px-2 py-0.5 rounded-full w-fit mt-1 glass-utility border border-white/20">{scene.tag}</span>
                </div>
              </div>
            ))}
          </HorizontalScroller>
        </div>

        {/* 2) AMBIENT STRIP */}
        <div className="flex flex-col gap-4">
          <h3 className="text-lg font-medium text-[var(--color-mist-text)] ml-1">Ambient</h3>
          <HorizontalScroller showHint>
            {ambientItems.map(amb => {
              const Icon = amb.icon;
              const isActive = activeAmbiences.includes(amb.id);
              return (
                <div 
                  key={amb.id}
                  onClick={() => toggleAmbience(amb.id)}
                  className={`relative w-56 h-32 rounded-2xl overflow-hidden shrink-0 cursor-pointer group transition-all ${isActive ? 'ring-2 ring-white ring-offset-2 ring-offset-white/20' : 'hover:ring-1 hover:ring-white/50'}`}
                >
                  <img 
                    src={(amb as any).imageUrl} 
                    alt={amb.name} 
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
                    referrerPolicy="no-referrer" 
                  />
                  <div className={`absolute inset-0 transition-colors ${isActive ? 'bg-[var(--color-mist-text)]/20' : 'bg-[var(--color-mist-text)]/40 group-hover:bg-[var(--color-mist-text)]/20'}`}></div>
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-mist-text)]/60 via-transparent to-transparent"></div>
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <Icon className={`w-8 h-8 transition-transform duration-300 ${isActive ? 'scale-110 text-white' : 'text-white/80 group-hover:scale-110'}`} />
                    <span className="text-white text-sm font-medium tracking-wide">{amb.name}</span>
                  </div>
                  {isActive && (
                    <div className="absolute bottom-3 left-3 right-3 p-2 bg-white/20 glass-utility rounded-xl border border-white/20 animate-in slide-in-from-bottom-2 duration-300" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <Volume2 className="w-3 h-3 text-white" />
                        <input 
                          type="range" 
                          min="0" max="100" 
                          value={volumes[amb.id]} 
                          onChange={(e) => setVolumes({...volumes, [amb.id]: parseInt(e.target.value)})}
                          className="w-full h-1 rounded-full appearance-none bg-white/30 outline-none accent-white"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </HorizontalScroller>
        </div>

        {/* 3) SESSION STRIP */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between ml-1">
            <h3 className="text-lg font-medium text-[var(--color-mist-text)]">Session</h3>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--color-mist-text)]/40 font-bold">
              <Timer className="w-3 h-3" />
              <span>Focus Timer</span>
            </div>
          </div>
          
          <div className="glass-panel p-6 flex flex-col gap-8 shadow-sm">
            <div className="flex items-center justify-between">
              {/* Mode Switcher */}
              <div className="flex bg-white/10 rounded-2xl p-1 border border-white/10 shrink-0">
                <button 
                  onClick={() => setSessionMode('timer')}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
                    sessionMode === 'timer' 
                      ? 'bg-white/30 text-[var(--color-mist-text)] shadow-lg scale-[1.02]' 
                      : 'text-[var(--color-mist-text)]/40 hover:text-[var(--color-mist-text)]/70'
                  }`}
                >
                  <Timer className="w-4 h-4" />
                  Timer
                </button>
                <button 
                  onClick={() => setSessionMode('pomodoro')}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
                    sessionMode === 'pomodoro' 
                      ? 'bg-white/30 text-[var(--color-mist-text)] shadow-lg scale-[1.02]' 
                      : 'text-[var(--color-mist-text)]/40 hover:text-[var(--color-mist-text)]/70'
                  }`}
                >
                  <TomatoIcon className="w-4 h-4" />
                  Pomodoro
                </button>
              </div>

              {/* Settings & Action */}
              <div className="flex items-center gap-8">
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[10px] uppercase tracking-widest text-[var(--color-mist-text)]/40 font-bold">Fadeout</span>
                  <select 
                    value={fadeOut}
                    onChange={(e) => setFadeOut(e.target.value)}
                    className="bg-transparent text-xs text-[var(--color-mist-text)]/60 focus:outline-none cursor-pointer font-medium text-right"
                  >
                    <option value="Off">No Fade</option>
                    <option value="1m">1m Fade</option>
                    <option value="3m">3m Fade</option>
                  </select>
                </div>
                <button className="matte-button px-8 py-3 rounded-2xl text-sm font-bold shadow-xl hover:scale-105 active:scale-95 transition-all">
                  Start Session
                </button>
              </div>
            </div>

            {/* Mode Specific Controls */}
            <div className="bg-white/5 rounded-3xl p-6 border border-white/5">
              {sessionMode === 'timer' ? (
                <div className="flex items-center justify-between animate-in slide-in-from-left-4 duration-500">
                  <div className="flex flex-col gap-3">
                    <span className="text-xs font-bold uppercase tracking-widest text-[var(--color-mist-text)]/40">Duration Presets</span>
                    <div className="flex gap-3">
                      {[15, 30, 45, 60, 90].map(t => (
                        <button 
                          key={t}
                          onClick={() => { setTimerPreset(t); setCustomTimer(''); }}
                          className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center transition-all duration-300 border ${
                            timerPreset === t 
                              ? 'bg-white/40 border-white/40 text-[var(--color-mist-text)] shadow-md scale-105' 
                              : 'bg-white/10 border-white/10 text-[var(--color-mist-text)]/40 hover:bg-white/20'
                          }`}
                        >
                          <span className="text-lg font-bold">{t}</span>
                          <span className="text-[8px] uppercase">min</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div className="h-12 w-px bg-white/10"></div>

                  <div className="flex flex-col gap-3 items-end">
                    <span className="text-xs font-bold uppercase tracking-widest text-[var(--color-mist-text)]/40">Custom Time</span>
                    <div className="relative">
                      <input 
                        type="number" 
                        placeholder="00" 
                        value={customTimer}
                        onChange={(e) => {
                          setCustomTimer(e.target.value);
                          setTimerPreset(null);
                        }}
                        className="w-24 bg-white/10 border border-white/10 rounded-2xl px-4 py-4 text-2xl font-bold text-center text-[var(--color-mist-text)] placeholder-[var(--color-mist-text)]/20 focus:outline-none focus:bg-white/20 focus:border-white/30 transition-all"
                      />
                      <span className="absolute -right-8 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-mist-text)]/40">MIN</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between animate-in slide-in-from-right-4 duration-500">
                  <div className="flex flex-col gap-3">
                    <span className="text-xs font-bold uppercase tracking-widest text-[var(--color-mist-text)]/40">Pomodoro Presets</span>
                    <div className="flex gap-4">
                      {[
                        { label: 'Classic', value: '25/5', focus: '25', break: '5' },
                        { label: 'Long', value: '50/10', focus: '50', break: '10' }
                      ].map(p => (
                        <button 
                          key={p.value}
                          onClick={() => setPomoPreset(p.value as any)}
                          className={`px-6 py-4 rounded-2xl flex flex-col items-start gap-1 transition-all duration-300 border ${
                            pomoPreset === p.value 
                              ? 'bg-white/40 border-white/40 text-[var(--color-mist-text)] shadow-md scale-105' 
                              : 'bg-white/10 border-white/10 text-[var(--color-mist-text)]/40 hover:bg-white/20'
                          }`}
                        >
                          <span className="text-[10px] font-bold uppercase opacity-60">{p.label}</span>
                          <span className="text-xl font-bold">{p.focus}<span className="text-sm opacity-40 mx-1">/</span>{p.break}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="h-12 w-px bg-white/10"></div>

                  <div className="flex flex-col gap-3 items-end">
                    <span className="text-xs font-bold uppercase tracking-widest text-[var(--color-mist-text)]/40">Custom Intervals</span>
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-center gap-1">
                        <input 
                          type="number" 
                          value={pomoPreset === 'custom' ? pomoFocus : (pomoPreset === '25/5' ? '25' : '50')}
                          onChange={(e) => { setPomoPreset('custom'); setPomoFocus(e.target.value); }}
                          className="w-16 bg-white/10 border border-white/10 rounded-xl py-3 text-xl font-bold text-center text-[var(--color-mist-text)] focus:outline-none focus:bg-white/20"
                        />
                        <span className="text-[8px] font-bold uppercase opacity-40">Focus</span>
                      </div>
                      <span className="text-xl font-bold text-[var(--color-mist-text)]/20 mb-4">/</span>
                      <div className="flex flex-col items-center gap-1">
                        <input 
                          type="number" 
                          value={pomoPreset === 'custom' ? pomoBreak : (pomoPreset === '25/5' ? '5' : '10')}
                          onChange={(e) => { setPomoPreset('custom'); setPomoBreak(e.target.value); }}
                          className="w-16 bg-white/10 border border-white/10 rounded-xl py-3 text-xl font-bold text-center text-[var(--color-mist-text)] focus:outline-none focus:bg-white/20"
                        />
                        <span className="text-[8px] font-bold uppercase opacity-40">Break</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsTab({ isPremium, setIsPremium, setActiveView }: { isPremium: boolean, setIsPremium: (v: boolean) => void, setActiveView: (v: View) => void }) {
  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col animate-in fade-in duration-500">
      <h2 className="text-3xl font-medium mb-8 tracking-wide text-[var(--color-mist-text)]">User Settings</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Account */}
        <div className="glass-panel p-6 rounded-[32px] flex flex-col gap-6">
          <div className="flex justify-between items-start">
            <h3 className="text-lg font-medium text-[var(--color-mist-text)]/80">Account</h3>
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${isPremium ? 'bg-amber-600/20 text-amber-700' : 'bg-[var(--color-mist-text)]/10 text-[var(--color-mist-text)]/60'}`}>
              {isPremium ? 'Premium Member' : 'Free Member'}
            </span>
          </div>
          
          <div className="flex flex-col gap-5">
            <div className="flex justify-between items-center group">
              <div className="flex flex-col">
                <span className="text-sm text-[var(--color-mist-text)]/50">Username</span>
                <span className="text-base">AlexChenMusic</span>
              </div>
              <Edit2 className="w-4 h-4 text-[var(--color-mist-text)]/30 group-hover:text-[var(--color-mist-text)]/80 cursor-pointer transition-colors" />
            </div>
            
            <div className="flex justify-between items-center group">
              <div className="flex flex-col">
                <span className="text-sm text-[var(--color-mist-text)]/50">Email</span>
                <span className="text-base">alex.chen@example.com</span>
              </div>
              <span className="text-xs text-amber-700/80 cursor-pointer hover:text-amber-700">change</span>
            </div>

            <div className="flex justify-between items-center">
              <div className="flex flex-col">
                <span className="text-sm text-[var(--color-mist-text)]/50">Member Since</span>
                <span className="text-base">2024</span>
              </div>
            </div>
          </div>
          
          <button className="mt-auto w-full py-3 rounded-xl matte-button text-sm font-medium">
            Change Password
          </button>
        </div>
        
        {/* Studio Membership */}
        <div className="glass-panel p-6 rounded-[32px] flex flex-col gap-6 border-amber-600/10 bg-white/10">
          <h3 className="text-lg font-medium text-[var(--color-mist-text)]/80">Studio Membership</h3>
          
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-mist-text)]/50">Current Plan</span>
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-medium border ${isPremium ? 'bg-amber-600/20 border-amber-600/30 text-amber-800' : 'bg-white/20 border-white/20 text-[var(--color-mist-text)]'}`}>
                  {isPremium ? 'Premium' : 'Free'}
                </span>
              </div>
            </div>
            
            <div className="h-px w-full bg-white/10 my-1"></div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--color-mist-text)]/80">Premium Benefits</span>
              <Lock className="w-3.5 h-3.5 text-[var(--color-mist-text)]/30" />
            </div>
            
            <ul className="flex flex-col gap-5">
              {[
                { title: 'Access All Focus Environments', desc: 'Unlock every immersive visual and listening space.' },
                { title: 'Multi-Track Ambient Mixer', desc: 'Blend multiple ambient sounds to create your ideal atmosphere.' },
                { title: 'Custom Listening Presets', desc: 'Save your favorite combinations of music, ambience, and focus settings.' },
                { title: 'Smart Radio', desc: 'Keep listening with automatically matched songs and seamless playback.' }
              ].map((benefit, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center shrink-0 mt-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-mist-text)]/40"></div>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-[var(--color-mist-text)]/80 tracking-tight">{benefit.title}</span>
                    <span className="text-[11px] leading-relaxed text-[var(--color-mist-text)]/50">{benefit.desc}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          
          <button 
            onClick={() => setIsPremium(!isPremium)}
            className={`mt-auto w-full py-3 rounded-xl text-sm font-medium shadow-md transition-all ${isPremium ? 'bg-white/10 text-[var(--color-mist-text)]/40 hover:bg-white/20' : 'matte-button border-amber-600/20'}`}
          >
            {isPremium ? 'Manage Subscription' : 'Upgrade to Premium'}
          </button>
        </div>
        
        {/* Links & Community */}
        <div className="glass-panel p-6 rounded-[32px] flex flex-col gap-6">
          <h3 className="text-lg font-medium text-[var(--color-mist-text)]/80">Links & Community</h3>
          
          <div className="flex flex-col gap-3">
            {[
              { label: 'YouTube Channel', icon: <Youtube className="w-4 h-4" />, url: 'https://www.youtube.com/@TheVelvetLounge' },
              { label: 'Bilibili Channel', icon: <Tv className="w-4 h-4" />, url: 'https://space.bilibili.com' },
              { label: 'Sheet Music Store', icon: <BookOpen className="w-4 h-4" />, url: 'https://www.mymusicsheet.com' },
              { label: 'Contact Support', icon: <MessageCircle className="w-4 h-4" />, url: 'mailto:support@example.com' }
            ].map((link) => (
              <button 
                key={link.label}
                onClick={() => window.open(link.url, '_blank')}
                className="w-full py-3.5 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-sm font-medium text-[var(--color-mist-text)] flex items-center justify-between px-5 border border-white/20 shadow-sm group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-white/10 text-[var(--color-mist-text)]/60 group-hover:text-[var(--color-mist-text)] transition-colors">
                    {link.icon}
                  </div>
                  <span>{link.label}</span>
                </div>
                <ExternalLink className="w-3.5 h-3.5 opacity-20 group-hover:opacity-60 transition-opacity" />
              </button>
            ))}
          </div>

          <div className="mt-auto pt-4 border-t border-white/10 flex flex-col gap-4">
            <button
              onClick={() => setActiveView('admin')}
              className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-xs text-[var(--color-mist-text)]/40 hover:text-[var(--color-mist-text)]/80 border border-white/10 border-dashed"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Metadata Review (Dev Only)</span>
            </button>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-mist-text)]/80">Dark Mode</span>
              <div className="w-10 h-5 rounded-full bg-white/10 p-0.5 cursor-pointer">
                <div className="w-4 h-4 rounded-full bg-[var(--color-mist-text)]/60"></div>
              </div>
            </div>
          </div>
        </div>
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
                    <span className={`text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider ${
                      track.metadataStatus === 'approved' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
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
                    <span className={`text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider ${
                      artist.metadata_status === 'approved' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
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
