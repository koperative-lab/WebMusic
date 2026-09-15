import {
  isSoundingNote,
  noteEndSeconds,
  noteMidi,
  noteOnsetSeconds,
  scoreDurationSeconds,
  type Note,
  type Score,
} from '../../core';
import type {PianoRollNote, StaffGlyph, ViewLayoutOptions, WaterfallNote} from './types';

export function createPianoRollLayout(score: Score, opts: ViewLayoutOptions = {}): PianoRollNote[] {
  const pixelsPerSecond = positiveScale(opts.pixelsPerSecond ?? 30, 'pixelsPerSecond');
  const noteHeight = positiveScale(opts.laneHeight ?? 6, 'laneHeight');
  const noteSpacing = 1;
  const entries = scoreNoteEntries(score);
  if (entries.length === 0) {
    // Math.min/Math.max of an empty array would be ±Infinity → NaN layout.
    return [];
  }
  let minPitch = Number.POSITIVE_INFINITY;
  let maxPitch = Number.NEGATIVE_INFINITY;
  for (const {note} of entries) {
    const midi = noteMidi(note);
    minPitch = Math.min(minPitch, midi);
    maxPitch = Math.max(maxPitch, midi);
  }
  minPitch -= 2;
  maxPitch += 2;
  const height = (maxPitch - minPitch) * noteHeight;

  return entries.map(({partId, note, startTime, endTime}) => {
    const midi = noteMidi(note);
    const duration = endTime - startTime;
    return {
      partId,
      note,
      startSeconds: startTime,
      durationSeconds: duration,
      x: startTime * pixelsPerSecond,
      y: height - (midi - minPitch) * noteHeight,
      width: Math.max(pixelsPerSecond * duration - noteSpacing, 1),
      height: noteHeight,
    };
  });
}

export function createWaterfallLayout(score: Score, opts: ViewLayoutOptions = {}): WaterfallNote[] {
  const pixelsPerSecond = positiveScale(opts.pixelsPerSecond ?? 30, 'pixelsPerSecond');
  const noteSpacing = 1;
  const whiteNoteWidth = positiveScale(opts.laneHeight ?? 20, 'laneHeight');
  const blackNoteWidth = (whiteNoteWidth * 2) / 3;
  const entries = scoreNoteEntries(score);
  const duration = entries.reduce(
    (maxEnd, entry) => Math.max(maxEnd, entry.endTime),
    scoreDurationSeconds(score),
  );
  const height = Math.max(duration * pixelsPerSecond, 1);

  return entries.map(({partId, note, startTime, endTime}) => {
    const midi = noteMidi(note);
    const key = waterfallKey(midi, whiteNoteWidth, blackNoteWidth);
    const durationSeconds = endTime - startTime;
    const itemHeight = Math.max(pixelsPerSecond * durationSeconds - noteSpacing, 1);
    return {
      partId,
      note,
      x: key.x,
      y: height - startTime * pixelsPerSecond - itemHeight,
      width: key.width,
      height: itemHeight,
      startSeconds: startTime,
      durationSeconds,
    };
  });
}

const STEP_TO_DIATONIC: Record<string, number> = {C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6};

/**
 * Diatonic staff steps from middle C (C4 = 0, D4 = 1, …, C5 = 7). Uses the
 * notated spelling so accidentals sit on their natural's line (C#4 shares
 * C4's position, Db4 shares D4's). Falls back to a MIDI approximation only
 * when spelling information is absent.
 */
function diatonicStepsFromMiddleC(note: Note): number {
  const pitch = note.pitch as {step?: string; octave?: number} | undefined;
  const letter = pitch?.step === undefined ? undefined : STEP_TO_DIATONIC[pitch.step];
  if (letter !== undefined && typeof pitch?.octave === 'number' && Number.isFinite(pitch.octave)) {
    return (pitch.octave - 4) * 7 + letter;
  }
  return Math.round((noteMidi(note) - 60) * 0.58);
}

export function createStaffLayout(score: Score, opts: ViewLayoutOptions = {}): StaffGlyph[] {
  const staffSpace = positiveScale(opts.staffSpace ?? 10, 'staffSpace');
  const pixelsPerSecond = positiveScale(opts.pixelsPerSecond ?? 30, 'pixelsPerSecond');
  return score.parts.flatMap((part, partIndex) =>
    part.notes.filter(isSoundingNote).map((note) => {
      const startSeconds = noteOnsetSeconds(note, score);
      const staffSteps = diatonicStepsFromMiddleC(note);
      const staffY = partIndex * staffSpace * 10 - staffSteps * (staffSpace / 2);
      return {
        partId: part.id,
        note,
        startSeconds,
        x: startSeconds * pixelsPerSecond,
        staffY,
        ledgerLines: Math.max(0, Math.ceil((Math.abs(staffSteps) - 10) / 2)),
      };
    }),
  );
}

function scoreNoteEntries(score: Score): Array<{
  partId: string;
  note: Note;
  startTime: number;
  endTime: number;
}> {
  const entries = score.parts.flatMap((part) =>
    part.notes.filter(isSoundingNote).map((note) => ({partId: part.id, note})),
  );

  return entries
    .map((entry) => ({
      ...entry,
      startTime: noteOnsetSeconds(entry.note, score),
      endTime: noteEndSeconds(entry.note, score),
    }))
    .sort((a, b) => a.startTime - b.startTime || noteMidi(a.note) - noteMidi(b.note));
}

const WHITE_KEY_INDEX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

/** Physical key position relative to A0, extended across the full MIDI range. */
function waterfallKey(
  midi: number,
  whiteNoteWidth: number,
  blackNoteWidth: number,
): {x: number; width: number} {
  const pitchClass = midi % 12;
  const black = BLACK_PITCH_CLASSES.has(pitchClass);
  // Twelve white keys precede A0 (MIDI 21) when counting upward from MIDI 0.
  const whiteIndex = Math.floor(midi / 12) * 7 + WHITE_KEY_INDEX[pitchClass]! - 12;
  return {
    x: whiteIndex * whiteNoteWidth + (black ? whiteNoteWidth - blackNoteWidth / 2 : 0),
    width: black ? blackNoteWidth : whiteNoteWidth,
  };
}

function positiveScale(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`Score layout ${name} must be finite and positive.`);
  }
  return value;
}
