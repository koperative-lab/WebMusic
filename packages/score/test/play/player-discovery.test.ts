// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ScoreBuilder, type ScorePlaybackSnapshot, type ScorePlaybackSource} from '../../src/core';
import {bindAnalysisPlayer} from '../../src/analyze/element/internal/player-binding';
import {bindViewPlayer} from '../../src/view/element/internal/player-binding';

const cleanups: Array<() => void> = [];
let nextTag = 0;
const flush = async () => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); };

function source() {
  let state: ScorePlaybackSnapshot = Object.freeze({
    revision: 0, sourceRevision: 1, readiness: 'ready', state: 'paused',
    score: new ScoreBuilder().build(), nominalSeconds: 0, nominalDurationSeconds: 4,
    transportSeconds: 0, transportDurationSeconds: 2, rate: 2, activeNotes: [],
  });
  const listeners = new Set<(snapshot: ScorePlaybackSnapshot) => void>();
  const playback: ScorePlaybackSource = {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => { listeners.delete(listener); };
    },
  };
  return {
    playback,
    get listenerCount() { return listeners.size; },
    publish(seconds: number) {
      state = Object.freeze({...state, revision: state.revision + 1, nominalSeconds: seconds, transportSeconds: seconds / 2});
      for (const listener of [...listeners]) listener(state);
    },
  };
}

function observe(kind: 'Analyze' | 'View', host: Element) {
  const time = vi.fn();
  const data = vi.fn();
  const target = vi.fn();
  const stop = kind === 'Analyze'
    ? bindAnalysisPlayer(host, {timeUpdate: (seconds) => time(seconds), dataChanged: data, targetChanged: target})
    : bindViewPlayer(host, {snapshot: (state) => time(state.nominalSeconds), scoreChanged: data, targetChanged: target});
  if (stop) cleanups.push(stop);
  return {time, data, target, stop};
}

function latePair() {
  const name = `late-playback-source-${nextTag++}`;
  const target = document.createElement(name);
  target.id = 'owner';
  const host = document.createElement('div');
  host.setAttribute('player', '#owner');
  document.body.append(target, host);
  return {name, target, host};
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

describe.each(['Analyze', 'View'] as const)('%s player discovery', (kind) => {
  it('subscribes to a native-only source after late upgrade and releases it on detach', async () => {
    const {name, host} = latePair();
    const native = source();
    const observed = observe(kind, host);
    expect(native.listenerCount).toBe(0);
    customElements.define(name, class extends HTMLElement {
      get playback() { return native.playback; }
    });
    await flush();
    expect(native.listenerCount).toBe(1);
    expect(observed.data).toHaveBeenLastCalledWith(native.playback.snapshot().score);
    native.publish(2);
    expect(observed.time).toHaveBeenLastCalledWith(2);
    observed.stop?.();
    observed.stop?.();
    expect(native.listenerCount).toBe(0);
    observed.time.mockClear();
    native.publish(3);
    expect(observed.time).not.toHaveBeenCalled();
  });

  it('replaces a pre-upgrade native source even when no DOM event or attribute changes', async () => {
    const {name, target, host} = latePair();
    const original = source();
    const upgraded = source();
    Object.assign(target, {playback: original.playback});
    const observed = observe(kind, host);
    expect(original.listenerCount).toBe(1);
    customElements.define(name, class extends HTMLElement {
      playback = upgraded.playback;
    });
    await flush();
    expect(original.listenerCount).toBe(0);
    expect(upgraded.listenerCount).toBe(1);
    observed.time.mockClear();
    original.publish(1);
    expect(observed.time).not.toHaveBeenCalled();
    upgraded.publish(3);
    expect(observed.time).toHaveBeenLastCalledWith(3);
  });

  it('cancels pending upgrade work after cleanup, including reading a later source', async () => {
    const {name, host} = latePair();
    const native = source();
    const read = vi.fn(() => native.playback);
    const observed = observe(kind, host);
    observed.stop?.();
    observed.target.mockClear();
    customElements.define(name, class extends HTMLElement {
      get playback() { return read(); }
    });
    await flush();
    expect(read).not.toHaveBeenCalled();
    expect(native.listenerCount).toBe(0);
    expect(observed.target).not.toHaveBeenCalled();
  });
});
