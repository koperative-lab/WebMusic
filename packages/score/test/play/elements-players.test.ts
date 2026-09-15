// Node-safe tests for the consolidated player elements (<score-recorder>,
// ). Like the other element tests
// these run in plain Node — no happy-dom: the DOM surface each element touches
// (shadow root, createElement, attributes, listeners) is grafted onto the
// instances via lightweight stubs, mirroring packages/view/test/elements.test.ts.
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {transportStateStyle} from '@webmusic/ui/transport';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';

// Elements that resolve a `src` URL go through loadScoreFromUrl —
// replace it so they can be tested without fetch/network.
vi.mock('../../src/io/load', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/io/load')>();
  return {
    ...original,
    loadScoreFromUrl: vi.fn(async () => buildScore('Loaded')),
  };
});

import {RackControlElement, defineRackControlElement} from '../../src/play/element/rack-control';
import {RackPartElement} from '../../src/play/element/rack-part';
import {ScoreRecorderElement, defineScoreRecorderElement} from '../../src/play/element/score-recorder';
import {mountControllerPlayer, mountPresetPlayer, mountRackPlayer} from '../../src/play/element/internal/preset-player';
import {Effect, PlayerController, ScorePlayer, Sound, type Rack} from '../../src/play/headless';
import {loadScoreFromUrl} from '../../src/io/load';

// CustomEvent is global only from Node 19 — keep the suite Node-18 safe.
// Extend the native Event so instances pass EventTarget.dispatchEvent's
// `instanceof Event` check (a plain class is rejected with ERR_INVALID_ARG_TYPE).
if (typeof (globalThis as Record<string, unknown>).CustomEvent === 'undefined') {
  class NodeCustomEvent<T = unknown> extends Event {
    detail: T;
    constructor(type: string, init: {detail?: T; bubbles?: boolean; composed?: boolean} = {}) {
      super(type, {
        bubbles: init.bubbles ?? false,
        composed: init.composed ?? false,
      });
      this.detail = init.detail as T;
    }
  }
  (globalThis as Record<string, unknown>).CustomEvent = NodeCustomEvent;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// Score fixture: two quarter notes (C4, D4) in one 4/4 bar at 120bpm —
// transport duration is the full bar: 2.0s.
// ---------------------------------------------------------------------------
function buildScore(title = 'Two Notes', withPerformedTail = false): Score {
  const b = new ScoreBuilder();
  const part = PartId('p');
  const voice = VoiceId('v');
  const timeSignature = {numerator: 4, denominator: 4};
  b.setMetadata({title})
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  b.addPart({id: part, name: 'Part', staves: 1});
  b.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature,
  });
  for (const [i, name] of ['C4', 'D4'].entries()) {
    b.addNote(part, {
      id: b.newNoteId(),
      pitch: Pitch.parse(name),
      onsetQuarters: new Rational(i),
      duration: Duration.quarter(),
      ...(withPerformedTail && i === 0 ? {performed: {onsetSec: 0, durationSec: 3, velocity: 80}} : {}),
      voice,
    });
  }
  return b.build();
}

// ---------------------------------------------------------------------------
// DOM stubs
// ---------------------------------------------------------------------------
class StubStyle {
  props: Record<string, string | null> = {};
  display = '';
  setProperty(key: string, value: string | null): void {
    this.props[key] = value;
  }
}

class StubClassList {
  private names = new Set<string>();
  add(...names: string[]): void {
    names.forEach((n) => this.names.add(n));
  }
  remove(...names: string[]): void {
    names.forEach((n) => this.names.delete(n));
  }
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.names.has(name);
    if (on) this.names.add(name);
    else this.names.delete(name);
    return on;
  }
  contains(name: string): boolean {
    return this.names.has(name);
  }
  toString(): string {
    return [...this.names].join(' ');
  }
}

function stubClasses(node: StubNode): string {
  return [node.className, node.classList.toString()].filter(Boolean).join(' ');
}

class StubNode {
  tagName: string;
  className = '';
  children: StubNode[] = [];
  parentNode: StubNode | null = null;
  attrs: Record<string, string> = {};
  listeners: Record<string, Array<(event: unknown) => void>> = {};
  style = new StubStyle();
  classList = new StubClassList();
  dataset: Record<string, string> = {};
  value = '';
  textContent = '';
  disabled = false;
  tabIndex = -1;
  href = '';
  download = '';
  rect = {left: 0, width: 100};
  capturedPointers: number[] = [];
  focused = false;

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  get ownerDocument(): Document {
    return document;
  }

  get firstChild(): StubNode | null {
    return this.children[0] ?? null;
  }

  get childNodes(): StubNode[] {
    return this.children;
  }

  getBoundingClientRect(): DOMRect {
    return {
      ...this.rect,
      x: this.rect.left,
      y: 0,
      top: 0,
      right: this.rect.left + this.rect.width,
      bottom: 0,
      height: 0,
      toJSON: () => ({}),
    };
  }

  setPointerCapture(pointerId: number): void {
    this.capturedPointers.push(pointerId);
  }

  set innerHTML(_html: string) {
    this.children.forEach((c) => (c.parentNode = null));
    this.children = [];
  }

  appendChild(child: StubNode): StubNode {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...children: StubNode[]): void {
    children.forEach((child) => this.appendChild(child));
  }

  replaceChildren(...children: StubNode[]): void {
    this.children.forEach((child) => (child.parentNode = null));
    this.children = [];
    this.append(...children);
  }

  removeChild(child: StubNode): StubNode {
    const i = this.children.indexOf(child);
    if (i !== -1) {
      this.children.splice(i, 1);
      child.parentNode = null;
    }
    return child;
  }

  /**
   * Placing a node WITHOUT disturbing the ones already in place — which is how
   * the mixer keeps the strip under the pointer alive across an update. A
   * reference of `null` appends, as the real DOM does.
   */
  insertBefore(child: StubNode, reference: StubNode | null): StubNode {
    child.parentNode?.removeChild(child);
    const i = reference ? this.children.indexOf(reference) : -1;
    if (i === -1) this.children.push(child);
    else this.children.splice(i, 0, child);
    child.parentNode = this;
    return child;
  }

  get lastElementChild(): StubNode | null {
    return this.children[this.children.length - 1] ?? null;
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  click(): void {
    this.dispatch('click');
  }

  focus(): void {
    // The kit's slider focuses its element on pointerdown; nothing here reads
    // focus, so recording the call is enough.
    this.focused = true;
  }

  setAttribute(key: string, value: string): void {
    this.attrs[key] = String(value);
    if (key === 'class') this.className = String(value);
  }

  getAttribute(key: string): string | null {
    return this.attrs[key] ?? null;
  }

  hasAttribute(key: string): boolean {
    return key in this.attrs;
  }

  removeAttribute(key: string): void {
    delete this.attrs[key];
    if (key === 'class') this.className = '';
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners[type];
    if (!list) return;
    const i = list.indexOf(listener);
    if (i !== -1) list.splice(i, 1);
  }

  dispatch(type: string, extra: Record<string, unknown> = {}): void {
    [...(this.listeners[type] ?? [])].forEach((l) => l({type, target: this, ...extra}));
  }
}

/** Depth-first search of a stub tree. */
function findAll(node: StubNode, predicate: (n: StubNode) => boolean, out: StubNode[] = []): StubNode[] {
  for (const child of node.children) {
    if (predicate(child)) out.push(child);
    findAll(child, predicate, out);
  }
  return out;
}

function byAria(root: StubNode, label: string): StubNode {
  const hit = findAll(root, (n) => n.attrs['aria-label'] === label)[0];
  if (!hit) throw new Error(`no node with aria-label "${label}"`);
  return hit;
}

function installDocument(): () => void {
  const globals = globalThis as Record<string, unknown>;
  const previous = globals.document;
  globals.document = {
    createElement: (tag: string) => new StubNode(tag),
    createElementNS: (_namespace: string, tag: string) => new StubNode(tag),
    body: new StubNode('body'),
  };
  return () => {
    if (previous === undefined) delete globals.document;
    else globals.document = previous;
  };
}

interface Host<T> {
  el: T & Record<string, unknown>;
  root: StubNode;
  events: Array<{type: string; detail: unknown}>;
  attributes: Record<string, string>;
  connect(): void;
  disconnect(): void;
}

/**
 * Graft the DOM surface the elements use (attributes, shadow root, light-DOM
 * children, event dispatch) onto a bare instance — the SSR base class is an
 * empty class in Node, so this is exactly what a real HTMLElement would add.
 */
function createHost<T>(Ctor: new () => T, attrs: Record<string, string> = {}): Host<T> {
  const el = new Ctor() as T & Record<string, unknown>;
  const attributes: Record<string, string> = {...attrs};
  const events: Array<{type: string; detail: unknown}> = [];
  const root = new StubNode('#shadow-root');
  const selfListeners: Record<string, Array<(event: Event) => void>> = {};
  const target = el as unknown as Record<string, unknown>;
  target.isConnected = false;
  target.children = [];
  target.getAttribute = (name: string) => attributes[name] ?? null;
  target.hasAttribute = (name: string) => name in attributes;
  target.setAttribute = (name: string, value: string) => {
    attributes[name] = String(value);
    if (target.isConnected) (target.attributeChangedCallback as ((n: string) => void) | undefined)?.(name);
  };
  target.removeAttribute = (name: string) => {
    delete attributes[name];
    if (target.isConnected) (target.attributeChangedCallback as ((n: string) => void) | undefined)?.(name);
  };
  target.attachShadow = () => root;
  target.addEventListener = (type: string, listener: (event: Event) => void) => {
    (selfListeners[type] ??= []).push(listener);
  };
  target.removeEventListener = (type: string, listener: (event: Event) => void) => {
    const list = selfListeners[type];
    if (!list) return;
    const i = list.indexOf(listener);
    if (i !== -1) list.splice(i, 1);
  };
  target.dispatchEvent = (event: Event) => {
    events.push({type: event.type, detail: (event as CustomEvent).detail});
    [...(selfListeners[event.type] ?? [])].forEach((l) => l(event));
    return true;
  };
  return {
    el,
    root,
    events,
    attributes,
    connect() {
      target.isConnected = true;
      (target.connectedCallback as () => void)();
    },
    disconnect() {
      (target.disconnectedCallback as () => void)();
      target.isConnected = false;
    },
  };
}

// ===========================================================================
// SSR safety + define idempotency
// ===========================================================================
describe('elements module (SSR safety)', () => {
  it('imports and constructs in Node without document/customElements', () => {
    expect(() => new RackControlElement()).not.toThrow();
    expect(() => new ScoreRecorderElement()).not.toThrow();
  });

  it('define* are no-ops without customElements', () => {
    expect((globalThis as Record<string, unknown>).customElements).toBeUndefined();
    expect(() => defineRackControlElement()).not.toThrow();
    expect(() => defineScoreRecorderElement()).not.toThrow();
  });
});

describe('define idempotency', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).customElements;
  });

  it('each definer registers its tag once', () => {
    const registry = new Map<string, CustomElementConstructor>();
    const define = vi.fn((tag: string, ctor: CustomElementConstructor) => registry.set(tag, ctor));
    (globalThis as Record<string, unknown>).customElements = {
      get: (tag: string) => registry.get(tag),
      define,
    };

    defineRackControlElement();
    defineRackControlElement();
    defineScoreRecorderElement();
    defineScoreRecorderElement();

    expect(define).toHaveBeenCalledTimes(2);
    expect(registry.get('rack-control')).toBe(RackControlElement);
    expect(registry.get('score-recorder')).toBe(ScoreRecorderElement);
  });
});

describe('mountRackPlayer lifecycle', () => {
  let restoreDocument: () => void;

  beforeEach(() => {
    restoreDocument = installDocument();
  });

  afterEach(() => {
    restoreDocument();
    vi.restoreAllMocks();
  });

  it('releases its Rack end listener when destroyed', () => {
    const offEnd = vi.fn();
    const rack = {
      list: () => [],
      on: vi.fn(() => offEnd),
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      stop: vi.fn(),
    };
    const container = new StubNode('div');
    const handle = mountRackPlayer(rack as never, container as unknown as HTMLElement);

    expect(rack.on).toHaveBeenCalledWith('end', expect.any(Function));
    handle.destroy();
    handle.destroy();
    expect(offEnd).toHaveBeenCalledTimes(1);
  });

  it('preserves custom play/pause labels through the UI Kit presenter', async () => {
    const rack = {
      list: () => [],
      on: vi.fn(() => vi.fn()),
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      stop: vi.fn(),
    };
    const handle = mountRackPlayer(rack as never, new StubNode('div') as unknown as HTMLElement, {
      playLabel: 'Start rack',
      pauseLabel: 'Hold rack',
    });

    expect((handle.button as unknown as StubNode).attrs['aria-label']).toBe('Start rack');
    expect((handle.progress as unknown as StubNode).attrs['aria-label']).toBe('Rack player seek');
    expect(stubClasses((handle.button as unknown as StubNode).children[0]!)).toContain('webscore-play-preset__icon');
    const pending = handle.play();
    expect((handle.button as unknown as StubNode).attrs['aria-label']).toBe('Hold rack');
    expect((handle.button as unknown as StubNode).children[0]?.children.map((child) => child.attrs.x)).toEqual([
      '6',
      '14',
    ]);
    await pending;
    handle.pause();
    expect((handle.button as unknown as StubNode).attrs['aria-label']).toBe('Start rack');
    expect((handle.button as unknown as StubNode).children[0]?.children[0]?.attrs.d).toBe('M7 4v16l13-8z');
    handle.destroy();
  });

  it('exposes the UI Kit surface transport through the historic facade fields', () => {
    const player = {
      durationSeconds: 10,
      seconds: 2,
      progress: 0.2,
      seek: vi.fn((seconds: number) => {
        player.seconds = seconds;
        player.progress = seconds / player.durationSeconds;
      }),
    };
    const rack = {
      list: () => [{player}],
      on: vi.fn(() => vi.fn()),
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      stop: vi.fn(),
    };
    const container = new StubNode('div');
    const handle = mountRackPlayer(rack as never, container as unknown as HTMLElement, {
      playLabel: 'Start rack',
    });
    const root = handle.element as unknown as StubNode;
    const progress = handle.progress as unknown as StubNode;
    const fill = handle.progressFill as unknown as StubNode;
    const button = handle.button as unknown as StubNode;

    expect(container.children).toEqual([root]);
    expect(findAll(container, (node) => node.tagName === 'INPUT')).toEqual([]);
    const styles = findAll(container, (node) => node.tagName === 'STYLE');
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toBe(transportStateStyle);
    expect(progress.children).toEqual([fill]);
    expect({
      role: progress.attrs.role,
      label: progress.attrs['aria-label'],
      min: progress.attrs['aria-valuemin'],
      max: progress.attrs['aria-valuemax'],
      now: progress.attrs['aria-valuenow'],
      // The shared slider writes the attribute; a real DOM reflects it to
      // `.tabIndex`, and this stub does not.
      tabIndex: progress.attrs.tabindex,
    }).toEqual({role: 'slider', label: 'Rack player seek', min: '0', max: '100', now: '20', tabIndex: '0'});
    expect(button.children[0]?.children[0]?.tagName).toBe('PATH');
    expect(button.children[0]?.children[0]?.attrs.d).toBe('M7 4v16l13-8z');
    expect(button.children[0]?.attrs.width).toBe('var(--webscore-play-icon-size, 1.25rem)');
    // The preset mounts with `stylesheet: false`, so the glyph has to carry the
    // link to the button's own `color` itself.
    expect(button.children[0]?.attrs.fill).toBe('currentColor');
    // The facade bridges its own variables onto the kit's `--cp-*` layer and
    // paints nothing itself; the presenter writes the box from the very same
    // records its stylesheet is generated from. Both halves are asserted here,
    // because a facade that starts re-declaring properties is exactly how the
    // two drifted apart before.
    expect(root.style.props['--cp-gap']).toBe(
      'var(--webscore-play-gap, var(--wm-control-gap, 0.75rem))',
    );
    expect(root.style.props.gap).toBe('var(--wui-transport-gap)');
    expect(root.style.props['--cp-track-height']).toContain('--webscore-play-progress-height');
    expect(progress.style.props.height).toBe('var(--wui-transport-track-height)');

    const preventDefault = vi.fn();
    progress.dispatch('pointerdown', {button: 0, clientX: 10, pointerId: 7, preventDefault});
    progress.dispatch('pointermove', {clientX: 60, pointerId: 7, preventDefault});
    expect(player.seek).not.toHaveBeenCalled();
    // The fill's width is a value the update writes, not a declaration the box
    // carries — so it is a plain percentage and nothing else declares it.
    expect((fill.style as unknown as {width?: string}).width).toBe('60%');
    expect(fill.style.props.width).toBeUndefined();

    progress.dispatch('pointerup', {clientX: 60, pointerId: 7, preventDefault});
    expect(player.seek).toHaveBeenLastCalledWith(6);
    expect(progress.capturedPointers).toEqual([7]);

    progress.dispatch('keydown', {key: 'ArrowRight', preventDefault});
    expect(player.seek).toHaveBeenLastCalledWith(6.5);
    expect(progress.attrs['aria-valuenow']).toBe('65');
    // pointerdown, pointermove and keydown: the shared slider also suppresses
    // the default on a move, so a scrub cannot select text or scroll the page.
    expect(preventDefault).toHaveBeenCalledTimes(3);

    handle.destroy();
    expect(progress.listeners.pointerdown).toEqual([]);
    expect(progress.listeners.keydown).toEqual([]);
    expect(findAll(root, (node) => node.tagName === 'STYLE')).toEqual([]);
  });

  it('honours a pause issued re-entrantly from the Rack onPlay callback', async () => {
    const rack = {
      list: () => [],
      on: vi.fn(() => vi.fn()),
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      stop: vi.fn(),
    };
    const onPause = vi.fn();
    const handle = mountRackPlayer(rack as never, new StubNode('div') as unknown as HTMLElement, {
      onPlay: () => handle.pause(),
      onPause,
    });

    await handle.play();

    expect(rack.play).not.toHaveBeenCalled();
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(handle.isPlaying()).toBe(false);
    handle.destroy();
  });

  it('does not arm a stale progress reset when onEnd replays or destroys the Rack facade', async () => {
    vi.useFakeTimers();
    const globals = globalThis as Record<string, unknown>;
    const previousRaf = globals.requestAnimationFrame;
    const previousCancelRaf = globals.cancelAnimationFrame;
    let frame: ((timestamp: number) => void) | undefined;
    globals.requestAnimationFrame = (callback: (timestamp: number) => void) => {
      frame = callback;
      return 1;
    };
    globals.cancelAnimationFrame = vi.fn();

    try {
      const endListeners = new Set<() => void>();
      const player = {
        durationSeconds: 10,
        seconds: 0,
        progress: 0,
        seek: vi.fn(),
      };
      const rack = {
        list: () => [{player}],
        on: vi.fn((event: string, listener: () => void) => {
          if (event === 'end') endListeners.add(listener);
          return vi.fn(() => endListeners.delete(listener));
        }),
        play: vi.fn(async () => undefined),
        pause: vi.fn(),
        stop: vi.fn(),
      };
      const handle = mountRackPlayer(rack as never, new StubNode('div') as unknown as HTMLElement, {
        onEnd: () => {
          void handle.play();
        },
      });

      await handle.play();
      for (const listener of [...endListeners]) listener();
      await Promise.resolve();
      player.seconds = 4;
      player.progress = 0.4;
      frame?.(0);
      vi.advanceTimersByTime(181);

      expect(rack.play).toHaveBeenCalledTimes(2);
      expect((handle.progressFill as unknown as {style: {width: string}}).style.width).toBe('40%');
      handle.destroy();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      if (previousRaf === undefined) delete globals.requestAnimationFrame;
      else globals.requestAnimationFrame = previousRaf;
      if (previousCancelRaf === undefined) delete globals.cancelAnimationFrame;
      else globals.cancelAnimationFrame = previousCancelRaf;
    }
  });

  it('restores prior host content and releases the borrowed Rack when facade mounting fails', () => {
    const original = new StubNode('p');
    const container = new StubNode('div');
    container.append(original);
    const offEnd = vi.fn();
    const rack = {
      list: () => [],
      on: vi.fn(() => offEnd),
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      stop: vi.fn(),
    };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === 'span') throw new Error('compatibility DOM failed');
      return createElement(tagName, options);
    });

    expect(() => mountRackPlayer(rack as never, container as unknown as HTMLElement)).toThrow(
      'compatibility DOM failed',
    );
    expect(container.children).toEqual([original]);
    expect(offEnd).toHaveBeenCalledTimes(1);
    expect(rack.stop).not.toHaveBeenCalled();
  });

  it('contains click rejections and restores rack transport UI', async () => {
    const failure = new Error('rack play failed');
    const onError = vi.fn();
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rack = {
      list: () => [],
      on: vi.fn(() => vi.fn()),
      play: vi.fn(async () => {
        throw failure;
      }),
      pause: vi.fn(),
      stop: vi.fn(),
    };
    const handle = mountRackPlayer(rack as never, new StubNode('div') as unknown as HTMLElement, {onError});

    await expect(handle.play()).rejects.toBe(failure);
    expect(handle.isPlaying()).toBe(false);
    expect((handle.button as unknown as StubNode).attrs['aria-label']).toBe('Play');

    (handle.button as unknown as StubNode).click();
    await flush();
    await flush();
    expect(handle.isPlaying()).toBe(false);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(rack.pause).toHaveBeenCalledTimes(2);
    expect(reported).toHaveBeenCalled();
    handle.destroy();
  });

  it('rolls back a rack start that completes after the user pauses', async () => {
    let resolvePlay!: () => void;
    const pendingBackend = new Promise<void>((resolve) => {
      resolvePlay = resolve;
    });
    let backendPlaying = false;
    const rack = {
      list: () => [],
      on: vi.fn(() => vi.fn()),
      play: vi.fn(async () => {
        await pendingBackend;
        backendPlaying = true;
      }),
      pause: vi.fn(() => {
        backendPlaying = false;
      }),
      stop: vi.fn(() => {
        backendPlaying = false;
      }),
    };
    const handle = mountRackPlayer(rack as never, new StubNode('div') as unknown as HTMLElement);

    const pending = handle.play();
    handle.pause();
    expect(handle.isPlaying()).toBe(false);
    resolvePlay();
    await pending;

    expect(backendPlaying).toBe(false);
    expect(rack.pause).toHaveBeenCalledTimes(2);
    expect((handle.button as unknown as StubNode).attrs['aria-label']).toBe('Play');
    handle.destroy();
  });
});

describe('mount transport progress', () => {
  let restoreDocument: () => void;

  beforeEach(() => {
    restoreDocument = installDocument();
  });

  afterEach(() => {
    restoreDocument();
    vi.restoreAllMocks();
  });

  it('carries the clock and the volume control the caller asked for, and changes both in place', () => {
    const container = new StubNode('div');
    const onVolumeChange = vi.fn();
    const handle = mountPresetPlayer(buildScore('Chrome'), container as unknown as HTMLElement, {
      timeControl: 'full',
      volume: 0.5,
      onVolumeChange,
    });
    const root = handle.element as unknown as StubNode;
    const part = (name: string) => findAll(root, (node) => stubClasses(node).includes(name))[0];
    const time = part('webscore-play-preset__time')!;

    // `full` is the elapsed time and the total, in two nodes so `simple` can
    // drop the second without a remount.
    expect(time.style.display).toBe('');
    const halves = time.children.map((child) => child.textContent);
    expect(halves).toHaveLength(2);
    expect(halves[1]).toContain('/');

    // No volume control was asked for, so none was built.
    expect(part('webscore-play-preset__volume')).toBeUndefined();

    handle.setChrome({volume: 'fader', time: 'simple'});
    // The clock stays, minus its total half.
    expect(time.style.display).toBe('');
    expect(time.children[1]!.style.display).toBe('none');

    // The volume control is the UI Kit fader: an ARIA slider drawn from plain
    // elements, so it needs no stylesheet this light-DOM facade cannot install.
    const fader = part('webscore-play-preset__volume')!;
    expect(stubClasses(fader)).toContain('wui-fader--horizontal');
    expect(fader.attrs.role).toBe('slider');
    expect(fader.children.map((child) => stubClasses(child))).toEqual([
      'wui-fader__fill',
      'wui-fader__thumb',
    ]);
    // Its colours and sizes reach the preset's own variables THROUGH the kit:
    // the presenter feeds `--wm-fader-*` from its own tokens, and the facade's
    // bridge points those at `--webscore-play-*` on the root.
    expect(fader.style.props['--wm-fader-fill']).toBe('var(--wui-transport-fill)');
    expect(root.style.props['--cp-fill']).toContain('--webscore-play-progress-fill');
    // The swap repaints from the volume the owner already applied.
    expect(fader.attrs['aria-valuenow']).toBe('0.5');

    fader.dispatch('keydown', {key: 'Home', preventDefault: () => {}});
    expect(onVolumeChange).toHaveBeenCalledWith(0);

    // A knob replaces the fader rather than joining it, and carries the same
    // bridge in its own vocabulary.
    handle.setChrome({volume: 'knob'});
    expect(part('webscore-play-preset__volume')).not.toBe(fader);
    const knob = part('webscore-play-preset__volume')!;
    expect(stubClasses(knob)).toContain('wui-knob');
    expect(knob.attrs.role).toBe('slider');
    expect(knob.style.props['--wm-knob-arc']).toBe('var(--wui-transport-fill)');
    expect(knob.attrs['aria-valuenow']).toBe('0');

    handle.setChrome({volume: 'off', time: 'off'});
    expect(part('webscore-play-preset__volume')).toBeUndefined();
    expect(time.style.display).toBe('none');

    handle.destroy();
  });

  it('uses the player transport progress for a score with a performed tail', () => {
    const container = new StubNode('div');
    const handle = mountPresetPlayer(buildScore('Performed Tail', true), container as unknown as HTMLElement);

    handle.player!.setRate(2);
    handle.player!.seekFraction(0.5);

    expect((handle.progressFill as unknown as {style: {width: string}}).style.width).toBe('50%');
    handle.destroy();
  });

  it('contains preset click rejections and restores its play button', async () => {
    const failure = new Error('sample preload failed');
    const onError = vi.fn(() => {
      throw new Error('onError callback failed');
    });
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const gainNode = () => ({
      gain: {value: 1},
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
    const context = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createGain: gainNode,
      createStereoPanner: () => ({
        pan: {value: 0},
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
    } as unknown as AudioContext;
    const synth = {
      connect: vi.fn(),
      noteOn: vi.fn(),
      preload: vi.fn(async () => {
        throw failure;
      }),
    };
    const handle = mountPresetPlayer(buildScore('Failure'), new StubNode('div') as unknown as HTMLElement, {
      audioContext: context,
      synth,
      onError,
    });

    await expect(handle.play()).rejects.toBe(failure);
    expect((handle.button as unknown as StubNode).attrs['aria-label']).toBe('Play');

    (handle.button as unknown as StubNode).click();
    await flush();
    await flush();
    expect(onError).toHaveBeenCalledTimes(2);
    expect((handle.button as unknown as StubNode).attrs['aria-label']).toBe('Play');
    expect(reported).toHaveBeenCalled();
    handle.destroy();
  });

  it('cancels a preset start while asynchronous preload is pending', async () => {
    let resolvePreload!: () => void;
    const loading = new Promise<void>((resolve) => {
      resolvePreload = resolve;
    });
    const gainNode = () => ({
      gain: {value: 1},
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
    const context = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createGain: gainNode,
      createStereoPanner: () => ({
        pan: {value: 0},
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
    } as unknown as AudioContext;
    const synth = {
      connect: vi.fn(),
      noteOn: vi.fn(),
      preload: vi.fn(() => loading),
    };
    const handle = mountPresetPlayer(buildScore('Pending preload'), new StubNode('div') as unknown as HTMLElement, {
      audioContext: context,
      synth,
    });

    const pending = handle.play();
    expect((handle.button as unknown as StubNode).attrs['aria-label']).toBe('Pause');
    handle.pause();
    expect((handle.button as unknown as StubNode).attrs['aria-label']).toBe('Play');
    resolvePreload();
    await pending;

    expect(handle.isPlaying()).toBe(false);
    expect(synth.noteOn).not.toHaveBeenCalled();
    expect((handle.button as unknown as StubNode).attrs['aria-label']).toBe('Play');
    handle.destroy();
  });

  it('honours a pause issued re-entrantly from the preset onPlay callback', async () => {
    const play = vi.spyOn(ScorePlayer.prototype, 'play').mockResolvedValue(undefined);
    const onPause = vi.fn();
    const handle = mountPresetPlayer(buildScore('Re-entrant preset'), new StubNode('div') as unknown as HTMLElement, {
      onPlay: () => handle.pause(),
      onPause,
    });

    await handle.play();

    expect(play).not.toHaveBeenCalled();
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(handle.isPlaying()).toBe(false);
    expect((handle.button as unknown as StubNode).attrs['aria-label']).toBe('Play');
    handle.destroy();
  });

  it('settles preset state before onEnd, contains callback throws, and skips a stale replay reset', async () => {
    vi.useFakeTimers();
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const play = vi.spyOn(ScorePlayer.prototype, 'play').mockResolvedValue(undefined);
    const score = buildScore('Replay after end');
    const handle = mountPresetPlayer(score, new StubNode('div') as unknown as HTMLElement, {
      onEnd: () => {
        void handle.play();
        throw new Error('consumer end callback failed');
      },
    });

    try {
      await handle.play();
      await handle.player!.seekFraction(0.4);
      (
        handle.player as unknown as {
          emit(event: 'end', payload: Score): void;
        }
      ).emit('end', score);
      await Promise.resolve();

      expect(play).toHaveBeenCalledTimes(2);
      expect((handle.button as unknown as StubNode).attrs['aria-label']).toBe('Play');
      expect((handle.progressFill as unknown as {style: {width: string}}).style.width).toBe('40%');
      vi.advanceTimersByTime(181);
      expect((handle.progressFill as unknown as {style: {width: string}}).style.width).toBe('40%');
      expect(reported).toHaveBeenCalled();
    } finally {
      handle.destroy();
      vi.useRealTimers();
    }
  });

  it('does not arm the preset end reset when onEnd destroys the facade', () => {
    vi.useFakeTimers();
    const score = buildScore('Destroy after end');
    const handle = mountPresetPlayer(score, new StubNode('div') as unknown as HTMLElement, {
      onEnd: () => handle.destroy(),
    });

    try {
      (
        handle.player as unknown as {
          emit(event: 'end', payload: Score): void;
        }
      ).emit('end', score);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      handle.destroy();
      vi.useRealTimers();
    }
  });

  it('lets ScorePlayer resume user activation before preset sample preparation', async () => {
    const order: string[] = [];
    let state: AudioContextState = 'suspended';
    const gainNode = () => ({
      gain: {value: 1},
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
    const context = {
      get state() {
        return state;
      },
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => {
        order.push('resume');
        state = 'running';
      }),
      createGain: gainNode,
      createStereoPanner: () => ({
        pan: {value: 0},
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
    } as unknown as AudioContext;
    const synth = {
      connect: vi.fn(),
      noteOn: vi.fn(),
      preload: vi.fn(async () => {
        order.push('preload');
      }),
    };
    const handle = mountPresetPlayer(buildScore('Activation order'), new StubNode('div') as unknown as HTMLElement, {
      audioContext: context,
      synth,
    });

    await handle.play();

    expect(order).toEqual(['resume', 'preload']);
    handle.destroy();
  });

  it("follows the longest rack member's transport progress, not its nominal cursor", async () => {
    const globals = globalThis as Record<string, unknown>;
    const previousRaf = globals.requestAnimationFrame;
    const previousCancelRaf = globals.cancelAnimationFrame;
    let frame: ((timestamp: number) => void) | undefined;
    globals.requestAnimationFrame = (callback: (timestamp: number) => void) => {
      frame = callback;
      return 1;
    };
    globals.cancelAnimationFrame = () => undefined;

    try {
      const player = {
        // At 2x, this is the same musical point as nominal second 1.
        seconds: 0.5,
        durationSeconds: 1,
        progress: 0.5,
        currentTime: {seconds: 1},
        seek: vi.fn(),
      };
      const offEnd = vi.fn();
      const rack = {
        list: () => [{player}],
        on: vi.fn(() => offEnd),
        play: vi.fn(async () => undefined),
        pause: vi.fn(),
        stop: vi.fn(),
      };
      const handle = mountRackPlayer(rack as never, new StubNode('div') as unknown as HTMLElement);

      await handle.play();
      expect(frame).toBeTypeOf('function');
      frame?.(0);

      expect((handle.progressFill as unknown as {style: {width: string}}).style.width).toBe('50%');
      handle.destroy();
    } finally {
      if (previousRaf === undefined) delete globals.requestAnimationFrame;
      else globals.requestAnimationFrame = previousRaf;
      if (previousCancelRaf === undefined) delete globals.cancelAnimationFrame;
      else globals.cancelAnimationFrame = previousCancelRaf;
    }
  });
});

describe('mountControllerPlayer borrowed-controller composition', () => {
  let restoreDocument: () => void;

  beforeEach(() => {
    restoreDocument = installDocument();
  });

  afterEach(() => {
    restoreDocument();
    vi.restoreAllMocks();
  });

  function borrowedController() {
    const state = {
      playing: false,
      progress: 0.2,
      currentTime: 2,
      duration: 10,
    };
    const listeners = new Map<string, Set<() => void>>();
    const offs: Array<ReturnType<typeof vi.fn>> = [];
    const emit = (event: string) => {
      for (const listener of listeners.get(event) ?? []) listener();
    };
    const destroy = vi.fn();
    const controller = {
      get playing() {
        return state.playing;
      },
      get progress() {
        return state.progress;
      },
      get currentTime() {
        return state.currentTime;
      },
      get duration() {
        return state.duration;
      },
      play: vi.fn(() => {
        state.playing = true;
        emit('transportchange');
      }),
      pause: vi.fn(() => {
        state.playing = false;
        emit('transportchange');
      }),
      stop: vi.fn(),
      seekFraction: vi.fn((value: number) => {
        state.progress = value;
        state.currentTime = value * state.duration;
        emit('timeupdate');
      }),
      on: vi.fn((event: string, listener: () => void) => {
        const group = listeners.get(event) ?? new Set<() => void>();
        group.add(listener);
        listeners.set(event, group);
        const off = vi.fn(() => group.delete(listener));
        offs.push(off);
        return off;
      }),
      destroy,
    } as unknown as PlayerController;
    return {controller, destroy, emit, listeners, offs, state};
  }

  it('paints the borrowed controller state into the shared preset chrome', () => {
    const fixture = borrowedController();
    const container = new StubNode('div');
    const handle = mountControllerPlayer(fixture.controller, container as unknown as HTMLElement);

    expect((handle.button as unknown as StubNode).attrs['aria-label']).toBe('Play');
    expect((handle.progressFill as unknown as StubNode).style.props).toBeDefined();
    expect((handle.progressFill as unknown as {style: {width: string}}).style.width).toBe('20%');
    expect(handle.isPlaying()).toBe(false);
    // The engine belongs to the controller's owner, never to this facade.
    expect(handle.player).toBeUndefined();

    handle.destroy();
  });

  it('syncs external play/pause and delegates user play/pause/seek', async () => {
    const fixture = borrowedController();
    const container = new StubNode('div');
    const handle = mountControllerPlayer(fixture.controller, container as unknown as HTMLElement);
    const button = handle.button as unknown as StubNode;

    fixture.controller.play();
    expect(button.attrs['aria-label']).toBe('Pause');
    fixture.controller.pause();
    expect(button.attrs['aria-label']).toBe('Play');

    button.click();
    expect(fixture.controller.play).toHaveBeenCalledTimes(2);
    button.click();
    expect(fixture.controller.pause).toHaveBeenCalledTimes(2);

    const progress = handle.progress as unknown as StubNode;
    progress.dispatch('pointerdown', {button: 0, pointerId: 1, clientX: 62.5, preventDefault() {}});
    progress.dispatch('pointerup', {button: 0, pointerId: 1, clientX: 62.5, preventDefault() {}});
    expect(fixture.controller.seekFraction).toHaveBeenCalledWith(0.625);

    await handle.play();
    expect(fixture.controller.play).toHaveBeenCalledTimes(3);
    handle.pause();
    expect(fixture.controller.pause).toHaveBeenCalledTimes(3);
    handle.stop();
    expect(fixture.controller.stop).toHaveBeenCalledTimes(1);

    handle.destroy();
  });

  it('never destroys the borrowed controller and unsubscribes exactly once', () => {
    const fixture = borrowedController();
    const container = new StubNode('div');
    const handle = mountControllerPlayer(fixture.controller, container as unknown as HTMLElement);

    handle.destroy();
    handle.destroy();

    expect(fixture.destroy).not.toHaveBeenCalled();
    expect(fixture.controller.stop).not.toHaveBeenCalled();
    fixture.offs.forEach((off) => expect(off).toHaveBeenCalledTimes(1));
  });

  it('reports controller errors through onError and keeps repainting', () => {
    const fixture = borrowedController();
    const onError = vi.fn();
    const container = new StubNode('div');
    const handle = mountControllerPlayer(fixture.controller, container as unknown as HTMLElement, {onError});

    fixture.emit('error');
    expect(onError).toHaveBeenCalledTimes(1);

    handle.destroy();
    fixture.emit('error');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// <rack-control>
// ===========================================================================
describe('<rack-control>', () => {
  let restoreDocument: () => void;

  beforeEach(() => {
    restoreDocument = installDocument();
  });

  afterEach(() => {
    restoreDocument();
  });

  /**
   * A rack stands in for the headless one: the desk is a VIEW over it, so every
   * assertion below is about what reached the rack, never about a private
   * mirror the element keeps beside it.
   */
  function fakeRack(members: Array<{id: string; volume?: number; muted?: boolean; solo?: boolean}> = []) {
    const list = members.map((m) => ({
      id: m.id,
      mode: 'timeline' as const,
      player: undefined,
      volume: m.volume ?? 1,
      muted: m.muted ?? false,
      solo: m.solo ?? false,
    }));
    let effect: Effect | undefined;
    return {
      list: () => list,
      masterVolume: 1,
      get effect() { return effect; },
      setEffect: vi.fn((next: Effect | undefined) => { effect = next; }),
      add: vi.fn(({id}: {id: string}) => {
        if (!list.some((m) => m.id === id)) {
          list.push({id, mode: 'timeline' as const, player: undefined, volume: 1, muted: false, solo: false});
        }
      }),
      rename: vi.fn((oldId: string, newId: string) => {
        const member = list.find((candidate) => candidate.id === oldId);
        if (!member) throw new Error(`Rack member "${oldId}" does not exist.`);
        if (oldId === newId) return;
        if (list.some((candidate) => candidate.id === newId)) {
          throw new Error(`Rack member "${newId}" already exists.`);
        }
        member.id = newId;
      }),
      remove: vi.fn((id: string) => {
        const i = list.findIndex((m) => m.id === id);
        if (i >= 0) list.splice(i, 1);
      }),
      setVolume: vi.fn(),
      setMasterVolume: vi.fn(),
      mute: vi.fn(),
      solo: vi.fn(),
      dispose: vi.fn(),
      on: vi.fn(() => () => {}),
      get context(): AudioContext {
        throw new Error('no audio in tests');
      },
    };
  }

  function withRack(rack: unknown, children: unknown[] = []) {
    const host = createHost(RackControlElement);
    (host.el as unknown as {children: unknown[]}).children = children;
    (host.el as {rack: unknown}).rack = rack;
    return host;
  }

  it('renders a strip per rack member and sends every level to the rack', () => {
    const rack = fakeRack([{id: 'lead', volume: 0.5}, {id: 'bass'}]);
    const host = withRack(rack);
    host.connect();

    // The strip's control is the UI Kit's shared fader: an ARIA slider driven by
    // pointer and keyboard, not a native range with a `.value`.
    byAria(host.root, 'lead volume').dispatch('keydown', {key: 'Home', preventDefault: () => {}});
    expect(rack.setVolume).toHaveBeenLastCalledWith('lead', 0);

    byAria(host.root, 'master volume').dispatch('keydown', {key: 'End', preventDefault: () => {}});
    expect(rack.setMasterVolume).toHaveBeenLastCalledWith(1);

    // A level is never a redeclaration: `Rack.add` on an existing id disposes
    // the live player, so moving a fader must not reach it.
    expect(rack.add).not.toHaveBeenCalled();

    host.disconnect();
  });

  it('reads each channel back off the rack rather than mirroring it', () => {
    const rack = fakeRack([{id: 'lead', volume: 0.25}]);
    const host = withRack(rack);
    host.connect();
    expect(byAria(host.root, 'lead volume').attrs['aria-valuenow']).toBe('0.25');
    host.disconnect();
  });

  it('turns declared parts into rack members, and drops them when they leave', () => {
    const rack = fakeRack();
    const part = (id: string, score: unknown) => ({
      id,
      rackPartDeclaration: () => ({id, score}),
    });
    const lead = part('lead', {id: 'lead'});
    const bass = part('bass', {id: 'bass'});
    const host = withRack(rack, [lead, bass]);
    host.connect();

    expect(rack.add).toHaveBeenCalledTimes(2);
    expect(rack.add).toHaveBeenCalledWith({id: 'lead', score: {id: 'lead'}});

    // Re-reconciling with the same declarations adds nothing: `Rack.add` on an
    // existing id disposes the live player, so it is only for a real change.
    (host.el as unknown as {children: unknown[]}).children = [lead];
    (host.el as unknown as {dispatchEvent(event: unknown): boolean}).dispatchEvent(
      new CustomEvent('webscore:rack-part', {bubbles: true}),
    );
    expect(rack.remove).toHaveBeenCalledWith('bass');
    expect(rack.add).toHaveBeenCalledTimes(2);

    host.disconnect();
  });

  it('renames the same part in place when its score and sound are unchanged', () => {
    const rack = fakeRack();
    const score = {id: 'lead-score'};
    const sound = {id: 'lead-sound'};
    let id = 'lead';
    const part = {
      id,
      rackPartDeclaration: () => ({id, score, sound}),
    };
    const host = withRack(rack, [part]);
    host.connect();

    expect(rack.add).toHaveBeenCalledWith({id: 'lead', score, sound});

    id = 'drums-main';
    part.id = id;
    (host.el as unknown as {dispatchEvent(event: unknown): boolean}).dispatchEvent(
      new CustomEvent('webscore:rack-part', {bubbles: true}),
    );

    expect(rack.rename).toHaveBeenCalledOnce();
    expect(rack.rename).toHaveBeenCalledWith('lead', 'drums-main');
    expect(rack.add).toHaveBeenCalledTimes(1);
    expect(rack.remove).not.toHaveBeenCalled();
    expect(rack.list().map((member) => member.id)).toEqual(['drums-main']);

    host.disconnect();
  });

  it('replaces rather than renames when id and declaration identity change together', () => {
    const rack = fakeRack();
    const original = {id: 'original-score'};
    const replacement = {id: 'replacement-score'};
    let declaration = {id: 'lead', score: original, sound: {id: 'triangle'}};
    const part = {
      rackPartDeclaration: () => declaration,
    };
    const host = withRack(rack, [part]);
    host.connect();

    const replacementSound = {id: 'sine'};
    declaration = {id: 'melody', score: replacement, sound: replacementSound};
    (host.el as unknown as {dispatchEvent(event: unknown): boolean}).dispatchEvent(
      new CustomEvent('webscore:rack-part', {bubbles: true}),
    );

    expect(rack.rename).not.toHaveBeenCalled();
    expect(rack.add).toHaveBeenLastCalledWith({
      id: 'melody',
      score: replacement,
      sound: replacementSound,
    });
    expect(rack.remove).toHaveBeenCalledWith('lead');
    expect(rack.list().map((member) => member.id)).toEqual(['melody']);

    host.disconnect();
  });

  it('rejects duplicate part ids without replacing either declared member', () => {
    const rack = fakeRack();
    const leadScore = {id: 'lead-score'};
    const bassScore = {id: 'bass-score'};
    let bassId = 'bass';
    const lead = {rackPartDeclaration: () => ({id: 'lead', score: leadScore})};
    const bass = {rackPartDeclaration: () => ({id: bassId, score: bassScore})};
    const host = withRack(rack, [lead, bass]);
    host.connect();
    host.events.length = 0;

    bassId = 'lead';
    (host.el as unknown as {dispatchEvent(event: unknown): boolean}).dispatchEvent(
      new CustomEvent('webscore:rack-part', {bubbles: true}),
    );

    expect(rack.rename).not.toHaveBeenCalled();
    expect(rack.add).toHaveBeenCalledTimes(2);
    expect(rack.remove).not.toHaveBeenCalled();
    expect(rack.list().map((member) => member.id)).toEqual(['lead', 'bass']);
    expect(host.events.some((event) => event.type === 'webscore:error')).toBe(true);

    host.disconnect();
  });

  it('shows or hides each control from its own attribute', () => {
    const rack = fakeRack([{id: 'lead'}]);

    const full = withRack(rack);
    full.connect();
    expect(findAll(full.root, (node) => node.attrs['aria-label'] === 'master volume')).toHaveLength(1);
    expect(findAll(full.root, (node) => node.attrs['aria-label'] === 'Mute lead')).toHaveLength(1);
    expect(findAll(full.root, (node) => node.attrs['aria-label'] === 'Solo lead')).toHaveLength(1);
    full.disconnect();

    // Mute and solo exist only when the binding can act on them, so taking them
    // away is the same statement as not offering the command.
    const bare = createHost(RackControlElement, {master: 'false', mute: 'false', solo: 'false'});
    (bare.el as {rack: unknown}).rack = rack;
    bare.connect();
    expect(findAll(bare.root, (node) => node.attrs['aria-label'] === 'master volume')).toHaveLength(0);
    expect(findAll(bare.root, (node) => node.attrs['aria-label'] === 'Mute lead')).toHaveLength(0);
    expect(findAll(bare.root, (node) => node.attrs['aria-label'] === 'Solo lead')).toHaveLength(0);
    // The channel it mixes is still there — only the chrome went.
    expect(findAll(bare.root, (node) => node.attrs['aria-label'] === 'lead volume')).toHaveLength(1);
    bare.disconnect();
  });

  it('translates the presenter exclusive solo onto the rack per-member one', () => {
    const rack = fakeRack([{id: 'lead'}, {id: 'bass'}]);
    const host = withRack(rack);
    host.connect();

    const solo = findAll(host.root, (node) => node.attrs['aria-label'] === 'Solo lead')[0]!;
    solo.dispatch('click', {});
    // The presenter sends one id (or null to clear); the rack takes a flag per
    // member, so forwarding it raw would leave a soloed channel unsoloable.
    expect(rack.solo).toHaveBeenCalledWith('lead', true);
    expect(rack.solo).toHaveBeenCalledWith('bass', false);

    host.disconnect();
  });

  it('adopts an assigned rack and never disposes it', () => {
    const rack = fakeRack([{id: 'lead'}]);
    const host = withRack(rack);
    host.connect();
    host.disconnect();
    expect(rack.dispose).not.toHaveBeenCalled();
  });

  it('forwards one reusable effect chain to the active rack and preserves it across adoption', () => {
    const first = fakeRack([{id: 'lead'}]);
    const second = fakeRack([{id: 'bass'}]);
    const host = withRack(first);
    host.connect();
    const effect = Effect.chain(Effect.reverb({wet: 0.2}), Effect.filter({frequency: 900}));

    (host.el as RackControlElement).effect = effect;
    expect(first.setEffect).toHaveBeenCalledWith(effect);
    expect((host.el as RackControlElement).effect).toBe(effect);

    (host.el as RackControlElement).rack = second as unknown as Rack;
    expect(second.setEffect).toHaveBeenCalledWith(effect);
    expect(first.dispose).not.toHaveBeenCalled();

    (host.el as RackControlElement).effect = undefined;
    expect(second.setEffect).toHaveBeenLastCalledWith(undefined);
    expect((host.el as RackControlElement).effect).toBeUndefined();
    host.disconnect();
    expect(second.dispose).not.toHaveBeenCalled();
  });

  it('keeps the last applied effect when a rack rejects a replacement', () => {
    const first = fakeRack([{id: 'lead'}]);
    const second = fakeRack([{id: 'bass'}]);
    const host = withRack(first);
    const element = host.el as RackControlElement;
    host.connect();
    const applied = Effect.reverb({wet: 0.2});
    const rejected = Effect.custom(() => { throw new Error('must not build'); });
    const failure = new Error('replacement failed');

    element.effect = applied;
    first.setEffect.mockImplementationOnce(() => { throw failure; });
    expect(() => { element.effect = rejected; }).toThrow(failure);
    expect(element.effect).toBe(applied);
    expect(host.events).toContainEqual({
      type: 'webscore:error',
      detail: {operation: 'rack-control', error: failure},
    });

    element.rack = second as unknown as Rack;
    expect(second.setEffect).toHaveBeenCalledWith(applied);
    expect(second.setEffect).not.toHaveBeenCalledWith(rejected);
    host.disconnect();
  });

  it('seeds an owned rack with an effect assigned before connection', () => {
    const effect = Effect.chain(Effect.delay({wet: 0.25}), Effect.compressor());
    const part = {
      rackPartDeclaration: () => ({id: 'lead', score: buildScore('lead')}),
    };
    const host = createHost(RackControlElement);
    (host.el as unknown as {children: unknown[]}).children = [part];
    (host.el as RackControlElement).effect = effect;

    host.connect();
    expect((host.el as RackControlElement).rack?.effect).toBe(effect);
    host.disconnect();
  });

  it('bridges its legacy variables through tokens, not properties', () => {
    const host = withRack(fakeRack([{id: 'piano'}]));
    host.connect();

    const sheet = findAll(host.root, (node) => node.tagName === 'STYLE')
      .map((node) => node.textContent)
      .join('');

    // The strip's control is the kit's shared fader, which paints its own track
    // with INLINE geometry so it stays correct in a light-DOM host. An inline
    // style beats this sheet, so the bridge has to feed the fader's tokens —
    // setting `width`/`background` here would be silently dead.
    expect(sheet).toContain('--wm-fader-width:var(--rc-fader-width,var(--wm-mixer-fader-width');
    expect(sheet).toContain('--wm-fader-track:var(--rc-track,var(--wm-mixer-track');
    expect(sheet).toContain('--wm-fader-track-border:var(--rc-track-border,var(--wm-mixer-track-border,var(--wm-control-border,var(--wm-border,#d8d8d8))))');
    expect(sheet).toContain('var(--rc-text,var(--wm-mixer-text,var(--wm-foreground');
    // Compatibility aliases must not replace inherited UIKit theme inputs.
    expect(sheet).not.toContain('--wm-mixer-track:');
    expect(sheet).toContain(':host([hidden]) { display:none; }');
    // Anchored, because the token declaration itself ends in `-width:var(--rc-…`.
    expect(sheet).not.toMatch(/[;{\s]width:var\(--rc-fader-width/);
    expect(sheet).not.toMatch(/[;{\s]background:var\(--rc-track/);

    host.disconnect();
  });

  it('slots its parts above the desk, and announces the rack upward', () => {
    const rack = fakeRack([{id: 'piano'}]);
    const host = withRack(rack);
    host.connect();
    expect(findAll(host.root, (node) => node.tagName === 'SLOT')).toHaveLength(1);
    // The player wrapping the desk learns which rack to drive from this.
    expect(host.events.some((event) => event.type === 'webscore:rack')).toBe(true);
    host.disconnect();
  });

  it('subscribes to rack memberschange', () => {
    const rack = fakeRack([{id: 'piano'}]);
    const host = withRack(rack);
    host.connect();
    expect(rack.on).toHaveBeenCalledWith('memberschange', expect.any(Function));
    host.disconnect();
  });

  it('styles mixer nodes through caller-owned part tokens', () => {
    const host = withRack(fakeRack([{id: 'piano'}]));
    host.connect();

    // Box and range collapsed into one fader node, so both hooks land on it.
    expect(byAria(host.root, 'piano volume').attrs.part).toContain('rack-control-input');
    expect(byAria(host.root, 'master volume').attrs.part).toContain('rack-control-fader');
    expect(findAll(host.root, (node) => node.attrs.part?.includes('rack-control-label'))).toHaveLength(2);
    host.disconnect();
  });
});

// ===========================================================================
// <rack-part>
// ===========================================================================
describe('<rack-part>', () => {
  let restoreDocument: () => void;

  beforeEach(() => { restoreDocument = installDocument(); });
  afterEach(() => { restoreDocument(); });

  it('declares what its markup says, and nothing about playback', () => {
    const host = createHost(RackPartElement, {id: 'lead', sound: 'triangle'});
    (host.el as {id: string}).id = 'lead';
    (host.el as {score: unknown}).score = {id: 'lead-score'};
    host.connect();

    const declaration = host.el.rackPartDeclaration();
    expect(declaration?.id).toBe('lead');
    expect(declaration?.score).toEqual({id: 'lead-score'});
    expect(declaration?.sound).toBeDefined();
    // It is a declaration: no transport, no chrome, nothing rendered.
    expect(host.root.children).toHaveLength(0);

    host.disconnect();
  });

  it('announces a connected id rename without reloading its score', async () => {
    expect(RackPartElement.observedAttributes).toEqual(['id', 'src', 'format', 'sound']);
    vi.mocked(loadScoreFromUrl).mockClear();
    const host = createHost(RackPartElement, {
      id: 'lead',
      src: '/midi/demo.mid',
      sound: 'triangle',
    });
    (host.el as {id: string}).id = 'lead';
    (host.el as unknown as {parentElement: {tagName: string}}).parentElement = {
      tagName: 'rack-control',
    };
    host.connect();
    await flush();

    const before = host.el.rackPartDeclaration();
    expect(before).toBeDefined();
    expect(loadScoreFromUrl).toHaveBeenCalledTimes(1);
    host.events.length = 0;

    (host.el as {id: string}).id = 'drums-main';
    host.el.setAttribute('id', 'drums-main');

    const after = host.el.rackPartDeclaration();
    expect(host.events.map((event) => event.type)).toEqual(['webscore:rack-part']);
    expect(loadScoreFromUrl).toHaveBeenCalledTimes(1);
    expect(after).toMatchObject({id: 'drums-main'});
    expect(after?.score).toBe(before?.score);
    expect(after?.sound).toBe(before?.sound);

    host.disconnect();
  });

  it('has nothing to declare until a score resolves', () => {
    const host = createHost(RackPartElement, {id: 'lead'});
    host.connect();
    expect(host.el.rackPartDeclaration()).toBeUndefined();
    host.disconnect();
  });

  it('builds the voice once per value, so a reconcile is not a redeclaration', () => {
    const host = createHost(RackPartElement, {id: 'lead', sound: 'triangle'});
    (host.el as {score: unknown}).score = {id: 's'};
    host.connect();

    // The desk decides whether to rebuild a member by comparing what it was
    // declared WITH. A fresh synth on every read would make every reconcile
    // look like a change, and a redeclaration disposes the member's player.
    const first = host.el.rackPartDeclaration()?.sound;
    expect(host.el.rackPartDeclaration()?.sound).toBe(first);

    host.el.setAttribute('sound', 'square');
    expect(host.el.rackPartDeclaration()?.sound).not.toBe(first);

    host.disconnect();
  });

  it('reports a sound it cannot name rather than voicing the part wrongly', () => {
    const host = createHost(RackPartElement, {sound: 'kazoo'});
    (host.el as {score: unknown}).score = {id: 's'};
    host.connect();

    const declaration = host.el.rackPartDeclaration();
    expect(declaration?.sound).toBeUndefined();
    expect(host.events.some((event) => event.type === 'webscore:error')).toBe(true);

    host.disconnect();
  });
});

// ===========================================================================
// <score-recorder>
// ===========================================================================
describe('<score-recorder>', () => {
  let restoreDocument: () => void;

  beforeEach(() => {
    restoreDocument = installDocument();
  });

  afterEach(() => {
    restoreDocument();
    vi.restoreAllMocks();
  });

  it('records .input() presses into a Score and fires webscore:recorded', () => {
    const host = createHost(ScoreRecorderElement);
    host.connect();

    host.el.record();
    expect(host.el.recordingActive).toBe(true);
    const input = host.el.input as (midi: number, velocity: number, on: boolean) => void;
    input(60, 100, true);
    input(60, 100, false);
    input(64, 90, true);
    input(64, 90, false);

    const score = (host.el.stop as () => Score | undefined)();
    expect(score).toBeDefined();
    expect(host.el.recordingActive).toBe(false);
    const total = score!.parts.reduce((sum, p) => sum + p.notes.length, 0);
    expect(total).toBe(2);
    expect(host.el.take).toBe(score);

    const recorded = host.events.filter((e) => e.type === 'webscore:recorded');
    expect(recorded).toHaveLength(1);
    expect((recorded[0].detail as {score: Score}).score).toBe(score);

    host.disconnect();
  });

  it('records webscore:noteon/noteoff from a .source EventTarget', () => {
    const host = createHost(ScoreRecorderElement);
    host.connect();
    const source = new EventTarget();
    host.el.source = source;

    host.el.record();
    source.dispatchEvent(
      new CustomEvent('webscore:noteon', {
        detail: {midi: 62, velocity: 80},
      }),
    );
    source.dispatchEvent(new CustomEvent('webscore:noteoff', {detail: {midi: 62}}));
    const score = (host.el.stop as () => Score | undefined)();

    expect(score).toBeDefined();
    expect(score!.parts.reduce((sum, p) => sum + p.notes.length, 0)).toBe(1);

    // Replacing the source detaches the listeners — further events are ignored.
    host.el.source = undefined;
    host.el.record();
    source.dispatchEvent(
      new CustomEvent('webscore:noteon', {
        detail: {midi: 70, velocity: 80},
      }),
    );
    source.dispatchEvent(new CustomEvent('webscore:noteoff', {detail: {midi: 70}}));
    expect((host.el.stop as () => Score | undefined)()).toBeUndefined(); // nothing captured

    host.disconnect();
  });

  it('records events bubbling through the element itself (light-DOM children)', () => {
    const host = createHost(ScoreRecorderElement);
    host.connect();
    host.el.record();
    (host.el as unknown as EventTarget).dispatchEvent(
      new CustomEvent('webscore:noteon', {
        detail: {midi: 65, velocity: 99},
        bubbles: true,
        composed: true,
      }),
    );
    (host.el as unknown as EventTarget).dispatchEvent(
      new CustomEvent('webscore:noteoff', {
        detail: {midi: 65},
        bubbles: true,
        composed: true,
      }),
    );
    const score = (host.el.stop as () => Score | undefined)();
    expect(score).toBeDefined();
    expect(score!.parts.reduce((sum, p) => sum + p.notes.length, 0)).toBe(1);
    host.disconnect();
  });

  it('an empty take yields no Score and no event', () => {
    const host = createHost(ScoreRecorderElement);
    host.connect();
    host.el.record();
    expect((host.el.stop as () => Score | undefined)()).toBeUndefined();
    expect(host.events.filter((e) => e.type === 'webscore:recorded')).toHaveLength(0);
    host.disconnect();
  });

  it('bpm and quantize attributes are NaN-safe', () => {
    const host = createHost(ScoreRecorderElement, {
      bpm: 'abc',
      quantize: '-1',
    });
    host.connect();
    expect(host.el.bpm).toBe(120);
    expect(host.el.quantize).toBe(0);
    host.disconnect();
  });

  it('memoizes its compatibility style across reconnects', () => {
    const host = createHost(ScoreRecorderElement);
    host.connect();
    host.disconnect();
    host.connect();
    host.disconnect();

    expect(findAll(
      host.root,
      (node) => node.tagName === 'STYLE' && node.dataset.webmusicCompatibility === 'score-recorder',
    )).toHaveLength(1);

    const css = findAll(
      host.root,
      (node) => node.tagName === 'STYLE' && node.dataset.webmusicCompatibility === 'score-recorder',
    )[0]?.textContent;
    expect(css).toContain(
      '--wui-recorder-host-button-border:var(--wm-recorder-button-border,var(--wm-control-border,var(--wm-border,#d8d8d8)))',
    );
    expect(css).toContain('--wm-recorder-button-border:var(--rec-btn-border,var(--wui-recorder-host-button-border))');
    expect(css).not.toContain('--wm-recorder-button-border:var(--rec-btn-border,#111)');
  });

  it('hands a single-route Sound from live monitoring to take playback', async () => {
    const context = {} as AudioContext;
    const param = () => ({value: 1});
    const node = () => ({
      context,
      gain: param(),
      pan: param(),
      connect: vi.fn((destination: AudioNode) => destination),
      disconnect: vi.fn(),
    });
    Object.assign(context, {
      state: 'running',
      currentTime: 0,
      destination: node(),
      createGain: () => node(),
      createStereoPanner: () => node(),
      resume: vi.fn(async () => undefined),
    });
    let routes = 0;
    let cleanups = 0;
    const sound = Sound.custom(() => ({
      connect: () => {
        routes += 1;
        return () => {
          cleanups += 1;
        };
      },
      noteOn: vi.fn(),
      noteOff: vi.fn(),
    }));
    const host = createHost(ScoreRecorderElement);
    host.el.audioContext = context;
    host.el.sound = sound;
    host.connect();
    host.el.record();
    host.el.input(60, 100, true);
    host.el.input(60, 100, false);
    expect(host.el.stop()).toBeDefined();
    expect(routes).toBe(1);

    byAria(host.root, 'Play take').click();
    await flush();

    expect(routes).toBe(2);
    expect(cleanups).toBe(1);
    expect(host.events.filter((event) => event.type === 'webscore:error')).toEqual([]);
    expect(byAria(host.root, 'Play take').classList.contains('on')).toBe(true);
    host.disconnect();
    expect(cleanups).toBe(2);
  });

  it('rolls back recorder playback UI and emits an observable error when play rejects', async () => {
    const failure = new Error('take playback failed');
    vi.spyOn(ScorePlayer.prototype, 'play').mockRejectedValueOnce(failure);
    const host = createHost(ScoreRecorderElement);
    host.connect();
    host.el.record();
    host.el.input(60, 100, true);
    host.el.input(60, 100, false);
    expect(host.el.stop()).toBeDefined();

    const play = byAria(host.root, 'Play take');
    play.click();
    expect(play.classList.contains('on')).toBe(true);
    await flush();

    expect(play.classList.contains('on')).toBe(false);
    expect(play.textContent).toBe('▶ Play');
    const errors = host.events.filter((event) => event.type === 'webscore:error');
    expect(errors).toHaveLength(1);
    expect(errors[0].detail).toEqual({operation: 'play', error: failure});
    host.disconnect();
  });
});
