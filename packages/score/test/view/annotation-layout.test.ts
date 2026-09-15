// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {Rational} from '../../src/core';
import type {ScoreAnnotation} from '../../src/view/core/annotations';
import {drawHorizontalScoreAnnotations, drawThumbnailScoreAnnotations, drawVerticalScoreAnnotations} from '../../src/view/render/annotations';

function annotation(label: string, start: number, end?: number): ScoreAnnotation {
  return {
    partId: 'piano', label, startQuarters: start, endQuarters: end, changes: [],
    source: end === undefined ? {kind: 'words', text: label, onsetQuarters: Rational.from(start)}
      : {kind: 'pedal', type: 'start', onsetQuarters: Rational.from(start)},
  };
}
function surface(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  return svg;
}
afterEach(() => document.body.replaceChildren());

describe('compact shared annotation layout', () => {
  it('retains simultaneous spans in a bounded overflow rail without painting them over an occupied span', () => {
    const svg = surface();
    const result = drawHorizontalScoreAnnotations(svg, [annotation('Ped. A', 0, 8), annotation('Ped. B', 1, 4), annotation('Ped. C', 1, 5), annotation('rit.', 9)], {
      width: 500, maxLanes: 1, xAtQuarter: (quarter) => quarter * 40,
    });
    const overflow = [...svg.querySelectorAll('[data-webscore-annotation-overflow]')];
    expect(svg.querySelectorAll('[data-webscore-direction]')).toHaveLength(4);
    expect(overflow).toHaveLength(2);
    expect(overflow.flatMap((group) => [...group.querySelectorAll('path')])).toHaveLength(1);
    expect(overflow[0].querySelector('path')?.getAttribute('d')).toBe('M40 19v4');
    expect(overflow[0].querySelector('title')?.textContent).toBe('Ped. B (1–4 quarters); Ped. C (1–5 quarters)');
    expect(result.height).toBeLessThan(36);
    expect(svg.querySelector('[data-webscore-direction-end="8"] path')?.getAttribute('d')).toContain('H320');
  });

  it('combines simultaneous waterfall expressions into readable full-width wrapped lines', () => {
    const svg = surface();
    drawVerticalScoreAnnotations(svg, [annotation('sempre crescendo', 1), annotation('poco a poco ritardando', 1)], {
      yAtQuarter: () => 40, x: 200, width: 160, height: 200,
    });
    const labels = [...svg.querySelectorAll('text')];
    expect(new Set(labels.map((label) => Number(label.getAttribute('x')))).size).toBe(1);
    expect(labels.map((label) => label.textContent).join(' ')).toBe('sempre crescendo poco a poco ritardando');
    expect(svg.querySelectorAll('[data-webscore-annotation-callout]')).toHaveLength(1);
    expect([...svg.querySelectorAll('[data-webscore-direction]')].map((group) => group.getAttribute('aria-label')))
      .toEqual(['sempre crescendo', 'poco a poco ritardando']);
  });

  it('fits wide browser glyphs to the assigned label width', () => {
    const original = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getComputedTextLength');
    Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {configurable: true, value(this: SVGElement) { return (this.textContent?.length ?? 0) * 14; }});
    try {
      const svg = surface();
      drawVerticalScoreAnnotations(svg, [annotation('WWWWWWWWWWWWWWWWWWWW', 1)], {
        yAtQuarter: () => 40, x: 0, width: 160, height: 200,
      });
      const label = svg.querySelector('text')!;
      expect(label.textContent!.length * 14).toBeLessThanOrEqual(147);
      expect(label.textContent).toMatch(/…$/);
      expect(svg.querySelector('title')?.textContent).toBe('WWWWWWWWWWWWWWWWWWWW');
    } finally {
      if (original) Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', original);
      else Reflect.deleteProperty(SVGElement.prototype, 'getComputedTextLength');
    }
  });

  it('uses the requested note color for text and expression strokes on both axes', () => {
    const horizontal = surface(); const vertical = surface();
    const marks = [annotation('Ped.', 0, 4)];
    drawHorizontalScoreAnnotations(horizontal, marks, {width: 200, xAtQuarter: (quarter) => quarter * 40, color: '#a34'});
    drawVerticalScoreAnnotations(vertical, marks, {height: 200, width: 160, x: 0, yAtQuarter: (quarter) => 180 - quarter * 40, color: '#a34'});
    for (const svg of [horizontal, vertical]) {
      expect(svg.querySelector('[data-webscore-annotations]')?.getAttribute('color')).toBe('#a34');
      expect(svg.querySelector('[data-webscore-annotations]')?.getAttribute('fill')).toBe('#a34');
      expect(svg.querySelector('path')?.getAttribute('stroke')).toBe('currentColor');
    }
  });

  it('keeps the opening tempo words, dynamics and pedal visible above their shared time-zero anchor', () => {
    const svg = surface();
    const pedal = annotation('Ped.', 0, 4);
    drawVerticalScoreAnnotations(svg, [annotation('Andantino con moto', 0), annotation('p', 0), pedal], {
      yAtQuarter: (quarter) => 400 - quarter * 30, x: 200, width: 180, height: 400,
    });
    const labels = [...svg.querySelectorAll('text')];
    expect(labels.map((label) => label.textContent).join(' ')).toBe('Andantino con moto p · Ped.');
    expect(labels.every((label) => Number(label.getAttribute('y')) < 399)).toBe(true);
    expect([...svg.querySelectorAll('[data-webscore-direction]')].map((mark) => mark.getAttribute('data-webscore-annotation-anchor')))
      .toEqual(['399', '399', '399']);
    expect(svg.querySelector('[data-webscore-direction-end="4"] path')?.getAttribute('d')).toContain('V280');
  });

  it('bounds top-edge callouts and overlapping span tracks without losing source endpoints', () => {
    const svg = surface();
    const marks = Array.from({length: 7}, (_, index) => annotation(`Ped. ${index}`, index, 10));
    marks.push(annotation('rit.', 9.6), annotation('a tempo', 10));
    drawVerticalScoreAnnotations(svg, marks, {yAtQuarter: (quarter) => 200 - quarter * 20, x: 200, width: 180, height: 200});
    expect(svg.querySelectorAll('[data-webscore-direction]')).toHaveLength(marks.length);
    expect(svg.querySelectorAll('[data-webscore-annotation-span-overflow]').length).toBeGreaterThan(0);
    const boxes = [...svg.querySelectorAll('[data-webscore-annotation-callout]')].map((callout) => {
      const ys = [...callout.querySelectorAll('text')].map((label) => Number(label.getAttribute('y')));
      return {top: Math.min(...ys) - 12, bottom: Math.max(...ys) + 3};
    }).sort((a, b) => a.top - b.top);
    expect(boxes.every((box) => box.top >= 0 && box.bottom <= 200)).toBe(true);
    for (let index = 1; index < boxes.length; index += 1) expect(boxes[index].top).toBeGreaterThanOrEqual(boxes[index - 1].bottom);
  });

  it('summarizes hundreds of thumbnail marks as readable clusters instead of tiny repeated notation', () => {
    const svg = surface();
    const marks = Array.from({length: 300}, (_, index) => annotation(index % 12 === 0 ? 'rit.' : 'Ped.', index, index + 2));
    const layout = drawThumbnailScoreAnnotations(svg, marks, {width: 600, xAtQuarter: (quarter) => quarter * 2});
    expect(layout.height).toBe(24);
    expect(svg.querySelectorAll('[data-webscore-direction]')).toHaveLength(300);
    expect(svg.querySelectorAll('[data-webscore-annotation-cluster]')).toHaveLength(5);
    expect(svg.querySelectorAll('text')).toHaveLength(5);
    expect(svg.querySelectorAll('path')).toHaveLength(5);
    expect([...svg.querySelectorAll('text')].every((label) => !label.textContent!.includes('…'))).toBe(true);
    expect(svg.querySelector('[data-webscore-annotation-cluster]')!.getAttribute('aria-label')).toContain('quarters 0–2');
  });

  it('backtracks after a terminal callout grows at the top, preserving exact anchors and complete labels', () => {
    const svg = surface();
    const positions = [35, 10, 9, 100];
    const marks = [annotation('A', 0), annotation('B', 1), annotation('A long expression text here', 2), annotation('Earlier', 3)];
    drawVerticalScoreAnnotations(svg, marks, {yAtQuarter: (quarter) => positions[quarter], x: 0, width: 180, height: 300});
    const boxes = [...svg.querySelectorAll('[data-webscore-annotation-callout]')].map((callout) => {
      const ys = [...callout.querySelectorAll('text')].map((label) => Number(label.getAttribute('y')));
      return {top: Math.min(...ys) - 12, bottom: Math.max(...ys) + 3};
    }).sort((a, b) => a.top - b.top);
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => box.top >= 0 && box.bottom <= 300)).toBe(true);
    for (let index = 1; index < boxes.length; index += 1) expect(boxes[index].top).toBeGreaterThanOrEqual(boxes[index - 1].bottom + 3);
    for (const [index, mark] of marks.entries()) {
      const source = svg.querySelector(`[data-webscore-direction-onset="${index}"]`)!;
      expect(source.getAttribute('data-webscore-annotation-anchor')).toBe(String(positions[index]));
      expect(source.getAttribute('aria-label')).toBe(mark.label);
      expect(source.querySelector('path')?.getAttribute('d')).toContain(` ${positions[index]}h2`);
    }
    const merged = svg.querySelector('[data-webscore-annotation-callout="3"]')!;
    expect(merged.getAttribute('aria-label')).toContain('A long expression text here');
    expect(merged.getAttribute('aria-label')).toContain('B (quarter 1)');
  });
});
