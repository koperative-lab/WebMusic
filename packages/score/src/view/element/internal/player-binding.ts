import {observeCompanionInput} from '@webmusic/kernel/element';
import {SOURCE_SCHEMAS, type ModuleHandle} from '@webmusic/kernel/module';
import {SCORE_PLAYBACK_OWNER, type Score, type ScorePlaybackSnapshot} from '../../../core';
import {
  bindScoreCompanion, readCompanionScore, readCompanionTime, resolveCompanionOwner,
  type ScoreCompanionNote, type ScoreCompanionOwner, type ScoreCompanionTime,
} from '../../../core/companion';

/** Cursor coordinates supplied by a borrowed player; never a follower clock. */
export type ViewPlayerNote = ScoreCompanionNote;
export type ViewPlayerSnapshot = ScoreCompanionTime;
/** What a view follows: a player or Rack part element, or a module source port's playback. */
export type ViewPlayerOwner = ScoreCompanionOwner;

/** Playback callbacks a view element can subscribe to. */
export interface ViewPlayerHandlers {
  score?(): Score | undefined;
  isCurrent?(): boolean;
  noteOn?(note: ViewPlayerNote): void;
  noteOff?(note: ViewPlayerNote): void;
  snapshot?(snapshot: ViewPlayerSnapshot): void;
  /** Reuse a code-only follower's native snapshot projection instead of note-event diffing. */
  playbackSnapshot?(snapshot: ScorePlaybackSnapshot): void;
  targetChanged?(target: ViewPlayerOwner | undefined): void;
  /** Source readiness can change before score data or time becomes available. */
  readinessChanged?(snapshot: ScorePlaybackSnapshot): void;
  scoreChanged?(score: Score | undefined): void;
  /** Clear live projections when their owner or its musical position changes. */
  reset?(): void;
  end?(): void;
}

/** Unique selector lookup within the follower's Document or ShadowRoot. */
export function resolveViewPlayer(host: Element): ViewPlayerOwner | undefined {
  return resolveCompanionOwner(host);
}

/** Read only the owner's resolved data capability, without fetching its URL. */
export const readViewPlayerScore = readCompanionScore;
/** Read the native player's current state without allocating playback resources. */
export const readViewPlayerSnapshot = readCompanionTime;

/**
 * Borrow one player's data and events (DEC-068 order: an explicit
 * `.inputModule`, the `input` selector, then the enclosing player or Rack part;
 * a `port` attribute follows that module's source port). The shared Score
 * companion follower does the rest; cleanup releases discovery and listeners.
 */
export function bindViewPlayer(
  host: Element, handlers: ViewPlayerHandlers, assigned?: ModuleHandle | null,
): (() => void) | undefined {
  return bindScoreCompanion(host, (update) => observeCompanionInput(host, {
    capability: SCORE_PLAYBACK_OWNER, assigned, schemaId: SOURCE_SCHEMAS.score,
  }, update), {
    score: handlers.score,
    isCurrent: handlers.isCurrent,
    state: (state) => host.setAttribute('data-player-state', state),
    targetChanged: handlers.targetChanged,
    playbackSnapshot: handlers.playbackSnapshot,
    readinessChanged: handlers.readinessChanged,
    scoreChanged: handlers.scoreChanged,
    noteOn: handlers.noteOn,
    noteOff: handlers.noteOff,
    time: handlers.snapshot,
    reset: handlers.reset,
    end: handlers.end,
    diffOwnerNotes: true,
  });
}
