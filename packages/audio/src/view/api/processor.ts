import {createAudioClipFromOwnedChannels} from '../../core/model/AudioClip';
import {AudioEditError, type AudioRangeProcessor} from '../../core/editing';

/** Length-preserving selected-range processing with no hidden handles, latency or tail. */
export function createAudioRangeProcessor(kind: 'normalize' | 'reverse'): AudioRangeProcessor {
  if (kind !== 'normalize' && kind !== 'reverse') throw new AudioEditError('unsupported-processor', 'Expected normalize or reverse');
  const parameters = (value: unknown): number => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AudioEditError('invalid-command', 'Processor parameters must be an object');
    const object = value as Record<string, unknown>;
    if (Object.keys(object).some(key => kind !== 'normalize' || key !== 'targetPeak')) throw new AudioEditError('invalid-command', 'Unknown processor parameter');
    const peak = object.targetPeak ?? .95;
    if (typeof peak !== 'number' || !Number.isFinite(peak) || peak < 0 || peak > 1) throw new AudioEditError('invalid-command', 'targetPeak must be between 0 and 1');
    return peak;
  };
  return Object.freeze({
    id: kind, version: 1,
    plan(request: Parameters<AudioRangeProcessor['plan']>[0]) {
      parameters(request.parameters);
      return {inputBefore: 0, inputAfter: 0, outputLength: request.rangeLength, latencyFrames: 0, tailFrames: 0};
    },
    async process(input: Parameters<AudioRangeProcessor['process']>[0]) {
      const target = parameters(input.parameters);
      const check = () => {if (input.signal.aborted) throw input.signal.reason ?? Object.assign(new Error('Processing cancelled'), {name:'AbortError'});};
      check();
      const start = input.selectionOffset, length = input.selectionLength;
      const channels = input.channels.map(channel => channel.subarray(start, start + length));
      let peak = 0;
      if (kind === 'normalize') {
        for (let offset = 0; offset < length; offset += 65_536) {
          check();
          const end = Math.min(length, offset + 65_536);
          for (const channel of channels) for (let index = offset; index < end; index++) peak = Math.max(peak, Math.abs(channel[index]));
          // NaN and Infinity propagate through Math.max and leave no meaningful scale.
          if (!Number.isFinite(peak)) throw new AudioEditError('processing-failed', 'Normalize requires finite input samples');
          if (end < length) await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
      }
      const scale = peak > 0 ? target / peak : 1;
      const output = channels.map(() => new Float32Array(length));
      for (let offset = 0; offset < length; offset += 65_536) {
        check();
        const end = Math.min(length, offset + 65_536);
        for (let channel = 0; channel < channels.length; channel++) for (let index = offset; index < end; index++) {
          output[channel][index] = kind === 'reverse' ? channels[channel][length - 1 - index] : channels[channel][index] * scale;
        }
        if (end < length) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      check();
      return createAudioClipFromOwnedChannels({sampleRate: input.sampleRate, channelData: output});
    },
  });
}
