// @vitest-environment node

import {afterEach, describe, expect, it, vi} from 'vitest';
import {createWebAudioContext, getAudioContextConstructor} from '../src/audio-context';

afterEach(() => vi.unstubAllGlobals());

describe('AudioContext construction', () => {
  it('imports without Web Audio and reports the caller-owned unavailable message', () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    expect(getAudioContextConstructor()).toBeUndefined();
    expect(() => createWebAudioContext('Audio unavailable here')).toThrow('Audio unavailable here');
  });

  it('prefers the standard constructor and does not create a context while feature-testing', () => {
    const standard = vi.fn(function () {});
    const legacy = vi.fn(function () {});
    vi.stubGlobal('AudioContext', standard);
    vi.stubGlobal('webkitAudioContext', legacy);
    expect(getAudioContextConstructor()).toBe(standard);
    expect(standard).not.toHaveBeenCalled();
    createWebAudioContext('unavailable');
    expect(standard).toHaveBeenCalledWith();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('falls back to the legacy constructor and forwards the exact options', () => {
    const legacy = vi.fn(function () {});
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', legacy);
    const options: AudioContextOptions = {sampleRate: 48_000, latencyHint: 'interactive'};
    const context = createWebAudioContext('unavailable', options);
    expect(context).toBeInstanceOf(legacy);
    expect(legacy).toHaveBeenCalledExactlyOnceWith(options);
  });

  it('preserves constructor failures instead of retrying or hiding them', () => {
    const failure = new Error('context limit exceeded');
    const standard = vi.fn(function () { throw failure; });
    const legacy = vi.fn(function () {});
    vi.stubGlobal('AudioContext', standard);
    vi.stubGlobal('webkitAudioContext', legacy);
    expect(() => createWebAudioContext('unavailable')).toThrow(failure);
    expect(standard).toHaveBeenCalledTimes(1);
    expect(legacy).not.toHaveBeenCalled();
  });
});
