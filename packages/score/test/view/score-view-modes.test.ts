// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {ScoreViewElement, type ScoreViewElementType} from '../../src/view/element/score-view';
import {createScoreView} from '../../src/view/headless/score-view';
import {ScorePlayerElement} from '../../src/play/element/score-player';

const io = vi.hoisted(() => ({load: vi.fn()}));
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: io.load}));
vi.mock('../../src/view/headless/score-view', async (original) => {
  const actual = await original<typeof import('../../src/view/headless/score-view')>();
  return {...actual, createScoreView: vi.fn(actual.createScoreView)};
});
customElements.define('mode-score-view', ScoreViewElement);
customElements.define('mode-score-player', ScorePlayerElement);
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

describe('score-view type switching', () => {
  it('accepts only piano-roll, staff and waterfall; retired map and thumbnail values fall back to piano-roll', async () => {
    const view = await mount('piano-roll', {}, music());
    for (const retired of ['map', 'thumbnail']) {
      view.setAttribute('type', retired);
      expect(view.type).toBe('piano-roll');
      expect(view.querySelector('button, input[type="range"]')).toBeNull();
    }
    expect('forPart' in view).toBe(false);
    expect('cells' in view).toBe(false);
    expect(ScoreViewElement.observedAttributes).not.toContain('for-part');
    expect(ScoreViewElement.observedAttributes).not.toContain('cells');
  });

  it('switches loaded URL modes without another fetch and releases the old presenter', async () => {
    const score = music();
    io.load.mockResolvedValueOnce(score);
    const view = await mount('piano-roll', {src: 'piece.mid'});
    await vi.waitFor(() => expect(createScoreView).toHaveBeenCalledTimes(1));
    const controller = vi.mocked(createScoreView).mock.results[0]!.value;
    const disposed = vi.spyOn(controller, 'dispose');
    view.type = 'waterfall';
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(createScoreView).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createScoreView).mock.calls[1]![1]).toEqual({type: 'waterfall'});
    expect(view.score).toBe(score);
    expect(io.load).toHaveBeenCalledTimes(1);
  });

  it('finishes one pending source in the selected mode without canceling it on type changes', async () => {
    let finish!: (score: Score) => void;
    io.load.mockImplementationOnce(() => new Promise<Score>((resolve) => { finish = resolve; }));
    const view = await mount('piano-roll', {src: 'pending.mid'});
    await vi.waitFor(() => expect(io.load).toHaveBeenCalledTimes(1));
    const signal = io.load.mock.calls[0]![1].signal as AbortSignal;
    view.type = 'staff';
    view.type = 'waterfall';
    expect(signal.aborted).toBe(false);
    expect(createScoreView).not.toHaveBeenCalled();
    finish(music());
    await flush();
    expect(createScoreView).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createScoreView).mock.calls[0]![1]).toEqual({type: 'waterfall'});
    expect(io.load).toHaveBeenCalledTimes(1);
  });

  it('borrows a paused native score once and keeps its cursor across mode switches', async () => {
    const source = document.createElement('mode-score-player') as ScorePlayerElement;
    source.id = 'player';
    source.score = music();
    document.body.append(source);
    await flush();
    source.rate = 2;
    await source.seekNominal(1.25);
    const view = await mount('piano-roll', {player: '#player'});
    expect(view.score).toBe(source.resolvedScore);
    expect(view.currentTime).toBeCloseTo(1.25);
    view.type = 'waterfall';
    expect(view.currentTime).toBeCloseTo(1.25);
    await source.seekNominal(0.5);
    expect(view.currentTime).toBeCloseTo(0.5);
    view.type = 'piano-roll';
    expect(view.currentTime).toBeCloseTo(0.5);
    expect(view.active).toEqual([60]);
    expect(io.load).not.toHaveBeenCalled();
  });

  it('keeps borrowed score, notes and time while changing a roll or waterfall direction', async () => {
    const source = document.createElement('mode-score-player') as ScorePlayerElement;
    source.id = 'direction-player';
    source.score = music();
    document.body.append(source);
    await flush();
    await source.seekNominal(0.5);
    const view = await mount('piano-roll', {player: '#direction-player'});
    for (const type of ['piano-roll', 'waterfall'] as const) {
      view.type = type;
      for (const direction of ['up', 'down', 'left', 'right'] as const) {
        view.direction = direction;
        expect(view.currentTime).toBeCloseTo(0.5);
        expect(view.active).toEqual([60]);
        expect(view.score).toBe(source.resolvedScore);
        expect(view.querySelectorAll('[part~="drawing"]')).toHaveLength(1);
      }
    }
    await source.seekNominal(1);
    expect(view.currentTime).toBeCloseTo(1);
    expect(io.load).not.toHaveBeenCalled();
  });

  it('keeps waterfall time scrolling focusable and releases the old region on direction or mode changes', async () => {
    const view = await mount('waterfall', {}, music());
    let previous: HTMLElement | null = null;
    for (const direction of ['up', 'down', 'left', 'right'] as const) {
      view.direction = direction;
      if (previous) {
        expect(previous.isConnected).toBe(false);
        expect(previous.hasAttribute('tabindex')).toBe(false);
      }
      const viewport = view.querySelector<HTMLElement>('[role="region"][aria-label="Score time window"]')!;
      expect(viewport).not.toBeNull();
      expect(viewport.tabIndex).toBe(0);
      viewport.focus();
      expect(document.activeElement).toBe(viewport);
      expect(viewport.getAttribute('role')).not.toBe('slider');
      previous = viewport;
    }
    view.type = 'staff';
    expect(previous!.isConnected).toBe(false);
    expect(previous!.hasAttribute('tabindex')).toBe(false);
    expect(view.querySelector('[aria-label="Score time window"]')).toBeNull();
  });

  it('discovers late owners and clears invalid or ambiguous selections without fetching their src', async () => {
    const view = await mount('piano-roll', {player: '#player'});
    expect(view.score).toBeUndefined();
    const first = player();
    first.target.setAttribute('src', 'owned.mid');
    await flush();
    expect(view.score).toBe(first.target.resolvedScore);
    expect(view.currentTime).toBe(1);
    const other = player(music('G4'));
    await flush();
    expect(view.score).toBeUndefined();
    other.target.remove();
    await flush();
    expect(view.score).toBe(first.target.resolvedScore);
    view.setAttribute('player', '[');
    await flush();
    expect(view.score).toBeUndefined();
    expect(view.currentTime).toBe(0);
    expect(io.load).not.toHaveBeenCalled();
  });

  it('respects external host sizing across type switches', async () => {
    const view = await mount('piano-roll', {}, music());
    view.style.width = '50%';
    view.style.height = '5rem';
    view.type = 'waterfall';
    expect(view.style.width).toBe('50%');
    expect(view.style.height).toBe('5rem');
    view.setAttribute('width', '240');
    expect(view.style.width).toBe('240px');
    view.style.width = '75%';
    view.removeAttribute('width');
    expect(view.style.width).toBe('75%');
    view.type = 'piano-roll';
    expect(view.style.height).toBe('5rem');
  });
});
