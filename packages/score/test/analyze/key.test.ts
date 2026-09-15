import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {describe, expect, it} from 'vitest';
import {detectKey} from '../../src/analyze/core/key';

function melodyScore(pitches: string[]) {
  const builder = new ScoreBuilder();
  const partId = builder.newPartId();
  builder.addPart({id: partId, name: 'Melody'});
  const voice = VoiceId(`${partId}-v1`);
  pitches.forEach((name, index) => {
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(name),
      onsetQuarters: new Rational(index),
      duration: Duration.quarter(),
      voice,
    });
  });
  return builder.build();
}

describe('detectKey', () => {
  it('detects a clear C-major melody', () => {
    const result = detectKey(
      melodyScore(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'G4', 'E4', 'C4', 'G4', 'C4']),
    );
    expect(result.tonic).toBe('C');
    expect(result.mode).toBe('major');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.scores[0]).toMatchObject({tonic: 'C', mode: 'major'});
  });

  it('returns unknown (confidence 0, no candidates) for an empty score', () => {
    const result = detectKey(new ScoreBuilder().build());
    expect(result.confidence).toBe(0);
    expect(result.scores).toEqual([]);
  });

  it('gives distinct confidences to clear vs ambiguous input', () => {
    const clear = detectKey(
      melodyScore(['C4', 'E4', 'G4', 'C5', 'G4', 'E4', 'C4', 'F4', 'G4', 'B3', 'C4']),
    );
    // Chromatic input: every key fits equally badly.
    const ambiguous = detectKey(
      melodyScore(['C4', 'C#4', 'D4', 'Eb4', 'E4', 'F4', 'F#4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4']),
    );
    expect(clear.confidence).toBeGreaterThan(ambiguous.confidence);
  });
});
