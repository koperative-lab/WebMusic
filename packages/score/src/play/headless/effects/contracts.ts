import type {ReverbOptions} from '../audio-contracts';

import type {EffectNodes} from '@webmusic/kernel/effect';

/** A built effect sub-graph: signal enters `input`, leaves `output`.
 * Alias of the kernel contract's node bundle (structurally identical); the
 * historical score-family name is preserved for the public API. */
export type EffectNode = EffectNodes;

export type EffectFactory = (context: AudioContext) => EffectNode;

export interface EffectRecipe {
  build(context: BaseAudioContext): EffectNode;
}

export interface DelayOptions {
  delaySeconds?: number;
  feedback?: number;
  wet?: number;
  dry?: number;
}

export interface FilterOptions {
  type?: BiquadFilterType;
  frequency?: number;
  Q?: number;
  gain?: number;
}

export interface DistortionOptions {
  amount?: number;
  oversample?: OverSampleType;
}

export interface CompressorOptions {
  threshold?: number;
  knee?: number;
  ratio?: number;
  attack?: number;
  release?: number;
}

export interface LimiterOptions {
  threshold?: number;
  release?: number;
}

export interface AnalyserOptions {
  fftSize?: number;
  smoothing?: number;
  /** Receives the live AnalyserNode for frequency or waveform reads. */
  onReady?: (node: AnalyserNode) => void;
}

export interface BitcrusherOptions {
  /** Bit depth (1–16). Lower values sound crunchier. */
  bits?: number;
}

export interface TremoloOptions {
  frequency?: number;
  /** Modulation depth from 0 to 1. */
  depth?: number;
}

export interface ChorusOptions {
  delaySeconds?: number;
  depth?: number;
  frequency?: number;
  wet?: number;
}

export type {ReverbOptions};
