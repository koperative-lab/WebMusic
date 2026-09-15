import {describe, expect, it} from 'vitest';
import {Rational, TimeMap} from '../../src/core';

describe('TimeMap', () => {
  const tm = new TimeMap(
    [{atQuarters: Rational.ZERO, bpm: 120}],
    [{atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}}],
  );

  it('converts quarters to seconds at constant tempo', () => {
    expect(tm.quartersToSeconds(new Rational(2))).toBeCloseTo(1);
    expect(tm.quartersToSeconds(new Rational(4))).toBeCloseTo(2);
  });

  it('seconds → quarters is an inverse (within 1/480)', () => {
    const q = new Rational(3, 2);
    const back = tm.secondsToQuarters(tm.quartersToSeconds(q));
    expect(back.sub(q).toFloat()).toBeCloseTo(0, 3);
  });

  it('keeps only the final declaration at a shared musical position', () => {
    const canonical = new TimeMap(
      [
        {atQuarters: Rational.ZERO, bpm: 120},
        {atQuarters: Rational.ZERO, bpm: 90},
        {atQuarters: new Rational(4), bpm: 60},
      ],
      [
        {atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}},
        {atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 3, denominator: 4}},
      ],
    );

    expect(canonical.tempi.map((entry) => [entry.atQuarters.toString(), entry.bpm])).toEqual([
      ['0', 90],
      ['4', 60],
    ]);
    expect(canonical.meters).toEqual([
      expect.objectContaining({timeSignature: {numerator: 3, denominator: 4}}),
    ]);
  });

  it('quartersToMBS in 4/4', () => {
    expect(tm.quartersToMBS(Rational.ZERO)).toMatchObject({measure: 1, beat: 1});
    expect(tm.quartersToMBS(new Rational(2))).toMatchObject({measure: 1, beat: 3});
    expect(tm.quartersToMBS(new Rational(4))).toMatchObject({measure: 2, beat: 1});
    expect(tm.quartersToMBS(new Rational(5))).toMatchObject({measure: 2, beat: 2});
  });

  it('mbsToQuarters round-trips through MBS', () => {
    const target = new Rational(5);
    const mbs = tm.quartersToMBS(target);
    expect(tm.mbsToQuarters(mbs).eq(target)).toBe(true);
  });

  it('handles tempo changes mid-piece', () => {
    const tm2 = new TimeMap(
      [
        {atQuarters: Rational.ZERO, bpm: 120},
        {atQuarters: new Rational(4), bpm: 60},
      ],
      [{atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}}],
    );
    // 4 quarters at 120 = 2s; then 4 quarters at 60 = 4s → 6s total
    expect(tm2.quartersToSeconds(new Rational(8))).toBeCloseTo(6);
    expect(tm2.secondsToQuarters(6).toFloat()).toBeCloseTo(8, 2);
  });

  it('rejects missing zero-position entries', () => {
    expect(
      () =>
        new TimeMap(
          [{atQuarters: new Rational(1), bpm: 120}],
          [{atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}}],
        ),
    ).toThrow();
  });

  it('rejects non-positive or non-finite tempo and invalid meter values', () => {
    const meter = [{atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}}];
    for (const bpm of [0, -1, Infinity, Number.NaN]) {
      expect(() => new TimeMap([{atQuarters: Rational.ZERO, bpm}], meter)).toThrow(RangeError);
    }
    expect(() => new TimeMap([{atQuarters: Rational.ZERO, bpm: 120, unit: 0}], meter)).toThrow(RangeError);
    expect(() =>
      new TimeMap(
        [{atQuarters: Rational.ZERO, bpm: 120}],
        [{atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 0, denominator: 4}}],
      ),
    ).toThrow(RangeError);
    expect(() =>
      new TimeMap(
        [{atQuarters: Rational.ZERO, bpm: 120}],
        [{atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 0}}],
      ),
    ).toThrow(RangeError);
  });
});

describe('TimeMap multi-meter MBS', () => {
  // 2 measures of 3/4 (measures 1-2, q 0..6), then 4/4 from q=6 (measure 3+).
  const tm = new TimeMap(
    [{atQuarters: Rational.ZERO, bpm: 120}],
    [
      {atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 3, denominator: 4}},
      {atQuarters: new Rational(6), measureNumber: 3, timeSignature: {numerator: 4, denominator: 4}},
    ],
  );

  it('quartersToMBS across the meter change', () => {
    expect(tm.quartersToMBS(Rational.ZERO)).toMatchObject({measure: 1, beat: 1});
    expect(tm.quartersToMBS(new Rational(3))).toMatchObject({measure: 2, beat: 1});
    expect(tm.quartersToMBS(new Rational(5))).toMatchObject({measure: 2, beat: 3});
    expect(tm.quartersToMBS(new Rational(6))).toMatchObject({measure: 3, beat: 1});
    expect(tm.quartersToMBS(new Rational(11))).toMatchObject({measure: 4, beat: 2});
  });

  it('mbsToQuarters across the meter change', () => {
    expect(tm.mbsToQuarters({measure: 2, beat: 1, subbeat: Rational.ZERO}).eq(new Rational(3))).toBe(true);
    expect(tm.mbsToQuarters({measure: 3, beat: 1, subbeat: Rational.ZERO}).eq(new Rational(6))).toBe(true);
    expect(tm.mbsToQuarters({measure: 4, beat: 2, subbeat: Rational.ZERO}).eq(new Rational(11))).toBe(true);
  });

  it('mbsToQuarters never returns negative quarters (former bug)', () => {
    const q = tm.mbsToQuarters({measure: 0, beat: 1, subbeat: Rational.ZERO});
    expect(q.gte(Rational.ZERO)).toBe(true);
    expect(q.eq(Rational.ZERO)).toBe(true); // clamps to score start
    expect(
      tm.mbsToQuarters({measure: -5, beat: 1, subbeat: Rational.ZERO}).gte(Rational.ZERO),
    ).toBe(true);
    expect(tm.mbsToQuarters({measure: 1, beat: -3, subbeat: new Rational(-1, 2)}).eq(Rational.ZERO)).toBe(true);
    expect(() => tm.mbsToQuarters({measure: 1.5, beat: 1, subbeat: Rational.ZERO})).toThrow(/MBS measure/i);
  });

  it('mbsToQuarters round-trips quartersToMBS at meter boundaries', () => {
    for (const q of [0, 2, 3, 5, 6, 9, 10]) {
      const target = new Rational(q);
      expect(tm.mbsToQuarters(tm.quartersToMBS(target)).eq(target)).toBe(true);
    }
  });
});

describe('TimeMap meter-only synthetic partial measures', () => {
  // MIDI has no authored measure list. The q=6 change lands halfway through
  // nominal 4/4 measure 2, but the input label still says "measure 2".
  const tm = new TimeMap(
    [{atQuarters: Rational.ZERO, bpm: 120}],
    [
      {atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}},
      {atQuarters: new Rational(6), measureNumber: 2, timeSignature: {numerator: 3, denominator: 4}},
    ],
  );

  it('consumes a label for a mid-bar meter change and round-trips both sides', () => {
    expect(tm.meters[1].measureNumber).toBe(3); // partial measure 2 is canonicalised
    expect(tm.quartersToMBS(new Rational(4))).toMatchObject({measure: 2, beat: 1});
    expect(tm.quartersToMBS(new Rational(5))).toMatchObject({measure: 2, beat: 2});
    expect(tm.quartersToMBS(new Rational(6))).toMatchObject({measure: 3, beat: 1});
    expect(tm.mbsToQuarters({measure: 2, beat: 1, subbeat: Rational.ZERO}).eq(new Rational(4))).toBe(true);
    expect(tm.mbsToQuarters({measure: 3, beat: 1, subbeat: Rational.ZERO}).eq(new Rational(6))).toBe(true);

    for (const q of [0, 4, 5, 6, 7, 9]) {
      const target = new Rational(q);
      expect(tm.mbsToQuarters(tm.quartersToMBS(target)).eq(target)).toBe(true);
    }
  });
});

describe('TimeMap with real measure list (pickup / anacrusis)', () => {
  // 1-quarter pickup (measure 0), then full 4/4 measures.
  const measures = [
    {number: 0, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(1)},
    {number: 1, onsetQuarters: new Rational(1), durationQuarters: new Rational(4)},
    {number: 2, onsetQuarters: new Rational(5), durationQuarters: new Rational(4)},
  ];
  const tm = new TimeMap(
    [{atQuarters: Rational.ZERO, bpm: 120}],
    [{atQuarters: Rational.ZERO, measureNumber: 0, timeSignature: {numerator: 4, denominator: 4}}],
    measures,
  );

  it('quartersToMBS reports the right measure for pickup scores', () => {
    expect(tm.quartersToMBS(Rational.ZERO)).toMatchObject({measure: 0, beat: 1});
    expect(tm.quartersToMBS(new Rational(1))).toMatchObject({measure: 1, beat: 1});
    expect(tm.quartersToMBS(new Rational(4))).toMatchObject({measure: 1, beat: 4});
    expect(tm.quartersToMBS(new Rational(5))).toMatchObject({measure: 2, beat: 1});
  });

  it('mbsToQuarters uses real measure onsets', () => {
    expect(tm.mbsToQuarters({measure: 0, beat: 1, subbeat: Rational.ZERO}).eq(Rational.ZERO)).toBe(true);
    expect(tm.mbsToQuarters({measure: 1, beat: 1, subbeat: Rational.ZERO}).eq(new Rational(1))).toBe(true);
    expect(tm.mbsToQuarters({measure: 2, beat: 3, subbeat: Rational.ZERO}).eq(new Rational(7))).toBe(true);
  });

  it('clamps below the first measure instead of going negative', () => {
    const q = tm.mbsToQuarters({measure: -1, beat: 1, subbeat: Rational.ZERO});
    expect(q.gte(Rational.ZERO)).toBe(true);
  });

  it('uses the meter at the final barline when extrapolating beyond real measures', () => {
    const finalMeter = new TimeMap(
      [{atQuarters: Rational.ZERO, bpm: 120}],
      [
        {atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}},
        // This change begins immediately after the final supplied measure.
        {atQuarters: new Rational(8), measureNumber: 3, timeSignature: {numerator: 3, denominator: 4}},
      ],
      [
        {number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(4)},
        {number: 2, onsetQuarters: new Rational(4), durationQuarters: new Rational(4)},
      ],
    );

    const q = new Rational(11); // measure 4, beat 1 under the 3/4 tail.
    expect(finalMeter.quartersToMBS(q)).toMatchObject({measure: 4, beat: 1});
    expect(finalMeter.mbsToQuarters({measure: 4, beat: 1, subbeat: Rational.ZERO}).eq(q)).toBe(true);
  });

  it('keeps mid-measure meter events while MBS uses the authored measure-start meter', () => {
    const midMeasureMeter = new TimeMap(
      [{atQuarters: Rational.ZERO, bpm: 120}],
      [
        {atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}},
        {atQuarters: new Rational(2), measureNumber: 1, timeSignature: {numerator: 6, denominator: 8}},
      ],
      [{number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(4)}],
    );
    const target = new Rational(3);
    expect(midMeasureMeter.timeSignatureAt(target)).toEqual({numerator: 6, denominator: 8});
    expect(midMeasureMeter.quartersToMBS(target)).toMatchObject({measure: 1, beat: 4});
    expect(midMeasureMeter.mbsToQuarters(midMeasureMeter.quartersToMBS(target)).eq(target)).toBe(true);
  });

  it('uses piecewise synthetic meter segments after the final authored measure', () => {
    const tailMeterChange = new TimeMap(
      [{atQuarters: Rational.ZERO, bpm: 120}],
      [
        {atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}},
        {atQuarters: new Rational(12), measureNumber: 4, timeSignature: {numerator: 3, denominator: 4}},
      ],
      [
        {number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(4)},
        {number: 2, onsetQuarters: new Rational(4), durationQuarters: new Rational(4)},
      ],
    );
    expect(tailMeterChange.quartersToMBS(new Rational(16))).toMatchObject({measure: 5, beat: 2});
    for (const q of [8, 11, 12, 14, 15, 16]) {
      const target = new Rational(q);
      expect(tailMeterChange.mbsToQuarters(tailMeterChange.quartersToMBS(target)).eq(target)).toBe(true);
    }
  });
});

describe('TimeMap lookup helpers', () => {
  const tm = new TimeMap(
    [
      {atQuarters: Rational.ZERO, bpm: 120},
      {atQuarters: new Rational(4), bpm: 60},
      {atQuarters: new Rational(8), bpm: 90},
    ],
    [
      {atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}},
      {atQuarters: new Rational(8), measureNumber: 3, timeSignature: {numerator: 3, denominator: 4}},
    ],
  );

  it('tempoAt picks the prevailing segment (binary search path)', () => {
    expect(tm.tempoAt(Rational.ZERO).bpm).toBe(120);
    expect(tm.tempoAt(new Rational(3)).bpm).toBe(120);
    expect(tm.tempoAt(new Rational(4)).bpm).toBe(60);
    expect(tm.tempoAt(new Rational(7, 1)).bpm).toBe(60);
    expect(tm.tempoAt(new Rational(100)).bpm).toBe(90);
  });

  it('timeSignatureAt picks the prevailing meter', () => {
    expect(tm.timeSignatureAt(new Rational(7))).toEqual({numerator: 4, denominator: 4});
    expect(tm.timeSignatureAt(new Rational(8))).toEqual({numerator: 3, denominator: 4});
  });

  it('quartersToSeconds/secondsToQuarters agree across segments', () => {
    // 4q at 120 = 2s, 4q at 60 = 4s, then 90 bpm.
    expect(tm.quartersToSeconds(new Rational(4))).toBeCloseTo(2);
    expect(tm.quartersToSeconds(new Rational(8))).toBeCloseTo(6);
    expect(tm.quartersToSeconds(new Rational(11))).toBeCloseTo(8);
    expect(tm.secondsToQuarters(6).toFloat()).toBeCloseTo(8, 2);
    expect(tm.secondsToQuarters(8).toFloat()).toBeCloseTo(11, 2);
  });
});

describe('TimeMap immutability', () => {
  it('snapshots nested entries and measure refs before caching projections', () => {
    const tempo = {atQuarters: Rational.ZERO, bpm: 120};
    const meter = {
      atQuarters: Rational.ZERO,
      measureNumber: 1,
      timeSignature: {numerator: 4, denominator: 4},
    };
    const measure = {
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
    };
    const tm = new TimeMap([tempo], [meter], [measure]);

    // These are caller-owned input objects, so they remain mutable. None of
    // their changes may invalidate TimeMap's cached float projections.
    tempo.bpm = 30;
    meter.timeSignature.numerator = 3;
    measure.number = 99;
    measure.onsetQuarters = new Rational(10);
    measure.durationQuarters = new Rational(1);

    expect(tm.quartersToSeconds(new Rational(2))).toBeCloseTo(1);
    expect(tm.timeSignatureAt(Rational.ZERO)).toEqual({numerator: 4, denominator: 4});
    expect(tm.quartersToMBS(new Rational(1))).toMatchObject({measure: 1, beat: 2});
    expect(Object.isFrozen(tm.tempi[0])).toBe(true);
    expect(Object.isFrozen(tm.meters[0].timeSignature)).toBe(true);
    expect(Object.isFrozen(tm.measures![0])).toBe(true);
  });
});
