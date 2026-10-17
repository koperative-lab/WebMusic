import {InsertChain, type EffectNodes, type InsertChainOptions, type InsertSlot} from './effect-chain';
import {effectGenerationGuards} from './effect-generation-guard';
import {createTickSource, type TickSource, type TickSourceOptions} from './tick';

export interface InsertTransitionOptions {
  /** Linear crossfade in audio seconds. Default 0.02; finite and nonnegative. */
  readonly fadeSeconds?: number;
  /** Stop feeding the outgoing graph, then fade its tail over this duration. Default 0. */
  readonly tailSeconds?: number;
}

export interface TransitionInsertChainOptions extends InsertChainOptions {
  /** Maximum simultaneously retiring generations. Default 8; positive integer. */
  readonly maxRetiring?: number;
  readonly tick?: TickSourceOptions;
}

export interface RetiringInsertChain {
  readonly chain: InsertChain;
  /** Absolute audio-context time; suspension does not consume the tail budget. */
  readonly retireAt: number;
}

interface Ramp {
  readonly start: number;
  readonly end: number;
  readonly from: number;
  readonly to: number;
}

interface Generation {
  readonly chain: InsertChain;
  readonly inlet: GainNode;
  readonly outlet: GainNode;
  readonly edges: Array<{source: AudioNode; destination: AudioNode}>;
  inputRamp: Ramp;
  outputRamp: Ramp;
  retireAt?: number;
  drainingTail?: boolean;
}

let sequence = 0;

/**
 * Explicit whole-generation effect changes with stable external ports. Each
 * replacement builds fresh owned circuits; parameter/CV/automation identities
 * stay with their generation, and are never silently copied to its successor.
 * Ordinary InsertChain edits retain their existing reuse and immediate-cut rules.
 */
export class TransitionInsertChain {
  readonly id: string;
  readonly input: GainNode;
  readonly output: GainNode;
  private active: Generation;
  private previous: Generation[] = [];
  private ticker?: TickSource;
  private readonly maxRetiring: number;
  private serial = 0;
  private graphRevision = 0;
  private ended = false;
  private editing = false;

  constructor(readonly context: BaseAudioContext, private readonly options: TransitionInsertChainOptions = {}) {
    this.id = options.id ?? `transition-insert-${++sequence}`;
    if (!this.id) throw new Error('A TransitionInsertChain requires a nonempty id.');
    this.maxRetiring = options.maxRetiring ?? 8;
    if (!Number.isSafeInteger(this.maxRetiring) || this.maxRetiring < 1) {
      throw new RangeError('maxRetiring must be a positive safe integer.');
    }
    this.input = context.createGain();
    let output: GainNode | undefined;
    try {
      this.output = output = context.createGain();
      this.active = this.build([], 1);
    } catch (error) {
      try { this.input.disconnect(); } catch (cleanupError) { this.report(cleanupError); }
      try { output?.disconnect(); } catch (cleanupError) { this.report(cleanupError); }
      throw error;
    }
  }

  get current(): InsertChain { return this.active.chain; }
  get retiring(): readonly RetiringInsertChain[] {
    return Object.freeze(this.previous.map((generation) => Object.freeze({
      chain: generation.chain, retireAt: generation.retireAt!,
    })));
  }
  get revision(): number { return this.graphRevision; }
  get disposed(): boolean { return this.ended; }

  replace(slots: readonly InsertSlot[], options: InsertTransitionOptions = {}): void {
    this.assertEditable();
    const fade = duration(options.fadeSeconds ?? 0.02, 'fadeSeconds');
    const tail = duration(options.tailSeconds ?? 0, 'tailSeconds');
    let now = this.context.currentTime;
    let retireAt: number;
    if (!Number.isFinite(now) || !Number.isFinite(fade + tail)) throw new RangeError('Transition times must be finite.');
    if (slots.some((slot) => slot.ownership === 'borrowed')) {
      throw new Error('Transition generations require fresh owned effect slots.');
    }
    this.collect();
    this.assertEditable();
    if (fade + tail > 0 && this.previous.length >= this.maxRetiring) {
      throw new Error('The retiring effect generation limit has been reached.');
    }
    this.editing = true;
    const old = this.active;
    const changed: Array<{generation: Generation; input: Ramp; output: Ramp}> = [];
    let candidate: Generation | undefined;
    try {
      candidate = this.build(slots, 0);
      this.assertAlive();
      // Acquire the cleanup driver before modifying the audible generation.
      if (fade + tail > 0) {
        this.ticker ??= createTickSource(this.options.tick);
        this.ticker.start(() => this.collect());
      }
      // Recipe/worker callbacks may take longer than a fade. The commit anchor
      // is chosen only after the silent candidate and cleanup driver are ready.
      now = this.context.currentTime;
      const fadeEnd = now + fade;
      retireAt = fadeEnd + tail;
      if (!Number.isFinite(now) || !Number.isFinite(retireAt)) throw new RangeError('Transition times must be finite.');
      candidate.outputRamp = this.ramp(candidate.outlet.gain, candidate.outputRamp, now, now, fadeEnd, 1);
      // An interrupted crossfade hands off the whole audible mix, not just its
      // newest generation. Keep intentional tails on their existing deadlines.
      const outgoing = [old, ...this.previous.filter((generation) => !generation.drainingTail && generation.retireAt! > now)];
      for (const generation of outgoing) {
        const {inputRamp: input, outputRamp: output} = generation;
        changed.push({generation, input, output});
        if (tail > 0) {
          generation.inputRamp = this.ramp(generation.inlet.gain, input, now, now, fadeEnd, 0);
          generation.outputRamp = this.ramp(generation.outlet.gain, output, now, fadeEnd, retireAt, 0);
        } else {
          generation.outputRamp = this.ramp(generation.outlet.gain, output, now, now, fadeEnd, 0);
          generation.inputRamp = this.ramp(generation.inlet.gain, input, now, fadeEnd, fadeEnd, 0);
        }
      }
      this.assertAlive();
    } catch (error) {
      if (candidate) this.release(candidate);
      if (!this.ended) {
        for (const {generation, input, output} of changed) {
          this.restore(generation.inlet.gain, input, now);
          this.restore(generation.outlet.gain, output, now);
          generation.inputRamp = input;
          generation.outputRamp = output;
        }
      }
      if (!this.previous.length) this.ticker?.stop();
      this.editing = false;
      throw error;
    }
    this.active = candidate;
    for (const {generation} of changed) {
      generation.retireAt = retireAt;
      generation.drainingTail = tail > 0;
    }
    this.previous.push(old);
    this.graphRevision++;
    this.editing = false;
    this.collect();
  }

  /** Release expired generations; useful after deterministic offline rendering. */
  collect(): void {
    if (this.ended || this.editing) return;
    this.editing = true;
    const due = this.previous.filter((generation) => generation.retireAt! <= this.context.currentTime);
    this.previous = this.previous.filter((generation) => !due.includes(generation));
    for (const generation of due) this.release(generation);
    this.editing = false;
    if (!this.previous.length) this.ticker?.stop();
  }

  dispose(): void {
    if (this.ended) return;
    this.ended = true;
    this.graphRevision++;
    try { this.ticker?.dispose(); } catch (error) { this.report(error); }
    const generations = [this.active, ...this.previous];
    this.previous = [];
    for (const generation of generations) this.release(generation);
  }

  private build(slots: readonly InsertSlot[], level: number): Generation {
    const chain = new InsertChain(this.context, {id: `${this.id}/generation-${++this.serial}`, onCleanupError: this.options.onCleanupError});
    let generation: Generation | undefined;
    try {
      generation = {
        chain, inlet: this.context.createGain(), outlet: this.context.createGain(), edges: [],
        inputRamp: {start: this.context.currentTime, end: this.context.currentTime, from: 1, to: 1},
        outputRamp: {start: this.context.currentTime, end: this.context.currentTime, from: level, to: level},
      };
      const owner = generation;
      effectGenerationGuards.set(chain, (nodes) => this.reserved(nodes, owner));
      generation.inlet.gain.value = 1;
      generation.outlet.gain.value = level;
      chain.replace(slots);
      this.assertAlive();
      for (const edge of [
        {source: this.input, destination: generation.inlet},
        {source: generation.inlet, destination: chain.input},
        {source: chain.output, destination: generation.outlet},
        {source: generation.outlet, destination: this.output},
      ]) {
        generation.edges.push(edge);
        edge.source.connect(edge.destination);
        this.assertAlive();
      }
      return generation;
    } catch (error) {
      if (generation) this.release(generation);
      else {
        try { chain.dispose(); } catch (cleanupError) { this.report(cleanupError); }
      }
      throw error;
    }
  }

  private reserved(nodes: EffectNodes, owner: Generation): boolean {
    const touches = (node: AudioNode) => nodes.input === node || nodes.output === node;
    if ([this.input, this.output, owner.inlet, owner.outlet].some(touches)) return true;
    for (const generation of [this.active, ...this.previous]) {
      if (!generation || generation === owner) continue;
      if ([generation.inlet, generation.outlet, generation.chain.input, generation.chain.output].some(touches)) return true;
      for (const instance of generation.chain.instances) {
        if (touches(instance.nodes.input) || touches(instance.nodes.output)) return true;
        const parameters = new Set(Object.values(instance.nodes.params ?? {}));
        if (Object.values(nodes.params ?? {}).some((parameter) => parameters.has(parameter))) return true;
      }
    }
    return false;
  }

  private ramp(parameter: AudioParam, previous: Ramp, now: number, start: number, end: number, to: number): Ramp {
    const from = valueAt(previous, now);
    hold(parameter, from, now);
    if (start > now) parameter.setValueAtTime(from, start);
    if (end > start) parameter.linearRampToValueAtTime(to, end);
    else parameter.setValueAtTime(to, end);
    return {start, end, from, to};
  }

  private restore(parameter: AudioParam, previous: Ramp, now: number): void {
    try {
      hold(parameter, valueAt(previous, now), now);
      if (previous.start > now) parameter.setValueAtTime(previous.from, previous.start);
      if (previous.end > now) {
        if (previous.end > previous.start) parameter.linearRampToValueAtTime(previous.to, previous.end);
        else parameter.setValueAtTime(previous.to, previous.end);
      }
    } catch (error) { this.report(error); }
  }

  private release(generation: Generation): void {
    effectGenerationGuards.delete(generation.chain);
    for (const edge of [...generation.edges].reverse()) {
      try { edge.source.disconnect(edge.destination); } catch (error) { this.report(error); }
    }
    generation.edges.length = 0;
    try { generation.chain.dispose(); } catch (error) { this.report(error); }
  }

  private assertAlive(): void {
    if (this.ended) throw new Error('TransitionInsertChain is disposed.');
  }

  private assertEditable(): void {
    this.assertAlive();
    if (this.editing) throw new Error('TransitionInsertChain edits cannot re-enter graph construction or cleanup.');
  }

  private report(error: unknown): void {
    try { this.options.onCleanupError?.(error); } catch { /* Diagnostics cannot change graph ownership. */ }
  }
}

function valueAt(ramp: Ramp, time: number): number {
  if (time < ramp.start) return ramp.from;
  if (time >= ramp.end) return ramp.to;
  return ramp.from + (ramp.to - ramp.from) * (time - ramp.start) / (ramp.end - ramp.start);
}

function hold(parameter: AudioParam, value: number, time: number): void {
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(time);
  else {
    parameter.cancelScheduledValues(time);
    // Re-establish the truncated linear ramp, including its already elapsed
    // portion in OfflineAudioContext command sequences prepared before render.
    parameter.linearRampToValueAtTime(value, time);
  }
  parameter.setValueAtTime(value, time);
}

function duration(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and nonnegative.`);
  return value;
}
