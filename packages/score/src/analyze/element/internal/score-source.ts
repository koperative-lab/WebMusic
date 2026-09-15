import type {Score} from '../../../core';
import {readAnalysisPlayerScore, resolveAnalysisPlayer} from './player-binding';

/** What one resolution of the input produced. */
export interface ScoreSourceResult {
  score: Score | undefined;
  /** A newer load superseded this one; the caller must drop it on the floor. */
  stale: boolean;
  /**
   * The load was attempted and failed.
   *
   * Present ONLY for a real failure. No `src` at all, and an aborted load, both
   * answer with no score and no error — which is the distinction the caller
   * needs and could not make before: "nothing was asked for" renders an idle
   * shell, and "it was asked for and did not arrive" renders an error one.
   * Without this an element had no way to tell them apart, so it showed the
   * same blank for both and the reader could not tell either.
   */
  error?: string;
}

/** Score precedence: explicit `.score`, owned `src`, then the selected player's data. */
export interface ScoreSource {
  /** Explicit score assignment (overrides the `src` attribute). */
  score: Score | undefined;
  /** Current borrowed player data, used only without explicit input or src. */
  borrowed: Score | undefined;
  /** Resolve the current input and report whether a newer load superseded it. */
  load(): Promise<ScoreSourceResult>;
  /** Abort the owned URL load and make its eventual result stale. */
  cancel(): void;
}

/** Create the score input for a host element (reads `src` / `format`). */
export function createScoreSource(host: Element): ScoreSource {
  let explicit: Score | undefined;
  let borrowed: Score | undefined;
  let token = 0;
  let activeController: AbortController | undefined;

  const cancel = (): void => {
    token += 1;
    const controller = activeController;
    activeController = undefined;
    controller?.abort();
  };

  return {
    get score() {
      return explicit;
    },
    set score(score: Score | undefined) {
      explicit = score;
      cancel();
    },
    get borrowed() { return borrowed; },
    set borrowed(score: Score | undefined) { borrowed = score; cancel(); },
    async load() {
      cancel();
      const current = token;
      const explicitScore = explicit;
      const hasSource = !!host.getAttribute('src');
      const controller = explicitScore === undefined && hasSource ? new AbortController() : undefined;
      activeController = controller;
      try {
        const loaded = controller
          ? await loadScoreFromAttrs(host, controller.signal)
          : {score: explicitScore ?? borrowed ?? readAnalysisPlayerScore(resolveAnalysisPlayer(host))};
        return {score: loaded.score, stale: current !== token, error: loaded.error};
      } finally {
        if (activeController === controller) activeController = undefined;
      }
    },
    cancel,
  };
}

async function loadScoreFromAttrs(
  host: Element,
  signal: AbortSignal,
): Promise<{score?: Score; error?: string}> {
  const src = host.getAttribute('src');
  if (!src) return {};
  const format = host.getAttribute('format') ?? undefined;
  try {
    const io = await import('../../../io/load');
    return {
      score: await io.loadScoreFromUrl(src, {
        ...(format ? {format: format as never} : {}),
        signal,
      }),
    };
  } catch (error) {
    // An abort is this element's own doing — a newer `src`, or a disconnect —
    // so it is neither an error to report nor one to show.
    if (signal.aborted) return {};
    console.error('[WebScore] analysis element failed to load', src, error, '(is @webmusic/score/io installed?)');
    return {error: `Could not load ${src}`};
  }
}
