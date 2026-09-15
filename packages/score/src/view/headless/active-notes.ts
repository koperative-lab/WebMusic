/** Immutable state for a score-independent note activity tracker. */
export interface ActiveNoteState {
  readonly activeMidis: readonly number[];
}

export type ActiveNoteListener = (state: ActiveNoteState) => void;

/** Headless held-note state reusable by keyboards, meters and MIDI monitors. */
export interface ActiveNoteTracker {
  readonly state: ActiveNoteState;
  noteOn(midi: number): ActiveNoteState;
  noteOff(midi: number): ActiveNoteState;
  clear(): ActiveNoteState;
  subscribe(listener: ActiveNoteListener): () => void;
}

export function createActiveNoteTracker(): ActiveNoteTracker {
  const active = new Map<number, number>();
  const listeners = new Set<ActiveNoteListener>();
  let state = snapshot();

  function snapshot(): ActiveNoteState {
    return Object.freeze({activeMidis: Object.freeze([...active.keys()].sort((a, b) => a - b))});
  }

  function publish(): ActiveNoteState {
    const published = snapshot();
    state = published;
    for (const listener of [...listeners]) {
      if (state !== published) break;
      if (listeners.has(listener)) listener(published);
    }
    return state;
  }

  function validateMidi(midi: number): void {
    if (!Number.isSafeInteger(midi) || midi < 0 || midi > 127) {
      throw new RangeError('Active note MIDI must be a safe integer between 0 and 127.');
    }
  }

  return {
    get state() {
      return state;
    },
    noteOn(midi) {
      validateMidi(midi);
      active.set(midi, (active.get(midi) ?? 0) + 1);
      return publish();
    },
    noteOff(midi) {
      validateMidi(midi);
      const count = active.get(midi) ?? 0;
      if (count <= 1) active.delete(midi);
      else active.set(midi, count - 1);
      return publish();
    },
    clear() {
      active.clear();
      return publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
