import {identifyNamedChord} from './chord-spelling';
import {isPitchedNote, noteMidi, scoreNotes, type Note, type Score} from '../../core';
import {pcName, pitchClass} from './pitch-class';
import type {ChordSegment, ChordWindowOptions} from './types';

/** @internal Shared tolerance for float time comparisons in chord segmentation. */
export const EPSILON = 1e-9;

/** @internal Resolve the shared chord-window option without allowing NaN/Infinity into wire results. */
export function resolveChordWindowQuarters(value: number | undefined): number {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new RangeError('Chord windowQuarters must be a finite number');
  }
  return Math.max(0.125, value ?? 2);
}

/**
 * @internal A sounding-note candidate for the chord sweep, with its onset and
 * offset projected to floats and its stable position in `scoreNotes` order
 * (used as a deterministic tie-break so windowed re-sweeps reproduce the
 * full sweep exactly).
 */
export interface SweepCandidate {
  note: Note;
  onset: number;
  offset: number;
  pos: number;
}

/**
 * Slice the score into harmonic segments and name the chord sounding in each.
 *
 * Segment boundaries are placed at every note onset and offset, so a window
 * never mixes two harmonies; `windowQuarters` (default `2`) caps the maximum
 * segment length before merging. Adjacent segments with the same chord are
 * merged, but only when they are contiguous (a rest breaks the merge).
 *
 * Chord naming uses Tonal candidates with the shared spelling policy's
 * coverage validation and preferred conventional inversion ordering.
 */
export function segmentChords(score: Score, opts: ChordWindowOptions = {}): ChordSegment[] {
  const windowQuarters = resolveChordWindowQuarters(opts.windowQuarters);
  const end = score.durationQuarters.toFloat();
  const candidates: SweepCandidate[] = [];
  let pos = 0;
  for (const note of scoreNotes(score)) {
    if (!isPitchedNote(note)) continue;
    const onset = note.onsetQuarters.toFloat();
    const offset = note.offsetQuarters.toFloat();
    pos += 1;
    // Zero-length notes never sound in any segment (matches the strict
    // onset < stop && offset > start overlap test of the previous filter).
    if (offset - onset < EPSILON) continue;
    // Notes ending at/before 0 cannot contribute to any flushed span.
    if (offset <= 0) continue;
    candidates.push({note, onset, offset, pos});
  }
  return mergeAdjacent(sweepChordPieces(candidates, windowQuarters, 0, Infinity, end));
}

/**
 * @internal Run the chord sweep over the half-open range `[t0, t1)` and
 * return the UNMERGED segment pieces. `candidates` must be the notes
 * overlapping the range (`offset > t0 && onset < t1`, zero-length excluded),
 * ordered by ascending `pos` (i.e. `scoreNotes` order). Used by both
 * `segmentChords` (with `t0 = 0`, `t1 = Infinity`) and the incremental
 * analyzer (which re-sweeps only the dirty window).
 */
export function sweepChordPieces(
  candidates: readonly SweepCandidate[],
  windowQuarters: number,
  t0: number,
  t1: number,
  end: number,
): ChordSegment[] {
  const segments: ChordSegment[] = [];

  // Sweep line: one +1/-1 event per note onset/offset inside the range,
  // sorted by time (ties broken by delta then scoreNotes position, matching
  // the stable sort over scoreNotes order of the full sweep). Notes already
  // sounding at t0 seed the active set in event order (onset, then position).
  type SweepEvent = {time: number; delta: 1 | -1; pos: number; note: Note};
  const events: SweepEvent[] = [];
  const seeds: SweepCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.onset <= t0) seeds.push(candidate);
    else events.push({time: candidate.onset, delta: 1, pos: candidate.pos, note: candidate.note});
    if (candidate.offset <= t1) {
      events.push({time: candidate.offset, delta: -1, pos: candidate.pos, note: candidate.note});
    }
  }
  events.sort((a, b) => a.time - b.time || a.delta - b.delta || a.pos - b.pos);
  seeds.sort((a, b) => a.onset - b.onset || a.pos - b.pos);

  const active = new Set<Note>();
  for (const seed of seeds) active.add(seed.note);

  const flush = (start: number, stop: number): void => {
    start = Math.max(0, start);
    stop = Math.min(end, stop);
    if (stop - start < EPSILON || active.size === 0) return;
    const sounding = [...active];
    const pitchClasses = [...new Set(sounding.map((note) => pitchClass(noteMidi(note))))].sort((a, b) => a - b);
    const chord = identifyChord(sounding);
    // Subdivide spans longer than the window, exactly like the old boundary
    // list did between consecutive base boundaries.
    for (let cursor = start; cursor < stop - EPSILON; cursor += windowQuarters) {
      const segmentEnd = Math.min(stop, cursor + windowQuarters);
      segments.push({startQuarters: cursor, endQuarters: segmentEnd, pitchClasses: [...pitchClasses], chord});
    }
  };

  let previous = t0;
  let index = 0;
  while (index < events.length) {
    const time = events[index].time;
    flush(previous, time);
    while (index < events.length && events[index].time === time) {
      const event = events[index];
      if (event.delta === 1) active.add(event.note);
      else active.delete(event.note);
      index += 1;
    }
    previous = Math.max(previous, Math.min(time, end));
  }
  flush(previous, Math.min(t1, end));

  return segments;
}

/**
 * Name the chord formed by a set of sounding notes. Notes are ordered low to
 * high so Tonal can recognise the bass note for slash/inversion labels, and
 * spelled from each note's notated Pitch (so F# vs Gb is preserved).
 */
export function identifyChord(notes: readonly Note[]): string {
  const ordered = notes.filter(isPitchedNote).sort((a, b) => noteMidi(a) - noteMidi(b));
  const names: string[] = [];
  const seen = new Set<number>();
  for (const note of ordered) {
    const pc = pitchClass(noteMidi(note));
    if (seen.has(pc)) continue;
    seen.add(pc);
    names.push(noteName(note));
  }
  return detectFromNames(names, seen);
}

/**
 * Name the chord formed by a set of sounding MIDI note numbers — the
 * spelling-free sibling of {@link identifyChord} for callers that only have
 * pitches (e.g. live `webscore:noteon` events during playback). Pitch classes
 * take {@link pcName}'s fixed MIXED spelling — sharps for 1 and 6, flats for
 * 3, 8 and 10 — which is why it cannot answer a caller's spelling preference,
 * and why {@link spellChord} carries its own two tables. The empty set
 * returns `''`.
 */
export function identifyChordFromMidi(midis: readonly number[]): string {
  if (midis.length === 0) return '';
  const ordered = [...midis].sort((a, b) => a - b);
  const names: string[] = [];
  const seen = new Set<number>();
  for (const midi of ordered) {
    const pc = pitchClass(midi);
    if (seen.has(pc)) continue;
    seen.add(pc);
    names.push(pcName(pc));
  }
  return detectFromNames(names, seen);
}

/**
 * Shared candidate naming over a bass-up, deduped pitch-name list, memoized.
 * The name list fully determines the result, including the pitch-class fallback
 * label. No pitch-role or presentation projection is needed here.
 */
function detectFromNames(names: string[], pcs: ReadonlySet<number>): string {
  const cacheKey = names.join(',');
  const cached = detectCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const detected = identifyNamedChord(names, [...pcs]);
  const result = detected ?? [...pcs].sort((a, b) => a - b).map(pcName).join(' ');
  if (detectCache.size >= DETECT_CACHE_LIMIT) detectCache.clear();
  detectCache.set(cacheKey, result);
  return result;
}

const DETECT_CACHE_LIMIT = 10000;
const detectCache = new Map<string, string>();

/** Pitch-class name (no octave) using the note's notated spelling. */
function noteName(note: Note): string {
  const {step, alter} = note.pitch;
  const accidental = alter > 0 ? '#'.repeat(alter) : alter < 0 ? 'b'.repeat(-alter) : '';
  return `${step}${accidental}`;
}

/**
 * @internal Merge contiguous same-chord segments (a gap breaks the merge).
 * Exported for the incremental analyzer, which merges re-swept dirty-window
 * pieces and then splices them between cached merged segments.
 */
export function mergeAdjacent(segments: readonly ChordSegment[]): ChordSegment[] {
  const merged: Array<{
    startQuarters: number;
    endQuarters: number;
    pitchClasses: number[];
    chord: string;
  }> = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    const contiguous = previous != null && Math.abs(previous.endQuarters - segment.startQuarters) < EPSILON;
    if (previous && contiguous && previous.chord === segment.chord) {
      previous.endQuarters = segment.endQuarters;
      previous.pitchClasses = [...new Set([...previous.pitchClasses, ...segment.pitchClasses])].sort((a, b) => a - b);
    } else {
      merged.push({...segment, pitchClasses: [...segment.pitchClasses]});
    }
  }
  return merged;
}
