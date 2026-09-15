import {describe, expect, it, vi} from 'vitest';
import {
  TempoController,
  appendTap,
  tapBpm,
} from '../../src/play/headless/tempo';

describe('TempoController pure tap tempo', () => {
  it('keeps tap history and reports a rolling BPM without any DOM', () => {
    let now = 10;
    const controller = new TempoController({now: () => now});
    const notify = vi.fn();
    controller.subscribe(notify);

    expect(controller.press()).toEqual({type: 'tap', bpm: null});
    now += 0.5;
    expect(controller.press()).toEqual({type: 'tap', bpm: 120});
    now += 0.5;
    expect(controller.press()).toEqual({type: 'tap', bpm: 120});
    expect(controller.snapshot()).toMatchObject({
      mode: 'tap',
      bpm: 120,
      activation: 3,
      holding: false,
    });
    expect(notify).toHaveBeenCalledTimes(3);
  });

  it('retains the public reset/window helpers', () => {
    expect(appendTap([0, 0.5], 4)).toEqual([4]);
    let taps: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      taps = appendTap(taps, index * 0.5);
    }
    expect(taps).toHaveLength(7);
    expect(tapBpm(taps)).toBe(120);
  });
});

describe('TempoController conduct lifecycle', () => {
  it('computes conduct intervals including when the first press is at zero', () => {
    let now = 0;
    const target = {
      advance: vi.fn(),
      advanceHold: vi.fn(),
      allNotesOff: vi.fn(),
    };
    const controller = new TempoController({
      mode: 'conduct',
      conduct: 'hold',
      target,
      now: () => now,
    });

    expect(controller.press()).toEqual({type: 'beat', secondsPerBeat: undefined});
    expect(controller.snapshot().holding).toBe(true);
    controller.release();
    now = 0.5;
    expect(controller.press()).toEqual({type: 'beat', secondsPerBeat: 0.5});
    controller.release();
    now = 10;
    expect(controller.press()).toEqual({type: 'beat', secondsPerBeat: 2});

    expect(target.advanceHold).toHaveBeenCalledTimes(3);
    expect(target.allNotesOff).toHaveBeenCalledTimes(2);
    controller.dispose();
    expect(target.allNotesOff).toHaveBeenCalledTimes(3);
  });

  it('full mode advances once and never owns a held target', () => {
    const target = {advance: vi.fn(), allNotesOff: vi.fn()};
    const controller = new TempoController({mode: 'conduct', conduct: 'full', target});

    controller.press(1);
    controller.press(1.5);
    controller.release();
    controller.dispose();

    expect(target.advance).toHaveBeenNthCalledWith(1, {});
    expect(target.advance).toHaveBeenNthCalledWith(2, {secondsPerBeat: 0.5});
    expect(target.allNotesOff).not.toHaveBeenCalled();
    expect(controller.snapshot().holding).toBe(false);
  });

  it('releases the exact held target before target/mode/conduct changes', () => {
    const first = {advance: vi.fn(), advanceHold: vi.fn(), allNotesOff: vi.fn()};
    const second = {advance: vi.fn(), advanceHold: vi.fn(), allNotesOff: vi.fn()};
    const controller = new TempoController({mode: 'conduct', target: first});

    controller.press(1);
    controller.configure({target: second});
    expect(first.allNotesOff).toHaveBeenCalledTimes(1);
    expect(second.allNotesOff).not.toHaveBeenCalled();

    controller.press(2);
    controller.configure({conduct: 'full'});
    expect(second.allNotesOff).toHaveBeenCalledTimes(1);
    controller.configure({mode: 'tap'});
    controller.configure({mode: 'conduct'});
    expect(controller.press(100)).toEqual({type: 'beat', secondsPerBeat: undefined});
    controller.dispose();
    expect(second.allNotesOff).toHaveBeenCalledTimes(1);
  });

  it('makes a configuration transition atomic against release reentrancy', () => {
    const target = {
      advance: vi.fn(),
      advanceHold: vi.fn(),
      allNotesOff: vi.fn(),
    };
    const controller = new TempoController({mode: 'conduct', target});
    target.allNotesOff.mockImplementation(() => controller.press(2));
    controller.press(1);
    controller.subscribe(() => {
      if (controller.snapshot().mode === 'tap' && controller.snapshot().activation < 3) {
        controller.press(3);
      }
    });

    controller.configure({mode: 'tap'});

    expect(target.advanceHold).toHaveBeenCalledOnce();
    expect(target.allNotesOff).toHaveBeenCalledOnce();
    expect(controller.snapshot()).toMatchObject({
      mode: 'tap',
      holding: false,
      activation: 3,
      bpm: 60,
    });
    controller.dispose();
  });

  it('does not revive conduct mode when releasing a previous press reconfigures it', () => {
    const target = {advance: vi.fn(), advanceHold: vi.fn(), allNotesOff: vi.fn()};
    const controller = new TempoController({mode: 'conduct', target});
    controller.press(1);
    controller.subscribe(() => {
      const state = controller.snapshot();
      if (state.mode === 'conduct' && !state.holding) controller.configure({mode: 'tap'});
    });

    expect(controller.press(2)).toBeUndefined();

    expect(target.advanceHold).toHaveBeenCalledOnce();
    expect(target.allNotesOff).toHaveBeenCalledOnce();
    expect(controller.snapshot()).toMatchObject({mode: 'tap', holding: false, activation: 2});
    controller.dispose();
  });

  it('dispose releases after an advance failure, clears subscribers and is idempotent', () => {
    const failure = new Error('advance failed');
    const target = {
      advance: vi.fn(),
      advanceHold: vi.fn(() => {
        throw failure;
      }),
      allNotesOff: vi.fn(),
    };
    const controller = new TempoController({mode: 'conduct', target});
    const notify = vi.fn();
    controller.subscribe(notify);

    expect(() => controller.press(1)).toThrow(failure);
    expect(controller.snapshot().holding).toBe(true);
    controller.dispose();
    controller.dispose();

    expect(target.allNotesOff).toHaveBeenCalledTimes(1);
    expect(controller.press(2)).toBeUndefined();
    const callsAfterDispose = notify.mock.calls.length;
    controller.configure({mode: 'tap'});
    expect(notify).toHaveBeenCalledTimes(callsAfterDispose);
  });

  it('never lets a subscriber failure prevent release of a held target', () => {
    const target = {advance: vi.fn(), advanceHold: vi.fn(), allNotesOff: vi.fn()};
    const controller = new TempoController({mode: 'conduct', target});
    controller.press(1);
    controller.subscribe(() => {
      throw new Error('listener failed');
    });

    expect(() => controller.release()).toThrow('listener failed');
    expect(target.allNotesOff).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().holding).toBe(false);
  });

  it('runs the conduct command before publishing and preserves its first failure', () => {
    const sequence: string[] = [];
    const target = {
      advance: vi.fn(),
      advanceHold: vi.fn(() => sequence.push('advance')),
      allNotesOff: vi.fn(() => sequence.push('release')),
    };
    const controller = new TempoController({mode: 'conduct', target});
    controller.subscribe(() => {
      sequence.push(`notify:${controller.snapshot().holding}`);
      if (controller.snapshot().holding) controller.release();
    });

    controller.press(1);

    expect(sequence).toEqual(['advance', 'notify:true', 'release', 'notify:false']);
    expect(controller.snapshot().holding).toBe(false);
  });

  it('still advances when a conduct subscriber throws', () => {
    const target = {advance: vi.fn()};
    const controller = new TempoController({mode: 'conduct', conduct: 'full', target});
    controller.subscribe(() => {
      throw new Error('listener failed');
    });

    expect(() => controller.press(1)).toThrow('listener failed');
    expect(target.advance).toHaveBeenCalledOnce();
  });

  it('seals new commands before dispose publishes a held release', () => {
    const target = {advance: vi.fn(), advanceHold: vi.fn(), allNotesOff: vi.fn()};
    const controller = new TempoController({mode: 'conduct', target});
    controller.press(1);
    const reentrantPress = vi.fn(() => controller.press(2));
    controller.subscribe(reentrantPress);

    controller.dispose();

    expect(reentrantPress).toHaveReturnedWith(undefined);
    expect(target.advanceHold).toHaveBeenCalledOnce();
    expect(target.allNotesOff).toHaveBeenCalledOnce();
    expect(controller.snapshot().holding).toBe(false);
  });
});
