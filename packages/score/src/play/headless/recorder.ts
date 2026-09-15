import type {Score} from '../../core';
import {notesToScore, type RecordedNote} from '../core/record';

export const SCORE_RECORDER_VOICE = 'rec';

/** Detail payload of `webscore:recorded`. */
export interface ScoreRecorderRecordedDetail {
  score: Score;
}

export interface ScoreRecorderNotationOptions {
  bpm: number;
  quantize: number;
  title?: string;
}

type Clock = () => number;

/** Current monotonic time in seconds, with an SSR-safe fallback. */
export function recorderNow(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

/**
 * DOM-free note-pairing model for one recording take. It owns no event
 * listeners, audio monitoring, playback, file downloads, or presenter state.
 */
export class ScoreRecorderSession {
  private notes: RecordedNote[] | null = null;
  private readonly presses = new Map<number, Array<{start: number; velocity: number}>>();
  private startedAt = 0;

  constructor(private readonly clock: Clock = recorderNow) {}

  get active(): boolean {
    return this.notes != null;
  }

  get noteCount(): number {
    return this.notes?.length ?? 0;
  }

  start(): void {
    this.notes = [];
    this.presses.clear();
    this.startedAt = this.clock();
  }

  /** Capture a press/release and report when it completed a recorded note. */
  capture(midi: number, velocity: number, on: boolean): boolean {
    if (!this.notes) return false;
    if (on) {
      const presses = this.presses.get(midi) ?? [];
      presses.push({start: this.clock(), velocity});
      this.presses.set(midi, presses);
      return false;
    }
    const presses = this.presses.get(midi);
    const press = presses?.shift();
    if (!press) return false;
    if (!presses?.length) this.presses.delete(midi);
    this.notes.push({
      voice: SCORE_RECORDER_VOICE,
      midi,
      velocity: press.velocity,
      onsetSec: press.start - this.startedAt,
      durationSec: Math.max(0.02, this.clock() - press.start),
    });
    return true;
  }

  /** Discard unmatched presses, preserving completed notes and the take's start time. */
  discardPending(): void {
    this.presses.clear();
  }

  /** Finish an active take; returns null when the session was not armed. */
  finish(): RecordedNote[] | null {
    if (!this.notes) return null;
    const completed = this.notes;
    this.notes = null;
    this.discardPending();
    return completed;
  }

  cancel(): void {
    this.notes = null;
    this.discardPending();
  }
}

/** Convert a completed performance into its notated Score representation. */
export function recordedNotesToScore(
  notes: ReadonlyArray<RecordedNote>,
  {bpm, quantize, title = 'Recording'}: ScoreRecorderNotationOptions,
): Score | undefined {
  if (notes.length === 0) return undefined;
  return notesToScore(notes, {
    bpm,
    quantizeGrid: quantize || undefined,
    title,
  });
}
