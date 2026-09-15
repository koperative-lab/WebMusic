// @vitest-environment jsdom

import {describe, expect, it} from 'vitest';
import {MeasureId, PartId, Rational, ScoreBuilder, type Score} from '../../src/core';
import {createPlayheadHighlighter} from '../../src/analyze/element/internal/playhead';

/** 120 bpm, so one quarter is half a second. */
function scoreAt120(): Score {
  const builder = new ScoreBuilder();
  const timeSignature = {numerator: 4, denominator: 4};
  builder
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  builder.addPart({id: PartId('p'), name: 'Part', staves: 1});
  builder.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature,
  });
  return builder.build();
}

interface SpanFixture {
  element: HTMLElement;
  scrolls: () => number;
}

function spanElement(spans: string): SpanFixture {
  const element = document.createElement('div');
  element.dataset.spans = spans;
  element.dataset.webscoreIdleStyle = 'display:flex;';
  element.style.cssText = element.dataset.webscoreIdleStyle;
  let count = 0;
  element.scrollIntoView = () => { count += 1; };
  return {element, scrolls: () => count};
}

function rootOf(children: SpanFixture[]): HTMLElement {
  const root = document.createElement('div');
  root.append(...children.map(({element}) => element));
  return root;
}

const lit = (element: HTMLElement) =>
  element.classList.contains('is-playing') && element.getAttribute('aria-current') === 'true';

describe('analysis playhead highlighter', () => {
  it('delegates span discovery, active paint and stable scrolling to the UI controller', () => {
    const score = scoreAt120();
    const first = spanElement('0:2');
    const second = spanElement('2:4');
    const root = rootOf([first, second]);
    const highlighter = createPlayheadHighlighter();

    highlighter.follow(root, score, 0.1);
    highlighter.follow(root, score, 0.2);
    highlighter.follow(root, score, 0.3);
    expect(lit(first.element)).toBe(true);
    expect(first.scrolls()).toBe(1);

    highlighter.follow(root, score, 1.2);
    expect(lit(first.element)).toBe(false);
    expect(lit(second.element)).toBe(true);
    expect(second.scrolls()).toBe(1);

    highlighter.follow(root, score, 1.4);
    expect(second.scrolls()).toBe(1);
  });

  it('re-reads spans that were rewritten in place', () => {
    const score = scoreAt120();
    const fixture = spanElement('0:2');
    const root = rootOf([fixture]);
    const highlighter = createPlayheadHighlighter();

    highlighter.follow(root, score, 0.5);
    expect(lit(fixture.element)).toBe(true);

    fixture.element.dataset.spans = '4:6';
    highlighter.follow(root, score, 0.5);
    expect(lit(fixture.element)).toBe(false);

    highlighter.follow(root, score, 2.5);
    expect(lit(fixture.element)).toBe(true);
  });

  it('clears every highlight it owns', () => {
    const score = scoreAt120();
    const fixture = spanElement('0:2');
    const root = rootOf([fixture]);
    const highlighter = createPlayheadHighlighter();

    highlighter.follow(root, score, 0.5);
    expect(lit(fixture.element)).toBe(true);

    highlighter.clear();
    expect(lit(fixture.element)).toBe(false);
    expect(fixture.element.style.cssText).toContain('display: flex');
  });
});
