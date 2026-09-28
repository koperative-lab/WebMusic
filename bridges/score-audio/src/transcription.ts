// ============================================================================
// Audio → symbolic assembly: build a real @webmusic/score Score from the
// family-neutral note events that @webmusic/audio/analyze/transcribe emits. This
// deliberately lives in the bridge — the analyze package knows nothing about
// scores, and this module is the only place the two vocabularies meet.
//
// Notation is quantized to a grid; the exact audio timing survives on each
// note's `performed` attributes (onsetSec/durationSec/velocity), so nothing
// the transcriber heard is lost to the grid.
// ============================================================================

import type {TranscribedNote} from '@webmusic/audio/analyze/transcribe';
import {
  Duration,
  MeasureId,
  PartId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
  type Score,
} from '@webmusic/score';

export interface ScoreFromTranscriptionOptions {
  /** Tempo of the produced score. Default 120 (pass the transcriber's bpm). */
  bpm?: number;
  /** Time signature. Default 4/4. */
  timeSignature?: {numerator: number; denominator: number};
  /**
   * Notation grid in subdivisions per quarter note: onsets/durations snap to
   * `1/grid` quarters and durations never collapse below one grid unit.
   * Default 4 (sixteenth notes). Pass 0 to keep exact (unquantized) values
   * on the 1/480 tick grid.
   */
  quantizeGrid?: number;
  /** Score title. Default 'Transcription'. */
  title?: string;
  /** Part name. Default 'Transcribed'. */
  partName?: string;
  /** Maximum number of input note events to process. Default 100,000. */
  maxNotes?: number;
  /** Maximum number of measures to materialize. Default 4,096. */
  maxMeasures?: number;
}

const TICKS_PER_QUARTER = 480;
export const DEFAULT_MAX_TRANSCRIPTION_NOTES = 100_000;
export const DEFAULT_MAX_TRANSCRIPTION_MEASURES = 4_096;

/**
 * Assemble a Score from transcribed note events. Notes with a MIDI pitch
 * outside [0, 127] are skipped (transcription noise); velocities clamp into
 * the 1..127 MIDI range; measures are laid out to cover the material.
 */
export function scoreFromTranscription(
  notes: readonly TranscribedNote[],
  options: ScoreFromTranscriptionOptions = {},
): Score {
  const bpm = options.bpm ?? 120;
  if (!(Number.isFinite(bpm) && bpm > 0)) {
    throw new RangeError(`scoreFromTranscription: bpm must be finite and > 0, got ${bpm}.`);
  }
  const grid = options.quantizeGrid ?? 4;
  if (!(Number.isSafeInteger(grid) && grid >= 0)) {
    throw new RangeError(`scoreFromTranscription: quantizeGrid must be a non-negative safe integer, got ${grid}.`);
  }
  const timeSignature = options.timeSignature ?? {numerator: 4, denominator: 4};
  if (
    !Number.isSafeInteger(timeSignature.numerator) || timeSignature.numerator < 1 ||
    !Number.isSafeInteger(timeSignature.denominator) || timeSignature.denominator < 1
  ) {
    throw new RangeError('scoreFromTranscription: timeSignature values must be positive safe integers.');
  }
  const maxNotes = resolvePositiveLimit(
    'maxNotes',
    options.maxNotes,
    DEFAULT_MAX_TRANSCRIPTION_NOTES,
  );
  const maxMeasures = resolvePositiveLimit(
    'maxMeasures',
    options.maxMeasures,
    DEFAULT_MAX_TRANSCRIPTION_MEASURES,
  );
  if (notes.length > maxNotes) {
    throw new RangeError(
      `Transcription resource limit exceeded: ${notes.length.toLocaleString()} note events ` +
        `(maxNotes is ${maxNotes.toLocaleString()}).`,
    );
  }

  const denominator = grid > 0 ? grid : TICKS_PER_QUARTER;
  const secondsToQuarterUnits = (seconds: number, label: string): number => {
    const units = Math.round((seconds * bpm * denominator) / 60);
    if (!Number.isSafeInteger(units)) {
      throw new RangeError(`scoreFromTranscription: ${label} is too large to represent safely.`);
    }
    return units;
  };

  const builder = new ScoreBuilder();
  builder
    .setMetadata({title: options.title ?? 'Transcription'})
    .addTempo({atQuarters: Rational.ZERO, bpm})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});

  const partId = PartId('transcription');
  const voice = VoiceId('v1');
  builder.addPart({id: partId, name: options.partName ?? 'Transcribed', staves: 1});

  let maxEndUnits = 0;
  for (const [index, note] of notes.entries()) {
    if (!Number.isFinite(note.midi)) {
      throw new RangeError(`scoreFromTranscription: note ${index} pitch must be finite.`);
    }
    const midi = Math.round(note.midi);
    if (midi < 0 || midi > 127) continue; // transcription noise
    if (
      !Number.isFinite(note.startSeconds) || note.startSeconds < 0 ||
      !Number.isFinite(note.endSeconds) || note.endSeconds < note.startSeconds
    ) {
      throw new RangeError(
        `scoreFromTranscription: note ${index} must have finite, non-negative, ordered start/end seconds.`,
      );
    }
    if (!Number.isFinite(note.velocity)) {
      throw new RangeError(`scoreFromTranscription: note ${index} velocity must be finite.`);
    }
    const onsetUnits = secondsToQuarterUnits(note.startSeconds, `note ${index} startSeconds`);
    const endUnits = Math.max(
      onsetUnits + 1,
      secondsToQuarterUnits(note.endSeconds, `note ${index} endSeconds`),
    );
    if (!Number.isSafeInteger(endUnits)) {
      throw new RangeError(`scoreFromTranscription: note ${index} duration is too large to represent safely.`);
    }
    maxEndUnits = Math.max(maxEndUnits, endUnits);
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.fromMidi(midi),
      onsetQuarters: new Rational(onsetUnits, denominator),
      duration: new Duration({base: new Rational(endUnits - onsetUnits, denominator)}),
      voice,
      performed: {
        onsetSec: note.startSeconds,
        durationSec: Math.max(0, note.endSeconds - note.startSeconds),
        velocity: Math.min(127, Math.max(1, Math.round(note.velocity * 127))),
      },
    });
  }

  // Measures cover the material (at least one, so an empty transcription is
  // still a valid score).
  const materialUnits = BigInt(maxEndUnits) * BigInt(timeSignature.denominator);
  const measureUnits = BigInt(denominator) * BigInt(timeSignature.numerator) * 4n;
  const exactMeasureCount = materialUnits === 0n
    ? 1n
    : (materialUnits + measureUnits - 1n) / measureUnits;
  if (exactMeasureCount > BigInt(maxMeasures)) {
    throw new RangeError(
      `Transcription resource limit exceeded: score would create ` +
        `${exactMeasureCount.toLocaleString()} measures ` +
        `(maxMeasures is ${maxMeasures.toLocaleString()}).`,
    );
  }
  const measureCount = Number(exactMeasureCount);
  const quartersPerMeasure = quartersPerMeasureFrom(timeSignature);
  for (let index = 0; index < measureCount; index++) {
    builder.addMeasure({
      id: MeasureId(`m${index + 1}`),
      number: index + 1,
      onsetQuarters: quartersPerMeasure.mul(new Rational(index, 1)),
      durationQuarters: quartersPerMeasure,
      timeSignature,
    });
  }

  return builder.build();
}

function resolvePositiveLimit(name: 'maxNotes' | 'maxMeasures', value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`scoreFromTranscription: ${name} must be a positive safe integer.`);
  }
  return value;
}

function quartersPerMeasureFrom(timeSignature: {numerator: number; denominator: number}): Rational {
  let numerator = BigInt(timeSignature.numerator) * 4n;
  let denominator = BigInt(timeSignature.denominator);
  const divisor = greatestCommonDivisor(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  if (numerator > maxSafe || denominator > maxSafe) {
    throw new RangeError(
      'scoreFromTranscription: timeSignature measure duration is too large to represent safely.',
    );
  }
  return new Rational(Number(numerator), Number(denominator));
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  while (right !== 0n) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}
