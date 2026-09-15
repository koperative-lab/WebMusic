// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {ScorePlayerElement} from '../../src/play/element/score-player';
import {RackControlElement} from '../../src/play/element/rack-control';
import {RackPartElement} from '../../src/play/element/rack-part';
import {PlayerController} from '../../src/play/headless/controller';
import {ScorePlayer} from '../../src/play/headless/score-player';
import {Rack} from '../../src/play/headless/rack';
import type {HeadlessSynth} from '../../src/play/headless/audio-contracts';

customElements.define('score-player-lifecycle', ScorePlayerElement);
customElements.define('rack-control', RackControlElement);
customElements.define('rack-part', RackPartElement);

const flush = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

function score(duration = Duration.whole()) {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('part'), name: 'Part', staves: 1});
  builder.addNote(part, {
    id: builder.newNoteId(), pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO,
    duration, voice: VoiceId('voice'),
  });
  return builder.build();
}

function audioContext(): AudioContext {
  const param = () => ({value: 1, setValueAtTime() {return this;}, cancelScheduledValues() {return this;}});
  const context = {state: 'running', currentTime: 0, sampleRate: 44100, resume: async () => {}} as unknown as AudioContext;
  const node = () => ({context, gain: param(), connect() {}, disconnect() {}});
  Object.assign(context, {
    destination: node(), createGain: node,
    createStereoPanner: () => ({...node(), pan: param()}),
  });
  return context;
}

function synth(): HeadlessSynth {
  return {connect() {}, disconnect() {}, noteOn() {}, noteOff() {}};
}

function element(): ScorePlayerElement {
  return document.createElement('score-player-lifecycle') as ScorePlayerElement;
}

afterEach(() => document.body.replaceChildren());

describe('score-player lifecycle with real transport owners', () => {
  it('keeps a borrowed controller rate across connection, reconnection and attribute initialization', async () => {
    const music = score();
    const player = new ScorePlayer(music);
    const controller = new PlayerController(player, music);
    controller.setRate(1.5);
    const setRate = vi.spyOn(controller, 'setRate');
    const host = element();
    host.controller = controller;
    host.setAttribute('rate', '0.75');
    document.body.append(host);
    await flush();
    expect(controller.rate).toBe(1.5);
    expect(setRate).not.toHaveBeenCalled();
    host.remove();
    document.body.append(host);
    await flush();
    expect(controller.rate).toBe(1.5);
    expect(setRate).not.toHaveBeenCalled();
    host.setAttribute('rate', '0.5');
    expect(setRate).not.toHaveBeenCalled();
    host.rate = 1.25;
    expect(controller.rate).toBe(1.25);
    expect(setRate).toHaveBeenCalledExactlyOnceWith(1.25);
    host.remove();
    controller.destroy();
    player.dispose();
  });

  it('forwards seconds and fractional seeks to real Rack members and reads the longest timeline', async () => {
    const rack = new Rack({audioContext: audioContext()});
    rack.add({id: 'long', score: score(), sound: synth()});
    rack.add({id: 'short', score: score(Duration.half()), sound: synth()});
    await rack.preload();
    const long = rack.get('long')!.player as ScorePlayer;
    const short = rack.get('short')!.player as ScorePlayer;
    await long.seek(0.25);
    const host = element();
    host.rack = rack;
    document.body.append(host);
    await flush();
    expect(host.currentTime).toBe(0.25);
    expect(host.duration).toBe(2);
    host.seek(1.5);
    expect(long.seconds).toBe(1.5);
    expect(short.seconds).toBe(1);
    expect(host.currentTime).toBe(1.5);
    host.seekFraction(0.25);
    expect(long.seconds).toBe(0.5);
    expect(short.seconds).toBe(0.5);
    expect(host.currentTime).toBe(0.5);
    host.seek(100);
    expect(long.seconds).toBe(2);
    expect(short.seconds).toBe(1);
    host.remove();
    rack.dispose();
  });

  it.each([false, true])('drops a removed owned desk and resumes a direct score (immediate assignment: %s)', async (assignImmediately) => {
    const host = element();
    host.audioContext = audioContext();
    host.sound = synth();
    if (!assignImmediately) host.score = score();
    const desk = document.createElement('rack-control') as RackControlElement;
    const part = document.createElement('rack-part') as RackPartElement;
    part.score = score();
    desk.append(part);
    host.append(desk);
    document.body.append(host);
    await flush();
    const oldRack = desk.rack!;
    expect(oldRack).toBeDefined();
    desk.remove();
    if (assignImmediately) host.score = score();
    await flush();
    await expect(oldRack.play()).rejects.toThrow('disposed');
    expect(host.duration).toBe(2);
    host.seek(0.5);
    expect(host.currentTime).toBe(0.5);
    await expect(host.play()).resolves.toBeUndefined();
    host.stop();
    host.remove();
  });
});
