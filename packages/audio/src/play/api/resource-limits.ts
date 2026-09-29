/** Conservative defaults for fully-buffered audio operations. */
export const DEFAULT_MAX_INPUT_BYTES = 128 * 1024 * 1024;
export const DEFAULT_MAX_DECODED_FRAMES = 30_000_000;
export const DEFAULT_MAX_DECODED_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MAX_CHANNELS = 32;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface AudioResourceLimits {
  /** Cancellation for fetch and best-effort cancellation around decode. */
  signal?: AbortSignal;
  /** Maximum compressed/input bytes accepted. Default 128 MiB. */
  maxInputBytes?: number;
  /** Maximum frames per decoded channel. Default 30,000,000. */
  maxDecodedFrames?: number;
  /** Maximum decoded PCM bytes across all channels. Default 256 MiB. */
  maxDecodedBytes?: number;
  /** Maximum decoded channel count. Default 32. */
  maxChannels?: number;
}

export interface AudioFetchOptions extends AudioResourceLimits {
  /** Fetch timeout in milliseconds. Set to 0 to disable. Default 30 seconds. */
  timeoutMs?: number;
}

export function maxInputBytes(options: AudioResourceLimits): number {
  return positiveSafeInteger(options.maxInputBytes, DEFAULT_MAX_INPUT_BYTES, 'maxInputBytes');
}

export function maxDecodedFrames(options: AudioResourceLimits): number {
  return positiveSafeInteger(options.maxDecodedFrames, DEFAULT_MAX_DECODED_FRAMES, 'maxDecodedFrames');
}

export function assertInputSize(byteLength: number, options: AudioResourceLimits): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new TypeError('Audio input byteLength must be a non-negative safe integer');
  }
  const limit = maxInputBytes(options);
  if (byteLength > limit) {
    throw new RangeError(`Audio input is ${byteLength} bytes, exceeding maxInputBytes (${limit})`);
  }
}

export function assertDecodedSize(channelData: readonly {length: number}[], options: AudioResourceLimits): void {
  for (const channel of channelData) {
    if (!Number.isSafeInteger(channel.length) || channel.length < 0) {
      throw new TypeError('Decoded audio channel length must be a non-negative safe integer');
    }
  }
  const limit = maxDecodedFrames(options);
  const channelLimit = positiveSafeInteger(options.maxChannels, DEFAULT_MAX_CHANNELS, 'maxChannels');
  const byteLimit = positiveSafeInteger(options.maxDecodedBytes, DEFAULT_MAX_DECODED_BYTES, 'maxDecodedBytes');
  if (channelData.length > channelLimit) {
    throw new RangeError(`Decoded audio has ${channelData.length} channels, exceeding maxChannels (${channelLimit})`);
  }
  const frames = channelData.reduce((largest, channel) => Math.max(largest, channel.length), 0);
  if (frames > limit) {
    throw new RangeError(`Decoded audio has ${frames} frames per channel, exceeding maxDecodedFrames (${limit})`);
  }
  const decodedBytes = channelData.reduce((total, channel) => total + channel.length * Float32Array.BYTES_PER_ELEMENT, 0);
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > byteLimit) {
    throw new RangeError(`Decoded audio requires ${decodedBytes} PCM bytes, exceeding maxDecodedBytes (${byteLimit})`);
  }
}

/** Validate declared AudioBuffer dimensions without allocating per-channel helpers. */
export function assertDecodedDimensions(
  numberOfChannels: number,
  frames: number,
  options: AudioResourceLimits,
): void {
  if (!Number.isSafeInteger(numberOfChannels) || numberOfChannels < 1) {
    throw new TypeError('AudioBuffer numberOfChannels must be a positive safe integer');
  }
  if (!Number.isSafeInteger(frames) || frames < 0) {
    throw new TypeError('AudioBuffer length must be a non-negative safe integer');
  }
  const channelLimit = positiveSafeInteger(options.maxChannels, DEFAULT_MAX_CHANNELS, 'maxChannels');
  if (numberOfChannels > channelLimit) {
    throw new RangeError(
      `Decoded audio has ${numberOfChannels} channels, exceeding maxChannels (${channelLimit})`,
    );
  }
  const frameLimit = maxDecodedFrames(options);
  if (frames > frameLimit) {
    throw new RangeError(
      `Decoded audio has ${frames} frames per channel, exceeding maxDecodedFrames (${frameLimit})`,
    );
  }
  const byteLimit = positiveSafeInteger(
    options.maxDecodedBytes,
    DEFAULT_MAX_DECODED_BYTES,
    'maxDecodedBytes',
  );
  const decodedBytes = numberOfChannels * frames * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > byteLimit) {
    throw new RangeError(
      `Decoded audio requires ${decodedBytes} PCM bytes, exceeding maxDecodedBytes (${byteLimit})`,
    );
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  const error = new Error(reason == null ? 'Audio operation was aborted' : String(reason));
  error.name = 'AbortError';
  throw error;
}

/** Fetch bytes with timeout, cancellation, Content-Length and streamed caps. */
export async function fetchAudioBytes(url: string, options: AudioFetchOptions = {}): Promise<ArrayBuffer> {
  throwIfAborted(options.signal);
  const limit = maxInputBytes(options);
  const timeoutMs = timeoutMilliseconds(options.timeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'timeoutMs');
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, {once: true});
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;

  try {
    const response = await fetch(url, {signal: controller.signal});
    if (!response.ok) {
      cancelResponseBody(response.body, `HTTP ${response.status}`);
      throw new Error(`Failed to load audio from ${url}: ${response.status} ${response.statusText}`);
    }
    const declaredLength = Number(response.headers?.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > limit) {
      cancelResponseBody(response.body, 'maxInputBytes exceeded');
      controller.abort();
      throw new RangeError(`Audio input is ${declaredLength} bytes, exceeding maxInputBytes (${limit})`);
    }
    const buffer = await readResponseWithLimit(response, limit, controller.signal);
    throwIfAborted(options.signal);
    return buffer;
  } catch (error) {
    if (timedOut) throw Object.assign(new Error(`Timed out loading audio from ${url} after ${timeoutMs}ms`), {cause: error});
    throwIfAborted(options.signal);
    throw error;
  } finally {
    if (timer != null) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

async function readResponseWithLimit(response: Response, limit: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  throwIfAborted(signal);
  if (!response.body) {
    const buffer = await raceWithAbort(response.arrayBuffer(), signal);
    throwIfAborted(signal);
    if (buffer.byteLength > limit) {
      throw new RangeError(`Audio input is ${buffer.byteLength} bytes, exceeding maxInputBytes (${limit})`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onAbort = (): void => {
    try {
      void Promise.resolve(reader.cancel(signal?.reason)).catch(() => {});
    } catch {
      /* cancellation is best-effort; the abort race still rejects */
    }
  };
  signal?.addEventListener('abort', onAbort, {once: true});
  try {
    while (true) {
      throwIfAborted(signal);
      const {done, value} = await raceWithAbort(reader.read(), signal);
      throwIfAborted(signal);
      if (done) break;
      const nextTotal = total + value.byteLength;
      if (!Number.isSafeInteger(nextTotal) || nextTotal > limit) {
        try {
          void Promise.resolve(reader.cancel('maxInputBytes exceeded')).catch(() => {});
        } catch {
          /* preserve the useful limit failure */
        }
        throw new RangeError(`Audio input exceeds maxInputBytes (${limit})`);
      }
      total = nextTotal;
      chunks.push(value);
    }
  } catch (error) {
    try {
      void Promise.resolve(reader.cancel(error)).catch(() => {});
    } catch {
      /* stream already closed */
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* a cancelled reader may already have released its lock */
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function positiveSafeInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return resolved;
}

export function timeoutMilliseconds(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > 2_147_483_647) {
    throw new RangeError(`${name} must be a non-negative safe integer no greater than 2147483647`);
  }
  return resolved;
}

function raceWithAbort<T>(task: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(task);
  try {
    throwIfAborted(signal);
  } catch (error) {
    return Promise.reject(error);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener('abort', onAbort, {once: true});
    Promise.resolve(task).then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        try {
          throwIfAborted(signal);
          resolve(value);
        } catch (error) {
          reject(error);
        }
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function cancelResponseBody(body: ReadableStream<Uint8Array> | null | undefined, reason?: unknown): void {
  try {
    const cancellation = body?.cancel(reason);
    if (cancellation) void Promise.resolve(cancellation).catch(() => {});
  } catch {
    /* cancellation must never replace the HTTP/limit error */
  }
}
