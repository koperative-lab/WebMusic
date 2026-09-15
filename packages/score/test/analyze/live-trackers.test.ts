import {describe, expect, it} from 'vitest';
import {
  createLiveChordTracker,
  createLiveKeyTracker,
  type LiveChordState,
} from '../../src/analyze/headless/live-trackers';

describe('live chord tracker reentrant ownership', () => {
  it('does not repaint an old chord after a chord listener resets the tracker', () => {
    const paints: LiveChordState[] = [];
    const trackerRef: {current?: ReturnType<typeof createLiveChordTracker>} = {};
    const tracker = createLiveChordTracker({
      onUpdate: (state) => paints.push(state),
      // Element chordchange listeners can synchronously switch the `player`
      // attribute; the element responds by resetting this same tracker.
      onChordChange: () => trackerRef.current?.reset(),
    });
    trackerRef.current = tracker;

    tracker.noteOn(60);
    tracker.noteOn(64);
    tracker.noteOn(67);

    expect(paints.at(-1)).toEqual({chord: '', midis: [], history: []});
  });

  it('gives a reentrant note update ownership of the final paint', () => {
    const paints: LiveChordState[] = [];
    let injected = false;
    const trackerRef: {current?: ReturnType<typeof createLiveChordTracker>} = {};
    const tracker = createLiveChordTracker({
      onUpdate: (state) => paints.push(state),
      onChordChange: () => {
        if (injected) return;
        injected = true;
        trackerRef.current?.noteOn(71);
      },
    });
    trackerRef.current = tracker;

    tracker.noteOn(60);
    tracker.noteOn(64);
    tracker.noteOn(67);

    expect(paints.at(-1)?.midis).toEqual([60, 64, 67, 71]);
  });

  it('rejects invalid MIDI data at the public headless boundary', () => {
    const chord = createLiveChordTracker({onUpdate: () => undefined});
    const key = createLiveKeyTracker(() => undefined);

    expect(() => chord.noteOn(60.5)).toThrow(RangeError);
    expect(() => chord.noteOff(-1)).toThrow(RangeError);
    expect(() => key.noteOn(128)).toThrow(RangeError);
    expect(chord).toBeDefined();
    expect(key.heard).toBe(0);
  });
});
