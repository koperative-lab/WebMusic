import {createConnectionLease, type ConnectionLease} from './lease';
import type {ProjectPluginFactory, ProjectPluginLookup} from './project-types';

/** Exact plugin/version dispatch. Registration borrows factories and never executes them. */
export class ProjectPluginRegistry implements ProjectPluginLookup {
  readonly #entries = new Map<string, Map<string, ProjectPluginFactory>>();
  get(id: string, version: string): ProjectPluginFactory | undefined { return this.#entries.get(id)?.get(version); }
  register(factory: ProjectPluginFactory): ConnectionLease {
    const id = factory.id, version = factory.version;
    for (const value of [id, version]) if (typeof value !== 'string' || !value || value !== value.trim()) throw new TypeError('Plugin ID and version must be nonempty trimmed strings.');
    if (typeof factory.create !== 'function') throw new TypeError('Plugin factory requires create().');
    const versions = this.#entries.get(id) ?? new Map<string, ProjectPluginFactory>();
    if (versions.has(version)) throw new Error(`Plugin already registered: ${id}@${version}.`);
    const entry = Object.freeze({id, version, create: factory.create.bind(factory)});
    versions.set(version, entry); this.#entries.set(id, versions);
    return createConnectionLease(() => {
      if (versions.get(version) !== entry) return;
      versions.delete(version);
      if (versions.size === 0) this.#entries.delete(id);
    });
  }
}
