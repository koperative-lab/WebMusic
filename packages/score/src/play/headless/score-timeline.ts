import {
  mergedTiedNotes,
  noteEndSeconds,
  noteMidi,
  noteOnsetSeconds,
  noteVelocity,
  Pitch,
  transpositionSemitones,
  type Note,
  type Score,
} from '../../core';

/** One rate-independent entry in the player's immutable scheduling snapshot. */
export interface ScheduledScoreNote {
  note: Note;
  partId: string;
  /** Nominal score seconds at the notated tempo. */
  start: number;
  /** Nominal score seconds at the notated tempo. */
  end: number;
  /** Sounding MIDI pitch, including part transposition. */
  midi: number;
  velocity: number;
}

interface ScoreTimelineSnapshot {
  notes: ScheduledScoreNote[];
  maxNoteDuration: number;
  /** End of the actual performance, including performed notes past notation. */
  duration: number;
}

/**
 * Lazy, immutable performance view of a Score. It merges ties, skips grace
 * notes, resolves sounding pitch, sorts once, and owns the binary searches the
 * rolling scheduler uses for seek, resume and live rate changes.
 */
export class ScoreTimeline {
  private snapshot?: ScoreTimelineSnapshot;
  private preparedNotes?: readonly Note[];

  constructor(private readonly score: Score) {}

  prepare(): readonly ScheduledScoreNote[] {
    return this.ensureSnapshot().notes;
  }

  /** The same sounding pitches that noteOn receives, retaining note ids/data. */
  get preloadNotes(): readonly Note[] {
    return this.preparedNotes ??= this.prepare().map(({note, midi}) =>
      midi === noteMidi(note) ? note : note.with({pitch: Pitch.fromMidi(midi)}),
    );
  }

  get maxNoteDuration(): number {
    return this.ensureSnapshot().maxNoteDuration;
  }

  /**
   * Nominal performance duration in seconds. This deliberately includes a
   * performed note which extends beyond the final notated measure: MIDI and
   * recorded scores are allowed to carry that timing independently.
   */
  get duration(): number {
    return this.ensureSnapshot().duration;
  }

  /** First note whose nominal start is greater than or equal to `target`. */
  lowerBound(target: number): number {
    const notes = this.prepare();
    let low = 0;
    let high = notes.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (notes[middle].start < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /** First note whose nominal start is greater than `target`. */
  upperBound(target: number): number {
    const notes = this.prepare();
    let low = 0;
    let high = notes.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (notes[middle].start <= target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private ensureSnapshot(): ScoreTimelineSnapshot {
    if (this.snapshot) return this.snapshot;

    const notes: ScheduledScoreNote[] = [];
    let maxNoteDuration = 0;
    let duration = this.score.durationSeconds;
    for (const part of this.score.parts) {
      const semitones = transpositionSemitones(part);
      for (const event of mergedTiedNotes(part)) {
        const first = event.first;
        if (first.grace) continue;
        const start = noteOnsetSeconds(first, this.score);
        // Do not assume a recorded tie chain is monotonically timed. The
        // sounding event must survive until its furthest performed endpoint.
        const end = Math.max(...event.notes.map((note) => noteEndSeconds(note, this.score)));
        maxNoteDuration = Math.max(maxNoteDuration, end - start);
        duration = Math.max(duration, end);
        notes.push({
          note: first,
          partId: part.id,
          start,
          end,
          midi: noteMidi(first) + semitones,
          velocity: noteVelocity(first),
        });
      }
    }
    notes.sort((left, right) => left.start - right.start || left.midi - right.midi);
    this.snapshot = {notes, maxNoteDuration, duration};
    return this.snapshot;
  }
}
