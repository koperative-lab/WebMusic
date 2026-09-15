import type {Score} from '../../../core';
import {
  notesToScore,
  type RecordedNote,
  type RecordToScoreOptions,
} from '../../core/record';

/** Captures fired notes independently from playback and audio-graph state. */
export class InteractivePerformanceRecorder {
  private notes?: RecordedNote[];
  private baseTime?: number;

  start(): void {
    this.notes = [];
    this.baseTime = undefined;
  }

  get active(): boolean {
    return this.notes != null;
  }

  capture(
    voice: string,
    midi: number,
    velocity: number,
    time: number,
    durationSeconds: number,
  ): void {
    if (!this.notes) return;
    if (this.baseTime == null) this.baseTime = time;
    this.notes.push({
      voice,
      midi,
      velocity,
      onsetSec: time - this.baseTime,
      durationSec: durationSeconds,
    });
  }

  stop(options: RecordToScoreOptions = {}): Score {
    const notes = this.notes ?? [];
    this.reset();
    return notesToScore(notes, options);
  }

  reset(): void {
    this.notes = undefined;
    this.baseTime = undefined;
  }
}
