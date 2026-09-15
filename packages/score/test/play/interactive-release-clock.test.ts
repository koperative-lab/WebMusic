import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {InteractivePlayer, type HeadlessSynth} from '../../src/play/headless';

function fixture() {
  let time = 0;
  let state: AudioContextState = 'running';
  const context = {
    get currentTime() { return time; }, get state() { return state; },
    destination: {},
    createGain: () => ({context, gain: {value: 1}, connect() {}, disconnect() {}}),
  };
  let nextHandle = 0;
  const release = vi.fn();
  const synth: HeadlessSynth = {connect() {}, noteOn: () => ++nextHandle, noteOffById: release};
  const player = new InteractivePlayer({audioContext: context as unknown as AudioContext, lookaheadSeconds: 0});
  player.addVoice('lead', synth);
  return {player, release, at(seconds: number) { time = seconds; }, suspend() { state = 'suspended'; }, resume() { state = 'running'; }};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('interactive releases follow their note and audio clock', () => {
  it('does not consume a logical gate while the AudioContext is suspended', () => {
    const f = fixture();
    const off = vi.fn();
    f.player.on('noteOff', off);
    f.player.noteOn('lead', 60, 100, 1);
    f.at(0.25);
    f.suspend();
    vi.advanceTimersByTime(2000);
    expect(f.release).not.toHaveBeenCalled();
    expect(off).not.toHaveBeenCalled();
    f.resume();
    f.at(1);
    vi.advanceTimersByTime(50);
    expect(f.release).toHaveBeenCalledExactlyOnceWith(1, 1);
    expect(off).toHaveBeenCalledExactlyOnceWith({voice: 'lead', midi: 60, time: 1});
    f.player.dispose();
  });

  it('preserves the automatic release of a new note started inside allNotesOff feedback', () => {
    const f = fixture();
    f.player.noteOn('lead', 60, 100, 10);
    f.player.on('noteOff', ({midi}) => { if (midi === 60) f.player.noteOn('lead', 64, 100, 1); });
    f.player.allNotesOff();
    expect(f.release).toHaveBeenCalledExactlyOnceWith(1, 0);
    f.at(1);
    vi.advanceTimersByTime(1000);
    expect(f.release.mock.calls).toEqual([[1, 0], [2, 1]]);
    f.player.dispose();
  });

  it('does not recursively release the same occurrence from a backend callback', () => {
    const f = fixture();
    f.player.noteOn('lead', 60, 100, 1);
    f.player.noteOn('lead', 64, 100, 1);
    f.release.mockImplementation(() => { f.player.allNotesOff(); });
    f.player.allNotesOff();
    expect(f.release.mock.calls).toEqual([[1, 0], [2, 0]]);
    f.player.allNotesOff();
    expect(f.release).toHaveBeenCalledTimes(2);
    f.player.dispose();
  });
});
