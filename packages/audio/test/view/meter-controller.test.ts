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

describe('AudioMeterController float reads and stereo branch', () => {
  interface StereoFixture {
    context: BaseAudioContext;
    analyser: FakeAnalyser & {
      getFloatTimeDomainData: ReturnType<typeof vi.fn>;
      getFloatFrequencyData: ReturnType<typeof vi.fn>;
      context: unknown;
      minDecibels: number;
      maxDecibels: number;
    };
    gains: Array<FakeNode & {channelCount?: number; channelCountMode?: string; channelInterpretation?: string}>;
    splitters: FakeNode[];
    analysers: Array<FakeAnalyser & {getFloatTimeDomainData: ReturnType<typeof vi.fn>}>;
  }

  function stereoFixture(): StereoFixture {
    const gains: StereoFixture['gains'] = [];
    const splitters: FakeNode[] = [];
    const analysers: StereoFixture['analysers'] = [];
    const context = {
      sampleRate: 48_000,
      createGain: vi.fn(() => {
        const gain = node();
        gains.push(gain);
        return gain;
      }),
      createChannelSplitter: vi.fn(() => {
        const splitter = node();
        splitters.push(splitter);
        return splitter;
      }),
      createAnalyser: vi.fn(() => {
        const channel = analysers.length;
        const created = {
          ...analyser(),
          getFloatTimeDomainData: vi.fn((buffer: Float32Array) => buffer.fill(channel === 0 ? 0.25 : -0.25)),
        };
        analysers.push(created);
        return created;
      }),
    } as unknown as BaseAudioContext;
    const borrowed = {
      ...analyser(),
      fftSize: 8,
      frequencyBinCount: 4,
      minDecibels: -90,
      maxDecibels: -20,
      context,
      getByteFrequencyData: vi.fn((buffer: Uint8Array) => buffer.fill(128)),
      getFloatTimeDomainData: vi.fn((buffer: Float32Array) => buffer.set([0, 0.5, 0, -0.5, 0, 0.5, 0, -0.5])),
      getFloatFrequencyData: vi.fn((buffer: Float32Array) => buffer.set([-100, -60, -40, -80])),
    };
    return {context, analyser: borrowed, gains, splitters, analysers};
  }

  it('reads float windows into reused scratch buffers and reports the frequency grid', () => {
    const fixture = stereoFixture();
    const controller = new AudioMeterController({analyser: fixture.analyser as unknown as AnalyserNode});
    expect(controller.sampleRate).toBe(48_000);
    expect(controller.frequencyInfo).toEqual({sampleRate: 48_000, frequencyBinCount: 4, minDecibels: -90, maxDecibels: -20});
    const time = controller.readTimeDomain();
    expect(Array.from(time)).toEqual([0, 0.5, 0, -0.5, 0, 0.5, 0, -0.5]);
    expect(controller.readTimeDomain()).toBe(time);
    const frequency = controller.readFrequency();
    expect(frequency).toHaveLength(4);
    expect(frequency[0]).toBeCloseTo(128 / 255);
    expect(controller.readFrequency()).toBe(frequency);
    expect(Array.from(controller.readFrequencyDecibels())).toEqual([-100, -60, -40, -80]);
    expect(controller.stereo).toBe(false);
    expect(controller.readStereo()).toBeUndefined();
    controller.dispose();
    expect(() => controller.readTimeDomain()).toThrow('no analyser');
    expect(new AudioMeterController().frequencyInfo).toBeUndefined();
    expect(new AudioMeterController().attachStereo()).toBe(false);
  });

  it('adds one output edge to a borrowed analyser for the stereo branch and removes only that edge', () => {
    const fixture = stereoFixture();
    const controller = new AudioMeterController({analyser: fixture.analyser as unknown as AnalyserNode});
    expect(controller.attachStereo()).toBe(true);
    expect(controller.attachStereo()).toBe(true);
    expect(controller.stereo).toBe(true);
    expect(fixture.gains).toHaveLength(1);
    expect(fixture.splitters).toHaveLength(1);
    expect(fixture.analysers).toHaveLength(2);
    const [fanOut] = fixture.gains;
    expect(fanOut!.channelCount).toBe(2);
    expect(fanOut!.channelCountMode).toBe('explicit');
    expect(fanOut!.channelInterpretation).toBe('speakers');
    expect(fixture.analyser.connect).toHaveBeenCalledWith(fanOut);
    expect(fanOut!.connect).toHaveBeenCalledWith(fixture.splitters[0]);
    expect(fixture.splitters[0]!.connect).toHaveBeenCalledWith(fixture.analysers[0], 0);
    expect(fixture.splitters[0]!.connect).toHaveBeenCalledWith(fixture.analysers[1], 1);
    expect(fixture.analysers.every((channel) => channel.fftSize === 8 && channel.smoothingTimeConstant === 0)).toBe(true);

    const frame = controller.readStereo()!;
    expect(Array.from(frame.left)).toEqual(new Array(8).fill(0.25));
    expect(Array.from(frame.right)).toEqual(new Array(8).fill(-0.25));
    expect(controller.readStereo()!.left).toBe(frame.left);

    controller.releaseStereo();
    expect(controller.stereo).toBe(false);
    expect(fixture.analyser.disconnect).toHaveBeenCalledTimes(1);
    expect(fixture.analyser.disconnect).toHaveBeenCalledWith(fanOut);
    expect(fanOut!.disconnect).toHaveBeenCalledOnce();
    expect(fixture.splitters[0]!.disconnect).toHaveBeenCalledOnce();
    expect(fixture.analysers[0]!.disconnect).toHaveBeenCalledOnce();
    expect(fixture.analysers[1]!.disconnect).toHaveBeenCalledOnce();
    controller.releaseStereo();
    expect(fixture.analyser.disconnect).toHaveBeenCalledTimes(1);

    controller.attachStereo();
    controller.dispose();
    expect(fixture.analyser.disconnect).toHaveBeenCalledTimes(2);
    expect(fixture.analyser.disconnect.mock.calls.every((call) => call.length === 1)).toBe(true);
  });

  it('rolls back a partially built branch and tolerates an already detached analyser', () => {
    const fixture = stereoFixture();
    vi.mocked(fixture.context.createChannelSplitter).mockImplementationOnce(() => {
      throw new Error('no splitter');
    });
    const controller = new AudioMeterController({analyser: fixture.analyser as unknown as AnalyserNode});
    expect(() => controller.attachStereo()).toThrow('no splitter');
    expect(controller.stereo).toBe(false);
    expect(fixture.gains[0]!.disconnect).toHaveBeenCalledOnce();
    expect(fixture.analyser.connect).not.toHaveBeenCalled();

    expect(controller.attachStereo()).toBe(true);
    fixture.analyser.disconnect.mockImplementationOnce(() => {
      throw new Error('not connected');
    });
    expect(() => controller.releaseStereo()).not.toThrow();
    expect(controller.stereo).toBe(false);
  });

  it('keeps the owned channel analysers at the summed window length while tuning', () => {
    const fixture = stereoFixture();
    const owned = analyser();
    const context = {
      createGain: vi.fn(() => node()),
      createAnalyser: vi.fn()
        .mockImplementationOnce(() => Object.assign(owned, {context: fixture.context}))
        .mockImplementation(() => fixture.context.createAnalyser()),
      createChannelSplitter: fixture.context.createChannelSplitter,
      sampleRate: 48_000,
    } as unknown as BaseAudioContext;
    const controller = new AudioMeterController({context, fftSize: 64});
    expect(controller.attachStereo()).toBe(true);
    expect(fixture.analysers.every((channel) => channel.fftSize === 64)).toBe(true);
    controller.configure({fftSize: 256});
    expect(fixture.analysers.every((channel) => channel.fftSize === 256)).toBe(true);
    controller.dispose();
    expect(owned.disconnect).toHaveBeenCalledTimes(2);
  });
});
