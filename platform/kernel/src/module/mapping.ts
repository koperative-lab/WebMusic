import type {ParamDescriptor} from './parameter';
import type {ProjectMappingRecord, ProjectMappingSource, ProjectParamEndpoint} from './project-types';

// ============================================================================
// Control mappings (DEC-076): MIDI controllers, pitch bend, program changes
// and computer keys set parameters directly, as Max's Mappings do. The
// registry is pure: an input adapter hands it events, it resolves targets
// through the caller and writes base values.
// ============================================================================

/** One control gesture from an input device. */
export type ControlEvent =
  | {readonly kind: 'cc'; readonly controller: number; readonly value: number; readonly channel: number}
  | {readonly kind: 'pitchbend'; readonly value: number; readonly channel: number}
  | {readonly kind: 'program'; readonly value: number; readonly channel: number}
  | {readonly kind: 'key'; readonly key: string; readonly down: boolean};

/** The 0–1 position of an event, or undefined for one that sets nothing (a key release). */
export function controlFraction(event: ControlEvent): number | undefined {
  switch (event.kind) {
    case 'cc': case 'program': return Math.min(1, Math.max(0, event.value / 127));
    case 'pitchbend': return Math.min(1, Math.max(0, (event.value + 8192) / 16383));
    case 'key': return event.down ? 1 : undefined;
  }
}

/** The mapping source an event comes from. */
export function controlSource(event: ControlEvent): ProjectMappingSource {
  switch (event.kind) {
    case 'cc': return {kind: 'cc', controller: event.controller, channel: event.channel};
    case 'pitchbend': return {kind: 'pitchbend', channel: event.channel};
    case 'program': return {kind: 'program', channel: event.channel};
    case 'key': return {kind: 'key', key: event.key};
  }
}

/** Whether `source` listens to `event`; a source without a channel listens to every channel. */
export function sourceMatches(source: ProjectMappingSource, event: ControlEvent): boolean {
  if (source.kind !== event.kind) return false;
  if (source.kind === 'key') return event.kind === 'key' && source.key === event.key;
  if (source.kind === 'cc' && (event.kind !== 'cc' || source.controller !== event.controller)) return false;
  return source.channel === undefined || (event.kind !== 'key' && source.channel === event.channel);
}

/** A short name for a source: `CC 7 ch 1`, `Bend`, `Program`, `Key A`. */
export function describeSource(source: ProjectMappingSource): string {
  const channel = 'channel' in source && source.channel !== undefined ? ` ch ${source.channel + 1}` : '';
  switch (source.kind) {
    case 'cc': return `CC ${source.controller}${channel}`;
    case 'pitchbend': return `Bend${channel}`;
    case 'program': return `Program${channel}`;
    case 'key': return `Key ${source.key.length === 1 ? source.key.toUpperCase() : source.key}`;
  }
}

/**
 * What a mapping writes: a `ParamHandle`, or anything shaped like one, such
 * as an adapter over an interface object's value.
 */
export interface MappableParameter {
  readonly descriptor: Pick<ParamDescriptor, 'range' | 'displayRange'>;
  readonly snapshot: {readonly disposed: boolean};
  setBaseValue(value: number): void;
}

export interface ControlMappingOptions {
  /** Find the live parameter a mapping targets; undefined while it is unavailable. */
  resolve(target: ProjectParamEndpoint): MappableParameter | undefined;
  /** Called after learning or removing a mapping changes the list. */
  onChange?(mappings: readonly ProjectMappingRecord[]): void;
}

/** Applies control events to parameters through a list of mappings, and learns new ones. */
export class ControlMappings {
  #mappings: readonly ProjectMappingRecord[] = [];
  #learning?: ProjectParamEndpoint;
  readonly #keyState = new Map<string, boolean>();
  readonly #options: ControlMappingOptions;
  readonly #listeners = new Set<() => void>();

  constructor(options: ControlMappingOptions, mappings: readonly ProjectMappingRecord[] = []) {
    this.#options = options;
    this.#mappings = mappings;
  }

  get mappings(): readonly ProjectMappingRecord[] { return this.#mappings; }
  /** The target waiting for its next control event, if any. */
  get learning(): ProjectParamEndpoint | undefined { return this.#learning; }

  /** Replace the list, as when a project opens. */
  set(mappings: readonly ProjectMappingRecord[]): void { this.#mappings = mappings; this.#keyState.clear(); this.#notify(); }

  /** The next control event maps to `target`, replacing that target's previous mapping. */
  learn(target: ProjectParamEndpoint): void { this.#learning = target; this.#notify(); }
  cancelLearn(): void { if (this.#learning) { this.#learning = undefined; this.#notify(); } }

  remove(id: string): void {
    const next = this.#mappings.filter(mapping => mapping.id !== id);
    if (next.length === this.#mappings.length) return;
    this.#mappings = next;
    this.#options.onChange?.(next);
    this.#notify();
  }

  /** Apply one event. Returns true when it learned a mapping or set at least one parameter. */
  handle(event: ControlEvent): boolean {
    if (this.#learning && (event.kind !== 'key' || event.down)) {
      const target = this.#learning;
      this.#learning = undefined;
      const source = controlSource(event);
      const kept = this.#mappings.filter(mapping => !(mapping.target.moduleId === target.moduleId && mapping.target.param === target.param));
      let index = 1;
      const used = new Set(kept.map(mapping => mapping.id));
      while (used.has(`map${index}`)) index++;
      this.#mappings = [...kept, {id: `map${index}`, source, target}];
      this.#options.onChange?.(this.#mappings);
      this.#notify();
      return true;
    }
    let applied = false;
    for (const mapping of this.#mappings) {
      if (!sourceMatches(mapping.source, event)) continue;
      const handle = this.#options.resolve(mapping.target);
      if (!handle || handle.snapshot.disposed) continue;
      const range = handle.descriptor.displayRange ?? handle.descriptor.range;
      const min = mapping.min ?? range.min, max = mapping.max ?? range.max;
      let fraction = controlFraction(event);
      if (event.kind === 'key') {
        // A key flips its target between the range's ends on each press.
        if (!event.down) continue;
        const on = !(this.#keyState.get(mapping.id) ?? false);
        this.#keyState.set(mapping.id, on);
        fraction = on ? 1 : 0;
      }
      if (fraction === undefined) continue;
      const value = min + fraction * (max - min);
      const {min: legalMin, max: legalMax} = handle.descriptor.range;
      try { handle.setBaseValue(Math.min(legalMax, Math.max(legalMin, value))); applied = true; } catch { /* A refused write leaves the parameter. */ }
    }
    return applied;
  }

  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }

  #notify(): void { for (const listener of [...this.#listeners]) { try { listener(); } catch { /* Observers cannot undo a mapping. */ } } }
}
