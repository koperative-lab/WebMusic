import {identifyChordFromMidi} from '../core/chords';
import {keyFromHistogram} from '../core/key';
import {pitchClass} from '../core/pitch-class';
import type {KeyResult} from '../core/types';

export interface LiveChordState {
  chord: string;
  midis: readonly number[];
  history: readonly string[];
}

export interface LiveChordTracker {
  noteOn(midi: number): void;
  noteOff(midi: number): void;
  reset(): void;
}

/** Track and name the set of notes currently sounding. */
export function createLiveChordTracker(callbacks: {
  onUpdate(state: LiveChordState): void;
  onChordChange?(chord: string, midis: readonly number[]): void;
}): LiveChordTracker {
  const sounding = new Map<number, number>();
  const history: string[] = [];
  let last = '';
  let revision = 0;

  const update = (): void => {
    const activeRevision = revision;
    const midis = [...sounding.keys()].sort((a, b) => a - b);
    const chord = identifyChordFromMidi(midis);
    if (chord !== last) {
      last = chord;
      if (chord) {
        if (history[history.length - 1] !== chord) {
          history.push(chord);
          if (history.length > 8) history.shift();
        }
        callbacks.onChordChange?.(chord, [...midis]);
      }
    }
    // External chord listeners may synchronously reset this tracker or feed
    // another note. That newer update owns the observable state, so never let
    // this older stack frame publish stale state when the callback returns.
    if (revision !== activeRevision) return;
    callbacks.onUpdate({chord: last, midis: [...midis], history: [...history]});
  };

  return {
    noteOn(midi) {
      validateMidi(midi);
      revision += 1;
      sounding.set(midi, (sounding.get(midi) ?? 0) + 1);
      update();
    },
    noteOff(midi) {
      validateMidi(midi);
      revision += 1;
      const count = sounding.get(midi) ?? 0;
      if (count <= 1) sounding.delete(midi);
      else sounding.set(midi, count - 1);
      update();
    },
    reset() {
      revision += 1;
      sounding.clear();
      history.length = 0;
      last = '';
      update();
    },
  };
}

export interface LiveKeyTracker {
  noteOn(midi: number): void;
  reset(): void;
  readonly heard: number;
  result(): KeyResult | undefined;
}

/** Estimate a key from the pitch classes heard during playback. */
export function createLiveKeyTracker(onUpdate: (result: KeyResult, heard: number) => void): LiveKeyTracker {
  const histogram = new Array<number>(12).fill(0);
  let total = 0;
  return {
    noteOn(midi) {
      validateMidi(midi);
      histogram[pitchClass(midi)] += 1;
      total += 1;
      onUpdate(keyFromHistogram(histogram, total), total);
    },
    reset() {
      histogram.fill(0);
      total = 0;
    },
    get heard() {
      return total;
    },
    result() {
      return total > 0 ? keyFromHistogram(histogram, total) : undefined;
    },
  };
}

function validateMidi(midi: number): void {
  if (!Number.isSafeInteger(midi) || midi < 0 || midi > 127) {
    throw new RangeError('Live analysis MIDI note must be a safe integer between 0 and 127.');
  }
}
