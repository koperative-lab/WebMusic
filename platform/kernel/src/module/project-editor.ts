import type {ModuleProjectRuntime} from './project-runtime';
import type {ProjectEndpoint, ProjectSignalKind} from './project-types';

export interface ProjectEditorPort {
  readonly id: string;
  readonly label?: string;
  readonly direction: 'input' | 'output';
  readonly kind: ProjectSignalKind;
  /** Present only for a synthetic parameter input. Native plugin port IDs remain unchanged. */
  readonly parameterId?: string;
}
export interface ProjectEditorModule {
  readonly id: string;
  readonly label: string;
  readonly ports: readonly ProjectEditorPort[];
  readonly position?: {readonly x: number; readonly y: number};
  readonly status: 'ready' | 'unresolved';
  readonly diagnostic?: string;
}
export interface ProjectEditorConnection {
  readonly id: string;
  readonly from: ProjectEndpoint;
  readonly to: ProjectEndpoint;
  readonly mode: 'connect' | 'replace' | 'send' | 'tap' | 'default';
  readonly status: 'connected' | 'unresolved';
  readonly diagnostic?: string;
  readonly editable?: boolean;
}
export interface ProjectEditorState {
  readonly modules: readonly ProjectEditorModule[];
  readonly connections: readonly ProjectEditorConnection[];
  readonly disabled: boolean;
}
export interface ProjectEditorConnectRequest {
  readonly from: ProjectEndpoint;
  readonly to: ProjectEndpoint;
  readonly mode: 'connect' | 'replace' | 'send' | 'tap';
}
export interface ProjectEditorBinding {
  snapshot(): ProjectEditorState;
  connect(connection: ProjectEditorConnectRequest): Promise<void>;
  disconnect(id: string): void;
  moveModule(id: string, position: {readonly x: number; readonly y: number}): void;
  subscribe(notify: () => void): () => void;
}
export interface ProjectEditorOptions {
  /** Additive depth in the destination's native unit. Defaults to one unit. */
  readonly modulationDepth?: number;
}

/** Structural presenter adapter. It borrows the runtime; creating/unmounting UI owns no graph. */
export function createProjectEditorBinding(runtime: ModuleProjectRuntime, options: ProjectEditorOptions = {}): ProjectEditorBinding {
  const depth = options.modulationDepth ?? 1;
  if (!Number.isFinite(depth)) throw new RangeError('Editor modulation depth must be finite.');
  let sequence = 0;
  const snapshot = (): ProjectEditorState => {
    const state = runtime.snapshot();
    const project = state.project;
    const parameterPorts = new Map<string, Map<string, string>>();
    const modules: ProjectEditorModule[] = state.modules.map(entry => {
      const ports: ProjectEditorPort[] = [...entry.ports];
      // Lost plugins retain their named plugs and incident wires for inspection/recovery.
      if (entry.status === 'unresolved') {
        const infer = (endpoint: ProjectEndpoint, direction: 'input' | 'output', kind: ProjectSignalKind) => {
          if (endpoint.moduleId === entry.record.id && !ports.some(port => port.id === endpoint.port)) ports.push({id: endpoint.port, direction, kind});
        };
        for (const connection of project?.connections ?? []) {
          infer(connection.from, 'output', connection.kind); infer(connection.to, 'input', connection.kind);
        }
        for (const mapping of project?.modulations ?? []) {
          infer(mapping.source, 'output', 'control');
        }
      }
      const parameters = new Map<string, string>();
      for (const handle of runtime.getModule(entry.record.id)?.params ?? []) {
        if (handle.descriptor.modulation === 'audio-rate' || handle.descriptor.modulation === 'control-rate') {
          parameters.set(handle.descriptor.id, handle.descriptor.label ?? handle.descriptor.id);
        }
      }
      const available = new Set(parameters.keys());
      for (const mapping of project?.modulations ?? []) {
        if (mapping.target.moduleId === entry.record.id && !parameters.has(mapping.target.param)) parameters.set(mapping.target.param, mapping.target.param);
      }
      // Plugin authors may use any port ID, including the presenter's usual param: prefix.
      const occupied = new Set(ports.map(port => port.id));
      const reserved = new Set([...parameters.keys()].map(parameterPort));
      const allocated = new Map<string, string>();
      parameterPorts.set(entry.record.id, allocated);
      for (const [parameterId, label] of [...parameters].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
        const base = parameterPort(parameterId);
        let id = base, suffix = 0;
        while (occupied.has(id)) {
          do { id = `${base}#${++suffix}`; } while (reserved.has(id));
        }
        occupied.add(id);
        allocated.set(parameterId, id);
        if (available.has(parameterId) || entry.status === 'unresolved') ports.push({id, parameterId, label, direction: 'input', kind: 'control'});
      }
      const position = project?.layout.modules.find(layout => layout.moduleId === entry.record.id);
      return {id: entry.record.id, label: entry.record.label ?? entry.record.id, ports, position, status: entry.status, diagnostic: entry.diagnostic};
    });
    const diagnostic = (kind: 'connection' | 'modulation', id: string) => state.unresolved.find(item => item.kind === kind && item.id === id)?.reason;
    const connections: ProjectEditorConnection[] = (project?.connections ?? []).map(record => ({
      id: connectionId(record.id), from: record.from, to: record.to, mode: record.mode ?? (record.kind === 'audio' ? 'replace' : 'connect'),
      status: diagnostic('connection', record.id) ? 'unresolved' : 'connected', diagnostic: diagnostic('connection', record.id),
    }));
    for (const record of project?.modulations ?? []) connections.push({
      id: modulationId(record.id), from: record.source, to: {moduleId: record.target.moduleId,
        port: parameterPorts.get(record.target.moduleId)?.get(record.target.param) ?? parameterPort(record.target.param)}, mode: 'connect',
      status: diagnostic('modulation', record.id) ? 'unresolved' : 'connected', diagnostic: diagnostic('modulation', record.id),
    });
    for (const entry of state.modules) {
      const owner = state.modules.find(module => module.record.id === entry.defaultOwnerModuleId);
      if (!owner || owner.status !== 'ready') continue;
      const inputs = owner.ports.filter(port => port.kind === 'audio' && port.direction === 'input');
      // The runtime identifies the actual owner; several inputs need a richer endpoint contract.
      if (inputs.length !== 1) continue;
      const record = entry.record;
      for (const port of entry.ports) {
        if (port.kind !== 'audio' || port.direction !== 'output') continue;
        const live = runtime.getModule(record.id)?.getPort?.(port.id);
        if (!live?.defaultDestination || live.replaced) continue;
        connections.push({id: `default:${JSON.stringify([record.id, port.id])}`, from: {moduleId: record.id, port: port.id},
          to: {moduleId: owner.record.id, port: inputs[0].id}, mode: 'default', status: 'connected', editable: false});
      }
    }
    return {modules, connections, disabled: state.disposed || state.restoring || !project};
  };
  return Object.freeze({
    snapshot,
    async connect(request: ProjectEditorConnectRequest): Promise<void> {
      const state = snapshot();
      if (state.disabled) throw new Error('The project is not editable.');
      const fromModule = state.modules.find(module => module.id === request.from.moduleId);
      const toModule = state.modules.find(module => module.id === request.to.moduleId);
      if (fromModule?.status !== 'ready' || toModule?.status !== 'ready') throw new Error('The selected module is unavailable.');
      const source = fromModule.ports.find(port => port.id === request.from.port);
      const target = toModule.ports.find(port => port.id === request.to.port);
      if (!source || !target || source.direction !== 'output' || target.direction !== 'input' || source.kind !== target.kind) throw new Error('Choose compatible output and input ports.');
      const project = runtime.exportProject();
      let id: string;
      do { id = `patch-${++sequence}`; } while ([...project.connections, ...project.modulations].some(record => record.id === id));
      if (source.kind !== 'audio' && request.mode !== 'connect') throw new Error('This signal requires connect mode.');
      if (source.kind === 'control' && target.parameterId !== undefined) {
        if (request.mode !== 'connect') throw new Error('A parameter mapping uses connect mode.');
        await runtime.connectModulation({id, source: request.from, target: {moduleId: request.to.moduleId, param: target.parameterId}, depth});
      } else {
        if (source.kind === 'audio' && request.mode === 'connect') throw new Error('Audio patches require replace, send or tap mode.');
        await runtime.connect({id, kind: source.kind, from: request.from, to: request.to, ...(request.mode !== 'connect' && {mode: request.mode})});
      }
    },
    disconnect(id: string): void {
      if (id.startsWith('connection:')) runtime.disconnect(id.slice(11));
      else if (id.startsWith('modulation:')) runtime.disconnectModulation(id.slice(11));
      else throw new Error('Default routes cannot be removed by the editor.');
    },
    moveModule(id: string, position: {readonly x: number; readonly y: number}): void {
      const project = runtime.exportProject();
      if (!project.modules.some(module => module.id === id)) throw new Error(`Unknown module ${id}.`);
      const previous = project.layout.modules.find(layout => layout.moduleId === id);
      runtime.updateLayout({modules: [...project.layout.modules.filter(layout => layout.moduleId !== id), {...previous, moduleId: id, ...position}]});
    },
    subscribe: (notify: () => void) => runtime.subscribe(notify),
  });
}

const parameterPort = (id: string): string => `param:${id}`;
const connectionId = (id: string): string => `connection:${id}`;
const modulationId = (id: string): string => `modulation:${id}`;
