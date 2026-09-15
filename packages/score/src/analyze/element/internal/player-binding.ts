import {observeElementTarget, type ElementTargetState} from '@webmusic/kernel/element';
import {type Score, type ScorePlaybackSnapshot, type ScorePlaybackSource, type ScorePlaybackNote} from '../../../core';
import {bindAnalysisPlayback} from '../../headless/playback-binding';
import {seekAnalysisPlayback} from '../../headless/seek';

/** Cursor coordinates supplied by a borrowed player; never a follower clock. */
export interface AnalysisTimeUpdate {
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
}

/** Playback callbacks an analysis element can subscribe to. */
export interface AnalysisPlayerHandlers {
  score?(): Score | undefined;
  snapshot?(snapshot: ScorePlaybackSnapshot | undefined): void;
  isCurrent?(): boolean;
  noteOn?(midi: number): void;
  noteOff?(midi: number): void;
  /** The first argument remains nominal seconds for existing consumers. */
  timeUpdate?(seconds: number, update: AnalysisTimeUpdate): void;
  stateChanged?(playing: boolean, update: AnalysisTimeUpdate): void;
  targetChanged?(target: Element | undefined): void;
  dataChanged?(score: Score | undefined): void;
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
  activeNotes?: ReadonlyArray<{midi: number}>;
}

/** Structural: Analyze never imports a sibling Play implementation. */
interface AnalysisPlayer extends Element {
  playback?: ScorePlaybackSource;
  resolvedScore?: Score;
  score?: Score;
  getPlaybackSnapshot?(): TimeUpdateDetail | undefined;
}

/** Unique selector lookup within the follower's Document or ShadowRoot. */
export function resolveAnalysisPlayer(host: Element): Element | undefined {
  const selector = host.getAttribute('player');
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
export function readAnalysisPlayerScore(target: Element | undefined): Score | undefined {
  if (!target) return undefined;
  const player = target as AnalysisPlayer;
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
export function bindAnalysisPlayer(host: Element, handlers: AnalysisPlayerHandlers): (() => void) | undefined {
  const selector = host.getAttribute('player');
  if (!selector) return undefined;
  const connectedAtStart = host.isConnected;
  let disposed = false;
  let generation = 0;
  let clearListeners: (() => void) | undefined;
  let currentScore: Score | undefined;
  const root = host.getRootNode();
  let stopDiscovery: (() => void) | undefined;

  const attach = (next: Element | undefined, state?: ElementTargetState): void => {
    if (disposed || host.getAttribute('player') !== selector) return;
    const ownGeneration = ++generation;
    clearListeners?.();
    clearListeners = undefined;
    currentScore = undefined;
    const selected = host.getAttribute('player');
    const wasConnected = host.isConnected;
    const current = () => !disposed && ownGeneration === generation && (!wasConnected || host.isConnected)
      && host.getAttribute('player') === selected && handlers.isCurrent?.() !== false;
    let discovery = state === 'ready' ? 'resolved' : state ?? (next ? 'resolved' : 'missing');
    if (!state && !next) {
      try { if (selected && (root as ParentNode).querySelectorAll?.(selected).length > 1) discovery = 'ambiguous'; }
      catch { discovery = 'invalid'; }
    }
    host.setAttribute?.('data-player-state', discovery);
    handlers.snapshot?.(undefined);
    handlers.reset?.();
    if (!current()) return;
    handlers.targetChanged?.(next);
    if (!current()) return;
    if (!next) {
      handlers.dataChanged?.(undefined);
      return;
    }

    const native = (next as AnalysisPlayer).playback;
    let nativeUnbind: (() => void) | undefined;
    let nativeSerial = 0;
    // Only delivered events enter this map: a note callback can reenter the
    // owner before later additions from the same coherent snapshot are sent.
    const deliveredNotes = new Map<string, ScorePlaybackNote>();
    const acceptsLegacy = () => !native || native.snapshot().readiness === 'unavailable';
    const snapshot = (): TimeUpdateDetail | undefined => native && !acceptsLegacy() ? playbackTime(native.snapshot()) : (next as AnalysisPlayer).getPlaybackSnapshot?.();
    let lastTime: TimeUpdateDetail | undefined;
    const publishTime = (detail: TimeUpdateDetail | undefined): void => {
      if (!current() || !detail) return;
      lastTime = detail;
      const update = normalizeTime(detail);
      handlers.timeUpdate?.(update.nominalSeconds, update);
      if (current() && update.playing !== undefined) handlers.stateChanged?.(update.playing, update);
    };
    const publishScore = (force = false): void => {
      if (!current()) return;
      const score = readAnalysisPlayerScore(next);
      if (!force && score === currentScore) return;
      currentScore = score;
      handlers.dataChanged?.(score);
    };
    const onNoteOn = (event: Event): void => {
      const midi = (event as CustomEvent<{midi?: number}>).detail?.midi;
      if (current() && typeof midi === 'number' && Number.isFinite(midi)) handlers.noteOn?.(midi);
    };
    const onNoteOff = (event: Event): void => {
      const midi = (event as CustomEvent<{midi?: number}>).detail?.midi;
      if (current() && typeof midi === 'number' && Number.isFinite(midi)) handlers.noteOff?.(midi);
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
      handlers.reset?.();
      publishScore(true);
      if (current()) publishTime(snapshot());
    };
    const onReset = (event: Event): void => {
      if (!current()) return;
      handlers.reset?.();
      if (current()) publishTime(snapshot() ?? (event.type === 'webscore:seek' ? lastTime : undefined));
    };
    const onEnd = (): void => {
      if (!current()) return;
      publishTime(snapshot());
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
            handlers.reset?.();
            if (current()) publishTime(snapshot());
          }
        }
      };
      listeners[i] = [type, ownedEvent];
      next.addEventListener(type, ownedEvent);
    }
    if (native && typeof native.subscribe === 'function') {
      const candidate = bindAnalysisPlayback(native, () => handlers.score?.(), (update) => {
        if (!current()) return;
        const state = update.playback;
        const serial = ++nativeSerial;
        const valid = () => current() && serial === nativeSerial && update.isCurrent();
        const before = update.previous;
        host.setAttribute?.('data-player-state', state.readiness);
        handlers.snapshot?.(state);
        if (!valid()) return;
        const mismatch = update.mismatched;
        if (mismatch) host.setAttribute?.('data-player-state', 'mismatched');
        const notes = new Map(update.activeNotes.map((note) => [`${state.sourceRevision}:${note.occurrenceId}`, note]));
        for (const [id, note] of deliveredNotes) {
          if (update.reset || !notes.has(id)) { deliveredNotes.delete(id); handlers.noteOff?.(note.midi); }
          if (!valid()) return;
        }
        if (update.reset) {
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
          if (!deliveredNotes.has(id)) { deliveredNotes.set(id, note); handlers.noteOn?.(note.midi); }
          if (!valid()) return;
        }
        if (!mismatch && state.nominalSeconds !== null && state.readiness !== 'disposed') {
          publishTime(playbackTime(state));
        }
        if (valid() && state.state === 'ended' && before?.state !== 'ended') handlers.end?.();
      });
      if (current()) nativeUnbind = () => candidate.dispose();
      else { candidate.dispose(); return; }
      if (!acceptsLegacy()) return;
    }
    publishScore(true);
    if (!current()) return;
    const initial = snapshot();
    publishTime(initial);
    if (!current()) return;
    for (const note of initial?.activeNotes ?? []) {
      if (!current()) return;
      if (Number.isFinite(note.midi)) handlers.noteOn?.(note.midi);
    }
  };

  try {
    // Kernel owns real-DOM discovery, including cancellable late definition
    // callbacks. A definition/source change must reattach even when the target
    // element stayed the same: its native playback capability may be new.
    if (typeof root.nodeType === 'number') {
      stopDiscovery = observeElementTarget(host, selector, attach);
    } else {
      // Existing structural connection hosts have no browser lifetime to watch.
      attach(resolveAnalysisPlayer(host));
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

function normalizeTime(detail: TimeUpdateDetail): AnalysisTimeUpdate {
  const nominal = numberOr(detail.nominalSeconds, numberOr(detail.seconds, 0));
  return {
    nominalSeconds: nominal,
    transportSeconds: numberOr(detail.transportSeconds, 0),
    transportDurationSeconds: numberOr(detail.transportDurationSeconds, 0),
    ...(typeof detail.rate === 'number' && Number.isFinite(detail.rate) && detail.rate > 0 ? {rate: detail.rate} : {}),
    ...(typeof detail.playing === 'boolean' ? {playing: detail.playing} : {}),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function playbackTime(state: ScorePlaybackSnapshot): TimeUpdateDetail {
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
export function seekAnalysisPlayer(target: Element | undefined, seconds: number, score?: Score, rate = 1, isCurrent: () => boolean = () => true): void | Promise<void> {
  const player = target as (AnalysisPlayer & {seekNominal?(seconds: number): void | Promise<void>; seek?(seconds: number): void | Promise<void>}) | undefined;
  const source = player?.playback;
  if (source && source.snapshot().readiness !== 'unavailable') {
    return seekAnalysisPlayback(source, score, seconds, isCurrent).then((outcome) => {
      if (outcome.status === 'failed') throw outcome.error;
    });
  }
  if (!isCurrent()) return;
  if (player?.seekNominal) return player.seekNominal(seconds);
  if (player?.seek) return player.seek(seconds / rate);
  if (target) throw new Error('The player does not support seeking.');
}
