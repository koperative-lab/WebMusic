import type {ModuleSession, SessionTransportSnapshot} from '../session';
import type {SyncLoopRegion, TransportCommit} from '../sync';
import type {PortReadiness} from './port';

/** A transport observation in the port's named axis. */
export interface TransportPortSnapshot {
  readonly revision: number;
  readonly axis: string;
  /** Reference-clock time at which `position` was observed. */
  readonly referenceTime: number;
  readonly position: number;
  /** null while unknown; Infinity for live or unbounded material. */
  readonly durationSeconds: number | null;
  readonly playing: boolean;
  readonly rate: number;
  readonly loop: Readonly<SyncLoopRegion> | null;
  readonly ended: boolean;
  readonly pending: boolean;
  readonly schedulingMode: SessionTransportSnapshot['schedulingMode'];
}

/** A command result. `failed` carries the rejection instead of throwing at the caller. */
export interface TransportPortOutcome {
  readonly status: 'committed' | 'superseded' | 'failed';
  readonly revision: number | null;
  readonly snapshot: TransportPortSnapshot;
  readonly error?: unknown;
}

/** Commands a provider chose to lend. A read-only port has none. */
export interface TransportCommands {
  play(): Promise<TransportPortOutcome>;
  pause(): Promise<TransportPortOutcome>;
  stop(): Promise<TransportPortOutcome>;
  seek(position: number): Promise<TransportPortOutcome>;
  setRate(rate: number): Promise<TransportPortOutcome>;
  setLoop(loop: SyncLoopRegion | null): Promise<TransportPortOutcome>;
}

/** Read side, plus optional lent commands, of one Session. */
export interface TransportPort {
  readonly id: string;
  readonly family: 'transport';
  readonly direction: 'output';
  readonly multiplicity: 'single';
  readonly schemaVersion: number;
  readonly readiness: PortReadiness;
  readonly axis: string;
  readonly commands?: TransportCommands;
  snapshot(): TransportPortSnapshot;
  /** Continuous position at a reference-clock time; not loop-folded. */
  positionAt(referenceTime: number): number;
  /** The listener receives each committed snapshot; it is not called on subscription. */
  subscribe(listener: (snapshot: TransportPortSnapshot) => void): () => void;
}

export interface TransportPortOptions {
  id?: string;
  /** Lend play/pause/seek/rate/loop commands to the port's consumers. Default false. */
  commands?: boolean;
}

function project(snapshot: SessionTransportSnapshot): TransportPortSnapshot {
  return Object.freeze({
    revision: snapshot.revision,
    axis: snapshot.axis,
    referenceTime: snapshot.referenceTime,
    position: snapshot.position,
    durationSeconds: snapshot.durationSeconds,
    playing: !snapshot.paused,
    rate: snapshot.rate,
    loop: snapshot.loop,
    ended: snapshot.ended,
    pending: snapshot.pending,
    schedulingMode: snapshot.schedulingMode,
  });
}

/**
 * Project a borrowed Session into a transport port. The port holds no
 * authority of its own: commands, when lent, go to the Session, and disposing
 * a consumer's subscription never stops or disposes the Session.
 */
export function createTransportPort(session: ModuleSession, options: TransportPortOptions = {}): TransportPort {
  let detached = false;
  const read = (): TransportPortSnapshot => project(session.snapshot);
  const outcome = async (run: () => Promise<TransportCommit>): Promise<TransportPortOutcome> => {
    try {
      const commit = await run();
      return Object.freeze({status: commit.status, revision: commit.revision, snapshot: project(commit.snapshot as SessionTransportSnapshot)});
    } catch (error) {
      let snapshot: TransportPortSnapshot;
      try { snapshot = read(); } catch { snapshot = last; }
      return Object.freeze({status: 'failed', revision: null, snapshot, error});
    }
  };
  let last = read();
  const commands: TransportCommands | undefined = options.commands ? Object.freeze({
    play: () => outcome(() => session.play()),
    pause: () => outcome(() => session.pause()),
    stop: () => outcome(() => session.stop()),
    seek: (position: number) => outcome(() => session.seek(position)),
    setRate: (rate: number) => outcome(() => session.setRate(rate)),
    setLoop: (loop: SyncLoopRegion | null) => outcome(() => session.setLoop(loop)),
  }) : undefined;
  return Object.freeze({
    id: options.id ?? 'transport',
    family: 'transport' as const,
    direction: 'output' as const,
    multiplicity: 'single' as const,
    schemaVersion: 1,
    get readiness(): PortReadiness {
      if (detached) return 'detached';
      try { return session.snapshot.disposed ? 'detached' : 'ready'; } catch { detached = true; return 'detached'; }
    },
    axis: last.axis,
    ...(commands ? {commands} : {}),
    snapshot: () => {
      try { last = read(); } catch { detached = true; }
      return last;
    },
    positionAt: (referenceTime: number) => session.scheduling.positionAt(referenceTime),
    subscribe: (listener: (snapshot: TransportPortSnapshot) => void) => {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
      return session.subscribe((event) => {
        last = project(event.snapshot);
        listener(last);
      });
    },
  });
}
