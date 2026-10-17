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
