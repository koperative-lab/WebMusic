import {describe, expect, it} from 'vitest';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {chordTimeline, summarizeScore} from '../../src/analyze';

describe('score summary', () => {
  it('summarizes scores and detects a simple chord timeline', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('piano');
    const voice = VoiceId('piano-v1');
    const timeSignature = {numerator: 4, denominator: 4};

    builder
      .setMetadata({title: 'Chord Test'})
      .addTempo({atQuarters: Rational.ZERO, bpm: 120})
      .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});

    builder.addPart({id: partId, name: 'Piano', staves: 1});
    builder.addMeasure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      timeSignature,
    });

    for (const pitch of ['C4', 'E4', 'G4']) {
      builder.addNote(partId, {
        id: builder.newNoteId(),
        pitch: Pitch.parse(pitch),
        onsetQuarters: Rational.ZERO,
        duration: Duration.whole(),
        voice,
      });
    }

    const score = builder.build();

    expect(summarizeScore(score)).toMatchObject({
      title: 'Chord Test',
      parts: 1,
      measures: 1,
      notes: 3,
      timeSignature: '4/4',
      pitchRange: {low: 'C4', high: 'G4'},
    });

    expect(chordTimeline(score, {windowQuarters: 1})).toMatchObject([
      {
        startQuarters: 0,
        endQuarters: 4,
        chord: 'CM',
        root: 'C',
        quality: 'major',
      },
    ]);
  });
});
