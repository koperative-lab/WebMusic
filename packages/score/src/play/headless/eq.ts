/** One peaking equalizer band. */
export interface EqBand {
  /** Centre frequency in Hz. */
  frequency: number;
  /** Gain in dB. Defaults to 0. */
  gain?: number;
  /** Quality factor. Defaults to 1. */
  q?: number;
}

export interface EqResponsePoint {
  /** Normalized logarithmic frequency position. */
  x: number;
  /** Summed response in decibels. */
  gain: number;
}

export interface EqControllerState {
  bands: EqBand[];
  response: EqResponsePoint[];
  ready: boolean;
}

export interface EqControllerOptions {
  context?: AudioContext;
  bands?: readonly EqBand[];
}

export const EQ_MIN_FREQUENCY = 30;
export const EQ_MAX_FREQUENCY = 18_000;
export const EQ_MAX_GAIN = 18;
export const EQ_RESPONSE_SAMPLES = 64;

export const DEFAULT_EQ_BANDS: readonly EqBand[] = [
  {frequency: 120, gain: 0, q: 0.8},
  {frequency: 1_000, gain: 0, q: 0.9},
  {frequency: 6_000, gain: 0, q: 0.9},
];

interface EqGraph {
  input: GainNode;
  output: GainNode;
  filters: BiquadFilterNode[];
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return Math.max(minimum, Math.min(maximum, finite(value, fallback)));
}

function normalizeBand(band: EqBand): EqBand {
  return {
    frequency: clamp(
      band.frequency,
      EQ_MIN_FREQUENCY,
      EQ_MAX_FREQUENCY,
      EQ_MIN_FREQUENCY,
    ),
    gain: clamp(band.gain, -EQ_MAX_GAIN, EQ_MAX_GAIN, 0),
    q: Math.max(Number.EPSILON, finite(band.q, 1)),
  };
}

function normalizeBands(bands: readonly EqBand[] | undefined): EqBand[] {
  return (bands ?? DEFAULT_EQ_BANDS).map(normalizeBand);
}

function disconnectGraph(graph: EqGraph | undefined): void {
  if (!graph) return;
  const nodes: AudioNode[] = [graph.input, ...graph.filters, graph.output];
  let firstError: unknown;
  let failed = false;
  for (const node of nodes) {
    try {
      node.disconnect();
    } catch (error) {
      if (!failed) {
        failed = true;
        firstError = error;
      }
    }
  }
  if (failed) throw firstError;
}

function buildGraph(context: AudioContext, bands: readonly EqBand[]): EqGraph {
  let input: GainNode | undefined;
  let output: GainNode | undefined;
  const filters: BiquadFilterNode[] = [];
  try {
    input = context.createGain();
    output = context.createGain();
    let previous: AudioNode = input;
    for (const band of bands) {
      const filter = context.createBiquadFilter();
      filters.push(filter);
      filter.type = 'peaking';
      filter.frequency.value = band.frequency;
      filter.gain.value = band.gain ?? 0;
      filter.Q.value = band.q ?? 1;
      previous.connect(filter);
      previous = filter;
    }
    previous.connect(output);
    return {input, output, filters};
  } catch (error) {
    if (input && output) {
      try {
        disconnectGraph({input, output, filters});
      } catch {
        // Preserve the construction error after best-effort rollback.
      }
    } else {
      for (const filter of filters) {
        try {
          filter.disconnect();
        } catch {
          // Preserve the construction error.
        }
      }
      try {
        input?.disconnect();
      } catch {
        // Preserve the construction error.
      }
      try {
        output?.disconnect();
      } catch {
        // Preserve the construction error.
      }
    }
    throw error;
  }
}

/** Convert a frequency to a normalized logarithmic X coordinate. */
export function eqFrequencyToX(frequency: number): number {
  const value = clamp(
    frequency,
    EQ_MIN_FREQUENCY,
    EQ_MAX_FREQUENCY,
    EQ_MIN_FREQUENCY,
  );
  return (
    Math.log2(value / EQ_MIN_FREQUENCY) /
    Math.log2(EQ_MAX_FREQUENCY / EQ_MIN_FREQUENCY)
  );
}

/** Convert a normalized logarithmic X coordinate to frequency. */
export function eqXToFrequency(x: number): number {
  const position = clamp(x, 0, 1, 0);
  return (
    EQ_MIN_FREQUENCY *
    Math.pow(EQ_MAX_FREQUENCY / EQ_MIN_FREQUENCY, position)
  );
}

/** Convert a normalized top-to-bottom Y coordinate to gain in dB. */
export function eqYToGain(y: number): number {
  return -(clamp(y, 0, 1, 0.5) - 0.5) * 2 * EQ_MAX_GAIN;
}

/** Convert gain in dB to a normalized top-to-bottom Y coordinate. */
export function eqGainToY(gain: number): number {
  return 0.5 - clamp(gain, -EQ_MAX_GAIN, EQ_MAX_GAIN, 0) / (2 * EQ_MAX_GAIN);
}

/**
 * DOM-free equalizer graph and response controller.
 *
 * The AudioContext is borrowed and is never closed. The controller owns only
 * the Gain/Biquad nodes that it creates and disconnects them on replacement or
 * disposal. Graph rebuilds are transactional: a failed replacement leaves the
 * previous graph and state usable.
 */
export class EqController {
  private contextValue?: AudioContext;
  private bandsValue: EqBand[];
  private graph?: EqGraph;
  private readonly subscribers = new Set<() => void>();
  private destroyed = false;

  constructor(options: EqControllerOptions = {}) {
    this.bandsValue = normalizeBands(options.bands);
    if (options.context) this.replaceGraph(options.context, this.bandsValue);
  }

  get context(): AudioContext | undefined {
    return this.contextValue;
  }

  get input(): AudioNode | undefined {
    return this.graph?.input;
  }

  get output(): AudioNode | undefined {
    return this.graph?.output;
  }

  snapshot(): EqControllerState {
    return {
      bands: this.bandsValue.map((band) => ({...band})),
      response: this.sampleResponse(),
      ready: Boolean(this.graph),
    };
  }

  subscribe(notify: () => void): () => void {
    if (this.destroyed) return () => undefined;
    this.subscribers.add(notify);
    return () => this.subscribers.delete(notify);
  }

  setContext(context: AudioContext | undefined): void {
    if (this.destroyed || context === this.contextValue) return;
    if (!context) {
      const previous = this.graph;
      this.contextValue = undefined;
      this.graph = undefined;
      try {
        disconnectGraph(previous);
      } finally {
        this.emit();
      }
      return;
    }
    this.replaceGraph(context, this.bandsValue);
  }

  setBands(bands: readonly EqBand[] | undefined): void {
    if (this.destroyed) return;
    const next = normalizeBands(bands);
    if (this.contextValue) this.replaceGraph(this.contextValue, next);
    else {
      this.bandsValue = next;
      this.emit();
    }
  }

  setBand(index: number, band: Partial<EqBand>): void {
    if (this.destroyed || !Number.isInteger(index)) return;
    const previous = this.bandsValue[index];
    if (!previous) return;
    const next = normalizeBand({...previous, ...band});
    const filter = this.graph?.filters[index];
    if (filter) {
      const previousFrequency = filter.frequency.value;
      const previousGain = filter.gain.value;
      const previousQ = filter.Q.value;
      try {
        filter.frequency.value = next.frequency;
        filter.gain.value = next.gain ?? 0;
        filter.Q.value = next.q ?? 1;
      } catch (error) {
        try {
          filter.frequency.value = previousFrequency;
          filter.gain.value = previousGain;
          filter.Q.value = previousQ;
        } catch {
          // Preserve the original parameter-write failure.
        }
        throw error;
      }
    }
    this.bandsValue[index] = next;
    this.emit();
  }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const graph = this.graph;
    this.graph = undefined;
    this.contextValue = undefined;
    this.subscribers.clear();
    disconnectGraph(graph);
  }

  destroy(): void {
    this.dispose();
  }

  private replaceGraph(context: AudioContext, bands: readonly EqBand[]): void {
    const nextBands = normalizeBands(bands);
    const nextGraph = buildGraph(context, nextBands);
    const previous = this.graph;
    this.contextValue = context;
    this.bandsValue = nextBands;
    this.graph = nextGraph;
    try {
      disconnectGraph(previous);
    } finally {
      this.emit();
    }
  }

  private sampleResponse(): EqResponsePoint[] {
    const filters = this.graph?.filters;
    if (!filters || filters.length === 0) return [];
    // Web Audio returns NaN outside [0, sampleRate / 2]. Keep the public
    // logarithmic axis fixed, omitting samples beyond the context's Nyquist
    // frequency instead of inventing a response for inaudible frequencies.
    const nyquist = (this.contextValue?.sampleRate ?? 2 * EQ_MAX_FREQUENCY) / 2;
    const frequencies = Float32Array.from(
      {length: EQ_RESPONSE_SAMPLES},
      (_, index) => eqXToFrequency(index / (EQ_RESPONSE_SAMPLES - 1)),
    ).filter((frequency) => frequency <= nyquist);
    if (frequencies.length === 0) return [];
    const totalGain = new Float32Array(frequencies.length);
    const magnitude = new Float32Array(frequencies.length);
    const phase = new Float32Array(frequencies.length);
    for (const filter of filters) {
      filter.getFrequencyResponse(frequencies, magnitude, phase);
      for (let index = 0; index < frequencies.length; index += 1) {
        totalGain[index] += 20 * Math.log10(Math.max(1e-6, magnitude[index]));
      }
    }
    return Array.from(totalGain, (gain, index) => ({
      x: index / (EQ_RESPONSE_SAMPLES - 1),
      gain,
    }));
  }

  private emit(): void {
    for (const notify of [...this.subscribers]) {
      if (this.destroyed || !this.subscribers.has(notify)) continue;
      notify();
    }
  }
}

export function createEqController(options: EqControllerOptions = {}): EqController {
  return new EqController(options);
}
