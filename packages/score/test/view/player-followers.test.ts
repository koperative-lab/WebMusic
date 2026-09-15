// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {PitchViewElement, ScoreViewElement} from '../../src/view/element';
import {SimpleScorePlayerElement} from '../../src/play/element/score-player';

const io = vi.hoisted(() => ({load: vi.fn()}));
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: io.load}));
customElements.define('follower-keyboard', PitchViewElement);
customElements.define('follower-score', ScoreViewElement);
customElements.define('follower-player', SimpleScorePlayerElement);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function music(pitches = ['C4', 'E4', 'G4', 'C5', 'C4', 'E4', 'G4', 'C5']): Score {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Piano'});
  const voice = VoiceId('melody');
  pitches.forEach((pitch, index) => builder.addNote(part, {
    id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: new Rational(index),
    duration: Duration.quarter(), voice,
  }));
  return builder.build();
}

function noteSource(id = 'source') {
  const state = {
    nominalSeconds: 1, transportSeconds: 0.5, transportDurationSeconds: 2,
    rate: 2, playing: true,
    activeNotes: [] as Array<{midi: number; startTime?: number}>,
  };
  const node = Object.assign(document.createElement('div'), {getPlaybackSnapshot: () => ({...state})});
  node.id = id;
  document.body.append(node);
  return {node, state};
}

function emit(node: Element, type: string, detail?: unknown) {
  node.dispatchEvent(new CustomEvent(`webscore:${type}`, {detail, bubbles: true}));
}

function keyboard(attributes: Record<string, string> = {player: '#source'}) {
  const node = document.createElement('follower-keyboard') as PitchViewElement;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  document.body.append(node);
  return node;
}

async function nativePlayer(score = music()) {
  const node = document.createElement('follower-player') as SimpleScorePlayerElement;
  node.id = 'source';
  node.score = score;
  document.body.append(node);
  await flush();
  return node;
}

async function scoreView(attributes: Record<string, string> = {player: '#source'}) {
  const node = document.createElement('follower-score') as ScoreViewElement;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  document.body.append(node);
  await flush();
  return node;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('composable View player followers', () => {
  it('hydrates duplicate held pitches, prioritizes player over source and reconciles pause snapshots', () => {
    const selected = noteSource();
    const legacy = noteSource('legacy');
    selected.state.activeNotes = [{midi: 60, startTime: 0}, {midi: 60, startTime: 1}, {midi: 64, startTime: 1}];
    const view = keyboard({player: '#source', source: '#legacy'});
    expect(view.active).toEqual([60, 64]);
    selected.state.activeNotes.splice(0, 1);
    emit(selected.node, 'noteoff', {midi: 60, startTime: 0});
    expect(view.active).toEqual([60, 64]);
    emit(legacy.node, 'noteon', {midi: 67});
    expect(view.active).toEqual([60, 64]);
    selected.state.activeNotes = [];
    selected.state.playing = false;
    emit(selected.node, 'statechange', selected.state);
    expect(view.active).toEqual([]);
    expect(view.querySelector('[data-midi="60"]')?.getAttribute('data-active')).toBe('false');
  });

  it('discovers and replaces late targets, rejects invalid/ambiguous selectors, and releases listeners', async () => {
    const view = keyboard();
    const first = noteSource();
    first.state.activeNotes = [{midi: 60}];
    await flush();
    expect(view.active).toEqual([60]);
    first.node.remove();
    const second = noteSource();
    second.state.activeNotes = [{midi: 64}];
    await flush();
    emit(first.node, 'noteon', {midi: 72});
    expect(view.active).toEqual([64]);
    const ambiguous = noteSource();
    await flush();
    expect(view.active).toEqual([]);
    ambiguous.node.remove();
    await flush();
    expect(view.active).toEqual([64]);
    view.setAttribute('player', '[');
    expect(view.active).toEqual([]);
    view.setAttribute('player', '#source');
    expect(view.active).toEqual([64]);
    view.remove();
    emit(second.node, 'noteon', {midi: 67});
    expect(view.active).toEqual([]);
  });

  it('keeps legacy source and follows a late custom element upgrade without requiring another event', async () => {
    const target = document.createElement('late-view-source');
    target.id = 'source';
    document.body.append(target);
    const view = keyboard({source: '#source'});
    customElements.define('late-view-source', class extends HTMLElement {
      getPlaybackSnapshot() {
        return {nominalSeconds: 0, rate: 1, playing: true, activeNotes: [{midi: 67}]};
      }
    });
    await flush();
    expect(view.active).toEqual([67]);
  });

  it('ignores descendant request events and clears seek/stop/source replacement note state', () => {
    const target = noteSource();
    target.state.activeNotes = [{midi: 60}];
    const view = keyboard();
    const child = document.createElement('div');
    target.node.append(child);
    emit(child, 'noteon', {midi: 72});
    expect(view.active).toEqual([60]);
    for (const type of ['seek', 'stop', 'scorechange']) {
      target.state.activeNotes = [];
      emit(target.node, type);
      expect(view.active).toEqual([]);
      target.state.activeNotes = [{midi: 64}];
      emit(target.node, 'noteon', {midi: 64});
    }
  });

  it('borrows one loaded score and follows actual paused nominal time across rate, seek and end', async () => {
    const score = music();
    io.load.mockResolvedValueOnce(score);
    const source = document.createElement('follower-player') as SimpleScorePlayerElement;
    source.id = 'source';
    source.setAttribute('src', 'piece.mid');
    document.body.append(source);
    await flush();
    source.rate = 2;
    await source.seekNominal(1.25);
    const first = await scoreView();
    const second = await scoreView();
    expect(first.score).toBe(score);
    expect(second.score).toBe(score);
    expect(first.currentTime).toBeCloseTo(1.25);
    expect(first.active).toEqual([67]);
    expect(io.load).toHaveBeenCalledTimes(1);
    source.rate = 0.5;
    expect(first.currentTime).toBeCloseTo(1.25);
    expect(second.currentTime).toBeCloseTo(1.25);
    expect(source.currentTime).toBeCloseTo(2.5);
    await source.seekNominal(2.25);
    expect(first.currentTime).toBeCloseTo(2.25);
    expect(first.active).toEqual([60]);
    await source.seekNominal(score.durationSeconds);
    emit(source, 'end');
    expect(first.currentTime).toBeCloseTo(score.durationSeconds);
    expect(first.active).toEqual([]);
    expect(io.load).toHaveBeenCalledTimes(1);
  });

  it('retains explicit > src > player precedence and clears borrowed data when its source disappears', async () => {
    const source = await nativePlayer();
    const own = music(['D4', 'F4']);
    io.load.mockResolvedValueOnce(own);
    const view = await scoreView({player: '#source', src: 'own.mid'});
    expect(view.score).toBe(own);
    const explicit = music(['A4']);
    view.score = explicit;
    await flush();
    expect(view.score).toBe(explicit);
    expect(io.load).toHaveBeenCalledTimes(1);
    view.removeAttribute('src');
    view.score = undefined;
    await flush();
    expect(view.score).toBe(source.resolvedScore);
    source.remove();
    await flush();
    expect(view.score).toBeUndefined();
    expect(view.currentTime).toBe(0);
    expect(view.querySelector('svg')).toBeNull();
  });

  it('clears and rebinds a score view when a uniquely selected owner is replaced', async () => {
    const first = await nativePlayer();
    const view = await scoreView();
    await first.seekNominal(1);
    expect(view.currentTime).toBe(1);
    first.remove();
    const replacement = await nativePlayer(music(['D4', 'F4', 'A4', 'D5']));
    await replacement.seekNominal(0.75);
    await flush();
    expect(view.score).toBe(replacement.resolvedScore);
    expect(view.currentTime).toBeCloseTo(0.75);
    expect(view.active).toEqual([65]);
    view.remove();
    await replacement.seekNominal(0);
    expect(view.currentTime).toBe(0);
  });
});
