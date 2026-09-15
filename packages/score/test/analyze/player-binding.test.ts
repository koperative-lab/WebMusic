// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Score, ScorePlaybackSnapshot, ScorePlaybackSource} from '../../src/core';
import {
  bindAnalysisPlayer,
  resolveAnalysisPlayer,
  type AnalysisPlayerHandlers,
} from '../../src/analyze/element/internal/player-binding';
import {createScoreSource} from '../../src/analyze/element/internal/score-source';

const io = vi.hoisted(() => ({load: vi.fn()}));
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: io.load}));

const cleanups: Array<() => void> = [];
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

function follower(selector = '#player') {
  const host = document.createElement('div');
  host.setAttribute('player', selector);
  document.body.append(host);
  return host;
}

function player(id = 'player') {
  const element = document.createElement('div') as unknown as HTMLElement & {
    resolvedScore: Score | undefined;
    score: Score | undefined;
    getPlaybackSnapshot: () => typeof state;
  };
  const state = {
    nominalSeconds: 6, transportSeconds: 3, transportDurationSeconds: 10,
    rate: 2, playing: false, activeNotes: [] as Array<{midi: number}>,
  };
  element.id = id;
  element.resolvedScore = {id} as unknown as Score;
  element.score = undefined;
  element.getPlaybackSnapshot = () => ({...state});
  document.body.append(element);
  return {element, state};
}

function bind(host: Element, handlers: AnalysisPlayerHandlers) {
  const dispose = bindAnalysisPlayer(host, handlers);
  if (dispose) cleanups.push(dispose);
  return dispose;
}

function emit(target: Element, type: string, detail?: unknown) {
  target.dispatchEvent(new CustomEvent(`webscore:${type}`, {detail}));
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('borrowed Analyze player data and state', () => {
  it('reconciles native occurrences when an early note callback replaces a pending batch', () => {
    const {element} = player();
    let value: ScorePlaybackSnapshot = {revision: 0, sourceRevision: 0, readiness: 'ready', state: 'paused',
      score: element.resolvedScore, nominalSeconds: 0, nominalDurationSeconds: 10,
      transportSeconds: 0, transportDurationSeconds: 10, rate: 1, activeNotes: []};
    const listeners = new Set<(snapshot: ScorePlaybackSnapshot) => void>();
    const source: ScorePlaybackSource = {snapshot: () => value, subscribe(listener) {
      listeners.add(listener); listener(value); return () => listeners.delete(listener);
    }};
    Object.assign(element, {playback: source});
    const publish = (midis: number[]) => {
      value = {...value, revision: value.revision + 1, activeNotes: midis.map((midi) => ({
        midi, occurrenceId: String(midi), noteId: String(midi), partId: 'P1', nominalStartSeconds: 0, nominalEndSeconds: 10,
      }))};
      for (const listener of [...listeners]) listener(value);
    };
    const active = new Set<number>();
    bind(follower(), {noteOn(midi) {
      active.add(midi);
      if (midi === 60) publish([64]);
    }, noteOff(midi) { active.delete(midi); }, reset() { active.clear(); }});
    publish([60, 64]);
    expect([...active]).toEqual([64]);
  });

  it('initializes paused position, actual rate, score and held occurrences without a new event', () => {
    const {element, state} = player();
    state.activeNotes = [{midi: 60}, {midi: 60}, {midi: 64}];
    const handlers = {targetChanged: vi.fn(), dataChanged: vi.fn(), timeUpdate: vi.fn(), stateChanged: vi.fn(), noteOn: vi.fn()};
    bind(follower(), handlers);
    expect(handlers.targetChanged).toHaveBeenCalledWith(element);
    expect(handlers.dataChanged).toHaveBeenCalledWith(element.resolvedScore);
    expect(handlers.timeUpdate).toHaveBeenCalledWith(6, {
      nominalSeconds: 6, transportSeconds: 3, transportDurationSeconds: 10, rate: 2, playing: false,
    });
    expect(handlers.stateChanged).toHaveBeenCalledWith(false, expect.objectContaining({nominalSeconds: 6}));
    expect(handlers.noteOn.mock.calls).toEqual([[60], [60], [64]]);
  });

  it('discovers a later owner, releases a removed owner, and follows its replacement', async () => {
    const handlers = {targetChanged: vi.fn(), dataChanged: vi.fn(), noteOn: vi.fn(), reset: vi.fn()};
    bind(follower(), handlers);
    expect(handlers.targetChanged).toHaveBeenLastCalledWith(undefined);
    const first = player();
    await settle();
    expect(handlers.targetChanged).toHaveBeenLastCalledWith(first.element);
    first.element.remove();
    await settle();
    expect(handlers.dataChanged).toHaveBeenLastCalledWith(undefined);
    const next = player();
    await settle();
    expect(handlers.targetChanged).toHaveBeenLastCalledWith(next.element);
    emit(first.element, 'noteon', {midi: 60});
    expect(handlers.noteOn).not.toHaveBeenCalled();
    emit(next.element, 'noteon', {midi: 67});
    expect(handlers.noteOn).toHaveBeenCalledExactlyOnceWith(67);
  });

  it('rejects invalid and ambiguous selectors and scopes lookup to a ShadowRoot', () => {
    const first = player();
    player();
    const host = follower();
    expect(resolveAnalysisPlayer(host)).toBeUndefined();
    host.setAttribute('player', '[');
    expect(() => bind(host, {})).not.toThrow();
    const shell = document.createElement('div');
    const shadow = shell.attachShadow({mode: 'open'});
    document.body.append(shell);
    host.setAttribute('player', '#player');
    shadow.append(host);
    expect(resolveAnalysisPlayer(host)).toBeUndefined();
    shadow.append(first.element);
    expect(resolveAnalysisPlayer(host)).toBe(first.element);
  });

  it('updates paused seek/rate snapshots and preserves the nominal end position', () => {
    const {element, state} = player();
    const handlers = {timeUpdate: vi.fn(), stateChanged: vi.fn(), reset: vi.fn(), end: vi.fn()};
    bind(follower(), handlers);
    state.nominalSeconds = 12;
    state.transportSeconds = 24;
    state.rate = 0.5;
    emit(element, 'seek');
    expect(handlers.reset).toHaveBeenCalledTimes(2);
    expect(handlers.timeUpdate).toHaveBeenLastCalledWith(12, expect.objectContaining({rate: 0.5, playing: false}));
    state.nominalSeconds = 20;
    emit(element, 'end');
    expect(handlers.timeUpdate).toHaveBeenLastCalledWith(20, expect.objectContaining({playing: false}));
    expect(handlers.end).toHaveBeenCalledOnce();
  });

  it('keeps event-only nominal callbacks compatible without guessing missing rate', () => {
    const target = document.createElement('div');
    target.id = 'player';
    document.body.append(target);
    const timeUpdate = vi.fn();
    bind(follower(), {timeUpdate});
    emit(target, 'timeupdate', {seconds: 5});
    expect(timeUpdate).toHaveBeenLastCalledWith(5, {
      nominalSeconds: 5, transportSeconds: 0, transportDurationSeconds: 0,
    });
    emit(target, 'timeupdate', {seconds: 99, nominalSeconds: 7, rate: NaN});
    expect(timeUpdate).toHaveBeenLastCalledWith(7, {
      nominalSeconds: 7, transportSeconds: 0, transportDurationSeconds: 0,
    });
  });

  it('does not publish stale source or snapshot after disposal inside a reset callback', () => {
    const {element} = player();
    const dataChanged = vi.fn();
    const attachment: {dispose?: () => void} = {};
    attachment.dispose = bind(follower(), {dataChanged, reset: () => attachment.dispose?.()});
    dataChanged.mockClear();
    emit(element, 'scorechange');
    expect(dataChanged).not.toHaveBeenCalled();
    element.remove();
    attachment.dispose?.();
  });

  it('stops discovery and all events after idempotent disposal', async () => {
    const host = follower();
    const changed = vi.fn();
    const dispose = bind(host, {targetChanged: changed});
    dispose?.();
    dispose?.();
    changed.mockClear();
    player();
    await settle();
    expect(changed).not.toHaveBeenCalled();
  });

  it('resolves explicit score > own src > borrowed resolved score without reloading the player URL', async () => {
    const {element} = player();
    element.setAttribute('src', 'already-loaded.mid');
    const host = follower();
    const source = createScoreSource(host);
    await expect(source.load()).resolves.toMatchObject({score: element.resolvedScore, stale: false});
    expect(io.load).not.toHaveBeenCalled();

    const own = {id: 'own'} as unknown as Score;
    io.load.mockResolvedValueOnce(own);
    host.setAttribute('src', 'own.mid');
    await expect(source.load()).resolves.toMatchObject({score: own});
    expect(io.load).toHaveBeenCalledExactlyOnceWith('own.mid', expect.objectContaining({signal: expect.any(AbortSignal)}));

    const explicit = {id: 'explicit'} as unknown as Score;
    source.score = explicit;
    await expect(source.load()).resolves.toMatchObject({score: explicit});
    expect(io.load).toHaveBeenCalledTimes(1);
    source.score = undefined;
    host.removeAttribute('src');
    element.resolvedScore = undefined;
    element.score = explicit;
    await expect(source.load()).resolves.toMatchObject({score: undefined});
  });
});
