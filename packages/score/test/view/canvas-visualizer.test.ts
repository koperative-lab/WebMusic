import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {PianoRollCanvasVisualizer} from '../../src/view/render/renderers/piano-roll';
import {MAX_CANVAS_DIMENSION} from '../../src/view/core/windowing';
import type {ScoreNoteSequence, ScoreSequenceNote} from '../../src/view/core/types';
import {
  StubCanvasElement,
  StubElement,
  installStubGlobals,
  type StubGlobals,
} from './stub-dom';

/** Dense sequence: one 0.125 s note every 0.125 s (8 notes/s). */
function makeSequence(count: number): ScoreNoteSequence {
  const notes: ScoreSequenceNote[] = Array.from({length: count}, (_, index) => ({
    pitch: 36 + (index % 48),
    velocity: 80,
    startTime: index * 0.125,
    endTime: index * 0.125 + 0.125,
  }));
  return {
    ticksPerQuarter: 220,
    tempos: [{time: 0, qpm: 120}],
    timeSignatures: [],
    keySignatures: [],
    partInfos: [],
    notes,
    totalTime: count * 0.125,
  };
}

/**
 * Build a canvas already inside a reusable scroll-viewport stub (the
 * `data-webscore-scroll-viewport` marker makes ensureScrollViewport adopt it
 * instead of creating one, so we can preset clientWidth before construction).
 */
function makeCanvasInViewport(clientWidth: number): {canvas: StubCanvasElement; viewport: StubElement} {
  const viewport = new StubElement('div');
  viewport.dataset.webscoreScrollViewport = 'webscore-piano-roll-viewport';
  viewport.clientWidth = clientWidth;
  const canvas = new StubCanvasElement();
  canvas.rectHeight = 300; // getRenderedHeight shortcut
  viewport.appendChild(canvas);
  return {canvas, viewport};
}

function makeVisualizer(noteCount: number, clientWidth = 800) {
  const sequence = makeSequence(noteCount);
  const {canvas, viewport} = makeCanvasInViewport(clientWidth);
  const visualizer = new PianoRollCanvasVisualizer(
    sequence,
    canvas as unknown as HTMLCanvasElement,
  );
  const overlay = viewport.children
    .flatMap((child) => [child, ...child.children])
    .find((el): el is StubCanvasElement => el instanceof StubCanvasElement && el !== canvas);
  return {sequence, canvas, viewport, visualizer, overlay};
}

describe('PianoRollCanvasVisualizer layering', () => {
  let globals: StubGlobals;

  beforeEach(() => {
    globals = installStubGlobals(2); // dpr 2
  });

  afterEach(() => {
    globals.restore();
  });

  it('uses exact sounding intervals for overlapping notes and retains that sample on viewport redraw', () => {
    const sequence = makeSequence(3);
    const data: ScoreNoteSequence = {...sequence, totalTime: 3, notes: [
      {pitch: 60, startTime: 0, endTime: 2},
      {pitch: 64, startTime: 1, endTime: 3},
      {pitch: 67, startTime: 1, endTime: 1.5},
    ]};
    const {canvas, viewport} = makeCanvasInViewport(800);
    const visualizer = new PianoRollCanvasVisualizer(data, canvas as unknown as HTMLCanvasElement);
    const overlay = viewport.children.flatMap((child) => [child, ...child.children])
      .find((el): el is StubCanvasElement => el instanceof StubCanvasElement && el !== canvas)!;
    const sample = (seconds: number, expected: number): void => {
      const before = overlay.ctx.fillRectCalls;
      visualizer.redrawAtTime(seconds, false);
      expect(overlay.ctx.fillRectCalls - before).toBe(expected);
    };
    sample(1.25, 3);
    sample(1.5, 2);
    sample(2, 1);
    const before = overlay.ctx.fillRectCalls;
    viewport.dispatch('scroll');
    expect(overlay.ctx.fillRectCalls - before).toBe(1);
    sample(3, 0);
    expect(() => visualizer.redrawAtTime(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    visualizer.dispose();
  });

  it('allocates a viewport-sized backing store, not a timeline-sized one', () => {
    const {canvas} = makeVisualizer(50_000, 800);
    // 50k notes = 6250 s × 30 px/s = 187 500 css px timeline; the old code
    // allocated dpr × 187 500 = 375 000 device px and went silently blank.
    expect(canvas.width).toBe(800 * 2);
    expect(canvas.width).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
  });

  it('caps the backing store to safe limits when no viewport is measurable', () => {
    const {canvas} = makeVisualizer(50_000, 0);
    expect(canvas.width).toBe(MAX_CANVAS_DIMENSION);
    expect(canvas.height).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
  });

  it('creates an overlay canvas and a full-width scroll spacer', () => {
    const {viewport, overlay} = makeVisualizer(50_000, 800);
    expect(overlay).toBeDefined();
    expect(overlay!.style.props['pointer-events']).toBe('none');
    const spacer = viewport.children.find((child) =>
      child.classList.contains('webscore-piano-roll-spacer'),
    );
    expect(spacer).toBeDefined();
    // 6250 s × 30 px/s timeline width drives scrollWidth.
    expect(spacer!.style.props.width).toBe('187500px');
  });

  it('initial static draw paints only the visible window of notes', () => {
    const {canvas} = makeVisualizer(50_000, 800);
    // 800 px visible = 26.6 s ≈ 214 notes — not 50 000.
    expect(canvas.ctx.fillRectCalls).toBeGreaterThan(0);
    expect(canvas.ctx.fillRectCalls).toBeLessThan(400);
  });

  it('noteOn draws O(active) rects on the overlay and leaves the static layer alone', () => {
    const {sequence, canvas, visualizer, overlay} = makeVisualizer(50_000, 800);
    const staticFills = canvas.ctx.fillRectCalls;
    const overlayCtx = overlay!.ctx;
    const baseline = overlayCtx.fillRectCalls;

    // Mid-score noteOn, far outside the rendered static window.
    const active = sequence.notes[25_000];
    const position = visualizer.redraw(active, false);

    expect(canvas.ctx.fillRectCalls).toBe(staticFills); // static untouched
    const overlayFills = overlayCtx.fillRectCalls - baseline;
    expect(overlayFills).toBeGreaterThan(0);
    expect(overlayFills).toBeLessThan(10); // O(active), not O(n)
    expect(position).toBeCloseTo(25_000 * 0.125 * 30);

    // noteOff path: clears the overlay only.
    const clears = overlayCtx.clearRectCalls;
    visualizer.clearActiveNotes();
    expect(overlayCtx.clearRectCalls).toBe(clears + 1);
    expect(canvas.ctx.fillRectCalls).toBe(staticFills);
  });

  it('scrolling redraws the static window with a scroll translate', () => {
    const {canvas, viewport, visualizer} = makeVisualizer(50_000, 800);
    expect(visualizer).toBeDefined();
    const before = canvas.ctx.fillRectCalls;

    viewport.scrollLeft = 90_000; // jump to 3000 s
    viewport.dispatch('scroll'); // rAF unavailable → synchronous

    const delta = canvas.ctx.fillRectCalls - before;
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(400); // windowed, not full repaint
    // Transform carries the -scrollX translate (× scaleX = dpr 2).
    expect(canvas.ctx.lastTransform[4]).toBe(-90_000 * 2);
  });

  it('redraw() with no active note refreshes the window and clears highlights', () => {
    const {visualizer, overlay, canvas} = makeVisualizer(10_000, 800);
    const result = visualizer.redraw();
    expect(result).toBeNull();
    expect(overlay!.ctx.clearRectCalls).toBeGreaterThan(0);
    expect(canvas.ctx.fillRectCalls).toBeLessThan(800); // still windowed
  });

  it('dispose removes the scroll listener and unwraps the layer elements', () => {
    const {canvas, viewport, visualizer} = makeVisualizer(10_000, 800);
    expect(viewport.listeners.scroll).toHaveLength(1);

    visualizer.dispose();

    expect(viewport.listeners.scroll).toHaveLength(0);
    // Canvas back to a direct viewport child; stage/overlay/spacer gone.
    expect(canvas.parentElement).toBe(viewport);
    expect(viewport.children.some((child) => child.classList.contains('webscore-piano-roll-canvas-stage'))).toBe(false);
    expect(viewport.children.some((child) => child.classList.contains('webscore-piano-roll-spacer'))).toBe(false);

    const clearsAfterFirstDispose = canvas.ctx.clearRectCalls;
    visualizer.dispose(); // idempotent
    expect(canvas.parentElement).toBe(viewport);
    expect(canvas.ctx.clearRectCalls).toBe(clearsAfterFirstDispose);

    visualizer.redraw();
    visualizer.clearActiveNotes();
    expect(canvas.parentElement).toBe(viewport);
    expect(canvas.ctx.clearRectCalls).toBe(clearsAfterFirstDispose);
  });

  it('ignores a viewport redraw queued before dispose', () => {
    const root = globalThis as unknown as {
      requestAnimationFrame?: (callback: () => void) => number;
    };
    const previousRAF = root.requestAnimationFrame;
    let queuedFrame: (() => void) | undefined;
    root.requestAnimationFrame = (callback) => {
      queuedFrame = callback;
      return 1;
    };

    try {
      const {canvas, viewport, visualizer} = makeVisualizer(10_000, 800);
      viewport.scrollLeft = 30_000;
      viewport.dispatch('scroll');
      expect(queuedFrame).toBeDefined();

      const fillsBeforeDispose = canvas.ctx.fillRectCalls;
      visualizer.dispose();
      queuedFrame?.();

      expect(canvas.ctx.fillRectCalls).toBe(fillsBeforeDispose);
    } finally {
      if (previousRAF === undefined) delete root.requestAnimationFrame;
      else root.requestAnimationFrame = previousRAF;
    }
  });

  it('does not follow a note after its renderer has been disposed', () => {
    const root = globalThis as unknown as {
      requestAnimationFrame?: (callback: () => void) => number;
    };
    const previousRAF = root.requestAnimationFrame;
    let queuedFrame: (() => void) | undefined;
    root.requestAnimationFrame = (callback) => {
      queuedFrame = callback;
      return 1;
    };

    try {
      const {sequence, viewport, visualizer} = makeVisualizer(10_000, 800);
      visualizer.redraw(sequence.notes[5_000], true);
      expect(queuedFrame).toBeDefined();

      visualizer.dispose();
      queuedFrame?.();

      expect(viewport.scrollLeft).toBe(0);
    } finally {
      if (previousRAF === undefined) delete root.requestAnimationFrame;
      else root.requestAnimationFrame = previousRAF;
    }
  });
});
