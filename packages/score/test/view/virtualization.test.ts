import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {BaseSVGVisualizer} from '../../src/view/render/renderers/svg';
import {WaterfallSVGVisualizer} from '../../src/view/render/renderers/waterfall';
import type {ScoreNoteSequence, ScoreSequenceNote} from '../../src/view/core/types';
import type {VisualizerConfig} from '../../src/view/render/renderers/base';
import {StubElement, installStubGlobals, type StubGlobals} from './stub-dom';

/** Dense sequence: one note every 0.125 s (8 notes/s), 0.125 s long. */
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
 * Test double mirroring PianoRollSVGVisualizer's wiring (stub svg + stub
 * scroll viewport) without the SVGSVGElement instanceof check.
 */
class VirtualizedTestVisualizer extends BaseSVGVisualizer {
  constructor(
    sequence: ScoreNoteSequence,
    svg: StubElement,
    viewport: StubElement,
    config: VisualizerConfig = {},
  ) {
    super(sequence, config);
    this.svg = svg as unknown as SVGSVGElement;
    this.parentElement = viewport as unknown as HTMLElement;
    this.clear();
    this.draw();
  }

  get mountedCount(): number {
    return this.noteElements.filter(Boolean).length;
  }

  get range(): {start: number; end: number} {
    return this.renderedRange;
  }

  get extras(): Set<number> {
    return this.extraIndices;
  }

  elementAt(index: number): unknown {
    return this.noteElements[index];
  }
}

// pixelsPerSecond defaults to 30; 8 notes/s → 3.75 px per note.
// viewport 600 px → 20 s visible → 160 notes; buffer 1 screen each side
// → window ≈ 480 notes (+1 maxDuration slack).
function makeViewport(clientWidth = 600): StubElement {
  const viewport = new StubElement('div');
  viewport.clientWidth = clientWidth;
  return viewport;
}

describe('SVG viewport virtualization', () => {
  let globals: StubGlobals;

  beforeEach(() => {
    globals = installStubGlobals();
  });

  afterEach(() => {
    globals.restore();
  });

  it('mounts only the visible window (± buffer) instead of all notes', () => {
    const sequence = makeSequence(10_000);
    const svg = new StubElement('svg');
    const visualizer = new VirtualizedTestVisualizer(sequence, svg, makeViewport());

    // 10 000 notes is over the default threshold → virtualization on.
    expect(visualizer.mountedCount).toBeGreaterThan(0);
    expect(visualizer.mountedCount).toBeLessThan(600);
    expect(globals.document.nsCreated.rect ?? 0).toBe(visualizer.mountedCount);
    expect(visualizer.range.start).toBe(0);
  });

  it('stays below the default threshold: all notes mounted, no listeners', () => {
    const sequence = makeSequence(100);
    const svg = new StubElement('svg');
    const viewport = makeViewport();
    const visualizer = new VirtualizedTestVisualizer(sequence, svg, viewport);

    expect(visualizer.mountedCount).toBe(100);
    expect(viewport.listeners.scroll ?? []).toHaveLength(0);
  });

  it('virtualization: true forces windowing even for small scores', () => {
    const sequence = makeSequence(100);
    // 100 notes span 12.5 s = 375 px; a 100 px viewport (+1 buffer screen)
    // covers only part of it.
    const visualizer = new VirtualizedTestVisualizer(sequence, new StubElement('svg'), makeViewport(100), {
      virtualization: true,
    });
    expect(visualizer.mountedCount).toBeGreaterThan(0);
    expect(visualizer.mountedCount).toBeLessThan(100);
  });

  it('virtualization: false keeps the always-mounted DOM for huge scores', () => {
    const sequence = makeSequence(5_000);
    const visualizer = new VirtualizedTestVisualizer(sequence, new StubElement('svg'), makeViewport(), {
      virtualization: false,
    });
    expect(visualizer.mountedCount).toBe(5_000);
  });

  it('bufferScreens widens the mounted window', () => {
    const sequence = makeSequence(10_000);
    const narrow = new VirtualizedTestVisualizer(sequence, new StubElement('svg'), makeViewport(), {
      virtualization: {bufferScreens: 0},
    });
    const wide = new VirtualizedTestVisualizer(sequence, new StubElement('svg'), makeViewport(), {
      virtualization: {bufferScreens: 3},
    });
    expect(wide.mountedCount).toBeGreaterThan(narrow.mountedCount * 2);
  });

  it('adds/removes rects incrementally across simulated scrolls', () => {
    const sequence = makeSequence(10_000);
    const svg = new StubElement('svg');
    const viewport = makeViewport();
    const visualizer = new VirtualizedTestVisualizer(sequence, svg, viewport);
    const initialRange = visualizer.range;
    const initialCreated = globals.document.nsCreated.rect ?? 0;

    // Scroll to the middle of the piece (note 5000 is at 625 s × 30 px/s).
    viewport.scrollLeft = 5_000 * 0.125 * 30;
    viewport.dispatch('scroll'); // rAF unavailable in Node → synchronous

    const movedRange = visualizer.range;
    expect(movedRange.start).toBeGreaterThan(initialRange.end);
    // Old window unmounted...
    expect(visualizer.elementAt(0)).toBeUndefined();
    expect(visualizer.elementAt(initialRange.end - 1)).toBeUndefined();
    // ...new window mounted, same bounded size.
    expect(visualizer.elementAt(5_000)).toBeDefined();
    expect(visualizer.mountedCount).toBe(movedRange.end - movedRange.start);
    expect(visualizer.mountedCount).toBeLessThan(600);
    // Only the new window's rects were created on top of the initial ones.
    const createdAfterScroll = (globals.document.nsCreated.rect ?? 0) - initialCreated;
    expect(createdAfterScroll).toBe(movedRange.end - movedRange.start);

    // Scroll back to the start: the original window is re-mounted.
    viewport.scrollLeft = 0;
    viewport.dispatch('scroll');
    expect(visualizer.elementAt(0)).toBeDefined();
    expect(visualizer.elementAt(5_000)).toBeUndefined();
    expect(visualizer.mountedCount).toBeLessThan(600);
  });

  it('highlights an out-of-window note by rendering it on demand', () => {
    const sequence = makeSequence(10_000);
    const svg = new StubElement('svg');
    const viewport = makeViewport();
    const visualizer = new VirtualizedTestVisualizer(sequence, svg, viewport);

    const farNote = sequence.notes[8_000];
    expect(visualizer.elementAt(8_000)).toBeUndefined();

    const position = visualizer.redraw(farNote);
    const element = visualizer.elementAt(8_000) as StubElement | undefined;
    expect(element).toBeDefined();
    expect(element!.classList.contains('active')).toBe(true);
    expect(position).toBe(Number(element!.getAttribute('x')));
    expect(visualizer.extras.has(8_000)).toBe(true);

    // Once the highlight clears and a window update runs, the extra is swept.
    visualizer.clearActiveNotes();
    viewport.dispatch('scroll');
    expect(visualizer.extras.has(8_000)).toBe(false);
    expect(visualizer.elementAt(8_000)).toBeUndefined();
  });

  it('keeps an active note mounted when it scrolls out of the window', () => {
    const sequence = makeSequence(10_000);
    const viewport = makeViewport();
    const visualizer = new VirtualizedTestVisualizer(sequence, new StubElement('svg'), viewport);

    const note = sequence.notes[10];
    visualizer.redraw(note);
    expect((visualizer.elementAt(10) as StubElement).classList.contains('active')).toBe(true);

    viewport.scrollLeft = 5_000 * 0.125 * 30;
    viewport.dispatch('scroll');

    // Still mounted (tracked as extra) while highlighted...
    expect(visualizer.elementAt(10)).toBeDefined();
    expect(visualizer.extras.has(10)).toBe(true);

    // ...and swept after the highlight clears.
    visualizer.clearActiveNotes();
    viewport.dispatch('scroll');
    expect(visualizer.elementAt(10)).toBeUndefined();
  });

  it('redraw with an in-window active note never touches out-of-window rects', () => {
    const sequence = makeSequence(10_000);
    const viewport = makeViewport();
    const visualizer = new VirtualizedTestVisualizer(sequence, new StubElement('svg'), viewport);
    const before = globals.document.nsCreated.rect ?? 0;

    visualizer.redraw(sequence.notes[5]);

    // No on-demand mounts were needed; bookkeeping is O(active).
    expect(globals.document.nsCreated.rect ?? 0).toBe(before);
    expect(visualizer.extras.size).toBe(0);
  });

  it('falls back to mounting everything when the viewport is unmeasurable', () => {
    const sequence = makeSequence(3_000);
    const viewport = makeViewport(0); // e.g. display:none — no window math possible
    const visualizer = new VirtualizedTestVisualizer(sequence, new StubElement('svg'), viewport);
    expect(visualizer.mountedCount).toBe(3_000);
  });

  it('dispose removes the scroll listener and drawn content', () => {
    const sequence = makeSequence(10_000);
    const viewport = makeViewport();
    const svg = new StubElement('svg');
    const visualizer = new VirtualizedTestVisualizer(sequence, svg, viewport);
    expect(viewport.listeners.scroll).toHaveLength(1);

    visualizer.dispose();
    expect(viewport.listeners.scroll).toHaveLength(0);
    expect(svg.children).toHaveLength(0);
    expect(visualizer.mountedCount).toBe(0);

    const hostContent = new StubElement('text');
    svg.appendChild(hostContent);
    visualizer.dispose(); // idempotent
    visualizer.redraw(sequence.notes[8_000]);
    visualizer.clearActiveNotes();
    expect(viewport.listeners.scroll).toHaveLength(0);
    expect(svg.children).toEqual([hostContent]);
  });
});

describe('waterfall vertical window mapping', () => {
  it('maps scrollTop through the top padding to an inverted time window', () => {
    // Bypass the DOM-heavy constructor: the mapping only needs a few fields.
    // Model the real layout produced by setupDOM: the scrollable content is
    // [top padding | notes svg] with padding == the container's border-box
    // height (== clientHeight), so svg-space y = scroll-space y − padding.
    const visualizer = Object.create(WaterfallSVGVisualizer.prototype) as WaterfallSVGVisualizer;
    const internals = visualizer as unknown as {
      parentElement: unknown;
      config: unknown;
      virtualizationConfig: unknown;
      height: number;
      scrollPaddingTop: number;
      getVisibleTimeWindow(): {t0: number; t1: number} | undefined;
    };
    internals.parentElement = {clientHeight: 400, scrollTop: 1_000};
    internals.config = {pixelsPerSecond: 30};
    internals.virtualizationConfig = {enabled: true, bufferScreens: 0};
    internals.height = 3_000;
    internals.scrollPaddingTop = 400;

    // Visible scroll-space y ∈ [1000, 1400] → svg-space y ∈ [600, 1000]
    // → time ∈ [(3000-1000)/30, (3000-600)/30].
    const window = internals.getVisibleTimeWindow();
    expect(window).toBeDefined();
    expect(window!.t0).toBeCloseTo(2_000 / 30);
    expect(window!.t1).toBeCloseTo(2_400 / 30);
    expect(window!.t0).toBeLessThan(window!.t1);
  });

  it('returns undefined when the container has no measurable height', () => {
    const visualizer = Object.create(WaterfallSVGVisualizer.prototype) as WaterfallSVGVisualizer;
    const internals = visualizer as unknown as {
      parentElement: unknown;
      getVisibleTimeWindow(): unknown;
    };
    internals.parentElement = {clientHeight: 0, scrollTop: 0};
    expect(internals.getVisibleTimeWindow()).toBeUndefined();
  });
});

describe('waterfall virtualization and follow scroll (real constructor)', () => {
  let globals: StubGlobals;

  beforeEach(() => {
    globals = installStubGlobals();
  });

  afterEach(() => {
    globals.restore();
  });

  // Geometry: pixelsPerSecond 30, 4000 notes at 8/s → totalTime 500 s →
  // svg height 15 000 px. Host container 400 px tall fills the notes viewport;
  // its CSS height == paddingTop == 400 px, so
  // svg-space y = scroll-space y − 400 and
  // scrollHeight = 400 + 15 000.
  const PADDING = 400;
  const SVG_HEIGHT = 15_000;
  const PPS = 30;

  function makeWaterfall(config: ConstructorParameters<typeof WaterfallSVGVisualizer>[2] = {}) {
    const sequence = makeSequence(4_000);
    const container = new StubElement('div');
    container.clientHeight = PADDING;
    const visualizer = new WaterfallSVGVisualizer(
      sequence,
      container as unknown as HTMLDivElement,
      config,
    );
    const viewport = container.children.find((child) =>
      child.classList.contains('waterfall-notes-container'),
    )!;
    // Stub layout metrics the real browser would compute from the CSS above.
    viewport.clientHeight = PADDING;
    viewport.scrollHeight = PADDING + SVG_HEIGHT;
    const noteElements = (visualizer as unknown as {noteElements: Array<unknown>}).noteElements;
    return {sequence, visualizer, viewport, noteElements};
  }

  it('bufferScreens: 0 still mounts every note inside the visible area', () => {
    const {sequence, viewport, noteElements} = makeWaterfall({virtualization: {bufferScreens: 0}});
    viewport.scrollTop = 7_000;
    viewport.dispatch('scroll'); // rAF unavailable in Node → synchronous

    // Visible scroll-space [7000, 7400] → svg-space [6600, 7000]
    // → time [(15000−7000)/30, (15000−6600)/30] ≈ [266.67, 280].
    const visibleT0 = (SVG_HEIGHT - (viewport.scrollTop + viewport.clientHeight - PADDING)) / PPS;
    const visibleT1 = (SVG_HEIGHT - (viewport.scrollTop - PADDING)) / PPS;

    const mountedCount = noteElements.filter(Boolean).length;
    expect(mountedCount).toBeGreaterThan(0);
    expect(mountedCount).toBeLessThan(300); // windowed, not everything

    // With zero buffer the mounted window must still cover the visible area:
    // every note lying strictly inside it is mounted.
    let strictlyVisible = 0;
    for (let index = 0; index < sequence.notes.length; index += 1) {
      const note = sequence.notes[index];
      if (note.startTime > visibleT0 && note.endTime < visibleT1) {
        strictlyVisible += 1;
        expect(noteElements[index], `visible note ${index} (${note.startTime}s) must be mounted`).toBeDefined();
      }
    }
    expect(strictlyVisible).toBeGreaterThan(50);
  });

  it('follow mode keeps the active note pinned to the visible bottom edge', () => {
    const {sequence, visualizer, viewport} = makeWaterfall();
    // Start at the bottom of the scroll range (time 0 on screen), like the
    // constructor's `scrollTop = scrollHeight` does under real layout.
    viewport.scrollTop = PADDING + SVG_HEIGHT - viewport.clientHeight; // 15 000
    viewport.dispatch('scroll');

    // Note 80 starts at 10 s → svg-space bottom edge y+h = 15000 − 300 = 14700.
    visualizer.redraw(sequence.notes[80]); // scheduleFrame is synchronous here
    // Pinned: the note's bottom edge sits exactly on the visible bottom edge,
    // i.e. scrollTop + clientHeight == padding + (svg y + h).
    expect(viewport.scrollTop + viewport.clientHeight).toBe(PADDING + 14_700);
    // Because padding == clientHeight, that target equals the svg-space
    // bottom edge itself — the historical observable behavior.
    expect(viewport.scrollTop).toBe(14_700);

    // Playback advances → the view keeps following upward.
    visualizer.redraw(sequence.notes[240]); // 30 s → bottom edge 14 100
    expect(viewport.scrollTop).toBe(14_100);

    // Ordinary forward playback does not undo a manual look-ahead.
    viewport.scrollTop = 13_000;
    visualizer.redraw(sequence.notes[320]); // 40s, landing would be 13 800
    expect(viewport.scrollTop).toBe(13_000);

    // An earlier playback position is a seek or repeat and rewinds the view.
    visualizer.redraw(sequence.notes[80]);
    expect(viewport.scrollTop).toBe(14_700);
    visualizer.redraw(sequence.notes[0]);
    expect(viewport.scrollTop).toBe(15_000);
    visualizer.dispose();
    expect(() => visualizer.redraw(sequence.notes[240])).not.toThrow();
    expect(viewport.scrollTop).toBe(15_000);
  });
});
