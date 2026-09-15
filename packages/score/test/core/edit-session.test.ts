import {describe, expect, it} from 'vitest';
import {
  Duration,
  Measure,
  MeasureId,
  Note,
  NoteId,
  Part,
  PartId,
  Pitch,
  Rational,
  Score,
  ScoreBuilder,
  ScoreId,
  TimeMap,
  VoiceId,
  notesAt,
  notesIn,
  notesOverlapping,
  scoreFromJSON,
} from '../../src/core/index';
import type {NoteData} from '../../src/core/index';

const EIGHTH = new Duration({base: [1, 2]});
const QUARTER = new Duration({base: [1, 1]});

function buildScore(notesPerPart = 16, parts = 3): Score {
  const b = new ScoreBuilder();
  const numMeasures = Math.max(1, Math.ceil(notesPerPart / 8));
  for (let m = 0; m < numMeasures; m++) {
    b.addMeasure({
      id: MeasureId(`m${m}`),
      number: m + 1,
      onsetQuarters: new Rational(4 * m, 1),
      durationQuarters: new Rational(4, 1),
      keySignature: m === 0 ? {fifths: 2} : undefined,
    });
  }
  b.addTempo({atQuarters: new Rational(0, 1), bpm: 120});
  for (let p = 0; p < parts; p++) {
    const pid = PartId(`p${p}`);
    b.addPart({id: pid, name: `Part ${p}`});
    for (let i = 0; i < notesPerPart; i++) {
      b.addNote(pid, {
        id: NoteId(`n${p}_${i}`),
        pitch: new Pitch('C', 0, 4),
        onsetQuarters: new Rational(i, 2),
        duration: EIGHTH,
        voice: VoiceId(`v${p}`),
      });
    }
  }
  return b.build();
}

interface RefOps {
  updates?: Record<string, Partial<NoteData>>;
  removes?: string[];
  adds?: Record<string, NoteData[]>; // partId -> notes
}

/**
 * Naive full reconstruction with the same op semantics as the edit session:
 * unmoved updates replace in place; moved updates and adds are appended (the
 * Part constructor's stable sort puts them after existing equal onsets);
 * removals filter. The Score is rebuilt through the plain constructor.
 */
function referenceApply(score: Score, ops: RefOps): Score {
  const updates = ops.updates ?? {};
  const removes = new Set(ops.removes ?? []);
  const adds = ops.adds ?? {};
  const parts = score.parts.map((part) => {
    const kept: Note[] = [];
    const moved: Note[] = [];
    for (const n of part.notes) {
      if (removes.has(n.id as string)) continue;
      const patch = updates[n.id as string];
      if (patch) {
        const next = n.with(patch);
        if (next.onsetQuarters.eq(n.onsetQuarters)) kept.push(next);
        else moved.push(next);
      } else {
        kept.push(n);
      }
    }
    const added = (adds[part.id as string] ?? []).map((d) => new Note(d));
    return new Part({...part, notes: [...kept, ...moved, ...added]});
  });
  return new Score({
    id: score.id,
    metadata: score.metadata,
    parts,
    measures: score.measures,
    timeMap: score.timeMap,
  });
}

function applyViaSession(score: Score, ops: RefOps): Score {
  return score.edit((tx) => {
    for (const [id, patch] of Object.entries(ops.updates ?? {})) tx.updateNote(NoteId(id), patch);
    for (const id of ops.removes ?? []) tx.removeNote(NoteId(id));
    for (const [pid, notes] of Object.entries(ops.adds ?? {})) {
      for (const n of notes) tx.addNote(PartId(pid), n);
    }
  });
}

/** Assert the edited score is observationally identical to the reference. */
function expectEquivalent(actual: Score, expected: Score): void {
  // Full structural equality (parts, note order, measures, timeMap).
  expect(actual.toJSON()).toEqual(expected.toJSON());
  // Flattened sounding view: same notes in the same order.
  expect(actual.notes.map((n) => n.id)).toEqual(expected.notes.map((n) => n.id));
  // Duration.
  expect(actual.durationQuarters.eq(expected.durationQuarters)).toBe(true);
  expect(actual.durationSeconds).toBeCloseTo(expected.durationSeconds, 12);
  expect(actual.durationTicks).toBe(expected.durationTicks);
  // getNote agrees for every note (and a miss).
  for (const n of expected.notes) {
    expect(actual.getNote(n.id)?.toJSON()).toEqual(n.toJSON());
  }
  expect(actual.getNote(NoteId('no-such-note'))).toBeUndefined();
  // Legacy getters.
  expect(actual.tempos).toEqual(expected.tempos);
  expect(actual.timeSignatures).toEqual(expected.timeSignatures);
  expect(actual.keySignatures).toEqual(expected.keySignatures);
  // Queries across the whole range agree.
  const end = Math.ceil(expected.durationQuarters.toFloat()) + 1;
  for (let q = 0; q <= end; q++) {
    const at = new Rational(q, 1);
    expect(notesAt(actual, at).map((n) => n.id)).toEqual(notesAt(expected, at).map((n) => n.id));
    const to = new Rational(q + 1, 1);
    expect(notesOverlapping(actual, at, to).map((n) => n.id)).toEqual(
      notesOverlapping(expected, at, to).map((n) => n.id),
    );
    expect(notesIn(actual, at, to).map((n) => n.id)).toEqual(
      notesIn(expected, at, to).map((n) => n.id),
    );
  }
}

describe('Score.edit (batch edit session)', () => {
  it('edits the first note of a part', () => {
    const score = buildScore();
    const ops: RefOps = {updates: {n1_0: {pitch: new Pitch('E', 0, 5), lyric: 'la'}}};
    expectEquivalent(applyViaSession(score, ops), referenceApply(score, ops));
  });

  it('edits the last note of a part (duration-defining note)', () => {
    const score = buildScore();
    // Extend the last note: duration must grow.
    const ops: RefOps = {updates: {n2_15: {duration: new Duration({base: [4, 1]})}}};
    const edited = applyViaSession(score, ops);
    expectEquivalent(edited, referenceApply(score, ops));
    expect(edited.durationQuarters.gt(score.durationQuarters)).toBe(true);
  });

  it('moves a note across other onsets (merge order changes)', () => {
    const score = buildScore();
    const ops: RefOps = {updates: {n0_2: {onsetQuarters: new Rational(25, 4)}}};
    expectEquivalent(applyViaSession(score, ops), referenceApply(score, ops));
  });

  it('moves a note to the very front and the very back', () => {
    const score = buildScore();
    for (const onset of [new Rational(-1, 2), new Rational(1000, 1)]) {
      const ops: RefOps = {updates: {n1_7: {onsetQuarters: onset}}};
      expectEquivalent(applyViaSession(score, ops), referenceApply(score, ops));
    }
  });

  it("removes a part's last note (duration shrinks, no stale max)", () => {
    const b = new ScoreBuilder();
    const pid = b.addPart({id: PartId('solo'), name: 'Solo'});
    for (let i = 0; i < 4; i++) {
      b.addNote(pid, {
        id: NoteId(`s${i}`),
        pitch: new Pitch('C', 0, 4),
        onsetQuarters: new Rational(i, 1),
        duration: QUARTER,
        voice: VoiceId('v'),
      });
    }
    const score = b.build();
    expect(score.durationQuarters.eq(new Rational(4, 1))).toBe(true);
    const ops: RefOps = {removes: ['s3']};
    const edited = applyViaSession(score, ops);
    expectEquivalent(edited, referenceApply(score, ops));
    expect(edited.durationQuarters.eq(new Rational(3, 1))).toBe(true);
  });

  it('removes ALL notes of a part', () => {
    const score = buildScore(4, 2);
    const ops: RefOps = {removes: ['n1_0', 'n1_1', 'n1_2', 'n1_3']};
    expectEquivalent(applyViaSession(score, ops), referenceApply(score, ops));
  });

  it('adds notes extending the score duration', () => {
    const score = buildScore();
    const ops: RefOps = {
      adds: {
        p0: [
          {
            id: NoteId('tail'),
            pitch: new Pitch('G', 0, 5),
            onsetQuarters: new Rational(100, 1),
            duration: QUARTER,
            voice: VoiceId('v0'),
          },
        ],
      },
    };
    const edited = applyViaSession(score, ops);
    expectEquivalent(edited, referenceApply(score, ops));
    expect(edited.durationQuarters.eq(new Rational(101, 1))).toBe(true);
  });

  it('handles a batch of 100 mixed ops across parts in one commit', () => {
    const score = buildScore(40, 3);
    const ops: RefOps = {updates: {}, removes: [], adds: {p0: [], p2: []}};
    for (let k = 0; k < 40; k++) {
      ops.updates![`n1_${k}`] =
        k % 3 === 0
          ? {onsetQuarters: new Rational(80 - k, 2)}
          : {pitch: new Pitch('D', k % 2 === 0 ? 1 : 0, 4)};
    }
    for (let k = 0; k < 30; k++) ops.removes!.push(`n0_${k}`);
    for (let k = 0; k < 30; k++) {
      ops.adds![k % 2 === 0 ? 'p0' : 'p2'].push({
        id: NoteId(`new_${k}`),
        pitch: new Pitch('A', 0, 3),
        onsetQuarters: new Rational(k * 3, 4),
        duration: EIGHTH,
        voice: VoiceId('vx'),
      });
    }
    expectEquivalent(applyViaSession(score, ops), referenceApply(score, ops));
  });

  it('keeps rests out of the flattened view but reachable via getNote', () => {
    const score = buildScore(4, 1);
    const edited = score.edit((tx) => {
      tx.addNote(PartId('p0'), {
        id: NoteId('rest1'),
        rest: true,
        onsetQuarters: new Rational(9, 2),
        duration: QUARTER,
        voice: VoiceId('v0'),
      });
    });
    expect(edited.notes.some((n) => n.id === NoteId('rest1'))).toBe(false);
    expect(edited.getNote(NoteId('rest1'))?.rest).toBe(true);
    // Rest offsets still count toward duration.
    expect(edited.durationQuarters.eq(new Rational(11, 2))).toBe(true);
  });

  it('preserves object identity of untouched parts and notes', () => {
    const score = buildScore();
    const edited = score.edit((tx) => {
      tx.updateNote(NoteId('n1_3'), {lyric: 'hey'});
    });
    // Untouched parts are the SAME objects (downstream WeakMap memoization).
    expect(edited.getPart(PartId('p0'))).toBe(score.getPart(PartId('p0')));
    expect(edited.getPart(PartId('p2'))).toBe(score.getPart(PartId('p2')));
    // The edited part is new, but its untouched notes are the same objects.
    const oldP1 = score.getPart(PartId('p1'))!;
    const newP1 = edited.getPart(PartId('p1'))!;
    expect(newP1).not.toBe(oldP1);
    for (let i = 0; i < oldP1.notes.length; i++) {
      if (oldP1.notes[i].id === NoteId('n1_3')) continue;
      expect(newP1.notes[i]).toBe(oldP1.notes[i]);
    }
    // Measures and timeMap untouched → shared by reference.
    expect(edited.measures).toBe(score.measures);
    expect(edited.timeMap).toBe(score.timeMap);
  });

  it('round-trips an edited score through JSON', () => {
    const score = buildScore();
    const edited = score.edit((tx) => {
      tx.updateNote(NoteId('n0_0'), {pitch: new Pitch('B', -1, 3)});
      tx.removeNote(NoteId('n2_15'));
      tx.addNote(PartId('p1'), {
        id: NoteId('rt'),
        pitch: new Pitch('D', 0, 5),
        onsetQuarters: new Rational(9, 2),
        duration: QUARTER,
        voice: VoiceId('v1'),
      });
      tx.updateMeasure(MeasureId('m1'), {keySignature: {fifths: 1}});
    });
    const revived = scoreFromJSON(JSON.parse(JSON.stringify(edited.toJSON())));
    expect(revived.toJSON()).toEqual(edited.toJSON());
    expect(revived.getNote(NoteId('rt'))?.pitch.step).toBe('D');
    expect(revived.durationSeconds).toBeCloseTo(edited.durationSeconds, 12);
  });

  it('leaves the original score untouched', () => {
    const score = buildScore();
    const beforeJSON = JSON.stringify(score.toJSON());
    const beforeNotes = score.notes;
    applyViaSession(score, {
      updates: {n0_0: {onsetQuarters: new Rational(99, 1)}},
      removes: ['n2_3'],
      adds: {p1: [{id: NoteId('zz'), pitch: new Pitch('B', 0, 3), onsetQuarters: Rational.ZERO, duration: EIGHTH, voice: VoiceId('v1')}]},
    });
    expect(JSON.stringify(score.toJSON())).toBe(beforeJSON);
    expect(score.notes).toBe(beforeNotes);
    expect(score.getNote(NoteId('n2_3'))).toBeDefined();
    expect(score.getNote(NoteId('zz'))).toBeUndefined();
  });

  it('returns the same instance when no ops were buffered', () => {
    const score = buildScore();
    expect(score.edit(() => {})).toBe(score);
  });

  it('supports updating and removing notes added in the same session', () => {
    const score = buildScore(4, 1);
    const edited = score.edit((tx) => {
      tx.addNote(PartId('p0'), {id: NoteId('a1'), pitch: new Pitch('C', 0, 5), onsetQuarters: new Rational(10, 1), duration: EIGHTH, voice: VoiceId('v0')});
      tx.addNote(PartId('p0'), {id: NoteId('a2'), pitch: new Pitch('D', 0, 5), onsetQuarters: new Rational(11, 1), duration: EIGHTH, voice: VoiceId('v0')});
      tx.updateNote(NoteId('a1'), {pitch: new Pitch('F', 1, 5)});
      tx.removeNote(NoteId('a2'));
    });
    expect(edited.getNote(NoteId('a1'))?.pitch.step).toBe('F');
    expect(edited.getNote(NoteId('a2'))).toBeUndefined();
  });

  it('merges successive updates to the same note', () => {
    const score = buildScore();
    const edited = score.edit((tx) => {
      tx.updateNote(NoteId('n0_1'), {lyric: 'one'});
      tx.updateNote(NoteId('n0_1'), {dynamic: 'mf'});
    });
    const n = edited.getNote(NoteId('n0_1'))!;
    expect(n.lyric).toBe('one');
    expect(n.dynamic).toBe('mf');
  });

  it('update then remove: removal wins', () => {
    const score = buildScore();
    const ops: RefOps = {removes: ['n0_1']};
    const edited = score.edit((tx) => {
      tx.updateNote(NoteId('n0_1'), {lyric: 'gone'});
      tx.removeNote(NoteId('n0_1'));
    });
    expectEquivalent(edited, referenceApply(score, ops));
  });

  it('supports measure update/add/remove', () => {
    const score = buildScore(16, 1);
    const edited = score.edit((tx) => {
      tx.updateMeasure(MeasureId('m0'), {keySignature: {fifths: -3}});
      tx.addMeasure({
        id: MeasureId('m9'),
        number: 99,
        onsetQuarters: new Rational(8, 1),
        durationQuarters: new Rational(4, 1),
      });
      tx.removeMeasure(MeasureId('m1'));
    });
    expect(edited.getMeasure(MeasureId('m0'))?.keySignature?.fifths).toBe(-3);
    expect(edited.getMeasure(MeasureId('m1'))).toBeUndefined();
    expect(edited.getMeasure(MeasureId('m9'))?.number).toBe(99);
    // keySignatures legacy view reflects the measure edit.
    expect(edited.keySignatures).toEqual([{tick: 0, fifths: -3, mode: undefined}]);
    // Measures stay sorted by onset.
    const onsets = edited.measures.map((m) => m.onsetQuarters.toFloat());
    expect(onsets).toEqual([...onsets].sort((a, b) => a - b));
    // Duration reflects the added measure's end (12 quarters at 120bpm = 6s).
    expect(edited.durationQuarters.eq(new Rational(12, 1))).toBe(true);
    expect(edited.durationSeconds).toBeCloseTo(6, 12);
    // Original untouched.
    expect(score.getMeasure(MeasureId('m1'))).toBeDefined();
  });

  it('rebuilds TimeMap from edited measure timing, tempo and meter fields', () => {
    const b = new ScoreBuilder();
    b.addMeasure({
      id: MeasureId('m0'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      tempo: {bpm: 120},
      timeSignature: {numerator: 4, denominator: 4},
    });
    b.addMeasure({
      id: MeasureId('m1'),
      number: 2,
      onsetQuarters: new Rational(4),
      durationQuarters: new Rational(4),
      tempo: {bpm: 90},
      timeSignature: {numerator: 5, denominator: 4},
    });
    // Explicit entries must survive a measure edit; they intentionally win
    // only at their own positions.
    b.addTempo({atQuarters: Rational.ONE, bpm: 100});
    b.addMeter({
      atQuarters: Rational.ONE,
      measureNumber: 1,
      timeSignature: {numerator: 3, denominator: 4},
    });
    const score = b.build();

    const edited = score.edit((tx) => {
      tx.updateMeasure(MeasureId('m0'), {durationQuarters: new Rational(2)});
      tx.updateMeasure(MeasureId('m1'), {
        onsetQuarters: new Rational(2),
        tempo: {bpm: 60},
        timeSignature: {numerator: 2, denominator: 4},
      });
    });

    expect(edited.timeMap.tempoAt(new Rational(2)).bpm).toBe(60);
    expect(edited.timeMap.tempoAt(new Rational(4)).bpm).toBe(60);
    expect(edited.timeMap.timeSignatureAt(new Rational(1))).toEqual({numerator: 3, denominator: 4});
    expect(edited.timeMap.timeSignatureAt(new Rational(2))).toEqual({numerator: 2, denominator: 4});
    expect(edited.timeMap.quartersToMBS(new Rational(2))).toMatchObject({measure: 2, beat: 1});
    // 1q at 120 (.5s), 1q at explicit 100 (.6s), then 2q at 60 (2s).
    expect(edited.timeMap.quartersToSeconds(new Rational(4))).toBeCloseTo(3.1);
    expect(edited.tempos).toEqual([
      {tick: 0, bpm: 120},
      {tick: 480, bpm: 100},
      {tick: 960, bpm: 60},
    ]);
    expect(edited.timeSignatures).toEqual([
      {tick: 0, numerator: 4, denominator: 4},
      {tick: 480, numerator: 3, denominator: 4},
      {tick: 960, numerator: 2, denominator: 4},
    ]);
    expect(score.timeMap.tempoAt(new Rational(4)).bpm).toBe(90);
  });

  it('preserves direct TimeMap entries when their provenance is unknown', () => {
    const measure = new Measure({
      id: MeasureId('m0'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      tempo: {bpm: 100},
      timeSignature: {numerator: 3, denominator: 4},
    });
    const score = new Score({
      id: ScoreId('direct-time-map'),
      metadata: {},
      parts: [],
      measures: [measure],
      // This deliberately bypasses ScoreBuilder, so there is no private
      // inferred-vs-explicit provenance to consult during the edit.
      timeMap: new TimeMap(
        [{atQuarters: Rational.ZERO, bpm: 100}],
        [{atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 3, denominator: 4}}],
        [measure],
      ),
    });

    const edited = score.edit((tx) => {
      tx.updateMeasure(MeasureId('m0'), {tempo: undefined, timeSignature: undefined});
    });

    expect(edited.timeMap.tempoAt(Rational.ZERO).bpm).toBe(100);
    expect(edited.timeMap.timeSignatureAt(Rational.ZERO)).toEqual({numerator: 3, denominator: 4});
    expect(edited.timeMap.toJSON().tempi[0]).toMatchObject({explicit: true});
    expect(edited.timeMap.toJSON().meters[0]).toMatchObject({explicit: true});
  });

  it('snapshots nested model data so public caches cannot be invalidated', () => {
    const keySignature = {fifths: 0};
    const tempo = {bpm: 120};
    const timeSignature = {numerator: 4, denominator: 4};
    const performed = {onsetSec: 0.5, durationSec: 0.25, velocity: 90};
    const custom = {source: {take: 1}};
    const b = new ScoreBuilder().setMetadata({custom});
    b.addMeasure({
      id: MeasureId('m0'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      keySignature,
      tempo,
      timeSignature,
    });
    const partId = b.addPart({id: PartId('p'), name: 'P', transpose: {chromatic: -2}});
    b.addNote(partId, {
      id: NoteId('n'),
      pitch: new Pitch('C', 0, 4),
      onsetQuarters: Rational.ZERO,
      duration: QUARTER,
      voice: VoiceId('v'),
      performed,
      tags: ['recorded'],
    });
    const score = b.build();

    keySignature.fifths = 4;
    tempo.bpm = 30;
    timeSignature.numerator = 3;
    performed.onsetSec = 9;
    custom.source.take = 2;

    expect(score.keySignatures).toEqual([{tick: 0, fifths: 0, mode: undefined}]);
    expect(score.timeMap.tempoAt(Rational.ZERO).bpm).toBe(120);
    expect(score.timeMap.timeSignatureAt(Rational.ZERO)).toEqual({numerator: 4, denominator: 4});
    expect(score.getNote(NoteId('n'))?.performed?.onsetSec).toBeCloseTo(0.5);
    expect((score.metadata.custom?.source as {take: number}).take).toBe(1);
    expect(score.parts[0].transpose).toEqual({chromatic: -2});
    expect(Object.isFrozen(score.measures[0].keySignature)).toBe(true);
    expect(Object.isFrozen(score.getNote(NoteId('n'))?.performed)).toBe(true);
  });

  it('rejects invalid measure durations, tempi and time signatures at construction', () => {
    const base = {
      id: MeasureId('invalid'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
    };
    expect(() => new Measure({...base, durationQuarters: new Rational(-1)})).toThrow(RangeError);
    expect(() => new Measure({...base, tempo: {bpm: 0}})).toThrow(RangeError);
    expect(() => new Measure({...base, tempo: {bpm: 120, unit: -1}})).toThrow(RangeError);
    expect(() => new Measure({...base, timeSignature: {numerator: 0, denominator: 4}})).toThrow(RangeError);
    expect(() => new Measure({...base, timeSignature: {numerator: 4, denominator: 1.5}})).toThrow(RangeError);
  });

  it('throws clear errors for unknown ids and misuse', () => {
    const score = buildScore();
    expect(() => score.edit((tx) => tx.updateNote(NoteId('nope'), {lyric: 'x'}))).toThrow(/Unknown note id: nope/);
    expect(() => score.edit((tx) => tx.removeNote(NoteId('nope')))).toThrow(/Unknown note id: nope/);
    expect(() =>
      score.edit((tx) =>
        tx.addNote(PartId('ghost'), {id: NoteId('x'), pitch: new Pitch('C', 0, 4), onsetQuarters: Rational.ZERO, duration: EIGHTH, voice: VoiceId('v')}),
      ),
    ).toThrow(/Unknown part: ghost/);
    expect(() =>
      score.edit((tx) =>
        tx.addNote(PartId('p0'), {id: NoteId('n1_2'), pitch: new Pitch('C', 0, 4), onsetQuarters: Rational.ZERO, duration: EIGHTH, voice: VoiceId('v')}),
      ),
    ).toThrow(/Duplicate note id: n1_2/);
    expect(() =>
      score.edit((tx) => {
        tx.removeNote(NoteId('n0_0'));
        tx.removeNote(NoteId('n0_0'));
      }),
    ).toThrow(/already removed/);
    expect(() => score.edit((tx) => tx.updateNote(NoteId('n0_0'), {id: NoteId('other')}))).toThrow(/cannot change/);
    expect(() => score.edit((tx) => tx.updateMeasure(MeasureId('mx'), {number: 5}))).toThrow(/Unknown measure id: mx/);
    expect(() => score.edit((tx) => tx.removeMeasure(MeasureId('mx')))).toThrow(/Unknown measure id: mx/);
    // Using the tx after commit throws.
    let leaked: any;
    score.edit((tx) => {
      leaked = tx;
      tx.updateNote(NoteId('n0_0'), {lyric: 'x'});
    });
    expect(() => leaked.updateNote(NoteId('n0_0'), {lyric: 'y'})).toThrow(/already committed/);
  });

  it('allows re-adding an id removed in the same session', () => {
    const score = buildScore();
    const edited = score.edit((tx) => {
      tx.removeNote(NoteId('n0_0'));
      tx.addNote(PartId('p1'), {id: NoteId('n0_0'), pitch: new Pitch('G', 0, 4), onsetQuarters: new Rational(7, 1), duration: EIGHTH, voice: VoiceId('v1')});
    });
    const n = edited.getNote(NoteId('n0_0'))!;
    expect(n.pitch.step).toBe('G');
    expect(score.getPart(PartId('p1'))!.notes.some((x) => x.id === NoteId('n0_0'))).toBe(false);
    expect(edited.getPart(PartId('p1'))!.notes.some((x) => x.id === NoteId('n0_0'))).toBe(true);
  });

  it('stays correct across a long chain of edits (drag simulation, overlay flattening)', () => {
    const score = buildScore(32, 2);
    // Materialize lookups up front, as an editor would.
    expect(score.getNote(NoteId('n1_5'))).toBeDefined();
    let current = score;
    const frames = 30; // crosses the overlay-depth flatten threshold twice
    for (let f = 1; f <= frames; f++) {
      current = current.edit((tx) => tx.updateNote(NoteId('n1_5'), {onsetQuarters: new Rational(10 + f, 4)}));
      // getNote must see the latest version every frame.
      expect(current.getNote(NoteId('n1_5'))!.onsetQuarters.eq(new Rational(10 + f, 4))).toBe(true);
    }
    const ops: RefOps = {updates: {n1_5: {onsetQuarters: new Rational(10 + frames, 4)}}};
    expectEquivalent(current, referenceApply(score, ops));
  });
});

describe('incremental withPart', () => {
  it('matches full reconstruction exactly', () => {
    const score = buildScore();
    const part = score.getPart(PartId('p1'))!;
    const notes = [...part.notes];
    notes[3] = notes[3].with({onsetQuarters: new Rational(31, 4)});
    const newPart = new Part({...part, notes});
    const incremental = score.withPart(newPart);
    const full = new Score({
      id: score.id,
      metadata: score.metadata,
      parts: score.parts.map((p) => (p.id === newPart.id ? newPart : p)),
      measures: score.measures,
      timeMap: score.timeMap,
    });
    expectEquivalent(incremental, full);
  });

  it('appends a brand-new part and updates duration/getNote', () => {
    const score = buildScore(4, 1);
    const extra = new Part({
      id: PartId('extra'),
      name: 'Extra',
      notes: [
        new Note({id: NoteId('e0'), pitch: new Pitch('F', 0, 3), onsetQuarters: new Rational(50, 1), duration: QUARTER, voice: VoiceId('ve')}),
      ],
    });
    const next = score.withPart(extra);
    expect(next.parts.length).toBe(2);
    expect(next.getNote(NoteId('e0'))).toBeDefined();
    expect(next.durationQuarters.eq(new Rational(51, 1))).toBe(true);
    expect(next.notes.length).toBe(score.notes.length + 1);
  });

  it('withoutPart removes notes from all derived views', () => {
    const score = buildScore(4, 2);
    const next = score.withoutPart(PartId('p0'));
    expect(next.getNote(NoteId('n0_0'))).toBeUndefined();
    expect(next.getNote(NoteId('n1_0'))).toBeDefined();
    expect(next.notes.every((n) => !(n.id as string).startsWith('n0_'))).toBe(true);
  });
});
