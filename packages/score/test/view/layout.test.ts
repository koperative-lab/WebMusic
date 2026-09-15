import {describe, expect, it} from 'vitest';
import {
  Duration,
  MeasureId,
  PartId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
  type Score,
} from '../../src/core';
import {createPianoRollLayout, createStaffLayout, createWaterfallLayout} from '../../src/view/core/layout';

function buildScore(pitches: string[], bpm = 120): Score {
  const builder = new ScoreBuilder();
  const partId = PartId('piano');
  const voice = VoiceId('piano-v1');
  const timeSignature = {numerator: 4, denominator: 4};

  builder
    .addTempo({atQuarters: Rational.ZERO, bpm})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  builder.addPart({id: partId, name: 'Piano', staves: 1});
  builder.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature,
  });

  pitches.forEach((pitch, index) => {
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(pitch),
      onsetQuarters: new Rational(index),
      duration: Duration.quarter(),
      voice,
    });
  });

  return builder.build();
}

function emptyScore(): Score {
  const builder = new ScoreBuilder();
  builder.addPart({id: PartId('p'), name: 'Empty', staves: 1});
  return builder.build();
}

describe('createStaffLayout diatonic step math', () => {
  it('places C#4 on the same line as C4 (accidental sits on the natural line)', () => {
    const [cNatural] = createStaffLayout(buildScore(['C4']));
    const [cSharp] = createStaffLayout(buildScore(['C#4']));
    expect(cSharp.staffY).toBe(cNatural.staffY);
  });

  it('places Db4 on the same line as D4, not C4', () => {
    const [dFlat] = createStaffLayout(buildScore(['Db4']));
    const [dNatural] = createStaffLayout(buildScore(['D4']));
    const [cNatural] = createStaffLayout(buildScore(['C4']));
    expect(dFlat.staffY).toBe(dNatural.staffY);
    expect(dFlat.staffY).not.toBe(cNatural.staffY);
  });

  it('steps one half staff-space per letter and 7 steps per octave', () => {
    const staffSpace = 10;
    const score = buildScore(['C4', 'D4', 'B4', 'C5', 'C3']);
    const glyphs = createStaffLayout(score, {staffSpace});
    const yOf = (index: number) => glyphs[index].staffY;
    // D4 is one diatonic step above C4.
    expect(yOf(0) - yOf(1)).toBe(staffSpace / 2);
    // B4 is six steps above C4, C5 seven steps.
    expect(yOf(0) - yOf(2)).toBe(6 * (staffSpace / 2));
    expect(yOf(0) - yOf(3)).toBe(7 * (staffSpace / 2));
    // C3 is seven steps below C4.
    expect(yOf(4) - yOf(0)).toBe(7 * (staffSpace / 2));
  });

  it('counts ledger lines from diatonic distance', () => {
    const [a5] = createStaffLayout(buildScore(['C7']));
    expect(a5.ledgerLines).toBeGreaterThan(0);
    const [g4] = createStaffLayout(buildScore(['G4']));
    expect(g4.ledgerLines).toBe(0);
  });
});

describe('empty-score guards', () => {
  it('places all MIDI pitches on distinct keyboard columns, preserving the A0 origin', () => {
    const builder = new ScoreBuilder();
    const part = builder.newPartId();
    builder.addPart({id: part, name: 'MIDI range'});
    for (let midi = 0; midi <= 127; midi += 1) builder.addNote(part, {
      id: builder.newNoteId(), pitch: Pitch.fromMidi(midi), onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(), voice: VoiceId('v'),
    });
    const layout = createWaterfallLayout(builder.build(), {laneHeight: 18});
    expect(new Set(layout.map((note) => note.x)).size).toBe(128);
    expect(layout[0].x).toBe(-216);
    expect(layout[21].x).toBe(0);
    expect(layout[22].x).toBe(12);
    expect(layout[22].width).toBe(12);
    expect(layout[60].x).toBe(414);
    expect(layout[108].x).toBe(918);
    expect(layout[127].x).toBe(1116);
    expect(layout.every((note, index) => index === 0 || note.x > layout[index - 1].x)).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid used layout scales (%s)', (value) => {
    const score = buildScore(['C4']);
    for (const layout of [createPianoRollLayout, createWaterfallLayout, createStaffLayout]) {
      expect(() => layout(score, {pixelsPerSecond: value})).toThrow(RangeError);
      expect(() => layout(emptyScore(), {pixelsPerSecond: value})).toThrow(RangeError);
    }
    expect(() => createPianoRollLayout(score, {laneHeight: value})).toThrow(RangeError);
    expect(() => createWaterfallLayout(score, {laneHeight: value})).toThrow(RangeError);
    expect(() => createStaffLayout(score, {staffSpace: value})).toThrow(RangeError);
  });

  it('lays out scores larger than the JavaScript function argument limit', () => {
    const builder = new ScoreBuilder();
    const part = builder.newPartId();
    builder.addPart({id: part, name: 'Large score'});
    const duration = Duration.quarter();
    const pitches = Array.from({length: 128}, (_, midi) => Pitch.fromMidi(midi));
    for (let index = 0; index < 150_000; index += 1) builder.addNote(part, {
      id: builder.newNoteId(), pitch: pitches[index % pitches.length],
      onsetQuarters: new Rational(index), duration, voice: VoiceId('large'),
    });
    const layout = createPianoRollLayout(builder.build());
    expect(layout).toHaveLength(150_000);
    expect(layout.every((note) => Number.isFinite(note.x) && Number.isFinite(note.y))).toBe(true);
    expect(layout[149_999].startSeconds).toBe(149_999 / 2);
  });

  it('createPianoRollLayout returns an empty layout without NaN', () => {
    expect(createPianoRollLayout(emptyScore())).toEqual([]);
  });

  it('createStaffLayout and createWaterfallLayout return empty arrays', () => {
    expect(createStaffLayout(emptyScore())).toEqual([]);
    expect(createWaterfallLayout(emptyScore())).toEqual([]);
  });

  it('createPianoRollLayout produces finite coordinates for non-empty scores', () => {
    const layout = createPianoRollLayout(buildScore(['C4', 'E4']));
    expect(layout).toHaveLength(2);
    for (const note of layout) {
      expect(Number.isFinite(note.x)).toBe(true);
      expect(Number.isFinite(note.y)).toBe(true);
      expect(Number.isFinite(note.width)).toBe(true);
      expect(Number.isFinite(note.height)).toBe(true);
    }
  });

  it('skips explicit rests in every layout projection', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('p');
    const voice = VoiceId('v');
    builder.addPart({id: partId, name: 'Test'});
    builder.addNote(partId, {
      id: builder.newNoteId(),
      rest: true,
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice,
    });
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ONE,
      duration: Duration.quarter(),
      voice,
    });
    const score = builder.build();

    expect(createPianoRollLayout(score)).toHaveLength(1);
    expect(createStaffLayout(score)).toHaveLength(1);
    expect(createWaterfallLayout(score)).toHaveLength(1);
  });
});
