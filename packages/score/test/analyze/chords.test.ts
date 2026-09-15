import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, scoreNotes, noteMidi, type Score} from '../../src/core';
import {describe, expect, it} from 'vitest';
import {identifyChord, identifyChordFromMidi, segmentChords} from '../../src/analyze/core/chords';
import {pitchClass} from '../../src/analyze/core/pitch-class';
import {romanNumerals, romanNumeralForChord} from '../../src/analyze/core/roman';
import type {ChordSegment} from '../../src/analyze/core/types';

/** Build a single-part score from [pitchName, onsetQuarters, durationQuarters] tuples. */
function scoreFrom(notes: Array<[string, number, number]>) {
  const builder = new ScoreBuilder();
  const partId = builder.newPartId();
  builder.addPart({id: partId, name: 'Test'});
  const voice = VoiceId(`${partId}-v1`);
  for (const [name, onset, dur] of notes) {
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(name),
      onsetQuarters: new Rational(Math.round(onset * 4), 4),
      duration: new Duration({base: new Rational(Math.round(dur * 4), 4)}),
      voice,
    });
  }
  return builder.build();
}

describe('identifyChordFromMidi (live detection)', () => {
  it('names triads from MIDI numbers', () => {
    expect(identifyChordFromMidi([60, 64, 67])).toBe('CM'); // C E G
    expect(identifyChordFromMidi([57, 60, 64])).toBe('Am'); // A C E
  });

  it('matches the Note-based identifyChord for the same pitches', () => {
    // First-inversion C major (E in the bass) — both entry points share the
    // same Tonal detection path, so their labels must agree.
    const score = scoreFrom([
      ['E4', 0, 1],
      ['G4', 0, 1],
      ['C5', 0, 1],
    ]);
    const fromNotes = identifyChord(scoreNotes(score));
    expect(identifyChordFromMidi([64, 67, 72])).toBe(fromNotes);
    expect(fromNotes.length).toBeGreaterThan(0);
  });

  it('dedupes octave doublings and ignores input order', () => {
    expect(identifyChordFromMidi([72, 67, 60, 64, 48])).toBe(identifyChordFromMidi([60, 64, 67]));
  });

  it('returns the empty string for no notes', () => {
    expect(identifyChordFromMidi([])).toBe('');
  });

  it('falls back to pitch-class names for non-chords', () => {
    const label = identifyChordFromMidi([60, 61]); // C + C# — no chord
    expect(label.length).toBeGreaterThan(0);
  });
});

describe('segmentChords (Tonal-backed naming)', () => {
  it('names a C major triad', () => {
    const score = scoreFrom([
      ['C4', 0, 2],
      ['E4', 0, 2],
      ['G4', 0, 2],
    ]);
    const segments = segmentChords(score);
    expect(segments[0]?.chord).toBe('CM');
  });

  it('preserves enharmonic spelling and detects a dominant seventh', () => {
    const score = scoreFrom([
      ['G3', 0, 2],
      ['B3', 0, 2],
      ['D4', 0, 2],
      ['F4', 0, 2],
    ]);
    expect(segmentChords(score)[0]?.chord).toBe('G7');
  });

  it('splits a window when a new harmony enters mid-window', () => {
    // One quarter of C major then one quarter of G major inside a single
    // default window (2 quarters): segmentation follows onset boundaries.
    const score = scoreFrom([
      ['C4', 0, 1],
      ['E4', 0, 1],
      ['G4', 0, 1],
      ['G3', 1, 1],
      ['B3', 1, 1],
      ['D4', 1, 1],
    ]);
    const segments = segmentChords(score);
    expect(segments.map((s) => s.chord)).toEqual(['CM', 'GM']);
    expect(segments[0]).toMatchObject({startQuarters: 0, endQuarters: 1});
    expect(segments[1]).toMatchObject({startQuarters: 1, endQuarters: 2});
  });

  it('does not merge identical chords across a rest', () => {
    // C major at beats 0–1, a rest at 1–2, then C major again at 2–3.
    const score = scoreFrom([
      ['C4', 0, 1],
      ['E4', 0, 1],
      ['G4', 0, 1],
      ['C4', 2, 1],
      ['E4', 2, 1],
      ['G4', 2, 1],
    ]);
    const segments = segmentChords(score);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({chord: 'CM', startQuarters: 0, endQuarters: 1});
    expect(segments[1]).toMatchObject({chord: 'CM', startQuarters: 2, endQuarters: 3});
  });

  it('merges contiguous identical chords and unions pitch classes', () => {
    const score = scoreFrom([
      // The same C major chord re-struck across two contiguous windows.
      ['C4', 0, 2],
      ['E4', 0, 2],
      ['G4', 0, 2],
      ['C4', 2, 2],
      ['E4', 2, 2],
      ['G4', 2, 2],
    ]);
    const segments = segmentChords(score);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({startQuarters: 0, endQuarters: 4});
    expect(segments[0].pitchClasses).toEqual([0, 4, 7]);
  });
});

describe('romanNumerals (standard notation)', () => {
  it('labels I and V7 in C major', () => {
    const score = scoreFrom([
      ['C4', 0, 2],
      ['E4', 0, 2],
      ['G4', 0, 2],
      ['G3', 2, 2],
      ['B3', 2, 2],
      ['D4', 2, 2],
      ['F4', 2, 2],
    ]);
    const romans = romanNumerals(score, {tonic: 'C', mode: 'major'});
    expect(romans.map((r) => r.roman)).toEqual(['I', 'V7']);
  });

  it('respects minor mode: i, V7 and III in A minor', () => {
    const score = scoreFrom([
      // Am
      ['A3', 0, 2],
      ['C4', 0, 2],
      ['E4', 0, 2],
      // E7
      ['E3', 2, 2],
      ['G#3', 2, 2],
      ['B3', 2, 2],
      ['D4', 2, 2],
      // C
      ['C4', 4, 2],
      ['E4', 4, 2],
      ['G4', 4, 2],
    ]);
    const romans = romanNumerals(score, {tonic: 'A', mode: 'minor'});
    expect(romans.map((r) => r.roman)).toEqual(['i', 'V7', 'III']);
  });

  it('uses standard case and quality symbols per chord', () => {
    const key = {tonic: 'C', mode: 'major'} as const;
    expect(romanNumeralForChord('CM', key)).toBe('I');
    expect(romanNumeralForChord('Dm', key)).toBe('ii');
    expect(romanNumeralForChord('Dm7', key)).toBe('ii7');
    expect(romanNumeralForChord('G7', key)).toBe('V7');
    expect(romanNumeralForChord('Bdim', key)).toBe('vii°');
    expect(romanNumeralForChord('Bm7b5', key)).toBe('vii\u00f87');
    expect(romanNumeralForChord('Caug', key)).toBe('I+');
    expect(romanNumeralForChord('Cmaj7', key)).toBe('Imaj7');
    expect(romanNumeralForChord('Db', key)).toBe('bII');
  });

  it('accepts precomputed segments and returns identical results', () => {
    const score = scoreFrom([
      ['C4', 0, 2],
      ['E4', 0, 2],
      ['G4', 0, 2],
      ['G3', 2, 2],
      ['B3', 2, 2],
      ['D4', 2, 2],
      ['F4', 2, 2],
    ]);
    const key = {tonic: 'C', mode: 'major'} as const;
    const segments = segmentChords(score);
    expect(romanNumerals(score, key, {segments})).toEqual(romanNumerals(score, key));
  });
});

/**
 * Brute-force reference implementation of segmentChords (the previous
 * per-segment-filter algorithm) used to validate the sweep-line rewrite.
 */
function referenceSegments(score: Score, windowQuarters = 2): ChordSegment[] {
  const EPSILON = 1e-9;
  const end = score.durationQuarters.toFloat();
  const allNotes = [...scoreNotes(score)];

  const boundarySet = new Set<number>([0, end]);
  for (const note of allNotes) {
    const onset = note.onsetQuarters.toFloat();
    const offset = note.offsetQuarters.toFloat();
    if (onset > 0 && onset < end) boundarySet.add(onset);
    if (offset > 0 && offset < end) boundarySet.add(offset);
  }
  const base = [...boundarySet].sort((a, b) => a - b);
  const boundaries: number[] = [];
  for (let index = 0; index < base.length; index += 1) {
    boundaries.push(base[index]);
    const next = base[index + 1];
    if (next == null) continue;
    for (let cut = base[index] + windowQuarters; cut < next - EPSILON; cut += windowQuarters) {
      boundaries.push(cut);
    }
  }

  const segments: ChordSegment[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const stop = boundaries[index + 1];
    if (stop - start < EPSILON) continue;
    const sounding = allNotes.filter((note) => {
      const onset = note.onsetQuarters.toFloat();
      const offset = note.offsetQuarters.toFloat();
      return onset < stop - EPSILON && offset > start + EPSILON;
    });
    if (sounding.length === 0) continue;
    const pitchClasses = [...new Set(sounding.map((note) => pitchClass(noteMidi(note))))].sort((a, b) => a - b);
    segments.push({startQuarters: start, endQuarters: stop, pitchClasses, chord: identifyChord(sounding)});
  }

  // Merging mutates segments in place, so drop the readonly modifiers locally.
  const merged: Array<{-readonly [K in keyof ChordSegment]: ChordSegment[K]}> = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    const contiguous = previous != null && Math.abs(previous.endQuarters - segment.startQuarters) < EPSILON;
    if (previous && contiguous && previous.chord === segment.chord) {
      previous.endQuarters = segment.endQuarters;
      previous.pitchClasses = [...new Set([...previous.pitchClasses, ...segment.pitchClasses])].sort((a, b) => a - b);
    } else {
      merged.push({...segment});
    }
  }
  return merged;
}

function assertInvariants(segments: ChordSegment[], durationQuarters: number): void {
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    // No empty/negative segments, all within the score.
    expect(segment.endQuarters).toBeGreaterThan(segment.startQuarters);
    expect(segment.startQuarters).toBeGreaterThanOrEqual(0);
    expect(segment.endQuarters).toBeLessThanOrEqual(durationQuarters + 1e-9);
    // Sorted, non-overlapping.
    if (index > 0) expect(segment.startQuarters).toBeGreaterThanOrEqual(segments[index - 1].endQuarters - 1e-9);
    // Pitch classes sorted and unique.
    expect(segment.pitchClasses).toEqual([...new Set(segment.pitchClasses)].sort((a, b) => a - b));
    expect(segment.pitchClasses.length).toBeGreaterThan(0);
  }
}

describe('segmentChords sweep-line vs brute-force reference', () => {
  const cases: Array<{name: string; notes: Array<[string, number, number]>; windowQuarters?: number}> = [
    {
      name: 'pedal note overlapping a chord change mid-window',
      notes: [
        ['C3', 0, 4], // pedal across both harmonies
        ['E4', 0, 2],
        ['G4', 0, 2],
        ['F4', 2, 2],
        ['A4', 2, 2],
      ],
    },
    {
      name: 'rests between chords and a re-struck chord',
      notes: [
        ['C4', 0, 1],
        ['E4', 0, 1],
        ['G4', 0, 1],
        // rest 1–2
        ['C4', 2, 1],
        ['E4', 2, 1],
        ['G4', 2, 1],
        // rest 3–4
        ['G3', 4, 2],
        ['B3', 4, 2],
        ['D4', 4, 2],
        ['F4', 5, 1], // seventh enters mid-chord
      ],
    },
    {
      name: 'long held chord subdivided by a small window',
      notes: [
        ['C4', 0, 8],
        ['E4', 0, 8],
        ['G4', 0, 8],
        ['A4', 3, 2], // changes harmony mid-window
      ],
      windowQuarters: 1,
    },
    {
      name: 'dense overlapping voices with staggered onsets/offsets',
      notes: [
        ['C3', 0, 3],
        ['G3', 0.5, 3],
        ['E4', 1, 1.5],
        ['C5', 1.5, 2],
        ['F3', 3, 2],
        ['A3', 3.5, 1.5],
        ['C4', 4, 1],
        ['E5', 4.5, 0.5],
        ['B2', 5, 2],
        ['D4', 5, 1.5],
        ['F4', 5.5, 1],
        ['G4', 6, 1],
      ],
    },
  ];

  for (const {name, notes, windowQuarters} of cases) {
    it(`matches the reference on: ${name}`, () => {
      const score = scoreFrom(notes);
      const fast = segmentChords(score, windowQuarters ? {windowQuarters} : {});
      const reference = referenceSegments(score, windowQuarters ?? 2);
      expect(fast).toEqual(reference);
      assertInvariants(fast, score.durationQuarters.toFloat());
    });
  }

  it('covers exactly the sounding regions (rests produce gaps)', () => {
    const score = scoreFrom([
      ['C4', 0, 1],
      ['E4', 0, 1],
      ['C4', 2, 1],
      ['E4', 2, 1],
    ]);
    const segments = segmentChords(score);
    expect(segments.map((s) => [s.startQuarters, s.endQuarters])).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
});
