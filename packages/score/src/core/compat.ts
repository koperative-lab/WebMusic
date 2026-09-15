/**
 * Compatibility helpers that expose the new Rational-quarters Score model
 * through tick-shaped accessors for downstream consumers (analyze, view, react).
 *
 * The view layer historically expressed positions in MIDI-style ticks at a
 * fixed pulses-per-quarter resolution. The model itself uses tempo-independent
 * quarter-note rationals; these helpers project to ticks on demand so that
 * existing rendering and analysis code does not need to be aware of the
 * Rational layer.
 */

import type {Measure} from './model/Measure';
import type {Note} from './model/Note';
import type {Score} from './model/Score';
import {Rational} from './primitives/Rational';
import type {Mode} from './types/meta';
import type {Alter, Step} from './types/pitch';

import {Pitch} from './primitives/Pitch';

/** Default ticks per quarter note for compatibility projections. */
export const DEFAULT_PPQ = 480;

/** Accepts a Pitch instance or a plain {step, alter?, octave} POJO. */
export function pitchToMidi(pitch: Pitch | {step: string; alter?: number; octave: number}): number {
  if (pitch instanceof Pitch) return pitch.midi;
  return new Pitch(pitch.step as Step, (pitch.alter ?? 0) as Alter, pitch.octave).midi;
}

export function midiToPitch(midi: number): Pitch {
  return Pitch.fromMidi(midi);
}

export function quartersToTicks(q: Rational, ppq: number = DEFAULT_PPQ): number {
  assertPpq(ppq);
  const ticks = Math.round(q.toFloat() * ppq);
  if (!Number.isSafeInteger(ticks)) throw new RangeError('tick position must be a safe integer');
  return ticks;
}

export function ticksToQuarters(ticks: number, ppq: number = DEFAULT_PPQ): Rational {
  assertPpq(ppq);
  return new Rational(Math.round(ticks), ppq);
}

function assertPpq(ppq: number): void {
  if (!Number.isSafeInteger(ppq) || ppq <= 0) throw new RangeError('PPQ must be a positive safe integer');
}

// --- Note accessors ---

export function noteMidi(note: Note): number {
  return note.pitch.midi;
}

export function noteOnsetTicks(note: Note, ppq: number = DEFAULT_PPQ): number {
  return quartersToTicks(note.onsetQuarters, ppq);
}

export function noteDurationTicks(note: Note, ppq: number = DEFAULT_PPQ): number {
  return quartersToTicks(note.duration.quarters, ppq);
}

export function noteEndTicks(note: Note, ppq: number = DEFAULT_PPQ): number {
  return quartersToTicks(note.offsetQuarters, ppq);
}

export function noteOnsetSeconds(note: Note, score: Score): number {
  return note.performed?.onsetSec ?? score.timeMap.quartersToSeconds(note.onsetQuarters);
}

export function noteDurationSeconds(note: Note, score: Score): number {
  if (note.performed) return note.performed.durationSec;
  return score.timeMap.quartersToSeconds(note.offsetQuarters) - score.timeMap.quartersToSeconds(note.onsetQuarters);
}

export function noteEndSeconds(note: Note, score: Score): number {
  return note.performed
    ? note.performed.onsetSec + note.performed.durationSec
    : score.timeMap.quartersToSeconds(note.offsetQuarters);
}

export function noteVelocity(note: Note): number {
  return note.performed?.velocity ?? 80;
}

export function noteVoiceString(note: Note): string {
  return note.voice;
}

// --- Score accessors ---

export function scoreNotes(score: Score): Note[] {
  // Sounding notes only — explicit rests have no pitch and would break the
  // tick/midi projections this compat layer exists for.
  return [...score.notes];
}

export function scoreTitle(score: Score): string | undefined {
  return score.metadata.title;
}

export function scoreComposer(score: Score): string | undefined {
  return score.metadata.composer;
}

export function scoreDurationTicks(score: Score, ppq: number = DEFAULT_PPQ): number {
  return quartersToTicks(score.durationQuarters, ppq);
}

export function scoreDurationSeconds(score: Score): number {
  return score.durationSeconds;
}

export interface TempoChange {
  tick: number;
  /** Quarter notes per minute; the authored TempoEntry.unit is folded in. */
  bpm: number;
}

export interface TimeSignatureChange {
  tick: number;
  numerator: number;
  denominator: number;
}

export interface KeySignatureChange {
  tick: number;
  fifths: number;
  mode?: Mode;
}

export function scoreTempos(score: Score, ppq: number = DEFAULT_PPQ): TempoChange[] {
  return score.timeMap.tempi.map((t) => ({tick: quartersToTicks(t.atQuarters, ppq), bpm: t.bpm * (t.unit ?? 1)}));
}

export function scoreTimeSignatures(score: Score, ppq: number = DEFAULT_PPQ): TimeSignatureChange[] {
  return score.timeMap.meters.map((m) => ({
    tick: quartersToTicks(m.atQuarters, ppq),
    numerator: m.timeSignature.numerator,
    denominator: m.timeSignature.denominator,
  }));
}

export function scoreKeySignatures(score: Score, ppq: number = DEFAULT_PPQ): KeySignatureChange[] {
  const out: KeySignatureChange[] = [];
  for (const m of score.measures) {
    if (m.keySignature) {
      out.push({
        tick: quartersToTicks(m.onsetQuarters, ppq),
        fifths: m.keySignature.fifths,
        mode: m.keySignature.mode,
      });
    }
  }
  return out;
}

// --- TimeMap projection helpers (tick-based) ---

export function tickToSeconds(score: Score, tick: number, ppq: number = DEFAULT_PPQ): number {
  return score.timeMap.quartersToSeconds(ticksToQuarters(tick, ppq));
}

export function secondsToTick(score: Score, seconds: number, ppq: number = DEFAULT_PPQ): number {
  return quartersToTicks(score.timeMap.secondsToQuarters(seconds, ppq), ppq);
}

export function tickToMeasureBeat(
  score: Score,
  tick: number,
  ppq: number = DEFAULT_PPQ,
): {measure: number; beat: number} {
  const mbs = score.timeMap.quartersToMBS(ticksToQuarters(tick, ppq));
  return {measure: mbs.measure, beat: mbs.beat + mbs.subbeat.toFloat()};
}

export interface TimePosition {
  tick: number;
  seconds: number;
  measure: number;
  beat: number;
}

export function locateTick(score: Score, tick: number, ppq: number = DEFAULT_PPQ): TimePosition {
  const seconds = tickToSeconds(score, tick, ppq);
  const {measure, beat} = tickToMeasureBeat(score, tick, ppq);
  return {tick, seconds, measure, beat};
}

export function locateSeconds(score: Score, seconds: number, ppq: number = DEFAULT_PPQ): TimePosition {
  return locateTick(score, secondsToTick(score, seconds, ppq), ppq);
}

// --- Measure accessor ---

export function measureStartTicks(measure: Measure, ppq: number = DEFAULT_PPQ): number {
  return quartersToTicks(measure.onsetQuarters, ppq);
}

export function measureDurationTicks(measure: Measure, ppq: number = DEFAULT_PPQ): number {
  return quartersToTicks(measure.durationQuarters, ppq);
}
