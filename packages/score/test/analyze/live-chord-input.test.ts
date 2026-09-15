// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {defineLiveChordAnalysisElement, type LiveChordAnalysisElement} from '../../src/analyze/element';
import * as analysisSession from '../../src/analyze/headless/session';
import * as analysisCore from '../../src/analyze/core';

defineLiveChordAnalysisElement();
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
  const element = document.createElement('live-chord-analysis') as LiveChordAnalysisElement;
  element.setAttribute('player', selector);
  document.body.append(element);
  return element;
}
function sound(owner: Element, midis: number[]) {
  for (const midi of midis) owner.dispatchEvent(new CustomEvent('webscore:noteon', {detail: {midi}}));
}
function expectWaiting(element: LiveChordAnalysisElement) {
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
    expect(element.chord).toBe('CM');
    snapshot.activeNotes = [60, 64, 67].map((midi) => ({midi}));
    owner.dispatchEvent(new CustomEvent('webscore:statechange', {detail: snapshot}));
    snapshot.rate = 2;
    owner.dispatchEvent(new CustomEvent('webscore:timeupdate', {detail: snapshot}));
    expect(element.chord).toBe('CM');
    for (const midi of [60, 64, 67]) owner.dispatchEvent(new CustomEvent('webscore:noteoff', {detail: {midi}}));
    expectWaiting(element);
  });

  it.each(['webscore:stop', 'webscore:seek', 'webscore:scorechange', 'webscore:end'])(
    '%s clears the sounding chord without exposing whole-score analysis', async (event) => {
      const {owner} = player();
      document.body.append(owner);
      const element = panel();
      await flush();
      sound(owner, [60, 64, 67]);
      expect(element.chord).toBe('CM');
      owner.resolvedScore = music();
      owner.dispatchEvent(new CustomEvent(event));
      await flush();
      expectWaiting(element);
      sound(owner, [62, 66, 69]);
      expect(element.chord).toBe('DM');
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
    expect(element.chord).toBe('DM');
    element.remove();
    document.body.append(element);
    await flush();
    expectWaiting(element);
  });
});
