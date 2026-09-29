// Pins the latest-wins behavior of <audio-player>'s src loading: rapid
// `src` changes fire one loadFromSrc per change, and the LAST assignment must
// win even when an earlier (slower) fetch resolves after a newer one. Mirrors
// score/analyze's score-source-cancellation.test.ts style: instantiate the
// element class directly in Node (HTMLElementBase is a plain class stub) and
// mock the load module with controllable promises.

import {createAudioClip, type AudioClip} from '../../src/core';
import {afterEach, describe, expect, it, vi} from 'vitest';

interface LoadRequest {
  url: string;
  signal?: AbortSignal;
  resolve(clip: AudioClip): void;
  reject(reason: unknown): void;
}

const loadState = vi.hoisted(() => ({requests: [] as LoadRequest[]}));

vi.mock('../../src/play/api/load', () => ({
  loadClipFromUrl: vi.fn((url: string, options?: {signal?: AbortSignal}) => {
    let resolvePromise!: (clip: AudioClip) => void;
    let rejectPromise!: (reason: unknown) => void;
    const promise = new Promise<AudioClip>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    loadState.requests.push({url, signal: options?.signal, resolve: resolvePromise, reject: rejectPromise});
    return promise;
  }),
  loadClip: vi.fn(),
}));

import {AudioPlayerElement} from '../../src/play/element/audio-player';
import {AudioPlayer} from '../../src/play/headless/audio-player';

afterEach(() => {
  loadState.requests.length = 0;
  vi.restoreAllMocks();
});

function makeClip(): AudioClip {
  return createAudioClip({sampleRate: 8000, channelData: [new Float32Array(8)]});
}

/** Instantiate the element in Node with just enough DOM surface stubbed. */
function makeElement(): AudioPlayerElement & {events: Array<{type: string; detail: unknown}>} {
  const element = new AudioPlayerElement() as AudioPlayerElement & {
    events: Array<{type: string; detail: unknown}>;
  };
  const el = element as unknown as Record<string, unknown>;
  el.isConnected = true;
  el.getAttribute = () => null;
  el.hasAttribute = () => false;
  el.attachShadow = () => ({
    innerHTML: '',
    querySelector: () => null,
  });
  element.events = [];
  el.dispatchEvent = (event: CustomEvent) => {
    element.events.push({type: event.type, detail: event.detail});
    return true;
  };
  return element;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('<audio-player> src load race', () => {
  it('keeps the newest src clip when an older fetch resolves last', async () => {
    const element = makeElement();

    // Two rapid src changes: the first fetch is slow, the second is fast.
    element.attributeChangedCallback('src', null, 'first.wav');
    element.attributeChangedCallback('src', 'first.wav', 'second.wav');
    expect(loadState.requests.map((r) => r.url)).toEqual(['first.wav', 'second.wav']);
    expect(loadState.requests[0]!.signal?.aborted).toBe(true);
    expect(loadState.requests[1]!.signal?.aborted).toBe(false);

    const newest = makeClip();
    const stale = makeClip();

    // The newer request resolves first...
    loadState.requests[1]!.resolve(newest);
    await flushMicrotasks();
    expect(element.clip).toBe(newest);

    // ...then the stale one straggles in: it must NOT overwrite the newer clip.
    loadState.requests[0]!.resolve(stale);
    await flushMicrotasks();
    expect(element.clip).toBe(newest);
    expect(element.events.filter((e) => e.type === 'webaudio:error')).toEqual([]);
  });

  it('does not dispatch an error when a superseded fetch fails', async () => {
    const element = makeElement();

    element.attributeChangedCallback('src', null, 'first.wav');
    element.attributeChangedCallback('src', 'first.wav', 'second.wav');

    const newest = makeClip();
    loadState.requests[1]!.resolve(newest);
    await flushMicrotasks();

    // The stale fetch failing is not this element's current load — stay silent.
    loadState.requests[0]!.reject(new Error('network down'));
    await flushMicrotasks();
    expect(element.clip).toBe(newest);
    expect(element.events.filter((e) => e.type === 'webaudio:error')).toEqual([]);
  });

  it('an explicit .clip assignment supersedes an in-flight src load', async () => {
    const element = makeElement();

    element.attributeChangedCallback('src', null, 'first.wav');
    const explicit = makeClip();
    element.clip = explicit;

    const stale = makeClip();
    loadState.requests[0]!.resolve(stale);
    await flushMicrotasks();
    expect(element.clip).toBe(explicit);
    expect(loadState.requests[0]!.signal?.aborted).toBe(true);
  });

  it('aborts an in-flight src request on disconnect without reporting an error', async () => {
    const element = makeElement();
    element.attributeChangedCallback('src', null, 'first.wav');

    element.disconnectedCallback();
    expect(loadState.requests[0]!.signal?.aborted).toBe(true);
    loadState.requests[0]!.reject(new Error('aborted'));
    await flushMicrotasks();

    expect(element.events.filter((event) => event.type === 'webaudio:error')).toEqual([]);
  });

  it('rebuilds an internally-owned player after disconnect/reconnect', () => {
    const element = makeElement();
    const clip = makeClip();
    element.clip = clip;
    const first = element.player;
    expect(first).toBeDefined();
    const dispose = vi.spyOn(first!, 'dispose');

    element.disconnectedCallback();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(element.player).toBeUndefined();

    element.connectedCallback();
    expect(element.player).toBeDefined();
    expect(element.player).not.toBe(first);
    expect(element.duration).toBe(clip.duration);
  });

  it('preserves an externally-owned player across disconnect/reconnect', () => {
    const element = makeElement();
    const external = new AudioPlayer(makeClip());
    element.player = external;
    const dispose = vi.spyOn(external, 'dispose');

    element.disconnectedCallback();
    element.connectedCallback();

    expect(dispose).not.toHaveBeenCalled();
    expect(element.player).toBe(external);
  });
});
