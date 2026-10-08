import {describe, expect, it} from 'vitest';
import {Duration, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type NoteData} from '../../src/core';
import {projectBasicInspection} from '../../src/analyze/headless/basic-inspection';

function builder() {
  const value = new ScoreBuilder();
  value.addPart({id: PartId('p'), name: 'Part'});
  return value;
}

function add(b: ScoreBuilder, id: string, onset: Rational | number, pitch: string | null, duration = Duration.quarter(), extra: Partial<NoteData> = {}) {
  b.addNote(PartId('p'), {
    id: NoteId(id), voice: VoiceId('v'), onsetQuarters: Rational.from(onset), duration,
    ...(pitch === null ? {rest: true} : {pitch: Pitch.parse(pitch)}), ...extra,
  });
}

describe('basic inspection projections', () => {
  it('inspects the complete score when optional selection filters are absent or undefined', () => {
    const b = builder();
    add(b, 'a', 0, 'C4'); add(b, 'b', 1, 'E4');
    const score = b.build();
    expect(projectBasicInspection(score, 'interval').inspections.map((item) => item.headline)).toEqual(['3M']);
    expect(projectBasicInspection(score, 'scale', {tonic: 'C', selection: {partId: undefined}})
      .inspections.map((item) => item.headline)).toEqual(['1', '3']);
    expect(projectBasicInspection(score, 'scale').message).toMatch(/Choose a tonic/);
  });

  it('preserves explicit note-subset and range semantics in the chord view', () => {
    const b = builder();
    add(b, 'c', 0, 'C4', Duration.whole());
    add(b, 'e', 0, 'E4', Duration.whole());
    add(b, 'g', 0, 'G4', Duration.whole());
    add(b, 'passing', 0, 'D4', Duration.whole());
    const score = b.build();
    expect(projectBasicInspection(score, 'chord').inspections[0]?.headline).toBe('C4 D4 E4 G4');
    const selected = projectBasicInspection(score, 'chord', {
      selection: {noteIds: ['c', 'e', 'g'], fromQuarters: 1, toQuarters: 2},
    });
    expect(selected.inspections[0]).toMatchObject({headline: 'C', selection: {startQuarters: 1, endQuarters: 2}});
    expect(selected.inspections[0]?.evidence.join(' ')).not.toContain('passing');
  });

  it('projects chosen subdivisions onto the visible rhythm ruler', () => {
    const b = builder();
    add(b, 'held', 0, 'C4');
    const score = b.build();
    const one = projectBasicInspection(score, 'rhythm', {subdivision: 1}).lane.ruler;
    const three = projectBasicInspection(score, 'rhythm', {subdivision: 3}).lane.ruler;
    expect(one?.map((tick) => tick.label)).toEqual(['1:1']);
    expect(three?.map((tick) => tick.label)).toEqual(['1:1', '', '']);
    expect(three?.map((tick) => tick.major)).toEqual([true, false, false]);
    expect(three?.[1]?.at).toBeCloseTo(score.timeMap.quartersToSeconds(new Rational(1, 3)));
  });

  it('makes rest and tied-continuation notation inspectable without counting new attacks', () => {
    const b = builder();
    add(b, 'attack', 0, 'C4', Duration.quarter(), {tie: 'start'});
    add(b, 'held', 1, 'C4', Duration.quarter(), {tie: 'stop'});
    add(b, 'rest', 2, null);
    const result = projectBasicInspection(b.build(), 'rhythm');
    expect(result.lane.bands.map((band) => band.primary)).toEqual(['Quarter', 'Tie', 'Rest']);
    expect(result.inspections.find((item) => item.headline === 'Tie continuation')?.detail).toContain('not a new attack');
    expect(result.inspections.find((item) => item.headline === 'Rest')?.evidence).toContain('rest: 1 quarter-note units; base 1');
    expect(result.inspections[0]?.evidence).toContain('attack: 1 quarter-note units; base 1; tie start');
    expect(result.lane.tracks).toHaveLength(1);
  });

  it('shows exact tuplet/dot evidence and keeps source-note filters consistent', () => {
    const b = builder();
    add(b, 'triplet', 0, 'C4', Duration.triplet(Duration.eighth()));
    add(b, 'dotted', 1, 'D4', Duration.dotted(Duration.eighth()));
    add(b, 'other-voice', 2, null, Duration.quarter(), {voice: VoiceId('other')});
    const result = projectBasicInspection(b.build(), 'rhythm', {selection: {voiceId: 'v'}});
    const evidence = result.inspections.flatMap((item) => item.evidence).join(' ');
    expect(evidence).toContain('1/3 quarter-note units; base 1/2; tuplet 3 in the time of 2');
    expect(evidence).toContain('3/4 quarter-note units; base 1/2; dots 1');
    expect(evidence).not.toContain('other-voice');
    expect(result.lane.bands.map((band) => band.readout?.primary)).toEqual(['Eighth-note triplet', 'Dotted eighth note']);
    expect(result.lane.bands.map((band) => band.secondary)).toEqual(['1:1', '1:2']);
    expect(projectBasicInspection(b.build(), 'rhythm', {selection: {noteIds: []}}).lane.bands).toEqual([]);
  });

  it('allocates rows chronologically when notation-only bands precede attacks', () => {
    const b = builder();
    add(b, 'rest', 0, null); add(b, 'attack', 1, 'C4');
    const result = projectBasicInspection(b.build(), 'rhythm');
    expect(result.lane.bands.map((band) => band.primary)).toEqual(['Rest', 'Quarter']);
    expect(result.lane.tracks).toHaveLength(1);
  });

  it.each(['accent', 'marcato'] as const)('keeps authored %s evidence within the selected rhythm notes', (articulation) => {
    const b = builder();
    add(b, 'plain', 0, 'C4');
    add(b, 'accented', 0, 'E4', Duration.quarter(), {articulations: [articulation]});
    const score = b.build();
    const plain = projectBasicInspection(score, 'rhythm', {selection: {noteIds: ['plain']}});
    const accented = projectBasicInspection(score, 'rhythm', {selection: {noteIds: ['accented']}});
    const complete = projectBasicInspection(score, 'rhythm');

    expect(plain.inspections).toHaveLength(1);
    expect(plain.inspections[0]?.evidence[0]).toBe('p/v · plain');
    expect(plain.inspections[0]?.detail).not.toContain('notated accent');
    expect(accented.inspections).toHaveLength(1);
    expect(accented.inspections[0]?.evidence[0]).toBe('p/v · accented');
    expect(accented.inspections[0]?.detail).toContain('notated accent');
    expect(complete.inspections).toHaveLength(1);
    expect(complete.inspections[0]?.detail).toContain('notated accent');
  });

  it('discloses inferred transposition spelling in all pitch-based evidence', () => {
    const b = new ScoreBuilder();
    b.addPart({id: PartId('p'), name: 'Transposing', transpose: {chromatic: -1}});
    add(b, 'a', 0, 'D4'); add(b, 'b', 1, 'E4');
    const score = b.build();
    for (const kind of ['chord', 'interval', 'scale'] as const) {
      const result = projectBasicInspection(score, kind, {pitchMode: 'sounding', tonic: 'C'});
      expect(result.inspections.length).toBeGreaterThan(0);
      expect(result.inspections[0]?.evidence[0]).toContain('(spelling inferred)');
    }
    const written = projectBasicInspection(score, 'scale', {tonic: 'C'});
    expect(written.inspections[0]?.evidence[0]).not.toContain('(spelling inferred)');
  });

  it('keeps source identities distinct when part and note IDs contain separators', () => {
    const b = builder();
    b.addPart({id: PartId('p:x'), name: 'Other part'});
    add(b, 'x:n', 0, 'C4');
    b.addNote(PartId('p:x'), {
      id: NoteId('n'), voice: VoiceId('v'), onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(), pitch: Pitch.parse('E4'),
    });
    const result = projectBasicInspection(b.build(), 'scale', {tonic: 'C'});
    expect(result.lane.bands).toHaveLength(2);
    expect(new Set(result.lane.bands.map((band) => band.id)).size).toBe(2);
  });

  it('separates clear current readings from compact timeline labels', () => {
    const b = builder();
    add(b, 'a', 0, 'C4'); add(b, 'b', 1, 'E4');
    const interval = projectBasicInspection(b.build(), 'interval').lane.bands[0]!;
    expect(interval.primary).toBe('3M');
    expect(interval.readout).toEqual({primary: 'Major 3rd', secondary: 'C4 → E4 · ascending · 4 semitones', fields: [
      {id: 'notes', label: 'Notes', value: 'C4 → E4'},
      {id: 'motion', label: 'Motion', value: 'Ascending'},
      {id: 'semitones', label: 'Semitones', value: '4'},
    ]});
    const degree = projectBasicInspection(b.build(), 'scale', {tonic: 'C'}).lane.bands[1]!;
    expect(degree.readout).toEqual({primary: 'Degree 3', secondary: 'E4 · C major', fields: [
      {id: 'note', label: 'Note', value: 'E4'},
      {id: 'reference', label: 'Reference', value: 'C major'},
      {id: 'relation', label: 'Relation', value: 'In scale'},
    ]});
    add(b, 'simultaneous', 0, 'G4');
    const harmonic = projectBasicInspection(b.build(), 'interval', {intervalKind: 'harmonic'}).lane.bands[0]!;
    expect(harmonic.secondary).toBe('C4 + G4');
    expect(harmonic.readout?.secondary).toContain('simultaneous');
    expect(harmonic.readout?.fields?.find((field) => field.id === 'motion')?.value).toBe('Simultaneous');
  });

  it('keeps the same scale fields for reference tones and chromatic alterations', () => {
    const b = builder();
    add(b, 'in', 0, 'E4'); add(b, 'out', 1, 'F#4');
    const bands = projectBasicInspection(b.build(), 'scale', {tonic: 'C'}).lane.bands;
    expect(bands.map((band) => band.readout?.fields?.map((field) => field.id)))
      .toEqual([['note', 'reference', 'relation'], ['note', 'reference', 'relation']]);
    expect(bands.map((band) => band.readout?.fields?.[2]?.value)).toEqual(['In scale', 'Altered']);
  });

  it.each([
    {meter: {numerator: 6, denominator: 8}, groups: undefined, at: 2, beat: '2 + 1/3'},
    {meter: {numerator: 5, denominator: 8}, groups: [2, 3], at: 1.5, beat: '2 + 1/3'},
  ])('uses the same grouped beat fields for attacks, rests and ties in $meter.numerator/$meter.denominator', ({meter, groups, at, beat}) => {
    const b = builder();
    b.addMeasure({id: b.newMeasureId(), number: 1, onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(meter.numerator, 2), timeSignature: meter});
    add(b, 'attack', at, 'C4', Duration.eighth());
    add(b, 'rest', at, null, Duration.eighth(), {voice: VoiceId('rest')});
    add(b, 'tie', at, 'E4', Duration.eighth(), {tie: 'stop', voice: VoiceId('held')});
    const result = projectBasicInspection(b.build(), 'rhythm', {beatGroups: groups,
      selection: {fromQuarters: at, toQuarters: at + 0.5}});
    expect(result.lane.bands).toHaveLength(3);
    for (const band of result.lane.bands) {
      expect(band.readout?.fields).toEqual([
        {id: 'bar', label: 'Bar', value: '1'},
        {id: 'beat', label: 'Beat', value: beat},
        {id: 'duration', label: 'Duration (qn)', value: '1/2'},
      ]);
      expect(band.readout?.primary).not.toContain('·');
    }
  });

  it('keeps an out-of-range continuation onset without inventing an unmatched irregular beat grouping', () => {
    const b = builder();
    b.addMeasure({id: b.newMeasureId(), number: 1, onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(7, 2), timeSignature: {numerator: 7, denominator: 8}});
    b.addMeasure({id: b.newMeasureId(), number: 2, onsetQuarters: new Rational(7, 2),
      durationQuarters: new Rational(5, 2), timeSignature: {numerator: 5, denominator: 8}});
    add(b, 'rest', 3, null, Duration.half());
    add(b, 'tie', 3, 'E4', Duration.half(), {tie: 'stop', voice: VoiceId('held')});
    const score = b.build();
    const result = projectBasicInspection(score, 'rhythm', {beatGroups: [2, 3],
      selection: {fromQuarters: 4, toQuarters: 5}});
    expect(result.lane.bands).toHaveLength(2);
    for (const band of result.lane.bands) {
      expect(band.stampStart).toBe(3);
      expect(band.readout?.fields).toEqual([
        {id: 'bar', label: 'Bar', value: '1'},
        {id: 'beat', label: 'Beat', value: ''},
        {id: 'duration', label: 'Duration (qn)', value: '2'},
      ]);
    }
    // A grouping for the earlier 7/8 bar restores its exact beat without changing the selection.
    const grouped = projectBasicInspection(score, 'rhythm', {beatGroups: [[2, 3], [2, 2, 3]],
      selection: {fromQuarters: 4, toQuarters: 5}});
    for (const band of grouped.lane.bands) {
      expect(band.readout?.fields?.map((field) => field.value)).toEqual(['1', '3 + 2/3', '2']);
    }
    expect(() => projectBasicInspection(score, 'rhythm', {beatGroups: [2, 2],
      selection: {fromQuarters: 4, toQuarters: 5}})).toThrow(RangeError);
    expect(projectBasicInspection(score, 'rhythm', {beatGroups: [2, 3],
      selection: {fromQuarters: 4, toQuarters: 4}}).lane.bands).toEqual([]);
  });

  it('retains an earlier rest onset in the same compound meter when the selection clips its duration', () => {
    const b = builder();
    b.addMeasure({id: b.newMeasureId(), number: 1, onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(3), timeSignature: {numerator: 6, denominator: 8}});
    add(b, 'rest', 2, null, Duration.quarter());
    const band = projectBasicInspection(b.build(), 'rhythm', {selection: {fromQuarters: 2.5, toQuarters: 3}}).lane.bands[0]!;
    expect(band.stampStart).toBe(2);
    expect(band.readout?.fields?.find((field) => field.id === 'beat')?.value).toBe('2 + 1/3');
  });

  it('names a complete beat arpeggio without inventing a chord for a dyad', () => {
    const b = builder();
    add(b, 'a', 0, 'C#4', Duration.triplet(Duration.eighth()));
    add(b, 'b', new Rational(1, 3), 'E4', Duration.triplet(Duration.eighth()));
    add(b, 'c', new Rational(2, 3), 'A4', Duration.triplet(Duration.eighth()));
    const music = b.build();
    const simultaneous = projectBasicInspection(music, 'chord');
    expect(simultaneous.inspections.map((item) => item.headline)).toEqual(['C#4', 'E4', 'A4']);
    const beat = projectBasicInspection(music, 'chord', {chordGrouping: 'beat'});
    expect(beat.lane.bands[0]).toMatchObject({primary: 'A/C#', secondary: 'C#4 E4 A4',
      readout: {primary: 'A/C#', secondary: 'C#4 E4 A4'}});
    const dyad = projectBasicInspection(music, 'chord', {chordGrouping: 'beat', selection: {noteIds: ['a', 'c']}});
    expect(dyad.lane.bands[0]).toMatchObject({primary: '', secondary: 'C#4 A4',
      readout: {primary: '', secondary: 'C#4 A4'}});
    expect(beat.inspections[0]?.detail).toContain('Beat collection');
    expect(JSON.stringify(beat.lane)).not.toContain('Beat collection');
    expect(JSON.stringify(simultaneous.lane)).not.toContain('Simultaneous notes');
    expect(dyad.inspections[0]?.candidates).toEqual([]);
    expect(JSON.stringify(dyad)).not.toContain('Unclassified note set');
  });

  it.each(['beat', 'simultaneous'] as const)('keeps unmatched %s pitches exclusively in the note row', (chordGrouping) => {
    const b = builder();
    ['B2', 'E3', 'F#4', 'G#4', 'B4'].forEach((pitch, index) => add(b, `n${index}`, 0, pitch));
    const result = projectBasicInspection(b.build(), 'chord', {chordGrouping});
    expect(result.lane.bands[0]).toMatchObject({primary: '', secondary: 'B2 E3 F#4 G#4 B4',
      readout: {primary: '', secondary: 'B2 E3 F#4 G#4 B4'}});
    expect(result.inspections[0]?.candidates).toEqual([]);
  });
});
