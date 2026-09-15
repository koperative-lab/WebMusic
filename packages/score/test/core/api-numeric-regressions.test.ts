import {describe, expect, it} from 'vitest';
import {Pitch, Rational, ScoreBuilder, pitchToMidi, quartersToTicks, ticksToQuarters, secondsToTick, tickToSeconds} from '../../src/core';

function exactFraction(num: bigint, den: bigint): string {
  if (den < 0n) { num = -num; den = -den; }
  let a = num < 0n ? -num : num;
  let b = den;
  while (b !== 0n) [a, b] = [b, a % b];
  num /= a;
  den /= a;
  return den === 1n ? String(num) : `${num}/${den}`;
}

describe('public Rational exact arithmetic', () => {
  it('does not silently round cancellation of individually unsafe cross products', () => {
    const a = new Rational(9_007_199_254_740_991, 3);
    const b = new Rational(6_004_799_503_160_661, 2);
    expect(String(a.sub(b))).toBe('-1/6');
    expect(String(a.add(b.neg()))).toBe('-1/6');
  });

  it('reduces representable results even when intermediate products exceed safe integers', () => {
    const large = new Rational(Number.MAX_SAFE_INTEGER, 2);
    expect(large.div(large).eq(Rational.ONE)).toBe(true);
    expect(large.mul(new Rational(2, Number.MAX_SAFE_INTEGER)).eq(Rational.ONE)).toBe(true);
    expect(new Rational(1, 1_000_000_000).add(new Rational(1, 1_000_000_000)).toString()).toBe('1/500000000');
    expect(large.cmp(new Rational(Number.MAX_SAFE_INTEGER - 2, 3))).toBe(1);
    expect(() => large.mul(new Rational(3))).toThrow(RangeError);
  });

  it('matches exact integer arithmetic across signed fractions and cancellation near the safe limit', () => {
    for (let index = 0; index < 500; index += 1) {
      const a = new Rational(Number.MAX_SAFE_INTEGER - index * 17, 3);
      const b = new Rational(Number.MAX_SAFE_INTEGER - index * 13, 3);
      const expected = exactFraction(BigInt(a.num) * BigInt(b.den) - BigInt(b.num) * BigInt(a.den), BigInt(a.den) * BigInt(b.den));
      expect(a.sub(b).toString()).toBe(expected);
      expect(a.neg().add(b).toString()).toBe(exactFraction(-BigInt(a.num) * BigInt(b.den) + BigInt(b.num) * BigInt(a.den), BigInt(a.den) * BigInt(b.den)));
    }
  });
});

describe('public compatibility resolution', () => {
  it('rejects invalid tick resolutions consistently across projections', () => {
    const score = new ScoreBuilder().build();
    for (const ppq of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => quartersToTicks(Rational.ONE, ppq)).toThrow(RangeError);
      expect(() => ticksToQuarters(1, ppq)).toThrow(RangeError);
      expect(() => secondsToTick(score, 1, ppq)).toThrow(RangeError);
    }
    expect(() => quartersToTicks(new Rational(Number.MAX_SAFE_INTEGER), 2)).toThrow(RangeError);
  });
  it.each([96, 480, 960, 1920])('round-trips tick positions at the requested %s PPQ through a tempo change', (ppq) => {
    const builder = new ScoreBuilder();
    builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
    builder.addTempo({atQuarters: Rational.ONE, bpm: 90, unit: 1.5});
    const score = builder.build();
    for (const tick of [0, 1, 2, ppq - 1, ppq, ppq + 1, ppq * 3 + 1]) {
      const quarters = tick / ppq;
      const expected = quarters <= 1 ? quarters / 2 : 0.5 + (quarters - 1) * 60 / 135;
      expect(tickToSeconds(score, tick, ppq)).toBeCloseTo(expected, 12);
      expect(secondsToTick(score, expected, ppq)).toBe(tick);
    }
  });
});

describe('public Pitch values', () => {
  it('validates plain pitch input with the same rules as immutable Pitch values', () => {
    expect(pitchToMidi({step: 'B', alter: -1, octave: 3})).toBe(58);
    expect(() => pitchToMidi({step: 'toString', octave: 4})).toThrow(RangeError);
    expect(() => pitchToMidi({step: 'C', octave: NaN})).toThrow(RangeError);
    expect(() => pitchToMidi({step: 'C', alter: 0.5, octave: 4})).toThrow(RangeError);
  });
  it('maps all 128 MIDI notes, octave transposition and enharmonic spellings consistently', () => {
    for (let midi = 0; midi < 128; midi += 1) {
      const pitch = Pitch.fromMidi(midi);
      expect(pitch.midi).toBe(midi);
      expect(Pitch.parse(pitch.toString()).eq(pitch)).toBe(true);
      expect(pitch.transpose(12).toFrequency() / pitch.toFrequency()).toBeCloseTo(2, 12);
    }
    expect(Pitch.parse('B#3').midi).toBe(60);
    expect(Pitch.parse('Cb4').midi).toBe(59);
    expect(Pitch.fromMidi(-1).toString()).toBe('B-2');
  });

  it('rejects invalid numeric pitches and tuning rather than constructing NaN data', () => {
    expect(() => new Pitch('C', 0, NaN)).toThrow(RangeError);
    expect(() => new Pitch('C', 0, 4.5)).toThrow(RangeError);
    expect(() => Pitch.parse('C99999999999999999999999')).toThrow(RangeError);
    expect(() => Pitch.fromMidi(60.5)).toThrow(RangeError);
    expect(() => Pitch.fromMidi(Infinity)).toThrow(RangeError);
    expect(() => Pitch.parse('A4').toFrequency(0)).toThrow(RangeError);
    expect(() => Pitch.parse('A4').toFrequency(NaN)).toThrow(RangeError);
  });

  it('cannot mutate the shared semitone table and change existing pitch values', () => {
    const c4 = Pitch.parse('C4');
    const previous = Pitch.STEP_TO_SEMITONE.C;
    try {
      Reflect.set(Pitch.STEP_TO_SEMITONE, 'C', 1);
      expect(c4.midi).toBe(60);
    } finally {
      Reflect.set(Pitch.STEP_TO_SEMITONE, 'C', previous);
    }
  });
});
