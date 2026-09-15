// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {renderStaffVisualizer} from '../../src/view/render';

const q = (value: number) => Rational.from(value);
function music(staves: number[], keys = [0, 0, 0]): Score {
  const builder = new ScoreBuilder();
  builder.addTempo({atQuarters: q(0), bpm: 60});
  for (const [partIndex, count] of staves.entries()) {
    const part = builder.addPart({id: PartId(`part-${partIndex}`), name: 'Part', staves: count});
    for (let staff = 1; staff <= count; staff += 1) builder.addNote(part, {
      id: NoteId(`p${partIndex}s${staff}`), pitch: Pitch.parse(staff === 1 ? 'C5' : 'C3'),
      onsetQuarters: q(0), duration: Duration.quarter(), voice: VoiceId('voice'), staff,
    });
  }
  for (const [index, [start, duration, numerator]] of [[0, 1, 4], [1, 3, 3], [4, 5, 5]].entries()) {
    builder.addMeasure({id: builder.newMeasureId(), number: index, onsetQuarters: q(start), durationQuarters: q(duration),
      timeSignature: {numerator, denominator: 4}, keySignature: {fifths: keys[index]},
      ...(index === 0 ? {clefs: {1: {sign: 'G' as const, line: 2}, 2: {sign: 'F' as const, line: 4}}} : {}),
    });
  }
  return builder.build();
}
function fixture(score: Score) {
  const host = document.createElement('div');
  host.getBoundingClientRect = () => ({width: 240, height: 180, x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 180, toJSON() { return {}; }});
  document.body.append(host);
  const rendered = renderStaffVisualizer(score, host);
  const rows = [...host.querySelectorAll<SVGElement>('[data-webscore-staff-layer]')];
  const viewport = host.querySelector<HTMLElement>('[data-webscore-staff-timeline]')!;
  return {host, rendered, rows, viewport};
}
function numbers(path: Element): number[] { return (path.getAttribute('d')!.match(/-?\d*\.?\d+/g) ?? []).map(Number); }
function rowY(row: Element): number { return Number(/translate\(0 (-?[\d.]+)\)/.exec(row.getAttribute('transform')!)![1]); }

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('notation-aware staff systems', () => {
  it('connects the whole system and braces only adjacent staves of the same part', () => {
    const {host, rendered, rows} = fixture(music([2, 1]));
    expect(rows.map((row) => row.dataset.webscorePart)).toEqual(['0', '0', '1']);
    expect(host.querySelectorAll('[data-webscore-system-brace]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-webscore-system-connector]')).toHaveLength(1);
    const bars = [...host.querySelectorAll('[data-webscore-system-bars] path')];
    expect(bars.length).toBe(3);
    for (const path of bars) {
      const [x1, y1, x2, y2] = numbers(path);
      expect(x1).toBe(x2);
      expect(y1).toBe(rowY(rows[0]) + 80);
      expect(y2).toBe(rowY(rows[1]) + 40);
    }
    rendered.dispose!();
  });

  it('does not add grand-staff braces or connecting barlines across separate parts', () => {
    const {host, rendered} = fixture(music([1, 1, 1]));
    expect(host.querySelectorAll('[data-webscore-system-brace]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-webscore-system-bars] path')).toHaveLength(0);
    expect(host.querySelectorAll('[data-webscore-system-connector]')).toHaveLength(1);
    rendered.dispose!();
  });

  it('aligns actual barlines across all staves after pickup and meter changes', () => {
    const {host, rendered, rows} = fixture(music([2]));
    const ends = rows.map((row) => [...row.querySelectorAll('[data-webscore-barline] path')].map((line) => numbers(line)[0]));
    expect(ends[0].length).toBe(3);
    expect(ends[0]).toEqual(ends[1]);
    expect(ends[0][1]).toBeGreaterThan(ends[0][0]);
    expect(ends[0][2]).toBeGreaterThan(ends[0][1]);
    const extensions = [...host.querySelectorAll('[data-webscore-system-bars] path')].map((path) => numbers(path)[0]);
    expect(extensions).toEqual(ends[0]);
    // One signature per actual source declaration, including the 1-quarter pickup.
    expect(rows[0].querySelectorAll('.vf-timesignature').length).toBe(3);
    rendered.dispose!();
  });

  it('compacts measured staves within a part while keeping notation clearance and original glyph scale', () => {
    const prototype = SVGElement.prototype as SVGElement & {getBBox?: () => DOMRect; getCTM?: () => unknown};
    const oldBox = Object.getOwnPropertyDescriptor(prototype, 'getBBox');
    const oldMatrix = Object.getOwnPropertyDescriptor(prototype, 'getCTM');
    const oldPoint = Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, 'createSVGPoint');
    Object.defineProperty(prototype, 'getBBox', {configurable: true, value: () => ({x: 0, y: 20, width: 300, height: 160})});
    Object.defineProperty(prototype, 'getCTM', {configurable: true, value: () => ({a: 1, b: 0, c: 0, d: 1, e: 0, f: 0})});
    Object.defineProperty(SVGSVGElement.prototype, 'createSVGPoint', {configurable: true, value: () => ({
      x: 0, y: 0, matrixTransform(this: {x: number; y: number}) { return {x: this.x, y: this.y}; },
    })});
    try {
      const same = fixture(music([2]));
      const separate = fixture(music([1, 1]));
      const compactDistance = rowY(same.rows[1]) - rowY(same.rows[0]);
      const separateDistance = rowY(separate.rows[1]) - rowY(separate.rows[0]);
      expect(compactDistance).toBeLessThan(separateDistance);
      expect(compactDistance + 20 - 180).toBeGreaterThanOrEqual(10);
      for (const row of same.rows) expect(row.getAttribute('transform')).not.toContain('scale');
      same.rendered.dispose!();
      separate.rendered.dispose!();
    } finally {
      for (const [name, descriptor] of [['getBBox', oldBox], ['getCTM', oldMatrix]] as const) {
        if (descriptor) Object.defineProperty(prototype, name, descriptor);
        else Reflect.deleteProperty(prototype, name);
      }
      if (oldPoint) Object.defineProperty(SVGSVGElement.prototype, 'createSVGPoint', oldPoint);
      else Reflect.deleteProperty(SVGSVGElement.prototype, 'createSVGPoint');
    }
  });

  it('pans one drawing without rebuilding its barlines and cleans the shared viewport on disposal', () => {
    const {host, rendered, viewport} = fixture(music([2]));
    const bars = host.querySelector('[data-webscore-system-bars]')!;
    const path = bars.firstElementChild!;
    const drawing = host.querySelector<SVGSVGElement>('[data-webscore-staff-drawing]')!;
    const divider = host.querySelector<HTMLElement>('[data-webscore-staff-divider]')!;
    const boundary = Number.parseFloat(divider.style.left);
    viewport.scrollLeft = 100;
    viewport.dispatchEvent(new Event('scroll'));
    expect(bars.firstElementChild).toBe(path);
    expect(viewport.contains(bars)).toBe(true);
    expect(drawing.style.clipPath).toBe(`inset(0 0 0 ${100 + boundary}px)`);
    expect(drawing.getAttribute('aria-hidden')).toBe('true');
    rendered.dispose!();
    rendered.dispose!();
    expect(host.children).toHaveLength(0);
  });

  it('reserves the widest future key signature so C to seven sharps and back do not obscure music or shift the divider', () => {
    const plain = fixture(music([2]));
    const changing = fixture(music([2], [0, 7, 0]));
    const boundary = (host: Element) => Number.parseFloat(host.querySelector<HTMLElement>('[data-webscore-staff-divider]')!.style.left);
    const original = boundary(changing.host);
    expect(original).toBeGreaterThan(boundary(plain.host));
    const drawing = changing.host.querySelector<SVGSVGElement>('[data-webscore-staff-drawing]')!;
    const scale = Number(drawing.getAttribute('width')) / Number(drawing.getAttribute('viewBox')!.split(' ')[2]);
    const nextBarX = numbers(changing.rows[0].querySelector('[data-webscore-barline] path')!)[0];
    changing.viewport.scrollLeft = nextBarX * scale + 1;
    changing.viewport.dispatchEvent(new Event('scroll'));
    expect(boundary(changing.host)).toBe(original);
    expect(changing.host.querySelectorAll('[data-webscore-staff-header] .vf-keysignature path').length).toBe(14);
    changing.rendered.redrawAtTime!(0, true);
    expect(boundary(changing.host)).toBe(original);
    expect(changing.host.querySelectorAll('[data-webscore-staff-header] .vf-keysignature path').length).toBe(0);
    plain.rendered.dispose!();
    changing.rendered.dispose!();
  });

  it('reports a durationless empty score without leaving partial drawing or connections', () => {
    const host = document.createElement('div');
    document.body.append(host);
    expect(() => renderStaffVisualizer(new ScoreBuilder().build(), host)).toThrow(/empty score/);
    expect(host.children).toHaveLength(0);
  });

  it('centers explicit rests on both treble and bass staves instead of treating their placeholder as a pitch', () => {
    const builder = new ScoreBuilder();
    const part = builder.addPart({id: PartId('piano'), name: 'Piano', staves: 2});
    builder.addMeasure({id: builder.newMeasureId(), number: 1, onsetQuarters: q(0), durationQuarters: q(4),
      clefs: {1: {sign: 'G', line: 2}, 2: {sign: 'F', line: 4}}});
    for (const staff of [1, 2]) builder.addNote(part, {id: NoteId(`rest-${staff}`), rest: true,
      onsetQuarters: q(0), duration: Duration.quarter(), voice: VoiceId('rests'), staff});
    const {rendered, rows} = fixture(builder.build());
    const restY = rows.map((row) => numbers(row.querySelector('[data-webscore-onset] path')!)[1]);
    expect(restY[0]).toBe(restY[1]);
    expect(restY[0]).toBeGreaterThan(30);
    expect(restY[0]).toBeLessThan(90);
    rendered.dispose!();
  });
});
