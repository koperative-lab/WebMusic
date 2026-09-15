import {
  Duration,
  NoteId,
  PartId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
  type MidiNumber,
  type Score,
} from '../../src/core';
import {describe, expect, it} from 'vitest';
import type {AnalysisResult, AnalysisSessionOptions} from '../../src/analyze/api';
import {segmentChords} from '../../src/analyze/core/chords';
import {detectKey} from '../../src/analyze/core/key';
import {findMotifs} from '../../src/analyze/core/motif';
import {romanNumerals} from '../../src/analyze/core/roman';
import {createAnalysisSession} from '../../src/analyze/headless/session';
import {voiceLeading} from '../../src/analyze/core/voice-leading';

/** Deterministic mulberry32 PRNG so failures are reproducible. */
function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCALE = [0, 2, 4, 5, 7, 9, 11];

/**
 * Melodic multi-voice score: `voices` random-walk voices spread over
 * `parts` parts, `notesPerVoice` notes each, mixed eighth/quarter/half
 * rhythms so chord windows split and merge at many boundaries.
 */
function buildScore(notesPerVoice: number, voices = 4, parts = 2, seed = 42): Score {
  const rand = rng(seed);
  const builder = new ScoreBuilder();
  const partIds = Array.from({length: parts}, (_, p) => {
    const id = PartId(`part-${p}`);
    builder.addPart({id, name: `Part ${p}`});
    return id;
  });
  const centers = [76, 69, 62, 50];
  const durations: Array<[number, number]> = [[1, 2], [1, 2], [1, 1], [3, 2], [2, 1]];
  for (let v = 0; v < voices; v += 1) {
    let degree = 0;
    let onsetEighths = 0;
    for (let i = 0; i < notesPerVoice; i += 1) {
      const r = rand();
      if (r < 0.55) degree += rand() < 0.5 ? 1 : -1;
      else if (r < 0.8) degree += rand() < 0.5 ? 2 : -2;
      else if (r < 0.9) degree += rand() < 0.5 ? 4 : -4;
      if (degree > 10) degree -= 4;
      if (degree < -10) degree += 4;
      const center = centers[v % centers.length];
      const octave = Math.floor(degree / 7);
      const midi = Math.max(24, Math.min(100, center + octave * 12 + SCALE[((degree % 7) + 7) % 7]));
      const [num, den] = durations[(rand() * durations.length) | 0];
      builder.addNote(partIds[v % parts], {
        id: NoteId(`n-${v}-${i}`),
        pitch: Pitch.fromMidi(midi as MidiNumber),
        onsetQuarters: new Rational(onsetEighths, 2),
        duration: new Duration({base: new Rational(num, den)}),
        voice: VoiceId(`voice-${v}`),
      });
      onsetEighths += (num * 2) / den;
    }
  }
  return builder.build();
}

type FreshOptions = AnalysisSessionOptions;

/** From-scratch analysis with the standalone functions (the ground truth). */
function freshAnalysis(score: Score, options: FreshOptions = {}): AnalysisResult {
  const key = detectKey(score);
  return {
    key,
    chords: segmentChords(score, {windowQuarters: options.windowQuarters}),
    roman: romanNumerals(score, key, {windowQuarters: options.windowQuarters}),
    motifs: findMotifs(score, {
      length: options.motifLength,
      minOccurrences: options.minOccurrences,
    }),
    issues: voiceLeading(score),
  };
}

function liveNoteIds(score: Score): string[] {
  const ids: string[] = [];
  for (const part of score.parts) for (const note of part.notes) ids.push(note.id);
  return ids;
}

/** Apply one random edit (pitch / move / resize / remove / add) to one part. */
function randomEdit(score: Score, rand: () => number, step: number): Score {
  const ids = liveNoteIds(score);
  const id = NoteId(ids[(rand() * ids.length) | 0]);
  const span = Math.max(1, Math.ceil(score.durationQuarters.toFloat()));
  const roll = rand();
  return score.edit((tx) => {
    if (roll < 0.35) {
      tx.updateNote(id, {pitch: Pitch.fromMidi((36 + ((rand() * 48) | 0)) as MidiNumber)});
    } else if (roll < 0.6) {
      // Move anywhere in the score, including to the very start/end.
      tx.updateNote(id, {onsetQuarters: new Rational((rand() * span * 2) | 0, 2)});
    } else if (roll < 0.75) {
      tx.updateNote(id, {duration: new Duration({base: new Rational(1 + ((rand() * 4) | 0), 2)})});
    } else if (roll < 0.9) {
      tx.removeNote(id);
    } else {
      tx.addNote(score.parts[(rand() * score.parts.length) | 0].id, {
        id: NoteId(`added-${step}`),
        pitch: Pitch.fromMidi((40 + ((rand() * 40) | 0)) as MidiNumber),
        onsetQuarters: new Rational((rand() * span * 2) | 0, 2),
        duration: new Duration({base: new Rational(1, 1)}),
        voice: VoiceId('voice-added'),
      });
    }
  });
}

describe('createAnalysisSession', () => {
  it('matches a from-scratch analysis across 20 random edits (2k notes)', () => {
    let score = buildScore(500); // 4 voices × 500 = 2000 notes
    const session = createAnalysisSession(score);
    expect(session.result).toEqual(freshAnalysis(score));

    const rand = rng(1234);
    for (let step = 0; step < 20; step += 1) {
      score = randomEdit(score, rand, step);
      const updated = session.update(score);
      // The centerpiece invariant: incremental === from scratch, deeply.
      expect(updated).toEqual(freshAnalysis(score));
      expect(session.score).toBe(score);
    }
  });

  it('matches across edits with non-default options', () => {
    let score = buildScore(150, 4, 2, 7); // 600 notes
    const options = {windowQuarters: 1, motifLength: 3, minOccurrences: 3};
    const session = createAnalysisSession(score, options);
    expect(session.result).toEqual(freshAnalysis(score, options));

    const rand = rng(99);
    for (let step = 0; step < 10; step += 1) {
      score = randomEdit(score, rand, step);
      expect(session.update(score)).toEqual(freshAnalysis(score, options));
    }
  });

  it('rejects non-finite or structurally invalid analysis options', () => {
    const score = buildScore(4, 1, 1);
    expect(() => createAnalysisSession(score, {windowQuarters: Number.NaN})).toThrow(/finite/);
    expect(() => createAnalysisSession(score, {windowQuarters: Number.POSITIVE_INFINITY})).toThrow(/finite/);
    expect(() => createAnalysisSession(score, {motifLength: 1.5})).toThrow(/positive safe integer/);
    expect(() => createAnalysisSession(score, {minOccurrences: 0})).toThrow(/positive safe integer/);
  });

  it('returns the cached result for the same score identity', () => {
    const score = buildScore(50);
    const session = createAnalysisSession(score);
    const first = session.result;
    expect(session.update(score)).toBe(first);
  });

  it('deep-freezes shared results so one session cannot poison another', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('cache-isolation');
    const voice = VoiceId('cache-isolation-v1');
    builder.addPart({id: partId, name: 'Cache isolation'});
    [60, 79, 81, 83, 62, 81, 83, 85].forEach((midi, index) => {
      builder.addNote(partId, {
        id: NoteId(`cache-note-${index}`),
        pitch: Pitch.fromMidi(midi as MidiNumber),
        onsetQuarters: new Rational(index),
        duration: Duration.quarter(),
        voice,
      });
    });
    const score = builder.build();
    const first = createAnalysisSession(score).result;
    const issue = first.issues[0]!;
    const motif = first.motifs[0]!;

    expect(issue).toBeDefined();
    expect(motif).toBeDefined();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.issues)).toBe(true);
    expect(Object.isFrozen(issue)).toBe(true);
    expect(Object.isFrozen(issue.voices)).toBe(true);
    expect(Object.isFrozen(first.motifs)).toBe(true);
    expect(Object.isFrozen(motif)).toBe(true);
    expect(Object.isFrozen(motif.intervals)).toBe(true);
    expect(Object.isFrozen(motif.occurrences[0]!.noteIndexes)).toBe(true);

    const originalSeverity = issue.severity;
    const originalVoices = [...issue.voices];
    const originalIntervals = [...motif.intervals];
    expect(() => {
      (issue as {severity: 'info'}).severity = 'info';
    }).toThrow(TypeError);
    expect(() => (issue.voices as string[]).push('poison')).toThrow(TypeError);
    expect(() => {
      (motif.intervals as number[])[0] = 999;
    }).toThrow(TypeError);
    expect(() => (motif.occurrences[0]!.noteIndexes as number[]).push(999)).toThrow(TypeError);

    const second = createAnalysisSession(score).result;
    expect(second.issues[0]!.severity).toBe(originalSeverity);
    expect(second.issues[0]!.voices).toEqual(originalVoices);
    expect(second.motifs[0]!.intervals).toEqual(originalIntervals);
  });

  it('falls back correctly when parts are added or removed', () => {
    const score = buildScore(100, 4, 2);
    const session = createAnalysisSession(score);

    const without = score.withoutPart(score.parts[1].id);
    expect(session.update(without)).toEqual(freshAnalysis(without));

    // Bring the part back (appended → different part order than the original).
    const restored = without.withPart(score.parts[1]);
    expect(session.update(restored)).toEqual(freshAnalysis(restored));
  });

  it('handles an empty score and growing from empty', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('p0');
    builder.addPart({id: partId, name: 'P'});
    const empty = builder.build();
    const session = createAnalysisSession(empty);
    expect(session.result).toEqual(freshAnalysis(empty));

    const withNotes = empty.edit((tx) => {
      for (let i = 0; i < 8; i += 1) {
        tx.addNote(partId, {
          id: NoteId(`n${i}`),
          pitch: Pitch.fromMidi((60 + SCALE[i % 7]) as MidiNumber),
          onsetQuarters: new Rational(i, 1),
          duration: new Duration({base: new Rational(1, 1)}),
          voice: VoiceId('v1'),
        });
      }
    });
    expect(session.update(withNotes)).toEqual(freshAnalysis(withNotes));
  });
});
