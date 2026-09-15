import {describe, expect, it} from 'vitest';
import {
  Duration,
  Note,
  Pitch,
  Rational,
  Score,
  ScoreBuilder,
  notesAt,
  notesOverlapping,
  type NoteQueryOptions,
} from '../../src/core';
import {MeasureId, NoteId, PartId, VoiceId} from '../../src/core/types/ids';

// ---------------------------------------------------------------------------
// Naive reference implementations: the exact pre-optimization algorithms
// (linear scan from index 0, pure Rational comparisons). The optimized
// notesAt/notesOverlapping must match these on every input.
// ---------------------------------------------------------------------------

function naiveNotesAt(score: Score, q: Rational, options?: NoteQueryOptions): Note[] {
  const includeRests = options?.includeRests ?? false;
  const includeGrace = options?.includeGrace ?? true;
  const out: Note[] = [];
  for (const part of score.parts) {
    for (const n of part.notes) {
      if (n.onsetQuarters.gt(q)) break;
      if (n.rest && !includeRests) continue;
      if (n.grace) {
        if (includeGrace && (n.onsetQuarters.eq(q) || n.offsetQuarters.gt(q))) out.push(n);
        continue;
      }
      if (n.offsetQuarters.gt(q)) out.push(n);
    }
  }
  return out;
}

function naiveNotesOverlapping(
  score: Score,
  from: Rational,
  to: Rational,
  options?: NoteQueryOptions,
): Note[] {
  const includeRests = options?.includeRests ?? false;
  const includeGrace = options?.includeGrace ?? true;
  const out: Note[] = [];
  for (const part of score.parts) {
    for (const n of part.notes) {
      if (n.onsetQuarters.gte(to)) break;
      if (n.rest && !includeRests) continue;
      if (n.grace) {
        if (includeGrace && (n.onsetQuarters.gte(from) || n.offsetQuarters.gt(from))) out.push(n);
        continue;
      }
      if (n.offsetQuarters.lte(from)) continue;
      out.push(n);
    }
  }
  return out;
}

const ids = (notes: Note[]) => notes.map((n) => n.id);

function buildPedalScore(): Score {
  // One part: a 20-quarter pedal note starting at q=2, plus a stream of
  // eighth notes covering q=0..40.
  const b = new ScoreBuilder();
  const pid = b.addPart({id: PartId('p0'), name: 'Piano'});
  const voice = VoiceId('v1');
  b.addNote(pid, {
    id: NoteId('pedal'),
    pitch: Pitch.parse('C2'),
    onsetQuarters: new Rational(2),
    duration: new Duration({base: 20}),
    voice,
  });
  for (let i = 0; i < 80; i++) {
    b.addNote(pid, {
      id: NoteId(`e${i}`),
      pitch: Pitch.parse('C4'),
      onsetQuarters: new Rational(i, 2),
      duration: Duration.eighth(),
      voice,
    });
  }
  return b.build();
}

describe('notesAt/notesOverlapping fast path: long sustained notes', () => {
  const score = buildPedalScore();

  it('notesAt finds a 20-quarter pedal far from its onset', () => {
    // q=21 is 19 quarters past the pedal onset (pedal sounds on [2, 22)).
    const at = notesAt(score, new Rational(21));
    expect(ids(at)).toContain('pedal');
    expect(ids(at)).toEqual(ids(naiveNotesAt(score, new Rational(21))));
  });

  it('notesAt at the pedal offset boundary excludes it (exclusive offset)', () => {
    const at = notesAt(score, new Rational(22));
    expect(ids(at)).not.toContain('pedal');
    expect(ids(at)).toEqual(ids(naiveNotesAt(score, new Rational(22))));
  });

  it('notesOverlapping window far from the pedal onset still finds it', () => {
    const ov = notesOverlapping(score, new Rational(20), new Rational(21));
    expect(ids(ov)).toContain('pedal');
    expect(ids(ov)).toEqual(ids(naiveNotesOverlapping(score, new Rational(20), new Rational(21))));
  });

  it('notesOverlapping window starting exactly at the pedal offset excludes it', () => {
    const ov = notesOverlapping(score, new Rational(22), new Rational(23));
    expect(ids(ov)).not.toContain('pedal');
    expect(ids(ov)).toEqual(ids(naiveNotesOverlapping(score, new Rational(22), new Rational(23))));
  });

  it('matches the naive reference at every half-quarter position', () => {
    for (let h = 0; h <= 90; h++) {
      const q = new Rational(h, 2);
      const to = q.add(Rational.ONE);
      expect(ids(notesAt(score, q))).toEqual(ids(naiveNotesAt(score, q)));
      expect(ids(notesOverlapping(score, q, to))).toEqual(
        ids(naiveNotesOverlapping(score, q, to)),
      );
    }
  });
});

describe('notesAt/notesOverlapping fast path: tuplet (1/3) boundary equivalence', () => {
  // Triplet eighths: onsets at k/3 quarters, each 1/3 quarter long. Floats
  // for thirds are inexact, so boundary comparisons must hit the exact
  // Rational fallback and still agree with the naive reference.
  const b = new ScoreBuilder();
  const pid = b.addPart({id: PartId('p0'), name: 'P'});
  const voice = VoiceId('v1');
  for (let k = 0; k < 120; k++) {
    b.addNote(pid, {
      id: NoteId(`t${k}`),
      pitch: Pitch.parse('G4'),
      onsetQuarters: new Rational(k, 3),
      duration: Duration.triplet(Duration.eighth()), // 1/3 quarter
      voice,
      tupletId: `tup${Math.floor(k / 3)}`,
    });
  }
  // A long sustained note under the triplets, plus some rests and graces near
  // third boundaries to exercise every branch.
  b.addNote(pid, {
    id: NoteId('sustain'),
    pitch: Pitch.parse('C3'),
    onsetQuarters: new Rational(1, 3),
    duration: new Duration({base: 12}),
    voice,
  });
  b.addNote(pid, {
    id: NoteId('rest1'),
    rest: true,
    onsetQuarters: new Rational(10, 3),
    duration: Duration.quarter(),
    voice,
  });
  b.addNote(pid, {
    id: NoteId('grace1'),
    pitch: Pitch.parse('A4'),
    grace: true,
    onsetQuarters: new Rational(20, 3),
    duration: new Duration({base: 0}),
    voice,
  });
  const score = b.build();

  it('queries straddling 1/3 onsets match the naive reference exactly', () => {
    const optionVariants: (NoteQueryOptions | undefined)[] = [
      undefined,
      {includeRests: true},
      {includeGrace: false},
      {includeRests: true, includeGrace: false},
    ];
    for (let k = 0; k <= 124; k++) {
      const q = new Rational(k, 3); // exactly on triplet boundaries
      const to = q.add(new Rational(1, 3));
      for (const opts of optionVariants) {
        expect(ids(notesAt(score, q, opts))).toEqual(ids(naiveNotesAt(score, q, opts)));
        expect(ids(notesOverlapping(score, q, to, opts))).toEqual(
          ids(naiveNotesOverlapping(score, q, to, opts)),
        );
      }
      // Also straddle: window [k/3 - 1/6, k/3 + 1/6) crosses the boundary.
      const fromHalf = q.sub(new Rational(1, 6));
      if (fromHalf.sign() >= 0) {
        const toHalf = q.add(new Rational(1, 6));
        expect(ids(notesOverlapping(score, fromHalf, toHalf))).toEqual(
          ids(naiveNotesOverlapping(score, fromHalf, toHalf)),
        );
        expect(ids(notesAt(score, fromHalf))).toEqual(ids(naiveNotesAt(score, fromHalf)));
      }
    }
  });

  it('grace note at 20/3 is matched at its exact tuplet onset', () => {
    const at = notesAt(score, new Rational(20, 3));
    expect(ids(at)).toContain('grace1');
    const ov = notesOverlapping(score, new Rational(20, 3), new Rational(21, 3));
    expect(ids(ov)).toContain('grace1');
  });
});

describe('ScoreBuilder tempo/meter dedup (Set-based)', () => {
  function naiveDedup(measures: {onset: Rational; bpm: number}[]) {
    // Canonical TimeMap semantics: final source declaration at a position wins.
    const byPosition = new Map<string, {atQuarters: Rational; bpm: number}>();
    for (const m of measures) {
      byPosition.set(`${m.onset.num}/${m.onset.den}`, {atQuarters: m.onset, bpm: m.bpm});
    }
    return [...byPosition.values()].sort((left, right) => left.atQuarters.cmp(right.atQuarters));
  }

  it('1000 tempo measures produce the same TimeMap as the naive dedup', () => {
    const M = 1000;
    const b = new ScoreBuilder();
    const measures: {onset: Rational; bpm: number}[] = [];
    for (let m = 0; m < M; m++) {
      const onset = new Rational(4 * m, 1);
      const bpm = 60 + (m % 90);
      measures.push({onset, bpm});
      b.addMeasure({
        id: MeasureId(`m${m}`),
        number: m + 1,
        onsetQuarters: onset,
        durationQuarters: new Rational(4),
        tempo: {bpm},
        timeSignature: m % 5 === 0 ? {numerator: 4, denominator: 4} : undefined,
      });
    }
    // Duplicate-onset measures are permitted during construction, but their
    // timeline declarations use the same final-wins rule as TimeMap.
    b.addMeasure({
      id: MeasureId('dup'),
      number: M + 1,
      onsetQuarters: new Rational(8),
      durationQuarters: new Rational(4),
      tempo: {bpm: 999},
    });
    const pid = b.addPart({id: PartId('p0'), name: 'P'});
    b.addNote(pid, {
      id: NoteId('n0'),
      pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice: VoiceId('v1'),
    });
    const score = b.build();

    const expected = naiveDedup([...measures, {onset: new Rational(8), bpm: 999}]);
    expect(score.timeMap.tempi).toHaveLength(expected.length);
    // TimeMap sorts by position; both inputs have unique sorted positions.
    for (let i = 0; i < expected.length; i++) {
      expect(score.timeMap.tempi[i].atQuarters.eq(expected[i].atQuarters)).toBe(true);
      expect(score.timeMap.tempi[i].bpm).toBe(expected[i].bpm);
    }
    // The final duplicate at q=8 replaces the original (bpm 62).
    expect(score.timeMap.tempoAt(new Rational(8)).bpm).toBe(999);
    // Meter entries: one per m % 5 === 0 measure.
    expect(score.timeMap.meters).toHaveLength(M / 5);
  });

  it('explicit addTempo wins over a measure tempo at the same position', () => {
    const b = new ScoreBuilder();
    b.addTempo({atQuarters: Rational.ZERO, bpm: 77});
    b.addMeasure({
      id: MeasureId('m0'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      tempo: {bpm: 200},
    });
    const pid = b.addPart({id: PartId('p0'), name: 'P'});
    b.addNote(pid, {
      id: NoteId('n0'),
      pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice: VoiceId('v1'),
    });
    const score = b.build();
    expect(score.timeMap.tempoAt(Rational.ZERO).bpm).toBe(77);
    expect(score.timeMap.tempi).toHaveLength(1);
  });

  it('default 120bpm/4-4 fallbacks still appear when nothing is at zero', () => {
    const b = new ScoreBuilder();
    b.addMeasure({
      id: MeasureId('m0'),
      number: 1,
      onsetQuarters: new Rational(4),
      durationQuarters: new Rational(4),
      tempo: {bpm: 90},
    });
    const pid = b.addPart({id: PartId('p0'), name: 'P'});
    b.addNote(pid, {
      id: NoteId('n0'),
      pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice: VoiceId('v1'),
    });
    const score = b.build();
    expect(score.timeMap.tempoAt(Rational.ZERO).bpm).toBe(120);
    expect(score.timeMap.tempoAt(new Rational(4)).bpm).toBe(90);
    expect(score.timeMap.meters[0].timeSignature).toEqual({numerator: 4, denominator: 4});
  });
});
