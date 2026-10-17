// ============================================================================
// Effect contract shared by both families: an effect is anything with
// `createAudioNodes(context) → {input, output}`. Canonical source is
// @webaudio/play's shape — `BaseAudioContext` keeps it offline-render capable.
// @webscore/play's Effect class adds a `createAudioNodes` method to satisfy it
// structurally. InsertChain supplies shared transactional routing while recipes
// keep ownership of their internal DSP and optional cleanup.
// ============================================================================

import {ParamHandle, ParamSurface, type ParamDescriptor} from './module/parameter';
import {effectGenerationGuards} from './effect-generation-guard';


/** A built effect sub-graph: signal enters `input`, leaves `output`. */
export interface EffectNodes {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** Live, adjustable parameters (e.g. `frequency`, `wet`) for real-time control. */
  params?: Record<string, AudioParam>;
  dispose?(): void;
}

/**
 * The structural Effect contract. The single method `createAudioNodes` lets
 * effects cross between the families by shape alone.
 */
export interface Effect {
  /** Optional label — UIs can caption controls with it. */
  label?: string;
  /** Real parameter units/ranges supplied by the recipe, never guessed by a UI. */
  parameterDescriptors?: Readonly<Record<string, Partial<Omit<ParamDescriptor, 'id'>>>>;
  /**
   * Realize a fresh graph for each call; sharing a recipe does not share nodes.
   * InsertChain also accepts its exact active-slot bundle as an alias, or an
   * explicitly borrowed slot whose graph remains owned by the caller.
   */
  createAudioNodes(context: BaseAudioContext): EffectNodes;
}

export interface InsertSlot {
  readonly id: string;
  readonly recipe: Effect;
  /** Borrowed bundles are never disposed by this chain. */
  readonly ownership?: 'owned' | 'borrowed';
  readonly parameterDescriptors?: Effect['parameterDescriptors'];
}

export interface EffectInstance {
  /** Stable realization identity; a slot replacement receives a new identity. */
  readonly id: string;
  readonly slotId: string;
  readonly recipe: Effect;
  readonly nodes: EffectNodes;
  readonly params: ParamSurface;
  readonly ownership: 'owned' | 'borrowed';
}

export interface InsertChainOptions {
  readonly id?: string;
  /** Retirement errors occur after commit and cannot invalidate the new graph. */
  readonly onCleanupError?: (error: unknown) => void;
}

interface Edge {readonly source: AudioNode; readonly destination: AudioNode}

export const COMPATIBILITY_EFFECT_SLOT = '$compat';
let chainSequence = 0;

/**
 * An ordered insert graph with stable ports in either a live or offline context.
 * Logical replacement is transactional; Web Audio does not promise a hardware
 * atomic switch or a crossfade. Callers own connections outside these ports.
 */
export class InsertChain {
  readonly id: string;
  readonly input: GainNode;
  readonly output: GainNode;
  private explicitSlots: readonly InsertSlot[] = Object.freeze([]);
  private compatibility?: InsertSlot;
  private active: readonly EffectInstance[] = Object.freeze([]);
  private edges: readonly Edge[];
  private graphRevision = 0;
  private ended = false;
  private editing = false;
  private sequence = 0;
  private readonly listeners = new Set<{listener: (chain: InsertChain) => void}>();

  constructor(readonly context: BaseAudioContext, private readonly options: InsertChainOptions = {}) {
    this.id = options.id ?? `insert-chain-${++chainSequence}`;
    if (!this.id) throw new Error('An InsertChain requires a nonempty id.');
    this.input = context.createGain();
    this.output = context.createGain();
    const edge = {source: this.input, destination: this.output};
    try { edge.source.connect(edge.destination); } catch (error) {
      try { edge.source.disconnect(edge.destination); } catch { /* Preserve construction failure. */ }
      throw error;
    }
    this.edges = [edge];
  }

  get slots(): readonly InsertSlot[] { return this.explicitSlots; }
  get instances(): readonly EffectInstance[] { return this.active; }
  get revision(): number { return this.graphRevision; }
  get disposed(): boolean { return this.ended; }

  /** Replace explicit slots only; the legacy compatibility slot remains first. */
  replace(slots: readonly InsertSlot[]): void {
    this.assertEditable();
    if (slots.some((slot) => slot.id === COMPATIBILITY_EFFECT_SLOT)) {
      throw new Error('The compatibility slot is managed by setCompatibility().');
    }
    this.update(slots, this.compatibility);
  }

  /** Add a slot or update it in place without reordering other declarations. */
  setSlot(slot: InsertSlot): void {
    const index = this.explicitSlots.findIndex((entry) => entry.id === slot.id);
    const next = [...this.explicitSlots];
    if (index === -1) next.push(slot);
    else next[index] = slot;
    this.replace(next);
  }

  removeSlot(id: string): void {
    if (id === COMPATIBILITY_EFFECT_SLOT) throw new Error('Use setCompatibility() for the compatibility slot.');
    this.replace(this.explicitSlots.filter((slot) => slot.id !== id));
  }

  setCompatibility(recipe: Effect | undefined): void {
    this.assertEditable();
    this.update(this.explicitSlots, recipe ? {id: COMPATIBILITY_EFFECT_SLOT, recipe} : undefined);
  }

  subscribe(listener: (chain: InsertChain) => void): () => void {
    if (this.ended) return () => {};
    const subscription = {listener};
    this.listeners.add(subscription);
    return () => { this.listeners.delete(subscription); };
  }

  dispose(): void {
    if (this.ended) return;
    this.ended = true;
    this.graphRevision++;
    const old = this.active;
    const edges = this.edges;
    this.active = Object.freeze([]);
    this.explicitSlots = Object.freeze([]);
    this.compatibility = undefined;
    this.edges = [];
    let failure: unknown;
    for (const edge of [...edges].reverse()) {
      try { edge.source.disconnect(edge.destination); } catch (error) { failure ??= error; }
    }
    for (const instance of old) {
      try { this.retire(instance); } catch (error) { failure ??= error; }
    }
    this.notify();
    this.listeners.clear();
    if (failure !== undefined) {
      this.report(failure);
      throw failure;
    }
  }

  private assertEditable(): void {
    if (this.ended) throw new Error('InsertChain is disposed.');
    if (this.editing) throw new Error('InsertChain edits cannot re-enter graph construction.');
  }

  private update(slots: readonly InsertSlot[], compatibility: InsertSlot | undefined): void {
    this.assertEditable();
    // Builders are external callbacks. Freeze declarations before calling any
    // recipe so caller mutation cannot change the configuration being committed.
    slots = slots.map(snapshotSlot);
    compatibility = compatibility && snapshotSlot(compatibility);
    const declarations = compatibility ? [compatibility, ...slots] : [...slots];
    const ids = new Set<string>();
    for (const slot of declarations) {
      if (!slot.id || ids.has(slot.id)) throw new Error(`Invalid or duplicate insert slot id: ${slot.id}`);
      if (slot.ownership !== undefined && slot.ownership !== 'owned' && slot.ownership !== 'borrowed') {
        throw new Error('Invalid effect ownership.');
      }
      ids.add(slot.id);
    }
    const previousSlots = this.compatibility ? [this.compatibility, ...this.explicitSlots] : this.explicitSlots;
    if (declarations.length === previousSlots.length && declarations.every((slot, index) => sameSlot(slot, previousSlots[index]))) return;

    this.editing = true;
    const previous = this.active;
    const candidates: EffectInstance[] = [];
    const fresh: EffectInstance[] = [];
    const attempted: Edge[] = [];
    const removed: Edge[] = [];
    const nextEdges: Edge[] = [];
    try {
      for (const slot of declarations) {
        const old = previous.find((instance) => instance.slotId === slot.id);
        const oldSlot = previousSlots.find((entry) => entry.id === slot.id);
        if (old && oldSlot && sameSlot(slot, oldSlot)) {
          candidates.push(old);
          continue;
        }
        const nodes = slot.recipe.createAudioNodes(this.context);
        const ownership = slot.ownership ?? 'owned';
        // A transition rack may still own earlier generations. Reject aliases
        // before taking ownership: disposing a rejected alias would kill the
        // sounding graph that the transaction promises to preserve.
        if (effectGenerationGuards.get(this)?.(nodes)) {
          throw new Error('An effect transition must return fresh generation nodes and parameters.');
        }
        // An exact active bundle alias is safe only in its existing slot and
        // ownership. Partial overlap cannot safely invoke either disposer.
        if (old && nodes === old.nodes && ownership === old.ownership) {
          const entries = Object.entries(nodes.params ?? {});
          if (entries.length !== old.params.handles.length || entries.some(([id]) => {
            const handle = old.params.get(id);
            return !handle || !sameDescriptors({[id]: handle.descriptor}, {[id]: fitDisplayRange({
              ...handle.descriptor, ...slot.recipe.parameterDescriptors?.[id], ...slot.parameterDescriptors?.[id],
            })});
          })) throw new Error('An active effect bundle alias cannot change parameter metadata.');
          candidates.push(Object.freeze({...old, recipe: slot.recipe}));
          continue;
        }
        const overlapsLive = previous.some((instance) => overlaps(nodes, instance.nodes)) ||
          touches(nodes, this.input) || touches(nodes, this.output);
        if (overlapsLive) throw new Error('An insert replacement must return fresh nodes or its exact active bundle.');
        let instance: EffectInstance | undefined;
        try {
          for (const node of [nodes.input, nodes.output]) {
            if (!node || typeof node.connect !== 'function' || typeof node.disconnect !== 'function') {
              throw new TypeError('An effect must return input and output AudioNodes.');
            }
            if (node.context !== undefined && node.context !== this.context) throw new Error('Effect nodes belong to another audio context.');
          }
          if (candidates.some((candidate) => overlaps(nodes, candidate.nodes))) {
            throw new Error('Insert slots cannot share effect input/output nodes.');
          }
          instance = Object.freeze({
            id: `${this.id}/effect-${++this.sequence}`,
            slotId: slot.id,
            recipe: slot.recipe,
            nodes,
            params: this.parameters(nodes, slot),
            ownership,
          });
          fresh.push(instance);
          candidates.push(instance);
        } catch (error) {
          // Avoid invoking a second disposer for an aliased candidate graph.
          if (!instance && ownership === 'owned' && !candidates.some((candidate) => overlaps(nodes, candidate.nodes))) {
            try { nodes.dispose?.(); } catch (cleanupError) { this.report(cleanupError); }
          }
          throw error;
        }
        if (this.ended) throw new Error('InsertChain was disposed during graph construction.');
      }
      if (this.ended) throw new Error('InsertChain was disposed during graph construction.');
      let source: AudioNode = this.input;
      for (const instance of candidates) {
        nextEdges.push({source, destination: instance.nodes.input});
        source = instance.nodes.output;
      }
      nextEdges.push({source, destination: this.output});
      // Disconnect changing chain edges before adding new ones. In particular,
      // reversing A -> B must never briefly create an A -> B -> A feedback loop.
      for (const edge of this.edges) {
        if (nextEdges.some((next) => sameEdge(edge, next))) continue;
        removed.push(edge);
        edge.source.disconnect(edge.destination);
        if (this.ended) throw new Error('InsertChain was disposed during graph construction.');
      }
      for (const edge of nextEdges) {
        if (this.edges.some((old) => sameEdge(edge, old))) continue;
        attempted.push(edge);
        edge.source.connect(edge.destination);
        if (this.ended) throw new Error('InsertChain was disposed during graph construction.');
      }
    } catch (error) {
      // Restore only edges this transaction removed. Disposal is terminal and
      // must never be undone by an interrupted candidate's rollback.
      for (const edge of attempted.reverse()) {
        try { edge.source.disconnect(edge.destination); } catch (cleanupError) { this.report(cleanupError); }
      }
      if (!this.ended) for (const edge of removed) {
        try { edge.source.connect(edge.destination); } catch (cleanupError) { this.report(cleanupError); }
      }
      for (const instance of fresh.reverse()) {
        try { this.retire(instance); } catch (cleanupError) { this.report(cleanupError); }
      }
      this.editing = false;
      throw error;
    }

    this.active = Object.freeze(candidates);
    this.explicitSlots = Object.freeze(slots.map((slot) => Object.freeze({...slot})));
    this.compatibility = compatibility && Object.freeze({...compatibility});
    this.edges = nextEdges;
    this.graphRevision++;
    // Keep edits blocked while retiring old graphs: a custom disposer must not
    // recursively replace the graph halfway through this cleanup batch.
    for (const instance of previous) {
      if (candidates.some((candidate) => candidate.id === instance.id)) continue;
      try { this.retire(instance); } catch (error) { this.report(error); }
    }
    this.editing = false;
    this.notify();
  }

  private parameters(nodes: EffectNodes, slot: InsertSlot): ParamSurface {
    const handles: ParamHandle[] = [];
    try {
      for (const [id, parameter] of Object.entries(nodes.params ?? {})) {
        const descriptor = this.parameterDescriptor(parameter, id, slot);
        const native = descriptor.modulation === 'audio-rate' || descriptor.modulation === 'control-rate';
        const handle = new ParamHandle(descriptor, {
          baseValue: parameter.value,
          ...(!native && {apply: (value: number) => { parameter.value = value; }}),
        });
        handles.push(handle);
        // Native targets keep their intrinsic base until an explicit modulation
        // or automation command activates the shared CV bus.
        if (native) handle.bindAudioParam(this.context, parameter, {lazy: true});
      }
      return new ParamSurface(handles);
    } catch (error) {
      for (const handle of handles) {
        try { handle.dispose(); } catch { /* Preserve parameter construction failure. */ }
      }
      throw error;
    }
  }

  private parameterDescriptor(parameter: AudioParam, id: string, slot: InsertSlot): ParamDescriptor {
    const min = Number.isFinite(parameter.minValue) ? parameter.minValue : -Number.MAX_VALUE;
    const max = Number.isFinite(parameter.maxValue) ? parameter.maxValue : Number.MAX_VALUE;
    const rate = parameter.automationRate;
    const descriptor: ParamDescriptor = {
      id, unit: 'native', range: {min, max},
      defaultValue: Number.isFinite(parameter.defaultValue) ? parameter.defaultValue : parameter.value,
      updateTiming: rate === 'a-rate' || rate === 'k-rate' ? 'scheduled' : 'synchronous',
      modulation: rate === 'a-rate' ? 'audio-rate' : rate === 'k-rate' ? 'control-rate' : 'none',
      ...slot.recipe.parameterDescriptors?.[id], ...slot.parameterDescriptors?.[id],
    };
    return fitDisplayRange(descriptor);
  }

  private retire(instance: EffectInstance): void {
    let failure: unknown;
    for (const handle of instance.params) {
      try { handle.dispose(); } catch (error) { failure ??= error; }
    }
    if (instance.ownership === 'owned') {
      try { instance.nodes.dispose?.(); } catch (error) { failure ??= error; }
    }
    if (failure !== undefined) throw failure;
  }

  private report(error: unknown): void {
    try { this.options.onCleanupError?.(error); } catch { /* Diagnostics cannot change graph ownership. */ }
  }

  private notify(): void {
    const revision = this.graphRevision;
    for (const subscription of [...this.listeners]) {
      if (revision !== this.graphRevision) break;
      if (!this.listeners.has(subscription)) continue;
      try {
        const result: unknown = subscription.listener(this);
        if (result != null && typeof (result as {then?: unknown}).then === 'function') {
          void Promise.resolve(result).catch(() => {});
        }
      } catch { /* Observers cannot invalidate a committed graph. */ }
    }
  }
}

function sameSlot(left: InsertSlot, right: InsertSlot): boolean {
  return left.id === right.id && left.recipe === right.recipe &&
    (left.ownership ?? 'owned') === (right.ownership ?? 'owned') &&
    sameDescriptors(left.parameterDescriptors, right.parameterDescriptors);
}

function snapshotSlot(slot: InsertSlot): InsertSlot {
  const descriptors = slot.parameterDescriptors;
  return Object.freeze({...slot, parameterDescriptors: descriptors && Object.freeze(Object.fromEntries(
    Object.entries(descriptors).map(([id, descriptor]) => [id, Object.freeze({
      ...descriptor, ...(descriptor.range && {range: Object.freeze({...descriptor.range})}),
      ...(descriptor.displayRange && {displayRange: Object.freeze({...descriptor.displayRange})}),
    })]),
  ))});
}

function sameDescriptors(left: Effect['parameterDescriptors'], right: Effect['parameterDescriptors']): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => {
    const a = left[key];
    const b = right[key];
    return b !== undefined && a.label === b.label && a.unit === b.unit &&
      a.defaultValue === b.defaultValue && a.step === b.step && a.scale === b.scale &&
      a.updateTiming === b.updateTiming && a.modulation === b.modulation &&
      a.range?.min === b.range?.min && a.range?.max === b.range?.max &&
      a.displayRange?.min === b.displayRange?.min && a.displayRange?.max === b.displayRange?.max;
  });
}

function sameEdge(left: Edge, right: Edge): boolean {
  return left.source === right.source && left.destination === right.destination;
}

function fitDisplayRange(descriptor: ParamDescriptor): ParamDescriptor {
  const display = descriptor.displayRange;
  if (!display) return descriptor;
  if (!Number.isFinite(display.min) || !Number.isFinite(display.max) || display.min > display.max) {
    throw new RangeError('A suggested parameter displayRange must be finite and ordered.');
  }
  // A recipe's UI sweep may exceed this context's native limits, notably a
  // filter frequency in a low-sample-rate offline context. Legal writes remain
  // unchanged; an incompatible suggestion is omitted rather than inverted.
  const min = Math.max(descriptor.range.min, display.min);
  const max = Math.min(descriptor.range.max, display.max);
  return {...descriptor, displayRange: min <= max ? {min, max} : undefined};
}

function touches(nodes: EffectNodes, node: AudioNode): boolean {
  return nodes.input === node || nodes.output === node;
}

function overlaps(left: EffectNodes, right: EffectNodes): boolean {
  return touches(left, right.input) || touches(left, right.output);
}
