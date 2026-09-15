import {describe, expect, it} from 'vitest';
import {
  assertValidScore,
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
  ScoreJSONError,
  scoreFromJSON,
  TimeMap,
  validateScore,
  VoiceId,
} from '../../src/core';
import {setTimeMapExplicitEntries} from '../../src/core/time/TimeMap';

function makeNote(id = 'n'): Note {
  return new Note({
    id: NoteId(id),
    pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO,
    duration: Duration.quarter(),
    voice: VoiceId('v'),
  });
}

function makeMeasure(id: string, number: number, onset: Rational, duration = new Rational(4)): Measure {
  return new Measure({
    id: MeasureId(id),
    number,
    onsetQuarters: onset,
    durationQuarters: duration,
  });
}

describe('score integrity validation', () => {
  it('reports structural ambiguity while direct TimeMap construction canonicalizes same-position events', () => {
    const measures = [
      makeMeasure('m', 1, Rational.ZERO),
      makeMeasure('m', 2, Rational.ZERO),
      makeMeasure('m3', 3, new Rational(3)),
    ];
    const score = new Score({
      id: ScoreId('score'),
      metadata: {},
      parts: [
        new Part({id: PartId('p'), name: 'First', notes: [makeNote('n')]}),
        new Part({id: PartId('p'), name: 'Second', notes: [makeNote('n')]}),
      ],
      measures,
      timeMap: new TimeMap(
        [
          {atQuarters: Rational.ZERO, bpm: 120},
          {atQuarters: Rational.ZERO, bpm: 90},
        ],
        [
          {atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}},
          {atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 3, denominator: 4}},
        ],
        measures,
      ),
    });

    const codes = validateScore(score).map(({code}) => code);
    expect(score.timeMap.tempi.map((entry) => entry.bpm)).toEqual([90]);
    expect(score.timeMap.meters.map((entry) => entry.timeSignature)).toEqual([
      {numerator: 3, denominator: 4},
    ]);
    expect(codes).toEqual(
      expect.arrayContaining([
        'duplicate-part-id',
        'duplicate-note-id',
        'duplicate-measure-id',
        'measure-grid-same-onset',
        'measure-grid-overlap',
      ]),
    );
    expect(codes).not.toContain('duplicate-time-map-tempo-position');
    expect(codes).not.toContain('duplicate-time-map-meter-position');
    expect(() => assertValidScore(score)).toThrow(/duplicate part/i);
  });

  it('detects a stale TimeMap measure snapshot and metadata with no matching entry', () => {
    const first = new Measure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      tempo: {bpm: 120},
      timeSignature: {numerator: 4, denominator: 4},
    });
    const second = new Measure({
      id: MeasureId('m2'),
      number: 2,
      onsetQuarters: new Rational(4),
      durationQuarters: new Rational(4),
      tempo: {bpm: 60},
      timeSignature: {numerator: 3, denominator: 4},
    });
    const score = new Score({
      id: ScoreId('score'),
      metadata: {},
      parts: [],
      measures: [first, second],
      timeMap: new TimeMap(
        [{atQuarters: Rational.ZERO, bpm: 120}],
        [{atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}}],
        [
          {number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(4)},
          {number: 2, onsetQuarters: new Rational(4), durationQuarters: new Rational(3)},
        ],
      ),
    });

    expect(validateScore(score).map(({code}) => code)).toEqual(
      expect.arrayContaining([
        'time-map-measure-snapshot-mismatch',
        'measure-tempo-missing-time-map-entry',
        'measure-time-signature-missing-time-map-entry',
      ]),
    );
  });

  it('reports value mismatches for measure-derived timeline entries with complete provenance', () => {
    const measure = new Measure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      tempo: {bpm: 90},
      timeSignature: {numerator: 3, denominator: 4},
    });
    const timeMap = new TimeMap(
      [{atQuarters: Rational.ZERO, bpm: 120}],
      [{atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}}],
      [measure],
    );
    // A complete provenance vector with no explicit entries means both entries
    // claim to have been inferred from Measure metadata.
    setTimeMapExplicitEntries(timeMap, [], []);
    const score = new Score({
      id: ScoreId('inferred-timeline-mismatch'),
      metadata: {},
      parts: [],
      measures: [measure],
      timeMap,
    });

    expect(validateScore(score).map(({code}) => code)).toEqual(
      expect.arrayContaining([
        'measure-tempo-time-map-mismatch',
        'measure-time-signature-time-map-mismatch',
      ]),
    );
  });

  it('rejects duplicate display measure numbers at the strict JSON boundary', () => {
    const measures = [
      makeMeasure('m1', 1, Rational.ZERO),
      makeMeasure('m2', 1, new Rational(4)),
    ];
    const score = new Score({
      id: ScoreId('duplicate-display-number'),
      metadata: {},
      parts: [],
      measures,
      timeMap: new TimeMap(
        [{atQuarters: Rational.ZERO, bpm: 120}],
        [{atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}}],
        measures,
      ),
    });

    expect(validateScore(score).map(({code}) => code)).toContain('duplicate-measure-number');
    expect(() => scoreFromJSON(JSON.parse(JSON.stringify(score)))).toThrow(/Measure:Beat:Subbeat is ambiguous/);
  });
});

describe('ScoreBuilder integrity guards', () => {
  it('rejects duplicate part, global note, and measure ids before build()', () => {
    const builder = new ScoreBuilder();
    const firstPart = builder.addPart({id: PartId('p1'), name: 'First'});
    const secondPart = builder.addPart({id: PartId('p2'), name: 'Second'});

    expect(() => builder.addPart({id: PartId('p1'), name: 'Duplicate'})).toThrow(/Duplicate part id: p1/);

    const note = {
      id: NoteId('n1'),
      pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice: VoiceId('v'),
    };
    builder.addNote(firstPart, note);
    expect(() => builder.addNote(secondPart, note)).toThrow(/Duplicate note id: n1/);

    const measure = {
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
    };
    builder.addMeasure(measure);
    expect(() => builder.addMeasure(measure)).toThrow(/Duplicate measure id: m1/);
    expect(() => builder.addMeasure({...measure, id: MeasureId('m2')})).toThrow(/Duplicate measure number: 1/);
  });

  it('snapshots every add* input before duplicate bookkeeping and build()', () => {
    const builder = new ScoreBuilder();
    const part = {id: PartId('p1'), name: 'First', transpose: {chromatic: -2}};
    const firstPart = builder.addPart(part);
    part.id = PartId('p2');
    part.name = 'Mutated';
    part.transpose.chromatic = 7;
    builder.addPart({id: PartId('p2'), name: 'Second'});

    const note = {
      id: NoteId('n1'),
      pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice: VoiceId('v'),
      performed: {onsetSec: 0, durationSec: 0.5, velocity: 80},
    };
    builder.addNote(firstPart, note);
    note.id = NoteId('n2');
    note.performed.velocity = 1;
    builder.addNote(firstPart, {...note, performed: {onsetSec: 0, durationSec: 0.5, velocity: 90}});

    const firstMeasure = {
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      tempo: {bpm: 90},
      timeSignature: {numerator: 4, denominator: 4},
    };
    builder.addMeasure(firstMeasure);
    firstMeasure.id = MeasureId('m2');
    firstMeasure.number = 2;
    firstMeasure.tempo.bpm = 30;
    firstMeasure.timeSignature.numerator = 3;
    builder.addMeasure({
      ...firstMeasure,
      onsetQuarters: new Rational(4),
      tempo: {bpm: 120},
      timeSignature: {numerator: 4, denominator: 4},
    });

    const tempo = {atQuarters: Rational.ZERO, bpm: 72};
    const meter = {
      atQuarters: Rational.ZERO,
      measureNumber: 1,
      timeSignature: {numerator: 5, denominator: 4},
    };
    builder.addTempo(tempo);
    builder.addMeter(meter);
    tempo.bpm = 20;
    meter.timeSignature.numerator = 2;

    const score = builder.build();
    expect(score.parts.map(({id}) => id)).toEqual([PartId('p1'), PartId('p2')]);
    expect(score.parts[0].name).toBe('First');
    expect(score.parts[0].transpose).toEqual({chromatic: -2});
    expect(score.parts[0].notes.map(({id}) => id)).toEqual([NoteId('n1'), NoteId('n2')]);
    expect(score.parts[0].notes[0].performed?.velocity).toBe(80);
    expect(score.measures.map(({id, number}) => [id, number])).toEqual([
      [MeasureId('m1'), 1],
      [MeasureId('m2'), 2],
    ]);
    expect(score.timeMap.tempoAt(Rational.ZERO).bpm).toBe(72);
    expect(score.timeMap.timeSignatureAt(Rational.ZERO)).toEqual({numerator: 5, denominator: 4});
  });

  it('snapshots setMetadata JSON-like values before build while retaining non-plain values', () => {
    class ImportSession {
      constructor(readonly id: string) {}
    }

    const session = new ImportSession('session-1');
    // Runtime metadata is intentionally extensible even though the published
    // `encoding` type exposes its standard software/date fields.
    const encoding = {
      software: 'Importer',
      date: '2026-07-11',
      provenance: {parser: {revision: 1}},
    };
    const custom = {
      source: {take: 1},
      tracks: [{name: 'opening'}],
      session,
    };
    const builder = new ScoreBuilder().setMetadata({
      encoding: encoding as unknown as {software?: string; date?: string},
      custom,
    });

    // These happen before build(), which is the gap the Builder must close.
    encoding.software = 'Mutated importer';
    encoding.provenance.parser.revision = 2;
    custom.source.take = 9;
    custom.tracks[0].name = 'mutated';

    const score = builder.build();
    const scoreEncoding = score.metadata.encoding as unknown as typeof encoding;
    expect(scoreEncoding.software).toBe('Importer');
    expect(scoreEncoding.provenance.parser.revision).toBe(1);
    expect(score.metadata.custom?.source).toEqual({take: 1});
    expect(score.metadata.custom?.tracks).toEqual([{name: 'opening'}]);
    expect(score.metadata.custom?.session).toBe(session);

    const extension = new ImportSession('encoding-extension');
    const extensionScore = new ScoreBuilder()
      .setMetadata({encoding: extension as unknown as {software?: string; date?: string}})
      .build();
    expect(extensionScore.metadata.encoding).toBe(extension);
  });

  it('uses the final same-position tempo and meter declaration, including the q=0 anchor', () => {
    const builder = new ScoreBuilder();
    builder.addTempo({atQuarters: Rational.ZERO, bpm: 100});
    builder.addTempo({atQuarters: Rational.ZERO, bpm: 90});
    builder.addMeter({
      atQuarters: Rational.ZERO,
      measureNumber: 1,
      timeSignature: {numerator: 4, denominator: 4},
    });
    builder.addMeter({
      atQuarters: Rational.ZERO,
      measureNumber: 1,
      timeSignature: {numerator: 3, denominator: 4},
    });

    const score = builder.build();
    expect(score.timeMap.tempi).toHaveLength(1);
    expect(score.timeMap.tempoAt(Rational.ZERO).bpm).toBe(90);
    expect(score.timeMap.meters).toHaveLength(1);
    expect(score.timeMap.timeSignatureAt(Rational.ZERO)).toEqual({numerator: 3, denominator: 4});
    expect(validateScore(score)).toEqual([]);

    const restored = scoreFromJSON(JSON.parse(JSON.stringify(score)));
    expect(restored.toJSON()).toEqual(score.toJSON());
  });

  it('keeps explicit meter provenance after no-grid MBS label canonicalisation', () => {
    const builder = new ScoreBuilder();
    builder.addMeter({
      atQuarters: Rational.ZERO,
      measureNumber: 1,
      timeSignature: {numerator: 4, denominator: 4},
    });
    builder.addMeter({
      atQuarters: new Rational(6),
      // MIDI-style source labels can describe this as measure 2 even though
      // the q=4..6 partial measure has already consumed that label.
      measureNumber: 2,
      timeSignature: {numerator: 3, denominator: 4},
    });

    const score = builder.build();
    expect(score.timeMap.meters[1].measureNumber).toBe(3);
    expect(score.toJSON().timeMap.meters[1]).toMatchObject({explicit: true});
  });

  it('rejects an edit that would make Measure:Beat:Subbeat ambiguous', () => {
    const builder = new ScoreBuilder();
    builder.addMeasure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
    });
    builder.addMeasure({
      id: MeasureId('m2'),
      number: 2,
      onsetQuarters: new Rational(4),
      durationQuarters: new Rational(4),
    });
    const score = builder.build();

    expect(() => score.edit((tx) => tx.updateMeasure(MeasureId('m2'), {number: 1}))).toThrow(
      /Duplicate measure number 1/,
    );
  });
});

describe('scoreFromJSON integrity boundary', () => {
  it('rejects serialized ambiguity but accepts valid measureless MIDI-shaped scores', () => {
    const builder = new ScoreBuilder();
    const part = builder.addPart({id: PartId('p'), name: 'MIDI track'});
    builder.addNote(part, {
      id: NoteId('n'),
      pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice: VoiceId('v'),
    });
    const encoded = JSON.parse(JSON.stringify(builder.build()));

    expect(validateScore(scoreFromJSON(encoded))).toEqual([]);

    encoded.parts.push({...encoded.parts[0]});
    expect(() => scoreFromJSON(encoded)).toThrow(/scoreFromJSON: Score integrity validation failed:.*Duplicate part id "p"/s);
  });

  it('normalizes repeated serialized timeline entries with the final declaration winning', () => {
    const builder = new ScoreBuilder();
    const encoded = JSON.parse(JSON.stringify(builder.build()));
    encoded.timeMap.tempi = [
      {atQuarters: [0, 1], bpm: 100},
      {atQuarters: [0, 1], bpm: 90},
    ];
    encoded.timeMap.meters = [
      {atQuarters: [0, 1], measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}},
      {atQuarters: [0, 1], measureNumber: 1, timeSignature: {numerator: 3, denominator: 4}},
    ];

    const restored = scoreFromJSON(encoded);
    expect(restored.timeMap.tempoAt(Rational.ZERO).bpm).toBe(90);
    expect(restored.timeMap.timeSignatureAt(Rational.ZERO)).toEqual({numerator: 3, denominator: 4});
    expect(validateScore(restored)).toEqual([]);
  });

  it('uses the final serialized declaration when restoring explicit timeline provenance', () => {
    const builder = new ScoreBuilder();
    builder.addMeasure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      tempo: {bpm: 90},
    });
    const encoded = JSON.parse(JSON.stringify(builder.build()));
    encoded.timeMap.tempi = [
      {...encoded.timeMap.tempi[0], explicit: true},
      {...encoded.timeMap.tempi[0]},
    ];

    const restored = scoreFromJSON(encoded).edit((tx) => {
      tx.updateMeasure(MeasureId('m1'), {tempo: {bpm: 60}});
    });
    expect(restored.timeMap.tempoAt(Rational.ZERO).bpm).toBe(60);
  });

  it('rejects measure tempo and meter metadata that the serialized TimeMap omits', () => {
    const builder = new ScoreBuilder();
    builder.addMeasure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
    });
    builder.addMeasure({
      id: MeasureId('m2'),
      number: 2,
      onsetQuarters: new Rational(4),
      durationQuarters: new Rational(4),
    });
    const encoded = JSON.parse(JSON.stringify(builder.build()));
    encoded.measures[1].tempo = {bpm: 60};
    encoded.measures[1].timeSignature = {numerator: 3, denominator: 4};

    expect(() => scoreFromJSON(encoded)).toThrow(/missing-time-map-entry|TimeMap has no/i);
  });

  it('rejects inferred timeline values that disagree with Measure metadata', () => {
    const builder = new ScoreBuilder();
    builder.addMeasure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      tempo: {bpm: 120},
      timeSignature: {numerator: 4, denominator: 4},
    });
    const encoded = JSON.parse(JSON.stringify(builder.build()));
    expect(encoded.timeMap.tempi[0].explicit).toBe(false);
    expect(encoded.timeMap.meters[0].explicit).toBe(false);
    encoded.measures[0].tempo = {bpm: 90};
    encoded.measures[0].timeSignature = {numerator: 3, denominator: 4};

    let caught: unknown;
    try {
      scoreFromJSON(encoded);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ScoreJSONError);
    expect((caught as ScoreJSONError).code).toBe('invalid-score');
    expect((caught as Error).message).toMatch(/inferred TimeMap entry is 120 bpm/);
    expect((caught as Error).message).toMatch(/inferred TimeMap entry is 4\/4/);
  });

  it('allows intentional explicit overrides and provenance-unknown legacy timelines', () => {
    const builder = new ScoreBuilder();
    builder.addMeasure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      tempo: {bpm: 90},
      timeSignature: {numerator: 3, denominator: 4},
    });
    builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
    builder.addMeter({
      atQuarters: Rational.ZERO,
      measureNumber: 1,
      timeSignature: {numerator: 4, denominator: 4},
    });

    const explicit = scoreFromJSON(JSON.parse(JSON.stringify(builder.build())));
    expect(explicit.timeMap.tempoAt(Rational.ZERO).bpm).toBe(120);
    expect(explicit.timeMap.timeSignatureAt(Rational.ZERO)).toEqual({numerator: 4, denominator: 4});

    const [measure] = explicit.measures;
    const unknown = new Score({
      id: ScoreId('unknown-timeline-provenance'),
      metadata: {},
      parts: [],
      measures: [measure],
      timeMap: new TimeMap(
        [{atQuarters: Rational.ZERO, bpm: 110}],
        [{atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 2, denominator: 4}}],
        [measure],
      ),
    });
    const legacy = scoreFromJSON(JSON.parse(JSON.stringify(unknown)));
    expect(validateScore(legacy)).toEqual([]);
    expect(legacy.timeMap.tempoAt(Rational.ZERO).bpm).toBe(110);
    expect(legacy.timeMap.timeSignatureAt(Rational.ZERO)).toEqual({numerator: 2, denominator: 4});
  });
});
