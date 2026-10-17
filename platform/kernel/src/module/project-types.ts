import type {SessionTransport} from '../session';
import type {ModuleAudioEnvironment, ModuleContext} from './context';
import type {ConnectionLease} from './lease';
import type {ControlSignal} from './param-audio';
import type {ModuleHandle} from './registry';

export type ProjectJson = null | boolean | number | string | readonly ProjectJson[] | ProjectJsonObject;
export interface ProjectJsonObject { readonly [key: string]: ProjectJson }
export interface ProjectPluginReference { readonly id: string; readonly version: string }
export interface ProjectAssetReference {
  readonly id: string;
  readonly uri: string;
  readonly mediaType?: string;
  readonly integrity?: string;
}
export interface ProjectContextRecord {
  readonly id: string;
  readonly parentId?: string;
  /** An owner in the direct parent context supplies the nested audio/admission bus. */
  readonly ownerModuleId?: string;
}
export interface ProjectModuleRecord {
  readonly id: string;
  readonly plugin: ProjectPluginReference;
  readonly contextId: string;
  readonly label?: string;
  readonly config: ProjectJsonObject;
  /** Named asset roles point at project asset IDs; Kernel never fetches these URIs. */
  readonly assets?: Readonly<Record<string, string>>;
  readonly params?: Readonly<Record<string, number>>;
}
export type ProjectSignalKind = 'audio' | 'control' | 'note' | 'transport' | 'source';
export interface ProjectEndpoint { readonly moduleId: string; readonly port: string }
export interface ProjectParamEndpoint { readonly moduleId: string; readonly param: string }
export interface ProjectConnectionRecord {
  readonly id: string;
  readonly kind: ProjectSignalKind;
  readonly from: ProjectEndpoint;
  readonly to: ProjectEndpoint;
  readonly mode?: 'replace' | 'send' | 'tap';
}
export interface ProjectModulationRecord {
  readonly id: string;
  readonly source: ProjectEndpoint;
  readonly target: ProjectParamEndpoint;
  readonly depth: number;
  readonly polarity?: 'bipolar' | 'unipolar';
}
export interface ProjectMacroRecord {
  readonly id: string;
  readonly label?: string;
  readonly value: number;
  readonly targets: readonly (ProjectParamEndpoint & {readonly min: number; readonly max: number})[];
}
export interface ProjectAutomationPoint {
  readonly type: 'set' | 'linear' | 'exponential';
  readonly value: number;
  readonly timeSeconds: number;
}
export interface ProjectAutomationRecord {
  readonly id: string;
  readonly target: ProjectParamEndpoint;
  readonly points: readonly ProjectAutomationPoint[];
  readonly loop?: 'repeat' | 'once';
  /** A manual base edit can suspend a track without discarding its authored points. */
  readonly enabled?: boolean;
  /** Baseline before the first authored point; preserved independently of current base value. */
  readonly initialValue?: number;
}
export interface ProjectModuleLayout {
  readonly moduleId: string;
  readonly x: number;
  readonly y: number;
  readonly collapsed?: boolean;
}
export interface ProjectLayout { readonly modules: readonly ProjectModuleLayout[] }
export interface ProjectSessionState {
  /** Unwrapped Session seconds, preserving once-only automation and LFO phase across loop passes. */
  readonly positionSeconds: number;
  readonly rate: number;
  readonly loop?: Readonly<{startSeconds: number; endSeconds: number}> | null;
}
/** Serializable project state. DSP objects, DOM, storage and undo history are deliberately absent. */
export interface ModuleProject {
  readonly schema: 'webmusic.module-project';
  readonly version: 1;
  readonly id: string;
  readonly contexts: readonly ProjectContextRecord[];
  readonly modules: readonly ProjectModuleRecord[];
  readonly assets: readonly ProjectAssetReference[];
  readonly connections: readonly ProjectConnectionRecord[];
  readonly modulations: readonly ProjectModulationRecord[];
  readonly macros: readonly ProjectMacroRecord[];
  readonly automation: readonly ProjectAutomationRecord[];
  readonly session: ProjectSessionState;
  readonly layout: ProjectLayout;
}

export interface ProjectPortDescriptor {
  readonly id: string;
  readonly label?: string;
  readonly kind: ProjectSignalKind;
  readonly direction: 'input' | 'output';
}
export interface ProjectFactoryRequest {
  readonly record: ProjectModuleRecord;
  readonly context: ModuleContext;
  readonly signal: AbortSignal;
  asset(role: string): ProjectAssetReference | undefined;
  resolveAsset(role: string): Promise<unknown>;
}
/** Exclusively owned by one staged graph. Factories must respect context.destination and must not publish externally. */
export interface ProjectModuleInstance {
  readonly module: ModuleHandle;
  readonly ports?: readonly ProjectPortDescriptor[];
  getInput?(port: string): AudioNode | undefined;
  getControl?(port: string): ControlSignal | undefined;
  /** Enrich a fresh child scope; keep its ID, registry and shared AudioEnvironment. */
  childContext?(context: ModuleContext): ModuleContext;
  /** Capture live serializable configuration such as oscillator waveform. */
  exportConfig?(): ProjectJsonObject;
  dispose(): void;
}
export interface ProjectPluginFactory extends ProjectPluginReference {
  /** Must return a fresh, exclusively owned instance, even when replacing the same stable ID. */
  create(request: ProjectFactoryRequest): ProjectModuleInstance | Promise<ProjectModuleInstance>;
}
export interface ProjectConnectionRequest {
  readonly connection: ProjectConnectionRecord;
  readonly from: ProjectModuleInstance;
  readonly to: ProjectModuleInstance;
  readonly context: ModuleContext;
  readonly signal: AbortSignal;
}
/** Adapters explicitly opt in to domain signals; undefined means retained unresolved. */
export type ProjectConnector = (request: ProjectConnectionRequest) => ConnectionLease | undefined | Promise<ConnectionLease | undefined>;
export interface ProjectRuntimeOptions {
  /** Borrowed environment/context. Disposing a project never closes it. */
  readonly audio: ModuleAudioEnvironment;
  readonly plugins: ProjectPluginLookup;
  readonly destination?: () => AudioNode | undefined;
  readonly resolveAsset?: (asset: ProjectAssetReference, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly connect?: ProjectConnector;
  readonly onCleanupError?: (error: unknown) => void;
}
export interface ProjectPluginLookup { get(id: string, version: string): ProjectPluginFactory | undefined }
export interface ProjectDiagnostic {
  readonly kind: 'module' | 'context' | 'connection' | 'modulation' | 'macro' | 'automation';
  readonly id: string;
  readonly reason: string;
}
export interface ProjectRuntimeModule {
  readonly record: ProjectModuleRecord;
  readonly status: 'ready' | 'unresolved';
  readonly ports: readonly ProjectPortDescriptor[];
  /** Effective audio owner established by the context's destination/admission, inherited through organizational scopes. */
  readonly defaultOwnerModuleId?: string;
  readonly diagnostic?: string;
}
export interface ProjectRuntimeSnapshot {
  readonly project?: ModuleProject;
  readonly revision: number;
  readonly restoring: boolean;
  readonly disposed: boolean;
  readonly modules: readonly ProjectRuntimeModule[];
  readonly unresolved: readonly ProjectDiagnostic[];
}
export interface ProjectRestoreOptions {
  readonly signal?: AbortSignal;
  /** Restore remains paused by default; the caller owns any user-gesture resume policy. */
  readonly play?: boolean;
}
export interface ProjectRestoreResult {
  readonly status: 'committed' | 'cancelled';
  readonly snapshot: ProjectRuntimeSnapshot;
}
/** Borrowed current resources; disposal stays with ModuleProjectRuntime. */
export interface ProjectRuntimeResources {
  readonly context: ModuleContext;
  readonly session: SessionTransport;
  module(id: string): ModuleHandle | undefined;
}
