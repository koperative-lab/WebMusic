import {observeScorePlayback, type ScorePlaybackSnapshot, type ScorePlaybackSource} from '../../core';
import {createActiveNoteTracker} from './active-notes';

/** Optional borrowed source; a pitch view never owns playback resources. */
export interface PitchViewOptions {
  playback?: ScorePlaybackSource;
}

/** Immutable held-pitch projection, independent of any visual representation. */
export interface PitchViewState {
  readonly activeMidis: readonly number[];
  /** Most recently accepted native snapshot; absent before attachment or after detachment. */
  readonly playback?: ScorePlaybackSnapshot;
}

export type PitchViewListener = (state: PitchViewState) => void;

/** Reusable held-note state for keyboard, notation and string readouts. */
export interface PitchView {
  readonly state: PitchViewState;
  /** Increment one standalone occurrence; MIDI must be an integer in 0–127. */
  noteOn(midi: number): PitchViewState;
  /** Release one standalone occurrence; unmatched releases have no effect. */
  noteOff(midi: number): PitchViewState;
  /** Clear the local held notes without releasing the borrowed subscription. */
  clear(): PitchViewState;
  /** Replace/detach the borrowed source, clearing notes and the source's revision scope. */
  setPlayback(playback?: ScorePlaybackSource): PitchViewState;
  /** Replace held notes from one coherent snapshot; lower revisions are ignored until rebinding. */
  updatePlayback(playback: ScorePlaybackSnapshot): PitchViewState;
  /** Observe subsequent changes; read state for the initial snapshot. */
  subscribe(listener: PitchViewListener): () => void;
  /** Release owned subscriptions and state. Idempotent; never disposes the player. */
  dispose(): void;
}

/** Create a code-only pitch readout, with standalone input or one borrowed player. */
export function createPitchView(options: PitchViewOptions = {}): PitchView {
  const notes = createActiveNoteTracker();
  const listeners = new Set<PitchViewListener>();
  let playback: ScorePlaybackSnapshot | undefined;
  let revision = -1;
  let generation = 0;
  let disposed = false;
  let unbind: (() => void) | undefined;
  let state = snapshot();

  function snapshot(): PitchViewState {
    return Object.freeze({activeMidis: notes.state.activeMidis, ...(playback ? {playback} : {})});
  }

  function assertActive(): void {
    if (disposed) throw new Error('PitchView has been disposed.');
  }

  function publish(): PitchViewState {
    const published = state = snapshot();
    for (const listener of [...listeners]) {
      if (disposed || state !== published) break;
      if (listeners.has(listener)) listener(published);
    }
    return state;
  }

  const view: PitchView = {
    get state() { return state; },
    noteOn(midi) { assertActive(); notes.noteOn(midi); return publish(); },
    noteOff(midi) { assertActive(); notes.noteOff(midi); return publish(); },
    clear() { assertActive(); notes.clear(); return publish(); },
    setPlayback(source) {
      assertActive();
      const ownGeneration = ++generation;
      const previous = unbind;
      unbind = undefined;
      revision = -1;
      playback = undefined;
      notes.clear();
      // State is cleared even when the previous source's cleanup fails. A
      // reentrant listener may attach a newer source, which must remain current.
      try { publish(); } finally { previous?.(); }
      if (disposed || generation !== ownGeneration || !source) return state;
      const candidate = observeScorePlayback(source, (next) => {
        if (!disposed && generation === ownGeneration) view.updatePlayback(next);
      });
      if (disposed || generation !== ownGeneration) candidate();
      else unbind = candidate;
      return state;
    },
    updatePlayback(next) {
      assertActive();
      if (!Number.isSafeInteger(next.revision) || next.revision < 0
        || !Number.isSafeInteger(next.sourceRevision) || next.sourceRevision < 0) {
        throw new RangeError('PitchView playback revisions must be non-negative safe integers.');
      }
      if (next.revision < revision) return state;
      const occurrences = new Map<string, number>();
      if (next.readiness === 'ready' && next.state !== 'stopped' && next.state !== 'ended') {
        for (const note of next.activeNotes) {
          if (!Number.isSafeInteger(note.midi) || note.midi < 0 || note.midi > 127
            || typeof note.occurrenceId !== 'string' || note.occurrenceId.length === 0) {
            throw new RangeError('PitchView active occurrences require an ID and an integer MIDI pitch in 0–127.');
          }
          const previousMidi = occurrences.get(note.occurrenceId);
          if (previousMidi !== undefined && previousMidi !== note.midi) {
            throw new RangeError('PitchView occurrence IDs must identify one MIDI pitch.');
          }
          occurrences.set(note.occurrenceId, note.midi);
        }
      }
      // Validate first, then commit one coherent state. Duplicate IDs do not
      // inflate counts; equal MIDI pitches with different IDs remain distinct.
      revision = next.revision;
      playback = next;
      notes.clear();
      for (const midi of occurrences.values()) notes.noteOn(midi);
      return publish();
    },
    subscribe(listener) {
      assertActive();
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      const release = unbind;
      unbind = undefined;
      playback = undefined;
      notes.clear();
      state = snapshot();
      listeners.clear();
      release?.();
    },
  };
  if (options.playback) view.setPlayback(options.playback);
  return view;
}
