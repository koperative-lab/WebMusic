import {describe, expect, it} from 'vitest';
import {
  layoutStaffCurve, pairStaffCurves, staffBeamInk,
  type StaffCurveAnchor, type StaffCurveEvent, type StaffCurveLayout, type StaffCurveObstacle,
} from '../../src/view/render/renderers/staff-curves';

const head = (x: number, y = 60): StaffCurveAnchor => ({
  head: {left: x - 6, right: x + 6, top: y - 4, bottom: y + 4},
  stemDirection: 'down', stem: {x: x - 5, tipY: y + 35},
});
const event = (id: string, onset: number, extra: Partial<StaffCurveEvent> = {}): StaffCurveEvent =>
  ({id, voice: 'melody', onset, end: onset + 1, pitch: 'C:0:4', ...extra});
const sample = (curve: StaffCurveLayout, t: number) => {
  const u = 1 - t;
  return {x: curve.start.x * u + curve.end.x * t,
    y: curve.start.y * u ** 3 + curve.control1.y * 3 * u ** 2 * t + curve.control2.y * 3 * u * t ** 2 + curve.end.y * t ** 3};
};
const expectClearance = (curve: StaffCurveLayout, obstacles: readonly StaffCurveObstacle[], minimum: number) => {
  for (const obstacle of obstacles) {
    const left = Math.max(curve.start.x, obstacle.left);
    const right = Math.min(curve.end.x, obstacle.right);
    if (left > right) continue;
    for (let index = 0; index <= 100; index += 1) {
      const x = left + (right - left) * index / 100;
      const point = sample(curve, (x - curve.start.x) / (curve.end.x - curve.start.x));
      const distance = curve.side === 'above' ? obstacle.top - point.y : point.y - obstacle.bottom;
      expect(distance).toBeGreaterThanOrEqual(minimum);
    }
  }
};

describe('staff beam ink', () => {
  it('covers a sloping beam without occupying the empty corners of its full bounds', () => {
    const polygon = [{x: 10, y: 20}, {x: 10, y: 25}, {x: 110, y: 55}, {x: 110, y: 50}];
    const before = structuredClone(polygon);
    const strips = staffBeamInk(polygon);
    expect(strips).toHaveLength(20);
    expect(strips[0]).toEqual({left: 10, right: 15, top: 20, bottom: 26.5, kind: 'beam'});
    expect(strips.at(-1)).toEqual({left: 105, right: 110, top: 48.5, bottom: 55, kind: 'beam'});
    for (const strip of strips) {
      expect(strip.top).toBeCloseTo(20 + (strip.left - 10) * 0.3);
      expect(strip.bottom).toBeCloseTo(25 + (strip.right - 10) * 0.3);
    }
    expect(polygon).toEqual(before);
    expect(staffBeamInk([...polygon].reverse())).toEqual(strips);
    expect(staffBeamInk([...polygon, polygon[0]])).toEqual(strips);
  });

  it('retains polygon corners within strips and bounds the work for long beams', () => {
    const strips = staffBeamInk([{x: 0, y: 10}, {x: 8, y: 0}, {x: 20, y: 10}, {x: 8, y: 15}]);
    expect(strips[1].top).toBe(0);
    expect(strips[1].bottom).toBe(15);
    expect(staffBeamInk([{x: 0, y: 0}, {x: 1e8, y: 0}, {x: 1e8, y: 5}, {x: 0, y: 5}])).toHaveLength(512);
    expect(staffBeamInk([{x: 0, y: 0}, {x: 5, y: 5}, {x: 10, y: 10}])).toEqual([]);
    expect(staffBeamInk([{x: 0, y: 0}, {x: 10, y: 0}, {x: NaN, y: 5}])).toEqual([]);
    expect(staffBeamInk([{x: 0, y: 0}, {x: 10, y: 0}, {x: 10, y: 5}], 0)).toEqual([]);
  });
});

describe('staff source curve pairing', () => {
  it('requires contiguous time, voice and written pitch for ties', () => {
    expect(pairStaffCurves([event('a', 0, {tie: 'start'}), event('b', 1, {tie: 'stop'})]))
      .toMatchObject([{kind: 'tie', startId: 'a', endId: 'b'}]);
    for (const other of [{onset: 2}, {voice: 'other'}, {pitch: 'B:1:3'}, {staff: 2}, {part: 'other'}]) {
      expect(pairStaffCurves([event('a', 0, {tie: 'start'}), event('b', 1, {tie: 'stop', ...other})])).toEqual([]);
    }
  });

  it('does not reuse a stale tie after an untied occurrence', () => {
    expect(pairStaffCurves([event('a', 0, {end: 2, tie: 'start'}), event('b', 1), event('c', 2, {tie: 'stop'})]))
      .toEqual([]);
  });

  it('joins fragments by source identity and retains authored tie placement', () => {
    expect(pairStaffCurves([event('a', 0, {sourceId: 'written-a', continuesToNext: true, tiePlacement: 'below'}),
      event('b', 1, {sourceId: 'written-a', continuedFromPrevious: true})]))
      .toMatchObject([{kind: 'tie', startId: 'a', endId: 'b', placement: 'below'}]);
    expect(pairStaffCurves([event('a', 0, {sourceId: 'written-a', continuesToNext: true}),
      event('b', 1, {sourceId: 'written-b', continuedFromPrevious: true})])).toEqual([]);
  });

  it('pairs numbered slurs independently and draws the inner one first', () => {
    const pairs = pairStaffCurves([
      event('outer', 0, {slurs: [{type: 'start', number: 1}]}),
      event('inner', 1, {slurs: [{type: 'start', number: 2, placement: 'below'}]}),
      event('inner-end', 2, {slurs: [{type: 'stop', number: 2}]}),
      event('outer-end', 3, {slurs: [{type: 'stop', number: 1}]}),
    ]);
    expect(pairs).toMatchObject([
      {kind: 'slur', startId: 'inner', endId: 'inner-end', number: 2, placement: 'below'},
      {kind: 'slur', startId: 'outer', endId: 'outer-end', number: 1},
    ]);
  });

  it('accepts an unambiguous cross-voice slur within the same staff', () => {
    expect(pairStaffCurves([event('a', 0, {slurs: [{type: 'start'}]}),
      event('b', 1, {voice: 'response', slurs: [{type: 'stop'}]})]))
      .toMatchObject([{kind: 'slur', startId: 'a', endId: 'b'}]);
    expect(pairStaffCurves([event('a', 0, {slurs: [{type: 'start'}]}),
      event('b', 1, {staff: 2, part: 'other', slurs: [{type: 'stop'}]})])).toEqual([]);
  });

  it('consumes cross-staff source stops before a later reuse of the same number', () => {
    const events = [
      event('m33-lower', 128, {staff: 2, voice: '5', slurs: [{type: 'start', number: 1, placement: 'below'}]}),
      event('m33-upper', 395 / 3, {staff: 1, voice: '2', slurs: [{type: 'stop', number: 1}]}),
      event('m34-upper', 132, {staff: 1, voice: '5', slurs: [{type: 'start', number: 2, placement: 'below'}]}),
      event('m34-lower', 134, {staff: 2, voice: '5', slurs: [{type: 'stop', number: 2}]}),
      event('late-stop', 270, {staff: 1, voice: '5', slurs: [{type: 'stop', number: 2}]}),
    ];
    expect(pairStaffCurves(events)).toMatchObject([
      {startId: 'm34-upper', endId: 'm34-lower', number: 2, placement: 'below'},
      {startId: 'm33-lower', endId: 'm33-upper', number: 1, placement: 'below'},
    ]);
  });

  it('retains other-voice spans that overlap in music time while reusing a source number', () => {
    expect(pairStaffCurves([
      event('upper-start', 120, {staff: 1, voice: '1', slurs: [{type: 'start'}]}),
      event('moving-start', 124, {staff: 1, voice: '5', slurs: [{type: 'start'}]}),
      event('upper-end', 127, {staff: 1, voice: '1', slurs: [{type: 'stop'}]}),
      event('moving-end', 127, {staff: 2, voice: '5', slurs: [{type: 'stop'}]}),
    ])).toMatchObject([
      {startId: 'moving-start', endId: 'moving-end'},
      {startId: 'upper-start', endId: 'upper-end'},
    ]);
  });

  it('retains duplicate authored starts on one note and consumes one for each source stop', () => {
    for (const shortVoice of ['5', '6']) {
      const longVoice = shortVoice === '5' ? '6' : '5';
      const pairs = pairStaffCurves([
        event('m89-start', 352, {staff: 2, voice: '6', slurs: [
          {type: 'start', number: 2, placement: 'below'},
          {type: 'start', number: 2, placement: 'below'},
        ]}),
        event('short-end', 1061 / 3, {staff: 2, voice: shortVoice, slurs: [{type: 'stop', number: 2}]}),
        event('long-end', 358, {staff: 2, voice: longVoice, slurs: [{type: 'stop', number: 2}]}),
        event('extra-stop', 370, {staff: 2, voice: '6', slurs: [{type: 'stop', number: 2}]}),
      ]);
      expect(pairs).toEqual([
        {kind: 'slur', startId: 'm89-start', endId: 'short-end', placement: 'below', number: 2},
        {kind: 'slur', startId: 'm89-start', endId: 'long-end', placement: 'below', number: 2},
      ]);
    }
  });

  it('replaces unused duplicate starts when their voice authors a later new start', () => {
    expect(pairStaffCurves([
      event('old-start', 0, {staff: 2, voice: '6', slurs: [{type: 'start'}, {type: 'start'}]}),
      event('old-short-end', 1, {staff: 2, voice: '5', slurs: [{type: 'stop'}]}),
      event('new-start', 4, {staff: 1, voice: '6', slurs: [{type: 'start'}]}),
      event('new-end', 5, {staff: 2, voice: '6', slurs: [{type: 'stop'}]}),
      event('late-stop', 30, {staff: 2, voice: '6', slurs: [{type: 'stop'}]}),
    ])).toMatchObject([
      {startId: 'old-start', endId: 'old-short-end'},
      {startId: 'new-start', endId: 'new-end'},
    ]);
  });

  it('prefers the voice across staves and replaces a stale same-voice start after a staff change', () => {
    expect(pairStaffCurves([
      event('stale', 0, {staff: 2, voice: '5', slurs: [{type: 'start'}]}),
      event('new-start', 32, {staff: 1, voice: '5', slurs: [{type: 'start'}]}),
      event('other-start', 32, {staff: 2, voice: '6', slurs: [{type: 'start'}]}),
      event('new-end', 34, {staff: 2, voice: '5', slurs: [{type: 'stop'}]}),
      event('other-end', 35, {staff: 2, voice: '6', slurs: [{type: 'stop'}]}),
      event('later-stop', 100, {staff: 2, voice: '5', slurs: [{type: 'stop'}]}),
    ])).toMatchObject([
      {startId: 'new-start', endId: 'new-end'},
      {startId: 'other-start', endId: 'other-end'},
    ]);
  });

  it('keeps Parts independent and does not resurrect candidates after an ambiguous stop', () => {
    const starts = [event('a', 0, {voice: 'a', slurs: [{type: 'start'}]}),
      event('b', 0, {voice: 'b', slurs: [{type: 'start'}]})];
    expect(pairStaffCurves([...starts,
      event('ambiguous', 1, {voice: 'c', slurs: [{type: 'stop'}]}),
      event('late-a', 30, {voice: 'a', slurs: [{type: 'stop'}]}),
    ])).toEqual([]);
    expect(pairStaffCurves([
      event('piano', 0, {part: 'piano', slurs: [{type: 'start'}]}),
      event('violin', 1, {part: 'violin', slurs: [{type: 'stop'}]}),
      event('piano-end', 2, {part: 'piano', staff: 2, slurs: [{type: 'stop'}]}),
    ])).toMatchObject([{startId: 'piano', endId: 'piano-end'}]);
  });

  it('prefers the exact voice and refuses ambiguous cross-voice tails', () => {
    const starts = [event('a', 0, {voice: 'a', slurs: [{type: 'start'}]}),
      event('b', 0, {voice: 'b', slurs: [{type: 'start'}]})];
    expect(pairStaffCurves([...starts, event('end', 1, {voice: 'a', slurs: [{type: 'stop'}]})]))
      .toMatchObject([{kind: 'slur', startId: 'a', endId: 'end'}]);
    expect(pairStaffCurves([...starts, event('end', 1, {voice: 'c', slurs: [{type: 'stop'}]})])).toEqual([]);
  });

  it('keeps continuation marks on one arc, without creating unmatched tails', () => {
    const events = [event('a', 0, {slurs: [{type: 'start'}]}),
      event('mid', 1, {slurs: [{type: 'continue'}]}), event('end', 2, {slurs: [{type: 'stop'}]})];
    expect(pairStaffCurves(events)).toMatchObject([{startId: 'a', endId: 'end'}]);
    expect(pairStaffCurves(events.slice(1))).toEqual([]);
  });

  it('avoids duplicate starts and early stops on split source notes', () => {
    expect(pairStaffCurves([
      event('a1', 0, {continuesToNext: true, slurs: [{type: 'start'}]}),
      event('a2', 1, {continuedFromPrevious: true, slurs: [{type: 'start'}]}),
      event('b1', 2, {continuesToNext: true, slurs: [{type: 'stop'}]}),
      event('b2', 3, {continuedFromPrevious: true, slurs: [{type: 'stop'}]}),
    ]).filter((connection) => connection.kind === 'slur')).toMatchObject([{startId: 'a1', endId: 'b2'}]);
  });
});

describe('staff curve engraving geometry', () => {
  it('uses opposite-stem slurs for one voice and outside placement for multiple voices', () => {
    const start = head(20); const end = head(120);
    expect(layoutStaffCurve({kind: 'slur', start, end, space: 10})?.side).toBe('above');
    start.stemDirection = 'up'; end.stemDirection = 'up';
    expect(layoutStaffCurve({kind: 'slur', start, end, space: 10})?.side).toBe('below');
    expect(layoutStaffCurve({kind: 'slur', start, end, space: 10, stemDirections: ['down']})?.side).toBe('above');
    start.voiceSide = 'above';
    expect(layoutStaffCurve({kind: 'slur', start, end, space: 10})?.side).toBe('above');
    expect(layoutStaffCurve({kind: 'slur', start, end, space: 10, placement: 'below'})?.side).toBe('below');
  });

  it('places chord ties outward while single-note ties follow their own rule', () => {
    expect(layoutStaffCurve({kind: 'tie', start: {...head(20), chordPosition: 'top'}, end: head(100), space: 10})?.side).toBe('above');
    expect(layoutStaffCurve({kind: 'tie', start: {...head(20), chordPosition: 'bottom'}, end: head(100), space: 10})?.side).toBe('below');
    const curve = layoutStaffCurve({kind: 'tie', start: head(20), end: head(100), space: 10})!;
    expect(curve.start.x).toBeGreaterThan(26);
    expect(curve.end.x).toBeLessThan(94);
    expect(curve.path).toMatch(/^M .+ C .+ C .+ Z$/);
  });

  it('anchors stem-side slurs outside actual stem tips instead of cutting through stems', () => {
    const curve = layoutStaffCurve({kind: 'slur', space: 10, placement: 'above',
      start: {...head(20), stemDirection: 'up', stem: {x: 25, tipY: 12}},
      end: {...head(120), stemDirection: 'up', stem: {x: 125, tipY: 22}},
    })!;
    expect(curve.start.y).toBeLessThan(12);
    expect(curve.end.y).toBeLessThan(22);
    expect(curve.control1.x).toBeGreaterThan(curve.start.x);
    expect(curve.control2.x).toBeLessThan(curve.end.x);
  });

  it('scales curvature with span and keeps short ties from forming tall loops', () => {
    const short = layoutStaffCurve({kind: 'tie', start: head(20), end: head(40), space: 10})!;
    const long = layoutStaffCurve({kind: 'tie', start: head(20), end: head(240), space: 10})!;
    expect(short.start.y - short.control1.y).toBeLessThan(short.end.x - short.start.x);
    expect(long.start.y - long.control1.y).toBeGreaterThan(short.start.y - short.control1.y);
  });

  it('clears an interior high note, thin stem, beam and tuplet with sloped endpoints', () => {
    const obstacles: StaffCurveObstacle[] = [
      {left: 47, right: 57, top: 16, bottom: 24, kind: 'note'},
      {left: 85.001, right: 85.02, top: 5, bottom: 64, kind: 'stem'},
      {left: 110, right: 158, top: 12, bottom: 18, kind: 'beam'},
      {left: 130, right: 145, top: -5, bottom: 4, kind: 'tuplet'},
    ];
    const curve = layoutStaffCurve({kind: 'slur', start: head(20), end: head(180, 40), space: 10, placement: 'above', obstacles})!;
    expectClearance(curve, obstacles, 3.5);
    expect(curve.control1.x).toBeGreaterThan(curve.start.x);
    expect(curve.control2.x).toBeLessThan(curve.end.x);
  });

  it('moves endpoints as well as shoulders for obstacles close to attachments', () => {
    const obstacles: StaffCurveObstacle[] = [
      {left: 20, right: 30, top: 5, bottom: 50, kind: 'beam'},
      {left: 110, right: 122, top: 15, bottom: 70, kind: 'stem'},
    ];
    const curve = layoutStaffCurve({kind: 'slur', start: head(20), end: head(120), space: 10, placement: 'above', obstacles})!;
    expectClearance(curve, obstacles, 3.5);
    expect(curve.start.y).toBeLessThan(5);
    expect(curve.end.y).toBeLessThan(15);
  });

  it('mirrors collision avoidance for a below-staff slur', () => {
    const obstacles: StaffCurveObstacle[] = [{left: 60, right: 80, top: 65, bottom: 105, kind: 'stem'}];
    const curve = layoutStaffCurve({kind: 'slur', start: head(20), end: head(120), space: 10, placement: 'below', obstacles})!;
    expectClearance(curve, obstacles, 3.5);
  });

  it('lets a slur clear existing ties without replacing them with one huge rectangle', () => {
    const tie = layoutStaffCurve({kind: 'tie', start: head(20), end: head(120), space: 10, placement: 'above'})!;
    const slur = layoutStaffCurve({kind: 'slur', start: head(20), end: head(120), space: 10,
      placement: 'above', obstacles: tie.obstacles})!;
    expect(tie.obstacles.length).toBeGreaterThan(2);
    expectClearance(slur, tie.obstacles, 3.5);
    expect(sample(slur, 0.5).y).toBeLessThan(sample(tie, 0.5).y);
  });

  it('avoids staff-line attachment collisions and leaves inputs untouched', () => {
    const request = {kind: 'slur' as const, start: head(20, 67), end: head(120, 67), space: 10,
      placement: 'above' as const, staffLines: [40, 50, 60, 70, 80]};
    const before = structuredClone(request);
    const curve = layoutStaffCurve(request)!;
    expect(Math.abs(curve.start.y - 60)).toBeGreaterThanOrEqual(1.39);
    expect(request).toEqual(before);
  });

  it('rejects invalid/reversed endpoints and bounds obstacle-strip counts for long spans', () => {
    expect(layoutStaffCurve({kind: 'slur', start: head(120), end: head(20), space: 10})).toBeUndefined();
    expect(layoutStaffCurve({kind: 'slur', start: head(20), end: head(NaN), space: 10})).toBeUndefined();
    expect(layoutStaffCurve({kind: 'slur', start: head(20), end: head(120), space: 0})).toBeUndefined();
    const curve = layoutStaffCurve({kind: 'slur', start: head(20), end: head(1e8), space: 10})!;
    expect(curve.obstacles.length).toBeLessThanOrEqual(128);
    expect(curve.path).not.toMatch(/NaN|Infinity/);
  });
});
