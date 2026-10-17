import {attachSessionAutomation, SessionTransport, type SessionAutomationLease} from '../session';
import type {TransportCommit} from '../sync';
import type {AudioOutputPort} from './audio-port';
import {ModuleContext} from './context';
import {createConnectionLease, type ConnectionLease} from './lease';
import {ParamMacro} from './param-macro';
import type {ParamMapping} from './param-audio';
import type {ParamHandle} from './parameter';
import {createModuleHandle, ModuleRegistry, type ModuleHandle} from './registry';
import {parseModuleProject} from './project-schema';
import type {
  ModuleProject, ProjectConnectionRecord, ProjectContextRecord, ProjectDiagnostic,
  ProjectLayout, ProjectModuleInstance, ProjectModulationRecord, ProjectRestoreOptions,
  ProjectRestoreResult, ProjectRuntimeOptions, ProjectRuntimeResources, ProjectRuntimeSnapshot,
} from './project-types';

interface Graph {
  project: ModuleProject;
  readonly controller: AbortController;
  readonly gate: GainNode;
  readonly session: SessionTransport;
  readonly context: ModuleContext;
  readonly contexts: Map<string, ModuleContext>;
  readonly defaultOwners: Map<string, string | undefined>;
  readonly instances: Map<string, ProjectModuleInstance>;
  readonly handles: Map<string, ModuleHandle>;
  readonly macros: Map<string, ParamMacro>;
  readonly leases: ConnectionLease[];
  readonly connectionLeases: Map<string, ConnectionLease>;
  readonly modulationLeases: Map<string, ParamMapping>;
  readonly automationLeases: Map<string, SessionAutomationLease>;
  readonly diagnostics: ProjectDiagnostic[];
  disposed: boolean;
}
interface Pending { readonly controller: AbortController; readonly generation: number }

function aborted(): Error { const error = new Error('Project restoration was cancelled.'); error.name = 'AbortError'; return error; }
function assertSignal(signal: AbortSignal): void { if (signal.aborted) throw aborted(); }
async function abortable<T>(value: T | Promise<T>, signal: AbortSignal, retireLate?: (value: T) => void): Promise<T> {
  if (signal.aborted) {
    void Promise.resolve(value).then(result => retireLate?.(result), () => {});
    throw aborted();
  }
  let finished = false;
  let acquired: {value: T} | undefined;
  let retired = false;
  const retire = (result: T) => { if (!retired) { retired = true; retireLate?.(result); } };
  let rejectAbort!: (error: unknown) => void;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(aborted());
  signal.addEventListener('abort', onAbort, {once: true});
  const task = Promise.resolve(value);
  void task.then(result => { acquired = {value: result}; if (signal.aborted && !finished) retire(result); }, () => {});
  try {
    const result = await Promise.race([task, cancellation]);
    assertSignal(signal);
    finished = true;
    return result;
  } catch (error) {
    if (!finished && acquired) retire(acquired.value);
    throw error;
  } finally { signal.removeEventListener('abort', onAbort); }
}

/**
 * Owns one active graph and at most one muted candidate. It borrows its audio
 * environment; applications own file access, persistence, undo and user gestures.
 */
export class ModuleProjectRuntime {
  readonly #options: ProjectRuntimeOptions;
  readonly #listeners = new Set<(snapshot: ProjectRuntimeSnapshot) => void>();
  readonly #ownedInstances = new WeakSet<ProjectModuleInstance>();
  #graph?: Graph;
  #pending?: Pending;
  #generation = 0;
  #revision = 0;
  #disposed = false;
  #editing = false;
  #editObserved = false;
  #preparedEdit?: {graph: Graph; project: ModuleProject};
  #committing = false;

  constructor(options: ProjectRuntimeOptions) { this.#options = options; }
  get context(): ModuleContext | undefined { return this.#graph?.context; }
  get session(): SessionTransport | undefined { return this.#graph?.session; }
  get resources(): ProjectRuntimeResources | undefined {
    const graph = this.#graph;
    return graph && Object.freeze({context: graph.context, session: graph.session, module: (id: string) => graph.handles.get(id)});
  }
  getModule(id: string): ModuleHandle | undefined { return this.#graph?.handles.get(id); }
  getMacro(id: string): ParamMacro | undefined { return this.#graph?.macros.get(id); }

  snapshot(): ProjectRuntimeSnapshot {
    const graph = this.#graph;
    return this.#captureSnapshot(graph, graph ? this.#exportGraph(graph) : undefined);
  }

  #captureSnapshot(graph: Graph | undefined, project: ModuleProject | undefined): ProjectRuntimeSnapshot {
    return Object.freeze({
      project, revision: this.#revision,
      restoring: this.#pending !== undefined, disposed: this.#disposed,
      modules: Object.freeze((graph?.project.modules ?? []).map(record => {
        const instance = graph?.instances.get(record.id);
        const diagnostic = graph?.diagnostics.find(item => item.kind === 'module' && item.id === record.id)?.reason;
        const defaultOwnerModuleId = graph?.defaultOwners.get(record.contextId);
        return Object.freeze({record, status: instance ? 'ready' as const : 'unresolved' as const,
          ports: Object.freeze((instance?.ports ?? []).map(port => Object.freeze({...port}))),
          ...(defaultOwnerModuleId ? {defaultOwnerModuleId} : {}), ...(diagnostic ? {diagnostic} : {})});
      })),
      unresolved: Object.freeze([...(graph?.diagnostics ?? [])]),
    });
  }

  exportProject(): ModuleProject {
    return this.#exportGraph(this.#requireGraph());
  }

  #exportGraph(graph: Graph): ModuleProject {
    const transport = graph.session.snapshot;
    return parseModuleProject({...graph.project,
      modules: graph.project.modules.map(record => {
        const instance = graph.instances.get(record.id);
        if (!instance) return record;
        const params: Record<string, number> = {...record.params};
        for (const handle of instance.module.params ?? []) params[handle.descriptor.id] = handle.snapshot.baseValue;
        return {...record, config: instance.exportConfig?.() ?? record.config, params};
      }),
      macros: graph.project.macros.map(record => ({...record, value: graph.macros.get(record.id)?.value ?? record.value})),
      modulations: graph.project.modulations.map(record => ({...record, depth: graph.modulationLeases.get(record.id)?.depth ?? record.depth})),
      automation: graph.project.automation.map(record => ({...record, ...(graph.automationLeases.has(record.id) ? {enabled: graph.automationLeases.get(record.id)!.active, initialValue: graph.automationLeases.get(record.id)!.initialValue} : {})})),
      session: {positionSeconds: graph.session.clock.positionAt(transport.referenceTime), rate: transport.rate, loop: transport.loop},
    });
  }

  /** Build/prepare a private candidate. A failed factory, asset, parameter or route leaves the active graph intact. */
  async restore(input: unknown, options: ProjectRestoreOptions = {}): Promise<ProjectRestoreResult> {
    this.#assertActive();
    if (this.#committing) throw new Error('Project restoration cannot re-enter activation.');
    const project = parseModuleProject(input);
    if (options.signal?.aborted) return {status: 'cancelled', snapshot: this.snapshot()};
    const previousPending = this.#pending;
    const pending = {controller: new AbortController(), generation: ++this.#generation};
    this.#pending = pending;
    previousPending?.controller.abort();
    const cancel = () => { if (this.#pending === pending) this.cancelRestore(); };
    options.signal?.addEventListener('abort', cancel, {once: true});
    this.#changed();
    let candidate: Graph | undefined;
    try {
      this.#assertPending(pending);
      candidate = await this.#build(project, pending.controller);
      this.#assertPending(pending);
      if (options.play) await this.#command(candidate.session.play(), pending.controller.signal);
      this.#assertPending(pending);
      // Plugin exports, parameter reads and port descriptors may fail or re-enter.
      // Validate the complete result before making the candidate audible.
      const prepared = this.#captureSnapshot(candidate, this.#exportGraph(candidate));
      this.#assertPending(pending);
      const snapshot = this.#activate(candidate, pending, prepared);
      candidate = undefined;
      return {status: 'committed', snapshot};
    } catch (error) {
      if (candidate) this.#disposeGraph(candidate);
      if (this.#pending !== pending || this.#disposed) return {status: 'cancelled', snapshot: this.snapshot()};
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', cancel);
      if (this.#pending === pending) { this.#pending = undefined; this.#changed(); }
    }
  }

  retryMissing(options: ProjectRestoreOptions = {}): Promise<ProjectRestoreResult> {
    return this.restore(this.exportProject(), options);
  }
  cancelRestore(): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = undefined;
    ++this.#generation;
    pending.controller.abort();
    this.#changed();
  }

  /** Presentation-only mutations preserve all instances, routes, voices and Session state. */
  updateLayout(layout: ProjectLayout): void {
    const graph = this.#requireEditable();
    graph.project = parseModuleProject({...graph.project, layout});
    this.#changed();
  }
  updatePresentation(options: {modules?: readonly {id: string; label?: string}[]; layout?: ProjectLayout}): void {
    const graph = this.#requireEditable();
    const records = new Map(graph.project.modules.map(record => [record.id, record]));
    const modules = options.modules?.map(item => {
      const record = records.get(item.id);
      if (!record) throw new Error(`Unknown presentation module ${item.id}.`);
      records.delete(item.id);
      const {label: _previousLabel, ...rest} = record;
      return {...rest, ...(item.label !== undefined ? {label: item.label} : {})};
    });
    if (modules && records.size) throw new Error('Presentation updates must retain every module ID.');
    graph.project = parseModuleProject({...graph.project, ...(modules ? {modules} : {}), ...(options.layout ? {layout: options.layout} : {})});
    this.#changed();
  }

  /** Add one explicit edge without recreating playing modules. The backend still validates context/routing. */
  async connect(connection: ProjectConnectionRecord): Promise<ProjectRuntimeSnapshot> {
    const graph = this.#requireEditable();
    const generation = this.#generation;
    this.#editing = true;
    let lease: ConnectionLease | undefined;
    let committed: ProjectRuntimeSnapshot | undefined;
    try {
      const next = parseModuleProject({...graph.project, connections: [...graph.project.connections, connection]});
      this.#validateAudioTopology(graph, next);
      this.#assertEdit(graph, generation);
      const record = next.connections[next.connections.length - 1]!;
      const diagnostics = [...graph.diagnostics];
      lease = await this.#connect(graph, record, diagnostics);
      this.#assertEdit(graph, generation);
      const prepared = this.#prepareEdit(graph, next, diagnostics);
      this.#assertEdit(graph, generation);
      if (lease) graph.connectionLeases.set(record.id, lease);
      committed = this.#commitEdit(graph, next, diagnostics, prepared);
      return committed;
    } catch (error) { this.#retire(lease); throw error; }
    finally { this.#finishEdit(committed); }
  }
  disconnect(id: string): ProjectRuntimeSnapshot {
    const graph = this.#requireEditable();
    const generation = this.#generation;
    this.#editing = true;
    let committed: ProjectRuntimeSnapshot | undefined;
    try {
      if (!graph.project.connections.some(connection => connection.id === id)) throw new Error(`Unknown project connection ${id}.`);
      const next = parseModuleProject({...graph.project, connections: graph.project.connections.filter(connection => connection.id !== id)});
      this.#validateAudioTopology(graph, next);
      this.#assertEdit(graph, generation);
      const diagnostics = graph.diagnostics.filter(item => !(item.kind === 'connection' && item.id === id));
      const prepared = this.#prepareEdit(graph, next, diagnostics);
      this.#assertEdit(graph, generation);
      const lease = graph.connectionLeases.get(id);
      graph.connectionLeases.delete(id);
      committed = this.#commitEdit(graph, next, diagnostics, prepared);
      this.#retire(lease);
      return committed;
    } finally { this.#finishEdit(committed); }
  }

  async connectModulation(record: ProjectModulationRecord): Promise<ProjectRuntimeSnapshot> {
    const graph = this.#requireEditable();
    const generation = this.#generation;
    this.#editing = true;
    let lease: ParamMapping | undefined;
    let committed: ProjectRuntimeSnapshot | undefined;
    try {
      const next = parseModuleProject({...graph.project, modulations: [...graph.project.modulations, record]});
      const modulation = next.modulations[next.modulations.length - 1]!;
      const diagnostics = [...graph.diagnostics];
      lease = this.#connectModulation(graph, modulation, diagnostics);
      this.#assertEdit(graph, generation);
      const mappings = new Map(graph.modulationLeases);
      if (lease) mappings.set(modulation.id, lease);
      const prepared = this.#prepareEdit(graph, next, diagnostics, mappings);
      this.#assertEdit(graph, generation);
      if (lease) graph.modulationLeases.set(modulation.id, lease);
      committed = this.#commitEdit(graph, next, diagnostics, prepared);
      return committed;
    } catch (error) { this.#retire(lease); throw error; }
    finally { this.#finishEdit(committed); }
  }
  disconnectModulation(id: string): ProjectRuntimeSnapshot {
    const graph = this.#requireEditable();
    const generation = this.#generation;
    this.#editing = true;
    let committed: ProjectRuntimeSnapshot | undefined;
    try {
      if (!graph.project.modulations.some(record => record.id === id)) throw new Error(`Unknown project modulation ${id}.`);
      const next = parseModuleProject({...graph.project, modulations: graph.project.modulations.filter(record => record.id !== id)});
      const diagnostics = graph.diagnostics.filter(item => !(item.kind === 'modulation' && item.id === id));
      const prepared = this.#prepareEdit(graph, next, diagnostics);
      this.#assertEdit(graph, generation);
      const lease = graph.modulationLeases.get(id);
      graph.modulationLeases.delete(id);
      committed = this.#commitEdit(graph, next, diagnostics, prepared);
      this.#retire(lease);
      return committed;
    } finally { this.#finishEdit(committed); }
  }

  #prepareEdit(graph: Graph, project: ModuleProject, diagnostics: ProjectDiagnostic[], modulationLeases = graph.modulationLeases): ProjectRuntimeSnapshot {
    // Exporters and port getters are plugin code. Validate their result before
    // publishing the document or retiring a route that cannot be reacquired.
    const candidate = {...graph, project, diagnostics, modulationLeases};
    const observed = this.#editObserved;
    this.#editObserved = false;
    try {
      const project = this.#exportGraph(candidate);
      const snapshot = this.#captureSnapshot(candidate, project);
      this.#preparedEdit = {graph, project};
      return snapshot;
    } catch (error) { this.#editObserved ||= observed; throw error; }
  }
  #assertEdit(graph: Graph, generation: number): void {
    if (this.#graph !== graph || this.#generation !== generation || graph.disposed) throw aborted();
  }
  #commitEdit(graph: Graph, project: ModuleProject, diagnostics: ProjectDiagnostic[], prepared: ProjectRuntimeSnapshot): ProjectRuntimeSnapshot {
    graph.project = project;
    graph.diagnostics.splice(0, graph.diagnostics.length, ...diagnostics);
    return Object.freeze({...prepared, revision: ++this.#revision});
  }
  #finishEdit(committed?: ProjectRuntimeSnapshot): void {
    this.#editing = false;
    const observed = this.#editObserved;
    this.#editObserved = false;
    this.#preparedEdit = undefined;
    // Reuse the validated snapshot: a committed edit must not fail a second read.
    if (committed) {
      this.#notify(committed.revision, committed);
      // Retirement may write parameters after capture. Publish that later state
      // separately; observer/export failures cannot undo the committed command.
      if (observed && this.#graph) this.#observe(this.#graph);
    } else if (observed) this.#changed();
  }

  subscribe(listener: (snapshot: ProjectRuntimeSnapshot) => void): () => void {
    this.#assertActive();
    this.#listeners.add(listener);
    this.#call(listener);
    return () => { this.#listeners.delete(listener); };
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const pending = this.#pending, graph = this.#graph;
    this.#pending = undefined; this.#graph = undefined; ++this.#generation;
    pending?.controller.abort();
    if (graph) this.#disposeGraph(graph);
    this.#changed(); this.#listeners.clear();
  }

  async #build(project: ModuleProject, controller: AbortController): Promise<Graph> {
    const signal = controller.signal;
    assertSignal(signal);
    const audio = this.#options.audio.prepare();
    assertSignal(signal);
    const gate = audio.createGain();
    gate.gain.value = 0;
    const root = project.contexts.find(context => !context.parentId)!;
    const session = new SessionTransport(() => audio.currentTime);
    const context = new ModuleContext({id: root.id, audio: this.#options.audio, session, destination: () => gate});
    const graph: Graph = {project, controller, gate, session, context, contexts: new Map([[root.id, context]]), defaultOwners: new Map([[root.id, undefined]]),
      instances: new Map(), handles: new Map(), macros: new Map(), leases: [], connectionLeases: new Map(), modulationLeases: new Map(), automationLeases: new Map(), diagnostics: [], disposed: false};
    try {
      const destination = this.#options.destination?.() ?? audio.destination;
      if (destination.context !== audio || destination === gate) throw new Error('Project output destination must belong to its AudioContext.');
      gate.connect(destination);
      const assets = new Map(project.assets.map(asset => [asset.id, asset]));
      const prepareContext = async (record: ProjectContextRecord): Promise<void> => {
        assertSignal(signal);
        const parent = record.parentId ? graph.contexts.get(record.parentId) : context;
        let scope: ModuleContext | undefined = record.parentId ? undefined : context;
        if (record.parentId && parent) {
          const fresh = parent.derive({id: record.id, registry: new ModuleRegistry()});
          try {
            let defaultOwner = graph.defaultOwners.get(record.parentId);
            if (!record.ownerModuleId) scope = fresh;
            else {
              const owner = graph.instances.get(record.ownerModuleId);
              if (owner?.childContext) {
                scope = owner.childContext(fresh);
                if (scope && (scope.admit !== fresh.admit || scope.destination !== fresh.destination)) {
                  defaultOwner = owner.ports?.some(port => port.kind === 'audio' && port.direction === 'input') ? record.ownerModuleId : undefined;
                }
              }
            }
            if (scope && (scope.id !== fresh.id || scope.registry !== fresh.registry || scope.audio !== fresh.audio || scope.session !== fresh.session)) throw new Error('A project child context must preserve its ID, registry, audio and Session ownership.');
            if (scope) { graph.contexts.set(record.id, scope); graph.defaultOwners.set(record.id, defaultOwner); }
            else this.#cleanup(() => fresh.registry.dispose());
          } catch (error) { this.#cleanup(() => fresh.registry.dispose()); throw error; }
        }
        if (!scope) graph.diagnostics.push({kind: 'context', id: record.id, reason: 'Parent context or owner plugin is unresolved.'});
        for (const moduleRecord of project.modules.filter(module => module.contextId === record.id)) {
          assertSignal(signal);
          const factory = this.#options.plugins.get(moduleRecord.plugin.id, moduleRecord.plugin.version);
          if (!scope || !factory) {
            graph.diagnostics.push({kind: 'module', id: moduleRecord.id, reason: !scope ? 'Module context is unresolved.' : `Missing plugin ${moduleRecord.plugin.id}@${moduleRecord.plugin.version}.`});
            continue;
          }
          const asset = (role: string) => { const id = moduleRecord.assets?.[role]; return id === undefined ? undefined : assets.get(id); };
          const instance = await abortable(factory.create({record: moduleRecord, context: scope, signal, asset,
            resolveAsset: async (role) => {
              assertSignal(signal);
              const reference = asset(role);
              if (!reference) throw new Error(`Missing asset role ${role} for ${moduleRecord.id}.`);
              if (!this.#options.resolveAsset) throw new Error('No project asset resolver was supplied.');
              return abortable(Promise.resolve(this.#options.resolveAsset(reference, signal)), signal);
            },
          }), signal, value => { if (!this.#ownedInstances.has(value)) this.#disposeInstance(value); });
          if (this.#ownedInstances.has(instance)) throw new Error('Project factories must return fresh owned instances.');
          this.#ownedInstances.add(instance);
          graph.instances.set(moduleRecord.id, instance);
          if (instance.module.id !== moduleRecord.id || typeof instance.dispose !== 'function') throw new Error('Plugin instance must preserve its stable module ID and provide disposal.');
          graph.handles.set(moduleRecord.id, createModuleHandle(instance.module));
          const registered = scope.registry.get(moduleRecord.id);
          if (registered && registered !== instance.module) throw new Error(`Different module is already registered: ${moduleRecord.id}.`);
          if (!registered) graph.leases.push(scope.registry.register(instance.module));
          await abortable(instance.module.prepare?.(), signal);
          for (const [id, value] of Object.entries(moduleRecord.params ?? {})) {
            const parameter = instance.module.params?.get(id);
            if (!parameter) throw new Error(`Unknown saved parameter ${moduleRecord.id}.${id}.`);
            parameter.setBaseValue(value);
            assertSignal(signal);
          }
          for (const parameter of instance.module.params ?? []) {
            let baseRevision = parameter.snapshot.baseRevision;
            graph.leases.push(createConnectionLease(parameter.subscribe(snapshot => {
              const baseChanged = snapshot.baseRevision !== baseRevision;
              baseRevision = snapshot.baseRevision;
              this.#observe(graph, baseChanged || snapshot.disposed || this.#uncapturedParameterState(graph, moduleRecord.id, parameter.descriptor.id, snapshot.baseValue));
            })));
          }
          if (instance.module.subscribe) graph.leases.push(createConnectionLease(instance.module.subscribe(() => this.#observe(graph))));
        }
        for (const child of project.contexts.filter(child => child.parentId === record.id)) await prepareContext(child);
      };
      await prepareContext(root);
      this.#validateAudioTopology(graph, project);
      // Replacement intentions break their normal routes together, so document
      // ordering cannot create an intermediate cycle in an otherwise valid graph.
      const normalRoutes = new Map<AudioOutputPort, AudioNode | undefined>();
      for (const connection of project.connections) {
        if (connection.kind !== 'audio' || (connection.mode ?? 'replace') !== 'replace') continue;
        const source = graph.instances.get(connection.from.moduleId)?.module.getPort?.(connection.from.port);
        if (!source) continue;
        if (normalRoutes.has(source)) throw new Error('Aliased audio output ports cannot have multiple replacement claims.');
        normalRoutes.set(source, source.defaultDestination);
        source.setDefault(undefined);
      }
      for (const connection of project.connections) {
        const lease = await this.#connect(graph, connection, graph.diagnostics);
        if (lease) graph.connectionLeases.set(connection.id, lease);
        assertSignal(signal);
      }
      for (const [source, normal] of normalRoutes) source.setDefault(normal);
      for (const record of project.modulations) {
        const lease = this.#connectModulation(graph, record, graph.diagnostics);
        if (lease) graph.modulationLeases.set(record.id, lease);
        assertSignal(signal);
      }
      for (const record of project.macros) {
        const targets = record.targets.map(target => ({target: this.#parameter(graph, target), min: target.min, max: target.max}));
        if (targets.some(target => !target.target)) { graph.diagnostics.push({kind: 'macro', id: record.id, reason: 'Macro parameter is unresolved.'}); continue; }
        const macro = new ParamMacro(targets as {target: ParamHandle; min: number; max: number}[], {value: record.value});
        graph.macros.set(record.id, macro);
        graph.leases.push(createConnectionLease(macro.subscribe(() => this.#observe(graph))));
      }
      await this.#command(session.setRate(project.session.rate), signal);
      if (project.session.loop) await this.#command(session.setLoop(project.session.loop), signal);
      await this.#command(session.seek(project.session.positionSeconds), signal);
      for (const record of project.automation) {
        if (record.enabled === false) continue;
        const target = this.#parameter(graph, record.target);
        if (!target) { graph.diagnostics.push({kind: 'automation', id: record.id, reason: 'Automation parameter is unresolved.'}); continue; }
        const lease = attachSessionAutomation(session.scheduling, audio, target, record.points, {loop: record.loop, initialValue: record.initialValue,
          onRelease: () => this.#observe(graph), onError: error => {
          graph.diagnostics.push({kind: 'automation', id: record.id, reason: `Automation stopped: ${String(error)}`});
          this.#observe(graph);
        }});
        graph.automationLeases.set(record.id, lease);
        assertSignal(signal);
      }
      graph.leases.push(createConnectionLease(session.subscribe(() => this.#observe(graph))));
      return graph;
    } catch (error) { this.#disposeGraph(graph); throw error; }
  }

  async #connect(graph: Graph, connection: ProjectConnectionRecord, diagnostics: ProjectDiagnostic[]): Promise<ConnectionLease | undefined> {
    assertSignal(graph.controller.signal);
    const from = graph.instances.get(connection.from.moduleId), to = graph.instances.get(connection.to.moduleId);
    if (connection.kind === 'audio') {
      const source = from?.module.getPort?.(connection.from.port), target = to?.getInput?.(connection.to.port);
      if (source && target) return source[connection.mode ?? 'replace'](target);
      diagnostics.push({kind: 'connection', id: connection.id, reason: 'Audio source or destination is unresolved.'});
      if (source && (connection.mode ?? 'replace') === 'replace') {
        const silence = source.context.createGain();
        let replacement: ConnectionLease;
        try { replacement = source.replace(silence); }
        catch (error) { this.#cleanup(() => silence.disconnect()); throw error; }
        return createConnectionLease(() => { try { replacement.release(); } finally { silence.disconnect(); } });
      }
      return undefined;
    }
    if (from && to && this.#options.connect) {
      const lease = await abortable(this.#options.connect({connection, from, to, context: graph.context, signal: graph.controller.signal}), graph.controller.signal, value => this.#retire(value));
      if (lease !== undefined) {
        if (!lease || lease.active !== true || typeof lease.release !== 'function') {
          this.#retire(lease);
          throw new Error('A project connector must return an active connection lease.');
        }
        return lease;
      }
    }
    diagnostics.push({kind: 'connection', id: connection.id, reason: 'Signal endpoints or a matching connector are unavailable.'});
    return undefined;
  }
  #connectModulation(graph: Graph, record: ProjectModulationRecord, diagnostics: ProjectDiagnostic[]): ParamMapping | undefined {
    const source = graph.instances.get(record.source.moduleId)?.getControl?.(record.source.port);
    const target = this.#parameter(graph, record.target);
    if (!source || !target) { diagnostics.push({kind: 'modulation', id: record.id, reason: 'Control source or parameter is unresolved.'}); return undefined; }
    return target.connectModulation(source, {depth: record.depth, polarity: record.polarity});
  }
  #validateAudioTopology(graph: Graph, project: ModuleProject): void {
    const routes = new Map<string, Set<string>>();
    const replaced = new Set(project.connections.filter(connection => connection.kind === 'audio' && (connection.mode ?? 'replace') === 'replace').map(connection => JSON.stringify(connection.from)));
    const add = (from: string, to: string) => { const targets = routes.get(from) ?? new Set<string>(); targets.add(to); routes.set(from, targets); };
    for (const record of project.modules) {
      const owner = graph.defaultOwners.get(record.contextId), instance = graph.instances.get(record.id);
      if (!owner || !instance) continue;
      for (const descriptor of instance.ports ?? []) {
        if (descriptor.kind !== 'audio' || descriptor.direction !== 'output') continue;
        if (replaced.has(JSON.stringify({moduleId: record.id, port: descriptor.id}))) continue;
        if (instance.module.getPort?.(descriptor.id)?.defaultDestination) add(record.id, owner);
      }
    }
    for (const connection of project.connections) {
      if (connection.kind !== 'audio') continue;
      if (graph.instances.get(connection.from.moduleId)?.module.getPort?.(connection.from.port)
        && graph.instances.get(connection.to.moduleId)?.getInput?.(connection.to.port)) add(connection.from.moduleId, connection.to.moduleId);
    }
    const degrees = new Map<string, number>();
    for (const [source, targets] of routes) {
      if (!degrees.has(source)) degrees.set(source, 0);
      for (const target of targets) degrees.set(target, (degrees.get(target) ?? 0) + 1);
    }
    const ready = [...degrees.keys()].filter(id => degrees.get(id) === 0);
    for (let index = 0; index < ready.length; index++) for (const target of routes.get(ready[index]!) ?? []) {
      const remaining = degrees.get(target)! - 1;
      degrees.set(target, remaining);
      if (remaining === 0) ready.push(target);
    }
    if (ready.length !== degrees.size) throw new Error('Project routes would create feedback through a nested default bus.');
  }
  #parameter(graph: Graph, target: {moduleId: string; param: string}): ParamHandle | undefined { return graph.instances.get(target.moduleId)?.module.params?.get(target.param); }
  async #command(command: Promise<TransportCommit>, signal: AbortSignal): Promise<void> {
    const result = await abortable(command, signal);
    if (result.status !== 'committed') throw new Error('Project Session preparation was superseded.');
  }
  #activate(candidate: Graph, pending: Pending, prepared: ProjectRuntimeSnapshot): ProjectRuntimeSnapshot {
    this.#assertPending(pending);
    const previous = this.#graph;
    const time = candidate.gate.context.currentTime;
    let committed!: ProjectRuntimeSnapshot;
    this.#committing = true;
    try {
      candidate.gate.gain.setValueAtTime(1, time);
      this.#assertPending(pending);
      previous?.gate.gain.setValueAtTime(0, time);
      this.#assertPending(pending);
      committed = Object.freeze({...prepared, revision: this.#revision + 1, restoring: false, disposed: false});
      this.#graph = candidate;
      this.#pending = undefined;
      this.#revision = committed.revision;
    } catch (error) {
      try { candidate.gate.gain.setValueAtTime(0, time); } catch (cleanup) { this.#report(cleanup); }
      try { previous?.gate.gain.setValueAtTime(1, time); } catch (cleanup) { this.#report(cleanup); }
      throw error;
    } finally { this.#committing = false; }
    if (previous) this.#disposeGraph(previous);
    this.#notify(committed.revision, committed);
    return committed;
  }
  #disposeGraph(graph: Graph): void {
    if (graph.disposed) return;
    graph.disposed = true;
    this.#cleanup(() => { graph.gate.gain.value = 0; });
    this.#cleanup(() => graph.controller.abort());
    this.#cleanup(() => graph.session.dispose());
    for (const lease of [...graph.connectionLeases.values()].reverse()) this.#retire(lease);
    for (const lease of graph.modulationLeases.values()) this.#retire(lease);
    for (const lease of graph.automationLeases.values()) this.#retire(lease);
    for (const lease of graph.leases.reverse()) this.#retire(lease);
    for (const macro of graph.macros.values()) this.#cleanup(() => macro.dispose());
    for (const instance of [...graph.instances.values()].reverse()) this.#disposeInstance(instance);
    for (const context of [...graph.contexts.values()].reverse()) this.#cleanup(() => context.registry.dispose());
    this.#cleanup(() => graph.gate.disconnect());
  }
  #disposeInstance(instance: ProjectModuleInstance): void { this.#cleanup(() => instance?.dispose?.()); }
  #retire(lease?: ConnectionLease): void { this.#cleanup(() => lease?.release()); }
  #cleanup(callback: () => void): void { try { callback(); } catch (error) { this.#report(error); } }
  #report(error: unknown): void {
    try {
      const result: unknown = this.#options.onCleanupError?.(error);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(() => {});
    } catch { /* Diagnostics do not own resources. */ }
  }
  #assertActive(): void { if (this.#disposed) throw new Error('ModuleProjectRuntime is disposed.'); }
  #requireGraph(): Graph { this.#assertActive(); if (!this.#graph) throw new Error('No module project is active.'); return this.#graph; }
  #requireEditable(): Graph {
    const graph = this.#requireGraph();
    if (this.#pending || this.#editing || this.#committing) throw new Error('Project edits cannot overlap restore or another edit.');
    return graph;
  }
  #assertPending(pending: Pending): void {
    if (this.#disposed || this.#pending !== pending || pending.generation !== this.#generation) throw aborted();
    assertSignal(pending.controller.signal);
  }
  #uncapturedParameterState(graph: Graph, moduleId: string, parameterId: string, baseValue: number): boolean {
    const captured = this.#preparedEdit;
    if (!captured || captured.graph !== graph) return true;
    // Immediate automation can change the modeled base without a manual base
    // write, so its value also needs comparison with the saved capture.
    return captured.project.modules.find(record => record.id === moduleId)?.params?.[parameterId] !== baseValue || captured.project.modulations.some(record => {
      const mapping = graph.modulationLeases.get(record.id);
      return mapping !== undefined && mapping.depth !== record.depth;
    }) || captured.project.automation.some(record => {
      const automation = graph.automationLeases.get(record.id);
      return automation !== undefined && automation.active !== (record.enabled !== false);
    });
  }
  #observe(graph: Graph, affectsSavedState = true): void {
    if (this.#graph !== graph || graph.disposed) return;
    // The prepared project already captures this edit's CV metadata changes;
    // actual base writes still need delivery if they occur after that capture.
    if (this.#editing) { if (affectsSavedState) this.#editObserved = true; }
    else this.#changed();
  }
  #changed(): void {
    this.#notify(++this.#revision);
  }
  #notify(revision: number, snapshot?: ProjectRuntimeSnapshot): void {
    for (const listener of [...this.#listeners]) {
      if (revision !== this.#revision) break;
      if (this.#listeners.has(listener)) this.#call(listener, snapshot);
    }
  }
  #call(listener: (snapshot: ProjectRuntimeSnapshot) => void, snapshot?: ProjectRuntimeSnapshot): void {
    try {
      const result: unknown = listener(snapshot ?? this.snapshot());
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(error => this.#report(error));
    } catch (error) { this.#report(error); }
  }
}
