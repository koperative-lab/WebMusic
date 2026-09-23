import {useEffect, useRef, type RefObject} from 'react';
import {observeScorePlayback, type Score, type ScorePlaybackSnapshot, type ScorePlaybackSource} from '../core';
import {createScoreView, type ScoreView} from '../view/headless/score-view';
import {upperBoundByStartTime} from '../view/core/windowing';
import type {RenderedScoreVisualizer, ScoreViewType} from '../view/api';
import type {ScoreViewRenderState} from '../view/render';
import {useOptionalPlayer, useOptionalScore} from './context';

export interface ReactScoreViewSource {
  /** Explicit immutable score. Without playback, this is a static view. */
  score?: Score;
  /** Borrowed observation only; unmount never stops or disposes its owner. */
  playback?: ScorePlaybackSource;
  /** Observe this view's source/render readiness and original failures. */
  onStateChange?: (state: ScoreViewRenderState) => void;
}

export type ReactScoreRenderer = (
  score: Score, surface: HTMLDivElement, signal: AbortSignal,
) => RenderedScoreVisualizer | Promise<RenderedScoreVisualizer>;

/** One subscription and render lifetime, shared by all three React views. */
export function useScoreViewRenderer(
  containerRef: RefObject<HTMLDivElement>,
  inputs: ReactScoreViewSource,
  type: ScoreViewType,
  render: ReactScoreRenderer,
): void {
  const inheritedScore = useOptionalScore();
  const inheritedPlayer = useOptionalPlayer();
  const playback = inputs.playback ?? (inputs.score === undefined ? inheritedPlayer?.playback : undefined);
  const explicitScore = inputs.score !== undefined;
  const fixedScore = inputs.score ?? (inputs.playback === undefined ? inheritedScore ?? undefined : undefined);
  const callback = useRef(inputs.onStateChange);
  callback.current = inputs.onStateChange;
  const revision = useRef(0);
  const generation = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let active = true;
    let initialized = false;
    let selectedScore: Score | undefined;
    let selectedReadiness: ScorePlaybackSnapshot['readiness'] | undefined;
    let sourceRevision: number | undefined;
    let selectedError: unknown;
    let latest: ScorePlaybackSnapshot | undefined;
    let unsubscribe: (() => void) | undefined;
    let staging: HTMLElement | undefined;
    let controller: AbortController | undefined;
    let rendered: RenderedScoreVisualizer | undefined;
    let model: ScoreView | undefined;
    const current = (request: number): boolean => active && generation.current === request;
    const report = (error: unknown): void => console.error('[WebScore] React view cleanup or callback failed', error);
    const publish = (status: ScoreViewRenderState['status'], phase: ScoreViewRenderState['phase'], cause?: unknown): void => {
      const state: ScoreViewRenderState = Object.freeze({
        revision: ++revision.current, generation: generation.current, status, phase,
        ...(selectedScore ? {score: selectedScore} : {}),
        ...(cause !== undefined ? {cause} : {}),
      });
      if (status === 'error' && !callback.current) console.error('[WebScore] React score view failed', cause);
      try {
        const result = callback.current?.(state) as unknown;
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(report);
      } catch (error) { report(error); }
    };
    const release = (): void => {
      const oldController = controller;
      const oldStaging = staging;
      const oldRendered = rendered;
      const oldModel = model;
      controller = undefined;
      staging = undefined;
      rendered = undefined;
      model = undefined;
      for (const cleanup of [
        () => oldController?.abort(),
        () => oldStaging?.remove(),
        () => oldModel?.dispose(),
        () => oldRendered?.dispose?.(),
        () => oldStaging?.replaceChildren(),
      ]) {
        try { cleanup(); } catch (error) { report(error); }
      }
    };
    const paint = (): void => {
      if (!rendered || !model || !latest) return;
      const state = model.updatePlayback(latest);
      if (latest.score !== selectedScore || latest.readiness !== 'ready') {
        rendered.clearActiveNotes();
        return;
      }
      if (latest.nominalSeconds !== null && rendered.redrawAtTime) {
        // Time-aware renderers retain the paused cursor and show score notes
        // at that position. clearActiveNotes also hides that cursor.
        rendered.redrawAtTime(state.currentTime, true);
        return;
      }
      let last = state.activeNotes[state.activeNotes.length - 1];
      if (!last && latest.nominalSeconds !== null && !rendered.redrawAtTime) {
        // OSMD's event renderer positions its cursor at a note boundary. A
        // paused source has no sounding occurrences; derive that boundary
        // from score time instead of hiding the cursor until another attack.
        const projected = model.seek(state.currentTime);
        last = projected.activeNotes[projected.activeNotes.length - 1]
          ?? model.sequence.notes[Math.max(0, upperBoundByStartTime(model.sequence.notes, state.currentTime) - 1)];
      }
      if (!last) rendered.clearActiveNotes();
      else {
        const note = rendered.noteSequence.notes.find((candidate) => candidate.partId === last.partId && candidate.noteId === last.noteId);
        if (note) rendered.redraw(note, true);
      }
    };
    const fail = (request: number, phase: ScoreViewRenderState['phase'], error: unknown): void => {
      if (!current(request)) return;
      release();
      if (current(request)) publish('error', phase, error);
    };
    const accept = (snapshot?: ScorePlaybackSnapshot): void => {
      if (!active) return;
      latest = snapshot;
      const score = fixedScore ?? snapshot?.score;
      const readiness = snapshot?.readiness;
      const replace = !initialized || score !== selectedScore || readiness !== selectedReadiness
        || snapshot?.sourceRevision !== sourceRevision || snapshot?.error !== selectedError;
      if (!replace) {
        try { paint(); } catch (error) { fail(generation.current, 'render', error); }
        return;
      }
      initialized = true;
      selectedScore = score;
      selectedReadiness = readiness;
      sourceRevision = snapshot?.sourceRevision;
      selectedError = snapshot?.error;
      const request = ++generation.current;
      release();
      if (!current(request)) return;
      if (!explicitScore && readiness === 'loading') { publish('loading', 'source'); return; }
      if (!explicitScore && readiness === 'error') { publish('error', 'source', snapshot?.error); return; }
      if (!score || (!explicitScore && readiness && readiness !== 'ready')) { publish('empty', snapshot ? 'source' : null); return; }
      publish('rendering', 'render');
      if (!current(request)) return;
      const root = container.ownerDocument.createElement('div');
      root.style.width = '100%';
      root.style.minHeight = '100%';
      staging = root;
      container.replaceChildren(root);
      const abort = new AbortController();
      controller = abort;
      const finish = (result: RenderedScoreVisualizer): void => {
        if (!current(request)) { try { result?.dispose?.(); } catch (error) { report(error); } return; }
        rendered = result;
        if (playback) model = createScoreView(score, {type});
        paint();
        if (current(request)) publish('ready', 'render');
      };
      try {
        const result = render(score, root, abort.signal);
        if (result && typeof (result as Promise<RenderedScoreVisualizer>).then === 'function') {
          void Promise.resolve(result).then(finish).catch((error) => fail(request, 'render', error));
        } else finish(result as RenderedScoreVisualizer);
      } catch (error) { fail(request, 'render', error); }
    };

    if (playback) {
      try {
        unsubscribe = observeScorePlayback(playback, accept);
        if (!active) unsubscribe();
      }
      catch (error) { fail(generation.current, 'source', error); }
    } else accept();
    return () => {
      active = false;
      generation.current += 1;
      try { unsubscribe?.(); } catch (error) { report(error); }
      release();
      publish('disposed', null);
    };
  }, [containerRef, explicitScore, fixedScore, playback, render, type]);
}
