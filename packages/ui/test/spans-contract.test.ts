// @vitest-environment jsdom

import {describe, expect, it} from 'vitest';
import {
  ANALYSIS_SPAN_SELECTOR,
  createAnalysisPlayhead,
  readAnalysisIdleStyle,
  readAnalysisSpans,
} from '../src/analysis';
import {harmonyInline, harmonyParts} from '../src/harmony-style';
import {restampActiveStyle, stampIdleStyle, stampSpans} from '../src/internal/spans';

/**
 * The stamp and the reader are two halves of one contract, and this file is the
 * only place they are held together.
 *
 * `internal/spans.ts` writes four attributes; `analysis.ts` reads them and has
 * not changed. So every assertion below goes through the REAL reader —
 * `readAnalysisSpans`, `readAnalysisIdleStyle`, `ANALYSIS_SPAN_SELECTOR` and
 * `createAnalysisPlayhead` — rather than through a second copy of the parsing,
 * which would agree with the writer by construction and prove nothing.
 *
 * jsdom's `cssText` is a normalising serialiser: it lowercases, puts a space
 * after every colon, expands `.2rem` to `0.2rem` and always appends a trailing
 * `;`. That is exactly why `stampIdleStyle` reads the value back out of the
 * node instead of taking a string — the round trip has to survive the browser's
 * own opinion of how a declaration is spelled, and it is asserted here as a
 * byte-for-byte equality rather than as a "contains".
 */

function node(): HTMLElement {
  return document.createElement('div');
}

describe('stampSpans', () => {
  it('writes the range form for one span, and the reader gets exactly it back', () => {
    const row = node();
    stampSpans(row, {start: 0, end: 4});
    expect(row.dataset.startQuarters).toBe('0');
    expect(row.dataset.endQuarters).toBe('4');
    // The two forms are mutually exclusive: `readAnalysisSpans` collects BOTH,
    // so a node carrying both reads back as one span too many.
    expect(row.dataset.spans).toBeUndefined();
    expect(readAnalysisSpans(row)).toEqual([{startQuarters: 0, endQuarters: 4}]);
    expect(row.matches(ANALYSIS_SPAN_SELECTOR)).toBe(true);
  });

  it('writes the list form for an array, even when the array holds one entry', () => {
    const row = node();
    stampSpans(row, [
      {start: 0, end: 3},
      {start: 8, end: 11},
    ]);
    // The byte sequence the motif renderer has always written.
    expect(row.dataset.spans).toBe('0:3 8:11');
    expect(row.dataset.startQuarters).toBeUndefined();
    expect(readAnalysisSpans(row)).toEqual([
      {startQuarters: 0, endQuarters: 3},
      {startQuarters: 8, endQuarters: 11},
    ]);

    // One occurrence is still an occurrence LIST. Collapsing it into the range
    // form would give a one-occurrence motif a different node shape from a
    // two-occurrence one, for no reason the caller asked for.
    const single = node();
    stampSpans(single, [{start: 2, end: 5}]);
    expect(single.dataset.spans).toBe('2:5');
    expect(single.dataset.startQuarters).toBeUndefined();
  });

  it('removes the form it is not writing, so the two can never both be present', () => {
    const row = node();
    stampSpans(row, {start: 0, end: 4});
    stampSpans(row, [{start: 6, end: 7}]);
    expect(row.dataset.startQuarters).toBeUndefined();
    expect(row.dataset.endQuarters).toBeUndefined();
    expect(readAnalysisSpans(row)).toEqual([{startQuarters: 6, endQuarters: 7}]);

    stampSpans(row, {start: 1, end: 2});
    expect(row.dataset.spans).toBeUndefined();
    expect(readAnalysisSpans(row)).toEqual([{startQuarters: 1, endQuarters: 2}]);
  });

  it('writes NO attribute for a non-finite number, never the string NaN', () => {
    // A `NaN` node matches the selector and parses to nothing: a zombie the
    // playhead walks on every tick and can never light.
    const broken = node();
    stampSpans(broken, {start: Number.NaN, end: 4});
    expect(broken.dataset.startQuarters).toBeUndefined();
    expect(broken.dataset.endQuarters).toBeUndefined();
    expect(broken.matches(ANALYSIS_SPAN_SELECTOR)).toBe(false);
    expect(broken.outerHTML).not.toContain('NaN');

    const infinite = node();
    stampSpans(infinite, {start: 0, end: Number.POSITIVE_INFINITY});
    expect(infinite.matches(ANALYSIS_SPAN_SELECTOR)).toBe(false);

    const mixed = node();
    stampSpans(mixed, [
      {start: 0, end: 1},
      {start: Number.NaN, end: 2},
    ]);
    expect(mixed.dataset.spans).toBe('0:1');
    expect(readAnalysisSpans(mixed)).toEqual([{startQuarters: 0, endQuarters: 1}]);

    const empty = node();
    stampSpans(empty, []);
    expect(empty.matches(ANALYSIS_SPAN_SELECTOR)).toBe(false);
    stampSpans(empty, undefined);
    expect(empty.matches(ANALYSIS_SPAN_SELECTOR)).toBe(false);
  });

  it('keeps the two axes apart: a lane in seconds stamps in quarters', () => {
    // The whole reason `stampStart`/`stampEnd` exist. The band sits from 2.5 to
    // 4.0 SECONDS and is stamped from 4 to 8 QUARTERS, and the reader — which
    // is fed quarters — sees only the second pair.
    const band = node();
    band.style.cssText = 'left:20%;width:10%;';
    stampSpans(band, {start: 4, end: 8});
    expect(readAnalysisSpans(band)).toEqual([{startQuarters: 4, endQuarters: 8}]);
    expect(band.style.left).toBe('20%');
  });
});

describe('stampIdleStyle', () => {
  it('records the node’s COMPLETE inline style, byte for byte', () => {
    const row = node();
    row.style.cssText = harmonyInline(harmonyParts.timelineRow);
    stampIdleStyle(row);
    // Not "contains" and not a hand-built string: the browser normalises what
    // it stores, and only the value read back out of the node is the value the
    // playhead will restore.
    expect(readAnalysisIdleStyle(row)).toBe(row.style.cssText);
    expect(readAnalysisIdleStyle(row)?.endsWith(';')).toBe(true);
  });

  it('terminates the string, because the playhead concatenates onto it', () => {
    const bare = node();
    // A serialiser that does not append its own `;` still gets one here.
    bare.setAttribute('style', 'color:red');
    stampIdleStyle(bare);
    expect(readAnalysisIdleStyle(bare)?.endsWith(';')).toBe(true);

    const nothing = node();
    stampIdleStyle(nothing);
    expect(readAnalysisIdleStyle(nothing)).toBe('');
  });

  it('survives the playhead lighting the node and putting it back', () => {
    const root = document.createElement('div');
    const band = node();
    band.style.cssText = 'left:20%;width:10%;top:0px;';
    stampSpans(band, {start: 4, end: 8});
    stampIdleStyle(band);
    root.append(band);
    const idle = band.style.cssText;

    const playhead = createAnalysisPlayhead(root, {scroll: false});
    playhead.update(5);
    expect(band.getAttribute('aria-current')).toBe('true');
    // The active style is CONCATENATED onto the idle string, which is the whole
    // reason the terminator matters: without it the join is one malformed
    // declaration and both sides of it are dropped.
    expect(band.style.cssText).toContain('outline');
    expect(band.style.left).toBe('20%');

    playhead.update(12);
    expect(band.style.cssText).toBe(idle);
    expect(band.getAttribute('aria-current')).toBeNull();
    playhead.destroy();
  });
});

describe('restampActiveStyle', () => {
  it('writes the same string the playhead itself writes, byte for byte', () => {
    // Two modules generate this string — `analysis.ts` because it owns the
    // highlight, and `internal/spans.ts` because `harmony.ts` may not import
    // `analysis.ts` and drag the playhead's registry into a second chunk. Both
    // read the same record, and this is where that is held true rather than
    // remembered.
    const root = document.createElement('div');
    const band = node();
    band.style.cssText = 'left:20%;width:10%;';
    stampSpans(band, {start: 4, end: 8});
    stampIdleStyle(band);
    root.append(band);

    const playhead = createAnalysisPlayhead(root, {scroll: false});
    playhead.update(5);
    const lit = band.style.cssText;

    // A writer re-boxes the node underneath the playhead, which is exactly the
    // case the lane and the chip strip hit, and hands the highlight back.
    band.style.cssText = 'left:20%;width:10%;';
    stampIdleStyle(band);
    restampActiveStyle(band);
    expect(band.style.cssText).toBe(lit);
    // Without it the node stays dark for the rest of the span: the playhead
    // lights a node once and skips it while it stays active.
    playhead.update(6);
    expect(band.style.cssText).toBe(lit);
    playhead.destroy();
  });

  it('leaves a node the playhead has not lit exactly as it found it', () => {
    const band = node();
    band.style.cssText = 'left:20%;';
    stampIdleStyle(band);
    const idle = band.style.cssText;
    restampActiveStyle(band);
    expect(band.style.cssText).toBe(idle);
    expect(band.style.cssText).not.toContain('outline');
  });
});
