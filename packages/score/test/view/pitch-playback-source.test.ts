// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {ScorePlaybackNote, ScorePlaybackSnapshot, ScorePlaybackSource} from '../../src/core';
import {definePitchViewElement, type PitchViewElement, type PitchViewType} from '../../src/view/element/pitch-view';

definePitchViewElement();
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function note(occurrenceId: string, midi = 60): ScorePlaybackNote {
  return {occurrenceId, noteId: occurrenceId, partId: 'piano', midi, nominalStartSeconds: 0, nominalEndSeconds: 2};
}

function snapshot(overrides: Partial<ScorePlaybackSnapshot> = {}): ScorePlaybackSnapshot {
  return {revision: 0, sourceRevision: 0, readiness: 'ready', state: 'playing',
    nominalSeconds: 0, nominalDurationSeconds: 2, transportSeconds: 0, transportDurationSeconds: 2,
    rate: 1, activeNotes: [], ...overrides};
}

function player(initial: ScorePlaybackSnapshot) {
  let state = initial;
  const subscriptions = new Set<(value: ScorePlaybackSnapshot) => void>();
  const cleanup = vi.fn();
  const playback: ScorePlaybackSource = {
    snapshot: () => state,
    subscribe: vi.fn((listener) => { subscriptions.add(listener); listener(state); return () => { subscriptions.delete(listener); cleanup(); }; }),
    seekNominal: vi.fn(async () => {}),
  };
  const element = Object.assign(document.createElement('div'), {
    playback, stop: vi.fn(), dispose: vi.fn(),
    legacy: {nominalSeconds: 0, playing: true, activeNotes: [] as Array<{midi: number}>},
    getPlaybackSnapshot() { return this.legacy; },
  });
  element.id = 'pitch-owner';
  document.body.append(element);
  return {element, playback, subscriptions, cleanup, emit(next: ScorePlaybackSnapshot) {
    state = next;
    for (const listener of [...subscriptions]) listener(state);
  }};
}

function mount(type: PitchViewType = 'keyboard') {
  const element = document.createElement('pitch-view') as PitchViewElement;
  element.setAttribute('player', '#pitch-owner');
  element.setAttribute('type', type);
  element.setAttribute('data-motion', 'none');
  document.body.append(element);
  return element;
}

describe('pitch-view shared native follower', () => {
  it.each(['keyboard', 'staff', 'fretboard'] as const)('%s reuses occurrence-aware snapshots and clears reused IDs at stop', (type) => {
    const owner = player(snapshot({activeNotes: [note('left'), note('right')]}));
    const view = mount(type);
    expect(view.active).toEqual([60]);
    expect(owner.playback.subscribe).toHaveBeenCalledOnce();
    owner.element.dispatchEvent(new CustomEvent('webscore:noteon', {detail: {midi: 67}}));
    owner.element.dispatchEvent(new CustomEvent('webscore:noteoff', {detail: {midi: 60}}));
    expect(view.active).toEqual([60]);
    owner.emit(snapshot({revision: 1, activeNotes: [note('right')]}));
    expect(view.active).toEqual([60]);
    owner.emit(snapshot({revision: 2, state: 'stopped', activeNotes: [note('right')]}));
    expect(view.active).toEqual([]);
    owner.emit(snapshot({revision: 3, activeNotes: [note('right')]}));
    expect(view.active).toEqual([60]);
    view.type = 'staff'; view.type = 'fretboard'; view.type = 'keyboard';
    expect(view.active).toEqual([60]);
    expect(owner.playback.subscribe).toHaveBeenCalledOnce();
    owner.emit(snapshot({revision: 4, sourceRevision: 1, activeNotes: [note('right', 65)]}));
    expect(view.active).toEqual([65]);
    owner.emit(snapshot({revision: 5, readiness: 'disposed', activeNotes: [note('right', 65)]}));
    expect(view.active).toEqual([]);
    view.remove();
    expect(owner.cleanup).toHaveBeenCalledOnce();
    expect(owner.element.stop).not.toHaveBeenCalled();
    expect(owner.element.dispose).not.toHaveBeenCalled();
    expect(owner.playback.seekNominal).not.toHaveBeenCalled();
  });

  it('reconstructs unavailable native sources from legacy snapshots without accumulating counts', () => {
    const owner = player(snapshot({readiness: 'unavailable'}));
    owner.element.legacy.activeNotes = [{midi: 64}, {midi: 64}];
    const view = mount();
    expect(view.active).toEqual([64]);
    owner.emit(snapshot({revision: 1, readiness: 'unavailable'}));
    owner.element.legacy.activeNotes = [{midi: 64}];
    owner.element.dispatchEvent(new CustomEvent('webscore:noteoff', {detail: {midi: 64}}));
    expect(view.active).toEqual([64]);
    owner.element.legacy.activeNotes = [];
    owner.element.dispatchEvent(new CustomEvent('webscore:noteoff', {detail: {midi: 64}}));
    expect(view.active).toEqual([]);
    owner.emit(snapshot({revision: 2, activeNotes: [note('native', 67)]}));
    expect(view.active).toEqual([67]);
    owner.element.legacy.activeNotes = [{midi: 72}];
    owner.emit(snapshot({revision: 3, readiness: 'unavailable'}));
    expect(view.active).toEqual([72]);
    owner.element.legacy.activeNotes = [];
    owner.element.dispatchEvent(new CustomEvent('webscore:noteoff', {detail: {midi: 72}}));
    expect(view.active).toEqual([]);
  });

  it('resets revision scope when discovery replaces a native owner and ignores detached updates', async () => {
    const previous = player(snapshot({revision: 20, activeNotes: [note('old')]}));
    const view = mount();
    previous.element.remove();
    const next = player(snapshot({revision: 0, activeNotes: [note('new', 67)]}));
    await flush();
    expect(previous.cleanup).toHaveBeenCalledOnce();
    expect(next.playback.subscribe).toHaveBeenCalledOnce();
    expect(view.active).toEqual([67]);
    previous.emit(snapshot({revision: 30, activeNotes: [note('late', 72)]}));
    expect(view.active).toEqual([67]);
    view.remove();
    next.emit(snapshot({revision: 1, activeNotes: [note('late', 72)]}));
    expect(view.active).toEqual([]);
    expect(next.cleanup).toHaveBeenCalledOnce();
    document.body.append(view);
    expect(view.active).toEqual([72]);
    expect(next.subscriptions.size).toBe(1);
  });

  it('releases the presenter and held state even when a borrowed source cleanup fails', () => {
    const owner = player(snapshot({activeNotes: [note('held')]}));
    const view = mount();
    owner.cleanup.mockImplementation(() => { throw new Error('cleanup failed'); });
    expect(() => view.disconnectedCallback()).toThrow('cleanup failed');
    expect(view.active).toEqual([]);
    expect(view.querySelector('[role="img"]')).toBeNull();
    expect(owner.subscriptions.size).toBe(0);
    expect(() => view.disconnectedCallback()).not.toThrow();
    expect(owner.cleanup).toHaveBeenCalledOnce();
  });
});
