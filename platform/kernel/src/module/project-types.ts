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
export type ProjectSignalKind = 'audio' | 'control' | 'note' | 'transport' | 'source' | 'message';
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
/** A text note on the canvas of one context (DEC-076). */
export interface ProjectComment {
  readonly id: string;
  readonly contextId: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
}
/** Modules selected and moved together. */
export interface ProjectGroup { readonly id: string; readonly moduleIds: readonly string[] }
export interface ProjectLayout {
  readonly modules: readonly ProjectModuleLayout[];
  /**
   * The presentation view (DEC-076): the modules it shows and where. A module
   * without an entry is absent from presentation.
   */
  readonly presentation?: readonly ProjectModuleLayout[];
  readonly comments?: readonly ProjectComment[];
  readonly groups?: readonly ProjectGroup[];
}
/** What drives a mapped parameter: a MIDI controller, pitch bend, program change or a computer key. */
export type ProjectMappingSource =
  | {readonly kind: 'cc'; readonly controller: number; readonly channel?: number}
  | {readonly kind: 'pitchbend'; readonly channel?: number}
  | {readonly kind: 'program'; readonly channel?: number}
  | {readonly kind: 'key'; readonly key: string};
/** One mapping from a control source to a parameter (DEC-076). */
export interface ProjectMappingRecord {
  readonly id: string;
  readonly source: ProjectMappingSource;
  readonly target: ProjectParamEndpoint;
  /** Target range the source's 0–1 maps onto; defaults to the parameter's display range. */
  readonly min?: number;
  readonly max?: number;
}
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
  /** Control mappings (DEC-076); absent means none. */
  readonly mappings?: readonly ProjectMappingRecord[];
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
  /**
   * Called once after the graph holding this instance commits, before
   * observers hear of it; a candidate graph that never commits is disposed
   * without activation. Message objects start timers and fire `loadbang` here.
   */
  activate?(): void;
  dispose(): void;
}
/**
 * Thrown by a plugin factory when its module cannot exist in this environment
 * (a capability, preparation or resource it needs is unavailable). Restoration
 * keeps the record unresolved with this message, exactly like a missing
 * plugin, instead of failing; any other error still fails the restore.
 */
export class ProjectModuleUnavailableError extends Error {
  /** The underlying failure, when there is one. */
  readonly cause?: unknown;
  constructor(message: string, options?: {cause?: unknown}) {
    super(message);
    this.name = 'ProjectModuleUnavailableError';
    if (options && 'cause' in options) this.cause = options.cause;
  }
}

/** True for {@link ProjectModuleUnavailableError}, also across duplicate package copies. */
export function isProjectModuleUnavailable(error: unknown): error is ProjectModuleUnavailableError {
  return error instanceof ProjectModuleUnavailableError || (error instanceof Error && error.name === 'ProjectModuleUnavailableError');
}

export interface ProjectPluginFactory extends ProjectPluginReference {
  /**
   * Must return a fresh, exclusively owned instance, even when replacing the
   * same stable ID. Throw {@link ProjectModuleUnavailableError} to leave the
   * module unresolved.
   */
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
