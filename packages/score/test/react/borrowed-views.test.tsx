// @vitest-environment jsdom

import React from 'react';
import {act, cleanup, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Duration, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId,
  type Score, type ScorePlaybackSnapshot} from '../../src/core';
import {scoreToNoteSequence} from '../../src/view/core/note-sequence';
import {renderOSMDStaffVisualizer, renderPianoRollVisualizer, renderStaffVisualizer, renderWaterfallVisualizer,
  type ScoreViewRenderState} from '../../src/view/render';

const owned = vi.hoisted(() => ({created: vi.fn(), stop: vi.fn(), dispose: vi.fn(), playbacks: [] as ReturnType<typeof playback>[]}));
vi.mock('../../src/play/headless', () => ({Player: class {
  currentTime = {seconds: 0};
  stop = owned.stop;
  dispose = owned.dispose;
  readonly playback: ReturnType<typeof playback>;
  constructor(score: Score) { owned.created(); this.playback = playback(score); owned.playbacks.push(this.playback); }
  on() { return () => {}; }
}}));
vi.mock('../../src/view/render', () => ({
  renderPianoRollVisualizer: vi.fn(), renderStaffVisualizer: vi.fn(),
  renderWaterfallVisualizer: vi.fn(), renderOSMDStaffVisualizer: vi.fn(),
}));

import {ScoreProvider} from '../../src/react/context';
import {PianoRollView, StaffView, WaterfallView} from '../../src/react/views';

beforeEach(() => {
  for (const renderer of [renderPianoRollVisualizer, renderStaffVisualizer, renderWaterfallVisualizer]) {
    vi.mocked(renderer).mockImplementation((score) => visualizer(score) as never);
  }
});
afterEach(() => { cleanup(); owned.playbacks.length = 0; vi.resetAllMocks(); });

describe('standalone and borrowed React score views', () => {
  it('renders all three static views without constructing a player', () => {
    const score = music();
    const states: ScoreViewRenderState[] = [];
    render(<><StaffView score={score} onStateChange={(state) => states.push(state)} />
      <PianoRollView score={score} /><WaterfallView score={score} /></>);
    expect(owned.created).not.toHaveBeenCalled();
    expect(renderStaffVisualizer).toHaveBeenCalledOnce();
    expect(renderPianoRollVisualizer).toHaveBeenCalledOnce();
    expect(renderWaterfallVisualizer).toHaveBeenCalledOnce();
    expect(states.map((state) => state.status)).toEqual(['rendering', 'ready']);
    expect(states.every(Object.isFrozen)).toBe(true);
  });

  it.each([StaffView, PianoRollView, WaterfallView])('initializes paused nominal position and follows seek without borrowing commands', (View) => {
    const score = music();
    const source = playback(score, {state: 'paused', nominalSeconds: 0.25, transportSeconds: 0.125, rate: 2});
    const renderer = View === StaffView ? renderStaffVisualizer : View === PianoRollView ? renderPianoRollVisualizer : renderWaterfallVisualizer;
    const {unmount} = render(<View playback={source} />);
    const drawing = vi.mocked(renderer).mock.results[0]!.value as ReturnType<typeof visualizer>;
    expect(drawing.redrawAtTime).toHaveBeenLastCalledWith(0.25, true);
    act(() => source.emit({nominalSeconds: 0.75, state: 'paused'}));
    expect(drawing.redrawAtTime).toHaveBeenLastCalledWith(0.75, true);
    expect(renderer).toHaveBeenCalledOnce();
    expect(owned.created).not.toHaveBeenCalled();
    expect(source.seekNominal).not.toHaveBeenCalled();
    unmount();
    expect(source.off).toHaveBeenCalledOnce();
    expect(drawing.dispose).toHaveBeenCalledOnce();
    act(() => source.emit({nominalSeconds: 1}, true));
    expect(drawing.redrawAtTime).toHaveBeenLastCalledWith(0.75, true);
    expect(source.stop).not.toHaveBeenCalled();
    expect(source.dispose).not.toHaveBeenCalled();
  });

  it('inherits the owned provider source through the same snapshot path', () => {
    const score = music();
    render(<ScoreProvider score={score}><StaffView /></ScoreProvider>);
    const source = owned.playbacks[0]!;
    const drawing = vi.mocked(renderStaffVisualizer).mock.results[0]!.value as ReturnType<typeof visualizer>;
    expect(owned.created).toHaveBeenCalledOnce();
    act(() => source.emit({state: 'paused', nominalSeconds: 0.5}));
    expect(drawing.redrawAtTime).toHaveBeenLastCalledWith(0.5, true);
    expect(renderStaffVisualizer).toHaveBeenCalledOnce();
  });

  it('reports subscription failure and releases an already constructed drawing', () => {
    const score = music();
    const source = playback(score);
    const cause = new Error('subscribe failed');
    source.subscribe = (listener) => { listener(source.snapshot()); throw cause; };
    const states: ScoreViewRenderState[] = [];
    render(<StaffView playback={source} onStateChange={(state) => states.push(state)} />);
    const drawing = vi.mocked(renderStaffVisualizer).mock.results[0]!.value as ReturnType<typeof visualizer>;
    expect(drawing.dispose).toHaveBeenCalledOnce();
    expect(states.at(-1)).toMatchObject({status: 'error', phase: 'source', cause});
  });

  it('keeps an explicit score static inside an owned provider and rejects mismatched playback identity', () => {
    const score = music();
    const other = music();
    const source = playback(other);
    const {rerender} = render(<ScoreProvider score={other}><StaffView score={score} /></ScoreProvider>);
    expect(owned.created).toHaveBeenCalledOnce();
    rerender(<ScoreProvider score={other}><StaffView score={score} playback={source} /></ScoreProvider>);
    const drawing = vi.mocked(renderStaffVisualizer).mock.results[1]!.value as ReturnType<typeof visualizer>;
    expect(drawing.redrawAtTime).not.toHaveBeenCalled();
    expect(drawing.clearActiveNotes).toHaveBeenCalled();
    expect(source.seekNominal).not.toHaveBeenCalled();
  });

  it('matches active notes by part and note identity when a renderer has no time-redraw method', () => {
    const score = music();
    const source = playback(score, {activeNotes: [{occurrenceId: 'sound-1', partId: 'p', noteId: 'n', midi: 72,
      nominalStartSeconds: 0, nominalEndSeconds: 2}]});
    const drawing = {...visualizer(score), redrawAtTime: undefined};
    vi.mocked(renderStaffVisualizer).mockReturnValue(drawing);
    render(<StaffView playback={source} />);
    expect(drawing.redraw).toHaveBeenLastCalledWith(drawing.noteSequence.notes[0], true);
    expect(drawing.noteSequence.notes[0].pitch).toBe(60);
  });

  it('positions an event-only renderer at a score note when paused with no active occurrences', () => {
    const score = music();
    const source = playback(score, {state: 'paused', nominalSeconds: 0.75, activeNotes: []});
    const drawing = {...visualizer(score), redrawAtTime: undefined};
    vi.mocked(renderStaffVisualizer).mockReturnValue(drawing);
    render(<StaffView playback={source} />);
    expect(drawing.redraw).toHaveBeenLastCalledWith(drawing.noteSequence.notes[0], true);
    expect(drawing.clearActiveNotes).not.toHaveBeenCalled();
  });

  it('does not declare a retained source score ready during loading or failure', () => {
    const score = music();
    const source = playback(score, {readiness: 'loading'});
    const states: ScoreViewRenderState[] = [];
    render(<StaffView playback={source} onStateChange={(state) => states.push(state)} />);
    expect(renderStaffVisualizer).not.toHaveBeenCalled();
    expect(states.at(-1)).toMatchObject({status: 'loading', phase: 'source'});
    const error = new Error('source failed');
    act(() => source.emit({readiness: 'error', error}));
    expect(states.at(-1)).toMatchObject({status: 'error', phase: 'source', cause: error});
    expect(renderStaffVisualizer).not.toHaveBeenCalled();
    act(() => source.emit({readiness: 'ready', error: undefined}));
    expect(states.at(-1)).toMatchObject({status: 'ready', phase: 'render', score});
  });

  it('keeps explicit score data renderable when its borrowed source is unavailable', () => {
    const score = music();
    const source = playback(score, {readiness: 'loading'});
    const states: ScoreViewRenderState[] = [];
    render(<StaffView score={score} playback={source} onStateChange={(state) => states.push(state)} />);
    expect(states.at(-1)).toMatchObject({status: 'ready', phase: 'render', score});
    const drawing = vi.mocked(renderStaffVisualizer).mock.results[0]!.value as ReturnType<typeof visualizer>;
    expect(drawing.redrawAtTime).not.toHaveBeenCalled();
    expect(drawing.clearActiveNotes).toHaveBeenCalled();
    act(() => source.emit({readiness: 'error', error: new Error('external failure')}));
    expect(states.at(-1)).toMatchObject({status: 'ready', phase: 'render', score});
  });

  it('contains rejected async state callbacks without treating them as drawing failures', async () => {
    const cause = new Error('host callback failed');
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    const states: ScoreViewRenderState[] = [];
    render(<StaffView score={music()} onStateChange={async (state) => {
      states.push(state);
      if (state.status === 'ready') throw cause;
    }} />);
    await act(async () => {});
    expect(states.at(-1)?.status).toBe('ready');
    expect(report).toHaveBeenCalledWith(expect.any(String), cause);
    report.mockRestore();
  });

  it('replaces borrowed source scores, ignores older revisions and finishes cleanup if unsubscribe throws', () => {
    const score = music();
    const replacement = music();
    const source = playback(score);
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    source.off.mockImplementation(() => { throw new Error('unsubscribe failed'); });
    const {unmount} = render(<StaffView playback={source} />);
    const first = vi.mocked(renderStaffVisualizer).mock.results[0]!.value as ReturnType<typeof visualizer>;
    act(() => source.emit({score: replacement, sourceRevision: 1, revision: 3}));
    const second = vi.mocked(renderStaffVisualizer).mock.results[1]!.value as ReturnType<typeof visualizer>;
    expect(first.dispose).toHaveBeenCalledOnce();
    act(() => source.emit({score, sourceRevision: 0, revision: 2}));
    expect(renderStaffVisualizer).toHaveBeenCalledTimes(2);
    unmount();
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledOnce();
    report.mockRestore();
  });

  it('reports synchronous rendering failures with the original cause and recovers after replacement', () => {
    const cause = new Error('renderer failed');
    vi.mocked(renderStaffVisualizer).mockImplementationOnce(() => { throw cause; });
    const states: ScoreViewRenderState[] = [];
    const change = (state: ScoreViewRenderState): void => { states.push(state); };
    const {rerender} = render(<StaffView score={music()} onStateChange={change} />);
    expect(states.at(-1)).toMatchObject({status: 'error', phase: 'render', cause});
    rerender(<StaffView score={music()} onStateChange={change} />);
    expect(states.at(-1)?.status).toBe('ready');
    expect(states.map((state) => state.revision)).toEqual(states.map((_, index) => index + 1));
  });

  it('does not finish an obsolete render after a state callback replaces its source', () => {
    const first = music();
    const second = music();
    const source = playback(first);
    const states: ScoreViewRenderState[] = [];
    render(<StaffView playback={source} onStateChange={(state) => {
      states.push(state);
      if (state.status === 'rendering' && state.score === first) source.emit({score: second, sourceRevision: 1});
    }} />);
    expect(renderStaffVisualizer).toHaveBeenCalledOnce();
    expect(vi.mocked(renderStaffVisualizer).mock.calls[0]?.[0]).toBe(second);
    expect(states.filter((state) => state.status === 'ready').map((state) => state.score)).toEqual([second]);
  });

  it('reports current OSMD errors and suppresses old completion/error after replacing its score', async () => {
    type RenderedOSMD = Awaited<ReturnType<typeof renderOSMDStaffVisualizer>>;
    const first = deferred<RenderedOSMD>();
    const second = deferred<RenderedOSMD>();
    const third = deferred<RenderedOSMD>();
    vi.mocked(renderOSMDStaffVisualizer).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const states: ScoreViewRenderState[] = [];
    const score = music();
    const replacement = music();
    const change = (state: ScoreViewRenderState): void => { states.push(state); };
    const {rerender, unmount} = render(<StaffView score={score} osmd={{musicXML: 'first'}} onStateChange={change} />);
    const signal = vi.mocked(renderOSMDStaffVisualizer).mock.calls[0]![2]!.signal;
    rerender(<StaffView score={replacement} osmd={{musicXML: 'second'}} onStateChange={change} />);
    expect(signal?.aborted).toBe(true);
    const stale = {...visualizer(score), visualizer: {load: async () => {}, render() {}}};
    await act(async () => first.resolve(stale));
    expect(stale.dispose).toHaveBeenCalledOnce();
    expect(states.at(-1)).toMatchObject({status: 'rendering', score: replacement});
    const cause = new Error('OSMD could not draw');
    await act(async () => second.reject(cause));
    expect(states.at(-1)).toMatchObject({status: 'error', phase: 'render', cause, score: replacement});
    rerender(<StaffView score={music()} osmd={{musicXML: 'third'}} onStateChange={change} />);
    unmount();
    const count = states.length;
    await act(async () => third.reject(new Error('late failure')));
    expect(states).toHaveLength(count);
    expect(states.at(-1)?.status).toBe('disposed');
  });
});

function music(): Score {
  const builder = new ScoreBuilder();
  builder.addPart({id: PartId('p'), name: 'Piano'});
  builder.addNote(PartId('p'), {id: NoteId('n'), pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO,
    duration: Duration.whole(), voice: VoiceId('v')});
  return builder.build();
}

function visualizer(score: Score) {
  return {noteSequence: scoreToNoteSequence(score), visualizer: {}, redrawAtTime: vi.fn(),
    redraw: vi.fn(), clearActiveNotes: vi.fn(), dispose: vi.fn()};
}

function playback(score: Score, overrides: Partial<ScorePlaybackSnapshot> = {}) {
  let snapshot: ScorePlaybackSnapshot = {revision: 0, sourceRevision: 0, readiness: 'ready', state: 'playing', score,
    nominalSeconds: 0, nominalDurationSeconds: score.durationSeconds, transportSeconds: 0,
    transportDurationSeconds: score.durationSeconds, rate: 1, activeNotes: [], ...overrides};
  let listener: ((state: ScorePlaybackSnapshot) => void) | undefined;
  let lateListener: ((state: ScorePlaybackSnapshot) => void) | undefined;
  const off = vi.fn();
  return {
    snapshot: () => snapshot,
    subscribe(callback: (state: ScorePlaybackSnapshot) => void) {
      listener = callback;
      lateListener = callback;
      callback(snapshot);
      return () => { listener = undefined; off(); };
    },
    emit(next: Partial<ScorePlaybackSnapshot>, late = false) {
      snapshot = {...snapshot, revision: snapshot.revision + 1, ...next};
      (late ? lateListener : listener)?.(snapshot);
    },
    off, seekNominal: vi.fn(async () => {}), stop: vi.fn(), dispose: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return {promise, resolve, reject};
}
