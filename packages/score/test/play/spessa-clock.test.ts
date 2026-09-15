import {afterEach, describe, expect, it, vi} from 'vitest';
import {SpessaSynthSynth} from '../../src/play/headless';

afterEach(() => vi.useRealTimers());

describe('adopted Spessa audio-clock timing', () => {
  it('waits for audio time after timer wake and cancels remaining work on disposal', () => {
    vi.useFakeTimers();
    let time = 0;
    let state: AudioContextState = 'running';
    const context = {get currentTime() { return time; }, get state() { return state; }} as AudioContext;
    const synth = {noteOn: vi.fn(), noteOff: vi.fn(), dispose: vi.fn()};
    const adapter = new SpessaSynthSynth(synth, 2, context);
    adapter.noteOn(60, 100, 1);
    adapter.noteOff(60, 2);
    state = 'suspended';
    vi.advanceTimersByTime(3000);
    expect(synth.noteOn).not.toHaveBeenCalled();
    expect(synth.noteOff).not.toHaveBeenCalled();
    state = 'running';
    time = 1;
    vi.advanceTimersByTime(50);
    expect(synth.noteOn).toHaveBeenCalledExactlyOnceWith(2, 60, 100);
    expect(synth.noteOff).not.toHaveBeenCalled();
    state = 'suspended';
    adapter.noteOff(60, 1);
    vi.advanceTimersByTime(0);
    expect(synth.noteOff).toHaveBeenCalledExactlyOnceWith(2, 60);
    adapter.dispose();
    time = 3;
    vi.advanceTimersByTime(3000);
    expect(synth.noteOff).toHaveBeenCalledExactlyOnceWith(2, 60);
    expect(synth.dispose).not.toHaveBeenCalled();
  });
});
