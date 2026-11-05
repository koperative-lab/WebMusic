// Imperative DOM renderer factories; intentionally outside the code-only /headless layer.
import type {Score} from '../../../core';
import {scoreToNoteSequence} from '../../core/note-sequence';
import type {
  RenderedScoreVisualizer,
  ScoreNoteSequence,
  ScoreSequenceNote,
  StaffRenderOptions,
  VisualizerRenderOptions,
} from '../../core/types';
import {PianoRollSVGVisualizer} from './piano-roll';
import {ScrollType, StaffSVGVisualizer} from './staff';
import {WaterfallSVGVisualizer, type WaterfallVisualizerConfig} from './waterfall';

/** Browser handle; DOM details remain confined to the explicit render surface. */
export interface ScoreVisualizerHandle<TVisualizer = unknown> extends RenderedScoreVisualizer<TVisualizer> {
  /** Waterfall's native time viewport. Absent on renderers without an independent time scroller. */
  readonly scrollViewport?: HTMLElement;
}

export function renderPianoRollVisualizer(
  score: Score,
  svg: SVGSVGElement,
  config: VisualizerRenderOptions = {},
): ScoreVisualizerHandle {
  const noteSequence = scoreToNoteSequence(score);
  return wrapVisualizer(noteSequence, new PianoRollSVGVisualizer(noteSequence, svg, config, score));
}

export function renderWaterfallVisualizer(
  score: Score,
  container: HTMLDivElement,
  config: WaterfallVisualizerConfig = {},
): ScoreVisualizerHandle {
  const noteSequence = scoreToNoteSequence(score);
  return wrapVisualizer(noteSequence, new WaterfallSVGVisualizer(noteSequence, container, config, score));
}

export function renderStaffVisualizer(
  score: Score,
  container: HTMLDivElement,
  config: StaffRenderOptions = {},
): ScoreVisualizerHandle {
  const noteSequence = scoreToNoteSequence(score);
  const visualizer = new StaffSVGVisualizer(noteSequence, container, {
    ...config,
    scrollType: config.scrollType as ScrollType | undefined,
  }, score);
  return wrapVisualizer(noteSequence, visualizer);
}

function wrapVisualizer<
  TVisualizer extends {
    redraw(activeNote?: ScoreSequenceNote, scrollIntoView?: boolean): number | null;
    redrawAtTime?(seconds: number, scrollIntoView?: boolean): number | null;
    clearActiveNotes(): void;
    dispose?(): void;
    readonly scrollViewport?: HTMLElement;
  },
>(noteSequence: ScoreNoteSequence, visualizer: TVisualizer): ScoreVisualizerHandle<TVisualizer> {
  return {
    noteSequence,
    visualizer,
    get scrollViewport() { return visualizer.scrollViewport; },
    redraw: (activeNote, scrollIntoView) => visualizer.redraw(activeNote, scrollIntoView),
    ...(visualizer.redrawAtTime ? {redrawAtTime: (seconds: number, scrollIntoView?: boolean) => visualizer.redrawAtTime!(seconds, scrollIntoView)} : {}),
    clearActiveNotes: () => visualizer.clearActiveNotes(),
    dispose: () => visualizer.dispose?.(),
  };
}
