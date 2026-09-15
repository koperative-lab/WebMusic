import {describe, expect, it} from 'vitest';
import {
  Duration,
  MeasureId,
  PartId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
} from '../../src/core';
import {ScoreTimeline} from '../../src/play/headless/score-timeline';

function buildTimelineScore() {
  const builder = new ScoreBuilder();
  const partId = PartId('clarinet');
  const voice = VoiceId('clarinet-v1');
  const timeSignature = {numerator: 4, denominator: 4};
  builder
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  builder.addPart({
    id: partId,
    name: 'B-flat Clarinet',
    transpose: {chromatic: -2, diatonic: -1},
  });
  builder.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature,
  });
  const add = (
    pitch: string,
    onsetQuarters: Rational,
    duration: Duration,
    extra: {tie?: 'start' | 'stop'; grace?: boolean} = {},
  ) => builder.addNote(partId, {
    id: builder.newNoteId(),
    pitch: Pitch.parse(pitch),
    onsetQuarters,
    duration,
    voice,
    ...extra,
  });

  add('D4', Rational.ZERO, Duration.quarter(), {tie: 'start'});
  add('D4', Rational.ONE, Duration.quarter(), {tie: 'stop'});
  add('B3', Rational.ONE, new Duration({base: 0}), {grace: true});
  add('F4', new Rational(2), Duration.quarter());
  add('E4', new Rational(2), Duration.quarter());
  return builder.build();
}

describe('ScoreTimeline', () => {
  it('builds one cached, rate-independent performance snapshot', () => {
    const timeline = new ScoreTimeline(buildTimelineScore());
    const notes = timeline.prepare();

    expect(timeline.prepare()).toBe(notes);
    expect(notes.map(({midi}) => midi)).toEqual([60, 62, 63]);
    expect(notes.map(({start}) => start)).toEqual([0, 1, 1]);
    expect(notes[0].end - notes[0].start).toBeCloseTo(1);
    expect(timeline.maxNoteDuration).toBeCloseTo(1);
  });

  it('owns lower and upper bound lookup for seek and live rate changes', () => {
    const timeline = new ScoreTimeline(buildTimelineScore());

    expect(timeline.lowerBound(0)).toBe(0);
    expect(timeline.upperBound(0)).toBe(1);
    expect(timeline.lowerBound(0.5)).toBe(1);
    expect(timeline.lowerBound(1)).toBe(1);
    expect(timeline.upperBound(1)).toBe(3);
    expect(timeline.lowerBound(2)).toBe(3);
  });
});
