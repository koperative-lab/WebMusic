import {describe, expect, it} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder} from '../../src/core';
import {parseMusicXML, serializeMusicXML} from '../../src/io';

describe('MusicXML performance timing with non-quarter metronome units', () => {
  it('keeps half-note and dotted-quarter tempos when a Score is serialized and reloaded', () => {
    const builder = new ScoreBuilder();
    const part = builder.addPart({id: builder.newPartId(), name: 'Piano'});
    builder.addMeasure({
      id: builder.newMeasureId(), number: 1, onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4), timeSignature: {numerator: 4, denominator: 4},
    });
    builder.addTempo({atQuarters: Rational.ZERO, bpm: 60, unit: 2});
    builder.addTempo({atQuarters: new Rational(2), bpm: 60, unit: 1.5});
    builder.addNote(part, {
      id: builder.newNoteId(), pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO,
      duration: Duration.whole(), voice: builder.newVoiceId(),
    });
    const original = builder.build();
    const reloaded = parseMusicXML(serializeMusicXML(original));
    // Two quarters at half=60 last 1s, then two at dotted-quarter=60 last 4/3s.
    expect(reloaded.durationSeconds).toBeCloseTo(7 / 3, 12);
    for (const [quarter, seconds] of [[0, 0], [1, 0.5], [2, 1], [3, 5 / 3], [4, 7 / 3]]) {
      expect(reloaded.timeMap.quartersToSeconds(new Rational(quarter))).toBeCloseTo(seconds, 12);
      expect(original.timeMap.quartersToSeconds(new Rational(quarter))).toBeCloseTo(seconds, 12);
    }
  });
});
