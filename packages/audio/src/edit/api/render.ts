import {createAudioSequence, readAudioSequenceRange, retainAudioSequence,
  type AudioAssetReader, type AudioSequence} from '../../core/sequence';
import {AudioEditError} from '../../core/editing';
import {serializeWav, type WavBitDepth} from '../../core/serialize/wav';

export interface AudioSequenceRenderOptions {
  /** Half-open output range; defaults to the entire explicitly requested sequence. */
  readonly startFrame?: number;
  readonly endFrame?: number;
  /** Total job-owned output allocation cap. Default 256 MiB; export includes PCM and WAV. */
  readonly maxBytes?: number;
  /** Maximum frames read before yielding to cancellation. Default 65,536. */
  readonly chunkFrames?: number;
  readonly signal?: AbortSignal;
}
export interface RenderedAudioSequence {
  readonly sampleRate: number;
  readonly channelLayout: readonly string[];
  /** Caller-owned mutable PCM; changing it cannot change the source assets. */
  readonly channelData: readonly Float32Array[];
}
export interface AudioSequenceWavOptions extends AudioSequenceRenderOptions {
  readonly bitDepth?: WavBitDepth;
  /** Requires bitDepth: 32. Otherwise WAV uses integer PCM. */
  readonly float?: boolean;
}

/** Explicit, bounded materialization; structural edits and playback never call it. */
export async function renderAudioSequence(sequence: AudioSequence, assets: AudioAssetReader,
  options: AudioSequenceRenderOptions = {}): Promise<RenderedAudioSequence> {
  const input = plan(sequence, assets, options);
  return render(input.sequence, assets, input, options.signal);
}

/** Export exactly this immutable root, holding its assets until rendering finishes. */
export async function exportAudioSequenceWav(sequence: AudioSequence, assets: AudioAssetReader,
  options: AudioSequenceWavOptions = {}): Promise<ArrayBuffer> {
  const input = plan(sequence, assets, options);
  const depth = options.bitDepth ?? 16;
  if (![16, 24, 32].includes(depth) || (options.float !== undefined && typeof options.float !== 'boolean') || (options.float && depth !== 32)) {
    throw new AudioEditError('invalid-command', 'WAV requires 16/24/32-bit PCM, or explicitly 32-bit float');
  }
  const channels = input.sequence.channelLayout.length;
  const blockAlign = channels * depth / 8;
  const dataBytes = input.length * blockAlign;
  if (!Number.isSafeInteger(input.sequence.sampleRate) || channels > 65535 || blockAlign > 65535 || input.sequence.sampleRate > 0xffffffff
      || input.sequence.sampleRate * blockAlign > 0xffffffff || dataBytes + 36 > 0xffffffff) {
    throw new AudioEditError('resource-limit', 'Sequence exceeds RIFF/WAV dimensions');
  }
  checkBytes(input.pcmBytes + dataBytes + 44, input.maxBytes);
  const result = await render(input.sequence, assets, input, options.signal);
  aborted(options.signal);
  return serializeWav([...result.channelData], result.sampleRate, depth, {float: options.float});
}

function plan(sequence: AudioSequence, assets: AudioAssetReader, options: AudioSequenceRenderOptions) {
  aborted(options.signal);
  const content = createAudioSequence(sequence, assets);
  const start = options.startFrame ?? 0, end = options.endFrame ?? content.length;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > content.length) {
    throw new AudioEditError('invalid-range', 'Render range must be within the sequence');
  }
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
  const chunkFrames = options.chunkFrames ?? 65_536;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(chunkFrames) || chunkFrames < 1) {
    throw new AudioEditError('invalid-command', 'maxBytes and chunkFrames must be positive safe integers');
  }
  const length = end - start, pcmBytes = length * content.channelLayout.length * 4;
  checkBytes(pcmBytes, maxBytes);
  return {sequence: content, start, length, pcmBytes, maxBytes, chunkFrames};
}

async function render(sequence: AudioSequence, assets: AudioAssetReader,
  input: ReturnType<typeof plan>, signal?: AbortSignal): Promise<RenderedAudioSequence> {
  const lease = retainAudioSequence(sequence, assets);
  try {
    aborted(signal);
    const channels = sequence.channelLayout.map(() => new Float32Array(input.length));
    for (let offset = 0; offset < input.length; offset += input.chunkFrames) {
      aborted(signal);
      const end = Math.min(input.length, offset + input.chunkFrames);
      readAudioSequenceRange(sequence, assets, input.start + offset, channels.map((channel) => channel.subarray(offset, end)));
      // A task boundary permits browser input and AbortSignal delivery between bounded reads.
      if (end < input.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    aborted(signal);
    return Object.freeze({sampleRate: sequence.sampleRate, channelLayout: sequence.channelLayout, channelData: Object.freeze(channels)});
  } finally { lease.release(); }
}
function checkBytes(bytes: number, limit: number): void {
  if (!Number.isSafeInteger(bytes) || bytes > limit) throw new AudioEditError('resource-limit', `Audio job requires ${bytes} bytes, exceeding maxBytes (${limit})`);
}
function aborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw Object.assign(new Error('Audio rendering was cancelled'), {name: 'AbortError'});
}
