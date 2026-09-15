// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {ChordAnalysisElement, type AnalysisSeekDetail} from '../../src/analyze/element';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let serial = 0;
function melody(): Score {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Melody'});
  const voice = VoiceId(`${part}-v1`);
  ['C4', 'D4', 'E4', 'G4', 'C4', 'D4', 'E4', 'G4'].forEach((pitch, index) => {
    builder.addNote(part, {id: builder.newNoteId(), voice, pitch: Pitch.parse(pitch), onsetQuarters: new Rational(index), duration: Duration.quarter()});
  });
  return builder.build();
}
function player(score: Score) {
  const element = Object.assign(document.createElement('div'), {score, seek: vi.fn()});
  element.id = 'player';
  document.body.append(element);
  return element;
}
async function mount(score?: Score): Promise<ChordAnalysisElement> {
  const name = `interactive-analysis-${serial++}`;
  customElements.define(name, class extends ChordAnalysisElement {});
  const element = document.createElement(name) as ChordAnalysisElement;
  element.setAttribute('player', '#player');
  element.setAttribute('motion', 'stepped');
  if (score) element.score = score;
  document.body.append(element);
  await flush();
  return element;
}
function cursor(target: HTMLElement, score: Score, quarters: number, rate = 1): void {
  const seconds = score.timeMap.quartersToSeconds(Rational.from(quarters));
  target.dispatchEvent(new CustomEvent('webscore:timeupdate', {detail: {
    seconds, nominalSeconds: seconds, transportSeconds: seconds / rate,
    transportDurationSeconds: score.durationSeconds / rate, playing: false,
  }}));
}
function position(element: Element): number {
  return Number(element.querySelector('[role="slider"]')?.getAttribute('aria-valuenow'));
}
function seekEnd(element: Element): void {
  element.querySelector('[role="slider"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}));
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('chord follower navigation lifecycle', () => {
  it('borrows a late player score and seeks in player units without rebuilding its bands on cursors', async () => {
    const score = melody();
    const element = await mount();
    expect(element.querySelector('[role="slider"]')?.getAttribute('aria-disabled')).toBe('true');
    expect(element.querySelectorAll('.wui-harmony-flow__band')).toHaveLength(0);
    const target = player(score);
    await flush();
    const bands = [...element.querySelectorAll('.wui-harmony-flow__band')];
    expect(bands.length).toBeGreaterThan(0);
    cursor(target, score, 3, 2);
    expect([...element.querySelectorAll('.wui-harmony-flow__band')]).toEqual(bands);
    expect(position(element)).toBeCloseTo(1.5);
    expect(element.querySelector('[role="slider"]')?.getAttribute('aria-valuetext')).toContain('beat');
    seekEnd(element);
    expect(target.seek).toHaveBeenCalledWith(score.durationSeconds / 2);
  });

  it('borrows through empty src and distinguishes owner removal from removing the player attribute', async () => {
    const score = melody();
    const element = await mount();
    element.setAttribute('src', '');
    const target = player(score);
    await flush();
    expect(element.querySelector('[role="slider"]')?.getAttribute('aria-disabled')).not.toBe('true');
    expect(element.querySelectorAll('.wui-harmony-flow__band').length).toBeGreaterThan(0);
    target.remove();
    await flush();
    expect(element.querySelector('[role="slider"]')?.getAttribute('aria-disabled')).toBe('true');
    expect(element.querySelectorAll('.wui-harmony-flow__band')).toHaveLength(0);
    document.body.append(target);
    await flush();
    expect(element.querySelector('[role="slider"]')?.getAttribute('aria-disabled')).not.toBe('true');
    expect(element.querySelectorAll('.wui-harmony-flow__band').length).toBeGreaterThan(0);
    element.removeAttribute('player');
    await flush();
    expect(element.querySelector('[role="slider"]')?.getAttribute('aria-disabled')).toBe('true');
    expect(element.querySelectorAll('.wui-harmony-flow__band')).toHaveLength(0);
    element.score = score;
    await flush();
    expect(element.querySelector('[role="slider"]')?.getAttribute('aria-disabled')).not.toBe('true');
    expect(element.querySelectorAll('.wui-harmony-flow__band').length).toBeGreaterThan(0);
  });

  it('seeks a chord band locally without a player', async () => {
    const element = await mount(melody());
    const bands = element.querySelectorAll('.wui-harmony-flow__lane[data-track="0"] > *');
    expect(bands.length).toBeGreaterThan(1);
    const seeks: AnalysisSeekDetail[] = [];
    element.addEventListener('webscore:seek', (event) => seeks.push((event as CustomEvent).detail));
    bands[1]!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(seeks).toHaveLength(1);
    expect(seeks[0].quarters).toBeGreaterThan(0);
    expect(position(element)).toBeCloseTo(seeks[0].seconds);
  });

  it('rebinds to a replaced player without retaining its seek target or detached subscriptions', async () => {
    const score = melody();
    const old = player(score);
    const element = await mount();
    old.remove();
    const replacement = player(score);
    await flush();
    seekEnd(element);
    expect(old.seek).not.toHaveBeenCalled();
    expect(replacement.seek).toHaveBeenCalledOnce();
    element.remove();
    cursor(replacement, score, 6);
    expect(element.children).toHaveLength(0);
  });

  it('keeps the empty score state visible while a scoreless player reports playback', async () => {
    const snapshot = {nominalSeconds: 0.5, rate: 1, playing: true};
    const target = Object.assign(document.createElement('div'), {
      resolvedScore: undefined as Score | undefined, getPlaybackSnapshot: () => snapshot,
    });
    target.id = 'player';
    document.body.append(target);
    const element = await mount();
    target.dispatchEvent(new CustomEvent('webscore:timeupdate', {detail: snapshot}));
    expect(element.querySelector('.wui-workbench')?.getAttribute('data-phase')).toBe('empty');
    const waiting = [...element.querySelectorAll<HTMLElement>('[role="status"]')]
      .find((node) => node.textContent?.includes('Waiting for a score'));
    expect(waiting).toBeDefined();
    expect(waiting?.hidden).toBe(false);
    expect(waiting?.closest('[hidden]')).toBeNull();
    expect(element.querySelector('[role="slider"]')?.getAttribute('aria-disabled')).toBe('true');
    target.resolvedScore = melody();
    target.dispatchEvent(new CustomEvent('webscore:scorechange'));
    await flush();
    expect(element.querySelector('.wui-workbench')?.getAttribute('data-phase')).toBe('playing');
    expect(element.querySelectorAll('.wui-harmony-flow__band').length).toBeGreaterThan(0);
    expect(element.querySelector('[role="slider"]')?.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('keeps an initial transport duration while asynchronous score resolution completes', async () => {
    const score = melody();
    const target = player(score);
    Object.assign(target, {getPlaybackSnapshot: () => ({
      nominalSeconds: 0.5, transportDurationSeconds: score.durationSeconds / 2, playing: false,
    })});
    const element = await mount();
    expect(position(element)).toBe(0.5);
    seekEnd(element);
    expect(target.seek).toHaveBeenCalledWith(score.durationSeconds / 2);
  });

  it('forgets a replaced owner rate when the new owner has no playback snapshot', async () => {
    const score = melody();
    const old = player(score);
    const element = await mount(score);
    cursor(old, score, 2, 2);
    old.remove();
    const replacement = player(score);
    await flush();
    seekEnd(element);
    expect(old.seek).not.toHaveBeenCalled();
    expect(replacement.seek).toHaveBeenCalledWith(score.durationSeconds);
  });

  it('lets synchronous source replacement cancel a seek before it reaches the owner', async () => {
    const score = melody();
    const target = player(score);
    const element = await mount(score);
    element.addEventListener('webscore:seek', () => { element.score = melody(); }, {once: true});
    seekEnd(element);
    await flush();
    expect(target.seek).not.toHaveBeenCalled();
  });

  it('rolls back a failed seek but preserves a newer authoritative cursor after a late rejection', async () => {
    const score = melody();
    const target = player(score);
    const element = await mount();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    cursor(target, score, 1);
    target.seek.mockRejectedValueOnce(new Error('seek failed'));
    seekEnd(element);
    await flush();
    expect(position(element)).toBe(0.5);
    let rejectSeek: (error: Error) => void = () => {};
    target.seek.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSeek = reject; }));
    seekEnd(element);
    cursor(target, score, 6);
    rejectSeek(new Error('late failure'));
    await flush();
    expect(position(element)).toBe(3);
  });
});
