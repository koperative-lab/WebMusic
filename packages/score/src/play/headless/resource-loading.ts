/** Minimal response surface accepted by resource loaders and test injectors. */
export const DEFAULT_MAX_SOUNDFONT_BYTES = 128 * 1024 * 1024;

export interface BinaryResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers?: { get?(name: string): string | null };
  readonly body?: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Validate every externally configurable resource limit consistently. */
export function positiveSafeIntegerOption(
  scope: string,
  name: string,
  value: number | undefined,
  fallback: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new RangeError(
      `${scope} option ${name} must be a positive safe integer`,
    );
  }
  return resolved;
}

/** Estimate retained planar Float32 PCM bytes without touching channel data. */
export function decodedAudioByteLength(
  buffer: Pick<AudioBuffer, "length" | "numberOfChannels">,
  label: string,
): number {
  const bytes =
    buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new RangeError(`${label}: decoded sample size is invalid`);
  }
  return bytes;
}

export function throwIfResourceAborted(
  signal: AbortSignal | undefined,
  fallbackMessage: string,
): void {
  if (!signal?.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  const error = new Error(fallbackMessage);
  error.name = "AbortError";
  throw error;
}

/**
 * Read an untrusted response with a declared-size preflight and an incremental
 * cap. Responses from simple dependency injectors may omit headers/body and
 * only expose arrayBuffer(); that compatibility path is checked immediately
 * after the body resolves.
 */
export async function readBoundedResponse(
  response: BinaryResponseLike,
  maxBytes: number,
  label: string,
  limitName: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  positiveSafeIntegerOption(label, limitName, maxBytes, maxBytes);
  throwIfResourceAborted(signal, `${label} was aborted`);
  const declaredText = response.headers?.get?.("content-length");
  if (declaredText != null) {
    const declared = Number(declaredText);
    if (Number.isFinite(declared) && declared > maxBytes) {
      cancelBinaryResponseBody(response.body, `${limitName} exceeded`);
      throw new RangeError(
        `${label} exceeds ${limitName} (${maxBytes.toLocaleString()} bytes)`,
      );
    }
  }

  if (!response.body) {
    const source = await raceWithResourceAbort(
      response.arrayBuffer(),
      signal,
      `${label} was aborted`,
    );
    throwIfResourceAborted(signal, `${label} was aborted`);
    if (source.byteLength > maxBytes) {
      throw new RangeError(
        `${label} exceeds ${limitName} (${maxBytes.toLocaleString()} bytes)`,
      );
    }
    return source;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onAbort = (): void => {
    try {
      void Promise.resolve(reader.cancel(signal?.reason)).catch(() => {});
    } catch {
      // Cancellation is best-effort; the abort race below still rejects.
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      throwIfResourceAborted(signal, `${label} was aborted`);
      const { done, value } = await raceWithResourceAbort(
        reader.read(),
        signal,
        `${label} was aborted`,
      );
      throwIfResourceAborted(signal, `${label} was aborted`);
      if (done) break;
      const nextTotal = total + value.byteLength;
      if (!Number.isSafeInteger(nextTotal) || nextTotal > maxBytes) {
        try {
          void Promise.resolve(reader.cancel(`${limitName} exceeded`)).catch(
            () => {},
          );
        } catch {
          // Preserve the useful limit error when a polyfill throws on cancel.
        }
        throw new RangeError(
          `${label} exceeds ${limitName} (${maxBytes.toLocaleString()} bytes)`,
        );
      }
      total = nextTotal;
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* a cancelled reader may already have released its lock */
    }
  }

  const source = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    source.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return source.buffer;
}

/** Reject an awaited resource promptly even when a stream polyfill ignores cancel(). */
function raceWithResourceAbort<T>(
  task: PromiseLike<T>,
  signal: AbortSignal | undefined,
  fallbackMessage: string,
): Promise<T> {
  if (!signal) return Promise.resolve(task);
  try {
    throwIfResourceAborted(signal, fallbackMessage);
  } catch (error) {
    return Promise.reject(error);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      try {
        throwIfResourceAborted(signal, fallbackMessage);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(task).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        try {
          throwIfResourceAborted(signal, fallbackMessage);
          resolve(value);
        } catch (error) {
          reject(error);
        }
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Best-effort response cancellation for an HTTP failure or size preflight. */
export function cancelBinaryResponseBody(
  body: ReadableStream<Uint8Array> | null | undefined,
  reason?: unknown,
): void {
  try {
    const cancellation = body?.cancel(reason);
    if (cancellation) void Promise.resolve(cancellation).catch(() => {});
  } catch {
    // Some fetch polyfills throw synchronously when a body is already locked.
  }
}

/** Ordered bounded-concurrency mapper used by sample preloaders. */
export async function mapWithConcurrency<T, Result>(
  values: readonly T[],
  concurrency: number,
  map: (value: T, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await map(values[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}
