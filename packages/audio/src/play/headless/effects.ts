// ============================================================================
// Effect — composable post-processing inserted between a player's output bus and
// the destination. The contract itself lives in the shared kernel (bundled at
// build time), so a WebScore effect instance can be passed straight to a
// WebAudio player (and vice versa) by construction, while the published
// packages share zero runtime code. Builtins are lazy recipes — they touch no
// AudioContext until the player wires its graph.
// ============================================================================

import type {Effect, EffectNodes} from '../core';

export {insertEffect, type Effect, type EffectNodes} from '../core';

type EffectFactory = (context: BaseAudioContext) => EffectNodes;

export interface GainOptions {
  value?: number;
}
export interface FilterOptions {
  type?: BiquadFilterType;
  frequency?: number;
  Q?: number;
  gain?: number;
}
export interface DelayOptions {
  delaySeconds?: number;
  feedback?: number;
  wet?: number;
  dry?: number;
}
export interface CompressorOptions {
  threshold?: number;
  knee?: number;
  ratio?: number;
  attack?: number;
  release?: number;
}

/** Wrap a factory function as an Effect. The escape hatch / shared internal ctor. */
function makeEffect(factory: EffectFactory, label?: string): Effect {
  return {
    ...(label !== undefined ? {label} : {}),
    createAudioNodes(context: BaseAudioContext): EffectNodes {
      return factory(context);
    },
  };
}

/** Bring your own sub-graph (or a factory). */
export function customEffect(impl: EffectFactory | EffectNodes, label?: string): Effect {
  return makeEffect(typeof impl === 'function' ? impl : () => impl, label);
}

/** A simple gain stage. */
export function gain(options: GainOptions | number = {}): Effect {
  const value = typeof options === 'number' ? options : options.value ?? 1;
  return makeEffect((ctx) => {
    const g = ctx.createGain();
    g.gain.value = value;
    return {input: g, output: g, params: {gain: g.gain}};
  }, 'Gain');
}

/** A biquad filter (lowpass by default). */
export function filter(options: FilterOptions = {}): Effect {
  return makeEffect((ctx) => {
    const f = ctx.createBiquadFilter();
    f.type = options.type ?? 'lowpass';
    f.frequency.value = options.frequency ?? 1000;
    f.Q.value = options.Q ?? 1;
    if (options.gain != null) f.gain.value = options.gain;
    return {input: f, output: f, params: {frequency: f.frequency, Q: f.Q, gain: f.gain}};
  }, 'Filter');
}

/** A feedback delay with wet/dry mix. */
export function delay(options: DelayOptions = {}): Effect {
  return makeEffect((ctx) => {
    const time = options.delaySeconds ?? 0.25;
    const input = ctx.createGain();
    const output = ctx.createGain();
    const node = ctx.createDelay(Math.max(1, time + 1));
    node.delayTime.value = time;
    const feedback = ctx.createGain();
    feedback.gain.value = options.feedback ?? 0.3;
    const wet = ctx.createGain();
    wet.gain.value = options.wet ?? 0.3;
    const dry = ctx.createGain();
    dry.gain.value = options.dry ?? 1;

    input.connect(dry).connect(output);
    input.connect(node);
    node.connect(feedback).connect(node); // feedback loop
    node.connect(wet).connect(output);
    return {input, output, params: {time: node.delayTime, feedback: feedback.gain, wet: wet.gain}};
  }, 'Delay');
}

/** A dynamics compressor. */
export function compressor(options: CompressorOptions = {}): Effect {
  return makeEffect((ctx) => {
    const c = ctx.createDynamicsCompressor();
    if (options.threshold != null) c.threshold.value = options.threshold;
    if (options.knee != null) c.knee.value = options.knee;
    if (options.ratio != null) c.ratio.value = options.ratio;
    if (options.attack != null) c.attack.value = options.attack;
    if (options.release != null) c.release.value = options.release;
    return {input: c, output: c, params: {threshold: c.threshold, ratio: c.ratio}};
  }, 'Compressor');
}

/** Compose several effects in series; nullish entries are skipped. */
export function chainEffects(...effects: Array<Effect | null | undefined>): Effect {
  const list = effects.filter((e): e is Effect => !!e);
  return makeEffect((ctx) => {
    if (list.length === 0) {
      const g = ctx.createGain();
      return {input: g, output: g};
    }
    const nodes = list.map((e) => e.createAudioNodes(ctx));
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].output.connect(nodes[i + 1].input);
    return {
      input: nodes[0].input,
      output: nodes[nodes.length - 1].output,
      dispose: () => {
        for (const n of nodes) n.dispose?.();
      },
    };
  }, 'Chain');
}
