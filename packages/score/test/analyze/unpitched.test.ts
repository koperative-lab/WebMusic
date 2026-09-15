import {describe, expect, it} from 'vitest';
import {Duration, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {
  chordTimeline,
  detectKey,
  findMotifs,
  identifyChord,
  segmentChords,
  summarizeScore,
  voiceLeading,
} from '../../src/analyze';
import {createAnalysisSession} from '../../src/analyze/headless/session';

function percussionScore() {
  const builder = new ScoreBuilder();
  const partId = PartId('drums');
  builder.addPart({id: partId, name: 'Drums'});
  const add = (voice: string, pitch: string, onset: number) =>
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(pitch),
      unpitched: true,
      onsetQuarters: new Rational(onset),
      duration: Duration.quarter(),
      voice: VoiceId(voice),
    });
  add('drums-1', 'C4', 0);
  add('drums-2', 'G4', 0);
  add('drums-1', 'D4', 1);
  add('drums-2', 'A4', 1);
  add('drums-1', 'E4', 2);
  add('drums-1', 'F4', 3);
  return builder.build();
}

describe('unpitched percussion', () => {
  it('does not contaminate tonal, harmonic, melodic, or voice-leading analysis', () => {
    const score = percussionScore();

    expect(detectKey(score).scores).toEqual([]);
    expect(segmentChords(score)).toEqual([]);
    expect(chordTimeline(score)).toEqual([
      expect.objectContaining({chord: 'rest', notes: [], pitchClasses: []}),
    ]);
    expect(identifyChord(score.notes)).toBe('');
    expect(findMotifs(score, {length: 3})).toEqual([]);
    expect(voiceLeading(score)).toEqual([]);
    expect(summarizeScore(score).pitchRange).toBeUndefined();

    const session = createAnalysisSession(score);
    expect(session.result.key.scores).toEqual([]);
    expect(session.result.chords).toEqual([]);
    expect(session.result.motifs).toEqual([]);
    expect(session.result.issues).toEqual([]);
  });
});
