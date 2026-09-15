import {describe, expect, it} from 'vitest';
import {keyFromHistogram} from '../../src/analyze/core/key';
import {
  fifthsStepOf,
  keyPitchClasses,
  keyRelatedness,
  keyWheel,
  type KeyWheel,
  type KeyWheelSegment,
} from '../../src/analyze/core/key-wheel';
import {keySignatureFifths} from '../../src/analyze/core/staff-placement';
import type {Key, KeyResult} from '../../src/analyze/core/types';

/** The three spellings, so no test can quietly cover only the default. */
const SPELLINGS = ['auto', 'sharp', 'flat'] as const;

/**
 * Scale-degree weights shaped like a real piece: tonic heaviest, then the
 * dominant, then the third. Rotated to a tonic this is what the detector sees
 * when a piece is unambiguously in one key.
 */
const MAJOR_SHAPE = [8, 0, 3, 0, 5, 4, 0, 6, 0, 3, 0, 2];
const MINOR_SHAPE = [8, 0, 3, 5, 0, 4, 0, 6, 3, 0, 2, 0];

function histogramFrom(shape: readonly number[], tonic: number): {histogram: number[]; total: number} {
  const histogram = Array.from({length: 12}, (_value, index) => shape[(index - tonic + 12) % 12]);
  return {histogram, total: histogram.reduce((sum, value) => sum + value, 0)};
}

/** A `KeyResult` the detector itself produced, so the test never hand-builds scores it did not earn. */
function detected(tonic: number, mode: Key['mode']): KeyResult {
  const {histogram, total} = histogramFrom(mode === 'minor' ? MINOR_SHAPE : MAJOR_SHAPE, tonic);
  const result = keyFromHistogram(histogram, total);
  // If this ever fails the fixture drifted, not the wheel.
  expect(`${result.tonic} ${result.mode}`).toBe(`${['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][tonic]} ${mode}`);
  return result;
}

/** The silent score's result: `keyFromHistogram`'s documented "nothing to detect" shape. */
function silence(): KeyResult {
  return keyFromHistogram(Array.from({length: 12}, () => 0), 0);
}

function segments(wheel: KeyWheel): readonly KeyWheelSegment[] {
  return [...wheel.outer, ...wheel.inner];
}

function activeSegment(wheel: KeyWheel): KeyWheelSegment {
  const found = segments(wheel).filter((segment) => segment.active);
  expect(found).toHaveLength(1);
  return found[0];
}

describe('keyWheel rings', () => {
  it('draws twelve major segments clockwise in fifths from C', () => {
    const wheel = keyWheel(detected(0, 'major'));

    expect(wheel.outer).toHaveLength(12);
    expect(wheel.outer.map((segment) => segment.tonic)).toEqual([
      'C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F',
    ]);
    expect(wheel.outer.map((segment) => segment.pitchClass)).toEqual([0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]);
    expect(wheel.outer.every((segment) => segment.mode === 'major')).toBe(true);
  });

  it('puts each major key relative minor directly beneath it', () => {
    const wheel = keyWheel(detected(0, 'major'));

    expect(wheel.inner).toHaveLength(12);
    expect(wheel.inner.map((segment) => segment.tonic)).toEqual([
      'A', 'E', 'B', 'F#', 'C#', 'G#', 'Eb', 'Bb', 'F', 'C', 'G', 'D',
    ]);
    wheel.inner.forEach((minor, index) => {
      const major = wheel.outer[index];
      const where = `${minor.tonic} minor under ${major.tonic} major`;
      // The relative pair is defined by the SIGNATURE, and nine semitones is
      // only how that comes out in sound.
      expect(minor.fifths, where).toBe(major.fifths);
      expect(minor.pitchClass, where).toBe((major.pitchClass + 9) % 12);
    });
  });

  it('gives every segment the signature its own tonic signs, in every spelling', () => {
    for (const spelling of SPELLINGS) {
      for (const segment of segments(keyWheel(detected(0, 'major'), {spelling}))) {
        const where = `${segment.name} (${spelling})`;
        expect(keySignatureFifths(segment), where).toBe(segment.fifths);
        expect(Math.abs(segment.fifths), where).toBeLessThanOrEqual(7);
      }
    }
  });

  it('prints majors in capitals and minors in lower case, with real accidental glyphs', () => {
    const wheel = keyWheel(detected(0, 'major'));

    expect(wheel.outer.map((segment) => segment.label)).toEqual([
      'C', 'G', 'D', 'A', 'E', 'B', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F',
    ]);
    expect(wheel.inner.map((segment) => segment.label)).toEqual([
      'a', 'e', 'b', 'f♯', 'c♯', 'g♯', 'e♭', 'b♭', 'f', 'c', 'g', 'd',
    ]);
    expect(wheel.outer[6].name).toBe('G♭ major');
    expect(wheel.inner[6].name).toBe('E♭ minor');
    // The ASCII tonic is what round-trips; only the label is decorated.
    expect(wheel.outer[6].tonic).toBe('Gb');
  });

  it('gives every segment of one wheel a distinct id', () => {
    for (const spelling of SPELLINGS) {
      const ids = segments(keyWheel(detected(0, 'major'), {spelling})).map((segment) => segment.id);
      expect(new Set(ids).size, spelling).toBe(24);
      expect(ids).toContain('c-major');
      expect(ids).toContain('a-minor');
    }
  });
});

describe('keyWheel spelling', () => {
  it('makes F-sharp major and G-flat major two segments, each signing its own key', () => {
    const result = detected(6, 'major');
    const sharp = activeSegment(keyWheel(result, {spelling: 'sharp'}));
    const flat = activeSegment(keyWheel(result, {spelling: 'flat'}));

    expect(sharp.tonic).toBe('F#');
    expect(flat.tonic).toBe('Gb');
    expect(sharp.id).not.toBe(flat.id);
    expect(sharp.label).toBe('F♯');
    expect(flat.label).toBe('G♭');
    // One sound, two keys: same chroma, opposite signatures.
    expect(sharp.pitchClass).toBe(flat.pitchClass);
    expect(sharp.fifths).toBe(6);
    expect(flat.fifths).toBe(-6);
    expect(keySignatureFifths(sharp)).toBe(6);
    expect(keySignatureFifths(flat)).toBe(-6);
  });

  it('re-spells the ring instead of repeating KeyResult.tonic', () => {
    // `detectKey` can only ever say `F#` for this chroma — `NOTE_NAMES` holds
    // no flat spelling of it — so a flat wheel that agreed with the result
    // would be one that never re-spelled anything.
    const result = detected(6, 'major');
    expect(result.tonic).toBe('F#');

    const flat = keyWheel(result, {spelling: 'flat'});
    expect(flat.outer.map((segment) => segment.tonic)).toContain('Gb');
    expect(flat.outer.map((segment) => segment.tonic)).not.toContain(result.tonic);
    expect(activeSegment(flat).tonic).toBe('Gb');
  });

  it('moves only the three positions that have two writable signatures', () => {
    const sharp = keyWheel(detected(0, 'major'), {spelling: 'sharp'});
    const flat = keyWheel(detected(0, 'major'), {spelling: 'flat'});

    const moved = sharp.outer
      .map((segment, index) => (segment.tonic === flat.outer[index].tonic ? -1 : index))
      .filter((index) => index >= 0);
    expect(moved).toEqual([5, 6, 7]);
    // Forcing sharps cannot conjure G# major: eight sharps have no signature.
    expect(sharp.outer[8].tonic).toBe('Ab');
    expect(flat.outer[4].tonic).toBe('E');
  });

  it('defaults to the fewer accidentals, and gives the six-and-six tie to G-flat', () => {
    const auto = keyWheel(detected(0, 'major')).outer;

    expect(auto[5].tonic).toBe('B'); // 5 sharps beats C-flat major 7 flats
    expect(auto[7].tonic).toBe('Db'); // 5 flats beats C-sharp major 7 sharps
    expect(auto[6].tonic).toBe('Gb'); // the tie, spelled the way a printed circle spells it
  });
});

describe('keyWheel weights', () => {
  it('normalises across both rings at once, so a relative minor cannot tie its major', () => {
    const wheel = keyWheel(detected(0, 'major'));
    const all = segments(wheel);

    expect(activeSegment(wheel).id).toBe('c-major');
    expect(wheel.outer[0].weight).toBe(1);
    expect(all.filter((segment) => segment.weight === 1)).toHaveLength(1);
    expect(Math.min(...all.map((segment) => segment.weight))).toBe(0);

    const relativeMinor = wheel.inner[0];
    expect(relativeMinor.tonic).toBe('A');
    expect(relativeMinor.weight).toBeGreaterThan(0);
    expect(relativeMinor.weight).toBeLessThan(1);
  });

  it('spreads the ring instead of collapsing it when one key dominates', () => {
    const all = segments(keyWheel(detected(0, 'major')));
    const distinct = new Set(all.map((segment) => Math.round(segment.weight * 1000)));

    // 24 keys, 24 different fits: a ring where everything is 1 (or 0) paints
    // no information at all.
    expect(distinct.size).toBeGreaterThan(12);
    expect(all.filter((segment) => segment.weight > 0.5).length).toBeLessThan(all.length / 2);
  });

  it('takes the better of two spellings of one key, not the last one it read', () => {
    // `keyFromHistogram` names tonics out of a fixed table, so it can never
    // emit two spellings of one pitch class — but `scores` is a public field
    // and a caller assembling it by hand can. The pitch class is worth its
    // BEST reading; the other entry is the same key spelled worse.
    const doubled: KeyResult = {
      tonic: 'C#',
      mode: 'major',
      confidence: 0.8,
      scores: [
        {tonic: 'C#', mode: 'major', score: 0.9},
        {tonic: 'Db', mode: 'major', score: 0.1},
        {tonic: 'G', mode: 'major', score: 0.2},
      ],
    };
    const wheel = keyWheel(doubled, {spelling: 'flat'});
    const position = wheel.outer.find((segment) => segment.pitchClass === 1);

    expect(position?.tonic).toBe('Db');
    expect(position?.weight).toBe(1);
  });

  it('weighs a candidate the caller left out as zero', () => {
    const partial: KeyResult = {
      tonic: 'C',
      mode: 'major',
      confidence: 1,
      scores: [
        {tonic: 'C', mode: 'major', score: 0.9},
        {tonic: 'A', mode: 'minor', score: 0.2},
      ],
    };
    const wheel = keyWheel(partial);

    expect(wheel.outer[0].weight).toBe(1);
    expect(wheel.inner[0].weight).toBe(0);
    expect(wheel.outer[1].weight).toBe(0);
    expect(segments(wheel).every((segment) => Number.isFinite(segment.weight))).toBe(true);
  });

  it('answers a flat tie with zeros rather than with a wheel of ones', () => {
    const tied: KeyResult = {
      tonic: 'C',
      mode: 'major',
      confidence: 0,
      scores: ['C', 'D', 'E', 'F', 'G', 'A', 'B'].flatMap((tonic) => [
        {tonic, mode: 'major' as const, score: 0.5},
        {tonic, mode: 'minor' as const, score: 0.5},
      ]),
    };
    const wheel = keyWheel(tied);

    for (const segment of segments(wheel)) {
      expect(segment.weight, segment.name).toBe(0);
    }
    // And the centre agrees with the ring it sits in. A dial where nothing
    // outweighs anything has detected nothing; naming C major over it would
    // make the centre the only part of the wheel claiming something.
    expect(wheel.centre).toEqual({primary: '—'});
    expect(segments(wheel).some((segment) => segment.active)).toBe(false);
  });

  it('reads a chromatic cluster as no key at all, ring and centre together', () => {
    // Twelve pitch classes at equal weight — a tone row, a cluster, a
    // percussion part read as pitches. Every correlation is the same, which is
    // the flat tie arriving from the detector rather than from a caller.
    const chromatic = keyFromHistogram(Array.from({length: 12}, () => 1), 12);

    expect(chromatic.scores).toHaveLength(24);
    expect(keyWheel(chromatic).centre).toEqual({primary: '—'});
    expect(segments(keyWheel(chromatic)).every((segment) => segment.weight === 0)).toBe(true);
  });

  it('reads a scores list trimmed to one candidate as that candidate', () => {
    // One entry is not a tie: it is a caller who kept only the winner, and the
    // one key on the ring is the whole ranking. A wheel that weighed it 0
    // would light a segment it also said was worthless.
    const trimmed: KeyResult = {
      tonic: 'C',
      mode: 'major',
      confidence: 1,
      scores: [{tonic: 'C', mode: 'major', score: 0.9}],
    };
    const wheel = keyWheel(trimmed);

    expect(wheel.outer[0].weight).toBe(1);
    expect(activeSegment(wheel).id).toBe('c-major');
    expect(wheel.centre.primary).toBe('C major');
  });
});

describe('keyWheel on silence', () => {
  it('still draws twelve empty segments and lights none of them', () => {
    const wheel = keyWheel(silence());

    expect(wheel.outer).toHaveLength(12);
    expect(wheel.inner).toHaveLength(12);
    for (const segment of segments(wheel)) {
      expect(segment.weight, segment.name).toBe(0);
      expect(segment.active, segment.name).toBe(false);
    }
  });

  it('says the key is unknown instead of naming the placeholder tonic', () => {
    const result = silence();
    // `keyFromHistogram` returns C major as a placeholder; reading it as a
    // detection would be inventing a key out of silence.
    expect(result.tonic).toBe('C');
    expect(keyWheel(result).centre).toEqual({primary: '—'});
  });

  it('lights nothing up for a tonic it cannot read', () => {
    const junk = {tonic: 'H', mode: 'major', confidence: 0.4, scores: [{tonic: 'H', mode: 'major', score: 1}]};
    const wheel = keyWheel(junk as unknown as KeyResult);

    expect(segments(wheel).some((segment) => segment.active)).toBe(false);
    expect(wheel.centre.primary).toBe('—');
    expect(wheel.centre.secondary).toBeUndefined();
  });
});

describe('keyWheel centre', () => {
  it('names the active key and prints the detector confidence', () => {
    const result = detected(3, 'minor');
    const wheel = keyWheel(result);

    expect(activeSegment(wheel).name).toBe('E♭ minor');
    expect(wheel.centre.primary).toBe('E♭ minor');
    expect(wheel.centre.secondary).toBe(`${Math.round(result.confidence * 100)}%`);
    expect(wheel.centre.secondary).toMatch(/^\d{1,3}%$/);
  });

  it('hands out the key it PRINTED, so a stave cannot be signed against the dial', () => {
    // The detector can only say `F#` for this chroma; the auto wheel spells it
    // `G♭`. A caller signing a stave from `KeyResult.tonic` would draw six
    // sharps under a centre reading `G♭ major` — six accidentals of daylight
    // between two surfaces reading one key. `centre.key` is the reconciliation.
    const result = detected(6, 'major');
    const wheel = keyWheel(result);

    expect(result.tonic).toBe('F#');
    expect(wheel.centre.primary).toBe('G♭ major');
    expect(wheel.centre.key).toEqual({tonic: 'Gb', mode: 'major'});
    expect(keySignatureFifths(wheel.centre.key as Key)).toBe(-6);
    expect(keySignatureFifths(result)).toBe(6);

    // It is the ACTIVE segment's own key, so forcing the other spelling moves it.
    expect(keyWheel(result, {spelling: 'sharp'}).centre.key).toEqual({tonic: 'F#', mode: 'major'});
    // Relative minors come off the inner ring the same way.
    expect(keyWheel(detected(3, 'minor')).centre.key).toEqual({tonic: 'Eb', mode: 'minor'});
    // Nothing detected, nothing to sign.
    expect(keyWheel(silence()).centre.key).toBeUndefined();
  });
});

describe('keyWheel arithmetic', () => {
  it('keeps every number finite over inputs a caller can actually produce', () => {
    const spread: readonly KeyResult[] = [
      silence(),
      detected(0, 'major'),
      detected(6, 'major'),
      detected(9, 'minor'),
      keyFromHistogram(Array.from({length: 12}, () => 1), 12),
      {tonic: 'C', mode: 'major', confidence: Number.NaN, scores: [{tonic: 'C', mode: 'major', score: 1}]},
      {
        tonic: 'G',
        mode: 'major',
        confidence: 0.5,
        scores: [
          {tonic: 'G', mode: 'major', score: Number.NaN},
          {tonic: 'D', mode: 'major', score: Number.POSITIVE_INFINITY},
          {tonic: 'C', mode: 'major', score: 0.4},
        ],
      },
      {tonic: 'C', mode: 'major', confidence: 5, scores: []},
    ];

    for (const result of spread) {
      for (const spelling of SPELLINGS) {
        const wheel = keyWheel(result, {spelling});
        for (const segment of segments(wheel)) {
          const where = `${segment.name} (${result.tonic} ${result.mode}, ${spelling})`;
          expect(Number.isFinite(segment.weight), where).toBe(true);
          expect(segment.weight, where).toBeGreaterThanOrEqual(0);
          expect(segment.weight, where).toBeLessThanOrEqual(1);
          expect(Number.isFinite(segment.pitchClass) && Number.isInteger(segment.pitchClass), where).toBe(true);
          expect(Number.isFinite(segment.fifths) && Number.isInteger(segment.fifths), where).toBe(true);
        }
        if (wheel.centre.secondary !== undefined) {
          expect(wheel.centre.secondary, `${result.tonic} ${spelling}`).toMatch(/^\d{1,3}%$/);
        }
      }
    }
  });

  it('hands out frozen rings, so one caller cannot re-weight everyone else', () => {
    const wheel = keyWheel(detected(0, 'major'));

    expect(Object.isFrozen(wheel)).toBe(true);
    expect(Object.isFrozen(wheel.outer)).toBe(true);
    expect(Object.isFrozen(wheel.inner)).toBe(true);
    expect(Object.isFrozen(wheel.outer[0])).toBe(true);
    expect(Object.isFrozen(wheel.centre)).toBe(true);
  });
});

describe('keyPitchClasses', () => {
  it('gives C major the seven white notes, in scale order from the tonic', () => {
    expect(keyPitchClasses({tonic: 'C', mode: 'major'})).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('gives a minor key its NATURAL seventh, because that is what the signature carries', () => {
    const aMinor = keyPitchClasses({tonic: 'A', mode: 'minor'});

    expect(aMinor).toEqual([9, 11, 0, 2, 4, 5, 7]);
    expect(aMinor).toContain(7); // G natural
    expect(aMinor).not.toContain(8); // the harmonic minor's G# is a sounding event, not a ghost
  });

  it('returns seven distinct classes for all 24 keys', () => {
    for (const tonic of ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'Cb', 'D#']) {
      for (const mode of ['major', 'minor'] as const) {
        const classes = keyPitchClasses({tonic, mode});
        const where = `${tonic} ${mode}`;
        expect(classes, where).toHaveLength(7);
        expect(new Set(classes).size, where).toBe(7);
        expect(classes.every((value) => Number.isInteger(value) && value >= 0 && value < 12), where).toBe(true);
      }
    }
  });

  it('gives a key and its relative the same seven classes', () => {
    const major = [...keyPitchClasses({tonic: 'Eb', mode: 'major'})].sort((a, b) => a - b);
    const minor = [...keyPitchClasses({tonic: 'C', mode: 'minor'})].sort((a, b) => a - b);

    expect(minor).toEqual(major);
  });

  it('starts on the tonic, whatever the spelling of it', () => {
    expect(keyPitchClasses({tonic: 'F#', mode: 'major'})[0]).toBe(6);
    expect(keyPitchClasses({tonic: 'Gb', mode: 'major'})[0]).toBe(6);
    expect(keyPitchClasses({tonic: 'Cb', mode: 'major'})[0]).toBe(11);
  });

  it('reads a mode it does not model as no ghosts at all, like an unreadable tonic', () => {
    // Reading `harmonic minor` as major would ghost C♯, F♯ and G♯ over an A
    // harmonic minor passage: three notes the key does not have. That is the
    // claim this layer refuses to make about the raised seventh, so it refuses
    // it here too — an empty list is a hint withheld, not a wrong hint given.
    expect(keyPitchClasses({tonic: 'A', mode: 'harmonic minor' as Key['mode']})).toEqual([]);
    expect(keyPitchClasses({tonic: 'C', mode: 'dorian' as Key['mode']})).toEqual([]);
    expect(keyPitchClasses({tonic: 'H', mode: 'major'})).toEqual([]);
    expect(keyPitchClasses({tonic: '', mode: 'minor'})).toEqual([]);
    expect(Object.isFrozen(keyPitchClasses({tonic: 'C', mode: 'major'}))).toBe(true);
  });

  it('reads a capitalised mode as the mode, not as its parallel major', () => {
    // The trap this replaces: `'Minor'` failed a `=== 'minor'` test and fell
    // through to the major set, so one capital letter silently swapped A minor
    // for A major — four of its seven notes.
    expect(keyPitchClasses({tonic: 'A', mode: 'Minor' as Key['mode']}))
      .toEqual(keyPitchClasses({tonic: 'A', mode: 'minor'}));
    expect(keyPitchClasses({tonic: 'A', mode: ' MAJOR ' as Key['mode']}))
      .toEqual(keyPitchClasses({tonic: 'A', mode: 'major'}));
  });
});

describe('keyWheel rotation (the ring turns; it does not scroll)', () => {
  it('turns the ring so the reference key stands at twelve o clock', () => {
    // A modulation turns the wheel by a fixed angle rather than sliding a list
    // under a highlight, which is what makes the same modulation look the same
    // wherever in the piece it happens.
    const c = keyWheel(detected(0, 'major'));
    expect(c.outer.map((segment) => segment.tonic))
      .toEqual(['C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F']);
    expect(c.outer.map((segment) => segment.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    // The same twelve keys, turned. Every step is still a fifth from the last.
    const d = keyWheel(detected(2, 'major'));
    expect(d.outer.map((segment) => segment.tonic))
      .toEqual(['D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G']);
    expect(d.outer[0].pitchClass).toBe(2);
    expect(d.outer[10].tonic).toBe('C');
    for (const wheel of [c, d]) {
      wheel.outer.forEach((segment, index) => {
        expect(segment.index).toBe(index);
        expect(wheel.inner[index].index).toBe(index);
      });
    }
  });

  it('turns the ring WITHOUT re-signing a single segment', () => {
    // The one thing rotation must never touch. A segment's `fifths` is the
    // signature of the key at that stop; move it round the dial and E-flat
    // major still signs three flats. If rotation could change a signature the
    // wheel and the stave would part company on the first modulation.
    const c = keyWheel(detected(0, 'major'));
    const eFlat = keyWheel(detected(3, 'major'));
    for (const wheel of [c, eFlat]) {
      for (const segment of segments(wheel)) {
        expect(segment.fifths, segment.id)
          .toBe(keySignatureFifths({tonic: segment.tonic, mode: segment.mode}));
      }
    }
    const cSegment = c.outer.find((segment) => segment.tonic === 'Eb');
    const turnedSegment = eFlat.outer[0];
    expect(turnedSegment.tonic).toBe('Eb');
    expect(turnedSegment.fifths).toBe(cSegment?.fifths);
    expect(turnedSegment.index).not.toBe(cSegment?.index);
  });

  it('reads a minor key through the signature it shares with its relative major', () => {
    // A minor and C major stand at the same stop. Which one is at twelve
    // o'clock is the same question as which RING the needle is on.
    const aMinor = keyWheel(detected(9, 'minor'));
    expect(aMinor.outer.map((segment) => segment.tonic))
      .toEqual(keyWheel(detected(0, 'major')).outer.map((segment) => segment.tonic));
    expect(aMinor.inner[0].tonic).toBe('A');
    expect(aMinor.inner[0].active).toBe(true);
    expect(aMinor.needle).toMatchObject({at: 0, ring: 'inner'});
  });

  it('seats a key past seven accidentals where it belongs, not where a signature stops', () => {
    // A SIGNATURE stops at seven — there are only seven lines to draw one on.
    // A POSITION on the circle does not, and reading the position off the
    // clamp would seat G-sharp major (eight sharps) on D-flat and turn the
    // whole wheel to a key four stops away.
    expect(fifthsStepOf({tonic: 'G#', mode: 'major'})).toBe(8);
    expect(fifthsStepOf({tonic: 'D#', mode: 'major'})).toBe(9);
    expect(fifthsStepOf({tonic: 'A#', mode: 'major'})).toBe(10);
    expect(fifthsStepOf({tonic: 'Fb', mode: 'major'})).toBe(4);
    expect(fifthsStepOf({tonic: 'Cb', mode: 'major'})).toBe(5);
    expect(fifthsStepOf({tonic: 'Ab', mode: 'minor'})).toBe(5);
    expect(fifthsStepOf({tonic: 'Gb', mode: 'major'})).toBe(fifthsStepOf({tonic: 'F#', mode: 'major'}));
    // And a ring turned to one is turned to the stop that key stands in: G#
    // sounds pitch class 8, so the segment at twelve o'clock has to.
    const gSharp = keyWheel(detected(0, 'major'), {reference: {tonic: 'G#', mode: 'major'}});
    expect(gSharp.outer[0].pitchClass).toBe(8);
    expect(keyWheel(detected(0, 'major'), {reference: {tonic: 'D#', mode: 'major'}}).outer[0].pitchClass).toBe(3);
  });

  it('re-weights from a reference a reader chose, WITHOUT moving the needle', () => {
    // Clicking a segment asks "what if it were this one instead". The ring
    // turns and every relatedness is re-measured; the needle stays on what was
    // actually heard, which is the whole point of asking.
    const wheel = keyWheel(detected(0, 'major'), {reference: {tonic: 'G', mode: 'major'}});
    expect(wheel.outer[0].tonic).toBe('G');
    expect(wheel.outer[0].relatedness).toBe(1);
    expect(wheel.centre.primary).toBe('C major');
    // C is now one step anticlockwise of the top: the last segment of twelve.
    expect(wheel.needle?.at).toBe(11);
    expect(wheel.needle?.ring).toBe('outer');
    expect(wheel.outer[11].tonic).toBe('C');
    expect(wheel.outer[11].active).toBe(true);
    expect(wheel.outer[0].active).toBe(false);
    // And the EVIDENCE is untouched by the turn: C is still what was heard.
    expect(wheel.outer[11].weight).toBe(1);
    expect(wheel.outer[11].weight).toBeGreaterThan(wheel.outer[0].weight);
  });

  it('ignores an unreadable reference whole, rather than half-turning to C', () => {
    // A caller's junk turns nothing. The wheel keeps the orientation it would
    // have had, which is the detected key — the same standard `keyPitchClasses`
    // and `weigh` hold their inputs to, and better than silently anchoring at C
    // while still measuring relatedness from the mode of the junk.
    const straight = keyWheel(detected(2, 'major'));
    for (const tonic of ['', 'H', 'nonsense', 'C###']) {
      const wheel = keyWheel(detected(2, 'major'), {reference: {tonic, mode: 'major'}});
      expect(wheel.outer, tonic).toHaveLength(12);
      expect(wheel.outer[0].tonic, tonic).toBe('D');
      expect(wheel.outer.map((segment) => segment.relatedness), tonic)
        .toEqual(straight.outer.map((segment) => segment.relatedness));
      // The READING survives it either way: it is the ring that was turned
      // badly, not the music that went missing.
      expect(wheel.centre.primary, tonic).toBe('D major');
      expect(wheel.needle, tonic).toBeDefined();
    }
  });

  it('turns an empty ring without inventing a reading to put on it', () => {
    const turned = keyWheel(silence(), {reference: {tonic: 'Eb', mode: 'major'}});
    expect(turned.outer[0].tonic).toBe('Eb');
    expect(turned.centre.primary).toBe('—');
    expect(turned.needle).toBeUndefined();
    for (const segment of segments(turned)) {
      expect(segment.weight, segment.id).toBe(0);
      expect(segment.relatedness, segment.id).toBe(0);
      expect(segment.active, segment.id).toBe(false);
    }
  });
});

describe('keyWheel relatedness (a claim about harmony, written down once)', () => {
  it('ranks the tonic, then the dominant and subdominant, then the relative minor', () => {
    // This ordering IS the design. The relative minor shares every note of its
    // major and still reads as further away than the dominant, because a
    // modulation to the dominant is one accidental and a turn to the relative
    // minor is a change of centre.
    const wheel = keyWheel(detected(0, 'major'));
    const of = (tonic: string, mode: 'major' | 'minor'): number => {
      const found = segments(wheel).find((segment) => segment.tonic === tonic && segment.mode === mode);
      return found?.relatedness ?? Number.NaN;
    };
    expect(of('C', 'major')).toBe(1);
    expect(of('G', 'major')).toBeLessThan(of('C', 'major'));
    expect(of('G', 'major')).toBe(of('F', 'major'));
    expect(of('A', 'minor')).toBeLessThan(of('G', 'major'));
    expect(of('C', 'minor')).toBeLessThan(of('A', 'minor'));
    expect(of('Gb', 'major')).toBeLessThan(of('C', 'minor'));
    expect(of('Gb', 'major')).toBeGreaterThan(0);

    // Falling off with the distance ROUND the circle, in both directions at
    // once: the sixth stop is the far side whichever way you walk to it.
    const outward = wheel.outer.slice(0, 7).map((segment) => segment.relatedness);
    for (let index = 1; index < outward.length; index += 1) {
      expect(outward[index]).toBeLessThan(outward[index - 1]);
    }
    expect(wheel.outer[1].relatedness).toBe(wheel.outer[11].relatedness);
    expect(wheel.outer[5].relatedness).toBe(wheel.outer[7].relatedness);
  });

  it('is symmetric, and says the same thing from either key', () => {
    const C: Key = {tonic: 'C', mode: 'major'};
    const Am: Key = {tonic: 'A', mode: 'minor'};
    expect(keyRelatedness(C, C)).toBe(1);
    expect(keyRelatedness(Am, Am)).toBe(1);
    expect(keyRelatedness(C, {tonic: 'G', mode: 'major'}))
      .toBe(keyRelatedness({tonic: 'G', mode: 'major'}, C));
    expect(keyRelatedness(C, Am)).toBe(keyRelatedness(Am, C));
    // Two keys that sound alike stand in the same place, so they relate alike.
    expect(keyRelatedness(C, {tonic: 'F#', mode: 'major'}))
      .toBe(keyRelatedness(C, {tonic: 'Gb', mode: 'major'}));
  });

  it('refuses to become a distribution', () => {
    // Every relatedness is in (0, 1] with the reference at exactly 1 and
    // nothing else there. They deliberately do NOT sum to one: twenty-four
    // affinities made into a distribution would invent a claim about how likely
    // each key is, which is `detectKey`'s question and is answered by `weight`.
    for (const result of [detected(0, 'major'), detected(9, 'minor'), detected(3, 'major')]) {
      const all = segments(keyWheel(result));
      expect(all).toHaveLength(24);
      expect(all.filter((segment) => segment.relatedness === 1)).toHaveLength(1);
      for (const segment of all) {
        expect(segment.relatedness, segment.id).toBeGreaterThan(0);
        expect(segment.relatedness, segment.id).toBeLessThanOrEqual(1);
      }
      expect(all.reduce((sum, segment) => sum + segment.relatedness, 0)).toBeGreaterThan(1);
    }
  });

  it('is a DIFFERENT number from the weight, and never stands in for it', () => {
    // The whole reason both fields exist. Relatedness is geometry measured from
    // the reference, so in ring order it is the same twenty-four numbers for
    // every piece ever analysed; weight is evidence and follows the music. A
    // wheel tinted by relatedness alone is a constant pattern that rotates.
    const c = keyWheel(detected(0, 'major'));
    const eFlat = keyWheel(detected(3, 'major'));
    expect(c.outer.map((segment) => segment.relatedness))
      .toEqual(eFlat.outer.map((segment) => segment.relatedness));
    expect(c.outer.map((segment) => segment.weight))
      .not.toEqual(eFlat.outer.map((segment) => segment.weight));
    // And the evidence ranks the detector's own runners-up the detector's way:
    // in C major the relative minor outranks the far side of the circle, which
    // geometry alone gets right only by accident.
    const weightOf = (wheel: KeyWheel, tonic: string, mode: 'major' | 'minor'): number =>
      segments(wheel).find((segment) => segment.tonic === tonic && segment.mode === mode)?.weight ?? Number.NaN;
    expect(weightOf(c, 'A', 'minor')).toBeGreaterThan(weightOf(c, 'Gb', 'major'));
  });
});

describe('keyWheel needle (uncertainty is a width, never a position)', () => {
  it('opens the needle as confidence falls, and points at the same segment throughout', () => {
    // A thin line that happens to be wrong is a lie; a fat one is a doubt.
    const reading = detected(0, 'major');
    const sure = keyWheel({...reading, confidence: 1});
    const middling = keyWheel({...reading, confidence: 0.5});
    const unsure = keyWheel({...reading, confidence: 0});
    expect(sure.needle?.spread).toBe(0);
    expect(middling.needle?.spread).toBeGreaterThan(0);
    expect(unsure.needle?.spread).toBeGreaterThan(middling.needle?.spread ?? 0);
    expect(sure.needle?.at).toBe(unsure.needle?.at);
    // A nonsense confidence draws a hairline rather than a NaN angle.
    expect(keyWheel({...reading, confidence: Number.NaN}).needle?.spread).toBe(0);
    expect(keyWheel({...reading, confidence: -5}).needle?.spread)
      .toBe(keyWheel({...reading, confidence: 0}).needle?.spread);
    expect(keyWheel({...reading, confidence: 42}).needle?.spread).toBe(0);
  });

  it('puts the needle on the segment that is active, or on nothing at all', () => {
    for (const result of [detected(0, 'major'), detected(9, 'minor'), detected(6, 'major'), silence()]) {
      const wheel = keyWheel(result);
      const active = segments(wheel).filter((segment) => segment.active);
      expect(active).toHaveLength(wheel.needle === undefined ? 0 : 1);
      if (wheel.needle === undefined) {
        // Silence gets no needle, rather than a full-width one over C.
        expect(wheel.centre.primary).toBe('—');
        continue;
      }
      expect(wheel.needle.at).toBe(active[0].index);
      expect(wheel.needle.ring).toBe(active[0].mode === 'minor' ? 'inner' : 'outer');
      expect(Number.isFinite(wheel.needle.spread)).toBe(true);
    }
  });
});

describe('keyWheel memoisation', () => {
  it('returns the very same wheel for a repeated reading', () => {
    // The wheel is re-read on every frame and every field of it is frozen, so a
    // presenter that skips work on `previous === next` gets to skip it. Keyed
    // on the READING OBJECT, not on a digest of it: the weights depend on the
    // whole `scores` array and no short string can stand for that.
    const reading = detected(0, 'major');
    const first = keyWheel(reading);
    expect(keyWheel(reading)).toBe(first);
    expect(keyWheel(reading, {spelling: 'auto'})).toBe(first);
    expect(keyWheel(reading, {spelling: 'sharp'})).not.toBe(first);
    expect(keyWheel(reading, {reference: {tonic: 'G', mode: 'major'}})).not.toBe(first);
    expect(keyWheel(reading, {reference: {tonic: 'G', mode: 'major'}}))
      .toBe(keyWheel(reading, {reference: {tonic: 'G', mode: 'major'}}));
    // A different reading is a different wheel even when it reads the same key.
    expect(keyWheel(detected(0, 'major'))).not.toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.outer[0])).toBe(true);
  });
});
