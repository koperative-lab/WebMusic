import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  createRequestTracker,
  createDecoderWorker,
  resolveDecoderWorkerUrl,
  type WorkerLike,
} from '../../src/play/worker-client';
import {DECODE_WORKER_PROTOCOL, DECODE_WORKER_PROTOCOL_VERSION, handleDecodeRequest, transferablesOf, type DecodeRequest, type DecodeResponse} from '../../src/play/core/worker-protocol';
import {serializeWav} from '../../src/play/core/wav';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// RequestTracker — pure id correlation bookkeeping.
// ---------------------------------------------------------------------------

describe('createRequestTracker', () => {
  it('hands out monotonically increasing ids', () => {
    const t = createRequestTracker<number>();
    expect(t.add().id).toBe(0);
    expect(t.add().id).toBe(1);
    expect(t.add().id).toBe(2);
  });

  it('resolves the promise correlated to its id', async () => {
    const t = createRequestTracker<string>();
    const a = t.add();
    const b = t.add();
    expect(t.size).toBe(2);
    expect(t.resolve(b.id, 'B')).toBe(true);
    expect(t.resolve(a.id, 'A')).toBe(true);
    await expect(a.promise).resolves.toBe('A');
    await expect(b.promise).resolves.toBe('B');
    expect(t.size).toBe(0);
  });

  it('rejects the promise correlated to its id', async () => {
    const t = createRequestTracker<number>();
    const {id, promise} = t.add();
    const err = new Error('boom');
    expect(t.reject(id, err)).toBe(true);
    await expect(promise).rejects.toBe(err);
  });

  it('returns false when settling an unknown id', () => {
    const t = createRequestTracker<number>();
    expect(t.resolve(999, 1)).toBe(false);
    expect(t.reject(999, new Error('x'))).toBe(false);
  });

  it('settling an id only once (subsequent settles are no-ops)', async () => {
    const t = createRequestTracker<number>();
    const {id, promise} = t.add();
    expect(t.resolve(id, 1)).toBe(true);
    expect(t.resolve(id, 2)).toBe(false); // already settled & removed
    await expect(promise).resolves.toBe(1);
  });

  it('rejectAll empties the registry and rejects every pending request', async () => {
    const t = createRequestTracker<number>();
    const a = t.add();
    const b = t.add();
    const err = new Error('worker crashed');
    t.rejectAll(err);
    expect(t.size).toBe(0);
    await expect(a.promise).rejects.toBe(err);
    await expect(b.promise).rejects.toBe(err);
  });
});

// ---------------------------------------------------------------------------
// handleDecodeRequest — the pure, Node-testable worker handler.
// ---------------------------------------------------------------------------

describe('handleDecodeRequest', () => {
  it('decodes a WAV request into float channels (no AudioContext needed)', async () => {
    const wav = serializeWav([new Float32Array([0, 0.5, -0.5])], 44100, 16);
    const res = await handleDecodeRequest({id: 7, action: 'decode', data: wav});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.id).toBe(7);
      expect(res.sampleRate).toBe(44100);
      expect(res.channelData[0]).toHaveLength(3);
      expect(res.channelData[0][1]).toBeCloseTo(0.5, 4);
    }
  });

  it('echoes the correlation id on success', async () => {
    const wav = serializeWav([new Float32Array([0])], 8000, 16);
    const res = await handleDecodeRequest({id: 42, action: 'decode', data: wav});
    expect(res.id).toBe(42);
  });

  it('returns an error response (never throws) for the wrong action', async () => {
    const res = await handleDecodeRequest({id: 1, action: 'bogus' as 'decode', data: new ArrayBuffer(8)});
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.id).toBe(1);
      expect(res.error).toMatch(/Unsupported action/);
    }
  });

  it('returns an error response when data is not an ArrayBuffer', async () => {
    const res = await handleDecodeRequest({id: 2, action: 'decode', data: 'not-a-buffer' as unknown as ArrayBuffer});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/ArrayBuffer/);
  });

  it('reports a clear error for an unknown format with no context/decoder', async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]).buffer;
    const res = await handleDecodeRequest({id: 3, action: 'decode', data: garbage, format: 'mp3'});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/mpg123-decoder|decoder|peer/i);
  });
});

describe('transferablesOf', () => {
  it('collects each distinct channel buffer once', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([3, 4]);
    const res: DecodeResponse = {id: 0, ok: true, sampleRate: 44100, channelData: [a, b]};
    const transfer = transferablesOf(res);
    expect(transfer).toHaveLength(2);
    expect(transfer).toContain(a.buffer);
    expect(transfer).toContain(b.buffer);
  });

  it('dedupes channels that view the same underlying buffer', () => {
    const backing = new Float32Array([0, 1, 2, 3]);
    const left = backing.subarray(0, 2);
    const right = backing.subarray(2, 4);
    const res: DecodeResponse = {id: 0, ok: true, sampleRate: 44100, channelData: [left as Float32Array, right as Float32Array]};
    expect(transferablesOf(res)).toHaveLength(1);
  });

  it('returns no transferables for an error response', () => {
    const res: DecodeResponse = {id: 0, ok: false, error: 'nope'};
    expect(transferablesOf(res)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createDecoderWorker — fallback path + a mock-worker correlation round trip.
// ---------------------------------------------------------------------------

/** A fake Worker that runs the real handler synchronously and posts back. */
function mockWorker(): WorkerLike & {dispatchError(message: string): void} {
  let onMessage: ((event: MessageEvent) => void) | null = null;
  let onError: ((event: ErrorEvent) => void) | null = null;
  return {
    postMessage(message: unknown) {
      const req = message as DecodeRequest;
      void handleDecodeRequest(req).then((response) => {
        onMessage?.({data: response} as MessageEvent);
      });
    },
    terminate() {},
    addEventListener(type: 'message' | 'error', listener: (event: never) => void) {
      if (type === 'message') onMessage = listener as (event: MessageEvent) => void;
      else onError = listener as (event: ErrorEvent) => void;
    },
    dispatchError(message: string) {
      onError?.({message} as ErrorEvent);
    },
  };
}

describe('createDecoderWorker', () => {
  it('falls back to in-process decoding when no Worker is available', async () => {
    // No worker passed and (in Node) no global Worker → in-process decode.
    const dw = createDecoderWorker();
    const wav = serializeWav([new Float32Array([0.25, -0.25])], 22050, 16);
    const decoded = await dw.decode(wav);
    expect(decoded.sampleRate).toBe(22050);
    expect(decoded.channelData[0]).toHaveLength(2);
    dw.dispose();
  });

  it('routes a decode through a mock worker and correlates the response', async () => {
    const dw = createDecoderWorker(mockWorker());
    const wav = serializeWav([new Float32Array([0, 1, -1])], 48000, 16);
    const decoded = await dw.decode(wav);
    expect(decoded.sampleRate).toBe(48000);
    expect(decoded.channelData[0]).toHaveLength(3);
    dw.dispose();
  });

  it('preserves the caller-supplied Worker factory override', async () => {
    const factory = vi.fn(() => mockWorker());
    const dw = createDecoderWorker(factory);
    expect(factory).not.toHaveBeenCalled();

    const wav = serializeWav([new Float32Array([0])], 8000, 16);
    await expect(dw.decode(wav)).resolves.toMatchObject({sampleRate: 8000});
    expect(factory).toHaveBeenCalledTimes(1);
    dw.dispose();
  });

  it('wraps a worker decode into an AudioClip via decodeClip', async () => {
    const dw = createDecoderWorker(mockWorker());
    const wav = serializeWav([new Float32Array([0, 0.5])], 44100, 16);
    const clip = await dw.decodeClip(wav, {sourceUrl: 'mock://x.wav'});
    expect(clip.sampleRate).toBe(44100);
    expect(clip.length).toBe(2);
    expect(clip.sourceUrl).toBe('mock://x.wav');
    dw.dispose();
  });

  it('rejects in-flight requests after dispose', async () => {
    const dw = createDecoderWorker(mockWorker());
    dw.dispose();
    await expect(dw.decode(new ArrayBuffer(8))).rejects.toThrow(/disposed/);
  });

  it('rejects and cleans up when postMessage throws synchronously', async () => {
    const worker: WorkerLike = {
      postMessage() {
        throw new Error('clone failed');
      },
      terminate() {},
      addEventListener() {},
    };
    const dw = createDecoderWorker(worker);
    await expect(dw.decode(new ArrayBuffer(8))).rejects.toThrow('clone failed');
    dw.dispose();
  });

  it('times out a worker that never responds', async () => {
    vi.useFakeTimers();
    const worker: WorkerLike = {
      postMessage() {},
      terminate() {},
      addEventListener() {},
    };
    const dw = createDecoderWorker(worker);
    const pending = dw.decode(new ArrayBuffer(8), undefined, {timeoutMs: 20});
    const assertion = expect(pending).rejects.toThrow(/timed out.*20ms/i);
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
    dw.dispose();
  });

  it('cancels an in-flight worker request with AbortSignal', async () => {
    const worker: WorkerLike = {
      postMessage() {},
      terminate() {},
      addEventListener() {},
    };
    const controller = new AbortController();
    const dw = createDecoderWorker(worker);
    const pending = dw.decode(new ArrayBuffer(8), undefined, {signal: controller.signal});
    const assertion = expect(pending).rejects.toThrow('cancelled');
    controller.abort(new Error('cancelled'));
    await assertion;
    dw.dispose();
  });

  it('rejects oversized input before posting it to the worker', async () => {
    const postMessage = vi.fn();
    const worker: WorkerLike = {
      postMessage,
      terminate() {},
      addEventListener() {},
    };
    const dw = createDecoderWorker(worker);
    await expect(dw.decode(new ArrayBuffer(8), undefined, {maxInputBytes: 4})).rejects.toThrow(/maxInputBytes/);
    expect(postMessage).not.toHaveBeenCalled();
    dw.dispose();
  });

  it('transfers a private snapshot instead of detaching caller-owned buffers', async () => {
    let posted!: DecodeRequest;
    let transfer!: Transferable[];
    const worker: WorkerLike = {
      postMessage(message, values) {
        posted = message as DecodeRequest;
        transfer = [...(values ?? [])];
      },
      terminate() {},
      addEventListener() {},
    };
    const input = new Uint8Array([1, 2, 3, 4]).buffer;
    const dw = createDecoderWorker(worker);
    const pending = dw.decode(input, undefined, {timeoutMs: 0});

    expect(posted.data).not.toBe(input);
    expect(Array.from(new Uint8Array(posted.data))).toEqual([1, 2, 3, 4]);
    expect(transfer).toEqual([posted.data]);
    expect(input.byteLength).toBe(4);

    dw.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
  });

  it('rejects timer-overflow values before posting a Worker request', async () => {
    const postMessage = vi.fn();
    const worker: WorkerLike = {
      postMessage,
      terminate() {},
      addEventListener() {},
    };
    const dw = createDecoderWorker(worker);

    await expect(dw.decode(new ArrayBuffer(8), undefined, {timeoutMs: 2_147_483_648})).rejects.toThrow(
      /2147483647/,
    );
    expect(postMessage).not.toHaveBeenCalled();
    dw.dispose();
  });

  it('removes worker listeners and rejects pending requests on dispose', async () => {
    const removeEventListener = vi.fn();
    const terminate = vi.fn();
    const worker = {
      postMessage() {},
      terminate,
      addEventListener: vi.fn(),
      removeEventListener,
    } as unknown as WorkerLike;
    const dw = createDecoderWorker(worker);
    const pending = dw.decode(new ArrayBuffer(8), undefined, {timeoutMs: 0});
    const assertion = expect(pending).rejects.toThrow(/disposed/);

    dw.dispose();
    await assertion;
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledTimes(2);
  });
});

describe('decoder worker URL resolution', () => {
  it('resolves worker.js beside each emitted entry format', () => {
    expect(resolveDecoderWorkerUrl('https://cdn.test/pkg/dist/api/worker-client.js')?.href).toBe(
      'https://cdn.test/pkg/dist/worker.js',
    );
    expect(resolveDecoderWorkerUrl('https://cdn.test/pkg/dist/chunk-ABC.js')?.href).toBe(
      'https://cdn.test/pkg/dist/worker.js',
    );
    expect(resolveDecoderWorkerUrl(undefined, 'https://cdn.test/pkg/dist/auto.global.js')?.href).toBe(
      'https://cdn.test/pkg/dist/worker.js',
    );
    expect(resolveDecoderWorkerUrl(undefined, 'https://cdn.test/pkg/dist/worker-client.cjs')?.href).toBe(
      'https://cdn.test/pkg/dist/worker.js',
    );
    expect(resolveDecoderWorkerUrl(undefined, 'https://cdn.test/pkg/dist/element/auto.cjs')?.href).toBe(
      'https://cdn.test/pkg/dist/worker.js',
    );
    expect(resolveDecoderWorkerUrl(undefined, 'https://cdn.test/@webmusic/audio/play@0.1.0/global')?.href).toBe(
      'https://cdn.test/@webmusic/audio/play@0.1.0/worker',
    );
    expect(
      resolveDecoderWorkerUrl(undefined, 'https://cdn.test/@webmusic/audio/play@0.1.0/global/?cache=1')?.href,
    ).toBe('https://cdn.test/@webmusic/audio/play@0.1.0/worker');
    expect(resolveDecoderWorkerUrl()).toBeUndefined();
  });
});

describe('decode worker protocol envelope', () => {
  const bytes = () => new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer;

  it('accepts a request carrying the current protocol header', async () => {
    const response = await handleDecodeRequest({
      protocol: DECODE_WORKER_PROTOCOL,
      protocolVersion: DECODE_WORKER_PROTOCOL_VERSION,
      id: 1,
      action: 'decode',
      data: bytes(),
    });
    // The header passed validation; failure here is a decode error, not a
    // protocol rejection.
    expect(response.id).toBe(1);
    if (!response.ok) expect(response.error).not.toMatch(/protocol/i);
  });

  it('still accepts a legacy request that omits the header', async () => {
    const response = await handleDecodeRequest({
      id: 2,
      action: 'decode',
      data: bytes(),
    });
    expect(response.id).toBe(2);
    if (!response.ok) expect(response.error).not.toMatch(/protocol/i);
  });

  it('rejects a foreign protocol instead of failing as a decode error', async () => {
    const response = await handleDecodeRequest({
      protocol: 'someone-elses-worker',
      protocolVersion: 1,
      id: 3,
      action: 'decode',
      data: bytes(),
    } as never);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toMatch(/Unsupported decode worker protocol/);
  });

  it('rejects a future protocol version', async () => {
    const response = await handleDecodeRequest({
      protocol: DECODE_WORKER_PROTOCOL,
      protocolVersion: 99,
      id: 4,
      action: 'decode',
      data: bytes(),
    } as never);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toMatch(/protocol version 99/);
  });

  it('rejects a half-filled header rather than guessing the sender', async () => {
    const response = await handleDecodeRequest({
      protocol: DECODE_WORKER_PROTOCOL,
      id: 5,
      action: 'decode',
      data: bytes(),
    } as never);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toMatch(/both be present or both be omitted/);
  });
});
