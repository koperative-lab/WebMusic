import {SessionTransport, type ModuleSession, type SessionTransportOptions} from '../session';
import {ModuleAudioEnvironment, ModuleContext, type ModuleAdmission, type ModuleAudioEnvironmentOptions} from './context';
import type {ModuleRegistry, ModuleHandle} from './registry';

export interface ProviderScopeOptions {
  /** ID of the derived child context. */
  id: string;
  /** The context this provider borrows, or undefined at a composition root. */
  parent: ModuleContext | undefined;
  /** The host declared `session="local"`: own a Session even when one is inherited. */
  local?: boolean;
  /** Audio environment created only when there is no parent. */
  audio?: ModuleAudioEnvironmentOptions;
  /** Destination resolver for the root context (ignored when a parent exists). */
  destination?: () => AudioNode | undefined;
  registry?: ModuleRegistry;
  admit?: ModuleAdmission | null;
  target?: ModuleHandle | null;
  /** Options for an owned Session; `now` defaults to the audio environment's clock. */
  session?: SessionTransportOptions & {now?: () => number};
}

/** A provider's derived context plus the resources it created and must release. */
export interface ProviderScope {
  readonly context: ModuleContext;
  readonly session: ModuleSession;
  /** Present when this provider owns the Session (root or `session="local"`). */
  readonly ownedSession?: SessionTransport;
  /** Present when this provider created the audio environment (no parent). */
  readonly ownedAudio?: ModuleAudioEnvironment;
  /** Dispose the owned Session, then the owned audio environment. Idempotent. */
  dispose(): void;
}

/**
 * Session election shared by every provider Element (DEC-068): the outermost
 * provider — a player, Rack or Mixer — owns the Session; nested providers
 * borrow it unless they declare `session="local"`. A root without a parent
 * also creates the audio environment. Creating the scope allocates no audio
 * context; the environment stays lazy.
 */
export function createProviderScope(options: ProviderScopeOptions): ProviderScope {
  const {parent} = options;
  const ownedAudio = parent ? undefined : new ModuleAudioEnvironment(options.audio);
  const audio = parent?.audio ?? ownedAudio!;
  const inherited = options.local ? undefined : parent?.session;
  const ownedSession = inherited ? undefined
    : new SessionTransport(options.session?.now ?? (() => audio.peek()?.currentTime ?? 0), options.session);
  const session: ModuleSession = inherited ?? ownedSession!;
  let context: ModuleContext;
  try {
    const relation = {
      id: options.id, session, registry: options.registry,
      ...(options.admit !== undefined ? {admit: options.admit} : {}),
      ...(options.target !== undefined ? {target: options.target} : {}),
    };
    context = parent
      ? parent.derive(relation)
      : new ModuleContext({...relation, audio, destination: options.destination,
        admit: options.admit ?? undefined, target: options.target ?? undefined});
  } catch (error) {
    ownedSession?.dispose();
    ownedAudio?.dispose();
    throw error;
  }
  let disposed = false;
  return Object.freeze({
    context, session, ownedSession, ownedAudio,
    dispose() {
      if (disposed) return;
      disposed = true;
      let failure: unknown;
      try { ownedSession?.dispose(); } catch (error) { failure = error; }
      try { ownedAudio?.dispose(); } catch (error) { failure ??= error; }
      if (failure !== undefined) throw failure;
    },
  });
}
