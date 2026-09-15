import type {Score} from '../../../core';
import {
  createAnalysisPlayhead,
  type AnalysisPlayheadHandle,
} from '@webmusic/ui/analysis';

export interface PlayheadHighlighter {
  follow(root: HTMLElement, score: Score, seconds: number): void;
  clear(): void;
}

export interface PlayheadHighlighterOptions {
  /** Scroll newly active rows into view. Flow lanes pass false to keep their frame fixed. */
  scroll?: boolean;
}

/** Highlight rendered rows or chips whose quarter-note span is playing. */
export function createPlayheadHighlighter(
  options: PlayheadHighlighterOptions = {},
): PlayheadHighlighter {
  let rootRef: HTMLElement | undefined;
  let presenter: AnalysisPlayheadHandle | undefined;

  const controllerFor = (root: HTMLElement): AnalysisPlayheadHandle => {
    if (rootRef === root && presenter) return presenter;
    presenter?.destroy();
    rootRef = root;
    presenter = createAnalysisPlayhead(root, {scroll: options.scroll});
    return presenter;
  };

  return {
    follow(root, score, seconds) {
      // Retain fractional quarters so semantic and visual positions agree.
      const quarters = score.timeMap.secondsToQuarters(Math.max(0, seconds)).toFloat();
      controllerFor(root).update(quarters);
    },
    clear() {
      presenter?.clear();
    },
  };
}
