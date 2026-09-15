import { Duration, PartId, Pitch, Rational, ScoreBuilder, VoiceId, noteMidi, scoreNotes } from '../../src/core';
import { describe, expect, it } from 'vitest';
import { ABCParseLimitError, parseABC, parseABCDetailed, serializeABC, serializeABCDetailed } from '../../src/io/formats/abc';
import { loadScore, loadScoreDetailed } from '../../src/io/load';

const HEADER = 'X:1\nM:4/4\nL:1/4\nK:C\n';

describe('ABC parser resource limits', () => {
  it('rejects an oversized individual duration before materializing measures', () => {
    expect(() => parseABC(`${HEADER}C100000`)).toThrow(ABCParseLimitError);
    expect(() => parseABC(`${HEADER}C100000`)).toThrow(/maxDurationQuarters/);
  });

  it('limits token and generated-measure counts with clear errors', () => {
    expect(() => parseABC(`${HEADER}${'C '.repeat(5)}`, { maxTokens: 4 })).toThrow(/maxTokens/);
    expect(() => parseABC(`${HEADER}z16`, { maxDurationQuarters: 32, maxMeasures: 3 })).toThrow(/maxMeasures/);
  });

  it('allows a trusted caller to raise a limit explicitly', () => {
    const score = parseABC(`${HEADER}C64`, {
      maxDurationQuarters: 64,
      maxMeasures: 32,
    });
    expect(scoreNotes(score)).toHaveLength(1);
    expect(score.measures).toHaveLength(16);
  });

  it('rejects oversized binary ABC before decoding it', async () => {
    const bytes = new TextEncoder().encode(`${HEADER}C`);
    await expect(loadScore(bytes, { format: 'abc', abc: { maxInputBytes: 4 } })).rejects.toThrow(/maxInputBytes/);
  });

  it('materializes z rests so their timing survives an ABC round-trip', () => {
    const once = parseABC(`${HEADER}C z2 D`);
    const firstRest = [...once.allNotes()].find((note) => note.rest);

    expect(firstRest).toBeDefined();
    expect(firstRest!.onsetQuarters.toFloat()).toBe(1);
    expect(firstRest!.duration.quarters.toFloat()).toBe(2);
    expect(scoreNotes(once).map((note) => note.onsetQuarters.toFloat())).toEqual([0, 3]);

    const twice = parseABC(serializeABC(once));
    const secondRest = [...twice.allNotes()].find((note) => note.rest);

    expect(secondRest).toBeDefined();
    expect(secondRest!.onsetQuarters.toFloat()).toBe(1);
    expect(secondRest!.duration.quarters.toFloat()).toBe(2);
    expect(scoreNotes(twice).map((note) => note.onsetQuarters.toFloat())).toEqual([0, 3]);
  });

  it('preserves common slash duration forms through direct and load APIs', async () => {
    const abc = `${HEADER}C C2 C/ C// C3/ C3// C/2 C3/2`;
    const expected = ['1', '2', '1/2', '1/4', '3/2', '3/4', '1/2', '3/2'];
    const durations = (score: Awaited<ReturnType<typeof loadScore>>) =>
      scoreNotes(score).map((note) => note.duration.quarters.toString());

    expect(durations(parseABC(abc))).toEqual(expected);
    await expect(loadScore(abc, { format: 'abc' }).then(durations)).resolves.toEqual(expected);
  });

  it('skips lyrics, fields, directives, and comments instead of turning their letters into notes', () => {
    const abc = `${HEADER}w: C D E
C: Composer C D
%%MIDI program 1
C % D E
D
[K:G] [CEG] E`;
    const detailed = parseABCDetailed(abc);

    expect(scoreNotes(detailed.score).map((note) => note.pitch.toString())).toEqual(['C4', 'D4', 'E4']);
    expect(detailed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'abc-lyrics-ignored',
        'abc-header-fields-ignored',
        'abc-directives-ignored',
        'abc-comments-ignored',
        'abc-chords-or-inline-fields-ignored',
      ]),
    );
  });

  it('skips quoted annotations instead of tokenizing chord-symbol text as notes', () => {
    const detailed = parseABCDetailed(`${HEADER}"Cmaj7" C "G7" D`);

    expect(scoreNotes(detailed.score).map((note) => note.pitch.toString())).toEqual(['C4', 'D4']);
    expect(detailed.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'abc-quoted-annotations-ignored' })]),
    );
  });

  it('does not turn grace or decoration text into notes', () => {
    const grace = parseABCDetailed(`${HEADER}C {c} D`);
    const decoration = parseABCDetailed(`${HEADER}!fermata! C`);

    expect(scoreNotes(grace.score).map((note) => [note.pitch.toString(), note.onsetQuarters.toString()])).toEqual([
      ['C4', '0'],
      ['D4', '1'],
    ]);
    expect(scoreNotes(decoration.score).map((note) => note.pitch.toString())).toEqual(['C4']);
    expect(grace.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({code: 'abc-grace-notes-ignored'})]),
    );
    expect(decoration.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({code: 'abc-decorations-ignored'})]),
    );
  });

  it('writes implicit rests from note onsets when serializing a sparse monophonic part', () => {
    const builder = new ScoreBuilder();
    const part = PartId('p');
    const voice = VoiceId('p-v1');
    builder.addPart({ id: part, name: 'Sparse' });
    builder.addNote(part, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C4'),
      onsetQuarters: new Rational(2),
      duration: Duration.quarter(),
      voice,
    });
    builder.addNote(part, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('D4'),
      onsetQuarters: new Rational(4),
      duration: Duration.quarter(),
      voice,
    });

    const serialized = serializeABC(builder.build());
    const twice = parseABC(serialized);

    expect(serialized).toContain('z2');
    expect(scoreNotes(twice).map((note) => [note.pitch.toString(), note.onsetQuarters.toString()])).toEqual([
      ['C4', '2'],
      ['D4', '4'],
    ]);
  });

  it('reports and skips overlapping notes rather than retiming them during minimal serialization', () => {
    const builder = new ScoreBuilder();
    const part = PartId('p');
    const voice = VoiceId('p-v1');
    builder.addPart({ id: part, name: 'Overlap' });
    for (const [pitch, onset, duration] of [
      ['C4', 0, 2],
      ['E4', 1, 1],
      ['G4', 2, 1],
    ] as const) {
      builder.addNote(part, {
        id: builder.newNoteId(),
        pitch: Pitch.parse(pitch),
        onsetQuarters: new Rational(onset),
        duration: new Duration({ base: new Rational(duration) }),
        voice,
      });
    }

    const serialized = serializeABCDetailed(builder.build());
    const twice = parseABC(serialized.data);

    expect(serialized.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'abc-overlapping-notes-skipped' })]),
    );
    expect(scoreNotes(twice).map((note) => [note.pitch.toString(), note.onsetQuarters.toString()])).toEqual([
      ['C4', '0'],
      ['G4', '2'],
    ]);
  });

  it('reports unsupported ABC semantics through the detailed parser and loader', async () => {
    const abc = `${HEADER}K:G\nQ:1/4=90\nV:melody\nC |: (3DEF [CEG] A>B {c} & :|`;
    const direct = parseABCDetailed(abc);
    const loaded = await loadScoreDetailed(abc, { format: 'abc' });
    const codes = direct.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        'abc-key-signature-ignored',
        'abc-tempo-ignored',
        'abc-voices-ignored',
        'abc-repeats-ignored',
        'abc-tuplets-ignored',
        'abc-chords-or-inline-fields-ignored',
        'abc-broken-rhythm-ignored',
        'abc-grace-notes-ignored',
        'abc-overlay-ignored',
      ]),
    );
    expect(loaded.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(codes);
    // C D E F A B survive; the chord, grace note, and overlay content do not,
    // and the ignored K:G inline field leaves F natural.
    const expectedMidis = [60, 62, 64, 65, 69, 71];
    expect(scoreNotes(direct.score).map(noteMidi)).toEqual(expectedMidis);
    expect(scoreNotes(parseABC(abc)).map(noteMidi)).toEqual(expectedMidis);
  });
});

describe('ABC accidental serialization', () => {
  it('round-trips flats at the same MIDI pitch instead of shifting them down', () => {
    const abc = `${HEADER}_B _E ^F _C`;
    const once = parseABC(abc);
    expect(scoreNotes(once).map((note) => note.pitch.midi)).toEqual([70, 63, 66, 59]);

    const serialized = serializeABC(once);
    const twice = parseABC(serialized);
    expect(scoreNotes(twice).map((note) => note.pitch.midi)).toEqual([70, 63, 66, 59]);

    // The original spelling survives too: flats stay flats, not sharp respellings.
    expect(serialized).toContain('_B');
    expect(serialized).toContain('_E');
    expect(serialized).toContain('_C');
    expect(serialized).toContain('^F');
  });

  it('keeps sharp spellings stable across repeated round-trips', () => {
    const abc = `${HEADER}^C ^G ^A`;
    const once = serializeABC(parseABC(abc));
    const twice = serializeABC(parseABC(once));

    expect(twice).toBe(once);
    expect(scoreNotes(parseABC(twice)).map((note) => note.pitch.midi)).toEqual([61, 68, 70]);
  });

  it('round-trips double accidentals and naturals at the same MIDI pitch', () => {
    const abc = `${HEADER}__B ^^F =B`;
    const once = parseABC(abc);
    expect(scoreNotes(once).map((note) => note.pitch.midi)).toEqual([69, 67, 71]);

    const twice = parseABC(serializeABC(once));
    expect(scoreNotes(twice).map((note) => note.pitch.midi)).toEqual([69, 67, 71]);
  });
});
