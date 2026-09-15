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
import {findSequenceNote, scoreToNoteSequence, secondsToQuarters} from '../../src/view/core/note-sequence';
import {createWaterfallLayout} from '../../src/view/core/layout';
import type {ScoreSequenceNote} from '../../src/view/core/types';

function buildScore(): Score {
  const builder = new ScoreBuilder();
  const partId = PartId('piano');
  const voice = VoiceId('piano-v1');
  const timeSignature = {numerator: 4, denominator: 4};

  builder
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  builder.addPart({id: partId, name: 'Piano', staves: 1});
  builder.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature,
  });

  for (const [pitch, onset] of [
    ['C4', 0],
    ['E4', 1],
    ['G4', 2],
  ] as const) {
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(pitch),
      onsetQuarters: new Rational(onset),
      duration: Duration.quarter(),
      voice,
    });
  }

  return builder.build();
}

describe('scoreToNoteSequence', () => {
  it('projects tempo beat units into quarter-note rates through tempo changes', () => {
    const builder = new ScoreBuilder();
    const part = builder.newPartId();
    builder.addPart({id: part, name: 'Beat units'});
    builder.addTempo({atQuarters: Rational.ZERO, bpm: 60, unit: 2});
    builder.addTempo({atQuarters: new Rational(4), bpm: 80, unit: 0.5});
    for (const at of [0, 2, 4, 6]) builder.addNote(part, {
      id: builder.newNoteId(), pitch: Pitch.parse('C4'), onsetQuarters: new Rational(at),
      duration: Duration.quarter(), voice: VoiceId('v'),
    });
    const score = builder.build();
    const sequence = scoreToNoteSequence(score);
    expect(sequence.tempos).toEqual([{time: 0, qpm: 120}, {time: 2, qpm: 40}]);
    for (const [index, note] of sequence.notes.entries()) {
      expect(secondsToQuarters(sequence.tempos, note.startTime)).toBeCloseTo(index * 2);
      expect(secondsToQuarters(sequence.tempos, note.endTime)).toBeCloseTo(index * 2 + 1);
    }
  });

  it('converts notes with pitch, seconds and totalTime at 120 bpm', () => {
    const sequence = scoreToNoteSequence(buildScore());
    expect(sequence.notes).toHaveLength(3);
    // 120 bpm → a quarter note is 0.5 s.
    expect(sequence.notes[0]).toMatchObject({pitch: 60, startTime: 0, endTime: 0.5});
    expect(sequence.notes[1]).toMatchObject({pitch: 64, startTime: 0.5, endTime: 1});
    expect(sequence.notes[2]).toMatchObject({pitch: 67, startTime: 1, endTime: 1.5});
    // Score duration spans the full 4/4 measure: 4 quarters at 120 bpm = 2 s.
    expect(sequence.totalTime).toBeCloseTo(2, 6);
    expect(sequence.tempos[0]).toMatchObject({time: 0, qpm: 120});
    expect(sequence.partInfos).toEqual([{part: 0, name: 'Piano'}]);
  });

  it('produces an empty sequence (totalTime 0) for an empty score', () => {
    const builder = new ScoreBuilder();
    builder.addPart({id: PartId('p'), name: 'Empty', staves: 1});
    const sequence = scoreToNoteSequence(builder.build());
    expect(sequence.notes).toEqual([]);
    expect(sequence.totalTime).toBe(0);
  });

  it('findSequenceNote matches pitch and onset within tolerance', () => {
    const sequence = scoreToNoteSequence(buildScore());
    expect(findSequenceNote(sequence, 64, 0.5)).toBe(sequence.notes[1]);
    expect(findSequenceNote(sequence, 64, 0.5 + 1e-8)).toBe(sequence.notes[1]);
    expect(findSequenceNote(sequence, 64, 0.6)).toBeUndefined();
    expect(findSequenceNote(sequence, 61, 0.5)).toBeUndefined();
  });

  it('findSequenceNote matches a linear scan across chords and repeated onsets', () => {
    // Stacked onsets are what the windowed lookup has to get right: the match
    // may sit anywhere inside the run of notes sharing a start time.
    const builder = new ScoreBuilder();
    const partId = PartId('piano');
    const voice = VoiceId('v1');
    const timeSignature = {numerator: 4, denominator: 4};
    builder
      .addTempo({atQuarters: Rational.ZERO, bpm: 120})
      .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
    builder.addPart({id: partId, name: 'Piano', staves: 1});
    builder.addMeasure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      timeSignature,
    });
    for (let beat = 0; beat < 4; beat += 1) {
      for (const semitone of [0, 4, 7]) {
        builder.addNote(partId, {
          id: builder.newNoteId(),
          pitch: Pitch.fromMidi(60 + beat + semitone),
          onsetQuarters: new Rational(beat),
          duration: Duration.quarter(),
          voice,
        });
      }
    }
    const sequence = scoreToNoteSequence(builder.build());
    const linear = (pitch: number, startTime: number) =>
      sequence.notes.find(
        (note) => note.pitch === pitch && Math.abs(note.startTime - startTime) < 0.000001,
      );

    for (const note of sequence.notes) {
      expect(findSequenceNote(sequence, note.pitch, note.startTime)).toBe(note);
    }
    // Misses and near-misses agree with the scan they replaced, on both sides
    // of the tolerance window.
    for (const startTime of [-1, 0, 0.5 - 1e-8, 0.5, 0.5 + 1e-8, 1.25, 99]) {
      for (const pitch of [59, 60, 64, 67, 120]) {
        expect(findSequenceNote(sequence, pitch, startTime)).toBe(linear(pitch, startTime));
      }
    }
  });

  it('skips rest notes (no pitch) from MusicXML scores', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('piano');
    const voice = VoiceId('piano-v1');
    const timeSignature = {numerator: 4, denominator: 4};

    builder
      .addTempo({atQuarters: Rational.ZERO, bpm: 120})
      .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
    builder.addPart({id: partId, name: 'Piano', staves: 2});
    builder.addMeasure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      timeSignature,
    });
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice,
      staff: 1,
    });
    builder.addNote(partId, {
      id: builder.newNoteId(),
      rest: true,
      onsetQuarters: Rational.ONE,
      duration: Duration.quarter(),
      voice,
      staff: 1,
    });
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('E4'),
      onsetQuarters: new Rational(2),
      duration: Duration.quarter(),
      voice,
      staff: 1,
    });

    const sequence = scoreToNoteSequence(builder.build());
    expect(sequence.notes).toHaveLength(2);
    expect(sequence.notes[0]).toMatchObject({pitch: 60, staff: 1});
    expect(sequence.notes[1]).toMatchObject({pitch: 64, staff: 1});
  });

  it('extends the sequence and waterfall height through a performed note tail', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('piano');
    const voice = VoiceId('piano-v1');
    builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
    builder.addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}});
    builder.addPart({id: partId, name: 'Piano'});
    builder.addMeasure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
    });
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C4'),
      onsetQuarters: new Rational(3),
      duration: Duration.quarter(),
      performed: {onsetSec: 2, durationSec: 1, velocity: 100},
      voice,
    });
    const score = builder.build();

    expect(score.durationSeconds).toBe(2);
    expect(scoreToNoteSequence(score).totalTime).toBe(3);
    expect(createWaterfallLayout(score, {pixelsPerSecond: 30})[0].y).toBe(1);
  });
});

describe('secondsToQuarters (tempo-map aware)', () => {
  it('uses the same clamped origin with an implicit or explicit default tempo', () => {
    expect(secondsToQuarters([], -1)).toBe(0);
    expect(secondsToQuarters([{time: 0, qpm: 120}], -1)).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects non-finite nominal time (%s)', (seconds) => {
    expect(() => secondsToQuarters([], seconds)).toThrow(RangeError);
    expect(() => secondsToQuarters([{time: 0, qpm: 120}], seconds)).toThrow(RangeError);
  });

  it.each([
    {time: -1, qpm: 120}, {time: Number.NaN, qpm: 120}, {time: Number.POSITIVE_INFINITY, qpm: 120},
    {time: 0, qpm: 0}, {time: 0, qpm: -60}, {time: 0, qpm: Number.NaN}, {time: 0, qpm: Number.POSITIVE_INFINITY},
  ])('rejects a malformed tempo marker (%j)', (tempo) => {
    expect(() => secondsToQuarters([tempo], 1)).toThrow(RangeError);
  });

  it('uses a 120 qpm fallback with no tempos', () => {
    expect(secondsToQuarters([], 1)).toBe(2);
  });

  it('converts with a single tempo', () => {
    expect(secondsToQuarters([{time: 0, qpm: 60}], 3)).toBe(3);
    expect(secondsToQuarters([{time: 0, qpm: 120}], 3)).toBe(6);
  });

  it('accumulates piecewise across a tempo change', () => {
    const tempos = [
      {time: 0, qpm: 60},
      {time: 2, qpm: 120},
    ];
    // 2 s at 60 qpm = 2 quarters, then 1 s at 120 qpm = 2 quarters.
    expect(secondsToQuarters(tempos, 3)).toBe(4);
    // Exactly at the change point: only the first segment.
    expect(secondsToQuarters(tempos, 2)).toBe(2);
    // Before the change point: first tempo only.
    expect(secondsToQuarters(tempos, 1)).toBe(1);
  });

  it('handles unsorted tempo maps and times before the first marker', () => {
    const tempos = [
      {time: 2, qpm: 120},
      {time: 0, qpm: 60},
    ];
    expect(secondsToQuarters(tempos, 3)).toBe(4);
    // Before the first marker, the first marker's tempo applies.
    expect(secondsToQuarters([{time: 1, qpm: 60}], 0.5)).toBe(0.5);
  });
});

describe('secondsToQuarters sorted-tempos cache', () => {
  it('returns identical results on repeated calls with the same unsorted array', () => {
    const tempos = [
      {time: 2, qpm: 120},
      {time: 0, qpm: 60},
    ];
    const first = secondsToQuarters(tempos, 3);
    // Second call hits the per-array cache; result must not change.
    expect(secondsToQuarters(tempos, 3)).toBe(first);
    expect(first).toBe(4);
    // The input array itself is never reordered.
    expect(tempos[0]).toMatchObject({time: 2, qpm: 120});
    expect(tempos[1]).toMatchObject({time: 0, qpm: 60});
  });

  it('does not copy already-sorted arrays but still computes correctly', () => {
    const tempos = [
      {time: 0, qpm: 60},
      {time: 2, qpm: 120},
    ];
    expect(secondsToQuarters(tempos, 3)).toBe(4);
    expect(secondsToQuarters(tempos, 2)).toBe(2);
    expect(secondsToQuarters(tempos, 1)).toBe(1);
  });

  it('caches per array identity, not per contents', () => {
    const a = [{time: 0, qpm: 60}];
    const b = [{time: 0, qpm: 120}];
    expect(secondsToQuarters(a, 3)).toBe(3);
    expect(secondsToQuarters(b, 3)).toBe(6);
    expect(secondsToQuarters(a, 3)).toBe(3);
  });

  it('does not reuse a stale order after caller-owned tempo input mutates', () => {
    const tempos = [
      {time: 2, qpm: 120},
      {time: 0, qpm: 60},
    ];
    expect(secondsToQuarters(tempos, 3)).toBe(4);

    tempos[0] = {time: 0, qpm: 120};
    tempos[1] = {time: 2, qpm: 60};
    expect(secondsToQuarters(tempos, 3)).toBe(5);
  });
});

describe('scoreToNoteSequence memoization', () => {
  it('returns the same sequence object for the same Score', () => {
    const score = buildScore();
    const first = scoreToNoteSequence(score);
    const second = scoreToNoteSequence(score);
    expect(second).toBe(first);
  });

  it('is keyed per Score: distinct scores get distinct sequences', () => {
    const scoreA = buildScore();
    const scoreB = buildScore();
    const seqA = scoreToNoteSequence(scoreA);
    const seqB = scoreToNoteSequence(scoreB);
    expect(seqA).not.toBe(seqB);
    // Equal geometry, while source note IDs retain each score's identity.
    expect(seqB.notes.map((note) => ({...note, noteId: undefined})))
      .toEqual(seqA.notes.map((note) => ({...note, noteId: undefined})));
    expect(seqB.notes.map((note) => note.noteId)).not.toEqual(seqA.notes.map((note) => note.noteId));
    expect(seqB.totalTime).toBe(seqA.totalTime);
  });

  it('deep-freezes the shared projection so one consumer cannot poison another', () => {
    const score = buildScore();
    const first = scoreToNoteSequence(score);
    const originalNote = {...first.notes[0]};
    const originalTempo = {...first.tempos[0]};

    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.notes)).toBe(true);
    expect(Object.isFrozen(first.notes[0])).toBe(true);
    expect(Object.isFrozen(first.tempos)).toBe(true);
    expect(Object.isFrozen(first.tempos[0])).toBe(true);

    expect(() => (first.notes as ScoreSequenceNote[]).splice(0, 1)).toThrow(TypeError);
    expect(() => {
      (first.notes[0] as {startTime: number}).startTime = 99;
    }).toThrow(TypeError);
    expect(() => {
      (first.tempos[0] as {qpm: number}).qpm = 1;
    }).toThrow(TypeError);

    const second = scoreToNoteSequence(score);
    expect(second.notes[0]).toEqual(originalNote);
    expect(second.tempos[0]).toEqual(originalTempo);
  });
});
