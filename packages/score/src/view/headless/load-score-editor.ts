import type {LoadScoreOptions} from '../../io/load';
import {createScoreEditor, type ScoreEditor, type ScoreEditorOptions} from './score-editor';

/** URL loading options plus the editor's history and listener options. */
export interface LoadScoreEditorOptions extends LoadScoreOptions, ScoreEditorOptions {}

const FORMATS = new Set(['midi', 'musicxml', 'mxl', 'abc']);

/**
 * Fetch and parse a Score file, then create the editor that owns it. The
 * caller owns the returned editor: assign it to `<score-view>` / `<score-player>`
 * through `.editor` and call `dispose()` when the document is no longer needed.
 *
 * Rejects with the loader's error (including an `AbortError` from `signal`)
 * and creates no editor in that case. The optional I/O stack loads on demand.
 */
export async function loadScoreEditor(url: string, options: LoadScoreEditorOptions = {}): Promise<ScoreEditor> {
  const {history, onListenerError, ...load} = options;
  if (load.format !== undefined && !FORMATS.has(load.format)) throw new TypeError(`Unsupported Score format: ${String(load.format)}`);
  const {loadScoreFromUrl} = await import('../../io/load');
  const score = await loadScoreFromUrl(url, load);
  load.signal?.throwIfAborted();
  return createScoreEditor(score, {
    ...(history !== undefined ? {history} : {}),
    ...(onListenerError ? {onListenerError} : {}),
  });
}
