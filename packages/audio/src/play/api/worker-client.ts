// ============================================================================
// Main-thread client for the decode worker. `createDecoderWorker()` moves
// mp3/flac/ogg/wav decoding off the main thread: the worker decodes and posts
// back deinterleaved float channels (transferred zero-copy), which are cheaply
// wrapped into an AudioClip here. Where Workers don't exist (Node, SSR, very old
// browsers) — or constructing one throws — the client transparently falls back
// to synchronous in-process decoding behind the same Promise API.
// ============================================================================

import {createAudioClip, type AudioClip, type AudioFormat} from '../../core';
import {decodeAudio} from '../core/decode';
import {detectAudioFormat, formatFromExtension} from '../core/format-detect';
import {
  DECODE_WORKER_PROTOCOL,
  DECODE_WORKER_PROTOCOL_VERSION,
  type DecodeRequest,
  type DecodeResponse,
  type DecodeWorkerFormat,
} from '../core/worker-protocol';
import {createRequestTracker, type RequestTracker, type WorkerLike} from '@webmusic/kernel/worker';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  assertDecodedSize,
  assertInputSize,
  fetchAudioBytes,
  timeoutMilliseconds,
  throwIfAborted,
  type AudioResourceLimits,
} from './resource-limits';

// Re-export the same local binding so the emitted module performs one kernel
// import instead of a second import solely for the public forwarding seam.
export {createRequestTracker};
export type {RequestTracker, WorkerLike};

/** Decoded payload returned by the worker client before AudioClip assembly. */
export interface DecodedResult {
  sampleRate: number;
  channelData: Float32Array[];
}

export interface DecoderRequestOptions extends AudioResourceLimits {
  /** Worker request timeout in milliseconds. Set to 0 to disable. */
  timeoutMs?: number;
}

export interface DecoderWorkerOptions extends AudioResourceLimits {
  /** Default timeout for worker requests. Set to 0 to disable. */
  requestTimeoutMs?: number;
}

export interface DecodeClipOptions extends DecoderRequestOptions {
  format?: DecodeWorkerFormat;
  sourceUrl?: string;
}

/** Handle returned by {@link createDecoderWorker}. */
export interface DecoderWorker {
  /** Decode audio bytes in the worker, returning float channels. */
  decode(data: ArrayBuffer | Uint8Array, format?: DecodeWorkerFormat, options?: DecoderRequestOptions): Promise<DecodedResult>;
  /** Decode bytes and wrap the result into an immutable AudioClip. */
  decodeClip(data: ArrayBuffer | Uint8Array, options?: DecodeClipOptions): Promise<AudioClip>;
  /** Fetch on the main thread and hand the bytes to the worker as a transferable. */
  decodeFromUrl(url: string, format?: DecodeWorkerFormat, options?: DecoderRequestOptions): Promise<AudioClip>;
  /** Terminate the worker; in-flight requests reject. Idempotent. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Request-id correlation (pure, exported for unit tests)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** Resolve the shipped decoder worker for both module and classic-script bundles. */
export function resolveDecoderWorkerUrl(
  moduleUrl?: string,
  classicScriptUrl?: string,
): URL | undefined {
  const base = moduleUrl ?? classicScriptUrl;
  if (!base) return undefined;
  const resolvedBase = new URL(base);
  // A classic CDN/server may expose package exports directly, so the script's
  // observable URL is `.../global` rather than the redirected
  // `.../dist/auto.global.js`. Keep that public-subpath form and resolve the
  // sibling `/worker` export; filesystem-shaped dist URLs still use worker.js.
  if (!moduleUrl && /\/global\/?$/.test(resolvedBase.pathname)) {
    resolvedBase.pathname = resolvedBase.pathname.replace(/\/global\/?$/, '/worker');
    resolvedBase.search = '';
    resolvedBase.hash = '';
    return resolvedBase;
  }
  // Split ESM chunks and compatibility/global entries are emitted at `dist`
  // beside worker.js. Explicit subpath entries are one directory deeper.
  const relative = /\/(?:api|element|headless)\/[^/]*$/.test(resolvedBase.pathname)
    ? '../worker.js'
    : './worker.js';
  return new URL(relative, resolvedBase);
}

let configuredClassicWorkerUrl: URL | undefined;

/**
 * Supply the URL of a classic-script entry before creating the default Worker.
 * The `/auto` element entry calls this while `document.currentScript` is still
 * available; API-only callers can continue to pass a Worker/factory directly.
 */
export function configureDecoderWorkerScriptUrl(scriptUrl?: string): void {
  configuredClassicWorkerUrl = scriptUrl
    ? resolveDecoderWorkerUrl(undefined, scriptUrl)
    : undefined;
}

/**
 * Spawn the bundled decoder module worker via a STATIC `new URL(...)` literal
 * so consumer bundlers (Vite/webpack/Rollup) can detect and bundle the worker
 * asset — runtime-computed URLs are invisible to them and 404 in bundled
 * apps. The unique `decoder-worker.js` filename is re-hosted next to every
 * emitted spawn site by scripts/postbuild-worker-facade.mjs, so the relative
 * URL stays correct wherever esbuild places this module (entry or chunk).
 * Returns undefined where spawning is impossible: no `Worker` global, or the
 * CommonJS build (import.meta.url compiled away).
 */
function spawnBundledDecoderWorker(): WorkerLike | undefined {
  if (typeof Worker === 'undefined' || typeof import.meta.url !== 'string') {
    return undefined;
  }
  try {
    return new Worker(new URL('./decoder-worker.js', import.meta.url), {type: 'module'});
  } catch {
    return undefined;
  }
}

function defaultWorkerFactory(): WorkerLike {
  const bundled = spawnBundledDecoderWorker();
  if (bundled) return bundled;
  // Classic-script (<script src=".../auto.global.js">) consumers have no
  // usable import.meta.url; /auto captured document.currentScript for us.
  if (configuredClassicWorkerUrl && typeof Worker !== 'undefined') {
    return new Worker(configuredClassicWorkerUrl, {type: 'module'});
  }
  throw new Error('Cannot resolve the decoder worker URL; pass a Worker or factory explicitly');
}

function toTransferPayload(data: ArrayBuffer | Uint8Array): {data: ArrayBuffer; transfer: Transferable[]} {
  // Always transfer a private snapshot. Transferring a caller-owned
  // ArrayBuffer would detach it; copying through Uint8Array also handles views
  // backed by SharedArrayBuffer without attempting to transfer shared memory.
  const source = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return {data: copy.buffer, transfer: [copy.buffer]};
}

/**
 * Create a decoder that runs format decoding in a Web Worker, keeping the main
 * thread responsive. Without arguments it resolves the shipped `worker.js`
 * beside the active package bundle; pass a `Worker` instance or factory to
 * override that default (including for custom bundler or hosting layouts).
 * If `Worker` is unavailable (Node / SSR) or construction fails, every call
 * decodes in-process instead — same API, no worker.
 */
export function createDecoderWorker(
  workerOrFactory?: WorkerLike | (() => WorkerLike),
  workerOptions: DecoderWorkerOptions = {},
): DecoderWorker {
  const tracker = createRequestTracker<DecodeResponse & {ok: true}>();
  let worker: WorkerLike | undefined;
  let disposed = false;
  /** Whether we already tried (and failed) to get a worker this session. */
  let fallback = false;
  let messageHandler: ((event: MessageEvent) => void) | null = null;
  let errorHandler: ((event: ErrorEvent) => void) | null = null;

  function obtainWorker(): WorkerLike | undefined {
    if (disposed || fallback || worker) return worker;
    try {
      if (typeof workerOrFactory === 'function') worker = workerOrFactory();
      else if (workerOrFactory) worker = workerOrFactory;
      else if (typeof Worker === 'function') worker = defaultWorkerFactory();
    } catch {
      worker = undefined;
    }
    if (!worker) {
      fallback = true;
      return undefined;
    }
    messageHandler = (event: MessageEvent) => {
      const response = event.data as DecodeResponse;
      if (!response || typeof response.id !== 'number') return;
      if (response.ok) tracker.resolve(response.id, response);
      else tracker.reject(response.id, new Error(response.error));
    };
    errorHandler = (event: ErrorEvent) => {
      tracker.rejectAll(new Error(`Decoder worker failed: ${event.message ?? 'unknown error'}`));
      releaseWorker(true);
      fallback = true;
    };
    worker.addEventListener('message', messageHandler);
    worker.addEventListener('error', errorHandler);
    return worker;
  }

  async function decode(
    data: ArrayBuffer | Uint8Array,
    format?: DecodeWorkerFormat,
    options: DecoderRequestOptions = {},
  ): Promise<DecodedResult> {
    if (disposed) throw new Error('Decoder worker has been disposed');
    const effectiveOptions = {...workerOptions, ...options};
    throwIfAborted(effectiveOptions.signal);
    assertInputSize(data.byteLength, effectiveOptions);
    const timeoutMs = requestTimeout(options.timeoutMs ?? workerOptions.requestTimeoutMs);
    const resolvedFormat = format && format !== 'auto' ? format : undefined;
    const target = obtainWorker();
    if (!target) {
      // No Worker available: decode in-process (blocks, but keeps the API).
      const decoded = await decodeAudio(data, {format: resolvedFormat});
      if (disposed) throw new Error('Decoder worker has been disposed');
      throwIfAborted(effectiveOptions.signal);
      assertDecodedSize(decoded.channelData, effectiveOptions);
      return decoded;
    }
    const {data: payload, transfer} = toTransferPayload(data);
    const {id, promise} = tracker.add();
    const request: DecodeRequest = {
      protocol: DECODE_WORKER_PROTOCOL,
      protocolVersion: DECODE_WORKER_PROTOCOL_VERSION,
      id,
      action: 'decode',
      format: resolvedFormat ?? 'auto',
      data: payload,
    };
    const onAbort = (): void => {
      try {
        throwIfAborted(effectiveOptions.signal);
      } catch (error) {
        tracker.reject(id, error);
      }
    };
    effectiveOptions.signal?.addEventListener('abort', onAbort, {once: true});
    const timer =
      timeoutMs > 0
        ? setTimeout(() => tracker.reject(id, new Error(`Decoder worker timed out after ${timeoutMs}ms`)), timeoutMs)
        : null;
    try {
      throwIfAborted(effectiveOptions.signal);
      try {
        target.postMessage(request, transfer);
      } catch (error) {
        tracker.reject(id, error);
      }
      const response = await promise;
      if (disposed) throw new Error('Decoder worker has been disposed');
      throwIfAborted(effectiveOptions.signal);
      assertDecodedSize(response.channelData, effectiveOptions);
      return {sampleRate: response.sampleRate, channelData: response.channelData};
    } catch (error) {
      // If setup itself failed (for example an already-aborted signal), ensure
      // the correlation entry cannot remain pending forever.
      tracker.reject(id, error);
      throw error;
    } finally {
      if (timer != null) clearTimeout(timer);
      effectiveOptions.signal?.removeEventListener('abort', onAbort);
    }
  }

  async function decodeClip(data: ArrayBuffer | Uint8Array, options: DecodeClipOptions = {}): Promise<AudioClip> {
    const decoded = await decode(data, options.format, options);
    throwIfAborted(options.signal);
    return createAudioClip({
      sampleRate: decoded.sampleRate,
      channelData: decoded.channelData,
      ...(options.sourceUrl !== undefined ? {sourceUrl: options.sourceUrl} : {}),
    });
  }

  async function decodeFromUrl(
    url: string,
    format?: DecodeWorkerFormat,
    options: DecoderRequestOptions = {},
  ): Promise<AudioClip> {
    const effectiveOptions = {
      ...workerOptions,
      ...options,
      timeoutMs: options.timeoutMs ?? workerOptions.requestTimeoutMs,
    };
    const buffer = await fetchAudioBytes(url, effectiveOptions);
    const hint: AudioFormat | undefined =
      (format && format !== 'auto' ? format : undefined) ?? formatFromExtension(url) ?? detectAudioFormat(buffer);
    return decodeClip(buffer, {...options, format: hint ?? 'auto', sourceUrl: url});
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    tracker.rejectAll(new Error('Decoder worker has been disposed'));
    releaseWorker(true);
  }

  function releaseWorker(terminate: boolean): void {
    const current = worker as
      | (WorkerLike & {
          removeEventListener?: (type: 'message' | 'error', listener: (event: never) => void) => void;
        })
      | undefined;
    if (current && messageHandler) current.removeEventListener?.('message', messageHandler as (event: never) => void);
    if (current && errorHandler) current.removeEventListener?.('error', errorHandler as (event: never) => void);
    try {
      if (terminate) current?.terminate();
    } catch {
      // A crashed or caller-injected Worker may throw during termination; its
      // listeners and local ownership still need to be cleared.
    } finally {
      worker = undefined;
      messageHandler = null;
      errorHandler = null;
    }
  }

  return {decode, decodeClip, decodeFromUrl, dispose};
}

function requestTimeout(value: number | undefined): number {
  return timeoutMilliseconds(value, DEFAULT_REQUEST_TIMEOUT_MS, 'timeoutMs');
}
