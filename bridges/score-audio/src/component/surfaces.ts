// View objects (DEC-078): objects whose box shows one of the packages' own
// Components — a keyboard, an oscilloscope, a meter, a spectrum, a piano
// roll. The runtime side lives here, with no DOM: the project plugins and the
// slots that hand each view what its element borrows. Studio and exported
// components use the same plugins.
//
// A slot outlives the runtime modules behind it. A rebuild creates the new
// module before it disposes the old one, and a failed rebuild disposes the new
// one and keeps the old, so a slot keeps every provided value in creation
// order and shows the newest one still provided.
//
// Ownership: each plugin instance owns its analyser or note port and releases
// what it provided on dispose. Elements borrow; they never dispose a value.

import {
  NoteOutputPort, createConnectionLease,
  type ModuleHandle, type NoteEvent, type ProjectConnector,
  type ProjectFactoryRequest, type ProjectModuleInstance, type ProjectPluginFactory, type ProjectPortDescriptor,
} from '@webmusic/kernel/module';

const PLUGIN_VERSION = '1.0.0';
export const KEYS_PLUGIN = 'webmusic.surface.keys';
export const SCOPE_PLUGIN = 'webmusic.surface.scope';
export const METER_PLUGIN = 'webmusic.surface.meter';
export const SPECTRUM_PLUGIN = 'webmusic.surface.spectrum';
export const ROLL_PLUGIN = 'webmusic.surface.roll';

/** The view a surface plugin shows. */
export type SurfaceKind = 'keys' | 'scope' | 'meter' | 'spectrum' | 'roll';
export const SURFACE_PLUGINS: Readonly<Record<SurfaceKind, string>> = Object.freeze({
  keys: KEYS_PLUGIN, scope: SCOPE_PLUGIN, meter: METER_PLUGIN, spectrum: SPECTRUM_PLUGIN, roll: ROLL_PLUGIN,
});
/** The surface kind of a plugin ID, if it is one. */
export function surfaceKindOf(plugin: string): SurfaceKind | undefined {
  return (Object.entries(SURFACE_PLUGINS) as [SurfaceKind, string][]).find(([, id]) => id === plugin)?.[0];
}

/** One provided value, newest wins while it is provided. */
class Provided<T> {
  readonly #values: {value: T}[] = [];
  readonly #listeners = new Set<() => void>();
  get current(): T | undefined { return this.#values[this.#values.length - 1]?.value; }
  provide(value: T): () => void {
    const entry = {value};
    this.#values.push(entry);
    this.#notify();
    return () => {
      const index = this.#values.indexOf(entry);
      if (index < 0) return;
      this.#values.splice(index, 1);
      this.#notify();
    };
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
  #notify(): void {
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch (error) { queueMicrotask(() => { throw error; }); }
    }
  }
}

/** What one view's element borrows, by module ID. */
export class SurfaceSlot {
  /** The analyser a scope, meter or spectrum box samples. */
  readonly analyser = new Provided<AnalyserNode>();
  /** The score module a roll box follows, through its `source` cord. */
  readonly source = new Provided<ModuleHandle>();
  /** The note port of the newest keys module; the box's keyboard plays into it. */
  readonly notes = new Provided<(event: NoteEvent) => void>();
}

export class ComponentSurfaces {
  readonly #slots = new Map<string, SurfaceSlot>();

  slot(id: string): SurfaceSlot {
    let slot = this.#slots.get(id);
    if (!slot) { slot = new SurfaceSlot(); this.#slots.set(id, slot); }
    return slot;
  }

  /** The plugins for the five view objects. */
  plugins(): readonly ProjectPluginFactory[] {
    const analyserPlugin = (id: string, fftSize: number): ProjectPluginFactory => ({
      id, version: PLUGIN_VERSION, create: request => this.#analyser(request, fftSize),
    });
    return Object.freeze([
      {id: KEYS_PLUGIN, version: PLUGIN_VERSION, create: request => this.#keys(request)},
      analyserPlugin(SCOPE_PLUGIN, 2048),
      analyserPlugin(METER_PLUGIN, 2048),
      analyserPlugin(SPECTRUM_PLUGIN, 4096),
      {id: ROLL_PLUGIN, version: PLUGIN_VERSION, create: ({record}) => ({
        module: {id: record.id},
        ports: [{id: 'source', kind: 'source', direction: 'input'}],
        dispose: () => {},
      })},
    ]);
  }

  /** The runtime connector for `source` cords: the roll box follows the score module. */
  readonly connect: ProjectConnector = ({connection, from}) => {
    if (connection.kind !== 'source') return undefined;
    return createConnectionLease(this.slot(connection.to.moduleId).source.provide(from.module));
  };

  #keys({record, context}: ProjectFactoryRequest): ProjectModuleInstance {
    const notes = new NoteOutputPort({id: 'notes'});
    const module: ModuleHandle = {id: record.id, ports: () => [notes]};
    const registration = context.registry.register(module);
    // A rebuild can drop the port while a key is held: the old port cancels it,
    // and the new one must not see a release it never started.
    const forward = (event: NoteEvent) => {
      if (notes.disposed) return;
      if (event.gate !== 'on' && !notes.held.some(held => held.occurrenceId === event.occurrenceId)) return;
      notes.emit(event);
    };
    const release = this.slot(record.id).notes.provide(forward);
    return {
      module,
      ports: [{id: 'notes', kind: 'note', direction: 'output'}],
      dispose: () => { release(); notes.dispose(); registration.release(); },
    };
  }

  #analyser({record, context}: ProjectFactoryRequest, fftSize: number): ProjectModuleInstance {
    const analyser = context.audio.prepare().createAnalyser();
    analyser.fftSize = fftSize;
    const release = this.slot(record.id).analyser.provide(analyser);
    const ports: readonly ProjectPortDescriptor[] = [{id: 'input', kind: 'audio', direction: 'input'}];
    return {
      module: {id: record.id},
      ports,
      getInput: name => name === 'input' ? analyser : undefined,
      dispose: () => { release(); analyser.disconnect(); },
    };
  }
}

/** True when a plugin's module only listens: its audio cords are sends, never a replaced route. */
export function isListener(plugin: string): boolean {
  return plugin === SCOPE_PLUGIN || plugin === METER_PLUGIN || plugin === SPECTRUM_PLUGIN;
}
