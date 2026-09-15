import {describe, expect, it} from 'vitest';
import {
  Duration,
  Measure,
  MeasureId,
  Pitch,
  Rational,
  Score,
  ScoreBuilder,
  SCORE_JSON_SCHEMA_ID,
  ScoreJSONError,
  ScoreId,
  TimeMap,
  scoreFromJSON,
} from '../../src/core';

function buildRichScore() {
  const b = new ScoreBuilder();
  b.setMetadata({title: 'Rich', composer: 'Test'});
  const partId = b.addPart({id: b.newPartId(), name: 'Piano', staves: 2});
  const voice = b.newVoiceId();
  b.addNote(partId, {
    id: b.newNoteId(),
    pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO,
    duration: Duration.quarter(),
    voice,
    performed: {onsetSec: 0.01, durationSec: 0.45, velocity: 90},
    articulations: ['staccato', 'accent'],
    tie: 'start',
    slur: 'start',
    dynamic: 'mf',
    lyric: 'la',
    staff: 1,
  });
  b.addNote(partId, {
    id: b.newNoteId(),
    pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ONE,
    duration: Duration.quarter(),
    voice,
    tie: 'stop',
    slur: 'stop',
  });
  b.addMeasure({
    id: b.newMeasureId(),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature: {numerator: 4, denominator: 4},
    keySignature: {fifths: 2, mode: 'major'},
    tempo: {bpm: 90},
    repeat: {start: true},
  });
  b.addMeasure({
    id: b.newMeasureId(),
    number: 2,
    onsetQuarters: new Rational(4),
    durationQuarters: new Rational(4),
    repeat: {end: true, times: 2},
    volta: [1, 2],
  });
  return b.build();
}

describe('scoreFromJSON rich round-trip', () => {
  it('preserves performed/articulations/tie/slur/repeat/volta/keySignature', () => {
    const score = buildRichScore();
    const back = scoreFromJSON(JSON.parse(JSON.stringify(score)));

    const [n1, n2] = [...back.allNotes()];
    expect(n1.performed).toEqual({onsetSec: 0.01, durationSec: 0.45, velocity: 90});
    expect(n1.articulations).toEqual(['staccato', 'accent']);
    expect(n1.tie).toBe('start');
    expect(n1.slur).toBe('start');
    expect(n1.dynamic).toBe('mf');
    expect(n1.lyric).toBe('la');
    expect(n1.staff).toBe(1);
    expect(n2.tie).toBe('stop');
    expect(n2.slur).toBe('stop');

    const [m1, m2] = back.measures;
    expect(m1.keySignature).toEqual({fifths: 2, mode: 'major'});
    expect(m1.tempo).toEqual({bpm: 90});
    expect(m1.repeat).toEqual({start: true});
    expect(m2.repeat).toEqual({end: true, times: 2});
    expect(m2.volta).toEqual([1, 2]);

    // Measure tempo survives the trip via the time map (8q at 90 bpm).
    expect(back.durationSeconds).toBeCloseTo(score.durationSeconds);
  });

  it('preserves explicit time-map provenance across a JSON round-trip', () => {
    const builder = new ScoreBuilder();
    builder.addMeasure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      tempo: {bpm: 120},
      timeSignature: {numerator: 4, denominator: 4},
    });
    builder.addMeasure({
      id: MeasureId('m2'),
      number: 2,
      onsetQuarters: new Rational(4),
      durationQuarters: new Rational(4),
      tempo: {bpm: 90},
      timeSignature: {numerator: 3, denominator: 4},
    });
    // These duplicate the measure-derived entries exactly. Their provenance,
    // not their value, is what makes them intentional overrides on later
    // measure edits.
    builder.addTempo({atQuarters: new Rational(4), bpm: 90});
    builder.addMeter({
      atQuarters: new Rational(4),
      measureNumber: 2,
      timeSignature: {numerator: 3, denominator: 4},
    });
    const original = builder.build();
    const encoded = JSON.parse(JSON.stringify(original));
    expect(encoded.timeMap.tempi[0].explicit).toBe(false);
    expect(encoded.timeMap.meters[0].explicit).toBe(false);
    expect(encoded.timeMap.tempi[1].explicit).toBe(true);
    expect(encoded.timeMap.meters[1].explicit).toBe(true);

    const editSecondMeasure = (score: typeof original) =>
      score.edit((tx) => {
        tx.updateMeasure(MeasureId('m2'), {
          tempo: {bpm: 60},
          timeSignature: {numerator: 2, denominator: 4},
        });
      });

    const editedDirectly = editSecondMeasure(original);
    const editedAfterRoundTrip = editSecondMeasure(scoreFromJSON(encoded));

    // The explicit q=4 entries continue to win after both edit paths.
    expect(editedDirectly.timeMap.tempoAt(new Rational(4)).bpm).toBe(90);
    expect(editedDirectly.timeMap.timeSignatureAt(new Rational(4))).toEqual({numerator: 3, denominator: 4});
    expect(editedAfterRoundTrip.toJSON()).toEqual(editedDirectly.toJSON());
  });

  it('keeps builder-known inferred timeline entries inferred across a JSON round-trip', () => {
    const builder = new ScoreBuilder();
    builder.addMeasure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      tempo: {bpm: 100},
      timeSignature: {numerator: 3, denominator: 4},
    });

    const encoded = JSON.parse(JSON.stringify(builder.build()));
    expect(encoded.timeMap.tempi[0].explicit).toBe(false);
    expect(encoded.timeMap.meters[0].explicit).toBe(false);

    const edited = scoreFromJSON(encoded).edit((tx) => {
      tx.updateMeasure(MeasureId('m1'), {
        tempo: {bpm: 60},
        timeSignature: {numerator: 2, denominator: 4},
      });
    });
    expect(edited.timeMap.tempoAt(Rational.ZERO).bpm).toBe(60);
    expect(edited.timeMap.timeSignatureAt(Rational.ZERO)).toEqual({numerator: 2, denominator: 4});
  });

  it('preserves unknown direct TimeMap provenance across a JSON round-trip', () => {
    const measure = new Measure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      tempo: {bpm: 100},
      timeSignature: {numerator: 3, denominator: 4},
    });
    const direct = new Score({
      id: ScoreId('direct-time-map-json'),
      metadata: {},
      parts: [],
      measures: [measure],
      timeMap: new TimeMap(
        [{atQuarters: Rational.ZERO, bpm: 100}],
        [{atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 3, denominator: 4}}],
        [measure],
      ),
    });

    const encoded = JSON.parse(JSON.stringify(direct));
    expect(encoded.timeMap.tempi[0]).not.toHaveProperty('explicit');
    expect(encoded.timeMap.meters[0]).not.toHaveProperty('explicit');

    const edited = scoreFromJSON(encoded).edit((tx) => {
      tx.updateMeasure(MeasureId('m1'), {tempo: undefined, timeSignature: undefined});
    });
    expect(edited.timeMap.tempoAt(Rational.ZERO).bpm).toBe(100);
    expect(edited.timeMap.timeSignatureAt(Rational.ZERO)).toEqual({numerator: 3, denominator: 4});
  });
});

describe('scoreFromJSON validation', () => {
  const valid = () => JSON.parse(JSON.stringify(buildRichScore()));

  it('rejects non-object input', () => {
    expect(() => scoreFromJSON(null)).toThrow(/must be an object/);
    expect(() => scoreFromJSON('nope')).toThrow(/must be an object/);
  });

  it('rejects an unknown $schema', () => {
    const j = valid();
    j.$schema = 'https://example.com/other-schema';
    expect(() => scoreFromJSON(j)).toThrow(/\$schema/);
    try {
      scoreFromJSON(j);
    } catch (error) {
      expect(error).toBeInstanceOf(ScoreJSONError);
      expect((error as ScoreJSONError).code).toBe('unsupported-schema');
    }
  });

  it('rejects unknown future WebScore schema versions', () => {
    const j = valid();
    j.$schema = 'https://webscore.dev/schema/score/v999';
    expect(() => scoreFromJSON(j)).toThrow(new RegExp(`supported: ${SCORE_JSON_SCHEMA_ID}`));
  });

  it('accepts a missing $schema', () => {
    const j = valid();
    delete j.$schema;
    expect(() => scoreFromJSON(j)).not.toThrow();
  });

  it('rejects a part without its required name', () => {
    const j = valid();
    delete j.parts[0].name;
    expect(() => scoreFromJSON(j)).toThrow(/part .* name must be a string/);
  });

  it('emits the exact supported schema marker', () => {
    expect(buildRichScore().toJSON().$schema).toBe(SCORE_JSON_SCHEMA_ID);
  });

  it('rejects missing required top-level fields', () => {
    for (const field of ['id', 'parts', 'measures', 'timeMap']) {
      const j = valid();
      delete j[field];
      expect(() => scoreFromJSON(j)).toThrow(new RegExp(field === 'id' ? 'score.id' : field));
    }
  });

  it('rejects malformed notes with a clear message', () => {
    const j = valid();
    delete j.parts[0].notes[0].pitch;
    expect(() => scoreFromJSON(j)).toThrow(/missing pitch/);

    const j2 = valid();
    j2.parts[0].notes[0].onsetQuarters = 'bad';
    expect(() => scoreFromJSON(j2)).toThrow(/onsetQuarters/);

    const j3 = valid();
    j3.parts[0].notes[0].pitch = {step: 'Z', alter: 'x', octave: {}};
    expect(() => scoreFromJSON(j3)).toThrow(/pitch\.step/);
    try {
      scoreFromJSON(j3);
    } catch (error) {
      expect(error).toBeInstanceOf(ScoreJSONError);
      expect((error as ScoreJSONError).code).toBe('invalid-json');
    }

    const j4 = valid();
    j4.parts[0].notes[0].onsetQuarters = [1, 0];
    expect(() => scoreFromJSON(j4)).toThrow(/non-zero safe integer denominator/);
  });

  it('rejects malformed measures with a clear message', () => {
    const j = valid();
    delete j.measures[0].durationQuarters;
    expect(() => scoreFromJSON(j)).toThrow(/durationQuarters/);

    const j2 = valid();
    j2.measures[0].number = 'one';
    expect(() => scoreFromJSON(j2)).toThrow(/number/);
  });

  it('rejects malformed present known fields with invalid-json', () => {
    const reject = (mutate: (json: any) => void, message: RegExp): void => {
      const json = valid();
      mutate(json);
      let caught: unknown;
      try {
        scoreFromJSON(json);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ScoreJSONError);
      expect((caught as ScoreJSONError).code).toBe('invalid-json');
      expect((caught as Error).message).toMatch(message);
    };

    reject((json) => { json.metadata = 42; }, /score\.metadata must be an object/);
    reject((json) => { json.metadata.title = 42; }, /metadata\.title must be a string/);
    reject((json) => { json.metadata.encoding = []; }, /metadata\.encoding must be an object/);
    reject((json) => { json.metadata.custom = []; }, /metadata\.custom must be an object/);
    reject((json) => { json.measures[0].keySignature = 42; }, /keySignature must be an object/);
    reject((json) => { json.measures[0].keySignature.fifths = 8; }, /fifths must be an integer from -7 to 7/);
    reject((json) => { json.measures[0].keySignature.mode = 'ionian'; }, /mode must be one of/);
    reject((json) => { json.measures[0].repeat.start = 'yes'; }, /repeat\.start must be a boolean/);
    reject((json) => { json.measures[1].volta = '1,2'; }, /volta must be an array/);
    reject((json) => { json.measures[0].clef = {sign: 'Z'}; }, /clef\.sign must be one of/);
    reject((json) => { json.measures[0].timeSignature.denominator = 0; }, /denominator must be a positive/);
    reject((json) => { json.measures[0].tempo.bpm = 'fast'; }, /tempo\.bpm must be a finite number/);

    reject((json) => { json.parts[0].notes[0].articulations = 'staccato'; }, /articulations must be an array/);
    reject((json) => { json.parts[0].notes[0].ornaments = ['shake']; }, /ornaments\[0\] must be one of/);
    reject((json) => { json.parts[0].notes[0].tie = 'begin'; }, /tie must be one of/);
    reject((json) => { json.parts[0].notes[0].slur = {type: 'start', number: 0}; }, /slur\.number/);
    reject((json) => { json.parts[0].notes[0].tags = 'recorded'; }, /tags must be an array/);
    reject((json) => { json.parts[0].notes[0].grace = {slash: 'yes'}; }, /grace\.slash must be a boolean/);
  });

  it('retains open metadata extension values after validating standard fields', () => {
    const json = valid();
    json.metadata.encoding = {software: 'WebScore test', provenance: {parser: 'custom-importer'}};
    json.metadata.custom = {plugin: {revision: 2}};

    const restored = scoreFromJSON(json);
    expect((restored.metadata.encoding as any).provenance).toEqual({parser: 'custom-importer'});
    expect(restored.metadata.custom).toEqual({plugin: {revision: 2}});
  });
});
