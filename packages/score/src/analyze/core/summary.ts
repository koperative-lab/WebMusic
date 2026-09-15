import {
  isPitchedNote,
  noteMidi,
  notesOverlapping,
  Rational,
  scoreDurationSeconds,
  type Note,
  type Score,
} from '../../core';
import {identifyChord} from './chords';
import {parseChordSymbol} from './chord-spelling';
import {pitchClass} from './pitch-class';

export interface ScoreSummary {
  title?: string;
  composer?: string;
  parts: number;
  measures: number;
  notes: number;
  durationQuarters: number;
  durationSeconds: number;
  tempoBpm: number;
  timeSignature: string;
  keySignature?: string;
  pitchRange?: {low: string; high: string};
}

export interface ChordTimelineOptions {
  /** Finite quarter-note window, default 1; values below 0.125 clamp to 0.125. */
  windowQuarters?: number;
  /** Finite distinct pitch-class threshold, default 2; values below 1 clamp to 1. */
  minNotes?: number;
  /** Merge equal adjacent labels and union their note/pitch-class evidence. Default true. */
  mergeAdjacent?: boolean;
}

export interface ChordTimelineSegment {
  startQuarters: number;
  endQuarters: number;
  startSeconds: number;
  endSeconds: number;
  notes: ReadonlyArray<Note>;
  pitchClasses: ReadonlyArray<number>;
  chord: string;
  root?: string;
  quality?: string;
}

export function summarizeScore(score: Score): ScoreSummary {
  const pitches = score.notes.filter(isPitchedNote).map((note) => note.pitch).sort((a, b) => a.midi - b.midi);
  const firstTempo = score.timeMap.tempi[0]?.bpm ?? 120;
  const firstMeter = score.timeMap.meters[0]?.timeSignature;
  const firstKey = score.measures.find((measure) => measure.keySignature)?.keySignature;

  return {
    title: score.metadata.title,
    composer: score.metadata.composer,
    parts: score.parts.length,
    measures: score.measures.length,
    notes: score.notes.length,
    durationQuarters: score.durationQuarters.toFloat(),
    durationSeconds: scoreDurationSeconds(score),
    tempoBpm: firstTempo,
    timeSignature: firstMeter ? `${firstMeter.numerator}/${firstMeter.denominator}` : '4/4',
    keySignature: firstKey ? `${firstKey.fifths} fifths ${firstKey.mode ?? ''}`.trim() : undefined,
    pitchRange: pitches.length
      ? {
          low: pitches[0].toString(),
          high: pitches[pitches.length - 1].toString(),
        }
      : undefined,
  };
}

/**
 * Windowed chord timeline. Chord naming is the same Tonal-backed
 * `identifyChord` used by `segmentChords`, so labels are consistent across
 * both APIs (e.g. `CM`, `G7`).
 */
export function chordTimeline(score: Score, options: ChordTimelineOptions = {}): ChordTimelineSegment[] {
  if (options.windowQuarters !== undefined && !Number.isFinite(options.windowQuarters)) {
    throw new RangeError('Chord timeline windowQuarters must be a finite number');
  }
  if (options.minNotes !== undefined && !Number.isFinite(options.minNotes)) {
    throw new RangeError('Chord timeline minNotes must be a finite number');
  }
  const windowQuarters = Math.max(0.125, options.windowQuarters ?? 1);
  const minNotes = Math.max(1, options.minNotes ?? 2);
  const mergeAdjacent = options.mergeAdjacent ?? true;
  const duration = score.durationQuarters.toFloat();
  const segments: ChordTimelineSegment[] = [];
  let mergedNotes: Note[] = [];
  let seenNotes = new Set<Note>();

  for (let start = 0; start < duration; start += windowQuarters) {
    const end = Math.min(duration, start + windowQuarters);
    const notes = notesOverlapping(score, Rational.from(start), Rational.from(end)).filter(isPitchedNote);
    const pitchClasses = uniquePitchClasses(notes);
    const detected = pitchClasses.length >= minNotes ? nameChord(notes) : undefined;
    const chord = detected?.name ?? (pitchClasses.length ? 'N.C.' : 'rest');

    const segment: ChordTimelineSegment = {
      startQuarters: start,
      endQuarters: end,
      startSeconds: score.timeMap.quartersToSeconds(Rational.from(start)),
      endSeconds: score.timeMap.quartersToSeconds(Rational.from(end)),
      notes,
      pitchClasses,
      chord,
      root: detected?.root,
      quality: detected?.quality,
    };

    const previous = segments[segments.length - 1];
    if (mergeAdjacent && previous && previous.chord === segment.chord) {
      previous.endQuarters = segment.endQuarters;
      previous.endSeconds = segment.endSeconds;
      for (const note of notes) {
        if (!seenNotes.has(note)) {
          seenNotes.add(note);
          mergedNotes.push(note);
        }
      }
      previous.pitchClasses = [...new Set([...previous.pitchClasses, ...pitchClasses])].sort((a, b) => a - b);
    } else {
      mergedNotes = notes;
      seenNotes = new Set(notes);
      segments.push(segment);
    }
  }

  return segments;
}

function uniquePitchClasses(notes: ReadonlyArray<Note>): number[] {
  return [...new Set(notes.map((note) => pitchClass(noteMidi(note))))].sort((a, b) => a - b);
}

/**
 * Name a chord with `identifyChord` and parse root/quality back out with
 * Tonal. Returns undefined when no chord is recognised (the pitch-class-list
 * fallback contains a space and is not a parsable symbol).
 */
function nameChord(notes: ReadonlyArray<Note>): {name: string; root: string; quality: string} | undefined {
  const name = identifyChord(notes);
  if (!name || name.includes(' ')) return undefined;
  const parsed = parseChordSymbol(name);
  if (!parsed.tonic) return undefined;
  return {
    name,
    root: parsed.tonic,
    quality: parsed.type || parsed.quality,
  };
}
