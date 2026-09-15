import type {Score} from '../../src/core';
import {afterEach, describe, expect, it, vi} from 'vitest';

interface LoadRequest {
  url: string;
  signal: AbortSignal;
  resolve(score: Score): void;
}

const ioState = vi.hoisted(() => ({requests: [] as LoadRequest[]}));

vi.mock('../../src/io/load', () => ({
  loadScoreFromUrl: vi.fn((url: string, options: {signal?: AbortSignal} = {}) => {
    const signal = options.signal;
    if (!signal) throw new Error('analysis element did not pass an AbortSignal');
    let resolvePromise!: (score: Score) => void;
    let rejectPromise!: (reason: unknown) => void;
    const promise = new Promise<Score>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const abort = () => rejectPromise(new Error('aborted'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, {once: true});
    ioState.requests.push({url, signal, resolve: resolvePromise});
    return promise;
  }),
}));

import {
  KeyAnalysisElement,
  ChordAnalysisElement,
} from '../../src/analyze/element/index';
import {createScoreSource} from '../../src/analyze/element/internal/score-source';

afterEach(() => {
  ioState.requests.length = 0;
  vi.restoreAllMocks();
});

describe('analysis element URL cancellation', () => {
  it('aborts a superseded load, keeps its result stale, and does not report cancellation', async () => {
    const attributes: Record<string, string> = {src: 'first.mid'};
    const host = {
      getAttribute: (name: string) => attributes[name] ?? null,
    } as unknown as Element;
    const source = createScoreSource(host);
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const first = source.load();
    await vi.waitFor(() => expect(ioState.requests).toHaveLength(1));

    attributes.src = 'second.mid';
    const second = source.load();
    await vi.waitFor(() => expect(ioState.requests).toHaveLength(2));
    expect(ioState.requests[0]!.signal.aborted).toBe(true);

    const newestScore = {} as Score;
    ioState.requests[1]!.resolve(newestScore);

    await expect(first).resolves.toEqual({score: undefined, stale: true});
    await expect(second).resolves.toEqual({score: newestScore, stale: false});
    expect(reported).not.toHaveBeenCalled();
  });

  it.each([
    ['chord-analysis', ChordAnalysisElement],
    ['key-analysis', KeyAnalysisElement],
  ])('%s aborts its owned load when disconnected', async (_name, Ctor) => {
    const element = new Ctor() as InstanceType<typeof Ctor> & Record<string, unknown>;
    // The DOM lib declares these readonly or with Node-generic signatures;
    // view them as the writable stub surface grafted onto the SSR-safe base.
    const surface = element as unknown as {
      isConnected: boolean;
      getRootNode(): {querySelector(sel: string): unknown};
      appendChild(child: unknown): unknown;
    };
    surface.isConnected = true;
    element.getAttribute = (name: string) => (name === 'src' ? 'score.mid' : null);
    surface.getRootNode = () => ({querySelector: () => null});
    element.replaceChildren = () => undefined;
    surface.appendChild = (child: unknown) => child;
    element.dispatchEvent = () => true;
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    (element as unknown as {connectedCallback(): void}).connectedCallback();
    await vi.waitFor(() => expect(ioState.requests).toHaveLength(1));

    (element as unknown as {disconnectedCallback(): void}).disconnectedCallback();
    expect(ioState.requests[0]!.signal.aborted).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(reported).not.toHaveBeenCalled();
  });
});
