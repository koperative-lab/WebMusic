// ============================================================================
// Decode-worker protocol: the message shapes exchanged between the main-thread
// client (`worker-client.ts`) and the worker entry (`worker.ts`), plus the pure
// request handler. Keeping the handler here — free of any worker-global access
// — makes it unit-testable in plain Node. The worker decodes (WAV via pure JS,
// compressed via the WASM peers) and posts back deinterleaved float channels,
// transferred zero-copy.
// ============================================================================

import type {AudioFormat} from '../../core';
import {decodeAudio} from './decode';

/** Stable identity and version for decode Worker messages. */
export const DECODE_WORKER_PROTOCOL = '@webmusic/audio/play/decode-worker' as const;
export const DECODE_WORKER_PROTOCOL_VERSION = 1 as const;

/** Format hint accepted by the decode worker; omitted/`'auto'` sniffs the bytes. */
export type DecodeWorkerFormat = AudioFormat | 'auto';

interface DecodeRequestPayload {
  /** Correlation id chosen by the client; echoed back on the response. */
  id: number;
  action: 'decode';
  /** Optional format hint; omitted or `'auto'` triggers byte sniffing. */
  format?: DecodeWorkerFormat;
  /** Raw audio bytes. The ArrayBuffer may arrive transferred (zero-copy). */
  data: ArrayBuffer;
}

interface LegacyDecodeEnvelope {
  protocol?: never;
  protocolVersion?: never;
}

interface V1DecodeEnvelope {
  protocol: typeof DECODE_WORKER_PROTOCOL;
  protocolVersion: typeof DECODE_WORKER_PROTOCOL_VERSION;
}

/**
 * Request posted to the decode worker. The envelope names the protocol so a
 * stray message from another library, or a client left over from a different
 * release, fails with a protocol error instead of a confusing decode failure —
 * the same header the score family's worker trio carries. Legacy senders omit
 * both fields; v1 requires both, so the public type cannot construct a partial
 * header that the runtime would reject.
 */
export type DecodeRequest = DecodeRequestPayload & (LegacyDecodeEnvelope | V1DecodeEnvelope);

/** Response posted back by the decode worker. Channel buffers are transferred. */
export type DecodeResponse =
  | {id: number; ok: true; sampleRate: number; channelData: Float32Array[]}
  | {id: number; ok: false; error: string};

/**
 * Handle one decode request. Pure: takes a message, returns a response, never
 * throws (decode failures become `{ok: false, error}`) and never touches worker
 * globals — `worker.ts` wires it to `onmessage`.
 */
export async function handleDecodeRequest(msg: DecodeRequest): Promise<DecodeResponse> {
  const id = msg?.id ?? -1;
  try {
    // The worker receives arbitrary postMessage data, so the envelope is read
    // through an untyped view rather than the narrowed request union.
    const envelope = msg as unknown as {protocol?: unknown; protocolVersion?: unknown};
    const hasProtocol = envelope?.protocol !== undefined;
    const hasProtocolVersion = envelope?.protocolVersion !== undefined;
    if (hasProtocol !== hasProtocolVersion) {
      throw new Error(
        'Decode worker protocol and protocolVersion must either both be present or both be omitted for legacy senders',
      );
    }
    if (hasProtocol && envelope.protocol !== DECODE_WORKER_PROTOCOL) {
      throw new Error(`Unsupported decode worker protocol "${String(envelope.protocol)}"`);
    }
    if (hasProtocolVersion && envelope.protocolVersion !== DECODE_WORKER_PROTOCOL_VERSION) {
      throw new Error(
        `Unsupported decode worker protocol version ${String(envelope.protocolVersion)} (expected ${DECODE_WORKER_PROTOCOL_VERSION})`,
      );
    }
    if (msg?.action !== 'decode') {
      throw new Error(`Unsupported action "${String(msg?.action)}" (expected "decode")`);
    }
    if (!(msg.data instanceof ArrayBuffer)) {
      throw new Error('Decode request data must be an ArrayBuffer');
    }
    const format = msg.format && msg.format !== 'auto' ? msg.format : undefined;
    const decoded = await decodeAudio(msg.data, {format});
    return {id, ok: true, sampleRate: decoded.sampleRate, channelData: decoded.channelData};
  } catch (err) {
    return {id, ok: false, error: err instanceof Error ? err.message : String(err)};
  }
}

/** Collect transferable channel buffers from a successful response (zero-copy post). */
export function transferablesOf(response: DecodeResponse): Transferable[] {
  if (!response.ok) return [];
  const seen = new Set<ArrayBufferLike>();
  const transfer: Transferable[] = [];
  for (const ch of response.channelData) {
    const buf = ch.buffer;
    if (!seen.has(buf)) {
      seen.add(buf);
      transfer.push(buf as ArrayBuffer);
    }
  }
  return transfer;
}
