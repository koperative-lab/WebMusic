import type {Score, TimePosition} from '../../core';
import type {ReverbOptions} from './audio-contracts';
import {createWebAudioContext} from '@webmusic/kernel/audio-context';

export function createReverbNode(context: AudioContext, options: ReverbOptions = {}): ConvolverNode {
  const seconds = Math.max(0.1, options.seconds ?? 1.8);
  const decay = Math.max(0.1, options.decay ?? 2.2);
  const rate = context.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const time = index / length;
      data[index] = (Math.random() * 2 - 1) * Math.pow(1 - time, decay);
    }
  }
  const node = context.createConvolver();
  node.buffer = impulse;
  return node;
}

export function createAudioContext(): AudioContext {
  return createWebAudioContext('Web Audio is not available. Pass an existing AudioContext in options.audioContext.');
}

export interface ResolvedAudioGraphContext {
  context: AudioContext;
  destination: AudioNode;
  ownsContext: boolean;
}

/**
 * Reject BaseAudioContext implementations that cannot drive a live graph.
 *
 * `instanceof AudioContext` is deliberately avoided: injected contexts may
 * come from another realm. OfflineAudioContext is identified by its unique
 * `startRendering()` capability instead.
 */
export function assertLiveAudioContext(
  context: BaseAudioContext,
  label = 'AudioContext',
): asserts context is AudioContext {
  if (context.state === 'closed') {
    throw new Error(`${label} is closed and cannot drive live playback.`);
  }
  if (typeof (context as Partial<OfflineAudioContext>).startRendering === 'function') {
    throw new Error(`${label} must be a live AudioContext, not an OfflineAudioContext.`);
  }
}

function closeRejectedOwnedContext(context: AudioContext): void {
  try {
    const closing = context.close?.();
    void (closing as Promise<void> | undefined)?.catch(() => undefined);
  } catch {
    // Construction is already failing. Closing is best-effort because a
    // malformed/closed implementation may reject close() itself.
  }
}

/**
 * Resolve one live Web Audio graph identity before allocating any nodes.
 *
 * An injected destination is itself a context capability. When no explicit
 * context is supplied we borrow `destination.context`; when both are supplied
 * they must be identical. This keeps every graph edge in one BaseAudioContext
 * and prevents a failed cross-context connect from leaking a just-created
 * AudioContext.
 */
export function resolveAudioGraphContext(
  audioContext: AudioContext | undefined,
  destination: AudioNode | undefined,
  createContext: () => AudioContext = createAudioContext,
): ResolvedAudioGraphContext {
  const destinationContext = destination?.context as AudioContext | undefined;
  if (audioContext && destinationContext && destinationContext !== audioContext) {
    throw new Error(
      'audioContext and destination.context must reference the same AudioContext.',
    );
  }
  if (audioContext) {
    assertLiveAudioContext(audioContext, 'audioContext');
    return {
      context: audioContext,
      destination: destination ?? audioContext.destination,
      ownsContext: false,
    };
  }
  if (destinationContext && destination) {
    assertLiveAudioContext(destinationContext, 'destination.context');
    return {context: destinationContext, destination, ownsContext: false};
  }
  const context = createContext();
  try {
    assertLiveAudioContext(context, 'Created AudioContext');
    return {context, destination: context.destination, ownsContext: true};
  } catch (error) {
    closeRejectedOwnedContext(context);
    throw error;
  }
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function locateSecondsCompat(score: Score, seconds: number): TimePosition {
  const tick = score.timeMap.secondsToTick(seconds);
  const measureBeat = score.timeMap.tickToMeasureBeat(tick);
  return {tick, seconds, measure: measureBeat.measure, beat: measureBeat.beat};
}
