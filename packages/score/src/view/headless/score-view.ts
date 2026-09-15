import {observeScorePlayback, type Score, type ScorePlaybackSnapshot, type ScorePlaybackSource} from '../../core';
import {scoreToNoteSequence} from '../core/note-sequence';
import type {
  ScoreNoteSequence,
  ScoreSequenceNote,
  ScoreViewType,
} from '../core/types';
import {
  lowerBoundByStartTime,
  maxNoteDuration,
  upperBoundByStartTime,
  visibleNoteRange,
  type IndexRange,
} from '../core/windowing';

const NOTE_TIME_TOLERANCE = 0.000001;

/** Time window used to select the notes a caller needs to draw. */
export interface ScoreViewTimeRange {
  readonly startTime: number;
  readonly endTime: number;
}

/** Initial state for a code-only score view. */
export interface ScoreViewOptions {
  type?: ScoreViewType;
  viewport?: ScoreViewTimeRange;
  /** Borrow a native source for this same immutable score. Never owns playback. */
  playback?: ScorePlaybackSource;
}

/** Immutable state published by {@link ScoreView}. */
export interface ScoreViewState {
  readonly type: ScoreViewType;
  readonly sequence: ScoreNoteSequence;
  readonly currentTime: number;
  readonly activeNotes: ReadonlyArray<ScoreSequenceNote>;
  readonly viewport?: Readonly<ScoreViewTimeRange>;
  /** Candidate range in `sequence.notes`, start inclusive and end exclusive. */
  readonly visibleRange: Readonly<IndexRange>;
  /** Exact notes whose sounding span intersects the current viewport. */
  readonly visibleNotes: ReadonlyArray<ScoreSequenceNote>;
}

export type ScoreViewListener = (state: ScoreViewState) => void;

/**
 * A code-only score-view component.
 *
 * It converts a score to a note sequence, tracks playback/selection state and
 * computes the notes visible in a time window. It owns no element or canvas,
 * performs no DOM work and applies no visual defaults; callers can feed its
 * immutable snapshots to React, Canvas, SVG, a terminal, or any other renderer.
 */
export interface ScoreView {
  readonly score: Score;
  readonly sequence: ScoreNoteSequence;
  readonly state: ScoreViewState;
  setType(type: ScoreViewType): ScoreViewState;
  setViewport(startTime: number, endTime: number): ScoreViewState;
  clearViewport(): ScoreViewState;
  seek(seconds: number): ScoreViewState;
  noteOn(midi: number, startTimeSeconds: number): ScoreSequenceNote | undefined;
  noteOff(midi: number, startTimeSeconds?: number): void;
  clearActiveNotes(): void;
  end(): void;
  reset(): void;
  subscribe(listener: ScoreViewListener): () => void;
  /** Apply a snapshot for this score; incompatible/unavailable input clears active notes. */
  updatePlayback(snapshot: ScorePlaybackSnapshot): ScoreViewState;
  dispose(): void;
}

/** Create a stateful, UI-independent score view for direct use in code. */
export function createScoreView(score: Score, options: ScoreViewOptions = {}): ScoreView {
  const sequence = scoreToNoteSequence(score);
  const listeners = new Set<ScoreViewListener>();
  const activeNotes = new Set<ScoreSequenceNote>();
  const notesByIdentity = new Map<string, ScoreSequenceNote[]>();
  for (const note of sequence.notes) {
    const key = JSON.stringify([note.partId, note.noteId]);
    const group = notesByIdentity.get(key) ?? [];
    group.push(note);
    notesByIdentity.set(key, group);
  }
  const longestNote = maxNoteDuration(sequence.notes);
  const fullRange = Object.freeze({start: 0, end: sequence.notes.length});
  let type = validateType(options.type ?? 'piano-roll');
  let currentTime = 0;
  let viewport = options.viewport ? validateViewport(options.viewport) : undefined;
  let disposed = false;
  let snapshot = createSnapshot();
  let unbindPlayback: (() => void) | undefined;

  function assertActive(): void {
    if (disposed) throw new Error('ScoreView has been disposed.');
  }

  function createSnapshot(): ScoreViewState {
    const visibleRange = viewport
      ? visibleNoteRange(sequence.notes, viewport.startTime, viewport.endTime, longestNote)
      : fullRange;
    const visibleNotes = viewport
      ? sequence.notes
          .slice(visibleRange.start, visibleRange.end)
          .filter(
            (note) => note.endTime > viewport!.startTime && note.startTime <= viewport!.endTime,
          )
      : sequence.notes;
    return Object.freeze({
      type,
      sequence,
      currentTime,
      activeNotes: Object.freeze([...activeNotes]),
      viewport,
      visibleRange: Object.isFrozen(visibleRange) ? visibleRange : Object.freeze(visibleRange),
      visibleNotes: Object.isFrozen(visibleNotes) ? visibleNotes : Object.freeze(visibleNotes),
    });
  }

  function publish(): ScoreViewState {
    const published = createSnapshot();
    snapshot = published;
    for (const listener of [...listeners]) {
      if (disposed || snapshot !== published) break;
      if (listeners.has(listener)) listener(published);
    }
    return snapshot;
  }

  function setCurrentTime(seconds: number): void {
    if (!Number.isFinite(seconds)) throw new RangeError('Score view time must be finite.');
    currentTime = Math.min(Math.max(0, seconds), Math.max(0, sequence.totalTime));
  }

  const view: ScoreView = {
    score,
    sequence,
    get state() {
      return snapshot;
    },
    setType(nextType) {
      assertActive();
      type = validateType(nextType);
      return publish();
    },
    setViewport(startTime, endTime) {
      assertActive();
      viewport = validateViewport({startTime, endTime});
      return publish();
    },
    clearViewport() {
      assertActive();
      viewport = undefined;
      return publish();
    },
    seek(seconds) {
      assertActive();
      setCurrentTime(seconds);
      activeNotes.clear();
      const range = visibleNoteRange(sequence.notes, currentTime, currentTime, longestNote);
      for (const note of sequence.notes.slice(range.start, range.end)) {
        if (note.startTime <= currentTime && note.endTime > currentTime) activeNotes.add(note);
      }
      return publish();
    },
    noteOn(midi, startTimeSeconds) {
      assertActive();
      validateMidi(midi);
      validateNoteTime(startTimeSeconds, 'noteOn');
      setCurrentTime(startTimeSeconds);
      for (const active of activeNotes) {
        if (active.endTime <= currentTime) activeNotes.delete(active);
      }
      const note = visitMatchingNotes(sequence, midi, startTimeSeconds, (candidate) => {
        activeNotes.add(candidate);
      });
      publish();
      return note;
    },
    noteOff(midi, startTimeSeconds) {
      assertActive();
      validateMidi(midi);
      if (startTimeSeconds !== undefined) validateNoteTime(startTimeSeconds, 'noteOff');
      if (startTimeSeconds === undefined) {
        for (const note of activeNotes) {
          if (note.pitch === midi) activeNotes.delete(note);
        }
      } else {
        visitMatchingNotes(sequence, midi, startTimeSeconds, (note) => activeNotes.delete(note));
      }
      publish();
    },
    clearActiveNotes() {
      assertActive();
      activeNotes.clear();
      publish();
    },
    end() {
      assertActive();
      currentTime = Math.max(0, sequence.totalTime);
      activeNotes.clear();
      publish();
    },
    reset() {
      assertActive();
      currentTime = 0;
      activeNotes.clear();
      publish();
    },
    subscribe(listener) {
      assertActive();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updatePlayback(playback) {
      assertActive();
      const compatible = playback.score === score
        && playback.readiness !== 'disposed' && playback.readiness !== 'unavailable';
      if (compatible && playback.nominalSeconds !== null) setCurrentTime(playback.nominalSeconds);
      activeNotes.clear();
      if (compatible) {
        for (const note of playback.activeNotes) {
          for (const visible of notesByIdentity.get(JSON.stringify([note.partId, note.noteId])) ?? []) activeNotes.add(visible);
        }
      }
      return publish();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const releasePlayback = unbindPlayback;
      unbindPlayback = undefined;
      activeNotes.clear();
      snapshot = createSnapshot();
      listeners.clear();
      releasePlayback?.();
    },
  };
  if (options.playback) unbindPlayback = observeScorePlayback(options.playback, (state) => { view.updatePlayback(state); });
  return view;
}

function validateViewport(viewport: ScoreViewTimeRange): Readonly<ScoreViewTimeRange> {
  const {startTime, endTime} = viewport;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime < startTime) {
    throw new RangeError('Score view viewport must be a finite range with 0 <= startTime <= endTime.');
  }
  return Object.freeze({startTime, endTime});
}

function validateType(type: ScoreViewType): ScoreViewType {
  if (type !== 'piano-roll' && type !== 'staff' && type !== 'waterfall') {
    throw new RangeError(`Unsupported score view type: ${String(type)}`);
  }
  return type;
}

function validateMidi(midi: number): void {
  if (!Number.isSafeInteger(midi) || midi < 0 || midi > 127) {
    throw new RangeError('Score view MIDI note must be a safe integer between 0 and 127.');
  }
}

function validateNoteTime(seconds: number, operation: 'noteOn' | 'noteOff'): void {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`Score view ${operation} time must be a finite non-negative number.`);
  }
}

/** Visit only the small onset-sorted slice that can match the player event. */
function visitMatchingNotes(
  sequence: ScoreNoteSequence,
  midi: number,
  startTime: number,
  visit: (note: ScoreSequenceNote) => void,
): ScoreSequenceNote | undefined {
  const notes = sequence.notes;
  const start = lowerBoundByStartTime(notes, startTime - NOTE_TIME_TOLERANCE);
  const end = upperBoundByStartTime(notes, startTime + NOTE_TIME_TOLERANCE);
  let first: ScoreSequenceNote | undefined;
  for (let index = start; index < end; index += 1) {
    const note = notes[index];
    if (note.pitch !== midi || Math.abs(note.startTime - startTime) >= NOTE_TIME_TOLERANCE) continue;
    first ??= note;
    visit(note);
  }
  return first;
}
