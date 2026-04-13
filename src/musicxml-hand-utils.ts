/**
 * MusicXML-based hand assignment for Practice Mode.
 *
 * When a MIDI file has only one track (left/right hand mixed), this module
 * parses the corresponding MusicXML to recover per-note hand labels, then
 * maps those labels back onto the MIDI note sequence via a pitch-ordered
 * queue matching algorithm.
 *
 * Two MusicXML layouts are supported:
 *   1. Multi-part: separate <part> elements for each hand (P1 = treble, P2 = bass)
 *   2. Single-part / dual-staff: one <part> with <staves>2</staves> and
 *      per-note <staff>1</staff> / <staff>2</staff> tags  (standard piano layout)
 */

type HandLabel = 'left' | 'right';

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

interface XmlNoteEntry {
  midiPitch: number;
  position: number;
  hand: HandLabel;
}

// ---------------------------------------------------------------------------
// Strategy 1: Multi-part — each <part> is one hand
// ---------------------------------------------------------------------------

/**
 * Walk a single MusicXML `<part>` element and extract every sounding note
 * onset. All notes in the part receive the same `hand` label.
 */
function extractPartNotes(partEl: Element, hand: HandLabel): XmlNoteEntry[] {
  return extractNotesFromPart(partEl, () => hand);
}

// ---------------------------------------------------------------------------
// Strategy 2: Single-part with dual staves — hand from <staff> tag
// ---------------------------------------------------------------------------

/**
 * Walk a single `<part>` that contains `<staves>2</staves>` and per-note
 * `<staff>` tags.  Staff 1 (treble) → right, Staff 2 (bass) → left.
 */
function extractStaffBasedNotes(partEl: Element): XmlNoteEntry[] {
  return extractNotesFromPart(partEl, (noteEl) => {
    const staffEl = noteEl.querySelector('staff');
    if (!staffEl?.textContent) return 'right';
    return staffEl.textContent.trim() === '2' ? 'left' : 'right';
  });
}

// ---------------------------------------------------------------------------
// Shared extraction engine
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface HandAssignmentResult {
  /** Per-pitch FIFO queues of hand labels, consumed sequentially as MIDI notes arrive. */
  pitchHandQueues: Map<number, HandLabel[]>;
  totalNotes: number;
  rightCount: number;
  leftCount: number;
}

/**
 * Parse a MusicXML document and build pitch→hand queues that can be used
 * to label MIDI notes.
 *
 * Supports two layouts:
 *   • Multi-part: 2+ `<part>` elements → highest avg pitch = right hand
 *   • Single-part / dual-staff: 1 `<part>` with `<staves>2` and per-note
 *     `<staff>` tags → staff 1 = right, staff 2 = left
 *
 * Returns `null` only when hand separation truly cannot be determined.
 */
export function parseMusicXmlHandAssignment(xmlText: string): HandAssignmentResult | null {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) return null;

  const parts = Array.from(doc.querySelectorAll('score-partwise > part'));
  if (parts.length === 0) return null;

  let all: XmlNoteEntry[];

  if (parts.length >= 2) {
    // --- Strategy 1: Multi-part ---
    const parsed = parts.map(p => {
      const n = extractPartNotes(p, 'right');
      const avg = n.length > 0 ? n.reduce((s, x) => s + x.midiPitch, 0) / n.length : 60;
      return { notes: n, avgPitch: avg };
    });
    parsed.sort((a, b) => b.avgPitch - a.avgPitch);

    all = [];
    parsed.forEach((p, i) => {
      const h: HandLabel = i === 0 ? 'right' : 'left';
      p.notes.forEach(n => all.push({ ...n, hand: h }));
    });
  } else {
    // --- Strategy 2: Single-part, check for dual staff ---
    const part = parts[0];
    const hasStaffTags = part.querySelector('note > staff') !== null;
    const stavesDeclared = part.querySelector('attributes > staves');
    const staveCount = stavesDeclared ? parseInt(stavesDeclared.textContent || '1', 10) : 0;

    if (!hasStaffTags && staveCount < 2) return null;

    all = extractStaffBasedNotes(part);
  }

  // Sort chronologically for correct queue ordering
  all.sort((a, b) => a.position - b.position || a.midiPitch - b.midiPitch);

  const queues = new Map<number, HandLabel[]>();
  let rc = 0;
  let lc = 0;
  for (const n of all) {
    let q = queues.get(n.midiPitch);
    if (!q) {
      q = [];
      queues.set(n.midiPitch, q);
    }
    q.push(n.hand);
    if (n.hand === 'right') rc++;
    else lc++;
  }

  if (rc === 0 || lc === 0) return null;

  return { pitchHandQueues: queues, totalNotes: all.length, rightCount: rc, leftCount: lc };
}

/**
 * Consume the next hand label for a given MIDI pitch from the pre-built
 * queue map.  Falls back to `'right'` when the queue is exhausted.
 */
export function consumeHandLabel(
  midiPitch: number,
  queues: Map<number, HandLabel[]>,
): HandLabel {
  const q = queues.get(midiPitch);
  if (q && q.length > 0) return q.shift()!;
  return 'right';
}
