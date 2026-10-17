// ============================================================================
// Effect — composable post-processing inserted between a player's output bus and
// the destination. The contract lives in the shared Kernel peer, so a Score
// effect can be passed straight to an Audio player (and vice versa) by shape.
// Builtins are lazy recipes — they touch no
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
function makeEffect(factory: EffectFactory, label?: string, parameterDescriptors?: Effect['parameterDescriptors']): Effect {
  return {
    ...(label !== undefined ? {label} : {}),
    ...(parameterDescriptors !== undefined ? {parameterDescriptors} : {}),
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
  }, 'Gain', {gain: {unit: 'linear-gain', defaultValue: value, displayRange: {min: 0, max: 2}, step: 0.01}});
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
  }, 'Filter', {
    frequency: {unit: 'Hz', defaultValue: options.frequency ?? 1000, displayRange: {min: 20, max: 12_000}, step: 1},
    Q: {unit: !options.type || ['lowpass', 'highpass'].includes(options.type) ? 'dB' : 'ratio', defaultValue: options.Q ?? 1, displayRange: {min: 0.1, max: 20}, step: 0.1},
    gain: {unit: 'dB', defaultValue: options.gain ?? 0, displayRange: {min: -24, max: 24}, step: 0.1},
  });
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

    const edges: EffectEdge[] = [
      [input, dry], [dry, output], [input, node], [node, feedback],
      [feedback, node], [node, wet], [wet, output],
    ];
    const dispose = connectOwnedEdges(edges);
    return {input, output, params: {time: node.delayTime, feedback: feedback.gain, wet: wet.gain, dry: dry.gain}, dispose};
  }, 'Delay', {
    time: {unit: 's', range: {min: 0, max: Math.max(1, (options.delaySeconds ?? 0.25) + 1)}, defaultValue: options.delaySeconds ?? 0.25, displayRange: {min: 0, max: 1}, step: 0.01},
    feedback: {unit: 'linear-gain', defaultValue: options.feedback ?? 0.3, displayRange: {min: 0, max: 0.95}, step: 0.01},
    wet: {unit: 'linear-gain', defaultValue: options.wet ?? 0.3, displayRange: {min: 0, max: 1}, step: 0.01},
    dry: {unit: 'linear-gain', defaultValue: options.dry ?? 1, displayRange: {min: 0, max: 1}, step: 0.01},
  });
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
    return {input: c, output: c, params: {threshold: c.threshold, knee: c.knee, ratio: c.ratio, attack: c.attack, release: c.release}};
  }, 'Compressor', {
    threshold: {unit: 'dB', defaultValue: options.threshold ?? -24, displayRange: {min: -60, max: 0}, step: 0.1},
    knee: {unit: 'dB', defaultValue: options.knee ?? 30, displayRange: {min: 0, max: 40}, step: 0.1},
    ratio: {unit: 'ratio', defaultValue: options.ratio ?? 12, displayRange: {min: 1, max: 20}, step: 0.1},
    attack: {unit: 's', defaultValue: options.attack ?? 0.003, displayRange: {min: 0, max: 1}, step: 0.001},
    release: {unit: 's', defaultValue: options.release ?? 0.25, displayRange: {min: 0, max: 1}, step: 0.01},
  });
}

/** Compose several effects in series; nullish entries are skipped. */
export function chainEffects(...effects: Array<Effect | null | undefined>): Effect {
  const list = effects.filter((e): e is Effect => !!e);
  return makeEffect((ctx) => {
    if (list.length === 0) {
      const g = ctx.createGain();
      return {input: g, output: g};
    }
    const nodes: EffectNodes[] = [];
    let disconnect: (() => void) | undefined;
    try {
      for (const effect of list) nodes.push(effect.createAudioNodes(ctx));
      disconnect = connectOwnedEdges(nodes.slice(0, -1).map((node, index) => [node.output, nodes[index + 1].input]));
    } catch (error) {
      for (const node of [...nodes].reverse()) {
        try { node.dispose?.(); } catch { /* Preserve the construction failure. */ }
      }
      throw error;
    }
    let disposed = false;
    return {
      input: nodes[0].input,
      output: nodes[nodes.length - 1].output,
      params: Object.fromEntries(nodes.flatMap((node, index) =>
        Object.entries(node.params ?? {}).map(([id, parameter]) => [`${index}.${id}`, parameter]),
      )),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        let failure: unknown;
        try { disconnect?.(); } catch (error) { failure = error; }
        for (const node of nodes) {
          try { node.dispose?.(); } catch (error) { failure ??= error; }
        }
        if (failure !== undefined) throw failure;
      },
    };
  }, 'Chain', Object.fromEntries(list.flatMap((effect, index) =>
    Object.entries(effect.parameterDescriptors ?? {}).map(([id, descriptor]) => [`${index}.${id}`, descriptor]),
  )));
}

type EffectEdge = readonly [AudioNode, AudioNode];

/** Own only declared internal edges; preserve unrelated borrowed branches. */
function connectOwnedEdges(edges: readonly EffectEdge[]): () => void {
  const attempted: EffectEdge[] = [];
  try {
    for (const edge of edges) {
      attempted.push(edge);
      edge[0].connect(edge[1]);
    }
  } catch (error) {
    for (const [source, destination] of attempted.reverse()) {
      try { source.disconnect(destination); } catch { /* Preserve the connect failure. */ }
    }
    throw error;
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    let failure: unknown;
    for (const [source, destination] of [...attempted].reverse()) {
      try { source.disconnect(destination); } catch (error) { failure ??= error; }
    }
    if (failure !== undefined) throw failure;
  };
}
