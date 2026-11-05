// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {
  defineScorePlayerElement,
  type ScorePlayerElement,
} from '../../src/play/element/score-player';
import {defineAllAnalysisElements, type ChordAnalysisElement} from '../../src/analyze/element';
import {defineScoreViewElement} from '../../src/view/element/score-view';
import {definePitchViewElement} from '../../src/view/element/score-pitch-view';
import {defineSheetViewElement, type SheetViewElement} from '../../src/view/element/score-sheet-view';

const io = vi.hoisted(() => ({load: vi.fn()}));
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: io.load}));
vi.mock('../../src/view/render/osmd-staff', () => ({renderOSMDStaffVisualizer: vi.fn(async () => ({
  element: document.createElement('div'), noteSequence: {notes: [], totalTime: 0},
  redraw: vi.fn(), clearActiveNotes: vi.fn(), dispose: vi.fn(),
}))}));

defineScorePlayerElement();
defineAllAnalysisElements();
defineScoreViewElement();
definePitchViewElement();
defineSheetViewElement();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function music(): Score {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Piano'});
  const voice = VoiceId('melody');
  ['C4', 'E4', 'G4', 'C5', 'C4', 'E4', 'G4', 'C5'].forEach((pitch, i) => {
    builder.addNote(part, {id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: new Rational(i), duration: Duration.quarter(), voice});
  });
  return builder.build();
}

async function nativePlayer() {
  const source = document.createElement('score-player') as ScorePlayerElement;
  source.id = 'source';
  source.setAttribute('src', 'piece.mid');
  document.body.append(source);
  await flush();
  return source;
}

async function follower(feature: string, attrs: Record<string, string> = {}) {
  const node = document.createElement(`score-${feature}-analysis`) as ChordAnalysisElement;
  node.setAttribute('player', '#source');
  node.setAttribute('motion', 'stepped');
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  document.body.append(node);
  await flush();
  return node;
}

function position(node: Element): number {
  return Number(node.querySelector('[role="slider"]')?.getAttribute('aria-valuenow'));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('native single-score player with independent Analyze components', () => {
  it('shares source waiting, loading, failure and recovery across all four tools and live chord mode', async () => {
    const companions = await Promise.all([
      follower('chord'),
      follower('interval'),
      follower('scale', {tonic: 'C'}),
      follower('rhythm'),
      follower('chord', {mode: 'live'}),
    ]);
    const feedback = (element: Element) => element.querySelector<HTMLElement>('[part~="feedback"]')!;
    for (const companion of companions) {
      expect(feedback(companion).dataset.kind).toBe('waiting');
      expect(feedback(companion).getAttribute('aria-busy')).toBeNull();
    }

    let reject!: (error: Error) => void;
    io.load.mockImplementationOnce(() => new Promise<Score>((_resolve, fail) => { reject = fail; }));
    const source = await nativePlayer();
    for (const companion of companions) {
      expect(feedback(companion).dataset.kind).toBe('loading');
      expect(feedback(companion).getAttribute('aria-busy')).toBe('true');
    }
    expect(io.load).toHaveBeenCalledOnce();
    reject(new Error('Shared source unavailable'));
    await flush();
    for (const companion of companions) {
      expect(companion.querySelector('.wui-workbench')?.getAttribute('data-phase')).toBe('error');
      expect(companion.textContent).toContain('Shared source unavailable');
      expect(companion.querySelector('[aria-busy="true"]')).toBeNull();
    }

    source.removeAttribute('src');
    await flush();
    for (const companion of companions) expect(feedback(companion).dataset.kind).toBe('waiting');
    io.load.mockResolvedValueOnce(music());
    source.setAttribute('src', 'recovered.mid');
    await flush();
    for (const companion of companions.slice(0, 4)) {
      expect(feedback(companion).hidden).toBe(true);
      expect(companion.querySelector('[part~="content"]')?.hasAttribute('hidden')).toBe(false);
      expect(companion.analysis).toBeDefined();
    }
    // A loaded, silent live source is ready; silence is not missing input.
    expect(feedback(companions[4]!).hidden).toBe(true);
    expect(companions[4]!.querySelector('.wui-workbench')?.getAttribute('data-phase')).toBe('idle');
    expect(io.load).toHaveBeenCalledTimes(2);
  });

  it('shares caller preparation without replacing the native owner or its paused position', async () => {
    io.load.mockResolvedValueOnce(music());
    const source = await nativePlayer();
    await source.seekNominal(1);
    const companions = await Promise.all([
      follower('chord'), follower('interval'), follower('scale', {tonic: 'C'}),
      follower('rhythm'), follower('chord', {mode: 'live'}),
    ]);
    const view = document.createElement('score-view');
    view.setAttribute('type', 'map');
    view.setAttribute('player', '#source');
    document.body.append(view);
    const pitch = document.createElement('score-pitch-view');
    pitch.setAttribute('player', '#source');
    const sheet = document.createElement('score-sheet-view') as SheetViewElement;
    sheet.score = source.resolvedScore;
    sheet.setAttribute('player', '#source');
    document.body.append(pitch, sheet);
    await flush();
    await vi.waitFor(() => expect(sheet.querySelector('.wui-status')).toBeNull());
    const engraving = sheet.querySelector('[part~="surface"]');
    expect(engraving).not.toBeNull();
    const control = source.querySelector('[part~="play"]');
    const score = source.resolvedScore;
    source.loading = true;
    expect(source.playback.snapshot().readiness).toBe('loading');
    for (const companion of companions) expect(companion.querySelector('[part~="feedback"]')?.getAttribute('data-kind')).toBe('loading');
    expect(view.querySelector('[data-kind="loading"]')).not.toBeNull();
    expect(pitch.querySelector('[data-kind="loading"]')).not.toBeNull();
    expect(sheet.querySelector('.wui-status')).toBeNull();
    expect(sheet.querySelector('[part~="surface"]')).toBe(engraving);
    source.loading = false;
    await flush();
    expect(source.playback.snapshot().readiness).toBe('ready');
    for (const companion of companions) expect(companion.querySelector<HTMLElement>('[part~="feedback"]')?.hidden).toBe(true);
    expect(view.querySelector('[data-kind="loading"], [data-kind="waiting"]')).toBeNull();
    expect(pitch.querySelector<HTMLElement>('[part~="pitch-status"]')?.hidden).toBe(true);
    expect(sheet.querySelector('[part~="surface"]')).toBe(engraving);
    expect(source.querySelector('[part~="play"]')).toBe(control);
    expect(source.resolvedScore).toBe(score);
    expect(source.playback.snapshot().nominalSeconds).toBe(1);
    expect(io.load).toHaveBeenCalledOnce();
  });

  it('loads one src for several companions and initializes a paused position at a changed rate', async () => {
    const score = music();
    io.load.mockResolvedValueOnce(score);
    const source = await nativePlayer();
    source.rate = 2;
    await source.seekNominal(1);
    const chord = await follower('chord');
    const sibling = await follower('chord');
    expect(source.resolvedScore).toBe(score);
    expect(io.load).toHaveBeenCalledTimes(1);
    expect(source.currentTime).toBeCloseTo(0.5);
    expect(source.getPlaybackSnapshot()).toMatchObject({nominalSeconds: 1, rate: 2, playing: false});
    expect(position(chord)).toBeCloseTo(1);
    expect(position(sibling)).toBeCloseTo(1);

    source.rate = 0.5;
    expect(source.currentTime).toBeCloseTo(2);
    expect(position(chord)).toBeCloseTo(1);
    expect(position(sibling)).toBeCloseTo(1);
    expect(io.load).toHaveBeenCalledTimes(1);
  });

  it('delegates a keyboard seek once in nominal seconds and follows stop without playing audio', async () => {
    io.load.mockResolvedValueOnce(music());
    const source = await nativePlayer();
    source.rate = 2;
    await source.seekNominal(1);
    const chord = await follower('chord');
    const sibling = await follower('chord');
    const seek = vi.spyOn(source.playback, 'seekNominal');
    const legacyNominal = vi.spyOn(source, 'seekNominal');
    const fallback = vi.spyOn(source, 'seek');
    chord.querySelector('[role="slider"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    await flush();
    expect(seek).toHaveBeenCalledOnce();
    expect(legacyNominal).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    const intended = position(chord);
    expect(intended).toBeGreaterThan(1);
    expect(seek).toHaveBeenCalledWith(intended);
    expect(source.getPlaybackSnapshot()).toMatchObject({nominalSeconds: intended, playing: false});
    expect(source.currentTime).toBeCloseTo(intended / 2);
    expect(position(chord)).toBeCloseTo(intended);
    expect(position(sibling)).toBeCloseTo(intended);

    source.stop();
    expect(position(chord)).toBe(0);
    expect(position(sibling)).toBe(0);
    expect(source.getPlaybackSnapshot()).toMatchObject({nominalSeconds: 0, playing: false, activeNotes: []});
  });

  it('invalidates borrowed data during a pending replacement and resolves the new source once', async () => {
    io.load.mockResolvedValueOnce(music());
    const source = await nativePlayer();
    const chord = await follower('chord');
    const sibling = await follower('chord');
    let resolve!: (score: Score) => void;
    io.load.mockImplementationOnce(() => new Promise<Score>((done) => { resolve = done; }));
    source.setAttribute('src', 'replacement.mid');
    expect(source.resolvedScore).toBeUndefined();
    await flush();
    for (const companion of [chord, sibling]) {
      const feedback = companion.querySelector('[part~="feedback"]');
      expect(feedback?.getAttribute('data-kind')).toBe('loading');
      expect(feedback?.getAttribute('aria-busy')).toBe('true');
      expect(feedback?.textContent).toContain('Loading score');
      expect(companion.querySelector('[role="slider"]')?.getAttribute('aria-disabled')).toBe('true');
    }
    expect(position(chord)).toBe(0);
    expect(position(sibling)).toBe(0);
    const replacement = music();
    resolve(replacement);
    await flush();
    expect(source.resolvedScore).toBe(replacement);
    expect(chord.querySelector('[role="slider"]')).not.toBeNull();
    expect(sibling.querySelector('[role="slider"]')).not.toBeNull();
    expect(io.load).toHaveBeenCalledTimes(2);
  });
});


it('Score View follows native source loading and error even before a score exists', async () => {
  let reject!: (error: Error) => void;
  io.load.mockImplementationOnce(() => new Promise<Score>((_resolve, fail) => { reject = fail; }));
  const source = await nativePlayer();
  const view = document.createElement('score-view');
  view.setAttribute('type', 'map');
  view.setAttribute('player', '#source');
  document.body.append(view);
  await flush();
  expect(view.querySelector('[data-kind="loading"]')?.getAttribute('aria-busy')).toBe('true');
  reject(new Error('Unavailable score file'));
  await flush();
  expect(view.querySelector('[data-kind="error"]')?.textContent).toContain('Unavailable score file');
  source.removeAttribute('src');
  await flush();
  expect(view.querySelector('[data-kind="waiting"]')).not.toBeNull();
  expect(view.querySelector('[aria-busy="true"]')).toBeNull();
});
