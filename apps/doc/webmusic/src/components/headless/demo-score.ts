import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '@webmusic/score';

/** Two independent immutable inputs make explicit-source mismatch visible. */
export function followerDemoScore(alternate = false): Score {
  const builder = new ScoreBuilder();
  const part = PartId('piano');
  const voice = VoiceId('melody');
  const meter = {numerator: 4, denominator: 4};
  builder.setMetadata({title: alternate ? 'A minor study' : 'C major study'})
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: meter})
    .addPart({id: part, name: 'Piano', staves: 1});
  for (let bar = 0; bar < 2; bar += 1) {
    builder.addMeasure({id: MeasureId(`m${bar + 1}`), number: bar + 1,
      onsetQuarters: new Rational(bar * 4), durationQuarters: new Rational(4), timeSignature: meter});
  }
  const names = alternate
    ? ['A3', 'C4', 'E4', 'A4', 'G4', 'E4', 'C4', 'A3']
    : ['C4', 'E4', 'G4', 'C5', 'B4', 'G4', 'E4', 'C4'];
  names.forEach((name, index) => builder.addNote(part, {
    id: builder.newNoteId(), pitch: Pitch.parse(name), onsetQuarters: new Rational(index),
    duration: Duration.quarter(), voice,
  }));
  return builder.build();
}

