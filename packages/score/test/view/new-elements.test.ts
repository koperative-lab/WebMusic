// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {createScoreMap} from '../../src/view/core/map';
import {
  PitchViewElement,
  ScoreViewElement,
  SheetViewElement,
} from '../../src/view/element/index';

let nextTag = 0;
function define(ctor: CustomElementConstructor): string {
  const tag = `webscore-view-${nextTag++}`;
  customElements.define(tag, ctor);
  return tag;
}

const flush = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Settle the several dynamic imports an element chains before it paints.
 * Deadline-based rather than tick-counted: OSMD's load is real work, and a
 * fixed number of zero-delay ticks starves under a loaded full-suite run.
 */
async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Four bars of quarter notes in 4/4, the second bar marked "A". */
function fourBars(pitches: string[] = ['C4', 'E4', 'G4', 'C5', 'G4', 'E4', 'C4', 'G4']): Score {
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
  for (let bar = 0; bar < 4; bar += 1) {
    builder.addMeasure({
      id: builder.newMeasureId(),
      number: bar + 1,
      onsetQuarters: new Rational(bar * 4),
      durationQuarters: new Rational(4),
      ...(bar === 1 ? {rehearsal: 'A'} : {}),
    });
  }
  return builder.build();
}

/** Two parts, all the notes in the first — so a part filter changes density. */
function twoParts(): Score {
  const builder = new ScoreBuilder();
  const lead = builder.newPartId();
  const bass = builder.newPartId();
  builder.addPart({id: lead, name: 'Lead'});
  builder.addPart({id: bass, name: 'Bass'});
  for (let index = 0; index < 8; index += 1) {
    builder.addNote(lead, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C5'),
      onsetQuarters: new Rational(index),
      duration: Duration.quarter(),
      voice: VoiceId(`${lead}-v1`),
    });
  }
  builder.addNote(bass, {
    id: builder.newNoteId(),
    pitch: Pitch.parse('C2'),
    onsetQuarters: new Rational(0),
    duration: Duration.whole(),
    voice: VoiceId(`${bass}-v1`),
  });
  return builder.build();
}

async function mount<T extends HTMLElement>(
  tag: string,
  score: Score | undefined,
  attrs: Record<string, string> = {},
): Promise<T> {
  const element = document.createElement(tag) as T & {score?: Score};
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  if (score) element.score = score;
  document.body.append(element);
  await flush();
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('createScoreMap', () => {
  it.each([0, 2, 4, 8])('counts a zero-length note at quarter %s exactly once', (onset) => {
    const builder = new ScoreBuilder();
    const part = builder.newPartId();
    builder.addPart({id: part, name: 'Grace'});
    for (const index of [0, 1]) builder.addMeasure({
      id: builder.newMeasureId(), number: index + 1,
      onsetQuarters: new Rational(index * 4), durationQuarters: new Rational(4),
    });
    builder.addNote(part, {
      id: builder.newNoteId(), pitch: Pitch.parse('C4'), onsetQuarters: new Rational(onset),
      duration: new Duration({base: 0}), voice: VoiceId('grace'),
    });
    const map = createScoreMap(builder.build());
    expect(map.cells.map((cell) => cell.count)).toEqual(onset < 4 ? [1, 0] : [0, 1]);
  });

  it('projects one cell per measure with a normalized density', () => {
    const map = createScoreMap(fourBars());

    expect(map.cells).toHaveLength(4);
    expect(map.cells[0]!.firstMeasure).toBe(1);
    expect(map.cells[0]!.count).toBe(4);
    expect(map.cells[0]!.density).toBe(1);
    expect(map.durationQuarters).toBe(16);
    // Bars 3 and 4 are past the last note, so the strip shows them empty.
    expect(map.cells[3]!.count).toBe(0);
    expect(map.cells[3]!.density).toBe(0);
  });

  it('groups measures evenly to stay under the cell budget', () => {
    const map = createScoreMap(fourBars(), {maxCells: 2});

    expect(map.cells).toHaveLength(2);
    expect(map.cells[0]!.firstMeasure).toBe(1);
    expect(map.cells[0]!.lastMeasure).toBe(2);
    expect(map.cells[0]!.count).toBe(8);
  });

  it('divides the score evenly when it carries no bar structure', () => {
    const builder = new ScoreBuilder();
    const partId = builder.newPartId();
    builder.addPart({id: partId, name: 'Melody'});
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C4'),
      onsetQuarters: new Rational(0),
      duration: Duration.whole(),
      voice: VoiceId(`${partId}-v1`),
    });
    const map = createScoreMap(builder.build());

    expect(map.cells.length).toBeGreaterThan(1);
    expect(map.cells[0]!.firstMeasure).toBeUndefined();
    expect(map.marks).toHaveLength(0);
  });

  it('counts only the requested part', () => {
    const all = createScoreMap(twoParts());
    const bass = createScoreMap(twoParts(), {part: 'Bass'});

    expect(all.cells[0]!.count).toBeGreaterThan(bass.cells[0]!.count);
    expect(bass.cells.every((cell) => cell.count <= 1)).toBe(true);
  });

  it('promotes rehearsal marks to major ruler landmarks', () => {
    const marks = createScoreMap(fourBars()).marks;

    const rehearsal = marks.find((mark) => mark.label === 'A');
    expect(rehearsal).toBeDefined();
    expect(rehearsal!.level).toBe('major');
    expect(rehearsal!.startQuarters).toBe(4);
    expect(marks.filter((mark) => mark.level === 'minor').length).toBeGreaterThan(0);
  });

  it('thins plain bar numbers to stay under the mark budget', () => {
    const builder = new ScoreBuilder();
    const partId = builder.newPartId();
    builder.addPart({id: partId, name: 'Melody'});
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C4'),
      onsetQuarters: new Rational(0),
      duration: Duration.quarter(),
      voice: VoiceId(`${partId}-v1`),
    });
    for (let bar = 0; bar < 200; bar += 1) {
      builder.addMeasure({
        id: builder.newMeasureId(),
        number: bar + 1,
        onsetQuarters: new Rational(bar * 4),
        durationQuarters: new Rational(4),
      });
    }
    const map = createScoreMap(builder.build(), {maxMarks: 10, maxCells: 40});

    expect(map.marks.length).toBeLessThanOrEqual(11);
    expect(map.cells).toHaveLength(40);
  });

  it('returns an empty map for an empty score', () => {
    const map = createScoreMap(new ScoreBuilder().build());
    expect(map).toEqual({durationQuarters: 0, cells: [], marks: []});
  });
});

describe('<score-view type="map">', () => {
  const tag = define(class extends ScoreViewElement {});

  it('renders one clickable region per bar and labels the ruler', async () => {
    const element = await mount(tag, fourBars(), {type: 'map'});

    const regions = element.querySelectorAll('button');
    expect(regions).toHaveLength(4);
    expect(regions[0]!.textContent).toBe('m. 1');
    expect(element.textContent).toContain('A');
  });

  it('hides expressions and legacy rehearsal labels without losing map position or notes', async () => {
    const builder = new ScoreBuilder();
    const part = builder.newPartId();
    builder.addPart({id: part, name: 'Piano', directions: [
      {kind: 'words', text: 'rit.', onsetQuarters: Rational.ONE},
      {kind: 'pedal', type: 'start', onsetQuarters: Rational.ZERO, line: true},
      {kind: 'pedal', type: 'stop', onsetQuarters: new Rational(4), line: true},
    ]});
    builder.addMeasure({id: builder.newMeasureId(), number: 1, onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4), rehearsal: 'Intro'});
    builder.addNote(part, {id: builder.newNoteId(), pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO,
      duration: Duration.whole(), voice: VoiceId('piano')});
    const score = builder.build();
    const element = await mount<ScoreViewElement>(tag, score, {type: 'map'});
    expect(element.querySelector('svg[part="annotations"]')?.textContent).toContain('rit.');
    const seek = element.querySelector('input[type="range"]') as HTMLInputElement;
    seek.value = '2';
    seek.dispatchEvent(new Event('input', {bubbles: true}));
    const position = element.currentTime;
    element.setAttribute('show-annotations', 'false');
    expect(element.querySelector('svg[part="annotations"]')).toBeNull();
    expect(element.textContent).not.toContain('rit.');
    expect(element.textContent).not.toContain('Intro');
    expect(element.currentTime).toBe(position);
    expect(element.score).toBe(score);
    expect(element.querySelectorAll('button')).toHaveLength(1);
    element.options = {showAnnotations: true};
    expect(element.querySelector('svg[part="annotations"]')?.textContent).toContain('rit.');
    expect(element.currentTime).toBe(position);
  });

  it('uses the complete map width for an expression spanning a sub-quarter score', async () => {
    const builder = new ScoreBuilder();
    const part = builder.newPartId();
    builder.addPart({id: part, name: 'Short', directions: [
      {kind: 'pedal', type: 'start', onsetQuarters: Rational.ZERO},
      {kind: 'pedal', type: 'stop', onsetQuarters: new Rational(1, 2)},
    ]});
    builder.addNote(part, {id: builder.newNoteId(), pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO,
      duration: new Duration({base: new Rational(1, 2)}), voice: VoiceId('short')});
    const element = await mount(tag, builder.build(), {type: 'map'});
    const svg = element.querySelector('svg[part="annotations"]')!;
    const width = svg.getAttribute('viewBox')!.split(' ')[2];
    const pedal = svg.querySelector('[data-webscore-direction="pedal"] path');
    expect(pedal?.getAttribute('d')).toContain(`H${width}`);
  });

  it('dispatches webscore:seek and drives the bound player', async () => {
    const seeks: number[] = [];
    const player = document.createElement('div');
    player.id = 'player';
    (player as HTMLElement & {seek?: (seconds: number) => void}).seek = (seconds) =>
      seeks.push(seconds);
    document.body.append(player);

    const element = await mount(tag, fourBars(), {type: 'map', player: '#player'});
    const detail: Array<{quarters: number; seconds: number}> = [];
    element.addEventListener('webscore:seek', (event) => {
      detail.push((event as CustomEvent<{quarters: number; seconds: number}>).detail);
    });

    element.querySelectorAll('button')[1]!.click();
    await flush();

    expect(detail).toHaveLength(1);
    expect(detail[0]!.quarters).toBe(4);
    expect(detail[0]!.seconds).toBeCloseTo(2, 5);
    // The element drives the player directly; players never listen for seeks.
    expect(seeks).toEqual([detail[0]!.seconds]);
  });

  it('follows the playhead on transport ticks, not on note onsets', async () => {
    const player = document.createElement('div');
    player.id = 'ticker';
    document.body.append(player);
    const element = await mount(tag, fourBars(), {type: 'map', player: '#ticker'});

    player.dispatchEvent(
      new CustomEvent('webscore:noteon', {detail: {midi: 60, startTime: 6}}),
    );
    await flush();
    expect((element as unknown as {currentTime: number}).currentTime).toBe(0);

    player.dispatchEvent(new CustomEvent('webscore:timeupdate', {detail: {seconds: 3}}));
    await flush();
    expect((element as unknown as {currentTime: number}).currentTime).toBe(3);

    player.dispatchEvent(new CustomEvent('webscore:end'));
    await flush();
    expect((element as unknown as {currentTime: number}).currentTime).toBe(0);
  });

  it('marks the bar under the playhead as the current one', async () => {
    const player = document.createElement('div');
    player.id = 'current';
    document.body.append(player);
    const element = await mount(tag, fourBars(), {type: 'map', player: '#current'});

    player.dispatchEvent(new CustomEvent('webscore:timeupdate', {detail: {seconds: 2.5}}));
    await flush();
    // 2.5s at 120bpm is quarter 5, which is the second bar.
    const pressed = [...element.querySelectorAll('button')].map((button) =>
      button.getAttribute('aria-pressed'),
    );
    expect(pressed).toEqual(['false', 'true', 'false', 'false']);
  });

  it('re-derives the map in place when the part filter changes', async () => {
    const element = await mount(tag, twoParts(), {type: 'map'});
    const before = element.querySelectorAll('button').length;

    element.setAttribute('for-part', 'Bass');
    await flush();

    expect((element as unknown as {forPart?: string}).forPart).toBe('Bass');
    // Same cells, re-weighted — the strip is re-derived, not remounted.
    expect(element.querySelectorAll('button')).toHaveLength(before);
  });

  it('stops following a player once disconnected', async () => {
    const player = document.createElement('div');
    player.id = 'gone';
    document.body.append(player);
    const element = await mount(tag, fourBars(), {type: 'map', player: '#gone'});

    element.remove();
    player.dispatchEvent(new CustomEvent('webscore:timeupdate', {detail: {seconds: 3}}));
    await flush();

    expect((element as unknown as {currentTime: number}).currentTime).toBe(0);
    expect(element.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('<pitch-view type=keyboard>', () => {
  const tag = define(PitchViewElement);

  it('draws the requested key range', async () => {
    const element = await mount(tag, undefined, {low: '60', high: '72'});

    const keys = element.querySelectorAll('[data-midi]');
    expect(keys).toHaveLength(13);
    expect((element as unknown as {low: number}).low).toBe(60);
  });

  it('lights and releases keys from any note source', async () => {
    const source = document.createElement('div');
    source.id = 'source';
    document.body.append(source);
    const element = await mount(tag, undefined, {source: '#source', low: '60', high: '72'});

    source.dispatchEvent(new CustomEvent('webscore:noteon', {detail: {midi: 64}}));
    source.dispatchEvent(new CustomEvent('webscore:noteon', {detail: {midi: 67}}));
    expect((element as unknown as {active: number[]}).active).toEqual([64, 67]);
    expect(element.querySelector('[data-midi="64"]')!.getAttribute('data-active')).toBe('true');

    source.dispatchEvent(new CustomEvent('webscore:noteoff', {detail: {midi: 64}}));
    expect((element as unknown as {active: number[]}).active).toEqual([67]);
    expect(element.querySelector('[data-midi="64"]')!.getAttribute('data-active')).toBe('false');

    source.dispatchEvent(new CustomEvent('webscore:end'));
    expect((element as unknown as {active: number[]}).active).toEqual([]);
  });

  it('can be composed beside a keyboard-free waterfall with independent cleanup', async () => {
    const source = document.createElement('div');
    source.id = 'shared-waterfall-source';
    document.body.append(source);
    const waterfallTag = define(class extends ScoreViewElement {});
    const waterfall = await mount<ScoreViewElement>(waterfallTag, fourBars(), {
      type: 'waterfall', player: '#shared-waterfall-source',
    });
    const keyboard = await mount<PitchViewElement>(tag, undefined, {
      player: '#shared-waterfall-source', low: '60', high: '72',
    });
    source.dispatchEvent(new CustomEvent('webscore:noteon', {detail: {midi: 60, startTime: 0}}));
    expect(keyboard.active).toEqual([60]);
    expect(waterfall.querySelectorAll('.waterfall-notes [data-index]')).not.toHaveLength(0);
    expect(waterfall.querySelector('.waterfall-piano, [data-midi], pitch-view')).toBeNull();
    expect(keyboard.querySelector('[data-midi="60"]')?.getAttribute('data-active')).toBe('true');
    waterfall.remove();
    expect(keyboard.isConnected).toBe(true);
    source.dispatchEvent(new CustomEvent('webscore:noteoff', {detail: {midi: 60}}));
    expect(keyboard.active).toEqual([]);
    expect(source.isConnected).toBe(true);
  });

  it('rebinds when the source changes and drops the held keys', async () => {
    const first = document.createElement('div');
    first.id = 'first';
    const second = document.createElement('div');
    second.id = 'second';
    document.body.append(first, second);
    const element = await mount(tag, undefined, {source: '#first'});

    first.dispatchEvent(new CustomEvent('webscore:noteon', {detail: {midi: 60}}));
    expect((element as unknown as {active: number[]}).active).toEqual([60]);

    element.setAttribute('source', '#second');
    expect((element as unknown as {active: number[]}).active).toEqual([]);

    first.dispatchEvent(new CustomEvent('webscore:noteon', {detail: {midi: 62}}));
    expect((element as unknown as {active: number[]}).active).toEqual([]);
    second.dispatchEvent(new CustomEvent('webscore:noteon', {detail: {midi: 64}}));
    expect((element as unknown as {active: number[]}).active).toEqual([64]);
  });
});

describe('<score-view type="thumbnail">', () => {
  const tag = define(class extends ScoreViewElement {});

  it('fits the whole score while keeping annotation text unscaled', async () => {
    const element = await mount(tag, fourBars(), {type: 'thumbnail', width: '180', height: '48'});

    const svg = element.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.hasAttribute('viewBox')).toBe(false);
    const notes = svg.querySelector('svg')!;
    expect(notes.getAttribute('preserveAspectRatio')).toBe('none');
    expect(notes.getAttribute('viewBox')).toMatch(/^0 0 \d/);
    expect(svg.querySelectorAll('rect')).toHaveLength(8);
    expect(element.style.width).toBe('180px');
    expect(element.querySelector('.wui-stage--fill')).not.toBeNull();
    expect(element.querySelector<HTMLElement>('.wui-stage')!.style.getPropertyValue('--wm-stage-overflow')).toBe('auto');
  });

  it('has no interactive surface at all', async () => {
    const element = await mount(tag, fourBars(), {type: 'thumbnail'});

    expect(element.querySelectorAll('button')).toHaveLength(0);
    expect(element.querySelectorAll('input')).toHaveLength(0);
  });

  it('renders nothing for an empty score', async () => {
    const element = await mount(tag, new ScoreBuilder().build(), {type: 'thumbnail'});
    expect(element.querySelector('svg')).toBeNull();
  });
});

describe('<sheet-view>', () => {
  const tag = define(SheetViewElement);

  it("surfaces the engine's own message instead of failing silently", async () => {
    // Real OSMD cannot lay out in jsdom (no text metrics), and a machine
    // without the optional peer never loads it at all — either way the
    // element must report rather than sit blank, and the message it shows is
    // the engine's, which is what names the missing peer in a browser.
    const element = await mount(tag, fourBars());
    await waitFor(() => element.querySelector('[role="alert"]') !== null);

    const status = element.querySelector('[role="alert"]');
    expect(status).not.toBeNull();
    expect(status!.textContent!.length).toBeGreaterThan(0);
  });

  it('engraves through an injected OSMD instance', async () => {
    const load = vi.fn();
    const render = vi.fn();
    const element = await mount<SheetViewElement>(tag, undefined);
    (element as SheetViewElement & {osmd: unknown}).osmd = {
      load: (xml: string) => {
        load(xml);
        return Promise.resolve();
      },
      render,
      cursor: {show: vi.fn(), hide: vi.fn(), reset: vi.fn(), next: vi.fn()},
      Sheet: {},
    };
    element.score = fourBars();
    await waitFor(() => load.mock.calls.length > 0);

    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]![0]).toContain('<score-partwise');
    expect(render).toHaveBeenCalled();
  });
});
