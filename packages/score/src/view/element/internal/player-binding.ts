import {observeElementTarget, type ElementTargetState} from '@webmusic/kernel/element';
import {observeScorePlayback, type Score, type ScorePlaybackSnapshot, type ScorePlaybackSource, type ScorePlaybackNote} from '../../../core';

/** Cursor coordinates supplied by a borrowed player; never a follower clock. */
export interface ViewPlayerNote {
  midi: number;
  /** Nominal onset when the source is a scored player; absent on live input. */
  startTime?: number;
}

export interface ViewPlayerSnapshot {
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
  activeNotes?: ReadonlyArray<ViewPlayerNote>;
}

/** Playback callbacks a view element can subscribe to. */
export interface ViewPlayerHandlers {
  score?(): Score | undefined;
  isCurrent?(): boolean;
  noteOn?(note: ViewPlayerNote): void;
  noteOff?(note: ViewPlayerNote): void;
  snapshot?(snapshot: ViewPlayerSnapshot): void;
  /** Reuse a code-only follower's native snapshot projection instead of note-event diffing. */
  playbackSnapshot?(snapshot: ScorePlaybackSnapshot): void;
  targetChanged?(target: Element | undefined): void;
  scoreChanged?(score: Score | undefined): void;
  /** Clear live projections when their owner or its musical position changes. */
  reset?(): void;
  end?(): void;
}

interface TimeUpdateDetail {
  seconds?: number;
  nominalSeconds?: number;
  transportSeconds?: number;
  transportDurationSeconds?: number;
  rate?: number;
  playing?: boolean;
  activeNotes?: ReadonlyArray<ViewPlayerNote>;
}

/** Structural: View never imports a sibling Play implementation. */
interface ViewPlayer extends Element {
  playback?: ScorePlaybackSource;
  resolvedScore?: Score;
  score?: Score;
  getPlaybackSnapshot?(): TimeUpdateDetail | undefined;
}

/** Unique selector lookup within the follower's Document or ShadowRoot. */
export function resolveViewPlayer(host: Element, selectorAttribute = 'player'): Element | undefined {
  const selector = host.getAttribute(selectorAttribute);
  if (!selector) return undefined;
  try {
    const root = host.getRootNode() as ParentNode;
    // The fallback also supports existing structural connection hosts.
    if (!root.querySelectorAll) return root.querySelector(selector) ?? undefined;
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 ? matches[0] : undefined;
  } catch {
    return undefined;
  }
}

/** Read only the owner's resolved data capability, without fetching its URL. */
export function readViewPlayerScore(target: Element | undefined): Score | undefined {
  if (!target) return undefined;
  const player = target as ViewPlayer;
  const native = player.playback?.snapshot();
  if (native && native.readiness !== 'unavailable') return native.readiness === 'disposed' ? undefined : native.score;
  // An explicit undefined resolvedScore means this mode has no loaded score;
  // do not accidentally expose an ignored .score in controller or Rack mode.
  return 'resolvedScore' in player ? player.resolvedScore : player.score;
}

/**
 * Borrow one selected player's data and events. Discovery lasts only for this
 * attachment: removal, replacement and late custom-element upgrade are handled
 * within the same root; cleanup releases listeners and target observation.
 */
export function bindViewPlayer(
  host: Element, handlers: ViewPlayerHandlers, selectorAttribute = 'player',
): (() => void) | undefined {
  const selector = host.getAttribute(selectorAttribute);
  if (!selector) return undefined;
  const connectedAtStart = host.isConnected;
  let disposed = false;
  let generation = 0;
  let clearListeners: (() => void) | undefined;
  let currentScore: Score | undefined;
  const root = host.getRootNode();
  let stopDiscovery: (() => void) | undefined;

  const attach = (next: Element | undefined, state?: ElementTargetState): void => {
    if (disposed || host.getAttribute(selectorAttribute) !== selector) return;
    const ownGeneration = ++generation;
    clearListeners?.();
    clearListeners = undefined;
    currentScore = undefined;
    const selected = host.getAttribute(selectorAttribute);
    const wasConnected = host.isConnected;
    const current = () => !disposed && ownGeneration === generation && (!wasConnected || host.isConnected)
      && host.getAttribute(selectorAttribute) === selected && handlers.isCurrent?.() !== false;
    let discovery = state === 'ready' ? 'resolved' : state ?? (next ? 'resolved' : 'missing');
    if (!state && !next) {
      try { if (selected && (root as ParentNode).querySelectorAll?.(selected).length > 1) discovery = 'ambiguous'; }
      catch { discovery = 'invalid'; }
    }
    host.setAttribute?.('data-player-state', discovery);
    handlers.reset?.();
    if (!current()) return;
    handlers.targetChanged?.(next);
    if (!current()) return;
    if (!next) {
      handlers.scoreChanged?.(undefined);
      return;
    }

    const native = (next as ViewPlayer).playback;
    let nativeUnbind: (() => void) | undefined;
    let nativeState: ScorePlaybackSnapshot | undefined;
    let nativeSerial = 0;
    const nativeNotes = new Map<string, ScorePlaybackNote>();
    const acceptsLegacy = () => !native || native.snapshot().readiness === 'unavailable';
    const snapshot = (): ViewPlayerSnapshot | undefined => readViewPlayerSnapshot(next);
    let held: ViewPlayerNote[] = [];
    const resetNotes = (): void => {
      held = [];
      handlers.reset?.();
    };
    let lastTime: TimeUpdateDetail | undefined;
    const publishTime = (detail: TimeUpdateDetail | undefined): void => {
      if (!current() || !detail) return;
      lastTime = detail;
      const state = normalizeTime(detail);
      const nextNotes = state.activeNotes;
      if (nextNotes && !sameNotes(held, nextNotes)) {
        resetNotes();
        if (!current()) return;
        handlers.snapshot?.(state);
        if (!current()) return;
        for (const note of nextNotes) {
          held.push(note);
          handlers.noteOn?.(note);
          if (!current()) return;
        }
      } else handlers.snapshot?.(state);
    };
    const publishScore = (force = false): void => {
      if (!current()) return;
      const score = readViewPlayerScore(next);
      if (!force && score === currentScore) return;
      currentScore = score;
      handlers.scoreChanged?.(score);
    };
    const onNoteOn = (event: Event): void => {
      const detail = (event as CustomEvent<ViewPlayerNote>).detail;
      if (current() && detail && validMidi(detail.midi)) {
        held.push(detail);
        handlers.noteOn?.(detail);
      }
    };
    const onNoteOff = (event: Event): void => {
      const detail = (event as CustomEvent<ViewPlayerNote>).detail;
      if (current() && detail && validMidi(detail.midi)) {
        const index = held.findIndex((note) => note.midi === detail.midi
          && (detail.startTime === undefined || note.startTime === detail.startTime));
        if (index !== -1) held.splice(index, 1);
        handlers.noteOff?.(detail);
      }
    };
    const onTime = (event: Event): void => {
      const detail = (event as CustomEvent<TimeUpdateDetail>).detail;
      if (detail) publishTime({...snapshot(), ...detail});
    };
    const onState = (event: Event): void => {
      const detail = (event as CustomEvent<TimeUpdateDetail>).detail;
      publishTime(detail ?? snapshot());
    };
    const onScore = (): void => {
      if (!current()) return;
      resetNotes();
      publishScore(true);
      if (!current()) return;
      const state = snapshot();
      publishTime(state);
    };
    const onReset = (event: Event): void => {
      if (!current()) return;
      resetNotes();
      if (!current()) return;
      const state = snapshot() ?? (event.type === 'webscore:seek' ? lastTime : undefined);
      publishTime(state);
    };
    const onEnd = (): void => {
      if (!current()) return;
      publishTime(snapshot());
      held = [];
      if (current()) handlers.end?.();
    };
    const listeners: Array<[string, EventListener]> = [
      ['webscore:noteon', onNoteOn], ['webscore:noteoff', onNoteOff],
      ['webscore:timeupdate', onTime], ['webscore:statechange', onState],
      ['webscore:scorechange', onScore], ['webscore:seek', onReset],
      ['webscore:stop', onReset], ['webscore:end', onEnd],
    ];
    clearListeners = () => {
      nativeSerial += 1;
      const cleanup = nativeUnbind;
      nativeUnbind = undefined;
      try { cleanup?.(); } finally {
        for (const [type, listener] of listeners) next.removeEventListener(type, listener);
      }
    };
    for (let i = 0; i < listeners.length; i += 1) {
      const [type, listener] = listeners[i]!;
      const ownedEvent: EventListener = (event) => {
        if ((!event.target || event.target === next) && current()) {
          if (acceptsLegacy()) listener(event);
          else if (type === 'webscore:seek' || type === 'webscore:stop') {
            if (handlers.playbackSnapshot && native) handlers.playbackSnapshot(native.snapshot());
            else {
              handlers.reset?.();
              if (current()) publishTime(snapshot());
            }
          }
        }
      };
      listeners[i] = [type, ownedEvent];
      next.addEventListener(type, ownedEvent);
    }
    if (native && typeof native.subscribe === 'function') {
      const candidate = observeScorePlayback(native, (state) => {
        if (!current()) return;
        const serial = ++nativeSerial;
        const valid = () => current() && serial === nativeSerial;
        const before = nativeState;
        nativeState = state;
        host.setAttribute?.('data-player-state', state.readiness);

        if (!valid()) return;
        const data = handlers.score?.();
        const mismatch = Boolean(data && state.score && data !== state.score);
        if (mismatch) host.setAttribute?.('data-player-state', 'mismatched');
        if (handlers.playbackSnapshot) {
          held = [];
          handlers.playbackSnapshot(state);
          if (!valid()) return;
          publishScore();
          if (!valid()) return;
          if (state.readiness === 'unavailable') publishTime(snapshot());
          return;
        }
        const notes = new Map(state.readiness === 'ready' && !mismatch
          ? state.activeNotes.map((note) => [`${state.sourceRevision}:${note.occurrenceId}`, note]) : []);
        for (const [id, note] of nativeNotes) {
          if (!notes.has(id)) { nativeNotes.delete(id); handlers.noteOff?.({midi: note.midi, startTime: note.nominalStartSeconds}); }
          if (!valid()) return;
        }
        const replaced = before && (before.sourceRevision !== state.sourceRevision || before.score !== state.score
          || (before.state !== 'stopped' && state.state === 'stopped'));
        if (replaced || mismatch || state.readiness === 'disposed') {
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
          if (!nativeNotes.has(id)) { nativeNotes.set(id, note); handlers.noteOn?.({midi: note.midi, startTime: note.nominalStartSeconds}); }
          if (!valid()) return;
        }
        if (!mismatch && state.nominalSeconds !== null && state.readiness !== 'disposed') {
          handlers.snapshot?.(playbackTime(state));
        }
        if (valid() && state.state === 'ended' && before?.state !== 'ended') handlers.end?.();
      });
      if (current()) nativeUnbind = candidate;
      else { candidate(); return; }
      if (!acceptsLegacy()) return;
    }
    publishScore(true);
    if (!current()) return;
    const initial = snapshot();
    publishTime(initial);
    if (!current()) return;
  };

  try {
    // Kernel owns real-DOM discovery, including cancellable late definition
    // callbacks. A definition/source change must reattach even when the target
    // element stayed the same: its native playback capability may be new.
    if (typeof root.nodeType === 'number') {
      stopDiscovery = observeElementTarget(host, selector, attach);
    } else {
      // Existing structural connection hosts have no browser lifetime to watch.
      attach(resolveViewPlayer(host, selectorAttribute));
    }
    if (connectedAtStart && !host.isConnected) {
      disposed = true;
      generation += 1;
      stopDiscovery?.();
      clearListeners?.();
      clearListeners = undefined;
    }
  } catch (error) {
    disposed = true;
    generation += 1;
    stopDiscovery?.();
    clearListeners?.();
    throw error;
  }
  return () => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    stopDiscovery?.();
    clearListeners?.();
    clearListeners = undefined;
  };
}

function normalizeTime(detail: TimeUpdateDetail): ViewPlayerSnapshot {
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

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Read the native player's current state without allocating playback resources. */
export function readViewPlayerSnapshot(target: Element | undefined): ViewPlayerSnapshot | undefined {
  const native = (target as ViewPlayer | undefined)?.playback?.snapshot();
  if (native && native.readiness !== 'unavailable') return native.readiness === 'disposed' ? undefined : playbackTime(native);
  const snapshot = (target as ViewPlayer | undefined)?.getPlaybackSnapshot?.();
  return snapshot ? normalizeTime(snapshot) : undefined;
}

function validMidi(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 127;
}

function sameNotes(left: ReadonlyArray<ViewPlayerNote>, right: ReadonlyArray<ViewPlayerNote>): boolean {
  if (left.length !== right.length) return false;
  const key = (note: ViewPlayerNote) => `${note.midi}:${note.startTime ?? ''}`;
  const leftKeys = left.map(key).sort();
  const rightKeys = right.map(key).sort();
  return leftKeys.every((value, index) => value === rightKeys[index]);
}

function playbackTime(state: ScorePlaybackSnapshot): ViewPlayerSnapshot {
  return {
    nominalSeconds: state.nominalSeconds ?? 0,
    transportSeconds: state.transportSeconds ?? 0,
    transportDurationSeconds: state.transportDurationSeconds ?? 0,
    ...(state.rate === null ? {} : {rate: state.rate}),
    playing: state.state === 'playing',
    activeNotes: state.activeNotes.map((note) => ({midi: note.midi, startTime: note.nominalStartSeconds})),
  };
}

/** Use the native nominal command, or the existing custom-owner transport command. */
export function seekViewPlayer(target: Element | undefined, seconds: number, score?: Score, rate = 1): void | Promise<void> {
  const player = target as (ViewPlayer & {seekNominal?(seconds: number): void | Promise<void>; seek?(seconds: number): void | Promise<void>}) | undefined;
  const source = player?.playback;
  if (source && source.snapshot().readiness !== 'unavailable') {
    if (score && source.snapshot().score !== score) throw new Error('The player and follower use different scores.');
    if (!source.seekNominal) throw new Error('The playback source is read-only.');
    return source.seekNominal(seconds);
  }
  if (player?.seekNominal) return player.seekNominal(seconds);
  if (player?.seek) return player.seek(seconds / rate);
  if (target) throw new Error('The player does not support seeking.');
}
