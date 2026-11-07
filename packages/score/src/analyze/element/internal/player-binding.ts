import {observeCompanionInput} from '@webmusic/kernel/element';
import {SOURCE_SCHEMAS, type ModuleHandle} from '@webmusic/kernel/module';
import {SCORE_PLAYBACK_OWNER, type Score, type ScorePlaybackSnapshot, type ScorePlaybackSource} from '../../../core';
import {
  bindScoreCompanion, readCompanionScore, resolveCompanionOwner, seekCompanionOwner,
  type ScoreCompanionOwner,
} from '../../../core/companion';
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

/** What an analysis follows: a player or Rack part element, or a module source port's playback. */
export type AnalysisPlayerOwner = ScoreCompanionOwner;

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
  targetChanged?(target: AnalysisPlayerOwner | undefined): void;
  dataChanged?(score: Score | undefined): void;
  /** Clear live projections when their owner or its musical position changes. */
  reset?(): void;
  end?(): void;
}

/** Unique selector lookup within the follower's Document or ShadowRoot. */
export function resolveAnalysisPlayer(host: Element): AnalysisPlayerOwner | undefined {
  return resolveCompanionOwner(host);
}

/** Read only the owner's resolved data capability, without fetching its URL. */
export const readAnalysisPlayerScore = readCompanionScore;

/**
 * Borrow one player's data and events (DEC-068 order: an explicit
 * `.inputModule`, the `input` selector, then the enclosing player or Rack part;
 * a `port` attribute follows that module's source port). The shared Score
 * companion follower does the rest; cleanup releases discovery and listeners.
 */
export function bindAnalysisPlayer(
  host: Element, handlers: AnalysisPlayerHandlers, assigned?: ModuleHandle | null,
): (() => void) | undefined {
  return bindScoreCompanion(host, (update) => observeCompanionInput(host, {
    capability: SCORE_PLAYBACK_OWNER, assigned, schemaId: SOURCE_SCHEMAS.score,
  }, update), {
    score: handlers.score,
    isCurrent: handlers.isCurrent,
    state: (state) => host.setAttribute('data-player-state', state),
    targetChanged: handlers.targetChanged,
    nativeSnapshot: handlers.snapshot,
    scoreChanged: handlers.dataChanged,
    noteOn: handlers.noteOn && ((note) => handlers.noteOn!(note.midi)),
    noteOff: handlers.noteOff && ((note) => handlers.noteOff!(note.midi)),
    time: (time) => {
      const update: AnalysisTimeUpdate = {
        nominalSeconds: time.nominalSeconds,
        transportSeconds: time.transportSeconds,
        transportDurationSeconds: time.transportDurationSeconds,
        ...(time.rate === undefined ? {} : {rate: time.rate}),
        ...(time.playing === undefined ? {} : {playing: time.playing}),
      };
      handlers.timeUpdate?.(update.nominalSeconds, update);
      if (update.playing !== undefined && handlers.isCurrent?.() !== false) handlers.stateChanged?.(update.playing, update);
    },
    reset: handlers.reset,
    end: handlers.end,
  });
}

/** Use the native nominal command, or the existing custom-owner transport command. */
export function seekAnalysisPlayer(
  target: AnalysisPlayerOwner | undefined, seconds: number, score?: Score, rate = 1, isCurrent: () => boolean = () => true,
): void | Promise<void> {
  const source: ScorePlaybackSource | undefined = target?.playback;
  if (source && source.snapshot().readiness !== 'unavailable') {
    return seekAnalysisPlayback(source, score, seconds, isCurrent).then((outcome) => {
      if (outcome.status === 'failed') throw outcome.error;
    });
  }
  if (!isCurrent()) return;
  return seekCompanionOwner(target, seconds, rate);
}
