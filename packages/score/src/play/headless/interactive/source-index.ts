import {
  mergedTiedNotes,
  noteEndSeconds,
  noteMidi,
  noteOnsetSeconds,
  noteVelocity,
  transpositionSemitones,
  type Score,
} from '../../../core';
import type {BeatNote, SourceRoute} from './contracts';

export interface InteractiveSource {
  id: string;
  beats: BeatNote[][];
  totalBeats: number;
  secondsPerBeat: number;
  cursor: number;
}

/** Build the immutable beat buckets used by pull playback. */
export function createInteractiveSource(
  id: string,
  score: Score,
  beatUnitQuarters: number,
  route?: SourceRoute,
): InteractiveSource {
  const unit = Number.isFinite(beatUnitQuarters) && beatUnitQuarters > 0
    ? beatUnitQuarters
    : 1;
  const routePart = toRouteFunction(route);
  const initialTempo = score.timeMap.tempi[0];
  const bpm = initialTempo?.bpm ?? 120;
  // TempoEntry.bpm is expressed in `TempoEntry.unit` quarter notes, while
  // the pull grid can use a different beat width. Match TimeMap's
  // seconds-per-quarter conversion before projecting one source-grid beat.
  const secondsPerBeat = (60 / (bpm * (initialTempo?.unit ?? 1))) * unit;
  // A source is a score-wide beat grid, not merely a list of note onsets.
  // Preserve trailing rests, written long notes, and performed tails so a pull
  // clock cannot wrap and retrigger a source while its final recording-derived
  // voice is still sounding. Performed seconds are projected through this
  // source's default initial tempo and tempo-unit beat width; a host override
  // remains the authority for actual pulse timing.
  let totalBeats = Math.max(0, Math.ceil(score.durationQuarters.toFloat() / unit));
  const events: Array<{beat: number; note: BeatNote}> = [];

  for (const part of score.parts) {
    const semitones = transpositionSemitones(part);
    // Pull playback owns the clock, but it must not invent a second definition
    // of a sounding score event. Keep its written beat grid while using the
    // same tie, grace, pitch and performed-end projection as ScoreTimeline.
    for (const event of mergedTiedNotes(part)) {
      const first = event.first;
      if (first.grace) continue;
      const onsetBeatPosition = event.onsetQuarters.toFloat() / unit;
      const beat = Math.floor(onsetBeatPosition);
      const endBeatPosition = event.onsetQuarters.add(event.durationQuarters).toFloat() / unit;
      const startSeconds = noteOnsetSeconds(first, score);
      const endSeconds = Math.max(
        ...event.notes.map((note) => noteEndSeconds(note, score)),
      );
      totalBeats = Math.max(totalBeats, Math.ceil(endBeatPosition));
      totalBeats = Math.max(totalBeats, Math.ceil(endSeconds / secondsPerBeat));
      events.push({
        beat,
        note: {
          midi: noteMidi(first) + semitones,
          velocity: noteVelocity(first),
          durationBeats: event.durationQuarters.toFloat() / unit,
          durationSeconds: Math.max(0, endSeconds - startSeconds),
          onsetInBeat: onsetBeatPosition - beat,
          part: part.name,
          voice: routePart(part.name),
        },
      });
    }
  }

  const beats: BeatNote[][] = Array.from({length: totalBeats}, () => []);
  for (const event of events) beats[event.beat].push(event.note);
  for (const beat of beats) {
    beat.sort((left, right) => left.onsetInBeat - right.onsetInBeat || left.midi - right.midi);
  }
  return {id, beats, totalBeats, secondsPerBeat, cursor: 0};
}

/** Mutable registry and active-source pointer; beat contents stay immutable. */
export class InteractiveSourceIndex {
  private readonly sources = new Map<string, InteractiveSource>();
  private current?: InteractiveSource;

  add(source: InteractiveSource): void {
    const replaced = this.sources.get(source.id);
    this.sources.set(source.id, source);
    if (!this.current || this.current === replaced) this.current = source;
  }

  remove(id: string): void {
    const source = this.sources.get(id);
    if (!source) return;
    this.sources.delete(id);
    if (this.current === source) this.current = this.sources.values().next().value;
  }

  select(id: string, carry = true): InteractiveSource | undefined {
    const next = this.sources.get(id);
    if (!next) return undefined;
    const previous = this.current;
    if (!carry) next.cursor = 0;
    if (
      carry &&
      previous &&
      previous !== next &&
      previous.totalBeats > 0 &&
      next.totalBeats > 0
    ) {
      const ratio = previous.cursor / previous.totalBeats;
      next.cursor = Math.min(
        Math.floor(ratio * next.totalBeats),
        next.totalBeats - 1,
      );
    }
    this.current = next;
    return next;
  }

  get active(): InteractiveSource | undefined {
    return this.current;
  }

  list(): string[] {
    return [...this.sources.keys()];
  }

  clear(): void {
    this.sources.clear();
    this.current = undefined;
  }
}

function toRouteFunction(route?: SourceRoute): (part: string) => string | undefined {
  if (!route) return () => undefined;
  if (typeof route === 'function') return route;
  return (part) => route[part];
}
