import type {ReverbOptions} from '../audio-contracts';
import type {
  AnalyserOptions,
  BitcrusherOptions,
  ChorusOptions,
  CompressorOptions,
  DelayOptions,
  DistortionOptions,
  EffectNode,
  EffectRecipe,
  FilterOptions,
  LimiterOptions,
  TremoloOptions,
} from './contracts';

export function buildGainEffect(context: BaseAudioContext, value: number): EffectNode {
  const gain = context.createGain();
  gain.gain.value = value;
  return {input: gain, output: gain, params: {gain: gain.gain}};
}

export function buildPannerEffect(context: BaseAudioContext, pan: number): EffectNode {
  const panner = context.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  return {input: panner, output: panner, params: {pan: panner.pan}};
}

export function buildAnalyserEffect(context: BaseAudioContext, options: AnalyserOptions): EffectNode {
  const analyser = context.createAnalyser();
  if (options.fftSize) analyser.fftSize = options.fftSize;
  if (options.smoothing != null) analyser.smoothingTimeConstant = options.smoothing;
  options.onReady?.(analyser);
  return {input: analyser, output: analyser};
}

export function buildLimiterEffect(context: BaseAudioContext, options: LimiterOptions): EffectNode {
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = options.threshold ?? -3;
  compressor.knee.value = 0;
  compressor.ratio.value = 20;
  compressor.attack.value = 0.002;
  compressor.release.value = options.release ?? 0.1;
  return {
    input: compressor,
    output: compressor,
    params: {threshold: compressor.threshold, ratio: compressor.ratio},
  };
}

export function buildBitcrusherEffect(context: BaseAudioContext, options: BitcrusherOptions): EffectNode {
  const shaper = context.createWaveShaper();
  shaper.curve = makeBitcrushCurve(options.bits ?? 6);
  return {input: shaper, output: shaper};
}

export function buildTremoloEffect(context: BaseAudioContext, options: TremoloOptions): EffectNode {
  const depth = Math.max(0, Math.min(1, options.depth ?? 0.5));
  const vca = context.createGain();
  vca.gain.value = 1 - depth;
  const oscillator = context.createOscillator();
  oscillator.frequency.value = options.frequency ?? 5;
  const modulation = context.createGain();
  modulation.gain.value = depth;
  oscillator.connect(modulation).connect(vca.gain);
  oscillator.start();
  return {
    input: vca,
    output: vca,
    params: {rate: oscillator.frequency, depth: modulation.gain},
    dispose: () => stopOscillator(oscillator),
  };
}

export function buildChorusEffect(context: BaseAudioContext, options: ChorusOptions): EffectNode {
  const input = context.createGain();
  const output = context.createGain();
  const delay = context.createDelay(1);
  delay.delayTime.value = options.delaySeconds ?? 0.025;
  const oscillator = context.createOscillator();
  oscillator.frequency.value = options.frequency ?? 0.8;
  const modulation = context.createGain();
  modulation.gain.value = options.depth ?? 0.005;
  const wet = context.createGain();
  wet.gain.value = options.wet ?? 0.5;

  oscillator.connect(modulation).connect(delay.delayTime);
  input.connect(output);
  input.connect(delay).connect(wet).connect(output);
  oscillator.start();
  return {
    input,
    output,
    params: {rate: oscillator.frequency, depth: modulation.gain, wet: wet.gain},
    dispose: () => stopOscillator(oscillator),
  };
}

export function buildFilterEffect(context: BaseAudioContext, options: FilterOptions): EffectNode {
  const filter = context.createBiquadFilter();
  filter.type = options.type ?? 'lowpass';
  filter.frequency.value = options.frequency ?? 1000;
  filter.Q.value = options.Q ?? 1;
  if (options.gain != null) filter.gain.value = options.gain;
  return {input: filter, output: filter, params: {frequency: filter.frequency, Q: filter.Q}};
}

export function buildDelayEffect(context: BaseAudioContext, options: DelayOptions): EffectNode {
  const seconds = options.delaySeconds ?? 0.25;
  const input = context.createGain();
  const output = context.createGain();
  const delay = context.createDelay(Math.max(1, seconds + 1));
  delay.delayTime.value = seconds;
  const feedback = context.createGain();
  feedback.gain.value = options.feedback ?? 0.3;
  const wet = context.createGain();
  wet.gain.value = options.wet ?? 0.3;
  const dry = context.createGain();
  dry.gain.value = options.dry ?? 1;

  input.connect(dry).connect(output);
  input.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(wet).connect(output);
  return {input, output, params: {time: delay.delayTime, feedback: feedback.gain, wet: wet.gain}};
}

export function buildDistortionEffect(context: BaseAudioContext, options: DistortionOptions): EffectNode {
  const shaper = context.createWaveShaper();
  shaper.curve = makeDistortionCurve(options.amount ?? 0.4);
  shaper.oversample = options.oversample ?? '2x';
  return {input: shaper, output: shaper};
}

export function buildCompressorEffect(context: BaseAudioContext, options: CompressorOptions): EffectNode {
  const compressor = context.createDynamicsCompressor();
  if (options.threshold != null) compressor.threshold.value = options.threshold;
  if (options.knee != null) compressor.knee.value = options.knee;
  if (options.ratio != null) compressor.ratio.value = options.ratio;
  if (options.attack != null) compressor.attack.value = options.attack;
  if (options.release != null) compressor.release.value = options.release;
  return {
    input: compressor,
    output: compressor,
    params: {threshold: compressor.threshold, ratio: compressor.ratio},
  };
}

export function buildReverbEffect(context: BaseAudioContext, options: ReverbOptions): EffectNode {
  const input = context.createGain();
  const output = context.createGain();
  const dry = context.createGain();
  dry.gain.value = options.dry ?? 0.82;
  const wet = context.createGain();
  wet.gain.value = options.wet ?? 0.28;
  const convolver = context.createConvolver();
  convolver.buffer = buildImpulseResponse(context, options);

  input.connect(dry).connect(output);
  input.connect(convolver).connect(wet).connect(output);
  return {input, output, params: {wet: wet.gain, dry: dry.gain}};
}

/** Build and wire several lazy effect recipes in series. */
export function buildEffectChain(context: BaseAudioContext, effects: readonly EffectRecipe[]): EffectNode {
  if (effects.length === 0) return buildGainEffect(context, 1);
  const nodes: EffectNode[] = [];
  const edges: Array<{source: AudioNode; destination: AudioNode}> = [];
  try {
    for (const effect of effects) nodes.push(effect.build(context));
    for (let index = 0; index < nodes.length - 1; index += 1) {
      const edge = {source: nodes[index].output, destination: nodes[index + 1].input};
      // Register the attempted edge first: a custom connect() implementation
      // may commit the route and still throw afterwards.
      edges.push(edge);
      edge.source.connect(edge.destination);
    }
  } catch (error) {
    // Construction is atomic from the caller's perspective. Cleanup failures
    // must not replace the build/connect failure that triggered the rollback.
    rollbackEffectChain(nodes, edges);
    throw error;
  }

  let disposed = false;
  return {
    input: nodes[0].input,
    output: nodes[nodes.length - 1].output,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      let firstError: unknown;

      // Remove chain-owned edges before child disposers can disconnect their
      // whole output nodes. Every step is attempted and the earliest failure
      // remains authoritative.
      for (let index = edges.length - 1; index >= 0; index -= 1) {
        const edge = edges[index];
        try {
          edge.source.disconnect(edge.destination);
        } catch (error) {
          firstError ??= error;
        }
      }
      // Preserve the established first-to-last disposer order, but do not let
      // one broken custom effect prevent every later effect from being freed.
      for (const node of nodes) {
        try {
          node.dispose?.();
        } catch (error) {
          firstError ??= error;
        }
      }

      if (firstError !== undefined) throw firstError;
    },
  };
}

function rollbackEffectChain(
  nodes: readonly EffectNode[],
  edges: ReadonlyArray<{source: AudioNode; destination: AudioNode}>,
): void {
  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const edge = edges[index];
    try {
      edge.source.disconnect(edge.destination);
    } catch {
      // Best-effort rollback; the construction error remains authoritative.
    }
  }
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    try {
      nodes[index].dispose?.();
    } catch {
      // See above.
    }
  }
}

export function makeBitcrushCurve(bits: number) {
  const steps = Math.max(2, Math.pow(2, Math.max(1, Math.min(16, bits))));
  const samples = 1024;
  const curve = new Float32Array(new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT));
  for (let index = 0; index < samples; index += 1) {
    const input = (index * 2) / (samples - 1) - 1;
    curve[index] = Math.round(((input + 1) / 2) * (steps - 1)) / (steps - 1) * 2 - 1;
  }
  return curve;
}

export function makeDistortionCurve(amount: number) {
  const strength = amount * 100;
  const samples = 1024;
  const curve = new Float32Array(new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT));
  for (let index = 0; index < samples; index += 1) {
    const input = (index * 2) / (samples - 1) - 1;
    curve[index] = ((3 + strength) * input * 20 * (Math.PI / 180)) /
      (Math.PI + strength * Math.abs(input));
  }
  return curve;
}

function buildImpulseResponse(context: BaseAudioContext, options: ReverbOptions): AudioBuffer {
  const seconds = Math.max(0.1, options.seconds ?? 1.8);
  const decay = Math.max(0.1, options.decay ?? 2.2);
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const progress = index / length;
      data[index] = (Math.random() * 2 - 1) * Math.pow(1 - progress, decay);
    }
  }
  return impulse;
}

function stopOscillator(oscillator: OscillatorNode): void {
  try {
    oscillator.stop();
  } catch {
    // Already stopped or not started.
  }
}
