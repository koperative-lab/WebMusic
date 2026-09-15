import {describe, expect, it} from 'vitest';
import {pianoKeys} from '../../src/play/core/piano-keys';
import {formatTime} from '../../src/play/element/internal/transport-format';

describe('formatTime', () => {
  it('formats seconds as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(125.9)).toBe('2:05');
    expect(formatTime(-3)).toBe('0:00');
  });
});

describe('pianoKeys', () => {
  it('spans the inclusive range in pitch order', () => {
    const keys = pianoKeys(60, 72); // C4..C5
    expect(keys[0].midi).toBe(60);
    expect(keys[keys.length - 1].midi).toBe(72);
    expect(keys.length).toBe(13);
  });

  it('marks the five black keys of an octave', () => {
    const blacks = pianoKeys(60, 71).filter((k) => k.isBlack).map((k) => k.midi);
    // C#4 D#4 F#4 G#4 A#4
    expect(blacks).toEqual([61, 63, 66, 68, 70]);
  });

  it('normalizes a reversed range', () => {
    expect(pianoKeys(72, 60).map((k) => k.midi)).toEqual(pianoKeys(60, 72).map((k) => k.midi));
  });
});
