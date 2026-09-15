import {describe, expect, it} from 'vitest';
import {
  Duration, NoteId, Pitch, Rational, ScoreBuilder, VoiceId,
  mergedTiedNotes, notesAt, notesIn, notesOverlapping, scoreTempos,
  type NoteData,
} from '../../src/core';

function scoreWithNotes(notes: Array<Pick<NoteData, 'onsetQuarters' | 'duration'> & Partial<NoteData>>) {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: builder.newPartId(), name: 'Piano'});
  notes.forEach((note, index) => builder.addNote(part, {
    id: NoteId(`note-${index}`),
    pitch: Pitch.parse('C4'),
    voice: VoiceId('voice'),
    ...note,
  }));
  return builder.build();
}

describe('Headless shared foundation: half-open note windows', () => {
  const score = scoreWithNotes([
    {onsetQuarters: Rational.ZERO, duration: Duration.whole()},
    {onsetQuarters: Rational.ONE, duration: new Duration({base: 0}), grace: true},
    {onsetQuarters: Rational.ZERO, duration: Duration.whole(), pitch: undefined, rest: true},
  ]);

  it.each([[1, 1], [2, 1]])('contains no note in the empty interval [%s, %s)', (start, end) => {
    for (const options of [undefined, {includeRests: true}, {includeGrace: false}]) {
      expect(notesOverlapping(score, new Rational(start), new Rational(end), options)).toEqual([]);
      expect(notesIn(score, new Rational(start), new Rational(end), options)).toEqual([]);
    }
  });

  it('keeps a point query distinct from an empty interval and excludes the final endpoint', () => {
    expect(notesAt(score, Rational.ONE).map((note) => note.id)).toEqual(['note-0', 'note-1']);
    expect(notesOverlapping(score, new Rational(3), new Rational(4)).map((note) => note.id)).toEqual(['note-0']);
    expect(notesOverlapping(score, new Rational(4), new Rational(5))).toEqual([]);
  });

  it('treats zero-duration ordinary notes as empty while retaining explicitly marked grace onsets', () => {
    const zeroNotes = scoreWithNotes([
      {onsetQuarters: Rational.ONE, duration: new Duration({base: 0})},
      {onsetQuarters: Rational.ONE, duration: new Duration({base: 0}), grace: true},
    ]);
    expect(notesOverlapping(zeroNotes, Rational.ZERO, new Rational(2)).map((note) => note.id)).toEqual(['note-1']);
    expect(notesOverlapping(zeroNotes, Rational.ZERO, new Rational(2), {includeGrace: false})).toEqual([]);
    // Onset queries still list zero-duration source events by design.
    expect(notesIn(zeroNotes, Rational.ZERO, new Rational(2))).toHaveLength(2);
  });
});

describe('Headless shared foundation: sounding tie continuity', () => {
  it.each([
    {name: 'gap', firstDuration: Duration.quarter(), nextOnset: new Rational(2)},
    {name: 'overlap', firstDuration: Duration.half(), nextOnset: Rational.ONE},
  ])('preserves separate attacks and durations across a malformed $name', ({firstDuration, nextOnset}) => {
    const score = scoreWithNotes([
      {onsetQuarters: Rational.ZERO, duration: firstDuration, tie: 'start'},
      {onsetQuarters: nextOnset, duration: Duration.quarter(), tie: 'stop'},
    ]);
    const events = mergedTiedNotes(score.parts[0]);
    expect(events.map((event) => event.notes.map((note) => note.id))).toEqual([['note-0'], ['note-1']]);
    expect(events.map((event) => event.onsetQuarters.toFloat())).toEqual([0, nextOnset.toFloat()]);
    expect(events.map((event) => event.durationQuarters.toFloat())).toEqual([firstDuration.quarters.toFloat(), 1]);
  });

  it('starts a new valid chain after a disconnected continue', () => {
    const score = scoreWithNotes([
      {onsetQuarters: Rational.ZERO, duration: Duration.quarter(), tie: 'start'},
      {onsetQuarters: new Rational(2), duration: Duration.quarter(), tie: 'continue'},
      {onsetQuarters: new Rational(3), duration: Duration.quarter(), tie: 'stop'},
    ]);
    expect(mergedTiedNotes(score.parts[0]).map((event) => event.notes.map((note) => note.id)))
      .toEqual([['note-0'], ['note-1', 'note-2']]);
  });

  it('merges exact tuplet boundaries across staves without mixing other voices', () => {
    const score = scoreWithNotes([
      {onsetQuarters: Rational.ZERO, duration: Duration.triplet(Duration.eighth()), tie: 'start', staff: 1},
      {onsetQuarters: new Rational(1, 3), duration: Duration.triplet(Duration.eighth()), tie: 'continue', staff: 2},
      {onsetQuarters: new Rational(1, 3), duration: Duration.quarter(), tie: 'stop', voice: VoiceId('other')},
      {onsetQuarters: new Rational(2, 3), duration: Duration.triplet(Duration.eighth()), tie: 'stop', staff: 2},
    ]);
    const events = mergedTiedNotes(score.parts[0]);
    expect(events.map((event) => event.notes.map((note) => note.id))).toEqual([['note-0', 'note-1', 'note-3'], ['note-2']]);
    expect(events[0].durationQuarters.eq(Rational.ONE)).toBe(true);
  });
});

describe('Headless shared foundation: tempo units', () => {
  const builder = new ScoreBuilder();
  builder.addTempo({atQuarters: Rational.ZERO, bpm: 60, unit: 2});
  builder.addTempo({atQuarters: new Rational(2), bpm: 80, unit: 1.5});
  builder.addTempo({atQuarters: new Rational(4), bpm: 120, unit: 0.5});
  const score = builder.build();

  it('projects every legacy BPM as quarters per minute', () => {
    expect(scoreTempos(score)).toEqual([
      {tick: 0, bpm: 120}, {tick: 960, bpm: 120}, {tick: 1920, bpm: 60},
    ]);
    expect(score.tempos).toEqual(scoreTempos(score));
    expect(scoreTempos(score, 96)).toEqual([
      {tick: 0, bpm: 120}, {tick: 192, bpm: 120}, {tick: 384, bpm: 60},
    ]);
    // The authored beat-unit information remains on the authoritative TimeMap.
    expect(score.timeMap.tempi.map((tempo) => tempo.unit)).toEqual([2, 1.5, 0.5]);
  });

  it('integrates beats of different units and round-trips within half a 480-PPQ tick', () => {
    // The first four quarters last 2 seconds. Each subsequent quarter lasts 1 second.
    for (let index = 0; index <= 444; index += 1) {
      const quarters = new Rational(index, 37);
      const position = quarters.toFloat();
      const expectedSeconds = position <= 4 ? position / 2 : 2 + position - 4;
      expect(score.timeMap.quartersToSeconds(quarters)).toBeCloseTo(expectedSeconds, 12);
      expect(Math.abs(score.timeMap.secondsToQuarters(expectedSeconds).toFloat() - position))
        .toBeLessThanOrEqual(1 / 960 + 1e-12);
    }
  });
});
