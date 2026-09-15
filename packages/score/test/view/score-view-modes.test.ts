// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {ScoreViewElement, type ScoreViewElementType} from '../../src/view/element/score-view';
import {createScoreView} from '../../src/view/headless/score-view';
import {SimpleScorePlayerElement} from '../../src/play/element/score-player';

const io = vi.hoisted(() => ({load: vi.fn()}));
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: io.load}));
vi.mock('../../src/view/headless/score-view', async (original) => {
  const actual = await original<typeof import('../../src/view/headless/score-view')>();
  return {...actual, createScoreView: vi.fn(actual.createScoreView)};
});
customElements.define('mode-score-view', ScoreViewElement);
customElements.define('mode-score-player', SimpleScorePlayerElement);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function music(pitch = 'C4'): Score {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Lead'});
  builder.addNote(part, {
    id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: Rational.ZERO,
    duration: Duration.whole(), voice: VoiceId('lead'),
  });
  for (let i = 0; i < 4; i += 1) builder.addMeasure({
    id: builder.newMeasureId(), number: i + 1,
    onsetQuarters: new Rational(i * 4), durationQuarters: new Rational(4),
  });
  return builder.build();
}

async function mount(type: ScoreViewElementType, attrs: Record<string, string> = {}, score?: Score) {
  const view = document.createElement('mode-score-view') as ScoreViewElement;
  view.type = type;
  for (const [name, value] of Object.entries(attrs)) view.setAttribute(name, value);
  if (score) view.score = score;
  document.body.append(view);
  await flush();
  return view;
}

function player(score = music()) {
  const state = {nominalSeconds: 1, rate: 2, playing: false, activeNotes: []};
  const target = Object.assign(document.createElement('div'), {
    resolvedScore: score,
    getPlaybackSnapshot: () => ({...state}),
    seek: vi.fn<((seconds: number) => void | Promise<void>)>(),
  });
  target.id = 'player';
  document.body.append(target);
  return {target, state};
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('score-view lightweight modes', () => {
  it('switches loaded URL modes without another fetch and releases the old presenter', async () => {
    const score = music();
    io.load.mockResolvedValueOnce(score);
    const view = await mount('map', {src: 'piece.mid'});
    await vi.waitFor(() => expect(view.querySelectorAll('button')).toHaveLength(4));
    const oldRegion = view.querySelectorAll('button')[1]!;
    const seek = vi.fn();
    view.addEventListener('webscore:seek', seek);
    view.type = 'thumbnail';
    expect(view.querySelector('svg[role="img"]')).not.toBeNull();
    expect(view.querySelector('input[type="range"]')).toBeNull();
    oldRegion.click();
    expect(seek).not.toHaveBeenCalled();
    expect(createScoreView).not.toHaveBeenCalled();
    view.type = 'piano-roll';
    expect(createScoreView).toHaveBeenCalledTimes(1);
    const controller = vi.mocked(createScoreView).mock.results[0]!.value;
    const disposed = vi.spyOn(controller, 'dispose');
    view.type = 'map';
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(view.score).toBe(score);
    expect(io.load).toHaveBeenCalledTimes(1);
  });

  it('finishes one pending source in the selected mode without canceling it on type changes', async () => {
    let finish!: (score: Score) => void;
    io.load.mockImplementationOnce(() => new Promise<Score>((resolve) => { finish = resolve; }));
    const view = await mount('piano-roll', {src: 'pending.mid'});
    await vi.waitFor(() => expect(io.load).toHaveBeenCalledTimes(1));
    const signal = io.load.mock.calls[0]![1].signal as AbortSignal;
    view.type = 'map';
    view.type = 'thumbnail';
    expect(signal.aborted).toBe(false);
    finish(music());
    await flush();
    expect(view.querySelector('svg[role="img"]')).not.toBeNull();
    expect(createScoreView).not.toHaveBeenCalled();
    expect(io.load).toHaveBeenCalledTimes(1);
  });

  it('borrows a paused native score once, seeks nominal time and keeps its cursor across mode switches', async () => {
    const source = document.createElement('mode-score-player') as SimpleScorePlayerElement;
    source.id = 'player';
    source.score = music();
    document.body.append(source);
    await flush();
    source.rate = 2;
    await source.seekNominal(1.25);
    const view = await mount('map', {player: '#player'});
    expect(view.score).toBe(source.resolvedScore);
    expect(view.currentTime).toBeCloseTo(1.25);
    view.querySelectorAll('button')[1]!.click();
    await flush();
    expect(source.getPlaybackSnapshot()?.nominalSeconds).toBeCloseTo(2);
    expect(source.currentTime).toBeCloseTo(1);
    expect(view.currentTime).toBeCloseTo(2);
    view.type = 'thumbnail';
    const preview = view.querySelector('svg');
    expect(view.active).toEqual([]);
    await source.seekNominal(0.5);
    expect(view.querySelector('svg')).toBe(preview);
    expect(view.currentTime).toBeCloseTo(0.5);
    expect(view.querySelector('button, input, [role="slider"]')).toBeNull();
    view.type = 'piano-roll';
    expect(view.currentTime).toBeCloseTo(0.5);
    expect(view.active).toEqual([60]);
    expect(io.load).not.toHaveBeenCalled();
  });

  it('converts map seconds to transport seconds and preserves position after rejected seeks', async () => {
    const {target} = player();
    const view = await mount('map', {player: '#player'});
    view.querySelectorAll('button')[1]!.click();
    expect(target.seek).toHaveBeenCalledWith(1);
    expect(view.currentTime).toBe(2);
    target.seek.mockRejectedValueOnce(new Error('seek rejected'));
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    view.querySelectorAll('button')[2]!.click();
    await flush();
    expect(view.currentTime).toBe(2);
    expect(report).toHaveBeenCalledTimes(1);
    expect(view.querySelectorAll('button')[1]!.getAttribute('aria-pressed')).toBe('true');
  });

  it('invalidates reentrant and pending map commands when the source, mode or selected owner changes', async () => {
    const {target} = player();
    const view = await mount('map', {player: '#player'});
    view.addEventListener('webscore:seek', () => { view.type = 'thumbnail'; }, {once: true});
    view.querySelectorAll('button')[1]!.click();
    expect(target.seek).not.toHaveBeenCalled();
    view.type = 'map';
    let reject!: (error: Error) => void;
    target.seek.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    view.querySelectorAll('button')[1]!.click();
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    target.remove();
    const replacement = player(music('D4'));
    replacement.state.nominalSeconds = 3;
    await flush();
    reject(new Error('old owner failed'));
    await flush();
    expect(view.score).toBe(replacement.target.resolvedScore);
    expect(view.currentTime).toBe(3);
    expect(report).not.toHaveBeenCalled();
    view.addEventListener('webscore:seek', () => { view.score = music('G4'); }, {once: true});
    view.querySelectorAll('button')[1]!.click();
    expect(replacement.target.seek).not.toHaveBeenCalled();
  });

  it('discovers late owners and clears invalid or ambiguous selections without fetching their src', async () => {
    const view = await mount('map', {player: '#player'});
    expect(view.score).toBeUndefined();
    const first = player();
    first.target.setAttribute('src', 'owned.mid');
    await flush();
    expect(view.score).toBe(first.target.resolvedScore);
    expect(view.currentTime).toBe(1);
    const other = player(music('G4'));
    await flush();
    expect(view.score).toBeUndefined();
    expect(view.querySelector('input[type="range"]')).toBeNull();
    other.target.remove();
    await flush();
    expect(view.score).toBe(first.target.resolvedScore);
    view.setAttribute('player', '[');
    await flush();
    expect(view.score).toBeUndefined();
    expect(view.currentTime).toBe(0);
    expect(io.load).not.toHaveBeenCalled();
  });

  it('reweights map cells without remounting its keyboard surface or loading the score again', async () => {
    const view = await mount('map', {}, music());
    const lane = view.querySelector('input[type="range"]') as HTMLInputElement;
    lane.focus();
    view.setAttribute('for-part', 'missing');
    view.setAttribute('cells', '2');
    expect(view.forPart).toBe('missing');
    expect(view.cells).toBe(2);
    expect(view.querySelectorAll('button')).toHaveLength(2);
    expect(view.querySelector('input[type="range"]')).toBe(lane);
    expect(document.activeElement).toBe(lane);
    lane.value = '0';
    lane.dispatchEvent(new Event('input', {bubbles: true}));
    expect(view.currentTime).toBe(0);
    expect(createScoreView).not.toHaveBeenCalled();
  });

  it('keeps standalone navigation across types and respects external host sizing', async () => {
    const view = await mount('map', {}, music());
    view.style.width = '50%';
    view.style.height = '5rem';
    view.querySelectorAll('button')[1]!.click();
    expect(view.currentTime).toBe(2);
    view.type = 'piano-roll';
    expect(view.currentTime).toBe(2);
    view.type = 'thumbnail';
    view.setAttribute('note-color', '12, 34, 56');
    expect(view.querySelector('rect')?.getAttribute('fill')).toBe('rgb(12, 34, 56)');
    expect(view.currentTime).toBe(2);
    expect(view.style.width).toBe('50%');
    expect(view.style.height).toBe('5rem');
    view.setAttribute('width', '240');
    expect(view.style.width).toBe('240px');
    view.style.width = '75%';
    view.removeAttribute('width');
    expect(view.style.width).toBe('75%');
    view.type = 'map';
    expect(view.querySelectorAll('button')[1]!.getAttribute('aria-pressed')).toBe('true');
  });
});
