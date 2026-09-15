import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Sound} from '../../src/play/headless';

async function fixture() {
  let time = 0;
  let state: AudioContextState = 'running';
  const sent: number[][] = [];
  const send = vi.fn((message: number[] | Uint8Array) => { sent.push([...message]); });
  const context = {
    get currentTime() { return time; },
    get state() { return state; },
    createGain: () => ({context, gain: {value: 1}, connect() {}, disconnect() {}}),
  };
  const sound = Sound.midiOut({output: {send}});
  const release = sound.connect({context} as unknown as AudioNode);
  await sound.ready;
  return {
    sound, release, send, sent,
    at(seconds: number) { time = seconds; },
    suspend() { state = 'suspended'; },
    resume() { state = 'running'; },
    close() { state = 'closed'; },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('MIDI occurrence ownership', () => {
  it('releases an occurrence once, preserving the second same-pitch attack', async () => {
    const f = await fixture();
    const first = f.sound.noteOn(60, 100, 0, 1);
    const second = f.sound.noteOn(60, 80, 0, 2);
    expect(first).not.toBeUndefined();
    expect(second).not.toBe(first);
    vi.advanceTimersByTime(0);
    f.at(0.25);
    f.sound.noteOffById(first, 0.25);
    vi.advanceTimersByTime(0);
    f.at(1);
    vi.advanceTimersByTime(1000);
    expect(f.sent).toEqual([[0x90, 60, 100], [0x90, 60, 80], [0x80, 60, 0]]);
    f.release();
    expect(f.sent.filter(([status]) => status === 0x80)).toHaveLength(2);
    f.at(3);
    vi.advanceTimersByTime(3000);
    expect(f.sent).toHaveLength(4);
  });

  it('holds future attacks and releases while the audio clock is suspended', async () => {
    const f = await fixture();
    f.sound.noteOn(60, 100, 1, 1);
    f.suspend();
    vi.advanceTimersByTime(2500);
    expect(f.sent).toEqual([]);
    f.resume();
    f.at(1);
    vi.advanceTimersByTime(50);
    expect(f.sent).toEqual([[0x90, 60, 100]]);
    f.suspend();
    vi.advanceTimersByTime(2500);
    expect(f.sent).toHaveLength(1);
    f.resume();
    f.at(2);
    vi.advanceTimersByTime(50);
    expect(f.sent).toEqual([[0x90, 60, 100], [0x80, 60, 0]]);
    f.release();
  });

  it('retimes an active gate when a playback rate change extends it', async () => {
    const f = await fixture();
    const handle = f.sound.noteOn(60, 100, 0, 1);
    vi.advanceTimersByTime(0);
    f.at(0.5);
    f.sound.retimeScheduledNote(handle, 2);
    f.at(1);
    vi.advanceTimersByTime(1000);
    expect(f.sent).toHaveLength(1);
    f.at(2);
    vi.advanceTimersByTime(1000);
    expect(f.sent).toHaveLength(2);
    f.release();
  });

  it('honors an explicit pause release immediately while audio time is suspended', async () => {
    const f = await fixture();
    const handle = f.sound.noteOn(60, 100, 0, 10);
    vi.advanceTimersByTime(0);
    f.suspend();
    f.sound.noteOffById(handle, 0);
    expect(f.sent).toEqual([[0x90, 60, 100], [0x80, 60, 0]]);
    f.release();
  });

  it('retires closed-clock notes without leaving a polling timer', async () => {
    const f = await fixture();
    f.sound.noteOn(60, 100, 0, 1);
    f.sound.noteOn(64, 100, 1, 1);
    vi.advanceTimersByTime(0);
    f.close();
    vi.advanceTimersByTime(2000);
    expect(f.sent).toEqual([[0x90, 60, 100], [0x80, 60, 0]]);
    expect(vi.getTimerCount()).toBe(0);
    f.release();
  });

  it('continues route cleanup after one device send throws and never retries retired notes', async () => {
    const f = await fixture();
    f.sound.noteOn(60, 100, 0, 10);
    f.sound.noteOn(64, 100, 0, 10);
    vi.advanceTimersByTime(0);
    const failure = new Error('device lost');
    f.send.mockImplementationOnce(() => { throw failure; });
    expect(f.release).toThrow(failure);
    expect(f.sent).toContainEqual([0x80, 64, 0]);
    const count = f.send.mock.calls.length;
    expect(f.release).not.toThrow();
    f.at(20);
    vi.advanceTimersByTime(20_000);
    expect(f.send).toHaveBeenCalledTimes(count);
  });
});
