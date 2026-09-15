// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';
import type {ScorePlaybackNote, ScorePlaybackSnapshot, ScorePlaybackSource} from '../../src/core';
import {createPitchView} from '../../src/view/headless/pitch-view';
import {currentFretMarks, currentStaffMarks, readoutPitch, STANDARD_VIEW_TUNING} from '../../src/view/api';

function occurrence(occurrenceId: string, midi = 60): ScorePlaybackNote {
  return {occurrenceId, midi, noteId: occurrenceId, partId: 'piano', nominalStartSeconds: 0, nominalEndSeconds: 2};
}

function snapshot(overrides: Partial<ScorePlaybackSnapshot> = {}): ScorePlaybackSnapshot {
  return {revision: 0, sourceRevision: 0, readiness: 'ready', state: 'playing',
    nominalSeconds: 0, nominalDurationSeconds: 2, transportSeconds: 0, transportDurationSeconds: 2,
    rate: 1, activeNotes: [], ...overrides};
}

function source(initial: ScorePlaybackSnapshot) {
  let state = initial;
  const listeners = new Set<(value: ScorePlaybackSnapshot) => void>();
  const cleanup = vi.fn();
  const playback: ScorePlaybackSource = {
    snapshot: () => state,
    seekNominal: vi.fn(async () => {}),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      try { listener(state); } catch (error) { listeners.delete(listener); throw error; }
      return () => { listeners.delete(listener); cleanup(); };
    }),
  };
  return {playback, cleanup, listeners, emit(next: ScorePlaybackSnapshot) {
    state = next;
    for (const listener of [...listeners]) listener(state);
  }};
}

describe('headless pitch view', () => {
  it('supports overlapping standalone notes with immutable ascending state and exact releases', () => {
    expect(typeof document).toBe('undefined');
    const view = createPitchView();
    const notify = vi.fn();
    const unsubscribe = view.subscribe(notify);
    expect(notify).not.toHaveBeenCalled();
    view.noteOn(67); view.noteOn(60); view.noteOn(60);
    const held = view.state;
    expect(held.activeMidis).toEqual([60, 67]);
    expect(Object.isFrozen(held)).toBe(true);
    expect(Object.isFrozen(held.activeMidis)).toBe(true);
    view.noteOff(60);
    expect(view.state.activeMidis).toEqual([60, 67]);
    view.noteOff(60); view.noteOff(60);
    expect(view.state.activeMidis).toEqual([67]);
    expect(held.activeMidis).toEqual([60, 67]);
    expect(() => view.noteOn(60.5)).toThrow(RangeError);
    expect(() => view.noteOff(128)).toThrow(RangeError);
    unsubscribe();
    const notifications = notify.mock.calls.length;
    view.clear();
    expect(view.state.activeMidis).toEqual([]);
    expect(notify).toHaveBeenCalledTimes(notifications);
    view.dispose(); view.dispose();
    expect(() => view.noteOn(60)).toThrow(/disposed/);
    expect(() => view.clear()).toThrow(/disposed/);
    expect(() => view.subscribe(notify)).toThrow(/disposed/);
  });

  it('reconciles native occurrences, ignores older revisions and resets on loss, stop and replacement', () => {
    const owner = source(snapshot({revision: 10, activeNotes: [occurrence('left'), occurrence('right'), occurrence('third', 67)]}));
    const view = createPitchView({playback: owner.playback});
    expect(owner.playback.subscribe).toHaveBeenCalledOnce();
    expect(view.state.activeMidis).toEqual([60, 67]);
    owner.emit(snapshot({revision: 11, activeNotes: [occurrence('right')]}));
    expect(view.state.activeMidis).toEqual([60]);
    owner.emit(snapshot({revision: 9, activeNotes: [occurrence('late', 64)]}));
    expect(view.state.activeMidis).toEqual([60]);
    owner.emit(snapshot({revision: 12, state: 'paused', activeNotes: [occurrence('right')]}));
    expect(view.state.activeMidis).toEqual([60]);
    owner.emit(snapshot({revision: 13, readiness: 'unavailable', activeNotes: [occurrence('stale')]}));
    expect(view.state.activeMidis).toEqual([]);
    owner.emit(snapshot({revision: 14, sourceRevision: 1, activeNotes: [occurrence('right', 72)]}));
    expect(view.state.activeMidis).toEqual([72]);
    owner.emit(snapshot({revision: 15, sourceRevision: 1, state: 'stopped', activeNotes: [occurrence('right', 72)]}));
    expect(view.state.activeMidis).toEqual([]);
    owner.emit(snapshot({revision: 16, sourceRevision: 1, activeNotes: [occurrence('right', 72)]}));
    expect(view.state.activeMidis).toEqual([72]);
    owner.emit(snapshot({revision: 17, sourceRevision: 1, state: 'ended', activeNotes: [occurrence('right', 72)]}));
    expect(view.state.activeMidis).toEqual([]);
    const next = source(snapshot({activeNotes: [occurrence('fresh', 65)]}));
    view.setPlayback(next.playback);
    expect(owner.cleanup).toHaveBeenCalledOnce();
    expect(view.state.activeMidis).toEqual([65]);
    owner.emit(snapshot({revision: 100, activeNotes: [occurrence('stale', 70)]}));
    expect(view.state.activeMidis).toEqual([65]);
    view.setPlayback(undefined);
    expect(view.state.playback).toBeUndefined();
    expect(view.state.activeMidis).toEqual([]);
    expect(next.cleanup).toHaveBeenCalledOnce();
    view.updatePlayback(snapshot({activeNotes: [occurrence('manual', 69)]}));
    expect(view.state.activeMidis).toEqual([69]);
    view.dispose();
    expect(owner.playback.seekNominal).not.toHaveBeenCalled();
    expect(next.playback.seekNominal).not.toHaveBeenCalled();
  });

  it('deduplicates occurrence IDs and rejects malformed replacements before changing state', () => {
    const view = createPitchView();
    view.updatePlayback(snapshot({activeNotes: [occurrence('one'), occurrence('one')]}));
    view.noteOff(60);
    expect(view.state.activeMidis).toEqual([]);
    view.updatePlayback(snapshot({revision: 1, activeNotes: [occurrence('first'), occurrence('second')]}));
    view.noteOff(60);
    expect(view.state.activeMidis).toEqual([60]);
    const before = view.state;
    for (const invalid of [
      snapshot({revision: NaN}), snapshot({sourceRevision: -1}),
      snapshot({revision: 2, activeNotes: [occurrence('bad', 128)]}),
      snapshot({revision: 2, activeNotes: [occurrence('same', 60), occurrence('same', 64)]}),
    ]) expect(() => view.updatePlayback(invalid)).toThrow(RangeError);
    expect(view.state).toBe(before);
    view.dispose();
  });

  it('lets a newer reentrant publication supersede stale listener delivery', () => {
    const view = createPitchView();
    const seen: number[][] = [];
    view.subscribe((state) => { if (state.activeMidis.length === 1) view.clear(); });
    view.subscribe((state) => { seen.push([...state.activeMidis]); });
    view.noteOn(60);
    expect(seen).toEqual([[]]);
    view.dispose();
  });

  it('releases a source whose initial snapshot triggers replacement or disposal', () => {
    const old = source(snapshot({activeNotes: [occurrence('old')]}));
    const next = source(snapshot({activeNotes: [occurrence('next', 65)]}));
    const view = createPitchView();
    view.subscribe((state) => { if (state.activeMidis[0] === 60) view.setPlayback(next.playback); });
    view.setPlayback(old.playback);
    expect(old.cleanup).toHaveBeenCalledOnce();
    expect(old.listeners.size).toBe(0);
    expect(next.listeners.size).toBe(1);
    expect(view.state.activeMidis).toEqual([65]);
    view.dispose();
    expect(next.cleanup).toHaveBeenCalledOnce();

    const disposedOwner = source(snapshot({activeNotes: [occurrence('first')]}));
    const disposedView = createPitchView();
    disposedView.subscribe((state) => { if (state.playback) disposedView.dispose(); });
    disposedView.setPlayback(disposedOwner.playback);
    expect(disposedOwner.cleanup).toHaveBeenCalledOnce();
    expect(disposedView.state.activeMidis).toEqual([]);
  });

  it('keeps local cleanup complete even when borrowed unsubscription throws', () => {
    const cleanup = vi.fn(() => { throw new Error('cleanup failure'); });
    const initial = snapshot({activeNotes: [occurrence('one')]});
    const view = createPitchView({playback: {snapshot: () => initial, subscribe: (listener) => { listener(initial); return cleanup; }}});
    expect(() => view.dispose()).toThrow('cleanup failure');
    expect(view.state.activeMidis).toEqual([]);
    expect(() => view.dispose()).not.toThrow();
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

describe('public pitch readout projections', () => {
  it('deduplicates held pitches, preserves exact octaves and spells chromatic pairs', () => {
    expect(readoutPitch(0).toString()).toBe('C-1');
    expect(readoutPitch(127, 'flat').toString()).toBe('G9');
    expect(currentStaffMarks([61, 60, 61], 'flat')).toMatchObject([
      {midi: 60, label: 'C4', diatonic: 28, column: 0},
      {midi: 61, label: 'Db4', diatonic: 29, accidental: 'flat'},
    ]);
    expect(currentFretMarks([67, 67], [67, 60, 64, 69], 0, 5)).toMatchObject([
      {midi: 67, stringIndex: 0, fret: 0}, {midi: 67, stringIndex: 2, fret: 3},
    ]);
    expect(currentFretMarks([79], [67, 60, 64, 69], 0, 5)).toEqual([]);
    expect(currentFretMarks([40])[0]).toMatchObject({midi: 40, stringIndex: 0, fret: 0});
    expect(Object.isFrozen(STANDARD_VIEW_TUNING)).toBe(true);
  });

  it('rejects invalid public inputs instead of rounding pitches or inventing a tuning', () => {
    for (const midi of [-1, 60.5, 128, NaN, Infinity]) {
      expect(() => readoutPitch(midi)).toThrow(RangeError);
      expect(() => currentStaffMarks([midi])).toThrow(RangeError);
      expect(() => currentFretMarks([midi])).toThrow(RangeError);
    }
    expect(() => currentStaffMarks([], 'unknown' as never)).toThrow(RangeError);
    expect(() => currentFretMarks([], [], 0, 12)).toThrow(RangeError);
    expect(() => currentFretMarks([], [60.5])).toThrow(RangeError);
    expect(() => currentFretMarks([], [60], -1)).toThrow(RangeError);
    expect(() => currentFretMarks([], [60], 0, 0)).toThrow(RangeError);
    expect(() => currentFretMarks([], [60], 25, 12)).toThrow(RangeError);
    expect(() => currentFretMarks([], [60], 0, 25)).toThrow(RangeError);
  });
});
