import type {Score} from '../../core';

/** Presentation readiness, independent of the borrowed player's transport state. */
export type ScoreViewRenderStatus = 'empty' | 'loading' | 'rendering' | 'ready' | 'error' | 'disposed';

/** The owner of the current work or failure; no synthetic parser progress is implied. */
export type ScoreViewRenderPhase = 'source' | 'load' | 'render' | null;

/**
 * Immutable observation of one view's presentation lifecycle.
 *
 * `revision` increases for each published state. `generation` identifies the
 * current source/render attempt, so a superseded asynchronous attempt cannot
 * report readiness for its replacement. `ready` means that this view's current
 * presentation has been constructed, not that playback or an audio device is
 * ready. Source data and playback resources remain owned by their caller.
 */
export interface ScoreViewRenderState {
  readonly revision: number;
  readonly generation: number;
  readonly status: ScoreViewRenderStatus;
  readonly phase: ScoreViewRenderPhase;
  readonly score?: Score;
  /** Original failure, available when status is `error`. */
  readonly cause?: unknown;
}
