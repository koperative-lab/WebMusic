import type {Score} from './model/Score';
import {
  observeScorePlayback,
  type ScorePlaybackNote,
  type ScorePlaybackSnapshot,
  type ScorePlaybackSource,
} from './playback';

/**
 * One borrowed-player follower for every Score companion (DEC-068): views and
 * analysis share this projection of an owner's playback source, its custom
 * owner events and its score data. Discovery (selector, containment, module
 * port) is the Element adapter's; this module owns only what follows a found
 * owner, so it stays code-only.
 */

/** A note the owner is sounding. `startTime` is the nominal onset, absent on live input. */
export interface ScoreCompanionNote {
  readonly midi: number;
  readonly startTime?: number;
}

/** Cursor coordinates the owner supplies; never a follower clock. */
export interface ScoreCompanionTime {
  /** Position on the unscaled score timeline. */
  nominalSeconds: number;
  /** Rate-scaled transport seconds; 0 when unavailable. */
  transportSeconds: number;
  /** Rate-scaled total duration; 0 when unavailable. */
  transportDurationSeconds: number;
  /** Explicit playback rate, when the owner exposes it. */
  rate?: number;
  /** Whether the owner is playing, when that capability is available. */
  playing?: boolean;
  activeNotes?: ReadonlyArray<ScoreCompanionNote>;
}

interface OwnerTimeDetail {
  seconds?: number;
  nominalSeconds?: number;
  transportSeconds?: number;
  transportDurationSeconds?: number;
  rate?: number;
  playing?: boolean;
  activeNotes?: ReadonlyArray<ScoreCompanionNote>;
}

/**
 * What a companion follows, structurally: a player or Rack part element, a
 * module source port's playback source, or a custom owner that dispatches
 * `webscore:*` events and answers `getPlaybackSnapshot()`.
 */
export interface ScoreCompanionOwner {
  readonly playback?: ScorePlaybackSource;
  readonly resolvedScore?: Score;
  readonly score?: Score;
  getPlaybackSnapshot?(): OwnerTimeDetail | undefined;
  addEventListener?(type: string, listener: (event: Event) => void): void;
  removeEventListener?(type: string, listener: (event: Event) => void): void;
}

export interface ScoreCompanionHandlers {
  /** The companion's own score, compared with the owner's to detect a mismatch. */
  score?(): Score | undefined;
  /** Host-level guard; false makes the remainder of a callback stale. */
  isCurrent?(): boolean;
  /** Discovery or readiness state for the host's `data-player-state`. */
  state?(state: string): void;
  targetChanged?(owner: ScoreCompanionOwner | undefined): void;
  /** Every native source update, and undefined when the owner changes. */
  nativeSnapshot?(snapshot: ScorePlaybackSnapshot | undefined): void;
  /** Take native snapshots whole instead of note and time callbacks. */
  playbackSnapshot?(snapshot: ScorePlaybackSnapshot): void;
  /** Source readiness can change before score data or time becomes available. */
  readinessChanged?(snapshot: ScorePlaybackSnapshot): void;
  scoreChanged?(score: Score | undefined): void;
  noteOn?(note: ScoreCompanionNote): void;
  noteOff?(note: ScoreCompanionNote): void;
  time?(time: ScoreCompanionTime): void;
  /** Clear live projections when their owner or its musical position changes. */
  reset?(): void;
  end?(): void;
  /**
   * Custom owners: replace held notes whenever a time update carries a
   * different `activeNotes` set (views). Otherwise only the initial set is
   * delivered as note-ons (analysis).
   */
  diffOwnerNotes?: boolean;
}

/** Read only the owner's resolved data capability, without fetching its URL. */
export function readCompanionScore(owner: ScoreCompanionOwner | undefined): Score | undefined {
  if (!owner) return undefined;
  const native = owner.playback?.snapshot();
  if (native && native.readiness !== 'unavailable') return native.readiness === 'disposed' ? undefined : native.score;
  // An explicit undefined resolvedScore means this mode has no loaded score;
  // do not accidentally expose an ignored .score in controller or Rack mode.
  return 'resolvedScore' in owner ? owner.resolvedScore : owner.score;
}

/** Read the owner's current position without allocating playback resources. */
export function readCompanionTime(owner: ScoreCompanionOwner | undefined): ScoreCompanionTime | undefined {
  const native = owner?.playback?.snapshot();
  if (native && native.readiness !== 'unavailable') return native.readiness === 'disposed' ? undefined : playbackTime(native);
  const detail = owner?.getPlaybackSnapshot?.();
  return detail ? normalizeTime(detail) : undefined;
}

const OWNER_EVENTS = [
  'webscore:noteon', 'webscore:noteoff', 'webscore:timeupdate', 'webscore:statechange',
  'webscore:scorechange', 'webscore:seek', 'webscore:stop', 'webscore:end',
] as const;

/**
 * Follow one owner until the returned cleanup runs. With no owner the
 * companion is told so (reset, no target, no score) and nothing is retained.
 */
export function followScoreCompanion(
  owner: ScoreCompanionOwner | undefined,
  handlers: ScoreCompanionHandlers,
): () => void {
  let active = true;
  const current = () => active && handlers.isCurrent?.() !== false;
  handlers.nativeSnapshot?.(undefined);
  handlers.reset?.();
  if (!current()) return () => { active = false; };
  handlers.targetChanged?.(owner);
  if (!current()) return () => { active = false; };
  if (!owner) {
    handlers.scoreChanged?.(undefined);
    return () => { active = false; };
  }

  const native = owner.playback;
  let releaseNative: (() => void) | undefined;
  let nativeSerial = 0;
  let currentScore: Score | undefined;
  let held: ScoreCompanionNote[] = [];
  let lastTime: OwnerTimeDetail | undefined;
  const acceptsOwnerEvents = () => !native || native.snapshot().readiness === 'unavailable';
  const snapshot = (): OwnerTimeDetail | undefined => readCompanionTime(owner);
  const resetNotes = (): void => {
    held = [];
    handlers.reset?.();
  };
  const publishTime = (detail: OwnerTimeDetail | undefined): void => {
    if (!current() || !detail) return;
    lastTime = detail;
    const time = normalizeTime(detail);
    const notes = time.activeNotes;
    if (handlers.diffOwnerNotes && notes && !sameNotes(held, notes)) {
      resetNotes();
      if (!current()) return;
      handlers.time?.(time);
      for (const note of notes) {
        if (!current()) return;
        held.push(note);
        handlers.noteOn?.(note);
      }
    } else handlers.time?.(time);
  };
  const publishScore = (force = false): void => {
    if (!current()) return;
    const score = readCompanionScore(owner);
    if (!force && score === currentScore) return;
    currentScore = score;
    handlers.scoreChanged?.(score);
  };

  const onEvent = (type: (typeof OWNER_EVENTS)[number], event: Event): void => {
    const detail = (event as CustomEvent<OwnerTimeDetail & ScoreCompanionNote>).detail;
    switch (type) {
      case 'webscore:noteon':
        if (detail && validMidi(detail.midi)) {
          held.push(detail);
          handlers.noteOn?.(detail);
        }
        return;
      case 'webscore:noteoff':
        if (detail && validMidi(detail.midi)) {
          const index = held.findIndex((note) => note.midi === detail.midi
            && (detail.startTime === undefined || note.startTime === detail.startTime));
          if (index !== -1) held.splice(index, 1);
          handlers.noteOff?.(detail);
        }
        return;
      case 'webscore:timeupdate':
        if (detail) publishTime({...snapshot(), ...detail});
        return;
      case 'webscore:statechange':
        publishTime(detail ?? snapshot());
        return;
      case 'webscore:scorechange':
        resetNotes();
        publishScore(true);
        publishTime(snapshot());
        return;
      case 'webscore:seek':
      case 'webscore:stop':
        resetNotes();
        if (current()) publishTime(snapshot() ?? (type === 'webscore:seek' ? lastTime : undefined));
        return;
      case 'webscore:end':
        publishTime(snapshot());
        held = [];
        if (current()) handlers.end?.();
    }
  };
  const listeners = OWNER_EVENTS.map((type) => {
    const listener = (event: Event): void => {
      if ((event.target && event.target !== owner) || !current()) return;
      if (acceptsOwnerEvents()) onEvent(type, event);
      else if (type === 'webscore:seek' || type === 'webscore:stop') {
        // A native source reports the same change; refresh the projection now.
        if (handlers.playbackSnapshot && native) handlers.playbackSnapshot(native.snapshot());
        else {
          handlers.reset?.();
          if (current()) publishTime(snapshot());
        }
      }
    };
    return [type, listener] as const;
  });
  for (const [type, listener] of listeners) owner.addEventListener?.(type, listener);

  const cleanup = (): void => {
    if (!active) return;
    active = false;
    nativeSerial += 1;
    const release = releaseNative;
    releaseNative = undefined;
    try { release?.(); } finally {
      for (const [type, listener] of listeners) owner.removeEventListener?.(type, listener);
    }
  };

  if (native && typeof native.subscribe === 'function') {
    // Only delivered notes enter this map: a note callback can reenter the
    // owner before later additions from the same coherent snapshot are sent.
    const delivered = new Map<string, ScorePlaybackNote>();
    let previous: ScorePlaybackSnapshot | undefined;
    let previousScore: Score | undefined;
    const release = observeScorePlayback(native, (state) => {
      if (!current()) return;
      const serial = ++nativeSerial;
      const valid = () => current() && serial === nativeSerial;
      const before = previous;
      previous = state;
      const local = handlers.score?.();
      const available = state.readiness !== 'unavailable' && state.readiness !== 'disposed';
      const score = local ?? (available ? state.score : undefined);
      const mismatch = Boolean(local && state.score && local !== state.score && available);
      const reset = Boolean(before && (before.sourceRevision !== state.sourceRevision || before.score !== state.score
        || previousScore !== score || (before.state !== 'stopped' && state.state === 'stopped')
        || (before.readiness === 'ready' && state.readiness !== 'ready')))
        || mismatch || state.readiness === 'disposed';
      previousScore = score;
      if (before?.readiness !== state.readiness || before?.error !== state.error) {
        handlers.readinessChanged?.(state);
        if (!valid()) return;
      }
      handlers.state?.(mismatch ? 'mismatched' : state.readiness);
      handlers.nativeSnapshot?.(state);
      if (!valid()) return;
      if (handlers.playbackSnapshot) {
        held = [];
        handlers.playbackSnapshot(state);
        if (!valid()) return;
        publishScore();
        if (valid() && state.readiness === 'unavailable') publishTime(snapshot());
        return;
      }
      const notes = new Map<string, ScorePlaybackNote>(state.readiness === 'ready' && !mismatch
        ? state.activeNotes.map((note) => [`${state.sourceRevision}:${note.occurrenceId}`, note] as const) : []);
      for (const [id, note] of delivered) {
        if (reset || !notes.has(id)) {
          delivered.delete(id);
          handlers.noteOff?.({midi: note.midi, startTime: note.nominalStartSeconds});
        }
        if (!valid()) return;
      }
      if (reset) {
        handlers.reset?.();
        if (!valid()) return;
      }
      if (before?.readiness === 'unavailable' && state.readiness !== 'unavailable') {
        handlers.end?.();
        if (!valid()) return;
      }
      publishScore();
      if (!valid()) return;
      if (state.readiness === 'unavailable') {
        publishTime(snapshot());
        return;
      }
      for (const [id, note] of notes) {
        if (!delivered.has(id)) {
          delivered.set(id, note);
          handlers.noteOn?.({midi: note.midi, startTime: note.nominalStartSeconds});
        }
        if (!valid()) return;
      }
      if (!mismatch && state.nominalSeconds !== null && state.readiness !== 'disposed') {
        handlers.time?.(playbackTime(state));
      }
      if (valid() && state.state === 'ended' && before?.state !== 'ended') handlers.end?.();
    });
    if (current()) releaseNative = release;
    else { release(); cleanup(); return cleanup; }
    if (!acceptsOwnerEvents()) return cleanup;
  }
  publishScore(true);
  if (!current()) return cleanup;
  const initial = snapshot();
  publishTime(initial);
  if (!handlers.diffOwnerNotes) {
    for (const note of initial?.activeNotes ?? []) {
      if (!current()) break;
      if (validMidi(note.midi)) handlers.noteOn?.(note);
    }
  }
  return cleanup;
}

/**
 * Seek the owner on the nominal score axis: its native source, or a custom
 * owner's `seekNominal` / rate-scaled `seek` command.
 */
export function seekCompanionOwner(
  owner: (ScoreCompanionOwner & {seekNominal?(seconds: number): void | Promise<void>; seek?(seconds: number): void | Promise<void>}) | undefined,
  seconds: number,
  rate = 1,
): void | Promise<void> {
  if (owner?.seekNominal) return owner.seekNominal(seconds);
  if (owner?.seek) return owner.seek(seconds / rate);
  if (owner) throw new Error('The player does not support seeking.');
}

function normalizeTime(detail: OwnerTimeDetail): ScoreCompanionTime {
  const nominal = numberOr(detail.nominalSeconds, numberOr(detail.seconds, 0));
  return {
    nominalSeconds: nominal,
    transportSeconds: numberOr(detail.transportSeconds, 0),
    transportDurationSeconds: numberOr(detail.transportDurationSeconds, 0),
    ...(typeof detail.rate === 'number' && Number.isFinite(detail.rate) && detail.rate > 0 ? {rate: detail.rate} : {}),
    ...(typeof detail.playing === 'boolean' ? {playing: detail.playing} : {}),
    ...(detail.activeNotes ? {activeNotes: detail.activeNotes.filter((note) => validMidi(note.midi))} : {}),
  };
}

function playbackTime(state: ScorePlaybackSnapshot): ScoreCompanionTime {
  return {
    nominalSeconds: state.nominalSeconds ?? 0,
    transportSeconds: state.transportSeconds ?? 0,
    transportDurationSeconds: state.transportDurationSeconds ?? 0,
    ...(state.rate === null ? {} : {rate: state.rate}),
    playing: state.state === 'playing',
    activeNotes: state.activeNotes.map((note) => ({midi: note.midi, startTime: note.nominalStartSeconds})),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function validMidi(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 127;
}

function sameNotes(left: ReadonlyArray<ScoreCompanionNote>, right: ReadonlyArray<ScoreCompanionNote>): boolean {
  if (left.length !== right.length) return false;
  const key = (note: ScoreCompanionNote) => `${note.midi}:${note.startTime ?? ''}`;
  const leftKeys = left.map(key).sort();
  const rightKeys = right.map(key).sort();
  return leftKeys.every((value, index) => value === rightKeys[index]);
}

/** Structural companion host (the view or analysis element). */
export interface ScoreCompanionHost {
  getAttribute(name: string): string | null;
  setAttribute?(name: string, value: string): void;
  getRootNode?(): unknown;
  readonly isConnected: boolean;
}

/** A source port publishing a `webmusic.score` playback source, structurally. */
interface CompanionSourcePort {
  snapshot(): {readonly readiness: string; readonly value?: unknown};
  subscribe(listener: () => void): () => void;
}

/** One discovery result, in the shape of Kernel's `CompanionInput`. */
export interface ScoreCompanionInput {
  readonly element?: object;
  readonly port?: CompanionSourcePort;
  readonly state: string;
}

interface StructuralRoot {
  nodeType?: unknown;
  querySelector?(selector: string): unknown;
  querySelectorAll?(selector: string): ArrayLike<unknown>;
}

/** Unique selector lookup within the companion's Document or ShadowRoot. */
export function resolveCompanionOwner(host: ScoreCompanionHost): ScoreCompanionOwner | undefined {
  const selector = host.getAttribute('input');
  if (!selector) return undefined;
  try {
    const root = host.getRootNode?.() as StructuralRoot | undefined;
    // The fallback also supports existing structural connection hosts.
    if (!root?.querySelectorAll) return (root?.querySelector?.(selector) ?? undefined) as ScoreCompanionOwner | undefined;
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 ? matches[0] as ScoreCompanionOwner : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Bind a companion element for one attachment: `observe` is the Element
 * adapter's discovery (Kernel `observeCompanionInput`); each result is
 * followed with {@link followScoreCompanion}. A module source port is followed
 * through its published playback source and re-followed when it republishes
 * another one. Returns undefined when a contained companion has no real
 * document to discover in.
 */
export function bindScoreCompanion(
  host: ScoreCompanionHost,
  observe: (update: (input: ScoreCompanionInput) => void) => () => void,
  handlers: ScoreCompanionHandlers,
): (() => void) | undefined {
  const selector = host.getAttribute('input');
  const portName = host.getAttribute('port');
  const root = host.getRootNode?.() as StructuralRoot | undefined;
  const documentRoot = typeof root?.nodeType === 'number';
  if (!selector && !documentRoot) return undefined;
  const connectedAtStart = host.isConnected;
  let disposed = false;
  let generation = 0;
  let stopFollow: (() => void) | undefined;
  let stopPort: (() => void) | undefined;
  let stopDiscovery: (() => void) | undefined;

  const release = (): void => {
    const port = stopPort;
    const follow = stopFollow;
    stopPort = stopFollow = undefined;
    try { port?.(); } finally { follow?.(); }
  };
  const follow = (owner: ScoreCompanionOwner | undefined, state: string, own: number): void => {
    const previous = stopFollow;
    stopFollow = undefined;
    previous?.();
    const wasConnected = host.isConnected;
    const live = () => !disposed && own === generation && (!wasConnected || host.isConnected)
      && host.getAttribute('input') === selector && host.getAttribute('port') === portName
      && handlers.isCurrent?.() !== false;
    host.setAttribute?.('data-player-state', state);
    if (!live()) return;
    const stop = followScoreCompanion(owner, {...handlers, isCurrent: live});
    if (live()) stopFollow = stop;
    else stop();
  };
  const attach = (input: ScoreCompanionInput): void => {
    if (disposed || host.getAttribute('input') !== selector || host.getAttribute('port') !== portName) return;
    const own = ++generation;
    release();
    const port = input.port;
    if (!port) {
      follow(input.element as ScoreCompanionOwner | undefined, input.state === 'ready' ? 'resolved' : input.state, own);
      return;
    }
    let source: unknown;
    let followed = false;
    const read = (): void => {
      if (disposed || own !== generation) return;
      const snapshot = port.snapshot();
      const next = snapshot.readiness === 'ready' ? snapshot.value as ScorePlaybackSource | undefined : undefined;
      if (followed && next === source) return;
      followed = true;
      source = next;
      follow(next ? {playback: next} : undefined, next ? 'resolved' : 'pending', own);
    };
    const unsubscribe = port.subscribe(read);
    if (disposed || own !== generation) { unsubscribe(); return; }
    stopPort = unsubscribe;
    read();
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    const discovery = stopDiscovery;
    stopDiscovery = undefined;
    try { discovery?.(); } finally { release(); }
  };
  try {
    if (documentRoot) stopDiscovery = observe(attach);
    else {
      // Existing structural connection hosts have no browser lifetime to watch.
      const owner = resolveCompanionOwner(host);
      let state = owner ? 'resolved' : 'missing';
      if (!owner) {
        try { if (selector && (root?.querySelectorAll?.(selector).length ?? 0) > 1) state = 'ambiguous'; }
        catch { state = 'invalid'; }
      }
      attach({element: owner, state});
    }
    if (connectedAtStart && !host.isConnected) dispose();
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
