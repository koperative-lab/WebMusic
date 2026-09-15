import {describe, expect, it} from 'vitest';
import {Duration, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {
  chordTimeline, detectKey, distributions, findMotifs, identifyChord, identifyChordFromMidi,
  rhythmPatterns, romanNumeralForChord, romanNumerals, segmentChords, summarizeScore,
} from '../../src/analyze';
import {spellChord} from '../../src/analyze/core/chord-spelling';
import {fretboardVoicing, fretPositionsFor, resolveTuning, TUNINGS} from '../../src/analyze/core/fretboard-voicing';
import {voiceLeading} from '../../src/analyze';

type Spec = [pitch: string | null, onset: number | Rational, duration: number | Rational];
function scoreOf(voices: Record<string, Spec[]>, bpm = 120): Score {
  const builder = new ScoreBuilder();
  const part = PartId('part');
  builder.addPart({id: part, name: 'Review'});
  builder.addTempo({atQuarters: Rational.ZERO, bpm});
  for (const [voice, notes] of Object.entries(voices)) {
    for (const [pitch, onset, duration] of notes) builder.addNote(part, {
      id: builder.newNoteId(), ...(pitch === null ? {rest: true} : {pitch: Pitch.parse(pitch)}),
      onsetQuarters: Rational.from(onset), duration: new Duration({base: Rational.from(duration)}),
      voice: VoiceId(voice),
    });
  }
  return builder.build();
}
const triad = (root = 60, inversion = 0): number[] => [0, 4, 7]
  .map((degree, index) => root + degree + (index < inversion ? 12 : 0)).sort((a, b) => a - b);
const fromMidi = (midis: number[]) => scoreOf({one: midis.map((midi) => [Pitch.fromMidi(midi).toString(), 0, 1])});

describe('Analyze API independent contracts', () => {
  it.each([NaN, Infinity, -Infinity])('rejects non-finite timeline windows even for silence: %s', (windowQuarters) => {
    for (const score of [new ScoreBuilder().build(), fromMidi(triad())]) {
      expect(() => chordTimeline(score, {windowQuarters})).toThrow(RangeError);
    }
  });
  it.each([NaN, Infinity, -Infinity])('rejects non-finite timeline minimums even for silence: %s', (minNotes) => {
    for (const score of [new ScoreBuilder().build(), fromMidi(triad())]) {
      expect(() => chordTimeline(score, {minNotes})).toThrow(RangeError);
    }
  });
  it('merged timeline notes cover every reattack and retain a sustained note only once', () => {
    const score = scoreOf({one: [['C4', 0, 2], ['E4', 0, 1], ['G4', 0, 1], ['E4', 1, 1], ['G4', 1, 1]]});
    const [segment] = chordTimeline(score);
    expect(segment).toMatchObject({chord: 'CM', startQuarters: 0, endQuarters: 2, startSeconds: 0, endSeconds: 1});
    expect(segment.notes.map((note) => note.id)).toEqual(score.notes.map((note) => note.id));
    expect(segment.pitchClasses).toEqual([0, 4, 7]);
    expect(chordTimeline(score, {mergeAdjacent: false})).toHaveLength(2);
  });
  it('merged N.C. windows preserve the different pitch evidence across their full extent', () => {
    const score = scoreOf({one: [['C4', 0, 1], ['D4', 1, 1]]});
    const [segment] = chordTimeline(score);
    expect(segment).toMatchObject({chord: 'N.C.', startQuarters: 0, endQuarters: 2, pitchClasses: [0, 2]});
    expect(segment.notes).toHaveLength(2);
  });
  it('distinguishes the aggregate timeline from event-exact harmony boundaries', () => {
    const score = scoreOf({one: [['C4', 0, 0.5], ['E4', 0, 0.5], ['G4', 0, 0.5],
      ['F4', 0.5, 0.5], ['A4', 0.5, 0.5], ['C5', 0.5, 0.5]]});
    expect(segmentChords(score, {windowQuarters: 4}).map((entry) => [entry.startQuarters, entry.endQuarters, entry.chord]))
      .toEqual([[0, 0.5, 'CM'], [0.5, 1, 'FM']]);
    expect(chordTimeline(score, {windowQuarters: 1})[0].pitchClasses).toEqual([0, 4, 5, 7, 9]);
  });
  it('retains distinct Rational onsets below one compatibility tick in melody and interval analysis', () => {
    const score = scoreOf({one: [['C4', 0, new Rational(1, 2000)], ['D5', new Rational(1, 1000), 1]]});
    expect(voiceLeading(score)).toMatchObject([{type: 'large-leap', startQuarters: 0, endQuarters: 0.001}]);
    expect(distributions(score).intervals).toEqual([{key: 14, label: '+14', value: 1}]);
  });
  it('never invents simultaneous voice onsets by rounding nearby times to the same tick', () => {
    const score = scoreOf({lower: [['C4', 0, 1], ['D4', 1, 1]],
      upper: [['G4', new Rational(1, 1000), 1], ['A4', new Rational(1001, 1000), 1]]});
    expect(voiceLeading(score)).toEqual([]);
  });
  it('a rest between close Rational onsets still breaks melodic continuity', () => {
    const score = scoreOf({one: [['C4', 0, new Rational(1, 4000)],
      [null, new Rational(1, 4000), new Rational(1, 4000)], ['D5', new Rational(1, 2000), 1]]});
    expect(voiceLeading(score)).toEqual([]);
    expect(distributions(score).intervals).toEqual([]);
  });
  it('direct chord APIs share the accepted major-inversion naming policy in every transposition', () => {
    for (let root = 48; root < 60; root += 1) for (const inversion of [0, 1, 2]) {
      const midis = triad(root, inversion);
      const label = identifyChordFromMidi(midis);
      expect(label).not.toContain('m#5');
      expect(romanNumeralForChord(label, {tonic: Pitch.fromMidi(root).step + (Pitch.fromMidi(root).alter ? '#' : ''), mode: 'major'})).toBe('I');
      expect(identifyChord(fromMidi(midis).notes)).not.toContain('m#5');
    }
    expect(identifyChord(scoreOf({one: [['Eb4', 0, 1], ['Gb4', 0, 1], ['Cb5', 0, 1]]}).notes)).toBe('CbM/Eb');
  });
  it('all accepted detected spellings remain parsable by Roman and timeline analysis', () => {
    const score = fromMidi([63, 67, 71, 72]);
    const label = identifyChord(score.notes);
    expect(romanNumeralForChord(label, {tonic: 'C', mode: 'minor'})).toBe('imaj7');
    expect(chordTimeline(score)[0]).toMatchObject({root: 'C', quality: 'minor/major seventh'});
  });
  it('candidate normalization cannot claim a chord that leaves supplied pitch classes unexplained', () => {
    const label = identifyChordFromMidi([60, 61, 65, 67, 70]);
    expect(label).toBe('C11b9');
    expect(romanNumeralForChord(label, {tonic: 'C', mode: 'major'})).toBe('I11b9');
  });
  it('keeps diminished/augmented ambiguity, missing fifth and bass conventions explicit', () => {
    expect(identifyChordFromMidi([60, 64, 68])).toBe('Caug');
    expect(identifyChordFromMidi([59, 62, 65, 68])).toBe('Bdim7');
    expect(identifyChordFromMidi([60, 64, 71])).toBe('Cmaj7');
    expect(romanNumeralForChord('G7/B', {tonic: 'C', mode: 'major'})).toBe('V7');
    expect(romanNumeralForChord('Db', {tonic: 'C', mode: 'major'})).toBe('bII');
    expect(romanNumeralForChord('B', {tonic: 'C', mode: 'minor'})).toBe('bI');
    expect(romanNumeralForChord('not a chord', {tonic: 'C', mode: 'major'})).toBe('not a chord');
    expect(romanNumeralForChord('CM', {tonic: 'invalid', mode: 'major'})).toBe('CM');
  });
  it('duration weighting adds overlapping voices and is invariant to tempo and absolute onset shifts', () => {
    const voices: Record<string, Spec[]> = {one: [['C4', 0, 4], ['D4', 4, 1]], two: [['C5', 0, 2], [null, 2, 3]]};
    const score = scoreOf(voices);
    expect(distributions(score).pitchClasses.filter((bin) => bin.value)).toEqual([
      {key: 0, label: 'C', value: 2880}, {key: 2, label: 'D', value: 480},
    ]);
    const shifted = Object.fromEntries(Object.entries(voices).map(([voice, notes]) => [voice,
      notes.map(([pitch, onset, duration]) => [pitch, Rational.from(onset).add(new Rational(8)), duration] as Spec)]));
    expect(detectKey(scoreOf(shifted, 60))).toEqual(detectKey(score));
    expect(summarizeScore(score).notes).toBe(3);
    expect(summarizeScore(score).pitchRange).toEqual({low: 'C4', high: 'C5'});
  });
  it('motif transposition and duration identity retain note provenance through chord reduction', () => {
    const score = scoreOf({one: [['C3', 0, 1], ['E4', 0, 1], ['G4', 1, 1], ['F#4', 3, 1], ['A4', 4, 1]]});
    const [motif] = findMotifs(score, {length: 2});
    expect(motif.intervals).toEqual([3]);
    expect(motif.occurrences.map((entry) => entry.noteIndexes.map((index) => score.parts[0].notes[index].pitch.toString())))
      .toEqual([['E4', 'G4'], ['F#4', 'A4']]);
    expect(findMotifs(score, {length: 1})).toEqual([]);
  });
  it('rhythm vocabulary includes explicit rests and overlapping duration windows', () => {
    const score = scoreOf({one: [['C4', 0, 1], [null, 1, 2], ['E4', 3, 1], ['F4', 4, 2]]});
    expect(rhythmPatterns(score, 2)).toEqual([
      {pattern: [1, 2], count: 2, onsets: [0, 3]}, {pattern: [2, 1], count: 1, onsets: [1]},
    ]);
  });
  it('tuning arithmetic preserves physical string order and exact MIDI locations', () => {
    const reentrant = TUNINGS.ukulele.midis;
    const positions = fretPositionsFor(67, reentrant, {firstFret: 0, fretCount: 12});
    expect(positions.map(({stringIndex, fret}) => [stringIndex, fret])).toEqual([[0, 0], [1, 7], [2, 3]]);
    expect(fretPositionsFor(67, reentrant, {firstFret: 1, fretCount: 12})).not.toContainEqual({stringIndex: 0, fret: 0});
    expect(resolveTuning('constructor')).toBeUndefined();
    expect(resolveTuning('60,,67')).toBeUndefined();
    expect(resolveTuning([60, 60.5])?.midis).toEqual([60, 61]);
  });
  it('fretboard results obey their neck, span and sounding-tone constraints across built-in tunings', () => {
    const spelling = spellChord([60, 64, 67]);
    for (const tuning of Object.values(TUNINGS)) {
      const result = fretboardVoicing(spelling, {tuning, firstFret: 0, lastFret: 5, span: 4});
      const used = new Set<number>();
      for (const mark of result.marks) {
        expect(used.has(mark.stringIndex)).toBe(false);
        used.add(mark.stringIndex);
        expect(mark.fret).toBeGreaterThanOrEqual(0);
        expect(mark.fret).toBeLessThanOrEqual(Math.min(5, tuning.frets));
        expect([0, 4, 7]).toContain((tuning.midis[mark.stringIndex] + mark.fret) % 12);
      }
    }
  });
  it('romanNumerals respects precomputed segment boundaries without inventing inversion figures', () => {
    const score = fromMidi(triad());
    const segments = [{startQuarters: 2, endQuarters: 3, pitchClasses: [2, 7, 11], chord: 'G7/B'}];
    expect(romanNumerals(score, {tonic: 'C', mode: 'major'}, {segments})).toEqual([
      {startQuarters: 2, endQuarters: 3, chord: 'G7/B', roman: 'V7'},
    ]);
  });
});
