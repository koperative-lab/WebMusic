// @vitest-environment jsdom

import {afterEach, describe, expect, it} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {ChordAnalysisElement} from '../../src/analyze/element/index';

// ---------------------------------------------------------------------------
// A real document, real custom elements, real CSSOM — the harness this
// directory uses. Rendering is real here.
// LAYOUT AND TIME ARE NOT, and the next author needs the exact list, because
// the missing pieces are silent: they read back as zero or as `undefined`,
// never as a failure.
//
// Measured on vitest 3.2.7 / jsdom 24.1.3 — what this document does NOT have:
//   · layout. `getBoundingClientRect()`, `offsetWidth` and `clientWidth` are
//     all 0, even after an explicit inline width. Anything sized from a
//     measurement is therefore vacuously true here, not red.
//   · `matchMedia`, `ResizeObserver`, `IntersectionObserver`,
//     `Element.prototype.animate`, `Element.prototype.scrollIntoView` — all
//     absent. A mount that calls one unguarded throws on its first frame.
//   · custom-property inheritance. `getComputedStyle(child)` resolves a
//     `--wui-*` token only where the declaring rule matches the element
//     itself; a token declared on `:root` reads back as `''` on a descendant.
//     Numeric geometry must never be read from a token in a jsdom test.
//
// And two CSSOM behaviours that bite silently:
//   · `style.cssText` round-trips through a normalising serialiser —
//     `color:RED;padding:.2rem` reads back as `color: red; padding: 0.2rem;`.
//     Compare against the normalised form, or use `getPropertyValue`.
//   · because the getter appends `;`, `el.style.cssText += ';x'` produces `;;`
//     and cssstyle truncates the declaration list there. The addition is lost
//     under jsdom although it works in a browser. Never assert on one.
//
// TIME HERE IS REAL. jsdom's `requestAnimationFrame` is a ~16 ms wall-clock
// timer, and `flush()` below is a real macrotask — so a blanket
// `vi.useFakeTimers()` deadlocks every `await flush()` in this file unless each
// one is advanced with `advanceTimersByTimeAsync`. A live mount must be driven
// through an injected clock, never by waiting on a frame.
//
// The only fakes left are the player and the root that resolves it: jsdom
// exposes no listener count, and four assertions here are listener counts.
//
// The SSR cases that used to live here — "constructs without a DOM",
// "customElements is undefined", the `define*` no-ops and call counts — moved
// to `elements-ssr.test.ts`, which runs in the `node` environment.
// ---------------------------------------------------------------------------

let nextTag = 0;

/** Register one element class under a unique tag. */
function define(ctor: CustomElementConstructor): string {
  const tag = `webscore-analysis-${nextTag++}`;
  customElements.define(tag, class extends ctor {});
  return tag;
}

const CHORDS = define(ChordAnalysisElement);
const LIVE_CHORD = define(ChordAnalysisElement);

/**
 * All text in a rendered subtree, one text node at a time. Joined with a space
 * rather than concatenated, so two sibling labels never fuse into a phrase that
 * was never rendered, such as two adjacent chord spellings running together.
 */
function allText(node: Node): string {
  const parts: string[] = [];
  const walk = (current: Node): void => {
    if (current.nodeType === current.TEXT_NODE) {
      parts.push(current.nodeValue ?? '');
      return;
    }
    for (const child of [...current.childNodes]) walk(child);
  };
  walk(node);
  return parts.join(' ');
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The `getRootNode()` surface `bindAnalysisPlayer` reads to resolve `player`. */
interface PlayerRoot {
  querySelector(selector: string): unknown;
}

/**
 * Mount one analysis element in the document. The player targets are stubs
 * rather than elements, so `getRootNode` is overridden per instance — that one
 * method is the whole seam `bindAnalysisPlayer` looks through.
 *
 * `dispatchEvent` is wrapped rather than replaced: every event the element
 * fires on itself is recorded **and** really dispatched, so `dispatched` is a
 * complete log, including the intermediate readings emitted as notes arrive.
 */
function createHost<T extends ChordAnalysisElement>(
  tag: string,
  attrs: Record<string, string> = {},
  root?: PlayerRoot,
) {
  const el = document.createElement(tag) as unknown as T;
  if (tag === LIVE_CHORD) el.mode = 'live';
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  if (root) (el as unknown as {getRootNode: () => PlayerRoot}).getRootNode = () => root;
  const dispatched: Array<{type: string; detail: unknown}> = [];
  const nativeDispatch = el.dispatchEvent.bind(el);
  el.dispatchEvent = (event: Event): boolean => {
    dispatched.push({type: event.type, detail: (event as CustomEvent<unknown>).detail});
    return nativeDispatch(event);
  };
  return {
    el,
    dispatched,
    /** The element's rendered children — spread; jsdom hands back a live collection. */
    get children(): HTMLElement[] {
      return [...el.children] as HTMLElement[];
    },
    /** Rendered text of the element's current content. */
    text: () => [...el.children].map(allText).join(' '),
    setAttribute: (name: string, value: string) => el.setAttribute(name, value),
    connect: () => document.body.append(el),
    disconnect: () => el.remove(),
  };
}

/** A stub player target recording listeners; `emit` fires a fake CustomEvent. */
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
    emit(type: string, detail?: unknown) {
      listeners.get(type)?.forEach((listener) => listener({type, detail}));
    },
    count(type: string): number {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function melodyScore(pitches: string[]): Score {
  const builder = new ScoreBuilder();
  const partId = builder.newPartId();
  builder.addPart({id: partId, name: 'Melody'});
  const voice = VoiceId(`${partId}-v1`);
  pitches.forEach((name, index) => {
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(name),
      onsetQuarters: new Rational(index),
      duration: Duration.quarter(),
      voice,
    });
  });
  return builder.build();
}

const C_MAJOR = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'G4', 'E4', 'C4', 'G4', 'C4'];

afterEach(() => {
  document.body.replaceChildren();
});

describe('focused Analyze displays', () => {
  it('chord-analysis renders the chord timeline', async () => {
    const host = createHost<ChordAnalysisElement>(CHORDS);
    host.el.score = melodyScore(C_MAJOR);
    host.connect();
    await flush();

    const root = host.children[0];
    const ol = [...root.children].find((child) => child.tagName === 'OL');
    expect(ol).toBeDefined();
    expect(ol!.children.length).toBeGreaterThan(0);
    expect(host.text()).toContain('beat 1');
  });

});

describe('<score-chord-analysis mode="live"> (dynamic, player-bound)', () => {
  function liveHost() {
    const player = stubPlayer();
    const host = createHost<ChordAnalysisElement>(
      LIVE_CHORD,
      {player: '#p'},
      {querySelector: (sel) => (sel === '#p' ? player : null)},
    );
    return {player, host};
  }

  it('renders without a score and shows the waiting state', async () => {
    const {host} = liveHost();
    host.connect();
    await flush();
    expect(host.text()).not.toContain('sounding now');
    const caption = host.el.querySelector<HTMLElement>('.wui-harmony-nameplate__caption');
    expect(caption?.hidden).toBe(true);
    expect(caption?.textContent).toBe('');
    expect(host.el.querySelector('.wui-harmony-nameplate')?.hasAttribute('data-caption')).toBe(false);
    expect(host.el.querySelector('.wui-harmony-nameplate__empty')?.textContent).toBe('—');
    expect(host.el.chord).toBeUndefined();
    expect(host.text()).toContain('—');
  });

  it('names the sounding chord from noteon events and clears on noteoff', async () => {
    const {player, host} = liveHost();
    host.connect();
    await flush();

    for (const midi of [60, 64, 67]) player.emit('webscore:noteon', {midi}); // C E G
    expect(host.text()).toContain('C');
    expect(host.text()).toContain('C4');
    expect(host.text()).toContain('G4');

    for (const midi of [60, 64, 67]) player.emit('webscore:noteoff', {midi});
    expect(host.text()).toContain('—');
  });

  it('mounts one UI nameplate without embedding instrument views', async () => {
    const {player, host} = liveHost();
    host.connect();
    await flush();
    expect(host.el.querySelectorAll('.wui-harmony-nameplate')).toHaveLength(1);
    expect(host.el.querySelector('.wui-harmony-nameplate__symbol')).not.toBeNull();
    expect(host.el.querySelector('.wui-pitch-keyboard, .wui-pitch-staff, .wui-pitch-fretboard, .wui-harmony-flow')).toBeNull();
    for (const midi of [60, 64, 67]) player.emit('webscore:noteon', {midi});
    expect(host.el.querySelector('.wui-harmony-nameplate__symbol')?.textContent).toBe('C');
    expect(host.el.querySelector('.wui-harmony-nameplate__voicing')?.textContent).toContain('C4');
  });

  it('shows literal pitches at a stable height when a held set has no chord name', async () => {
    const {player, host} = liveHost();
    host.connect();
    await flush();
    const plate = host.el.querySelector<HTMLElement>('.wui-harmony-nameplate')!;
    const symbol = host.el.querySelector<HTMLElement>('.wui-harmony-nameplate__symbol')!;
    const height = getComputedStyle(plate).height;
    expect(plate.dataset.layout).toBe('stable');

    player.emit('webscore:noteon', {midi: 69});
    player.emit('webscore:noteon', {midi: 81});
    expect(symbol.textContent).toBe('');
    expect(host.el.querySelector('.wui-harmony-nameplate__voicing')?.textContent).toBe('A4  A5');
    expect(host.el.querySelector('.wui-harmony-nameplate__caption')?.textContent).toBe('');
    expect(symbol.parentElement?.style.gridRow).toBe('1');
    expect(host.el.querySelector<HTMLElement>('.wui-harmony-nameplate__voicing')?.style.gridRow).toBe('2');
    expect(host.el.chord).toBeUndefined();
    expect(plate.dataset.reading).toBe('notes');
    expect(getComputedStyle(plate).height).toBe(height);

    player.emit('webscore:noteoff', {midi: 69});
    player.emit('webscore:noteoff', {midi: 81});
    for (const midi of [60, 64, 67]) player.emit('webscore:noteon', {midi});
    expect(symbol.textContent).toBe('C');
    expect(plate.dataset.reading).toBe('chord');
    expect(getComputedStyle(plate).height).toBe(height);

    for (const midi of [60, 64, 67]) player.emit('webscore:noteoff', {midi});
    expect(symbol.textContent).toBe('—');
    expect(plate.dataset.reading).toBe('rest');
    expect(getComputedStyle(plate).height).toBe(height);
  });

  it('dispatches webscore:chordchange after the displayed chord settles', async () => {
    const {player, host} = liveHost();
    host.connect();
    await flush();

    for (const midi of [60, 64, 67]) player.emit('webscore:noteon', {midi});
    // The display is immediate; the short stability window collapses the
    // intermediate names before the external event.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const changes = host.dispatched.filter((event) => event.type === 'webscore:chordchange');
    expect(changes).toHaveLength(1);
    const last = changes[changes.length - 1]!.detail as {chord: string; midis: number[]};
    expect(last.chord).toBe('C');
    expect(last.midis).toEqual([60, 64, 67]);
  });

  it('webscore:end clears the sounding state; disconnect removes listeners', async () => {
    const {player, host} = liveHost();
    host.connect();
    await flush();

    player.emit('webscore:noteon', {midi: 60});
    player.emit('webscore:end');
    expect(host.el.querySelector('.wui-harmony-nameplate__empty')?.textContent).toBe('—');
    expect(host.el.chord).toBeUndefined();

    host.disconnect();
    expect(player.count('webscore:noteon')).toBe(0);
    expect(player.count('webscore:timeupdate')).toBe(0);
    expect(player.count('webscore:end')).toBe(0);
  });
});

describe('live chord player ownership', () => {
  it('live-chord-analysis drops sounding notes when the player selector changes', async () => {
    const playerA = stubPlayer();
    const playerB = stubPlayer();
    const host = createHost<ChordAnalysisElement>(
      LIVE_CHORD,
      {player: '#a'},
      {
        querySelector: (selector) =>
          selector === '#a' ? playerA : selector === '#b' ? playerB : null,
      },
    );
    host.connect();
    await flush();

    for (const midi of [60, 64, 67]) playerA.emit('webscore:noteon', {midi});
    expect(host.text()).toContain('C');

    host.setAttribute('player', '#b');
    await flush();
    expect(playerA.count('webscore:noteon')).toBe(0);
    expect(playerB.count('webscore:noteon')).toBe(1);
    expect(host.el.querySelector('.wui-harmony-nameplate__empty')?.textContent).toBe('—');
    expect(host.el.chord).toBeUndefined();

    const changeCount = host.dispatched.filter((event) => event.type === 'webscore:chordchange').length;
    for (const midi of [62, 66, 69]) playerB.emit('webscore:noteon', {midi});
    await new Promise((resolve) => setTimeout(resolve, 100));
    const changes = host.dispatched
      .filter((event) => event.type === 'webscore:chordchange')
      .slice(changeCount);
    const last = changes[changes.length - 1]!.detail as {chord: string; midis: number[]};
    expect(last.midis).toEqual([62, 66, 69]);
    expect(last.midis).not.toContain(60);
  });
});

describe('<score-chord-analysis> playhead follow', () => {
  it('highlights the segment under the playhead on webscore:timeupdate', async () => {
    const player = stubPlayer();
    const host = createHost<ChordAnalysisElement>(
      CHORDS,
      {player: '#p'},
      {querySelector: (sel) => (sel === '#p' ? player : null)},
    );
    host.el.score = melodyScore(C_MAJOR);
    host.connect();
    await flush();

    const segments = [...host.children[0].querySelectorAll<HTMLElement>('[data-start-quarters]')];
    expect(segments.length).toBeGreaterThan(0);

    // The default tempo maps the first quarters to the first seconds — a tick
    // just after the start must land inside the first segment.
    player.emit('webscore:timeupdate', {seconds: 0.1});
    const active = segments.filter((node) => String(node.style.cssText ?? '').includes('outline'));
    expect(active).toHaveLength(1);
    expect(active[0]).toBe(segments[0]);

    // Past the end of the piece, the highlight clears.
    player.emit('webscore:timeupdate', {seconds: 9999});
    const stillActive = segments.filter((node) => String(node.style.cssText ?? '').includes('outline'));
    expect(stillActive).toHaveLength(0);
  });
});

describe('analysis player lookup scope', () => {
  it('finds a player that lives in the same shadow root', async () => {
    // A host inside a shadow root cannot see the light DOM, and
    // `document.querySelector` cannot see into the shadow: the selector has to
    // be resolved against `getRootNode()`. Pinned with a real shadow root and a
    // real player rather than by overriding `getRootNode` on the instance,
    // which proves only that the method was CALLED — this fails if the element
    // ever reaches for `document` instead.
    const outer = document.createElement('div');
    document.body.append(outer);
    const root = outer.attachShadow({mode: 'open'});

    const player = document.createElement('div');
    player.id = 'shadowed-player';
    let noteonListeners = 0;
    const add = player.addEventListener.bind(player);
    player.addEventListener = ((type: string, fn: EventListener, options?: unknown) => {
      if (type === 'webscore:noteon') noteonListeners += 1;
      add(type, fn, options as AddEventListenerOptions);
    }) as typeof player.addEventListener;
    root.append(player);

    const el = document.createElement(LIVE_CHORD);
    el.setAttribute('player', '#shadowed-player');
    root.append(el);
    await flush();

    expect(noteonListeners).toBe(1);
    for (const midi of [60, 64, 67]) {
      player.dispatchEvent(new CustomEvent('webscore:noteon', {detail: {midi}}));
    }
    expect(el.textContent).toContain('C');
    outer.remove();
  });
});
