import {describe, expect, it, vi} from 'vitest';
import {createActiveNoteTracker} from '../../src/view/headless';

describe('createActiveNoteTracker', () => {
  it('supersedes older publications after a listener clears the held notes', () => {
    const tracker = createActiveNoteTracker();
    const observed: number[][] = [];
    tracker.subscribe((state) => { if (state.activeMidis.length) tracker.clear(); });
    tracker.subscribe((state) => { observed.push([...state.activeMidis]); });
    expect(tracker.noteOn(60).activeMidis).toEqual([]);
    expect(observed).toEqual([[]]);
  });

  it('honors an unsubscribe performed by an earlier listener', () => {
    const tracker = createActiveNoteTracker();
    const later = vi.fn();
    tracker.subscribe(() => off());
    const off = tracker.subscribe(later);
    tracker.noteOn(60);
    expect(later).not.toHaveBeenCalled();
  });

  it('publishes sorted, immutable held-note state', () => {
    const tracker = createActiveNoteTracker();
    const listener = vi.fn();
    tracker.subscribe(listener);
    tracker.noteOn(67);
    tracker.noteOn(60);
    expect(tracker.state.activeMidis).toEqual([60, 67]);
    tracker.noteOff(60);
    expect(tracker.state.activeMidis).toEqual([67]);
    tracker.clear();
    expect(tracker.state.activeMidis).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(4);
    expect(Object.isFrozen(tracker.state.activeMidis)).toBe(true);
  });

  it('rejects values outside the MIDI range', () => {
    const tracker = createActiveNoteTracker();
    expect(() => tracker.noteOn(128)).toThrow(RangeError);
    expect(() => tracker.noteOff(1.5)).toThrow(RangeError);
  });

  it('refcounts overlapping holders of the same pitch', () => {
    const tracker = createActiveNoteTracker();
    tracker.noteOn(60);
    tracker.noteOn(60);
    tracker.noteOff(60);
    expect(tracker.state.activeMidis).toEqual([60]);
    tracker.noteOff(60);
    expect(tracker.state.activeMidis).toEqual([]);
  });
});
