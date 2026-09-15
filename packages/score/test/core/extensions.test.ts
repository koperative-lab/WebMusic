import {describe, expect, it} from 'vitest';
import {
  Duration,
  Note,
  NoteId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
  expandRepeats,
  mergedTiedNotes,
  notesAt,
  notesIn,
  notesOverlapping,
  playedDurationSeconds,
  restsIn,
  scoreFromJSON,
  soundingPitch,
  tieChains,
  writtenPitch,
  type Clef,
  type NoteData,
} from '../../src/core';

function builderWithMeasures(count: number, extras: Array<Partial<Parameters<ScoreBuilder['addMeasure']>[0]>> = []) {
  const b = new ScoreBuilder();
  for (let i = 0; i < count; i++) {
    b.addMeasure({
      id: b.newMeasureId(),
      number: i + 1,
      onsetQuarters: new Rational(4 * i),
      durationQuarters: new Rational(4),
      ...(i === 0 ? {timeSignature: {numerator: 4, denominator: 4}, tempo: {bpm: 120}} : {}),
      ...(extras[i] ?? {}),
    });
  }
  return b;
}

function quarterNote(b: ScoreBuilder, voice: ReturnType<ScoreBuilder['newVoiceId']>, pitch: string, onset: Rational, patch: Partial<NoteData> = {}): NoteData {
  return {
    id: b.newNoteId(),
    pitch: Pitch.parse(pitch),
    onsetQuarters: onset,
    duration: Duration.quarter(),
    voice,
    ...patch,
  };
}

describe('clef', () => {
  it('round-trips clef and per-staff clefs through JSON', () => {
    const treble: Clef = {sign: 'G', line: 2};
    const bass: Clef = {sign: 'F', line: 4, octaveChange: -1};
    const b = builderWithMeasures(1, [{clef: treble, clefs: {1: treble, 2: bass}}]);
    const partId = b.addPart({id: b.newPartId(), name: 'Piano', staves: 2});
    b.addNote(partId, quarterNote(b, b.newVoiceId(), 'C4', Rational.ZERO));
    const score = b.build();

    expect(score.measures[0].clef).toEqual(treble);
    const back = scoreFromJSON(JSON.parse(JSON.stringify(score)));
    expect(back.measures[0].clef).toEqual(treble);
    expect(back.measures[0].clefs?.[2]).toEqual(bass);
    expect(back.parts[0].staves).toBe(2);
  });
});

describe('rests', () => {
  function scoreWithRest() {
    const b = builderWithMeasures(1);
    const partId = b.addPart({id: b.newPartId(), name: 'Flute'});
    const v = b.newVoiceId();
    b.addNote(partId, quarterNote(b, v, 'C4', Rational.ZERO));
    b.addNote(partId, {
      id: b.newNoteId(),
      rest: true,
      onsetQuarters: Rational.ONE,
      duration: Duration.quarter(),
      voice: v,
    });
    b.addNote(partId, quarterNote(b, v, 'D4', new Rational(2)));
    return b.build();
  }

  it('constructor rejects a non-rest note without pitch', () => {
    expect(
      () =>
        new Note({
          id: NoteId('bad'),
          onsetQuarters: Rational.ZERO,
          duration: Duration.quarter(),
          voice: VoiceId('v1'),
        }),
    ).toThrow(/must have a pitch/);
  });

  it('queries exclude rests by default and include them via option', () => {
    const score = scoreWithRest();
    expect(notesAt(score, Rational.ONE)).toHaveLength(0);
    expect(notesAt(score, Rational.ONE, {includeRests: true})).toHaveLength(1);
    expect(notesIn(score, Rational.ZERO, new Rational(4))).toHaveLength(2);
    expect(notesIn(score, Rational.ZERO, new Rational(4), {includeRests: true})).toHaveLength(3);
    expect(notesOverlapping(score, Rational.ZERO, new Rational(4))).toHaveLength(2);
    expect(
      notesOverlapping(score, Rational.ZERO, new Rational(4), {includeRests: true}),
    ).toHaveLength(3);
  });

  it('restsIn returns only the rest notes', () => {
    const score = scoreWithRest();
    const rests = restsIn(score, Rational.ZERO, new Rational(4));
    expect(rests).toHaveLength(1);
    expect(rests[0].rest).toBe(true);
  });

  it('rest notes without pitch round-trip; non-rest without pitch fails validation', () => {
    const score = scoreWithRest();
    const json = JSON.parse(JSON.stringify(score));
    const back = scoreFromJSON(json);
    const rest = [...back.allNotes()].find((n) => n.rest);
    expect(rest).toBeDefined();
    expect(rest!.pitch).toBeUndefined();
    expect(rest!.duration.quarters.eq(Rational.ONE)).toBe(true);

    const bad = JSON.parse(JSON.stringify(score));
    const restNote = bad.parts[0].notes.find((n: any) => n.rest);
    delete restNote.rest; // now a pitchless non-rest → invalid
    expect(() => scoreFromJSON(bad)).toThrow(/missing pitch/);
  });
});

describe('grace notes', () => {
  function scoreWithGrace() {
    const b = builderWithMeasures(1);
    const partId = b.addPart({id: b.newPartId(), name: 'Violin'});
    const v = b.newVoiceId();
    b.addNote(partId, {
      id: b.newNoteId(),
      pitch: Pitch.parse('B3'),
      onsetQuarters: Rational.ONE,
      duration: new Duration({base: 0}), // zero notated duration
      voice: v,
      grace: {slash: true, stealQuarters: 0.25},
    });
    b.addNote(partId, quarterNote(b, v, 'C4', Rational.ONE));
    return b.build();
  }

  it('notesAt returns zero-duration grace notes at their onset by default', () => {
    const score = scoreWithGrace();
    const at = notesAt(score, Rational.ONE);
    expect(at.map((n) => n.pitch.toString()).sort()).toEqual(['B3', 'C4']);
    const without = notesAt(score, Rational.ONE, {includeGrace: false});
    expect(without.map((n) => n.pitch.toString())).toEqual(['C4']);
  });

  it('notesOverlapping includes grace notes whose onset is inside the window', () => {
    const score = scoreWithGrace();
    expect(notesOverlapping(score, Rational.ZERO, new Rational(2))).toHaveLength(2);
    expect(
      notesOverlapping(score, Rational.ZERO, new Rational(2), {includeGrace: false}),
    ).toHaveLength(1);
  });

  it('grace attributes round-trip through JSON', () => {
    const score = scoreWithGrace();
    const back = scoreFromJSON(JSON.parse(JSON.stringify(score)));
    const grace = [...back.allNotes()].find((n) => n.grace);
    expect(grace?.grace).toEqual({slash: true, stealQuarters: 0.25});
  });
});

describe('transposing instruments', () => {
  it('soundingPitch / writtenPitch for a Bb clarinet (chromatic -2)', () => {
    const b = builderWithMeasures(1);
    const partId = b.addPart({
      id: b.newPartId(),
      name: 'Clarinet in Bb',
      transpose: {chromatic: -2, diatonic: -1},
    });
    const v = b.newVoiceId();
    b.addNote(partId, quarterNote(b, v, 'D4', Rational.ZERO));
    const score = b.build();
    const part = score.parts[0];
    const note = part.notes[0];

    expect(soundingPitch(note, part).toString()).toBe('C4'); // written D4 sounds C4
    // Inverse: a concert C4 is written D4 for the player.
    const concert = note.with({pitch: Pitch.parse('C4')});
    expect(writtenPitch(concert, part).toString()).toBe('D4');
    // Round-trip via JSON keeps the transpose field.
    const back = scoreFromJSON(JSON.parse(JSON.stringify(score)));
    expect(back.parts[0].transpose).toEqual({chromatic: -2, diatonic: -1});
    expect(soundingPitch(back.parts[0].notes[0], back.parts[0]).midi).toBe(60);
  });

  it('octaveChange shifts by 12 semitones', () => {
    const b = builderWithMeasures(1);
    const partId = b.addPart({
      id: b.newPartId(),
      name: 'Piccolo',
      transpose: {chromatic: 0, octaveChange: 1},
    });
    b.addNote(partId, quarterNote(b, b.newVoiceId(), 'C5', Rational.ZERO));
    const part = b.build().parts[0];
    expect(soundingPitch(part.notes[0], part).toString()).toBe('C6');
  });
});

describe('tie chains', () => {
  it('groups tied notes per voice/pitch and merges durations', () => {
    const b = builderWithMeasures(2);
    const partId = b.addPart({id: b.newPartId(), name: 'Cello'});
    const v = b.newVoiceId();
    // C4 tied across three notes: 1 + 1 + 2 quarters.
    b.addNote(partId, quarterNote(b, v, 'C4', Rational.ZERO, {tie: 'start'}));
    b.addNote(partId, quarterNote(b, v, 'C4', Rational.ONE, {tie: 'continue'}));
    b.addNote(partId, {
      id: b.newNoteId(),
      pitch: Pitch.parse('C4'),
      onsetQuarters: new Rational(2),
      duration: Duration.half(),
      voice: v,
      tie: 'stop',
    });
    // Untied G4 in the middle (different pitch — must not join the chain).
    b.addNote(partId, quarterNote(b, v, 'G4', Rational.ONE));
    const part = b.build().parts[0];

    const chains = tieChains(part);
    expect(chains).toHaveLength(2);
    const cChain = chains.find((c) => c.length === 3)!;
    expect(cChain.map((n) => n.tie)).toEqual(['start', 'continue', 'stop']);

    const merged = mergedTiedNotes(part);
    expect(merged).toHaveLength(2);
    const cEvent = merged.find((e) => e.notes.length === 3)!;
    expect(cEvent.first).toBe(cChain[0]);
    expect(cEvent.onsetQuarters.eq(Rational.ZERO)).toBe(true);
    expect(cEvent.durationQuarters.eq(new Rational(4))).toBe(true);
    const gEvent = merged.find((e) => e.notes.length === 1)!;
    expect(gEvent.durationQuarters.eq(Rational.ONE)).toBe(true);
  });

  it('handles malformed ties: stop without start is standalone', () => {
    const b = builderWithMeasures(1);
    const partId = b.addPart({id: b.newPartId(), name: 'Oboe'});
    const v = b.newVoiceId();
    b.addNote(partId, quarterNote(b, v, 'E4', Rational.ZERO, {tie: 'stop'}));
    b.addNote(partId, quarterNote(b, v, 'F4', Rational.ONE, {tie: 'start'})); // never stopped
    const part = b.build().parts[0];
    const chains = tieChains(part);
    expect(chains).toHaveLength(2);
    expect(chains.every((c) => c.length === 1)).toBe(true);
  });
});

describe('expandRepeats', () => {
  function noteEveryMeasure(b: ScoreBuilder, partId: ReturnType<ScoreBuilder['newPartId']>, count: number) {
    const v = b.newVoiceId();
    for (let i = 0; i < count; i++) {
      b.addNote(partId, {
        id: b.newNoteId(),
        pitch: Pitch.parse('C4'),
        onsetQuarters: new Rational(4 * i),
        duration: Duration.whole(),
        voice: v,
      });
    }
  }

  it('a simple repeat pair doubles quarters and seconds', () => {
    const b = builderWithMeasures(2, [{repeat: {start: true}}, {repeat: {end: true}}]);
    const partId = b.addPart({id: b.newPartId(), name: 'P'});
    noteEveryMeasure(b, partId, 2);
    const score = b.build();

    expect(score.durationQuarters.eq(new Rational(8))).toBe(true);
    const expanded = expandRepeats(score);
    expect(expanded.durationQuarters.eq(new Rational(16))).toBe(true);
    expect(expanded.measures).toHaveLength(4);
    expect(expanded.measures.map((m) => m.number)).toEqual([1, 2, 3, 4]);
    expect(expanded.notes).toHaveLength(4);
    expect(playedDurationSeconds(score)).toBeCloseTo(score.durationSeconds * 2);
    // Repeated occurrences get fresh, unambiguous ids.
    const ids = expanded.measures.map((m) => m.id);
    expect(new Set(ids).size).toBe(4);
    // Repeat markers are stripped from the result.
    expect(expanded.measures.every((m) => m.repeat === undefined)).toBe(true);
  });

  it('replays mid-measure map events and shifts performed timing for each repeat', () => {
    const b = builderWithMeasures(2, [{repeat: {start: true}}, {repeat: {end: true}}]);
    // The first measure slows down halfway through, then the second restores
    // the original tempo/meter. Both changes must recur on the second pass.
    b.addTempo({atQuarters: new Rational(2), bpm: 60});
    b.addTempo({atQuarters: new Rational(4), bpm: 120});
    b.addMeter({
      atQuarters: new Rational(2),
      measureNumber: 1,
      timeSignature: {numerator: 3, denominator: 4},
    });
    b.addMeter({
      atQuarters: new Rational(4),
      measureNumber: 2,
      timeSignature: {numerator: 4, denominator: 4},
    });
    const partId = b.addPart({id: b.newPartId(), name: 'P'});
    const voice = b.newVoiceId();
    const repeatedId = b.newNoteId();
    b.addNote(partId, {
      id: repeatedId,
      pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ONE,
      duration: Duration.quarter(),
      voice,
      performed: {onsetSec: 0.6, durationSec: 0.2, velocity: 90},
    });
    b.addNote(partId, quarterNote(b, voice, 'D4', new Rational(4)));
    const expanded = expandRepeats(b.build());

    expect(expanded.timeMap.tempoAt(new Rational(10)).bpm).toBe(60);
    expect(expanded.timeMap.timeSignatureAt(new Rational(10))).toEqual({numerator: 3, denominator: 4});
    expect(expanded.timeMap.tempoAt(new Rational(12)).bpm).toBe(120);
    expect(expanded.timeMap.timeSignatureAt(new Rational(12))).toEqual({numerator: 4, denominator: 4});
    expect(expanded.durationSeconds).toBeCloseTo(10);

    const repeated = expanded.getNote(NoteId(`${repeatedId}@2`))!;
    // q=9 is 5.5s in the expanded map; retain the source note's +0.1s
    // performance offset rather than replaying it at its original 0.6s.
    expect(repeated.performed?.onsetSec).toBeCloseTo(5.6);
    expect(repeated.performed?.durationSec).toBeCloseTo(0.2);
  });

  it('volta brackets pick the correct endings', () => {
    // m1 (repeat start), m2 (volta 1, repeat end), m3 (volta 2), m4
    const b = builderWithMeasures(4, [
      {repeat: {start: true}},
      {volta: [1], repeat: {end: true}},
      {volta: [2]},
      {},
    ]);
    const partId = b.addPart({id: b.newPartId(), name: 'P'});
    noteEveryMeasure(b, partId, 4);
    const score = b.build();

    const expanded = expandRepeats(score);
    // Playback: m1 m2 | m1 m3 m4 → 5 measures.
    expect(expanded.measures).toHaveLength(5);
    expect(expanded.measures.map((m) => m.number)).toEqual([1, 2, 3, 4, 5]);
    expect(expanded.durationQuarters.eq(new Rational(20))).toBe(true);
    // Second pass skips the first ending: original m2's note appears once.
    expect(expanded.notes).toHaveLength(5);
  });

  it('malformed repeats (end without start) fall back to no expansion', () => {
    const b = builderWithMeasures(2, [{}, {repeat: {end: true}}]);
    const partId = b.addPart({id: b.newPartId(), name: 'P'});
    noteEveryMeasure(b, partId, 2);
    const score = b.build();
    expect(expandRepeats(score)).toBe(score);
    expect(playedDurationSeconds(score)).toBeCloseTo(score.durationSeconds);
  });
});

describe('slur nesting', () => {
  it('round-trips plain, numbered and array slur values', () => {
    const b = builderWithMeasures(1);
    const partId = b.addPart({id: b.newPartId(), name: 'P'});
    const v = b.newVoiceId();
    b.addNote(partId, quarterNote(b, v, 'C4', Rational.ZERO, {slur: 'start'}));
    b.addNote(partId, quarterNote(b, v, 'D4', Rational.ONE, {slur: {type: 'start', number: 2}}));
    b.addNote(partId, quarterNote(b, v, 'E4', new Rational(2), {
      slur: [
        {type: 'stop', number: 2},
        {type: 'stop', number: 1},
      ],
    }));
    const score = b.build();
    const back = scoreFromJSON(JSON.parse(JSON.stringify(score)));
    const slurs = [...back.allNotes()]
      .sort((a, b2) => a.onsetQuarters.cmp(b2.onsetQuarters))
      .map((n) => n.slur);
    expect(slurs[0]).toBe('start');
    expect(slurs[1]).toEqual({type: 'start', number: 2});
    expect(slurs[2]).toEqual([
      {type: 'stop', number: 2},
      {type: 'stop', number: 1},
    ]);
  });
});
