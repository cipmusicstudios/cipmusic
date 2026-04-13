export type PracticeMidiHeaderLite = {
  tempos: Array<{ time: number; ticks: number; bpm: number }>;
  ppq: number;
  timeSignatures?: Array<{ timeSignature?: number[] }>;
};

export type PracticeSeekDebug = {
  targetTime: number | null;
  snappedTime: number | null;
  snappedMeasure: number | null;
  snappedBeatNumber: number | null;
  measureStartTime: number | null;
  actualTime: number | null;
  targetDelta: number | null;
  actualDelta: number | null;
  seekedEventTime: number | null;
  playCallTime: number | null;
  playEventTime: number | null;
  playingEventTime: number | null;
  mainSeekedEventTime: number | null;
  clickSeekedEventTime: number | null;
  mainPlayEventTime: number | null;
  clickPlayEventTime: number | null;
  mainPlayingEventTime: number | null;
  clickPlayingEventTime: number | null;
  firstStableMainTime: number | null;
  firstStableClickTime: number | null;
  firstStableDiff: number | null;
  firstStablePerfTime: number | null;
};

export type MusicalPosition = {
  absoluteTick: number;
  ticksPerMeasure: number;
  internalMeasureIndex: number;
  internalMeasure: number;
  displayMeasure: number;
  beatInMeasure: number;
  tickInMeasure: number;
  beatFloat: number;
  beatOffset: number;
  beatsPerMeasure: number;
};

export type PracticeMeasureTimelineEntry = {
  measureIndex: number;
  displayMeasure: number;
  startTick: number;
  endTick: number;
  startTime: number;
  endTime: number;
  ticksPerMeasure: number;
  beatsPerMeasure: number;
  beatUnit: number;
  implicit: boolean;
};
