import {afterEach, describe, expect, it, vi} from 'vitest';
import {loadClip, loadClipFromUrl} from '../../src/play/api/load';
import {serializeWav} from '../../src/play/core/wav';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('audio loading resource limits', () => {
  it('rejects oversized buffers and blobs before decode', async () => {
    await expect(loadClip(new ArrayBuffer(8), {maxInputBytes: 4})).rejects.toThrow(/maxInputBytes/);
    await expect(loadClip(new Blob([new Uint8Array(8)]), {maxInputBytes: 4})).rejects.toThrow(/maxInputBytes/);
  });

  it('rejects decoded audio above maxDecodedFrames', async () => {
    const wav = serializeWav([new Float32Array([0, 0.25, -0.25])], 8_000, 16);
    await expect(loadClip(wav, {maxDecodedFrames: 2})).rejects.toThrow(/maxDecodedFrames/);
  });

  it('bounds total decoded bytes and channel count as well as per-channel frames', async () => {
    const stereo = serializeWav(
      [new Float32Array([0, 0.25, -0.25]), new Float32Array([0, -0.25, 0.25])],
      8_000,
      16,
    );
    await expect(loadClip(stereo, {maxDecodedBytes: 20})).rejects.toThrow(/maxDecodedBytes/);

    const decoded = {
      sampleRate: 8_000,
      numberOfChannels: 3,
      length: 1,
      getChannelData: () => new Float32Array(1),
    } as unknown as AudioBuffer;
    await expect(loadClip(decoded, {maxChannels: 2})).rejects.toThrow(/maxChannels/);
  });

  it('rejects an oversized Content-Length without buffering the body', async () => {
    const response = new Response(new Uint8Array(8), {headers: {'content-length': '8'}});
    vi.stubGlobal('fetch', vi.fn(async () => response));

    await expect(loadClipFromUrl('https://example.test/large.wav', {maxInputBytes: 4})).rejects.toThrow(
      /maxInputBytes/,
    );
  });

  it('cancels the response body on HTTP and declared-size preflight failures', async () => {
    const cancelled: unknown[] = [];
    const body = () =>
      new ReadableStream<Uint8Array>({
        cancel(reason) {
          cancelled.push(reason);
        },
      });
    const responses = [
      {
        ok: false,
        status: 503,
        statusText: 'Unavailable',
        headers: new Headers(),
        body: body(),
      },
      {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({'content-length': '8'}),
        body: body(),
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => responses.shift() as Response),
    );

    await expect(loadClipFromUrl('https://example.test/failed.wav')).rejects.toThrow(/503/);
    await expect(loadClipFromUrl('https://example.test/large.wav', {maxInputBytes: 4})).rejects.toThrow(
      /maxInputBytes/,
    );
    expect(cancelled).toHaveLength(2);
  });

  it('enforces maxInputBytes while streaming when Content-Length is absent', async () => {
    const response = new Response(new Uint8Array(8));
    vi.stubGlobal('fetch', vi.fn(async () => response));

    await expect(loadClipFromUrl('https://example.test/large.wav', {maxInputBytes: 4})).rejects.toThrow(
      /maxInputBytes/,
    );
  });

  it('forwards cancellation to fetch', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {once: true});
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const loading = loadClipFromUrl('https://example.test/pending.wav', {signal: controller.signal});
    controller.abort(new Error('cancelled by caller'));

    await expect(loading).rejects.toThrow('cancelled by caller');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal).not.toBe(controller.signal);
  });

  it('aborts a fetch that exceeds timeoutMs', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
        });
      }),
    );

    const loading = loadClipFromUrl('https://example.test/slow.wav', {timeoutMs: 25});
    const assertion = expect(loading).rejects.toThrow(/Timed out.*25ms/);
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it('times out a body-less response whose arrayBuffer promise ignores cancellation', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        body: null,
        arrayBuffer: () => new Promise<ArrayBuffer>(() => {}),
      })),
    );

    const loading = loadClipFromUrl('https://example.test/stuck.wav', {
      timeoutMs: 25,
    });
    const assertion = expect(loading).rejects.toThrow(/Timed out.*25ms/);
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it('rejects timer-overflow values before starting a request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      loadClipFromUrl('https://example.test/audio.wav', {
        timeoutMs: 2_147_483_648,
      }),
    ).rejects.toThrow(/2147483647/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates duck-typed AudioBuffer dimensions before allocating or copying', async () => {
    const getChannelData = vi.fn(() => new Float32Array(1));
    const tooManyChannels = {
      sampleRate: 8_000,
      numberOfChannels: 1_000_000_000,
      length: 1,
      getChannelData,
    } as unknown as AudioBuffer;
    await expect(loadClip(tooManyChannels, {maxChannels: 2})).rejects.toThrow(/maxChannels/);
    expect(getChannelData).not.toHaveBeenCalled();

    const dishonestLength = {
      sampleRate: 8_000,
      numberOfChannels: 1,
      length: 1,
      getChannelData: () => new Float32Array(10),
    } as unknown as AudioBuffer;
    await expect(loadClip(dishonestLength, {maxDecodedFrames: 4})).rejects.toThrow(/buffer\.length/);
  });
});
