// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type ScorePlaybackSnapshot, type ScorePlaybackSource} from '../../src/core';
import {ScorePlayer} from '../../src/play/headless/score-player';
import {ScorePlayerElement} from '../../src/play/element/score-player';
import {createScoreView} from '../../src/view/headless/score-view';
import {ChordAnalysisElement} from '../../src/analyze/element/chord-analysis';
class AnalysisLaneElement extends ChordAnalysisElement {}
import {VoiceLeadingAnalysisElement} from '../../src/analyze/element/voice-leading-analysis';
import {ScoreViewElement as PreviewScoreViewElement} from '../../src/view/element/score-view';
class ScorePreviewElement extends PreviewScoreViewElement {
  override connectedCallback(): void { this.type = 'map'; super.connectedCallback(); }
}
import {bindAnalysisPlayer} from '../../src/analyze/element/internal/player-binding';
import {PlaybackPublisher} from '../../src/play/headless/playback-source';
import {ScoreViewElement} from '../../src/view/element/score-view';

customElements.define('binding-score-player', ScorePlayerElement);
customElements.define('binding-chord-analysis', AnalysisLaneElement);
customElements.define('binding-voice-analysis', VoiceLeadingAnalysisElement);
customElements.define('binding-score-preview', ScorePreviewElement);
customElements.define('binding-score-view', ScoreViewElement);

const players: ScorePlayer[] = [];
const flush = async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); };

function music(pitch = 'C4') {
  const builder = new ScoreBuilder();
  for (const [index, length] of [Duration.quarter(), Duration.whole()].entries()) {
    const part = PartId(`part-${index}`);
    builder.addPart({id: part, name: part});
    builder.addNote(part, {id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: Rational.ZERO, duration: length, voice: VoiceId('voice')});
  }
  return builder.build();
}

function engine(score = music()) {
  const context = {state: 'running', currentTime: 0, sampleRate: 44100, resume: vi.fn(async () => {})};
  const param = () => ({value: 1, setValueAtTime() { return this; }, cancelScheduledValues() { return this; }});
  const node = () => ({context, gain: param(), connect() {}, disconnect() {}});
  Object.assign(context, {destination: node(), createGain: node, createStereoPanner: () => ({...node(), pan: param()})});
  const player = new ScorePlayer(score, {audioContext: context as unknown as AudioContext, synth: {connect() {}, noteOn() {}, noteOff() {}}});
  players.push(player);
  return {player, context, score};
}

function owner(source: ScorePlaybackSource) {
  const element = document.createElement('div') as HTMLDivElement & {playback: ScorePlaybackSource};
  element.id = 'owner';
  element.playback = source;
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
  for (const player of players.splice(0)) player.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('shared native playback source', () => {
  it('initializes a late Headless view without creating/resuming audio and follows rate-aware paused seek', async () => {
    const {player, context, score} = engine();
    player.setRate(2);
    await player.playback.seekNominal!(1);
    const view = createScoreView(score, {playback: player.playback});
    expect(view.state.currentTime).toBe(1);
    expect(player.playback.snapshot()).toMatchObject({score, readiness: 'ready', nominalSeconds: 1, transportSeconds: 0.5, rate: 2});
    expect(context.resume).not.toHaveBeenCalled();
    player.pause();
    expect(player.playback.snapshot().state).toBe('paused');
    view.dispose();
    await player.playback.seekNominal!(0.5);
    expect(view.state.currentTime).toBe(1);
  });

  it('keeps equal pitches in separate parts alive until their own occurrence ends', async () => {
    vi.useFakeTimers();
    const {player, context, score} = engine();
    await player.play();
    vi.advanceTimersByTime(1);
    const view = createScoreView(score, {playback: player.playback});
    const initial = player.playback.snapshot().activeNotes;
    expect(initial).toHaveLength(2);
    expect(new Set(initial.map((note) => note.occurrenceId)).size).toBe(2);
    expect(new Set(initial.map((note) => note.partId)).size).toBe(2);
    expect(view.state.activeNotes).toHaveLength(2);
    context.currentTime = 0.75;
    vi.advanceTimersByTime(750);
    expect(player.playback.snapshot().activeNotes).toHaveLength(1);
    expect(view.state.activeNotes).toHaveLength(1);
    player.pause();
    expect(view.state.activeNotes).toHaveLength(0);
    expect(view.state.currentTime).toBeCloseTo(0.75);
    view.dispose();
  });

  it('does not deliver an older snapshot after a reentrant publication', () => {
    const {player} = engine();
    let mutate = false;
    player.playback.subscribe(() => { if (mutate) { mutate = false; player.setRate(3); } });
    const revisions: number[] = [];
    const rates: Array<number | null> = [];
    player.playback.subscribe((snapshot) => { revisions.push(snapshot.revision); rates.push(snapshot.rate); });
    mutate = true;
    player.setRate(2);
    expect(rates).toEqual([1, 3]);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
  });

  it('rejects failed native seek restart and reports paused state', async () => {
    const {player, context} = engine();
    const failures: unknown[] = [];
    player.on('operationError', (failure) => failures.push(failure.error));
    await player.play();
    context.state = 'suspended';
    context.resume.mockRejectedValueOnce(new Error('resume denied'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(player.playback.seekNominal!(1)).rejects.toThrow('resume denied');
    expect(player.playback.snapshot().state).toBe('paused');
    expect(player.playback.snapshot().activeNotes).toHaveLength(0);
    expect(failures).toHaveLength(1);
  });

  it('borrows loaded Element data and follows source replacement without repeated src', async () => {
    const player = document.createElement('binding-score-player') as ScorePlayerElement;
    player.id = 'owner';
    const first = music();
    player.score = first;
    document.body.append(player);
    await flush();
    const before = player.playback.snapshot();
    const follower = document.createElement('binding-chord-analysis') as AnalysisLaneElement;

    follower.setAttribute('player', '#owner');
    document.body.append(follower);
    await flush();
    expect(follower.textContent).not.toBe('');
    expect(before.score).toBe(first);
    const next = music('G4');
    player.score = next;
    await flush();
    expect(player.playback.snapshot().score).toBe(next);
    expect(player.playback.snapshot().sourceRevision).toBeGreaterThan(before.sourceRevision);
    expect(follower.getAttribute('data-player-state')).toBe('ready');
    const snapshots: ScorePlaybackSnapshot[] = [];
    const detach = player.playback.subscribe((snapshot) => snapshots.push(snapshot));
    follower.remove();
    expect(player.playback.snapshot().readiness).toBe('ready');
    player.remove();
    expect(snapshots.at(-1)?.readiness).toBe('disposed');
    detach();
  });

  it('discovers a late owner, follows replacement and rejects ambiguous selectors', async () => {
    const host = document.createElement('div');
    host.setAttribute('player', '#owner');
    document.body.append(host);
    const snapshots: Array<ScorePlaybackSnapshot | undefined> = [];
    const detach = bindAnalysisPlayer(host, {snapshot: (snapshot) => snapshots.push(snapshot)});
    expect(host.getAttribute('data-player-state')).toBe('missing');
    const a = engine();
    const element = owner(a.player.playback);
    await flush();
    expect(snapshots.at(-1)?.score).toBe(a.score);
    element.remove();
    const b = engine(music('G4'));
    owner(b.player.playback);
    await flush();
    expect(snapshots.at(-1)?.score).toBe(b.score);
    owner(a.player.playback);
    await flush();
    expect(host.getAttribute('data-player-state')).toBe('ambiguous');
    expect(snapshots.at(-1)).toBeUndefined();
    detach?.();
  });

  it('releases replaced occurrences even when their owner reuses a numeric occurrence ID', () => {
    const {player, score} = engine();
    let state: ScorePlaybackSnapshot = {...player.playback.snapshot(), activeNotes: [Object.freeze({occurrenceId: '1', noteId: 'a', partId: 'part', midi: 60, nominalStartSeconds: 0, nominalEndSeconds: 2})]};
    const source = new PlaybackPublisher(() => state);
    owner(source);
    const host = document.createElement('div');
    host.setAttribute('player', '#owner');
    document.body.append(host);
    const events: string[] = [];
    const detach = bindAnalysisPlayer(host, {noteOn: (midi) => events.push(`on:${midi}`), noteOff: (midi) => events.push(`off:${midi}`)});
    state = {...state, sourceRevision: state.sourceRevision + 1, score, activeNotes: [{...state.activeNotes[0], midi: 67}]};
    source.notify();
    expect(events).toEqual(['on:60', 'off:60', 'on:67']);
    detach?.();
  });

  it('abandons the rest of an initial note snapshot after a reentrant pause', async () => {
    vi.useFakeTimers();
    const {player} = engine();
    await player.play();
    vi.advanceTimersByTime(1);
    owner(player.playback);
    const host = document.createElement('div');
    host.setAttribute('player', '#owner');
    document.body.append(host);
    const attacks: number[] = [];
    const detach = bindAnalysisPlayer(host, {noteOn: (midi) => { attacks.push(midi); player.pause(); }});
    expect(attacks).toHaveLength(1);
    expect(player.playback.snapshot().activeNotes).toHaveLength(0);
    detach?.();
  });

  it('accepts legacy events only while a source is unavailable and releases both subscriptions', () => {
    const {player} = engine();
    let state: ScorePlaybackSnapshot = player.playback.snapshot();
    const source = new PlaybackPublisher(() => state);
    const element = owner(source);
    const host = document.createElement('div');
    host.setAttribute('player', '#owner');
    document.body.append(host);
    const noteOn = vi.fn();
    const end = vi.fn();
    const detach = bindAnalysisPlayer(host, {noteOn, end});
    const event = () => element.dispatchEvent(new CustomEvent('webscore:noteon', {detail: {midi: 60, startTime: 0}}));
    event();
    expect(noteOn).not.toHaveBeenCalled();
    state = {...state, readiness: 'unavailable', score: undefined};
    source.notify();
    event();
    expect(noteOn).toHaveBeenCalledExactlyOnceWith(60);
    state = {...state, readiness: 'ready', score: player.playback.snapshot().score};
    source.notify();
    expect(end).toHaveBeenCalledOnce();
    event();
    expect(noteOn).toHaveBeenCalledOnce();
    detach?.();
    state = {...state, readiness: 'unavailable', score: undefined};
    source.notify();
    event();
    expect(noteOn).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
  });

  it.each(['binding-score-view', 'binding-score-preview', 'binding-chord-analysis', 'binding-voice-analysis'])('releases an initial subscription when %s is removed before subscribe returns', (tag) => {
    const {player} = engine();
    const follower = document.createElement(tag);
    follower.setAttribute('player', '#owner');
    const cleanup = vi.fn();
    owner({snapshot: () => player.playback.snapshot(), subscribe(listener) {
      listener(player.playback.snapshot());
      follower.remove();
      return cleanup;
    }});
    document.body.append(follower);
    expect(follower.isConnected).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it.each(['binding-voice-analysis', 'binding-score-preview'])('seeks %s in nominal seconds at rate 2 using a real player', async (tag) => {
    const {player} = engine();
    player.setRate(2);
    owner(player.playback);
    const follower = document.createElement(tag);
    follower.setAttribute('player', '#owner');
    document.body.append(follower);
    await flush();
    if (tag === 'binding-voice-analysis') {
      const surface = follower.querySelector('[role="slider"]');
      expect(surface).not.toBeNull();
      surface!.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}));
    } else {
      const surface = follower.querySelector<HTMLInputElement>('input[type=range]');
      expect(surface).not.toBeNull();
      surface!.value = '4';
      surface!.dispatchEvent(new Event('input', {bubbles: true}));
    }
    await flush();
    expect(player.nominalSeconds).toBeCloseTo(2);
    expect(player.seconds).toBeCloseTo(1);
  });
});
