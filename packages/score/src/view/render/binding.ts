// Renderer-specific playback adapter; the code-only view controller lives in /headless.
import {findSequenceNote} from '../core/note-sequence';
import type {RenderedScoreVisualizer, ScoreSequenceNote} from '../core/types';
import type {ScoreView} from '../headless/score-view';

/** Handlers a player event source should invoke to drive a visualizer. */
export interface PlayerBindingHandlers {
  /** Highlight the sequence note matching this MIDI pitch + onset (seconds). */
  noteOn(midi: number, startTimeSeconds: number): void;
  /** Release one sounding note; the rest of the chord stays lit. */
  noteOff(midi: number, startTimeSeconds: number): void;
  /** Clear all active-note highlights (playback ended/stopped). */
  end(): void;
}

/**
 * Bind playback events to a rendered visualizer: `noteOn` looks up the
 * matching sequence note and redraws it as active (scrolling into view),
 * `noteOff` releases one note, `end` clears every highlight.
 *
 * A renderer highlights one nominated note plus everything sounding with it,
 * repainting from scratch each time — there is no per-note release. So this
 * adapter counts sounding events itself: releasing a note re-nominates the
 * most recent one still held, and only an empty set clears the highlight.
 * Without that, a `noteOff` in the middle of a chord would blank its siblings.
 *
 * `subscribe` adapts whatever event source the caller has (a `@webmusic/score/play`
 * Player, DOM CustomEvents, …) to the handlers and returns an unsubscribe
 * function. The returned function unsubscribes and clears any remaining
 * highlight.
 */
export function bindPlayerToVisualizer(
  rendered: RenderedScoreVisualizer,
  subscribe: (handlers: PlayerBindingHandlers) => () => void,
  controller?: ScoreView,
): () => void {
  // Insertion-ordered, so the "most recent still held" note is the last entry.
  const sounding = new Map<string, {note: ScoreSequenceNote; count: number}>();
  const keyOf = (note: ScoreSequenceNote): string => `${note.pitch}:${note.startTime}`;
  let disposed = false;
  let revision = 0;
  const current = (request: number): boolean => !disposed && request === revision;
  const clear = (): void => {
    sounding.clear();
    try {
      controller?.clearActiveNotes();
    } finally {
      rendered.clearActiveNotes();
    }
  };

  const handlers: PlayerBindingHandlers = {
    noteOn: (midi, startTimeSeconds) => {
      if (disposed) return;
      const request = ++revision;
      const note = findSequenceNote(rendered.noteSequence, midi, startTimeSeconds);
      if (note) {
        const key = keyOf(note);
        const held = sounding.get(key);
        sounding.set(key, {note, count: (held?.count ?? 0) + 1});
      }
      // Headless state is authoritative when supplied; the renderer is only
      // the second, visual side effect of the same player event.
      controller?.noteOn(midi, startTimeSeconds);
      if (!current(request)) return;
      rendered.redraw(note, true);
    },
    noteOff: (midi, startTimeSeconds) => {
      if (disposed) return;
      const request = ++revision;
      const note = findSequenceNote(rendered.noteSequence, midi, startTimeSeconds);
      const key = note && keyOf(note);
      const held = key === undefined ? undefined : sounding.get(key);
      if (held && held.count > 1) {
        held.count -= 1;
        return;
      }
      if (key !== undefined) sounding.delete(key);
      if (controller) {
        // Also accepts notes the caller activated through controller.seek().
        controller.noteOff(midi, startTimeSeconds);
        if (!current(request)) return;
        const active = controller.state.activeNotes;
        const latest = active[active.length - 1];
        const renderedLatest = latest
          ? findSequenceNote(rendered.noteSequence, latest.pitch, latest.startTime)
          : undefined;
        if (renderedLatest) rendered.redraw(renderedLatest, false);
        else rendered.clearActiveNotes();
        return;
      }
      if (!held) return;
      const remaining = [...sounding.values()];
      const latest = remaining[remaining.length - 1]?.note;
      if (latest) rendered.redraw(latest, false);
      else rendered.clearActiveNotes();
    },
    end: () => {
      if (disposed) return;
      const request = ++revision;
      sounding.clear();
      controller?.end();
      if (!current(request)) return;
      rendered.clearActiveNotes();
    },
  };

  let unsubscribe: () => void;
  try {
    unsubscribe = subscribe(handlers);
  } catch (error) {
    disposed = true;
    revision += 1;
    clear();
    throw error;
  }

  return () => {
    if (disposed) return;
    disposed = true;
    revision += 1;
    try {
      unsubscribe();
    } finally {
      clear();
    }
  };
}
