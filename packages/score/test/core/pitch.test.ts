import {describe, expect, it} from 'vitest';
import {Pitch} from '../../src/core';

describe('Pitch', () => {
  it('C4 has MIDI 60', () => {
    expect(Pitch.parse('C4').midi).toBe(60);
  });

  it('parses sharps and flats', () => {
    expect(Pitch.parse('F#5').midi).toBe(78);
    expect(Pitch.parse('Bb3').midi).toBe(58);
    expect(Pitch.parse('C##4').midi).toBe(62);
  });

  it('fromMidi gives sharp spelling and is enharmonically consistent', () => {
    const p = Pitch.fromMidi(66);
    expect(p.midi).toBe(66);
    expect(Pitch.parse('F#4').enharmonicEq(Pitch.parse('Gb4'))).toBe(true);
    expect(Pitch.parse('F#4').eq(Pitch.parse('Gb4'))).toBe(false);
  });

  it('transposes by semitones', () => {
    expect(Pitch.parse('C4').transpose(7).midi).toBe(67);
  });

  it('produces A4=440Hz', () => {
    expect(Pitch.parse('A4').toFrequency()).toBeCloseTo(440);
  });
});
