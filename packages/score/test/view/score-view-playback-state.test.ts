// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Score, type ScorePlaybackSnapshot, type ScorePlaybackSource} from '../../src/core';
import {ScoreViewElement, type ScoreViewRenderState} from '../../src/view/element/score-view';
import {renderScoreVisualizer} from '../../src/view/render/score-visualizer';

const io = vi.hoisted(() => ({load: vi.fn()}));
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: io.load}));
vi.mock('../../src/view/render/score-visualizer', async (original) => {
  const actual = await original<typeof import('../../src/view/render/score-visualizer')>();
  return {...actual, renderScoreVisualizer: vi.fn(actual.renderScoreVisualizer)};
});
customElements.define('borrowed-state-score-view', class extends ScoreViewElement {});
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

function music(pitch = 'C4'): Score {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Part'});
  builder.addNote(part, {id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: Rational.ZERO,
    duration: Duration.whole(), voice: VoiceId('voice')});
  return builder.build();
}

function playback(score = music()) {
  let state: ScorePlaybackSnapshot = {revision: 0, sourceRevision: 0, readiness: 'ready', state: 'paused', score,
    nominalSeconds: 1, nominalDurationSeconds: 2, transportSeconds: 1, transportDurationSeconds: 2, rate: 1, activeNotes: []};
  const listeners = new Set<(snapshot: ScorePlaybackSnapshot) => void>();
  const publish = (patch: Partial<ScorePlaybackSnapshot>) => {
    state = {...state, ...patch, revision: state.revision + 1};
    for (const listener of [...listeners]) listener(state);
  };
  const source: ScorePlaybackSource & {stop: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>} = {
    snapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
    seekNominal: vi.fn(async (seconds: number) => { publish({nominalSeconds: seconds}); }),
    stop: vi.fn(), dispose: vi.fn(),
  };
  return {source, listeners, publish};
}

function view() { return document.createElement('borrowed-state-score-view') as ScoreViewElement; }
afterEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); });

describe('score-view borrowed playback and render observation', () => {
  it.each(['piano-roll', 'staff', 'waterfall'] as const)('follows untimed native note identity in %s and clears released notes', async (type) => {
    const builder = new ScoreBuilder();
    const part = builder.addPart({id: PartId('part'), name: 'Part'});
    builder.addNote(part, {id: NoteId('first'), pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(), voice: VoiceId('voice')});
    builder.addNote(part, {id: NoteId('second'), pitch: Pitch.parse('G4'), onsetQuarters: Rational.from(2),
      duration: Duration.quarter(), voice: VoiceId('voice')});
    const owner = playback(builder.build());
    owner.publish({nominalSeconds: null, activeNotes: [{occurrenceId: 'second-1', partId: 'part', noteId: 'second',
      midi: 79, nominalStartSeconds: 1, nominalEndSeconds: 1.5}]});
    const element = view();
    element.type = type;
    element.playback = owner.source;
    document.body.append(element);
    await flush();
    expect(element.renderState.status).toBe('ready');
    expect(element.active).toEqual([67]);
    const rendered = vi.mocked(renderScoreVisualizer).mock.results.at(-1)!.value;
    const clear = vi.spyOn(rendered, 'clearActiveNotes');
    const redraw = vi.spyOn(rendered, 'redraw');
    owner.publish({activeNotes: []});
    expect(element.active).toEqual([]);
    expect(clear).toHaveBeenCalled();
    owner.publish({activeNotes: [{occurrenceId: 'first-1', partId: 'part', noteId: 'first',
      midi: 72, nominalStartSeconds: 0, nominalEndSeconds: 0.5}]});
    expect(element.active).toEqual([60]);
    expect(redraw).toHaveBeenLastCalledWith(expect.objectContaining({noteId: 'first', pitch: 60}), true);
    owner.publish({nominalSeconds: 1.25, activeNotes: []});
    expect(element.currentTime).toBe(1.25);
    expect(element.active).toEqual([67]);
    owner.publish({nominalSeconds: null, activeNotes: []});
    expect(element.active).toEqual([]);
    element.remove();
    expect(owner.listeners.size).toBe(0);
    expect(owner.source.dispose).not.toHaveBeenCalled();
  });

  it('borrows directly ahead of a selector, restores that selector, and releases only subscriptions', async () => {
    const direct = playback();
    const selected = playback(music('G4'));
    const owner = Object.assign(document.createElement('div'), {id: 'state-owner', playback: selected.source});
    const element = view();
    element.type = 'thumbnail';
    element.setAttribute('player', '#state-owner');
    element.playback = direct.source;
    document.body.append(owner, element);
    await flush();
    expect(element.score).toBe(direct.source.snapshot().score);
    expect(element.currentTime).toBe(1);
    expect(direct.listeners.size).toBe(1);
    expect(selected.listeners.size).toBe(0);
    direct.publish({nominalSeconds: 0.5});
    expect(element.currentTime).toBe(0.5);
    element.playback = undefined;
    await flush();
    expect(element.score).toBe(selected.source.snapshot().score);
    expect(direct.listeners.size).toBe(0);
    expect(selected.listeners.size).toBe(1);
    element.remove();
    expect(element.renderState.status).toBe('disposed');
    expect(selected.listeners.size).toBe(0);
    expect(direct.source.stop).not.toHaveBeenCalled();
    expect(selected.source.dispose).not.toHaveBeenCalled();
    document.body.append(element);
    await flush();
    expect(element.renderState.status).toBe('ready');
    expect(selected.listeners.size).toBe(1);
    expect(io.load).not.toHaveBeenCalled();
  });

  it('separates source loading/failure from successful drawing and preserves score identity', async () => {
    const owner = playback();
    owner.publish({readiness: 'loading', score: undefined});
    const element = view();
    element.type = 'thumbnail';
    element.playback = owner.source;
    document.body.append(element);
    await flush();
    expect(element.renderState).toMatchObject({status: 'loading', phase: 'source'});
    const error = new Error('source failed');
    owner.publish({readiness: 'error', error});
    await flush();
    expect(element.renderState).toMatchObject({status: 'error', phase: 'source', cause: error});
    expect(element.textContent).toContain('source failed');
    const replacement = music('E4');
    owner.publish({readiness: 'ready', error: undefined, score: replacement, sourceRevision: 1});
    await flush();
    expect(element.renderState).toMatchObject({status: 'ready', phase: 'render', score: replacement});
    expect(Object.isFrozen(element.renderState)).toBe(true);
    element.score = music('G4');
    await flush();
    expect(element.getAttribute('data-player-state')).toBe('mismatched');
    expect(element.currentTime).toBe(0);
    owner.publish({nominalSeconds: 1.5});
    expect(element.currentTime).toBe(0);
    expect(element.renderState.score).toBe(element.score);
  });

  it('reports real rendering failures and retries options without reporting a false ready state', async () => {
    const element = view();
    element.score = music();
    const states: ScoreViewRenderState[] = [];
    element.addEventListener('webscore:renderstatechange', (event) => states.push((event as CustomEvent<ScoreViewRenderState>).detail));
    const error = new Error('renderer failed');
    vi.mocked(renderScoreVisualizer).mockImplementationOnce(() => { throw error; });
    document.body.append(element);
    await flush();
    expect(element.renderState).toMatchObject({status: 'error', phase: 'render', cause: error});
    expect(states.map((state) => state.status)).not.toContain('ready');
    expect(element.textContent).toContain('renderer failed');
    element.options = {noteHeight: 8};
    expect(element.renderState).toMatchObject({status: 'ready', phase: 'render'});
    expect(states.at(-1)!.generation).toBeGreaterThan(states.at(-3)!.generation);
    expect(states.every((state, index) => index === 0 || state.revision > states[index - 1]!.revision)).toBe(true);
  });

  it('invalidates loads and reentrant rendering when a newer source wins', async () => {
    let reject!: (cause: unknown) => void;
    io.load.mockImplementationOnce(() => new Promise<Score>((_resolve, fail) => { reject = fail; }));
    const element = view();
    element.type = 'thumbnail';
    element.setAttribute('src', '/old.mid');
    document.body.append(element);
    await flush();
    expect(element.renderState).toMatchObject({status: 'loading', phase: 'load'});
    const first = music();
    const latest = music('E4');
    element.addEventListener('webscore:renderstatechange', (event) => {
      const state = (event as CustomEvent<ScoreViewRenderState>).detail;
      if (state.status === 'rendering' && state.score === first) element.score = latest;
    });
    element.score = first;
    await flush();
    reject(new Error('obsolete load failure'));
    await flush();
    expect(element.renderState).toMatchObject({status: 'ready', score: latest});
    expect(element.renderState.cause).toBeUndefined();
    expect(io.load.mock.calls[0]![1].signal.aborted).toBe(true);
  });

  it('cleans an initial subscription when a state event synchronously replaces the source', async () => {
    const first = playback();
    first.publish({readiness: 'loading', score: undefined});
    const latest = playback(music('G4'));
    const element = view();
    element.type = 'thumbnail';
    element.playback = first.source;
    element.addEventListener('webscore:renderstatechange', () => { element.playback = latest.source; }, {once: true});
    document.body.append(element);
    await flush();
    expect(first.listeners.size).toBe(0);
    expect(latest.listeners.size).toBe(1);
    expect(element.renderState).toMatchObject({status: 'ready', score: latest.source.snapshot().score});
  });

  it('reports load failures separately and suppresses completion after disconnect', async () => {
    const error = new Error('parse failed');
    io.load.mockRejectedValueOnce(error);
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const element = view();
    element.setAttribute('src', '/failed.mid');
    document.body.append(element);
    await flush();
    expect(element.renderState).toMatchObject({status: 'error', phase: 'load', cause: error});
    let finish!: (score: Score) => void;
    io.load.mockImplementationOnce(() => new Promise<Score>((resolve) => { finish = resolve; }));
    element.setAttribute('src', '/pending.mid');
    await flush();
    element.remove();
    const disposed = element.renderState;
    finish(music());
    await flush();
    expect(element.renderState).toBe(disposed);
    expect(disposed.status).toBe('disposed');
    expect(element.children).toHaveLength(0);
    reported.mockRestore();
  });

  it('borrows direct map seeks and invalidates them on disconnect from a state event', async () => {
    const owner = playback();
    const element = view();
    element.type = 'map';
    element.playback = owner.source;
    document.body.append(element);
    await flush();
    const seek = element.querySelector<HTMLInputElement>('[part~="seek"]')!;
    seek.value = '2';
    seek.dispatchEvent(new Event('input', {bubbles: true}));
    await flush();
    expect(owner.source.seekNominal).toHaveBeenCalledWith(1);
    element.addEventListener('webscore:renderstatechange', (event) => {
      if ((event as CustomEvent<ScoreViewRenderState>).detail.status === 'rendering') element.remove();
    });
    element.type = 'thumbnail';
    expect(element.renderState.status).toBe('disposed');
    expect(element.children).toHaveLength(0);
    expect(owner.listeners.size).toBe(0);
  });

  it('observes subscription failures and completes teardown even if unsubscribe throws', async () => {
    const failed = playback();
    const subscribeError = new Error('subscription failed');
    failed.source.subscribe = () => { throw subscribeError; };
    const element = view();
    element.type = 'thumbnail';
    element.playback = failed.source;
    document.body.append(element);
    await flush();
    expect(element.renderState).toMatchObject({status: 'error', phase: 'source', cause: subscribeError});
    const working = playback();
    const subscribe = working.source.subscribe;
    const cleanupError = new Error('cleanup failed');
    working.source.subscribe = (listener) => {
      const off = subscribe(listener);
      return () => { off(); throw cleanupError; };
    };
    element.playback = working.source;
    await flush();
    expect(element.renderState.status).toBe('ready');
    const failures: unknown[] = [];
    element.addEventListener('webscore:renderstatechange', (event) => {
      const state = (event as CustomEvent<ScoreViewRenderState>).detail;
      if (state.status === 'error') failures.push(state.cause);
    });
    element.remove();
    expect(failures).toContain(cleanupError);
    expect(element.renderState.status).toBe('disposed');
    expect(element.children).toHaveLength(0);
    expect(working.listeners.size).toBe(0);
    expect(working.source.dispose).not.toHaveBeenCalled();
  });

  it('preserves a reentrant replacement created by a failing old cleanup', async () => {
    const first = playback();
    const superseded = playback(music('D4'));
    const latest = playback(music('G4'));
    const element = view();
    element.type = 'thumbnail';
    const subscribe = first.source.subscribe;
    first.source.subscribe = (listener) => {
      const off = subscribe(listener);
      return () => {
        off();
        element.playback = latest.source;
        throw new Error('obsolete cleanup');
      };
    };
    element.playback = first.source;
    document.body.append(element);
    await flush();
    element.playback = superseded.source;
    await flush();
    expect(element.playback).toBe(latest.source);
    expect(element.renderState).toMatchObject({status: 'ready', score: latest.source.snapshot().score});
    expect(first.listeners.size).toBe(0);
    expect(superseded.listeners.size).toBe(0);
    expect(latest.listeners.size).toBe(1);
  });

  it('observes snapshot read failures without discarding explicit static data', async () => {
    const owner = playback();
    const element = view();
    element.type = 'thumbnail';
    element.playback = owner.source;
    document.body.append(element);
    await flush();
    const error = new Error('snapshot failed');
    owner.source.snapshot = () => { throw error; };
    const explicit = music('D4');
    element.score = explicit;
    await flush();
    expect(element.renderState).toMatchObject({status: 'error', phase: 'source', cause: error, score: explicit});
    expect(element.querySelector('svg')).not.toBeNull();
    expect(() => owner.publish({nominalSeconds: 0.5})).not.toThrow();
    await flush();
    expect(element.renderState).toMatchObject({status: 'error', phase: 'source', score: explicit});
  });

  it('reports a post-ready drawing failure without throwing through the playback owner', async () => {
    const owner = playback();
    const element = view();
    element.playback = owner.source;
    document.body.append(element);
    await flush();
    expect(element.renderState.status).toBe('ready');
    const error = new Error('cursor redraw failed');
    const rendered = vi.mocked(renderScoreVisualizer).mock.results.at(-1)!.value;
    rendered.redrawAtTime = () => { throw error; };
    expect(() => owner.publish({nominalSeconds: 0.5})).not.toThrow();
    expect(element.renderState).toMatchObject({status: 'error', phase: 'render', cause: error});
    expect(element.textContent).toContain('cursor redraw failed');
    element.options = {noteHeight: 8};
    expect(element.renderState.status).toBe('ready');
  });
});
