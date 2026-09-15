// @vitest-environment jsdom

import {act, cleanup, renderHook} from '@testing-library/react';
import type {AnalysisWorkerFactory, AnalysisWorkerLike} from '../../src/analyze/worker-client';
import type {Score} from '../../src/core';
import {afterEach, describe, expect, it, vi} from 'vitest';

const workerState = vi.hoisted(() => ({
  factories: [] as Array<() => unknown>,
  arguments: [] as unknown[],
}));

vi.mock('../../src/analyze/worker-client', () => ({
  createAnalysisWorker: vi.fn((worker: unknown) => {
    workerState.arguments.push(worker);
    const factory = workerState.factories.shift();
    if (!factory) throw new Error('No mock analysis client configured');
    return factory();
  }),
}));

vi.mock('../../src/analyze/headless', () => ({
  createAnalysisSession: vi.fn(),
}));

import {
  useScoreAnalysisAsync,
  type UseScoreAnalysisAsyncResult,
  type UseScoreAnalysisOptions,
} from '../../src/react/analysis';

afterEach(() => {
  cleanup();
  workerState.factories.length = 0;
  workerState.arguments.length = 0;
});

describe('useScoreAnalysisAsync', () => {
  it('ignores stale results and publishes only the latest score analysis', async () => {
    const harness = createClientHarness();
    workerState.factories.push(() => harness.client);
    const firstScore = score('first');
    const secondScore = score('second');
    const {result, rerender, unmount} = renderHook(
      ({currentScore}) => useScoreAnalysisAsync({}, currentScore),
      {initialProps: {currentScore: firstScore}},
    );

    expect(harness.analyze).toHaveBeenCalledWith(firstScore, {
      windowQuarters: undefined,
      motifLength: 4,
      minOccurrences: 2,
    });
    expect(result.current).toEqual({result: null, pending: true, error: null});

    rerender({currentScore: secondScore});
    expect(harness.update).toHaveBeenCalledWith(secondScore);

    const staleResult = {marker: 'stale'};
    await act(async () => harness.analyzeRequests[0].resolve(staleResult));
    expect(result.current).toEqual({result: null, pending: true, error: null});

    const latestResult = {marker: 'latest'};
    await act(async () => harness.updateRequests[0].resolve(latestResult));
    expect(result.current).toEqual({result: latestResult, pending: false, error: null});

    unmount();
    expect(harness.dispose).toHaveBeenCalledOnce();
  });

  it('marks a score-identity replacement pending in its first render and rejects both stale settlements', async () => {
    const harness = createClientHarness();
    workerState.factories.push(() => harness.client);
    const snapshots: UseScoreAnalysisAsyncResult[] = [];
    const firstScore = score('owned-first');
    const secondScore = score('owned-second');
    const thirdScore = score('owned-third');
    const fourthScore = score('owned-fourth');
    const {result, rerender} = renderHook(
      ({currentScore}) => {
        const current = useScoreAnalysisAsync({}, currentScore);
        snapshots.push(current);
        return current;
      },
      {initialProps: {currentScore: firstScore}},
    );

    const baseline = {marker: 'owned-baseline'};
    await act(async () => harness.analyzeRequests[0].resolve(baseline));
    expect(result.current).toEqual({result: baseline, pending: false, error: null});

    const secondRender = snapshots.length;
    rerender({currentScore: secondScore});
    // This is the render caused by the new prop, before useEffect can tag the
    // state/request. It must not expose the first score as completed.
    expect(snapshots[secondRender]).toEqual({result: baseline, pending: true, error: null});

    rerender({currentScore: thirdScore});
    await act(async () => harness.updateRequests[0].resolve({marker: 'late-success'}));
    expect(result.current).toEqual({result: baseline, pending: true, error: null});

    rerender({currentScore: fourthScore});
    await act(async () => harness.updateRequests[1].reject(new Error('late failure')));
    expect(result.current).toEqual({result: baseline, pending: true, error: null});

    const latest = {marker: 'owned-latest'};
    await act(async () => harness.updateRequests[2].resolve(latest));
    expect(result.current).toEqual({result: latest, pending: false, error: null});
  });

  it('recreates and disposes the client when analysis options change', () => {
    const first = createClientHarness();
    const second = createClientHarness();
    workerState.factories.push(() => first.client, () => second.client);
    const currentScore = score('options');
    const {rerender, unmount} = renderHook(
      ({motifLength}) => useScoreAnalysisAsync({motifLength}, currentScore),
      {initialProps: {motifLength: 4}},
    );

    rerender({motifLength: 6});
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.analyze).toHaveBeenCalledOnce();

    unmount();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it('keys ownership by option semantics, not the options object identity', async () => {
    const first = createClientHarness();
    const second = createClientHarness();
    const third = createClientHarness();
    const fourth = createClientHarness();
    workerState.factories.push(
      () => first.client,
      () => second.client,
      () => third.client,
      () => fourth.client,
    );
    const currentScore = score('option-ownership');
    const snapshots: UseScoreAnalysisAsyncResult[] = [];
    const {result, rerender} = renderHook(
      ({analysisOptions}: {analysisOptions: UseScoreAnalysisOptions}) => {
        const current = useScoreAnalysisAsync(analysisOptions, currentScore);
        snapshots.push(current);
        return current;
      },
      {initialProps: {analysisOptions: {motifLength: 4} as UseScoreAnalysisOptions}},
    );

    const baseline = {marker: 'option-baseline'};
    await act(async () => first.analyzeRequests[0].resolve(baseline));

    const equivalentRender = snapshots.length;
    rerender({analysisOptions: {motifLength: 4, minOccurrences: 2}});
    expect(snapshots[equivalentRender]).toEqual({
      result: baseline,
      pending: false,
      error: null,
    });
    expect(first.dispose).not.toHaveBeenCalled();
    expect(first.analyze).toHaveBeenCalledOnce();

    const semanticChangeRender = snapshots.length;
    rerender({analysisOptions: {motifLength: 5, minOccurrences: 2}});
    expect(snapshots[semanticChangeRender]).toEqual({
      result: baseline,
      pending: true,
      error: null,
    });
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.analyze).toHaveBeenCalledOnce();

    rerender({analysisOptions: {motifLength: 6, minOccurrences: 2}});
    await act(async () => second.analyzeRequests[0].resolve({marker: 'stale-option-success'}));
    expect(result.current).toEqual({result: baseline, pending: true, error: null});

    rerender({analysisOptions: {motifLength: 7, minOccurrences: 2}});
    await act(async () => third.analyzeRequests[0].reject(new Error('stale option failure')));
    expect(result.current).toEqual({result: baseline, pending: true, error: null});

    const latest = {marker: 'option-latest'};
    await act(async () => fourth.analyzeRequests[0].resolve(latest));
    expect(result.current).toEqual({result: latest, pending: false, error: null});
  });

  it('publishes a current request failure and clears it when a new request starts', async () => {
    const harness = createClientHarness();
    workerState.factories.push(() => harness.client);
    const firstScore = score('success');
    const failingScore = score('failure');
    const secondScore = score('retry');
    const {result, rerender} = renderHook(
      ({currentScore}) => useScoreAnalysisAsync({}, currentScore),
      {initialProps: {currentScore: firstScore}},
    );
    const baseline = {marker: 'baseline'};
    await act(async () => harness.analyzeRequests[0].resolve(baseline));

    rerender({currentScore: failingScore});
    expect(result.current).toEqual({result: baseline, pending: true, error: null});

    const failure = new Error('worker crashed');
    await act(async () => harness.updateRequests[0].reject(failure));

    expect(result.current).toEqual({result: baseline, pending: false, error: failure});

    rerender({currentScore: secondScore});
    expect(result.current).toEqual({result: baseline, pending: true, error: null});

    const recovered = {marker: 'recovered'};
    await act(async () => harness.updateRequests[1].resolve(recovered));
    expect(result.current).toEqual({result: recovered, pending: false, error: null});
  });

  it('ignores a rejection from a superseded request', async () => {
    const harness = createClientHarness();
    workerState.factories.push(() => harness.client);
    const {result, rerender} = renderHook(
      ({currentScore}) => useScoreAnalysisAsync({}, currentScore),
      {initialProps: {currentScore: score('first')}},
    );

    rerender({currentScore: score('second')});
    await act(async () => harness.analyzeRequests[0].reject(new Error('stale failure')));

    expect(result.current).toEqual({result: null, pending: true, error: null});
  });

  it('replaces the client when a ready-made Worker instance changes', () => {
    const first = createClientHarness();
    const second = createClientHarness();
    workerState.factories.push(() => first.client, () => second.client);
    const workerA = {name: 'A'} as unknown as AnalysisWorkerLike;
    const workerB = {name: 'B'} as unknown as AnalysisWorkerLike;
    const currentScore = score('worker-instance');
    const {rerender} = renderHook(
      ({worker}) => useScoreAnalysisAsync({worker}, currentScore),
      {initialProps: {worker: workerA}},
    );

    rerender({worker: workerB});

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.analyze).toHaveBeenCalledOnce();
    expect(workerState.arguments).toEqual([workerA, workerB]);
  });

  it('keeps inline factories stable until their explicit workerKey changes', () => {
    const first = createClientHarness();
    const second = createClientHarness();
    workerState.factories.push(() => first.client, () => second.client);
    const factoryA = vi.fn() as AnalysisWorkerFactory;
    const factoryB = vi.fn() as AnalysisWorkerFactory;
    const currentScore = score('worker-factory');
    const {rerender} = renderHook(
      ({worker, workerKey}) => useScoreAnalysisAsync({worker, workerKey}, currentScore),
      {initialProps: {worker: factoryA, workerKey: 'v1'}},
    );

    rerender({worker: factoryB, workerKey: 'v1'});
    expect(first.dispose).not.toHaveBeenCalled();
    expect(workerState.arguments).toEqual([factoryA]);

    rerender({worker: factoryB, workerKey: 'v2'});
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.analyze).toHaveBeenCalledOnce();
    expect(workerState.arguments).toEqual([factoryA, factoryB]);
  });
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {promise, resolve: resolvePromise, reject: rejectPromise};
}

function createClientHarness() {
  const analyzeRequests: Array<Deferred<unknown>> = [];
  const updateRequests: Array<Deferred<unknown>> = [];
  const analyze = vi.fn(() => {
    const request = deferred<unknown>();
    analyzeRequests.push(request);
    return request.promise;
  });
  const update = vi.fn(() => {
    const request = deferred<unknown>();
    updateRequests.push(request);
    return request.promise;
  });
  const dispose = vi.fn();
  return {
    client: {analyze, update, dispose},
    analyze,
    update,
    dispose,
    analyzeRequests,
    updateRequests,
  };
}

function score(id: string): Score {
  return {id, toJSON: () => ({id})} as unknown as Score;
}
