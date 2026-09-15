// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {mountPresetPlayer, type PresetPlayerHandle} from '../../src/play/element/internal/preset-player';
import {Effect} from '../../src/play/headless/effects';
import * as playbackEvents from '../../src/play/headless/playback-events';

const handles: PresetPlayerHandle[] = [];

function music() {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Piano'});
  builder.addNote(part, {
    id: builder.newNoteId(), pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO,
    duration: Duration.whole(), voice: VoiceId('voice'),
  });
  return builder.build();
}

function audio() {
  let state: AudioContextState = 'running';
  const node = () => ({gain: {value: 1}, pan: {value: 0}, connect() {}, disconnect() {}});
  const resume = vi.fn(async () => { state = 'running'; });
  const context = {
    currentTime: 0, get state() { return state; }, destination: {},
    resume, createGain: node, createStereoPanner: node,
  } as unknown as AudioContext;
  return {context, resume, suspend: () => { state = 'suspended'; }};
}

function container() {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('preset player operation errors', () => {
  it('reports a real seek restart failure even though the engine seek promise resolves', async () => {
    vi.useFakeTimers();
    const {context, resume, suspend} = audio();
    const onError = vi.fn();
    const handle = mountPresetPlayer(music(), container(), {
      audioContext: context, effect: Effect.gain(), synth: {connect() {}, noteOn() {}}, onError,
    });
    handles.push(handle);
    await handle.play();
    const failure = new Error('audio resume denied');
    suspend();
    resume.mockRejectedValueOnce(failure);

    await expect(handle.seekFraction!(0.5)).resolves.toBeUndefined();

    expect(handle.isPlaying()).toBe(false);
    expect(handle.currentTime).toBe(1);
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it('reports the same graph failure once when cleanup and play both expose it', async () => {
    vi.useFakeTimers();
    const {context} = audio();
    const failure = new Error('backend graph failed');
    const onError = vi.fn();
    const effect = Effect.custom((ctx) => {
      const node = ctx.createGain();
      return {input: node, output: node, dispose() { throw failure; }};
    });
    const handle = mountPresetPlayer(music(), container(), {
      audioContext: context, effect,
      synth: {connect() { throw failure; }, noteOn() {}}, onError,
    });
    handles.push(handle);

    await expect(handle.play()).rejects.toBe(failure);

    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it('detaches a replaced facade from a late seek failure', async () => {
    vi.useFakeTimers();
    vi.spyOn(playbackEvents, 'reportPlaybackOperationFailure').mockImplementation(() => {});
    const {context, resume, suspend} = audio();
    const oldError = vi.fn();
    const nextError = vi.fn();
    const host = container();
    const old = mountPresetPlayer(music(), host, {
      audioContext: context, effect: Effect.gain(), synth: {connect() {}, noteOn() {}}, onError: oldError,
    });
    handles.push(old);
    await old.play();
    let reject!: (error: unknown) => void;
    suspend();
    resume.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const pending = old.seekFraction!(0.5);
    old.destroy();
    handles.push(mountPresetPlayer(music(), host, {onError: nextError}));

    reject(new Error('obsolete resume failed'));
    await pending;

    expect(oldError).not.toHaveBeenCalled();
    expect(nextError).not.toHaveBeenCalled();
  });
});
