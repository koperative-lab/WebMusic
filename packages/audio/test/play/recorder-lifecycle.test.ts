import {afterEach, describe, expect, it, vi} from 'vitest';
import {AudioRecorder} from '../../src/play/headless/recorder';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

function fakeStream() {
  const stop = vi.fn();
  return {
    stream: {getTracks: () => [{stop}]} as unknown as MediaStream,
    stop,
  };
}

function installAudioContext(options: {state?: AudioContextState; resume?: () => Promise<void>} = {}) {
  const instances: FakeAudioContext[] = [];
  const node = () => ({connect: vi.fn(), disconnect: vi.fn()});
  class FakeAudioContext {
    sampleRate = 48_000;
    state: AudioContextState = options.state ?? 'running';
    resume = vi.fn(async () => {
      await options.resume?.();
      if (this.state !== 'closed') this.state = 'running';
    });
    destination = node();
    close = vi.fn(async () => { this.state = 'closed'; });
    source = node();
    analyser = {...node(), fftSize: 0};
    processor = {...node(), onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null};

    constructor() {
      instances.push(this);
    }

    createMediaStreamSource() {
      return this.source;
    }
    createAnalyser() {
      return this.analyser;
    }
    createScriptProcessor() {
      return this.processor;
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  return instances;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AudioRecorder lifecycle', () => {
  it('shares one pending getUserMedia request across concurrent starts', async () => {
    const permission = deferred<MediaStream>();
    const getUserMedia = vi.fn(() => permission.promise);
    vi.stubGlobal('navigator', {mediaDevices: {getUserMedia}});
    const contexts = installAudioContext();
    const {stream, stop} = fakeStream();
    const recorder = new AudioRecorder();

    const first = recorder.start();
    const second = recorder.start();
    expect(second).toBe(first);
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    permission.resolve(stream);
    await Promise.all([first, second]);
    expect(recorder.isRecording).toBe(true);
    expect(contexts).toHaveLength(1);

    recorder.dispose();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(contexts[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('stops a stream whose permission resolves after dispose', async () => {
    const permission = deferred<MediaStream>();
    vi.stubGlobal('navigator', {mediaDevices: {getUserMedia: vi.fn(() => permission.promise)}});
    const contexts = installAudioContext();
    const {stream, stop} = fakeStream();
    const recorder = new AudioRecorder();

    const start = recorder.start();
    recorder.dispose();
    permission.resolve(stream);

    await expect(start).rejects.toThrow(/cancelled/);
    expect(recorder.isRecording).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(contexts).toHaveLength(0);
    await expect(recorder.start()).rejects.toThrow(/disposed/);
  });

  it('stops the acquired stream when audio graph setup fails and permits retry', async () => {
    const first = fakeStream();
    const second = fakeStream();
    const getUserMedia = vi
      .fn<() => Promise<MediaStream>>()
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream);
    vi.stubGlobal('navigator', {mediaDevices: {getUserMedia}});
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    const recorder = new AudioRecorder();

    await expect(recorder.start()).rejects.toThrow(/AudioContext/);
    expect(first.stop).toHaveBeenCalledTimes(1);

    const contexts = installAudioContext();
    await recorder.start();
    expect(recorder.isRecording).toBe(true);
    recorder.dispose();
    expect(second.stop).toHaveBeenCalledTimes(1);
    expect(contexts[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('returns to idle after a rejected permission request', async () => {
    const getUserMedia = vi
      .fn<() => Promise<MediaStream>>()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(fakeStream().stream);
    vi.stubGlobal('navigator', {mediaDevices: {getUserMedia}});
    installAudioContext();
    const recorder = new AudioRecorder();

    await expect(recorder.start()).rejects.toThrow('denied');
    await expect(recorder.start()).resolves.toBeUndefined();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    recorder.dispose();
  });

  it('rolls back a committed capture when a start listener throws', async () => {
    const first = fakeStream();
    const second = fakeStream();
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn<() => Promise<MediaStream>>()
          .mockResolvedValueOnce(first.stream)
          .mockResolvedValueOnce(second.stream),
      },
    });
    const contexts = installAudioContext();
    const recorder = new AudioRecorder();
    const off = recorder.on('start', () => {
      throw new Error('observer failed');
    });

    await expect(recorder.start()).rejects.toThrow('observer failed');
    expect(recorder.isRecording).toBe(false);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(contexts[0]!.close).toHaveBeenCalledOnce();

    off();
    await recorder.start();
    expect(recorder.isRecording).toBe(true);
    recorder.dispose();
    expect(second.stop).toHaveBeenCalledOnce();
  });

  it('stops capture and surfaces an error before retained PCM exceeds its limit', async () => {
    const {stream, stop} = fakeStream();
    vi.stubGlobal('navigator', {
      mediaDevices: {getUserMedia: vi.fn(async () => stream)},
    });
    const contexts = installAudioContext();
    const recorder = new AudioRecorder({maxRecordedFrames: 4});
    const onError = vi.fn();
    recorder.on('error', onError);
    await recorder.start();

    contexts[0]!.processor.onaudioprocess?.({
      inputBuffer: {
        length: 5,
        numberOfChannels: 1,
        getChannelData: () => new Float32Array(5),
      },
    } as unknown as AudioProcessingEvent);

    expect(recorder.isRecording).toBe(false);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/maxRecordedFrames/),
      }),
    );
    expect(stop).toHaveBeenCalledOnce();
    expect(contexts[0]!.close).toHaveBeenCalledOnce();
    await expect(recorder.stop()).rejects.toThrow(/maxRecordedFrames/);
  });

  it('keeps both channels aligned when the input changes from mono to stereo and back', async () => {
    const {stream} = fakeStream();
    vi.stubGlobal('navigator', {mediaDevices: {getUserMedia: vi.fn(async () => stream)}});
    const contexts = installAudioContext();
    const recorder = new AudioRecorder();
    await recorder.start();
    const feed = (...channels: number[][]) => {
      contexts[0]!.processor.onaudioprocess?.({
        inputBuffer: {
          length: channels[0]!.length,
          numberOfChannels: channels.length,
          getChannelData: (channel: number) => Float32Array.from(channels[channel]!),
        },
      } as unknown as AudioProcessingEvent);
    };

    feed([0.1, 0.2]);
    feed([0.3, 0.4], [0.5, 0.6]);
    feed([0.7, 0.8]);
    const clip = await recorder.stop();

    expect(clip.numberOfChannels).toBe(2);
    expect(Array.from(clip.channelData(0)!, (value) => Number(value.toFixed(2)))).toEqual([
      0.1, 0.2, 0.3, 0.4, 0.7, 0.8,
    ]);
    expect(Array.from(clip.channelData(1)!, (value) => Number(value.toFixed(2)))).toEqual([
      0, 0, 0.5, 0.6, 0, 0,
    ]);
  });

  it('counts the silence retained for a promoted stereo channel against the byte limit', async () => {
    const {stream, stop} = fakeStream();
    vi.stubGlobal('navigator', {mediaDevices: {getUserMedia: vi.fn(async () => stream)}});
    const contexts = installAudioContext();
    const recorder = new AudioRecorder({maxRecordedBytes: 24});
    await recorder.start();
    const feed = (channelCount: number) => {
      contexts[0]!.processor.onaudioprocess?.({
        inputBuffer: {
          length: 2,
          numberOfChannels: channelCount,
          getChannelData: () => new Float32Array(2),
        },
      } as unknown as AudioProcessingEvent);
    };

    feed(1);
    feed(2);

    expect(recorder.isRecording).toBe(false);
    expect(stop).toHaveBeenCalledOnce();
    await expect(recorder.stop()).rejects.toThrow(/maxRecordedBytes/);
  });

  it('validates recording memory limits at construction', () => {
    for (const name of ['maxRecordedFrames', 'maxRecordedBytes'] as const) {
      expect(() => new AudioRecorder({[name]: 0})).toThrow(new RegExp(name));
      expect(() => new AudioRecorder({[name]: Number.MAX_SAFE_INTEGER + 1})).toThrow(new RegExp(name));
    }
  });
});

describe('AudioRecorder context readiness and channel energy', () => {
  it('waits for a suspended context before announcing capture', async () => {
    const ready = deferred<void>();
    const {stream} = fakeStream();
    vi.stubGlobal('navigator', {mediaDevices: {getUserMedia: vi.fn(async () => stream)}});
    const contexts = installAudioContext({state: 'suspended', resume: () => ready.promise});
    const recorder = new AudioRecorder();
    const started = vi.fn();
    recorder.on('start', started);
    const pending = recorder.start();
    await Promise.resolve();
    expect(contexts[0]!.resume).toHaveBeenCalledOnce();
    expect(recorder.isRecording).toBe(false);
    expect(started).not.toHaveBeenCalled();
    expect(recorder.inputAnalyser).toBeUndefined();
    ready.resolve();
    await pending;
    expect(recorder.isRecording).toBe(true);
    expect(started).toHaveBeenCalledOnce();
    recorder.dispose();
  });

  it('releases capture resources when resume rejects, then permits retry', async () => {
    const {stream, stop} = fakeStream();
    vi.stubGlobal('navigator', {mediaDevices: {getUserMedia: vi.fn(async () => stream)}});
    const resume = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('resume denied')).mockResolvedValueOnce();
    const contexts = installAudioContext({state: 'suspended', resume});
    const recorder = new AudioRecorder();
    await expect(recorder.start()).rejects.toThrow('resume denied');
    expect(recorder.isRecording).toBe(false);
    expect(stop).toHaveBeenCalledOnce();
    expect(contexts[0]!.close).toHaveBeenCalledOnce();
    await recorder.start();
    expect(recorder.isRecording).toBe(true);
    recorder.dispose();
  });

  it('releases a device immediately when disposed during pending resume', async () => {
    const ready = deferred<void>();
    const {stream, stop} = fakeStream();
    vi.stubGlobal('navigator', {mediaDevices: {getUserMedia: vi.fn(async () => stream)}});
    const contexts = installAudioContext({state: 'suspended', resume: () => ready.promise});
    const recorder = new AudioRecorder();
    const started = vi.fn(); recorder.on('start', started);
    const pending = recorder.start();
    await Promise.resolve();
    recorder.dispose();
    expect(stop).toHaveBeenCalledOnce();
    expect(contexts[0]!.close).toHaveBeenCalledOnce();
    ready.resolve();
    await expect(pending).rejects.toThrow('cancelled');
    expect(started).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
    expect(contexts[0]!.close).toHaveBeenCalledOnce();
  });

  it('measures energy across channels without cancelling opposite phases', async () => {
    const {stream} = fakeStream();
    vi.stubGlobal('navigator', {mediaDevices: {getUserMedia: vi.fn(async () => stream)}});
    const contexts = installAudioContext();
    const recorder = new AudioRecorder();
    await recorder.start();
    const feed = (left: number, right: number) => contexts[0]!.processor.onaudioprocess?.({
      inputBuffer: {length: 4, numberOfChannels: 2,
        getChannelData: (channel: number) => new Float32Array(4).fill(channel ? right : left)},
    } as unknown as AudioProcessingEvent);
    feed(0, 0.5);
    expect(recorder.level).toBeCloseTo(Math.sqrt(0.125));
    feed(0.5, -0.5);
    expect(recorder.level).toBeCloseTo(0.5);
    const clip = await recorder.stop();
    expect(clip.length).toBe(8);
    expect(clip.sampleRate).toBe(48_000);
    expect([...clip.channelData(1)!]).toEqual([0.5, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5]);
  });
});
