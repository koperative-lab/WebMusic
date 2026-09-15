// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {defineSimpleScorePlayerElement, type SimpleScorePlayerElement} from '../../src/play/element/score-player';
import {ScorePlayer} from '../../src/play/headless/score-player';
import type {PlayerController} from '../../src/play/headless/controller';
import type {Rack} from '../../src/play/headless/rack';

defineSimpleScorePlayerElement();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function rackMember(duration: number) {
  const player = {
    seconds: 0, durationSeconds: duration,
    get progress() { return this.seconds / duration; },
    seek: vi.fn(async (seconds: number) => { player.seconds = seconds; }),
  };
  return {mode: 'timeline', player};
}

function mountRack() {
  const members = [rackMember(8), rackMember(3)];
  const rack = {
    list: () => members, on: () => () => {},
    stop: vi.fn(), pause: vi.fn(), play: vi.fn(async () => {}),
  } as unknown as Rack;
  const owner = document.createElement('simple-score-player') as SimpleScorePlayerElement;
  owner.rack = rack;
  document.body.append(owner);
  return {owner, members};
}

describe('Play transport mode contracts', () => {
  it('shares the Rack seek path and longest-member readback with the public element', () => {
    const {owner, members} = mountRack();
    const events = vi.fn();
    owner.addEventListener('webscore:seek', events);
    expect(owner.duration).toBe(8);
    owner.seek(4);
    expect(members.map(({player}) => player.seconds)).toEqual([4, 3]);
    expect(owner.currentTime).toBe(4);
    owner.seekFraction(0.25);
    expect(members.map(({player}) => player.seconds)).toEqual([2, 2]);
    expect(owner.currentTime).toBe(2);
    expect(events).toHaveBeenCalledTimes(2);
    expect(owner.resolvedScore).toBeUndefined();
    expect(owner.getPlaybackSnapshot()).toBeUndefined();
  });

  it('preserves authored children across mode switches and releases a removed nested desk', async () => {
    const {owner} = mountRack();
    const rack = owner.rack;
    const desk = Object.assign(document.createElement('rack-control'), {rack});
    const note = document.createElement('span');
    note.textContent = 'Authored content';
    owner.append(desk, note);
    owner.rack = undefined;
    await flush();
    expect(owner.duration).toBe(8);
    const controller = {
      currentTime: 1, duration: 6, progress: 1 / 6, playing: false, rate: 1.5,
      on: () => () => {}, setRate: vi.fn(), stop: vi.fn(),
    } as unknown as PlayerController;
    owner.controller = controller;
    expect(owner.contains(desk)).toBe(true);
    expect(owner.contains(note)).toBe(true);
    expect(owner.currentTime).toBe(1);
    expect(owner.rate).toBe(1.5);
    owner.controller = undefined;
    expect(owner.duration).toBe(8);
    desk.remove();
    await flush();
    expect(owner.duration).toBe(0);
    expect(owner.contains(note)).toBe(true);
  });

  it('does not let a second desk take over the selected nested Rack', async () => {
    const {owner} = mountRack();
    const firstRack = owner.rack;
    const first = Object.assign(document.createElement('rack-control'), {rack: firstRack});
    const second = Object.assign(document.createElement('rack-control'), {rack: {list: () => []}});
    owner.append(first, second);
    owner.rack = undefined;
    await flush();
    second.dispatchEvent(new CustomEvent('webscore:rack', {detail: {rack: second.rack}, bubbles: true}));
    expect(owner.duration).toBe(8);
  });

  it('does not push stored or default rate into a borrowed controller on mount', () => {
    const controller = {
      currentTime: 1, duration: 6, progress: 1 / 6, playing: false, rate: 1.5,
      on: () => () => {}, setRate: vi.fn(),
    } as unknown as PlayerController;
    const owner = document.createElement('simple-score-player') as SimpleScorePlayerElement;
    owner.controller = controller;
    owner.setAttribute('rate', '2');
    document.body.append(owner);
    expect(controller.setRate).not.toHaveBeenCalled();
    expect(owner.rate).toBe(1.5);
    owner.setAttribute('rate', '4');
    expect(controller.setRate).not.toHaveBeenCalled();
    owner.rate = 3;
    expect(controller.setRate).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('rejects a Rack nominal seek rather than reporting a successful no-op', async () => {
    const {owner, members} = mountRack();
    await expect(owner.seekNominal(2)).rejects.toThrow('no single nominal score axis');
    expect(members[0]!.player.seek).not.toHaveBeenCalled();
  });

  it.each(['seek', 'seekFraction'] as const)('reports a failed native %s restart once', async (method) => {
    const builder = new ScoreBuilder();
    const part = builder.newPartId();
    builder.addPart({id: part, name: 'Piano'});
    builder.addNote(part, {id: builder.newNoteId(), pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(), voice: VoiceId('v')});
    const owner = document.createElement('simple-score-player') as SimpleScorePlayerElement;
    owner.score = builder.build();
    document.body.append(owner);
    await flush();
    const failure = new Error('resume failed');
    vi.spyOn(ScorePlayer.prototype, method).mockRejectedValue(failure);
    const errors: unknown[] = [];
    owner.addEventListener('webscore:error', (event) => errors.push((event as CustomEvent).detail.error));
    owner[method](0.5);
    await flush();
    expect(errors).toEqual([failure]);
  });
});
