import {describe, expect, it} from 'vitest';
import {LevelMeterController, createLevelMeterController} from '../../src/play/headless/meter';

/**
 * Score's meter is an adapter over the kernel's shared analyser meter. These
 * pin the editorial choices that stayed with Score across that extraction.
 */
function fakeContext(options: {time?: number[]; frequency?: number[]; failDisconnect?: boolean} = {}) {
  const gain = () => ({
    connect: (target: unknown) => target,
    disconnect() {
      if (options.failDisconnect) throw new Error('already disconnected');
    },
  });
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    get frequencyBinCount() {
      return options.frequency?.length ?? 16;
    },
    connect: (target: unknown) => target,
    disconnect() {
      if (options.failDisconnect) throw new Error('already disconnected');
    },
    getByteTimeDomainData(target: Uint8Array) {
      for (let index = 0; index < target.length; index += 1) target[index] = options.time?.[index] ?? 128;
    },
    getByteFrequencyData(target: Uint8Array) {
      for (let index = 0; index < target.length; index += 1) target[index] = options.frequency?.[index] ?? 0;
    },
  };
  return {
    createGain: gain,
    createAnalyser: () => analyser,
  } as unknown as BaseAudioContext;
}

describe('LevelMeterController', () => {
  it('publishes the score frame shape, scaled by score defaults', () => {
    // Half-scale square wave: rms = 0.5, and score has always scaled by 1.8.
    const context = fakeContext({time: Array.from({length: 8}, (_, i) => (i % 2 ? 192 : 64))});
    const frame = createLevelMeterController({context, fftSize: 8}).readLevel();

    expect(Object.keys(frame).sort()).toEqual(['level', 'peak', 'peakHold']);
    expect(frame.level).toBeCloseTo(0.9, 9);
    expect(frame.peak).toBeCloseTo(0.9, 9);
    expect(frame.peakHold).toBeCloseTo(0.9, 9);
  });

  it('keeps the four-bar spectrum floor', () => {
    const context = fakeContext({frequency: Array.from({length: 16}, () => 255)});
    const meter = createLevelMeterController({context});

    expect(meter.readSpectrum(2)).toHaveLength(4);
    expect(meter.readSpectrum(28)).toHaveLength(28);
  });

  it('finishes owned cleanup silently even when a disconnect throws', () => {
    const context = fakeContext({failDisconnect: true});
    const meter = createLevelMeterController({context});

    // Element disconnect paths call this; it must never throw at them.
    expect(() => meter.dispose()).not.toThrow();
    expect(() => meter.dispose()).not.toThrow();
  });

  it('rejects owning and borrowing at once with score wording', () => {
    const context = fakeContext();
    const analyser = {} as AnalyserNode;
    expect(() => new LevelMeterController({context, analyser})).toThrow(
      'Provide context or analyser, not both',
    );
  });
});
