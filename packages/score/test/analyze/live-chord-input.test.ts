// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {defineChordAnalysisElement, type ChordAnalysisElement} from '../../src/analyze/element';
import * as analysisSession from '../../src/analyze/headless/session';
import * as analysisCore from '../../src/analyze/core';

defineChordAnalysisElement();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function music(): Score {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Piano'});
  ['C4', 'E4', 'G4', 'C5'].forEach((pitch, index) => builder.addNote(part, {
    id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: new Rational(index),
    duration: Duration.quarter(), voice: VoiceId('melody'),
  }));
  return builder.build();
}
function player(activeNotes: {midi: number}[] = []) {
  const snapshot = {nominalSeconds: 0, rate: 1, playing: false, activeNotes};
  const owner = Object.assign(document.createElement('div'), {
    resolvedScore: music(), getPlaybackSnapshot: () => snapshot,
  });
  owner.id = 'performance';
  owner.className = 'shared';
  return {owner, snapshot};
}
function panel(selector = '#performance') {
  const element = document.createElement('score-chord-analysis') as ChordAnalysisElement;
  element.setAttribute('mode', 'live');
  element.setAttribute('player', selector);
  document.body.append(element);
  return element;
}
function sound(owner: Element, midis: number[]) {
  for (const midi of midis) owner.dispatchEvent(new CustomEvent('webscore:noteon', {detail: {midi}}));
}
function expectWaiting(element: ChordAnalysisElement) {
  expect(element.chord).toBeUndefined();
  expect(element.querySelector('.wui-harmony-nameplate__empty')?.textContent).toBe('—');
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('live chord input ownership', () => {
  it('waits for actual notes despite a loaded player score and avoids whole-score analysis', async () => {
    document.body.append(player().owner);
    const analyze = vi.spyOn(analysisSession, 'createAnalysisSession');
    const distributions = vi.spyOn(analysisCore, 'distributions');
    const element = panel();
    await flush();
    expectWaiting(element);
    expect(analyze).not.toHaveBeenCalled();
    expect(distributions).not.toHaveBeenCalled();
  });

  it('retains held pitches through pause and rate snapshots, then clears when they stop sounding', async () => {
    const {owner, snapshot} = player();
    document.body.append(owner);
    const element = panel();
    await flush();
    sound(owner, [60, 64, 67]);
    expect(element.chord).toBe('C');
    snapshot.activeNotes = [60, 64, 67].map((midi) => ({midi}));
    owner.dispatchEvent(new CustomEvent('webscore:statechange', {detail: snapshot}));
    snapshot.rate = 2;
    owner.dispatchEvent(new CustomEvent('webscore:timeupdate', {detail: snapshot}));
    expect(element.chord).toBe('C');
    for (const midi of [60, 64, 67]) owner.dispatchEvent(new CustomEvent('webscore:noteoff', {detail: {midi}}));
    expectWaiting(element);
  });

  it('leaves the chord name empty for unmatched held pitches while retaining the note row', async () => {
    const {owner} = player();
    document.body.append(owner);
    const element = panel();
    await flush();
    sound(owner, [47, 52, 66, 68, 71]);
    expect(element.chord).toBeUndefined();
    expect(element.querySelector('.wui-harmony-nameplate__symbol')?.textContent).toBe('');
    expect(element.querySelector('.wui-harmony-nameplate__voicing')?.textContent).toBe('B2  E3  F#4  G#4  B4');
    owner.dispatchEvent(new CustomEvent('webscore:stop'));
    sound(owner, [60, 64, 67]);
    expect(element.querySelector('.wui-harmony-nameplate__symbol')?.textContent).toBe('C');
    expect(element.querySelector('.wui-harmony-nameplate__voicing')?.textContent).toBe('C4  E4  G4');
  });

  it.each(['webscore:stop', 'webscore:seek', 'webscore:scorechange', 'webscore:end'])(
    '%s clears the sounding chord without exposing whole-score analysis', async (event) => {
      const {owner} = player();
      document.body.append(owner);
      const element = panel();
      await flush();
      sound(owner, [60, 64, 67]);
      expect(element.chord).toBe('C');
      owner.resolvedScore = music();
      owner.dispatchEvent(new CustomEvent(event));
      await flush();
      expectWaiting(element);
      sound(owner, [62, 66, 69]);
      expect(element.chord).toBe('D');
    },
  );

  it.each(['#missing', '[', '.shared'])('waits for unresolved selector %s', async (selector) => {
    document.body.append(player().owner, player().owner);
    const element = panel(selector);
    await flush();
    expectWaiting(element);
  });

  it('hydrates late held notes, discards replaced owners, and resets across reconnection', async () => {
    const element = panel();
    await flush();
    expectWaiting(element);
    const first = player([{midi: 61}, {midi: 65}, {midi: 68}]);
    document.body.append(first.owner);
    await flush();
    expect(element.chord).toBeDefined();
    first.owner.remove();
    const second = player();
    document.body.append(second.owner);
    await flush();
    expectWaiting(element);
    sound(first.owner, [60, 64, 67]);
    expectWaiting(element);
    sound(second.owner, [62, 66, 69]);
    expect(element.chord).toBe('D');
    element.remove();
    document.body.append(element);
    await flush();
    expectWaiting(element);
  });

  it('cancels a pending name event on reset and publishes only the settled display', async () => {
    const {owner} = player();
    document.body.append(owner);
    const element = panel();
    element.stabilityMs = 30;
    await flush();
    const changes: Array<{chord: string; midis: number[]}> = [];
    element.addEventListener('webscore:chordchange', (event) => changes.push((event as CustomEvent).detail));
    sound(owner, [60, 64, 67]);
    expect(element.chord).toBe('C');
    expect(changes).toHaveLength(0);
    owner.dispatchEvent(new CustomEvent('webscore:stop'));
    await new Promise((resolve) => setTimeout(resolve, 45));
    expect(changes).toHaveLength(0);
    sound(owner, [62, 66, 69]);
    await new Promise((resolve) => setTimeout(resolve, 45));
    expect(changes).toEqual([{chord: element.chord, midis: [62, 66, 69]}]);
  });

  it('switches score and live modes without commanding its player or retaining old mode resources', async () => {
    const {owner, snapshot} = player([60, 64, 67].map((midi) => ({midi})));
    const seek = vi.fn();
    Object.assign(owner, {seek});
    const added = vi.spyOn(owner, 'addEventListener');
    const removed = vi.spyOn(owner, 'removeEventListener');
    document.body.append(owner);
    const explicitScore = music();
    const element = document.createElement('score-chord-analysis') as ChordAnalysisElement;
    element.score = explicitScore;
    element.stabilityMs = 30;
    element.setAttribute('player', '#performance');
    const changes: Array<{chord: string; midis: number[]}> = [];
    element.addEventListener('webscore:chordchange', (event) => changes.push((event as CustomEvent).detail));
    document.body.append(element);
    await flush();

    expect(element.mode).toBe('score');
    expect(element.score).toBe(explicitScore);
    expect(element.querySelector('[part~="lane"]')).not.toBeNull();
    expect(element.chord).toBeUndefined();
    element.mode = 'live';
    await flush();
    expect(element.querySelector('[part~="nameplate"]')).not.toBeNull();
    expect(element.querySelector('[part~="lane"]')).toBeNull();
    expect(element.chord).toBe('C');
    expect(element.score).toBe(explicitScore);
    expect(changes).toEqual([]);

    // The still-pending live timer must not publish after a mode change.
    element.setAttribute('mode', 'score');
    await new Promise((resolve) => setTimeout(resolve, 45));
    expect(changes).toEqual([]);
    expect(element.score).toBe(explicitScore);
    expect(element.querySelector('[part~="lane"]')).not.toBeNull();
    expect(element.querySelector('[part~="nameplate"]')).toBeNull();

    // Exercise property and attribute transitions in both directions, then
    // hydrate the latest held-note snapshot rather than accumulated events.
    for (let index = 0; index < 2; index += 1) {
      element.setAttribute('mode', 'live');
      await flush();
      expect(element.chord).toBe('C');
      element.mode = 'score';
      await flush();
      expect(element.score).toBe(explicitScore);
    }
    snapshot.activeNotes = [62, 66, 69].map((midi) => ({midi}));
    element.mode = 'live';
    await new Promise((resolve) => setTimeout(resolve, 45));
    expect(element.chord).toBe('D');
    expect(changes).toEqual([{chord: 'D', midis: [62, 66, 69]}]);
    expect(seek).not.toHaveBeenCalled();

    // Detachment cancels another pending name event and every owner listener.
    owner.dispatchEvent(new CustomEvent('webscore:stop'));
    sound(owner, [65, 69, 72]);
    expect(element.chord).toBe('F');
    element.remove();
    sound(owner, [60, 64, 67]);
    await new Promise((resolve) => setTimeout(resolve, 45));
    expect(element.chord).toBeUndefined();
    expect(element.score).toBe(explicitScore);
    expect(changes).toHaveLength(1);
    expect(seek).not.toHaveBeenCalled();
    const subscriptions = added.mock.calls.filter(([type]) => type.startsWith('webscore:'));
    expect(subscriptions.length).toBeGreaterThan(0);
    for (const [type, listener] of subscriptions) {
      expect(removed.mock.calls.some(([removedType, removedListener]) =>
        removedType === type && removedListener === listener,
      )).toBe(true);
    }
  });
});
