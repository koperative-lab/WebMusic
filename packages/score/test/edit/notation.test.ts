import {describe, expect, it} from 'vitest';
import {Duration, MeasureId, Note, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, scoreFromJSON,
  type NoteData, type ScoreEditOperation, type ScoreNotationEntry} from '../../src/core';
import {applyScoreOperations, snapshotScoreOperations} from '../../src/edit/core';
import {createScoreEditor} from '../../src/edit/headless';
import {parseMusicXML, serializeMusicXML} from '../../src/io/formats/musicxml';

const p = PartId('p'); const v = VoiceId('1');
function note(id: string, onset = 0, duration = Duration.quarter(), extra: Partial<NoteData> = {}) {
  return new Note({id: NoteId(id), pitch: Pitch.parse('C4'), onsetQuarters: new Rational(onset), duration, voice: v, ...extra});
}
function fixture(notes: Note[] = []) {
  const builder = new ScoreBuilder();
  builder.addPart({id: p, name: 'Piano', staves: 2});
  builder.addMeasure({id: MeasureId('m1'), number: 1, onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4), timeSignature: {numerator: 4, denominator: 4}});
  builder.addMeasure({id: MeasureId('m2'), number: 2, onsetQuarters: new Rational(4), durationQuarters: new Rational(4)});
  for (const item of notes) builder.addNote(p, item);
  return builder.build();
}
function operation(patch: Partial<ScoreNotationEntry> = {}): ScoreEditOperation {
  return {type: 'enter-notation', entry: {id: NoteId('entry'), partId: p, voice: v, staff: 1,
    onsetQuarters: [0, 1], duration: {base: [1, 1]}, pitch: {step: 'F', alter: 1, octave: 4}, ...patch}};
}
function execute(editor: ReturnType<typeof createScoreEditor>, op = operation()) {
  return editor.transaction('Enter notation', (transaction) => transaction.add(op));
}

describe('measure-local notation entry', () => {
  it('writes spelled notes and deterministic real rests, preserves other voices/staves and replays identically', () => {
    const otherVoice = note('other-voice', 0, Duration.whole(), {voice: VoiceId('2')});
    const bass = note('bass', 0, Duration.whole(), {pitch: Pitch.parse('C3'), staff: 2});
    const before = fixture([otherVoice, bass]);
    const command = operation({onsetQuarters: [1, 1], duration: {base: [1, 1], dots: 1}});
    const result = applyScoreOperations(before, [command]);
    const entered = result.score.getNote(NoteId('entry'))!;
    expect(entered.pitch.toString()).toBe('F#4');
    expect(entered.duration.toJSON()).toEqual({base: [1, 1], dots: 1, tuplet: [1, 1]});
    expect(entered.performed).toBeUndefined();
    const rests = result.score.parts[0].notes.filter((item) => item.rest);
    expect(rests.map((item) => [item.id, item.onsetQuarters.toJSON(), item.duration.quarters.toJSON()])).toEqual([
      ['entry:rest:0', [0, 1], [1, 1]], ['entry:rest:1', [5, 2], [3, 2]],
    ]);
    expect(result.score.getNote(otherVoice.id)).toBe(before.getNote(otherVoice.id));
    expect(result.score.getNote(bass.id)).toBe(before.getNote(bass.id));
    expect(result.score.toJSON()).toEqual(applyScoreOperations(before, [command]).score.toJSON());
    expect(before.parts[0].notes).toHaveLength(2);
  });

  it('replaces only covered sounding events, retains untouched microtiming and splits real rests', () => {
    const before = fixture([note('a'), note('b', 1, Duration.quarter(), {performed: {onsetSec: .53, durationSec: .47, velocity: 82}}),
      note('rest', 2, Duration.half(), {rest: true, pitch: undefined})]);
    const changed = applyScoreOperations(before, [operation()]).score;
    expect(changed.getNote(NoteId('a'))).toBeUndefined();
    expect(changed.getNote(NoteId('b'))).toBe(before.getNote(NoteId('b')));
    expect(changed.getNote(NoteId('rest'))).toBe(before.getNote(NoteId('rest')));
    const split = applyScoreOperations(before, [operation({onsetQuarters: [5, 2], duration: {base: [1, 2]}})]).score;
    expect(split.getNote(NoteId('rest'))).toBeUndefined();
    expect(split.parts[0].notes.filter((item) => item.rest).map((item) => item.duration.quarters.toJSON())).toEqual([[1, 2], [1, 1]]);
  });

  it('writes explicit rests and shares one atomic history item for all automatic completion', () => {
    const before = fixture([note('a')]);
    const editor = createScoreEditor(before);
    expect(execute(editor, operation({pitch: null})).status).toBe('committed');
    const after = editor.score;
    expect(after.getNote(NoteId('entry'))?.rest).toBe(true);
    expect(after.parts[0].notes.every((item) => item.rest)).toBe(true);
    expect(editor.getState().history.undoCount).toBe(1);
    expect(editor.undo().status).toBe('committed'); expect(editor.score).toBe(before);
    expect(editor.redo().status).toBe('committed'); expect(editor.score).toBe(after);
    editor.dispose();
  });

  it('round-trips authored note spelling, dotted duration and automatic rests through JSON and MusicXML', () => {
    const edited = applyScoreOperations(fixture(), [operation({onsetQuarters: [1, 1],
      duration: {base: [1, 1], dots: 1}, pitch: {step: 'D', alter: -1, octave: 5}})]).score;
    const restored = scoreFromJSON(JSON.parse(JSON.stringify(edited.toJSON())));
    expect(restored.toJSON()).toEqual(edited.toJSON());
    const musical = (notes: readonly Note[]) => notes.map((item) => ({
      rest: item.rest ?? false, pitch: item.rest ? null : item.pitch.toString(),
      onset: item.onsetQuarters.toJSON(), duration: item.duration.toJSON(), voice: item.voice, staff: item.staff ?? 1,
    }));
    const xml = serializeMusicXML(edited);
    expect(xml).toContain('<rest'); expect(xml).toContain('<dot');
    const parsed = parseMusicXML(xml);
    // MusicXML import namespaces voice IDs by source part; membership survives.
    expect(musical(parsed.parts[0].notes.filter((item) => item.onsetQuarters.lt(new Rational(4)))))
      .toEqual(musical(edited.parts[0].notes).map((item) => ({...item, voice: VoiceId('p-1')})));
  });

  it('rejects partial sounding-note cuts, crossing entries and a missing authored grid atomically', () => {
    const before = fixture([note('a', 0, Duration.half())]);
    const editor = createScoreEditor(before);
    for (const op of [operation(), operation({onsetQuarters: [1, 1]}), operation({onsetQuarters: [7, 2]}),
      operation({onsetQuarters: [8, 1]})]) {
      const result = execute(editor, op);
      expect(result.status).toBe('failed');
      if (result.status === 'failed') expect(result.error.code).toBe('unsupported-structure');
      expect(editor.score).toBe(before); expect(editor.getState().history.undoCount).toBe(0);
    }
    const builder = new ScoreBuilder(); builder.addPart({id: p, name: 'Piano'});
    expect(() => applyScoreOperations(builder.build(), [operation()])).toThrow(/authored measure/);
    editor.dispose();
  });

  it.each([
    {tie: 'start' as const}, {tupletId: 't'}, {tupletMarks: [{type: 'start' as const}]},
    {grace: true}, {chord: true}, {slur: 'start' as const}, {beams: [{number: 1, type: 'begin' as const}]},
    {unpitched: true}, {printObject: false}, {duration: Duration.triplet(Duration.quarter())},
  ])('rejects unsupported structure elsewhere in the target measure: %j', (patch) => {
    const before = fixture([note('special', 2, Duration.quarter(), patch)]);
    expect(() => applyScoreOperations(before, [operation()])).toThrow(/unsupported/);
    expect(before.parts[0].notes).toHaveLength(1);
  });

  it('rejects overlapping voices, cross-measure notes and destructive replacement of authored notation', () => {
    expect(() => applyScoreOperations(fixture([note('a'), note('b')]), [operation()])).toThrow(/monophonic/);
    expect(() => applyScoreOperations(fixture([note('a', 3, Duration.half())]), [operation()])).toThrow(/crossing/);
    expect(() => applyScoreOperations(fixture([note('a', 0, Duration.quarter(), {lyric: 'Hello'})]), [operation()])).toThrow(/discard authored/);
  });

  it('replaces notes carrying only display hints, including typical imported MusicXML stems', () => {
    const before = fixture([note('stem', 0, Duration.quarter(), {stem: 'up', tiePlacement: 'below'}),
      note('rest', 1, Duration.dotted(Duration.half()), {rest: true, pitch: undefined, restDisplay: {step: 'B', octave: 4}})]);
    const changed = applyScoreOperations(before, [operation({duration: {base: [4, 1]}})]).score;
    expect(changed.parts[0].notes.map((item) => item.id)).toEqual([NoteId('entry')]);
    expect(changed.getNote(NoteId('entry'))?.stem).toBeUndefined();
    const imported = parseMusicXML(`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><stem>down</stem></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><stem>down</stem></note>
      </measure></part></score-partwise>`);
    const [first] = imported.parts[0].notes;
    expect(first.stem).toBe('down');
    const overwritten = applyScoreOperations(imported, [operation({partId: imported.parts[0].id, voice: first.voice,
      staff: first.staff ?? 1, pitch: {step: 'E', alter: -1, octave: 5}})]).score;
    expect(overwritten.parts[0].notes.map((item) => item.pitch.toString())).toEqual(['Eb5', 'D5']);
  });

  it('keeps the existing notes when re-entry would only regenerate identities', () => {
    const before = fixture([note('a'), note('rest', 1, Duration.dotted(Duration.half()), {rest: true, pitch: undefined, restDisplay: {step: 'B', octave: 4}})]);
    const rest = operation({id: NoteId('again'), onsetQuarters: [1, 1], duration: {base: [2, 1], dots: 1}, pitch: null});
    const sameNote = operation({id: NoteId('again'), pitch: {step: 'C', alter: 0, octave: 4}});
    for (const op of [rest, sameNote]) {
      const result = applyScoreOperations(before, [op]);
      expect(result.score).toBe(before);
      expect(result.affectedNoteIds).toEqual([]);
    }
    const editor = createScoreEditor(before);
    const session = editor.createInteractionSession();
    session.setSelection([NoteId('rest')]);
    expect(execute(editor, rest).status).toBe('noop');
    expect(editor.getSnapshot().documentRevision).toBe(0);
    expect(editor.getState().history.undoCount).toBe(0);
    expect(session.getSnapshot().selectedNoteIds).toEqual([NoteId('rest')]);
    // Different spelling or authored velocity is a real change.
    expect(applyScoreOperations(before, [operation({id: NoteId('again'), pitch: {step: 'B', alter: 1, octave: 3}})]).score).not.toBe(before);
    expect(applyScoreOperations(before, [operation({id: NoteId('again'), pitch: {step: 'C', alter: 0, octave: 4}, velocity: 90})]).score).not.toBe(before);
    editor.dispose();
  });

  it('fills a pickup measure only to its authored length', () => {
    const builder = new ScoreBuilder();
    builder.addPart({id: p, name: 'Voice'});
    builder.addMeasure({id: MeasureId('pickup'), number: 0, onsetQuarters: Rational.ZERO, durationQuarters: Rational.ONE,
      timeSignature: {numerator: 4, denominator: 4}});
    builder.addMeasure({id: MeasureId('m1'), number: 1, onsetQuarters: Rational.ONE, durationQuarters: new Rational(4)});
    const before = builder.build();
    const result = applyScoreOperations(before, [operation({duration: {base: [1, 2]}})]).score;
    expect(result.parts[0].notes.map((item) => [item.id, item.onsetQuarters.toJSON(), item.duration.quarters.toJSON()])).toEqual([
      ['entry', [0, 1], [1, 2]], ['entry:rest:0', [1, 2], [1, 2]],
    ]);
    expect(() => applyScoreOperations(before, [operation({duration: {base: [2, 1]}})])).toThrow(/measure boundary/);
    const next = applyScoreOperations(before, [operation({onsetQuarters: [1, 1]})]).score;
    expect(next.parts[0].notes.map((item) => [item.onsetQuarters.toJSON(), item.duration.quarters.toJSON()])).toEqual([
      [[1, 1], [1, 1]], [[2, 1], [3, 1]],
    ]);
  });

  it('rejects a meter change inside the authored target measure', () => {
    const builder = new ScoreBuilder();
    builder.addPart({id: p, name: 'Voice'});
    builder.addMeasure({id: MeasureId('m1'), number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(4),
      timeSignature: {numerator: 4, denominator: 4}});
    builder.addMeter({atQuarters: new Rational(2), timeSignature: {numerator: 2, denominator: 4}, measureNumber: 1});
    const before = builder.build();
    expect(() => applyScoreOperations(before, [operation()])).toThrow(/meter change inside/);
    expect(before.parts[0].notes).toHaveLength(0);
  });

  it('enters into one part of a multi-part score without changing the others', () => {
    const builder = new ScoreBuilder();
    builder.addPart({id: p, name: 'Flute'});
    builder.addPart({id: PartId('q'), name: 'Oboe'});
    builder.addMeasure({id: MeasureId('m1'), number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(4),
      timeSignature: {numerator: 4, denominator: 4}});
    builder.addNote(p, note('flute', 0, Duration.whole()));
    const before = builder.build();
    const result = applyScoreOperations(before, [operation({partId: PartId('q')})]);
    expect(result.score.parts[0]).toBe(before.parts[0]);
    expect(result.score.parts[1].notes.map((item) => item.id)).toEqual([NoteId('entry'), NoteId('entry:rest:0')]);
    expect(result.affectedNoteIds).toEqual([NoteId('entry'), NoteId('entry:rest:0')]);
    expect(() => applyScoreOperations(before, [operation({partId: PartId('missing')})])).toThrow(/Unknown part/);
  });

  it('infers the staff of notes without one on a two-staff part', () => {
    const low = note('low', 0, Duration.whole(), {pitch: Pitch.parse('C3')});
    const middle = note('middle', 0, Duration.half(), {pitch: Pitch.parse('C4'), voice: VoiceId('2')});
    const before = fixture([low, middle]);
    const upper = applyScoreOperations(before, [operation()]).score;
    expect(upper.getNote(low.id)).toBe(before.getNote(low.id));
    expect(upper.parts[0].notes.filter((item) => item.staff === 1).map((item) => item.id)).toEqual([NoteId('entry'), NoteId('entry:rest:0')]);
    expect(() => applyScoreOperations(before, [operation({staff: 2})])).toThrow(/truncate a sounding note/);
    const lower = applyScoreOperations(before, [operation({staff: 2, duration: {base: [4, 1]}})]).score;
    expect(lower.getNote(low.id)).toBeUndefined();
    expect(lower.getNote(middle.id)).toBe(before.getNote(middle.id));
    // Middle C and above infer the upper staff.
    expect(() => applyScoreOperations(before, [operation({voice: VoiceId('2')})])).toThrow(/truncate a sounding note/);
  });

  it('validates the entered sounding pitch through the Part transposition', () => {
    const builder = new ScoreBuilder();
    builder.addPart({id: p, name: 'Piccolo', transpose: {chromatic: 0, octaveChange: 1}});
    builder.addMeasure({id: MeasureId('m1'), number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(4),
      timeSignature: {numerator: 4, denominator: 4}});
    const before = builder.build();
    expect(() => applyScoreOperations(before, [operation({pitch: {step: 'A', alter: 0, octave: 8}})])).toThrow(/Sounding pitch/);
    expect(applyScoreOperations(before, [operation({pitch: {step: 'G', alter: 0, octave: 8}})]).score.getNote(NoteId('entry'))?.pitch.midi).toBe(115);
  });

  it('rejects colliding generated identities and non-dyadic gaps without exposing candidates', () => {
    const collision = fixture([note('entry:rest:0', 4)]);
    expect(() => applyScoreOperations(collision, [operation()])).toThrow(/Generated rest ID/);
    const before = fixture();
    expect(() => applyScoreOperations(before, [operation({onsetQuarters: [1, 3]})])).toThrow(/1\/64-quarter/);
    expect(before.parts[0].notes).toHaveLength(0);
  });

  it('preserves exact short dotted entry and fills representable binary gaps', () => {
    const result = applyScoreOperations(fixture(), [operation({duration: {base: [1, 16], dots: 2}})]).score;
    const voice = result.parts[0].notes;
    expect(voice[0].duration.quarters.toJSON()).toEqual([7, 64]);
    expect(voice.reduce((sum, item) => sum.add(item.duration.quarters), Rational.ZERO).toJSON()).toEqual([4, 1]);
  });

  it('validates notation payloads at capture time, rejecting unknown fields, unsupported bases and rest velocity', () => {
    for (const patch of [{duration: {base: [1, 3]}}, {duration: {base: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1]}}, {duration: {base: [1, 1], dots: 3}},
      {pitch: null, velocity: 80}, {staff: 0}, {pitch: {step: 'F', alter: 3, octave: 4}}, {extra: true}]) {
      expect(() => snapshotScoreOperations([operation(patch as Partial<ScoreNotationEntry>)])).toThrow();
    }
    const value = snapshotScoreOperations([operation()])[0];
    expect(Object.isFrozen(value)).toBe(true);
    if (value.type === 'enter-notation') expect(Object.isFrozen(value.entry.duration)).toBe(true);
  });
});
