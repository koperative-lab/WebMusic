// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {Rational} from '../../src/core';
import type {ScoreAnnotation} from '../../src/view/core/annotations';
import {drawThumbnailScoreAnnotations} from '../../src/view/render/annotations';

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

describe('thumbnail overview annotation layout', () => {
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
});
