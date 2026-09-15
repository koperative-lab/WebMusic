import {describe, expect, it} from 'vitest';
import {groupStaffBeams, type StaffBeamEvent, type StaffBeamMeasure} from '../../src/view/core/staff-beaming';

const common: StaffBeamMeasure = {start: 0, numerator: 4, denominator: 4};
const note = (onset: number, base = 0.5, extra: Partial<StaffBeamEvent> = {}): StaffBeamEvent =>
  ({onset, duration: base, base, rest: false, voice: 'upper', ...extra});
const run = (count: number, base = 0.5, start = 0): StaffBeamEvent[] =>
  Array.from({length: count}, (_, index) => note(start + index * base, base));
const indexes = (events: StaffBeamEvent[], measure = common) => groupStaffBeams(events, measure).map((group) => group.indices);
const beam = (type: NonNullable<StaffBeamEvent['beams']>[number]['type'], number = 1) => ({number, type});

describe('staff written-rhythm beam groups', () => {
  it('groups plain 4/4 eighths by half-bar, and 3/4 eighths by quarter', () => {
    expect(indexes(run(8))).toEqual([[0, 1, 2, 3], [4, 5, 6, 7]]);
    expect(indexes(run(6), {...common, numerator: 3})).toEqual([[0, 1], [2, 3], [4, 5]]);
  });

  it('uses quarter groups when either neighboring beat contains sixteenths', () => {
    expect(indexes([...run(2), ...run(4, 0.25, 1), ...run(4, 0.5, 2)]))
      .toEqual([[0, 1], [2, 3, 4, 5], [6, 7, 8, 9]]);
  });

  it.each([6, 9, 12])('uses dotted-quarter groups for %i/8', (numerator) => {
    const groups = indexes(run(numerator), {...common, numerator, denominator: 8});
    expect(groups.map((group) => group.length)).toEqual(Array(numerator / 3).fill(3));
  });

  it('uses 3+2 and 3+2+2 for uncustomized additive eighth meters', () => {
    expect(indexes(run(5), {...common, numerator: 5, denominator: 8})).toEqual([[0, 1, 2], [3, 4]]);
    expect(indexes(run(7), {...common, numerator: 7, denominator: 8})).toEqual([[0, 1, 2], [3, 4], [5, 6]]);
    expect(indexes(run(7), {...common, numerator: 7, denominator: 8, beatGroups: [2, 2, 3]}))
      .toEqual([[0, 1], [2, 3], [4, 5, 6]]);
  });

  it('groups cut-time eighths by half notes', () => {
    expect(indexes(run(8), {...common, numerator: 2, denominator: 2})).toEqual([[0, 1, 2, 3], [4, 5, 6, 7]]);
  });

  it('preserves exact triplet onsets and isolates adjacent authored tuplets', () => {
    const events = Array.from({length: 6}, (_, index) => note(index / 3, 0.5, {
      duration: 1 / 3, tupletId: index < 3 ? 'first' : 'second',
    }));
    const before = structuredClone(events);
    expect(indexes(events)).toEqual([[0, 1, 2], [3, 4, 5]]);
    expect(events).toEqual(before);
  });

  it('keeps a sextuplet together across its internal quarter boundary', () => {
    expect(indexes(Array.from({length: 6}, (_, index) => note(index / 3, 0.5, {
      duration: 1 / 3, tupletId: 'sextuplet',
    })))).toEqual([[0, 1, 2, 3, 4, 5]]);
  });

  it('uses written base instead of treating dotted eighths as quarter notes', () => {
    expect(indexes([note(0, 0.5, {duration: 0.75}), note(0.75, 0.25)]))
      .toEqual([[0, 1]]);
  });

  it('interrupts automatic groups at rests, holes, and quarter notes', () => {
    expect(indexes([note(0), note(0.5), note(1, 0.5, {rest: true}), note(1.5), note(2)]))
      .toEqual([[0, 1]]);
    expect(indexes([note(0), note(0.5), note(1.25), note(1.75)]))
      .toEqual([[0, 1], [2, 3]]);
    expect(indexes([note(0), note(0.5), note(1, 1), note(2), note(2.5)]))
      .toEqual([[0, 1], [3, 4]]);
  });

  it('honors source begin/continue/end across automatic beat boundaries', () => {
    const events = run(8).map((event, index) => ({...event,
      beams: [beam(index === 0 ? 'begin' : index === 7 ? 'end' : 'continue')],
    }));
    expect(indexes(events)).toEqual([[0, 1, 2, 3, 4, 5, 6, 7]]);
    events[3] = {...events[3], beams: [beam('end')]};
    events[4] = {...events[4], beams: [beam('begin')]};
    expect(indexes(events)).toEqual([[0, 1, 2, 3], [4, 5, 6, 7]]);
  });

  it('includes a rest only with authored beaming, and does not beam rests alone', () => {
    expect(indexes([note(0, 0.5, {beams: [beam('begin')]}),
      note(0.5, 0.5, {rest: true, beams: [beam('continue')]}),
      note(1, 0.5, {beams: [beam('end')]})])).toEqual([[0, 1, 2]]);
    expect(indexes([note(0, 0.5, {rest: true, beams: [beam('begin')]}),
      note(0.5, 0.5, {rest: true, beams: [beam('end')]})])).toEqual([]);
  });

  it('preserves independent nonnumeric voices and staff ownership', () => {
    const events = [note(0), note(0, 0.5, {voice: 'lower'}), note(0, 0.5, {staff: 2}),
      note(0.5), note(0.5, 0.5, {voice: 'lower'}), note(0.5, 0.5, {staff: 2})];
    expect(indexes(events)).toEqual([[0, 3], [1, 4], [2, 5]]);
  });

  it('starts meter grouping at the actual measure start after a meter change', () => {
    expect(indexes(run(10, 0.5, 3), {start: 3, numerator: 6, denominator: 8}))
      .toEqual([[0, 1, 2], [3, 4, 5]]);
  });

  it('returns original indexes for sorted events and bounds authored beams to one measure', () => {
    const events = [note(4, 0.5, {beams: [beam('end')]}), note(3.5, 0.5, {beams: [beam('continue')]}),
      note(3, 0.5, {beams: [beam('begin')]})];
    expect(indexes(events)).toEqual([[2, 1]]);
  });

  it('records secondary breaks and authored hooks without changing primary grouping', () => {
    const groups = groupStaffBeams(run(8, 0.125), common);
    expect(groups).toEqual([{indices: [0, 1, 2, 3, 4, 5, 6, 7], secondaryBreaks: [3], hooks: []}]);
    const events = [note(0, 0.25, {beams: [beam('begin'), beam('forward hook', 2)]}),
      note(0.25, 0.5, {duration: 0.75, beams: [beam('end')]})];
    expect(groupStaffBeams(events, common)).toEqual([{
      indices: [0, 1], secondaryBreaks: [0], hooks: [{index: 0, level: 2, direction: 'forward'}],
    }]);
  });

  it('does not replace explicit secondary continuation with an automatic break', () => {
    const events = run(8, 0.125).map((event, index) => ({...event,
      beams: [beam(index === 0 ? 'begin' : index === 7 ? 'end' : 'continue', 2)],
    }));
    expect(groupStaffBeams(events, common)[0].secondaryBreaks).toEqual([]);
  });

  it('keeps primary hooks standalone and rejects invalid geometry without allocating by meter size', () => {
    expect(indexes([note(0, 0.5, {beams: [beam('forward hook')]}), note(0.5)])).toEqual([]);
    expect(indexes([note(0), note(0.5)], {...common, numerator: 1e12})).toEqual([[0, 1]]);
    expect(indexes(run(2), {...common, denominator: 0})).toEqual([]);
    expect(indexes([note(0), note(NaN)])).toEqual([]);
  });
});
