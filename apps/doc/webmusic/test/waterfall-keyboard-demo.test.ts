// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Score} from '@webmusic/score';
import type {DemoScope} from '../src/components/demo-lifecycle';
import {mountWaterfallKeyboardDemo} from '../src/components/waterfall-keyboard-client';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) void cleanup();
  document.body.replaceChildren();
});

function mount() {
  const root = document.createElement('section');
  root.innerHTML = `<score-player></score-player>
    <p data-aligned-status></p>
    <select data-aligned-width><option selected>32/20</option><option>40/25</option></select>
    <select data-aligned-time-scale><option selected>64</option><option>96</option></select>
    <select data-aligned-key-height><option selected>80</option><option>112</option></select>
    <div data-aligned-track><score-view></score-view><pitch-view></pitch-view></div>`;
  document.body.append(root);
  const player = root.querySelector('score-player') as HTMLElement & {score?: Score};
  const unsubscribe = vi.fn();
  Object.defineProperty(player, 'playback', {value: {
    subscribe: (listener: (snapshot: unknown) => void) => {
      listener({sourceRevision: 1, readiness: 'ready', state: 'paused'});
      return unsubscribe;
    },
  }});
  const scope: DemoScope = {
    active: true, signal: new AbortController().signal,
    add: (cleanup) => { cleanups.push(cleanup); },
    listen: (target, event, listener) => {
      const handler = (input: Event) => { listener(input); };
      target.addEventListener(event, handler);
      cleanups.push(() => target.removeEventListener(event, handler));
    },
    run: () => {},
  };
  mountWaterfallKeyboardDemo(root, scope);
  const change = (name: string, value: string) => {
    const control = root.querySelector<HTMLSelectElement>(`[data-aligned-${name}]`)!;
    control.value = value;
    control.dispatchEvent(new Event('change'));
  };
  return {player, unsubscribe, change,
    view: root.querySelector('score-view')!, keyboard: root.querySelector('pitch-view')!,
    track: root.querySelector<HTMLElement>('[data-aligned-track]')!,
  };
}

describe('aligned waterfall and keyboard demo', () => {
  it('changes the shared pitch scale without replacing its score or changing note time', () => {
    const f = mount();
    const score = f.player.score!;
    expect([...score.allNotes()]).toHaveLength(16);
    expect(score.durationSeconds).toBeCloseTo(5);
    expect(f.track.style.width).toBe('448px');
    f.change('width', '40/25');
    expect(f.view.getAttribute('white-note-width')).toBe('40');
    expect(f.keyboard.getAttribute('white-key-width')).toBe('40');
    expect(f.view.getAttribute('black-note-width')).toBe('25');
    expect(f.keyboard.getAttribute('black-key-width')).toBe('25');
    expect(f.track.style.width).toBe('560px');
    f.change('time-scale', '96');
    expect(f.view.getAttribute('pixels-per-second')).toBe('96');
    expect(f.keyboard.getAttribute('white-key-width')).toBe('40');
    f.change('key-height', '112');
    expect(f.keyboard.getAttribute('white-key-height')).toBe('112');
    expect(f.keyboard.getAttribute('black-key-height')).toBe('70');
    expect(f.player.score).toBe(score);
  });

  it('releases the owned source and stops reacting to removed demo controls', () => {
    const f = mount();
    for (const cleanup of cleanups.splice(0).reverse()) void cleanup();
    expect(f.player.score).toBeUndefined();
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    f.change('width', '40/25');
    expect(f.track.style.width).toBe('448px');
  });
});
