// @vitest-environment jsdom

import {afterEach, describe, expect, it} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {
  KeyAnalysisElement, ChordAnalysisElement, RomanAnalysisElement, VoiceLeadingAnalysisElement,
  LiveChordAnalysisElement,
} from '../../src/analyze/element/index';

// ---------------------------------------------------------------------------
// Atomic analysis surfaces in a real document. Each tag owns one display;
// host layouts compose independent views and instrument readouts as siblings.
// These cases retain lane, source, lifecycle, naming and accessibility behavior.
// jsdom has no layout; cursor events drive time without waiting for a frame.
// ---------------------------------------------------------------------------

let nextTag = 0;
const define = (ctor: CustomElementConstructor): string => {
  const tag = `webscore-workbench-${nextTag++}`;
  customElements.define(tag, class extends ctor {});
  return tag;
};
const KEY = define(KeyAnalysisElement);
const CHORDS = define(ChordAnalysisElement);
const ROMAN = define(RomanAnalysisElement);
const VOICE = define(VoiceLeadingAnalysisElement);
const LIVE_CHORD = define(LiveChordAnalysisElement);
const FEATURE_TAGS: Record<string, string> = {
  key: KEY, chords: CHORDS, roman: ROMAN, 'voice-leading': VOICE, 'live-chord': LIVE_CHORD,
};

const flush = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 0));

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
const LEAPING = ['C4', 'C6', 'C4', 'C6'];

/** A stub player target; `emit` fires the fake CustomEvent the binding reads. */
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
  };
}

interface MountOptions {
  tag?: string;
  feature?: string;
  score?: Score;
  player?: ReturnType<typeof stubPlayer>;
  /** Presentation attributes supported by the selected display. */
  attrs?: Record<string, string>;
  /**
   * Put the element under a `data-motion` ancestor, which is how a host page
   * declares the preference and how `resolveMotion` reads it. jsdom has no
   * `matchMedia`, and stubbing a global to test a preference tests the stub.
   */
  motion?: 'stepped' | 'continuous' | 'none';
}

async function mount(options: MountOptions = {}) {
  const element = document.createElement(options.tag ?? FEATURE_TAGS[options.feature ?? 'key']) as ChordAnalysisElement;
  for (const [name, value] of Object.entries(options.attrs ?? {})) element.setAttribute(name, value);
  if (options.player) {
    element.setAttribute('player', '#p');
    (element as unknown as {getRootNode: () => ParentNode}).getRootNode = () =>
      ({querySelector: (selector: string) => (selector === '#p' ? options.player : null)}) as never;
  }
  if (options.score) element.score = options.score;
  const seeks: CustomEvent[] = [];
  element.addEventListener('webscore:seek', (event) => seeks.push(event as CustomEvent));
  const views: CustomEvent[] = [];
  element.addEventListener('webscore:viewchange', (event) => views.push(event as CustomEvent));
  const picks: CustomEvent[] = [];
  element.addEventListener('webscore:chordpick', (event) => picks.push(event as CustomEvent));
  if (options.motion) {
    const shell = document.createElement('div');
    shell.dataset.motion = options.motion;
    shell.append(element);
    document.body.append(shell);
  } else document.body.append(element);
  await flush();
  return {
    element,
    seeks,
    views,
    picks,
    get root(): HTMLElement {
      return element.children[0] as HTMLElement;
    },
    get index(): HTMLOListElement {
      return [...element.children[0].children].find(
        (child) => child.tagName === 'OL',
      ) as HTMLOListElement;
    },
    slots(): string[] {
      return [...this.root.querySelectorAll<HTMLElement>('.wui-workbench__stage > [data-slot]')].map(
        (node) => node.dataset.slot!,
      );
    },
    /** The shell's own root — where density, scheme, chrome and motion land. */
    get shell(): HTMLElement {
      return this.root.querySelector('.wui-workbench') as HTMLElement;
    },
    lanes(): (string | undefined)[] {
      return [...this.root.querySelectorAll<HTMLElement>('.wui-harmony-flow__lane')].map(
        (node) => node.dataset.lane,
      );
    },
    text(): string {
      return [...element.children].map(allText).join(' ');
    },
  };
}

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

afterEach(() => {
  document.body.replaceChildren();
});

describe('atomic Analyze displays', () => {
  it('mounts the key decision lane with one presenter', async () => {
    const score = melodyScore(C_MAJOR);
    const flow = await mount({feature: 'key', score});
    expect(flow.slots()).toEqual(['flow']);
    expect(flow.root.querySelector('.wui-harmony-wheel, .wui-harmony-chip')).toBeNull();
    expect(flow.text()).toContain('C major');

    expect(flow.root.querySelector('.wui-workbench__dock, .wui-workbench__tab, .wui-pitch-keyboard')).toBeNull();
  });

  it('mounts the chord timeline as one named chord track', async () => {
    const host = await mount({feature: 'chords', score: melodyScore(C_MAJOR)});
    expect(host.slots()).toEqual(['flow']);
    expect(host.root.querySelectorAll('.wui-harmony-flow__lane')).toHaveLength(1);
    expect(host.root.querySelectorAll('.wui-harmony-flow__lane[data-track="0"] > *').length).toBeGreaterThan(0);
    expect(host.text()).toContain('bar 1 · beat 1');
  });

  it('mounts the roman view as three coupled rows on one reel', async () => {
    const host = await mount({feature: 'roman', score: melodyScore(C_MAJOR)});
    expect(host.slots()).toEqual(['flow']);
    expect(host.root.querySelectorAll('.wui-harmony-flow__reel')).toHaveLength(1);
    expect(host.root.querySelectorAll('.wui-harmony-flow__lane')).toHaveLength(3);
    expect(host.text()).toContain('in C major');
  });



  it('draws voice-leading issues as brackets across the voices they implicate', async () => {
    const host = await mount({feature: 'voice-leading', score: melodyScore(LEAPING)});
    expect(host.root.querySelectorAll('.wui-harmony-flow__bracket').length).toBeGreaterThan(0);
    const rows = [...host.index.children] as HTMLElement[];
    expect(rows[0].textContent).toContain('large leap');
    expect(rows[0].textContent).toContain('voice 1');
  });

  it('keeps the readable clean result when nothing is wrong', async () => {
    const host = await mount({feature: 'voice-leading', score: melodyScore(C_MAJOR)});
    expect(host.index.childElementCount).toBe(0);
    expect(host.text()).toContain('No parallel motion, crossings or leaps over an octave — clean.');
    expect(host.root.querySelector('.wui-workbench')?.getAttribute('data-phase')).toBe('empty');
  });

  it('keeps live naming focused on the currently sounding chord', async () => {
    const player = stubPlayer();
    const hero = await mount({tag: LIVE_CHORD, player});
    expect(hero.slots()).toEqual(['hero']);
    expect(hero.root.querySelector('.wui-harmony-nameplate')?.getAttribute('data-emphasis')).toBe('hero');
    expect(hero.root.querySelector('.wui-harmony-flow')).toBeNull();
    for (const midi of [60, 64, 67]) player.emit('webscore:noteon', {midi});
    expect(hero.text()).toContain('CM');
    for (const midi of [60, 64, 67]) player.emit('webscore:noteoff', {midi});
    expect(hero.element.chord).toBeUndefined();
  });
});

describe('atomic nameplate and score cursor readings', () => {
  it('preserves the exact sounding voicing on the nameplate', async () => {
    const player = stubPlayer();
    const host = await mount({tag: LIVE_CHORD, player});
    for (const midi of [55, 59, 62, 65]) player.emit('webscore:noteon', {midi});
    expect(host.element.chord).toBe('G7');
    const voicing = host.root.querySelector('.wui-harmony-nameplate__voicing')?.textContent ?? '';
    expect(voicing.split(/\s+/).filter(Boolean)).toEqual(['G3', 'B3', 'D4', 'F4']);
  });

  it('follows the score when only a cursor is arriving', async () => {
    const player = stubPlayer();
    const host = await mount({feature: 'chords', score: melodyScore(C_MAJOR), player});
    player.emit('webscore:timeupdate', {seconds: 1.1, nominalSeconds: 1.1});
    const active = [...host.index.children].filter((node) => node.getAttribute('aria-current') === 'true');
    expect(active).toHaveLength(1);
    expect((active[0] as HTMLElement).dataset.startQuarters).toBe('2');
  });
});

describe('focused Analyze displays — the playhead owns the readable twin', () => {
  it('lights exactly one readable chord row', async () => {
    const player = stubPlayer();
    const host = await mount({feature: 'chords', score: melodyScore(C_MAJOR), player});
    const stamped = [...host.root.querySelectorAll<HTMLElement>('[data-start-quarters],[data-spans]')];
    // The lane draws geometry; the semantic list carries the span contract. One
    // instant, one owner: only the readable row carries the active position.
    expect(stamped.every((node) => node.tagName === 'LI')).toBe(true);

    player.emit('webscore:timeupdate', {seconds: 0.1, nominalSeconds: 0.1});
    const lit = stamped.filter((node) => node.getAttribute('aria-current') === 'true');
    expect(lit).toHaveLength(1);
    expect(lit[0]).toBe(stamped[0]);

    player.emit('webscore:timeupdate', {seconds: 9999, nominalSeconds: 9999});
    expect(stamped.filter((node) => node.getAttribute('aria-current') === 'true')).toHaveLength(0);
  });
});

describe('focused Analyze displays — the shell survives what it is asked to do', () => {




  it('takes everything down on disconnect, including the frame it was animating', async () => {
    const player = stubPlayer();
    const host = await mount({feature: 'chords', score: melodyScore(C_MAJOR), player});
    const {element} = host;
    expect(element.children).toHaveLength(1);

    element.remove();
    // No root, no workbench, no clock subscription — and no session cache left
    // to hand a stale analysis to whatever score arrives next.
    expect(element.children).toHaveLength(0);

    document.body.append(element);
    await flush();
    expect(element.children).toHaveLength(1);
    expect(element.children[0].querySelector('.wui-harmony-flow')).toBeTruthy();
  });

  it('seeks in nominal seconds and drives the player in transport ones', async () => {
    const calls: number[] = [];
    const player = Object.assign(stubPlayer(), {seek: (seconds: number) => calls.push(seconds)});
    const host = await mount({feature: 'chords', score: melodyScore(C_MAJOR), player});
    // rate 2: the transport reports half the nominal duration.
    player.emit('webscore:timeupdate', {
      seconds: 0,
      nominalSeconds: 0,
      transportDurationSeconds: (host.element.score?.durationSeconds ?? 0) / 2,
    });

    const band = host.root.querySelectorAll<HTMLElement>('.wui-harmony-flow__lane[data-track="0"] > *')[1];
    band!.dispatchEvent(new MouseEvent('click', {bubbles: true}));

    expect(host.seeks).toHaveLength(1);
    const detail = host.seeks[0].detail as {quarters: number; seconds: number};
    expect(detail.quarters).toBeCloseTo(1, 6);
    expect(detail.seconds).toBeCloseTo(0.5, 6);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeCloseTo(detail.seconds / 2, 6);
  });
});

describe('focused Analyze displays — reduced motion changes the driver, not the picture', () => {
  // §2.5.3 / §G.4, and the one non-negotiable of the whole live turn: under
  // `prefers-reduced-motion` the shell opens NO frame loop, so the conveyor is
  // driven by the element's own notification instead. Freezing it is not an
  // acceptable reading of "less motion" — it hands the readers who asked for
  // less motion the static table this redesign exists to remove, and it is
  // exactly what happens if the shell binding loses its `subscribe`.
  // Pairs 20 ms apart, four bands apart. A stepped lane must move across the
  // four, and must not write twice inside one of them.
  const CURSORS = [0.1, 0.12, 1.1, 1.12, 2.1, 2.12, 3.1, 3.12];

  async function drive(motion: 'stepped' | 'continuous') {
    const player = stubPlayer();
    const host = await mount({feature: 'chords', score: melodyScore(C_MAJOR), player, motion});
    const reel = host.root.querySelector<HTMLElement>('.wui-harmony-flow__reel')!;
    const pinned = host.root.querySelector<HTMLElement>('.wui-harmony-flow__pinned-name')!;
    const transforms = new Set<string>();
    const names = new Set<string>();
    for (const seconds of CURSORS) {
      player.emit('webscore:timeupdate', {seconds, nominalSeconds: seconds});
      transforms.add(reel.style.transform);
      names.add(pinned.textContent ?? '');
    }
    const boxes = [...host.root.querySelectorAll<HTMLElement>('.wui-harmony-flow__band')].map(
      (band) => `${band.style.left}|${band.style.width}`,
    );
    return {host, reel, transforms, names, boxes};
  }

  it('keeps the conveyor moving with no frame loop at all', async () => {
    const stepped = await drive('stepped');
    expect(stepped.host.root.querySelector('.wui-workbench')?.getAttribute('data-motion')).toBe(
      'stepped',
    );
    // The bug this pins: ONE transform for the whole piece, forever, and a
    // pinned name that never leaves the first chord.
    expect(stepped.transforms.size).toBeGreaterThan(1);
    expect(stepped.names.size).toBeGreaterThan(1);
    // Re-anchored on the BAND, not on the instant — which is the saving §2.5.3
    // promises: two cursors inside one chord write the reel once, not twice.
    expect(stepped.transforms.size).toBeLessThan(CURSORS.length);
  });

  it('draws the same picture either way — only the driver differs', async () => {
    const stepped = await drive('stepped');
    const continuous = await drive('continuous');
    expect(stepped.boxes).toEqual(continuous.boxes);
    expect(stepped.boxes.length).toBeGreaterThan(0);
    // And the division of labour, stated: under continuous motion the shared
    // frame loop owns the reel, so a cursor alone does not move it — which is
    // exactly why the stepped path needs a driver of its own rather than a
    // disabled one.
    expect(continuous.transforms.size).toBe(1);
  });
});

describe('focused Analyze displays — score boundaries', () => {
  it('keeps only the current chord active across a score boundary', async () => {
    const player = stubPlayer();
    // A viewing window may cross the boundary, but the active chord cannot.
    const builder = new ScoreBuilder();
    const partId = builder.newPartId();
    builder.addPart({id: partId, name: 'Keys'});
    const voice = VoiceId(`${partId}-v1`);
    const add = (name: string, at: number): void => {
      builder.addNote(partId, {
        id: builder.newNoteId(),
        pitch: Pitch.parse(name),
        onsetQuarters: new Rational(at),
        duration: Duration.whole(),
        voice,
      });
    };
    for (const name of ['C4', 'E4', 'G4']) add(name, 0);
    for (const name of ['F4', 'A4', 'C5']) add(name, 4);
    const host = await mount({feature: 'chords', score: builder.build(), player});

    const active = (): string[] => [...host.index.children]
      .filter((node) => node.getAttribute('aria-current') === 'true')
      .map((node) => node.textContent ?? '');

    // 120 bpm: the last eighth of the first bar. The C major is still the only
    // thing a listener has heard.
    player.emit('webscore:timeupdate', {seconds: 1.75, nominalSeconds: 1.75});
    expect(active()).toHaveLength(1);
    expect(active()[0]).toContain('CM');

    player.emit('webscore:timeupdate', {seconds: 2.0, nominalSeconds: 2.0});
    expect(active()).toHaveLength(1);
    expect(active()[0]).toContain('FM');
  });

  it('parks at the double bar instead of counting bars nobody wrote', async () => {
    const player = stubPlayer();
    const host = await mount({feature: 'chords', score: melodyScore(C_MAJOR), player});
    player.emit('webscore:timeupdate', {seconds: 9999, nominalSeconds: 9999, playing: false});
    const slider = host.root.querySelector('[role="slider"]')!;
    const detail = slider.getAttribute('aria-valuetext');
    // 13 quarters at 120 bpm is bar 4, beat 2 — not bar 5000.
    expect(detail).toBe('bar 4 · beat 2');

    player.emit('webscore:end');
    expect(slider.getAttribute('aria-valuetext')).toBe(detail);
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeCloseTo(host.element.score!.durationSeconds);
    // Nothing is arriving any more, so nothing is animating: the shell only
    // opens a frame loop for `playing` and `listening`.
    expect(host.root.querySelector('.wui-workbench')?.getAttribute('data-phase')).toBe('idle');
  });
});

describe('focused Analyze displays — the controls are controls', () => {

  it('promotes an alternate reading on the standalone nameplate', async () => {
    const player = stubPlayer();
    const host = await mount({tag: LIVE_CHORD, player});
    for (const midi of [60, 64, 67, 69]) player.emit('webscore:noteon', {midi}); // C6 / Am7
    const alternates = [...host.root.querySelectorAll<HTMLButtonElement>(
      '.wui-harmony-nameplate__alternate',
    )];
    expect(alternates.length).toBeGreaterThan(0);
    const wanted = alternates[0].textContent ?? '';

    alternates[0].click();
    expect(host.picks).toHaveLength(1);
    const detail = host.picks[0].detail as {symbol: string; midis: number[]};
    expect(wanted.startsWith(detail.symbol)).toBe(true);
    expect(detail.midis).toEqual([60, 64, 67, 69]);
    expect(host.element.chord).toBe(detail.symbol);
    expect(host.root.querySelector('.wui-harmony-nameplate__symbol')?.textContent).toBe(detail.symbol);
  });



  it('does not reload the score when presentation attributes change', async () => {
    // One `AbortController` per attempted `src` load — the source builds one
    // only on that path, so counting them counts loads.
    let loads = 0;
    const Original = globalThis.AbortController;
    globalThis.AbortController = class extends Original {
      constructor() {
        super();
        loads += 1;
      }
    } as typeof AbortController;
    try {
      const element = document.createElement(CHORDS) as ChordAnalysisElement;
      element.setAttribute('src', 'song.mid');
      document.body.append(element);
      await flush();
      expect(loads).toBe(1);

      for (const [name, value] of Object.entries({window: '4', density: 'compact', scheme: 'dark', motion: 'stepped'})) {
        element.setAttribute(name, value);
        await flush();
      }
      // Presentation changes preserve the loaded source and its pending request.
      expect(loads).toBe(1);

      element.setAttribute('window', '4');
      await flush();
      expect(loads).toBe(1);
      element.remove();
    } finally {
      globalThis.AbortController = Original;
    }
  });
});

// ---------------------------------------------------------------------------
// External presentation attributes. Each assertion checks the mounted display;
// parameter controls belong to the host application and are not embedded here.
// ---------------------------------------------------------------------------

describe('focused Analyze displays — every attribute reaches a surface', () => {

  it('drops the merged function row out of the roman reel', async () => {
    const withRow = await mount({feature: 'roman', score: melodyScore(C_MAJOR)});
    expect(withRow.lanes()).toEqual(['key', 'function', 'roman']);

    const without = await mount({
      feature: 'roman',
      score: melodyScore(C_MAJOR),
      attrs: {function: 'hide'},
    });
    // The row is REMOVED, not emptied: a labelled blank stripe on the reel is
    // the static this redesign exists to delete. Which means the numerals moved
    // up a row, and the pinned read-out has to have moved with them.
    expect(without.lanes()).toEqual(['key', 'roman']);
    expect(without.root.querySelectorAll('.wui-harmony-flow__lane[data-track="1"] > *').length)
      .toBeGreaterThan(0);
    expect(without.text()).toContain('in C major');
  });

  it('takes the other readings off the name plate', async () => {
    const player = stubPlayer();
    const host = await mount({tag: LIVE_CHORD, player, attrs: {alternates: 'hide'}});
    for (const midi of [60, 64, 67, 69]) player.emit('webscore:noteon', {midi});
    // Dropped from the SNAPSHOT, so the kit renders no button at all — a
    // focusable node with nothing behind it is a trap, not a tidier plate.
    expect(host.root.querySelectorAll('.wui-harmony-nameplate__alternate')).toHaveLength(0);
    expect(host.root.querySelector('.wui-harmony-nameplate__symbol')?.textContent).toBeTruthy();
  });

  it('updates display density in place and follows the host colour scheme', async () => {
    const host = await mount({feature: 'chords', score: melodyScore(C_MAJOR), attrs: {density: 'compact', scheme: 'dark'}});
    expect(host.shell.dataset.density).toBe('compact');
    expect(host.shell.dataset.scheme).toBe('dark');
    const shell = host.shell;
    const lane = host.root.querySelector('.wui-harmony-flow');
    host.element.density = 'comfortable';
    expect(host.shell).toBe(shell);
    expect(host.shell.dataset.density).toBe('comfortable');
    expect(host.root.querySelector('.wui-harmony-flow')).toBe(lane);
    const following = await mount({feature: 'chords', score: melodyScore(C_MAJOR)});
    expect(following.shell.dataset.density).toBe('comfortable');
    expect(following.shell.dataset.scheme).toBeUndefined();
  });

  it('applies spelling to the chord symbol and exact voicing', async () => {
    const flatPlayer = stubPlayer();
    const flat = await mount({tag: LIVE_CHORD, player: flatPlayer, attrs: {spelling: 'flat'}});
    for (const midi of [61, 65, 68]) flatPlayer.emit('webscore:noteon', {midi});
    expect(flat.element.chord).toBe('DbM');
    expect(
      flat.root.querySelector('.wui-harmony-nameplate__voicing')?.textContent?.split(/\s+/).filter(Boolean),
    ).toEqual(['Db4', 'F4', 'Ab4']);

    const sharpPlayer = stubPlayer();
    const sharp = await mount({tag: LIVE_CHORD, player: sharpPlayer, attrs: {spelling: 'sharp'}});
    for (const midi of [61, 65, 68]) sharpPlayer.emit('webscore:noteon', {midi});
    expect(sharp.element.chord).toBe('C#M');
    expect(
      sharp.root.querySelector('.wui-harmony-nameplate__voicing')?.textContent?.split(/\s+/).filter(Boolean),
    ).toEqual(['C#4', 'E#4', 'G#4']);
  });

  it('renders the analysis alone without opt-in shell attributes', async () => {
    const host = await mount({feature: 'chords', score: melodyScore(C_MAJOR)});
    expect(host.shell.dataset.chrome).toBe('bare');
    expect(host.root.querySelectorAll('.wui-workbench__tab')).toHaveLength(0);
    expect(host.root.querySelectorAll('.wui-workbench__dock')).toHaveLength(0);
    expect(host.root.querySelector('.wui-workbench__header, .wui-workbench__status, .wui-workbench__dock-toggle')).toBeNull();
    // The analysis and its readable index remain available.
    expect(host.root.querySelector('.wui-harmony-flow')).toBeTruthy();
    expect(host.index.childElementCount).toBeGreaterThan(0);
  });

  it('answers the motion question for every surface below it', async () => {
    const host = await mount({
      feature: 'chords',
      score: melodyScore(C_MAJOR),
      attrs: {motion: 'stepped'},
    });
    // The containing display and its timeline use the same motion policy.
    expect(host.shell.dataset.motion).toBe('stepped');
    expect(host.root.querySelector<HTMLElement>('.wui-harmony-flow')?.dataset.motion).toBe('stepped');
  });

  it('overrides a `data-motion` ancestor, and `auto` does not', async () => {
    const named = await mount({
      feature: 'chords',
      score: melodyScore(C_MAJOR),
      motion: 'stepped',
      attrs: {motion: 'continuous'},
    });
    expect(named.shell.dataset.motion).toBe('continuous');

    // `auto` is the element declining to answer, not a synonym for continuous:
    // the host page's declaration still wins, and so would the viewer's own
    // `prefers-reduced-motion` under it.
    const auto = await mount({
      feature: 'chords',
      score: melodyScore(C_MAJOR),
      motion: 'stepped',
      attrs: {motion: 'auto'},
    });
    expect(auto.shell.dataset.motion).toBe('stepped');
  });

  it('sizes the conveyor to the field of view `window` asks for', async () => {
    const reel = (host: {root: HTMLElement}): string =>
      host.root.querySelector<HTMLElement>('.wui-harmony-flow__reel')?.style.width ?? '';

    const near = await mount({feature: 'chords', score: melodyScore(C_MAJOR), attrs: {window: '4'}});
    const far = await mount({feature: 'chords', score: melodyScore(C_MAJOR), attrs: {window: '32'}});
    // Same material, same piece: only how much of it is in shot differs, so the
    // reel a four-second field is drawn on is eight times the width.
    expect(Number.parseFloat(reel(near))).toBeCloseTo(Number.parseFloat(reel(far)) * 8, 4);

    // `auto` is eight bars of THIS piece — 13 quarters of 4/4 at 120 bpm — so
    // it lands between the two rather than at either edge.
    const auto = await mount({feature: 'chords', score: melodyScore(C_MAJOR)});
    expect(Number.parseFloat(reel(auto))).toBeGreaterThan(Number.parseFloat(reel(far)));
    expect(Number.parseFloat(reel(auto))).toBeLessThan(Number.parseFloat(reel(near)));
  });

  it('rebuilds the lane in place when the field of view changes', async () => {
    const host = await mount({feature: 'chords', score: melodyScore(C_MAJOR), attrs: {window: '16'}});
    const before = host.root.querySelector<HTMLElement>('.wui-harmony-flow__reel')!.style.width;
    const slot = host.root.querySelector<HTMLElement>('[data-slot="flow"]')!;

    host.element.setAttribute('window', '4');
    await flush();
    // The lane sizes its reel once, at mount, so a new field of view is a new
    // lane — but the HOST stays, or the conveyor would jump to the end of the
    // stage every time somebody zoomed.
    expect(host.root.querySelector<HTMLElement>('[data-slot="flow"]')).toBe(slot);
    expect(host.slots()).toEqual(['flow']);
    expect(host.root.querySelector<HTMLElement>('.wui-harmony-flow__reel')!.style.width).not.toBe(
      before,
    );
  });
});

describe('focused Analyze displays — external attribute reconciliation', () => {
  it('survives a host that mirrors the window attribute straight back', async () => {
    const host = await mount({feature: 'chords', score: melodyScore(C_MAJOR)});
    let mirrored = host.element.getAttribute('window');
    const observer = new MutationObserver(() => {
      const value = host.element.getAttribute('window');
      if (value === mirrored) return;
      mirrored = value;
      host.element.setAttribute('window', value ?? '');
    });
    observer.observe(host.element, {attributes: true, attributeFilter: ['window']});
    try {
      host.element.window = 4;
      await flush();
      expect(host.element.window).toBe(4);
      expect(host.slots()).toEqual(['flow']);
      expect(host.lanes()).toEqual(['chords']);
      expect(host.element.children).toHaveLength(1);
      expect(host.views).toHaveLength(0);
    } finally {
      observer.disconnect();
    }
  });
});

describe('focused Analyze displays — the events leave the element', () => {
  it('bubbles and composes every one of them', async () => {
    const seen: CustomEvent[] = [];
    const collect = (event: Event): void => {
      seen.push(event as CustomEvent);
    };
    for (const type of ['webscore:chordpick', 'webscore:seek', 'webscore:chordchange']) {
      document.addEventListener(type, collect);
    }
    try {
      const player = stubPlayer();
      const host = await mount({feature: 'chords', score: melodyScore(C_MAJOR), player});
      const nameplate = await mount({tag: LIVE_CHORD, player});
      for (const midi of [60, 64, 67, 69]) player.emit('webscore:noteon', {midi});
      nameplate.root.querySelector<HTMLButtonElement>('.wui-harmony-nameplate__alternate')!.click();
      await flush();
      host.root
        .querySelector<HTMLElement>('.wui-harmony-flow__lane[data-track="0"] > *')!
        .dispatchEvent(new MouseEvent('click', {bubbles: true}));

      // Reached `document` at all, which is the half `bubbles` answers; and
      // `composed`, which is the half that matters the day a consumer puts this
      // card inside a shadow root.
      const types = seen.map((event) => event.type);
      expect(new Set(types)).toEqual(
        new Set(['webscore:chordchange', 'webscore:chordpick', 'webscore:seek']),
      );
      expect(seen.every((event) => event.composed)).toBe(true);
      // The one shape that is frozen: existing consumers pin `{chord, midis}`.
      const change = seen.find((event) => event.type === 'webscore:chordchange')!;
      expect(Object.keys(change.detail as object).sort()).toEqual(['chord', 'midis']);
    } finally {
      for (const type of ['webscore:chordpick', 'webscore:seek', 'webscore:chordchange']) {
        document.removeEventListener(type, collect);
      }
    }
  });
});

describe('focused Analyze displays — an unreadable attribute says so, once', () => {
  it('falls back and warns exactly once, not once per cursor', async () => {
    const warnings: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]): void => {
      warnings.push(args);
    };
    try {
      const player = stubPlayer();
      const host = await mount({
        feature: 'chords',
        score: melodyScore(C_MAJOR),
        player,
        attrs: {density: 'roomy', motion: 'fast', window: 'wide'},
      });
      for (const seconds of [0.1, 0.2, 0.3, 0.4, 0.5]) {
        player.emit('webscore:timeupdate', {seconds, nominalSeconds: seconds});
      }

      // Three bad values, three sentences — and five cursors later, still three.
      // A paint path running twenty times a second that repeats its complaint
      // is a complaint nobody reads.
      const said = warnings.map((args) => String(args[0]));
      expect(said.filter((line) => line.includes('density="roomy"'))).toHaveLength(1);
      expect(said.filter((line) => line.includes('motion="fast"'))).toHaveLength(1);
      expect(said.filter((line) => line.includes('window="wide"'))).toHaveLength(1);

      // …and every one of them fell back to the documented default rather than
      // to nothing, so the panel still reads.
      expect(host.shell.dataset.density).toBe('comfortable');
      expect(host.element.motion).toBe('auto');
      expect(host.element.window).toBe('auto');
      expect(host.slots()).toEqual(['flow']);
    } finally {
      console.warn = original;
    }
  });

});
