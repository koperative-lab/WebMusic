import {describe, expect, it, vi} from 'vitest';
import {
  RangeSampler as FacadeRangeSampler,
  chooseZone as facadeChooseZone,
  playbackRateFor as facadePlaybackRateFor,
} from '../../src/play/headless/sound';
import {midiToNoteName, toneAdapter} from '../../src/play/headless/sounds/adapters';
import {
  RangeSampler,
  chooseZone,
  playbackRateFor,
} from '../../src/play/headless/sounds/range-sampler';

describe('Sound module boundaries', () => {
  it('keeps range-sampler exports on the stable Sound facade', () => {
    expect(FacadeRangeSampler).toBe(RangeSampler);
    expect(facadeChooseZone).toBe(chooseZone);
    expect(facadePlaybackRateFor).toBe(playbackRateFor);
  });

  it('isolates Tone note-name conversion and lifecycle delegation', () => {
    const triggerAttack = vi.fn();
    const triggerRelease = vi.fn();
    const dispose = vi.fn();
    const adapter = toneAdapter({triggerAttack, triggerRelease, dispose});

    adapter.noteOn(69, 64, 1.25, 0.5);
    adapter.noteOff?.(69, 1.75);
    adapter.dispose?.();

    expect(midiToNoteName(69)).toBe('A4');
    expect(triggerAttack).toHaveBeenCalledWith('A4', 1.25, 64 / 127);
    expect(triggerRelease).toHaveBeenCalledWith('A4', 1.75);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
