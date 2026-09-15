import {describe, expect, it} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {distributions} from '../../src/analyze/core/distributions';
import {createScoreReport} from '../../src/analyze/headless/report';

function melody(pitches: string[], durations?: Duration[]): Score {
  const builder = new ScoreBuilder();
  const partId = builder.newPartId();
  builder.addPart({id: partId, name: 'Melody'});
  const voice = VoiceId(`${partId}-v1`);
  let onset = Rational.ZERO;
  pitches.forEach((name, index) => {
    const duration = durations?.[index] ?? Duration.quarter();
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(name),
      onsetQuarters: onset,
      duration,
      voice,
    });
    onset = onset.add(duration.quarters);
  });
  return builder.build();
}

describe('distributions', () => {
  it('weights pitch classes by sounding duration, not note count', () => {
    // One long C against three short Ds: C must dominate despite being rarer.
    const score = melody(
      ['C4', 'D4', 'D4', 'D4'],
      [Duration.whole(), Duration.quarter(), Duration.quarter(), Duration.quarter()],
    );
    const {pitchClasses} = distributions(score);

    expect(pitchClasses).toHaveLength(12);
    const c = pitchClasses.find((bin) => bin.key === 0)!;
    const d = pitchClasses.find((bin) => bin.key === 2)!;
    expect(c.label).toBe('C');
    expect(c.value).toBeGreaterThan(d.value);
    // Every other class is silent.
    expect(pitchClasses.filter((bin) => bin.value > 0)).toHaveLength(2);
  });

  it('counts melodic intervals as signed semitones in ascending order', () => {
    const {intervals} = distributions(melody(['C4', 'E4', 'D4']));

    expect(intervals.map((bin) => bin.key)).toEqual([-2, 4]);
    expect(intervals.map((bin) => bin.label)).toEqual(['-2', '+4']);
    expect(intervals.every((bin) => bin.value === 1)).toBe(true);
  });

  it('groups durations on the exact rational so triplets stay one bin', () => {
    const third = Duration.triplet(Duration.quarter());
    const {durations} = distributions(melody(['C4', 'D4', 'E4'], [third, third, third]));

    expect(durations).toHaveLength(1);
    expect(durations[0]!.value).toBe(3);
  });

  it('returns empty interval and duration sets for an empty score', () => {
    const empty = new ScoreBuilder().build();
    const result = distributions(empty);

    expect(result.intervals).toEqual([]);
    expect(result.durations).toEqual([]);
    expect(result.pitchClasses.every((bin) => bin.value === 0)).toBe(true);
  });
});

describe('createScoreReport', () => {
  it('combines summary, key and chord facts into display rows', () => {
    const report = createScoreReport(melody(['C4', 'E4', 'G4', 'C5']));
    const labels = report.rows.map((row) => row.label);

    expect(labels).toContain('Key');
    expect(labels).toContain('Confidence');
    expect(labels).toContain('Notes');
    expect(labels).toContain('Chord segments');
    expect(report.rows.find((row) => row.label === 'Notes')?.value).toBe('4');
    expect(report.rows.find((row) => row.label === 'Confidence')?.value).toMatch(/^\d+%$/);
  });

  it('is pure — the same score yields an equal report', () => {
    const score = melody(['C4', 'E4', 'G4']);
    expect(createScoreReport(score)).toEqual(createScoreReport(score));
  });
});
