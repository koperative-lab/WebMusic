// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import type {Score} from '@webmusic/score';
import {loadScore} from '@webmusic/score/io';
import type {DemoScope} from '../src/components/demo-lifecycle';
import {loadArabesqueScore} from '../src/components/headless/arabesque-score';
import {mountWaterfallKeyboardDemo} from '../src/components/waterfall-keyboard-client';

vi.mock('../src/components/headless/arabesque-score', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/components/headless/arabesque-score')>(),
  loadArabesqueScore: vi.fn(),
}));

const cleanups: Array<() => void | Promise<void>> = [];

beforeAll(async () => {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), '../public/midi/Arabesque No.1.mid');
  const score = await loadScore(readFileSync(path), {format: 'midi'});
  vi.mocked(loadArabesqueScore).mockResolvedValue(score);
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) void cleanup();
  document.body.replaceChildren();
});

function mount() {
  const root = document.createElement('section');
  root.innerHTML = `<score-player></score-player>
    <p data-aligned-status></p>
    <select data-aligned-direction><option selected>down</option><option>up</option><option>left</option><option>right</option></select>
    <select data-aligned-width><option selected>32/20</option><option>40/25</option></select>
    <select data-aligned-time-scale><option selected>64</option><option>96</option></select>
    <select data-aligned-key-height><option selected>80</option><option>112</option></select>
    <div data-aligned-track><score-pitch-view></score-pitch-view><score-view></score-view><score-pitch-view></score-pitch-view></div>`;
  document.body.append(root);
  const player = root.querySelector('score-player') as HTMLElement & {score?: Score; loading: boolean};
  const unsubscribe = vi.fn();
  Object.defineProperty(player, 'playback', {value: {
    subscribe: (listener: (snapshot: unknown) => void) => {
      listener({sourceRevision: 1, readiness: 'ready', state: 'paused'});
      return unsubscribe;
    },
  }});
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const scope: DemoScope = {
    get active() { return !controller.signal.aborted; }, signal: controller.signal,
    add: (cleanup) => { cleanups.push(cleanup); },
    listen: (target, event, listener) => {
      const handler = (input: Event) => { listener(input); };
      target.addEventListener(event, handler);
      cleanups.push(() => target.removeEventListener(event, handler));
    },
    run: (task, onError) => { void task.catch(() => { if (!controller.signal.aborted) onError?.(); }); },
  };
  mountWaterfallKeyboardDemo(root, scope);
  const change = (name: string, value: string) => {
    const control = root.querySelector<HTMLSelectElement>(`[data-aligned-${name}]`)!;
    control.value = value;
    control.dispatchEvent(new Event('change'));
  };
  return {player, unsubscribe, change,
    view: root.querySelector('score-view')!, keyboard: root.querySelector('score-pitch-view')!,
    keyboards: [...root.querySelectorAll<HTMLElement>('score-pitch-view')],
    track: root.querySelector<HTMLElement>('[data-aligned-track]')!,
  };
}

describe('aligned waterfall and keyboard demo', () => {
  it('declares external preparation until its excerpt arrives and clears it after cleanup', async () => {
    let finish!: (score: Score) => void;
    const source = await loadArabesqueScore();
    vi.mocked(loadArabesqueScore).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const f = mount();
    expect(f.player.loading).toBe(true);
    expect(f.player.score).toBeUndefined();
    finish(source);
    await vi.waitFor(() => expect(f.player.loading).toBe(false));
    expect(f.player.score).toBeDefined();
    vi.mocked(loadArabesqueScore).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = mount();
    expect(pending.player.loading).toBe(true);
    for (const cleanup of cleanups.splice(0).reverse()) void cleanup();
    expect(pending.player.loading).toBe(false);
    finish(source);
    await Promise.resolve();
    await Promise.resolve();
    expect(pending.player.score).toBeUndefined();
    expect(pending.player.loading).toBe(false);
  });

  it('uses an Arabesque excerpt while changing one shared pitch scale', async () => {
    const f = mount();
    await vi.waitFor(() => expect(f.player.score).toBeDefined());
    const score = f.player.score!;
    expect([...score.allNotes()].length).toBeGreaterThan(16);
    expect(score.durationSeconds).toBeLessThan(20);
    expect(f.track.style.width).toBe('672px');
    f.change('width', '40/25');
    expect(f.view.getAttribute('white-note-width')).toBe('40');
    expect(f.keyboard.getAttribute('white-key-width')).toBe('40');
    expect(f.view.getAttribute('black-note-width')).toBe('25');
    expect(f.keyboard.getAttribute('black-key-width')).toBe('25');
    expect(f.track.style.width).toBe('840px');
    f.change('time-scale', '96');
    expect(f.view.getAttribute('pixels-per-second')).toBe('96');
    expect(f.keyboard.getAttribute('white-key-width')).toBe('40');
    f.change('key-height', '112');
    expect(f.keyboard.getAttribute('white-key-height')).toBe('112');
    expect(f.keyboard.getAttribute('black-key-height')).toBe('70');
    expect(f.player.score).toBe(score);
  });

  it('turns a shared pitch axis while keeping independent keyboards opposed and the player intact', async () => {
    const f = mount();
    await vi.waitFor(() => expect(f.player.score).toBeDefined());
    const score = f.player.score;
    for (const direction of ['up', 'down', 'left', 'right']) {
      f.change('direction', direction);
      const horizontal = direction === 'left' || direction === 'right';
      expect(f.view.getAttribute('direction')).toBe(direction);
      expect(f.view.getAttribute('height')).toBe(horizontal ? '672' : '180');
      expect(f.view.getAttribute('width')).toBe(horizontal ? '360' : '672');
      expect(f.keyboards.map(keyboard => keyboard.getAttribute('direction')))
        .toEqual(horizontal ? ['right', 'left'] : ['down', 'up']);
      expect(f.keyboards.map(keyboard => keyboard.style.height))
        .toEqual(horizontal ? ['672px', '672px'] : ['80px', '80px']);
      expect(f.player.score).toBe(score);
    }
    f.change('width', '40/25');
    expect(f.view.getAttribute('height')).toBe('840');
    expect(f.keyboards.every(keyboard => keyboard.getAttribute('black-key-width') === '25')).toBe(true);
    f.change('key-height', '112');
    expect(f.track.style.width).toBe('584px');
    expect(f.view.getAttribute('height')).toBe('840');
  });

  it('releases the owned source and stops reacting to removed demo controls', async () => {
    const f = mount();
    await vi.waitFor(() => expect(f.player.score).toBeDefined());
    for (const cleanup of cleanups.splice(0).reverse()) void cleanup();
    expect(f.player.score).toBeUndefined();
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    f.change('width', '40/25');
    expect(f.track.style.width).toBe('672px');
  });
});
