// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import type {ScoreNoteSequence} from '../../src/view/core/types';
import {ScoreViewElement} from '../../src/view/element/score-view';
import {WaterfallSVGVisualizer} from '../../src/view/render/renderers/waterfall';

const failures = vi.hoisted(() => ({render: false, load: vi.fn()}));
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: failures.load}));
vi.mock('../../src/view/render/score-visualizer', async (original) => {
  const actual = await original<typeof import('../../src/view/render/score-visualizer')>();
  return {...actual, renderScoreVisualizer: (...args: Parameters<typeof actual.renderScoreVisualizer>) => {
    if (failures.render) throw new Error('Drawing unavailable');
    return actual.renderScoreVisualizer(...args);
  }};
});
customElements.define('responsive-score-view', ScoreViewElement);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

class Observer {
  static instances: Observer[] = [];
  readonly disconnect = vi.fn();
  target?: Element;
  constructor(readonly notify: () => void) { Observer.instances.push(this); }
  observe(target: Element) { this.target = target; }
  unobserve() {}
}

function sequence(): ScoreNoteSequence {
  return {
    notes: [60, 61, 64].map((pitch) => ({pitch, velocity: 100, startTime: 0, endTime: 1})),
    ticksPerQuarter: 220, tempos: [{time: 0, qpm: 120}],
    timeSignatures: [], keySignatures: [], partInfos: [], totalTime: 12,
  };
}

function container(width = 280, height = 200) {
  const element = document.createElement('div');
  const size = {width, height};
  Object.defineProperties(element, {
    clientWidth: {get: () => size.width}, clientHeight: {get: () => size.height},
  });
  element.getBoundingClientRect = () => ({...size, x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height, toJSON() { return {}; }});
  document.body.append(element);
  return {element, size, resize: () => Observer.instances.filter((observer) => observer.target === element).forEach((observer) => observer.notify())};
}

function music(pitches = ['C4', 'C#4', 'E4']) {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Piano'});
  for (const pitch of pitches) builder.addNote(part, {
    id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: Rational.ZERO,
    duration: Duration.whole(), voice: VoiceId('piano'),
  });
  return builder.build();
}

beforeEach(() => {
  Observer.instances = [];
  vi.stubGlobal('ResizeObserver', Observer);
});
afterEach(() => {
  document.body.replaceChildren();
  failures.render = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('responsive waterfall renderer', () => {
  it('keeps pitch columns, sounding chord and score position through resize and hidden recovery', () => {
    const host = container();
    const score = sequence();
    const visualizer = new WaterfallSVGVisualizer(score, host.element, {
      fitToWidth: true, showOnlyOctavesUsed: true,
    });
    const viewport = host.element.firstElementChild as HTMLElement;
    const notes = () => host.element.querySelectorAll<SVGRectElement>('.waterfall-notes [data-index]');
    const activePitches = () => [...host.element.querySelectorAll<SVGRectElement>('.note.active')].map((note) => Number(note.dataset.pitch));
    visualizer.redraw(score.notes[0], false);
    viewport.scrollTop = 140;
    expect(activePitches()).toEqual([60, 61, 64]);
    expect(notes()[0].getAttribute('width')).toBe('40');
    host.size.width = 420;
    host.size.height = 320;
    host.resize();
    expect(host.element.querySelector('svg')?.getAttribute('width')).toBe('420');
    expect(activePitches()).toEqual([60, 61, 64]);
    expect(viewport.scrollTop).toBe(140);
    expect(viewport.style.height).toBe('320px');
    expect(notes()[0].getAttribute('x')).toBe('0');
    expect(notes()[0].getAttribute('width')).toBe('60');
    expect(Number(notes()[1].getAttribute('x'))).toBeCloseTo(41.4);
    expect(Number(notes()[1].getAttribute('width'))).toBeCloseTo(37.2);
    expect(notes()[2].getAttribute('x')).toBe('120');
    expect(host.element.querySelector('.waterfall-piano, [data-midi], button, input')).toBeNull();
    expect(host.element.children).toHaveLength(1);
    const visibleNotes = notes();
    host.size.width = 0;
    host.size.height = 0;
    host.resize();
    expect(notes()[0]).toBe(visibleNotes[0]);
    visualizer.clearActiveNotes();
    host.size.width = 350;
    host.size.height = 180;
    host.resize();
    expect(activePitches()).toEqual([]);
    expect(viewport.scrollTop).toBe(140);
    visualizer.dispose();
    expect(host.element.children).toHaveLength(0);
    expect(Observer.instances.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true);
    expect(() => host.resize()).not.toThrow();
    expect(() => visualizer.dispose()).not.toThrow();
  });

  it('preserves renderer defaults and explicit pitch widths across container changes', () => {
    const host = container();
    const legacy = new WaterfallSVGVisualizer(sequence(), host.element);
    expect(host.element.querySelectorAll('rect')).toHaveLength(3);
    expect(host.element.querySelector('.waterfall-notes')?.getAttribute('width')).toBe('1040');
    legacy.dispose();
    const manual = new WaterfallSVGVisualizer(sequence(), host.element, {
      fitToWidth: true, showOnlyOctavesUsed: true, whiteNoteWidth: 32,
    });
    expect(host.element.querySelector('.waterfall-notes')?.getAttribute('width')).toBe('224');
    host.size.width = 500;
    host.resize();
    expect(host.element.querySelector('.waterfall-notes')?.getAttribute('width')).toBe('224');
    manual.dispose();
  });

  it.each([true, false])('keeps explicit endpoints exact with occupied-octave mode %s', (showOnlyOctavesUsed) => {
    const host = container(320);
    const source = {...sequence(), notes: [52, 53, 54, 65, 66, 67].map((pitch) => ({pitch, startTime: 0, endTime: 1}))};
    const visualizer = new WaterfallSVGVisualizer(source, host.element, {
      fitToWidth: true, showOnlyOctavesUsed, minPitch: 53, maxPitch: 66, whiteNoteWidth: 32,
    });
    const note = (pitch: number) => host.element.querySelector<SVGRectElement>(`rect[data-pitch="${pitch}"]`);
    expect(note(52)).toBeNull();
    expect(note(67)).toBeNull();
    // F3–F#4 includes eight white keys and a trailing half-white reserve.
    expect(host.element.querySelector('svg')?.getAttribute('width')).toBe('272');
    expect(Number(note(53)!.getAttribute('x'))).toBe(0);
    expect(Number(note(54)!.getAttribute('x'))).toBeCloseTo(32 - 19.84 / 2);
    expect(Number(note(66)!.getAttribute('x'))).toBeCloseTo(256 - 19.84 / 2);
    host.size.width = 600;
    host.resize();
    expect(host.element.querySelector('svg')?.getAttribute('width')).toBe('272');
    visualizer.dispose();
  });

  it('preserves a fractional board width without rounding into horizontal overflow', () => {
    const host = container(267.75);
    const visualizer = new WaterfallSVGVisualizer(sequence(), host.element, {
      minPitch: 53, maxPitch: 66, whiteNoteWidth: 31.5, blackNoteWidth: 19.53,
    });
    const svg = host.element.querySelector<SVGSVGElement>('svg')!;
    expect(Number(svg.getAttribute('width'))).toBe(267.75);
    expect(svg.style.width).toBe('267.75px');
    expect((host.element.firstElementChild as HTMLElement).style.width).toBe('267.75px');
    visualizer.dispose();
  });

  it('reserves both endpoint halves for a single raised pitch', () => {
    const host = container();
    const visualizer = new WaterfallSVGVisualizer(sequence(), host.element, {
      minPitch: 61, maxPitch: 61, whiteNoteWidth: 40, blackNoteWidth: 25,
    });
    expect(host.element.querySelectorAll('rect')).toHaveLength(1);
    const note = host.element.querySelector('rect')!;
    expect(note.getAttribute('x')).toBe('7.5');
    expect(note.getAttribute('width')).toBe('25');
    expect(host.element.querySelector('svg')?.getAttribute('width')).toBe('40');
    visualizer.dispose();
  });

  it('preserves a lone explicit bound and normalizes reversed and invalid values', () => {
    const host = container();
    const source = {...sequence(), notes: [0, 60, 61, 64, 127].map((pitch) => ({pitch, startTime: 0, endTime: 1}))};
    const first = new WaterfallSVGVisualizer(source, host.element, {showOnlyOctavesUsed: true, minPitch: 61});
    expect([...host.element.querySelectorAll('rect')].map((note) => Number(note.dataset.pitch))).toEqual([61, 64, 127]);
    first.dispose();
    const second = new WaterfallSVGVisualizer(sequence(), host.element, {showOnlyOctavesUsed: true, maxPitch: 61});
    expect([...host.element.querySelectorAll('rect')].map((note) => Number(note.dataset.pitch))).toEqual([60, 61]);
    second.dispose();
    const reversed = new WaterfallSVGVisualizer(sequence(), host.element, {minPitch: 64.4, maxPitch: 60.1});
    expect(host.element.querySelectorAll('rect')).toHaveLength(3);
    reversed.dispose();
    const clamped = new WaterfallSVGVisualizer(source, host.element, {minPitch: -100, maxPitch: 1000});
    expect(host.element.querySelectorAll('rect')).toHaveLength(5);
    clamped.dispose();
    const invalid = new WaterfallSVGVisualizer(sequence(), host.element, {
      minPitch: Number.NaN, maxPitch: Number.POSITIVE_INFINITY, whiteNoteWidth: -2, blackNoteWidth: Number.POSITIVE_INFINITY,
    });
    expect(host.element.querySelector('svg')?.getAttribute('width')).toBe('1040');
    expect(host.element.querySelector('[data-pitch="60"]')?.getAttribute('width')).toBe('20');
    expect(host.element.querySelector('[data-pitch="61"]')?.getAttribute('width')).toBe('12.4');
    invalid.dispose();
  });

  it('bounds an oversized accidental width to its natural column', () => {
    const host = container();
    const visualizer = new WaterfallSVGVisualizer(sequence(), host.element, {minPitch: 61, maxPitch: 61, whiteNoteWidth: 20, blackNoteWidth: 60});
    expect(host.element.querySelector('rect')?.getAttribute('x')).toBe('0');
    expect(host.element.querySelector('rect')?.getAttribute('width')).toBe('20');
    visualizer.dispose();
  });

  it('retains a queued rewind through forward ticks and cancels pending scroll after disposal', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    const host = container();
    const visualizer = new WaterfallSVGVisualizer(sequence(), host.element);
    const viewport = host.element.firstElementChild as HTMLElement;
    viewport.scrollTop = 360;
    const frame = () => { for (const callback of frames.splice(0)) callback(0); };
    visualizer.redrawAtTime(8);
    frame();
    expect(viewport.scrollTop).toBe(120);
    visualizer.clearActiveNotes(); // stop/end clears highlights before replay
    visualizer.redrawAtTime(0);
    visualizer.redrawAtTime(.1);
    frame();
    expect(viewport.scrollTop).toBe(357);
    visualizer.redrawAtTime(1);
    visualizer.dispose();
    frame();
    expect(viewport.scrollTop).toBe(357);
    expect(viewport.isConnected).toBe(false);
    expect(host.element.children).toHaveLength(0);
  });

  it('uses compact content height without reserving space for a keyboard', () => {
    const host = container(280, 0);
    const long = new WaterfallSVGVisualizer(sequence(), host.element);
    expect((host.element.firstElementChild as HTMLElement).style.height).toBe('200px');
    long.dispose();
    const short = new WaterfallSVGVisualizer({...sequence(), totalTime: 3}, host.element);
    expect((host.element.firstElementChild as HTMLElement).style.height).toBe('90px');
    short.dispose();
    expect(host.element.children).toHaveLength(0);
  });

  it('preserves an explicit accidental column width while responding to height changes', () => {
    const host = container();
    const visualizer = new WaterfallSVGVisualizer(sequence(), host.element, {
      fitToWidth: true, showOnlyOctavesUsed: true, blackNoteWidth: 9,
    });
    const width = () => host.element.querySelector('.waterfall-notes')?.getAttribute('width');
    const blackWidth = () => host.element.querySelector('.waterfall-notes [data-pitch="61"]')?.getAttribute('width');
    const viewport = host.element.firstElementChild as HTMLElement;
    expect(Number(width())).toBeCloseTo(7 * 9 / .62);
    expect(blackWidth()).toBe('9');
    viewport.scrollTop = 90;
    host.size.width = 500;
    host.size.height = 320;
    host.resize();
    expect(Number(width())).toBeCloseTo(7 * 9 / .62);
    expect(blackWidth()).toBe('9');
    expect(viewport.style.height).toBe('320px');
    expect(viewport.scrollTop).toBe(90);
    visualizer.dispose();
  });
});

describe('score-view presentation states', () => {
  it('mounts only falling notes and preserves theme highlighting when switching modes', async () => {
    const view = document.createElement('responsive-score-view') as ScoreViewElement;
    view.type = 'waterfall';
    view.score = music();
    document.body.append(view);
    await flush();
    const notes = view.querySelector('.waterfall-notes')!;
    expect(notes).not.toBeNull();
    expect(notes.querySelectorAll('[data-index]')).toHaveLength(3);
    expect(view.querySelector('.waterfall-piano, [data-midi], button, input')).toBeNull();
    view.type = 'piano-roll';
    expect(notes.isConnected).toBe(false);
    // Theme colors stay live in SVG. The specific token precedes the shared
    // accent and red default; an explicit attribute still overrides the theme.
    const activeFill = view.querySelector('[data-index="0"]')?.getAttribute('fill');
    expect(activeFill).toContain('var(--wm-score-view-active-note, var(--wm-accent, rgb(240, 84, 119)))');
    expect(activeFill).toContain('--wm-accent');
    view.setAttribute('active-note-color', '#ff0000');
    expect(view.querySelector('[data-index="0"]')?.getAttribute('fill')).toContain('255, 0, 0');
    expect(view.querySelector('[data-index="0"]')?.getAttribute('fill')).not.toContain('--wm-accent');
  });

  it('keeps the full MIDI range without adding a keyboard', async () => {
    const view = document.createElement('responsive-score-view') as ScoreViewElement;
    view.type = 'waterfall';
    view.score = music(['C-1', 'G9']);
    document.body.append(view);
    await flush();
    expect(view.querySelector('[aria-label="Waterfall piano keys"]')).toBeNull();
    expect(view.querySelector('.waterfall-piano, [data-midi]')).toBeNull();
    expect(view.querySelectorAll('.waterfall-notes [data-index]')).toHaveLength(2);
  });

  it('shows accessible waiting, empty and load/render failure states and recovers with fresh content', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = document.createElement('responsive-score-view') as ScoreViewElement;
    document.body.append(view);
    await flush();
    expect(view.querySelector('[role="status"]')?.textContent).toBe('Waiting for a score');
    view.score = music([]);
    await flush();
    expect(view.querySelector('[role="status"]')?.textContent).toBe('No notes to display');
    failures.render = true;
    view.score = music();
    await flush();
    expect(view.querySelector('[role="alert"]')?.textContent).toBe('Drawing unavailable');
    failures.render = false;
    view.score = undefined;
    failures.load.mockRejectedValueOnce(new Error('Source unavailable'));
    view.setAttribute('src', 'failed.mid');
    await vi.waitFor(() => expect(view.querySelector('[role="alert"]')?.textContent).toBe('Source unavailable'));
    view.score = music();
    await flush();
    expect(view.querySelector('[role="alert"], [role="status"]')).toBeNull();
    expect(view.querySelector('[data-index="0"]')).not.toBeNull();
    expect(report).toHaveBeenCalled();
  });
});
