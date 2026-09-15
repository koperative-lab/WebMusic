import {describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score, type ScorePlaybackSnapshot, type ScorePlaybackSource} from '../../src/core';
import {createScoreMapView} from '../../src/view/headless';

function music() {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Piano'});
  builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
  builder.addTempo({atQuarters: new Rational(2), bpm: 60});
  builder.addNote(part, {id: builder.newNoteId(), pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO, duration: Duration.whole(), voice: VoiceId('v')});
  return builder.build();
}

function owner(score: Score) {
  let snapshot: ScorePlaybackSnapshot = {revision: 0, sourceRevision: 0, readiness: 'ready',
    state: 'paused', score, nominalSeconds: 0, nominalDurationSeconds: score.durationSeconds,
    transportSeconds: 0, transportDurationSeconds: score.durationSeconds / 2, rate: 2, activeNotes: []};
  const listeners = new Set<(snapshot: ScorePlaybackSnapshot) => void>();
  const source: ScorePlaybackSource = {
    snapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot); return () => { listeners.delete(listener); }; },
  };
  return {source, listeners, emit(change: Partial<ScorePlaybackSnapshot>) {
    snapshot = {...snapshot, ...change, revision: snapshot.revision + 1};
    for (const listener of [...listeners]) listener(snapshot);
  }};
}

describe('headless score map navigation', () => {
  it('uses the whole tempo map, clamps local gestures, and freezes published geometry', async () => {
    const view = createScoreMapView({score: music()});
    const states = vi.fn();
    view.subscribe(states);
    expect(states).toHaveBeenCalledTimes(1);
    expect(await view.seekQuarters(3)).toMatchObject({status: 'committed', nominalSeconds: 2, quarters: 3});
    expect(await view.seekQuarters(99)).toMatchObject({nominalSeconds: 3, quarters: 4});
    expect(Object.isFrozen(view.state.map!.cells[0])).toBe(true);
    expect(await view.seekQuarters(Number.NaN)).toMatchObject({status: 'failed', nominalSeconds: 3});
    expect(() => view.configure({maxCells: Infinity})).toThrow(RangeError);
    expect(view.state.quarters).toBe(4);
  });

  it('hydrates the owner and reports its wrapped cursor in nominal units at rate 2', async () => {
    const playback = owner(music());
    playback.emit({nominalSeconds: 0.5});
    playback.source.seekNominal = vi.fn(async (seconds) => { playback.emit({nominalSeconds: seconds % 1}); });
    const view = createScoreMapView({playback: playback.source});
    expect(view.state.nominalSeconds).toBe(0.5);
    expect(await view.seekQuarters(3.5)).toMatchObject({status: 'committed', nominalSeconds: 0.5, quarters: 1});
    expect(playback.source.seekNominal).toHaveBeenCalledWith(2.5);
    view.dispose(); view.dispose();
    expect(playback.listeners.size).toBe(0);
  });

  it('retains authority while a command is pending or rejected', async () => {
    let reject!: (error: unknown) => void;
    const view = createScoreMapView({score: music(), seekNominal: () => new Promise((_resolve, fail) => { reject = fail; })});
    view.setPosition(0.5);
    const seek = view.seekQuarters(3);
    expect(view.state).toMatchObject({pending: true, nominalSeconds: 0.5});
    view.setPosition(1);
    reject(new Error('owner rejected'));
    expect(await seek).toMatchObject({status: 'failed', nominalSeconds: 1});
    expect(view.state.pending).toBe(false);
  });

  it('keeps an unchanged native cursor authoritative after a successful no-op seek', async () => {
    const playback = owner(music());
    playback.source.seekNominal = vi.fn(async () => undefined);
    const view = createScoreMapView({playback: playback.source});
    expect(await view.seekQuarters(3)).toMatchObject({status: 'committed', nominalSeconds: 0, quarters: 0});
    expect(playback.source.seekNominal).toHaveBeenCalledWith(2);
    view.dispose();
  });

  it('does not let an older completion overwrite a newer command', async () => {
    const completions: (() => void)[] = [];
    const view = createScoreMapView({score: music(), seekNominal: () => new Promise((resolve) => { completions.push(resolve); })});
    const first = view.seekQuarters(1);
    const second = view.seekQuarters(3);
    completions[1]!();
    expect(await second).toMatchObject({status: 'committed', quarters: 3});
    completions[0]!();
    expect(await first).toMatchObject({status: 'superseded', quarters: 3});
  });

  it('invalidates commands and reprojects on source replacement, with explicit data precedence', async () => {
    let resolve!: () => void;
    const playback = owner(music());
    playback.source.seekNominal = () => new Promise((done) => { resolve = done; });
    const view = createScoreMapView({playback: playback.source});
    const pending = view.seekQuarters(3);
    const replacement = music();
    playback.emit({score: replacement, sourceRevision: 1, nominalSeconds: 0.25});
    resolve();
    expect(await pending).toMatchObject({status: 'superseded', nominalSeconds: 0.25});
    expect(view.state.score).toBe(replacement);
    view.setScore(music());
    expect(view.state.readiness).toBe('mismatched');
    expect(await view.seekQuarters(1)).toMatchObject({status: 'failed'});
    view.setScore(undefined);
    expect(view.state.score).toBe(replacement);
    expect(view.state.nominalSeconds).toBe(0.25);
  });

  it('does not turn a readonly or unavailable owner into local navigation', async () => {
    const playback = owner(music());
    const adapter = vi.fn();
    const view = createScoreMapView({playback: playback.source, seekNominal: adapter});
    expect(await view.seekQuarters(1)).toMatchObject({status: 'failed'});
    expect(adapter).not.toHaveBeenCalled();
    playback.emit({readiness: 'unavailable'});
    expect(view.state.score).toBeUndefined();
    expect(await view.seekQuarters(1)).toMatchObject({status: 'failed'});
  });

  it('releases replaced sources and ignores their retained stale callback', () => {
    const first = owner(music());
    const second = owner(music());
    const view = createScoreMapView({playback: first.source});
    const stale = [...first.listeners][0]!;
    view.setPlayback(second.source);
    expect(first.listeners.size).toBe(0);
    stale({...first.source.snapshot(), revision: 100, nominalSeconds: 2});
    expect(view.state.score).toBe(second.source.snapshot().score);
    expect(view.state.nominalSeconds).toBe(0);
    view.dispose();
    expect(second.listeners.size).toBe(0);
    expect(() => view.setPosition(1)).toThrow('disposed');
  });

  it('rejects a malformed replacement time before changing effective score or pending authority', async () => {
    const playback = owner(music());
    const view = createScoreMapView({playback: playback.source});
    const before = view.state;
    expect(() => playback.emit({score: music(), sourceRevision: 1, nominalSeconds: NaN})).toThrow(RangeError);
    expect(view.state).toBe(before);
    view.configure({maxCells: 2});
    expect(view.state.score).toBe(before.score);
    view.dispose();
  });

  it('cancels a seek when a pending-state listener replaces the score before delegation', async () => {
    const command = vi.fn();
    const view = createScoreMapView({score: music(), seekNominal: command});
    view.subscribe((state) => { if (state.pending) view.setScore(music()); });
    expect(await view.seekQuarters(2)).toMatchObject({status: 'superseded'});
    expect(command).not.toHaveBeenCalled();
  });

  it('cleans up a source replaced reentrantly during its initial notification', () => {
    const first = owner(music());
    const second = owner(music());
    const view = createScoreMapView();
    view.subscribe((state) => { if (state.score === first.source.snapshot().score) view.setPlayback(second.source); });
    view.setPlayback(first.source);
    expect(first.listeners.size).toBe(0);
    expect(second.listeners.size).toBe(1);
    expect(view.state.score).toBe(second.source.snapshot().score);
    view.dispose();
  });

  it('clears borrowed state even when an old subscription fails to release', () => {
    const playback = owner(music());
    const subscribe = playback.source.subscribe;
    playback.source.subscribe = (listener) => {
      const release = subscribe(listener);
      return () => { release(); throw new Error('cleanup failed'); };
    };
    const replacement = owner(music());
    const view = createScoreMapView({playback: playback.source});
    expect(() => view.setPlayback(replacement.source)).toThrow('cleanup failed');
    expect(playback.listeners.size).toBe(0);
    expect(replacement.listeners.size).toBe(0);
    expect(view.state).toMatchObject({score: undefined, readiness: 'unbound', pending: false});
    view.setPlayback(replacement.source);
    expect(view.state.score).toBe(replacement.source.snapshot().score);
    view.dispose();
  });
});
