import {describe, expect, it, vi} from 'vitest';
import {
  AudioMeterController,
  createAudioMeterController,
} from '../../src/view/headless/meter';

interface FakeNode {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

interface FakeAnalyser extends FakeNode {
  fftSize: number;
  smoothingTimeConstant: number;
  frequencyBinCount: number;
  getByteTimeDomainData: ReturnType<typeof vi.fn>;
  getByteFrequencyData: ReturnType<typeof vi.fn>;
}

function node(): FakeNode {
  return {connect: vi.fn(), disconnect: vi.fn()};
}

function analyser(): FakeAnalyser {
  return {
    ...node(),
    fftSize: 4,
    smoothingTimeConstant: 0,
    frequencyBinCount: 8,
    getByteTimeDomainData: vi.fn((buffer: Uint8Array) => buffer.set([128, 192, 128, 64])),
    getByteFrequencyData: vi.fn((buffer: Uint8Array) =>
      buffer.set([0, 0, 64, 64, 128, 128, 255, 255]),
    ),
  };
}

describe('AudioMeterController', () => {
  it('owns a transparent tap and reads level and spectrum without DOM', () => {
    const input = node();
    const output = node();
    const meterAnalyser = analyser();
    const context = {
      createGain: vi.fn().mockReturnValueOnce(input).mockReturnValueOnce(output),
      createAnalyser: vi.fn(() => meterAnalyser),
    } as unknown as BaseAudioContext;
    const controller = createAudioMeterController({context, fftSize: 4, levelScale: 1});

    expect(controller.ownsGraph).toBe(true);
    expect(controller.input).toBe(input);
    expect(controller.output).toBe(output);
    expect(input.connect).toHaveBeenCalledWith(meterAnalyser);
    expect(meterAnalyser.connect).toHaveBeenCalledWith(output);

    const level = controller.readLevel();
    expect(level.rms).toBeCloseTo(Math.sqrt(0.125));
    expect(level.level).toBeCloseTo(Math.sqrt(0.125));
    expect(level.peakHold).toBeCloseTo(Math.sqrt(0.125));
    const spectrum = controller.readSpectrum(4);
    expect(spectrum[0]).toBe(0);
    expect(spectrum[1]).toBeCloseTo(64 / 255);
    expect(spectrum[2]).toBeCloseTo(128 / 255);
    expect(spectrum[3]).toBe(1);

    controller.dispose();
    controller.dispose();
    expect(input.disconnect).toHaveBeenCalledOnce();
    expect(meterAnalyser.disconnect).toHaveBeenCalledOnce();
    expect(output.disconnect).toHaveBeenCalledOnce();
    expect(controller.analyser).toBeUndefined();
  });

  it('borrows an analyser and never disconnects it', () => {
    const borrowed = analyser();
    const controller = new AudioMeterController({analyser: borrowed as unknown as AnalyserNode});

    expect(controller.ownsGraph).toBe(false);
    expect(controller.input).toBeUndefined();
    controller.readLevel();
    controller.dispose();

    expect(borrowed.disconnect).not.toHaveBeenCalled();
  });

  it('rolls back partial graph construction without masking the cause', () => {
    const failure = new Error('connect failed');
    const input = node();
    input.connect.mockImplementation(() => {
      throw failure;
    });
    const output = node();
    const meterAnalyser = analyser();
    const context = {
      createGain: vi.fn().mockReturnValueOnce(input).mockReturnValueOnce(output),
      createAnalyser: vi.fn(() => meterAnalyser),
    } as unknown as BaseAudioContext;

    expect(() => new AudioMeterController({context})).toThrow(failure);
    expect(input.disconnect).toHaveBeenCalledOnce();
    expect(meterAnalyser.disconnect).toHaveBeenCalledOnce();
    expect(output.disconnect).toHaveBeenCalledOnce();
  });

  it('attempts every owned disconnect before rethrowing the first failure', () => {
    const failure = new Error('input disconnect failed');
    const input = node();
    input.disconnect.mockImplementation(() => {
      throw failure;
    });
    const output = node();
    const meterAnalyser = analyser();
    const context = {
      createGain: vi.fn().mockReturnValueOnce(input).mockReturnValueOnce(output),
      createAnalyser: vi.fn(() => meterAnalyser),
    } as unknown as BaseAudioContext;
    const controller = new AudioMeterController({context});

    expect(() => controller.dispose()).toThrow(failure);
    expect(meterAnalyser.disconnect).toHaveBeenCalledOnce();
    expect(output.disconnect).toHaveBeenCalledOnce();
    expect(() => controller.dispose()).not.toThrow();
  });

  it('rejects ambiguous or unreadable sources', () => {
    const borrowed = analyser() as unknown as AnalyserNode;
    const context = {} as BaseAudioContext;
    expect(() => new AudioMeterController({context, analyser: borrowed})).toThrow(TypeError);
    const empty = new AudioMeterController();
    expect(() => empty.readLevel()).toThrow('has no analyser');
    empty.dispose();
    expect(() => empty.readSpectrum()).toThrow('has been disposed');
  });
});
