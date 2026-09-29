// Internal reusable implementation layer. It is intentionally not exposed as
// a package subpath yet; the public API, headless runtime, worker, and elements
// compose these stateless helpers.

export {parseWav, serializeWav, type DecodedWav, type WavBitDepth} from './wav';
export {decodeAudio, decodeAudioChunked, type DecodedAudio, type DecodeOptions} from './decode';
export {detectAudioFormat, formatFromExtension} from './format-detect';
export {formatTime, parseLoopAttr} from './format';
export {insertEffect, type Effect, type EffectNodes} from './effect';
export {
  handleDecodeRequest,
  transferablesOf,
  type DecodeRequest,
  type DecodeResponse,
  type DecodeWorkerFormat,
} from './worker-protocol';
