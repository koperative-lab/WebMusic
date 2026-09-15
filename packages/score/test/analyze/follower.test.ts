import {describe, expect, it, vi} from 'vitest';
import {
  Duration, NoteId, Pitch, Rational, ScoreBuilder, VoiceId,
  type Score, type ScorePlaybackNote, type ScorePlaybackSnapshot, type ScorePlaybackSource,
} from '../../src/core';
import {createAnalysisFollower, createAnalysisSession, type AnalysisFollowerState} from '../../src/analyze/headless';

function piece(pitch = 'C4') {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: builder.newPartId(), name: 'Piano'});
  builder.addTempo({atQuarters: Rational.ZERO, bpm: 120, unit: 1});
  builder.addTempo({atQuarters: new Rational(4), bpm: 60, unit: 1});
  builder.addNote(part, {id: NoteId('note'), pitch: Pitch.parse(pitch), voice: VoiceId('voice'),
    onsetQuarters: Rational.ZERO, duration: new Duration({base: 8})});
  return builder.build();
}

function note(occurrenceId: string, midi = 60): ScorePlaybackNote {
  return {occurrenceId, midi, partId: 'part', noteId: 'note', nominalStartSeconds: 0, nominalEndSeconds: 6};
}

function playback(score?: Score) {
  let snapshot: ScorePlaybackSnapshot = Object.freeze({revision: 0, sourceRevision: 0,
    readiness: score ? 'ready' : 'empty', state: 'paused', score,
    nominalSeconds: score ? 0 : null, nominalDurationSeconds: score?.durationSeconds ?? null,
    transportSeconds: 0, transportDurationSeconds: score?.durationSeconds ?? null, rate: 1, activeNotes: [],
  });
  const listeners = new Set<(value: ScorePlaybackSnapshot) => void>();
  const seekNominal = vi.fn(async (seconds: number) => { publish({nominalSeconds: seconds, transportSeconds: seconds}); });
  const source: ScorePlaybackSource = {
    snapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot); return () => listeners.delete(listener); },
    seekNominal,
  };
  function publish(patch: Partial<ScorePlaybackSnapshot>) {
    const value = snapshot = Object.freeze({...snapshot, ...patch, revision: snapshot.revision + 1});
    for (const listener of [...listeners]) if (listeners.has(listener)) listener(value);
  }
  return {source, publish, seekNominal, listeners};
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

describe('AnalysisFollower', () => {
  it('analyzes standalone data and seeks across tempo changes without creating a clock', async () => {
    const score = piece();
    const follower = createAnalysisFollower({score});
    expect(follower.state.result).toEqual(createAnalysisSession(score).result);
    expect(follower.state.readiness).toBe('ready');
    expect(await follower.seekQuarters(5)).toEqual({status: 'committed', nominalSeconds: 3});
    expect(follower.state.quarters).toBe(5);
    expect(await follower.seekNominal(100)).toEqual({status: 'committed', nominalSeconds: 6});
    expect(Object.isFrozen(follower.state)).toBe(true);
    expect(Object.isFrozen(follower.state.activeMidis)).toBe(true);
    expect((await follower.seekNominal(-1)).status).toBe('failed');
    expect((await follower.seekQuarters(NaN)).status).toBe('failed');
    follower.dispose();
  });

  it('borrows coherent analysis, time and equal-pitch occurrences and replaces source data', () => {
    const score = piece();
    const owner = playback(score);
    owner.publish({nominalSeconds: 3, activeNotes: [note('one'), note('two'), note('three', 64)]});
    const follower = createAnalysisFollower({playback: owner.source});
    expect(follower.state).toMatchObject({score, nominalSeconds: 3, quarters: 5, activeMidis: [60, 64]});
    expect(follower.state.activeNotes).toHaveLength(3);
    const analysis = follower.state.result;
    owner.publish({nominalSeconds: 3.2, activeNotes: [note('two')]});
    expect(follower.state.activeMidis).toEqual([60]);
    expect(follower.state.result).toBe(analysis);
    const replacement = piece('D4');
    owner.publish({sourceRevision: 1, score: replacement, nominalSeconds: 0, activeNotes: []});
    expect(follower.state.score).toBe(replacement);
    expect(follower.state.result).toEqual(createAnalysisSession(replacement).result);
    expect(follower.state.activeMidis).toEqual([]);
    follower.dispose();
    expect(owner.listeners.size).toBe(0);
    expect(owner.seekNominal).not.toHaveBeenCalled();
  });

  it('retains explicit data, rejects unrelated navigation, then resumes borrowing', async () => {
    const score = piece();
    const explicit = piece('G4');
    const owner = playback(score);
    const follower = createAnalysisFollower({score: explicit, playback: owner.source});
    expect(follower.state).toMatchObject({score: explicit, readiness: 'mismatched', nominalSeconds: null, activeNotes: []});
    expect((await follower.seekQuarters(1)).status).toBe('failed');
    expect(owner.seekNominal).not.toHaveBeenCalled();
    follower.setScore(undefined);
    expect(follower.state).toMatchObject({score, readiness: 'ready', nominalSeconds: 0});
    expect(await follower.seekNominal(1)).toEqual({status: 'committed', nominalSeconds: 1});
    follower.dispose();
  });

  it('distinguishes unavailable/loading/error/disposed sources and clears stale activity', () => {
    const score = piece();
    const owner = playback(score);
    const follower = createAnalysisFollower({playback: owner.source});
    owner.publish({activeNotes: [note('one')]});
    for (const readiness of ['loading', 'error', 'unavailable', 'disposed'] as const) {
      owner.publish({readiness, score: undefined, nominalSeconds: null, error: readiness === 'error' ? 'failed' : undefined});
      expect(follower.state).toMatchObject({readiness, score: undefined, result: undefined, nominalSeconds: null, activeMidis: []});
    }
    follower.dispose();
    follower.dispose();
    expect(owner.listeners.size).toBe(0);
    expect(() => follower.setScore(score)).toThrow('disposed');
  });

  it('commits the owner result after loop wrapping and does not invent an optimistic position', async () => {
    const owner = playback(piece());
    owner.seekNominal.mockImplementation(async () => { owner.publish({nominalSeconds: 0.5}); });
    const follower = createAnalysisFollower({playback: owner.source});
    expect(await follower.seekNominal(4)).toEqual({status: 'committed', nominalSeconds: 0.5});
    expect(follower.state.nominalSeconds).toBe(0.5);
    follower.dispose();
  });

  it('supersedes stale seek completion and failure after newer commands, replacement or disposal', async () => {
    const owner = playback(piece());
    const first = deferred();
    owner.seekNominal.mockImplementationOnce(() => first.promise);
    const follower = createAnalysisFollower({playback: owner.source});
    const old = follower.seekNominal(1);
    expect(await follower.seekNominal(2)).toEqual({status: 'committed', nominalSeconds: 2});
    first.reject(new Error('old failure'));
    expect(await old).toEqual({status: 'superseded', nominalSeconds: 2});
    const second = deferred();
    owner.seekNominal.mockImplementationOnce(() => second.promise);
    const pending = follower.seekNominal(4);
    owner.publish({sourceRevision: 1, score: piece('D4'), nominalSeconds: 0});
    second.resolve();
    expect((await pending).status).toBe('superseded');
    const third = deferred();
    owner.seekNominal.mockImplementationOnce(() => third.promise);
    const disposed = follower.seekNominal(1);
    follower.dispose();
    third.resolve();
    expect(await disposed).toEqual({status: 'superseded', nominalSeconds: null});
  });

  it('preserves authoritative state on command failure and read-only input', async () => {
    const owner = playback(piece());
    owner.seekNominal.mockRejectedValue(new Error('seek failed'));
    const follower = createAnalysisFollower({playback: owner.source});
    expect(await follower.seekNominal(3)).toMatchObject({status: 'failed', nominalSeconds: 0, error: new Error('seek failed')});
    follower.setPlayback({...owner.source, seekNominal: undefined});
    expect((await follower.seekNominal(3)).status).toBe('failed');
    follower.dispose();
  });

  it('reports owner snapshot failures as failed outcomes without rejecting the command promise', async () => {
    const owner = playback(piece());
    const follower = createAnalysisFollower({playback: owner.source});
    const read = vi.spyOn(owner.source, 'snapshot').mockImplementationOnce(() => { throw new Error('cannot read'); });
    expect(await follower.seekNominal(1)).toMatchObject({status: 'failed', error: new Error('cannot read')});
    read.mockRestore();
    owner.seekNominal.mockImplementationOnce(async () => {
      vi.spyOn(owner.source, 'snapshot').mockImplementation(() => { throw new Error('lost owner'); });
    });
    expect(await follower.seekNominal(1)).toMatchObject({status: 'failed', error: new Error('lost owner')});
    follower.dispose();
  });

  it('orders reentrant publications and releases a replaced owner during initial subscription', () => {
    const score = piece();
    const owner = playback(score);
    const next = playback(piece('D4'));
    const follower = createAnalysisFollower({score});
    const seen: AnalysisFollowerState[] = [];
    follower.subscribe((state) => {
      if (state.playbackState === 'paused' && state.score === score) follower.setPlayback(next.source);
    });
    follower.subscribe((state) => seen.push(state));
    follower.setScore(undefined);
    follower.setPlayback(owner.source);
    expect(owner.listeners.size).toBe(0);
    expect(next.listeners.size).toBe(1);
    expect(follower.state.score).toBe(next.source.snapshot().score);
    expect(seen.at(-1)).toBe(follower.state);
    expect(seen.every((state, index) => index === 0 || state.revision > seen[index - 1]!.revision)).toBe(true);
    follower.dispose();
  });

  it('supports reentrant explicit score replacement during a source switch', () => {
    const old = piece();
    const replacement = piece('D4');
    const owner = playback(old);
    const follower = createAnalysisFollower();
    follower.subscribe((state) => {
      if (state.score === old) follower.setScore(replacement);
    });
    follower.setPlayback(owner.source);
    expect(follower.state).toMatchObject({score: replacement, readiness: 'mismatched', nominalSeconds: null});
    expect(owner.listeners.size).toBe(1);
    follower.dispose();
  });

  it('finishes replacement and releases the old listener before reporting a cleanup failure', () => {
    const old = playback(piece());
    const next = playback(piece('D4'));
    const source: ScorePlaybackSource = {...old.source, subscribe(listener) {
      const detach = old.source.subscribe(listener);
      return () => { detach(); throw new Error('cleanup failed'); };
    }};
    const follower = createAnalysisFollower({playback: source});
    expect(() => follower.setPlayback(next.source)).toThrow('cleanup failed');
    expect(follower.state).toMatchObject({score: next.source.snapshot().score, readiness: 'ready', nominalSeconds: 0, activeMidis: []});
    expect(old.listeners.size).toBe(0);
    expect(next.listeners.size).toBe(1);
    follower.dispose();
    expect(next.listeners.size).toBe(0);
  });

  it('does not dispatch a stale command after a snapshot getter replaces the owner', async () => {
    const old = playback(piece());
    const next = playback(piece('D4'));
    const follower = createAnalysisFollower({playback: old.source});
    const snapshot = old.source.snapshot();
    vi.spyOn(old.source, 'snapshot').mockImplementationOnce(() => {
      follower.setPlayback(next.source);
      return snapshot;
    });
    expect((await follower.seekNominal(1)).status).toBe('superseded');
    expect(old.seekNominal).not.toHaveBeenCalled();
    expect(next.seekNominal).not.toHaveBeenCalled();
    follower.dispose();
  });

  it('retains both cleanup and replacement failures without requiring AggregateError', () => {
    const old = playback(piece());
    const cleanupError = new Error('cleanup failed');
    const attachError = new Error('cannot subscribe');
    const source: ScorePlaybackSource = {...old.source, subscribe(listener) {
      const detach = old.source.subscribe(listener);
      return () => { detach(); throw cleanupError; };
    }};
    const next = playback(piece('D4'));
    next.source.subscribe = () => { throw attachError; };
    const follower = createAnalysisFollower({playback: source});
    let failure: unknown;
    try { follower.setPlayback(next.source); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({errors: [cleanupError, attachError]});
    expect(follower.state.readiness).toBe('empty');
    expect(old.listeners.size).toBe(0);
    follower.dispose();
  });

  it('clears borrowed authority when a replacement cannot subscribe', () => {
    const old = playback(piece());
    const failed = playback(piece('D4'));
    failed.source.subscribe = () => { throw new Error('cannot subscribe'); };
    const follower = createAnalysisFollower({playback: old.source});
    old.publish({activeNotes: [note('old')]});
    expect(() => follower.setPlayback(failed.source)).toThrow('cannot subscribe');
    expect(follower.state).toMatchObject({score: undefined, result: undefined, readiness: 'empty', nominalSeconds: null, activeNotes: []});
    expect(old.listeners.size).toBe(0);
    follower.dispose();
  });

  it('does not dispatch after a command getter disposes the follower', async () => {
    const owner = playback(piece());
    const follower = createAnalysisFollower({playback: owner.source});
    Object.defineProperty(owner.source, 'seekNominal', {get() { follower.dispose(); return owner.seekNominal; }});
    expect((await follower.seekNominal(1)).status).toBe('superseded');
    expect(owner.seekNominal).not.toHaveBeenCalled();
    expect(owner.listeners.size).toBe(0);
  });

  it('does not regress observed state when a manual refresh returns an older revision', () => {
    const owner = playback(piece());
    const stale = owner.source.snapshot();
    const follower = createAnalysisFollower({playback: owner.source});
    owner.publish({nominalSeconds: 3, activeNotes: [note('current')]});
    const current = follower.state;
    vi.spyOn(owner.source, 'snapshot').mockReturnValue(stale);
    follower.setPlayback(owner.source);
    expect(follower.state).toBe(current);
    follower.dispose();
  });
});
