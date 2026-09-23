// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  mountTimeline,
  timelineStyle,
  type TimelineBinding,
  type TimelineState,
} from '../src/timeline';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

class FakeTimeline implements TimelineBinding {
  state: TimelineState = {
    duration: 16,
    viewport: {start: 4, end: 12},
    playhead: 8,
    selection: {start: 6, end: 10},
    regions: [
      {id: 'intro', label: 'Intro', start: 2, end: 6, color: '#2255aa'},
      {id: 'verse', label: 'Verse', start: 7, end: 11, selected: true},
      {id: 'outro', label: 'Outro', start: 13, end: 16},
    ],
  };

  readonly subscribers = new Set<() => void>();
  readonly seek = vi.fn((position: number) => {
    this.state = {...this.state, playhead: position};
  });
  readonly selectRegion = vi.fn((id: string) => {
    this.state = {
      ...this.state,
      regions: this.state.regions.map((region) => ({
        ...region,
        selected: region.id === id,
      })),
    };
  });

  snapshot(): TimelineState {
    return this.state;
  }

  subscribe(notify: () => void): () => void {
    this.subscribers.add(notify);
    return () => this.subscribers.delete(notify);
  }

  notify(): void {
    for (const subscriber of this.subscribers) subscriber();
  }
}

describe('mountTimeline', () => {
  it('renders clipped regions, ruler, selection and playhead with stable parts', () => {
    const host = document.createElement('div');
    const binding = new FakeTimeline();
    const handle = mountTimeline(host, binding, {
      label: 'Arrangement',
      majorStep: 2,
      formatPosition: (position) => `${position} beats`,
    });

    expect(handle.element.getAttribute('aria-label')).toBe('Arrangement');
    expect(handle.element.getAttribute('part')).toBe('root');
    expect(handle.ruler.querySelectorAll('[part="tick"]')).toHaveLength(5);
    expect(handle.lane.querySelectorAll('[part="region"]')).toHaveLength(2);
    expect(handle.lane.querySelector('[data-region-id="intro"]')?.getAttribute('style')).toContain('width: 25%');
    expect(handle.lane.querySelector('[data-region-id="verse"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(handle.lane.querySelector<HTMLElement>('[part="selection"]')?.style.left).toBe('25%');
    expect(handle.lane.querySelector<HTMLElement>('[part="selection"]')?.style.width).toBe('50%');
    expect(handle.lane.querySelector<HTMLElement>('[part="playhead"]')?.style.left).toBe('50%');
    expect(handle.seek.hidden).toBe(false);
    expect(handle.seek.value).toBe('8');
    expect(handle.seek.getAttribute('aria-valuetext')).toBe('8 beats');
  });

  it('seeks by pointer and native range and selects a region additively', async () => {
    const host = document.createElement('div');
    const binding = new FakeTimeline();
    const handle = mountTimeline(host, binding, {
      majorStep: 4,
      keyboardStep: 1,
    });
    vi.spyOn(handle.lane, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 0,
      left: 100,
      right: 500,
      top: 0,
      bottom: 100,
      width: 400,
      height: 100,
      toJSON: () => ({}),
    });

    handle.lane.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: 200,
    }));
    await Promise.resolve();
    expect(binding.seek).toHaveBeenCalledWith(6);

    handle.seek.value = '7';
    handle.seek.dispatchEvent(new Event('input', {bubbles: true}));
    await Promise.resolve();
    expect(binding.seek).toHaveBeenLastCalledWith(7);

    const verse = handle.lane.querySelector<HTMLButtonElement>('[data-region-id="verse"]')!;
    verse.dispatchEvent(new MouseEvent('click', {bubbles: true, ctrlKey: true}));
    await Promise.resolve();
    expect(binding.selectRegion).toHaveBeenCalledWith('verse', {additive: true});
  });

  it('updates from subscriptions and preserves caller DOM across remounts', async () => {
    const host = document.createElement('div');
    const caller = document.createElement('span');
    caller.textContent = 'caller';
    host.append(caller);
    const firstBinding = new FakeTimeline();
    const first = mountTimeline(host, firstBinding);

    firstBinding.state = {...firstBinding.state, playhead: 10};
    firstBinding.notify();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    expect(first.lane.querySelector<HTMLElement>('[part="playhead"]')?.style.left).toBe('75%');

    const secondBinding = new FakeTimeline();
    const second = mountTimeline(host, secondBinding);
    expect(host.contains(caller)).toBe(true);
    expect(host.querySelectorAll('.wui-timeline')).toHaveLength(1);
    expect(firstBinding.subscribers.size).toBe(0);
    expect(secondBinding.subscribers.size).toBe(1);

    first.destroy();
    expect(host.querySelectorAll('.wui-timeline')).toHaveLength(1);
    second.destroy();
    second.destroy();
    expect(host.contains(caller)).toBe(true);
    expect(secondBinding.subscribers.size).toBe(0);
  });

  it('keeps structural nodes across playhead paints and supports ticks, markers and loops', () => {
    const host = document.createElement('div');
    const binding = new FakeTimeline();
    binding.state = {
      ...binding.state,
      ticks: [
        {id: 'bar-2', position: 4, label: '2'},
        {id: 'beat-9', position: 8.5, level: 'minor'},
        {id: 'bar-4', position: 12, label: '4'},
      ],
      loop: {start: 5, end: 9},
      regions: [
        ...binding.state.regions,
        {id: 'cue', label: 'Cue', start: 9},
        {id: 'cue', label: 'Duplicate ignored', start: 10},
      ],
    };
    const handle = mountTimeline(host, binding);
    const tick = handle.ruler.querySelector('[data-tick-id="beat-9"]');
    const region = handle.regionElement('verse');
    const marker = handle.regionElement('cue');

    expect(handle.ruler.querySelectorAll('[part~="tick"]')).toHaveLength(3);
    expect(tick?.getAttribute('data-level')).toBe('minor');
    expect(marker?.getAttribute('part')).toContain('marker');
    expect(marker?.style.width).toContain('--wm-timeline-marker-width');
    expect(handle.lane.querySelector<HTMLElement>('[part="loop"]')?.style.left).toBe('12.5%');

    binding.state = {...binding.state, playhead: 9};
    handle.update();
    expect(handle.ruler.querySelector('[data-tick-id="beat-9"]')).toBe(tick);
    expect(handle.regionElement('verse')).toBe(region);

    binding.state = {...binding.state, playhead: 15};
    handle.update();
    expect(handle.lane.querySelector('[part="playhead"]')).toBeNull();
    expect(handle.seek.value).toBe('12');
  });

  it('supports a read-only timeline and contains binding failures', async () => {
    const host = document.createElement('div');
    const error = new Error('seek failed');
    const onError = vi.fn(() => {
      throw new Error('reporter failed');
    });
    const readOnly: TimelineBinding = {
      snapshot: () => ({duration: 4, playhead: 1, regions: []}),
    };
    const readOnlyHandle = mountTimeline(host, readOnly);
    expect(readOnlyHandle.seek.hidden).toBe(true);
    expect(readOnlyHandle.seek.disabled).toBe(true);

    const failing: TimelineBinding = {
      snapshot: () => ({duration: 4, playhead: 1, regions: []}),
      seek: () => Promise.reject(error),
    };
    const handle = mountTimeline(host, failing, {onError});
    vi.spyOn(handle.lane, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      right: 100,
      top: 0,
      bottom: 20,
      width: 100,
      height: 20,
      toJSON: () => ({}),
    });
    handle.lane.dispatchEvent(new MouseEvent('click', {clientX: 50}));
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);
  });
});

describe('timeline ruler label layout', () => {
  function measuredRuler() {
    let resize = (): void => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe(): void {}
      disconnect = disconnect;
    });
    const binding = new FakeTimeline();
    binding.state = {
      duration: 100,
      playhead: 42,
      ticks: Array.from({length: 21}, (_, index) => ({id: `tick-${index}`, position: index * 5, label: `Measure ${index + 1}`})),
      regions: [{id: 'long', start: 0, end: 100, label: 'Complete region label'}],
    };
    const snapshot = vi.spyOn(binding, 'snapshot');
    const host = document.createElement('div');
    document.body.append(host);
    const handle = mountTimeline(host, binding, {formatPosition: (position) => `${position} complete units`});
    let width = 200;
    let labelWidth = 64;
    const readWidth = vi.fn(() => width);
    Object.defineProperty(handle.ruler, 'clientWidth', {get: readWidth});
    const labels = [...handle.ruler.querySelectorAll<HTMLElement>('[part="tick-label"]')];
    const measures = labels.map((label) => vi.spyOn(label, 'getBoundingClientRect').mockImplementation(() => ({width: labelWidth}) as DOMRect));
    const visible = () => labels.filter((label) => label.style.visibility === 'visible');
    const checkBounds = () => {
      const intervals = visible().map((label) => {
        const tick = label.parentElement!;
        const left = parseFloat(tick.style.left) / 100 * width + parseFloat(label.style.left);
        return {left, right: left + labelWidth};
      }).sort((a, b) => a.left - b.left);
      intervals.forEach((interval, index) => {
        expect(interval.left).toBeGreaterThanOrEqual(0);
        expect(interval.right).toBeLessThanOrEqual(width);
        if (index > 0) expect(interval.left).toBeGreaterThan(intervals[index - 1]!.right);
      });
    };
    return {binding, snapshot, handle, labels, measures, readWidth, visible, checkBounds, resize, disconnect,
      width: (value: number) => {width = value;}, labelWidth: (value: number) => {labelWidth = value;}};
  }

  it('thins labels without losing ticks or full descriptions and restores density after resize', () => {
    const test = measuredRuler();
    const region = test.handle.regionElement('long');
    const snapshots = test.snapshot.mock.calls.length;
    test.resize();
    const narrow = test.visible().length;
    expect(narrow).toBeGreaterThan(1);
    expect(narrow).toBeLessThan(test.labels.length);
    expect(test.labels[0]!.style.visibility).toBe('visible');
    expect(test.labels[test.labels.length - 1]!.style.visibility).toBe('visible');
    test.checkBounds();
    expect(test.handle.ruler.querySelectorAll('[part="tick"]')).toHaveLength(21);
    expect(test.labels.map((label) => label.textContent)).toEqual(test.binding.state.ticks!.map((tick) => tick.label));
    expect(test.labels[10]!.parentElement!.title).toBe('Measure 11');
    expect(region?.getAttribute('aria-label')).toBe('Complete region label');
    expect(test.handle.seek.getAttribute('aria-valuetext')).toBe('42 complete units');
    test.width(800);
    test.resize();
    expect(test.visible().length).toBeGreaterThan(narrow);
    test.checkBounds();
    expect(test.snapshot).toHaveBeenCalledTimes(snapshots);
    expect(test.handle.regionElement('long')).toBe(region);
    const wide = test.visible().length;
    test.labelWidth(130);
    test.resize();
    expect(test.visible().length).toBeLessThan(wide);
    test.checkBounds();
    const reads = test.measures.map((measure) => measure.mock.calls.length);
    test.handle.destroy();
    expect(test.disconnect).toHaveBeenCalledOnce();
    test.resize();
    expect(test.measures.map((measure) => measure.mock.calls.length)).toEqual(reads);
    vi.unstubAllGlobals();
    test.handle.element.parentElement?.remove();
  });

  it('does not measure ruler labels on ordinary playhead updates', () => {
    const test = measuredRuler();
    test.resize();
    const widths = test.readWidth.mock.calls.length;
    const labels = test.measures.map((measure) => measure.mock.calls.length);
    test.binding.state = {...test.binding.state, playhead: 60};
    test.handle.update();
    expect(test.readWidth).toHaveBeenCalledTimes(widths);
    expect(test.measures.map((measure) => measure.mock.calls.length)).toEqual(labels);
    test.width(20);
    test.resize();
    expect(test.visible()).toHaveLength(0);
    test.width(200);
    test.resize();
    expect(test.visible().length).toBeGreaterThan(0);
    test.handle.destroy();
    vi.unstubAllGlobals();
  });

  it('prioritizes major labels over nearby minor labels and supports the resize fallback', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const host = document.createElement('div');
    const handle = mountTimeline(host, {snapshot: () => ({duration: 100, regions: [], ticks: [
      {id: 'minor-start', position: 0, label: 'near cue', level: 'minor'},
      {id: 'major-start', position: 5, label: 'Cue', level: 'major'},
      {id: 'minor-end', position: 96, label: 'near end', level: 'minor'},
      {id: 'major-end', position: 100, label: 'End', level: 'major'},
    ]})});
    Object.defineProperty(handle.ruler, 'clientWidth', {value: 200});
    for (const label of handle.ruler.querySelectorAll<HTMLElement>('[part="tick-label"]')) {
      vi.spyOn(label, 'getBoundingClientRect').mockReturnValue({width: 60} as DOMRect);
    }
    window.dispatchEvent(new Event('resize'));
    expect(handle.ruler.querySelector('[data-tick-id="major-start"]')?.getAttribute('data-label-visible')).toBe('true');
    expect(handle.ruler.querySelector('[data-tick-id="major-end"]')?.getAttribute('data-label-visible')).toBe('true');
    expect(handle.ruler.querySelector('[data-tick-id="minor-start"]')?.getAttribute('data-label-visible')).toBe('false');
    expect(handle.ruler.querySelector('[data-tick-id="minor-end"]')?.getAttribute('data-label-visible')).toBe('false');
    const remove = vi.spyOn(window, 'removeEventListener');
    handle.destroy();
    expect(remove.mock.calls.some(([event]) => event === 'resize')).toBe(true);
    vi.unstubAllGlobals();
  });
});

it('keeps tiny ranged-region hit boxes proportional while retaining point-marker minimums', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mountTimeline(host, {
    snapshot: () => ({duration: 100, regions: [
      {id: 'small', start: 0, end: 0.1, label: 'A complete tiny region name'},
      {id: 'next', start: 0.1, end: 0.2, label: 'Its adjacent region'},
      {id: 'marker', start: 40, label: 'A point marker'},
    ]}),
    selectRegion: vi.fn(),
  });
  const small = handle.regionElement('small')!;
  const next = handle.regionElement('next')!;
  const marker = handle.regionElement('marker')!;
  expect(small.style.width).toBe('0.1%');
  expect(next.style.left).toBe('0.1%');
  for (const region of [small, next]) {
    const style = getComputedStyle(region);
    expect(style.minWidth).toBe('0px');
    expect(style.padding).toBe('0px');
    expect(style.borderWidth).toBe('0px');
    expect(style.boxSizing).toBe('border-box');
    expect(style.overflow).toBe('hidden');
  }
  expect(small.getAttribute('aria-label')).toBe('A complete tiny region name');
  expect(getComputedStyle(marker).minWidth).toBe('2px');
  expect(timelineStyle).toContain('outline: 1px solid CanvasText');
  expect(timelineStyle).toContain('outline-offset: -1px');
  handle.destroy();
});
