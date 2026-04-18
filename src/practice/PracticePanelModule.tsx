/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Lock, Search, Piano, Repeat, X } from 'lucide-react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { Midi } from '@tonejs/midi';
import * as Tone from 'tone';
import type { Track } from '../types/track';
import type { View } from '../types/view';
import type {
  PracticeMidiHeaderLite,
  PracticeSeekDebug,
  MusicalPosition,
  PracticeMeasureTimelineEntry,
} from './practice-types';
import { parseMusicXmlHandAssignment, consumeHandLabel } from '../musicxml-hand-utils';
import { stopPianoLikeVoice } from './piano-like-voice';
import { premiumUi, premiumUiModal } from '../premium-ui';
import {
  setPlaybackTimelineDuration,
  setPlaybackTimelineTime,
  getPlaybackTimelineSnapshot,
  subscribePlaybackTimeline,
} from '../playback-timeline-store';
function getTempoAtAudioTimeForHeader(header: PracticeMidiHeaderLite | null, timeSecs: number) {
  if (!header?.tempos?.length) return null;
  let activeTempo = header.tempos[0];
  for (let i = header.tempos.length - 1; i >= 0; i--) {
    if (timeSecs >= header.tempos[i].time) {
      activeTempo = header.tempos[i];
      break;
    }
  }
  return activeTempo;
}

function getTempoAtTickForHeader(header: PracticeMidiHeaderLite | null, targetTick: number) {
  if (!header?.tempos?.length) return null;
  let activeTempo = header.tempos[0];
  for (let i = header.tempos.length - 1; i >= 0; i--) {
    if (targetTick >= header.tempos[i].ticks) {
      activeTempo = header.tempos[i];
      break;
    }
  }
  return activeTempo;
}

function getAbsoluteTickAtAudioTimeForHeader(header: PracticeMidiHeaderLite | null, timeSecs: number) {
  const activeTempo = getTempoAtAudioTimeForHeader(header, timeSecs);
  if (!activeTempo || !header) return 0;
  const secondsSinceTempoChange = Math.max(0, timeSecs - activeTempo.time);
  const beatsElapsed = secondsSinceTempoChange * (activeTempo.bpm / 60);
  return activeTempo.ticks + (beatsElapsed * header.ppq);
}

function getAudioTimeForAbsoluteTickForHeader(header: PracticeMidiHeaderLite | null, targetTick: number) {
  const activeTempo = getTempoAtTickForHeader(header, targetTick);
  if (!activeTempo || !header) return 0;
  return activeTempo.time + (((targetTick - activeTempo.ticks) / header.ppq) / (activeTempo.bpm / 60));
}

function getLeadInMeasuresFromFirstNoteTick(firstNoteTick: number | null, header: PracticeMidiHeaderLite | null) {
  if (firstNoteTick === null || !header?.ppq) return 0;
  const beatsPerMeasure = header.timeSignatures?.[0]?.timeSignature?.[0] ?? 4;
  const ticksPerMeasure = beatsPerMeasure * header.ppq;
  if (!Number.isFinite(ticksPerMeasure) || ticksPerMeasure <= 0) return 0;
  const measureFloat = firstNoteTick / ticksPerMeasure;
  const rounded = Math.round(measureFloat);
  if (Math.abs(measureFloat - rounded) <= 0.05) {
    return Math.max(0, rounded);
  }
  return Math.max(0, Math.floor(measureFloat));
}

function getMusicalPositionAtAudioTimeForHeader(
  header: PracticeMidiHeaderLite | null,
  timeSecs: number,
  displayMeasureOffset = 0
): MusicalPosition {
  const absoluteTick = getAbsoluteTickAtAudioTimeForHeader(header, timeSecs);
  const ppq = header?.ppq ?? 480;
  const beatsPerMeasure = header?.timeSignatures?.[0]?.timeSignature?.[0] ?? 4;
  const ticksPerMeasure = ppq * beatsPerMeasure;
  const safeTick = Math.max(0, absoluteTick);
  const internalMeasureIndex = ticksPerMeasure > 0 ? Math.floor(safeTick / ticksPerMeasure) : 0;
  const internalMeasure = internalMeasureIndex + 1;
  const tickInMeasure = ticksPerMeasure > 0 ? safeTick - internalMeasureIndex * ticksPerMeasure : 0;
  const beatFloat = ppq > 0 ? safeTick / ppq : 0;
  const beatInMeasure = ppq > 0 ? Math.floor(tickInMeasure / ppq) + 1 : 1;
  const beatOffset = ppq > 0 ? (tickInMeasure % ppq) / ppq : 0;
  return {
    absoluteTick: safeTick,
    ticksPerMeasure,
    internalMeasureIndex,
    internalMeasure,
    displayMeasure: Math.max(1, internalMeasure - displayMeasureOffset),
    beatInMeasure,
    tickInMeasure,
    beatFloat,
    beatOffset,
    beatsPerMeasure,
  };
}

function getFractionRealValue(fraction: any): number {
  if (!fraction) return 0;
  if (typeof fraction.RealValue === 'number' && Number.isFinite(fraction.RealValue)) {
    return fraction.RealValue;
  }
  return 0;
}

function getFractionNumerator(fraction: any): number | null {
  if (!fraction) return null;
  const numerator = fraction.Numerator;
  return typeof numerator === 'number' && Number.isFinite(numerator) ? numerator : null;
}

function getFractionDenominator(fraction: any): number | null {
  if (!fraction) return null;
  const denominator = fraction.Denominator;
  return typeof denominator === 'number' && Number.isFinite(denominator) && denominator > 0 ? denominator : null;
}

function getTicksFromWholeNoteFraction(fraction: any, ppq: number) {
  return Math.max(0, getFractionRealValue(fraction) * ppq * 4);
}

function buildPracticeMeasureTimeline(
  osmd: any,
  header: PracticeMidiHeaderLite | null,
  midiNotes: Array<{ ticks?: number | null }> = []
): PracticeMeasureTimelineEntry[] {
  const sourceMeasures = osmd?.Sheet?.SourceMeasures;
  if (!header?.ppq || !Array.isArray(sourceMeasures) || sourceMeasures.length === 0) return [];

  let firstXmlSoundingTick: number | null = null;
  for (const measure of sourceMeasures) {
    const containers = Array.isArray(measure?.VerticalSourceStaffEntryContainers)
      ? measure.VerticalSourceStaffEntryContainers
      : [];
    for (const container of containers) {
      const staffEntries = Array.isArray(container?.StaffEntries) ? container.StaffEntries : [];
      for (const staffEntry of staffEntries) {
        const voiceEntries = Array.isArray(staffEntry?.VoiceEntries) ? staffEntry.VoiceEntries : [];
        for (const voiceEntry of voiceEntries) {
          const notes = Array.isArray(voiceEntry?.Notes) ? voiceEntry.Notes : [];
          const hasSoundingNote = notes.some((note: any) => typeof note?.isRest === 'function' ? !note.isRest() : true);
          if (!hasSoundingNote) continue;
          const absoluteTimestamp = typeof staffEntry?.AbsoluteTimestamp !== 'undefined'
            ? staffEntry.AbsoluteTimestamp
            : (typeof container?.getAbsoluteTimestamp === 'function' ? container.getAbsoluteTimestamp() : null);
          firstXmlSoundingTick = getTicksFromWholeNoteFraction(absoluteTimestamp, header.ppq);
          break;
        }
        if (firstXmlSoundingTick !== null) break;
      }
      if (firstXmlSoundingTick !== null) break;
    }
    if (firstXmlSoundingTick !== null) break;
  }

  const firstMidiNoteTick = midiNotes.reduce((min, note) => {
    const tick = Number(note?.ticks);
    return Number.isFinite(tick) ? Math.min(min, tick) : min;
  }, Infinity);
  const alignmentTickOffset = firstXmlSoundingTick !== null && Number.isFinite(firstMidiNoteTick)
    ? Math.max(0, firstMidiNoteTick - firstXmlSoundingTick)
    : 0;

  return sourceMeasures.map((measure: any, index: number) => {
    const startTick = getTicksFromWholeNoteFraction(measure?.AbsoluteTimestamp, header.ppq) + alignmentTickOffset;
    const durationTicks = Math.max(
      1,
      getTicksFromWholeNoteFraction(measure?.Duration, header.ppq)
    );
    const endTick = startTick + durationTicks;
    const timeSig = measure?.ActiveTimeSignature;
    const numerator = getFractionNumerator(timeSig);
    const denominator = getFractionDenominator(timeSig);
    const inferredBeatsPerMeasure = denominator
      ? Math.max(1, Math.round((getFractionRealValue(timeSig) * denominator) || 0))
      : Math.max(1, Math.round(getFractionRealValue(timeSig) * 4) || 4);
    const beatsPerMeasure = numerator ?? inferredBeatsPerMeasure;
    const beatUnit = denominator ?? 4;

    return {
      measureIndex: index,
      displayMeasure: index + 1,
      startTick,
      endTick,
      startTime: getAudioTimeForAbsoluteTickForHeader(header, startTick),
      endTime: getAudioTimeForAbsoluteTickForHeader(header, endTick),
      ticksPerMeasure: durationTicks,
      beatsPerMeasure,
      beatUnit,
      implicit: Boolean(measure?.ImplicitMeasure),
    };
  });
}

function getMusicalPositionAtAudioTimeForMeasureTimeline(
  header: PracticeMidiHeaderLite | null,
  timeline: PracticeMeasureTimelineEntry[] | null,
  timeSecs: number,
  displayMeasureOffset = 0,
  startIndex = 0
): MusicalPosition {
  if (!header?.ppq || !timeline?.length) {
    return getMusicalPositionAtAudioTimeForHeader(header, timeSecs, displayMeasureOffset);
  }

  const absoluteTick = Math.max(0, getAbsoluteTickAtAudioTimeForHeader(header, timeSecs));
  let activeIndex = Math.min(Math.max(0, Math.floor(startIndex)), timeline.length - 1);
  if (absoluteTick < timeline[activeIndex].startTick) {
    while (activeIndex > 0 && absoluteTick < timeline[activeIndex].startTick) {
      activeIndex--;
    }
  } else {
    while (activeIndex + 1 < timeline.length && absoluteTick >= timeline[activeIndex + 1].startTick) {
      activeIndex++;
    }
  }
  const activeMeasure = timeline[activeIndex];

  const tickInMeasure = Math.max(0, absoluteTick - activeMeasure.startTick);
  const ticksPerBeat = header.ppq * (4 / Math.max(1, activeMeasure.beatUnit));
  const beatInMeasure = Math.max(1, Math.min(
    activeMeasure.beatsPerMeasure,
    Math.floor(tickInMeasure / Math.max(1, ticksPerBeat)) + 1
  ));
  const beatOffset = ticksPerBeat > 0 ? (tickInMeasure % ticksPerBeat) / ticksPerBeat : 0;

  return {
    absoluteTick,
    ticksPerMeasure: activeMeasure.ticksPerMeasure,
    internalMeasureIndex: activeMeasure.measureIndex,
    internalMeasure: activeMeasure.measureIndex + 1,
    displayMeasure: Math.max(1, activeMeasure.displayMeasure - displayMeasureOffset),
    beatInMeasure,
    tickInMeasure,
    beatFloat: ticksPerBeat > 0 ? (activeMeasure.startTick / ticksPerBeat) + (tickInMeasure / ticksPerBeat) : 0,
    beatOffset,
    beatsPerMeasure: activeMeasure.beatsPerMeasure,
  };
}

function snapAudioTimeToNearestBeat(targetTime: number, header: PracticeMidiHeaderLite | null) {
  if (!header?.tempos?.length || !header.ppq) {
    return { targetTime, snappedTime: targetTime, snappedBeatNumber: null };
  }
  const absoluteTick = getAbsoluteTickAtAudioTimeForHeader(header, targetTime);
  const snappedBeatNumber = Math.max(0, Math.round(absoluteTick / header.ppq));
  const snappedTick = snappedBeatNumber * header.ppq;
  const snappedTime = getAudioTimeForAbsoluteTickForHeader(header, snappedTick);
  return { targetTime, snappedTime, snappedBeatNumber };
}

function snapAudioTimeToNearestMeasureStart(targetTime: number, header: PracticeMidiHeaderLite | null) {
  if (!header?.tempos?.length || !header.ppq) {
    return { targetTime, snappedTime: targetTime, snappedMeasureIndex: null, snappedBeatNumber: null };
  }
  const beatsPerMeasure = header.timeSignatures?.[0]?.timeSignature?.[0] ?? 4;
  const absoluteTick = getAbsoluteTickAtAudioTimeForHeader(header, targetTime);
  const absoluteBeatFloat = absoluteTick / header.ppq;
  const nearestMeasureIndex = Math.max(0, Math.round(absoluteBeatFloat / beatsPerMeasure));
  const snappedBeatNumber = nearestMeasureIndex * beatsPerMeasure;
  const snappedTick = snappedBeatNumber * header.ppq;
  const snappedTime = getAudioTimeForAbsoluteTickForHeader(header, snappedTick);
  return {
    targetTime,
    snappedTime,
    snappedMeasureIndex: nearestMeasureIndex,
    snappedBeatNumber,
  };
}

function getMainPlayerAudioElement() {
  return document.querySelector('audio[data-role="main-player"]') as HTMLAudioElement | null;
}

function pausePracticeAudioPair() {
  const mainAudio = getMainPlayerAudioElement();
  mainAudio?.pause();
}

function syncPracticeAudioPairToTime(timeSecs: number) {
  const mainAudio = getMainPlayerAudioElement();
  if (mainAudio) {
    mainAudio.currentTime = timeSecs;
  }
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
    output.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
}

function writeWavBlobFromMonoSamples(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  floatTo16BitPCM(view, 44, samples);

  return new Blob([buffer], { type: 'audio/wav' });
}

function generateClickTrackWavBlob(
  header: PracticeMidiHeaderLite | null,
  durationSecs: number
) {
  const sampleRate = 44100;
  const totalSamples = Math.max(1, Math.ceil(durationSecs * sampleRate));
  const samples = new Float32Array(totalSamples);
  if (!header?.tempos?.length || !header.ppq || durationSecs <= 0) {
    return writeWavBlobFromMonoSamples(samples, sampleRate);
  }

  const beatsPerMeasure = header.timeSignatures?.[0]?.timeSignature?.[0] ?? 4;
  const totalBeats = Math.ceil((getAbsoluteTickAtAudioTimeForHeader(header, durationSecs) / header.ppq)) + beatsPerMeasure + 1;
  const clickLengthSecs = 0.07;
  const clickLengthSamples = Math.floor(sampleRate * clickLengthSecs);

  for (let beatNumber = 0; beatNumber <= totalBeats; beatNumber++) {
    const when = getAudioTimeForAbsoluteTickForHeader(header, beatNumber * header.ppq);
    if (when > durationSecs + 0.1) break;
    const startSample = Math.round(when * sampleRate);
    const isStrong = (beatNumber % beatsPerMeasure) === 0;
    const baseFreq = isStrong ? 1700 : 1150;
    const overtoneFreq = isStrong ? 2550 : 1725;

    for (let i = 0; i < clickLengthSamples; i++) {
      const sampleIndex = startSample + i;
      if (sampleIndex < 0 || sampleIndex >= samples.length) break;
      const t = i / sampleRate;
      const decay = Math.exp(-t * (isStrong ? 36 : 42));
      const body = Math.sin(2 * Math.PI * baseFreq * t) * 0.52;
      const overtone = Math.sin(2 * Math.PI * overtoneFreq * t) * 0.18;
      const transient = (Math.random() * 2 - 1) * Math.exp(-t * 130) * (isStrong ? 0.11 : 0.07);
      samples[sampleIndex] += (body + overtone + transient) * decay;
    }
  }

  return writeWavBlobFromMonoSamples(samples, sampleRate);
}

function performPracticeMeasureSeek(args: {
  audio: HTMLAudioElement;
  targetTime: number;
  header: PracticeMidiHeaderLite | null;
  setPracticeSeekDebug: React.Dispatch<React.SetStateAction<PracticeSeekDebug>> | ((v: any) => void);
  onPracticeSnap: (message: string) => void;
  snapMessage: string;
  alwaysResume?: boolean;
}) {
  const { audio, targetTime, header, setPracticeSeekDebug, onPracticeSnap, snapMessage, alwaysResume = true } = args;
  const { snappedTime, snappedMeasureIndex, snappedBeatNumber } = snapAudioTimeToNearestMeasureStart(targetTime, header);
  const snappedMeasure = snappedMeasureIndex !== null ? snappedMeasureIndex + 1 : null;
  const baseDebug = {
    targetTime,
    snappedTime,
    snappedMeasure,
    snappedBeatNumber,
    measureStartTime: snappedTime,
    actualTime: snappedTime,
    targetDelta: snappedTime - targetTime,
    actualDelta: 0,
  };

  const finishSeek = () => {
    const actualTime = audio.currentTime;
    const seekedEventTime = performance.now();
    setPracticeSeekDebug((prev: PracticeSeekDebug) => ({
      ...prev,
      ...baseDebug,
      actualTime,
      actualDelta: actualTime - snappedTime,
      seekedEventTime,
    }));
    setPlaybackTimelineTime(actualTime, true);

    if (alwaysResume) {
      const playCallTime = performance.now();
      setPracticeSeekDebug((prev: PracticeSeekDebug) => ({
        ...prev,
        playCallTime,
      }));
      audio.play().catch(() => { });
    }
  };

  pausePracticeAudioPair();
  setPracticeSeekDebug((prev: PracticeSeekDebug) => ({
    ...prev,
    ...baseDebug,
    seekedEventTime: null,
    playCallTime: null,
    playEventTime: null,
    playingEventTime: null,
  }));
  setPlaybackTimelineTime(snappedTime, true);

  if (Math.abs(snappedTime - targetTime) > 0.001) {
    onPracticeSnap(snapMessage);
  }

  if (Math.abs(audio.currentTime - snappedTime) <= 0.001) {
    syncPracticeAudioPairToTime(snappedTime);
    finishSeek();
    return;
  }

  const handleSeeked = () => {
    audio.removeEventListener('seeked', handleSeeked);
    syncPracticeAudioPairToTime(snappedTime);
    finishSeek();
  };

  audio.addEventListener('seeked', handleSeeked);
  audio.currentTime = snappedTime;
}
export const PracticePanel = React.memo(function PracticePanel({
  currentTrack,
  isPlaying,
  setIsPlaying,
  playbackRate,
  setPlaybackRate,
  onClose,
  isPremium,
  setActiveView,
  practiceSeekDebug,
  setPracticeSeekDebug,
  onPracticeSnap,
  practiceSeekTarget,
  setPracticeSeekTarget,
  practiceMidiOutputVolume,
  practiceMidiOutputMuted,
  t
}: {
  currentTrack: Track,
  isPlaying: boolean,
  setIsPlaying: (v: boolean) => void,
  playbackRate: number,
  setPlaybackRate: (v: number) => void,
  onClose: () => void,
  isPremium: boolean,
  setActiveView: (v: View) => void,
  practiceSeekDebug: PracticeSeekDebug,
  setPracticeSeekDebug: React.Dispatch<React.SetStateAction<PracticeSeekDebug>>,
  onPracticeSnap: (message: string) => void,
  practiceSeekTarget: number | null,
  setPracticeSeekTarget: React.Dispatch<React.SetStateAction<number | null>>,
  practiceMidiOutputVolume: number,
  practiceMidiOutputMuted: boolean,
  t: any
}) {
  const playbackSnapshot = getPlaybackTimelineSnapshot();
  const lightweightMode = false;
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [osmdReady, setOsmdReady] = useState(false);
  const [midiNotes, setMidiNotes] = useState<any[]>([]);
  const [midiHeader, setMidiHeader] = useState<any>(null);
  const [practicePianoReady, setPracticePianoReady] = useState(false);
  const [practicePianoLoadError, setPracticePianoLoadError] = useState<string | null>(null);
  const formatDisplayedMeasure = (measure: number | null | undefined) => {
    if (measure === null || measure === undefined) return '-';
    return String(Math.max(1, measure));
  };

  const containerRef = React.useRef<HTMLDivElement>(null);
  const redLineRef = React.useRef<HTMLDivElement>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const staffViewportRef = React.useRef<HTMLDivElement>(null);
  const osmdRef = React.useRef<OpenSheetMusicDisplay | null>(null);
  const currentTimeRef = React.useRef(playbackSnapshot.currentTime);
  const renderedBlockRef = React.useRef(-1);
  const lastAutoScrollMeasureRef = React.useRef<number | null>(null);
  const lastRedLineFrameRef = React.useRef({ display: '', transform: '', width: '', height: '' });
  const lastScrollFrameRef = React.useRef({ clipPath: '', transform: '' });
  const practiceTransportFrameRef = React.useRef<number | null>(null);
  const practicePianoRef = React.useRef<any>(null);
  const practiceSchedulerTimerRef = React.useRef<number | null>(null);
  const practiceScheduledIndexRef = React.useRef(0);
  const practiceLastScheduledTimeRef = React.useRef(0);
  const practiceTriggeredNotesRef = React.useRef<Map<number, number>>(new Map());
  const practiceRecentTriggerKeysRef = React.useRef<Map<string, number>>(new Map());
  const practiceFallbackVoicesRef = React.useRef<any[]>([]);
  const practiceScheduledStopFnsRef = React.useRef<((time?: number) => void)[]>([]);
  const practiceEngineLoggedRef = React.useRef(false);
  const practiceLoopResetVersionRef = React.useRef(0);
  const practiceLoopRestartTimeRef = React.useRef<number | null>(null);
  const practiceLoopWrapGuardUntilRef = React.useRef(0);
  const practiceLoopPendingRestartRef = React.useRef<number | null>(null);
const PRACTICE_LOOP_HARD_CUT_SECS = 0.02;
const PRACTICE_TONE_SAMPLER_SUSTAIN_TAIL_SECS = 0.68;
const PRACTICE_TONE_SAMPLER_HIGH_NOTE_START_MIDI = 72; // C5
const PRACTICE_TONE_SAMPLER_BASE_URL = `${window.location.origin}/salamander/`;
const PRACTICE_TONE_SAMPLER_LOW_URLS: Record<string, string> = {
  A1: 'A1.mp3',
  C2: 'C2.mp3',
  'D#2': 'Ds2.mp3',
  'F#2': 'Fs2.mp3',
  A2: 'A2.mp3',
  C3: 'C3.mp3',
  'D#3': 'Ds3.mp3',
  'F#3': 'Fs3.mp3',
  A3: 'A3.mp3',
  C4: 'C4.mp3',
  'D#4': 'Ds4.mp3',
  'F#4': 'Fs4.mp3',
};
const PRACTICE_TONE_SAMPLER_HIGH_URLS: Record<string, string> = {
  C5: 'C5.mp3',
  'D#5': 'Ds5.mp3',
  'F#5': 'Fs5.mp3',
  A5: 'A5.mp3',
};
const PRACTICE_METRONOME_DELAY_COMPENSATION_SECS = 0.1;
const PRACTICE_MIDI_OUTPUT_GAIN_BOOST = 2.25;
  const practiceMetronomeTimerRef = React.useRef<number | null>(null);
  const practiceMetronomeNextBeatRef = React.useRef(0);
  const practiceMetronomeLastTimeRef = React.useRef(0);
  const practiceActiveMetronomeSourcesRef = React.useRef<AudioScheduledSourceNode[]>([]);
  const practiceInitialMountHandledRef = React.useRef(false);
  const practiceTransportRef = React.useRef({
    currentTime: playbackSnapshot.currentTime,
    startedAtTime: playbackSnapshot.currentTime,
    startedAtPerf: 0,
    duration: playbackSnapshot.duration,
    isPlaying: false,
    playbackRate: 1,
  });

  const loopRangeRef = React.useRef<HTMLDivElement>(null);
  const loopStartBlockRef = React.useRef<HTMLDivElement>(null);
  const loopEndBlockRef = React.useRef<HTMLDivElement>(null);

  // Practice Mode Lite Core Features Enablement
  const keyboardFxEnabled = true;
  const diagMaster = true;
  const diagScore = true;
  const diagKeyboard = true;
  const diagMeasure = true;
  const diagScroll = !lightweightMode;
  const diagBgAnim = !lightweightMode;

  const diagRef = React.useRef({ diagMaster, diagScore, diagKeyboard, diagMeasure, diagScroll });
  React.useEffect(() => {
    diagRef.current = { diagMaster, diagScore, diagKeyboard, diagMeasure, diagScroll };
  }, [diagMaster, diagScore, diagKeyboard, diagMeasure, diagScroll]);

  const [handFilter, setHandFilter] = useState<'both' | 'left' | 'right'>('both');
  const [handSeparationAvailable, setHandSeparationAvailable] = useState(true);
  const [noteNameMode, setNoteNameMode] = useState<'off' | 'letter' | 'number'>('letter');
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [metronomeVol, setMetronomeVol] = useState(50);
  const stateRefs = React.useRef({ handFilter, noteNameMode, metronomeOn, metronomeVol, isPlaying });
  React.useEffect(() => {
    stateRefs.current = { handFilter, noteNameMode, metronomeOn, metronomeVol, isPlaying };
  }, [handFilter, noteNameMode, metronomeOn, metronomeVol, isPlaying]);

  React.useEffect(() => {
    if (!handSeparationAvailable && handFilter !== 'both') {
      setHandFilter('both');
    }
  }, [handSeparationAvailable]);
  const simultaneousNoteCounts = React.useMemo(() => {
    const counts = {
      both: new Map<string, number>(),
      left: new Map<string, number>(),
      right: new Map<string, number>(),
    };
    for (const note of midiNotes) {
      const key = Number(note.time ?? 0).toFixed(6);
      counts.both.set(key, (counts.both.get(key) ?? 0) + 1);
      if (note.hand === 'left' || note.hand === 'right') {
        counts[note.hand].set(key, (counts[note.hand].get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [midiNotes]);

  // Handle A-B Looping State seamlessly across frames using strict Measure indexes
  const [loopM1, setLoopM1] = useState<number | null>(null);
  const [loopM2, setLoopM2] = useState<number | null>(null);
  const [isLoopSelectMode, setIsLoopSelectMode] = useState(false);
  const loopRef = React.useRef<{ M1: number | null, M2: number | null }>({ M1: null, M2: null });
  const currentMeasureIndexRef = React.useRef(0);
  const practiceMeasureTimelineRef = React.useRef<PracticeMeasureTimelineEntry[]>([]);
  const leadInMeasures = React.useMemo(() => {
    if (!midiHeader?.ppq || !midiNotes.length) return 0;
    const firstNoteTick = midiNotes.reduce((min, note) => Math.min(min, note.ticks ?? Infinity), Infinity);
    return getLeadInMeasuresFromFirstNoteTick(Number.isFinite(firstNoteTick) ? firstNoteTick : null, midiHeader);
  }, [midiHeader, midiNotes]);
  const practiceTransportEnabled = true;
  const practiceTrackDuration = React.useMemo(() => {
    if (!midiNotes.length) return 0;
    return midiNotes.reduce((max, note) => Math.max(max, (note.time ?? 0) + Math.max(0, note.duration ?? 0)), 0);
  }, [midiNotes]);

  const getPracticeNoteIndexAtTime = React.useCallback((timeSecs: number) => {
    let idx = 0;
    while (idx < midiNotes.length && (midiNotes[idx].time ?? 0) < Math.max(0, timeSecs - 0.02)) {
      idx++;
    }
    return idx;
  }, [midiNotes]);

  const getMeasureStartTime = React.useCallback((displayMeasureIndex: number) => {
    if (!midiHeader) return 0;
    const beatsPerM = midiHeader.timeSignatures?.[0]?.timeSignature?.[0] ?? 4;
    const targetTick = (displayMeasureIndex + leadInMeasures) * beatsPerM * midiHeader.ppq;
    let act = midiHeader.tempos[0];
    for (let i = midiHeader.tempos.length - 1; i >= 0; i--) {
      if (targetTick >= midiHeader.tempos[i].ticks) { act = midiHeader.tempos[i]; break; }
    }
    return act.time + ((targetTick - act.ticks) / midiHeader.ppq) / (act.bpm / 60);
  }, [leadInMeasures, midiHeader]);

  const getPracticeTransportTime = React.useCallback(() => {
    const transport = practiceTransportRef.current;
    if (!practiceTransportEnabled) return currentTimeRef.current;
    if (!transport.isPlaying) return transport.currentTime;
    const elapsed = ((performance.now() - transport.startedAtPerf) / 1000) * transport.playbackRate;
    return Math.max(0, Math.min(transport.duration, transport.startedAtTime + elapsed));
  }, [practiceTransportEnabled]);

  const stopPracticeTransportFrame = React.useCallback(() => {
    if (practiceTransportFrameRef.current !== null) {
      cancelAnimationFrame(practiceTransportFrameRef.current);
      practiceTransportFrameRef.current = null;
    }
  }, []);

  const stopPracticeFallbackVoices = React.useCallback(() => {
    const active = practicePianoRef.current;
    if (!active?.ctx) {
      practiceFallbackVoicesRef.current = [];
      return;
    }
    const stopAt = active.ctx.currentTime;
    practiceFallbackVoicesRef.current.forEach(voice => {
      stopPianoLikeVoice(active.ctx, voice, stopAt);
    });
    practiceFallbackVoicesRef.current = [];
  }, []);

  const stopPracticeScheduledNotes = React.useCallback(() => {
    practiceScheduledStopFnsRef.current.forEach(stopFn => {
      try {
        stopFn();
      } catch { }
    });
    practiceScheduledStopFnsRef.current = [];
  }, []);

  const stopPracticeMetronomeSources = React.useCallback(() => {
    practiceActiveMetronomeSourcesRef.current.forEach(source => {
      try {
        source.stop(0);
      } catch { }
      try {
        source.disconnect();
      } catch { }
    });
    practiceActiveMetronomeSourcesRef.current = [];
  }, []);

  const syncPracticeTransportFrame = React.useCallback(() => {
    if (!practiceTransportEnabled) return;
    const tick = () => {
      let nextTime = getPracticeTransportTime();
      const loopStart = loopRef.current.M1;
      const loopEnd = loopRef.current.M2;
      if (loopStart !== null && loopEnd !== null && midiHeader) {
        const loopStartTime = getMeasureStartTime(loopStart);
        const loopEndTime = getMeasureStartTime(loopEnd + 1);
        const hardLoopEndTime = Math.max(loopStartTime, loopEndTime - PRACTICE_LOOP_HARD_CUT_SECS);
        if (nextTime >= hardLoopEndTime || nextTime < loopStartTime) {
          nextTime = loopStartTime;
          practiceTransportRef.current.startedAtTime = nextTime;
          practiceTransportRef.current.startedAtPerf = performance.now();
          practiceTransportRef.current.currentTime = nextTime;
          practiceLoopResetVersionRef.current += 1;
          practiceLoopRestartTimeRef.current = nextTime;
          practiceLoopPendingRestartRef.current = nextTime;
          practiceScheduledIndexRef.current = getPracticeNoteIndexAtTime(nextTime);
          practiceLastScheduledTimeRef.current = nextTime;
          practiceTriggeredNotesRef.current.clear();
          practiceLoopWrapGuardUntilRef.current = 0;
          try {
            practicePianoRef.current?.stop?.();
          } catch { }
          stopPracticeScheduledNotes();
          stopPracticeFallbackVoices();
        }
      }
      practiceTransportRef.current.currentTime = nextTime;
      setPlaybackTimelineTime(nextTime);
      if (practiceTransportRef.current.isPlaying && nextTime < practiceTransportRef.current.duration) {
        practiceTransportFrameRef.current = requestAnimationFrame(tick);
      } else {
        practiceTransportRef.current.isPlaying = false;
        setIsPlaying(false);
        practiceTransportFrameRef.current = null;
      }
    };
    stopPracticeTransportFrame();
    practiceTransportFrameRef.current = requestAnimationFrame(tick);
  }, [getMeasureStartTime, getPracticeNoteIndexAtTime, getPracticeTransportTime, midiHeader, practiceTransportEnabled, setPlaybackTimelineTime, setIsPlaying, stopPracticeFallbackVoices, stopPracticeScheduledNotes, stopPracticeTransportFrame]);

  const jumpToDisplayMeasure = React.useCallback((displayMeasureNumber: number) => {
    if (!midiHeader) return;
    const totalMeasures = osmdRef.current?.GraphicSheet?.MeasureList?.length ?? 0;
    const clampedDisplayMeasure = Math.max(1, totalMeasures > 0 ? Math.min(displayMeasureNumber, totalMeasures) : displayMeasureNumber);
    const displayMeasureIndex = clampedDisplayMeasure - 1;
    const beatsPerM = midiHeader.timeSignatures?.[0]?.timeSignature?.[0] ?? 4;
    const targetTick = (displayMeasureIndex + leadInMeasures) * beatsPerM * midiHeader.ppq;
    let act = midiHeader.tempos[0];
    for (let i = midiHeader.tempos.length - 1; i >= 0; i--) {
      if (targetTick >= midiHeader.tempos[i].ticks) { act = midiHeader.tempos[i]; break; }
    }
    const seekSecs = act.time + ((targetTick - act.ticks) / midiHeader.ppq) / (act.bpm / 60);
    setIsPlaying(false);
    if (practiceTransportEnabled) {
      practiceTransportRef.current.currentTime = seekSecs;
      practiceTransportRef.current.startedAtTime = seekSecs;
      practiceTransportRef.current.startedAtPerf = performance.now();
      practiceTransportRef.current.isPlaying = false;
      setPlaybackTimelineTime(seekSecs, true);
      setPracticeSeekDebug(prev => ({
        ...prev,
        targetTime: seekSecs,
        snappedTime: seekSecs,
        measureStartTime: seekSecs,
        snappedMeasure: clampedDisplayMeasure,
        actualTime: seekSecs,
        targetDelta: 0,
        actualDelta: 0,
      }));
      return;
    }
    const audio = document.querySelector('audio') as HTMLAudioElement | null;
    if (!audio) return;
    performPracticeMeasureSeek({
      audio,
      targetTime: seekSecs,
      header: midiHeader,
      setPracticeSeekDebug,
      onPracticeSnap,
      snapMessage: t.common.measureSnapped,
      alwaysResume: false,
    });
  }, [leadInMeasures, midiHeader, onPracticeSnap, practiceTransportEnabled, setPlaybackTimelineTime, setIsPlaying, setPracticeSeekDebug, t.common.measureSnapped]);

  const getTempoAtAudioTime = (header: typeof midiHeader, timeSecs: number) => {
    if (!header?.tempos?.length) return null;
    let activeTempo = header.tempos[0];
    for (let i = header.tempos.length - 1; i >= 0; i--) {
      if (timeSecs >= header.tempos[i].time) {
        activeTempo = header.tempos[i];
        break;
      }
    }
    return activeTempo;
  };

  const getTempoAtTick = (header: typeof midiHeader, targetTick: number) => {
    if (!header?.tempos?.length) return null;
    let activeTempo = header.tempos[0];
    for (let i = header.tempos.length - 1; i >= 0; i--) {
      if (targetTick >= header.tempos[i].ticks) {
        activeTempo = header.tempos[i];
        break;
      }
    }
    return activeTempo;
  };

  const getAbsoluteTickAtAudioTime = (header: typeof midiHeader, timeSecs: number) => {
    const activeTempo = getTempoAtAudioTime(header, timeSecs);
    if (!activeTempo || !header) return 0;
    const secondsSinceTempoChange = Math.max(0, timeSecs - activeTempo.time);
    const beatsElapsed = secondsSinceTempoChange * (activeTempo.bpm / 60);
    const ticksElapsed = beatsElapsed * header.ppq;
    return activeTempo.ticks + ticksElapsed;
  };

  const getAudioTimeForAbsoluteTick = (header: typeof midiHeader, targetTick: number) => {
    const activeTempo = getTempoAtTick(header, targetTick);
    if (!activeTempo || !header) return 0;
    const beatsFromTempoChange = (targetTick - activeTempo.ticks) / header.ppq;
    return activeTempo.time + (beatsFromTempoChange / (activeTempo.bpm / 60));
  };

  const getPracticeBeatPositionAtAudioTime = (header: typeof midiHeader, timeSecs: number) => {
    const musicalPosition = getMusicalPositionAtAudioTimeForHeader(header, timeSecs, leadInMeasures);
    const wholeBeats = Math.floor(musicalPosition.beatFloat);
    return {
      absoluteTick: musicalPosition.absoluteTick,
      normalizedTick: musicalPosition.absoluteTick,
      beatFloat: musicalPosition.beatFloat,
      beatIndex: wholeBeats,
      beatOffset: musicalPosition.beatOffset,
      measureIndex: musicalPosition.internalMeasureIndex,
      internalMeasure: musicalPosition.internalMeasure,
      displayMeasure: musicalPosition.displayMeasure,
      beatInMeasure: musicalPosition.beatInMeasure,
      tickInMeasure: musicalPosition.tickInMeasure,
      beatsPerMeasure: musicalPosition.beatsPerMeasure,
      ticksPerMeasure: musicalPosition.ticksPerMeasure,
    };
  };

  const getAudioTimeForPracticeBeat = (header: typeof midiHeader, beatNumber: number) => {
    if (!header) return 0;
    return getAudioTimeForAbsoluteTick(header, beatNumber * header.ppq);
  };

  const getNextMetronomeBoundaryAtAudioTime = (header: typeof midiHeader, timeSecs: number) => {
    const beatPositionNow = getPracticeBeatPositionAtAudioTime(header, timeSecs);
    const beatFloatNow = beatPositionNow.beatFloat;
    const nearestBeatBoundary = Math.round(beatFloatNow);
    const beatBoundaryTolerance = 0.02;
    const beatNumber = Math.abs(beatFloatNow - nearestBeatBoundary) <= beatBoundaryTolerance
      ? Math.max(0, nearestBeatBoundary)
      : Math.max(0, Math.floor(beatFloatNow) + 1);
    return {
      beatNumber,
      measureIndex: Math.floor(beatNumber / beatPositionNow.beatsPerMeasure),
      beatInMeasure: (beatNumber % beatPositionNow.beatsPerMeasure) + 1,
      isAccent: (beatNumber % beatPositionNow.beatsPerMeasure) === 0,
    };
  };

  React.useEffect(() => {
    loopRef.current = { M1: loopM1, M2: loopM2 };
  }, [loopM1, loopM2]);

  // When loop is fully established, immediately seek audio to M1 and exit select mode
  React.useEffect(() => {
    if (loopM1 === null || loopM2 === null) return;
    // Auto-exit selection mode when loop is complete
    setIsLoopSelectMode(false);
    if (!midiHeader || !practiceTransportEnabled) return;
    const loopStartTime = getMeasureStartTime(loopM1);
    practiceTransportRef.current.currentTime = loopStartTime;
    practiceTransportRef.current.startedAtTime = loopStartTime;
    practiceTransportRef.current.startedAtPerf = performance.now();
    practiceLoopResetVersionRef.current += 1;
    practiceLoopRestartTimeRef.current = loopStartTime;
    practiceLoopPendingRestartRef.current = loopStartTime;
    practiceScheduledIndexRef.current = getPracticeNoteIndexAtTime(loopStartTime);
    practiceLastScheduledTimeRef.current = loopStartTime;
    practiceTriggeredNotesRef.current.clear();
    practiceLoopWrapGuardUntilRef.current = 0;
    try {
      practicePianoRef.current?.stop?.();
    } catch { }
    stopPracticeScheduledNotes();
    stopPracticeFallbackVoices();
    setPlaybackTimelineTime(loopStartTime, true);
    setPracticeSeekDebug(prev => ({
      ...prev,
      targetTime: loopStartTime,
      snappedTime: loopStartTime,
      measureStartTime: loopStartTime,
      snappedMeasure: loopM1 + 1,
      actualTime: loopStartTime,
      targetDelta: 0,
      actualDelta: 0,
    }));
  }, [getMeasureStartTime, getPracticeNoteIndexAtTime, loopM1, loopM2, midiHeader, practiceTransportEnabled, setPlaybackTimelineTime, setPracticeSeekDebug, stopPracticeFallbackVoices, stopPracticeScheduledNotes]);

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
    }
  };

  // Keep playback refs in sync without re-rendering the whole practice panel.
  React.useEffect(() => {
    const syncPlaybackSnapshot = () => {
      const snapshot = getPlaybackTimelineSnapshot();
      currentTimeRef.current = snapshot.currentTime;
      practiceTransportRef.current.duration = snapshot.duration;
    };

    syncPlaybackSnapshot();
    return subscribePlaybackTimeline(syncPlaybackSnapshot);
  }, []);

  React.useEffect(() => {
    practiceTransportRef.current.duration = practiceTrackDuration;
    practiceTransportRef.current.playbackRate = playbackRate;
    if (practiceTransportEnabled) {
      setPlaybackTimelineDuration(practiceTrackDuration);
      setPlaybackTimelineTime(practiceTransportRef.current.currentTime, true);
    }
  }, [practiceTrackDuration, playbackRate, practiceTransportEnabled, setPlaybackTimelineTime, setPlaybackTimelineDuration]);

  React.useEffect(() => {
    if (!practiceTransportEnabled) {
      stopPracticeTransportFrame();
      return stopPracticeTransportFrame;
    }

    if (isPlaying) {
      let nextStartTime = practiceTransportRef.current.currentTime;
      const loopStart = loopRef.current.M1;
      const loopEnd = loopRef.current.M2;
      if (loopStart !== null && loopEnd !== null && midiHeader) {
        const loopStartTime = getMeasureStartTime(loopStart);
        const loopEndTime = getMeasureStartTime(loopEnd + 1);
        if (nextStartTime < loopStartTime || nextStartTime >= loopEndTime) {
          nextStartTime = loopStartTime;
          practiceTransportRef.current.currentTime = nextStartTime;
          practiceLoopResetVersionRef.current += 1;
          practiceLoopRestartTimeRef.current = nextStartTime;
          practiceLoopPendingRestartRef.current = nextStartTime;
          practiceScheduledIndexRef.current = getPracticeNoteIndexAtTime(nextStartTime);
          practiceLastScheduledTimeRef.current = nextStartTime;
          practiceTriggeredNotesRef.current.clear();
          practiceLoopWrapGuardUntilRef.current = 0;
          try {
            practicePianoRef.current?.stop?.();
          } catch { }
          stopPracticeScheduledNotes();
          stopPracticeFallbackVoices();
          setPlaybackTimelineTime(nextStartTime, true);
        }
      }
      practiceTransportRef.current.isPlaying = true;
      practiceTransportRef.current.startedAtTime = nextStartTime;
      practiceTransportRef.current.startedAtPerf = performance.now();
      practiceTransportRef.current.playbackRate = playbackRate;
      syncPracticeTransportFrame();
      return stopPracticeTransportFrame;
    }

    practiceTransportRef.current.currentTime = getPracticeTransportTime();
    practiceTransportRef.current.isPlaying = false;
    stopPracticeTransportFrame();
    setPlaybackTimelineTime(practiceTransportRef.current.currentTime, true);
    return stopPracticeTransportFrame;
  }, [getMeasureStartTime, getPracticeNoteIndexAtTime, getPracticeTransportTime, isPlaying, midiHeader, playbackRate, practiceTransportEnabled, setPlaybackTimelineTime, stopPracticeFallbackVoices, stopPracticeScheduledNotes, stopPracticeTransportFrame, syncPracticeTransportFrame]);

  React.useEffect(() => {
    if (!practiceInitialMountHandledRef.current) {
      practiceInitialMountHandledRef.current = true;
      practiceTransportRef.current.currentTime = currentTimeRef.current;
      practiceTransportRef.current.startedAtTime = currentTimeRef.current;
      practiceTransportRef.current.startedAtPerf = performance.now();
      practiceTransportRef.current.isPlaying = false;
      if (practiceTransportEnabled) {
        setPlaybackTimelineTime(currentTimeRef.current, true);
        setPlaybackTimelineDuration(practiceTrackDuration);
      }
      return;
    }

    practiceTransportRef.current.currentTime = 0;
    practiceTransportRef.current.startedAtTime = 0;
    practiceTransportRef.current.startedAtPerf = performance.now();
    practiceTransportRef.current.isPlaying = false;
    if (practiceTransportEnabled) {
      setPlaybackTimelineTime(0, true);
      setPlaybackTimelineDuration(practiceTrackDuration);
    }
  }, [currentTrack.id, practiceTrackDuration, practiceTransportEnabled, setPlaybackTimelineTime, setPlaybackTimelineDuration]);

  React.useEffect(() => {
    return () => {
      practiceTransportRef.current.isPlaying = false;
      stopPracticeTransportFrame();
      if (practiceSchedulerTimerRef.current !== null) {
        window.clearInterval(practiceSchedulerTimerRef.current);
        practiceSchedulerTimerRef.current = null;
      }
      if (practiceMetronomeTimerRef.current !== null) {
        window.clearInterval(practiceMetronomeTimerRef.current);
        practiceMetronomeTimerRef.current = null;
      }
      stopPracticeScheduledNotes();
      stopPracticeFallbackVoices();
      stopPracticeMetronomeSources();
    };
  }, [stopPracticeFallbackVoices, stopPracticeMetronomeSources, stopPracticeScheduledNotes, stopPracticeTransportFrame]);

  // Load MIDI Notes and Time Map — with single-track MusicXML hand derivation
  React.useEffect(() => {
    if (!currentTrack.midiUrl) return;
    let cancelled = false;
    let idleHandle: number | undefined;

    const loadMidi = async () => {
      try {
        const res = await fetch(currentTrack.midiUrl);
        const buf = await res.arrayBuffer();
        if (cancelled) return;

        const midi = new Midi(buf);

        setMidiHeader({
          tempos: midi.header.tempos,
          ppq: midi.header.ppq,
          timeSignatures: midi.header.timeSignatures,
        });

        const trackPitches = midi.tracks
          .filter(t => t.notes.length > 0)
          .map(t => {
            const avg = t.notes.reduce((sum, n) => sum + n.midi, 0) / t.notes.length;
            return { track: t, avgPitch: avg };
          })
          .sort((a, b) => b.avgPitch - a.avgPitch);

        const isSingleTrack = trackPitches.length <= 1;
        let handMode: 'dual-track' | 'musicxml-derived' | 'both-only' = 'dual-track';
        let xmlQueues: Map<number, ('left' | 'right')[]> | null = null;

        if (isSingleTrack && currentTrack.musicxmlUrl) {
          try {
            const xmlRes = await fetch(currentTrack.musicxmlUrl);
            const xmlText = await xmlRes.text();
            if (cancelled) return;
            const result = parseMusicXmlHandAssignment(xmlText);
            if (result && result.leftCount > 0 && result.rightCount > 0) {
              xmlQueues = result.pitchHandQueues;
              handMode = 'musicxml-derived';
            } else {
              handMode = 'both-only';
            }
          } catch {
            handMode = 'both-only';
          }
        } else if (isSingleTrack) {
          handMode = 'both-only';
        }

        if (cancelled) return;

        const rightTrack = trackPitches[0]?.track;
        const leftTrack = trackPitches[1]?.track;

        const notes: any[] = [];

        if (handMode === 'dual-track') {
          midi.tracks.forEach(track => {
            if (track.notes.length === 0) return;
            const hand = track === rightTrack ? 'right' : track === leftTrack ? 'left' : 'right';
            track.notes.forEach(note => {
              notes.push({
                name: note.name,
                midi: note.midi,
                time: note.time,
                duration: note.duration,
                ticks: note.ticks,
                velocity: note.velocity ?? 0.7,
                hand,
              });
            });
          });
        } else if (handMode === 'musicxml-derived' && xmlQueues) {
          midi.tracks.forEach(track => {
            if (track.notes.length === 0) return;
            track.notes.forEach(note => {
              notes.push({
                name: note.name,
                midi: note.midi,
                time: note.time,
                duration: note.duration,
                ticks: note.ticks,
                velocity: note.velocity ?? 0.7,
                hand: consumeHandLabel(note.midi, xmlQueues!),
              });
            });
          });
        } else {
          midi.tracks.forEach(track => {
            if (track.notes.length === 0) return;
            track.notes.forEach(note => {
              notes.push({
                name: note.name,
                midi: note.midi,
                time: note.time,
                duration: note.duration,
                ticks: note.ticks,
                velocity: note.velocity ?? 0.7,
                hand: 'right' as const,
              });
            });
          });
        }

        notes.sort((a, b) => a.time - b.time);
        setMidiNotes(notes);
        setHandSeparationAvailable(handMode !== 'both-only');
      } catch (err) {
        console.error(err);
      }
    };

    if (typeof requestIdleCallback !== 'undefined') {
      idleHandle = requestIdleCallback(() => {
        void loadMidi();
      }, {timeout: 600});
    } else {
      idleHandle = window.setTimeout(() => {
        void loadMidi();
      }, 0) as unknown as number;
    }

    return () => {
      cancelled = true;
      if (idleHandle != null) {
        if (typeof cancelIdleCallback !== 'undefined') {
          cancelIdleCallback(idleHandle);
        } else {
          window.clearTimeout(idleHandle);
        }
      }
    };
  }, [currentTrack.midiUrl, currentTrack.musicxmlUrl]);

  React.useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let ctx: AudioContext | null = null;

    setPracticePianoReady(false);
    setPracticePianoLoadError(null);
    practicePianoRef.current = null;
    practiceEngineLoggedRef.current = false;

    rafId = window.requestAnimationFrame(() => {
      if (cancelled) return;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        setPracticePianoLoadError('Web Audio unavailable');
        return;
      }

      const toneContext = Tone.getContext();
      ctx = toneContext.rawContext as AudioContext;
      const pianoEq = new Tone.EQ3({
        low: 0.3,
        mid: 1.5,
        high: 3.2,
        lowFrequency: 180,
        highFrequency: 2600,
      });
      const pianoLowpass = new Tone.Filter({
        type: 'lowpass',
        frequency: 15500,
        rolloff: -12,
        Q: 0.6,
      });
      const pianoCompressor = new Tone.Compressor({
        threshold: -18,
        ratio: 2.2,
        attack: 0.01,
        release: 0.18,
      });
      const pianoOutput = new Tone.Gain(Math.min(2.25, 0.7 * PRACTICE_MIDI_OUTPUT_GAIN_BOOST));
      const lowSampler = new Tone.Sampler({
        urls: PRACTICE_TONE_SAMPLER_LOW_URLS,
        baseUrl: PRACTICE_TONE_SAMPLER_BASE_URL,
        release: 2.05,
        volume: -3.2,
        onerror: (error) => {
          console.error('Failed to load Tone sampler piano', error);
          if (cancelled) return;
          practicePianoRef.current = { ctx, piano: null };
          setPracticePianoLoadError('Preparing piano failed');
        },
      });
      const highSampler = new Tone.Sampler({
        urls: PRACTICE_TONE_SAMPLER_HIGH_URLS,
        baseUrl: PRACTICE_TONE_SAMPLER_BASE_URL,
        release: 1.92,
        volume: -4.2,
        onerror: (error) => {
          console.error('Failed to load Tone high sampler piano', error);
          if (cancelled) return;
          practicePianoRef.current = { ctx, piano: null };
          setPracticePianoLoadError('Preparing piano failed');
        },
      });
      lowSampler.chain(pianoEq, pianoLowpass, pianoCompressor, pianoOutput, Tone.Destination);
      highSampler.chain(pianoEq, pianoLowpass, pianoCompressor, pianoOutput, Tone.Destination);

      Tone.loaded()
        .then(() => {
          if (cancelled) return;
          practicePianoRef.current = {
            ctx,
            piano: lowSampler,
            pianoHigh: highSampler,
            output: pianoOutput,
            stop: (time?: number) => {
              const stopTime = time ?? Tone.now();
              lowSampler.releaseAll(stopTime);
              highSampler.releaseAll(stopTime);
            },
            dispose: () => {
              lowSampler.dispose();
              highSampler.dispose();
              pianoEq.dispose();
              pianoLowpass.dispose();
              pianoCompressor.dispose();
              pianoOutput.dispose();
            },
          };
          setPracticePianoReady(true);
        })
        .catch((error) => {
          console.error('Failed to finish loading Tone sampler piano', error);
          if (cancelled) return;
          practicePianoRef.current = { ctx, piano: null };
          setPracticePianoLoadError('Preparing piano failed');
        });
    });

    return () => {
      cancelled = true;
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      const current = practicePianoRef.current;
      if (ctx && current?.ctx === ctx) {
        try {
          current.stop?.();
          current.dispose?.();
        } catch { }
        practicePianoRef.current = null;
      }
    };
  }, [currentTrack.id]);

  React.useEffect(() => {
    const output = practicePianoRef.current?.output as Tone.Gain | undefined;
    if (!output) return;
    const targetGain = practiceMidiOutputMuted
      ? 0
      : Math.max(0, Math.min(2.25, practiceMidiOutputVolume * PRACTICE_MIDI_OUTPUT_GAIN_BOOST));
    try {
      output.gain.rampTo(targetGain, 0.02);
    } catch {
      output.gain.value = targetGain;
    }
  }, [practiceMidiOutputMuted, practiceMidiOutputVolume]);

  React.useEffect(() => {
    if (!practiceTransportEnabled) return;
    if (!isPlaying) return;
    if (practicePianoReady || practicePianoLoadError) return;
    setIsPlaying(false);
  }, [isPlaying, practicePianoLoadError, practicePianoReady, practiceTransportEnabled, setIsPlaying]);

  React.useEffect(() => {
    if (!practiceTransportEnabled) return;
    if (!isPlaying && !practicePianoLoadError) return;

    const active = practicePianoRef.current;
    Tone.start().catch(() => { });
    active?.ctx?.resume?.().catch(() => { });
  }, [isPlaying, practicePianoLoadError, practiceTransportEnabled]);

  React.useEffect(() => {
    if (!practiceTransportEnabled) return;
    if (practiceSeekTarget === null) return;
    const clampedTime = Math.max(0, Math.min(practiceTrackDuration, practiceSeekTarget));
    try {
      practicePianoRef.current?.stop?.();
    } catch { }
    stopPracticeScheduledNotes();
    stopPracticeFallbackVoices();
    stopPracticeMetronomeSources();
    practiceScheduledIndexRef.current = getPracticeNoteIndexAtTime(clampedTime);
    practiceLastScheduledTimeRef.current = clampedTime - 0.001;
    practiceTriggeredNotesRef.current.clear();
    practiceRecentTriggerKeysRef.current.clear();
    if (midiHeader) {
      const nextBoundary = getNextMetronomeBoundaryAtAudioTime(midiHeader, clampedTime);
      practiceMetronomeNextBeatRef.current = nextBoundary.beatNumber;
      practiceMetronomeLastTimeRef.current = clampedTime;
    }
    practiceTransportRef.current.currentTime = clampedTime;
    practiceTransportRef.current.startedAtTime = clampedTime;
    practiceTransportRef.current.startedAtPerf = performance.now();
    setPlaybackTimelineTime(clampedTime, true);
    setPracticeSeekTarget(null);
  }, [
    getPracticeNoteIndexAtTime,
    midiHeader,
    practiceSeekTarget,
    practiceTrackDuration,
    practiceTransportEnabled,
    setPlaybackTimelineTime,
    setPracticeSeekTarget,
    stopPracticeFallbackVoices,
    stopPracticeMetronomeSources,
    stopPracticeScheduledNotes,
  ]);

  React.useEffect(() => {
    if (!practiceTransportEnabled) return;

    const clearScheduler = () => {
      if (practiceSchedulerTimerRef.current !== null) {
        window.clearInterval(practiceSchedulerTimerRef.current);
        practiceSchedulerTimerRef.current = null;
      }
      practiceScheduledIndexRef.current = 0;
      practiceLastScheduledTimeRef.current = 0;
      practiceTriggeredNotesRef.current.clear();
      practiceRecentTriggerKeysRef.current.clear();
      try {
        practicePianoRef.current?.stop?.();
      } catch { }
      stopPracticeScheduledNotes();
      stopPracticeFallbackVoices();
    };

    if (!isPlaying || !midiNotes.length) {
      clearScheduler();
      return;
    }

    let lastLoopResetVersion = practiceLoopResetVersionRef.current;

      const resetCursor = (timeSecs: number) => {
      practiceScheduledIndexRef.current = getPracticeNoteIndexAtTime(timeSecs);
      practiceLastScheduledTimeRef.current = timeSecs;
      practiceTriggeredNotesRef.current.clear();
      practiceRecentTriggerKeysRef.current.clear();
    };

    resetCursor(getPracticeTransportTime());

    const scheduleNotes = () => {
      let nowTransport = getPracticeTransportTime();
      const pendingRestartTime = practiceLoopPendingRestartRef.current;
      if (pendingRestartTime !== null) {
        practiceLoopPendingRestartRef.current = null;
        try {
          practicePianoRef.current?.stop?.();
        } catch { }
        stopPracticeScheduledNotes();
        stopPracticeFallbackVoices();
        resetCursor(pendingRestartTime);
        practiceLastScheduledTimeRef.current = pendingRestartTime - 0.001;
        nowTransport = pendingRestartTime;
      } else if (performance.now() < practiceLoopWrapGuardUntilRef.current) {
        practiceLastScheduledTimeRef.current = nowTransport;
        return;
      }
      if (practiceLoopResetVersionRef.current !== lastLoopResetVersion) {
        lastLoopResetVersion = practiceLoopResetVersionRef.current;
        try {
          practicePianoRef.current?.stop?.();
        } catch { }
        stopPracticeScheduledNotes();
        stopPracticeFallbackVoices();
        const restartTime = practiceLoopRestartTimeRef.current;
        resetCursor(restartTime ?? nowTransport);
        practiceLoopRestartTimeRef.current = null;
      }
      const prevScheduled = practiceLastScheduledTimeRef.current;
      if (nowTransport < prevScheduled - 0.15 || nowTransport > prevScheduled + 1.5) {
        resetCursor(nowTransport);
      }

      const transportLookahead = 0.08 * Math.max(0.25, playbackRate);
      const loopStart = loopRef.current.M1;
      const loopEnd = loopRef.current.M2;
      const loopEndTimeRaw = loopStart !== null && loopEnd !== null && midiHeader
        ? getMeasureStartTime(loopEnd + 1)
        : null;
      const loopEndTime = loopEndTimeRaw === null || loopStart === null
        ? null
        : Math.max(getMeasureStartTime(loopStart), loopEndTimeRaw - PRACTICE_LOOP_HARD_CUT_SECS);
      const windowEnd = loopEndTime === null
        ? nowTransport + transportLookahead
        : Math.min(nowTransport + transportLookahead, Math.max(nowTransport, loopEndTime - 0.0001));
      const activePiano = practicePianoRef.current;
      const handMode = stateRefs.current.handFilter;

      while (practiceScheduledIndexRef.current < midiNotes.length) {
        const noteIndex = practiceScheduledIndexRef.current;
        const note = midiNotes[noteIndex];
        const noteTime = note.time ?? 0;
        if (loopEndTime !== null && noteTime >= loopEndTime) break;
        if (noteTime > windowEnd) break;

        if (handMode === 'both' || handMode === note.hand) {
          const noteTimeKey = Number(noteTime).toFixed(6);
          const simultaneousCount = handMode === 'both'
            ? (simultaneousNoteCounts.both.get(noteTimeKey) ?? 1)
            : (simultaneousNoteCounts[handMode].get(noteTimeKey) ?? 1);
          const polyphonyGainCompensation = simultaneousCount <= 1
            ? 1
            : simultaneousCount === 2
              ? 0.88
              : simultaneousCount === 3
                ? 0.8
                : 0.74;
          const delayReal = Math.max(0, (noteTime - nowTransport) / Math.max(0.25, playbackRate));
          const naturalDuration = note.duration ?? 0.2;
          const remainingToLoopEnd = loopEndTime === null ? naturalDuration : Math.max(0, loopEndTime - noteTime);
          const cappedDuration = Math.min(naturalDuration, remainingToLoopEnd);
          const durationReal = Math.max(
            0.02,
            (cappedDuration / Math.max(0.25, playbackRate)) +
            PRACTICE_TONE_SAMPLER_SUSTAIN_TAIL_SECS
          );
          const lastTriggeredAt = practiceTriggeredNotesRef.current.get(noteIndex) ?? -Infinity;
          const nowPerf = performance.now();
          if (nowPerf - lastTriggeredAt < 120) {
            console.warn('[PracticeNoiseProbe] duplicate-note-index-suppressed', {
              noteIndex,
              midi: note.midi,
              name: note.name,
              noteTime,
              deltaMs: Number((nowPerf - lastTriggeredAt).toFixed(2)),
            });
            practiceScheduledIndexRef.current += 1;
            continue;
          }
          practiceTriggeredNotesRef.current.set(noteIndex, nowPerf);
          const triggerKey = `${note.midi}@${noteTime.toFixed(6)}`;
          const lastKeyTriggeredAt = practiceRecentTriggerKeysRef.current.get(triggerKey) ?? -Infinity;
          if (nowPerf - lastKeyTriggeredAt < 180) {
            console.warn('[PracticeNoiseProbe] duplicate-note-event', {
              noteIndex,
              midi: note.midi,
              name: note.name,
              noteTime,
              deltaMs: Number((nowPerf - lastKeyTriggeredAt).toFixed(2)),
            });
          }
          practiceRecentTriggerKeysRef.current.set(triggerKey, nowPerf);

          if (activePiano?.piano && practicePianoReady) {
            if (!practiceEngineLoggedRef.current) {
              practiceEngineLoggedRef.current = true;
              console.info('[PracticePiano] engine=tone-sampler', {
                pianoReady: practicePianoReady,
                pianoLoadError: practicePianoLoadError,
                noteIndex,
                midi: note.midi,
                name: note.name,
              });
            }
            const ctx = activePiano.ctx as AudioContext;
            const when = Tone.now() + delayReal;
            const baseVelocity = Math.max(
              0.45,
              Math.min(0.92, (note.velocity ?? 0.72) * polyphonyGainCompensation)
            );
            const triggerVelocity = Math.max(0.4, Math.min(0.92, baseVelocity));
            const noteName = note.name ?? Tone.Frequency(note.midi, 'midi').toNote();
            const samplerForNote = note.midi >= PRACTICE_TONE_SAMPLER_HIGH_NOTE_START_MIDI && activePiano.pianoHigh
              ? activePiano.pianoHigh
              : activePiano.piano;
            samplerForNote.triggerAttackRelease(noteName, durationReal, when, triggerVelocity);
            practiceScheduledStopFnsRef.current.push((time?: number) => {
              const releaseTime = time ?? Tone.now();
              samplerForNote.triggerRelease(noteName, releaseTime);
            });
          }
        }

        practiceScheduledIndexRef.current += 1;
      }

      practiceLastScheduledTimeRef.current = nowTransport;
    };

    scheduleNotes();
    practiceSchedulerTimerRef.current = window.setInterval(scheduleNotes, 50);

    return clearScheduler;
  }, [
    getPracticeNoteIndexAtTime,
    getPracticeTransportTime,
    isPlaying,
    midiNotes,
    playbackRate,
    practicePianoReady,
    practicePianoLoadError,
    practiceTransportEnabled,
    stopPracticeFallbackVoices,
    stopPracticeScheduledNotes,
  ]);

  React.useEffect(() => {
    if (!practiceTransportEnabled) return;

    const clearMetronome = () => {
      if (practiceMetronomeTimerRef.current !== null) {
        window.clearInterval(practiceMetronomeTimerRef.current);
        practiceMetronomeTimerRef.current = null;
      }
      practiceMetronomeNextBeatRef.current = 0;
      practiceMetronomeLastTimeRef.current = 0;
      stopPracticeMetronomeSources();
    };

    if (!isPlaying || !metronomeOn || !midiHeader) {
      clearMetronome();
      return;
    }

    const ctx = practicePianoRef.current?.ctx as AudioContext | undefined;
    if (!ctx) {
      clearMetronome();
      return;
    }

    const resetBoundary = (timeSecs: number) => {
      const nextBoundary = getNextMetronomeBoundaryAtAudioTime(midiHeader, timeSecs);
      practiceMetronomeNextBeatRef.current = nextBoundary.beatNumber;
      practiceMetronomeLastTimeRef.current = timeSecs;
    };

    const scheduleClick = (when: number, isAccent: boolean) => {
      const source = ctx.createOscillator();
      source.type = isAccent ? 'triangle' : 'sine';
      source.frequency.setValueAtTime(isAccent ? 1560 : 1320, when);
      const highpass = ctx.createBiquadFilter();
      const lowpass = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      highpass.type = 'highpass';
      highpass.frequency.setValueAtTime(isAccent ? 520 : 460, when);
      highpass.Q.setValueAtTime(0.12, when);
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(isAccent ? 2280 : 1980, when);
      lowpass.Q.setValueAtTime(0.18, when);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(Math.max(0.0001, (metronomeVol / 100) * (isAccent ? 0.43 : 0.3)), when + 0.0035);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(gain);
      gain.connect(ctx.destination);
      practiceActiveMetronomeSourcesRef.current.push(source);
      source.onended = () => {
        practiceActiveMetronomeSourcesRef.current = practiceActiveMetronomeSourcesRef.current.filter(active => active !== source);
      };
      source.start(when);
      source.stop(when + 0.075);
    };

    resetBoundary(getPracticeTransportTime());

    const tick = () => {
      const nowTransport = getPracticeTransportTime();
      const prevTime = practiceMetronomeLastTimeRef.current;
      if (nowTransport < prevTime - 0.12 || nowTransport > prevTime + 1.5) {
        resetBoundary(nowTransport);
      }

      const lookahead = 0.06 * Math.max(0.25, playbackRate);
      const windowEnd = nowTransport + lookahead;

      while (true) {
        const beatNumber = practiceMetronomeNextBeatRef.current;
        const beatTime = getAudioTimeForPracticeBeat(midiHeader, beatNumber);
        if (beatTime > windowEnd) break;
        const delayReal = Math.max(0, ((beatTime - nowTransport) / Math.max(0.25, playbackRate)) + PRACTICE_METRONOME_DELAY_COMPENSATION_SECS);
        const when = ctx.currentTime + delayReal;
        const beatsPerMeasure = midiHeader.timeSignatures?.[0]?.timeSignature?.[0] ?? 4;
        const isAccent = (beatNumber % beatsPerMeasure) === 0;
        scheduleClick(when, isAccent);
        practiceMetronomeNextBeatRef.current += 1;
      }

      practiceMetronomeLastTimeRef.current = nowTransport;
    };

    tick();
    practiceMetronomeTimerRef.current = window.setInterval(tick, 18);

    return clearMetronome;
  }, [getPracticeTransportTime, isPlaying, metronomeOn, metronomeVol, midiHeader, playbackRate, practiceTransportEnabled, stopPracticeMetronomeSources]);

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
    setOsmdReady(false);
    practiceMeasureTimelineRef.current = [];
    lastRedLineFrameRef.current = { display: '', transform: '', width: '', height: '' };
    lastScrollFrameRef.current = { clipPath: '', transform: '' };
    containerRef.current.innerHTML = '';

    let cancelled = false;
    const rafId = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
      if (cancelled || !containerRef.current) return;

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
        if (cancelled) return;
        window.requestAnimationFrame(() => {
          if (cancelled) return;
          osmd.render();
          if (!osmdReady) setOsmdReady(true);
        });
      }).catch((err) => {
        if (cancelled) return;
        console.error("OSMD Load Error", err);
        setLoadError(err.message || "Failed to parse or load sheet music.");
        setIsLoading(false);
      });
    });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
      const osmd = osmdRef.current;
      osmd?.clear();
      osmdRef.current = null;
      practiceMeasureTimelineRef.current = [];
      lastRedLineFrameRef.current = { display: '', transform: '', width: '', height: '' };
      lastScrollFrameRef.current = { clipPath: '', transform: '' };
    };
  }, [currentTrack.musicxmlUrl]);

  React.useEffect(() => {
    if (!osmdReady || !osmdRef.current || !midiHeader || !midiNotes.length) return;
    practiceMeasureTimelineRef.current = buildPracticeMeasureTimeline(osmdRef.current, midiHeader, midiNotes);
    renderedBlockRef.current = 0;
    osmdRef.current.cursor.show();
    setIsLoading(false);
  }, [midiHeader, midiNotes, osmdReady]);

  // Global Time Loop Syncing
  React.useEffect(() => {
    if (isLoading || !osmdRef.current) return;

    // Performance Pass: Single query for isolated elements
    const audioElement = document.querySelector('audio') as HTMLAudioElement | null;
    if (!audioElement && !practiceTransportEnabled) return;

    const keyNodes = new Map<string, { el: HTMLElement, span: HTMLElement | null }>();
    if (keyboardFxEnabled) {
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
    }

    let animationId: number;
    let smoothedY = 0; // GPU lerp state for vertical scrolling
    let hasAnchoredScroll = false;
    let lastTimeSecs = currentTimeRef.current;

    // Cache latest stringified keys to prevent 60fps React rerender storms
    let prevRightStr = "";
    let prevLeftStr = "";
    let prevHandFilter = handFilter;

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
      const timeSecs = practiceTransportEnabled ? getPracticeTransportTime() : (audioElement?.currentTime ?? 0);
      const VISUAL_OFFSET = 0.08; // Conservative 80ms lookahead to compensate for audio buffer/hardware output lag
      const visualTimeSecs = timeSecs + VISUAL_OFFSET;

      // Calculate delta to handle seeks cleanly
      if (Math.abs(visualTimeSecs - lastTimeSecs) > 1.0) {
        lastTimeSecs = visualTimeSecs;
        trackStartIndex = 0; // reset pointer on heavy seek
      }

      // Local helper: get audio time for OSMD measure index by looking at MIDI notes in that measure
      // Strategy: find the minimum note time among notes whose tick position falls in the measure.
      // Fall back to PPQ*beatsPerMeasure formula if MIDI note lookup yields nothing.
      const getSecsForMeasureOsmd = (osmdMIdx: number): number => {
        const osmd = osmdRef.current;
        if (!osmd?.GraphicSheet?.MeasureList) return 0;
        const list = osmd.GraphicSheet.MeasureList;
        if (osmdMIdx >= list.length) return (practiceTransportEnabled ? practiceTrackDuration : (audioElement?.duration || 9999));
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
        const targetTick = (osmdMIdx + leadInMeasures) * beatsPerMeasure * midiHeader.ppq;

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

      const checkStart = Math.min(lastTimeSecs, visualTimeSecs);

      // Performance Pass: O(1) Sliding Window rather than generic filter over 5000 array elements
      // Forward the starting pointer for notes that are safely in the past (assume 10s max note hold)
      while (trackStartIndex < midiNotes.length && midiNotes[trackStartIndex].time < visualTimeSecs - 10.0) {
        trackStartIndex++;
      }

      const currentActive = [];
      if (keyboardFxEnabled) {
        for (let i = trackStartIndex; i < midiNotes.length; i++) {
          const n = midiNotes[i];
          if (n.time > visualTimeSecs + 0.5) break; // Prune future loop evaluation due to ascending sort

          const visualEnd = n.time + Math.max(0.1, n.duration);
          const isCurrentlyActive = visualTimeSecs >= n.time && visualTimeSecs <= visualEnd;
          const startedJustNow = n.time >= checkStart && n.time <= visualTimeSecs;

          if (isCurrentlyActive || startedJustNow) {
            currentActive.push(n);
          }
        }
      }

      const { handFilter, noteNameMode } = stateRefs.current;

      const newRight = currentActive.filter(n => n.hand === 'right' && (handFilter === 'both' || handFilter === 'right')).map(n => n.name);
      const newLeft = currentActive.filter(n => n.hand === 'left' && (handFilter === 'both' || handFilter === 'left')).map(n => n.name);

      const newRightStr = newRight.join(',');
      const newLeftStr = newLeft.join(',');

      // Detect Mode change to trigger full keyboard label refresh
      const modeChanged = noteNameMode !== prevNoteMode;
      const handModeChanged = handFilter !== prevHandFilter;

      // Direct DOM Mutation for Zero-Rerender Keyboard Highlighting (60fps performance fix)
      if (diagRef.current.diagMaster && diagRef.current.diagKeyboard && (newRightStr !== prevRightStr || newLeftStr !== prevLeftStr || modeChanged || handModeChanged)) {
        const rSet = new Set(newRight);
        const lSet = new Set(newLeft);

        // If mode changed, we must refresh all 88 keys. Otherwise just the diff.
        let notesToUpdate: string[];
        if (modeChanged || handModeChanged) {
          notesToUpdate = Array.from(keyNodes.keys());
          prevNoteMode = noteNameMode;
          prevHandFilter = handFilter;
        } else {
          const prevRSet = new Set(prevRightStr ? prevRightStr.split(',') : []);
          const prevLSet = new Set(prevLeftStr ? prevLeftStr.split(',') : []);
          notesToUpdate = Array.from(new Set([...newRight, ...newLeft, ...prevRSet, ...prevLSet]));
        }

        const getIdleLabel = (note: string, isBlack: boolean) => {
          if (noteNameMode === 'number') {
            return note.startsWith('C') && !isBlack ? getJianpuLabel(note, isBlack) : '';
          }
          if (noteNameMode === 'letter') {
            return note.startsWith('C') && !isBlack ? note : '';
          }
          return '';
        };

        const getActiveLabel = (note: string, isBlack: boolean) => {
          if (noteNameMode === 'number') return getJianpuLabel(note, isBlack);
          return note;
        };

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

            if (span) {
              const labelHtml = isActive ? getActiveLabel(note, isBlack) : getIdleLabel(note, isBlack);
              const nextLabelMode = noteNameMode === 'number' || (isActive && noteNameMode === 'off') ? 'html' : 'text';
              if (span.dataset.labelMode !== nextLabelMode || span.dataset.labelValue !== labelHtml) {
                if (nextLabelMode === 'html') {
                  span.innerHTML = labelHtml;
                } else {
                  span.innerText = labelHtml;
                }
                span.dataset.labelMode = nextLabelMode;
                span.dataset.labelValue = labelHtml;
              }
            }

            // Apply direct DOM state to prevent CSS bleeding
            if (span) {
              const hasIdleLabel = !!getIdleLabel(note, isBlack);
              if (isActive) {
                span.style.opacity = '1';
                span.style.color = isBlack ? 'white' : 'black';
              } else if (noteNameMode !== 'off' && hasIdleLabel) {
                span.style.opacity = '0.38';
                span.style.color = '#7d7d7d';
              } else {
                span.style.opacity = '0';
                span.style.color = isBlack ? 'white' : 'black';
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

      lastTimeSecs = visualTimeSecs;

      const musicalPosition = getMusicalPositionAtAudioTimeForMeasureTimeline(
        midiHeader,
        practiceMeasureTimelineRef.current,
        visualTimeSecs,
        0,
        currentMeasureIndexRef.current
      );
      const displayedMeasureIndex = Math.max(0, musicalPosition.displayMeasure - 1);
      currentMeasureIndexRef.current = displayedMeasureIndex;

      // 5. Calculate Local X and Y mapping (Lite 2.0: Measure-Level Only)
      let cursorX = 0;
      let cursorY = 0;
      let cursorWidth = 0;
      let cursorHeight = 80;

      if (osmd.GraphicSheet && osmd.GraphicSheet.MeasureList) {
        const measures = osmd.GraphicSheet.MeasureList;
        const localIndex = displayedMeasureIndex;

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
        const nextRedLineDisplay = diagRef.current.diagMaster && diagRef.current.diagMeasure && cursorHeight > 0 ? 'block' : 'none';
        const nextRedLineTransform = `translate(${cursorX}px, ${cursorY}px)`;
        const nextRedLineWidth = `${cursorWidth}px`;
        const nextRedLineHeight = `${cursorHeight}px`;
        if (diagRef.current.diagMaster && diagRef.current.diagMeasure && cursorHeight > 0) {
          if (lastRedLineFrameRef.current.display !== nextRedLineDisplay) {
            redLineRef.current.style.display = nextRedLineDisplay;
            lastRedLineFrameRef.current.display = nextRedLineDisplay;
          }
          if (lastRedLineFrameRef.current.transform !== nextRedLineTransform) {
            redLineRef.current.style.transform = nextRedLineTransform;
            lastRedLineFrameRef.current.transform = nextRedLineTransform;
          }
          if (lastRedLineFrameRef.current.width !== nextRedLineWidth) {
            redLineRef.current.style.width = nextRedLineWidth;
            lastRedLineFrameRef.current.width = nextRedLineWidth;
          }
          if (lastRedLineFrameRef.current.height !== nextRedLineHeight) {
            redLineRef.current.style.height = nextRedLineHeight;
            lastRedLineFrameRef.current.height = nextRedLineHeight;
          }
        } else if (lastRedLineFrameRef.current.display !== nextRedLineDisplay) {
          redLineRef.current.style.display = nextRedLineDisplay;
          lastRedLineFrameRef.current.display = nextRedLineDisplay;
        }

        // Score display and CSS Single-Line Masking
        if (diagRef.current.diagMaster && diagRef.current.diagScore) {
          scrollContainerRef.current.style.opacity = '1';

          // Lite 2.0 Single Line Masking Logic
          if (!lightweightMode && diagRef.current.diagMeasure && cursorHeight > 0) {
            // Generous margin for extreme high ledger lines and chords way above the staff
            const paddingTop = 75;
            // Buffer to not clip the bass line or pedaling
            const paddingBottom = 15;
            const scrollHeightAdjusted = cursorHeight + paddingBottom;
            const nextClipPath = `inset(${Math.max(0, cursorY - paddingTop)}px 0px calc(100% - ${cursorY + scrollHeightAdjusted}px) 0px)`;
            if (lastScrollFrameRef.current.clipPath !== nextClipPath) {
              scrollContainerRef.current.style.clipPath = nextClipPath;
              lastScrollFrameRef.current.clipPath = nextClipPath;
            }
          } else {
            if (lastScrollFrameRef.current.clipPath !== 'none') {
              scrollContainerRef.current.style.clipPath = 'none';
              lastScrollFrameRef.current.clipPath = 'none';
            }
          }
        } else {
          if (scrollContainerRef.current.style.opacity !== '0') {
            scrollContainerRef.current.style.opacity = '0';
          }
        }

        // Performance Pass: Cached parent height approximation prevents DOM Reflow/Layout Thrashing
        const parentHeight = window.innerHeight * 0.65;

        // Center the entire grand staff system height (cursorY + cursorHeight/2) inside the visible block
        const systemCenterY = cursorY + (cursorHeight / 2);

        // Let the system stably hover securely lower so ledger notes peek safely inside the 65vh container
        const targetScrollY = (parentHeight / 2) - systemCenterY + 20;

        // Skip lerp if jump is massive, otherwise gently slide to the next line when cursorY changes
        if (!isPlaying || !hasAnchoredScroll) {
          smoothedY = targetScrollY;
          hasAnchoredScroll = true;
        } else if (Math.abs(targetScrollY - smoothedY) > 400) {
          smoothedY = targetScrollY;
        } else {
          smoothedY += (targetScrollY - smoothedY) * 0.1;
        }

        // Prevent scrolling above the canvas top, and enforce a slight padding
        const maxScroll = 40;

        // Auto Follow Toggle
        const nextScrollTransform = `translateY(${Math.round(Math.min(maxScroll, smoothedY) * 2) / 2}px)`;
        if (!lightweightMode && diagRef.current.diagMaster && diagRef.current.diagScroll) {
          if (lastScrollFrameRef.current.transform !== nextScrollTransform) {
            scrollContainerRef.current.style.transform = nextScrollTransform;
            lastScrollFrameRef.current.transform = nextScrollTransform;
          }
        } else {
          if (lastScrollFrameRef.current.transform !== 'translateY(0px)') {
            scrollContainerRef.current.style.transform = 'translateY(0px)';
            lastScrollFrameRef.current.transform = 'translateY(0px)';
          }
        }

        if (lightweightMode && staffViewportRef.current && cursorHeight > 0) {
          const shouldFollow =
            lastAutoScrollMeasureRef.current === null ||
            lastAutoScrollMeasureRef.current !== displayedMeasureIndex;

          if (shouldFollow) {
            lastAutoScrollMeasureRef.current = displayedMeasureIndex;
            const viewport = staffViewportRef.current;
            const topPadding = Math.max(24, viewport.clientHeight * 0.16);
            const targetTop = Math.max(0, cursorY - topPadding);
            viewport.scrollTo({ top: targetTop, behavior: 'auto' });
          }
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
  }, [getPracticeTransportTime, isLoading, midiNotes, midiHeader, leadInMeasures, practiceTrackDuration, practiceTransportEnabled, setPlaybackTimelineTime, setIsPlaying, setPracticeSeekDebug, onPracticeSnap, t.common.measureSnapped, lightweightMode]);

  React.useEffect(() => {
    lastAutoScrollMeasureRef.current = null;
    if (lightweightMode && staffViewportRef.current) {
      staffViewportRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [currentTrack.id, lightweightMode]);

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
    <div
      className={`practice-container fixed left-0 right-0 z-40 ${lightweightMode ? '' : 'animate-in slide-in-from-bottom duration-500'}`}
      style={{
        bottom: 'calc(var(--player-bar-stack-h, calc(6rem + 1.1rem)) + var(--practice-above-player-gap, 0.5rem))',
        top: 'max(1.5rem, calc(100vh - 48rem), env(safe-area-inset-top, 0px))',
      }}
    >
      <div className={`${lightweightMode ? 'w-full h-full min-h-0 border-t border-white/20 flex flex-col justify-end rounded-t-[28px] overflow-hidden bg-[rgba(247,242,235,0.96)] relative' : 'w-full h-full min-h-0 glass-effect-static border-t border-white/40 flex flex-col justify-end rounded-t-[40px] shadow-2xl overflow-hidden bg-[var(--color-mist-bg)] relative'}`}>

        {/* PREMIUM STATIC OVERLAY */}
        {!isPremium && (
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) onClose();
            }}
            className={`practice-premium-overlay absolute inset-0 z-[60] flex flex-col items-center justify-center pointer-events-auto cursor-pointer overflow-y-auto ${lightweightMode ? 'bg-black/55' : 'bg-black/50 animate-in fade-in duration-500'}`}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={`my-4 w-[90%] max-w-sm cursor-default ${premiumUiModal.shellHeavy}`}
            >
              <div className={premiumUi.iconWrap}>
                <Lock className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              </div>

              <div className="relative z-[1] flex flex-col gap-1.5">
                <h3 className={premiumUiModal.title}>{t.practice.premiumTitle}</h3>
                <p className={premiumUiModal.description}>{t.practice.premiumDesc}</p>
              </div>

              <div className="relative z-[1] flex w-full flex-col gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    setActiveView('settings');
                  }}
                  className={premiumUi.upgradeButton}
                >
                  {t.common.learnMore}
                </button>
                <button type="button" onClick={onClose} className={premiumUi.secondaryMuted}>
                  {t.common.maybeLater}
                </button>
              </div>
            </div>
          </div>
        )}

	        {/* 1) 谱面 flex-1 + 限高滚动：恢复可见谱子，温和放宽高度 */}
	        <div
            ref={staffViewportRef}
            className={`practice-staff relative flex min-h-0 w-full max-h-[min(58vh,32rem)] flex-1 flex-col justify-start overflow-y-auto overflow-x-hidden bg-[#f8f6f0] shadow-inner`}
          >
	          <div className={`${lightweightMode ? 'relative w-full flex flex-col items-start pt-1 pb-10' : 'absolute top-0 w-full h-full flex flex-col items-start overflow-hidden pt-1'}`}>
            <div ref={scrollContainerRef} className={`relative w-full px-[5vw] transition-none origin-top ${lightweightMode ? 'min-h-max' : ''}`}>
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
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#f8f6f0]">
              <div className="w-8 h-8 border-2 border-amber-900/20 border-t-amber-900 rounded-full animate-spin"></div>
              <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-amber-900/40">{t.player.loadingMusicxml}</span>
            </div>
          )}

          {loadError && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#f8f6f0]">
              <Search className="w-8 h-8 text-red-500/50" />
              <span className="text-[12px] font-bold text-red-500/80">{loadError}</span>
            </div>
          )}

          {!isLoading && !loadError && !practicePianoReady && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 z-40 rounded-full border border-amber-900/10 bg-[#f8f6f0] px-4 py-2 shadow-md">
              <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-amber-900/50">
                {practicePianoLoadError ? 'Piano unavailable' : 'Preparing piano'}
              </span>
            </div>
          )}



          {/* Top/bottom gradient overlays to make the paper roll look elegant */}
          {!lightweightMode && <div className="absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-black/20 to-transparent z-10 pointer-events-none"></div>}
          {!lightweightMode && <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/20 to-transparent z-10 pointer-events-none"></div>}
        </div>

        <div className="practice-keyboard relative z-20 -mt-12 flex h-52 min-h-52 max-h-52 shrink-0 select-none border-t-[3px] border-[#8b0000]/60 bg-black/40 px-0 pb-0 pt-1">
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

        {/* 3) Control Strip — flex portion */}
        <div className="practice-controls relative z-50 flex min-h-[42px] max-h-[54px] shrink-0 flex-none items-center justify-between overflow-x-auto border-t border-white/35 bg-[linear-gradient(180deg,rgba(255,252,248,0.96)_0%,rgba(244,232,218,0.92)_48%,rgba(232,214,194,0.88)_100%)] px-3 text-[var(--color-mist-text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] no-scrollbar lg:px-5">
          {/* 顶栏同层级：统一 11px + font-medium */}
          <div className="flex h-full min-h-[32px] shrink-0 items-center gap-1.5 sm:gap-2 lg:gap-3">
            <span className="flex min-h-[30px] items-center gap-1.5 text-[11px] font-medium leading-tight">
              <Piano className="h-3 w-3 shrink-0 text-[var(--color-mist-text)]/75" strokeWidth={2} aria-hidden />
              {t.player.practice}
            </span>

            <div className="mx-0.5 h-4 w-px shrink-0 bg-[var(--color-mist-text)]/15" aria-hidden />

            <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
              {loopM1 === null && loopM2 === null ? (
                <button
                  type="button"
                  onClick={() => setIsLoopSelectMode(m => !m)}
                  className={`flex min-h-[30px] items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium leading-tight transition-all md:px-3 ${isLoopSelectMode
                    ? 'bg-white/55 ring-1 ring-white/50 shadow-sm'
                    : 'bg-white/35 hover:bg-white/45'
                    }`}
                >
                  <Repeat className="h-3 w-3 shrink-0 text-[var(--color-mist-text)]/80" strokeWidth={2} aria-hidden />
                  {isLoopSelectMode ? t.common.cancel : t.player.loop}
                </button>
              ) : loopM2 === null ? (
                <span className="flex min-h-[30px] items-center gap-1 text-[11px] font-medium leading-tight">
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-mist-text)]/45" />
                  M{loopM1! + 1} – click end
                </span>
              ) : (
                <span className="flex min-h-[30px] items-center gap-1 rounded-full bg-white/40 px-2.5 py-1 text-[11px] font-medium leading-tight ring-1 ring-white/45 md:px-3">
                  <Repeat className="h-3 w-3 shrink-0 text-[var(--color-mist-text)]/80" strokeWidth={2} aria-hidden />
                  Loop: M{loopM1! + 1}–M{loopM2 + 1}
                </span>
              )}

              {(loopM1 !== null || isLoopSelectMode) && (
                <button
                  type="button"
                  onClick={() => { setLoopM1(null); setLoopM2(null); setIsLoopSelectMode(false); }}
                  className="flex min-h-[30px] items-center gap-1 rounded-full border border-white/50 bg-white/30 px-2 py-1 text-[11px] font-medium leading-tight transition-colors hover:bg-white/45 md:px-2.5"
                >
                  <X className="h-3 w-3 shrink-0 text-[var(--color-mist-text)]/75" strokeWidth={2} aria-hidden />
                  {t.common.clear}
                </button>
              )}
            </div>

            <div className="mx-0.5 h-4 w-px shrink-0 bg-[var(--color-mist-text)]/15" aria-hidden />

            <div className="flex shrink-0 gap-0.5 rounded-full border border-white/40 bg-[rgba(255,255,255,0.22)] p-0.5 shadow-sm">
              <button
                type="button"
                onClick={() => setHandFilter('both')}
                className={`min-h-[30px] rounded-full px-2.5 py-1 text-[11px] font-medium leading-tight transition-all md:px-3 ${handFilter === 'both' ? 'bg-gradient-to-b from-white/95 to-white/75 text-[#3A2A1A] font-semibold tracking-wide shadow-[0_1px_4px_rgba(0,0,0,0.06)] ring-1 ring-white/60' : 'text-[#3A2A1A]/70 hover:bg-white/40'}`}
              >{t.player.handBoth}</button>
              <button
                type="button"
                onClick={() => handSeparationAvailable && setHandFilter('left')}
                disabled={!handSeparationAvailable}
                className={`min-h-[30px] rounded-full px-2.5 py-1 text-[11px] font-medium leading-tight transition-all md:px-3 ${!handSeparationAvailable
                  ? 'cursor-not-allowed opacity-45'
                  : handFilter === 'left' ? 'bg-gradient-to-b from-white/95 to-white/75 text-[#3A2A1A] font-semibold tracking-wide shadow-[0_1px_4px_rgba(0,0,0,0.06)] ring-1 ring-white/60' : 'text-[#3A2A1A]/70 hover:bg-white/40'}`}
                title={handSeparationAvailable ? undefined : t.player.handSeparationUnavailable ?? 'Hand separation unavailable for this track'}
              >{t.player.handLeft}</button>
              <button
                type="button"
                onClick={() => handSeparationAvailable && setHandFilter('right')}
                disabled={!handSeparationAvailable}
                className={`min-h-[30px] rounded-full px-2.5 py-1 text-[11px] font-medium leading-tight transition-all md:px-3 ${!handSeparationAvailable
                  ? 'cursor-not-allowed opacity-45'
                  : handFilter === 'right' ? 'bg-gradient-to-b from-white/95 to-white/75 text-[#3A2A1A] font-semibold tracking-wide shadow-[0_1px_4px_rgba(0,0,0,0.06)] ring-1 ring-white/60' : 'text-[#3A2A1A]/70 hover:bg-white/40'}`}
                title={handSeparationAvailable ? undefined : t.player.handSeparationUnavailable ?? 'Hand separation unavailable for this track'}
              >{t.player.handRight}</button>
            </div>

            <div className="mx-0.5 hidden h-4 w-px shrink-0 bg-[var(--color-mist-text)]/15 sm:block" aria-hidden />

            <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-white/40 bg-[rgba(255,255,255,0.22)] p-0.5 shadow-sm">
              <button
                type="button"
                onClick={() => setNoteNameMode('off')}
                className={`min-h-[30px] rounded-full px-2.5 py-1 text-[11px] font-medium leading-tight transition-all md:px-3 ${noteNameMode === 'off' ? 'bg-gradient-to-b from-white/95 to-white/75 text-[#3A2A1A] font-semibold tracking-wide shadow-[0_1px_4px_rgba(0,0,0,0.06)] ring-1 ring-white/60' : 'text-[#3A2A1A]/70 hover:bg-white/40'}`}
              >{t.common.off}</button>
              <button
                type="button"
                onClick={() => setNoteNameMode('letter')}
                className={`min-h-[30px] rounded-full px-2.5 py-1 text-[11px] font-medium leading-tight transition-all md:px-3 ${noteNameMode === 'letter' ? 'bg-gradient-to-b from-white/95 to-white/75 text-[#3A2A1A] font-semibold tracking-wide shadow-[0_1px_4px_rgba(0,0,0,0.06)] ring-1 ring-white/60' : 'text-[#3A2A1A]/70 hover:bg-white/40'}`}
              >{t.player.letter}</button>
              <button
                type="button"
                onClick={() => setNoteNameMode('number')}
                className={`min-h-[30px] rounded-full px-2.5 py-1 text-[11px] font-medium leading-tight transition-all md:px-3 ${noteNameMode === 'number' ? 'bg-gradient-to-b from-white/95 to-white/75 text-[#3A2A1A] font-semibold tracking-wide shadow-[0_1px_4px_rgba(0,0,0,0.06)] ring-1 ring-white/60' : 'text-[#3A2A1A]/70 hover:bg-white/40'}`}
              >{t.player.number}</button>
            </div>

            <div className="mx-0.5 h-4 w-px shrink-0 bg-[var(--color-mist-text)]/15" aria-hidden />

            <div className={`flex min-h-[30px] shrink-0 items-center rounded-full border transition-all ${metronomeOn ? 'border-[#E2D4C3] bg-gradient-to-b from-white/95 to-white/80 text-[#3A2A1A] shadow-[0_1px_5px_rgba(0,0,0,0.08)]' : 'border-white/40 bg-[rgba(255,255,255,0.22)]'}`}>
              <button
                type="button"
                onClick={() => setMetronomeOn(!metronomeOn)}
                className={`flex min-h-[30px] items-center rounded-l-full border-r px-2.5 text-[11px] leading-tight transition-all md:px-3 ${metronomeOn ? 'border-[#E2D4C3]/80 font-semibold tracking-wide' : 'border-white/35 font-medium hover:bg-white/35 text-[#3A2A1A]/80'}`}
              >
                {t.player.metronome}
              </button>
              <div className="flex w-[4rem] items-center px-1.5 sm:w-[4.5rem] sm:px-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={metronomeVol}
                  onChange={e => setMetronomeVol(parseInt(e.target.value, 10))}
                  className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-mist-text)]/12 accent-[var(--color-mist-text)]/55"
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="practice-close-btn ml-2 flex min-h-[30px] shrink-0 items-center gap-1 rounded-full border border-white/45 bg-white/30 px-2.5 py-1 text-[11px] font-medium leading-tight transition-colors hover:bg-white/45 md:px-3"
          >
            <X className="h-3 w-3 shrink-0 text-[var(--color-mist-text)]/75" strokeWidth={2} aria-hidden />
            {t.practice.close}
          </button>
        </div>

      </div>
    </div>
  );
});
