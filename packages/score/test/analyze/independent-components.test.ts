// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {defineAllAnalysisElements, type ChordAnalysisElement} from '../../src/analyze/element';

defineAllAnalysisElements();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const features = ['key', 'chord', 'roman', 'voice-leading', 'live-chord'];

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

function player(score = music()) {
  const node = Object.assign(document.createElement('div'), {
    resolvedScore: score,
    seek: vi.fn(),
    getPlaybackSnapshot: () => ({
      nominalSeconds: 1, seconds: 1, transportSeconds: 0.5,
      transportDurationSeconds: score.durationSeconds / 2, rate: 2, playing: false,
    }),
  });
  node.id = 'source';
  document.body.append(node);
  return node;
}

function mount(feature: string) {
  const node = document.createElement(`${feature}-analysis`) as ChordAnalysisElement;
  node.setAttribute('player', '#source');
  node.setAttribute('motion', 'stepped');
  document.body.append(node);
  return node;
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('independent analysis capabilities', () => {
  it.each(features)('%s owns its feature and has no switchable workbench inside', async (feature) => {
    player();
    const node = mount(feature);
    await flush();
    expect(node.querySelector('[role="tablist"]')).toBeNull();
    expect(node.querySelector('analysis-view')).toBeNull();
    expect(node.querySelector('[role="region"]')?.getAttribute('aria-label')).toBeTruthy();
    const slots = [...node.querySelectorAll('[data-slot]')].map((n) => n.getAttribute('data-slot'));
    node.setAttribute('type', 'key');
    await flush();
    expect([...node.querySelectorAll('[data-slot]')].map((n) => n.getAttribute('data-slot'))).toEqual(slots);
    expect(slots).toHaveLength(1);
    expect(node.querySelector('[part~="header"], [part~="dock"], [role="switch"], .wui-pitch-keyboard, .wui-pitch-staff, .wui-pitch-fretboard')).toBeNull();
  });

  it.each(['chord', 'roman', 'voice-leading'])('%s borrows an already paused player and seeks at its rate', async (feature) => {
    const source = player();
    const node = mount(feature);
    await flush();
    const slider = node.querySelector<HTMLElement>('[role="slider"]')!;
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeCloseTo(1);
    const seeks: number[] = [];
    node.addEventListener('webscore:seek', (event) => seeks.push((event as CustomEvent).detail.seconds));
    slider.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(seeks).toHaveLength(1);
    expect(source.seek).toHaveBeenCalledWith(seeks[0]! / 2);
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeCloseTo(seeks[0]!);
  });

  it('several companions share one score, survive owner replacement and release their subscriptions', async () => {
    const first = player();
    const chord = mount('chord');
    const roman = mount('roman');
    await flush();
    first.remove();
    const second = player();
    await flush();
    const slider = chord.querySelector<HTMLElement>('[role="slider"]')!;
    slider.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(second.seek).toHaveBeenCalledOnce();
    expect(first.seek).not.toHaveBeenCalled();
    chord.remove();
    const before = chord.textContent;
    second.dispatchEvent(new CustomEvent('webscore:timeupdate', {detail: {nominalSeconds: 2, playing: false, rate: 2}}));
    expect(chord.textContent).toBe(before);
    expect(Number(roman.querySelector('[role="slider"]')!.getAttribute('aria-valuenow'))).toBeCloseTo(2);
  });

  it('parks a score-backed key view and applies paused seeks without an animation frame', async () => {
    const source = player();
    const node = document.createElement('key-analysis');
    node.setAttribute('player', '#source');
    node.setAttribute('motion', 'continuous');
    document.body.append(node);
    await flush();
    expect(node.querySelector('.wui-workbench')?.getAttribute('data-phase')).toBe('idle');
    const slider = node.querySelector('[role="slider"]')!;
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeCloseTo(1);
    source.dispatchEvent(new CustomEvent('webscore:timeupdate', {detail: {nominalSeconds: 2, playing: false, rate: 2}}));
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeCloseTo(2);
  });

  it('live chord follows notes without offering a seek control with no score axis', async () => {
    const source = player();
    const live = mount('live-chord');
    await flush();
    for (const midi of [60, 64, 67]) source.dispatchEvent(new CustomEvent('webscore:noteon', {detail: {midi}}));
    expect(live.chord).toBe('CM');
    expect(live.querySelector('[role="slider"]')).toBeNull();
    for (const midi of [60, 64, 67]) source.dispatchEvent(new CustomEvent('webscore:noteoff', {detail: {midi}}));
    expect(live.chord).toBeUndefined();
  });
  it('restores a paused position after a rejected seek without leaking a rejection', async () => {
    const source = Object.assign(player(), {seekNominal: vi.fn(() => Promise.reject(new Error('seek unavailable')))});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const node = mount('chord');
    await flush();
    const slider = node.querySelector<HTMLElement>('[role="slider"]')!;
    slider.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    await flush();
    expect(source.seekNominal).toHaveBeenCalledOnce();
    expect(source.seek).not.toHaveBeenCalled();
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeCloseTo(1);
    expect(warn).toHaveBeenCalled();
  });

  it('does not seek the old owner when an event listener replaces the binding', async () => {
    const source = player();
    const node = mount('chord');
    await flush();
    node.addEventListener('webscore:seek', () => node.removeAttribute('player'), {once: true});
    node.querySelector<HTMLElement>('[role="slider"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(source.seek).not.toHaveBeenCalled();
  });

  it('removing player detaches seek ownership while keeping explicit standalone data', async () => {
    const source = player();
    const node = mount('chord');
    node.score = source.resolvedScore;
    await flush();
    node.removeAttribute('player');
    node.querySelector<HTMLElement>('[role="slider"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(source.seek).not.toHaveBeenCalled();
  });

  it('keeps a newer authoritative cursor when an older seek rejects', async () => {
    let reject: (error: Error) => void = () => {};
    const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
    const source = Object.assign(player(), {seekNominal: vi.fn(() => pending)});
    const node = mount('chord');
    await flush();
    const slider = node.querySelector<HTMLElement>('[role="slider"]')!;
    slider.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    source.dispatchEvent(new CustomEvent('webscore:timeupdate', {detail: {nominalSeconds: 2, playing: false, rate: 2}}));
    reject(new Error('superseded seek'));
    await flush();
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeCloseTo(2);
  });

});
