import {getAudioContextConstructor} from '../audio-context';
import type {SessionTransport} from '../session';
import type {AudioOutputPort} from './audio-port';
import {ModuleCapabilities} from './capability';
import {createConnectionLease, type ConnectionLease} from './lease';
import {assertModuleId, ModuleRegistry, type ModuleHandle} from './registry';

export interface ModuleAudioEnvironmentOptions {
  context?: BaseAudioContext;
  create?: () => BaseAudioContext;
  /** Factory-created contexts are owned by default. Explicitly injected contexts always remain borrowed. */
  owned?: boolean;
}

/** Explicit lazy allocation. Reading/discovering this environment never allocates or resumes audio. */
export class ModuleAudioEnvironment {
  #context?: BaseAudioContext;
  readonly #create: () => BaseAudioContext;
  readonly #owned: boolean;
  #disposed = false;
  #preparing = false;

  constructor(options: ModuleAudioEnvironmentOptions = {}) {
    this.#context = options.context;
    this.#owned = !options.context && (options.owned ?? true);
    this.#create = options.create ?? (() => {
      const Constructor = getAudioContextConstructor();
      if (!Constructor) throw new Error('AudioContext is unavailable');
      return new Constructor();
    });
  }
  get disposed(): boolean { return this.#disposed; }
  peek(): BaseAudioContext | undefined { return this.#context; }
  prepare(): BaseAudioContext {
    if (this.#disposed) throw new Error('ModuleAudioEnvironment is disposed');
    if (this.#preparing) throw new Error('Module audio preparation cannot re-enter');
    if (this.#context) {
      if (this.#context.state === 'closed') throw new Error('Module audio context is closed');
      return this.#context;
    }
    this.#preparing = true;
    try {
      const context = this.#create();
      if (this.#disposed) {
        if (this.#owned) this.#close(context);
        throw new Error('ModuleAudioEnvironment was disposed during preparation');
      }
      if (context.state === 'closed') throw new Error('Module audio context is closed');
      this.#context = context;
      return context;
    } finally { this.#preparing = false; }
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const context = this.#context;
    this.#context = undefined;
    if (this.#owned && context) this.#close(context);
  }
  #close(context: BaseAudioContext): void {
    if ('close' in context && typeof context.close === 'function' && context.state !== 'closed') {
      void Promise.resolve(context.close()).catch(() => {});
    }
  }
}

export type ModuleAdmission = (module: ModuleHandle, port: AudioOutputPort) => ConnectionLease;

export interface ModuleContextOptions {
  id: string;
  audio: ModuleAudioEnvironment;
  registry?: ModuleRegistry;
  session?: SessionTransport;
  destination?: () => AudioNode | undefined;
  admit?: ModuleAdmission;
  target?: ModuleHandle;
  capabilities?: ModuleCapabilities;
}

export interface DerivedModuleContextOptions {
  id: string;
  registry?: ModuleRegistry;
  session?: SessionTransport | null;
  destination?: () => AudioNode | undefined;
  admit?: ModuleAdmission | null;
  target?: ModuleHandle | null;
  capabilities?: ModuleCapabilities;
}

/** Explicit borrowed context. Inheritance is an explicit derive operation, never a DOM lookup. */
export class ModuleContext {
  readonly id: string;
  readonly audio: ModuleAudioEnvironment;
  readonly registry: ModuleRegistry;
  readonly session?: SessionTransport;
  readonly destination?: () => AudioNode | undefined;
  readonly admit?: ModuleAdmission;
  readonly target?: ModuleHandle;
  readonly capabilities: ModuleCapabilities;

  constructor(options: ModuleContextOptions) {
    assertModuleId(options.id);
    this.id = options.id;
    this.audio = options.audio;
    this.registry = options.registry ?? new ModuleRegistry();
    this.session = options.session;
    this.destination = options.destination;
    this.admit = options.admit;
    this.target = options.target;
    this.capabilities = options.capabilities ?? new ModuleCapabilities();
    Object.freeze(this);
  }

  derive(options: DerivedModuleContextOptions): ModuleContext {
    return new ModuleContext({
      id: options.id,
      audio: this.audio,
      registry: options.registry ?? this.registry,
      session: options.session === undefined ? this.session : options.session ?? undefined,
      destination: options.destination ?? this.destination,
      admit: options.admit === undefined ? this.admit : options.admit ?? undefined,
      target: options.target === undefined ? this.target : options.target ?? undefined,
      capabilities: options.capabilities ?? this.capabilities,
    });
  }
}

/**
 * How a republished context relates to the previous one. `none`: same audio
 * environment, Session, registry, admission and destination resolver (a new
 * target alone keeps the scope). `destination`: only the default destination
 * resolver changed, so existing members can re-route in place. `scope`: any
 * other change, or a missing side, requires rebinding.
 */
export function moduleScopeChange(previous: ModuleContext | undefined, next: ModuleContext | undefined): 'none' | 'destination' | 'scope' {
  if (!previous || !next || previous.audio !== next.audio || previous.session !== next.session ||
    previous.registry !== next.registry || previous.admit !== next.admit) return 'scope';
  return previous.destination === next.destination ? 'none' : 'destination';
}

/** Whether two contexts grant the same resource relationships; see {@link moduleScopeChange}. */
export function sameModuleScope(left: ModuleContext | undefined, right: ModuleContext | undefined): boolean {
  return moduleScopeChange(left, right) === 'none';
}

/**
 * Establish a module output's normal route in a scope: the scope's admission
 * when present, otherwise its default destination (or the audio environment's
 * speakers). Releasing the lease retracts only the default this call installed.
 */
export function routeModuleOutput(context: ModuleContext, module: ModuleHandle, port: AudioOutputPort): ConnectionLease {
  if (context.admit) return context.admit(module, port);
  const destination = context.destination?.() ?? context.audio.prepare().destination;
  port.setDefault(destination);
  return createConnectionLease(() => {
    if (!port.disposed && port.defaultDestination === destination) port.setDefault(undefined);
  });
}
