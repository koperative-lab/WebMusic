// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  ANALYSIS_SPAN_SELECTOR,
  createAnalysisPlayhead,
  readAnalysisIdleStyle,
  readAnalysisSpans,
} from '../src/analysis';
import {harmonyPresenterStyle, mountFlowLane, type FlowBand, type FlowLaneState, type FlowReadout} from '../src/harmony';
import {joinFrameLoop, type FrameClock, type FrameTick} from '../src/internal/frame';

/**
 * What jsdom does NOT give this lane, measured rather than assumed — and the
 * reason four of the rows below would otherwise be vacuously green:
 *
 * - `getBoundingClientRect()` / `clientWidth` are present and all `0`, even
 *   after an inline width. A lane sized from a measurement would pin its now
 *   line at x = 0, and "the reel transform is anchor·W − now·scale" would
 *   compare 0 to 0 and pass while measuring nothing. So every case that cares
 *   about the transform passes `fallbackWidth`, and one case proves the guard
 *   by leaving it out.
 * - `ResizeObserver` and `IntersectionObserver` are absent. Both are optional
 *   in the mount and stubbed here where the behaviour is the subject.
 * - `matchMedia` is absent, so `motion: 'auto'` must never reach it unguarded;
 *   the reduced-motion cases pass `motion` explicitly and one case stubs the
 *   media query to prove the auto path.
 * - `requestAnimationFrame` exists but is a real ~16 ms wall-clock timer. The
 *   loop is therefore tested against a FAKE view, where a frame is a function
 *   call, and the lane is driven through `handle.tick()` or an injected clock.
 */

const BANDS: readonly FlowBand[] = [
  {id: 'a', start: 0, end: 4, stampStart: 0, stampEnd: 8, primary: 'Am7', tone: 9, role: 'root'},
  {id: 'b', start: 4, end: 6, stampStart: 8, stampEnd: 12, primary: 'D7', tone: 2, role: 'fifth'},
  {id: 'c', start: 6, end: 10, stampStart: 12, stampEnd: 20, primary: 'Gmaj7', tone: 7},
];

function host(): HTMLElement {
  const node = document.createElement('div');
  document.body.append(node);
  return node;
}

function lane(
  state: Partial<FlowLaneState> = {},
  binding: Partial<Parameters<typeof mountFlowLane>[1]> = {},
  options: Parameters<typeof mountFlowLane>[2] = {},
) {
  return mountFlowLane(
    host(),
    {
      snapshot: () => ({bands: BANDS, span: {start: 0, end: 10}, now: 0, ...state}),
      ...binding,
    },
    {fallbackWidth: 300, ...options},
  );
}

/** Every band's box, exactly as serialised — the invariant's own measurement. */
function boxes(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('.wui-harmony-flow__band')].map(
    (node) => `${node.dataset.band}:${node.style.left}/${node.style.width}/${node.style.top}`,
  );
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe('the shared frame loop', () => {
  interface FakeView {
    view: Window & typeof globalThis;
    frame(at?: number): void;
    frames: () => number;
    /** Spend wall-clock time, as a slow subscriber does. */
    spend(ms: number): void;
    hide(): void;
    show(): void;
  }

  function fakeView(): FakeView {
    let handle = 0;
    let clock = 0;
    let visibility = 'visible';
    const pending = new Map<number, FrameRequestCallback>();
    const listeners = new Set<() => void>();
    let armed = 0;
    const view = {
      requestAnimationFrame: (callback: FrameRequestCallback): number => {
        handle += 1;
        armed += 1;
        pending.set(handle, callback);
        return handle;
      },
      cancelAnimationFrame: (id: number): void => {
        pending.delete(id);
      },
      performance: {now: () => clock},
      document: {
        get visibilityState() {
          return visibility;
        },
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      },
    };
    return {
      view: view as unknown as Window & typeof globalThis,
      frame(at = 16): void {
        const due = [...pending.values()];
        pending.clear();
        for (const callback of due) callback(at);
      },
      frames: () => armed,
      spend(ms: number): void {
        clock += ms;
      },
      hide(): void {
        visibility = 'hidden';
        for (const listener of [...listeners]) listener();
      },
      show(): void {
        visibility = 'visible';
        for (const listener of [...listeners]) listener();
      },
    };
  }

  it('never asks for a frame when nobody has joined', () => {
    const fake = fakeView();
    expect(fake.frames()).toBe(0);
    // And the moment the last subscriber goes, the loop stops asking: a parked
    // workbench on an open tab costs nothing at all.
    const leave = joinFrameLoop(fake.view, vi.fn());
    expect(fake.frames()).toBe(1);
    leave();
    fake.frame();
    expect(fake.frames()).toBe(1);
  });

  it('is ONE loop per view, however many mounts join it', () => {
    const fake = fakeView();
    const first = vi.fn();
    const second = vi.fn();
    const leaveFirst = joinFrameLoop(fake.view, first);
    const leaveSecond = joinFrameLoop(fake.view, second);
    // Six read-outs are six callbacks inside one frame, not six registrations:
    // one request is outstanding no matter how many have joined.
    expect(fake.frames()).toBe(1);
    fake.frame(32);
    expect(first).toHaveBeenCalledWith(32, false);
    expect(second).toHaveBeenCalledWith(32, false);
    expect(fake.frames()).toBe(2);
    leaveFirst();
    leaveSecond();
  });

  it('degrades to no motion, rather than throwing, without requestAnimationFrame', () => {
    const draw = vi.fn();
    const leave = joinFrameLoop(undefined, draw);
    expect(() => leave()).not.toThrow();
    expect(draw).not.toHaveBeenCalled();
    expect(joinFrameLoop({} as unknown as Window & typeof globalThis, draw)).toBeInstanceOf(Function);
    expect(draw).not.toHaveBeenCalled();
  });

  it('leaves the loop while the document is hidden and rejoins when it returns', () => {
    const fake = fakeView();
    const draw = vi.fn();
    const leave = joinFrameLoop(fake.view, draw);
    fake.hide();
    const armed = fake.frames();
    fake.frame();
    expect(draw).not.toHaveBeenCalled();
    expect(fake.frames()).toBe(armed);
    fake.show();
    fake.frame();
    expect(draw).toHaveBeenCalledTimes(1);
    leave();
  });

  it('halves its own rate when its subscribers are slow, and says so', () => {
    const fake = fakeView();
    // A subscriber that takes 5 ms of every frame, which is over the budget.
    const draw = vi.fn((_at: number, _degraded: boolean) => fake.spend(5));
    const leave = joinFrameLoop(fake.view, draw);
    // Thirty slow frames in the last sixty is the threshold. The verdict is
    // visible — `degraded` reaches the subscriber, which is what lets a mount
    // write it where somebody can see it rather than leaving a mystery stutter.
    for (let at = 0; at < 40; at += 1) fake.frame(at);
    expect(draw.mock.calls.at(-1)?.[1]).toBe(true);
    const spent = draw.mock.calls.length;
    fake.frame(100);
    fake.frame(101);
    // Half rate: two frames, one call.
    expect(draw.mock.calls.length).toBe(spent + 1);
    leave();
  });
});

// ---------------------------------------------------------------------------

describe('mountFlowLane geometry', () => {
  it('draws a band box from the band’s own fields and NEVER from the position', () => {
    let now = 0;
    const handle = lane({}, {position: () => now});
    const band = handle.band('b')!;
    const before = band.style.cssText;
    expect(before).toContain('left: 40%');
    expect(before).toContain('width: 20%');

    // Sixty ticks that walk the position clean across this band. The playhead
    // replaces a lit node's whole `cssText` with the idle string, so any
    // per-frame inline write here would be erased at exactly the instant the
    // band matters — the invariant is that there is nothing to erase.
    for (let step = 0; step < 60; step += 1) {
      now = (step / 59) * 10;
      handle.tick();
    }
    expect(band.style.cssText).toBe(before);
    expect(readAnalysisIdleStyle(band)).toBe(before);
    handle.destroy();
  });

  it('moves the reel, and only the reel', () => {
    let now = 0;
    const handle = lane({}, {position: () => now}, {fallbackWidth: 300, anchor: 0.33, scale: 10});
    // anchor·W − now·scale: 0.33 × 300 = 99 at the start of the axis.
    expect(handle.reel.style.transform).toBe('translate3d(99px, 0, 0)');
    now = 4;
    handle.tick();
    expect(handle.reel.style.transform).toBe('translate3d(59px, 0, 0)');
    // The line does not move. That is the whole design.
    expect(handle.nowLine.style.left).toBe('33%');
    handle.destroy();
  });

  it('keeps the sounding band’s name above the plot, where it does not scroll', () => {
    let now = 0;
    const handle = lane(
      {bands: [{...BANDS[0]!, secondary: 'i'}, ...BANDS.slice(1)]},
      {position: () => now},
    );
    const pinned = handle.element.querySelector('.wui-harmony-flow__pinned')!;
    const name = pinned.querySelector('.wui-harmony-flow__pinned-name')!;
    expect(name.textContent).toBe('Am7');
    expect(pinned.querySelector('.wui-harmony-flow__pinned-note')?.textContent).toBe('i');
    now = 7;
    handle.tick();
    // The readout has its own space above the plot and never rides the reel.
    expect(name.textContent).toBe('Gmaj7');
    expect(pinned.parentElement).toBe(handle.element);
    expect(pinned.nextElementSibling?.contains(handle.viewport)).toBe(true);
    expect(handle.reel.contains(pinned)).toBe(false);
    handle.destroy();
  });

  it.each([true, false])('reserves both readout line boxes through gaps (stylesheet=%s)', (stylesheet) => {
    let now = 0;
    const handle = lane({}, {
      snapshot: () => ({
        bands: [
          {id: 'first', start: 0, end: 1, primary: 'M1', secondary: 'First reading'},
          {id: 'repeat', start: 3, end: 4, primary: 'M1'},
        ],
        span: {start: 0, end: 4},
        now,
      }),
    }, {stylesheet, reservePinned: true, animate: false});
    const pinned = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__pinned')!;
    const name = pinned.querySelector<HTMLElement>('.wui-harmony-flow__pinned-name')!;
    const note = pinned.querySelector<HTMLElement>('.wui-harmony-flow__pinned-note')!;
    // Distinct definite sizes make font-relative reservation observable in
    // jsdom, whose computed style does not resolve our nested token calc().
    pinned.style.fontSize = '10px';
    name.style.fontSize = '24px';
    note.style.fontSize = '12px';
    const lineBoxes = () => [name, note].map((row) => {
      const style = getComputedStyle(row);
      // jsdom has no layout. Test the actual CSS line-box contract rather
      // than comparing two zero getBoundingClientRect() heights.
      expect(style.display).toBe('block');
      expect(Number.parseFloat(style.minHeight)).toBeCloseTo(
        Number.parseFloat(style.fontSize) * Number.parseFloat(style.lineHeight),
      );
      return row.style.minHeight;
    });
    expect(pinned.textContent).toBe('M1First reading');
    expect(pinned.hidden).toBe(false);
    expect(lineBoxes()).toEqual(['1.15em', '1.35em']);

    now = 2;
    handle.update();
    expect(pinned.textContent).toBe('');
    expect(pinned.style.visibility).toBe('hidden');
    expect(pinned.hidden).toBe(false);
    expect(getComputedStyle(pinned).display).not.toBe('none');
    expect(lineBoxes()).toEqual(['1.15em', '1.35em']);

    now = 3;
    handle.update();
    expect(pinned.textContent).toBe('M1');
    expect(pinned.style.visibility).toBe('');
    expect(note.textContent).toBe('');
    expect(lineBoxes()).toEqual(['1.15em', '1.35em']);
    handle.destroy();
  });

  it.each([true, false])('does not reserve empty readout rows unless requested (stylesheet=%s)', (stylesheet) => {
    let now = 0;
    const handle = lane({}, {
      snapshot: () => ({bands: [{id: 'first', start: 0, end: 1, primary: 'M1'}], now}),
    }, {stylesheet, animate: false});
    const pinned = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__pinned')!;
    expect(pinned.hidden).toBe(false);
    expect([...pinned.children].every((row) => (row as HTMLElement).style.minHeight === '')).toBe(true);
    now = 2;
    handle.update();
    expect(pinned.hidden).toBe(true);
    expect(getComputedStyle(pinned).display).toBe('none');
    handle.destroy();
  });

  it('survives a layout engine that answers zero, instead of dividing by it', () => {
    // No `fallbackWidth`, no `ResizeObserver`, and jsdom measures every box as
    // zero: the lane must still place itself and must never write a NaN.
    const handle = mountFlowLane(host(), {snapshot: () => ({bands: BANDS, now: 2})}, {scale: 10});
    expect(handle.reel.style.transform).toBe('translate3d(191.2px, 0, 0)');
    const written = [...handle.element.querySelectorAll('*')].flatMap((node) =>
      [...node.attributes].map((attribute) => attribute.value),
    );
    expect(written.some((value) => value.includes('NaN'))).toBe(false);
    handle.destroy();
  });

  it('writes data-zone only where the position CROSSED a boundary', () => {
    let now = 0;
    const handle = lane({}, {position: () => now});
    const band = handle.band('b')!;
    expect(band.dataset.zone).toBe('ahead');
    const writes = vi.spyOn(band, 'setAttribute');

    // Twenty ticks inside band `a`: nothing crosses, so nothing is written.
    for (let step = 0; step < 20; step += 1) {
      now = 0.1 * step;
      handle.tick();
    }
    expect(writes.mock.calls.filter(([name]) => name === 'data-zone')).toHaveLength(0);

    now = 5;
    handle.tick();
    expect(band.dataset.zone).toBe('now');
    now = 8;
    handle.tick();
    expect(band.dataset.zone).toBe('wake');
    expect(writes.mock.calls.filter(([name]) => name === 'data-zone')).toHaveLength(2);
    handle.destroy();
  });

  it('keeps every band node, and its identity, across the whole piece', () => {
    let now = 0;
    const handle = lane({}, {position: () => now});
    const nodes = BANDS.map((band) => handle.band(band.id));
    for (let step = 0; step < 60; step += 1) {
      now = (step / 59) * 10;
      handle.tick();
    }
    // Never recycled and never re-created. A band culled because it scrolled
    // off is a silently dead highlight — the playhead finds its nodes with
    // `querySelectorAll`, and the ones nearest the now line would be the first
    // to be recycled.
    expect(BANDS.map((band) => handle.band(band.id))).toEqual(nodes);
    expect(handle.element.querySelectorAll('.wui-harmony-flow__band')).toHaveLength(3);
    handle.destroy();
  });

  it('gives reduced motion the SAME layout with a different driver', () => {
    const continuous = lane({now: 5}, {}, {motion: 'continuous', scale: 10, fallbackWidth: 300});
    const stepped = lane({now: 5}, {}, {motion: 'stepped', scale: 10, fallbackWidth: 300});
    // Pixel-identical: the same nodes at the same offsets. Turning the movement
    // off is allowed; turning the view into a different view is not, because
    // "the next chord is approaching" is a property of where things are.
    expect(boxes(stepped.element)).toEqual(boxes(continuous.element));
    expect(stepped.element.querySelectorAll('.wui-harmony-flow__band')).toHaveLength(
      continuous.element.querySelectorAll('.wui-harmony-flow__band').length,
    );
    // Only the reel differs: `stepped` re-anchors on the sounding BAND (4), and
    // `continuous` sits at the instant (5).
    expect(continuous.reel.style.transform).toBe('translate3d(49px, 0, 0)');
    expect(stepped.reel.style.transform).toBe('translate3d(59px, 0, 0)');
    expect(stepped.element.dataset.motion).toBe('stepped');
    continuous.destroy();
    stepped.destroy();
  });

  it('spends a stepped lane’s frames only where something was crossed', () => {
    // §2.5.3's actual promise, and where the reduced-motion saving is really
    // made. A stepped lane is ticked at the full rate — by its own loop or, as
    // here, by a shell's clock — and running the whole body for each of sixty
    // ticks a second in order to re-anchor three times saves nothing at all.
    let emit: ((tick: FrameTick) => void) | undefined;
    const clock: FrameClock = {
      subscribe: (draw) => {
        emit = draw;
        return () => {
          emit = undefined;
        };
      },
      read: () => ({at: 0, now: 0, continuous: true}),
    };
    const handle = lane(
      {},
      {position: (tick) => tick.now},
      {clock, motion: 'stepped', scale: 10, fallbackWidth: 300},
    );
    const seen = new Set<string>();
    for (let step = 0; step < 120; step += 1) {
      emit?.({at: step * 16, now: (step / 119) * 9.9, continuous: true});
      seen.add(handle.reel.style.transform);
    }
    // Three bands, three anchors, and nothing written in between them.
    expect(seen.size).toBe(3);
    handle.destroy();
  });

  it('answers from the headline row, not from whichever row was listed first', () => {
    // Several rows share one now line, so exactly one of them has to be the
    // one the pinned word and the stepped re-anchor come from. Letting array
    // order decide meant a lane naming a motif and anchoring a second away
    // from the chord that was actually under the line.
    let now = 0;
    const handle = lane(
      {
        bands: [
          {id: 'motif', start: 0, end: 8, track: 1, primary: 'motif A'},
          {id: 'chord', start: 4, end: 6, track: 0, primary: 'D7'},
        ],
        span: {start: 0, end: 10},
      },
      {position: () => now},
      {scale: 10, fallbackWidth: 300},
    );
    const name = handle.element.querySelector('.wui-harmony-flow__pinned-name')!;
    now = 5;
    handle.tick();
    expect(name.textContent).toBe('D7');
    // And with nothing on the headline row, the lane still says what is
    // sounding rather than going blank.
    now = 1;
    handle.tick();
    expect(name.textContent).toBe('motif A');
    handle.destroy();
  });

  it('flashes the LINE on arrival, and only the line', () => {
    // §3.6.3's one sanctioned flash. `scaleX`, not `width`: the line grows
    // about its own centre, so the one thing the design pins in place is not
    // nudged sideways every time it is drawn attention to.
    const frames: Keyframe[][] = [];
    const animate = vi.fn((keyframes: Keyframe[]) => {
      frames.push(keyframes);
      return {cancel: vi.fn()} as unknown as Animation;
    });
    let now = 0;
    const handle = lane({}, {position: () => now}, {scale: 10, fallbackWidth: 300});
    (handle.nowLine as unknown as {animate: unknown}).animate = animate;
    // Nothing at mount: a lane that flashed as it appeared would be announcing
    // an arrival nobody travelled to.
    expect(animate).not.toHaveBeenCalled();
    now = 5;
    handle.tick();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(frames[0]?.map((frame) => frame.transform)).toEqual([
      'scaleX(1)',
      'scaleX(2)',
      'scaleX(1)',
    ]);
    now = 5.5;
    handle.tick();
    expect(animate).toHaveBeenCalledTimes(1);
    handle.destroy();
  });

  it('never opens a frame loop for a lane with nothing to animate', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const still = lane();
    expect(raf).not.toHaveBeenCalled();
    still.destroy();

    // And with a position to pull, it joins exactly one.
    const live = lane({}, {position: () => 1});
    expect(raf).toHaveBeenCalledTimes(1);
    live.destroy();
  });

  it('takes a shell’s clock instead of opening its own loop', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    let emit: ((tick: FrameTick) => void) | undefined;
    const clock: FrameClock = {
      subscribe: (draw) => {
        emit = draw;
        return () => {
          emit = undefined;
        };
      },
      read: () => ({at: 0, now: 0, continuous: true}),
    };
    const handle = lane({}, {position: (tick) => tick.now}, {clock, scale: 10, fallbackWidth: 300});
    // A passenger, not a driver: the shell takes the single reading per frame
    // and every dock in it answers about the same instant.
    expect(raf).not.toHaveBeenCalled();
    emit?.({at: 16, now: 6, continuous: true});
    expect(handle.reel.style.transform).toBe('translate3d(39px, 0, 0)');
    handle.destroy();
    expect(emit).toBeUndefined();
  });
});

describe('mountFlowLane and the playhead', () => {
  it('stamps in the caller’s OTHER unit, and the playhead reads it back', () => {
    const handle = lane();
    const band = handle.band('b')!;
    // The lane's axis is 4 to 6; the stamp is 8 to 12. Two rulers, deliberately.
    expect(readAnalysisSpans(band)).toEqual([{startQuarters: 8, endQuarters: 12}]);
    expect(band.dataset.spans).toBeUndefined();

    const spanNodes = handle.element.querySelectorAll(ANALYSIS_SPAN_SELECTOR);
    expect(spanNodes).toHaveLength(3);

    const playhead = createAnalysisPlayhead(handle.element, {scroll: false});
    playhead.update(9);
    // Exactly one lit, and it is the one whose stamped span contains 9.
    const lit = [...handle.element.querySelectorAll<HTMLElement>(ANALYSIS_SPAN_SELECTOR)].filter(
      (node) => node.style.cssText.includes('outline'),
    );
    expect(lit).toEqual([band]);
    playhead.destroy();
    handle.destroy();
  });

  it('stamps the multi-span form for a band that recurs', () => {
    const handle = lane({
      bands: [
        {
          id: 'motif',
          start: 0,
          end: 2,
          spans: [
            {start: 0, end: 3},
            {start: 8, end: 11},
          ],
        },
      ],
    });
    const band = handle.band('motif')!;
    expect(band.dataset.spans).toBe('0:3 8:11');
    expect(band.dataset.startQuarters).toBeUndefined();
    handle.destroy();
  });

  it('re-stamps a band whose stamping axis moved but whose box did not', () => {
    // The two axes move independently: a re-analysis can leave a chord in the
    // same place on the conveyor and give it a different metrical span. A
    // signature built from the box alone would keep the old numbers, and the
    // playhead would light the right band at the wrong moment for ever.
    let stampStart = 8;
    let notify = (): void => {};
    const handle = lane(
      {},
      {
        snapshot: () => ({
          bands: [{id: 'b', start: 4, end: 6, stampStart, stampEnd: stampStart + 4}],
          span: {start: 0, end: 10},
          now: 0,
        }),
        subscribe: (listener) => {
          notify = listener;
          return () => {};
        },
      },
    );
    const band = handle.band('b')!;
    const box = band.style.cssText;
    stampStart = 20;
    notify();
    expect(band.style.cssText).toBe(box);
    expect(readAnalysisSpans(band)).toEqual([{startQuarters: 20, endQuarters: 24}]);
    expect(readAnalysisIdleStyle(band)).toBe(box);
    handle.destroy();
  });

  it('leaves a lit band byte-identical while the material runs past it', () => {
    // R14, asserted against a MOUNTED lane and a real playhead rather than
    // against a hand-built div: the whole two-layer design exists so that a
    // band's inline style is a pure function of its own fields, and the moment
    // it is not, the playhead's idle string restores the wrong geometry on the
    // one band that mattered.
    let now = 0;
    const handle = lane({}, {position: () => now}, {scale: 10, fallbackWidth: 300});
    const band = handle.band('b')!;
    const idle = band.style.cssText;
    const playhead = createAnalysisPlayhead(handle.element, {scroll: false});
    const seen = new Set<string>();
    for (let step = 0; step < 60; step += 1) {
      now = (step / 59) * 10;
      handle.tick();
      playhead.update(readAnalysisSpans(band)[0]!.startQuarters + (step - 20) / 4);
      seen.add(band.style.cssText);
    }
    // Two strings and no more: the idle box, and the idle box plus the
    // playhead's own declarations. Every per-frame write landed on the reel.
    expect(seen.size).toBe(2);
    const lit = [...seen].filter((css) => css !== idle);
    expect(lit).toHaveLength(1);
    expect(lit[0]!.startsWith(idle)).toBe(true);
    expect(lit[0]).toContain('outline');
    playhead.update(1e6);
    expect(band.style.cssText).toBe(idle);
    playhead.destroy();
    handle.destroy();
  });

  it('hands the highlight back to a band it had to re-box while it was lit', () => {
    // The playhead lights a node ONCE and skips it while it stays active, so a
    // writer that rewrites a lit node's box does not lose one frame — it leaves
    // the band dark for the rest of the chord, still carrying the
    // `aria-current` that says it is the one sounding.
    let span = {start: 0, end: 10};
    let notify = (): void => {};
    const handle = lane(
      {},
      {
        snapshot: () => ({bands: BANDS, span, now: 0}),
        subscribe: (listener) => {
          notify = listener;
          return () => {};
        },
      },
    );
    const band = handle.band('a')!;
    const playhead = createAnalysisPlayhead(handle.element, {scroll: false});
    playhead.update(2);
    expect(band.style.cssText).toContain('outline');

    span = {start: 0, end: 20};
    notify();
    expect(band.style.left).toBe('0%');
    expect(band.style.width).toBe('20%');
    expect(band.style.cssText).toContain('outline');
    // And the idle string it will be restored to is the NEW box, not the box
    // plus the highlight — which would be a highlight nothing could remove.
    expect(readAnalysisIdleStyle(band)).not.toContain('outline');
    playhead.update(19);
    expect(band.style.cssText).toBe(readAnalysisIdleStyle(band));
    playhead.destroy();
    handle.destroy();
  });

  it('keeps a band stamped when the caller’s occurrence list came back empty', () => {
    // `spans: motif.occurrences.map(…)` is the natural caller shape, and an
    // empty result is not a request to un-stamp a band that has a perfectly
    // good start and end — it is a band the playhead could then never light,
    // silently missing from its selector.
    const handle = lane({bands: [{id: 'm', start: 0, end: 2, spans: []}]});
    const band = handle.band('m')!;
    expect(readAnalysisSpans(band)).toEqual([{startQuarters: 0, endQuarters: 2}]);
    expect(handle.element.querySelectorAll(ANALYSIS_SPAN_SELECTOR)).toHaveLength(1);
    handle.destroy();
  });

  it('leaves `outline` to the playhead alone', () => {
    // Six assertions across two packages detect "is it lit" by looking for that
    // substring in a style string, and `outline-offset` matches it too. One
    // rule — no other live state may use the property — keeps all six green.
    expect(harmonyPresenterStyle).not.toContain('outline');
    const handle = lane({focusGroup: 'x', bands: [{id: 'a', start: 0, end: 2, group: 'x'}]});
    const band = handle.band('a')!;
    expect(band.dataset.focus).toBe('true');
    expect(band.style.cssText).not.toContain('outline');
    handle.destroy();
  });

  it('clips its viewport rather than hiding it, so scrollIntoView is inert', () => {
    // `overflow: hidden` IS a scroll container, and the playhead scrolls every
    // node it lights — inside a lane that would shove the reel off its anchor
    // for good. `clip` creates no scroll container at all.
    expect(harmonyPresenterStyle).toContain('overflow: hidden; overflow: clip;');
    const handle = lane();
    expect(['hidden', 'clip']).toContain(handle.viewport.style.overflow);
    handle.destroy();
  });
});

describe('mountFlowLane accessibility and input', () => {
  it('publishes a semantic twin that matches the bands item for item', () => {
    let now = 0;
    const handle = lane({}, {position: () => now});
    expect([...handle.index.children].map((item) => item.textContent)).toEqual([
      'Am7',
      'D7',
      'Gmaj7',
    ]);
    now = 5;
    handle.tick();
    const current = [...handle.index.children].filter(
      (item) => item.getAttribute('aria-current') === 'true',
    );
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('D7');
    // The twin carries no spans: the band is the span-carrying node, and a
    // second one per item would double every pinned span count in the repo.
    expect(handle.index.querySelectorAll(ANALYSIS_SPAN_SELECTOR)).toHaveLength(0);
    handle.destroy();
  });

  it('is one tab stop, and only when there is something to seek', () => {
    const still = lane();
    expect(still.viewport.getAttribute('role')).toBeNull();
    expect(still.viewport.tabIndex).toBe(-1);
    // And no range on a node that is not a slider: a value a reader is told
    // about and cannot move is a promise nothing keeps.
    expect(still.viewport.getAttribute('aria-valuemin')).toBeNull();
    expect(still.viewport.getAttribute('aria-valuenow')).toBeNull();
    still.destroy();

    const seekable = lane({}, {seek: vi.fn()});
    expect(seekable.viewport.getAttribute('role')).toBe('slider');
    expect(seekable.viewport.tabIndex).toBe(0);
    expect(seekable.viewport.getAttribute('aria-valuemin')).toBe('0');
    expect(seekable.viewport.getAttribute('aria-valuemax')).toBe('10');
    seekable.destroy();
  });

  it('walks the harmony with the bracket keys, not the clock', () => {
    const seek = vi.fn();
    const handle = lane({now: 1}, {seek});
    const key = (name: string, shift = false): void => {
      handle.viewport.dispatchEvent(
        new KeyboardEvent('keydown', {key: name, shiftKey: shift, bubbles: true, cancelable: true}),
      );
    };
    key(']');
    expect(seek).toHaveBeenLastCalledWith(4, 'commit');
    key(']');
    expect(seek).toHaveBeenLastCalledWith(6, 'commit');
    key('[');
    expect(seek).toHaveBeenLastCalledWith(4, 'commit');
    key('ArrowRight');
    expect(seek).toHaveBeenLastCalledWith(5, 'commit');
    key('ArrowRight', true);
    expect(seek).toHaveBeenLastCalledWith(9, 'commit');
    key('End');
    expect(seek).toHaveBeenLastCalledWith(10, 'commit');
    key('Home');
    expect(seek).toHaveBeenLastCalledWith(0, 'commit');
    handle.destroy();
  });

  it('previews while dragging and commits once, on release', () => {
    const seek = vi.fn();
    const handle = lane({}, {seek}, {scale: 10, fallbackWidth: 300});
    handle.viewport.getBoundingClientRect = () =>
      ({x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 96, width: 300, height: 96, toJSON: () => ({})}) as DOMRect;
    const pointer = (type: string, clientX: number): PointerEvent => {
      const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX, button: 0});
      Object.defineProperty(event, 'pointerId', {configurable: true, value: 7});
      return event as PointerEvent;
    };
    handle.viewport.dispatchEvent(pointer('pointerdown', 200));
    // Dragging moves the MATERIAL, so pulling right walks backwards — and the
    // now line does not move, ever.
    handle.viewport.dispatchEvent(pointer('pointermove', 150));
    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenLastCalledWith(5, 'drag');
    handle.viewport.dispatchEvent(pointer('pointerup', 150));
    expect(seek).toHaveBeenLastCalledWith(5, 'commit');
    expect(handle.nowLine.style.left).toBe('33%');
    handle.destroy();
  });

  it('lets the finger outrank the clock for as long as it is down', () => {
    // Twelve moves of −22px at 44px/unit is six units of travel. With a live
    // `position()` the loop used to reset `position` between two moves, every
    // delta was then computed from a number 16ms old, and the whole gesture
    // committed where it started.
    const seek = vi.fn();
    let clock = 5;
    const handle = lane(
      {now: 5, span: {start: 0, end: 30}},
      {seek, position: () => clock},
      {scale: 44, fallbackWidth: 300},
    );
    handle.viewport.getBoundingClientRect = () =>
      ({x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 96, width: 300, height: 96, toJSON: () => ({})}) as DOMRect;
    const pointer = (type: string, clientX: number): PointerEvent => {
      const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX, button: 0});
      Object.defineProperty(event, 'pointerId', {configurable: true, value: 3});
      return event as PointerEvent;
    };
    handle.viewport.dispatchEvent(pointer('pointerdown', 400));
    for (let step = 1; step <= 12; step += 1) {
      handle.viewport.dispatchEvent(pointer('pointermove', 400 - 22 * step));
      // The clock goes on running underneath the gesture, and is ignored.
      handle.tick();
    }
    handle.viewport.dispatchEvent(pointer('pointerup', 400 - 22 * 12));
    expect(seek).toHaveBeenLastCalledWith(11, 'commit');
    // And the frame after the release takes the caller's answer back.
    clock = 2;
    handle.tick();
    expect(handle.reel.style.transform).toBe('translate3d(11px, 0, 0)');
    handle.destroy();
  });

  it('says its value to a reader when the answer changes, not sixty times a second', () => {
    const seek = vi.fn();
    let now = 0;
    const handle = lane({}, {seek, position: () => now}, {scale: 10, fallbackWidth: 300});
    const writes = vi.spyOn(handle.viewport, 'setAttribute');
    const aria = () => writes.mock.calls.filter(([name]) => name.startsWith('aria-value')).length;
    // Twenty frames inside one band: the slider's value has not changed at the
    // granularity a reader hears, and a focused slider that announced each of
    // them would talk over the music.
    for (let step = 0; step < 20; step += 1) {
      now = 0.1 * step;
      handle.tick();
    }
    expect(aria()).toBe(0);
    now = 5;
    handle.tick();
    expect(aria()).toBe(2);
    expect(handle.viewport.getAttribute('aria-valuetext')).toBe('5 — D7');
    handle.destroy();
  });

  it('seeks to a band’s start when it is clicked', () => {
    const seek = vi.fn();
    const selectBand = vi.fn();
    const handle = lane({}, {seek, selectBand});
    handle.band('c')!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(selectBand).toHaveBeenCalledWith('c', expect.objectContaining({id: 'c'}), {
      additive: false,
    });
    expect(seek).toHaveBeenLastCalledWith(6, 'commit');
    handle.destroy();
  });

  it('selects the pressed band when pointer capture retargets the click to the viewport', () => {
    const seek = vi.fn();
    const selectBand = vi.fn();
    const handle = lane({}, {seek, selectBand});
    const pointer = (type: string): MouseEvent => {
      const event = new MouseEvent(type, {bubbles: true, cancelable: true, button: 0});
      Object.defineProperty(event, 'pointerId', {value: 7});
      return event;
    };
    handle.band('b')!.dispatchEvent(pointer('pointerdown'));
    handle.viewport.dispatchEvent(pointer('pointerup'));
    handle.viewport.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(selectBand).toHaveBeenCalledOnce();
    expect(selectBand).toHaveBeenCalledWith('b', expect.objectContaining({id: 'b'}), {additive: false});
    expect(seek).toHaveBeenCalledWith(4, 'commit');
    handle.destroy();
  });

  it('keeps the pressed band when a captured click lands on another band', () => {
    const seek = vi.fn();
    const selectBand = vi.fn();
    const handle = lane({}, {seek, selectBand});
    const pointer = (type: string): MouseEvent => {
      const event = new MouseEvent(type, {bubbles: true, cancelable: true, button: 0});
      Object.defineProperty(event, 'pointerId', {value: 7});
      return event;
    };
    handle.band('b')!.dispatchEvent(pointer('pointerdown'));
    handle.viewport.dispatchEvent(pointer('pointerup'));
    handle.band('c')!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(selectBand).toHaveBeenCalledOnce();
    expect(selectBand).toHaveBeenCalledWith('b', expect.objectContaining({id: 'b'}), {additive: false});
    expect(seek).toHaveBeenCalledWith(4, 'commit');
    handle.destroy();
  });

  it('zooms on a modified wheel and re-places every band from the same fields', () => {
    const handle = lane({}, {}, {scale: 10, fallbackWidth: 300});
    const before = boxes(handle.element);
    expect(handle.reel.style.width).toBe('100px');
    handle.viewport.dispatchEvent(
      new WheelEvent('wheel', {deltaY: -300, ctrlKey: true, bubbles: true, cancelable: true}),
    );
    // The reel is what zoomed. Every band is still a percentage of it, so not
    // one of the three had to be touched.
    expect(Number.parseFloat(handle.reel.style.width)).toBeCloseTo(100 * Math.E, 3);
    expect(boxes(handle.element)).toEqual(before);
    handle.destroy();
  });

  it('rejoins the loop in one frame after being scrolled out of view', () => {
    let observed: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          observed = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    let now = 0;
    const handle = lane({}, {position: () => now}, {scale: 10, fallbackWidth: 300});
    expect(raf).toHaveBeenCalledTimes(1);

    const entry = (isIntersecting: boolean) =>
      observed?.([{isIntersecting} as IntersectionObserverEntry], {} as IntersectionObserver);
    entry(false);
    expect(cancel).toHaveBeenCalled();
    // Time passed while it was invisible; the position is a pure function of
    // the instant, so one frame is all it takes to be right again.
    now = 8;
    entry(true);
    expect(handle.reel.style.transform).toBe('translate3d(19px, 0, 0)');
    handle.destroy();
    expect(disconnect).toHaveBeenCalled();
  });

  it('asks the viewer only when nothing above it has answered', () => {
    // `matchMedia` is absent in jsdom, so an unguarded read throws on the first
    // mount. The ancestor's answer comes first in any case: a shell decides for
    // its whole subtree and six read-outs must not disagree.
    const matchMedia = vi.fn(() => ({matches: true}));
    vi.stubGlobal('matchMedia', matchMedia);
    const declared = document.createElement('div');
    declared.dataset.motion = 'continuous';
    document.body.append(declared);
    const inner = document.createElement('div');
    declared.append(inner);
    const following = mountFlowLane(inner, {snapshot: () => ({bands: [], now: 0})});
    expect(following.element.dataset.motion).toBe('continuous');
    expect(matchMedia).not.toHaveBeenCalled();
    following.destroy();

    const asking = lane();
    expect(asking.element.dataset.motion).toBe('stepped');
    asking.destroy();
  });
});

describe('mountFlowLane lifecycle', () => {
  it('reconciles content without rebuilding the bands that stayed', () => {
    let bands = BANDS;
    let notify = (): void => {};
    const handle = lane(
      {},
      {
        snapshot: () => ({bands, span: {start: 0, end: 10}, now: 0}),
        subscribe: (listener) => {
          notify = listener;
          return () => {
            notify = () => {};
          };
        },
      },
    );
    const kept = handle.band('a');
    bands = [BANDS[0]!, {id: 'd', start: 4, end: 9, primary: 'F'}];
    notify();
    expect(handle.band('a')).toBe(kept);
    expect(handle.band('b')).toBeUndefined();
    expect(handle.band('d')?.style.left).toBe('40%');
    expect([...handle.index.children].map((item) => item.textContent)).toEqual(['Am7', 'F']);
    handle.destroy();
  });

  it('renders an empty lane as a lane, and says what is missing', () => {
    const handle = lane({bands: [], emptyLabel: 'No chords yet.'});
    const empty = handle.element.querySelector('.wui-harmony-flow__empty');
    expect(empty?.textContent).toBe('No chords yet.');
    expect(empty?.getAttribute('role')).toBe('status');
    // The shape stands up first: the viewport, the reel and the line are there
    // before there is anything to put on them.
    expect(handle.viewport.isConnected).toBe(true);
    expect(handle.nowLine.style.left).toBe('33%');
    handle.destroy();
  });

  it('hands the host back exactly as it found it', () => {
    const node = host();
    const keep = document.createElement('span');
    node.append(keep);
    const handle = mountFlowLane(node, {snapshot: () => ({bands: BANDS, now: 0})});
    expect(node.querySelector('.wui-harmony-flow')).not.toBeNull();
    handle.destroy();
    handle.destroy();
    expect(node.firstElementChild).toBe(keep);
    expect(node.querySelector('.wui-harmony-flow')).toBeNull();
  });

  it('reports a failing snapshot instead of throwing at the caller', () => {
    const onError = vi.fn();
    const handle = mountFlowLane(
      host(),
      {
        snapshot: () => {
          throw new Error('no analysis');
        },
      },
      {onError},
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(handle.element.isConnected).toBe(true);
    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// Regressions from the three-lens review of the salvage port. Each one names
// the shape it caught, because each was green under every test above it.
// ---------------------------------------------------------------------------

describe('mountFlowLane regressions', () => {
  it('lets the musical row own the read-out while a header spans the whole piece', () => {
    let state: FlowLaneState = {
      bands: [
        {id: 'header', track: 0, start: 0, end: 10, primary: 'Section'},
        {id: 'chord', track: 1, start: 0, end: 4, primary: 'Am7'},
      ],
      primaryTrack: 1,
      now: 2,
    };
    const handle = lane({}, {snapshot: () => state}, {animate: false});
    const name = () => handle.element.querySelector('.wui-harmony-flow__pinned-name')?.textContent;
    const current = () => handle.index.querySelector('[aria-current="true"]')?.textContent;
    expect(name()).toBe('Am7');
    expect(current()).toBe('Am7');
    state = {...state, primaryTrack: 0};
    handle.update();
    expect(name()).toBe('Section');
    expect(current()).toBe('Section');
    expect(handle.index.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    handle.destroy();
  });

  it('runs a stepped lane off its own loop when nothing else is driving it', () => {
    // The one the whole conveyor rests on. `motion: 'auto'` — the default —
    // resolves to `stepped` under `prefers-reduced-motion: reduce`, and a lane
    // that opened no loop never called `binding.position` at all: the reel
    // parked at its mount-time seed, `update()` re-placed from the cached
    // number on purpose, and the pinned read-out went on naming bar one while
    // the highlight walked off the right-hand edge.
    const due: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      due.push(callback);
      return due.length;
    });
    let now = 0;
    const handle = lane(
      {},
      {position: () => now},
      {motion: 'stepped', scale: 10, fallbackWidth: 300},
    );
    expect(raf).toHaveBeenCalled();
    const anchors = new Set<string>();
    const names = new Set<string>();
    for (let step = 0; step < 30; step += 1) {
      now = (step / 29) * 9.9;
      for (const callback of due.splice(0, due.length)) callback(step * 16);
      anchors.add(handle.reel.style.transform);
      names.add(
        handle.element.querySelector<HTMLElement>('.wui-harmony-flow__pinned-name')?.textContent ??
          '',
      );
    }
    // Three bands, three anchors, three names — and nothing written in between
    // them, which is still the reduced-motion saving. Frame RATE, event COST.
    expect(anchors.size).toBe(3);
    expect([...names]).toEqual(['Am7', 'D7', 'Gmaj7']);
    handle.destroy();
  });

  it('subscribes ON the binding, so a method keeps its receiver', () => {
    // A binding written as a class is the ordinary shape, and lifting
    // `subscribe` off the object before calling it threw a `TypeError` that the
    // mount's own `catch` swallowed into `onError`. The lane then showed its
    // first snapshot for ever, with no symptom a caller could see.
    class Source {
      readonly #listeners = new Set<() => void>();
      bands: readonly FlowBand[] = BANDS;
      snapshot(): FlowLaneState {
        return {bands: this.bands, span: {start: 0, end: 10}, now: 0};
      }
      subscribe(listener: () => void): () => void {
        this.#listeners.add(listener);
        return () => {
          this.#listeners.delete(listener);
        };
      }
      notify(): void {
        for (const listener of [...this.#listeners]) listener();
      }
    }
    const source = new Source();
    const onError = vi.fn();
    const handle = mountFlowLane(host(), source, {onError, fallbackWidth: 300});
    expect(onError).not.toHaveBeenCalled();
    source.bands = [BANDS[0]!];
    source.notify();
    expect(handle.element.querySelectorAll('.wui-harmony-flow__band')).toHaveLength(1);
    handle.destroy();
  });

  it('keeps a band’s own range when every occurrence is still unplaced', () => {
    // `spans: motif.occurrences.map(...)` with one occurrence that has no
    // position yet reaches the stamp non-empty and comes out with nothing to
    // write — and took the band's perfectly good start and end down with it,
    // dropping it out of the selector so it could never be lit.
    const handle = lane({
      bands: [
        {id: 'lost', start: 4, end: 8, primary: 'F', spans: [{start: Number.NaN, end: Number.NaN}]},
      ],
    });
    const band = handle.band('lost')!;
    expect(band.dataset.spans).toBeUndefined();
    expect(readAnalysisSpans(band)).toEqual([{startQuarters: 4, endQuarters: 8}]);
    expect(band.matches(ANALYSIS_SPAN_SELECTOR)).toBe(true);
    const playhead = createAnalysisPlayhead(handle.element);
    playhead.update(5);
    expect(band.getAttribute('aria-current')).toBe('true');
    playhead.destroy();
    handle.destroy();
  });

  it('draws a row-scoped flag on its row, and a bracket in its severity', () => {
    // Both are inline-path only: `dress` is a bulk write of a whole part
    // record, so `flowParts.flag`'s `top: 0; bottom: 0` erased the row
    // placement and `flowParts.bracket`'s `border` SHORTHAND reset the
    // severity colour to the neutral rule grey.
    const handle = lane(
      {
        tracks: [{id: 'chords'}, {id: 'motifs'}],
        flags: [{id: 'f', at: 5, track: 1, severity: 'error', label: 'parallel fifths'}],
        brackets: [{id: 'k', start: 2, end: 6, from: 0, to: 1, severity: 'error'}],
      },
      {},
      {stylesheet: false},
    );
    const flag = handle.element.querySelector<HTMLElement>('[data-flag="f"]')!;
    expect(flag.style.bottom).toBe('auto');
    expect(flag.style.top).not.toBe('0px');
    const bracket = handle.element.querySelector<HTMLElement>('[data-bracket="k"]')!;
    // The severity, not the neutral rule grey `flowParts.bracket`'s `border`
    // shorthand reset it to — and the same colour the flag beside it carries.
    expect(bracket.style.borderColor).toBe(flag.style.background);
    expect(bracket.style.borderColor).toContain('--wui-harmony-danger');
    handle.destroy();
  });

  it('lights a motif’s siblings on the inline path, and never dims the sounding one', () => {
    // `focusGroup` is the reason `motifs` draws one track per motif, and on the
    // inline path it did nothing at all: `data-focus` was written and only the
    // sheet ever read it. The `now` exclusion is the other half — at equal
    // specificity the focus rule out-ordered the zone rules and dimmed the one
    // band that must never dim.
    const handle = lane(
      {
        bands: [
          {id: 'x', start: 0, end: 4, group: 'm', primary: 'A'},
          {id: 'y', start: 6, end: 9, group: 'm', primary: 'A'},
        ],
        focusGroup: 'm',
        now: 1,
      },
      {},
      {stylesheet: false, scale: 10, fallbackWidth: 300},
    );
    const fill = (id: string) =>
      handle.band(id)!.querySelector<HTMLElement>('.wui-harmony-flow__fill')!.style.opacity;
    expect(handle.band('y')!.dataset.focus).toBe('true');
    expect(fill('y')).toBe('0.7');
    expect(fill('x')).toBe('1');
    handle.destroy();
  });

  it('hides the reel from a reader, on both paths, and keeps the twin', () => {
    // The last visual child of the viewport that was not hidden, and the only
    // one whose contents are words. Without `seek` the viewport has no role, so
    // every label was announced twice — once off the reel, once out of the
    // `<ol>`.
    const still = lane();
    expect(still.reel.getAttribute('aria-hidden')).toBe('true');
    expect(still.viewport.getAttribute('role')).toBeNull();
    expect([...still.index.children].map((item) => item.textContent)).toEqual([
      'Am7',
      'D7',
      'Gmaj7',
    ]);
    still.destroy();
    const seekable = lane({}, {seek: vi.fn()});
    expect(seekable.reel.getAttribute('aria-hidden')).toBe('true');
    seekable.destroy();
  });

  it('dims a muted row, and weights a major tick against a beat', () => {
    // Both attributes were written from the first draft and read by nothing:
    // `FlowTrack.muted` says "drawn dimmed, and its bands with it", and a bar
    // line drawn at a beat's weight is a ruler that is not a ruler.
    const handle = lane(
      {
        tracks: [{id: 'chords'}, {id: 'motifs', muted: true}],
        ruler: [
          {at: 0, label: '1', major: true},
          {at: 1, label: ''},
        ],
      },
      {},
      {stylesheet: false},
    );
    expect(handle.track('motifs')!.style.opacity).toBe('0.45');
    expect(handle.track('chords')!.style.opacity).toBe('');
    const ticks = [...handle.element.querySelectorAll<HTMLElement>('.wui-harmony-flow__tick')];
    expect(ticks[0]?.dataset.major).toBe('true');
    expect(ticks[0]?.style.opacity).toBe('0.9');
    expect(ticks[1]?.style.opacity).toBe('0.5');
    expect(harmonyPresenterStyle).toContain('[data-major="true"]');
    expect(harmonyPresenterStyle).toContain('[data-muted="true"]');
    handle.destroy();
  });

  it('releases a capture it is still holding when it is torn down mid-drag', () => {
    const release = vi.fn();
    const handle = lane({}, {seek: vi.fn()}, {scale: 10, fallbackWidth: 300});
    handle.viewport.setPointerCapture = vi.fn();
    handle.viewport.releasePointerCapture = release;
    const down = new MouseEvent('pointerdown', {bubbles: true, cancelable: true, clientX: 10, button: 0});
    Object.defineProperty(down, 'pointerId', {configurable: true, value: 7});
    handle.viewport.dispatchEvent(down);
    handle.destroy();
    expect(release).toHaveBeenCalledWith(7);
  });
});


describe('mountFlowLane responsive layout', () => {
  it.each([true, false])('thins measured ruler labels on resize/zoom, prioritizing majors without moving ticks (stylesheet=%s)', (stylesheet) => {
    let resize = (): void => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe(): void {}
      disconnect(): void {}
    });
    const original = HTMLElement.prototype.getBoundingClientRect;
    const labelMeasure = vi.fn(() => 40);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('wui-harmony-flow__tick-label')) {
        return {x: 0, y: 0, left: 0, top: 0, right: 40, bottom: 12,
          width: labelMeasure(), height: 12, toJSON: () => ({})};
      }
      return original.call(this);
    });
    const ruler = Array.from({length: 11}, (_, at) => ({at, label: `bar:${at}`, major: at % 4 === 0}));
    const handle = lane({ruler}, {}, {visibleSpan: 10, animate: false, stylesheet});
    let width = 100;
    const widthRead = vi.fn(() => width);
    Object.defineProperty(handle.viewport, 'clientWidth', {get: widthRead});
    const visible = () => [...handle.element.querySelectorAll<HTMLElement>('.wui-harmony-flow__tick-label')]
      .filter((node) => !node.hidden);
    const ticks = () => [...handle.element.querySelectorAll<HTMLElement>('.wui-harmony-flow__tick')]
      .map((node) => node.style.left);
    const positions = ticks();
    const originalBoxes = boxes(handle.element);
    resize();
    expect(widthRead).toHaveBeenCalled();
    expect(labelMeasure).toHaveBeenCalled();
    expect(visible().map((node) => node.textContent)).toEqual(['bar:0', 'bar:8']);
    expect(ticks()).toEqual(positions);
    expect(ticks()).toHaveLength(11);
    expect(boxes(handle.element)).toEqual(originalBoxes);
    const measured = labelMeasure.mock.calls.length;
    handle.tick(); handle.tick(); handle.update();
    expect(labelMeasure).toHaveBeenCalledTimes(measured);
    width = 480;
    resize();
    expect(visible()).toHaveLength(11);
    const lefts = visible().map((node) => Number.parseFloat(node.style.left) / 100 * 480);
    lefts.slice(1).forEach((left, index) => expect(left - lefts[index]!).toBeGreaterThanOrEqual(48));
    expect(ticks()).toEqual(positions);
    handle.viewport.dispatchEvent(new WheelEvent('wheel', {deltaY: 300 * Math.log(2), ctrlKey: true}));
    expect(visible().map((node) => node.textContent)).toEqual(['bar:0', 'bar:2', 'bar:4', 'bar:6', 'bar:8', 'bar:10']);
    expect(ticks()).toEqual(positions);
    handle.destroy();
  });

  it.each([true, false])('keeps three rows separate without shrinking low-weight labels (stylesheet=%s)', (stylesheet) => {
    const handle = lane(
      {
        tracks: [{id: 'key', label: 'Key'}, {id: 'function', label: 'Function'}, {id: 'roman', label: 'Numerals'}],
        bands: [
          {id: 'key', start: 0, end: 10, primary: 'C major', track: 0, weight: 0.25},
          {id: 'function', start: 0, end: 4, primary: 'Dominant', secondary: '25% evidence', track: 1, weight: 0.25},
          {id: 'roman', start: 0, end: 4, primary: 'V7/V', track: 2},
        ],
        ruler: [{at: 0, label: '1'}, {at: 4, label: '2'}],
        flags: [{id: 'arrival', at: 0, track: 2}],
      },
      {},
      {stylesheet, animate: false},
    );
    const rows = ['key', 'function', 'roman'].map((id) => handle.track(id)!);
    expect(new Set(rows.map((row) => row.style.top)).size).toBe(3);
    expect(handle.viewport.style.minHeight).toContain('* 3');
    rows.forEach((row, index) => {
      const band = handle.band(['key', 'function', 'roman'][index]!)!;
      expect(band.parentElement).toBe(row);
      expect(band.style.top).toBe('0px');
      expect(band.style.height).toBe('100%');
    });
    const weighted = handle.band('function')!;
    const fill = weighted.querySelector<HTMLElement>('.wui-harmony-flow__fill')!;
    expect(fill.style.height).toBe('25%');
    expect(fill.style.top).toBe('37.5%');
    expect(weighted.querySelector('.wui-harmony-flow__label')?.textContent).toBe('Dominant');
    expect(weighted.querySelector('.wui-harmony-flow__note')?.textContent).toBe('25% evidence');
    expect(weighted.title).toBe('Dominant — 25% evidence');
    const gutter = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__gutter')!;
    const pinned = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__pinned')!;
    expect(handle.viewport.contains(gutter)).toBe(false);
    expect(handle.viewport.contains(pinned)).toBe(false);
    expect(pinned.parentElement).toBe(handle.element);
    expect(gutter.nextElementSibling).toBe(handle.viewport);
    const decorations = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__decorations')!;
    expect(getComputedStyle(decorations).pointerEvents).toBe('none');
    expect(handle.element.querySelector<HTMLElement>('[data-flag="arrival"]')!.style.top).toBe(rows[2]!.style.top);
    handle.destroy();
  });

  it('preserves the visible span, zoom, current position and drag scale after resize', () => {
    let resize = (): void => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe(): void {}
      disconnect = disconnect;
    });
    const seek = vi.fn();
    const handle = lane({now: 2}, {seek}, {visibleSpan: 10, scale: 999, animate: false});
    const band = handle.band('b');
    expect(handle.reel.style.width).toBe('300px');
    expect(handle.reel.style.transform).toBe('translate3d(39px, 0, 0)');
    handle.viewport.dispatchEvent(new WheelEvent('wheel', {deltaY: -300 * Math.log(2), ctrlKey: true}));
    expect(handle.reel.style.width).toBe('600px');
    expect(handle.reel.style.transform).toBe('translate3d(-21px, 0, 0)');
    let width = 150;
    const readWidth = vi.fn(() => width);
    Object.defineProperty(handle.viewport, 'clientWidth', {get: readWidth});
    resize();
    expect(handle.reel.style.width).toBe('300px');
    expect(handle.reel.style.transform).toBe('translate3d(-10.5px, 0, 0)');
    expect(handle.band('b')).toBe(band);
    const reads = readWidth.mock.calls.length;
    handle.tick();
    handle.tick();
    expect(readWidth).toHaveBeenCalledTimes(reads);
    const pointer = (type: string, clientX: number): PointerEvent => {
      const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX, button: 0});
      Object.defineProperty(event, 'pointerId', {value: 7});
      return event as PointerEvent;
    };
    handle.viewport.dispatchEvent(pointer('pointerdown', 100));
    handle.viewport.dispatchEvent(pointer('pointermove', 70));
    handle.viewport.dispatchEvent(pointer('pointerup', 70));
    expect(seek).toHaveBeenLastCalledWith(3, 'commit');
    expect(seek.mock.calls.filter(([, phase]) => phase === 'commit')).toHaveLength(1);
    const transform = handle.reel.style.transform;
    handle.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
    width = 500;
    resize();
    expect(handle.reel.style.transform).toBe(transform);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('falls back to scale for invalid visibleSpan %s', (visibleSpan) => {
    const handle = lane({}, {}, {visibleSpan, scale: 10, animate: false});
    expect(handle.reel.style.width).toBe('100px');
    handle.destroy();
  });

  it.each([true, false])('collapses an absent gutter and restores it when track labels arrive (stylesheet=%s)', (stylesheet) => {
    let tracks = [{id: 'first'}] as FlowLaneState['tracks'];
    const handle = lane({}, {snapshot: () => ({bands: BANDS, now: 0, tracks})}, {stylesheet, animate: false});
    const gutter = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__gutter')!;
    expect(getComputedStyle(gutter).display).toBe('none');
    expect(getComputedStyle(handle.viewport).gridColumn).toBe('2');
    tracks = [{id: 'first', label: 'Part', sublabel: 'Lower'}];
    handle.update();
    expect(getComputedStyle(gutter).display).toBe('flex');
    expect(gutter.textContent).toBe('Part · Lower');
    tracks = [{id: 'first', label: 'Part', sublabel: 'Upper'}];
    handle.update();
    expect(gutter.textContent).toBe('Part · Upper');
    handle.destroy();
  });
});


describe('mountFlowLane wrapped labels', () => {
  it.each([true, false])('keeps unmatched notes below an empty primary slot aligned with wrapped chord names (stylesheet=%s)', (stylesheet) => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('wui-harmony-flow__label') && this.parentElement?.dataset.labelMeasure === 'true') {
        expect(this.style.minHeight).toBe('1.25em');
        return {height: this.textContent ? 32 : 16} as DOMRect;
      }
      if (this.dataset.labelMeasure !== 'true') return original.call(this);
      // The unmatched note list is taller, but its primary slot is empty.
      const named = Boolean(this.querySelector('.wui-harmony-flow__label')!.textContent);
      return {height: named ? 65 : 105} as DOMRect;
    });
    const handle = lane({bands: [
      {id: 'named', start: 0, end: 0.8, primary: 'F#m7/C#', secondary: 'C#3 F#3 A3 E4'},
      {id: 'notes', start: 0.8, end: 1.6, primary: '', secondary: 'B2 E3 F#4 G#4 B4'},
    ]}, {}, {stylesheet, labelOverflow: 'wrap', visibleSpan: 4, animate: false});
    const named = handle.band('named')!;
    const unmatched = handle.band('notes')!;
    const primary = unmatched.querySelector<HTMLElement>('.wui-harmony-flow__label')!;
    const note = unmatched.querySelector<HTMLElement>('.wui-harmony-flow__note')!;
    expect(primary.textContent).toBe('');
    expect(primary.hidden).toBe(false);
    expect(note.textContent).toBe('B2 E3 F#4 G#4 B4');
    expect(primary.nextElementSibling).toBe(note);
    expect(getComputedStyle(named).justifyContent).toBe('flex-start');
    expect(getComputedStyle(unmatched).justifyContent).toBe('flex-start');
    expect(getComputedStyle(primary).minHeight).toBe(getComputedStyle(named.querySelector('.wui-harmony-flow__label')!).minHeight);
    expect(handle.element.style.getPropertyValue('--wui-harmony-flow-primary-height')).toBe('32px');
    expect(handle.element.style.getPropertyValue('--wui-harmony-flow-row-height')).toContain('121px');
    expect(handle.index.textContent).toContain('B2 E3 F#4 G#4 B4');
    expect(handle.element.querySelector('[data-label-measure]')).toBeNull();
    handle.destroy();
  });

  it.each([true, false])('fits complete stacks at the wrap minimum without changing time boxes or frame cost (stylesheet=%s)', (stylesheet) => {
    const measured = vi.fn();
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.labelMeasure !== 'true') return original.call(this);
      measured(Number.parseFloat(this.style.width));
      expect(this.parentElement?.getAttribute('aria-hidden')).toBe('true');
      expect(this.style.contentVisibility).toBe('visible');
      return {height: 173.25} as DOMRect;
    });
    let now = 0;
    let primary = 'F#m7/C#';
    const snapshot = (): FlowLaneState => ({
      bands: [{id: 'one', start: 0, end: 0.8, track: 0, primary, secondary: 'C#3 F#3 A3 E4'},
        {id: 'two', start: 4, end: 4.8, track: 2, primary, secondary: 'C#3 F#3 A3 E4'}],
      tracks: [{id: 'first'}, {id: 'blank'}, {id: 'later'}], span: {start: 0, end: 8}, now,
    });
    const handle = lane({}, {snapshot, position: () => now},
      {stylesheet, labelOverflow: 'wrap', trackLayout: 'visible', visibleSpan: 4, animate: false});
    expect(measured).toHaveBeenCalledTimes(1); // identical text + width, even on another row
    expect(measured).toHaveBeenCalledWith(60);
    const band = handle.band('one')!;
    const geometry = boxes(handle.element);
    expect(band.style.width).toBe('10%');
    expect(band.dataset.labelOverflow).toBe('wrap');
    for (const selector of ['.wui-harmony-flow__label', '.wui-harmony-flow__note']) {
      const text = band.querySelector<HTMLElement>(selector)!;
      const style = getComputedStyle(text);
      expect(style.whiteSpace).toBe('normal');
      expect(style.overflowWrap).toBe('anywhere');
      expect(style.textOverflow).toBe('clip');
      expect(style.display).not.toBe('none');
      expect(text.hidden).toBe(false);
    }
    expect(handle.element.style.getPropertyValue('--wui-harmony-flow-row-height')).toBe(
      'max(var(--wui-harmony-lane-height, var(--wm-harmony-lane-height, 48px)), 174px)',
    );
    expect(handle.element.style.getPropertyValue('--wui-harmony-lane-height')).toBe('');
    expect(handle.element.querySelector('[data-label-measure]')).toBeNull();
    expect(handle.track('later')!.hidden).toBe(true);
    for (let i = 0; i < 20; i++) { now += 0.01; handle.tick(); }
    expect(measured).toHaveBeenCalledTimes(1);
    handle.update();
    expect(measured).toHaveBeenCalledTimes(2);
    now = 4.1; handle.tick();
    expect(handle.track('later')!.hidden).toBe(false);
    expect(handle.track('later')!.style.top).toContain('* 0');
    expect(boxes(handle.element)).toEqual(geometry);
    primary = 'F# minor seventh / C#';
    handle.update();
    expect(measured).toHaveBeenCalledTimes(3);
    expect(handle.index.textContent).toContain(primary);
    handle.destroy();
  });

  it('remeasures measured width and inherited typography on resize and zoom, retaining the public minimum', () => {
    let resize = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe(): void {} disconnect(): void {}
    });
    const parent = host();
    parent.style.setProperty('--wui-harmony-lane-height', '180px');
    parent.style.setProperty('--wui-harmony-size-body', '24px');
    const widths: number[] = [];
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('wui-harmony-flow__label') && this.parentElement?.dataset.labelMeasure === 'true') {
        const width = Number.parseFloat(this.parentElement.style.width);
        const fontScale = Number.parseFloat(parent.style.getPropertyValue('--wui-harmony-size-body')) / 24;
        return {height: (width < 32 ? 190 : 80) * fontScale - 8} as DOMRect;
      }
      if (this.dataset.labelMeasure !== 'true') return original.call(this);
      expect(parent.contains(this)).toBe(true);
      expect(this.querySelector<HTMLElement>('.wui-harmony-flow__label')!.style.fontSize).toContain('--wui-harmony-size-body');
      const width = Number.parseFloat(this.style.width);
      widths.push(width);
      // Deliberate measurement seam: jsdom does not lay text into line boxes.
      const fontScale = Number.parseFloat(parent.style.getPropertyValue('--wui-harmony-size-body')) / 24;
      return {height: (width < 32 ? 190 : 80) * fontScale} as DOMRect;
    });
    const handle = mountFlowLane(parent, {snapshot: () => ({
      bands: [{id: 'small', start: 0, end: 0.5, primary: 'C#4 E4 G#4 B4'}], now: 0,
    })}, {labelOverflow: 'wrap', visibleSpan: 4, fallbackWidth: 200, animate: false, stylesheet: false});
    // 25px is below the wrap minimum: nothing is measured and the row keeps the token minimum.
    const label = handle.band('small')!.querySelector<HTMLElement>('.wui-harmony-flow__label')!;
    expect(widths).toEqual([]);
    expect(label.hidden).toBe(true);
    expect(handle.element.style.getPropertyValue('--wui-harmony-flow-row-height')).toBe('');
    const geometry = boxes(handle.element);
    Object.defineProperty(handle.viewport, 'clientWidth', {value: 400});
    resize();
    expect(widths).toEqual([50]);
    expect(label.hidden).toBe(false);
    expect(handle.element.style.getPropertyValue('--wui-harmony-flow-row-height')).toContain('80px');
    expect(parent.style.getPropertyValue('--wui-harmony-lane-height')).toBe('180px');
    expect(handle.track('0')!.style.height).toContain('--wui-harmony-flow-row-height');
    parent.style.setProperty('--wui-harmony-size-body', '36px');
    handle.update();
    expect(widths).toEqual([50, 50]);
    expect(handle.element.style.getPropertyValue('--wui-harmony-flow-row-height')).toContain('120px');
    handle.viewport.dispatchEvent(new WheelEvent('wheel', {deltaY: -300 * Math.log(2), ctrlKey: true}));
    expect(widths).toEqual([50, 50, 100]);
    expect(boxes(handle.element)).toEqual(geometry);
    handle.tick();
    expect(widths).toHaveLength(3);
    handle.destroy();
  });

  it.each([true, false])('hides wrapped stacks below 48px, keeps their reading elsewhere and restores them when zoomed (stylesheet=%s)', (stylesheet) => {
    const measured: number[] = [];
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('wui-harmony-flow__label') && this.parentElement?.dataset.labelMeasure === 'true') {
        return {height: 18} as DOMRect;
      }
      if (this.dataset.labelMeasure !== 'true') return original.call(this);
      measured.push(Number.parseFloat(this.style.width));
      return {height: 60} as DOMRect;
    });
    const handle = lane({bands: [
      {id: 'wide', start: 0, end: 1, primary: 'A/C#', secondary: 'C#4 E4 A4'},
      {id: 'narrow', start: 1, end: 1.4, primary: 'G#m/B', secondary: 'B3 D#4 G#4'},
    ]}, {}, {stylesheet, labelOverflow: 'wrap', visibleSpan: 4, animate: false});
    // 300px across 4 units: the wide band is 75px and the narrow one 30px.
    expect(measured).toEqual([75]);
    const wide = handle.band('wide')!;
    const narrow = handle.band('narrow')!;
    const narrowLabel = narrow.querySelector<HTMLElement>('.wui-harmony-flow__label')!;
    const narrowNote = narrow.querySelector<HTMLElement>('.wui-harmony-flow__note')!;
    expect(narrow.dataset.labelFit).toBe('hidden');
    expect(narrowLabel.hidden).toBe(true);
    expect(narrowNote.hidden).toBe(true);
    expect(getComputedStyle(narrowLabel).display).toBe('none');
    expect(narrow.title).toBe('G#m/B — B3 D#4 G#4');
    expect(handle.index.textContent).toContain('G#m/B — B3 D#4 G#4');
    expect(wide.dataset.labelFit).toBeUndefined();
    expect(wide.querySelector<HTMLElement>('.wui-harmony-flow__label')!.hidden).toBe(false);
    expect(handle.element.style.getPropertyValue('--wui-harmony-flow-row-height')).toContain('60px');
    const geometry = boxes(handle.element);
    handle.viewport.dispatchEvent(new WheelEvent('wheel', {deltaY: -300 * Math.log(2), ctrlKey: true}));
    expect(measured).toEqual([75, 150, 60]);
    expect(narrow.dataset.labelFit).toBeUndefined();
    expect(narrowLabel.hidden).toBe(false);
    expect(narrowNote.hidden).toBe(false);
    expect(boxes(handle.element)).toEqual(geometry);
    expect(handle.element.querySelector('[data-label-measure]')).toBeNull();
    handle.destroy();
  });

  it('keeps truncation as the default and performs no label-stack measurement', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    const handle = lane({bands: [{id: 'short', start: 0, end: 0.1, primary: 'Long label'}]}, {}, {animate: false});
    const band = handle.band('short')!;
    expect(band.dataset.labelOverflow).toBeUndefined();
    expect(getComputedStyle(band.querySelector('.wui-harmony-flow__label')!).textOverflow).toBe('ellipsis');
    expect(handle.element.style.getPropertyValue('--wui-harmony-flow-row-height')).toBe('');
    expect(rect.mock.instances.some((node) => (node as HTMLElement).dataset.labelMeasure === 'true')).toBe(false);
    handle.destroy();
  });
});

describe('mountFlowLane contour labels', () => {
  it.each([true, false])('keeps a narrow band readable through its title and semantic index (stylesheet=%s)', (stylesheet) => {
    const handle = lane({
      bands: [{id: 'r2', start: 0, end: 0.2, primary: 'R2', secondary: 'recurring rhythm'}],
      tracks: [{id: 'r2', label: 'R2'}],
      span: {start: 0, end: 10},
    }, {}, {stylesheet, visibleSpan: 12, animate: false});
    const band = handle.band('r2')!;
    expect(band.style.width).toBe('2%');
    expect(band.title).toBe('R2 — recurring rhythm');
    expect(handle.index.textContent).toBe('R2 — recurring rhythm');
    expect(handle.element.querySelector('.wui-harmony-flow__gutter')?.textContent).toBe('R2');
    expect(band.querySelector('.wui-harmony-flow__label')?.textContent).toBe('R2');
    expect(band.querySelector('.wui-harmony-flow__note')?.textContent).toBe('recurring rhythm');
    expect(band.querySelector('.wui-harmony-flow__label')?.hasAttribute('hidden')).toBe(false);
    handle.destroy();
  });

  it('suppresses internal labels below 32px without hiding the band or its semantic text', () => {
    expect(harmonyPresenterStyle).toContain('container-type: inline-size');
    expect(harmonyPresenterStyle).toContain('container-name: wui-harmony-band');
    expect(harmonyPresenterStyle).toContain('@container wui-harmony-band (max-width: 31px)');
    expect(harmonyPresenterStyle).toContain('.wui-harmony-flow__band:not([data-label-overflow="wrap"]) > .wui-harmony-flow__label');
    expect(harmonyPresenterStyle).toContain('.wui-harmony-flow__band:not([data-label-overflow="wrap"]) > .wui-harmony-flow__note { display: none; }');
  });

  it.each([true, false])('reserves label space and keeps contour strokes independent of the axis scale (stylesheet=%s)', (stylesheet) => {
    const handle = lane({
      bands: [{id: 'voice', start: 0, end: 10, primary: 'Voice 1', secondary: 'Upper part', points: [{at: 0, y: 0.2}, {at: 1, y: 0.8}]}],
    }, {}, {stylesheet, visibleSpan: 2, animate: false});
    const band = handle.band('voice')!;
    const label = band.querySelector<HTMLElement>('.wui-harmony-flow__label')!;
    const note = band.querySelector<HTMLElement>('.wui-harmony-flow__note')!;
    const glyph = band.querySelector<SVGElement>('.wui-harmony-flow__glyph')!;
    expect(note.nextElementSibling?.nextElementSibling).toBe(glyph);
    expect(getComputedStyle(label).flexShrink).toBe('0');
    expect(getComputedStyle(note).flexShrink).toBe('0');
    expect(getComputedStyle(glyph).position).toBe('relative');
    expect(getComputedStyle(glyph).flexGrow).toBe('1');
    expect(getComputedStyle(glyph).pointerEvents).toBe('none');
    const path = glyph.querySelector('path')!;
    expect(path.getAttribute('fill')).toBe('none');
    expect(path.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(path.getAttribute('stroke-width')).toBe('1.5');
    const geometry = path.getAttribute('d');
    handle.viewport.dispatchEvent(new WheelEvent('wheel', {deltaY: -300, ctrlKey: true}));
    expect(path.getAttribute('d')).toBe(geometry);
    expect(path.getAttribute('stroke-width')).toBe('1.5');
    expect(label.textContent).toBe('Voice 1');
    handle.destroy();
  });

  it('uses a translucent neutral fallback without diluting an explicit tone token', () => {
    const handle = lane({bands: [{id: 'plain', start: 0, end: 10, primary: 'T'}]}, {}, {stylesheet: false, motion: 'stepped'});
    const band = handle.band('plain')!;
    const fill = band.querySelector<HTMLElement>('.wui-harmony-flow__fill')!;
    expect(fill.style.background).toContain('var(--wui-harmony-flow-tone, color-mix(');
    expect(fill.style.background).toContain('18%, transparent');
    expect(fill.style.opacity).toBe('1');
    handle.element.style.setProperty('--wm-harmony-flow-tone', '#d03030');
    band.style.setProperty('--wui-harmony-flow-tone', '#236b44');
    handle.tick();
    expect(band.style.getPropertyValue('--wui-harmony-flow-tone')).toBe('#236b44');
    expect(fill.style.background.startsWith('var(--wm-harmony-flow-tone,')).toBe(true);
    expect(handle.element.style.getPropertyValue('--wm-harmony-flow-tone')).toBe('#d03030');
    handle.destroy();
  });
});

describe('mountFlowLane fixed readout fields', () => {
  it.each([true, false])('reserves all headings and fields, retains slots across bands and clears gap values (stylesheet=%s)', (stylesheet) => {
    const reads = vi.fn();
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const kind = this.dataset.readoutMeasure;
      if (!kind) return original.call(this);
      reads(kind, this.textContent);
      expect(this.closest('[aria-hidden="true"]')).not.toBeNull();
      return {height: kind === 'primary' ? (this.textContent!.length > 20 ? 56 : 28)
        : kind === 'value' && this.textContent!.length > 18 ? 52 : 18} as DOMRect;
    });
    let now = 0;
    const material: FlowBand[] = [
      {id: 'short', start: 0, end: 1, primary: '3m', secondary: 'legacy · text', readout: {
        primary: 'Minor third', fields: [
          {id: 'notes', label: 'Notes', value: 'C4 → Eb4'},
          {id: 'motion', label: 'Motion', value: 'Ascending'},
          {id: 'semitones', label: 'Semitones', value: '3'},
        ],
      }},
      {id: 'long', start: 2, end: 3, primary: '8th', secondary: 'other · legacy', readout: {
        primary: 'Dotted eighth-note triplet', fields: [
          {id: 'semitones', label: 'Semitones', value: '15'},
          {id: 'notes', label: 'Notes', value: 'B#-1 → C##10'},
          {id: 'motion', label: 'Motion', value: 'Descending across the interval'},
        ],
      }},
    ];
    const handle = lane({bands: material, span: {start: 0, end: 3}}, {position: () => now, seek: vi.fn()},
      {stylesheet, reservePinned: true, animate: false});
    const heading = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__pinned-name')!;
    const legacy = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__pinned-note')!;
    const fields = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__pinned-fields')!;
    const slots = [...fields.children];
    const values = () => [...fields.querySelectorAll('.wui-harmony-flow__pinned-field-value')].map((node) => node.textContent);
    expect(getComputedStyle(fields).gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    expect(slots.map((slot) => (slot as HTMLElement).dataset.readoutField)).toEqual(['notes', 'motion', 'semitones']);
    expect(heading.textContent).toBe('Minor third');
    expect(heading.style.minHeight).toBe('56px'); // future long heading already reserved
    expect(fields.style.getPropertyValue('--wui-harmony-flow-field-value-height')).toBe('52px');
    expect(values()).toEqual(['C4 → Eb4', 'Ascending', '3']);
    expect(legacy.hidden).toBe(true);
    expect(legacy.textContent).toBe('');
    expect(handle.band('short')!.title).toBe('Minor third\nNotes: C4 → Eb4\nMotion: Ascending\nSemitones: 3');
    expect(handle.index.textContent).not.toContain('legacy');
    expect(handle.viewport.getAttribute('aria-valuetext')).toContain('Notes: C4 → Eb4');
    expect(handle.element.querySelector('[data-readout-measure]')).toBeNull();
    const measurements = reads.mock.calls.length;
    const geometry = boxes(handle.element);
    for (let i = 0; i < 10; i++) { now += 0.01; handle.tick(); }
    now = 1.5; handle.tick();
    expect(heading.textContent).toBe('');
    expect(values()).toEqual(['', '', '']);
    expect(fields.hidden).toBe(false);
    expect(fields.textContent).toBe('NotesMotionSemitones');
    expect(heading.parentElement!.style.visibility).not.toBe('hidden');
    now = 2.2; handle.tick();
    expect(heading.textContent).toBe('Dotted eighth-note triplet');
    expect(values()).toEqual(['B#-1 → C##10', 'Descending across the interval', '15']);
    expect([...fields.children]).toEqual(slots); // reordered data does not move keyed slots
    expect(heading.style.minHeight).toBe('56px');
    expect(boxes(handle.element)).toEqual(geometry);
    expect(reads).toHaveBeenCalledTimes(measurements);
    handle.destroy();
  });

  it.each([
    {stylesheet: true, reservePinned: undefined},
    {stylesheet: false, reservePinned: undefined},
    {stylesheet: true, reservePinned: false},
    {stylesheet: false, reservePinned: false},
  ] as const)('collapses structured gaps unless reserved and retains explicit overrides (stylesheet=$stylesheet, reservePinned=$reservePinned)', ({stylesheet, reservePinned}) => {
    let now = 0;
    let pinned: FlowReadout | undefined;
    const material: FlowBand[] = [
      {id: 'first', start: 0, end: 1, readout: {primary: 'Major third', fields: [
        {id: 'notes', label: 'Notes', value: 'C4 → E4'},
        {id: 'motion', label: 'Motion', value: 'Ascending'},
        {id: 'semitones', label: 'Semitones', value: '4'},
      ]}},
      {id: 'next', start: 2, end: 3, readout: {primary: 'Minor third', fields: [
        {id: 'notes', label: 'Notes', value: 'E4 → G4'},
        {id: 'motion', label: 'Motion', value: 'Ascending'},
        {id: 'semitones', label: 'Semitones', value: '3'},
      ]}},
    ];
    const handle = lane({}, {snapshot: () => ({bands: material, span: {start: 0, end: 3}, now: 0, pinned}),
      position: () => now}, {stylesheet, animate: false, ...(reservePinned === undefined ? {} : {reservePinned})});
    const readout = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__pinned')!;
    const fields = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__pinned-fields')!;
    const slots = [...fields.children];
    const values = () => [...fields.querySelectorAll('.wui-harmony-flow__pinned-field-value')].map((node) => node.textContent);
    expect(readout.hidden).toBe(false);
    expect(values()).toEqual(['C4 → E4', 'Ascending', '4']);

    now = 1.5; handle.tick();
    expect(readout.hidden).toBe(true);
    expect(getComputedStyle(readout).display).toBe('none');
    expect(fields.hidden).toBe(true);

    pinned = {primary: 'Selected pair', fields: [
      {id: 'notes', label: 'Notes', value: 'F4 → A4'},
      {id: 'motion', label: 'Motion', value: 'Ascending'},
      {id: 'semitones', label: 'Semitones', value: '4'},
    ]};
    handle.update();
    expect(readout.hidden).toBe(false);
    expect(fields.hidden).toBe(false);
    expect(values()).toEqual(['F4 → A4', 'Ascending', '4']);
    expect([...fields.children]).toEqual(slots);

    pinned = undefined; handle.update();
    expect(readout.hidden).toBe(true);
    expect(getComputedStyle(readout).display).toBe('none');
    now = 2.5; handle.tick();
    expect(readout.hidden).toBe(false);
    expect(fields.hidden).toBe(false);
    expect(values()).toEqual(['E4 → G4', 'Ascending', '3']);
    expect([...fields.children]).toEqual(slots);
    handle.destroy();
  });

  it('honors whole-array overrides and explicit empty fields while preserving legacy secondary behavior', () => {
    let pinned: FlowReadout | undefined;
    let material: FlowBand[] = [{id: 'band', start: 0, end: 2, primary: 'Interval', secondary: 'legacy · description',
      readout: {fields: [{id: 'notes', label: 'Notes', value: 'C4 → E4'}]}}];
    const handle = lane({}, {snapshot: () => ({bands: material, now: 0, pinned})}, {reservePinned: true, animate: false});
    const fields = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__pinned-fields')!;
    const legacy = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__pinned-note')!;
    const heading = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__pinned-name')!;
    const slot = fields.firstElementChild;
    pinned = {primary: 'Override', fields: [{id: 'notes', label: 'Input', value: 'F4 → A4'}]};
    handle.update();
    expect(fields.firstElementChild).toBe(slot);
    expect(fields.textContent).toBe('InputF4 → A4');
    expect(heading.textContent).toBe('Override');
    pinned = {fields: [], secondary: 'must not leak'};
    handle.update();
    expect(fields.hidden).toBe(true);
    expect(fields.childElementCount).toBe(0);
    expect(legacy.hidden).toBe(true);
    expect(legacy.textContent).toBe('');
    pinned = undefined;
    material = [{id: 'band', start: 0, end: 2, primary: 'Old reader', secondary: 'legacy · description'}];
    handle.update();
    expect(legacy.hidden).toBe(false);
    expect(legacy.textContent).toBe('legacy · description');
    expect(heading.style.minHeight).toBe('1.15em');
    expect(handle.band('band')!.title).toBe('Old reader — legacy · description');
    handle.destroy();
  });

  it('remeasures fixed columns on width, typography and zoom changes without replacing slots or measuring frames', () => {
    let resize = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe(): void {} disconnect(): void {}
    });
    let factor = 1;
    const reads = vi.fn();
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const kind = this.dataset.readoutMeasure;
      if (!kind) return original.call(this);
      const width = Number.parseFloat((this.closest('.wui-harmony-flow__pinned') as HTMLElement).style.width);
      reads(kind, width);
      // Measured line-box seam: jsdom itself cannot wrap text into geometry.
      return {height: (width < 240 ? 64 : 24) * factor} as DOMRect;
    });
    const handle = lane({bands: [{id: 'degree', start: 0, end: 1, readout: {primary: 'Degree #6', fields: [
      {id: 'note', label: 'Note', value: 'F##4'},
      {id: 'reference', label: 'Reference', value: 'C# descending melodic minor'},
      {id: 'relation', label: 'Relation', value: 'Altered degree'},
    ]}}]}, {}, {reservePinned: true, animate: false});
    const fields = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__pinned-fields')!;
    const pinned = fields.parentElement!;
    const heading = pinned.querySelector<HTMLElement>('.wui-harmony-flow__pinned-name')!;
    const slots = [...fields.children];
    expect(heading.style.minHeight).toBe('24px');
    let width = 180;
    const widthRead = vi.fn(() => width);
    Object.defineProperty(pinned, 'clientWidth', {get: widthRead});
    resize();
    expect(heading.style.minHeight).toBe('64px');
    expect(fields.style.getPropertyValue('--wui-harmony-flow-field-value-height')).toBe('64px');
    expect(getComputedStyle(fields).gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    factor = 1.5;
    handle.element.style.setProperty('--wui-harmony-size-label', '1.5rem');
    handle.update();
    expect(heading.style.minHeight).toBe('96px');
    width = 360; resize();
    expect(heading.style.minHeight).toBe('36px');
    expect([...fields.children]).toEqual(slots);
    const beforeZoom = reads.mock.calls.length;
    handle.viewport.dispatchEvent(new WheelEvent('wheel', {deltaY: -100, ctrlKey: true}));
    expect(reads.mock.calls.length).toBeGreaterThan(beforeZoom);
    const measurements = reads.mock.calls.length;
    const widths = widthRead.mock.calls.length;
    handle.tick(); handle.tick();
    expect(reads).toHaveBeenCalledTimes(measurements);
    expect(widthRead).toHaveBeenCalledTimes(widths);
    expect(handle.element.querySelector('[data-readout-measure]')).toBeNull();
    handle.destroy();
    resize();
    expect(reads).toHaveBeenCalledTimes(measurements);
  });
});

// A sparse score can have many rows somewhere without needing empty rows here.
describe('mountFlowLane expanded readings and visible rows', () => {
  it.each([true, false])('separates compact labels from a clear pinned reading and honors state overrides (stylesheet=%s)', (stylesheet) => {
    let pinned: FlowLaneState['pinned'] = undefined;
    const handle = lane({}, {snapshot: () => ({
      bands: [{id: 'interval', start: 0, end: 4, primary: '3m', secondary: 'C#4 → E4',
        readout: {primary: 'Minor third', secondary: 'C#4 → E4 · ascending'}}],
      now: 0, pinned,
    }), seek: vi.fn()}, {stylesheet, animate: false});
    const primary = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__pinned-name')!;
    const secondary = handle.element.querySelector<HTMLElement>('.wui-harmony-flow__pinned-note')!;
    expect(primary.textContent).toBe('Minor third');
    expect(secondary.textContent).toBe('C#4 → E4 · ascending');
    expect(getComputedStyle(primary).fontWeight).toBe('700');
    expect(getComputedStyle(secondary).fontWeight).toBe('400');
    expect(handle.band('interval')?.querySelector('.wui-harmony-flow__label')?.textContent).toBe('3m');
    expect(handle.index.textContent).toBe('Minor third — C#4 → E4 · ascending');
    expect(handle.viewport.getAttribute('aria-valuetext')).toContain('Minor third');
    pinned = {primary: 'Selected passage', secondary: ''}; handle.update();
    expect(primary.textContent).toBe('Selected passage'); expect(secondary.textContent).toBe('');
    handle.destroy();
  });

  it.each([true, false])('compacts sparse original tracks, decorations and keyboard neighbors without removing data (stylesheet=%s)', (stylesheet) => {
    let now = 1;
    const focusBand = vi.fn();
    const seek = vi.fn();
    const source: FlowBand[] = [
      {id: 'near', start: 0, end: 3, track: 0, primary: 'Near'},
      {id: 'far', start: 8, end: 9, track: 1, primary: 'Far'},
      {id: 'low', start: 0, end: 3, track: 3, primary: 'Low'},
    ];
    const handle = lane({bands: source, tracks: [{id: 'top'}, {id: 'later'}, {id: 'empty'}, {id: 'lower'}],
      flags: [{id: 'lower-flag', at: 1, track: 3}, {id: 'hidden-flag', at: 8, track: 1}],
      brackets: [{id: 'pair', start: 0, end: 3, from: 0, to: 3}], now,
    }, {position: () => now, seek, focusBand}, {trackLayout: 'visible', visibleSpan: 2, anchor: 0.5, stylesheet, animate: false});
    const nodes = source.map((band) => handle.band(band.id));
    const geometry = boxes(handle.element);
    expect(handle.viewport.dataset.lanes).toBe('2');
    expect(handle.track('later')!.hidden).toBe(true);
    expect(handle.track('empty')!.hidden).toBe(true);
    expect(handle.track('lower')!.style.top).toContain('* 1');
    expect(handle.band('low')?.parentElement).toBe(handle.track('lower'));
    expect(handle.element.querySelector<HTMLElement>('[data-flag="lower-flag"]')!.style.top).toBe(handle.track('lower')!.style.top);
    expect(handle.element.querySelector<HTMLElement>('[data-flag="hidden-flag"]')!.hidden).toBe(true);
    expect(handle.element.querySelector<HTMLElement>('[data-bracket="pair"]')!.style.height).toContain('* 1');
    expect(handle.element.querySelector<HTMLElement>('.wui-harmony-flow__gutter')!.hidden).toBe(true);
    handle.viewport.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}));
    expect(focusBand).toHaveBeenLastCalledWith('low');
    expect(handle.index.children).toHaveLength(3);
    now = 8.5; handle.tick();
    expect(handle.viewport.dataset.lanes).toBe('1');
    expect(handle.track('later')!.hidden).toBe(false);
    expect(handle.track('later')!.style.top).toContain('* 0');
    expect(handle.track('lower')!.hidden).toBe(true);
    expect(handle.element.querySelector<HTMLElement>('[data-flag="hidden-flag"]')!.style.top).toBe(handle.track('later')!.style.top);
    expect(handle.element.querySelector<HTMLElement>('[data-bracket="pair"]')!.hidden).toBe(false);
    expect(boxes(handle.element)).toEqual(geometry);
    expect(source.map((band) => handle.band(band.id))).toEqual(nodes);
    expect(handle.index.children).toHaveLength(3);
    handle.viewport.dispatchEvent(new KeyboardEvent('keydown', {key: 'Home', bubbles: true}));
    expect(seek).toHaveBeenLastCalledWith(0, 'commit');
    expect(handle.viewport.dataset.lanes).toBe('2');
    handle.destroy();
  });

  it('uses half-open viewport intersections, handles backward seeks and reserves a single empty row', () => {
    let now = 1;
    const handle = lane({bands: [
      {id: 'old', start: 0, end: 1, track: 0}, {id: 'next', start: 2, end: 3, track: 2},
    ], tracks: [{id: 'old'}, {id: 'unused'}, {id: 'next'}], now}, {position: () => now},
    {trackLayout: 'visible', visibleSpan: 2, anchor: 0.5, animate: false});
    // [0,2) only touches next at its right boundary.
    expect(handle.track('next')!.hidden).toBe(true);
    now = 1.001; handle.tick(); expect(handle.viewport.dataset.lanes).toBe('2');
    // [1,3) no longer intersects old's [0,1).
    now = 2; handle.tick(); expect(handle.track('old')!.hidden).toBe(true);
    expect(handle.viewport.dataset.lanes).toBe('1');
    now = 1; handle.tick(); expect(handle.track('next')!.hidden).toBe(true);
    now = 5; handle.tick(); expect(handle.viewport.dataset.lanes).toBe('1');
    expect(handle.viewport.style.height).toContain('* 1');
    expect(handle.track('old')!.hidden).toBe(false);
    expect(handle.index.children).toHaveLength(2);
    handle.destroy();
  });

  it('reflows after zoom and measured resize without reading layout or rescanning bands on ordinary frames', () => {
    let resize = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe(): void {} disconnect(): void {}
    });
    let now = 1;
    const readStart = vi.fn(() => 4);
    const handle = lane({bands: [{id: 'held', start: 0, end: 3, track: 2},
      {id: 'later', get start() { return readStart(); }, end: 5, track: 4}], now}, {position: () => now},
    {trackLayout: 'visible', scale: 100, fallbackWidth: 200, anchor: 0.5, animate: false});
    const readWidth = vi.fn(() => 800);
    Object.defineProperty(handle.viewport, 'clientWidth', {get: readWidth});
    const reads = readStart.mock.calls.length;
    for (let i = 0; i < 10; i++) { now += 0.01; handle.tick(); }
    expect(readStart).toHaveBeenCalledTimes(reads);
    expect(readWidth).not.toHaveBeenCalled();
    resize(); expect(handle.viewport.dataset.lanes).toBe('2');
    handle.viewport.dispatchEvent(new WheelEvent('wheel', {deltaY: -300 * Math.log(4), ctrlKey: true}));
    expect(handle.viewport.dataset.lanes).toBe('1');
    expect(handle.band('later')!.parentElement!.hidden).toBe(true);
    handle.destroy();
  });
});
