import {describe, expect, it} from 'vitest';
import {
  DEFAULT_BUFFER_SCREENS,
  DEFAULT_VIRTUALIZATION_THRESHOLD,
  MAX_CANVAS_DIMENSION,
  activeNoteCandidateRange,
  bufferedScrollRange,
  clampCanvasBackingSize,
  isSortedByStartTime,
  lowerBoundByStartTime,
  maxNoteDuration,
  resolveVirtualization,
  upperBoundByStartTime,
  visibleNoteRange,
} from '../../src/view/core/windowing';

/** n notes on a 0.125s grid, each 0.125s long. */
function makeNotes(count: number, duration = 0.125, step = 0.125) {
  return Array.from({length: count}, (_, index) => ({
    startTime: index * step,
    endTime: index * step + duration,
  }));
}

describe('binary search bounds', () => {
  const notes = makeNotes(8); // starts at 0, 0.125, ..., 0.875

  it('lowerBound returns first index with startTime >= t', () => {
    expect(lowerBoundByStartTime(notes, -1)).toBe(0);
    expect(lowerBoundByStartTime(notes, 0)).toBe(0);
    expect(lowerBoundByStartTime(notes, 0.125)).toBe(1);
    expect(lowerBoundByStartTime(notes, 0.13)).toBe(2);
    expect(lowerBoundByStartTime(notes, 10)).toBe(8);
  });

  it('upperBound returns first index with startTime > t', () => {
    expect(upperBoundByStartTime(notes, -1)).toBe(0);
    expect(upperBoundByStartTime(notes, 0)).toBe(1);
    expect(upperBoundByStartTime(notes, 0.875)).toBe(8);
    expect(upperBoundByStartTime(notes, 10)).toBe(8);
  });

  it('handles duplicate start times (chords)', () => {
    const chord = [
      {startTime: 0, endTime: 1},
      {startTime: 1, endTime: 2},
      {startTime: 1, endTime: 2},
      {startTime: 1, endTime: 2},
      {startTime: 2, endTime: 3},
    ];
    expect(lowerBoundByStartTime(chord, 1)).toBe(1);
    expect(upperBoundByStartTime(chord, 1)).toBe(4);
  });

  it('handles empty arrays', () => {
    expect(lowerBoundByStartTime([], 0)).toBe(0);
    expect(upperBoundByStartTime([], 0)).toBe(0);
  });
});

describe('isSortedByStartTime / maxNoteDuration', () => {
  it('detects sorted and unsorted sequences', () => {
    expect(isSortedByStartTime([])).toBe(true);
    expect(isSortedByStartTime(makeNotes(5))).toBe(true);
    expect(
      isSortedByStartTime([
        {startTime: 1, endTime: 2},
        {startTime: 0, endTime: 1},
      ]),
    ).toBe(false);
  });

  it('finds the longest duration (0 when empty)', () => {
    expect(maxNoteDuration([])).toBe(0);
    const notes = [...makeNotes(5), {startTime: 0.1, endTime: 4.1}];
    expect(maxNoteDuration(notes)).toBeCloseTo(4);
  });
});

describe('visibleNoteRange', () => {
  it('returns the empty range for an empty score', () => {
    expect(visibleNoteRange([], 0, 10, 0)).toEqual({start: 0, end: 0});
  });

  it('returns all notes when the window covers the whole score', () => {
    const notes = makeNotes(100);
    expect(visibleNoteRange(notes, 0, 100, 0.125)).toEqual({start: 0, end: 100});
  });

  it('returns an interior slice for a mid-score window', () => {
    const notes = makeNotes(1000); // 125 s total
    const range = visibleNoteRange(notes, 10, 20, 0.125);
    // Notes starting in [10 - 0.125, 20] → indices ~79..160.
    expect(range.start).toBeLessThanOrEqual(80);
    expect(range.start).toBeGreaterThanOrEqual(78);
    expect(range.end).toBe(161);
    // Slice contains every truly intersecting note.
    for (let i = 0; i < notes.length; i += 1) {
      const intersects = notes[i].startTime < 20 && notes[i].endTime > 10;
      if (intersects) {
        expect(i).toBeGreaterThanOrEqual(range.start);
        expect(i).toBeLessThan(range.end);
      }
    }
  });

  it('is empty when the window is entirely past the end of the score', () => {
    const notes = makeNotes(10); // ends at 1.25 s
    const range = visibleNoteRange(notes, 100, 110, 0.125);
    expect(range.start).toBe(range.end);
  });

  it('is empty when the window is entirely before the score', () => {
    const notes = makeNotes(10, 0.125, 0.125).map((n) => ({
      startTime: n.startTime + 100,
      endTime: n.endTime + 100,
    }));
    const range = visibleNoteRange(notes, 0, 10, 0.125);
    expect(range.start).toBe(range.end);
  });

  it('widens the lower bound by maxDuration to catch long held notes', () => {
    const notes = [
      {startTime: 0, endTime: 30}, // pedal note reaching into the window
      {startTime: 1, endTime: 1.5},
      {startTime: 20, endTime: 21},
      {startTime: 25, endTime: 26},
    ];
    const range = visibleNoteRange(notes, 19, 27, 30);
    expect(range.start).toBe(0); // the long note is included
    expect(range.end).toBe(4);
    // Without the slack the long note would be missed:
    const naive = visibleNoteRange(notes, 19, 27, 0);
    expect(naive.start).toBe(2);
  });

  it('returns the empty range for an inverted window', () => {
    expect(visibleNoteRange(makeNotes(10), 5, 1, 0)).toEqual({start: 0, end: 0});
  });
});

describe('activeNoteCandidateRange', () => {
  it('covers the played note, its chord, and held longer notes', () => {
    const notes = [
      {startTime: 0, endTime: 100}, // held pedal
      {startTime: 4, endTime: 5},
      {startTime: 5, endTime: 5.5}, // chord with active
      {startTime: 5, endTime: 6}, // the active note
      {startTime: 5, endTime: 7},
      {startTime: 6.5, endTime: 7},
    ];
    const active = notes[3];
    const range = activeNoteCandidateRange(notes, active, 100);
    // All notes that the isPaintingActiveNote predicate can match are inside.
    const predicate = (n: {startTime: number; endTime: number}) =>
      n.startTime <= active.startTime && active.startTime < n.endTime;
    notes.forEach((note, index) => {
      if (predicate(note)) {
        expect(index).toBeGreaterThanOrEqual(range.start);
        expect(index).toBeLessThan(range.end);
      }
    });
    // The later note is excluded.
    expect(range.end).toBe(5);
  });

  it('handles empty sequences', () => {
    expect(activeNoteCandidateRange([], {startTime: 0, endTime: 1}, 0)).toEqual({start: 0, end: 0});
  });

  it('retains notes overlapping the onset even when they end before the nominated note', () => {
    const notes = [{startTime: 0, endTime: 2}, {startTime: 1, endTime: 3}];
    expect(activeNoteCandidateRange(notes, notes[1], 2)).toEqual({start: 0, end: 2});
  });

  it('is a tiny slice for dense sequences', () => {
    const notes = makeNotes(50_000);
    const active = notes[25_000];
    const range = activeNoteCandidateRange(notes, active, 0.125);
    expect(range.end - range.start).toBeLessThan(10);
    expect(range.start).toBeLessThanOrEqual(25_000);
    expect(range.end).toBeGreaterThan(25_000);
  });
});

describe('bufferedScrollRange', () => {
  it('widens the visible stripe by bufferScreens on each side', () => {
    expect(bufferedScrollRange(1000, 500, 1)).toEqual({lo: 500, hi: 2000});
    expect(bufferedScrollRange(1000, 500, 0)).toEqual({lo: 1000, hi: 1500});
    expect(bufferedScrollRange(1000, 500, 2.5)).toEqual({lo: -250, hi: 2750});
  });

  it('treats negative buffers as zero', () => {
    expect(bufferedScrollRange(100, 50, -3)).toEqual({lo: 100, hi: 150});
  });
});

describe('clampCanvasBackingSize', () => {
  it('multiplies CSS size by dpr in the normal case', () => {
    expect(clampCanvasBackingSize(800, 600, 2)).toEqual({width: 1600, height: 1200, scaleX: 2, scaleY: 2});
  });

  it('caps each dimension to the browser-safe maximum', () => {
    // 20-minute piece at 30 px/s = 36 000 css px; 2x dpr would be 72 000.
    const size = clampCanvasBackingSize(36_000, 400, 2);
    expect(size.width).toBe(MAX_CANVAS_DIMENSION);
    expect(size.height).toBe(800);
    expect(size.scaleX).toBeCloseTo(MAX_CANVAS_DIMENSION / 36_000);
    expect(size.scaleY).toBe(2);
  });

  it('never returns a zero or negative size', () => {
    const size = clampCanvasBackingSize(0, -5, 0);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
    expect(size.scaleX).toBeGreaterThan(0);
    expect(size.scaleY).toBeGreaterThan(0);
  });

  it('handles non-finite dpr', () => {
    const size = clampCanvasBackingSize(100, 100, Number.NaN);
    expect(size.width).toBe(100);
    expect(size.scaleX).toBe(1);
  });
});

describe('resolveVirtualization', () => {
  it('defaults ON above the note-count threshold, OFF below', () => {
    expect(resolveVirtualization(undefined, DEFAULT_VIRTUALIZATION_THRESHOLD).enabled).toBe(false);
    expect(resolveVirtualization(undefined, DEFAULT_VIRTUALIZATION_THRESHOLD + 1).enabled).toBe(true);
    expect(resolveVirtualization(undefined, 50_000)).toEqual({
      enabled: true,
      bufferScreens: DEFAULT_BUFFER_SCREENS,
    });
  });

  it('honors explicit booleans regardless of note count', () => {
    expect(resolveVirtualization(true, 3).enabled).toBe(true);
    expect(resolveVirtualization(false, 1_000_000).enabled).toBe(false);
  });

  it('treats an options object as enabled with a custom buffer', () => {
    expect(resolveVirtualization({bufferScreens: 2}, 10)).toEqual({enabled: true, bufferScreens: 2});
    expect(resolveVirtualization({}, 10)).toEqual({enabled: true, bufferScreens: DEFAULT_BUFFER_SCREENS});
    // Invalid buffers fall back to the default.
    expect(resolveVirtualization({bufferScreens: -1}, 10).bufferScreens).toBe(DEFAULT_BUFFER_SCREENS);
  });
});
