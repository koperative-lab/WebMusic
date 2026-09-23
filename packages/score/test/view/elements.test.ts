import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import type {RenderedScoreVisualizer, ScoreNoteSequence} from '../../src/view/core/types';
import {numAttr} from '../../src/view/element/base';
import {installStubGlobals, type StubGlobals} from './stub-dom';

interface LoadRequest {
  url: string;
  signal: AbortSignal;
  resolve(score: Score): void;
}

const loadState = vi.hoisted(() => ({requests: [] as LoadRequest[]}));

vi.mock('../../src/io/load', () => ({
  loadScoreFromUrl: vi.fn((url: string, options: {signal?: AbortSignal} = {}) => {
    const signal = options.signal;
    if (!signal) throw new Error('<score-view> did not pass an AbortSignal');
    let resolvePromise!: (score: Score) => void;
    let rejectPromise!: (reason: unknown) => void;
    const promise = new Promise<Score>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const abort = () => rejectPromise(new Error('aborted'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, {once: true});
    loadState.requests.push({url, signal, resolve: resolvePromise});
    return promise;
  }),
}));

// The element module delegates drawing to renderers/factory — replace the
// renderers with recorders so the dispatch (and dispose) logic can be tested
// without real SVG/DOM rendering.
vi.mock('../../src/view/render/renderers/factory', () => {
  const makeSequence = (): ScoreNoteSequence => ({
    ticksPerQuarter: 220,
    tempos: [{time: 0, qpm: 120}],
    timeSignatures: [],
    keySignatures: [],
    partInfos: [],
    notes: [{pitch: 60, startTime: 0, endTime: 0.5}],
    totalTime: 0.5,
  });
  const makeRenderer = () =>
    vi.fn((..._args: unknown[]): RenderedScoreVisualizer => ({
      noteSequence: makeSequence(),
      visualizer: {},
      redraw: vi.fn(() => null),
      clearActiveNotes: vi.fn(),
      dispose: vi.fn(),
    }));
  return {
    renderPianoRollVisualizer: makeRenderer(),
    renderStaffVisualizer: makeRenderer(),
    renderWaterfallVisualizer: makeRenderer(),
  };
});

import {ScoreViewElement, defineScoreViewElement, parseColorAttr} from '../../src/view/element/index';
import {
  renderPianoRollVisualizer,
  renderStaffVisualizer,
  renderWaterfallVisualizer,
} from '../../src/view/render/renderers/factory';

const pianoRollMock = vi.mocked(renderPianoRollVisualizer);
const staffMock = vi.mocked(renderStaffVisualizer);
const waterfallMock = vi.mocked(renderWaterfallVisualizer);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakeScore = (() => {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Test'});
  builder.addNote(part, {
    id: builder.newNoteId(),
    pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO,
    duration: Duration.quarter(),
    voice: VoiceId(`${part}-v1`),
  });
  return builder.build();
})();

interface Host {
  el: ScoreViewElement & Record<string, unknown>;
  children: unknown[];
  setAttribute(name: string, value: string): void;
  connect(): void;
  disconnect(): void;
}

/**
 * `ScoreViewElement` extends an empty class in Node (SSR-safe base), so the
 * DOM surface it uses (attributes, children, getRootNode) is grafted onto the
 * instance here — exactly the surface a real HTMLElement would provide.
 */
function createHost(attrs: Record<string, string> = {}, root?: {querySelector(sel: string): unknown}): Host {
  const el = new ScoreViewElement() as ScoreViewElement & Record<string, unknown>;
  const attributes: Record<string, string> = {...attrs};
  const children: unknown[] = [];
  // The DOM lib declares these readonly or with Node-generic signatures; view
  // them as the writable stub surface grafted onto the SSR-safe base.
  const surface = el as unknown as {
    isConnected: boolean;
    appendChild(child: unknown): unknown;
    getRootNode(): {querySelector(sel: string): unknown};
  };
  surface.isConnected = true;
  el.getAttribute = (name: string) => attributes[name] ?? null;
  el.dispatchEvent = () => true;
  el.setAttribute = (name: string, value: string) => {
    attributes[name] = value;
    (el as unknown as {attributeChangedCallback(name: string): void}).attributeChangedCallback(name);
  };
  el.replaceChildren = () => {
    children.length = 0;
  };
  surface.appendChild = (child: unknown) => {
    children.push(child);
    return child;
  };
  surface.getRootNode = () => root ?? {querySelector: () => null};
  return {
    el,
    children,
    setAttribute: (name, value) => el.setAttribute(name, value),
    connect: () => (el as unknown as {connectedCallback(): void}).connectedCallback(),
    disconnect: () => {
      (el as unknown as {disconnectedCallback(): void}).disconnectedCallback();
      surface.isConnected = false;
    },
  };
}

describe('elements module (SSR safety)', () => {
  it('configures a mode atomically and preserves it after invalid input', () => {
    const host = createHost({type: 'piano-roll'});
    host.disconnect();
    host.el.configure({type: 'waterfall', options: {whiteNoteWidth: 24}});
    expect(host.el.type).toBe('waterfall');
    expect(host.el.options).toEqual({whiteNoteWidth: 24});
    // @ts-expect-error A JavaScript caller can still supply an incompatible key.
    expect(() => host.el.configure({
      type: 'staff',
      options: {whiteNoteWidth: 12},
    })).toThrow(/whiteNoteWidth/);
    expect(host.el.type).toBe('waterfall');
    expect(host.el.options).toEqual({whiteNoteWidth: 24});
    host.el.configure({type: 'staff'});
    expect(host.el.options).toBeUndefined();
  });

  it('imports and constructs in Node without document/customElements', () => {
    expect(typeof ScoreViewElement).toBe('function');
    expect(() => new ScoreViewElement()).not.toThrow();
  });

  it('defineScoreViewElement is a no-op without customElements', () => {
    expect((globalThis as Record<string, unknown>).customElements).toBeUndefined();
    expect(() => defineScoreViewElement()).not.toThrow();
  });
});

describe('defineScoreViewElement', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).customElements;
  });

  it('registers once and is idempotent', () => {
    const registry = new Map<string, CustomElementConstructor>();
    const define = vi.fn((tag: string, ctor: CustomElementConstructor) => registry.set(tag, ctor));
    (globalThis as Record<string, unknown>).customElements = {
      get: (tag: string) => registry.get(tag),
      define,
    };

    defineScoreViewElement();
    defineScoreViewElement();
    expect(define).toHaveBeenCalledTimes(1);
    expect(registry.get('score-view')).toBe(ScoreViewElement);

    defineScoreViewElement('my-score-view');
    expect(registry.get('my-score-view')).toBe(ScoreViewElement);
  });
});

describe('<score-view> type dispatch', () => {
  let globals: StubGlobals;

  beforeEach(() => {
    globals = installStubGlobals();
    pianoRollMock.mockClear();
    staffMock.mockClear();
    waterfallMock.mockClear();
  });

  afterEach(() => {
    globals.restore();
  });

  it('defaults to piano-roll and renders into an appended <svg>', async () => {
    const host = createHost();
    host.el.score = fakeScore;
    host.connect();
    await flush();

    expect(pianoRollMock).toHaveBeenCalledTimes(1);
    expect(staffMock).not.toHaveBeenCalled();
    expect(waterfallMock).not.toHaveBeenCalled();
    expect(host.children).toHaveLength(1);
    expect((host.children[0] as {tagName: string}).tagName).toBe('SVG');
    expect(pianoRollMock.mock.calls[0][0]).toBe(fakeScore);
  });

  it('type="staff" renders into a scrollable <div>', async () => {
    const host = createHost({type: 'staff'});
    host.el.score = fakeScore;
    host.connect();
    await flush();

    expect(staffMock).toHaveBeenCalledTimes(1);
    expect(pianoRollMock).not.toHaveBeenCalled();
    const container = host.children[0] as {tagName: string; style: {props: Record<string, string | null>}};
    expect(container.tagName).toBe('DIV');
  });

  it('type="waterfall" renders into a <div>', async () => {
    const host = createHost({type: 'waterfall'});
    host.el.score = fakeScore;
    host.connect();
    await flush();
    expect(waterfallMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to piano-roll for unknown type values', async () => {
    const host = createHost({type: 'bogus'});
    host.el.score = fakeScore;
    host.connect();
    await flush();
    expect(host.el.type).toBe('piano-roll');
    expect(pianoRollMock).toHaveBeenCalledTimes(1);
  });

  it('switching type at runtime disposes the old visualizer and re-renders', async () => {
    const host = createHost();
    host.el.score = fakeScore;
    host.connect();
    await flush();
    expect(pianoRollMock).toHaveBeenCalledTimes(1);
    const firstRendered = pianoRollMock.mock.results[0].value as RenderedScoreVisualizer;

    host.setAttribute('type', 'waterfall');
    await flush();

    expect(firstRendered.dispose).toHaveBeenCalled();
    expect(waterfallMock).toHaveBeenCalledTimes(1);
    expect(host.children).toHaveLength(1); // old child replaced
    expect(host.el.type).toBe('waterfall');
  });

  it('disconnectedCallback disposes the rendered visualizer', async () => {
    const host = createHost();
    host.el.score = fakeScore;
    host.connect();
    await flush();
    const rendered = pianoRollMock.mock.results[0].value as RenderedScoreVisualizer;
    (host.el as unknown as {disconnectedCallback(): void}).disconnectedCallback();
    expect(rendered.dispose).toHaveBeenCalled();
  });

  it('renders nothing without a score or src', async () => {
    const host = createHost();
    host.connect();
    await flush();
    expect(pianoRollMock).not.toHaveBeenCalled();
    expect(host.children).toHaveLength(0);
  });
});

describe('<score-view> URL cancellation', () => {
  let globals: StubGlobals;

  beforeEach(() => {
    globals = installStubGlobals();
    loadState.requests.length = 0;
    pianoRollMock.mockClear();
    staffMock.mockClear();
    waterfallMock.mockClear();
  });

  afterEach(() => {
    globals.restore();
    loadState.requests.length = 0;
    vi.restoreAllMocks();
  });

  it('aborts a superseded src and renders only the newest result without logging cancellation', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const host = createHost({src: 'first.mid'});
    host.connect();
    await vi.waitFor(() => expect(loadState.requests).toHaveLength(1));

    host.setAttribute('src', 'second.mid');
    await vi.waitFor(() => expect(loadState.requests).toHaveLength(2));
    expect(loadState.requests[0]!.signal.aborted).toBe(true);

    const newestScore = fakeScore;
    loadState.requests[1]!.resolve(newestScore);
    await flush();

    expect(pianoRollMock).toHaveBeenCalledTimes(1);
    expect(pianoRollMock.mock.calls[0]![0]).toBe(newestScore);
    expect(reported).not.toHaveBeenCalled();
    host.disconnect();
  });

  it('keeps a pending source through type switches and aborts source replacement or disconnect', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const host = createHost({src: 'score.mid'});
    host.connect();
    await vi.waitFor(() => expect(loadState.requests).toHaveLength(1));

    host.setAttribute('type', 'staff');
    await flush();
    expect(loadState.requests).toHaveLength(1);
    expect(loadState.requests[0]!.signal.aborted).toBe(false);

    host.setAttribute('src', 'replacement.mid');
    await vi.waitFor(() => expect(loadState.requests).toHaveLength(2));
    expect(loadState.requests[0]!.signal.aborted).toBe(true);

    host.disconnect();
    expect(loadState.requests[1]!.signal.aborted).toBe(true);
    await flush();

    expect(pianoRollMock).not.toHaveBeenCalled();
    expect(staffMock).not.toHaveBeenCalled();
    expect(reported).not.toHaveBeenCalled();
  });
});

describe('<score-view> attribute options (NaN-safe)', () => {
  let globals: StubGlobals;

  beforeEach(() => {
    globals = installStubGlobals();
    pianoRollMock.mockClear();
  });

  afterEach(() => {
    globals.restore();
  });

  it('forwards numeric attributes and drops non-numeric ones', async () => {
    const host = createHost({
      'pixels-per-second': 'abc', // NaN → dropped, not forwarded
      'note-height': '12',
      'min-pitch': '',
    });
    host.el.score = fakeScore;
    host.connect();
    await flush();

    const options = pianoRollMock.mock.calls[0][2] as Record<string, unknown>;
    expect(options.noteHeight).toBe(12);
    expect('pixelsPerSecond' in options).toBe(false);
    expect('minPitch' in options).toBe(false);
  });

  it('the .options property wins over attributes', async () => {
    const host = createHost({'note-height': '12'});
    host.el.score = fakeScore;
    host.el.options = {noteHeight: 20, pixelsPerSecond: 50};
    host.connect();
    await flush();

    const options = pianoRollMock.mock.calls[0][2] as Record<string, unknown>;
    expect(options.noteHeight).toBe(20);
    expect(options.pixelsPerSecond).toBe(50);
  });

  it('forwards annotation visibility and lets options override the attribute', async () => {
    const host = createHost({'show-annotations': 'false'});
    host.el.score = fakeScore;
    host.connect();
    await flush();
    expect(pianoRollMock.mock.lastCall?.[2]).toMatchObject({showAnnotations: false});
    const previous = pianoRollMock.mock.results.at(-1)!.value;
    host.el.options = {showAnnotations: true};
    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(pianoRollMock.mock.lastCall?.[2]).toMatchObject({showAnnotations: true});
    host.el.options = undefined;
    expect(pianoRollMock.mock.lastCall?.[2]).toMatchObject({showAnnotations: false});
    host.disconnect();
  });
});

describe('<score-view> player linking', () => {
  let globals: StubGlobals;

  beforeEach(() => {
    globals = installStubGlobals();
    pianoRollMock.mockClear();
  });

  afterEach(() => {
    globals.restore();
  });

  function stubPlayer() {
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    return {
      addEventListener(type: string, listener: (event: unknown) => void) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener(type: string, listener: (event: unknown) => void) {
        listeners.get(type)?.delete(listener);
      },
      dispatch(type: string, detail?: unknown) {
        listeners.get(type)?.forEach((listener) => listener({type, detail}));
      },
      count(type: string): number {
        return listeners.get(type)?.size ?? 0;
      },
    };
  }

  it('listens to webscore:noteon / webscore:end on the player target', async () => {
    const player = stubPlayer();
    const host = createHost({player: '#p'}, {querySelector: (sel) => (sel === '#p' ? player : null)});
    host.el.score = fakeScore;
    host.connect();
    await flush();

    const rendered = pianoRollMock.mock.results[0].value as RenderedScoreVisualizer;
    expect(player.count('webscore:noteon')).toBe(1);
    expect(player.count('webscore:end')).toBe(1);

    player.dispatch('webscore:noteon', {midi: 60, startTime: 0});
    const controller = (host.el as unknown as {view: {state: {activeNotes: unknown[]}}}).view;
    expect(controller.state.activeNotes).toHaveLength(1);
    expect(rendered.redraw).toHaveBeenCalledWith(
      expect.objectContaining({pitch: 60, startTime: 0}),
      true,
    );

    player.dispatch('webscore:end');
    expect(rendered.clearActiveNotes).toHaveBeenCalled();

    (host.el as unknown as {disconnectedCallback(): void}).disconnectedCallback();
    expect(player.count('webscore:noteon')).toBe(0);
    expect(player.count('webscore:end')).toBe(0);
  });
});

describe('<score-view> customization attributes', () => {
  let globals: StubGlobals;

  beforeEach(() => {
    globals = installStubGlobals();
    pianoRollMock.mockClear();
    staffMock.mockClear();
    waterfallMock.mockClear();
  });

  afterEach(() => {
    globals.restore();
  });

  it('forwards waterfall pitch columns and ignores removed keyboard-only attributes', async () => {
    const host = createHost({
      type: 'waterfall',
      'white-note-width': '26',
      'white-note-height': '80',
      'black-note-width': '15',
      'black-note-height': '52',
      'min-pitch': '48',
      'max-pitch': '84',
      'show-only-octaves-used': '',
    });
    host.el.score = fakeScore;
    host.connect();
    await flush();

    const options = waterfallMock.mock.calls[0][2] as Record<string, unknown>;
    expect(options.whiteNoteWidth).toBe(26);
    expect(options).not.toHaveProperty('whiteNoteHeight');
    expect(options.blackNoteWidth).toBe(15);
    expect(options).not.toHaveProperty('blackNoteHeight');
    expect(options).not.toHaveProperty('keyboard');
    expect(options.minPitch).toBe(48);
    expect(options.maxPitch).toBe(84);
    expect(options.showOnlyOctavesUsed).toBe(true);
  });

  it('show-only-octaves-used reads false / 0 / no / off as false', async () => {
    const host = createHost({type: 'waterfall', 'show-only-octaves-used': 'false'});
    host.el.score = fakeScore;
    host.connect();
    await flush();
    const options = waterfallMock.mock.calls[0][2] as Record<string, unknown>;
    expect(options.showOnlyOctavesUsed).toBe(false);
  });

  it('forwards colour attributes as "r, g, b" strings', async () => {
    const host = createHost({
      'note-color': '#2563eb',
      'active-note-color': '240, 84, 119',
    });
    host.el.score = fakeScore;
    host.connect();
    await flush();

    const options = pianoRollMock.mock.calls[0][2] as Record<string, unknown>;
    expect(options.noteRGB).toBe('37, 99, 235');
    expect(options.activeNoteRGB).toBe('240, 84, 119');
  });

  it('falls back to the element skin when a colour is unparseable', async () => {
    const host = createHost({'note-color': 'bright-ish blue'});
    host.el.score = fakeScore;
    host.connect();
    await flush();
    const options = pianoRollMock.mock.calls[0][2] as Record<string, unknown>;
    expect(options.noteRGB).toBe('51, 51, 51');
    expect(options.activeNoteRGB).toBe('240, 84, 119');
  });

  it('forwards staff scroll-type and default-key', async () => {
    const host = createHost({type: 'staff', 'scroll-type': 'bar', 'default-key': '3'});
    host.el.score = fakeScore;
    host.connect();
    await flush();
    const options = staffMock.mock.calls[0][2] as Record<string, unknown>;
    expect(options.scrollType).toBe(2);
    expect(options.defaultKey).toBe(3);
  });

  it('ignores unknown scroll-type values', async () => {
    const host = createHost({type: 'staff', 'scroll-type': 'diagonal'});
    host.el.score = fakeScore;
    host.connect();
    await flush();
    const options = staffMock.mock.calls[0][2] as Record<string, unknown>;
    expect('scrollType' in options).toBe(false);
  });

  it('reflects width / height attributes onto the host box', async () => {
    const props: Record<string, string> = {};
    const removed: string[] = [];
    const host = createHost({width: '640', height: '18rem'});
    // The DOM lib types the `style` setter as cssText (string); the element
    // only calls setProperty/removeProperty, so graft that surface instead.
    (host.el as unknown as {style: unknown}).style = {
      setProperty: (name: string, value: string) => {
        props[name] = value;
      },
      removeProperty: (name: string) => {
        removed.push(name);
        delete props[name];
      },
    };
    host.el.score = fakeScore;
    host.connect();
    await flush();

    expect(props.width).toBe('640px'); // bare number → px
    expect(props.height).toBe('18rem'); // CSS length passes through
    expect(props['overflow-y']).toBe('auto');
  });

  it('.options wins over the customization attributes', async () => {
    const host = createHost({'note-color': '#000000', 'white-note-width': '26'});
    host.el.score = fakeScore;
    host.el.options = {noteRGB: '1, 2, 3'};
    host.connect();
    await flush();

    const options = pianoRollMock.mock.calls[0][2] as Record<string, unknown>;
    expect(options.noteRGB).toBe('1, 2, 3');
    expect(options.whiteNoteWidth).toBe(26);
  });
});

describe('parseColorAttr', () => {
  it('parses #rrggbb and #rgb hex', () => {
    expect(parseColorAttr('#2563eb')).toBe('37, 99, 235');
    expect(parseColorAttr('2563eb')).toBe('37, 99, 235');
    expect(parseColorAttr('#fff')).toBe('255, 255, 255');
  });

  it('parses rgb() and raw triples, clamping channels', () => {
    expect(parseColorAttr('rgb(240, 84, 119)')).toBe('240, 84, 119');
    expect(parseColorAttr('240,84,119')).toBe('240, 84, 119');
    expect(parseColorAttr('300, 0, 0')).toBe('255, 0, 0');
  });

  it('returns undefined for absent or unparseable values', () => {
    expect(parseColorAttr(null)).toBeUndefined();
    expect(parseColorAttr('')).toBeUndefined();
    expect(parseColorAttr('cornflower')).toBeUndefined();
    expect(parseColorAttr('#12345')).toBeUndefined();
  });
});

describe('numAttr', () => {
  function attrEl(value: string | null) {
    return {getAttribute: () => value} as unknown as Element;
  }

  it('falls back on missing, empty and non-numeric values', () => {
    expect(numAttr(attrEl(null), 'x', 7)).toBe(7);
    expect(numAttr(attrEl(''), 'x', 7)).toBe(7);
    expect(numAttr(attrEl('  '), 'x', 7)).toBe(7);
    expect(numAttr(attrEl('abc'), 'x', 7)).toBe(7);
    expect(numAttr(attrEl('NaN'), 'x', 7)).toBe(7);
    expect(numAttr(attrEl('Infinity'), 'x', 7)).toBe(7);
  });

  it('parses and clamps numeric values', () => {
    expect(numAttr(attrEl('42'), 'x', 7)).toBe(42);
    expect(numAttr(attrEl('-3'), 'x', 7, 0)).toBe(0);
    expect(numAttr(attrEl('99'), 'x', 7, 0, 50)).toBe(50);
  });
});
