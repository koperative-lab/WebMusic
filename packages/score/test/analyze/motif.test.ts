import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {describe, expect, it} from 'vitest';
import {findMotifs, rhythmPatterns} from '../../src/analyze/core/motif';

type NoteSpec = [pitch: string, onset: number, dur: number];

function scoreFrom(voices: Record<string, NoteSpec[]>) {
  const builder = new ScoreBuilder();
  const partId = builder.newPartId();
  builder.addPart({id: partId, name: 'Test'});
  for (const [voiceName, notes] of Object.entries(voices)) {
    const voice = VoiceId(`${partId}-${voiceName}`);
    for (const [name, onset, dur] of notes) {
      builder.addNote(partId, {
        id: builder.newNoteId(),
        pitch: Pitch.parse(name),
        onsetQuarters: new Rational(Math.round(onset * 4), 4),
        duration: new Duration({base: new Rational(Math.round(dur * 4), 4)}),
        voice,
      });
    }
  }
  return builder.build();
}

describe('findMotifs', () => {
  it('finds a motif repeated within a single voice', () => {
    // C D E G stated twice, non-overlapping.
    const line: NoteSpec[] = [
      ['C4', 0, 1],
      ['D4', 1, 1],
      ['E4', 2, 1],
      ['G4', 3, 1],
      ['C4', 4, 1],
      ['D4', 5, 1],
      ['E4', 6, 1],
      ['G4', 7, 1],
    ];
    const motifs = findMotifs(scoreFrom({v1: line}), {length: 4});
    expect(motifs).toHaveLength(1);
    expect(motifs[0].intervals).toEqual([2, 2, 3]);
    expect(motifs[0].occurrences).toHaveLength(2);
  });

  it('slides windows per voice and never mixes simultaneous voices', () => {
    // Two voices play different lines at the same onsets. Interleaving them
    // would fabricate spurious motifs; per-voice windows must not.
    const score = scoreFrom({
      v1: [
        ['C5', 0, 1],
        ['D5', 1, 1],
        ['E5', 2, 1],
        ['F5', 3, 1],
      ],
      v2: [
        ['C3', 0, 1],
        ['G3', 1, 1],
        ['C3', 2, 1],
        ['G3', 3, 1],
      ],
    });
    const motifs = findMotifs(score, {length: 4});
    // Each line is stated only once, so no motif should repeat.
    expect(motifs).toHaveLength(0);
  });

  it('finds a motif repeated across two voices', () => {
    const phrase = (octave: number, offset: number): NoteSpec[] => [
      [`C${octave}`, offset, 1],
      [`E${octave}`, offset + 1, 1],
      [`G${octave}`, offset + 2, 1],
      [`E${octave}`, offset + 3, 1],
    ];
    const score = scoreFrom({
      v1: phrase(5, 0),
      v2: phrase(3, 0),
    });
    const motifs = findMotifs(score, {length: 4});
    expect(motifs).toHaveLength(1);
    expect(motifs[0].intervals).toEqual([4, 3, -3]);
    expect(motifs[0].occurrences).toHaveLength(2);
  });

  it('filters trivial all-zero interval motifs (one repeated pitch)', () => {
    const line: NoteSpec[] = Array.from({length: 8}, (_, index) => ['C4', index, 1] as NoteSpec);
    expect(findMotifs(scoreFrom({v1: line}), {length: 4})).toHaveLength(0);
  });

  it('requires at least 2 non-overlapping occurrences', () => {
    // C D C D C D: the [C D C D] window repeats at indexes 0 and 2, but the
    // two occurrences overlap — there is only one non-overlapping statement.
    const line: NoteSpec[] = [
      ['C4', 0, 1],
      ['D4', 1, 1],
      ['C4', 2, 1],
      ['D4', 3, 1],
      ['C4', 4, 1],
      ['D4', 5, 1],
    ];
    const motifs = findMotifs(scoreFrom({v1: line}), {length: 4});
    expect(motifs).toHaveLength(0);
  });

  it('groups identical notated rhythms with non-dyadic (triplet) durations regardless of onset', () => {
    // C D E D in triplet eighths (1/3 quarter each), stated twice back-to-back.
    // Duration as float-of-offset minus float-of-onset is onset-dependent for
    // non-dyadic rationals (0.3333333333333333 vs 0.33333333333333337 vs
    // 0.33333333333333326), so float-keyed rhythms never group and the motif
    // silently vanishes. Keying must use the exact rational duration.
    const builder = new ScoreBuilder();
    const partId = builder.addPart({id: builder.newPartId(), name: 'Test'});
    const voice = builder.newVoiceId();
    const pitches = ['C4', 'D4', 'E4', 'D4', 'C4', 'D4', 'E4', 'D4'];
    pitches.forEach((name, index) => {
      builder.addNote(partId, {
        id: builder.newNoteId(),
        pitch: Pitch.parse(name),
        onsetQuarters: new Rational(index, 3),
        duration: Duration.triplet(Duration.eighth()),
        voice,
      });
    });
    const motifs = findMotifs(builder.build(), {length: 4});
    expect(motifs).toHaveLength(1);
    expect(motifs[0].intervals).toEqual([2, 2, -2]);
    expect(motifs[0].occurrences).toHaveLength(2);
    for (const duration of motifs[0].rhythm) {
      expect(duration).toBeCloseTo(1 / 3, 12);
    }
  });

  it('treats explicit rests as phrase boundaries instead of pitch events', () => {
    const b = new ScoreBuilder();
    const partId = b.addPart({id: b.newPartId(), name: 'Test'});
    const voice = b.newVoiceId();
    const add = (pitch: string, onset: number) =>
      b.addNote(partId, {
        id: b.newNoteId(),
        pitch: Pitch.parse(pitch),
        onsetQuarters: new Rational(onset),
        duration: Duration.quarter(),
        voice,
      });
    add('C4', 0);
    add('D4', 1);
    b.addNote(partId, {
      id: b.newNoteId(),
      rest: true,
      onsetQuarters: new Rational(2),
      duration: Duration.quarter(),
      voice,
    });
    add('E4', 3);
    add('F4', 4);
    add('C4', 5);
    add('D4', 6);
    b.addNote(partId, {
      id: b.newNoteId(),
      rest: true,
      onsetQuarters: new Rational(7),
      duration: Duration.quarter(),
      voice,
    });
    add('E4', 8);
    add('F4', 9);

    // Ignoring rest events would fabricate two C–D–E–F motifs by joining
    // separate phrases. More importantly, a pitchless rest must never crash.
    expect(findMotifs(b.build(), {length: 4})).toHaveLength(0);
  });
});

describe('rhythmPatterns', () => {
  it('counts identical dyadic patterns as one pattern', () => {
    const line: NoteSpec[] = [
      ['C4', 0, 1],
      ['D4', 1, 0.5],
      ['E4', 1.5, 0.5],
      ['F4', 2, 1],
      ['G4', 3, 0.5],
      ['A4', 3.5, 0.5],
    ];
    const patterns = rhythmPatterns(scoreFrom({v1: line}), 2);
    const halfPair = patterns.find((pattern) => pattern.pattern[0] === 0.5 && pattern.pattern[1] === 0.5);
    expect(halfPair).toBeDefined();
    expect(halfPair!.count).toBe(2);
  });

  it('groups non-dyadic (triplet) durations into one pattern regardless of onset', () => {
    // 8 straight triplet eighths: every length-4 window has the same notated
    // rhythm [1/3, 1/3, 1/3, 1/3], so there must be exactly ONE pattern with
    // count 5 — not five float-key variants with count 1 each.
    const builder = new ScoreBuilder();
    const partId = builder.addPart({id: builder.newPartId(), name: 'Test'});
    const voice = builder.newVoiceId();
    for (let index = 0; index < 8; index += 1) {
      builder.addNote(partId, {
        id: builder.newNoteId(),
        pitch: Pitch.parse('C4'),
        onsetQuarters: new Rational(index, 3),
        duration: Duration.triplet(Duration.eighth()),
        voice,
      });
    }
    const patterns = rhythmPatterns(builder.build(), 4);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].count).toBe(5);
    expect(patterns[0].onsets).toHaveLength(5);
    for (const duration of patterns[0].pattern) {
      expect(duration).toBeCloseTo(1 / 3, 12);
    }
  });
});
