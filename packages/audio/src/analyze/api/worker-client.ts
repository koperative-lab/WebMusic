// ============================================================================
// Main-thread client for the analysis worker. `createAnalysisWorker()` moves
// peaks / loudness / STFT / tempo off the main thread: register a clip's samples
// once (transferred zero-copy), then `analyze` / `update` by clipId. Where
// Workers don't exist (Node, SSR, very old browsers) — or constructing one
// throws — the client transparently falls back to synchronous in-process
// analysis behind the same Promise API.
// ============================================================================

import type { AudioClip, ClipEditDescriptor } from "../../core";
import {
  analyzeAudioClip,
  type AudioAnalysisOptions,
} from "../core/analyze-clip";
import type { AudioAnalysisResult, AudioAnalysisTask } from "../core/types";
import {
  AUDIO_ANALYSIS_WORKER_PROTOCOL,
  AUDIO_ANALYSIS_WORKER_PROTOCOL_VERSION,
  type AnalyzeWorkerRequest,
  type AnalyzeWorkerResponse,
} from "./worker-protocol";
import {
  createRequestTracker,
  type RequestTracker,
  type WorkerLike as AnalysisWorkerLike,
} from "@webmusic/kernel/worker";

// Forward the already imported bindings. Keeping the import and re-export on
// one seam avoids duplicate external loads in the generated ESM/CommonJS.
export { createRequestTracker };
export type { AnalysisWorkerLike, RequestTracker };

export type AnalysisWorkerFactory = () => AnalysisWorkerLike;

export interface AnalyzeCallOptions extends Omit<
  AudioAnalysisOptions,
  "tasks"
> {
  tasks?: readonly AudioAnalysisTask[];
}

/** Handle returned by {@link createAnalysisWorker}. */
export interface AnalysisWorkerClient {
  /** Register + analyze a clip; subsequent `update`s reuse the registered samples. */
  analyze(
    clip: AudioClip,
    options?: AnalyzeCallOptions,
  ): Promise<AudioAnalysisResult>;
  /** Incrementally re-analyze a registered clip after a list of edits. */
  update(
    clip: AudioClip,
    edits: ClipEditDescriptor[],
  ): Promise<AudioAnalysisResult>;
  /** Drop a clip's cached samples in the worker. */
  release(clip: AudioClip): void;
  /** Terminate the worker; in-flight requests reject. Idempotent. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Request-id correlation (pure, exported for unit tests)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** Resolve the shipped worker for both module and classic-script bundles. */
export function resolveAnalysisWorkerUrl(
  moduleUrl?: string,
  classicScriptUrl?: string,
): URL | undefined {
  const base = moduleUrl ?? classicScriptUrl;
  if (!base) return undefined;
  const resolvedBase = new URL(base);
  // Servers that honor package exports can leave document.currentScript.src
  // at `.../global` even though the response body is dist/auto.global.js.
  // Resolve the matching public Worker subpath in that case; direct dist URLs
  // continue to point at the physical worker.js asset below.
  if (!moduleUrl && /\/global\/?$/.test(resolvedBase.pathname)) {
    resolvedBase.pathname = resolvedBase.pathname.replace(
      /\/global\/?$/,
      "/worker",
    );
    resolvedBase.search = "";
    resolvedBase.hash = "";
    return resolvedBase;
  }
  // Split ESM chunks and compatibility/global entries are emitted at `dist`
  // beside worker.js. Explicit subpath entries are one directory deeper.
  const relative = /\/(?:api|element|headless)\/[^/]*$/.test(
    resolvedBase.pathname,
  )
    ? "../worker.js"
    : "./worker.js";
  return new URL(relative, resolvedBase);
}

let configuredClassicScriptUrl: string | undefined;

/**
 * Supply the URL of a classic-script entry before creating the default Worker.
 * The `/auto` element entry calls this while `document.currentScript` is still
 * available; API-only callers can pass a Worker/factory instead.
 */
export function configureAnalysisWorkerScriptUrl(scriptUrl?: string): void {
  configuredClassicScriptUrl = scriptUrl || undefined;
}

/**
 * Spawn the bundled analysis module worker via a STATIC `new URL(...)` literal
 * so consumer bundlers (Vite/webpack/Rollup) can detect and bundle the worker
 * asset — runtime-computed URLs are invisible to them and 404 in bundled
 * apps. The unique `analysis-worker.js` filename is re-hosted next to every
 * emitted spawn site by scripts/postbuild-worker-facade.mjs, so the relative
 * URL stays correct wherever esbuild places this module (entry or chunk).
 * Returns undefined where spawning is impossible: no `Worker` global, or the
 * CommonJS build (import.meta.url compiled away).
 */
function spawnBundledAnalysisWorker(): AnalysisWorkerLike | undefined {
  if (typeof Worker === "undefined" || typeof import.meta.url !== "string") {
    return undefined;
  }
  try {
    return new Worker(new URL("./analysis-worker.js", import.meta.url), {
      type: "module",
    }) as AnalysisWorkerLike;
  } catch {
    return undefined;
  }
}

function defaultWorkerFactory(): AnalysisWorkerLike {
  const bundled = spawnBundledAnalysisWorker();
  if (bundled) return bundled;
  // Classic-script (<script src=".../auto.global.js">) consumers have no
  // usable import.meta.url; /auto captured document.currentScript for us.
  const classicUrl = resolveAnalysisWorkerUrl(undefined, configuredClassicScriptUrl);
  if (classicUrl && typeof Worker !== "undefined") {
    return new Worker(classicUrl, { type: "module" }) as AnalysisWorkerLike;
  }
  throw new Error(
    "Cannot resolve the analysis worker URL; pass a Worker or factory explicitly",
  );
}

class WorkerBackedClient implements AnalysisWorkerClient {
  readonly #worker: AnalysisWorkerLike;
  readonly #ownsWorker: boolean;
  readonly #tracker = createRequestTracker<AudioAnalysisResult>();
  readonly #registered = new Set<string>();
  #disposed = false;
  #failure: Error | null = null;
  #terminated = false;

  readonly #onMessage = (event: MessageEvent): void => {
    const response = event.data as AnalyzeWorkerResponse;
    if (
      !response ||
      !Number.isSafeInteger((response as { id?: number }).id) ||
      (response.type !== "analyzed" && response.type !== "error")
    ) {
      this.#fail(new Error("Analysis worker returned a malformed response"));
      return;
    }
    const settled =
      response.type === "analyzed"
        ? this.#tracker.resolve(response.id, response.result)
        : this.#tracker.reject(response.id, new Error(response.message));
    if (!settled) {
      this.#fail(
        new Error(`Analysis worker returned unknown request id ${response.id}`),
      );
    }
  };

  readonly #onError = (event: ErrorEvent): void => {
    this.#fail(
      new Error(`Analysis worker failed: ${event.message ?? "unknown error"}`),
    );
  };

  constructor(worker: AnalysisWorkerLike, ownsWorker: boolean) {
    this.#worker = worker;
    this.#ownsWorker = ownsWorker;
    worker.addEventListener("message", this.#onMessage);
    worker.addEventListener("error", this.#onError);
  }

  #ensureRegistered(clip: AudioClip): void {
    if (this.#registered.has(clip.id)) return;
    const channels = clip.channels();
    if (!channels)
      throw new Error("Cannot register a streaming-only clip (no samples)");
    // AudioClip.channels() already returns caller-independent defensive copies,
    // so those copies can be transferred directly without a second full PCM copy.
    const transferChannels = channels;
    const message: AnalyzeWorkerRequest = {
      protocol: AUDIO_ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: AUDIO_ANALYSIS_WORKER_PROTOCOL_VERSION,
      type: "register",
      clipId: clip.id,
      clip: clip.toJSON(),
      channels: transferChannels,
    };
    this.#worker.postMessage(
      message,
      transferChannels.map((c) => c.buffer),
    );
    this.#registered.add(clip.id);
  }

  analyze(
    clip: AudioClip,
    options: AnalyzeCallOptions = {},
  ): Promise<AudioAnalysisResult> {
    const unavailable = this.#unavailableError();
    if (unavailable) return Promise.reject(unavailable);
    try {
      this.#ensureRegistered(clip);
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    const { tasks, ...rest } = options;
    const { id, promise } = this.#tracker.add();
    const message: AnalyzeWorkerRequest = {
      protocol: AUDIO_ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: AUDIO_ANALYSIS_WORKER_PROTOCOL_VERSION,
      type: "analyze",
      id,
      clipId: clip.id,
      tasks,
      options: rest,
    };
    try {
      this.#worker.postMessage(message);
    } catch (error) {
      this.#tracker.reject(id, error);
    }
    return promise;
  }

  update(
    clip: AudioClip,
    edits: ClipEditDescriptor[],
  ): Promise<AudioAnalysisResult> {
    const unavailable = this.#unavailableError();
    if (unavailable) return Promise.reject(unavailable);
    if (!this.#registered.has(clip.id)) {
      return Promise.reject(
        new Error(`Clip "${clip.id}" was never analyzed; call analyze() first`),
      );
    }
    const { id, promise } = this.#tracker.add();
    const message: AnalyzeWorkerRequest = {
      protocol: AUDIO_ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: AUDIO_ANALYSIS_WORKER_PROTOCOL_VERSION,
      type: "update",
      id,
      clipId: clip.id,
      edits,
    };
    try {
      this.#worker.postMessage(message);
    } catch (error) {
      this.#tracker.reject(id, error);
    }
    return promise;
  }

  release(clip: AudioClip): void {
    if (this.#disposed || this.#failure || !this.#registered.has(clip.id))
      return;
    this.#registered.delete(clip.id);
    try {
      this.#worker.postMessage({
        protocol: AUDIO_ANALYSIS_WORKER_PROTOCOL,
        protocolVersion: AUDIO_ANALYSIS_WORKER_PROTOCOL_VERSION,
        type: "release",
        clipId: clip.id,
      } satisfies AnalyzeWorkerRequest);
    } catch (error) {
      this.#fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#tracker.rejectAll(new Error("AnalysisWorkerClient is disposed"));
    this.#registered.clear();
    const removable = this.#worker as AnalysisWorkerLike & {
      removeEventListener?(
        type: "message",
        listener: (event: MessageEvent) => void,
      ): void;
      removeEventListener?(
        type: "error",
        listener: (event: ErrorEvent) => void,
      ): void;
    };
    removable.removeEventListener?.("message", this.#onMessage);
    removable.removeEventListener?.("error", this.#onError);
    this.#terminateOwnedWorker();
  }

  #unavailableError(): Error | null {
    if (this.#disposed) return new Error("AnalysisWorkerClient is disposed");
    return this.#failure;
  }

  #fail(error: Error): void {
    if (this.#disposed || this.#failure) return;
    this.#failure = error;
    this.#registered.clear();
    this.#tracker.rejectAll(error);
    this.#terminateOwnedWorker();
  }

  #terminateOwnedWorker(): void {
    if (!this.#ownsWorker || this.#terminated) return;
    this.#terminated = true;
    try {
      this.#worker.terminate();
    } catch {
      // A crashed Worker may throw during termination.
    }
  }
}

/** In-process fallback: same Promise API, runs synchronously on this thread. */
class InProcessClient implements AnalysisWorkerClient {
  readonly #entries = new Map<
    string,
    { clip: AudioClip; options: AnalyzeCallOptions }
  >();
  #disposed = false;

  async analyze(
    clip: AudioClip,
    options: AnalyzeCallOptions = {},
  ): Promise<AudioAnalysisResult> {
    if (this.#disposed) throw new Error("AnalysisWorkerClient is disposed");
    this.#entries.set(clip.id, { clip, options });
    return analyzeAudioClip(clip, options);
  }

  async update(
    clip: AudioClip,
    edits: ClipEditDescriptor[],
  ): Promise<AudioAnalysisResult> {
    if (this.#disposed) throw new Error("AnalysisWorkerClient is disposed");
    const entry = this.#entries.get(clip.id);
    if (!entry)
      throw new Error(
        `Clip "${clip.id}" was never analyzed; call analyze() first`,
      );
    // Apply edits in-process to derive the edited clip.
    const { createClipEditSession } = await import("../../core");
    const editSession = createClipEditSession(entry.clip);
    for (const edit of edits) applyEditDescriptor(editSession, edit);
    const edited = editSession.apply();
    entry.clip = edited;
    return analyzeAudioClip(edited, entry.options);
  }

  release(clip: AudioClip): void {
    this.#entries.delete(clip.id);
  }

  dispose(): void {
    this.#disposed = true;
    this.#entries.clear();
  }
}

/** Replay one serializable edit descriptor onto a ClipEditSession. */
function applyEditDescriptor(
  session: ReturnType<typeof import("../../core").createClipEditSession>,
  edit: ClipEditDescriptor,
): void {
  switch (edit.op) {
    case "cut":
      session.cut(edit.startSeconds, edit.endSeconds);
      break;
    case "gain":
      session.gain(edit.factor, edit.startSeconds, edit.endSeconds);
      break;
    case "fade":
      if (edit.direction === "in") session.fadeIn(edit.seconds, edit.curve);
      else session.fadeOut(edit.seconds, edit.curve);
      break;
    case "normalize":
      session.normalize(edit.targetPeak);
      break;
    case "reverse":
      session.reverse();
      break;
    case "insertSilence":
      session.insertSilence(edit.atSeconds, edit.seconds);
      break;
  }
}

/**
 * Create a main-thread client for worker-offloaded analysis.
 *
 * - `createAnalysisWorker()` spawns the bundled module worker
 *   (`new Worker(new URL('./worker.js', import.meta.url), {type: 'module'})`).
 * - `createAnalysisWorker(worker)` / `createAnalysisWorker(() => worker)` uses a
 *   caller-supplied Worker (custom bundlers, tests).
 * - When `Worker` is unavailable (Node, SSR) and none was supplied, the client
 *   transparently falls back to in-process analysis behind the same Promise API.
 */
export function createAnalysisWorker(
  workerOrFactory?: AnalysisWorkerLike | AnalysisWorkerFactory,
): AnalysisWorkerClient {
  if (typeof workerOrFactory === "function") {
    return new WorkerBackedClient(workerOrFactory(), true);
  }
  if (workerOrFactory) {
    return new WorkerBackedClient(workerOrFactory, false);
  }
  if (typeof Worker !== "undefined") {
    try {
      return new WorkerBackedClient(defaultWorkerFactory(), true);
    } catch {
      // Fall through to in-process.
    }
  }
  return new InProcessClient();
}
