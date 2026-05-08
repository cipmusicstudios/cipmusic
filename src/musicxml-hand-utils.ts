/**
 * MusicXML-based hand assignment for Practice Mode (web).
 *
 * Multi-track MIDI: use track-based split in PracticePanelModule (not here).
 *
 * Single-track MIDI: infer hands from MusicXML. Per-pitch FIFO matching is
 * unsafe when the same pitch appears in both hands; we use chord/onset-group
 * alignment — group XML notes by score onset, group MIDI notes by tick, then
 * match groups in order (with a sliding search when a beat misaligns).
 */

export type HandLabel = 'left' | 'right';

type XmlNoteEntry = {
  midiPitch: number;
  position: number;
  hand: HandLabel;
};

const STEP_TO_SEMITONE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

function pitchElementToMidi(pitchEl: Element): number | null {
  const step = pitchEl.querySelector('step')?.textContent;
  const octave = pitchEl.querySelector('octave')?.textContent;
  if (!step || !octave) return null;
  const semi = STEP_TO_SEMITONE[step];
  if (semi === undefined) return null;
  const alter = parseInt(pitchEl.querySelector('alter')?.textContent || '0', 10);
  return (parseInt(octave, 10) + 1) * 12 + semi + alter;
}

function extractStaffBasedNotes(partEl: Element): XmlNoteEntry[] {
  return extractNotesFromPart(partEl, (noteEl) => {
    const staffEl = noteEl.querySelector('staff');
    if (!staffEl?.textContent) return 'right';
    return staffEl.textContent.trim() === '2' ? 'left' : 'right';
  });
}

function extractNotesFromPart(
  partEl: Element,
  resolveHand: (noteEl: Element) => HandLabel,
): XmlNoteEntry[] {
  const notes: XmlNoteEntry[] = [];
  let divisions = 1;
  let beats = 4;
  let beatType = 4;
  let measureStart = 0;

  for (const measure of Array.from(partEl.querySelectorAll('measure'))) {
    const attrs = measure.querySelector('attributes');
    if (attrs) {
      const dEl = attrs.querySelector('divisions');
      if (dEl?.textContent) divisions = parseInt(dEl.textContent, 10) || 1;
      const tEl = attrs.querySelector('time');
      if (tEl) {
        const bEl = tEl.querySelector('beats');
        const btEl = tEl.querySelector('beat-type');
        if (bEl?.textContent) beats = parseInt(bEl.textContent, 10) || 4;
        if (btEl?.textContent) beatType = parseInt(btEl.textContent, 10) || 4;
      }
    }

    let offset = 0;
    let prevOnset = 0;

    for (const child of Array.from(measure.children)) {
      if (child.tagName === 'note') {
        const isChord = child.querySelector('chord') !== null;
        const isRest = child.querySelector('rest') !== null;
        const dur = parseInt(child.querySelector('duration')?.textContent || '0', 10);

        const hasTieStop = Array.from(child.querySelectorAll('tie')).some(
          t => t.getAttribute('type') === 'stop',
        );

        if (!isChord) prevOnset = offset;
        const notePos = measureStart + (isChord ? prevOnset : offset);

        if (!isRest && !hasTieStop) {
          const pitchEl = child.querySelector('pitch');
          if (pitchEl) {
            const midi = pitchElementToMidi(pitchEl);
            if (midi !== null) {
              notes.push({ midiPitch: midi, position: notePos, hand: resolveHand(child) });
            }
          }
        }

        if (!isChord) offset += dur;
      } else if (child.tagName === 'forward') {
        offset += parseInt(child.querySelector('duration')?.textContent || '0', 10);
      } else if (child.tagName === 'backup') {
        offset -= parseInt(child.querySelector('duration')?.textContent || '0', 10);
      }
    }

    const measureDuration = beats * divisions * (4 / beatType);
    measureStart += measureDuration;
  }

  return notes;
}

/** One simultaneous attack in the score (chord or single note). */
export interface HandOnsetGroup {
  position: number;
  notes: { midi: number; hand: HandLabel }[];
}

export interface MusicXmlHandOnsetPlan {
  groups: HandOnsetGroup[];
  xmlStaff1Notes: number;
  xmlStaff2Notes: number;
}

export interface SingleTrackHandMatchLog {
  handStrategy: 'musicxml-dual-staff';
  midiTrackCount: number;
  xmlStaff1Notes: number;
  xmlStaff2Notes: number;
  xmlOnsetGroups: number;
  midiOnsetGroups: number;
  finalRight: number;
  finalLeft: number;
  finalUnknown: number;
  suspiciousMatchCount: number;
}

function multisetKey(midis: number[]): string {
  return [...midis].sort((a, b) => a - b).join(',');
}

/** Build chronological onset groups from flat MusicXML-derived note list. */
function clusterXmlEntriesToOnsetGroups(flat: XmlNoteEntry[]): HandOnsetGroup[] {
  if (flat.length === 0) return [];
  flat.sort((a, b) => a.position - b.position || a.midiPitch - b.midiPitch);
  const groups: HandOnsetGroup[] = [];
  let curPos = flat[0].position;
  let curNotes: { midi: number; hand: HandLabel }[] = [];
  for (const n of flat) {
    if (n.position !== curPos) {
      groups.push({ position: curPos, notes: curNotes });
      curPos = n.position;
      curNotes = [];
    }
    curNotes.push({ midi: n.midiPitch, hand: n.hand });
  }
  if (curNotes.length) groups.push({ position: curPos, notes: curNotes });
  return groups;
}

/**
 * Parse MusicXML and build onset groups with staff / part-derived hands.
 * Staff 1 (upper) → right; staff 2 (lower) → left. Multi-part: higher mean pitch → right.
 */
export function buildMusicXmlHandOnsetPlan(xmlText: string): MusicXmlHandOnsetPlan | null {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) return null;

  const parts = Array.from(doc.querySelectorAll('score-partwise > part'));
  if (parts.length === 0) return null;

  let flat: XmlNoteEntry[];
  let staff1 = 0;
  let staff2 = 0;

  if (parts.length >= 2) {
    const parsed = parts.map(p => {
      const n = extractNotesFromPart(p, () => 'right');
      const avg = n.length > 0 ? n.reduce((s, x) => s + x.midiPitch, 0) / n.length : 60;
      return { part: p, avgPitch: avg };
    });
    parsed.sort((a, b) => b.avgPitch - a.avgPitch);
    flat = [];
    parsed.forEach((p, i) => {
      const h: HandLabel = i === 0 ? 'right' : 'left';
      const expanded = extractNotesFromPart(p.part, () => h);
      flat.push(...expanded);
    });
    staff1 = flat.filter(n => n.hand === 'right').length;
    staff2 = flat.filter(n => n.hand === 'left').length;
  } else {
    const part = parts[0];
    const hasStaffTags = part.querySelector('note > staff') !== null;
    const stavesDeclared = part.querySelector('attributes > staves');
    const staveCount = stavesDeclared ? parseInt(stavesDeclared.textContent || '1', 10) : 0;
    if (!hasStaffTags && staveCount < 2) return null;
    flat = extractStaffBasedNotes(part);
    staff1 = flat.filter(n => n.hand === 'right').length;
    staff2 = flat.filter(n => n.hand === 'left').length;
  }

  if (!flat.some(n => n.hand === 'right') || !flat.some(n => n.hand === 'left')) return null;

  const groups = clusterXmlEntriesToOnsetGroups(flat);
  if (groups.length === 0) return null;

  return { groups, xmlStaff1Notes: staff1, xmlStaff2Notes: staff2 };
}

interface MidiOnsetGroup {
  ticks: number;
  /** Indices into the caller's sorted chronological list */
  indices: number[];
  midis: number[];
}

function buildMidiOnsetGroups(
  chron: Array<{ midi: number; ticks: number }>,
): MidiOnsetGroup[] {
  const groups: MidiOnsetGroup[] = [];
  let cur: MidiOnsetGroup | null = null;
  for (let i = 0; i < chron.length; i++) {
    const { midi, ticks } = chron[i];
    if (!cur || cur.ticks !== ticks) {
      if (cur) groups.push(cur);
      cur = { ticks, indices: [i], midis: [midi] };
    } else {
      cur.indices.push(i);
      cur.midis.push(midi);
    }
  }
  if (cur) groups.push(cur);
  return groups;
}

function assignHandsInsideXmlGroup(
  xmlNotes: { midi: number; hand: HandLabel }[],
  midiGroup: MidiOnsetGroup,
  hands: HandLabel[],
  markSuspicious: () => void,
): void {
  const pool = new Map<number, HandLabel[]>();
  for (const x of xmlNotes) {
    let q = pool.get(x.midi);
    if (!q) {
      q = [];
      pool.set(x.midi, q);
    }
    q.push(x.hand);
  }

  const rhmaj = xmlNotes.filter(x => x.hand === 'right').length;
  const lhmaj = xmlNotes.filter(x => x.hand === 'left').length;
  const tieBreak: HandLabel = lhmaj > rhmaj ? 'left' : 'right';

  for (let k = 0; k < midiGroup.indices.length; k++) {
    const pitch = midiGroup.midis[k];
    const sortIdx = midiGroup.indices[k];
    const q = pool.get(pitch);
    if (q && q.length > 0) {
      hands[sortIdx] = q.shift()!;
    } else {
      hands[sortIdx] = tieBreak;
      markSuspicious();
    }
  }
}

const GROUP_SEARCH_WINDOW = 28;

function matchMidiGroupsToXml(
  xmlGroups: HandOnsetGroup[],
  midiGroups: MidiOnsetGroup[],
  hands: HandLabel[],
): number {
  let suspicious = 0;
  let xPtr = 0;

  for (let m = 0; m < midiGroups.length; m++) {
    const mg = midiGroups[m];
    const sig = multisetKey(mg.midis);
    let found = -1;
    const hi = Math.min(xPtr + GROUP_SEARCH_WINDOW, xmlGroups.length);
    for (let k = xPtr; k < hi; k++) {
      if (multisetKey(xmlGroups[k].notes.map(n => n.midi)) === sig) {
        found = k;
        break;
      }
    }

    if (found < 0) {
      suspicious++;
      found = Math.min(xPtr, xmlGroups.length - 1);
    }

    assignHandsInsideXmlGroup(xmlGroups[found].notes, mg, hands, () => {
      suspicious++;
    });

    xPtr = Math.max(xPtr, found + 1);
    if (xPtr >= xmlGroups.length && m + 1 < midiGroups.length) {
      xPtr = xmlGroups.length - 1;
    }
  }

  return suspicious;
}

function isHandDebugTrack(trackId?: string, title?: string): boolean {
  const id = (trackId || '').toLowerCase();
  const t = (title || '').toLowerCase();
  return id.includes('guyong') || t.includes('孤勇者');
}

/**
 * Map single-track MIDI notes (chronological) to left/right using MusicXML onset groups.
 */
export function assignSingleTrackMidiHandsFromMusicXml(
  xmlText: string,
  midiNotesChronological: Array<{ midi: number; ticks: number }>,
  logCtx?: { trackId?: string; title?: string },
): { hands: HandLabel[]; log: SingleTrackHandMatchLog } | null {
  const plan = buildMusicXmlHandOnsetPlan(xmlText);
  if (!plan || midiNotesChronological.length === 0) return null;

  const hands: HandLabel[] = new Array(midiNotesChronological.length).fill('right');
  const midiGroups = buildMidiOnsetGroups(midiNotesChronological);
  const suspicious = matchMidiGroupsToXml(plan.groups, midiGroups, hands);

  let finalRight = 0;
  let finalLeft = 0;
  for (const h of hands) {
    if (h === 'right') finalRight++;
    else finalLeft++;
  }

  const log: SingleTrackHandMatchLog = {
    handStrategy: 'musicxml-dual-staff',
    midiTrackCount: 1,
    xmlStaff1Notes: plan.xmlStaff1Notes,
    xmlStaff2Notes: plan.xmlStaff2Notes,
    xmlOnsetGroups: plan.groups.length,
    midiOnsetGroups: midiGroups.length,
    finalRight,
    finalLeft,
    finalUnknown: 0,
    suspiciousMatchCount: suspicious,
  };

  if (import.meta.env.DEV) {
    console.info('[practice-hand] single-track MusicXML onset match', {
      trackId: logCtx?.trackId,
      title: logCtx?.title,
      debugTrack: isHandDebugTrack(logCtx?.trackId, logCtx?.title),
      ...log,
    });
  }

  if (finalLeft === 0 || finalRight === 0) return null;
  return { hands, log };
}

// ---------------------------------------------------------------------------
// Legacy API (pitch FIFO) — kept for compatibility; avoid for new code.
// ---------------------------------------------------------------------------

export interface HandAssignmentResult {
  pitchHandQueues: Map<number, HandLabel[]>;
  totalNotes: number;
  rightCount: number;
  leftCount: number;
}

export function parseMusicXmlHandAssignment(xmlText: string): HandAssignmentResult | null {
  const plan = buildMusicXmlHandOnsetPlan(xmlText);
  if (!plan) return null;

  const queues = new Map<number, HandLabel[]>();
  let rc = 0;
  let lc = 0;
  for (const g of plan.groups) {
    for (const n of g.notes) {
      let q = queues.get(n.midi);
      if (!q) {
        q = [];
        queues.set(n.midi, q);
      }
      q.push(n.hand);
      if (n.hand === 'right') rc++;
      else lc++;
    }
  }

  if (rc === 0 || lc === 0) return null;
  return { pitchHandQueues: queues, totalNotes: rc + lc, rightCount: rc, leftCount: lc };
}

export function consumeHandLabel(midiPitch: number, queues: Map<number, HandLabel[]>): HandLabel {
  const q = queues.get(midiPitch);
  if (q && q.length > 0) return q.shift()!;
  return 'right';
}
