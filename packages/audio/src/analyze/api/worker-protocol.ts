// ============================================================================
// Analysis-worker protocol and its worker-global-free request handler.
//
// The public API owns the wire contract. A caller may inject a headless
// incremental-session factory when creating state; the default factory uses
// the core one-shot runner so importing the API never reaches the stateful
// headless layer.
// ============================================================================

import {
  applyOp,
  clipFromJSON,
  type AudioClip,
  type AudioClipJSON,
  type ClipEditDescriptor,
} from "../../core";
import {
  analyzeAudioClip,
  type AudioAnalysisOptions,
} from "../core/analyze-clip";
import type { AudioAnalysisResult, AudioAnalysisTask } from "../core/types";

/** Register a clip's samples in the worker (channels transferred zero-copy). */
export interface RegisterRequest {
  type: "register";
  clipId: string;
  clip: AudioClipJSON;
  /** Per-channel samples, transferred (their buffers are detached on send). */
  channels: Float32Array[];
}

/** Run analysis on a previously registered clip. */
export interface AnalyzeRequest {
  type: "analyze";
  /** Correlation id chosen by the client; echoed back. */
  id: number;
  clipId: string;
  tasks?: readonly AudioAnalysisTask[];
  options?: Omit<AudioAnalysisOptions, "tasks">;
}

/** Incrementally re-analyze a registered clip after serializable edits. */
export interface UpdateRequest {
  type: "update";
  id: number;
  clipId: string;
  edits: ClipEditDescriptor[];
}

/** Drop a clip's cached samples and session. */
export interface ReleaseRequest {
  type: "release";
  clipId: string;
}

/** Stable identity and version for analysis Worker messages. */
export const AUDIO_ANALYSIS_WORKER_PROTOCOL =
  "@webmusic/audio/analyze/analysis-worker" as const;
export const AUDIO_ANALYSIS_WORKER_PROTOCOL_VERSION = 1 as const;

interface LegacyAnalyzeEnvelope {
  protocol?: never;
  protocolVersion?: never;
}

interface V1AnalyzeEnvelope {
  protocol: typeof AUDIO_ANALYSIS_WORKER_PROTOCOL;
  protocolVersion: typeof AUDIO_ANALYSIS_WORKER_PROTOCOL_VERSION;
}

/**
 * Request posted to the analysis worker. The envelope names the protocol so a
 * stray message from another library, or a client left over from a different
 * release, fails with a protocol error instead of a confusing analysis error —
 * the same header the score family's worker trio carries. Legacy senders omit
 * both fields; v1 requires both, so the public type cannot construct a partial
 * header that the runtime would reject.
 */
export type AnalyzeWorkerRequest =
  (RegisterRequest | AnalyzeRequest | UpdateRequest | ReleaseRequest) &
    (LegacyAnalyzeEnvelope | V1AnalyzeEnvelope);

export type AnalyzeWorkerResponse =
  | { type: "analyzed"; id: number; result: AudioAnalysisResult }
  | { type: "error"; id: number; message: string };

interface AnalysisSessionLike {
  analyze(): Promise<AudioAnalysisResult>;
  update(editedClip: AudioClip): Promise<AudioAnalysisResult>;
}

/** Injection seam used by the Worker runtime to opt into incremental analysis. */
export type AudioAnalysisSessionFactory = (
  clip: AudioClip,
  options?: AudioAnalysisOptions,
) => AnalysisSessionLike;

interface ClipEntry {
  clip: AudioClip;
  session: AnalysisSessionLike | null;
  options: Omit<AudioAnalysisOptions, "tasks">;
  tasks: readonly AudioAnalysisTask[] | undefined;
}

/** Mutable state for {@link handleAnalyzeRequest}. */
export interface AudioWorkerState {
  clips: Map<string, ClipEntry>;
}

const sessionFactories = new WeakMap<
  AudioWorkerState,
  AudioAnalysisSessionFactory
>();
const stateRequestQueues = new WeakMap<
  AudioWorkerState,
  Map<string, Promise<void>>
>();

function createOneShotSession(
  initialClip: AudioClip,
  options: AudioAnalysisOptions = {},
): AnalysisSessionLike {
  let clip = initialClip;
  let cached: AudioAnalysisResult | null = null;
  return {
    async analyze(): Promise<AudioAnalysisResult> {
      cached ??= await analyzeAudioClip(clip, options);
      return cached;
    },
    async update(editedClip: AudioClip): Promise<AudioAnalysisResult> {
      clip = editedClip;
      cached = await analyzeAudioClip(clip, options);
      return cached;
    },
  };
}

/** Create isolated protocol state, optionally backed by an incremental session. */
export function createAnalysisWorkerState(
  sessionFactory: AudioAnalysisSessionFactory = createOneShotSession,
): AudioWorkerState {
  const state: AudioWorkerState = { clips: new Map() };
  sessionFactories.set(state, sessionFactory);
  return state;
}

/** Rebuild an AudioClip from its JSON and registered channel arrays. */
function reviveClip(json: AudioClipJSON, channels: Float32Array[]): AudioClip {
  return clipFromJSON(json, channels);
}

/** Apply serializable edit descriptors to a registered clip. */
function applyEdits(clip: AudioClip, edits: ClipEditDescriptor[]): AudioClip {
  const channels = clip.channels();
  if (!channels) return clip;
  let result = channels;
  for (const edit of edits) result = applyOp(result, clip.sampleRate, edit);
  return clipFromJSON(
    { ...clip.toJSON(), length: result[0]?.length ?? 0 },
    result,
  );
}

/**
 * Clone cache-retained typed arrays before transferring a response. This keeps
 * a headless incremental session's cache attached for subsequent updates.
 */
export function prepareResponseForPost(response: AnalyzeWorkerResponse): {
  message: AnalyzeWorkerResponse;
  transfer: Transferable[];
} {
  if (response.type !== "analyzed") return { message: response, transfer: [] };
  const transfer: Transferable[] = [];
  const copy = <T extends Int8Array | Float32Array>(view: T): T => {
    const out = view.slice() as T;
    if (out.buffer instanceof ArrayBuffer) transfer.push(out.buffer);
    return out;
  };
  const result: AudioAnalysisResult = {
    ...response.result,
    peaks: {
      ...response.result.peaks,
      levels: response.result.peaks.levels.map((level) => ({
        ...level,
        data: copy(level.data),
      })),
    },
    loudness: response.result.loudness.momentary
      ? {
          ...response.result.loudness,
          momentary: copy(response.result.loudness.momentary),
        }
      : response.result.loudness,
  };
  if (response.result.spectrogram) {
    result.spectrogram = {
      ...response.result.spectrogram,
      times: copy(response.result.spectrogram.times),
      frequencies: copy(response.result.spectrogram.frequencies),
      magnitudes: copy(response.result.spectrogram.magnitudes),
    };
  }
  if (response.result.pitchTrack) {
    result.pitchTrack = {
      times: copy(response.result.pitchTrack.times),
      frequencies: copy(response.result.pitchTrack.frequencies),
      confidences: copy(response.result.pitchTrack.confidences),
    };
  }
  return { message: { ...response, result }, transfer };
}

/** Handle one protocol request without accessing Worker globals. */
export async function handleAnalyzeRequest(
  state: AudioWorkerState,
  message: AnalyzeWorkerRequest,
): Promise<AnalyzeWorkerResponse | null> {
  const protocolError = analyzeProtocolError(message);
  if (protocolError) {
    const id = (message as {id?: unknown})?.id;
    return {
      type: "error",
      id: typeof id === "number" ? id : -1,
      message: protocolError,
    };
  }
  return enqueueStateRequest(state, message.clipId, () =>
    handleAnalyzeRequestNow(state, message),
  );
}

/**
 * Validate the protocol envelope. The worker receives arbitrary postMessage
 * data, so the header is read through an untyped view rather than the narrowed
 * request union. Returns an error message, or null when the envelope is
 * acceptable (present and matching, or absent for a legacy sender).
 */
function analyzeProtocolError(message: AnalyzeWorkerRequest): string | null {
  const envelope = message as unknown as {
    protocol?: unknown;
    protocolVersion?: unknown;
  };
  const hasProtocol = envelope?.protocol !== undefined;
  const hasProtocolVersion = envelope?.protocolVersion !== undefined;
  if (hasProtocol !== hasProtocolVersion) {
    return "Analysis worker protocol and protocolVersion must either both be present or both be omitted for legacy senders";
  }
  if (hasProtocol && envelope.protocol !== AUDIO_ANALYSIS_WORKER_PROTOCOL) {
    return `Unsupported analysis worker protocol "${String(envelope.protocol)}"`;
  }
  if (
    hasProtocolVersion &&
    envelope.protocolVersion !== AUDIO_ANALYSIS_WORKER_PROTOCOL_VERSION
  ) {
    return `Unsupported analysis worker protocol version ${String(envelope.protocolVersion)} (expected ${AUDIO_ANALYSIS_WORKER_PROTOCOL_VERSION})`;
  }
  return null;
}

/** Execute one request after earlier requests for the same clip have settled. */
async function handleAnalyzeRequestNow(
  state: AudioWorkerState,
  message: AnalyzeWorkerRequest,
): Promise<AnalyzeWorkerResponse | null> {
  try {
    switch (message.type) {
      case "register": {
        const clip = reviveClip(message.clip, message.channels);
        state.clips.set(message.clipId, {
          clip,
          session: null,
          options: {},
          tasks: undefined,
        });
        return null;
      }
      case "release": {
        state.clips.delete(message.clipId);
        return null;
      }
      case "analyze": {
        const entry = state.clips.get(message.clipId);
        if (!entry)
          throw new Error(`No clip registered for id "${message.clipId}"`);
        entry.options = message.options ?? {};
        entry.tasks = message.tasks;
        const sessionFactory =
          sessionFactories.get(state) ?? createOneShotSession;
        entry.session = sessionFactory(entry.clip, {
          ...entry.options,
          tasks: message.tasks,
        });
        const result = await entry.session.analyze();
        return { type: "analyzed", id: message.id, result };
      }
      case "update": {
        const entry = state.clips.get(message.clipId);
        if (!entry)
          throw new Error(`No clip registered for id "${message.clipId}"`);
        const edited = applyEdits(entry.clip, message.edits);
        if (!entry.session) {
          const sessionFactory =
            sessionFactories.get(state) ?? createOneShotSession;
          entry.session = sessionFactory(entry.clip, {
            ...entry.options,
            tasks: entry.tasks,
          });
          await entry.session.analyze();
        }
        const result = await entry.session.update(edited);
        entry.clip = edited;
        return { type: "analyzed", id: message.id, result };
      }
      default: {
        const exhaustive: never = message;
        void exhaustive;
        throw new Error("Unknown analysis worker request");
      }
    }
  } catch (error) {
    const id = (message as { id?: number }).id ?? -1;
    return {
      type: "error",
      id,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function enqueueStateRequest<Result>(
  state: AudioWorkerState,
  clipId: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  let queues = stateRequestQueues.get(state);
  if (!queues) {
    queues = new Map();
    stateRequestQueues.set(state, queues);
  }
  const previous = queues.get(clipId) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(clipId, tail);
  void tail.then(() => {
    if (queues?.get(clipId) === tail) queues.delete(clipId);
  });
  return result;
}
